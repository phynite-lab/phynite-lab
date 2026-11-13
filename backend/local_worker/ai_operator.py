"""Bounded, restartable scientific-agent primitives.

The operator is deliberately small and dependency-light.  NumPy and SciPy are
the only numerical dependencies used by discovery; every other operation is
stdlib-only so a broken optional feature can be reported without exposing a
traceback or asking a researcher to install packages.
"""
from __future__ import annotations

import hashlib
import importlib
import json
import math
import os
import re
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

HUMAN_RUNTIME_MESSAGE = "Versi aplikasi ini belum memiliki modul Discovery. Perbarui Phynite Lab untuk mengaktifkannya."
MAX_DISCOVERY_VARIABLES = 5
MAX_SPARSE_FILE_BYTES = 64 * 1024 * 1024
MAX_SPARSE_BUNDLE_BYTES = 256 * 1024 * 1024
WAVEFUNCTION_RE = re.compile(r"(?:^|/)(?:wfc[^/]*|charge-density[^/]*|atomic_occupations[^/]*|.*\.save(?:/|$)|scratch(?:/|$)|checkpoint[^/]*)", re.I)


class OperatorError(ValueError):
    """A safe, actionable error suitable for a researcher-facing card."""


@dataclass(frozen=True)
class AiAgentBudget:
    maxWallSeconds: int
    maxQueueWaitSeconds: int
    agentLeaseTimeoutSeconds: int
    maxRepairs: int
    maxCandidates: int | None = None
    maxNodeHours: float | None = None
    maxSparseHarvestBytes: int = MAX_SPARSE_BUNDLE_BYTES

    def validate(self) -> "AiAgentBudget":
        integer_fields = {
            "maxWallSeconds": self.maxWallSeconds,
            "maxQueueWaitSeconds": self.maxQueueWaitSeconds,
            "agentLeaseTimeoutSeconds": self.agentLeaseTimeoutSeconds,
            "maxRepairs": self.maxRepairs,
            "maxCandidates": self.maxCandidates,
            "maxSparseHarvestBytes": self.maxSparseHarvestBytes,
        }
        for name, value in integer_fields.items():
            if value is not None and (isinstance(value, bool) or not isinstance(value, int) or value < 0):
                raise OperatorError(f"{name} must be a non-negative integer.")
        if self.maxWallSeconds < 1 or self.maxQueueWaitSeconds < 1 or self.agentLeaseTimeoutSeconds < 1:
            raise OperatorError("Agent time budgets must be positive.")
        if self.maxRepairs > 2:
            raise OperatorError("At most two numerical repairs are supported per candidate.")
        if self.maxCandidates is not None and not 1 <= self.maxCandidates <= 10_000:
            raise OperatorError("maxCandidates must be between 1 and 10,000.")
        if self.maxNodeHours is not None and (isinstance(self.maxNodeHours, bool) or not isinstance(self.maxNodeHours, (int, float)) or not math.isfinite(self.maxNodeHours) or self.maxNodeHours <= 0):
            raise OperatorError("maxNodeHours must be a positive finite number.")
        if not 1 <= self.maxSparseHarvestBytes <= MAX_SPARSE_BUNDLE_BYTES:
            raise OperatorError("Sparse evidence exceeds the 256 MiB safety limit.")
        return self


def budget_from_mapping(value: Mapping[str, Any]) -> AiAgentBudget:
    """Parse the durable JSON shape while rejecting unknown or missing fields."""
    allowed = {"maxWallSeconds", "maxQueueWaitSeconds", "agentLeaseTimeoutSeconds", "maxCandidates", "maxRepairs", "maxNodeHours", "maxSparseHarvestBytes"}
    if set(value) - allowed:
        raise OperatorError("Agent budget contains an unsupported field.")
    required = {"maxWallSeconds", "maxQueueWaitSeconds", "agentLeaseTimeoutSeconds", "maxRepairs", "maxSparseHarvestBytes"}
    if not required.issubset(value):
        raise OperatorError("Agent budget is incomplete.")
    return AiAgentBudget(**{key: value.get(key) for key in allowed if key in value}).validate()


def human_budget_summary(contract: Mapping[str, Any]) -> str:
    """Render a contract without exposing backend field names or hashes."""
    candidates = contract.get("maxCandidates")
    ranges = contract.get("parameterRanges") or {}
    node_hours = contract.get("totalNodeHours")
    cluster = contract.get("clusterLabel") or contract.get("cluster") or "kluster yang diizinkan"
    parts = [f"Maksimal {candidates} kandidat" if isinstance(candidates, int) else "Kandidat terbatas"]
    if isinstance(ranges, Mapping) and ranges:
        readable = []
        for name, value in ranges.items():
            if isinstance(value, Mapping) and "min" in value and "max" in value:
                unit = f" {value['unit']}" if value.get("unit") else ""
                readable.append(f"{name} {value['min']}–{value['max']}{unit}")
        if readable:
            parts.append("rentang " + ", ".join(readable))
    if isinstance(node_hours, (int, float)):
        parts.append(f"hingga {node_hours:g} jam node")
    parts.append(f"pada {cluster}")
    return ", ".join(parts) + "."


def validate_campaign_contract(contract: Mapping[str, Any], *, now_epoch: int | None = None) -> dict[str, Any]:
    """Validate the bounded pre-approval contract and return a canonical copy."""
    required = {"maxCandidates", "parameterRanges", "evaluator", "allowedClusters", "totalNodeHours", "maxWallSecondsPerCandidate", "repairPolicy", "expiresAtEpoch"}
    if not required.issubset(contract):
        raise OperatorError("Discovery campaign approval is incomplete.")
    max_candidates = contract["maxCandidates"]
    if isinstance(max_candidates, bool) or not isinstance(max_candidates, int) or not 1 <= max_candidates <= 5:
        raise OperatorError("Discovery campaign is limited to at most 5 candidates.")
    ranges = contract["parameterRanges"]
    if not isinstance(ranges, Mapping) or not ranges or len(ranges) > MAX_DISCOVERY_VARIABLES:
        raise OperatorError("Ruang desain ini terlalu besar untuk mode Discovery saat ini. Kurangi menjadi maksimal 5 parameter.")
    canonical_ranges: dict[str, dict[str, Any]] = {}
    for name, bounds in ranges.items():
        if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", name) or not isinstance(bounds, Mapping):
            raise OperatorError("Each discovery parameter needs a named finite range.")
        lower, upper = bounds.get("min"), bounds.get("max")
        if isinstance(lower, bool) or isinstance(upper, bool) or not isinstance(lower, (int, float)) or not isinstance(upper, (int, float)) or not math.isfinite(lower) or not math.isfinite(upper) or lower > upper:
            raise OperatorError(f"Discovery range for {name} is invalid.")
        unit = bounds.get("unit", "")
        if not isinstance(unit, str) or len(unit) > 32:
            raise OperatorError(f"Discovery unit for {name} is invalid.")
        canonical_ranges[name] = {"min": lower, "max": upper, "unit": unit}
    if not isinstance(contract.get("evaluator"), str) or not contract["evaluator"].strip():
        raise OperatorError("Discovery requires a named evaluator.")
    clusters = contract.get("allowedClusters")
    if not isinstance(clusters, list) or not clusters or any(not isinstance(item, str) or not item.strip() for item in clusters):
        raise OperatorError("Discovery requires at least one allowed cluster profile.")
    node_hours = contract.get("totalNodeHours")
    if isinstance(node_hours, bool) or not isinstance(node_hours, (int, float)) or not math.isfinite(node_hours) or node_hours <= 0:
        raise OperatorError("Campaign node-hours must be positive and finite.")
    wall = contract.get("maxWallSecondsPerCandidate")
    if isinstance(wall, bool) or not isinstance(wall, int) or wall < 1:
        raise OperatorError("Each candidate needs a positive computation-time limit.")
    repairs = contract.get("repairPolicy")
    if not isinstance(repairs, list) or any(not isinstance(item, str) or item not in REPAIR_CATALOG for item in repairs):
        raise OperatorError("Campaign repair policy contains an unsupported change.")
    expires = contract.get("expiresAtEpoch")
    if isinstance(expires, bool) or not isinstance(expires, int):
        raise OperatorError("Campaign approval expiry is invalid.")
    if now_epoch is not None and expires <= now_epoch:
        raise OperatorError("Campaign approval has expired; review it before continuing.")
    return {
        "version": 1,
        "maxCandidates": max_candidates,
        "parameterRanges": canonical_ranges,
        "evaluator": contract["evaluator"].strip(),
        "allowedClusters": sorted(set(clusters)),
        "totalNodeHours": float(node_hours),
        "maxWallSecondsPerCandidate": wall,
        "repairPolicy": list(dict.fromkeys(repairs)),
        "expiresAtEpoch": expires,
    }


def candidate_within_contract(candidate: Mapping[str, Any], contract: Mapping[str, Any], *, used_node_hours: float = 0) -> bool:
    ranges = contract.get("parameterRanges")
    if not isinstance(ranges, Mapping):
        raise OperatorError("Campaign contract has no parameter ranges.")
    parameters = candidate.get("parameters") if isinstance(candidate.get("parameters"), Mapping) else candidate
    for name, bounds in ranges.items():
        value = parameters.get(name) if isinstance(parameters, Mapping) else None
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < bounds["min"] or value > bounds["max"]:
            return False
    if candidate.get("cluster") is not None and candidate.get("cluster") not in contract.get("allowedClusters", []):
        return False
    if isinstance(candidate.get("wallSeconds"), int) and candidate["wallSeconds"] > contract.get("maxWallSecondsPerCandidate", 0):
        return False
    candidate_hours = float(candidate.get("nodeHours", 0) or 0)
    return used_node_hours + candidate_hours <= float(contract.get("totalNodeHours", 0))


def create_discovery_campaign(contract: Mapping[str, Any], candidates: Sequence[Mapping[str, Any]], destination: Path | None = None, *, now_epoch: int | None = None) -> dict[str, Any]:
    """Prepare a bounded campaign and record geometry failures as evidence.

    Geometry-invalid candidates remain in the evidence list with
    ``schedulerSlotUsed=False``; they are never submitted by this function.
    """
    runtime = require_discovery_runtime()
    canonical = validate_campaign_contract(contract, now_epoch=now_epoch)
    if len(candidates) > canonical["maxCandidates"]:
        raise OperatorError("Campaign exceeds its approved candidate limit.")
    used = 0.0
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    for index, candidate in enumerate(candidates):
        identity = canonical_candidate(candidate)
        if identity in seen:
            rows.append({"index": index, "state": "skipped", "reason": "duplicate candidate", "schedulerSlotUsed": False, "evidence": {"candidateSha256": identity}})
            continue
        seen.add(identity)
        if not candidate_within_contract(candidate, canonical, used_node_hours=used):
            rows.append({"index": index, "state": "approval-required", "reason": "candidate outside campaign contract", "schedulerSlotUsed": False, "evidence": {"candidateSha256": identity}})
            continue
        geometry = candidate.get("geometry")
        if not isinstance(geometry, Mapping):
            raise OperatorError("Each Discovery candidate needs validated geometry before submission.")
        try:
            geometry_result = geometry_feasibility(geometry.get("atoms", []), geometry.get("cell", []), geometry.get("periodicity", []), geometry.get("radii", {}))
        except OperatorError as error:
            rows.append({"index": index, "state": "skipped", "reason": str(error), "schedulerSlotUsed": False, "evidence": {"candidateSha256": identity}})
            continue
        if not geometry_result["feasible"]:
            rows.append({"index": index, "state": "skipped", "reason": geometry_result["message"], "schedulerSlotUsed": False, "evidence": {"candidateSha256": identity, "geometry": geometry_result}})
            continue
        node_hours = float(candidate.get("nodeHours", 0) or 0)
        used += node_hours
        rows.append({"index": index, "state": "planned", "reason": "validated", "schedulerSlotUsed": True, "evidence": {"candidateSha256": identity, "geometry": geometry_result}, "candidate": dict(candidate)})
    state = {"version": 1, "kind": "discovery", "contract": canonical, "runtime": runtime, "createdAtEpoch": now_epoch or int(time.time()), "rows": rows, "usedNodeHours": used}
    if destination is not None:
        try:
            from recovery import atomic_json
        except ImportError:
            from .recovery import atomic_json
        atomic_json(Path(destination), state, overwrite=False)
    return state


# The catalog is intentionally closed.  Values are validated again at execution.
REPAIR_CATALOG: dict[str, dict[str, Any]] = {
    "lower_mixing_beta": {"field": "mixing_beta", "min": 0.05, "max": 0.7, "direction": "lower"},
    "switch_solver": {"field": "diagonalization", "values": ["david", "cg"]},
    "switch_mixing_mode": {"field": "mixing_mode", "values": ["plain", "TF", "local-TF"]},
    "raise_electron_maxstep": {"field": "electron_maxstep", "min": 1, "max": 500, "direction": "higher"},
}
FORBIDDEN_REPAIR_FIELDS = {"composition", "elements", "atoms", "atomic_species", "pseudopotential", "functional", "charge", "spin", "magnetization", "cutoff", "ecutwfc", "ecutrho", "kpoints", "k_point", "lattice", "cell", "coordinates", "positions", "periodicity", "calculation", "evaluator", "objective"}


def validate_repair(proposal: Mapping[str, Any], *, current: Mapping[str, Any] | None = None, allowed: Iterable[str] = (), diagnostics: Mapping[str, Any] | None = None, budget: AiAgentBudget | None = None) -> dict[str, Any]:
    kind = proposal.get("kind")
    if not isinstance(kind, str) or kind not in REPAIR_CATALOG:
        raise OperatorError("Perlu keputusan tentang perubahan metode")
    if kind not in set(allowed):
        raise OperatorError("Perlu keputusan tentang perubahan metode")
    spec = REPAIR_CATALOG[kind]
    field, value = spec["field"], proposal.get("value")
    for key in proposal:
        if key.lower() in FORBIDDEN_REPAIR_FIELDS:
            raise OperatorError("Perubahan ini menyentuh identitas ilmiah dan tidak dapat diperbaiki otomatis.")
    if "values" in spec and value not in spec["values"]:
        raise OperatorError("Repair value is outside the approved catalog.")
    if "min" in spec and (isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not spec["min"] <= value <= spec["max"]):
        raise OperatorError("Repair value is outside the approved validator range.")
    if current and field in current:
        before = current[field]
        if spec.get("direction") == "lower" and not value < before:
            raise OperatorError("The repair must lower the selected convergence parameter.")
        if spec.get("direction") == "higher" and not value > before:
            raise OperatorError("The repair must increase the selected convergence parameter.")
    return {"kind": kind, "field": field, "value": value, "reason": str(proposal.get("reason") or "Validated convergence repair."), "scientificIdentityChanged": False}


def geometry_feasibility(atoms: Sequence[Mapping[str, Any]], cell: Sequence[Sequence[float]], periodicity: Sequence[bool], radii: Mapping[str, Mapping[str, Any]], *, minimum_factor: float = 0.65) -> dict[str, Any]:
    """Reject overlapping candidates, including periodic images.

    Positions are Cartesian and cell vectors are rows.  A radius without a
    source/version is treated as unknown instead of receiving a silent fallback.
    """
    try:
        import numpy as np
    except Exception as error:  # pragma: no cover - exercised by runtime check
        raise OperatorError(HUMAN_RUNTIME_MESSAGE) from error
    if len(periodicity) != 3 or any(type(item) is not bool for item in periodicity) or len(cell) != 3 or any(len(row) != 3 for row in cell):
        raise OperatorError("Geometry cell or periodicity is invalid.")
    matrix = np.asarray(cell, dtype=float)
    if not np.isfinite(matrix).all() or abs(float(np.linalg.det(matrix))) <= 1e-12:
        raise OperatorError("Geometry cell volume is invalid.")
    if not atoms:
        raise OperatorError("Geometry has no atoms.")
    positions: list[Any] = []
    for atom in atoms:
        element = atom.get("element")
        position = atom.get("position")
        radius = radii.get(element) if isinstance(element, str) else None
        if not isinstance(radius, Mapping) or not isinstance(radius.get("covalent"), (int, float)) or isinstance(radius.get("covalent"), bool) or radius["covalent"] <= 0 or not radius.get("source") or not radius.get("version"):
            raise OperatorError(f"Covalent radius for {element or 'an element'} is unavailable; candidate is blocked.")
        if not isinstance(position, Sequence) or len(position) != 3:
            raise OperatorError("Geometry atom coordinates are invalid.")
        point = np.asarray(position, dtype=float)
        if not np.isfinite(point).all():
            raise OperatorError("Geometry atom coordinates are invalid.")
        positions.append(point)
    shifts = [np.array([i, j, k], dtype=float) for i in (-1, 0, 1) for j in (-1, 0, 1) for k in (-1, 0, 1) if all((component == 0 or periodicity[index]) for index, component in enumerate((i, j, k)))]
    best: dict[str, Any] | None = None
    for left in range(len(atoms)):
        for right in range(left, len(atoms)):
            for shift in shifts:
                if left == right and not np.any(shift):
                    continue
                distance = float(np.linalg.norm(positions[right] + shift @ matrix - positions[left]))
                threshold = minimum_factor * (float(radii[atoms[left]["element"]]["covalent"]) + float(radii[atoms[right]["element"]]["covalent"]))
                if best is None or distance < best["distance"]:
                    best = {"left": left, "right": right, "imageShift": shift.astype(int).tolist(), "distance": distance, "threshold": threshold}
    if best is None or best["distance"] < best["threshold"]:
        return {"feasible": False, "reasonCode": "geometry-overlap", "message": "Kandidat dilewati karena jarak antar atom terlalu dekat. Tidak dikirim ke antrean HPC.", "evidence": best}
    return {"feasible": True, "reasonCode": "ok", "message": "Geometry kandidat lolos validasi.", "evidence": best}


check_geometry_feasibility = geometry_feasibility


def canonical_candidate(candidate: Mapping[str, Any]) -> str:
    return hashlib.sha256(json.dumps(candidate, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


class RbfGaussianProcess:
    """Small deterministic GP used by Discovery v1.

    It intentionally implements only the RBF kernel and Cholesky solve.  The
    class has no optimizer or external acquisition package, which keeps the
    runtime auditable and bounded for at most five design variables.
    """

    def __init__(self, *, length_scale: float = 1.0, signal_variance: float = 1.0, seed: int = 0, jitter_initial: float = 1e-10, jitter_max: float = 1e-2) -> None:
        if not math.isfinite(length_scale) or length_scale <= 0 or not math.isfinite(signal_variance) or signal_variance <= 0:
            raise OperatorError("Discovery GP kernel parameters are invalid.")
        self.length_scale = float(length_scale)
        self.signal_variance = float(signal_variance)
        self.seed = int(seed)
        self.jitter_initial = float(jitter_initial)
        self.jitter_max = float(jitter_max)
        self._x: Any = None
        self._y_mean = 0.0
        self._y_scale = 1.0
        self._alpha: Any = None
        self._factor: Any = None
        self.jitter: float | None = None

    @staticmethod
    def _arrays(x: Sequence[Sequence[float]], y: Sequence[float]) -> tuple[Any, Any]:
        try:
            import numpy as np
        except Exception as error:  # pragma: no cover
            raise OperatorError(HUMAN_RUNTIME_MESSAGE) from error
        values = np.asarray(x, dtype=float)
        targets = np.asarray(y, dtype=float).reshape(-1)
        if values.ndim != 2 or not values.shape[0] or values.shape[1] > MAX_DISCOVERY_VARIABLES or targets.shape[0] != values.shape[0] or not np.isfinite(values).all() or not np.isfinite(targets).all():
            if values.ndim == 2 and values.shape[1] > MAX_DISCOVERY_VARIABLES:
                raise OperatorError("Ruang desain ini terlalu besar untuk mode Discovery saat ini. Kurangi menjadi maksimal 5 parameter.")
            raise OperatorError("Discovery training data must be finite and rectangular.")
        return values, targets

    def _kernel(self, left: Any, right: Any) -> Any:
        import numpy as np
        distances = left[:, None, :] - right[None, :, :]
        return self.signal_variance * np.exp(-0.5 * np.sum(distances * distances, axis=2) / (self.length_scale * self.length_scale))

    def fit(self, x: Sequence[Sequence[float]], y: Sequence[float]) -> "RbfGaussianProcess":
        import numpy as np
        from scipy import linalg
        values, targets = self._arrays(x, y)
        self._x = values
        self._y_mean = float(targets.mean())
        spread = float(targets.std())
        self._y_scale = spread if spread > 1e-12 else 1.0
        normalized = (targets - self._y_mean) / self._y_scale
        base = self._kernel(values, values)
        jitter = max(self.jitter_initial, 1e-16)
        while jitter <= self.jitter_max:
            try:
                factor = linalg.cho_factor(base + np.eye(values.shape[0]) * jitter, lower=True, check_finite=True)
                self._factor = factor
                self._alpha = linalg.cho_solve(factor, normalized, check_finite=True)
                self.jitter = jitter
                return self
            except (ValueError, np.linalg.LinAlgError):
                jitter *= 10
        raise OperatorError("Discovery model could not obtain a stable numerical factorization.")

    def predict(self, x: Sequence[Sequence[float]]) -> tuple[list[float], list[float]]:
        import numpy as np
        from scipy import linalg
        if self._x is None or self._factor is None or self._alpha is None:
            raise OperatorError("Discovery model has no validated training data.")
        values = np.asarray(x, dtype=float)
        if values.ndim != 2 or values.shape[1] != self._x.shape[1] or not np.isfinite(values).all():
            raise OperatorError("Discovery prediction data has the wrong shape.")
        cross = self._kernel(values, self._x)
        mean = self._y_mean + self._y_scale * (cross @ self._alpha)
        solved = linalg.cho_solve(self._factor, cross.T, check_finite=True)
        variance = np.maximum(0.0, self._kernel(values, values).diagonal() - np.sum(cross * solved.T, axis=1))
        return mean.astype(float).tolist(), (np.sqrt(variance) * self._y_scale).astype(float).tolist()

    def acquisition(self, x: Sequence[Sequence[float]], focus: str = "exploration") -> list[float]:
        mean, uncertainty = self.predict(x)
        if focus in {"exploration", "explore"}:
            return uncertainty
        if focus in {"precision", "precise"}:
            # Lower objective values are preferred; uncertainty only breaks ties.
            return [(-value) + 1e-6 * spread for value, spread in zip(mean, uncertainty)]
        raise OperatorError("Discovery focus must be exploration or precision.")


# Stable public names for callers that do not need to know the kernel detail.
GaussianProcess = RbfGaussianProcess


def sparse_evidence_manifest(files: Iterable[Mapping[str, Any]], *, limit_bytes: int = MAX_SPARSE_BUNDLE_BYTES) -> dict[str, Any]:
    """Keep small scientific evidence and retain large artifacts as references."""
    if not 1 <= limit_bytes <= MAX_SPARSE_BUNDLE_BYTES:
        raise OperatorError("Sparse evidence limit is outside the supported range.")
    used = 0
    entries: list[dict[str, Any]] = []
    for item in files:
        path = item.get("path")
        if not isinstance(path, str) or not path or path.startswith("/") or ".." in Path(path).parts:
            continue
        size = item.get("sizeBytes")
        checksum = item.get("sha256")
        allowed = isinstance(size, int) and size >= 0 and isinstance(checksum, str) and bool(re.fullmatch(r"[a-f0-9]{64}", checksum))
        excluded = bool(WAVEFUNCTION_RE.search(path))
        if not allowed:
            entries.append({"path": path, "status": "not_downloaded", "reason": "manifest metadata is incomplete"})
            continue
        if excluded:
            entries.append({"path": path, "sizeBytes": size, "sha256": checksum, "remotePath": item.get("remotePath"), "status": "reference_only", "reason": "large solver binary retained remotely"})
            continue
        if size > MAX_SPARSE_FILE_BYTES or used + size > limit_bytes:
            entries.append({"path": path, "sizeBytes": size, "sha256": checksum, "remotePath": item.get("remotePath"), "status": "reference_only", "reason": "sparse evidence size limit"})
            continue
        used += size
        entries.append({"path": path, "sizeBytes": size, "sha256": checksum, "status": "downloaded"})
    return {"version": 1, "mode": "sparse", "downloadedBytes": used, "limitBytes": limit_bytes, "files": entries, "largeFilesRemainRemote": any(entry["status"] != "downloaded" for entry in entries)}


sparse_bundle_manifest = sparse_evidence_manifest


def reconcile_receipt(receipt: Mapping[str, Any], scheduler_status: Mapping[str, Any], *, now_epoch: int | None = None, harvest: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """Resume observation/validation after browser or laptop shutdown.

    This function never submits or resubmits a job.  An unmatchable receipt
    stops at manual inspection, preserving scratch and checkpoints.
    """
    required = ("scheduler", "schedulerJobId", "remoteWorkDir", "profileSha256")
    if any(not receipt.get(key) for key in required) or scheduler_status.get("schedulerJobId") != receipt.get("schedulerJobId"):
        return {"state": "manual-resume-required", "message": "Perlu pemeriksaan manual", "resubmit": False, "scratchRetained": True}
    state = str(scheduler_status.get("state", "UNKNOWN")).upper()
    queue_started = int(receipt.get("submittedAtEpoch") or receipt.get("createdAtEpoch") or (now_epoch or time.time()))
    now = now_epoch or int(time.time())
    result: dict[str, Any] = {"scheduler": receipt["scheduler"], "schedulerJobId": receipt["schedulerJobId"], "queueWaitSeconds": max(0, now - queue_started), "resubmit": False, "scratchRetained": True}
    if state in {"PENDING", "PD", "Q", "QUEUED", "CONFIGURING"}:
        result.update(state="observing", phase="queue", message="Job masih menunggu antrean")
        return result
    if state in {"RUNNING", "R", "EXECUTING"}:
        result.update(state="observing", phase="solver", message="Kalkulasi sedang berjalan")
        return result
    if state not in {"COMPLETED", "C", "FAILED", "F", "TIMEOUT", "NODE_FAIL", "CANCELLED", "E", "X"}:
        return {**result, "state": "manual-resume-required", "message": "Perlu pemeriksaan manual"}
    if state not in {"COMPLETED", "C"} or str(scheduler_status.get("exitCode", "")) not in {"0", "0:0"}:
        return {**result, "state": "manual-resume-required", "message": "Output belum lengkap"}
    if not isinstance(harvest, Mapping) or harvest.get("manifestValidated") is not True:
        return {**result, "state": "manual-resume-required", "message": "Output belum lengkap"}
    return {**result, "state": "validating", "phase": "evidence", "message": "Memvalidasi hasil dan provenance", "harvest": dict(harvest)}


def budget_phase(receipt: Mapping[str, Any], scheduler_status: Mapping[str, Any], budget: AiAgentBudget, *, now_epoch: int | None = None) -> dict[str, Any]:
    """Report queue and solver clocks independently; never call a queued job a wall timeout."""
    budget.validate()
    now = now_epoch or int(time.time())
    submitted = int(receipt.get("submittedAtEpoch") or receipt.get("createdAtEpoch") or now)
    state = str(scheduler_status.get("state", "UNKNOWN")).upper()
    queue_seconds = max(0, now - submitted)
    if state in {"PENDING", "PD", "Q", "QUEUED", "CONFIGURING"}:
        return {"phase": "queue", "queueWaitSeconds": queue_seconds, "queueExceeded": queue_seconds > budget.maxQueueWaitSeconds, "solverElapsedSeconds": 0, "wallExceeded": False}
    started = int(receipt.get("solverStartedAtEpoch") or scheduler_status.get("startedAtEpoch") or submitted)
    elapsed = max(0, now - started)
    return {"phase": "solver", "queueWaitSeconds": queue_seconds, "queueExceeded": queue_seconds > budget.maxQueueWaitSeconds, "solverElapsedSeconds": elapsed, "wallExceeded": elapsed > budget.maxWallSeconds}


def human_error(code: str) -> dict[str, str]:
    messages = {
        "SSH_DISCONNECTED": ("Koneksi ke kluster terputus", "WiFi atau VPN kampus mungkin sedang offline. Job remote tetap dipantau dan tidak dibatalkan. Sambungkan kembali internet Anda, lalu tekan Sambung Ulang.", "Sambung Ulang"),
        "JOB_QUEUED": ("Job masih menunggu antrean", "Kluster belum menempatkan job ke node komputasi. Ini belum dianggap gagal. Agent akan memantau sampai batas tunggu antrean yang Anda pilih.", "Lihat status job"),
        "OUTPUT_INCOMPLETE": ("Output belum lengkap", "File hasil belum cukup untuk memastikan kalkulasi berhasil. Checkpoint dan scratch dipertahankan.", "Lanjutkan manual"),
        "REPAIR_APPROVAL": ("Perlu keputusan tentang perubahan metode", "Perhitungan mengalami masalah konvergensi. Agent menyiapkan perubahan yang aman untuk ditinjau sebelum mencoba lagi.", "Tinjau perubahan"),
    }
    title, message, action = messages.get(code, ("Pekerjaan belum selesai", "Agent menyimpan bukti yang tersedia dan menunggu tindakan Anda.", "Unduh evidence"))
    return {"title": title, "message": message, "action": action}


def feature_flags(environment: Mapping[str, str] | None = None) -> dict[str, bool]:
    source = environment or os.environ
    defaults = {"ai-agent-operator": True, "ai-agent-vision": False, "ai-agent-healing": False, "ai-agent-discovery": False}
    result = {}
    for name, default in defaults.items():
        key = "PHYNITE_" + name.upper().replace("-", "_")
        raw = source.get(key)
        result[name] = default if raw is None else raw.strip().lower() in {"1", "true", "yes", "on"}
    return result


def runtime_self_check(python: str | None = None) -> dict[str, Any]:
    """Check bundled scientific dependencies and a tiny Cholesky path."""
    if python and Path(python).resolve() != Path(sys.executable).resolve():
        code = "import importlib, json, numpy as np; from scipy import linalg; a=np.array([[1.,.2],[.2,1.]]); linalg.cho_solve(linalg.cho_factor(a, lower=True), np.array([1.,.5])); importlib.import_module('scipy.linalg'); print(json.dumps({'available': True, 'numpy': np.__version__, 'scipy': importlib.import_module('scipy').__version__, 'scipyLinalg': True, 'gpCholesky': True, 'message': 'Discovery tersedia.'}))"
        try:
            result = subprocess.run([python, "-c", code], capture_output=True, text=True, timeout=15, check=False)
            value = json.loads(result.stdout.strip().splitlines()[-1]) if result.returncode == 0 and result.stdout.strip() else None
            if isinstance(value, dict) and value.get("available") is True:
                return value
        except (OSError, subprocess.SubprocessError, ValueError, IndexError):
            pass
        return {"available": False, "message": HUMAN_RUNTIME_MESSAGE}
    try:
        numpy = importlib.import_module("numpy")
        linalg = importlib.import_module("scipy.linalg")
        matrix = numpy.array([[1.0, 0.2], [0.2, 1.0]], dtype=float)
        factor = linalg.cho_factor(matrix, lower=True, check_finite=True)
        solved = linalg.cho_solve(factor, numpy.array([1.0, 0.5]))
        if not numpy.isfinite(solved).all():
            raise ValueError("non-finite Cholesky result")
        worker_root = str(Path(__file__).resolve().parent)
        if worker_root not in sys.path:
            sys.path.insert(0, worker_root)
        for module in ("hpc_remote", "recovery"):
            try:
                importlib.import_module(module)
            except ImportError:
                importlib.import_module(f"backend.local_worker.{module}")
        return {"available": True, "numpy": getattr(numpy, "__version__", "unknown"), "scipy": importlib.import_module("scipy").__version__, "scipyLinalg": True, "gpCholesky": True, "message": "Discovery tersedia."}
    except Exception:
        return {"available": False, "message": HUMAN_RUNTIME_MESSAGE}


def require_discovery_runtime() -> dict[str, Any]:
    status = runtime_self_check()
    if status.get("available") is not True:
        raise OperatorError(HUMAN_RUNTIME_MESSAGE)
    return status


def assert_no_terminal_install_instructions(text: str) -> None:
    if re.search(r"(?:pip|python\s+-m\s+pip|conda)\s+install|sudo\s+|apt(?:-get)?\s+install", text, re.I):
        raise AssertionError("Researcher-facing runtime text contains an installation command.")

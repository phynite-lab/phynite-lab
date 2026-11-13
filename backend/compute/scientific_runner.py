"""Native QE execution kernel; the hosted AWS entrypoint is separate."""
from __future__ import annotations
from compute_clock import measured_compute
from scf_reuse import create_bundle, restore_bundle, digest as scf_bundle_digest

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import time
import traceback
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import numpy as np

from kpath import parse_qe_structure, qe_path_break_indices, qe_path_lines, replace_matdyn_q_path, replace_pw_k_path, requested_path_segments, seek_path_for_qe
from results import build_scientific_results, parse_qe_output, qe_stage_xml_path, retain_qe_stage_xml, write_result_manifest
from qe_model import dft_result_error, qe_stage_error, qe_runtime_identity, qe_string_value, transport_numbers, validate_qe_models, validate_band_postprocessor_input, validate_relaxation_input, validate_transport_settings
from workflow_scf import attach_scf_bundle, prepare_shared_scf


WORK = Path(os.environ.get("PHYNITE_WORK_DIR", "/work")).resolve()
INPUT = WORK / "input.json"
PSEUDO = WORK / "pseudo"
SCRATCH = WORK / "tmp"
OUTPUT = WORK / "results"
LOGS = OUTPUT / "logs"
DATA = OUTPUT / "data"
MARKER = "! ---------- "
MAX_INPUT_FILES = 12
MAX_INPUT_FILE_SIZE = 1_000_000
BOHR_TO_ANGSTROM = 0.529177210903
HARTREE_TO_EV = 27.211386245988
BOLTZMANN_EV_PER_K = 8.617333262145e-5
DEFAULT_TRANSPORT_INTERPOLATION_WINDOW_HA = 0.2
QE_MEMORY_ESTIMATE = re.compile(
    r"Estimated total dynamical RAM\s*>\s*([0-9.+\-Ee]+)\s*(KB|MB|GB|TB)",
    re.IGNORECASE,
)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def safe_extract(archive: Path, destination: Path) -> None:
    destination_resolved = destination.resolve()
    with tarfile.open(archive, "r:gz") as handle:
        for member in handle.getmembers():
            target = (destination / member.name).resolve()
            if destination_resolved not in target.parents and target != destination_resolved:
                raise RuntimeError("Dependency archive contains an unsafe path")
        handle.extractall(destination, filter="data")


def split_workflow(qe_input: str) -> tuple[str, dict[str, str]]:
    base, *sections = qe_input.split(MARKER)
    parsed: dict[str, str] = {}
    for section in sections:
        heading, _, content = section.partition("----------")
        parsed[heading.strip().lower()] = content.strip() + "\n"
    return base.rstrip() + "\n", parsed


def set_pw_calculation(input_text: str, calculation: str) -> str:
    if re.search(r"\bcalculation\s*=\s*['\"][^'\"]+['\"]", input_text, re.IGNORECASE):
        updated = re.sub(
            r"\bcalculation\s*=\s*['\"][^'\"]+['\"]",
            f"calculation = '{calculation}'",
            input_text,
            count=1,
            flags=re.IGNORECASE,
        )
    else:
        updated = re.sub(
            r"&CONTROL\b",
            f"&CONTROL\n  calculation = '{calculation}'",
            input_text,
            count=1,
            flags=re.IGNORECASE,
        )
    return normalize_pw_continuation_input(updated)


def pw_calculation_mode(input_text: str) -> str:
    return qe_string_value(input_text, "CONTROL", "calculation", "scf")


def normalize_pw_continuation_input(input_text: str) -> str:
    """Make NSCF/bands inputs read the charge density produced by SCF."""
    if pw_calculation_mode(input_text) not in {"nscf", "bands"}:
        return input_text
    return re.sub(
        r"(?im)^[ \t]*startingpot[ \t]*=[ \t]*['\"][^'\"]*['\"][ \t]*,?",
        "  startingpot = 'file'",
        input_text,
        count=1,
    )


def qe_resource_preflight_input(input_text: str, name: str) -> str:
    """Build a non-destructive input used only to estimate pw.x resources.

    A native NSCF ``nstep = 0`` still needs the previous SCF workspace and can
    enter band diagonalization. For resource estimation we instead preserve
    its system, cutoff, bands, and k-grid while switching only the disposable
    preflight copy to SCF initialization in an isolated outdir.
    """
    preflight_source = input_text
    if pw_calculation_mode(input_text) in {"nscf", "bands"}:
        preflight_source = re.sub(
            r"\bcalculation\s*=\s*['\"][^'\"]+['\"]",
            "calculation = 'scf'",
            preflight_source,
            count=1,
            flags=re.IGNORECASE,
        )
        preflight_source = re.sub(
            r"(?im)^[ \t]*startingpot[ \t]*=[ \t]*['\"][^'\"]*['\"][ \t]*,?",
            "  startingpot = 'atomic'",
            preflight_source,
            count=1,
        )
        if re.search(r"(?im)^\s*K_POINTS\s+(?:crystal_b|tpiba_b)\b", preflight_source):
            preflight_source = re.sub(
                r"(?ims)^\s*K_POINTS\s+(?:crystal_b|tpiba_b)\b.*$",
                "K_POINTS gamma\n",
                preflight_source,
                count=1,
            )
    return qe_dry_run_input(preflight_source, f"./preflight-{name}-tmp")


def qe_dry_run_input(
    input_text: str,
    preflight_outdir: str | None = "./preflight-tmp",
) -> str:
    """Return a pw.x input that stops after initialization.

    Quantum ESPRESSO documents ``nstep = 0`` as a quick dry run. Keeping the
    user's remaining input intact makes the initialization summary, including
    the dynamical-memory estimate, representative of the real calculation. A
    separate outdir prevents the dry run from contaminating reusable SCF data.
    """
    control = re.search(r"(?ims)&CONTROL\b(?P<body>.*?)(?P<end>^\s*/\s*(?:!.*)?$)", input_text)
    if not control:
        raise RuntimeError("Quantum ESPRESSO resource preflight requires a &CONTROL namelist")
    body = control.group("body")
    if re.search(r"(?im)^\s*nstep\s*=", body):
        body = re.sub(r"(?im)^\s*nstep\s*=\s*[^,\n/]+,?", "  nstep = 0,", body, count=1)
    else:
        body = f"{body.rstrip()}\n  nstep = 0,\n"
    if preflight_outdir is not None:
        if re.search(r"(?im)^\s*outdir\s*=", body):
            body = re.sub(
                r"(?im)^\s*outdir\s*=\s*['\"][^'\"]*['\"]\s*,?",
                f"  outdir = '{preflight_outdir}',",
                body,
                count=1,
            )
        else:
            body = f"{body.rstrip()}\n  outdir = '{preflight_outdir}',\n"
    return f"{input_text[:control.start('body')]}{body}{input_text[control.start('end'):]}"


def parse_qe_memory_estimate_mib(output: str) -> float | None:
    """Parse QE's lower-bound total dynamical-memory estimate as MiB."""
    matches = list(QE_MEMORY_ESTIMATE.finditer(output))
    if not matches:
        return None
    value = float(matches[-1].group(1))
    unit = matches[-1].group(2).upper()
    factors = {"KB": 1 / 1024, "MB": 1, "GB": 1024, "TB": 1024 * 1024}
    return value * factors[unit]


def _configured_memory_limit_mib() -> int | None:
    raw = os.environ.get("PHYNITE_MEMORY_MIB", "").strip()
    if not raw:
        return None
    try:
        value = int(raw)
    except ValueError as exc:
        raise RuntimeError("PHYNITE_MEMORY_MIB must be an integer") from exc
    return max(1, value)


def insufficient_memory_message(name: str, estimated_mib: float | None, limit_mib: int | None) -> str:
    if estimated_mib is not None and limit_mib is not None:
        return (
            f"Insufficient compute memory for {name}: Quantum ESPRESSO estimates at least "
            f"{estimated_mib / 1024:.2f} GB, but this job is limited to {limit_mib / 1024:.2f} GB. "
            "Reduce the accuracy or k-point grid, or increase the job memory."
        )
    if limit_mib is not None:
        return (
            f"Insufficient compute memory for {name}: the process was killed while the job was limited to "
            f"{limit_mib / 1024:.2f} GB. Reduce the accuracy or k-point grid, or increase the job memory."
        )
    return (
        f"Insufficient compute memory for {name}: Quantum ESPRESSO was killed by the operating system. "
        "Reduce the accuracy or k-point grid, or increase the available memory."
    )


def normalize_qe_paths(input_text: str) -> str:
    normalized = input_text
    for variable, value in {"outdir": "./tmp", "pseudo_dir": "./pseudo"}.items():
        pattern = rf"\b{variable}\s*=\s*['\"][^'\"]*['\"]"
        if re.search(pattern, normalized, re.IGNORECASE):
            normalized = re.sub(pattern, f"{variable} = '{value}'", normalized, count=1, flags=re.IGNORECASE)
    return normalized.rstrip() + "\n"


def sanitize_bands_input(input_text: str) -> str:
    """Use the full calculated k-path for bands.x symmetry processing.

    Quantum ESPRESSO's firstk/lastk variables select k-point indices, not band
    indices. Older Phynite drafts emitted ``firstk = 1`` and ``lastk = 0`` as
    an alleged "all bands" range; QE rejects that pair in findnks1nks2. The
    default bands.x behavior already processes the complete path, so removing
    both variables is the safe, scientifically equivalent migration.
    """
    sanitized = re.sub(
        r"(?im)^\s*(?:firstk|lastk)\s*=\s*[^\n!]*(?:!.*)?\n?",
        "",
        input_text,
    )
    return sanitized.rstrip() + "\n"


def _safe_input_filename(name: str) -> str:
    filename = Path(name).name
    if filename != name or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", filename):
        raise RuntimeError("Calculation contains an unsafe input filename")
    return filename


def resolve_input_files(payload: dict[str, Any]) -> dict[str, str]:
    supplied = payload.get("inputFiles")
    if supplied is not None:
        if not isinstance(supplied, dict) or not 1 <= len(supplied) <= MAX_INPUT_FILES:
            raise RuntimeError("Calculation input-file set is invalid")
        resolved: dict[str, str] = {}
        for raw_name, raw_content in supplied.items():
            name = _safe_input_filename(str(raw_name))
            if not isinstance(raw_content, str) or not raw_content.strip() or len(raw_content) > MAX_INPUT_FILE_SIZE:
                raise RuntimeError(f"Calculation input file {name} is invalid")
            normalized = normalize_pw_continuation_input(normalize_qe_paths(raw_content))
            resolved[name] = sanitize_bands_input(normalized) if name == "bands.in" else normalized
        return resolved

    primary, sections = split_workflow(payload["qeInput"])
    calculation_type = payload["calculationType"]
    if calculation_type == "Band structure":
        return {
            "scf.in": normalize_qe_paths(set_pw_calculation(primary, "scf")),
            "nscfbands.in": normalize_qe_paths(set_pw_calculation(primary, "bands")),
            "bands.in": sanitize_bands_input(normalize_qe_paths(sections.get("bands.x", "&BANDS\n/\n"))),
        }
    if calculation_type == "Density of states":
        files = {
            "scf.in": normalize_qe_paths(set_pw_calculation(primary, "scf")),
            "nscfdos.in": normalize_qe_paths(set_pw_calculation(primary, "nscf")),
        }
        if "dos.x" in sections:
            files["dos.in"] = normalize_qe_paths(sections["dos.x"])
        if "projwfc.x" in sections:
            files["projwfc.in"] = normalize_qe_paths(sections["projwfc.x"])
        return files
    if calculation_type == "Phonon dispersion":
        files = {
            "scf.in": normalize_qe_paths(set_pw_calculation(primary, "scf")),
            "ph.in": normalize_qe_paths(sections.get("ph.x", "&INPUTPH\n/\n")),
        }
        if "q2r.x -> matdyn.x" in sections:
            q2r, _, matdyn = sections["q2r.x -> matdyn.x"].partition("! matdyn.x")
            files["q2r.in"] = normalize_qe_paths(q2r)
            if matdyn.strip():
                files["matdyn.in"] = normalize_qe_paths(matdyn)
        return files
    if calculation_type == "Thermoelectric properties":
        return {
            "scf.in": normalize_qe_paths(set_pw_calculation(primary, "scf")),
            "nscftransport.in": normalize_qe_paths(set_pw_calculation(primary, "nscf")),
        }
    if calculation_type == "Nudged elastic band": return {"neb.in": normalize_qe_paths(primary)}
    name = "relax.in" if calculation_type == "Structural relaxation" else "scf.in"
    return {name: normalize_qe_paths(primary)}


def _xml_child(parent: ET.Element, name: str) -> ET.Element | None:
    return next((child for child in parent if child.tag.rsplit("}", 1)[-1] == name), None)


def _xml_vector(element: ET.Element | None, label: str) -> tuple[float, float, float]:
    if element is None or not element.text:
        raise RuntimeError(f"Relaxation result has no {label} vector")
    values = [float(value.replace("D", "E").replace("d", "e")) for value in element.text.split()]
    if len(values) != 3:
        raise RuntimeError(f"Relaxation result has an invalid {label} vector")
    return values[0], values[1], values[2]


def _dot(left: tuple[float, float, float], right: tuple[float, float, float]) -> float:
    return sum(a * b for a, b in zip(left, right))


def _cross(left: tuple[float, float, float], right: tuple[float, float, float]) -> tuple[float, float, float]:
    return (
        left[1] * right[2] - left[2] * right[1],
        left[2] * right[0] - left[0] * right[2],
        left[0] * right[1] - left[1] * right[0],
    )


def read_qe_final_structure(xml_path: Path) -> dict[str, Any]:
    """Read a final relaxed QE cell and sites in downstream-safe units."""
    root = ET.parse(xml_path).getroot()
    output = next((node for node in root.iter() if node.tag.rsplit("}", 1)[-1] == "output"), None)
    structure = _xml_child(output, "atomic_structure") if output is not None else None
    if structure is None:
        raise RuntimeError("Relaxation workspace has no final atomic structure")
    cell = _xml_child(structure, "cell")
    positions = _xml_child(structure, "atomic_positions")
    if cell is None or positions is None:
        raise RuntimeError("Relaxation workspace has an incomplete final structure")

    vectors_bohr = tuple(_xml_vector(_xml_child(cell, name), name) for name in ("a1", "a2", "a3"))
    a1, a2, a3 = vectors_bohr
    volume = _dot(a1, _cross(a2, a3))
    if abs(volume) < 1e-12:
        raise RuntimeError("Relaxation workspace contains a singular unit cell")

    atoms: list[dict[str, Any]] = []
    for atom in positions:
        if atom.tag.rsplit("}", 1)[-1] != "atom":
            continue
        label = str(atom.attrib.get("name") or "").strip()
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_+-]{0,31}", label):
            raise RuntimeError("Relaxation workspace contains an invalid atomic label")
        cartesian = _xml_vector(atom, f"{label} position")
        atoms.append({
            "label": label,
            "fractional": (
                _dot(cartesian, _cross(a2, a3)) / volume,
                _dot(cartesian, _cross(a3, a1)) / volume,
                _dot(cartesian, _cross(a1, a2)) / volume,
            ),
        })

    expected_atoms = int(structure.attrib.get("nat") or len(atoms))
    if not atoms or len(atoms) != expected_atoms:
        raise RuntimeError("Relaxation workspace atom count does not match its final structure")
    return {
        "cellAngstrom": tuple(
            tuple(component * BOHR_TO_ANGSTROM for component in vector)
            for vector in vectors_bohr
        ),
        "atoms": atoms,
        "atomCount": len(atoms),
    }


_QE_CARD_HEADER = re.compile(
    r"(?im)^[ \t]*(?P<name>ATOMIC_SPECIES|ATOMIC_POSITIONS|K_POINTS|CELL_PARAMETERS|"
    r"CONSTRAINTS|OCCUPATIONS|ATOMIC_FORCES|SOLVENTS|HUBBARD)\b[^\n]*(?:\n|$)"
)


def _replace_qe_card(input_text: str, card_name: str, header: str, lines: list[str]) -> str:
    cards = list(_QE_CARD_HEADER.finditer(input_text))
    target_index = next(
        (index for index, match in enumerate(cards) if match.group("name").upper() == card_name),
        None,
    )
    if target_index is None:
        raise RuntimeError(f"Downstream pw.x input has no {card_name} card")
    start = cards[target_index].start()
    end = cards[target_index + 1].start() if target_index + 1 < len(cards) else len(input_text)
    body = "\n".join(lines)
    replacement = f"{header}\n{body}\n"
    return input_text[:start] + replacement + input_text[end:]


def apply_dependency_structure(
    input_files: dict[str, str],
    settings: dict[str, Any],
    scratch: Path | None = None,
) -> dict[str, Any] | None:
    source = settings.get("structureSource")
    if not isinstance(source, dict):
        return None
    submitted_structure = settings.get("submittedStructure")
    if isinstance(submitted_structure, dict) and submitted_structure.get("source") == "calculation-structure-cards":
        raise RuntimeError("Edited structure cards cannot be combined with a relaxed dependency structure. Select one explicit input structure source.")
    if source.get("calculationType") != "Structural relaxation":
        raise RuntimeError("Only a completed structural relaxation can provide a downstream structure")

    scratch_root = scratch or SCRATCH
    prefix = str(source.get("prefix") or "").strip()
    candidates: list[Path] = []
    if prefix:
        safe_prefix = Path(prefix).name
        if safe_prefix != prefix or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", safe_prefix):
            raise RuntimeError("Structural-relaxation source has an unsafe Quantum ESPRESSO prefix")
        exact = scratch_root / f"{safe_prefix}.save" / "data-file-schema.xml"
        if exact.is_file():
            candidates.append(exact)
    if not candidates:
        candidates = sorted(scratch_root.glob("*.save/data-file-schema.xml"))
    if len(candidates) != 1:
        raise RuntimeError("Could not identify one final structural-relaxation workspace")

    structure = read_qe_final_structure(candidates[0])
    cell_lines = [
        " ".join(f"{component:.12f}" for component in vector)
        for vector in structure["cellAngstrom"]
    ]
    atom_lines = [
        f"{atom['label']:<8} " + " ".join(f"{component:.12f}" for component in atom["fractional"])
        for atom in structure["atoms"]
    ]
    applied_files: list[str] = []
    for filename, content in tuple(input_files.items()):
        if not re.search(r"(?im)^\s*ATOMIC_POSITIONS\b", content):
            continue
        rebased = _replace_qe_card(content, "ATOMIC_POSITIONS", "ATOMIC_POSITIONS crystal", atom_lines)
        rebased = _replace_qe_card(rebased, "CELL_PARAMETERS", "CELL_PARAMETERS angstrom", cell_lines)
        input_files[filename] = rebased
        applied_files.append(filename)
    if not applied_files:
        raise RuntimeError("No downstream pw.x input accepted the relaxed structure")

    return {
        "calculationId": source.get("calculationId"),
        "calculationType": source.get("calculationType"),
        "prefix": candidates[0].parent.name.removesuffix(".save"),
        "atomCount": structure["atomCount"],
        "cellAngstrom": structure["cellAngstrom"],
        "atoms": structure["atoms"],
        "sourceScope": "final relaxed dependency structure, before downstream execution",
        "inputFiles": applied_files,
        "coordinateMode": "crystal",
        "cellUnit": "angstrom",
    }


def _run_process(name: str, command: list[str], input_name: str | None = None) -> dict[str, Any]:
    output_path = LOGS / f"{name}.out"
    started = time.monotonic()
    step = {"name": name, "executable": command[0], "command": list(command),
            "inputFile": input_name, "status": "failed", "log": f"logs/{output_path.name}"}
    try:
        with output_path.open("w", encoding="utf-8") as output, measured_compute(WORK):
            completed = subprocess.run(
                command,
                cwd=WORK,
                stdout=output,
                stderr=subprocess.STDOUT,
                check=False,
                env={
                    **os.environ,
                    "OMP_NUM_THREADS": "1",
                    "OPENBLAS_NUM_THREADS": "1",
                    "MPLCONFIGDIR": os.environ.get("MPLCONFIGDIR", "/tmp/matplotlib-phynite"),
                },
            )
    except OSError as exc:
        step["elapsedSeconds"] = round(time.monotonic() - started, 3)
        raise QeConvergenceError(str(exc), step) from exc
    elapsed = round(time.monotonic() - started, 3)
    step.update({"elapsedSeconds": elapsed, "exitCode": completed.returncode})
    if completed.returncode != 0:
        output_text = output_path.read_text(encoding="utf-8", errors="replace")
        tail = "\n".join(output_text.splitlines()[-20:])
        killed_for_memory = completed.returncode in {-9, 137} or bool(
            re.search(r"(?:signal\s+9\s*\(Killed\)|Killed\s*$)", output_text, re.IGNORECASE | re.MULTILINE)
        )
        if killed_for_memory:
            raise QeConvergenceError(
                insufficient_memory_message(
                    name,
                    parse_qe_memory_estimate_mib(output_text),
                    _configured_memory_limit_mib(),
                ), step,
            )
        raise QeConvergenceError(f"{' '.join(command[:2])} exited with code {completed.returncode}\n{tail}", step)
    return {**step, "status": "completed"}


def qe_kpoint_pools(vcpus: int, preflight_output: str) -> int:
    """Conservative pools for dense meshes, using QE's symmetry-reduced count.

    Never infer metallicity, alter a mesh, or pool a gamma-only calculation.
    Leave small workloads on the existing plane-wave decomposition; require
    at least 16 k-points per pool to amortize startup and extra initialization.
    """
    match = re.search(r"number of k points\s*=\s*(\d+)", preflight_output, re.I)
    if not match:
        return 1
    count = int(match.group(1))
    return next((p for p in range(min(4, vcpus), 1, -1)
                 if vcpus % p == 0 and count >= max(64, 16 * p)), 1)


def qe_mpi_command(executable: str, input_path: Path, ranks: int, pools: int = 1) -> list[str]:
    if isinstance(ranks, bool) or not isinstance(ranks, int) or not 1 <= ranks <= 9007199254740991:
        raise ValueError("QE MPI ranks must be a positive safe integer")
    launcher = os.environ.get("PHYNITE_MPI_LAUNCHER")
    scheduler = os.environ.get("PHYNITE_HPC_SCHEDULER")
    if scheduler and scheduler not in {"slurm", "pbs"}:
        raise ValueError("PHYNITE_HPC_SCHEDULER must be slurm or pbs")
    if scheduler and not launcher:
        raise ValueError("Scheduler execution requires an explicit allocation-aware PHYNITE_MPI_LAUNCHER")
    if launcher:
        try:
            arguments = json.loads(launcher)
        except (ValueError, TypeError) as exc:
            raise ValueError("PHYNITE_MPI_LAUNCHER must be a JSON array of command arguments") from exc
        if not isinstance(arguments, list) or not arguments or len(arguments) > 64 or any(not isinstance(arg, str) or not arg or len(arg) > 4096 or any(ord(character) < 32 for character in arg) for arg in arguments):
            raise ValueError("PHYNITE_MPI_LAUNCHER requires nonempty command arguments without control characters")
        if sum(arg.count("{ranks}") for arg in arguments) != 1 or any("{" in arg.replace("{ranks}", "") or "}" in arg.replace("{ranks}", "") for arg in arguments):
            raise ValueError("PHYNITE_MPI_LAUNCHER requires exactly one {ranks} placeholder")
        if Path(arguments[0]).name not in {"srun", "mpiexec", "mpirun"} or any(arg.startswith("--oversubscribe") for arg in arguments):
            raise ValueError("HPC launcher must be srun, mpiexec or mpirun without oversubscription")
        if any("{ranks}" in arg and arg not in {"{ranks}", "--ntasks={ranks}"} for arg in arguments):
            raise ValueError("MPI rank placeholder must be a separate argument or --ntasks={ranks}")
        maximum = os.environ.get("PHYNITE_HPC_MAX_RANKS", "")
        if not re.fullmatch(r"[1-9][0-9]*", maximum) or int(maximum) > 9007199254740991 or ranks > int(maximum):
            raise ValueError("QE MPI ranks exceed or lack the validated PHYNITE_HPC_MAX_RANKS allocation")
        command = [arg.replace("{ranks}", str(ranks)) for arg in arguments] + [executable]
    else:
        command = ["mpirun", "--oversubscribe", "-np", str(ranks), executable]
    if executable == "pw.x" and pools > 1:
        command.extend(["-nk", str(pools)])
    return [*command, "-inp" if executable == "neb.x" else "-in", str(input_path)]


class QeConvergenceError(RuntimeError):
    def __init__(self, message: str, step: dict[str, Any]):
        super().__init__(message)
        self.step = step
        self.previous_steps: list[dict[str, Any]] = []


def run_qe_step(name: str, executable: str, input_name: str, input_text: str, vcpus: int) -> dict[str, Any]:
    input_text = normalize_pw_continuation_input(input_text)
    input_path = WORK / input_name
    validate_relaxation_input({input_name: input_text})
    input_path.write_text(input_text, encoding="utf-8")
    memory_limit_mib = _configured_memory_limit_mib()
    parallel_mode = os.environ.get("PHYNITE_QE_PARALLEL_MODE", "auto")
    if parallel_mode not in {"auto", "legacy"}:
        raise RuntimeError("PHYNITE_QE_PARALLEL_MODE must be auto or legacy")
    # These small postprocessors do not benefit from the full MPI allocation.
    # In particular, bands.x symmetry analysis can fail in multi-rank runs.
    ranks = 1 if parallel_mode == "auto" and executable in {"bands.x", "dos.x", "q2r.x", "matdyn.x"} else max(1, vcpus)
    pools = 1
    estimated_mib = None
    preflight_seconds = 0.0
    parallel_reason = "Single pool; no validated dense-mesh estimate"
    if executable == "pw.x" and memory_limit_mib is not None:
        preflight_name = f"preflight-{name}"
        preflight_input_name = f"preflight-{input_name}"
        preflight_input_path = WORK / preflight_input_name
        preflight_input_path.write_text(
            qe_resource_preflight_input(input_text, name),
            encoding="utf-8",
        )
        try:
            preflight_command = qe_mpi_command(executable, preflight_input_path, ranks)
            preflight = _run_process(preflight_name, preflight_command, preflight_input_name)
            preflight_seconds += preflight["elapsedSeconds"]
            preflight_output = (LOGS / f"{preflight_name}.out").read_text(
                encoding="utf-8", errors="replace"
            )
            estimated_mib = parse_qe_memory_estimate_mib(preflight_output)
            if estimated_mib is not None and estimated_mib > memory_limit_mib:
                raise QeConvergenceError(insufficient_memory_message(name, estimated_mib, memory_limit_mib),
                                         {**preflight, "status": "failed", "resourceValidation": "insufficient-memory", "memoryEstimateMiB": estimated_mib})
            candidate_pools = qe_kpoint_pools(ranks, preflight_output) if parallel_mode == "auto" else 1
            # Pooling replicates some arrays. Check the actual proposed layout,
            # not the (potentially much smaller) single-pool memory estimate.
            if candidate_pools > 1 and estimated_mib is not None and not re.search(r"(?im)^\s*K_POINTS\s+(?:crystal_b|tpiba_b)\b", input_text):
                candidate_name = f"{preflight_name}-pooled"
                candidate = _run_process(
                    candidate_name,
                    qe_mpi_command(executable, preflight_input_path, ranks, candidate_pools),
                    preflight_input_name,
                )
                preflight_seconds += candidate["elapsedSeconds"]
                candidate_mib = parse_qe_memory_estimate_mib(
                    (LOGS / f"{candidate_name}.out").read_text(encoding="utf-8", errors="replace")
                )
                if candidate_mib is not None and candidate_mib <= memory_limit_mib * 0.8:
                    pools, estimated_mib = candidate_pools, candidate_mib
                    parallel_reason = "Dense k-mesh; pooled memory estimate fits with 20% headroom"
                else:
                    parallel_reason = "Single pool retained: pooled memory estimate unavailable or too large"
        except QeConvergenceError as preflight_exc:
            if preflight_exc.step.get("resourceValidation") == "insufficient-memory":
                raise
            parallel_reason = f"Single pool retained: resource preflight check encountered {preflight_exc}"
    command = qe_mpi_command(executable, input_path, ranks, pools)
    mode = pw_calculation_mode(input_text) if executable == "pw.x" else "phonon" if executable == "ph.x" else None
    try:
        result = _run_process(name, command, input_name)
    except Exception as exc:
        failure_step = dict(exc.step) if isinstance(exc, QeConvergenceError) else {"name": name, "inputFile": input_name, "status": "failed", "log": f"logs/{name}.out"}
        failure_step.update({"executable": executable, "command": command, "mpiRanks": ranks, "kPointPools": pools,
                             "memoryEstimateMiB": estimated_mib, "preflightElapsedSeconds": round(preflight_seconds, 3)})
        try:
            xml = retain_qe_stage_xml(WORK, LOGS.parent, name, input_text) if executable == "pw.x" else None
            failure_step["convergence"] = parse_qe_output((LOGS / f"{name}.out").read_text(encoding="utf-8", errors="replace"), mode, input_text=input_text, xml_path=xml)
        except (OSError, ValueError):
            pass
        raise QeConvergenceError(str(exc), failure_step) from exc
    result.update({
        "executable": executable,
        "command": command,
        "mpiRanks": ranks,
        "kPointPools": pools,
        "memoryEstimateMiB": estimated_mib,
        "preflightElapsedSeconds": round(preflight_seconds, 3),
        "parallelizationReason": parallel_reason if executable == "pw.x" else "Postprocessor allocation",
    })
    xml = retain_qe_stage_xml(WORK, LOGS.parent, name, input_text) if executable == "pw.x" else None
    evidence = parse_qe_output((LOGS / f"{name}.out").read_text(encoding="utf-8", errors="replace"), mode, input_text=input_text, xml_path=xml)
    result["convergence"] = evidence
    failure = qe_stage_error({"stage": name, "calculationMode": mode, **evidence})
    if failure:
        result["status"] = "failed"
        raise QeConvergenceError(
            f"{name}: {'structural relaxation' if mode in {'relax', 'vc-relax'} else 'solver stage'} is not accepted: {failure}. Inspect logs/{name}.out, adjust convergence settings, and rerun before using this result.", result)
    return result


def require_reused_qe_stage(name: str, mode: str) -> None:
    log = LOGS / f"{name}.out"
    if not log.is_file():
        raise RuntimeError(f"Cannot reuse {name}: retained solver log is missing. Rerun this stage before continuing.")
    input_name = "scf.in" if name == "scf" else "nscftransport.in"
    retained_input = LOGS.parent / "inputs" / input_name
    if not retained_input.is_file():
        raise RuntimeError(f"Cannot reuse {name}: retained executed input is missing. Rerun this stage before continuing.")
    xml = LOGS.parent / "evidence" / f"{name}.xml"
    if not xml.is_file():
        raise RuntimeError(f"Cannot reuse {name}: its stage XML snapshot is missing. A later NSCF XML cannot prove prior SCF convergence. Rerun this stage before continuing.")
    evidence = parse_qe_output(log.read_text(encoding="utf-8", errors="replace"), mode,
                               input_text=retained_input.read_text(encoding="utf-8"), xml_path=xml)
    failure = qe_stage_error({"stage": name, "calculationMode": mode, **evidence})
    if failure:
        raise RuntimeError(f"Cannot reuse {name}: {failure}. Rerun this stage before continuing.")


def _prefix_from_input(input_text: str) -> str:
    match = re.search(r"\bprefix\s*=\s*['\"]([^'\"]+)['\"]", input_text, re.IGNORECASE)
    return Path(match.group(1)).name if match else "phynite"


def _setting_number(settings: dict[str, Any], names: Iterable[str], default: float) -> float:
    for name in names:
        value = settings.get(name)
        if value is not None:
            try:
                return float(value)
            except (TypeError, ValueError):
                pass
    return default


def transport_interpolation_window_ha(
    settings: dict[str, Any],
    chemical_min_ev: float,
    chemical_max_ev: float,
    temperature_max: float,
) -> tuple[float, float]:
    """Return the band-interpolation window, independently of the plotted mu range.

    BoltzTraP2's ``interpolate -e/-E`` options select *DFT bands* around the
    Fermi level. They are not the chemical-potential range shown in the final
    transport plot. Reusing a narrow mu range here can remove every band of a
    semiconductor whose Fermi level lies in the gap, leaving an empty
    least-squares problem inside BoltzTraP2.

    Keep at least BoltzTraP2's native +/-0.2 Ha window and extend it when the
    requested chemical-potential range plus a thermal margin needs more data.
    Expert overrides may widen the window, but cannot accidentally make it
    narrower than the scientifically required range.
    """
    numbers = transport_numbers(settings)
    thermal_margin_ev = max(1.0, 12.0 * BOLTZMANN_EV_PER_K * max(1.0, temperature_max))
    requested_min_ev = numbers["transportInterpolationEnergyMin"]
    requested_max_ev = numbers["transportInterpolationEnergyMax"]
    interpolation_min_ev = min(requested_min_ev, chemical_min_ev - thermal_margin_ev)
    interpolation_max_ev = max(requested_max_ev, chemical_max_ev + thermal_margin_ev)
    if interpolation_min_ev >= interpolation_max_ev:
        raise RuntimeError("The transport band-interpolation window is invalid")
    return interpolation_min_ev / HARTREE_TO_EV, interpolation_max_ev / HARTREE_TO_EV


def run_transport(input_files: dict[str, str], settings: dict[str, Any], vcpus: int) -> list[dict[str, Any]]:
    validate_transport_settings(settings)
    numbers = transport_numbers(settings)
    qe_save = qe_stage_xml_path(WORK, input_files["nscftransport.in"]).parent
    steps: list[dict[str, Any]] = []
    def recorded_qe_step(name: str, filename: str) -> dict[str, Any]:
        try:
            return run_qe_step(name, "pw.x", filename, input_files[filename], vcpus)
        except QeConvergenceError as exc:
            exc.previous_steps = list(steps)
            raise
    def recorded_process(name: str, command: list[str]) -> dict[str, Any]:
        try:
            return _run_process(name, command)
        except QeConvergenceError as exc:
            exc.previous_steps = list(steps)
            raise
    if settings.get("_inheritedScfStage"):
        pass  # Source state was verified and copied before this execution.
    elif (settings.get("_resumeScf") or settings.get("_verifiedScfReuse")) and (qe_save / "charge-density.dat").is_file():
        require_reused_qe_stage("scf", "scf")
        steps.append(
            {
                "name": "scf",
                "executable": "pw.x",
                "inputFile": "scf.in",
                "elapsedSeconds": 0.0,
                "status": "reused",
                "log": "logs/scf.out",
            }
        )
    else:
        steps.append(recorded_qe_step("scf", "scf.in"))
    if settings.get("_resumeNscf") and (qe_save / "data-file-schema.xml").is_file():
        require_reused_qe_stage("nscf-transport", "nscf")
        steps.append(
            {
                "name": "nscf-transport",
                "executable": "pw.x",
                "inputFile": "nscftransport.in",
                "elapsedSeconds": 0.0,
                "status": "reused",
                "log": "logs/nscf-transport.out",
            }
        )
    else:
        steps.append(recorded_qe_step("nscf-transport", "nscftransport.in"))
    if not (qe_save / "data-file-schema.xml").is_file():
        raise RuntimeError("Dense NSCF did not produce the Quantum ESPRESSO XML required by BoltzTraP2")

    multiplier = int(numbers["transportInterpolationMultiplier"])
    temperature_min = int(numbers["transportTemperatureMin"])
    temperature_max = int(numbers["transportTemperatureMax"])
    temperature_step = int(numbers["transportTemperatureStep"])
    bins = int(numbers["transportEnergyBins"])
    chemical_min_ev = numbers["transportChemicalPotentialMin"]
    chemical_max_ev = numbers["transportChemicalPotentialMax"]
    interpolation_min_ha, interpolation_max_ha = transport_interpolation_window_ha(
        settings,
        chemical_min_ev,
        chemical_max_ev,
        temperature_max,
    )
    transport_bt2 = DATA / "transport.bt2"
    adapter = Path(__file__).with_name("btp2_soc.py")
    steps.append(
        recorded_process(
            "boltztrap2-interpolate",
            [
                sys.executable,
                str(adapter),
                "interpolate",
                "-m",
                str(multiplier),
                "-e",
                f"{interpolation_min_ha:.12g}",
                "-E",
                f"{interpolation_max_ha:.12g}",
                "-o",
                str(transport_bt2),
                str(qe_save),
            ],
        )
    )
    scattering_flag = "-t"
    steps.append(
        recorded_process(
            "boltztrap2-integrate",
            [
                sys.executable,
                str(adapter),
                "integrate",
                str(transport_bt2),
                f"{temperature_min}:{temperature_max + 1}:{temperature_step}",
                "-b",
                str(bins),
                scattering_flag,
            ],
        )
    )
    return steps


def execute_qe_stages(stages: list[tuple[str, str, str]], input_files: dict[str, str], vcpus: int) -> list[dict[str, Any]]:
    steps: list[dict[str, Any]] = []
    for name, executable, filename in stages:
        try:
            steps.append(run_qe_step(name, executable, filename, input_files[filename], vcpus))
        except QeConvergenceError as exc:
            exc.previous_steps = steps
            raise
    return steps


def execute_workflow(calculation_type: str, input_files: dict[str, str], settings: dict[str, Any], vcpus: int) -> list[dict[str, Any]]:
    validate_band_postprocessor_input(input_files, calculation_type)
    inherited = settings.get("_inheritedScfStage")
    def stages_with_source(plan: list[tuple[str, str, str]]) -> list[dict[str, Any]]:
        if inherited:
            return execute_qe_stages([step for step in plan if step[0] != "scf"], input_files, vcpus)
        if settings.get("_verifiedScfReuse"):
            require_reused_qe_stage("scf", "scf")
            return [{"name": "scf", "status": "reused", "elapsedSeconds": 0.0, "sourceCalculationId": settings["_verifiedScfReuse"]["calculationId"], "log": "logs/scf.out"}, *execute_qe_stages([step for step in plan if step[0] != "scf"], input_files, vcpus)]
        return execute_qe_stages(plan, input_files, vcpus)
    if calculation_type == "Nudged elastic band":
        from neb_inputs import validate_neb_input
        from neb import neb_results
        text = input_files.get("neb.in", "")
        validate_neb_input(text)
        if not shutil.which("neb.x"):
            raise RuntimeError("NEB requires neb.x from the same Quantum ESPRESSO build. Rebuild the local runtime with NEB support and add its install/bin directory to PATH.")
        path = WORK / "neb.in"; path.write_text(text, encoding="utf-8")
        result = _run_process("neb", qe_mpi_command("neb.x", path, max(1,vcpus), 1), "neb.in")
        summary, _ = neb_results(WORK, OUTPUT, text)
        result["convergence"] = summary
        return [result]
    if calculation_type == "Band structure":
        return stages_with_source([
            ("scf", "pw.x", "scf.in"),
            ("bands-nscf", "pw.x", "nscfbands.in"),
            ("bands-postprocess", "bands.x", "bands.in"),
            *([("projected-bands", "projwfc.x", "projwfc.in")] if "projwfc.in" in input_files else []),
        ])
    if calculation_type == "Density of states":
        stages = [("scf", "pw.x", "scf.in"), ("dos-nscf", "pw.x", "nscfdos.in")]
        if "dos.in" in input_files:
            stages.append(("dos-postprocess", "dos.x", "dos.in"))
        if "projwfc.in" in input_files:
            stages.append(("projected-dos", "projwfc.x", "projwfc.in"))
        return stages_with_source(stages)
    if calculation_type == "Phonon dispersion":
        clean = "\n".join(line.split("!", 1)[0] for line in input_files.get("scf.in", "").splitlines())
        if re.search(r"\binput_dft\s*=\s*['\"](?:HSE[^'\"]*|PBE0|B3LYP|EXX|HF)['\"]", clean, re.I):
            raise RuntimeError("Hybrid-functional DFPT phonons are unsupported by the QE ph.x workflow. Use a supported semilocal functional or a separate finite-displacement workflow.")
        if re.search(r"\bvdw_corr\s*=\s*['\"](?:TS|TS-VdW|Tkatchenko-Scheffler)['\"]", clean, re.I):
            raise RuntimeError("TS-vdW DFPT phonons are unsupported by the QE ph.x workflow")
        required = ("scf.in", "ph.in", "q2r.in", "matdyn.in")
        missing = [name for name in required if name not in input_files]
        if missing:
            raise RuntimeError(f"Phonon workflow is missing: {', '.join(missing)}")
        return stages_with_source([
            ("scf", "pw.x", "scf.in"), ("phonon", "ph.x", "ph.in"),
            ("force-constants", "q2r.x", "q2r.in"), ("phonon-dispersion", "matdyn.x", "matdyn.in"),
        ])
    if calculation_type == "Thermoelectric properties":
        return run_transport(input_files, settings, vcpus)
    if calculation_type == "Structural relaxation":
        input_name = next((name for name in ("vcrelax.in", "relax.in") if name in input_files), None)
        if input_name is None:
            raise RuntimeError("Structural relaxation workflow is missing: vcrelax.in or relax.in")
        return stages_with_source([("relax", "pw.x", input_name)])
    if "scf.in" not in input_files:
        raise RuntimeError("Total-energy workflow is missing: scf.in")
    return stages_with_source([("scf", "pw.x", "scf.in")])


def prepare_automatic_k_path(calculation_type: str, input_files: dict[str, str], settings: dict[str, Any]) -> dict[str, Any] | None:
    if calculation_type not in {"Band structure", "Phonon dispersion"}:
        return None
    automatic = settings.get("autoKPath")
    if automatic is None:
        automatic = not bool(str(settings.get("rawInput") or "").strip())
    requested_path = str(settings.get("requestedKPath") or "").strip()
    if automatic is False and not requested_path:
        manual = settings.get("manualReciprocalPath")
        return {"mode": "manual", **manual} if isinstance(manual, dict) else {"mode": "manual"}
    scf_input = input_files.get("scf.in")
    if not scf_input:
        raise RuntimeError("Automatic reciprocal-space path requires scf.in")
    try:
        path_result = seek_path_for_qe(scf_input)
    except ImportError as exc:
        raise RuntimeError(
            "Automatic reciprocal-space paths require working seekpath and spglib packages in the selected Python runtime. "
            "Load a compatible scientific Python module or configure Python Executable, then probe the HPC profile again. "
            "The unverified input path was not used."
        ) from exc
    mode = "seekpath-original-cell"
    if requested_path:
        segments, requested_labels = requested_path_segments(path_result, requested_path)
        path_result = {**path_result, "path": segments}
        mode = "requested-high-symmetry"
    points_per_segment = int(max(5, min(200, _setting_number(settings, ("kPathPoints",), 24))))
    path_lines, labels, tick_indices = qe_path_lines(path_result, points_per_segment)
    if calculation_type == "Band structure":
        input_files["nscfbands.in"] = replace_pw_k_path(input_files["nscfbands.in"], path_lines)
    else:
        input_files["matdyn.in"] = replace_matdyn_q_path(input_files["matdyn.in"], path_lines)
    return {
        "mode": mode,
        **({"requestedPath": requested_path, "requestedLabels": requested_labels} if requested_path else {}),
        "labels": labels,
        "pointCoords": path_result["pointCoords"],
        "segments": path_result["path"],
        "cellAngstrom": path_result.get("cellAngstrom"),
        "coordinateSystem": path_result.get("coordinateSystem"),
        "tickIndices": tick_indices,
        "breakIndices": qe_path_break_indices(path_result, tick_indices),
        "spaceGroupNumber": path_result["spaceGroupNumber"],
        "spaceGroupInternational": path_result["spaceGroupInternational"],
        "bravaisLattice": path_result["bravaisLattice"],
        "isSupercell": path_result["isSupercell"],
        "pointsPerSegment": points_per_segment,
    }


def copy_raw_outputs() -> list[dict[str, str]]:
    DATA.mkdir(parents=True, exist_ok=True)
    artifacts: list[dict[str, str]] = []
    patterns = ("*.bands.dat", "*.dos.dat", "*.pdos*", "*.freq", "*.freq.gp", "*.trace", "*.condtens", "*.halltens", "*.bt2", "*.btj")
    copied: set[str] = set()
    for pattern in patterns:
        for source in WORK.rglob(pattern):
            if not source.is_file() or SCRATCH in source.parents:
                continue
            filename = source.name
            if filename in copied:
                continue
            destination = DATA / filename
            if source != destination:
                shutil.copy2(source, destination)
            copied.add(filename)
            artifacts.append({
                "path": f"data/{filename}",
                "label": filename,
                "role": "raw-data",
                "contentType": "application/octet-stream" if destination.suffix in {".bt2", ".btj"} else "text/plain",
            })
    return artifacts


def persist_executed_inputs(input_files: dict[str, str]) -> list[dict[str, str]]:
    input_directory = OUTPUT / "inputs"
    input_directory.mkdir(parents=True, exist_ok=True)
    artifacts: list[dict[str, str]] = []
    for filename, content in input_files.items():
        safe_name = _safe_input_filename(filename)
        destination = input_directory / safe_name
        destination.write_text(content, encoding="utf-8")
        artifacts.append(
            {
                "path": f"inputs/{safe_name}",
                "label": safe_name,
                "role": "input",
                "contentType": "text/plain",
            }
        )
    return artifacts


def executed_structure_evidence(input_files: dict[str, str]) -> list[dict[str, Any]]:
    evidence = []
    for filename, content in input_files.items():
        if not re.search(r"&SYSTEM\b", content, re.I):
            continue
        record: dict[str, Any] = {"inputFile": f"inputs/{filename}", "inputSha256": hashlib.sha256(content.encode("utf-8")).hexdigest(), "scope": "initial structure in the exact executed stage input"}
        try:
            cell, fractional, numbers = parse_qe_structure(content)
            positions = re.search(r"(?im)^\s*ATOMIC_POSITIONS[^\n]*\n", content)
            rows = content[positions.end():].splitlines() if positions else []
            labels = [line.split()[0] for line in rows if len(line.split()) >= 4 and re.match(r"^[A-Z][a-z]?[A-Za-z0-9_]*\s", line.strip())][:len(numbers)]
            species = re.search(r"(?im)^\s*ATOMIC_SPECIES[^\n]*\n", content)
            masses = {}
            if species:
                for line in content[species.end():].splitlines():
                    fields = line.split()
                    if not fields:
                        continue
                    if len(fields) != 3:
                        break
                    try:
                        masses[fields[0]] = float(fields[1])
                    except ValueError:
                        break
            record.update({"status": "resolved-explicit-cards", "cellAngstrom": cell, "fractionalPositions": fractional, "atomicNumbers": numbers, "atomicLabels": labels, "speciesMassesAmu": masses, "simulationCellPeriodicity": [True, True, True], "boundaryConditionScope": "QE plane-wave cell; electrostatic isolation corrections remain in the exact input"})
        except (ValueError, np.linalg.LinAlgError) as exc:
            record.update({"status": "retained-input-only", "reason": str(exc)})
        evidence.append(record)
    return evidence


def create_reusable_workspace_archive(scratch: Path, destination: Path) -> bool:
    """Archive the reusable QE state without per-rank wavefunction files.

    NSCF follow-up calculations need the saved charge density and XML metadata,
    but do not need hundreds of megabytes of distributed ``wfc*.dat`` files.
    Excluding those files keeps local development and S3 artifacts bounded.
    """
    if not scratch.exists():
        return False

    def reusable_member(member: tarfile.TarInfo) -> tarfile.TarInfo | None:
        name = Path(member.name).name.lower()
        if re.fullmatch(r"wfc(?:up|dw)?\d+\.dat", name) or re.search(r"\.wfc\d+$", name):
            return None
        return member

    destination.parent.mkdir(parents=True, exist_ok=True)
    try:
        with tarfile.open(destination, "w:gz") as archive:
            archive.add(scratch, arcname="tmp", filter=reusable_member)
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    return True


def failed_scientific_results(calculation_type: str) -> dict[str, Any]:
    errors = []
    try:
        scientific = build_scientific_results(calculation_type, WORK, OUTPUT, render_results=False)
    except Exception as exc:
        errors.append(f"Solver summary unavailable ({type(exc).__name__})")
        scientific = {"summary": {"converged": False, "jobDone": False}, "artifacts": [], "provenance": {"calculationType": calculation_type, "syntheticData": False, "source": "retained solver inputs and logs"}}
    # Enumerate input/log files even when a partial solver log is unparseable.
    diagnostics = {}
    for directory, role in (("inputs", "input"), ("logs", "log")):
        try:
            for path in sorted((OUTPUT / directory).glob("*")):
                if path.is_file():
                    relative = path.relative_to(OUTPUT).as_posix()
                    diagnostics[relative] = {"path": relative, "label": path.name, "role": role, "contentType": "text/plain"}
        except OSError as exc:
            errors.append(f"{directory} diagnostics unavailable ({type(exc).__name__})")
    for artifact in scientific["artifacts"]:
        diagnostics[artifact["path"]] = artifact
    try:
        for artifact in copy_raw_outputs():
            diagnostics[artifact["path"]] = artifact
    except Exception as exc:
        errors.append(f"Raw outputs unavailable ({type(exc).__name__})")
    scientific["artifacts"] = list(diagnostics.values())
    if errors:
        scientific["summary"]["diagnosticsStatus"] = "incomplete"
        scientific["summary"]["diagnosticsErrors"] = errors
    return scientific


def attach_reusable_workspace(scientific: dict[str, Any], scratch: Path, output: Path) -> None:
    workspace_archive = output / "workspace.tar.gz"
    try:
        created = create_reusable_workspace_archive(scratch, workspace_archive)
    except (OSError, tarfile.TarError) as exc:
        scientific["provenance"]["workspaceArchive"] = {
            "status": "omitted",
            "reason": type(exc).__name__,
        }
        return
    if not created:
        return
    scientific["artifacts"].append(
        {
            "path": "workspace.tar.gz",
            "label": "Reusable Quantum ESPRESSO workspace",
            "role": "workspace",
            "contentType": "application/gzip",
        }
    )
    scientific["provenance"]["workspaceArchive"] = {
        "status": "included",
        "wavefunctionsIncluded": False,
        "purpose": "charge-density reuse for follow-up calculations",
    }

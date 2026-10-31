"""Owned local account preferences and measured disk/compute usage."""
from __future__ import annotations

import base64

import hashlib

import hmac

import json

import math

import re

import secrets

import time

from datetime import datetime, timezone

from decimal import Decimal

from typing import Any

from backend.local_api.domain.phynite_core import ApiError, FINAL_JOB_STATES, owner_partition, public_item, require_project, response, storage_owner, utc_now

from backend.local_api.domain.compute_preferences import personal_limits, validate_personal_defaults

from backend.local_api.domain.storage_quota import storage_limit

def nonnegative_amount(value: Any) -> float:
    """Return a bounded account credit amount without exposing invalid ledger data."""
    try:
        amount = float(value or 0)
    except (TypeError, ValueError, OverflowError):
        return 0
    return round(amount, 6) if math.isfinite(amount) and amount >= 0 else 0

def validate_avatar(value: Any) -> str:
    if value == "":
        return ""
    if not isinstance(value, str) or len(value) > 100_000:
        raise ApiError(400, "Use a profile photo smaller than 75 KB after resizing.", "INVALID_AVATAR")
    match = re.fullmatch(r"data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)", value)
    try:
        raw = base64.b64decode(match.group(2), validate=True) if match else b""
    except ValueError:
        raw = b""
    valid = bool(match) and (
        (match[1] == "png" and raw.startswith(b"\x89PNG\r\n\x1a\n"))
        or (match[1] == "jpeg" and raw.startswith(b"\xff\xd8\xff"))
        or (match[1] == "webp" and raw.startswith(b"RIFF") and raw[8:12] == b"WEBP")
    )
    if not valid:
        raise ApiError(400, "Choose a PNG, JPEG, or WebP photo.", "INVALID_AVATAR")
    return value

def epoch(value: Any) -> float | None:
    try:
        date = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return date.replace(tzinfo=timezone.utc).timestamp() if date.tzinfo is None else date.timestamp()
    except (ValueError, TypeError, OverflowError):
        return None

def public_worker_telemetry(value: Any) -> dict[str, Any] | None:
    """Expose only reported measurements, without paths, credentials or inferred capacity."""
    if not isinstance(value, dict) or value.get("runtime") not in {"docker", "native"}:
        return None
    result: dict[str, Any] = {"runtime": value["runtime"]}
    for key in ("availableMemoryBytes", "diskFreeBytes", "diskTotalBytes", "cpuPercent"):
        raw = value.get(key)
        valid = isinstance(raw, (int, float, Decimal)) and not isinstance(raw, bool) and math.isfinite(raw) and raw >= 0
        maximum = 100 if key == "cpuPercent" else 10**16
        valid = valid and raw <= maximum and (key == "cpuPercent" or raw == int(raw))
        result[key] = (float(raw) if key == "cpuPercent" else int(raw)) if valid else None
    return result

class AccountApi:
    def __init__(self, services: Any):
        self.services = services

    def save(self, owner: str, kind: str, values: dict[str, Any]) -> dict[str, Any]:
        values = {**values, "updatedAt": utc_now()}
        if self.services.get_item(owner, kind, "primary"):
            return self.services.update_item(owner, kind, "primary", values)
        item = {"PK": owner_partition(owner), "SK": f"{kind}#primary", "entityType": kind,
                "id": "primary", "ownerId": owner, "createdAt": utc_now(), **values}
        try:
            self.services.put_item(item, "attribute_not_exists(PK)")
        except Exception:
            if not self.services.get_item(owner, kind, "primary"):
                raise
            return self.services.update_item(owner, kind, "primary", values)
        return item

    def record_presence(
        self, owner: str, worker_id: str, capabilities: list[str] | None = None
    ) -> None:
        # Update only presence fields so a concurrent revocation cannot restore the credential.
        updates: dict[str, Any] = {
            "workerId": worker_id, "lastSeenAt": utc_now(), "lastSeenAtEpoch": int(time.time()),
        }
        if capabilities is not None:
            updates["capabilities"] = capabilities
        self.services.update_item(owner, "PERSONAL_WORKER", "primary", updates)

    def usage(self, owner: str, scope: str | None = None, project_id: str | None = None) -> dict[str, Any]:
        if scope is not None and scope != "compute":
            raise ApiError(400, "Usage scope must be compute or omitted for the full inventory.", "INVALID_USAGE_SCOPE")
        if scope == "compute":
            return self.compute_usage(owner, project_id)
        owner_prefix = f"users/{storage_owner(owner)}/"
        project = self.services.get_item(owner, "PROJECT", project_id) if project_id else None
        project_ids = {project_id, project.get("legacyId")} - {None, ""} if project else {project_id}
        research_items = [(collection, item) for collection, kind in (("datasets", "DATASET"), ("figures", "FIGURE"), ("templates", "FIGURE_TEMPLATE"))
                          for item in self.services.list_owner_items(owner, kind)]
        prefixes = [owner_prefix] if project_id is None else [f"{owner_prefix}projects/{identity}/" for identity in project_ids]
        attribution_complete = True
        exact_keys: set[str] = set()
        if project_id is not None:
            # Research documents live outside /projects; their owned metadata is
            # the source of their project association, including retained revisions.
            for collection, item in research_items:
                if not item.get("projectId"):
                    attribution_complete = False
                elif item.get("projectId") in project_ids:
                    prefixes.append(f"{owner_prefix}research/{collection}/{item['id']}/")
            for kind in ("STRUCTURE", "CALCULATION", "MD_TRAJECTORY", "MD_SIMULATION", "MD_ANALYSIS", "MD_POTENTIAL"):
                for item in self.services.list_owner_items(owner, kind):
                    keys = [item.get("objectKey"), item.get("inputKey"), item.get("outputPrefix")]
                    keys += [file.get("objectKey") for file in item.get("files", []) if isinstance(file, dict)]
                    for key in filter(None, keys):
                        if item.get("projectId") in project_ids and isinstance(key, str) and key.startswith(owner_prefix):
                            if key == item.get("outputPrefix"):
                                prefixes.append(key.rstrip("/") + "/")
                            else:
                                exact_keys.add(key)
                        elif item.get("projectId") in project_ids or not item.get("projectId"):
                            attribution_complete = False
            # Chat sources, extracted text and vision derivatives share the
            # attachment directory; each attachment keeps its original project.
            project_keys = {f"{kind}:{identity}" for kind in ("project", "md", "dft") for identity in project_ids}
            for item in self.services.list_owner_items(owner, "AI_ATTACHMENT"):
                if item.get("projectKey") in project_keys:
                    if item.get("conversationId") and item.get("id"):
                        prefixes.append(f"{owner_prefix}ai/{item['conversationId']}/attachments/{item['id']}/")
                    else:
                        attribution_complete = False
        directory_prefixes = tuple(prefixes)
        def in_scope(key: str) -> bool:
            return key in exact_keys or key.startswith(directory_prefixes)
        # Keep scans bounded and avoid reading nested prefixes twice.
        prefixes = sorted(set(prefixes) | exact_keys, key=len)
        prefixes = [prefix for index, prefix in enumerate(prefixes) if not any(prefix.startswith(parent) for parent in prefixes[:index])]
        categories = {"calculations": 0, "trajectories": 0, "structures": 0, "research": 0, "workspace": 0, "other": 0}
        count = 0
        object_sizes: dict[str, int] = {}
        complete = attribution_complete
        pending_prefixes = iter(prefixes)
        prefix = next(pending_prefixes)
        query: dict[str, Any] = {"Bucket": self.services.bucket, "Prefix": prefix, "MaxKeys": 1000}
        for _ in range(20):
            page = self.services.s3.list_objects_v2(**query)
            for obj in page.get("Contents", []):
                if obj["Key"] in object_sizes or not in_scope(obj["Key"]):
                    continue
                object_sizes[obj["Key"]] = int(obj.get("Size") or 0)
                key = obj["Key"][len(owner_prefix):]
                parts = key.split("/")
                category = "trajectories" if "md" in parts and "trajectories" in parts else next(
                    (part for part in ("calculations", "structures", "research", "workspace")
                     if part in parts or key.startswith(part + ".")),
                    "other",
                )
                categories[category] += int(obj.get("Size") or 0)
                count += 1
            if not page.get("IsTruncated"):
                prefix = next(pending_prefixes, None)
                if prefix is None:
                    break
                query = {"Bucket": self.services.bucket, "Prefix": prefix, "MaxKeys": 1000}
            else:
                query["ContinuationToken"] = page["NextContinuationToken"]
        else:
            complete = False

        retained_bytes = sum(int(item.get("retainedBytes", item.get("sizeBytes", 0)))
                             for _, item in research_items
                             if project_id is None or item.get("projectId") in project_ids)
        quota_details: dict[str, Any] = {}
        if getattr(self.services.s3, "enforces_cloud_quota", False):
            partition = f"CLOUD_STORAGE#{storage_owner(owner)}"
            reserved = sum(max(0, int(item["reservedBytes"]) - object_sizes.get(item["objectKey"], 0))
                           for item in self.services.s3.reservations(partition)
                           if in_scope(str(item.get("objectKey", ""))))
            quota_details = {"cloudQuotaBytes": storage_limit(self.services, owner), "uploadReservedBytes": reserved}
        return {
            "storage": {"bytes": sum(categories.values()), "objects": count, "categories": categories,
                        "complete": complete, "scope": "current-objects" if project_id is None else "project-objects", "researchQuotaBytes": storage_limit(self.services, owner),
                        "researchRetainedBytes": retained_bytes, **quota_details},
            **self.compute_usage(owner, project_id),
        }

    def compute_usage(self, owner: str, project_id: str | None = None) -> dict[str, Any]:
        """Read owned job records without enumerating objects or research documents."""
        jobs = [job for kind in ("CALCULATION", "MD_SIMULATION", "MD_ANALYSIS") for job in self.services.list_owner_items(owner, kind)]
        if project_id is not None:
            project = self.services.get_item(owner, "PROJECT", project_id) or {}
            project_ids = {project_id, project.get("legacyId")} - {None, ""}
            jobs = [job for job in jobs if job.get("projectId") in project_ids]
        now = time.time()
        measured = []
        cpu_measured = []
        solver_measured = []
        gross_quanta = []
        net_quanta = []
        refunded_quanta = []
        quanta_measured_runs = 0
        def valid_quanta(value: Any) -> bool:
            return isinstance(value, (int, float, Decimal)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0
        for job in jobs:
            start, end = epoch(job.get("startedAt")), epoch(job.get("completedAt"))
            if job.get("status") in FINAL_JOB_STATES and start is not None and end is not None and end >= start:
                measured.append((job, end - start, end))
                # Personal workers can launch less than requested on a smaller host.
                # Old personal jobs do not establish the delivered allocation.
                cpu = job.get("effectiveVcpus", job.get("vcpus") if job.get("computeTarget") == "shared" else None)
                if isinstance(cpu, (int, Decimal)) and not isinstance(cpu, bool) and math.isfinite(cpu) and cpu > 0 and cpu == int(cpu):
                    cpu_measured.append((end - start) * int(cpu))
            solver = job.get("computeSeconds")
            if isinstance(solver, (int, float, Decimal)) and not isinstance(solver, bool) and math.isfinite(solver) and solver >= 0:
                solver_measured.append(float(solver))
            # A job's chargedQuanta is already its net debit after a refund.
            net, refund = job.get("chargedQuanta"), job.get("refundedQuanta")
            if valid_quanta(net):
                net_quanta.append(float(net))
            if valid_quanta(refund):
                refunded_quanta.append(float(refund))
            if valid_quanta(net) and valid_quanta(refund):
                gross_quanta.append(float(net) + float(refund))
                quanta_measured_runs += 1
        final = [job for job in jobs if job.get("status") in FINAL_JOB_STATES]
        active = [job for job in jobs if job.get("status") in {"PREPARING", "QUEUED", "RUNNING", "CANCEL_REQUESTED"}]
        compute = {
            "measuredAt": utc_now(),
            "compute": {
                "wallSeconds": round(sum(seconds for _, seconds, _ in measured)),
                "allocatedCpuSeconds": round(sum(cpu_measured)),
                "unmeasuredCpuRuns": len(final) - len(cpu_measured),
                "reportedSolverSeconds": round(sum(solver_measured)),
                "reportedSolverRuns": len(solver_measured),
                "last30DaysSeconds": round(sum(seconds for _, seconds, end in measured if end >= now - 30 * 86400)),
                "personalSeconds": round(sum(seconds for job, seconds, _ in measured if job.get("computeTarget") == "personal")),
                "measuredRuns": len(measured), "unmeasuredRuns": len(final) - len(measured),
                "totalRuns": len(jobs), "completedRuns": sum(job.get("status") == "COMPLETED" for job in jobs),
                "activeRuns": sum(job.get("status") in {"PREPARING", "QUEUED", "RUNNING", "CANCEL_REQUESTED"} for job in jobs),
            },
        }
        if gross_quanta:
            compute["compute"]["chargedQuanta"] = round(sum(gross_quanta), 6)
        if refunded_quanta:
            compute["compute"]["refundedQuanta"] = round(sum(refunded_quanta), 6)
        if net_quanta:
            compute["compute"]["netQuanta"] = round(sum(net_quanta), 6)
        compute["compute"]["quantaMeasuredRuns"] = quanta_measured_runs
        compute["compute"]["quantaUnmeasuredRuns"] = len(jobs) - quanta_measured_runs
        def public_run(job: dict[str, Any]) -> dict[str, Any]:
            return {**{key: job.get(key) for key in ("id", "name", "projectId", "status", "computePhase", "calculationType", "computeTarget", "vcpus", "memoryMiB", "effectiveVcpus", "effectiveMemoryMiB", "createdAt", "startedAt", "completedAt", "cloudMode", "computeProfileId", "computeSeconds", "fundedComputeSeconds")},
                    **{key: job[key] for key in ("chargedQuanta", "refundedQuanta") if valid_quanta(job.get(key))},
                    "calculationType": job.get("calculationType") or ("LAMMPS simulation" if job.get("entityType") == "MD_SIMULATION" else "OVITO analysis" if job.get("entityType") == "MD_ANALYSIS" else "DFT calculation")}
        compute["recentRuns"] = [public_run(job) for job in sorted(jobs, key=lambda item: item.get("createdAt", ""), reverse=True)[:12]]
        compute["activeRuns"] = [public_run(job) for job in sorted(active, key=lambda item: item.get("createdAt", ""), reverse=True)]
        return compute

    def calculations(self, owner: str, query: dict[str, str]) -> dict[str, Any]:
        try:
            limit = int(query.get("limit", "6"))
            if not 1 <= limit <= 50:
                raise ValueError()
            cursor = query.get("cursor", "")
            if len(cursor) > 1024:
                raise ValueError()
            boundary = json.loads(base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4))) if cursor else None
            if boundary is not None and (not isinstance(boundary, list) or len(boundary) != 2 or not all(isinstance(value, str) for value in boundary)):
                raise ValueError()
        except (ValueError, TypeError):
            raise ApiError(400, "Calculation page is invalid.", "INVALID_PAGE") from None
        jobs = [job for kind in ("CALCULATION", "MD_SIMULATION", "MD_ANALYSIS") for job in self.services.list_owner_items(owner, kind)]
        key = lambda item: (str(item.get("createdAt") or ""), str(item.get("id") or ""))
        ordered = sorted(jobs, key=key, reverse=True)
        if boundary:
            ordered = [item for item in ordered if key(item) < tuple(boundary)]
        page = ordered[:limit]
        fields = ("id", "name", "status", "calculationType", "computeTarget", "vcpus", "memoryMiB", "effectiveVcpus", "effectiveMemoryMiB", "createdAt", "startedAt", "completedAt", "cloudMode", "computeProfileId", "computeSeconds", "chargedQuanta", "refundedQuanta", "fundedComputeSeconds")
        return {"runs": [{**{field: item.get(field) for field in fields}, "calculationType": item.get("calculationType") or ("LAMMPS simulation" if item.get("entityType") == "MD_SIMULATION" else "OVITO analysis" if item.get("entityType") == "MD_ANALYSIS" else "DFT calculation")} for item in page], "total": len(jobs),
                "nextCursor": base64.urlsafe_b64encode(json.dumps(key(page[-1])).encode()).decode().rstrip("=") if len(ordered) > limit else None}

    def overview(self, owner: str) -> dict[str, Any]:
        item = self.services.get_item(owner, "ACCOUNT", "primary") or {}
        worker = self.services.get_item(owner, "PERSONAL_WORKER", "primary") or {}
        enabled = bool(worker.get("tokenHash"))
        return {
            "personalDefaults": item.get("personalDefaults", {}),
            "personalLimits": personal_limits(self.services),
            "computeProfileId": None,
            "estimatedComputeSeconds": int(item.get("estimatedComputeSeconds") or 3600),
            "cloudMode": "pilot", "pilotCompute": None, "paidCompute": None,
            "username": item.get("username", ""), "planId": "free", "billingStatus": "free",
            "computeTarget": "personal", "billingAvailable": False,
            "quanta": {"balance": 0, "usedThisMonth": 0, "usdPerQuanta": 1},
            "entitlements": {"personalCompute": True, "cloudCompute": False},
            "localComputeAvailable": self.services.local_worker_enabled,
            "limits": {"researchBytes": storage_limit(self.services, owner), "vcpus": self.services.max_job_vcpus, "memoryMiB": self.services.max_job_memory},
            "computer": {
                "enabled": enabled,
                "status": "connected" if enabled and int(worker.get("lastSeenAtEpoch") or 0) >= time.time() - 90 else "offline" if enabled else "not-connected",
                "createdAt": worker.get("credentialCreatedAt"), "lastSeenAt": worker.get("lastSeenAt"),
                "workerId": worker.get("workerId"), "telemetry": public_worker_telemetry(worker.get("telemetry")),
                "name": worker.get("deviceName"),
                "capabilities": [value for value in (worker.get("capabilities") or []) if value in {"qe", "md-analysis", "md-simulation"}],
            },
        }

    def handle(self, owner: str, method: str, path: str, payload: dict[str, Any], query=None):
        if path == "/v1/account" and method == "GET":
            profile = self.services.get_item(owner, "PROFILE", "primary")
            return response(200, {"account": self.overview(owner), "profile": public_item(profile) if profile else None})
        if path == "/v1/account/usage" and method == "GET":
            values = query or {}
            project = values.get("projectId")
            if project is not None:
                require_project(self.services, owner, project)
            return response(200, {"usage": self.usage(owner, values.get("scope"), project)})
        if path == "/v1/account/calculations" and method == "GET":
            return response(200, self.calculations(owner, query or {}))
        if path == "/v1/account/compute" and method == "PUT":
            if payload.get("computeTarget", "personal") != "personal":
                raise ApiError(400, "Select online compute through the optional Cloud connection.", "INVALID_COMPUTE_TARGET")
            changes = {"computeTarget": "personal"}
            if "personalDefaults" in payload:
                changes["personalDefaults"] = validate_personal_defaults(self.services, payload["personalDefaults"])
            self.save(owner, "ACCOUNT", changes)
            return response(200, {"account": self.overview(owner)})
        raise ApiError(404, "Use the optional Cloud connection for cloud account settings. Local workers are managed by the launcher.", "NOT_FOUND")

    def authenticate_computer(self, token: str) -> str:
        supplied = hashlib.sha256(token.encode()).hexdigest()
        if not token or not hmac.compare_digest(supplied, self.services.worker_token_sha256):
            raise ApiError(401, "Local worker authentication failed.", "WORKER_UNAUTHORIZED")
        return self.services.owner

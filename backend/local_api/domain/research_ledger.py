"""Local-first research context and run ledger.

Records are append-only, project-scoped metadata.  Scientific outputs remain in
artifact storage; this ledger only indexes the evidence needed to understand a
run and never accepts credentials or unverified scientific claims.
"""
from __future__ import annotations

import re
from typing import Any

from backend.local_api.domain.phynite_core import (
    ApiError,
    MetadataServices,
    clean_text,
    new_id,
    owner_partition,
    public_item,
    require_project,
    utc_now,
)
from backend.local_api.domain.failure_digest import classify_scientific_failure

EVENT_TYPES = {
    "project_created",
    "structure_imported",
    "workflow_saved",
    "calculation_submitted",
    "calculation_started",
    "calculation_progress",
    "calculation_completed",
    "calculation_failed",
    "calculation_cancelled",
    "artifact_verified",
    "decision",
    "ai_summary",
}
# Clients can add research notes and references.  Lifecycle state is emitted by
# the server after it has observed the owned calculation, never asserted by a
# browser request.
CLIENT_EVENT_TYPES = {"workflow_saved", "artifact_verified", "decision", "ai_summary"}
SERVER_EVENT_TYPES = EVENT_TYPES - CLIENT_EVENT_TYPES
SECRET_KEY = re.compile(r"(?:token|secret|password|cookie|credential|authorization|api[_-]?key|session)", re.I)
HEX_SHA256 = re.compile(r"^[a-f0-9]{64}$")


def _bounded_value(value: Any, label: str, depth: int = 0) -> Any:
    if depth > 2:
        raise ApiError(400, f"{label} is too deeply nested.", "INVALID_RESEARCH_EVENT")
    if isinstance(value, str):
        if len(value) > 1000:
            raise ApiError(400, f"{label} is too long.", "INVALID_RESEARCH_EVENT")
        if re.search(r"(?:^|\s)(?:bearer\s+|sk-[A-Za-z0-9_-]{20,}|phyp\.[A-Za-z0-9_.-]{20,})", value, re.I):
            raise ApiError(400, f"{label} contains a credential.", "INVALID_RESEARCH_EVENT")
        return value
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, list):
        if len(value) > 40:
            raise ApiError(400, f"{label} has too many entries.", "INVALID_RESEARCH_EVENT")
        return [_bounded_value(item, label, depth + 1) for item in value]
    if isinstance(value, dict):
        if len(value) > 24:
            raise ApiError(400, f"{label} has too many fields.", "INVALID_RESEARCH_EVENT")
        result: dict[str, Any] = {}
        for key, item in value.items():
            if not isinstance(key, str) or len(key) > 80 or SECRET_KEY.search(key):
                raise ApiError(400, f"{label} contains a private field.", "INVALID_RESEARCH_EVENT")
            result[key] = _bounded_value(item, label, depth + 1)
        return result
    raise ApiError(400, f"{label} contains an unsupported value.", "INVALID_RESEARCH_EVENT")


def normalize_event(payload: dict[str, Any], *, allow_server: bool = False) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ApiError(400, "Research event must be an object.", "INVALID_RESEARCH_EVENT")
    event_type = payload.get("eventType")
    if not isinstance(event_type, str) or event_type not in EVENT_TYPES:
        raise ApiError(400, "Research event type is not supported.", "INVALID_RESEARCH_EVENT")
    if not allow_server and event_type not in CLIENT_EVENT_TYPES:
        raise ApiError(400, "Run lifecycle events are recorded by the local service.", "SERVER_EVENT_REQUIRED")
    title = clean_text(payload.get("title") or event_type.replace("_", " ").title(), "Event title", minimum=1, maximum=180)
    summary = clean_text(payload.get("summary", ""), "Event summary", maximum=1000)
    normalized: dict[str, Any] = {"eventType": event_type, "title": title, "summary": summary}
    for field in ("runId", "calculationId", "jobKind"):
        if field in payload and payload[field] is not None:
            normalized[field] = clean_text(payload[field], field, minimum=1, maximum=96)
    if "metadata" in payload:
        metadata = payload["metadata"]
        if not isinstance(metadata, dict):
            raise ApiError(400, "Event metadata must be an object.", "INVALID_RESEARCH_EVENT")
        normalized["metadata"] = _bounded_value(metadata, "Event metadata")
    if "artifactRefs" in payload:
        refs = payload["artifactRefs"]
        if not isinstance(refs, list) or len(refs) > 40:
            raise ApiError(400, "Artifact references are invalid.", "INVALID_RESEARCH_EVENT")
        normalized["artifactRefs"] = [_bounded_value(ref, "Artifact reference") for ref in refs]
    if "inputSha256" in payload and payload["inputSha256"] is not None:
        digest = payload["inputSha256"]
        if not isinstance(digest, str) or not HEX_SHA256.fullmatch(digest.lower()):
            raise ApiError(400, "Input checksum must be a SHA-256 digest.", "INVALID_RESEARCH_EVENT")
        normalized["inputSha256"] = digest.lower()
    if "provenance" in payload:
        normalized["provenance"] = _bounded_value(payload["provenance"], "Provenance")
    return normalized


def append_research_event(
    services: MetadataServices,
    owner: str,
    project_id: str,
    payload: dict[str, Any],
    *,
    allow_server: bool = False,
) -> dict[str, Any]:
    """Append an immutable, owned event and return its public representation."""
    require_project(services, owner, project_id)
    event = normalize_event(payload, allow_server=allow_server)
    timestamp = utc_now()
    event_id = new_id("evt")
    item = {
        "PK": owner_partition(owner),
        "SK": f"RESEARCH_EVENT#{event_id}",
        "GSI1PK": f"PROJECT#{project_id}",
        "GSI1SK": f"RESEARCH_EVENT#{timestamp}#{event_id}",
        "entityType": "RESEARCH_EVENT",
        "id": event_id,
        "ownerId": owner,
        "projectId": project_id,
        "createdAt": timestamp,
        **event,
    }
    services.put_item(item, "attribute_not_exists(PK)")
    return public_item(item)


def list_research_events(
    services: MetadataServices,
    owner: str,
    project_id: str,
    *,
    limit: int = 100,
    before: str | None = None,
) -> list[dict[str, Any]]:
    require_project(services, owner, project_id)
    try:
        page_size = max(1, min(int(limit), 200))
    except (TypeError, ValueError):
        page_size = 100
    rows = [row for row in services.list_project_items(project_id, "RESEARCH_EVENT") if row.get("ownerId") == owner]
    rows.sort(key=lambda row: (str(row.get("createdAt") or ""), str(row.get("id") or "")), reverse=True)
    if before:
        marker = str(before)
        rows = [row for row in rows if f"{row.get('createdAt', '')}#{row.get('id', '')}" < marker]
    return [public_item(row) for row in rows[:page_size]]


def research_context(services: MetadataServices, owner: str, project_id: str, *, limit: int = 100) -> dict[str, Any]:
    project = require_project(services, owner, project_id)
    events = list_research_events(services, owner, project_id, limit=limit)
    runs: list[dict[str, Any]] = []
    for kind in ("CALCULATION", "MD_SIMULATION", "MD_ANALYSIS"):
        for row in services.list_project_items(project_id, kind):
            if row.get("ownerId") != owner:
                continue
            public = public_item(row)
            failure_reason = public.get("failureReason") if isinstance(public.get("failureReason"), str) else None
            runs.append({
                "id": public.get("id"),
                "kind": kind,
                "name": public.get("name") or public.get("calculationType"),
                "status": public.get("status"),
                "statusMessage": public.get("statusMessage"),
                "failureReason": failure_reason,
                "failureCategory": public.get("failureCategory") or (classify_scientific_failure(failure_reason) if failure_reason else None),
                "createdAt": public.get("createdAt"),
                "startedAt": public.get("startedAt"),
                "updatedAt": public.get("updatedAt"),
                "completedAt": public.get("completedAt"),
                "inputSha256": public.get("inputSha256"),
                "provenance": public.get("provenance") or public.get("resultProvenance"),
                "effectiveResources": public.get("effectiveResources"),
                "wallTimeSeconds": public.get("wallTimeSeconds"),
                "solverTimeSeconds": public.get("solverTimeSeconds"),
                "diskIoBytes": public.get("diskIoBytes"),
                "memoryPeakMiB": public.get("memoryPeakMiB"),
                "exitCode": public.get("exitCode"),
                "outputBytes": public.get("outputBytes"),
                "resultSummary": public.get("resultSummary"),
            })
    runs.sort(key=lambda row: str(row.get("createdAt") or ""), reverse=True)
    failures = [run for run in runs if run.get("status") in {"FAILED", "CANCELLED"}]
    return {
        "project": public_item(project),
        "events": events,
        "runs": runs[:200],
        "failures": failures[:100],
        "generatedAt": utc_now(),
    }

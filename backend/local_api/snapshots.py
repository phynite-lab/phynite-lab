"""Collect complete project evidence into portable, checksummed transfer chunks.

This module does not include account records, credentials, device pairing, cloud
session or sync queue records. Snapshot publication/import is the caller's atomic
metadata operation; this collector never mutates source project records.
"""
from __future__ import annotations

import hashlib
import copy
import os
import re
import secrets
from pathlib import Path
from typing import Any, Callable
from urllib.parse import parse_qsl, urlsplit

from .cloud_client import CloudError

from backend.local_api.domain.phynite_core import owner_partition, storage_owner, json_safe
from backend.local_api.domain.project_sync import MAX_CHUNK_BYTES, validate_snapshot


PROJECT_KINDS = {"PROJECT", "STRUCTURE", "CALCULATION", "CALCULATION_CONFIGURATION", "CALCULATION_COMPONENT", "MD_TRAJECTORY", "MD_ANALYSIS", "MD_SIMULATION", "MD_POTENTIAL", "MD_CONFIGURATION", "PROJECT_WORKFLOW", "PROJECT_RUN", "WORKFLOW_ATTEMPT", "PROJECT_VIEW_STATE", "DATASET", "FIGURE", "FIGURE_TEMPLATE", "AI_CONVERSATION", "AI_MESSAGE", "AI_RUN", "AI_ACTION", "AI_ATTACHMENT", "AI_ARTIFACT"}
TERMINAL = {"draft", "completed", "failed", "cancelled", "canceled", "ready", "stopped"}
SENSITIVE_FIELDS = {"accessToken", "refreshToken", "idToken", "password", "token", "workerToken", "workerTokenHash", "workerId", "localWorkerId", "batchJobId", "leaseExpiresAtEpoch", "leaseToken", "pendingCalls", "credential", "credentials", "apiKey", "authorization"}


def _sanitize(value: Any) -> Any:
    if isinstance(value, dict):
        # Scientific/user JSON is opaque evidence, even when its property names
        # resemble operational fields. Only application records own credentials.
        return {key: copy.deepcopy(item) if key in {"metadata", "provenance", "atoms", "lattice", "inputFiles"} else _sanitize(item) for key, item in value.items() if key not in SENSITIVE_FIELDS and key not in {"PK", "ownerId"} and not key.startswith("GSI")}
    if isinstance(value, list):
        return [_sanitize(item) for item in value]
    return value


def _private_url(value: Any) -> bool:
    if not isinstance(value, str) or not value.startswith(("http://", "https://")):
        return False
    parsed = urlsplit(value)
    return bool(parsed.username or parsed.password or any(key.lower().startswith("x-amz-") or key.lower() in {"access_token", "refresh_token", "token", "api_key", "apikey", "authorization", "signature", "sig"} for key, _ in parse_qsl(parsed.query)))


def _strings(value: Any, field: str = "") -> list[tuple[str, str]]:
    if isinstance(value, str):
        return [(field, value)]
    if isinstance(value, dict):
        return [entry for key, item in value.items() for entry in _strings(item, key)]
    if isinstance(value, list):
        return [entry for item in value for entry in _strings(item, field)]
    return []


def _owner_records(services: Any, owner: str) -> list[dict[str, Any]]:
    records = []
    args: dict[str, Any] = {"KeyConditionExpression": "PK = :pk", "ExpressionAttributeValues": {":pk": owner_partition(owner)}, "ConsistentRead": True}
    while True:
        page = services.table.query(**args)
        records.extend(page.get("Items", []))
        if not page.get("LastEvaluatedKey"):
            break
        args["ExclusiveStartKey"] = page["LastEvaluatedKey"]
    return records


def build_project_snapshot(services: Any, owner: str, project_id: str, staging_dir: Path, *, allow_asset: Callable[[str, dict[str, Any]], bool] | None = None, deleted: bool = False) -> tuple[dict[str, Any], dict[str, Path]]:
    """Return sync manifest + immutable local chunk files (digest -> path).

    Caller must serialize this operation with project edits and job launches. A
    project with active computation is deferred, so live output is never uploaded.
    Assets whose distribution licence is unknown are excluded and listed missing.
    """
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", project_id):
        raise ValueError("Project identity is invalid.")
    all_records = _owner_records(services, owner)
    selected = [record for record in all_records if record.get("entityType") in PROJECT_KINDS and (record.get("projectId") == project_id or record.get("entityType") in {"PROJECT", "PROJECT_WORKFLOW", "PROJECT_VIEW_STATE"} and record.get("id") == project_id or record.get("entityType") == "AI_CONVERSATION" and record.get("projectKey") in {"project:" + project_id, "md:" + project_id, "dft:" + project_id})]
    if not any(record.get("entityType") == "PROJECT" and record.get("id") == project_id for record in selected):
        raise CloudError(404, "LOCAL_PROJECT_NOT_FOUND", "Choose a saved local project before exporting or syncing.")
    conversations = {record["id"] for record in selected if record.get("entityType") == "AI_CONVERSATION"}
    for record in all_records:
        if record.get("entityType", "").startswith("AI_") and record.get("entityType") in PROJECT_KINDS and record.get("conversationId") in conversations and record not in selected:
            selected.append(record)
    if any(record.get("entityType") in {"CALCULATION", "MD_SIMULATION", "MD_ANALYSIS", "AI_RUN"} and str(record.get("status", "")).lower() not in TERMINAL for record in selected):
        raise CloudError(409, "SYNC_PROJECT_BUSY", "This project has active work. Its completed snapshot will sync after the work stops.")
    root = Path(staging_dir).resolve()
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    owner_prefix = f"users/{storage_owner(owner)}/"
    keys: dict[str, dict[str, Any]] = {}
    missing = []
    for record in selected:
        # Direct object references and bounded result/research-history prefixes
        # are followed only inside this owner's own namespace.
        references = [(field, value) for field, value in _strings(record) if field in {"objectKey", "inputKey", "outputPrefix", "snapshotKey", "manifestKey", "extractedKey", "visionKey"} and value.startswith(owner_prefix)]
        for field, value in references:
            if field != "outputPrefix":
                keys[value] = record
                continue
            args: dict[str, Any] = {"Bucket": services.bucket, "Prefix": value.rstrip("/") + "/"}
            while True:
                page = services.s3.list_objects_v2(**args)
                for item in page.get("Contents", []):
                    keys[item["Key"]] = record
                if not page.get("IsTruncated"):
                    break
                args["ContinuationToken"] = page["NextContinuationToken"]
    objects = []
    artifacts = []
    sources = {}
    for key, record in sorted(keys.items()):
        if key.lower().endswith(".upf") or record.get("entityType") == "MD_POTENTIAL" and not (allow_asset and allow_asset(key, record)):
            missing.append({"path": key[len(owner_prefix):], "reason": "This asset requires a separately verified distribution licence."})
            continue
        relative = key[len(owner_prefix):]
        if "\\" in relative or any(part in {"", ".", ".."} for part in relative.split("/")):
            raise CloudError(409, "LOCAL_ARTIFACT_INVALID", "A project artifact has an invalid owner-relative path.")
        item = services.s3.get_object(Bucket=services.bucket, Key=key)
        body = item["Body"]
        parts = []
        complete_digest, size = hashlib.sha256(), 0
        try:
            index = 0
            while chunk := body.read(MAX_CHUNK_BYTES):
                digest = hashlib.sha256(chunk).hexdigest()
                target = root / digest
                temporary = root / (".snapshot-" + secrets.token_hex(16))
                try:
                    with temporary.open("xb") as handle:
                        handle.write(chunk)
                        handle.flush()
                        os.fsync(handle.fileno())
                    temporary.chmod(0o600)
                    os.replace(temporary, target)
                finally:
                    temporary.unlink(missing_ok=True)
                sources[digest] = target
                path = f"objects/{hashlib.sha256(relative.encode()).hexdigest()}/{index:08d}"
                artifacts.append({"path": path, "sha256": digest, "sizeBytes": len(chunk), "contentType": "application/octet-stream"})
                parts.append({"path": path, "sha256": digest, "sizeBytes": len(chunk)})
                complete_digest.update(chunk)
                size += len(chunk)
                index += 1
        finally:
            body.close()
        if "ContentLength" in item and size != int(item["ContentLength"]):
            raise CloudError(409, "LOCAL_ARTIFACT_INVALID", "A project artifact changed during export.")
        objects.append({"key": relative, "sha256": complete_digest.hexdigest(), "sizeBytes": size, "contentType": item.get("ContentType", "application/octet-stream"), "metadata": item.get("Metadata", {}), "chunks": parts})
    # References in records retain an owner-neutral scheme for remapping by the
    # importing local owner. No local path, signed URL or cloud session is copied.
    def neutral(value: Any) -> Any:
        if isinstance(value, str) and value.startswith(owner_prefix):
            return "phynite-object:///" + value[len(owner_prefix):]
        if isinstance(value, dict):
            return {key: neutral(item) for key, item in value.items() if key not in {"downloadUrl", "viewUrl", "uploadUrl"} and not _private_url(item)}
        if isinstance(value, list):
            return [neutral(item) for item in value]
        return value
    snapshot = {"schemaVersion": 1, "projectId": project_id, "document": {"format": "phynite-project", "version": 1, "records": neutral(json_safe(_sanitize(selected))), "objects": objects, "missingAssets": missing}, "artifacts": artifacts, "deleted": deleted}
    validate_snapshot(snapshot, project_id)
    return snapshot, sources

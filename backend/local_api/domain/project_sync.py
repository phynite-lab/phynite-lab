"""Public snapshot format and integrity validation; Cloud server is separate."""
from __future__ import annotations

import base64

import hashlib

import json

import re

import secrets

import time

from pathlib import PurePosixPath

from contextlib import nullcontext

from typing import Any

from backend.local_api.domain.phynite_core import ApiError, owner_partition, response, storage_owner, utc_now

SYNC_PATH = re.compile(r"^/v1/sync/projects/([A-Za-z0-9_-]{1,100})/(head|prepare|commit|snapshots/[1-9][0-9]*)$")

MAX_MANIFEST_BYTES = 4_000_000

MAX_CHUNK_BYTES = 16 * 1024**2

MAX_CHUNKS = 10_000

TRASH_SECONDS = 15 * 86400

def canonical(value: Any) -> bytes:
    try:
        return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()
    except (TypeError, ValueError, RecursionError) as exc:
        raise ApiError(400, "Snapshot must contain finite JSON values.", "INVALID_SYNC_SNAPSHOT") from exc

def validate_snapshot(snapshot: Any, project_id: str) -> bytes:
    if not isinstance(snapshot, dict) or set(snapshot) - {"schemaVersion", "projectId", "document", "artifacts", "deleted"}:
        raise ApiError(400, "Snapshot fields are invalid.", "INVALID_SYNC_SNAPSHOT")
    if type(snapshot.get("schemaVersion")) is not int or snapshot["schemaVersion"] != 1 or snapshot.get("projectId") != project_id or not isinstance(snapshot.get("document"), dict) or type(snapshot.get("deleted", False)) is not bool:
        raise ApiError(400, "Snapshot identity, document or version is invalid.", "INVALID_SYNC_SNAPSHOT")
    artifacts = snapshot.get("artifacts")
    if not isinstance(artifacts, list) or len(artifacts) > MAX_CHUNKS:
        raise ApiError(400, "Snapshot has too many transfer chunks.", "INVALID_SYNC_SNAPSHOT")
    paths: set[str] = set()
    identities: dict[str, int] = {}
    for artifact in artifacts:
        if not isinstance(artifact, dict) or set(artifact) != {"path", "sha256", "sizeBytes", "contentType"}:
            raise ApiError(400, "Artifact fields are invalid.", "INVALID_SYNC_SNAPSHOT")
        path = artifact["path"]
        if not isinstance(path, str) or not 1 <= len(path) <= 1000 or "\\" in path or "\x00" in path or path.startswith("/") or any(part in {"", ".", ".."} for part in path.split("/")) or PurePosixPath(path).is_absolute() or path in paths:
            raise ApiError(400, "Artifact paths must be unique relative paths.", "INVALID_SYNC_SNAPSHOT")
        digest, size = artifact["sha256"], artifact["sizeBytes"]
        if not isinstance(digest, str) or not re.fullmatch(r"[a-f0-9]{64}", digest) or type(size) is not int or not 0 <= size <= MAX_CHUNK_BYTES or not isinstance(artifact["contentType"], str) or not re.fullmatch(r"[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+", artifact["contentType"]):
            raise ApiError(400, "Artifact needs a SHA-256, bounded size and media type.", "INVALID_SYNC_SNAPSHOT")
        if digest in identities and identities[digest] != size:
            raise ApiError(400, "One checksum cannot identify different sizes.", "INVALID_SYNC_SNAPSHOT")
        paths.add(path)
        identities[digest] = size
    encoded = canonical(snapshot)
    if len(encoded) > MAX_MANIFEST_BYTES:
        raise ApiError(413, "Project snapshot metadata exceeds 4 MB.", "SYNC_SNAPSHOT_TOO_LARGE")
    return encoded

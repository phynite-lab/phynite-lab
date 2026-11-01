"""Validation helpers for owner-scoped MD Batch result manifests."""
from __future__ import annotations

import json
import re
from pathlib import PurePosixPath
from typing import Any

from backend.local_api.domain.phynite_core import calculation_artifact_expiry


MAX_MD_RESULT_MANIFEST_BYTES = 8_000_000
MAX_MD_RESULT_ARTIFACTS = 10_001
MAX_MD_RESULT_FRAMES = 10_000
MAX_MD_RESULT_ATOM_FRAMES = 50_000_000
MAX_MD_RESULT_TOTAL_BYTES = 8 * 1024 * 1024 * 1024
MD_ARTIFACT_PATH = re.compile(
    r"^(?:timeline\.json\.gz|frames/(?:[0-9]{6}|[0-9]{6}-[0-9]{6})\.json\.gz)$"
)
SHA256_PATTERN = re.compile(r"^[a-f0-9]{64}$")


class MdResultError(ValueError):
    pass


def _bounded_integer(value: Any, maximum: int, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0 or value > maximum:
        raise MdResultError(f"MD result {label} is invalid.")
    return value


def validate_md_result_manifest(value: Any, item: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("version") != 1:
        raise MdResultError("MD result version is invalid.")
    expected = {
        "analysisId": item.get("id"),
        "projectId": item.get("projectId"),
        "sourceId": item.get("trajectoryId"),
        "sourceSha256": item.get("sourceSha256"),
    }
    if any(value.get(name) != expected_value for name, expected_value in expected.items()):
        raise MdResultError("MD result identity does not match the submitted analysis.")
    if value.get("status") != "completed" or value.get("syntheticData") is not False:
        raise MdResultError("MD result is not a completed scientific analysis.")
    frame_count = _bounded_integer(value.get("frameCount"), MAX_MD_RESULT_FRAMES, "frame count")
    atom_frames = _bounded_integer(value.get("atomFrames"), MAX_MD_RESULT_ATOM_FRAMES, "atom-frame count")
    if frame_count < 1 or atom_frames < frame_count:
        raise MdResultError("MD result contains an empty frame selection.")
    if value.get("pipelineFingerprint") != item.get("pipelineFingerprint"):
        raise MdResultError("MD result pipeline does not match the submitted analysis.")
    raw_range = value.get("frameRange")
    if not isinstance(raw_range, dict) or set(raw_range) != {"start", "stop", "stride"}:
        raise MdResultError("MD result frame range is invalid.")
    start = _bounded_integer(raw_range.get("start"), MAX_MD_RESULT_FRAMES - 1, "frame start")
    stop = _bounded_integer(raw_range.get("stop"), MAX_MD_RESULT_FRAMES, "frame stop")
    stride = _bounded_integer(raw_range.get("stride"), MAX_MD_RESULT_FRAMES, "frame stride")
    if stop <= start or stride < 1:
        raise MdResultError("MD result frame range is empty.")
    selected_frames = list(range(start, stop, stride))
    if len(selected_frames) != frame_count:
        raise MdResultError("MD result frame range does not match its frame count.")

    raw_artifacts = value.get("artifacts")
    if not isinstance(raw_artifacts, list) or not 1 <= len(raw_artifacts) <= MAX_MD_RESULT_ARTIFACTS:
        raise MdResultError("MD result artifact list is invalid.")
    artifacts: list[dict[str, Any]] = []
    paths: set[str] = set()
    frame_artifacts = 0
    frame_shard_artifacts = 0
    timeline_artifacts = 0
    total_artifact_bytes = 0
    for raw in raw_artifacts:
        if not isinstance(raw, dict):
            raise MdResultError("MD result artifact is invalid.")
        path = raw.get("path")
        if not isinstance(path, str) or not MD_ARTIFACT_PATH.fullmatch(path):
            raise MdResultError("MD result artifact path is invalid.")
        parsed_path = PurePosixPath(path)
        if parsed_path.is_absolute() or ".." in parsed_path.parts or path in paths:
            raise MdResultError("MD result artifact path is unsafe or duplicated.")
        paths.add(path)
        role = raw.get("role")
        expected_role = (
            "timeline"
            if path == "timeline.json.gz"
            else "frame-shard"
            if "-" in PurePosixPath(path).stem
            else "frame"
        )
        if role != expected_role:
            raise MdResultError("MD result artifact role does not match its path.")
        timeline_artifacts += role == "timeline"
        frame_artifacts += role == "frame"
        frame_shard_artifacts += role == "frame-shard"
        label = raw.get("label")
        if not isinstance(label, str) or not label.strip() or len(label) > 160:
            raise MdResultError("MD result artifact label is invalid.")
        content_type = raw.get("contentType")
        if content_type != "application/json" or raw.get("contentEncoding") != "gzip":
            raise MdResultError("MD result artifact encoding is invalid.")
        size_bytes = _bounded_integer(raw.get("sizeBytes"), 128 * 1024 * 1024, "artifact size")
        if size_bytes < 1:
            raise MdResultError("MD result artifact is empty.")
        total_artifact_bytes += size_bytes
        if total_artifact_bytes > MAX_MD_RESULT_TOTAL_BYTES:
            raise MdResultError("MD result artifacts exceed the total size limit.")
        sha256 = str(raw.get("sha256") or "").lower()
        if not SHA256_PATTERN.fullmatch(sha256):
            raise MdResultError("MD result artifact checksum is invalid.")
        artifacts.append(
            {
                "path": path,
                "label": label.strip(),
                "role": role,
                "contentType": content_type,
                "contentEncoding": "gzip",
                "sizeBytes": size_bytes,
                "sha256": sha256,
            }
        )
    if timeline_artifacts != 1 or bool(frame_artifacts) == bool(frame_shard_artifacts):
        raise MdResultError("MD result artifact count does not match its frame count.")
    if frame_artifacts:
        if frame_artifacts != frame_count:
            raise MdResultError("MD result artifact count does not match its frame count.")
        expected_frame_paths = {f"frames/{index:06d}.json.gz" for index in selected_frames}
        actual_frame_paths = {artifact["path"] for artifact in artifacts if artifact["role"] == "frame"}
        if actual_frame_paths != expected_frame_paths:
            raise MdResultError("MD result frame artifacts do not match the analyzed range.")
    else:
        frame_positions = {frame: position for position, frame in enumerate(selected_frames)}
        shard_ranges: list[tuple[int, int]] = []
        for artifact_item in artifacts:
            if artifact_item["role"] != "frame-shard":
                continue
            match = re.fullmatch(r"frames/([0-9]{6})-([0-9]{6})\.json\.gz", artifact_item["path"])
            if not match:
                raise MdResultError("MD result frame shard path is invalid.")
            first, last = (int(match.group(1)), int(match.group(2)))
            if first not in frame_positions or last not in frame_positions or frame_positions[first] > frame_positions[last]:
                raise MdResultError("MD result frame shard is outside the analyzed range.")
            shard_ranges.append((first, last))
        shard_ranges.sort(key=lambda bounds: frame_positions[bounds[0]])
        cursor = 0
        for first, last in shard_ranges:
            if cursor >= len(selected_frames) or first != selected_frames[cursor]:
                raise MdResultError("MD result frame shards overlap or leave a gap.")
            cursor = frame_positions[last] + 1
        if cursor != len(selected_frames):
            raise MdResultError("MD result frame shards do not cover the analyzed range.")

    engine = value.get("engine")
    if not isinstance(engine, dict):
        raise MdResultError("MD result engine metadata is invalid.")
    engine_id = engine.get("id")
    engine_name = engine.get("name")
    protocol = engine.get("protocol")
    if (
        not isinstance(engine_id, str)
        or not engine_id.strip()
        or len(engine_id) > 80
        or not isinstance(engine_name, str)
        or not engine_name.strip()
        or len(engine_name) > 120
        or protocol != 1
    ):
        raise MdResultError("MD result engine metadata is invalid.")

    return {
        "version": 1,
        "analysisId": expected["analysisId"],
        "projectId": expected["projectId"],
        "sourceId": expected["sourceId"],
        "sourceSha256": expected["sourceSha256"],
        "status": "completed",
        "syntheticData": False,
        "engine": {"id": engine_id.strip(), "name": engine_name.strip(), "protocol": 1},
        "frameRange": {"start": start, "stop": stop, "stride": stride},
        "frameCount": frame_count,
        "atomFrames": atom_frames,
        "pipelineFingerprint": item.get("pipelineFingerprint"),
        "artifacts": artifacts,
    }


def read_md_result_manifest(services: Any, item: dict[str, Any]) -> dict[str, Any]:
    result = services.s3.get_object(
        Bucket=services.bucket,
        Key=f"{item['outputPrefix']}/result.json",
    )
    body = result["Body"].read(MAX_MD_RESULT_MANIFEST_BYTES + 1)
    if len(body) > MAX_MD_RESULT_MANIFEST_BYTES:
        raise MdResultError("MD result manifest is too large.")
    try:
        value = json.loads(body)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise MdResultError("MD result manifest is not valid JSON.") from exc
    return validate_md_result_manifest(value, item)


def md_result_summary(manifest: dict[str, Any]) -> dict[str, Any]:
    return {
        "engine": manifest["engine"],
        "frameRange": manifest.get("frameRange"),
        "frameCount": manifest["frameCount"],
        "atomFrames": manifest["atomFrames"],
        "artifactCount": len(manifest["artifacts"]),
        "pipelineFingerprint": manifest["pipelineFingerprint"],
        "syntheticData": False,
    }


def finalize_md_analysis_result(
    services: Any,
    item: dict[str, Any],
    timestamp: str,
) -> tuple[dict[str, Any], dict[str, Any] | None]:
    """Validate a successful Batch result and atomically publish it.

    Missing S3 output is treated as transient so a later EventBridge delivery or
    owner GET can retry. A present but malformed manifest permanently fails the
    analysis instead of exposing unverified scientific output.
    """
    try:
        manifest = read_md_result_manifest(services, item)
    except MdResultError:
        failed = services.update_item_if_status(
            item["ownerId"],
            "MD_ANALYSIS",
            item["id"],
            {"FINALIZING"},
            {
                "status": "FAILED",
                "progress": 100,
                "failureReason": "MD result manifest validation failed",
                "statusMessage": "MD analysis output could not be verified",
                "completedAt": timestamp,
                "updatedAt": timestamp,
            },
        )
        return failed or services.get_item(item["ownerId"], "MD_ANALYSIS", item["id"]) or item, None
    except Exception:
        return item, None

    artifacts_expire_at, artifacts_expire_at_epoch = calculation_artifact_expiry(timestamp)
    completed = services.update_item_if_status(
        item["ownerId"],
        "MD_ANALYSIS",
        item["id"],
        {"FINALIZING"},
        {
            "status": "COMPLETED",
            "progress": 100,
            "statusMessage": "MD analysis complete",
            "resultSummary": md_result_summary(manifest),
            "completedAt": timestamp,
            "updatedAt": timestamp,
            "artifactsExpireAt": artifacts_expire_at,
            "artifactsExpireAtEpoch": artifacts_expire_at_epoch,
        },
    )
    return completed or services.get_item(item["ownerId"], "MD_ANALYSIS", item["id"]) or item, manifest

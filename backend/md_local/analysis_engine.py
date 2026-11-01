"""Headless trajectory analysis kernel, independent of hosted transfer/broker code."""
from __future__ import annotations

import gzip
import hashlib
import json
import os
import shutil
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable


os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from backend.compute.compute_clock import measured_compute
from ovito.io import import_file

from backend.md_studio.main import (
    AnalysisRequest,
    ENGINE_ID,
    ENGINE_NAME,
    Frame,
    Modifier,
    analyze_request,
    analysis_atom_limit,
    serialize,
    dump_metadata_lines,
    normalize_imported_frame,
    imported_type_mass_origin,
)


WORK = Path(os.environ.get("PHYNITE_MD_WORK_DIR", "/work")).resolve()
INPUT = WORK / "input.json"
OUTPUT = WORK / "results"
MAX_SOURCE_BYTES = (64 * 1024**3 if os.environ.get("PHYNITE_HEADLESS_JOB") == "1" or os.environ.get("PHYNITE_FUNDING_MODE") in {"paid", "pilot"} else 256 * 1024 * 1024)
MAX_FRAMES = 10_000
MAX_ATOMS_PER_FRAME = analysis_atom_limit()
MAX_ATOM_FRAMES = None if os.environ.get("PHYNITE_FUNDING_MODE") in {"paid", "pilot"} else 50_000_000
MAX_COMPRESSED_FRAME_BYTES = 128 * 1024 * 1024
MAX_TOTAL_OUTPUT_BYTES = (64 if os.environ.get("PHYNITE_FUNDING_MODE") in {"paid", "pilot"} else 8) * 1024**3
MAX_FRAME_SHARD_UNCOMPRESSED_BYTES = 64 * 1024 * 1024
MAX_FRAME_SHARD_FRAMES = 64
MAX_RESULT_ARTIFACTS = 10_000 if os.environ.get("PHYNITE_HEADLESS_JOB") == "1" or os.environ.get("PHYNITE_FUNDING_MODE") in {"paid", "pilot"} else 198
MAX_INPUT_BYTES = 256 * 1024
MAX_BROKER_RESPONSE_BYTES = 512 * 1024
HTTP_TIMEOUT = (10, 120)
SUPPORTED_MODIFIERS = {
    "wrap", "ptm", "cna", "dxa", "rdf", "surface", "expression",
    "slice", "centrosymmetry", "strain", "cluster", "coordination",
    "bonds", "replicate",
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_job(payload: Any, analysis_id: str, source_key: str) -> dict[str, Any]:
    if not isinstance(payload, dict) or payload.get("version") != 1:
        raise ValueError("Unsupported MD analysis job format.")
    if payload.get("analysisId") != analysis_id:
        raise ValueError("Analysis payload does not match the submitted job.")
    source = payload.get("source")
    pipeline = payload.get("pipeline")
    if not isinstance(source, dict) or source.get("objectKey") != source_key:
        raise ValueError("Trajectory source does not match the submitted job.")
    digest = str(source.get("sha256", "")).lower()
    if len(digest) != 64 or any(char not in "0123456789abcdef" for char in digest):
        raise ValueError("Trajectory checksum is invalid.")
    size = source.get("sizeBytes")
    if not isinstance(size, int) or isinstance(size, bool) or size < 1 or size > MAX_SOURCE_BYTES:
        raise ValueError("Trajectory size is outside the supported range.")
    filename = source.get("filename")
    if (
        not isinstance(filename, str)
        or not filename.strip()
        or len(filename) > 255
        or Path(filename).name != filename
        or filename in {".", ".."}
    ):
        raise ValueError("Trajectory filename is invalid.")
    if not isinstance(pipeline, dict) or pipeline.get("version") != 1:
        raise ValueError("Unsupported MD pipeline format.")
    modifiers = pipeline.get("modifiers", [])
    if not isinstance(modifiers, list) or len(modifiers) > 24:
        raise ValueError("An MD pipeline may contain at most 24 modifiers.")
    # Cloud payloads use `type`; the local scientific kernel calls the same field
    # `kind`. Normalize only at this process boundary so both contracts stay clear.
    normalized_modifiers: list[dict[str, Any]] = []
    for item in modifiers:
        if not isinstance(item, dict):
            raise ValueError("MD modifiers must be objects.")
        cloud_type = item.get("type")
        legacy_kind = item.get("kind")
        if cloud_type is not None and legacy_kind is not None and cloud_type != legacy_kind:
            raise ValueError("MD modifier type is ambiguous.")
        kind = cloud_type if cloud_type is not None else legacy_kind
        if kind not in SUPPORTED_MODIFIERS:
            raise ValueError("Unsupported MD modifier type.")
        params = item.get("params", {})
        if not isinstance(params, dict):
            raise ValueError("MD modifier parameters must be an object.")
        params = dict(params)
        if kind == "ptm" and "rmsdCutoff" in params:
            if "rmsd" in params and params["rmsd"] != params["rmsdCutoff"]:
                raise ValueError("PTM cutoff is ambiguous.")
            params["rmsd"] = params.pop("rmsdCutoff")
        if kind == "dxa" and "crystalStructure" in params:
            if "lattice" in params and params["lattice"] != params["crystalStructure"]:
                raise ValueError("DXA lattice is ambiguous.")
            params["lattice"] = params.pop("crystalStructure")
        if kind == "replicate" and any(name in params for name in ("numX", "numY", "numZ")):
            upstream_repeat = [params.pop("numX", 1), params.pop("numY", 1), params.pop("numZ", 1)]
            if "repeat" in params and params["repeat"] != upstream_repeat:
                raise ValueError("Replication counts are ambiguous.")
            params["repeat"] = upstream_repeat
        normalized_modifiers.append(Modifier.model_validate({
            "kind": kind,
            "enabled": item.get("enabled", True),
            "params": params,
        }).model_dump())
    pipeline["modifiers"] = normalized_modifiers
    type_map = pipeline.get("typeMap", {})
    if not isinstance(type_map, dict) or len(type_map) > 256:
        raise ValueError("Particle type mapping is invalid.")
    for source_name, element in type_map.items():
        if not isinstance(source_name, str) or not source_name or len(source_name) > 80:
            raise ValueError("Particle type mapping is invalid.")
        if not isinstance(element, str) or not element.strip() or len(element.strip()) > 8:
            raise ValueError("Particle type mapping is invalid.")
    periodic = pipeline.get("periodic")
    if periodic is not None and (
        not isinstance(periodic, list)
        or len(periodic) != 3
        or any(not isinstance(value, bool) for value in periodic)
    ):
        raise ValueError("Periodic directions must contain three booleans.")
    return payload


def frame_indices(total_frames: int, requested: Any) -> list[int]:
    if total_frames < 1:
        raise ValueError(f"Trajectory must contain 1–{MAX_FRAMES:,} frames.")
    selection = requested if isinstance(requested, dict) else {}
    start = selection.get("start", 0)
    stop = selection.get("stop", total_frames)
    if stop is None:
        stop = total_frames
    stride = selection.get("stride", 1)
    if any(isinstance(value, bool) or not isinstance(value, int) for value in (start, stop, stride)):
        raise ValueError("Frame range values must be integers.")
    if start < 0 or stop < 1 or stop > total_frames or start >= stop or stride < 1 or stride > 10_000:
        raise ValueError("Frame range is outside the trajectory.")
    selection_range = range(start, stop, stride)
    if not selection_range or len(selection_range) > MAX_FRAMES:
        raise ValueError("Frame range is empty or too large.")
    return list(selection_range)


def mapped_frame(raw: dict[str, Any], pipeline: dict[str, Any]) -> Frame:
    mapping = pipeline.get("typeMap") or {}
    periodic = pipeline.get("periodic")
    source_species = raw.get("species") or []
    raw = {
        **raw,
        "species": [str(mapping.get(str(species), species)).strip() for species in source_species],
        "periodic": periodic if periodic is not None else raw.get("periodic"),
    }
    return Frame.model_validate(raw)


def write_json(path: Path, value: Any, *, compress: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
    if compress:
        with gzip.open(path, "wb", compresslevel=6) as handle:
            handle.write(encoded)
    else:
        path.write_bytes(encoded)


def artifact(
    path: Path,
    root: Path,
    label: str,
    role: str,
    content_type: str,
    *,
    encoding: str | None = None,
) -> dict[str, Any]:
    item: dict[str, Any] = {
        "path": path.relative_to(root).as_posix(),
        "label": label,
        "role": role,
        "contentType": content_type,
        "sizeBytes": path.stat().st_size,
        "sha256": sha256_file(path),
    }
    if encoding:
        item["contentEncoding"] = encoding
    return item


def analyze_trajectory(
    source_path: Path,
    payload: dict[str, Any],
    output: Path = OUTPUT,
    progress: Callable[[int, int, int], None] | None = None,
) -> dict[str, Any]:
    output = output.resolve()
    pipeline_settings = payload["pipeline"]
    source_frame_value: dict[str, Any] | None = None
    metadata: list[dict[str, Any]] = []
    type_mass_origin = "element-database"
    if source_path.name.endswith(".phynite-md.json"):
        snapshot_limit = (256 if os.environ.get("PHYNITE_HEADLESS_JOB") == "1" else 64) * 1024**2
        if source_path.stat().st_size > snapshot_limit:
            raise ValueError("Immutable source snapshot exceeds the memory-bounded frame contract")
        source_snapshot = json.loads(source_path.read_text(encoding="utf-8"))
        if not isinstance(source_snapshot, dict) or source_snapshot.get("schemaVersion") != 1 or source_snapshot.get("kind") != "phynite-md-frame" or source_snapshot.get("units") != {"length": "angstrom", "time": "ps"}:
            raise ValueError("Immutable source snapshot schema/physical units are unsupported")
        source_frame_value = source_snapshot.get("frame")
        if not isinstance(source_frame_value, dict):
            raise ValueError("Immutable source snapshot frame is missing")
        imported = None
        total_frames = 1
    else:
        # Inspect headers in a streaming pass; native source files can exceed
        # browser import sizes. Normalize geometry/time before any modifier,
        # and use the same convention for atomic-strain reference frames.
        open_text = gzip.open if source_path.suffix.lower() == ".gz" else open
        with open_text(source_path, "rt", encoding="utf-8", errors="replace") as source:
            prefix = source.read(4096)
            source.seek(0)
            if "ITEM: TIMESTEP" in prefix:
                metadata = dump_metadata_lines(source)
        imported = import_file(str(source_path))
        type_mass_origin = imported_type_mass_origin(imported)
        total_frames = max(1, imported.source.num_frames)
        if metadata and len(metadata) != total_frames:
            raise ValueError("LAMMPS header metadata does not match the imported frame count")

    def load_frame(index: int) -> Frame:
        if source_frame_value is not None:
            raw = dict(source_frame_value)
        else:
            with measured_compute(output.parent):
                collection = imported.compute(index)
            raw = serialize(collection, index=index, native_mass_origin=type_mass_origin)["frame"]
            if metadata:
                raw = normalize_imported_frame(raw, metadata[index])
        return mapped_frame(raw, pipeline_settings)
    requested_range = pipeline_settings.get("frameRange") or {}
    selected = frame_indices(total_frames, requested_range)
    applied_range = {
        "start": requested_range.get("start", 0),
        "stop": requested_range.get("stop") if requested_range.get("stop") is not None else total_frames,
        "stride": requested_range.get("stride", 1),
    }
    reference_cache: dict[int, Frame] = {}
    reference_indices = {
        int(item.get("params", {}).get("referenceFrame", 0))
        for item in pipeline_settings["modifiers"]
        if item.get("enabled", True) and item.get("kind") == "strain"
    }
    if len(reference_indices) > 1:
        raise ValueError("Atomic strain modifiers must use the same reference frame.")
    if any(index < 0 or index >= total_frames for index in reference_indices):
        raise ValueError("Atomic strain reference frame is outside the trajectory.")
    for index in reference_indices:
        reference_cache[index] = load_frame(index)

    timeline: list[dict[str, Any]] = []
    artifacts: list[dict[str, Any]] = []
    atom_frames = 0
    output_bytes = 0
    shard_packets: list[dict[str, Any]] = []
    shard_timeline_positions: list[int] = []
    shard_uncompressed_bytes = 0

    def flush_frame_shard() -> None:
        nonlocal output_bytes, shard_packets, shard_timeline_positions, shard_uncompressed_bytes
        if not shard_packets:
            return
        first_frame = int(shard_packets[0]["result"]["frame"]["index"])
        last_frame = int(shard_packets[-1]["result"]["frame"]["index"])
        packet_path = output / "frames" / f"{first_frame:06d}-{last_frame:06d}.json.gz"
        write_json(packet_path, {
            "version": 1,
            "analysisId": payload["analysisId"],
            "frames": shard_packets,
        }, compress=True)
        if packet_path.stat().st_size > MAX_COMPRESSED_FRAME_BYTES:
            raise ValueError("One analyzed frame shard exceeds the output size limit.")
        output_bytes += packet_path.stat().st_size
        if output_bytes > MAX_TOTAL_OUTPUT_BYTES:
            raise ValueError("Analyzed trajectory exceeds the total output size limit.")
        packet_artifact = artifact(
            packet_path,
            output,
            f"Analyzed frames {first_frame + 1}–{last_frame + 1}",
            "frame-shard",
            "application/json",
            encoding="gzip",
        )
        artifacts.append(packet_artifact)
        for shard_index, timeline_position in enumerate(shard_timeline_positions):
            timeline[timeline_position]["frameShardArtifact"] = packet_artifact["path"]
            timeline[timeline_position]["frameShardIndex"] = shard_index
        shard_packets = []
        shard_timeline_positions = []
        shard_uncompressed_bytes = 0

    for completed, index in enumerate(selected, start=1):
        frame = load_frame(index)
        atom_count = len(frame.ids)
        atom_frames += atom_count
        if atom_count > MAX_ATOMS_PER_FRAME or (MAX_ATOM_FRAMES is not None and atom_frames > MAX_ATOM_FRAMES):
            raise ValueError("Trajectory exceeds the configured MD compute limit.")
        reference_index = next(iter(reference_indices), None)
        request = AnalysisRequest(
            frame=frame,
            reference=reference_cache.get(reference_index) if reference_index is not None else None,
            modifiers=pipeline_settings["modifiers"],
        )
        result = analyze_request(request, measured_compute(output.parent))
        if metadata and metadata[index]["sourceUnits"] is None:
            result["warnings"].append("LAMMPS units are undeclared; geometry assumes angstrom and physical time remains unknown.")
        if type_mass_origin == "source-explicit" and "Mass" in frame.properties and frame.sourceUnits is None and not (frame.propertyUnits or {}).get("mass"):
            result["warnings"].append("LAMMPS data files do not declare physical units. The exact imported masses are retained without an amu label. Before simulation, export a dump including the mass column and use dump_modify units yes in the original solver unit style.")
        packet = {"version": 1, "analysisId": payload["analysisId"], "result": result}
        packet_bytes = len(json.dumps(packet, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8"))
        if shard_packets and (
            len(shard_packets) >= MAX_FRAME_SHARD_FRAMES
            or shard_uncompressed_bytes + packet_bytes > MAX_FRAME_SHARD_UNCOMPRESSED_BYTES
        ):
            flush_frame_shard()
        timeline.append({
            "frame": index,
            "timestep": result["frame"].get("timestep"),
            "time": result["frame"].get("time"),
            "numParticles": len(result["frame"]["ids"]),
            "phases": result.get("phases", []),
            "attributes": result.get("attributes", {}),
            "warnings": result.get("warnings", []),
            "completedFrames": completed,
        })
        shard_packets.append(packet)
        shard_timeline_positions.append(len(timeline) - 1)
        shard_uncompressed_bytes += packet_bytes
        if progress is not None:
            progress(completed, len(selected), index)

    flush_frame_shard()
    if len(artifacts) > MAX_RESULT_ARTIFACTS:
        raise ValueError("Trajectory produced too many result shards. Select fewer frames or a larger stride.")

    timeline_path = output / "timeline.json.gz"
    write_json(timeline_path, {"version": 1, "analysisId": payload["analysisId"], "frames": timeline}, compress=True)
    if timeline_path.stat().st_size > MAX_COMPRESSED_FRAME_BYTES:
        raise ValueError("Trajectory metrics exceed the output artifact size limit.")
    output_bytes += timeline_path.stat().st_size
    if output_bytes > MAX_TOTAL_OUTPUT_BYTES:
        raise ValueError("Analyzed trajectory exceeds the total output size limit.")
    artifacts.insert(0, artifact(
        timeline_path, output, "Trajectory metrics", "timeline", "application/json", encoding="gzip",
    ))
    return {
        "version": 1,
        "analysisId": payload["analysisId"],
        "projectId": payload["projectId"],
        "sourceId": payload["source"]["id"],
        "sourceSha256": payload["source"]["sha256"],
        "status": "completed",
        "syntheticData": False,
        "engine": {"id": ENGINE_ID, "name": ENGINE_NAME, "protocol": 1},
        "frameRange": applied_range,
        "frameCount": len(selected),
        "atomFrames": atom_frames,
        "pipelineFingerprint": payload.get("pipelineFingerprint"),
        "artifacts": artifacts,
    }

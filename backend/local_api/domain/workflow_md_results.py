"""Bounded, checksummed MD result adapters for frames and numerical figures."""
from __future__ import annotations
import gzip
import hashlib
import io
import json
import math
from collections import Counter
from functools import reduce
from backend.local_api.domain.elements import ELEMENT_SYMBOLS
from typing import Any
from backend.local_api.domain.md_results import read_md_result_manifest
from backend.local_api.domain.phynite_core import ApiError, require_owner_item


def artifact_json(services: Any, job: dict[str, Any], manifest: dict[str, Any], path: str) -> tuple[Any, str]:
    artifact = next((item for item in manifest["artifacts"] if item["path"] == path), None)
    if artifact is None:
        raise ApiError(409, "MD artifact is not retained in its manifest.", "MD_RESULT_INCOMPLETE")
    raw = services.s3.get_object(Bucket=services.bucket, Key=f"{job['outputPrefix']}/{path}")["Body"].read(20_000_001)
    if len(raw) > 20_000_000 or hashlib.sha256(raw).hexdigest() != artifact["sha256"]:
        raise ApiError(409, "MD artifact checksum failed or exceeds the inline limit.", "MD_RESULT_INVALID")
    with gzip.GzipFile(fileobj=io.BytesIO(raw)) as stream:
        data = stream.read(32_000_001)
    if len(data) > 32_000_000:
        raise ApiError(413, "MD packet exceeds the inline analysis limit.", "MD_RESULT_TOO_LARGE")
    return json.loads(data), artifact["sha256"]


def analysis_frame(services: Any, job: dict[str, Any], frame_index: int) -> tuple[dict[str, Any], str]:
    manifest = read_md_result_manifest(services, job)
    timeline, _ = artifact_json(services, job, manifest, "timeline.json.gz")
    entry = next((item for item in timeline["frames"] if item["frame"] == frame_index), None)
    if entry is None:
        raise ApiError(409, "Selected frame is not available in this result.", "MD_FRAME_NOT_FOUND")
    path = entry.get("frameShardArtifact") or f"frames/{frame_index:06d}.json.gz"
    packet, checksum = artifact_json(services, job, manifest, path)
    if "frames" in packet:
        packet = packet["frames"][entry["frameShardIndex"]]
    if packet.get("analysisId") != job["id"] or packet.get("result", {}).get("frame", {}).get("index") != frame_index:
        raise ApiError(409, "MD frame identity does not match its source.", "MD_RESULT_INVALID")
    return packet["result"], checksum


def frame_structure(frame: dict[str, Any], configuration: dict[str, Any]) -> dict[str, Any]:
    if configuration.get("coordinateUnit") != "angstrom":
        raise ApiError(422, "Confirm the extracted coordinates are in angstrom.", "MD_FRAME_UNITS_REQUIRED")
    vectors, positions, origin, species = (frame.get(key) for key in ("vectors", "positions", "origin", "species"))
    if not isinstance(vectors, list) or len(vectors) != 3 or any(not isinstance(row, list) or len(row) != 3 for row in vectors) or not isinstance(origin, list) or len(origin) != 3 or not isinstance(species, list) or not species or not isinstance(positions, list) or len(positions) != len(species) * 3:
        raise ApiError(422, "MD frame geometry is incomplete.", "MD_FRAME_INVALID")
    values = [*positions, *origin, *(item for row in vectors for item in row)]
    if any(type(value) not in (int, float) or not math.isfinite(value) for value in values):
        raise ApiError(422, "MD frame coordinates must be finite.", "MD_FRAME_INVALID")
    a, b, c = vectors
    def cross(x, y):
        return [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]]
    def dot(x, y):
        return sum(left * right for left, right in zip(x, y))
    determinant = dot(a, cross(b, c))
    if abs(determinant) < 1e-12:
        raise ApiError(422, "MD frame cell is singular.", "MD_FRAME_INVALID")
    periodic = frame.get("periodic")
    if not isinstance(periodic, list) or len(periodic) != 3 or any(type(item) is not bool for item in periodic) or frame.get("hasCell") is not True:
        raise ApiError(422, "Preserve an explicit cell and periodicity for frame extraction.", "MD_FRAME_INVALID")
    if "periodic" in configuration and configuration["periodic"] != periodic:
        raise ApiError(422, "Confirm periodic axes that match the retained source frame.", "MD_FRAME_PERIODICITY_MISMATCH")
    atoms = []
    element_map = configuration.get("elementMap", {})
    for index, label in enumerate(species):
        element = element_map.get(str(label), label)
        if not isinstance(element, str) or element not in ELEMENT_SYMBOLS:
            raise ApiError(422, "Map every particle type to an explicit element.", "MD_ELEMENT_MAPPING_REQUIRED")
        cart = [positions[index * 3 + axis] - origin[axis] for axis in range(3)]
        fractional = [dot(cart, reciprocal) / determinant for reciprocal in (cross(b, c), cross(c, a), cross(a, b))]
        atoms.append({"id": f"atom_{index}", "species": element, "x": fractional[0], "y": fractional[1], "z": fractional[2]})
    lengths = [math.sqrt(dot(row, row)) for row in vectors]
    def angle(i, j):
        return math.degrees(math.acos(max(-1, min(1, dot(vectors[i], vectors[j]) / lengths[i] / lengths[j]))))
    counts = Counter(atom["species"] for atom in atoms)
    divisor = reduce(math.gcd, counts.values())
    formula = "".join(element + (str(count // divisor) if count // divisor != 1 else "") for element, count in counts.items())
    return {"name": configuration.get("name", f"MD frame {frame.get('index')}"), "formula": formula, "atoms": atoms, "lattice": {"a": lengths[0], "b": lengths[1], "c": lengths[2], "alpha": angle(1, 2), "beta": angle(0, 2), "gamma": angle(0, 1), "vectors": vectors}, "periodic": periodic, "source": "workflow-md-frame", "provenance": {"frame": frame.get("index"), "timestep": frame.get("timestep"), "timePs": frame.get("time"), "coordinateUnit": "angstrom", "periodic": periodic}}


def numerical_datasets(services: Any, owner: str, project: str, job_id: str) -> list[dict[str, Any]]:
    job = require_owner_item(services, owner, "MD_ANALYSIS", job_id, "MD_ANALYSIS_NOT_FOUND")
    if job.get("projectId") != project or job.get("status") != "COMPLETED":
        raise ApiError(409, "Choose a completed MD analysis in this project.", "MD_RESULT_INVALID")
    manifest = read_md_result_manifest(services, job)
    timeline, checksum = artifact_json(services, job, manifest, "timeline.json.gz")
    entries = timeline["frames"]
    timed = all(type(item.get("time")) in (int, float) and math.isfinite(item["time"]) for item in entries)
    x = lambda entry: entry["time"] if timed else entry["frame"]
    datasets = [{"name": "Particle count", "xLabel": "Time (ps)" if timed else "Frame index", "yLabel": "Particles (count)", "points": [[x(item), item["numParticles"]] for item in entries], "sha256": checksum, "filename": "timeline.json.gz", "units": {"x": "ps" if timed else "frame", "y": "count"}}]
    if entries:
        first, packet_sha = analysis_frame(services, job, entries[0]["frame"])
        if first.get("rdf"):
            if first["frame"].get("sourceUnits") is None:
                raise ApiError(422, "RDF length units are undeclared in this source. Declare source units before using a physical-length figure.", "MD_FIGURE_UNITS_REQUIRED")
            datasets.append({"name": f"RDF / frame {entries[0]['frame']}", "xLabel": "Distance (Å)", "yLabel": "g(r) (dimensionless)", "points": first["rdf"], "sha256": packet_sha, "filename": "rdf-frame.json", "units": {"x": "angstrom", "y": "dimensionless"}})
    for dataset in datasets:
        dataset["provenance"] = {"analysisId": job_id, "sourceId": job["trajectoryId"], "sourceSha256": job["sourceSha256"], "pipelineFingerprint": job["pipelineFingerprint"], "syntheticData": False}
    return datasets

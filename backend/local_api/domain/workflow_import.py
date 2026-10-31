"""Stage private input copies, then atomically publish the graph and metadata."""
from __future__ import annotations
import copy
import hashlib
import math
import re
import uuid
from typing import Any
from backend.local_api.domain.phynite_core import ApiError, owner_partition, require_project, storage_owner, utc_now
from backend.local_api.domain.project_workflow import ProjectWorkflowApi, RESOURCE_KINDS, digest, fail, validate_graph


def import_workflow(api: ProjectWorkflowApi, owner: str, destination: str, payload: dict[str, Any]) -> dict[str, Any]:
    source = payload.get("sourceProjectId")
    require_project(api.services, owner, destination)
    require_project(api.services, owner, source)
    key = payload.get("idempotencyKey")
    if not isinstance(key, str) or not re.fullmatch(r"[A-Za-z0-9_-]{16,96}", key) or source == destination:
        fail("Cross-project import requires a new destination and stable request key.")
    request_hash = digest(payload)
    import_id = "import_" + hashlib.sha256(f"{destination}:{key}".encode()).hexdigest()[:40]
    previous = api.services.get_item(owner, "WORKFLOW_IMPORT", import_id)
    if previous:
        if previous["requestFingerprint"] != request_hash:
            fail("Import key already identifies another selection.", "IDEMPOTENCY_CONFLICT", 409)
        return {"workflow": api.read_json(previous["objectKey"], previous["sha256"]), "revision": int(previous["revision"]), **({"imported": previous["imported"]} if "imported" in previous else {})}
    original, target = api.load(owner, source), api.load(owner, destination)
    snapshot = payload.get("clipboard")
    if payload.get("baseRevision") != target["revision"]:
        fail("Synchronize the destination before pasting.", "WORKFLOW_CONFLICT", 409)
    if snapshot is not None:
        if not isinstance(snapshot, dict) or snapshot.get("version") != 2 or snapshot.get("projectId") != source or type(snapshot.get("revision")) is not int or snapshot["revision"] < 0:
            fail("Invalid clipboard snapshot.")
        original_graph = validate_graph({"version": 1, "projectId": source, "nodes": snapshot.get("nodes"), "edges": snapshot.get("edges"), "groups": snapshot.get("groups")}, source)
        if not original_graph["nodes"]:
            fail("Select modules to import.")
        selected = copy.deepcopy(original_graph["nodes"])
    else:
        if payload.get("sourceRevision") != original["revision"] or original["revision"] < 1:
            fail("Both projects must be synchronized at the selected revisions.", "WORKFLOW_CONFLICT", 409)
        node_ids = payload.get("nodeIds")
        if not isinstance(node_ids, list) or not node_ids or len(node_ids) > 1000 or any(not isinstance(item, str) for item in node_ids) or len(set(node_ids)) != len(node_ids):
            fail("Select modules to import.")
        selected = copy.deepcopy([node for node in original["workflow"]["nodes"] if node["id"] in node_ids])
        if len(selected) != len(node_ids):
            fail("An imported module no longer exists.", "WORKFLOW_CONFLICT", 409)
        original_graph = original["workflow"]
    point = payload.get("point")
    if point is not None and (not isinstance(point, dict) or set(point) != {"x", "y"} or any(type(point[axis]) not in {int, float} or not math.isfinite(point[axis]) or abs(point[axis]) > 1_000_000 for axis in ("x", "y"))):
        fail("Paste position is invalid.")
    offset = {"x": point["x"] - min(node["position"]["x"] for node in selected), "y": point["y"] - min(node["position"]["y"] for node in selected)} if point else {"x": 40, "y": 40}
    for node in selected:
        for component in node["configuration"].get("components", []):
            asset_id = component.get("config", {}).get("potentialAssetId")
            if asset_id and not any(ref["kind"] == "potential" and ref["id"] == asset_id for ref in node["resources"]):
                node["resources"].append({"kind": "potential", "id": asset_id})
    api.resources(owner, {**original_graph, "nodes": selected}, execution=True)
    resources = {(ref["kind"], ref["id"]) for node in selected for ref in node["resources"]}
    if len(resources) > 80:
        fail("Import up to 80 input assets at once.", "WORKFLOW_IMPORT_LIMIT", 413)
    now = utc_now()
    mapping = {node["id"]: "node_" + digest([import_id, node["id"]])[:32] for node in selected}
    groups = [group for group in original_graph["groups"] if all(item in mapping for item in group["nodeIds"])]
    group_mapping = {group["id"]: "group_" + digest([import_id, group["id"]])[:32] for group in groups}
    edges = [edge for edge in original_graph["edges"] if edge["source"] in mapping and edge["target"] in mapping]
    edge_mapping = {edge["id"]: "edge_" + digest([import_id, edge["id"]])[:32] for edge in edges}
    imported = {"nodes": mapping, "edges": edge_mapping, "groups": group_mapping}
    resource_mapping: dict[str, str] = {}
    metadata: list[dict[str, Any]] = []
    staged: list[str] = []
    staging_id = uuid.uuid4().hex
    try:
        for kind, resource_id in sorted(resources):
            record = api.services.get_item(owner, RESOURCE_KINDS[kind], resource_id)
            if not record or record.get("projectId") != source:
                fail("Source asset is unavailable.", "WORKFLOW_RESOURCE_NOT_FOUND", 404)
            new_id = {"structure": "str_", "trajectory": "mdt_", "potential": "mdp_"}[kind] + digest([import_id, kind, resource_id])[:32]
            resource_mapping[resource_id] = new_id
            cloned = copy.deepcopy(record)
            for field in ("sourceSimulationId", "sourceAnalysisId", "resultTrajectoryId", "runtimeValidatedSimulationId", "runtimeValidatedAt", "revision"):
                cloned.pop(field, None)
            cloned.update(PK=owner_partition(owner), SK=RESOURCE_KINDS[kind] + "#" + new_id, id=new_id, projectId=destination, createdAt=now, updatedAt=now, GSI1PK="PROJECT#" + destination, GSI1SK=f"{RESOURCE_KINDS[kind]}#{now}#{new_id}")
            # All bytes are verified before any destination metadata is visible.
            files = cloned.get("files") if kind == "potential" else [cloned]
            for index, file in enumerate(files or []):
                object_key = file.get("objectKey")
                if not isinstance(object_key, str) or not object_key.startswith(f"users/{storage_owner(owner)}/projects/{source}/"):
                    fail("Source bytes are outside this project.", "PROJECT_MISMATCH", 409)
                body = api.services.s3.get_object(Bucket=api.services.bucket, Key=object_key)["Body"]
                # Bounded import keeps Lambda memory/timeout predictable. Large
                # source assets retain the existing explicit upload workflow.
                raw = body.read(128 * 1024**2 + 1)
                if len(raw) > 128 * 1024**2:
                    fail("Import assets up to 128 MB per file. Save larger inputs in the destination first.", "WORKFLOW_IMPORT_LIMIT", 413)
                checksum = hashlib.sha256(raw).hexdigest()
                if file.get("sha256") and file["sha256"] != checksum:
                    fail("Source asset checksum failed.", "WORKFLOW_RESOURCE_CHANGED", 409)
                new_key = f"users/{storage_owner(owner)}/projects/{destination}/workflow/imports/{import_id}/{staging_id}/{new_id}/{index}"
                api.services.s3.put_object(Bucket=api.services.bucket, Key=new_key, Body=raw, ContentType=file.get("contentType", "application/octet-stream"), ServerSideEncryption="AES256")
                staged.append(new_key)
                file["objectKey"] = new_key
                file["sha256"] = checksum
            metadata.append(cloned)
        def remap(value: Any) -> Any:
            if isinstance(value, list):
                return [remap(item) for item in value]
            if isinstance(value, dict):
                return {key: resource_mapping.get(item, item) if key in {"structureId", "trajectoryId", "assetId", "potentialAssetId", "materialId"} and isinstance(item, str) else remap(item) for key, item in value.items() if key not in {"preservedHistory", "preservedJobId", "preservedJobKind", "preservedFigureId", "binding", "result", "sourceAttemptId", "sharedScf"}}
            return value
        nodes = []
        for node in selected:
            cloned = copy.deepcopy(node)
            cloned.update(id=mapping[node["id"]], position={"x": node["position"]["x"] + offset["x"], "y": node["position"]["y"] + offset["y"]}, configuration=remap(node["configuration"]))
            if cloned.get("groupId") in group_mapping:
                cloned["groupId"] = group_mapping[cloned["groupId"]]
            else:
                cloned.pop("groupId", None)
            cloned.pop("legacy", None)
            configuration = cloned["configuration"]
            for field in ("legacySource", "preservedHistory", "savedStructureSignature", "configurationError"):
                configuration.pop(field, None)
            if cloned["kind"] in {"scf", "relax", "bands", "dos", "phonon", "btp2", "md"}:
                configuration.pop("execution", None)
            if cloned["kind"] == "md-analysis" and isinstance(configuration.get("execution"), dict):
                configuration["execution"] = {key: value for key, value in configuration["execution"].items() if key in {"pipeline", "name", "computeTarget"}}
            # User-provided UPFs are immutable inputs too; no live source-project path remains.
            for filename, source_key in list(configuration.get("pseudopotentials", {}).items()):
                if not isinstance(source_key, str) or not source_key.startswith(f"users/{storage_owner(owner)}/"):
                    fail("Pseudopotential does not belong to this owner.", "PROJECT_MISMATCH", 409)
                raw = api.services.s3.get_object(Bucket=api.services.bucket, Key=source_key)["Body"].read(32_000_001)
                if len(raw) > 32_000_000:
                    fail("Pseudopotential exceeds the import limit.", "WORKFLOW_IMPORT_LIMIT", 413)
                checksum = hashlib.sha256(raw).hexdigest()
                expected = configuration.get("pseudopotentialChecksums", {}).get(filename)
                if expected and expected != checksum:
                    fail("Pseudopotential checksum failed.", "WORKFLOW_RESOURCE_CHANGED", 409)
                new_key = f"users/{storage_owner(owner)}/projects/{destination}/workflow/imports/{import_id}/{staging_id}/upf/{checksum}.UPF"
                api.services.s3.put_object(Bucket=api.services.bucket, Key=new_key, Body=raw, ServerSideEncryption="AES256")
                staged.append(new_key)
                configuration["pseudopotentials"][filename] = new_key
                configuration.setdefault("pseudopotentialChecksums", {})[filename] = checksum
            if cloned["kind"] == "figure":
                cloned["configuration"] = {"style": cloned["configuration"].get("style", {})}
            cloned["resources"] = [{**ref, "id": resource_mapping[ref["id"]]} for ref in node["resources"]]
            nodes.append(cloned)
        graph = copy.deepcopy(target["workflow"])
        graph["nodes"].extend(nodes)
        graph["edges"].extend({**edge, "id": edge_mapping[edge["id"]], "source": mapping[edge["source"]], "target": mapping[edge["target"]]} for edge in edges)
        graph["groups"].extend({**group, "id": group_mapping[group["id"]], "nodeIds": [mapping[item] for item in group["nodeIds"]]} for group in groups)
        graph = validate_graph(graph, destination)
        object_key, checksum = api.write_json(owner, destination, "revisions", graph)
        workflow_item = {"PK": owner_partition(owner), "SK": "PROJECT_WORKFLOW#" + destination, "GSI1PK": "PROJECT#" + destination, "GSI1SK": "PROJECT_WORKFLOW#" + now, "entityType": "PROJECT_WORKFLOW", "ownerId": owner, "id": destination, "projectId": destination, "objectKey": object_key, "sha256": checksum, "revision": target["revision"] + 1, "createdAt": now, "updatedAt": now}
        receipt = {"PK": owner_partition(owner), "SK": "WORKFLOW_IMPORT#" + import_id, "GSI1PK": "PROJECT#" + destination, "GSI1SK": "WORKFLOW_IMPORT#" + now, "entityType": "WORKFLOW_IMPORT", "ownerId": owner, "id": import_id, "projectId": destination, "requestFingerprint": request_hash, "imported": imported, "objectKey": object_key, "sha256": checksum, "revision": target["revision"] + 1, "createdAt": now}
        if not api.services.save_workflow_import(owner, source, None if snapshot is not None else original["revision"], destination, target["revision"], workflow_item, metadata, receipt):
            fail("A project changed during import. No modules were installed. Retry after synchronizing.", "WORKFLOW_CONFLICT", 409)
        staged.clear()
        return {"workflow": graph, "revision": target["revision"] + 1, "imported": imported}
    finally:
        for object_key in staged:
            api.services.s3.delete_object(Bucket=api.services.bucket, Key=object_key)

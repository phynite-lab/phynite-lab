"""Owner-scoped, versioned research documents; numerical data lives in S3."""
from __future__ import annotations

import hashlib
import json
import math
import re
from typing import Any

from backend.local_api.domain.phynite_core import ApiError, owner_partition, public_item, response, storage_owner, utc_now

DOCUMENT_PATH = re.compile(r"^/v1/research/(datasets|figures|templates)(?:/([A-Za-z0-9_-]{1,100}))?$")
MAX_DOCUMENT_BYTES = 4_000_000
KINDS = {"datasets": "DATASET", "figures": "FIGURE", "templates": "FIGURE_TEMPLATE"}


def number(value: Any) -> bool:
    return not isinstance(value, bool) and isinstance(value, (float, int)) and math.isfinite(value)


def identifier(value: Any) -> bool:
    return isinstance(value, str) and bool(re.fullmatch(r"[A-Za-z0-9_-]{1,100}", value))


def text_value(value: Any, maximum: int = 200) -> bool:
    return isinstance(value, str) and len(value) <= maximum


def require(valid: bool, message: str) -> None:
    if not valid:
        raise ApiError(400, message, "INVALID_RESEARCH_DOCUMENT")


def validate_document(collection: str, document: Any, item_id: str) -> bytes:
    if not isinstance(document, dict) or document.get("schemaVersion") != 1 or document.get("id") != item_id:
        raise ApiError(400, "Research document identity or schema is invalid.", "INVALID_RESEARCH_DOCUMENT")
    for field in ("projectId", "name"):
        if not isinstance(document.get(field), str) or not 1 <= len(document[field].strip()) <= 200:
            raise ApiError(400, f"Research {field} is required (maximum 200 characters).", "INVALID_RESEARCH_DOCUMENT")
    try:
        encoded = json.dumps(document, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()
    except (TypeError, ValueError, RecursionError) as exc:
        raise ApiError(400, "Research data must contain valid finite JSON values.", "INVALID_RESEARCH_DOCUMENT") from exc
    if len(encoded) > MAX_DOCUMENT_BYTES:
        raise ApiError(413, "One research document may contain up to 4 MB. Split large datasets into files.", "RESEARCH_TOO_LARGE")
    if collection == "datasets":
        require(identifier(document.get("projectId")), "Dataset project identity is invalid.")
        source, metadata = document.get("source"), document.get("metadata")
        require(isinstance(source, dict) and isinstance(metadata, dict), "Dataset source and metadata are required.")
        require(text_value(source.get("filename"), 1000) and text_value(source.get("parserVersion")) and bool(re.fullmatch(r"[a-f0-9]{64}", str(source.get("sha256", "")))), "Dataset source identity is invalid.")
        if "text" in source:
            require(isinstance(source["text"], str) and hashlib.sha256(source["text"].encode()).hexdigest() == source["sha256"], "Dataset source checksum does not match.")
        energy = metadata.get("energy")
        require(isinstance(energy, dict) and energy.get("kind") in {"fermi", "source", "unknown"}, "Dataset energy convention is required.")
        require(all(number(energy[key]) for key in ("fermiEv", "vbmEv", "vacuumEv") if key in energy), "Energy references must be finite.")
        require(all(number(metadata[key]) and metadata[key] > 0 for key in ("atomCount", "formulaUnits", "volumeAngstrom3") if key in metadata), "DOS normalization factors must be positive.")
        condition = metadata.get("condition")
        if condition is not None:
            require(isinstance(condition, dict) and text_value(condition.get("parameter")) and text_value(condition.get("unit")) and number(condition.get("value")), "Parameter metadata is invalid.")
        data = document.get("data")
        if not isinstance(data, dict) or data.get("kind") not in {"band", "dos", "phonon", "thermoelectric", "generic"}:
            raise ApiError(400, "Dataset needs supported numerical plot data.", "INVALID_DATASET")
        quantities = data.get("quantities")
        if not isinstance(quantities, list) or not 1 <= len(quantities) <= 32:
            raise ApiError(400, "Dataset quantities are invalid.", "INVALID_DATASET")
        orbital = metadata.get("orbitalProjection")
        if orbital is not None:
            require(isinstance(orbital,dict) and data.get("kind")=="band" and orbital.get("basis")=="orthogonalized-atomic-global-axes" and isinstance(orbital.get("sourceSha256"),str) and re.fullmatch(r"[a-f0-9]{64}",orbital["sourceSha256"]) is not None,"Orbital projection source and basis are invalid.")
            channels=orbital.get("channels")
            require(isinstance(channels,list) and 1<=len(channels)<=4096,"Orbital channels are invalid.")
            channel_ids=set()
            for channel in channels:
                require(isinstance(channel,dict) and isinstance(channel.get("id"),str) and re.fullmatch(r"\d+",channel["id"]) is not None and channel["id"] not in channel_ids and type(channel.get("atom")) is int and channel["atom"]>0 and type(channel.get("wfc")) is int and channel["wfc"]>0 and type(channel.get("l")) is int and 0<=channel["l"]<=6 and text_value(channel.get("species")) and text_value(channel.get("orbital")) and text_value(channel.get("label")),"Atomic projection identities are invalid.")
                channel_ids.add(channel["id"])
        total = 0
        quantity_ids = set()
        for quantity in quantities:
            series = quantity.get("series") if isinstance(quantity, dict) else None
            if not isinstance(series, list) or not 1 <= len(series) <= 2000:
                raise ApiError(400, "Dataset series are invalid.", "INVALID_DATASET")
            require(text_value(quantity.get("id")) and quantity["id"] not in quantity_ids and text_value(quantity.get("label")) and text_value(quantity.get("yLabel")), "Quantity identities and labels are invalid.")
            quantity_ids.add(quantity["id"])
            curve_ids = set()
            for curve in series:
                points = curve.get("points") if isinstance(curve, dict) else None
                if not isinstance(points, list) or not points:
                    raise ApiError(400, "Dataset curves need numerical points.", "INVALID_DATASET")
                require(text_value(curve.get("id")) and curve["id"] not in curve_ids and text_value(curve.get("label")), "Curve identities and labels are invalid.")
                curve_ids.add(curve["id"])
                for point in points:
                    if not isinstance(point, list) or len(point) != 2 or any(value is not None and (isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value)) for value in point):
                        raise ApiError(400, "Dataset point must have two numbers or explicit gaps.", "INVALID_DATASET")
                require(any(all(number(value) for value in point) for point in points), "A curve needs at least one finite sample.")
                if "weights" in curve:
                    require(isinstance(curve["weights"], list) and len(curve["weights"]) == len(points) and all(number(weight) and weight >= 0 for weight in curve["weights"]), "Spectral weights must be nonnegative and match source points.")
                projections=curve.get("projections")
                if orbital is not None: require(isinstance(projections,dict) and set(projections)==channel_ids,"Every band needs every atomic projector.")
                if projections is not None: require(isinstance(projections,dict) and all(isinstance(key,str) and re.fullmatch(r"\d+",key) and isinstance(weights,list) and len(weights)==len(points) and all(number(w) and 0<=w<=1.00001 for w in weights) for key,weights in projections.items()),"Projection weights must be finite probabilities matching all source samples.")
                total += len(points)
        if total > 250_000:
            raise ApiError(413, "Split datasets larger than 250,000 points.", "RESEARCH_TOO_LARGE")
        path = metadata.get("path")
        if path is not None:
            require(isinstance(path, dict), "Path metadata must be an object.")
            samples = min(len(curve["points"]) for quantity in quantities for curve in quantity["series"])
            for key in ("tickIndices", "breakIndices"):
                if key in path:
                    indices = path[key]
                    require(isinstance(indices, list) and len(indices) <= 1000 and all(type(index) is int and 0 <= index < samples and (position == 0 or index > indices[position - 1]) for position, index in enumerate(indices)), "Path indices must increase and refer to source samples.")
            if "labels" in path:
                require(isinstance(path["labels"], list) and len(path["labels"]) == len(path.get("tickIndices", [])) and all(text_value(label, 50) for label in path["labels"]), "Path labels need matching sample indices.")
            if "segments" in path:
                require(isinstance(path["segments"], list) and len(path["segments"]) <= 1000 and all(isinstance(segment, list) and len(segment) == 2 and all(text_value(label, 50) for label in segment) for segment in path["segments"]), "Path segments need endpoint label pairs.")
            if "cellAngstrom" in path:
                require(isinstance(path["cellAngstrom"], list) and len(path["cellAngstrom"]) == 3 and all(isinstance(row, list) and len(row) == 3 and all(number(value) for value in row) for row in path["cellAngstrom"]), "Path direct cell must be a finite 3 by 3 matrix.")
            if "pointCoords" in path:
                require(isinstance(path["pointCoords"], dict) and all(isinstance(point, list) and len(point) == 3 and all(number(value) for value in point) for point in path["pointCoords"].values()), "Symmetry point coordinates must have three finite values.")
    else:
        require(identifier(document.get("projectId")), "Figure project identity is invalid.")
        require(number(document.get("widthMm")) and 50 <= document["widthMm"] <= 500 and number(document.get("heightMm")) and 50 <= document["heightMm"] <= 700, "Figure physical dimensions are invalid.")
        require(type(document.get("columns")) is int and 1 <= document["columns"] <= 6, "Figure columns are invalid.")
        require(number(document.get("fontPt")) and 5 <= document["fontPt"] <= 24 and number(document.get("lineWidthPt")) and .1 <= document["lineWidthPt"] <= 4 and document.get("fontFamily") in {"sans", "serif", "mono"} and text_value(document.get("caption"), 10000), "Figure style is invalid.")
        require(document.get("resultStyleVersion") in {None, 1}, "Figure result style version is invalid.")
        panels = document.get("panels")
        if not isinstance(panels, list) or not 1 <= len(panels) <= 64:
            raise ApiError(400, "A figure needs 1 to 64 panels.", "INVALID_FIGURE")
        ids = set()
        for panel in panels:
            if not isinstance(panel, dict) or not isinstance(panel.get("layers"), list) or not 1 <= len(panel["layers"]) <= 32:
                raise ApiError(400, "Figure panel layers are invalid.", "INVALID_FIGURE")
            require(identifier(panel.get("id")) and panel["id"] not in ids and text_value(panel.get("title")) and text_value(panel.get("energyGroup"), 100) and type(panel.get("span")) is int and 1 <= panel["span"] <= 6, "Panel identity or layout is invalid.")
            ids.add(panel["id"])
            require(all(panel.get(key) is None or number(panel[key]) for key in ("xMin", "xMax", "yMin", "yMax")), "Panel limits must be finite.")
            require(all(panel.get(key) is None or number(panel[key]) for key in ("xReference", "yReference")), "Panel references must be finite.")
            require(all(key not in panel or text_value(panel[key]) for key in ("xLabel", "yLabel", "referenceLabel")), "Panel labels are invalid.")
            require(all(key not in panel or type(panel[key]) is bool for key in ("showXZero", "showYZero", "showFrame")), "Panel reference visibility is invalid.")
            require(panel.get("pairingGroup") is None or identifier(panel["pairingGroup"]), "Band + DOS pairing identity is invalid.")
            for layer in panel["layers"]:
                require(isinstance(layer, dict) and identifier(layer.get("id")) and layer["id"] not in ids, "Result binding identity is invalid.")
                ids.add(layer["id"])
                require(text_value(layer.get("label")) and text_value(layer.get("quantityId")) and bool(re.fullmatch(r"#[a-fA-F0-9]{6}", str(layer.get("color", "")))), "Result labels or color are invalid.")
                require(layer.get("lineStyle") in {"solid", "dash", "dot", "dashdot"} and layer.get("energy") in {"source", "fermi", "vbm", "vacuum", "manual"} and layer.get("normalization") in {"source", "atom", "formula", "volume"} and number(layer.get("shiftEv")), "Result transformation is invalid.")
                require(all(type(layer.get(key)) is bool for key in ("visible", "energyVertical", "mirrorSpin", "normalizedPath")), "Result visibility or axes are invalid.")
                if "projectionIds" in layer: require(isinstance(layer["projectionIds"],list) and len(layer["projectionIds"])==len(set(layer["projectionIds"])) and all(isinstance(v,str) and re.fullmatch(r"\d+",v) for v in layer["projectionIds"]),"Orbital selection is invalid.")
                require(layer.get("seriesIds") is None or isinstance(layer["seriesIds"], list) and all(text_value(value) for value in layer["seriesIds"]), "Channel selection is invalid.")
                if "channelStyles" in layer:
                    styles = layer["channelStyles"]
                    require(isinstance(styles, dict) and all(isinstance(style, dict) and ("color" not in style or bool(re.fullmatch(r"#[a-fA-F0-9]{6}", str(style["color"])))) and ("label" not in style or text_value(style["label"])) and ("lineStyle" not in style or style["lineStyle"] in {"solid", "dash", "dot", "dashdot"}) for style in styles.values()), "Individual channel style is invalid.")
            if panel.get("inset"):
                inset = panel["inset"]
                require(isinstance(inset, dict) and all(number(inset.get(key)) for key in ("x", "y", "width", "height")), "Inset dimensions are invalid.")
                require(inset["x"] >= 0 and inset["y"] >= 0 and inset["width"] >= .2 and inset["height"] >= .2 and inset["x"] + inset["width"] <= 1 and inset["y"] + inset["height"] <= 1 and any(parent.get("id") == inset.get("parentId") and not parent.get("inset") for parent in panels), "Inset must fit in an existing parent panel.")
        if collection == "templates":
            slots = document.get("slots")
            require(isinstance(slots, list) and len(slots) == sum(len(panel["layers"]) for panel in panels) and all(isinstance(slot, dict) and any(panel["id"] == slot.get("panelId") and any(layer["id"] == slot.get("layerId") for layer in panel["layers"]) for panel in panels) for slot in slots), "Template slots are invalid.")
            require(len({slot["layerId"] for slot in slots}) == len(slots) and all(slot.get("kind") in {"band", "dos", "phonon", "thermoelectric", "generic"} and ("sourceIndex" not in slot or type(slot["sourceIndex"]) is int and 0 <= slot["sourceIndex"] < len(slots)) for slot in slots), "Template source slots are invalid.")
    return encoded


class ResearchDocuments:
    def __init__(self, services: Any):
        self.services = services

    def retain(self, key: str) -> None:
        self.services.s3.put_object_tagging(Bucket=self.services.bucket, Key=key, Tagging={"TagSet": [{"Key": "phynite-retention", "Value": "research-data"}]})

    def handle(self, user_id: str, method: str, collection: str, item_id: str | None, params: dict, payload: dict) -> dict:
        kind = KINDS[collection]
        if item_id is None:
            if method != "GET":
                raise ApiError(405, "Select a document to save.", "METHOD_NOT_ALLOWED")
            items = self.services.list_owner_items(user_id, kind)
            if params.get("projectId"):
                items = [item for item in items if item.get("projectId") == params["projectId"]]
            return response(200, {"items": [{key: item[key] for key in ("id", "projectId", "name", "revision", "sizeBytes", "updatedAt", "archived") if key in item} for item in items]})
        current = self.services.get_item(user_id, kind, item_id)
        if method == "GET":
            if not current:
                raise ApiError(404, "Research document was not found.", "RESEARCH_NOT_FOUND")
            requested = str(params.get("revision") or current["revision"])
            revision = next((entry for entry in current["history"] if str(entry["revision"]) == requested), None)
            if not revision:
                raise ApiError(404, "Research revision was not found.", "RESEARCH_NOT_FOUND")
            for attempt in range(3):
                try:
                    raw = self.services.s3.get_object(Bucket=self.services.bucket, Key=revision["objectKey"])["Body"].read(MAX_DOCUMENT_BYTES + 1)
                    break
                except Exception:
                    latest = self.services.get_item(user_id, kind, item_id)
                    if params.get("revision") or not latest or latest["revision"] == current["revision"]:
                        raise
                    if attempt == 2:
                        raise ApiError(409, "The figure is being updated. Try opening it again.", "RESEARCH_CONFLICT")
                    current = latest
                    revision = current["history"][-1]
            if len(raw) > MAX_DOCUMENT_BYTES or hashlib.sha256(raw).hexdigest() != revision["sha256"]:
                raise ApiError(409, "Stored research checksum does not match.", "RESEARCH_INTEGRITY")
            return response(200, {"document": json.loads(raw), "revision": revision["revision"], "metadata": public_item(current)})
        if method == "DELETE":
            if collection != "figures":
                raise ApiError(405, "Only figures can be permanently deleted. Source datasets remain retained for reproducibility.", "METHOD_NOT_ALLOWED")
            if not current:
                raise ApiError(404, "Research document was not found.", "RESEARCH_NOT_FOUND")
            if not self.services.delete_research_metadata(user_id, current):
                raise ApiError(409, "This figure changed elsewhere. Reload before deleting it.", "RESEARCH_CONFLICT")
            keys = [{"Key": entry["objectKey"]} for entry in current.get("history", []) if entry.get("objectKey")]
            if keys:
                try:
                    self.services.s3.delete_objects(Bucket=self.services.bucket, Delete={"Objects": keys})
                except Exception:
                    # The metadata transaction is authoritative. Stale object cleanup can
                    # be retried without making a completed user deletion appear to fail.
                    pass
            return response(200, {"deleted": True, "figureId": item_id})
        if method != "PUT":
            raise ApiError(405, "Research revisions are retained. Archive a figure in its document instead.", "METHOD_NOT_ALLOWED")
        document = payload.get("document")
        encoded = validate_document(collection, document, item_id)
        digest = hashlib.sha256(encoded).hexdigest()
        base = payload.get("baseRevision")
        if isinstance(base, bool) or not isinstance(base, int) or base < 0:
            raise ApiError(400, "baseRevision must be a nonnegative integer.", "INVALID_REVISION")
        autosave = payload.get("autosave", False)
        require(type(autosave) is bool and (not autosave or collection == "figures"), "Autosave is only supported for figures.")
        previous_auto = current["history"][-1] if current and current["history"][-1].get("autosave") else None
        actual = int(current["revision"]) if current else 0
        # Retrying the exact successful write is safe, including immutable datasets.
        if current and current["sha256"] == digest and (autosave or not previous_auto):
            self.retain(current["history"][-1]["objectKey"])
            return response(200, {"revision": actual, "metadata": public_item(current)})
        if current and (collection == "datasets" or current["projectId"] != document["projectId"]):
            raise ApiError(409, "Create a new dataset revision or copy to another project.", "IMMUTABLE_RESEARCH")
        if actual != base:
            raise ApiError(409, "This figure changed elsewhere. Reload or save a copy.", "RESEARCH_CONFLICT")
        if collection == "figures":
            for panel in document["panels"]:
                for layer in panel["layers"]:
                    dataset_id = layer.get("datasetId") if isinstance(layer, dict) else None
                    if not isinstance(dataset_id, str) or not self.services.get_item(user_id, "DATASET", dataset_id):
                        raise ApiError(400, "Save every source dataset before saving the figure.", "DATASET_NOT_SAVED")
        if collection == "templates" and any(layer.get("datasetId") for panel in document["panels"] for layer in panel["layers"]):
            raise ApiError(400, "Templates must not retain dataset bindings.", "INVALID_TEMPLATE")
        history = list(current.get("history", [])) if current else []
        # Keep one replaceable autosave after the explicit revision checkpoints.
        if previous_auto:
            history.pop()
        if not autosave and len(history) >= 100:
            raise ApiError(413, "This figure has 100 saved revisions. Duplicate it to continue; history is retained.", "RESEARCH_REVISION_LIMIT")
        replaced_bytes = int(current["sizeBytes"]) if previous_auto else 0
        added_bytes = len(encoded) - replaced_bytes
        used = sum(int(item.get("retainedBytes", item.get("sizeBytes", 0))) for entity in KINDS.values() for item in self.services.list_owner_items(user_id, entity))
        from backend.local_api.domain.storage_quota import storage_limit
        byte_limit = storage_limit(self.services, user_id)
        if used + added_bytes > byte_limit:
            raise ApiError(413, "Research storage exceeds your account allowance.", "RESEARCH_QUOTA")
        revision = actual + 1
        timestamp = utc_now()
        key = f"users/{storage_owner(user_id)}/research/{collection}/{item_id}/{revision}-{digest}.json"
        # A write that loses the metadata race remains a short-lived orphan.
        self.services.s3.put_object(Bucket=self.services.bucket, Key=key, Body=encoded, ContentType="application/json", ServerSideEncryption="AES256", Tagging="phynite-retention=calculation-output")
        history.append({"revision": revision, "objectKey": key, "sha256": digest, "savedAt": timestamp, **({"autosave": True} if autosave else {})})
        metadata = {"PK": owner_partition(user_id), "SK": f"{kind}#{item_id}", "entityType": kind, "ownerId": user_id, "id": item_id, "projectId": document["projectId"], "name": document["name"], "revision": revision, "sizeBytes": len(encoded), "retainedBytes": int(current.get("retainedBytes", 0)) + added_bytes if current else len(encoded), "sha256": digest, "updatedAt": timestamp, "history": history, "archived": bool(document.get("archived"))}
        if not self.services.save_research_metadata(user_id, metadata, base, byte_limit, added_bytes=added_bytes):
            latest = self.services.get_item(user_id, kind, item_id)
            if latest and latest["sha256"] == digest and (autosave or not latest["history"][-1].get("autosave")):
                self.retain(latest["history"][-1]["objectKey"])
                return response(200, {"revision": latest["revision"], "metadata": public_item(latest)})
            raise ApiError(409, "This figure changed elsewhere. Reload or save a copy.", "RESEARCH_CONFLICT")
        self.retain(key)
        if previous_auto:
            try:
                self.services.s3.delete_object(Bucket=self.services.bucket, Key=previous_auto["objectKey"])
            except Exception:
                # The new head is already durable; cleanup cannot turn it into a failed save.
                pass
        return response(200, {"revision": revision, "metadata": public_item(metadata)})

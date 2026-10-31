"""Owner-scoped context references and durable research outputs, independent of provider."""
from __future__ import annotations
import copy
import json
from backend.local_api.domain.ai_workspace import RESOURCE_KINDS, clean, digest, fail, valid_id
from backend.local_api.domain.ai_skills import selected_skill

TASK_MODES = {"work", "plan", "research", "summary"}


def task_mode(value: object) -> str:
    if not isinstance(value, str) or value not in TASK_MODES:
        fail(400, "Choose Work, Plan, Research or Summary.", "AI_TASK_INVALID")
    return value


def assert_work(run: dict) -> None:
    if run.get("taskMode", "work") != "work":
        fail(403, "Plan, Research and Summary can only read evidence. Start Work to apply changes.", "AI_TASK_READ_ONLY")


class AiWorkbench:
    def __init__(self, ai):
        self.ai = ai

    def graph(self, owner: str, conversation: dict) -> dict:
        project = self.ai.scope(owner, conversation.get("projectKey"))
        if not project or project["kind"] != "canvas":
            fail(400, "Open a Canvas project to select modules.", "AI_PROJECT_REQUIRED")
        from backend.local_api.domain.project_workflow import ProjectWorkflowApi
        return ProjectWorkflowApi(self.ai.api).load(owner, project["id"])

    def catalogue(self, owner: str, conversation: dict, query: str = "", node_id: str | None = None) -> dict:
        context = self.ai.context(owner, conversation)
        items = []
        def add(ref, label, detail):
            items.append({"ref": ref, "label": label, "detail": detail})
        if context["project"] and context["project"]["kind"] == "canvas":
            saved = self.graph(owner, conversation)
            graph, revision = saved["workflow"], saved["revision"]
            for node in graph["nodes"]:
                if node_id and node["id"] != node_id:
                    continue
                ref = {"kind": "node", "id": node["id"], "revision": revision}
                add(ref, node["name"], node["kind"])
                if node_id:
                    def fields(value, path):
                        if len(path) > 7 or len(items) >= 250:
                            return
                        if isinstance(value, dict):
                            for key, child in value.items():
                                if key not in {"structure", "parameterStudy", "result", "history"}:
                                    fields(child, path + [key])
                        elif not isinstance(value, (dict, list)):
                            add({"kind": "field", "id": node["id"], "path": path, "revision": revision}, node["name"] + " · " + ".".join(path), str(clean(value))[:120])
                    fields(node.get("configuration", {}), [])
                    structure = node.get("configuration", {}).get("structure") or {}
                    structure = structure if isinstance(structure, dict) else {}
                    atoms = structure.get("atoms", [])
                    for atom in (atoms if isinstance(atoms, list) else [])[:100]:
                        if isinstance(atom, dict) and isinstance(atom.get("id"), str):
                            add({"kind": "atom", "id": node["id"], "atomId": atom["id"], "revision": revision}, node["name"] + " · " + atom["id"], atom.get("species", "Atom"))
            if not node_id:
                names = {node["id"]: node["name"] for node in graph["nodes"]}
                for edge in graph["edges"]:
                    add({"kind": "edge", "id": edge["id"], "revision": revision}, names.get(edge["source"], edge["source"]) + " → " + names.get(edge["target"], edge["target"]), edge["port"])
        if not node_id:
            for kind, values in context.get("resources", {}).items():
                if kind == "workflow":
                    continue
                for item in values:
                    add({"kind": "resource", "resourceKind": kind, "id": item["id"], **({"revision": item["revision"]} if "revision" in item else {})}, item.get("name", item["id"]), kind + (" · " + item["status"] if isinstance(item.get("status"), str) else ""))
            for item in self.ai.services.list_owner_items(owner, "AI_ATTACHMENT"):
                if item.get("conversationId") == conversation["id"] and item.get("status") == "ready":
                    add({"kind": "attachment", "id": item["id"]}, item["filename"], "Attachment")
        filtered = [item for item in items if query.casefold() in (item["label"] + " " + item["detail"]).casefold()]
        return {"items": filtered[:250], "hasMore": len(filtered) > 250}

    def resolve(self, owner: str, conversation: dict, refs: object) -> list[dict]:
        if not isinstance(refs, list) or len(refs) > 16:
            fail(400, "Select at most sixteen context references.", "AI_CONTEXT_INVALID")
        manifests = []
        saved = None
        for ref in refs:
            if not isinstance(ref, dict) or set(ref) - {"kind", "id", "path", "revision", "resourceKind", "atomId", "image"}:
                fail(400, "This context reference is invalid.", "AI_CONTEXT_INVALID")
            item_id, kind = valid_id(ref.get("id")), ref.get("kind")
            if kind in {"node", "field", "edge", "atom"}:
                saved = saved or self.graph(owner, conversation)
                if ref.get("revision") is not None and (type(ref["revision"]) is not int or ref["revision"] != saved["revision"]):
                    fail(409, "The selected context changed. Select its current version before sending.", "AI_CONTEXT_CHANGED")
                collection = saved["workflow"]["edges" if kind == "edge" else "nodes"]
                value = next((item for item in collection if item["id"] == item_id), None)
                if value is None:
                    fail(404, "The selected context is no longer in this project.", "AI_CONTEXT_NOT_FOUND")
                label = value.get("name", value["id"])
                if kind == "field":
                    path = ref.get("path")
                    if not isinstance(path, list) or not 1 <= len(path) <= 7 or any(not isinstance(key, str) or len(key) > 100 or key.startswith("__") or key in {"constructor", "prototype"} for key in path):
                        fail(400, "Choose an existing configuration field.", "AI_CONTEXT_INVALID")
                    value = value.get("configuration", {})
                    for key in path:
                        if not isinstance(value, dict) or key not in value:
                            fail(404, "The selected configuration field no longer exists.", "AI_CONTEXT_NOT_FOUND")
                        value = value[key]
                    label += " · " + ".".join(path)
                elif kind == "atom":
                    structure = value.get("configuration", {}).get("structure", {})
                    if not isinstance(structure, dict) or not isinstance(structure.get("atoms"), list):
                        fail(400, "This module has no valid saved atom list.", "AI_CONTEXT_INVALID")
                    atom = next((a for a in structure["atoms"] if isinstance(a, dict) and a.get("id") == ref.get("atomId")), None)
                    image = ref.get("image", [0, 0, 0])
                    if not atom or not isinstance(image, list) or len(image) != 3 or any(type(v) is not int or abs(v) > 32 for v in image):
                        fail(400, "Choose an existing atom and periodic image.", "AI_CONTEXT_INVALID")
                    periodic = structure.get("periodic", (structure.get("lattice") or {}).get("periodic", [True, True, True]))
                    if not isinstance(periodic, list) or len(periodic) != 3 or any(type(value) is not bool for value in periodic):
                        fail(400, "The saved structure needs valid periodic axes before selecting an image.", "AI_CONTEXT_INVALID")
                    if any(image[i] and not periodic[i] for i in range(3)):
                        fail(400, "The selected image crosses a nonperiodic axis.", "AI_CONTEXT_INVALID")
                    value = {"atom": atom, "image": image, "lattice": structure.get("lattice"), "cellVectors": structure.get("cellVectors"), "periodic": periodic, "structureSha256": digest(structure)}
                    label += " · " + atom["id"]
                revision = saved["revision"]
            elif kind == "resource":
                value = self.ai.resource(owner, conversation, str(ref.get("resourceKind")), item_id)
                label = (value.get("item") or value.get("document") or value.get("dataset") or value.get("figure") or {}).get("name", item_id)
                resource_kind = ref.get("resourceKind")
                revision = self.ai.row(owner, RESOURCE_KINDS[resource_kind], item_id).get("revision") if resource_kind in RESOURCE_KINDS else value.get("revision")
                if ref.get("revision") is not None and (type(ref["revision"]) is not int or ref["revision"] != revision):
                    fail(409, "The selected source changed. Select its current version.", "AI_CONTEXT_CHANGED")
            elif kind == "attachment":
                from backend.local_api.domain.ai_attachments import AiAttachments
                attachment = AiAttachments(self.ai.api).get(owner, conversation, item_id)
                if attachment["status"] != "ready":
                    fail(409, "Wait for the selected attachment to finish uploading.", "AI_ATTACHMENT_NOT_READY")
                value = {"attachmentId": item_id, "sha256": attachment["sha256"], "note": "Use read_attachment for source sections; only file metadata is included here."}
                label, revision = attachment["filename"], None
            else:
                fail(400, "This context target is not supported.", "AI_CONTEXT_INVALID")
            value = clean(value)
            source_hash = digest(value)
            encoded = json.dumps(value, ensure_ascii=False)
            if len(encoded) > 16000:
                value = {"truncated": True, "excerpt": encoded[:16000], "note": "Only this excerpt was read. Request a narrower saved resource for more evidence."}
            manifests.append({"ref": {**copy.deepcopy(ref), **({"revision": revision} if revision is not None else {})}, "label": clean(label), "sha256": source_hash, "value": value, "sourceId": "C" + str(len(manifests) + 1)})
        if len(json.dumps(manifests).encode()) > 60000:
            fail(413, "Select fewer or narrower context references.", "AI_CONTEXT_LIMIT")
        return manifests

    def selection(self, owner: str, conversation: dict, payload: dict, *, previous_skill: dict | None = None, preserve_skill: bool = False) -> dict:
        mode = task_mode(payload.get("taskMode", "work"))
        refs = payload.get("contextRefs", [])
        source = payload.get("sourceArtifactId")
        if source:
            artifact = self.ai.row(owner, "AI_ARTIFACT", valid_id(source))
            if artifact.get("conversationId") != conversation["id"] or artifact.get("kind") != "plan" or artifact.get("status") != "complete" or mode != "work":
                fail(400, "Select a plan from this conversation to implement.", "AI_PLAN_INVALID")
            if artifact.get("sourceStamp") != self.ai.context(owner, conversation)["stamp"]:
                fail(409, "The project changed since this plan. Refresh the plan before implementing it.", "AI_PLAN_STALE")
            refs = [item["ref"] for item in artifact.get("contextManifest", [])]
        return {"taskMode": mode, "contextManifest": self.resolve(owner, conversation, refs), "skillSnapshot": selected_skill(payload, previous_skill, preserve=preserve_skill), **({"sourceArtifactId": source, "sourcePlan": artifact["text"]} if source else {})}

    def artifacts(self, owner: str, conversation: dict) -> list[dict]:
        return sorted([clean(row) for row in self.ai.services.list_owner_items(owner, "AI_ARTIFACT") if row.get("conversationId") == conversation["id"]], key=lambda row: row["createdAt"])

    def complete(self, owner: str, conversation: dict, run: dict, status: str) -> None:
        kind = run.get("taskMode", "work")
        if kind == "work":
            return
        messages = self.ai.detail(owner, conversation)["messages"]
        text = "\n\n".join(item["text"] for item in messages if item["runId"] == run["id"] and item["role"] == "assistant")
        if not text.strip():
            return
        evidence = []
        for message in messages:
            if message.get("runId") == run["id"] and message.get("evidence"):
                try:
                    entry = {**message["evidence"], "observation": json.loads(message["text"])}
                    if len(json.dumps(evidence + [entry]).encode()) <= 60000:
                        evidence.append(entry)
                except (ValueError, TypeError):
                    continue
        truncated = len(text.encode()) > 100000
        recorded_text = text.encode()[:99500 if truncated else 100000].decode("utf-8", errors="ignore")
        if truncated:
            recorded_text += "\n\n[Partial report: the recorded output exceeded 100 KB. Read the full messages before continuing; this excerpt cannot be implemented as a complete plan.]"
        item_id = "aid_" + digest([run["id"], kind])[:32]
        if self.ai.services.get_item(owner, "AI_ARTIFACT", item_id):
            return
        self.ai.put(owner, "AI_ARTIFACT", item_id, {"conversationId": conversation["id"], "projectKey": conversation.get("projectKey"), "runId": run["id"], "kind": kind, "status": "complete" if status == "completed" and not truncated else "partial", "truncated": truncated, "text": recorded_text, "sourceStamp": run.get("sourceStamp"), "contextManifest": run.get("contextManifest", []), "evidence": evidence, "modelId": run["modelId"], "providerId": run.get("providerId", "phynite"), "effort": run.get("effort", "auto")})

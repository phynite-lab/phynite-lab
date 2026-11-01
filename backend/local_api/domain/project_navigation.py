"""Navigation v2 uses its own revision; v1 clients cannot replace it."""
from __future__ import annotations
import re
from typing import Any
from backend.local_api.domain.phynite_core import ApiError, response, utc_now
from backend.local_api.domain.project_workflow import ProjectWorkflowApi

KIND = "PROJECT_NAVIGATION"


class ProjectNavigationApi:
    def __init__(self, api: Any):
        self.api = api
        self.services = api.services

    def legacy(self, owner: str) -> tuple[list[str], list[str], bool]:
        old = self.services.get_item(owner, "NAVIGATION_PREFERENCES", "primary")
        prefs = (old or {}).get("preferences", {})
        aliases = {item["id"]: item["projectId"] for item in self.services.list_owner_items(owner, "PROJECT_ALIAS")}
        for project in self.services.list_owner_items(owner, "PROJECT"):
            if project.get("legacyId"):
                aliases[project["legacyId"]] = project["id"]
        ids, unresolved = [], []
        for key in prefs.get("pinnedProjectKeys", []):
            prefix, item_id = key.split(":", 1)
            project_id = item_id if prefix == "md" else aliases.get(item_id)
            if project_id:
                if project_id not in ids:
                    ids.append(project_id)
            else:
                unresolved.append(key)
        return ids, unresolved, prefs.get("sidebarDocked", True)

    def get(self, owner: str) -> dict[str, Any]:
        item = self.services.get_item(owner, KIND, "primary")
        ids, unresolved, docked = self.legacy(owner)
        if item:
            aliases = {alias["id"]: alias["projectId"] for alias in self.services.list_owner_items(owner, "PROJECT_ALIAS")}
            prefs = dict(item["preferences"])
            pending = item.get("unresolvedProjectKeys", [])
            resolved = [aliases[key[4:]] for key in pending if key[4:] in aliases]
            prefs["pinnedProjectIds"] = list(dict.fromkeys([*prefs["pinnedProjectIds"], *resolved]))
            return response(200, {"preferences": prefs, "revision": int(item["revision"]), "unresolvedProjectKeys": [key for key in pending if key[4:] not in aliases]})
        return response(200, {"preferences": {"version": 2, "pinnedProjectIds": ids, "sidebarDocked": docked}, "revision": 0, "unresolvedProjectKeys": unresolved})

    def put(self, owner: str, payload: dict[str, Any]) -> dict[str, Any]:
        prefs, revision = payload.get("preferences"), payload.get("baseRevision")
        if set(payload) - {"preferences", "baseRevision", "unresolvedProjectKeys"} or type(revision) is not int or revision < 0 or not isinstance(prefs, dict) or set(prefs) != {"version", "pinnedProjectIds", "sidebarDocked"} or type(prefs.get("version")) is not int or prefs["version"] != 2 or type(prefs.get("sidebarDocked")) is not bool:
            raise ApiError(400, "Navigation v2 payload is invalid.", "INVALID_NAVIGATION_PREFERENCES")
        ids = prefs.get("pinnedProjectIds")
        if not isinstance(ids, list) or len(ids) > 256 or any(not isinstance(item, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,200}", item) for item in ids) or len(set(ids)) != len(ids):
            raise ApiError(400, "Pinned project IDs are invalid.", "INVALID_NAVIGATION_PREFERENCES")
        current = self.services.get_item(owner, KIND, "primary")
        if (int(current["revision"]) if current else 0) != revision:
            raise ApiError(409, "Project navigation changed on another device.", "NAVIGATION_PREFERENCES_CONFLICT")
        unresolved = payload.get("unresolvedProjectKeys", current.get("unresolvedProjectKeys", []) if current else self.legacy(owner)[1])
        if not isinstance(unresolved, list) or len(unresolved) + len(ids) > 256 or any(not isinstance(key, str) or not re.fullmatch(r"dft:[A-Za-z0-9_-]{1,200}", key) for key in unresolved) or len(set(unresolved)) != len(unresolved):
            raise ApiError(400, "Unresolved project pins are invalid.", "INVALID_NAVIGATION_PREFERENCES")
        values = {"preferences": prefs, "revision": revision + 1, "updatedAt": utc_now(), "unresolvedProjectKeys": unresolved}
        item = self.services.update_item_if_revision(owner, KIND, "primary", revision, values) if current else ProjectWorkflowApi(self.api).put_new(owner, KIND, "primary", values)
        if not item:
            raise ApiError(409, "Project navigation changed while saving.", "NAVIGATION_PREFERENCES_CONFLICT")
        return self.get(owner)

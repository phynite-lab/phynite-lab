"""Owner-scoped UI preferences, independent of scientific workspace snapshots."""
from __future__ import annotations

import json
import re
from typing import Any

from backend.local_api.domain.phynite_core import ApiError, owner_partition, response, utc_now

FEATURE_IDS = {"projects", "dft", "md", "figures", "storage", "inbox", "computer"}
KIND = "NAVIGATION_PREFERENCES"


def default_preferences() -> dict[str, Any]:
    return {"version": 1, "pinnedFeatureIds": ["dft", "md", "figures"],
            "pinnedProjectKeys": [], "sidebarDocked": True}


def validate_preferences(value: Any) -> dict[str, Any]:
    def invalid() -> None:
        raise ApiError(400, "Navigation preferences are invalid.", "INVALID_NAVIGATION_PREFERENCES")

    if not isinstance(value, dict) or set(value) != set(default_preferences()):
        invalid()
    if type(value["version"]) is not int or value["version"] != 1 or type(value["sidebarDocked"]) is not bool:
        invalid()
    features, projects = value["pinnedFeatureIds"], value["pinnedProjectKeys"]
    if not isinstance(features, list) or len(features) > len(FEATURE_IDS):
        invalid()
    if any(not isinstance(item, str) or item not in FEATURE_IDS for item in features) or len(set(features)) != len(features):
        invalid()
    if not isinstance(projects, list) or len(projects) > 256:
        invalid()
    if any(not isinstance(item, str) or not re.fullmatch(r"(?:dft|md):[A-Za-z0-9_-]{1,200}", item) for item in projects):
        invalid()
    if len(set(projects)) != len(projects) or len(json.dumps(value).encode("utf-8")) > 65536:
        invalid()
    return {**value, "pinnedFeatureIds": list(features), "pinnedProjectKeys": list(projects)}


class NavigationPreferencesApi:
    def __init__(self, services: Any):
        self.services = services

    def get(self, owner: str) -> dict[str, Any]:
        item = self.services.get_item(owner, KIND, "primary")
        return response(200, {"preferences": item["preferences"] if item else default_preferences(),
                              "revision": int(item["revision"]) if item else 0})

    def put(self, owner: str, payload: dict[str, Any]) -> dict[str, Any]:
        if set(payload) != {"preferences", "baseRevision"} or type(payload.get("baseRevision")) is not int or payload["baseRevision"] < 0:
            raise ApiError(400, "A nonnegative baseRevision and preferences are required.", "INVALID_NAVIGATION_PREFERENCES")
        preferences = validate_preferences(payload["preferences"])
        revision = payload["baseRevision"]
        timestamp = utc_now()
        current = self.services.get_item(owner, KIND, "primary")

        def conflict() -> None:
            raise ApiError(409, "Navigation changed on another device. Reload preferences and retry.", "NAVIGATION_PREFERENCES_CONFLICT")

        if (int(current["revision"]) if current else 0) != revision:
            conflict()
        values = {"preferences": preferences, "revision": revision + 1, "updatedAt": timestamp}
        if current:
            if self.services.update_item_if_revision(owner, KIND, "primary", revision, values) is None:
                conflict()
        else:
            try:
                self.services.put_item({"PK": owner_partition(owner), "SK": f"{KIND}#primary",
                    "entityType": KIND, "id": "primary", "ownerId": owner, "createdAt": timestamp, **values},
                    "attribute_not_exists(PK)")
            except Exception as exc:
                if getattr(exc, "response", {}).get("Error", {}).get("Code") == "ConditionalCheckFailedException":
                    conflict()
                raise
        return response(200, {"preferences": preferences, "revision": revision + 1})

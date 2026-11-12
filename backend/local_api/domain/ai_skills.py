"""Versioned built-in instructions. Clients select references, never executable skills."""
from __future__ import annotations

import copy
import hashlib
import json
import re
from functools import lru_cache
from pathlib import Path
from backend.local_api.domain.phynite_core import ApiError, json_safe


def invalid(message: str = "Choose a built-in skill from the current catalogue.", code: str = "AI_SKILL_INVALID", status: int = 400) -> None:
    raise ApiError(status, message, code)


def skill_ref(value: object) -> dict | None:
    if value is None:
        return None
    if not isinstance(value, dict) or set(value) - {"scope", "id", "version"} or not isinstance(value.get('scope', 'builtin'), str) or value.get('scope', 'builtin') not in {'builtin', 'user'} or not isinstance(value.get("id"), str) or not re.fullmatch(r"[a-z][a-z0-9_]{1,63}", value["id"]) or type(value.get("version")) is not int or value["version"] < 1:
        invalid()
    return {"id": value["id"], "version": value["version"], **({'scope': 'user'} if value.get('scope') == 'user' else {})}


def snapshot_ref(snapshot: dict | None) -> dict | None:
    # DynamoDB returns integral versions as Decimal; normalize only this stored value.
    return skill_ref(json_safe({"id": snapshot.get("id"), "version": snapshot.get("version"), 'scope': snapshot.get('scope', 'builtin')})) if snapshot else None


def skill_identity(snapshot: dict | None) -> tuple | None:
    return (snapshot.get('scope', 'builtin'), snapshot["id"], snapshot["version"], snapshot["sha256"]) if snapshot else None


@lru_cache(maxsize=1)
def manifest() -> list[dict]:
    try:
        document = json.loads(Path(__file__).with_name("ai_skills.json").read_text(encoding="utf-8"))
        skills = document["skills"]
        if document.get("schemaVersion") != 1 or not isinstance(skills, list) or not 1 <= len(skills) <= 32:
            raise ValueError()
        ids = set()
        for item in skills:
            skill_ref({"id": item["id"], "version": item["version"]})
            if item["id"] in ids or item.get("command") != item["id"] or not isinstance(item.get("instruction"), str) or not 1 <= len(item["instruction"]) <= 6000:
                raise ValueError()
            ids.add(item["id"])
            for field in ("label", "description"):
                if not isinstance(item.get(field), dict) or set(item[field]) != {"en", "id"} or any(not isinstance(value, str) or not 1 <= len(value) <= 500 for value in item[field].values()):
                    raise ValueError()
        return skills
    except (OSError, ValueError, TypeError, KeyError, ApiError) as exc:
        raise ApiError(503, "The built-in skill catalogue needs attention.", "AI_SKILLS_UNAVAILABLE") from exc


def catalogue() -> list[dict]:
    return [copy.deepcopy({key: item[key] for key in ("id", "version", "command", "label", "description")}) for item in manifest()]


def selected_skill(payload: dict, previous: dict | None = None, *, preserve: bool = False, ai=None, owner=None) -> dict | None:
    # Only internal records may supply a frozen snapshot. Never accept one from HTTP.
    if "skillSnapshot" in payload or "instruction" in payload:
        invalid("Select a saved skill reference; inline instructions and snapshots are not accepted.")
    if preserve and "skillRef" not in payload:
        return copy.deepcopy(previous)
    ref = skill_ref(payload.get("skillRef"))
    if ref is None:
        return None
    if preserve and ref == snapshot_ref(previous):
        return copy.deepcopy(previous)
    if ref.get('scope') == 'user':
        if ai is None or owner is None: invalid()
        from backend.local_api.domain.ai_custom_skills import CustomSkills
        item = CustomSkills(ai).get(owner, ref['id'])
    else:
        item = next((item for item in manifest() if item["id"] == ref["id"]), None)
    if not item:
        invalid()
    if item["version"] != ref["version"]:
        invalid("This skill changed. Select its current version before sending.", "AI_SKILL_CHANGED", 409)
    return {**ref, "label": item['label'] if ref.get('scope') == 'user' else item["label"]["en"], "instruction": item["instruction"], "sha256": hashlib.sha256(item["instruction"].encode("utf-8")).hexdigest(), **({key: copy.deepcopy(item.get(key)) for key in ('allowedTaskModes', 'allowedTools')} if ref.get('scope') == 'user' else {})}


def request_skill_ref(payload: dict) -> dict | None:
    if "skillSnapshot" in payload or "instruction" in payload:
        invalid("Select a skill reference; custom skill instructions are not supported.")
    return skill_ref(payload.get("skillRef"))

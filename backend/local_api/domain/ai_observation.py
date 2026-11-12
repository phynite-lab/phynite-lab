"""Structure-aware evidence compaction; original scientific records are never modified."""
from __future__ import annotations

import json
import re
from typing import Any

AI_OBSERVATION_BYTE_BUDGET = 24000
PRIORITY = ("error", "code", "status", "id", "name", "sha256", "revision", "warnings", "truncated",
            "nextLine", "nextOffset", "nextCursor", "issues", "metadata")


def _size(value: Any) -> int:
    # Account for ASCII escaping and spaces as well as values. This also bounds
    # the compact same-origin response serializer, which uses fewer separators.
    return len(json.dumps(value, allow_nan=False).encode())


def _array_summary(length: int) -> dict:
    return {"_compacted": True, "totalItems": length, "sampleHead": [], "sampleTail": []}


def _minimum(value: Any, key: str = "") -> int:
    length = _size(value)
    if isinstance(value, str):
        return length if key in PRIORITY and length <= 512 else min(length, _size(f"…[truncated {len(value)} chars]"))
    if isinstance(value, list):
        return min(length, _size(_array_summary(len(value))))
    if isinstance(value, dict):
        return min(length, _size({"truncated": True, "_omittedFields": len(value)}))
    return length


def _shortened(value: str, budget: int) -> str:
    def marked(end: int) -> str:
        return value[:end] + f"…[truncated {len(value) - end} chars]"
    low, high = 0, len(value)
    while low < high:
        middle = (low + high + 1) // 2
        if _size(marked(middle)) <= budget:
            low = middle
        else:
            high = middle - 1
    boundary = re.search(r"\s+\S*$", value[:low])
    if boundary and boundary.start() >= low * .8:
        low = boundary.start()
    return marked(low)


def _compact(value: Any, budget: int) -> Any:
    if _size(value) <= budget:
        return value
    if isinstance(value, str):
        return _shortened(value, budget)
    if isinstance(value, list):
        result = _array_summary(len(value))
        samples = []
        available = budget - _size(result)
        for offset in range(min(3, (len(value) + 1) // 2)):
            for index in (offset, len(value) - 1 - offset):
                if any(sample[0] == index for sample in samples):
                    continue
                needed = _minimum(value[index])
                if needed + 2 <= available:
                    samples.append((index, needed))
                    available -= needed + 2
        spare, items = available, {}
        for position, (index, needed) in enumerate(samples):
            item = _compact(value[index], needed + spare // (len(samples) - position))
            spare -= _size(item) - needed
            items[index] = item
        for index, _ in sorted(samples):
            result["sampleTail" if index >= (len(value) + 1) // 2 else "sampleHead"].append(items[index])
        return result
    if isinstance(value, dict):
        entries = sorted(((key, child) for key, child in value.items() if key != "truncated"),
                         key=lambda entry: PRIORITY.index(entry[0]) if entry[0] in PRIORITY else len(PRIORITY))
        selected = []
        available = budget - _size({"truncated": True, "_omittedFields": len(entries)})
        for key, child in entries:
            needed, overhead = _minimum(child, key), _size(key) + 4
            if needed + overhead <= available:
                selected.append((key, child, needed))
                available -= needed + overhead
        result = {"truncated": True}
        if len(selected) < len(entries):
            result["_omittedFields"] = len(entries) - len(selected)
        spare = budget - _size(result) - sum(_size(key) + 4 + needed for key, _, needed in selected)
        for position, (key, child, needed) in enumerate(selected):
            item = _compact(child, needed + spare // (len(selected) - position))
            result[key] = item
            spare -= _size(item) - needed
        return result
    return value


def compact_observation(value: Any, maximum: int = AI_OBSERVATION_BYTE_BUDGET) -> Any:
    """Return valid JSON data within a serialized byte budget, with explicit omissions."""
    if type(maximum) is not int or maximum < 128:
        raise ValueError("Observation budgets must be integers of at least 128 bytes.")
    return _compact(value, maximum)

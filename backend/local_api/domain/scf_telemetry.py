"""Bounded, numeric-only worker evidence for the owner-scoped calculation API."""
from __future__ import annotations

import math
from typing import Any


def normalize_scf_convergence(value: Any) -> dict[str, Any] | None:
    if value is None:
        return None
    if not isinstance(value, dict) or type(value.get("version")) is not int or value.get("version") != 1 or value.get("stage") not in {"scf", "relax"}:
        raise ValueError("SCF telemetry has an unsupported schema or stage.")
    points = value.get("points")
    if not isinstance(points, list) or not 1 <= len(points) <= 256:
        raise ValueError("SCF telemetry requires 1–256 measured iterations.")
    def finite(number: Any) -> bool:
        try:
            return type(number) in (int, float) and math.isfinite(number)
        except OverflowError:
            return False
    normalized = []
    previous = (-1, -1)
    for point in points:
        if not isinstance(point, dict):
            raise ValueError("Invalid SCF iteration.")
        cycle, iteration, error = point.get("cycle"), point.get("iteration"), point.get("errorRy")
        if type(cycle) is not int or not 0 <= cycle <= 1000000 or type(iteration) is not int or not 1 <= iteration <= 1000000 or (cycle, iteration) <= previous or not finite(error) or error < 0:
            raise ValueError("SCF iterations must be ordered, with finite nonnegative residual bounds in Ry.")
        row = {"cycle": cycle, "iteration": iteration, "errorRy": error}
        if "energyRy" in point:
            if not finite(point["energyRy"]):
                raise ValueError("SCF energy must be finite and in Ry.")
            row["energyRy"] = point["energyRy"]
        normalized.append(row)
        previous = (cycle, iteration)
    result = {"version": 1, "stage": value["stage"], "points": normalized, "truncated": value.get("truncated") is True}
    if value.get("thresholdRy") is not None:
        threshold = value["thresholdRy"]
        if not finite(threshold) or threshold <= 0:
            raise ValueError("SCF threshold must be finite and positive.")
        result["thresholdRy"] = threshold
    return result

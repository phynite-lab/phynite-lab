"""Validate worker-reported execution allocations against the owner job grant."""
from __future__ import annotations

from decimal import Decimal
from typing import Any

from backend.local_api.domain.phynite_core import ApiError


def normalize_compute_phase(payload: dict[str, Any]) -> str | None:
    if "computePhase" not in payload:
        return None
    phase = payload["computePhase"]
    if not isinstance(phase, str) or phase not in {"PREPARING", "COMPUTING", "FINALIZING"}:
        raise ApiError(400, "Worker compute phase is invalid.", "INVALID_COMPUTE_PHASE")
    return phase


def normalize_effective_resources(item: dict[str, Any], payload: dict[str, Any]) -> dict[str, int] | None:
    fields = {"effectiveVcpus": "vcpus", "effectiveMemoryMiB": "memoryMiB"}
    reported = {field: payload[field] for field in fields if field in payload}
    if not reported:
        return None  # Older workers never imply that their requested grant was used.
    if set(reported) != set(fields):
        raise ApiError(400, "Report effective CPU and RAM together.", "INVALID_EFFECTIVE_RESOURCES")
    result = {}
    for field, grant_field in fields.items():
        value, grant = reported[field], item.get(grant_field)
        if (isinstance(value, bool) or not isinstance(value, (int, Decimal))
                or isinstance(value, Decimal) and not value.is_finite()
                or value < 1 or value != int(value)):
            raise ApiError(400, "Effective CPU and RAM must be positive whole numbers.", "INVALID_EFFECTIVE_RESOURCES")
        if (isinstance(grant, bool) or not isinstance(grant, (int, Decimal))
                or isinstance(grant, Decimal) and not grant.is_finite()
                or grant < value):
            raise ApiError(400, "Effective resources exceed this job's allocation.", "INVALID_EFFECTIVE_RESOURCES")
        result[field] = int(value)
    return result

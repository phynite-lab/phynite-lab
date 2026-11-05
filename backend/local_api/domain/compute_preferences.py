"""Owner-scoped personal allocations; cloud and scheduler grants stay authoritative."""
from __future__ import annotations

from decimal import Decimal
from typing import Any

from backend.local_api.domain.phynite_core import ApiError

WORKLOADS = ("qe", "md-simulation", "md-analysis")
# Local jobs run under the RSS watchdog, which stops a job that exceeds its grant with a
# memory error. 1 GiB matches the smallest allocation accepted by the cloud path.
MINIMUM_MEMORY_MIB = 1024


def personal_limits(services: Any) -> dict[str, dict[str, int]]:
    return {
        workload: {
            "vcpus": int(services.max_job_vcpus if workload == "qe" else services.max_md_job_vcpus),
            "memoryMiB": int(services.max_job_memory if workload == "qe" else services.max_md_job_memory),
            "minimumMemoryMiB": MINIMUM_MEMORY_MIB,
            "memoryMiBPerVcpu": 1024 if workload == "md-analysis" else 0,
        }
        for workload in WORKLOADS
    }


def allocation_integer(value: Any) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, Decimal)) or isinstance(value, Decimal) and not value.is_finite():
        raise ApiError(400, "Personal CPU and RAM must be positive whole numbers.", "INVALID_PERSONAL_RESOURCES")
    if value != int(value) or value < 1:
        raise ApiError(400, "Personal CPU and RAM must be positive whole numbers.", "INVALID_PERSONAL_RESOURCES")
    return int(value)


def validate_allocation(services: Any, workload: str, value: Any) -> dict[str, int]:
    if not isinstance(value, dict) or set(value) != {"vcpus", "memoryMiB"}:
        raise ApiError(400, "Provide CPU and RAM for each personal workload.", "INVALID_PERSONAL_RESOURCES")
    vcpus, memory = allocation_integer(value["vcpus"]), allocation_integer(value["memoryMiB"])
    limits = personal_limits(services)[workload]
    minimum = max(limits["minimumMemoryMiB"], vcpus * limits["memoryMiBPerVcpu"])
    if vcpus > limits["vcpus"] or not minimum <= memory <= limits["memoryMiB"]:
        raise ApiError(400, f"Personal {workload} CPU or RAM exceeds the workload limits.", "INVALID_PERSONAL_RESOURCES")
    return {"vcpus": vcpus, "memoryMiB": memory}


def validate_personal_defaults(services: Any, value: Any) -> dict[str, dict[str, int]]:
    if not isinstance(value, dict) or set(value) - set(WORKLOADS):
        raise ApiError(400, "Choose supported personal compute workloads.", "INVALID_PERSONAL_RESOURCES")
    return {workload: validate_allocation(services, workload, allocation) for workload, allocation in value.items()}


def personal_resources(services: Any, owner: str, workload: str, request: dict[str, Any]) -> dict[str, Any]:
    """Resolve each explicit field before saved preferences, without changing legacy defaults."""
    account = services.get_item(owner, "ACCOUNT", "primary") or {}
    defaults = (account.get("personalDefaults") or {}).get(workload) or {}
    resolved = {**defaults, **{key: request[key] for key in ("vcpus", "memoryMiB") if key in request}}
    if not resolved:
        return request
    limits = personal_limits(services)[workload]
    for key, value in resolved.items():
        parsed = allocation_integer(value)
        if parsed > limits[key] or key == "memoryMiB" and parsed < limits["minimumMemoryMiB"]:
            raise ApiError(400, "Personal CPU or RAM exceeds the workload limits.", "INVALID_PERSONAL_RESOURCES")
    if set(resolved) == {"vcpus", "memoryMiB"}:
        resolved = validate_allocation(services, workload, resolved)
    return {**request, **resolved}


def budget_defaults(services: Any, account: dict[str, Any], budget: dict[str, Any]) -> dict[str, dict[str, int]]:
    """Defaults shown in run forms. A user's saved choice is kept while it is valid and fits the
    local admission budget; defaults the user never set follow the budget."""
    allowance = {"vcpus": int(budget["vcpus"]), "memoryMiB": int(budget["memoryMiB"])}
    saved = account.get("personalDefaults") or {}
    chosen = account.get("personalDefaultsSource") == "user"
    result = {}
    for workload in WORKLOADS:
        allocation = None
        if chosen and isinstance(saved, dict) and saved.get(workload) is not None:
            try:
                allocation = validate_allocation(services, workload, saved[workload])
            except ApiError:
                allocation = None
        fits = allocation is not None and allocation["vcpus"] <= allowance["vcpus"] and allocation["memoryMiB"] <= allowance["memoryMiB"]
        result[workload] = allocation if fits else dict(allowance)
    return result

"""Owner-scoped local HPC profile persistence and probing.

HPC profiles are deliberately part of the loopback control plane.  The hosted
Next/Worker surface never receives SSH paths or starts SSH processes.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import re
import time
from contextlib import nullcontext
from pathlib import Path
from typing import Any

try:
    from backend.local_api.domain.phynite_core import ApiError, owner_partition, utc_now
except ImportError:
    try:
        from phynite_core import ApiError, owner_partition, utc_now
    except ImportError:  # Keeps the pure profile contract testable without optional extras.
        class ApiError(RuntimeError):
            def __init__(self, status: int, message: str, code: str = "ERROR") -> None:
                super().__init__(message); self.status, self.message, self.code = status, message, code
        def owner_partition(owner: str) -> str:
            return f"OWNER#{owner}"
        def utc_now() -> str:
            return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

PROFILE_PREFIX = "HPC_PROFILE#"
SNAPSHOT_PREFIX = "HPC_PROFILE_SNAPSHOT#"
SHA256_RE = re.compile(r"^[a-f0-9]{64}$")
ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.@-]{0,95}$")
HOST_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,253}$")
USER_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.@-]{0,63}$")
MODULE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.+@:/-]{0,127}$")


def canonical_digest(value: Any) -> str:
    """Match backend/local_worker/recovery.canonical_digest exactly."""
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def _profile_digest(profile: dict[str, Any]) -> str:
    value = {key: profile[key] for key in profile if key not in {"profileSha256", "PK", "SK", "immutable"}}
    return canonical_digest(value)


def _text(value: Any, label: str, maximum: int = 256) -> str:
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > maximum or any(ord(char) < 32 or ord(char) == 127 for char in value):
        raise ApiError(400, f"{label} is invalid.", "INVALID_HPC_PROFILE")
    return value.strip()


def _integer(value: Any, label: str, low: int, high: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < low or value > high:
        raise ApiError(400, f"{label} must be an integer between {low} and {high}.", "INVALID_HPC_PROFILE")
    return value


def _path(value: Any, label: str) -> str:
    value = _text(value, label, 2048)
    if not value.startswith("/") or ".." in value.split("/"):
        raise ApiError(400, f"{label} must be an absolute path without traversal.", "INVALID_HPC_PROFILE")
    return value


def _safe_module(value: str) -> str | None:
    value = value.strip()
    # Older drafts used shell snippets.  Accept only the harmless legacy
    # spelling and normalize it to a module name; `module purge` is a no-op.
    if value == "module purge":
        return None
    if value.startswith("module load "):
        value = value[len("module load "):].strip()
    if not MODULE_RE.fullmatch(value) or any(char in value for char in ";&|`$()<>\\\"'\n\r\t"):
        raise ApiError(400, "Environment modules must be safe module names.", "INVALID_HPC_MODULE")
    return value


def validate_profile(raw: Any, owner_id: str, *, profile_id: str | None = None, now: str | None = None, created_at: str | None = None) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise ApiError(400, "HPC profile must be an object.", "INVALID_HPC_PROFILE")
    scheduler = raw.get("scheduler")
    if scheduler not in {"slurm", "pbs"}:
        raise ApiError(400, "Scheduler must be Slurm or OpenPBS.", "INVALID_HPC_PROFILE")
    identifier = profile_id or raw.get("id")
    if not isinstance(identifier, str) or not ID_RE.fullmatch(identifier.strip()):
        raise ApiError(400, "Profile ID is invalid.", "INVALID_HPC_PROFILE")
    identifier = identifier.strip()
    name = _text(raw.get("name"), "Profile name", 100)
    connection_raw = raw.get("connection") if isinstance(raw.get("connection"), dict) else {}
    host = _text(connection_raw.get("host"), "SSH host", 254)
    if not HOST_RE.fullmatch(host):
        raise ApiError(400, "SSH host is invalid.", "INVALID_HPC_PROFILE")
    username = _text(connection_raw.get("username"), "SSH username", 64)
    if not USER_RE.fullmatch(username):
        raise ApiError(400, "SSH username is invalid.", "INVALID_HPC_PROFILE")
    port = _integer(connection_raw.get("port", 22), "SSH port", 1, 65535)
    auth_kind = connection_raw.get("authKind", "key")
    if auth_kind not in {"key", "agent"}:
        raise ApiError(400, "SSH authentication must be key or agent.", "INVALID_HPC_PROFILE")
    connection: dict[str, Any] = {"host": host, "port": port, "username": username, "authKind": auth_kind}
    if auth_kind == "key":
        connection["privateKeyPath"] = _path(connection_raw.get("privateKeyPath"), "Private key path")
    for host_key, user_key, port_key in (("bastionHost", "bastionUser", "bastionPort"),):
        if connection_raw.get(host_key) is not None:
            bastion = _text(connection_raw.get(host_key), "Bastion host", 254)
            if not HOST_RE.fullmatch(bastion):
                raise ApiError(400, "Bastion host is invalid.", "INVALID_HPC_PROFILE")
            connection[host_key] = bastion
            connection[port_key] = _integer(connection_raw.get(port_key, 22), "Bastion port", 1, 65535)
            if connection_raw.get(user_key) is not None:
                user = _text(connection_raw.get(user_key), "Bastion username", 64)
                if not USER_RE.fullmatch(user):
                    raise ApiError(400, "Bastion username is invalid.", "INVALID_HPC_PROFILE")
                connection[user_key] = user

    storage_raw = raw.get("storage") if isinstance(raw.get("storage"), dict) else {}
    storage = {
        "scratchRoot": _path(storage_raw.get("scratchRoot"), "Scratch root"),
        "purgeWavefunctions": bool(storage_raw.get("purgeWavefunctions", False)),
    }
    if storage_raw.get("pseudoRoot") is not None:
        storage["pseudoRoot"] = _path(storage_raw.get("pseudoRoot"), "Pseudopotential root")

    runtime_raw = raw.get("runtime") if isinstance(raw.get("runtime"), dict) else {}
    modules: list[str] = []
    values = runtime_raw.get("environmentModules", [])
    if not isinstance(values, list) or len(values) > 64:
        raise ApiError(400, "Environment modules are invalid.", "INVALID_HPC_MODULE")
    for value in values:
        if not isinstance(value, str) or not value.strip():
            continue
        module = _safe_module(value)
        if module and module not in modules:
            modules.append(module)
    launcher = runtime_raw.get("mpiLauncher")
    if launcher is None:
        launcher = ["srun", "--mpi=pmix", "--ntasks={ranks}"] if scheduler == "slurm" else ["mpiexec", "-n", "{ranks}"]
    if not isinstance(launcher, list) or not 0 < len(launcher) <= 32 or any(not isinstance(arg, str) or not arg or any(ord(c) < 32 or ord(c) == 127 for c in arg) for arg in launcher) or sum(arg.count("{ranks}") for arg in launcher) != 1:
        raise ApiError(400, "MPI launcher must be an argv list with exactly one {ranks} placeholder.", "INVALID_HPC_PROFILE")
    if any("{" in arg.replace("{ranks}", "") or "}" in arg.replace("{ranks}", "") for arg in launcher):
        raise ApiError(400, "MPI launcher contains an unsupported placeholder.", "INVALID_HPC_PROFILE")
    expected_launcher = "srun" if scheduler == "slurm" else "mpiexec"
    if Path(launcher[0]).name != expected_launcher:
        raise ApiError(400, f"{scheduler} profiles require an {expected_launcher} MPI launcher.", "INVALID_HPC_PROFILE")
    runtime = {"environmentModules": modules, "mpiLauncher": launcher}

    defaults_raw = raw.get("defaults") if isinstance(raw.get("defaults"), dict) else {}
    defaults: dict[str, Any] = {
        "nodes": _integer(defaults_raw.get("nodes", 1), "nodes", 1, 4096),
        "ranksPerNode": _integer(defaults_raw.get("ranksPerNode", 32), "ranksPerNode", 1, 1024),
        "wallSeconds": _integer(defaults_raw.get("wallSeconds", 14400), "wallSeconds", 300, 5_184_000),
        "memoryMiBPerNode": _integer(defaults_raw.get("memoryMiBPerNode", 65536), "memoryMiBPerNode", 1024, 16_777_216),
    }
    if defaults["nodes"] * defaults["ranksPerNode"] > 65536:
        raise ApiError(400, "Total MPI ranks cannot exceed 65,536.", "INVALID_HPC_PROFILE")
    for key in ("queue", "account"):
        if defaults_raw.get(key) not in (None, ""):
            value = _text(defaults_raw[key], key, 96)
            if not ID_RE.fullmatch(value):
                raise ApiError(400, f"{key} contains unsupported characters.", "INVALID_HPC_PROFILE")
            defaults[key] = value

    timestamp = now or utc_now()
    profile = {
        "id": identifier,
        "ownerId": owner_id,
        "name": name,
        "scheduler": scheduler,
        **({"isDefault": True} if bool(raw.get("isDefault")) else {}),
        "connection": connection,
        "storage": storage,
        "runtime": runtime,
        "defaults": defaults,
        "createdAt": created_at or timestamp,
        "updatedAt": timestamp,
    }
    profile["profileSha256"] = _profile_digest(profile)
    return profile


def validate_hpc_allocation(raw: Any, profile: dict[str, Any]) -> dict[str, Any]:
    if raw is None:
        raw = {}
    if not isinstance(raw, dict) or set(raw) - {"nodes", "ranksPerNode", "wallSeconds", "memoryMiBPerNode", "queue", "account"}:
        raise ApiError(400, "The HPC allocation is invalid.", "INVALID_HPC_ALLOCATION")
    value = {**profile["defaults"], **raw}
    for key, low, high in (("nodes", 1, 4096), ("ranksPerNode", 1, 1024), ("wallSeconds", 300, 5_184_000), ("memoryMiBPerNode", 1024, 16_777_216)):
        value[key] = _integer(value[key], key, low, high)
    if value["nodes"] * value["ranksPerNode"] > 65536 or value["nodes"] * value["memoryMiBPerNode"] > 1024 ** 3:
        raise ApiError(400, "The HPC allocation exceeds the supported resource bounds.", "INVALID_HPC_ALLOCATION")
    for key in ("queue", "account"):
        if key in value and (not isinstance(value[key], str) or not ID_RE.fullmatch(value[key])):
            raise ApiError(400, f"HPC {key} is invalid.", "INVALID_HPC_ALLOCATION")
    return value


def resolve_hpc_compute(services: Any, owner: str, selection: Any) -> dict[str, Any]:
    """Resolve a UI/AI cluster choice locally before review; never trust wire affinity."""
    if not getattr(services, 'local_workspace', False) or owner != services.owner:
        raise ApiError(403, 'Open the local Phynite workspace to use HPC clusters.', 'HPC_LOCAL_ONLY')
    allowed = {'clusterId', 'profileSha256', 'nodes', 'ranksPerNode', 'wallSeconds', 'memoryMiBPerNode', 'partition', 'account', 'autoRestartOnWalltime'}
    if not isinstance(selection, dict) or set(selection) - allowed or not isinstance(selection.get('clusterId'), str):
        raise ApiError(400, 'Choose a saved local HPC cluster and allocation.', 'INVALID_HPC_ALLOCATION')
    profile = HpcProfileStore(services).get(selection['clusterId'])
    if not profile:
        raise ApiError(404, 'The selected HPC cluster is unavailable. Read the local compute inventory again.', 'HPC_PROFILE_NOT_FOUND')
    if 'profileSha256' in selection and selection['profileSha256'] != profile['profileSha256']:
        raise ApiError(409, 'The HPC profile changed. Read compute settings and review a fresh action.', 'HPC_PROFILE_CHANGED')
    if selection.get('autoRestartOnWalltime') not in (None, False):
        raise ApiError(400, 'HPC continuation requires explicit inspection; automatic scientific restart is unavailable.', 'INVALID_HPC_ALLOCATION')
    allocation = {key: selection[key] for key in ('nodes', 'ranksPerNode', 'wallSeconds', 'memoryMiBPerNode', 'account') if key in selection}
    if 'partition' in selection:
        allocation['queue'] = selection['partition']
    allocation = validate_hpc_allocation(allocation, profile)
    return {'computeTarget': 'personal', 'executionAffinity': {'scheduler': profile['scheduler'], 'profileSha256': profile['profileSha256']},
            'vcpus': allocation['nodes'] * allocation['ranksPerNode'], 'memoryMiB': allocation['nodes'] * allocation['memoryMiBPerNode'],
            'settings': {'hpcAllocation': allocation}}


class HpcProfileStore:
    def __init__(self, services: Any):
        self.services = services
        self.owner_id = services.owner
        self.pk = owner_partition(self.owner_id)

    def _get(self, sk: str) -> dict[str, Any] | None:
        return self.services.table.get_item(Key={"PK": self.pk, "SK": sk}).get("Item")

    def list(self) -> list[dict[str, Any]]:
        result = self.services.table.query(KeyConditionExpression="PK = :pk AND begins_with(SK, :prefix)", ExpressionAttributeValues={":pk": self.pk, ":prefix": PROFILE_PREFIX}, ScanIndexForward=True).get("Items", [])
        result.sort(key=lambda item: (not bool(item.get("isDefault")), str(item.get("name", "")).lower(), item.get("id", "")))
        return result

    def get(self, identifier: str) -> dict[str, Any] | None:
        if not ID_RE.fullmatch(identifier):
            return None
        return self._get(PROFILE_PREFIX + identifier)

    def snapshot(self, identifier: str, checksum: str) -> dict[str, Any] | None:
        if not ID_RE.fullmatch(identifier) or not SHA256_RE.fullmatch(checksum):
            return None
        item = self._get(f"{SNAPSHOT_PREFIX}{identifier}#{checksum}")
        return item

    def snapshot_by_checksum(self, checksum: str) -> dict[str, Any] | None:
        if not SHA256_RE.fullmatch(checksum):
            return None
        snapshots = self.services.table.query(KeyConditionExpression="PK = :pk AND begins_with(SK, :prefix)", ExpressionAttributeValues={":pk": self.pk, ":prefix": SNAPSHOT_PREFIX}).get("Items", [])
        return next((item for item in snapshots if item.get("profileSha256") == checksum), None)

    def _active_reference(self, checksum: str, identifier: str) -> bool:
        historical = {
            str(item.get("profileSha256"))
            for item in self.services.table.query(
                KeyConditionExpression="PK = :pk AND begins_with(SK, :prefix)",
                ExpressionAttributeValues={":pk": self.pk, ":prefix": f"{SNAPSHOT_PREFIX}{identifier}#"},
            ).get("Items", [])
            if item.get("profileSha256")
        }
        for kind in ("CALCULATION", "MD_ANALYSIS", "MD_SIMULATION"):
            for job in self.services.list_owner_items(self.owner_id, kind):
                affinity = job.get("executionAffinity") or {}
                if affinity.get("profileSha256") in ({checksum} | historical) or job.get("hpcProfileId") == identifier:
                    if job.get("status") not in {"COMPLETED", "FAILED", "CANCELLED"}:
                        return True
        return False

    def save(self, raw: Any, identifier: str | None = None) -> dict[str, Any]:
        transaction = self.services.table.atomic() if hasattr(self.services.table, "atomic") else nullcontext()
        with transaction:
            existing = self.get(identifier) if identifier else None
            profile = validate_profile(raw, self.owner_id, profile_id=identifier, created_at=existing.get("createdAt") if existing else None)
            if profile.get("isDefault"):
                for item in self.list():
                    if item.get("id") != profile["id"] and item.get("isDefault"):
                        updated = dict(item); updated.pop("profileSha256", None); updated["isDefault"] = False; updated["updatedAt"] = profile["updatedAt"]; updated["profileSha256"] = _profile_digest(updated)
                        self.services.table.put_item(Item={**updated, "PK": self.pk, "SK": PROFILE_PREFIX + updated["id"]})
                        self.services.table.put_item(Item={**updated, "PK": self.pk, "SK": f"{SNAPSHOT_PREFIX}{updated['id']}#{updated['profileSha256']}", "immutable": True})
            self.services.table.put_item(Item={"PK": self.pk, "SK": PROFILE_PREFIX + profile["id"], **profile})
            self.services.table.put_item(Item={"PK": self.pk, "SK": f"{SNAPSHOT_PREFIX}{profile['id']}#{profile['profileSha256']}", **profile, "immutable": True})
            return profile

    def delete(self, identifier: str) -> bool:
        profile = self.get(identifier)
        if not profile:
            return False
        if self._active_reference(str(profile.get("profileSha256", "")), identifier):
            raise ApiError(409, "This HPC profile is referenced by an active job. Wait for a terminal scheduler result before deleting it.", "HPC_PROFILE_IN_USE")
        self.services.table.delete_item(Key={"PK": self.pk, "SK": PROFILE_PREFIX + identifier})
        # Immutable snapshots remain if a receipt might still be reconciled. A
        # later maintenance pass may remove only unreferenced snapshots.
        return True

    def worker_snapshot(self, headers: dict[str, Any], identifier: str, checksum: str) -> dict[str, Any]:
        supplied = next((str(value) for key, value in headers.items() if str(key).lower() == "x-phynite-worker-token"), "")
        if not hmac.compare_digest(supplied, self.services.worker_token):
            raise ApiError(401, "Local worker authentication failed.", "WORKER_UNAUTHORIZED")
        if not SHA256_RE.fullmatch(checksum):
            raise ApiError(400, "Profile checksum is invalid.", "INVALID_PROFILE_CHECKSUM")
        profile = self.snapshot(identifier, checksum)
        if not profile:
            raise ApiError(404, "The requested HPC profile snapshot was not found.", "HPC_PROFILE_SNAPSHOT_NOT_FOUND")
        payload = {key: value for key, value in profile.items() if key not in {"PK", "SK", "immutable"}}
        return payload


def probe_profile(profile: dict[str, Any]) -> dict[str, Any]:
    from backend.local_worker.hpc_ssh import HpcSshConnection, HpcSshError
    connection = profile["connection"]
    try:
        client = HpcSshConnection(
            host=connection["host"], username=connection["username"], port=int(connection.get("port", 22)),
            private_key_path=connection.get("privateKeyPath") if connection.get("authKind") == "key" else None,
            bastion_host=connection.get("bastionHost"), bastion_port=int(connection.get("bastionPort", 22)), bastion_user=connection.get("bastionUser"),
        )
        runtime = profile.get("runtime", {})
        if not isinstance(runtime, dict):
            raise HpcSshError("HPC runtime configuration is invalid.")
        modules = runtime.get("environmentModules", [])
        if not isinstance(modules, list):
            raise HpcSshError("Environment modules are invalid; expected a list of module names.")
        return client.probe_connection(modules=modules)
    except (HpcSshError, OSError, ValueError) as exc:
        return {"ok": False, "latencyMs": 0, "error": str(exc), "solvers": {}, "schedulers": {}}

"""Durable, bounded parameter sweeps and replicas over the existing owner API."""
from __future__ import annotations

import argparse
import copy
import fcntl
import itertools
import json
import math
import os
import re
import shlex
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

from recovery import atomic_json, canonical_digest
from worker import worker_ssl_context

TOKENS = re.compile(r"\{\{([A-Za-z][A-Za-z0-9_]*)\}\}")
TERMINAL = {"completed", "failed", "cancelled"}
SCHEDULER_TERMINAL = {"COMPLETED", "FAILED", "CANCELLED", "TIMEOUT", "NODE_FAIL", "OUT_OF_MEMORY", "PREEMPTED", "BOOT_FAIL", "DEADLINE", "REVOKED", "F", "X"}
KINDS = {"qe": ("calculations", "/v1/calculations", "calculation"),
         "md-simulation": ("md/simulations", "/v1/md/simulations", "simulation"),
         "md-analysis": ("md/analyses", "/v1/md/analyses", "analysis")}


class CampaignError(RuntimeError):
    pass


class ApiError(CampaignError):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code = status, code


class UserApi:
    """User API credentials are read from a private file, never stored in state."""
    def __init__(self, credentials: Path):
        self.credentials = credentials
        self.ssl_context = worker_ssl_context()

    def request(self, method: str, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        if self.credentials.is_symlink() or not self.credentials.is_file() or self.credentials.stat().st_mode & 0o077:
            raise CampaignError("Campaign credentials must be private (chmod 600).")
        config = json.loads(self.credentials.read_text())
        base = str(config.get("apiUrl", "")).rstrip("/")
        token = config.get("accessToken")
        parsed = urllib.parse.urlsplit(base)
        secure = parsed.scheme == "https" and bool(parsed.hostname)
        loopback = parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1", "::1"}
        if not (secure or loopback) or parsed.username or parsed.password or parsed.query or parsed.fragment or not isinstance(token, str) or len(token) < 32:
            raise CampaignError("Credentials require an HTTPS apiUrl and a user accessToken; paired worker tokens cannot submit campaigns.")
        data = json.dumps(payload, allow_nan=False).encode() if payload is not None else None
        request = urllib.request.Request(base + path, data=data, method=method,
                                        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=60, context=self.ssl_context) as reply:
                body = reply.read(16_000_001)
        except urllib.error.HTTPError as exc:
            try:
                error = json.loads(exc.read(16_384))
            except ValueError:
                error = {}
            raise ApiError(exc.code, str(error.get("code", "API_ERROR")), str(error.get("error", f"Campaign API HTTP {exc.code}"))) from exc
        except (urllib.error.URLError, TimeoutError) as exc:
            raise CampaignError("Campaign API connection failed; resume with the same state to reuse idempotency keys.") from exc
        if len(body) > 16_000_000:
            raise CampaignError("Campaign API response exceeds its bounded JSON limit.")
        value = json.loads(body)
        if not isinstance(value, dict):
            raise CampaignError("Campaign API returned an invalid response.")
        return value


def render(value: Any, variables: dict[str, Any]) -> Any:
    if isinstance(value, dict):
        return {key: render(child, variables) for key, child in value.items()}
    if isinstance(value, list):
        return [render(child, variables) for child in value]
    if not isinstance(value, str):
        return value
    match = TOKENS.fullmatch(value)
    if match:
        if match[1] not in variables:
            raise CampaignError(f"Template variable {match[1]} is undefined.")
        return variables[match[1]]
    def replace(match: re.Match[str]) -> str:
        if match[1] not in variables:
            raise CampaignError(f"Template variable {match[1]} is undefined.")
        replacement = variables[match[1]]
        if isinstance(replacement, bool):
            return ".true." if replacement else ".false."
        return str(replacement)
    return TOKENS.sub(replace, value)



def qe_execution_text(text: str) -> str:
    """Ignore comments and bookkeeping namelist fields when recognizing axes."""
    stripped: list[str] = []
    for line in text.splitlines():
        quote = ""
        characters: list[str] = []
        for character in line:
            if character in {"'", '"'}:
                quote = "" if quote == character else character if not quote else quote
            if character == "!" and not quote:
                break
            characters.append(character)
        value = "".join(characters)
        value = re.sub(r"\b(?:title|prefix|outdir|pseudo_dir)\s*=\s*(['\"])(?:(?!\1).)*?\1", "", value, flags=re.IGNORECASE)
        stripped.append(value)
    return "\n".join(stripped)


def execution_template(kind: str, template: dict[str, Any]) -> Any:
    if kind == "qe":
        inputs = template.get("inputFiles")
        contents = list(inputs.values()) if isinstance(inputs, dict) else [template.get("qeInput", "")]
        return [qe_execution_text(content) for content in contents if isinstance(content, str)]
    if kind == "md-analysis":
        return template.get("pipeline", [])
    workflow = template.get("workflow")
    if isinstance(workflow, dict):
        if workflow.get("mode") == "manual" and workflow.get("manualBody"):
            return workflow["manualBody"]
        steps = []
        for step in workflow.get("steps", []):
            if not isinstance(step, dict) or step.get("enabled") is False:
                continue
            if workflow.get("mode") == "manual" and step.get("directives"):
                steps.extend({"kind": block.get("kind"), "params": block.get("params")} for block in step["directives"] if block.get("enabled") is not False)
            else:
                steps.append({"kind": step.get("kind"), "params": step.get("params")})
        return {"boundaryType": workflow.get("boundaryType"), "potential": workflow.get("potential"), "output": workflow.get("output"), "steps": steps}
    config = template.get("config")
    return {key: value for key, value in config.items() if key not in {"name", "computeTarget", "preset"}} if isinstance(config, dict) else {}


def executed_replica_seed(template: dict[str, Any]) -> bool:
    config = template.get("config", {})
    if isinstance(config, dict) and config.get("recipeId") in {"equilibration", "tensile", "shear", "compression", "melting", "diffusion"} and config.get("velocitySeed") == "{{replicaSeed}}":
        return True
    workflow = template.get("workflow", {})
    if not isinstance(workflow, dict):
        return False
    if workflow.get("mode") == "manual" and workflow.get("manualBody"):
        for line in str(workflow["manualBody"]).splitlines():
            try:
                tokens = shlex.split(line, comments=True)
            except ValueError:
                continue
            if len(tokens) >= 5 and tokens[:3] == ["velocity", "all", "create"] and tokens[4] == "{{replicaSeed}}":
                return True
            if len(tokens) >= 8 and tokens[0] == "fix" and tokens[3] == "langevin" and tokens[7] == "{{replicaSeed}}":
                return True
        return False
    for step in workflow.get("steps", []):
        if not isinstance(step, dict) or step.get("enabled") is False:
            continue
        if workflow.get("mode") == "manual" and step.get("directives"):
            for block in step["directives"]:
                params = block.get("params", {})
                if block.get("enabled") is not False and (block.get("kind") == "velocity" or block.get("kind") == "thermostat" and params.get("style") == "langevin") and params.get("seed") == "{{replicaSeed}}":
                    return True
        elif step.get("kind") in {"velocity", "langevin"} and step.get("params", {}).get("velocitySeed") == "{{replicaSeed}}":
            return True
    return False


def create(definition: dict[str, Any], destination: Path) -> dict[str, Any]:
    if destination.exists():
        raise CampaignError("Campaign state exists; resume it instead of overwriting its job identities.")
    if not isinstance(definition, dict) or set(definition) - {"name", "projectId", "kind", "template", "parameters", "replicas", "seedBase", "concurrency", "maxAttempts"}:
        raise CampaignError("Campaign definition contains unsupported fields.")
    name, project = definition.get("name"), definition.get("projectId")
    if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", name) or not isinstance(project, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,96}", project):
        raise CampaignError("Campaign name/project ID is invalid.")
    kind = definition.get("kind", "qe")
    template = definition.get("template")
    if kind not in KINDS or not isinstance(template, dict):
        raise CampaignError("Campaign requires a qe/md-simulation/md-analysis kind and an exact API payload template.")
    if template.get("computeTarget", "personal") != "personal" or template.get("cloudMode"):
        raise CampaignError("Campaigns execute on personal compute; shared/paid profiles require separate authorization.")
    if kind == "qe" and (not isinstance(template.get("qeInput"), str) or not template["qeInput"].strip()):
        raise CampaignError("DFT campaigns require actual qeInput; settings-only templates cannot execute a parameter sweep.")
    ensure_no_credentials(template)
    matrix = definition.get("parameters", {})
    if not isinstance(matrix, dict) or len(matrix) > 32:
        raise CampaignError("Campaign parameter matrix must have at most 32 axes.")
    variables_used = set(TOKENS.findall(json.dumps(execution_template(kind, template))))
    for key, values in matrix.items():
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", key) or key in {"replicaIndex", "replicaSeed"} or key not in variables_used:
            raise CampaignError(f"Parameter {key} must appear explicitly in the execution template.")
        if not isinstance(values, list) or not values or len(values) > 10_000 or any(not isinstance(value, (str, int, float, bool)) or isinstance(value, float) and not math.isfinite(value) for value in values):
            raise CampaignError(f"Parameter {key} needs finite scalar values.")
    replicas, concurrency, max_attempts = definition.get("replicas", 1), definition.get("concurrency", 4), definition.get("maxAttempts", 2)
    for value, lower, upper, label in ((replicas, 1, 10_000, "replicas"), (concurrency, 1, 8, "concurrency"), (max_attempts, 1, 20, "maxAttempts")):
        if isinstance(value, bool) or not isinstance(value, int) or not lower <= value <= upper:
            raise CampaignError(f"{label} must be an integer from {lower} to {upper}.")
    seed_base = definition.get("seedBase", 100_001)
    if isinstance(seed_base, bool) or not isinstance(seed_base, int) or not 1 <= seed_base <= 899_999_999:
        raise CampaignError("seedBase must fit the LAMMPS positive seed range.")
    count = math.prod(len(values) for values in matrix.values()) * replicas
    if count > 10_000 or seed_base + count > 900_000_000:
        raise CampaignError("Campaign is limited to 10,000 rows and valid replica seeds.")
    if replicas > 1 and kind == "md-simulation" and not executed_replica_seed(template):
        raise CampaignError("MD replicas must use {{replicaSeed}} explicitly in the executed velocity/random-state configuration.")
    fingerprint = canonical_digest(definition)
    state: dict[str, Any] = {"version": 1, "campaignId": f"{name}-{fingerprint[:16]}", "definitionSha256": fingerprint,
                             "projectId": project, "kind": kind, "concurrency": concurrency, "maxAttempts": max_attempts,
                             "createdAtEpoch": int(time.time()), "rows": []}
    keys = sorted(matrix)
    for values in itertools.product(*(matrix[key] for key in keys)):
        for replica in range(replicas):
            index = len(state["rows"])
            variables = {**dict(zip(keys, values)), "replicaIndex": replica, "replicaSeed": seed_base + index}
            request = render(template, variables)
            request.update({"computeTarget": "personal", "idempotencyKey": f"campaign_{fingerprint[:32]}_{index}_0"})
            if kind == "qe":
                request["run"] = True
            state["rows"].append({"index": index, "parameters": dict(zip(keys, values)), "replicaIndex": replica,
                                  "replicaSeed": seed_base + index, "state": "planned", "attempt": 0,
                                  "request": request, "requestSha256": canonical_digest(request), "history": []})
    atomic_json(destination, state, overwrite=False)
    return state


@contextmanager
def locked_state(path: Path) -> Iterator[dict[str, Any]]:
    lock = path.with_suffix(path.suffix + ".lock")
    descriptor = os.open(lock, os.O_WRONLY | os.O_CREAT, 0o600)
    with os.fdopen(descriptor, "w") as handle:
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise CampaignError("Another campaign process is updating this state.") from exc
        state = json.loads(path.read_text())
        if state.get("version") != 1 or state.get("kind") not in KINDS or not isinstance(state.get("rows"), list):
            raise CampaignError("Campaign state is invalid.")
        for row in state["rows"]:
            if row.get("requestSha256") != canonical_digest(row.get("request")):
                raise CampaignError("Campaign request checksum changed; create a new campaign for changed scientific inputs.")
        yield state


def clean_result(value: Any) -> Any:
    """Never persist expiring private signed URLs returned by the API."""
    if isinstance(value, dict):
        return {key: clean_result(child) for key, child in value.items() if not sensitive_key(key)}
    if isinstance(value, list):
        return [clean_result(child) for child in value]
    return value


def sensitive_key(key: str) -> bool:
    normalized = key.replace("_", "").replace("-", "").lower()
    return normalized.endswith("url") or normalized in {"accesstoken", "refreshtoken", "idtoken", "workertoken", "authorization", "password", "secret", "awsaccesskeyid", "awssecretaccesskey", "awssessiontoken"}


def ensure_no_credentials(value: Any) -> None:
    if isinstance(value, dict):
        if any(sensitive_key(str(key)) for key in value):
            raise CampaignError("Campaign definitions must use owned IDs rather than credentials or private signed URLs.")
        for child in value.values():
            ensure_no_credentials(child)
    elif isinstance(value, list):
        for child in value:
            ensure_no_credentials(child)


def allocation_pending(row: dict[str, Any]) -> bool:
    receipt = row.get("hpc") or {}
    if not receipt:
        return False
    if receipt.get("state") == "submission-uncertain" or not receipt.get("schedulerJobId"):
        return True
    proof = row.get("hpcTerminalProof") or {}
    return not (proof.get("receiptSha256") == canonical_digest(receipt)
                and proof.get("scheduler") == receipt.get("scheduler")
                and proof.get("schedulerJobId") == receipt["schedulerJobId"]
                and proof.get("state") in SCHEDULER_TERMINAL)


def summary(state: dict[str, Any]) -> dict[str, Any]:
    counts = {}
    for row in state["rows"]:
        counts[row["state"]] = counts.get(row["state"], 0) + 1
    return {"campaignId": state["campaignId"], "rows": len(state["rows"]), "states": counts,
            "complete": all(row["state"] in TERMINAL and not allocation_pending(row) for row in state["rows"]),
            "needsAttention": any(row["state"] == "attention-required" or row.get("hpc", {}).get("state") == "submission-uncertain"
                                  or row["state"] in TERMINAL and allocation_pending(row) for row in state["rows"])}


def poll_broker(row: dict[str, Any], api: Any, endpoint: str, response_key: str) -> None:
    reply = api.request("GET", f"{endpoint}/{row['jobId']}")
    job = reply.get(response_key)
    if not isinstance(job, dict) or job.get("id") != row["jobId"]:
        raise CampaignError("Campaign API returned a different job identity.")
    row["jobStatus"] = str(job.get("status", "UNKNOWN")).lower()
    if row["jobStatus"] not in TERMINAL:
        return
    row["state"] = row["jobStatus"]
    row.pop("error", None)
    result = reply.get("result")
    if isinstance(result, dict):
        row["result"] = clean_result(result)
        row["resultSha256"] = canonical_digest(row["result"])
        if row["state"] == "completed" and (result.get("status") != "completed" or any((result.get("summary") or {}).get(key) is False for key in ("converged", "jobDone"))):
            row.update({"state": "failed", "error": "Scientific result did not pass its execution/convergence contract."})
    elif row["state"] == "completed":
        row.update({"state": "failed", "error": "Completed job has no retained result manifest; scientific evidence is unavailable."})
    row["brokerTerminalState"] = row["state"]
    row["resultEvidenceAvailable"] = isinstance(result, dict)
    row.setdefault("finishedAtEpoch", int(time.time()))


def poll_allocation(row: dict[str, Any]) -> None:
    import hpc
    receipt = row.get("hpc") or {}
    if not receipt.get("schedulerJobId"):
        row["hpcStatus"] = {"state": "unknown", "error": "Scheduler submission is uncertain; reconcile its receipt before retrying."}
        return
    try:
        observed = hpc.status(receipt["scheduler"], receipt["schedulerJobId"])
        if observed.get("schedulerJobId") != receipt["schedulerJobId"]:
            raise hpc.HpcError("Scheduler returned a different allocation identity.")
        row["hpcStatus"] = {**observed, "observedAtEpoch": int(time.time())}
        if observed.get("state") in SCHEDULER_TERMINAL:
            row["hpcTerminalProof"] = {**row["hpcStatus"], "scheduler": receipt["scheduler"],
                                       "receiptSha256": canonical_digest(receipt)}
    except hpc.HpcError:
        row["hpcStatus"] = {"schedulerJobId": receipt["schedulerJobId"], "state": "unknown", "error": "Scheduler status unavailable; inspect the cluster receipt."}


def cancellation_intent(row: dict[str, Any]) -> dict[str, Any]:
    return row.setdefault("cancellation", {"requestedAtEpoch": int(time.time()),
                                         "broker": {"acknowledged": False},
                                         "scheduler": {"acknowledged": False}})


def reconcile_cancellation(state: dict[str, Any], path: Path, api: Any, row: dict[str, Any]) -> None:
    """Each side effect has independent durable intent/ack; a broker terminal is not allocation proof."""
    import hpc
    endpoint, response_key = KINDS[state["kind"]][1:]
    intent = cancellation_intent(row)
    row["state"] = "cancel-requested"
    atomic_json(path, state)
    broker = intent["broker"]
    if row.get("jobStatus") in TERMINAL:
        broker.update({"acknowledged": True, "status": row["jobStatus"]})
        broker.pop("error", None)
    elif not broker.get("acknowledged"):
        try:
            api.request("POST", f"{endpoint}/{row['jobId']}/cancel", {})
            broker.update({"acknowledged": True, "acknowledgedAtEpoch": int(time.time())})
            broker.pop("error", None)
        except ApiError as exc:
            if exc.status == 409:
                # The cancel reply may have been lost after the owner API committed it.
                try:
                    poll_broker(row, api, endpoint, response_key)
                except CampaignError:
                    broker["error"] = "Broker cancellation conflict could not be reconciled with an owned job."
                if row.get("jobStatus") in TERMINAL:
                    broker.update({"acknowledged": True, "status": row["jobStatus"]})
                    broker.pop("error", None)
                else:
                    broker["error"] = "Broker cancellation conflict is not a terminal owned job."
            else:
                broker["error"] = f"Broker cancellation unavailable (HTTP {exc.status}); resume to reconcile."
        except CampaignError:
            broker["error"] = "Broker cancellation reply unavailable; resume to reconcile."
        atomic_json(path, state)
    receipt = row.get("hpc") or {}
    scheduler = intent["scheduler"]
    if receipt:
        poll_allocation(row)
        atomic_json(path, state)
        if receipt.get("schedulerJobId"):
            scheduler.update({"scheduler": receipt["scheduler"], "schedulerJobId": receipt["schedulerJobId"]})
            if allocation_pending(row) and not scheduler.get("acknowledged"):
                # A terminal status after a lost reply needs no duplicate cancellation command.
                scheduler["requestedAtEpoch"] = int(time.time())
                atomic_json(path, state)
                try:
                    hpc.cancel(receipt["scheduler"], receipt["schedulerJobId"])
                    scheduler.update({"acknowledged": True, "acknowledgedAtEpoch": int(time.time())})
                    scheduler.pop("error", None)
                except hpc.HpcError:
                    scheduler["error"] = "Scheduler cancellation reply unavailable; resume to reconcile its status."
                atomic_json(path, state)
                poll_allocation(row)
            scheduler["terminalVerified"] = not allocation_pending(row)
            if scheduler["terminalVerified"]:
                scheduler.pop("error", None)
            scheduler["state"] = row.get("hpcStatus", {}).get("state", "unknown")
        else:
            scheduler.update({"terminalVerified": False, "state": "unknown"})
    else:
        scheduler.update({"terminalVerified": True, "state": "not-applicable"})
    if allocation_pending(row) and (row.get("hpcStatus", {}).get("state") == "unknown" or scheduler.get("error")):
        row.update({"state": "attention-required", "error": "Allocation cancellation is unverified; inspect/reconcile the receipt. Its campaign slot remains occupied and retry is blocked."})
    elif broker.get("error"):
        row.update({"state": "attention-required", "error": broker["error"]})
    elif row.get("jobStatus") in TERMINAL and not allocation_pending(row):
        row["state"] = row.get("brokerTerminalState", row["jobStatus"])
        if row["state"] != "failed":
            row.pop("error", None)
    atomic_json(path, state)


def advance(state: dict[str, Any], path: Path, api: Any, hpc_profile: dict[str, Any] | None = None) -> dict[str, Any]:
    collection, endpoint, response_key = KINDS[state["kind"]]
    if state.get("hpcProfileSha256") and (hpc_profile is None or state["hpcProfileSha256"] != canonical_digest(hpc_profile)):
        raise CampaignError("Resume this HPC campaign with its original --hpc-profile; changing allocation/runtime requires a new campaign.")
    if hpc_profile is not None:
        import hpc
        grant = {"ranks": hpc_profile["nodes"] * hpc_profile["ranksPerNode"], "memoryMiB": hpc_profile["nodes"] * hpc_profile["memoryMiBPerNode"]}
        affinity = {"scheduler": hpc_profile["scheduler"], "profileSha256": canonical_digest(hpc_profile)}
        for row in state["rows"]:
            for field, expected in (("vcpus", grant["ranks"]), ("memoryMiB", grant["memoryMiB"])):
                if field in row["request"] and row["request"][field] != expected:
                    raise CampaignError(f"HPC template {field} must exactly match the explicit profile allocation ({expected}); inputs are never clamped.")
                row["request"][field] = expected
            requested_ranks = hpc.positive(row["request"].get("vcpus"), "HPC template vcpus")
            requested_memory = hpc.positive(row["request"].get("memoryMiB"), "HPC template memoryMiB", 1_073_741_824)
            hpc.validate_job_resources(grant, requested_ranks, requested_memory)
            if row["request"].get("executionAffinity") != affinity:
                if row["state"] != "planned" or row.get("jobId") or row["attempt"]:
                    raise CampaignError("HPC affinity must be set before the first submission; create a new campaign to change execution location.")
                row["request"]["executionAffinity"] = affinity
            row["requestSha256"] = canonical_digest(row["request"])
        state["hpcProfileSha256"] = canonical_digest(hpc_profile)
        atomic_json(path, state)
    for row in state["rows"]:
        if not row.get("jobId") or (row["state"] not in {"submitted", "cancel-requested", "attention-required"}
                                    and not allocation_pending(row)):
            continue
        if row["state"] == "cancel-requested" or row.get("jobStatus") == "cancelled" or row["state"] == "cancelled":
            cancellation_intent(row)
        if row.get("cancellation"):
            # Cleanup continues even when polling the broker fails or it is already terminal.
            try:
                poll_broker(row, api, endpoint, response_key)
                row["cancellation"]["broker"].pop("error", None)
            except CampaignError:
                row["cancellation"]["broker"]["error"] = "Broker status unavailable; resume cancellation reconciliation."
            reconcile_cancellation(state, path, api, row)
            continue
        poll_broker(row, api, endpoint, response_key)
        if row.get("hpc"):
            poll_allocation(row)
            cluster_state = row.get("hpcStatus", {}).get("state")
            if row["jobStatus"] not in TERMINAL and cluster_state in SCHEDULER_TERMINAL:
                row.update({"state": "attention-required", "error": "Scheduler allocation ended before the broker recorded a terminal result. Inspect receipt/checkpoints and cancel or reconcile the broker job; no scientific success/failure is inferred."})
            elif cluster_state == "unknown" and allocation_pending(row):
                row.update({"state": "attention-required", "error": "Scheduler allocation status is unavailable; its campaign slot remains occupied until terminal status is verified."})
            elif row["jobStatus"] in TERMINAL and allocation_pending(row):
                row.update({"state": "attention-required", "error": "Broker job is terminal but the scheduler allocation is not verified terminal; inspect/reconcile the receipt before retrying or releasing this campaign slot."})
        atomic_json(path, state)
    active = sum(row["state"] in {"submitted", "submitting", "cancel-requested", "attention-required"}
                 or allocation_pending(row) for row in state["rows"])
    for row in state["rows"]:
        if row["state"] not in {"planned", "submitting"}:
            continue
        if row["state"] == "planned" and active >= state["concurrency"]:
            break
        if row["state"] == "planned":
            row["state"] = "submitting"
            active += 1
            atomic_json(path, state)
        try:
            reply = api.request("POST", f"/v1/projects/{state['projectId']}/{collection}", row["request"])
        except ApiError as exc:
            if exc.status in {429, 503} or exc.code in {"ACTIVE_JOB_LIMIT", "QUEUE_LIMIT", "ACCOUNT_JOB_LIMIT", "ACTIVE_CALCULATION_LIMIT", "MD_ACTIVE_JOB_LIMIT", "MD_ANALYSIS_LIMIT", "MD_SIMULATION_LIMIT"}:
                row["lastErrorCode"] = exc.code
                atomic_json(path, state)
                break
            if exc.status >= 500:
                atomic_json(path, state)
                raise
            row.update({"state": "failed", "error": f"API rejected submission (HTTP {exc.status}).", "lastErrorCode": exc.code})
            active -= 1
            atomic_json(path, state)
            continue
        job = reply.get(response_key)
        if not isinstance(job, dict) or not isinstance(job.get("id"), str):
            raise CampaignError("Campaign submission returned no job identity; resume the same idempotency key.")
        row.update({"jobId": job["id"], "state": "submitted", "jobStatus": str(job.get("status", "UNKNOWN")).lower(), "submittedAtEpoch": int(time.time())})
        atomic_json(path, state)
        if hpc_profile is not None and row["jobStatus"] == "queued":
            import hpc
            directory = path.parent / f"{state['campaignId']}-hpc"
            # State records the intent before allocating. hpc.submit writes a
            # durable receipt before contacting sbatch/qsub and refuses repeats.
            row["hpc"] = {"state": "submission-uncertain", "profileSha256": canonical_digest(hpc_profile)}
            atomic_json(path, state)
            row["hpc"] = hpc.submit(hpc_profile, row["jobId"], directory)
            atomic_json(path, state)
    # Recover a scheduler receipt persisted just before a controller process died.
    if hpc_profile is not None:
        import hpc
        for row in state["rows"]:
            if row["state"] == "submitted" and row.get("jobStatus") == "queued" and not row.get("hpc"):
                directory = path.parent / f"{state['campaignId']}-hpc"
                row["hpc"] = {"state": "submission-uncertain", "profileSha256": canonical_digest(hpc_profile)}
                atomic_json(path, state)
                row["hpc"] = hpc.submit(hpc_profile, row["jobId"], directory)
            elif row.get("hpc", {}).get("state") == "submission-uncertain":
                receipt = path.parent / f"{state['campaignId']}-hpc" / f"{row['jobId']}.json"
                if receipt.is_file():
                    recorded = json.loads(receipt.read_text())
                    if recorded.get("state") == "submitted" and recorded.get("profileSha256") == canonical_digest(hpc_profile):
                        row["hpc"] = recorded
                    else:
                        row["error"] = "Scheduler submission is uncertain; reconcile its receipt against the cluster before resuming."
    atomic_json(path, state)
    return summary(state)


def retry_row(state: dict[str, Any], index: int, path: Path, reason: str) -> None:
    row = next((row for row in state["rows"] if row["index"] == index), None)
    if not row or row["state"] not in {"failed", "cancelled"}:
        raise CampaignError("Retry requires a failed/cancelled campaign row.")
    if allocation_pending(row):
        raise CampaignError("Retry is blocked until the prior scheduler allocation is verified terminal; advance/cancel to reconcile its retained receipt.")
    if row["attempt"] + 1 >= state["maxAttempts"]:
        raise CampaignError("Campaign row reached its attempt limit.")
    row["history"].append({key: clean_result(value) for key, value in row.items() if key not in {"history", "request"}})
    row["attempt"] += 1
    row["request"]["idempotencyKey"] = f"campaign_{state['definitionSha256'][:32]}_{index}_{row['attempt']}"
    row["requestSha256"] = canonical_digest(row["request"])
    for key in ("jobId", "result", "resultSha256", "resultEvidenceAvailable", "error", "jobStatus", "hpc", "hpcStatus", "hpcTerminalProof", "cancellation", "brokerTerminalState", "finishedAtEpoch", "lastErrorCode"):
        row.pop(key, None)
    row.update({"state": "planned", "retryReason": reason})
    atomic_json(path, state)


def cancel_rows(state: dict[str, Any], path: Path, api: Any, index: int | None = None) -> None:
    for row in state["rows"]:
        if index is not None and row["index"] != index:
            continue
        if row["state"] in TERMINAL and not allocation_pending(row):
            continue
        if row["state"] == "planned" and not row.get("jobId"):
            row["state"] = "cancelled"
            atomic_json(path, state)
        elif row.get("jobId"):
            reconcile_cancellation(state, path, api, row)
        else:
            raise CampaignError("Resolve uncertain API submission with advance before cancelling it.")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Create, submit, resume, retry, and inspect durable Phynite research campaigns.")
    parser.add_argument("action", choices=("create", "advance", "run", "status", "retry", "cancel", "export"))
    parser.add_argument("--state", type=Path, required=True)
    parser.add_argument("--definition", type=Path)
    parser.add_argument("--credentials", type=Path)
    parser.add_argument("--hpc-profile", type=Path)
    parser.add_argument("--row", type=int)
    parser.add_argument("--reason", default="Explicit researcher retry")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--poll-seconds", type=int, default=15)
    args = parser.parse_args(argv)
    if args.action == "create":
        if not args.definition:
            raise CampaignError("Create requires --definition.")
        print(json.dumps(summary(create(json.loads(args.definition.read_text()), args.state)), indent=2))
        return 0
    api = UserApi(args.credentials) if args.credentials else None
    profile = None
    if args.hpc_profile:
        import hpc
        profile = hpc.load_profile(args.hpc_profile)
    while True:
        with locked_state(args.state) as state:
            if args.action in {"advance", "run"}:
                if api is None:
                    raise CampaignError("Submission/polling requires --credentials.")
                result = advance(state, args.state, api, profile)
            elif args.action == "retry":
                if args.row is None:
                    raise CampaignError("Retry requires --row.")
                retry_row(state, args.row, args.state, args.reason)
                result = summary(state)
            elif args.action == "cancel":
                if api is None:
                    raise CampaignError("Cancel requires --credentials.")
                cancel_rows(state, args.state, api, args.row)
                result = summary(state)
            elif args.action == "export":
                if not args.output or args.output.exists():
                    raise CampaignError("Export requires a new --output path.")
                atomic_json(args.output, {"version": 1, "campaignId": state["campaignId"], "definitionSha256": state["definitionSha256"], "summary": summary(state),
                                          "rows": [{key: clean_result(value) for key, value in row.items() if key != "request"} for row in state["rows"]]}, overwrite=False)
                result = summary(state)
            else:
                result = summary(state)
        print(json.dumps(result, indent=2), flush=True)
        if args.action != "run" or result["complete"] or result["needsAttention"]:
            return 3 if args.action == "run" and result["needsAttention"] else 0
        time.sleep(max(2, min(60, args.poll_seconds)))


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (CampaignError, OSError, ValueError) as exc:
        print(f"Campaign failed: {exc}", file=sys.stderr)
        raise SystemExit(2)

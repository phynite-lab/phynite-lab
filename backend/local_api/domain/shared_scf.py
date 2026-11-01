"""Resolve a reusable SCF by immutable worker-verified artifact identity."""
from __future__ import annotations
import hashlib
import json
import re
from typing import Any
from backend.local_api.domain.dft_validation import dft_result_error, read_dft_manifest
from backend.local_api.domain.phynite_core import ApiError, require_owner_item


def normalized_scf_input(text: str) -> str:
    for name, value in (("outdir", "./tmp"), ("pseudo_dir", "./pseudo")):
        text = re.sub(rf"\b{name}\s*=\s*['\"][^'\"]*['\"]", f"{name} = '{value}'", text, count=1, flags=re.I)
    return text.rstrip() + "\n"


def verified_scf_reference(services: Any, owner: str, project: str, calculation_id: str) -> dict[str, Any]:
    job = require_owner_item(services, owner, "CALCULATION", calculation_id, "SCF_NOT_FOUND")
    def invalid(message: str) -> None:
        raise ApiError(409, message, "SCF_NOT_REUSABLE")
    if job.get("projectId") != project or job.get("calculationType") != "Total energy" or job.get("status") != "COMPLETED":
        invalid("Select a completed SCF in this project.")
    try:
        manifest = read_dft_manifest(services, job)
        if dft_result_error(manifest, "Total energy"):
            invalid("SCF convergence is unverified. Rerun the SCF before continuing.")
        bundle = manifest.get("provenance", {}).get("scfBundle", {})
        if bundle.get("version") != 1 or bundle.get("path") != "scf-state.tar.gz" or bundle.get("calculationId") != calculation_id:
            invalid("This SCF has no reusable state bundle. Enable saved QE state and rerun SCF.")
        if any(not re.fullmatch(r"[a-f0-9]{64}", str(bundle.get(field, ""))) for field in ("sha256", "inputSha256", "runtimeFingerprint")):
            invalid("SCF bundle identity is incomplete.")
        from backend.local_api.domain.worker_artifacts import WorkerArtifacts
        WorkerArtifacts(services).verify(job, bundle["path"], int(bundle["sizeBytes"]), bundle["sha256"])
        return {"version": 1, "calculationId": calculation_id, "bundlePath": bundle["path"], "bundleSha256": bundle["sha256"], "inputSha256": bundle["inputSha256"], "runtimeFingerprint": bundle["runtimeFingerprint"], "manifestSha256": hashlib.sha256(json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()).hexdigest()}
    except ApiError:
        raise
    except Exception as exc:
        raise ApiError(409, "SCF state is missing, expired, or failed checksum verification. Rerun SCF.", "SCF_NOT_REUSABLE") from exc


def validate_shared_scf_submission(services: Any, owner: str, project: str, settings: dict[str, Any], dependencies: list[dict[str, Any]], input_files: dict[str, str]) -> dict[str, Any] | None:
    supplied = settings.get("sharedScf")
    if supplied is None:
        return None
    if not isinstance(supplied, dict):
        raise ApiError(400, "Shared SCF reference is invalid.", "INVALID_SHARED_SCF")
    reference = verified_scf_reference(services, owner, project, str(supplied.get("calculationId", "")))
    if supplied != reference or reference["calculationId"] not in {item["id"] for item in dependencies}:
        raise ApiError(409, "Shared SCF identity changed. Review the run plan again.", "INVALID_SHARED_SCF")
    # Generated branches must inherit the exact SCF input. Model changes require
    # a visible new SCF node, not a silently altered downstream Hamiltonian.
    scf_input = input_files.get("scf.in", "")
    if hashlib.sha256(normalized_scf_input(scf_input).encode()).hexdigest() != reference["inputSha256"]:
        raise ApiError(409, "Branch SCF parameters differ from the source. Inherit the source SCF or create a variant.", "SCF_MODEL_MISMATCH")
    return reference


def inherited_scf_error(services: Any, job: dict[str, Any], manifest: dict[str, Any]) -> str | None:
    """A consumer's claimed convergence must equal its retained source evidence."""
    inherited = [stage for stage in manifest.get("summary", {}).get("stageConvergence", []) if stage.get("execution") == "inherited"]
    if not inherited and not job.get("requiresWorkflowVersion"):
        return None
    original = json.loads(services.s3.get_object(Bucket=services.bucket, Key=job["inputKey"])["Body"].read(8_000_001))
    supplied = original.get("settings", {}).get("sharedScf")
    if not supplied and not inherited:
        return None
    if not supplied or len(inherited) != 1:
        return "Shared SCF consumer must retain exactly one inherited source stage."
    reference = verified_scf_reference(services, job["ownerId"], job["projectId"], inherited[0].get("sourceCalculationId", ""))
    if supplied != reference or inherited[0].get("sourceBundleSha256") != reference["bundleSha256"]:
        return "Inherited SCF does not match its verified submitted source."
    source = require_owner_item(services, job["ownerId"], "CALCULATION", reference["calculationId"], "SCF_NOT_FOUND")
    source_manifest = read_dft_manifest(services, source)
    source_stage = next(stage for stage in source_manifest["summary"]["stageConvergence"] if stage["stage"] == "scf")
    metadata = {"execution", "sourceCalculationId", "sourceBundleSha256", "log", "inputFile"}
    if {key: value for key, value in inherited[0].items() if key not in metadata} != {key: value for key, value in source_stage.items() if key not in metadata}:
        return "Inherited SCF convergence values differ from the original evidence."
    return None

from __future__ import annotations

import json
import os
import platform
import time
import traceback
from pathlib import Path
from typing import Any

from results import build_scientific_results, write_result_manifest
from qe_model import dft_result_error, qe_runtime_identity, software_version, validate_qe_models
from scientific_runner import (
    create_bundle,
    restore_bundle,
    DATA,
    INPUT,
    LOGS,
    OUTPUT,
    PSEUDO,
    SCRATCH,
    WORK,
    QeConvergenceError,
    failed_scientific_results,
    attach_reusable_workspace,
    apply_dependency_structure,
    copy_raw_outputs,
    execute_workflow,
    attach_scf_bundle,
    prepare_shared_scf,
    executed_structure_evidence,
    persist_executed_inputs,
    prepare_automatic_k_path,
    resolve_input_files,
    utc_now,
)


def _version(command: list[str]) -> str:
    return software_version(command)


def _provenance() -> dict[str, Any]:
    return {
        "executionMode": os.environ.get("PHYNITE_EXECUTION_MODE", "local-docker"),
        "operatingSystem": platform.system(),
        "architecture": platform.machine(),
        "parallelMode": os.environ.get("PHYNITE_QE_PARALLEL_MODE", "auto"),
        **qe_runtime_identity(PSEUDO),
    }


def main() -> int:
    calculation_id = os.environ.get("PHYNITE_CALCULATION_ID", "local-reference")
    vcpus = max(1, int(os.environ.get("PHYNITE_VCPUS", "2")))
    started_at = utc_now()
    started = time.monotonic()
    steps: list[dict[str, Any]] = []
    calculation_type = "Unknown"
    for directory in (OUTPUT, LOGS, DATA, PSEUDO, SCRATCH):
        directory.mkdir(parents=True, exist_ok=True)

    try:
        payload = json.loads(INPUT.read_text(encoding="utf-8"))
        calculation_type = str(payload["calculationType"])
        settings = payload.get("settings") if isinstance(payload.get("settings"), dict) else {}
        settings = dict(settings)
        if os.environ.get("PHYNITE_RESUME_SCF") == "1":
            settings["_resumeScf"] = True
        if os.environ.get("PHYNITE_RESUME_NSCF") == "1":
            settings["_resumeNscf"] = True
        input_files = resolve_input_files(payload)
        model_identity = validate_qe_models(input_files, PSEUDO)
        structure_source = apply_dependency_structure(input_files, settings)
        if payload.get("scfSource") and settings.get("sharedScf"):
            raise RuntimeError("Choose exactly one SCF source protocol for this calculation.")
        settings.pop("_verifiedScfReuse", None)
        prepare_shared_scf(WORK, SCRATCH, OUTPUT, PSEUDO, settings, input_files)
        if payload.get("scfSource"):
            settings["_verifiedScfReuse"] = restore_bundle(WORK, OUTPUT, PSEUDO, input_files, payload["scfSource"], vcpus, calculation_type)
        reciprocal_path = prepare_automatic_k_path(calculation_type, input_files, settings)
        input_artifacts = persist_executed_inputs(input_files)
        steps.extend(execute_workflow(calculation_type, input_files, settings, vcpus))
        raw_artifacts = copy_raw_outputs()
        result_settings = {**settings, "_reciprocalPath": reciprocal_path} if reciprocal_path else settings
        scientific = build_scientific_results(calculation_type, WORK, OUTPUT, result_settings)
        scientific["artifacts"] = [*input_artifacts, *scientific["artifacts"], *raw_artifacts]
        scientific["provenance"].update(_provenance())
        scientific["provenance"]["modelIdentity"] = model_identity
        scientific["provenance"]["workflowSettings"] = settings
        scientific["provenance"]["executedStructure"] = executed_structure_evidence(input_files)
        resolved_pseudos = settings.get("resolvedPseudopotentials")
        if isinstance(resolved_pseudos, list):
            scientific["provenance"]["resolvedPseudopotentials"] = resolved_pseudos
        qe_parameter_resolution = settings.get("qeParameterResolution")
        if isinstance(qe_parameter_resolution, dict):
            scientific["provenance"]["qeParameterResolution"] = qe_parameter_resolution
        reference_structure = settings.get("referenceStructure")
        if isinstance(reference_structure, dict):
            scientific["provenance"]["referenceStructure"] = reference_structure
        if reciprocal_path:
            scientific["provenance"]["reciprocalPath"] = reciprocal_path
        if structure_source:
            scientific["provenance"]["structureSource"] = structure_source

        attach_reusable_workspace(scientific, SCRATCH, OUTPUT)
        if settings.get("_verifiedScfReuse"):
            scientific["provenance"]["scfReuse"] = settings["_verifiedScfReuse"]
        if calculation_type == "Total energy" and settings.get("retainScfBundle"):
            bundle = create_bundle(WORK, OUTPUT, PSEUDO, calculation_id, vcpus)
            scientific["provenance"]["scfBundle"] = bundle
            scientific["artifacts"].append({"path": bundle["path"], "label": "Verified reusable SCF state", "role": "scf-workspace", "contentType": "application/gzip"})
        elif calculation_type == "Total energy":
            attach_scf_bundle(scientific, calculation_id, SCRATCH, OUTPUT, PSEUDO)
        result = {
            "version": 2,
            "calculationId": calculation_id,
            "calculationType": calculation_type,
            "status": "completed",
            "startedAt": started_at,
            "completedAt": utc_now(),
            "elapsedSeconds": round(time.monotonic() - started, 3),
            "steps": steps,
            **scientific,
        }
        failure = dft_result_error(result, calculation_type)
        if failure:
            raise RuntimeError(failure)
        (WORK / "CRASH").unlink(missing_ok=True)
        write_result_manifest(OUTPUT / "result.json", result)
        return 0
    except Exception as exc:
        if isinstance(exc, QeConvergenceError):
            steps.extend([*exc.previous_steps, exc.step])
        scientific = failed_scientific_results(calculation_type)
        result = {
            "version": 2,
            "calculationId": calculation_id,
            "status": "failed",
            "calculationType": calculation_type,
            **scientific,
            "startedAt": started_at,
            "completedAt": utc_now(),
            "elapsedSeconds": round(time.monotonic() - started, 3),
            "steps": steps,
            "error": str(exc),
            "trace": traceback.format_exc(limit=8),
        }
        write_result_manifest(OUTPUT / "result.json", result)
        print(result["trace"])
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

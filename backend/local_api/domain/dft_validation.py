"""DFT admission and retained scientific evidence; no solver/runtime dependency."""
from __future__ import annotations

import hashlib
import json
import math
import re
from typing import Any


def transport_numbers(settings: dict[str, Any]) -> dict[str, float]:
    # Keep the API and compute.qe_model numeric contract identical. Each is
    # deployed independently: Lambda does not contain scientific dependencies.
    specs = (
        ("transportInterpolationMultiplier", "interpolationMultiplier", 3, 1, 12, True),
        ("transportEnergyBins", "energyBins", 5000, 500, 50000, True),
        ("transportTemperatureMin", "temperatureMin", 100, 1, 9007199254740991, True),
        ("transportTemperatureMax", "temperatureMax", 900, 1, 9007199254740991, True),
        ("transportTemperatureStep", "temperatureStep", 50, 1, 9007199254740991, True),
        ("transportRelaxationTime", "relaxationTimeFs", 10, 0, math.inf, False),
        ("transportChemicalPotentialMin", "chemicalPotentialMin", -.5, -math.inf, math.inf, False),
        ("transportChemicalPotentialMax", "chemicalPotentialMax", .5, -math.inf, math.inf, False),
        ("transportInterpolationEnergyMin", "interpolationEnergyMin", -.2 * 27.211386245988, -math.inf, math.inf, False),
        ("transportInterpolationEnergyMax", "interpolationEnergyMax", .2 * 27.211386245988, -math.inf, math.inf, False),
    )
    resolved = {}
    for name, alias, default, minimum, maximum, integer in specs:
        supplied = [settings[key] for key in (name, alias) if key in settings]
        for value in supplied:
            try:
                finite = isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
            except OverflowError:
                finite = False
            if not finite:
                raise ValueError(f"{name} must be a finite number")
            if (integer and (not float(value).is_integer() or value < minimum or value > maximum)) or (not integer and (value < minimum or value > maximum)):
                bounds = f" from {minimum:g} to {maximum:g}" if integer else ""
                raise ValueError(f"{name} must be {'an integer' if integer else 'a number'}{bounds}")
        if len(supplied) == 2 and supplied[0] != supplied[1]:
            raise ValueError(f"Conflicting transport values: {name} and {alias}")
        resolved[name] = supplied[0] if supplied else default
    if resolved["transportRelaxationTime"] <= 0:
        raise ValueError("Transport relaxation time must be a finite positive value in fs")
    if resolved["transportTemperatureMax"] < resolved["transportTemperatureMin"]:
        raise ValueError("Transport maximum temperature must be at least the minimum temperature")
    for minimum, maximum, label in (("transportChemicalPotentialMin", "transportChemicalPotentialMax", "chemical-potential"), ("transportInterpolationEnergyMin", "transportInterpolationEnergyMax", "band-interpolation")):
        if resolved[minimum] >= resolved[maximum]:
            raise ValueError(f"The transport {label} window must have a finite minimum below its maximum")
    return resolved



def validate_transport_settings(settings: dict[str, Any]) -> None:
    transport_numbers(settings)
    model = settings.get("transportScatteringModel", "constant-relaxation-time")
    if model != "constant-relaxation-time":
        raise ValueError("Only constant-relaxation-time transport is supported. Mean-free-path normalization is not validated; select constant relaxation time.")
    if settings.get("transportSampling", "chemical-potential") != "chemical-potential":
        raise ValueError("Carrier-doping transport sampling is not supported; use the chemical-potential integration window.")
    unsupported = ("transportChemicalPotentialStep", "chemicalPotentialStep", "transportDopingMin", "transportDopingMax", "transportDopingPoints", "dopingMin", "dopingMax", "dopingPoints", "dopingRangeMin", "dopingRangeMax")
    supplied = [key for key in unsupported if settings.get(key) is not None]
    if supplied:
        raise ValueError("Unsupported transport settings would be ignored: " + ", ".join(supplied) + ". Remove them; energy bins control chemical-potential sampling.")


def strip_qe_comments(text: str) -> str:
    # A ! inside a quoted QE string belongs to its value, not a comment.
    return re.sub(r"('[^']*(?:''[^']*)*'|\"[^\"]*(?:\"\"[^\"]*)*\")|![^\n]*", lambda match: match.group(1) or "", text)


def qe_string_value(text: str, namelist: str, key: str, default: str, *, lowercase: bool = True) -> str:
    tokens = re.findall(r"'(?:''|[^'])*'|\"(?:\"\"|[^\"])*\"|[A-Za-z_][A-Za-z0-9_]*|[&/=,]", strip_qe_comments(text))
    active = False
    value = default
    for index, token in enumerate(tokens):
        if token == "&":
            active = index + 1 < len(tokens) and tokens[index + 1].lower() == namelist.lower()
        elif token == "/":
            active = False
        elif active and token.lower() == key.lower() and index + 2 < len(tokens) and tokens[index + 1] == "=" and tokens[index + 2][0] in "\"'":
            value = tokens[index + 2][1:-1].strip()
            if lowercase:
                value = value.lower()
    return value


def validate_band_postprocessor_input(input_files: dict[str, str], calculation_type: str) -> None:
    if calculation_type != "Band structure":
        return
    for name, content in input_files.items():
        # Mask whole strings before locating numeric assignments. Quoted titles
        # and comments must never impersonate SYSTEM settings or terminators.
        clean = re.sub(r"'(?:''|[^'])*'|\"(?:\"\"|[^\"])*\"", "''", strip_qe_comments(content))
        system = re.search(r"&SYSTEM\b([^/]*)/", clean, re.I)
        totals = re.findall(r"\btot_magnetization\s*=\s*([-+0-9.eEdD]+)", system.group(1), re.I) if system else []
        total = float(totals[-1].replace('D', 'e').replace('d', 'e')) if totals else -10000.0
        constraint = qe_string_value(content, "SYSTEM", "constrained_magnetization", "none")
        if total != -10000.0 or constraint != "none":
            raise ValueError(f"{name}: QE 7.5 bands.x does not support constrained magnetization. Select unconstrained magnetization for this band workflow; keep the constrained SCF as a separate calculation.")


def validate_relaxation_input(input_files: dict[str, str]) -> None:
    for name, content in input_files.items():
        if qe_string_value(content, "CONTROL", "calculation", "scf") != "vc-relax":
            continue
        cell = qe_string_value(content, "CELL", "cell_dynamics", "bfgs")
        ion = qe_string_value(content, "IONS", "ion_dynamics", "bfgs")
        required = "bfgs" if cell == "bfgs" else "damp" if cell in {"damp-pr", "damp-w", "none"} else None
        if required is not None and ion != required:
            raise ValueError(f"{name}: QE 7.5 vc-relax with cell_dynamics='{cell}' ignores ion_dynamics='{ion}'. Select ion_dynamics='{required}', or use fixed-cell relax for the requested ion algorithm.")


def relaxation_result_error(manifest: Any) -> str | None:
    return dft_result_error(manifest, "Structural relaxation")


def read_dft_manifest(services: Any, item: dict[str, Any]) -> dict[str, Any]:
    if not item.get("outputPrefix"):
        raise ValueError("DFT calculation has no retained result manifest. Rerun it before reusing its result.")
    raw = services.s3.get_object(Bucket=services.bucket, Key=f"{item['outputPrefix']}/result.json")["Body"].read(8_000_001)
    if len(raw) > 8_000_000:
        raise ValueError("DFT result manifest exceeds the verification limit.")
    manifest = json.loads(raw)
    if not isinstance(manifest, dict) or manifest.get("calculationId") != item.get("id"):
        raise ValueError("DFT result manifest does not match its calculation.")
    return manifest


def dft_convergence_summary(manifest: dict[str, Any]) -> dict[str, Any]:
    source = manifest.get("summary")
    if not isinstance(source, dict):
        return {}
    summary = {key: source[key] for key in ("converged", "geometryConverged", "jobDone") if key in source}
    stages = source.get("stageConvergence")
    if isinstance(stages, list):
        summary["stageConvergence"] = [{key: stage[key] for key in ("stage", "calculationMode", "jobDone", "electronicConvergence", "ionicConvergence", "cellConvergence", "phononResponseConvergence", "solverError", "stoppingReason", "scfAccuracy", "hybridConvergence", "hybridFunctional", "exchangeResidualRy", "scfResidualRy", "thresholds", "pathConverged", "maximumPathErrorEvAngstrom", "pathThresholdEvAngstrom", "imageConvergence") if key in stage} for stage in stages[:12] if isinstance(stage, dict)]
    return summary


def dependency_relaxation_error(services: Any, item: dict[str, Any]) -> str | None:
    if item.get("calculationType") != "Structural relaxation":
        return None
    try:
        return relaxation_result_error(read_dft_manifest(services, item))
    except Exception:
        return "Structural-relaxation convergence could not be verified from its retained result manifest. Rerun the relaxation before reusing its structure."


DFT_REQUIRED_STAGES = {
    "Nudged elastic band": {"neb"},
    "Total energy": {"scf"},
    "Structural relaxation": {"relax"},
    "Band structure": {"scf", "bands-nscf", "bands-postprocess"},
    "Density of states": {"scf", "dos-nscf"},
    "Phonon dispersion": {"scf", "phonon", "force-constants", "phonon-dispersion"},
    "Thermoelectric properties": {"scf", "nscf-transport"},
}
DFT_STAGE_MODES = {"neb": {"neb"}, "scf": {"scf"}, "relax": {"relax", "vc-relax"},
                   "bands-nscf": {"bands", "nscf"}, "dos-nscf": {"nscf"},
                   "nscf-transport": {"nscf"}, "phonon": {"phonon"}}
DFT_POSTPROCESSORS = {"bands-postprocess", "dos-postprocess", "projected-dos", "projected-bands", "force-constants", "phonon-dispersion"}


def scf_accuracy_error(stage: dict[str, Any]) -> str | None:
    accuracy = stage.get("scfAccuracy")
    if not isinstance(accuracy, dict) or accuracy.get("status") != "verified":
        return "SCF numerical residual against the effective threshold is failed or unverified"
    residual, upper, threshold = (accuracy.get(key) for key in ("residualRy", "residualUpperRy", "thresholdRy"))
    if not all(isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) for value in (residual, upper, threshold)) or not 0 <= residual <= upper < threshold:
        return "SCF numerical residual does not satisfy its finite positive effective threshold"
    if accuracy.get("source") not in {"qe-stage-xml", "qe-log-bound"}:
        return "SCF numerical evidence has an unknown source"
    if accuracy.get("source") == "qe-stage-xml" and (not isinstance(accuracy.get("xmlPath"), str) or not re.fullmatch(r"[a-f0-9]{64}", str(accuracy.get("xmlSha256", "")))):
        return "SCF stage XML identity was not retained"
    hybrid = stage.get("hybridConvergence")
    if hybrid not in {"converged", "not-applicable"} or (stage.get("hybridFunctional") is True and hybrid != "converged"):
        return "Hybrid EXX outer-loop self-consistency is failed or unverified"
    return None


def qe_stage_error(stage: Any) -> str | None:
    """Positive method-specific evidence; process exit alone is insufficient."""
    if not isinstance(stage, dict) or stage.get("jobDone") is not True:
        return "Solver completion (JOB DONE) was not positively reported"
    name, mode = stage.get("stage"), stage.get("calculationMode")
    if not isinstance(name, str) or (name not in DFT_STAGE_MODES and name not in DFT_POSTPROCESSORS):
        return "Unknown solver stage cannot be scientifically verified"
    if stage.get("solverError") is True:
        return "Solver reported an error"
    if name == "neb":
        rows = stage.get("imageConvergence")
        threshold, error = stage.get("pathThresholdEvAngstrom"), stage.get("maximumPathErrorEvAngstrom")
        if mode != "neb" or stage.get("pathConverged") is not True or not all(isinstance(v,(int,float)) and not isinstance(v,bool) and math.isfinite(v) for v in (threshold,error)) or not 0 <= error <= threshold or threshold <= 0 or not isinstance(rows,list) or not 3 <= len(rows) <= 32 or any(not isinstance(r,dict) for r in rows) or [r.get("image") for r in rows] != list(range(1,len(rows)+1)) or any(r.get("electronicConverged") is not True or scf_accuracy_error(r) is not None or not re.fullmatch(r"[a-f0-9]{64}",str(r.get("sha256",""))) for r in rows):
            return "NEB needs a converged numerical path and retained electronic evidence for every image"
        return None
    if name in DFT_POSTPROCESSORS:
        return None if mode is None else "Postprocessor has an unexpected calculation mode"
    if not isinstance(mode, str) or mode not in DFT_STAGE_MODES[name]:
        return "Solver stage calculation mode does not match its workflow"
    if name == "phonon":
        return None if stage.get("phononResponseConvergence") == "converged" else "Phonon response convergence was not positively reported for every calculated representation"
    expected = "diagonalization-completed" if mode in {"nscf", "bands"} else "converged"
    if stage.get("electronicConvergence") != expected:
        return f"Electronic convergence must be {expected}; reported {stage.get('electronicConvergence', 'unknown')}"
    if mode in {"scf", "relax", "vc-relax"}:
        failure = scf_accuracy_error(stage)
        if failure:
            return failure
    if mode in {"relax", "vc-relax"}:
        cell = "converged" if mode == "vc-relax" else "not-applicable"
        if stage.get("ionicConvergence") != "converged" or stage.get("cellConvergence") != cell:
            return "Structural relaxation has no positive ionic and cell convergence evidence"
    return None


def dft_result_error(manifest: Any, calculation_type: str | None = None) -> str | None:
    """Fail closed for unknown/historical evidence and incomplete workflows."""
    message = "DFT result has no complete positive solver convergence evidence. Inspect retained inputs/logs, correct the failed stage, and rerun before reusing this result."
    if not isinstance(manifest, dict) or manifest.get("status") != "completed":
        return message
    summary = manifest.get("summary")
    if not isinstance(summary, dict) or summary.get("converged") is not True or summary.get("jobDone") is not True:
        return message
    stages = summary.get("stageConvergence")
    if not isinstance(stages, list) or not stages or any(not isinstance(stage, dict) for stage in stages):
        return message
    provenance = manifest.get("provenance")
    supplied_type = manifest.get("calculationType") or (provenance.get("calculationType") if isinstance(provenance, dict) else None)
    if calculation_type and supplied_type and calculation_type != supplied_type:
        return "DFT result calculation type does not match the submitted workflow"
    calculation_type = calculation_type or supplied_type
    # Retained relaxation manifests from before calculationType was recorded.
    if calculation_type is None and len(stages) == 1 and stages[0].get("stage") == "relax":
        calculation_type = "Structural relaxation"
    if not isinstance(calculation_type, str):
        return message
    required = DFT_REQUIRED_STAGES.get(calculation_type)
    names = [stage.get("stage") for stage in stages]
    allowed = required | {"dos-postprocess", "projected-dos"} if calculation_type == "Density of states" and required is not None else required
    if calculation_type == "Band structure" and required is not None:
        allowed = required | {"projected-bands"}
    if required is None or any(not isinstance(name, str) for name in names) or len(names) != len(set(names)) or not required.issubset(names) or not set(names).issubset(allowed):
        return message
    if calculation_type == "Density of states" and not {"dos-postprocess", "projected-dos"}.intersection(names):
        return "Density-of-states workflow has no completed DOS postprocessor"
    for stage in stages:
        if stage.get("execution") == "inherited":
            if stage.get("stage") != "scf" or not re.fullmatch(r"[A-Za-z0-9_-]{1,96}", str(stage.get("sourceCalculationId", ""))) or not re.fullmatch(r"[a-f0-9]{64}", str(stage.get("sourceBundleSha256", ""))):
                return "Inherited SCF evidence has no immutable source identity"
        failure = qe_stage_error(stage)
        if failure:
            return f"{stage.get('stage', 'unknown')}: {failure}. Inspect its retained solver log and rerun."
    if calculation_type == "Structural relaxation" and summary.get("geometryConverged") is not True:
        return message
    return None


def dependency_dft_error(services: Any, item: dict[str, Any]) -> str | None:
    try:
        manifest = read_dft_manifest(services, item)
        failure = dft_result_error(manifest, item.get("calculationType"))
        if failure:
            return failure
        if any(stage.get("execution") == "inherited" for stage in manifest.get("summary", {}).get("stageConvergence", [])):
            from backend.local_api.domain.shared_scf import inherited_scf_error
            return inherited_scf_error(services, item, manifest)
        return None
    except Exception:
        return "DFT convergence could not be verified from its retained result manifest. Inspect its logs and rerun before reusing its result."


def scf_input_identity(text: str) -> str:
    """Conservative SCF identity. Preserve unknown variables/cards and their order.

    Only whole-line execution labels/paths are omitted; compact expert input
    remains exact. Scientific whitespace inside quoted values is retained.
    """
    tokens = re.findall(r"'(?:[^']|'')*'|\"(?:[^\"]|\"\")*\"|![^\n]*|[^\s'\"!]+", text)
    clean = " ".join(token for token in tokens if not token.startswith("!"))
    for name in ("title", "prefix", "outdir", "pseudo_dir"):
        # Labels are only canonicalized in the CONTROL namelist, before cards.
        control = re.search(r"&CONTROL\b(.*?)(?<!['\"])/(?![^'\"]*['\"])", clean, re.I)
        if control:
            body = re.sub(r"\b" + name + r"\s*=\s*(?:'(?:[^']|'')*'|\"(?:[^\"]|\"\")*\")\s*,?", "", control.group(1), flags=re.I)
            clean = clean[:control.start(1)] + body + clean[control.end(1):]
    return hashlib.sha256(re.sub(r"\s+", " ", clean).strip().encode("utf-8")).hexdigest()

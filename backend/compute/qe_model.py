"""Inspect the model actually read by QE; no inference from UPF filenames."""
from __future__ import annotations

import hashlib
import importlib.metadata
import json
import math
import os
import re
import shutil
import subprocess
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any


# IUPAC atomic-number order. Structure provenance must not require ASE merely
# to identify chemical symbols in otherwise supported explicit QE cards.
ELEMENTS = ("H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og").split()
ATOMIC_NUMBERS = {element: index + 1 for index, element in enumerate(ELEMENTS)}


def parse_upf_header(path: Path) -> dict[str, Any]:
    text = path.read_text(encoding="utf-8", errors="replace")
    match = re.search(r"<PP_HEADER\b[^>]*>", text)
    if not match:
        raise ValueError(f"{path.name} has no readable UPF PP_HEADER; install a valid UPF file")
    opening = match.group(0)
    if re.search(r"\belement\s*=", opening):
        try:
            node = ET.fromstring(opening if opening.endswith("/>") else opening + "</PP_HEADER>")
        except ET.ParseError as exc:
            raise ValueError(f"{path.name} has an invalid UPF PP_HEADER") from exc
        attributes = node.attrib
        element = attributes.get("element", "").strip()
        functional = attributes.get("functional", "").strip()
        pseudo_type = attributes.get("pseudo_type", "").strip()
        relativity = attributes.get("relativistic", "unknown").strip().lower()
        has_so = attributes.get("has_so", "").strip().lower().strip(".") in {"t", "true"}
        valence_text = attributes.get("z_valence", "")
        version = "2"
    else:
        # UPF v1 stores typed header fields in a fixed order rather than XML
        # attributes. Preserve its XC identifiers instead of guessing a label.
        closing = text.find("</PP_HEADER>", match.end())
        lines = [line.rstrip() for line in text[match.end():closing].splitlines() if line.strip()]
        if closing < 0 or len(lines) < 6:
            raise ValueError(f"{path.name} has an incomplete legacy UPF header")
        element, pseudo_type = lines[1].split()[0], lines[2].split()[0]
        # QE's legacy reader takes exactly the first twenty columns as XC.
        functional = lines[4][:20].strip()
        valence_text = lines[5].split()[0]
        info = text[:match.start()].lower()
        has_so = bool(re.search(r"<PP_(?:SPIN_ORB|ADDINFO)\b", text))
        relativity = "full" if has_so else ("scalar" if "scalar-relativistic" in info else "unknown")
        version = "1"
    try:
        valence = float(valence_text.replace("D", "E").replace("d", "e"))
    except ValueError as exc:
        raise ValueError(f"{path.name} has no valid UPF valence charge") from exc
    if element not in ATOMIC_NUMBERS or not functional or not pseudo_type or not math.isfinite(valence) or valence <= 0:
        raise ValueError(f"{path.name} has an incomplete UPF model identity")
    return {"element": element, "functional": functional, "relativity": relativity,
            "hasSpinOrbit": has_so, "valenceElectrons": valence,
            "pseudopotentialType": pseudo_type, "upfHeaderVersion": version}


def validate_qe_models(input_files: dict[str, str], pseudo_dir: Path) -> list[dict[str, Any]]:
    validate_relaxation_input(input_files)
    models: dict[tuple[str, str], dict[str, Any]] = {}
    for filename, content in input_files.items():
        clean = "\n".join(line.split("!", 1)[0] for line in content.splitlines())
        if not re.search(r"&SYSTEM\b", clean, re.I):
            continue
        soc = bool(re.search(r"\blspinorb\s*=\s*\.(?:true|t)\.", clean, re.I))
        input_models: list[dict[str, Any]] = []
        species = re.search(r"(?im)^\s*ATOMIC_SPECIES\s*$", clean)
        if species is None:
            continue
        for line in clean[species.end():].splitlines():
            fields = line.split()
            if not fields:
                continue
            if len(fields) != 3 or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", fields[0]):
                break
            try:
                float(fields[1])
            except ValueError:
                break
            label, pseudo_filename = fields[0], fields[2]
            if Path(pseudo_filename).name != pseudo_filename:
                raise ValueError(f"{filename}: pseudopotential must use a local filename")
            path = pseudo_dir / pseudo_filename
            if not path.is_file():
                raise ValueError(f"{filename}: required UPF {pseudo_filename} is missing")
            header = parse_upf_header(path)
            symbol = re.match(r"[A-Z][a-z]?", label)
            if symbol is None or symbol.group(0) != header["element"]:
                raise ValueError(f"{filename}: species {label} does not match UPF element {header['element']}")
            input_models.append(header)
            functional = re.search(r"\binput_dft\s*=\s*['\"]([^'\"]+)['\"]", clean, re.I)
            previous = models.get((label, pseudo_filename), {})
            requested_by_input = {**previous.get("requestedFunctionalByInput", {}), filename: functional.group(1) if functional else "UPF default"}
            models[(label, pseudo_filename)] = {"atomicLabel": label, "filename": pseudo_filename,
                "requestedFunctionalByInput": requested_by_input,
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), **header,
                "requestedFunctional": functional.group(1) if functional else "UPF default",
                "functionalPairing": "explicit input_dft override" if functional else "UPF default",
                "compatibilityScope": "element and SOC capability; physical model suitability requires study validation"}
        # QE supports mixed scalar/full-relativistic models. With all scalar
        # models lspinorb requests a noncollinear calculation without actual SOC.
        if soc and not any(header["relativity"] == "full" and header["hasSpinOrbit"] for header in input_models):
            raise ValueError(f"{filename}: SOC requires at least one fully relativistic UPF with spin-orbit data; all-scalar models have no SOC")
        functional = re.search(r"\binput_dft\s*=\s*['\"]([^'\"]+)['\"]", clean, re.I)
        hybrid = functional is not None and bool(re.match(r"^(?:HSE|PBE0|B3LYP|HF)", functional.group(1), re.I))
        augmented = any(header["pseudopotentialType"].upper() in {"US", "USPP", "PAW"} for header in input_models)
        mode = re.search(r"\bcalculation\s*=\s*['\"]([^'\"]+)['\"]", clean, re.I)
        noncollinear = bool(re.search(r"\bnoncolin\s*=\s*\.(?:true|t)\.", clean, re.I))
        if hybrid and augmented and mode and mode.group(1).lower() in {"relax", "vc-relax", "md", "vc-md"}:
            raise ValueError(f"{filename}: QE 7.5 hybrid relaxation/dynamics with US/PAW models is unsupported; select a compatible validated method/model")
        if hybrid and augmented and noncollinear:
            raise ValueError(f"{filename}: QE 7.5 noncollinear hybrid calculations with US/PAW models are unsupported")
    return list(models.values())


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


def software_version(command: list[str]) -> str:
    if not shutil.which(command[0]):
        return "not installed"
    attempts = [(command, 30)]
    raw_launcher = os.environ.get("PHYNITE_MPI_LAUNCHER", "").strip()
    if Path(command[0]).name == "pw.x" and raw_launcher:
        try:
            launcher_args = json.loads(raw_launcher)
        except (ValueError, TypeError):
            launcher_args = None
        if isinstance(launcher_args, list) and launcher_args and all(isinstance(arg, str) and arg for arg in launcher_args):
            single_rank = [arg.replace("{ranks}", "1") for arg in launcher_args] + command
            if shutil.which(single_rank[0]):
                attempts.append((single_rank, 15))
    diagnostic_failed = False
    with tempfile.TemporaryDirectory(prefix="phynite-version-") as temporary_directory:
        for probe_command, timeout in attempts:
            try:
                completed = subprocess.run(probe_command, cwd=temporary_directory, stdin=subprocess.DEVNULL,
                                           capture_output=True, text=True, check=False, timeout=timeout)
            except (subprocess.TimeoutExpired, OSError):
                diagnostic_failed = True
                continue
            output = "\n".join(part.strip() for part in (completed.stdout, completed.stderr) if part.strip())
            version = re.search(r"Program\s+(\S+)\s+v\.([^\s]+)", output)
            if version:
                return f"Quantum ESPRESSO {version.group(1)} {version.group(2)}"
            if completed.returncode == 0 and output:
                return output.splitlines()[0]
            diagnostic_failed = diagnostic_failed or completed.returncode != 0
    return "unknown (version probe failed)" if diagnostic_failed else "unknown"


def python_package_version(distribution: str) -> str:
    """Report the package used by this runner, independently of console PATH."""
    try:
        return importlib.metadata.version(distribution)
    except importlib.metadata.PackageNotFoundError:
        return "not installed"
    except (OSError, ValueError):
        return "unknown (package metadata unavailable)"


def qe_runtime_identity(pseudo_dir: Path) -> dict[str, Any]:
    def digest(path: Path) -> str:
        sha = hashlib.sha256()
        with path.open("rb") as source:
            for block in iter(lambda: source.read(1024 * 1024), b""):
                sha.update(block)
        return sha.hexdigest()
    return {
        "hpcAllocation": {"scheduler": os.environ.get("PHYNITE_HPC_SCHEDULER"), "launcher": json.loads(os.environ["PHYNITE_MPI_LAUNCHER"]) if os.environ.get("PHYNITE_MPI_LAUNCHER") else None, "maximumRanks": os.environ.get("PHYNITE_HPC_MAX_RANKS"), "profileSha256": os.environ.get("PHYNITE_HPC_PROFILE_SHA256")},
        "pseudopotentials": [{"filename": path.name, "sha256": digest(path), "sizeBytes": path.stat().st_size} for path in sorted(pseudo_dir.glob("*")) if path.is_file()],
        "solverExecutables": [{"name": name, "sha256": digest(Path(executable))} for name in ("neb.x", "pw.x", "bands.x", "dos.x", "projwfc.x", "ph.x", "q2r.x", "matdyn.x") if (executable := shutil.which(name))],
        "software": {"quantumEspresso": software_version(["pw.x", "--version"]), "boltzTraP2": python_package_version("BoltzTraP2")},
    }


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

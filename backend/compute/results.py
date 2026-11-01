from __future__ import annotations

from projected_bands import parse_projected_bands

import csv
import hashlib
import json
import math
import re
import shutil
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Iterable, Sequence

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from qe_model import dft_result_error, qe_stage_error, qe_string_value, strip_qe_comments, validate_transport_settings


HARTREE_TO_EV = 27.211386245988
RYDBERG_TO_EV = HARTREE_TO_EV / 2.0
PLOT_DPI = 600
BAND_FOCUS_HALF_WINDOW_EV = 5.0
BAND_EDGE_PADDING_EV = 1.5
METALLIC_OCCUPATION_TOLERANCE = 1e-2
BOLTZMANN_EV_PER_K = 8.617333262145e-5
TRANSPORT_THERMAL_WINDOW_FACTOR = 12.0
TRANSPORT_WINDOW_PADDING = 1.1


@dataclass(frozen=True)
class Artifact:
    path: str
    label: str
    role: str
    content_type: str

    def as_dict(self) -> dict[str, str]:
        return {
            "path": self.path,
            "label": self.label,
            "role": self.role,
            "contentType": self.content_type,
        }


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _elements(root: ET.Element, name: str) -> list[ET.Element]:
    return [element for element in root.iter() if _local_name(element.tag) == name]


def _first_float(text: str | None) -> float | None:
    if not text:
        return None
    match = re.search(r"[-+]?(?:\d+\.?\d*|\.\d+)(?:[EeDd][-+]?\d+)?", text)
    return float(match.group(0).replace("D", "E").replace("d", "e")) if match else None


def _numbers(text: str | None) -> list[float]:
    if not text:
        return []
    return [
        float(value.replace("D", "E").replace("d", "e"))
        for value in re.findall(r"[-+]?(?:\d+\.?\d*|\.\d+)(?:[EeDd][-+]?\d+)?", text)
    ]


def _qe_parameter(input_text: str, namelist: str, key: str) -> str | None:
    # Exclude quoted strings before looking for numeric/logical assignments.
    clean = re.sub(r"'(?:''|[^'])*'|\"(?:\"\"|[^\"])*\"", "''", strip_qe_comments(input_text))
    block = re.search(rf"&{namelist}\b([^/]*?)/", clean, re.I | re.S)
    values = re.findall(rf"\b{key}\s*=\s*([^,\s/]+)", block.group(1), re.I) if block else []
    return values[-1] if values else None


def _qe_numeric(input_text: str, namelist: str, key: str, default: float | None = None) -> float | None:
    value = _qe_parameter(input_text, namelist, key)
    try:
        return float(value.replace("D", "E").replace("d", "e")) if value is not None else default
    except ValueError:
        return None


def _printed_interval(token: str) -> tuple[float, float] | None:
    """Conservative rounding bounds for QE's finite-precision printed values."""
    try:
        value = Decimal(token.replace("D", "E").replace("d", "e"))
        if not value.is_finite():
            return None
        half_step = Decimal(10) ** value.as_tuple().exponent / 2
        return float(value - half_step), float(value + half_step)
    except (InvalidOperation, OverflowError):
        return None


def qe_stage_xml_path(work_dir: Path, input_text: str) -> Path:
    prefix = qe_string_value(input_text, "CONTROL", "prefix", "pwscf", lowercase=False)
    outdir = qe_string_value(input_text, "CONTROL", "outdir", ".", lowercase=False)
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", prefix) or ".." in Path(outdir).parts:
        raise ValueError("Executed QE prefix/outdir cannot identify a safe stage XML")
    scratch = (work_dir / outdir).resolve()
    if scratch != work_dir.resolve() and work_dir.resolve() not in scratch.parents:
        raise ValueError("Executed QE outdir lies outside the calculation workspace")
    source = (scratch / f"{prefix}.save" / "data-file-schema.xml").resolve()
    if work_dir.resolve() not in source.parents:
        raise ValueError("Executed QE XML lies outside the calculation workspace")
    return source


def retain_qe_stage_xml(work_dir: Path, output_dir: Path, stage: str, input_text: str) -> Path | None:
    """Call immediately after pw.x, before any later stage can replace its XML."""
    source = qe_stage_xml_path(work_dir, input_text)
    if not source.is_file():
        return None
    destination = output_dir / "evidence" / f"{stage}.xml"
    destination.parent.mkdir(parents=True, exist_ok=True)
    # Copy exact bytes; the hash proves which stage snapshot was interpreted.
    shutil.copyfile(source, destination)
    return destination


def _xml_stage_parts(path: Path) -> tuple[ET.Element | None, ET.Element | None]:
    root = ET.parse(path).getroot()
    inputs = [child for child in root if _local_name(child.tag) == "input"]
    outputs = [child for child in root if _local_name(child.tag) == "output"]
    if len(inputs) > 1 or len(outputs) > 1:
        raise ET.ParseError("Stage XML has ambiguous input/output sections")
    return inputs[0] if inputs else None, outputs[0] if outputs else None


def _xml_scalar(root: ET.Element | None, name: str) -> float | None:
    nodes = _elements(root, name) if root is not None else []
    if len(nodes) != 1:
        return None
    try:
        return float((nodes[0].text or "").strip().replace("D", "E").replace("d", "e"))
    except ValueError:
        return None


def _xml_ry(root: ET.Element | None, name: str) -> float | None:
    value = _xml_scalar(root, name)
    if value is None:
        return None
    node = _elements(root, name)[0]
    units = (node.attrib.get("units") or node.attrib.get("unit") or "hartree").lower()
    factors = {"hartree": 2.0, "ha": 2.0, "atomic": 2.0, "rydberg": 1.0, "ry": 1.0, "ev": 1 / RYDBERG_TO_EV}
    return value * factors[units] if units in factors else None


def _scf_accuracy(text: str, input_text: str, xml_path: Path | None,
                  hybrid: bool, xml_input: ET.Element | None, xml_output: ET.Element | None) -> dict[str, Any]:
    residual_tokens = re.findall(r"estimated scf accuracy\s*[<=>]+\s*([-+0-9.EeDd]+)\s+Ry", text, re.I)
    residual = _xml_ry(xml_output, "scf_error") if xml_output is not None else None
    source = "qe-stage-xml" if residual is not None else "qe-log-bound"
    interval = _printed_interval(residual_tokens[-1]) if residual_tokens else None
    residual_upper = residual if source == "qe-stage-xml" else interval[1] if interval else None
    if residual is None and residual_tokens:
        residual = float(residual_tokens[-1].replace("D", "E").replace("d", "e"))
    threshold = _xml_ry(xml_input, "conv_thr") if xml_input is not None else None
    if threshold is None:
        threshold = _qe_numeric(input_text, "ELECTRONS", "conv_thr", 1e-6) if input_text else None
    outer_threshold = threshold
    threshold_upper = threshold
    adaptive = (_qe_parameter(input_text, "ELECTRONS", "adaptive_thr") or ".false.").lower() in {".true.", ".t.", "true", "t"}
    if hybrid and adaptive:
        # QE reports a new tr2 *after* the previous inner cycle. Only updates
        # preceding the final residual apply to that final SCF calculation.
        residual_end = list(re.finditer(r"estimated scf accuracy\s*[<=>]+\s*[-+0-9.EeDd]+\s+Ry", text, re.I))
        before_residual = text[:residual_end[-1].start()] if residual_end else text
        updates = re.findall(r"scf convergence threshold\s*=\s*([-+0-9.EeDd]+)\s+Ry", before_residual, re.I)
        threshold_interval = _printed_interval(updates[-1]) if updates else None
        if threshold_interval:
            threshold, threshold_upper = threshold_interval
        elif re.search(r"Calculation\s*\(EXX\)\s*restarted", text, re.I):
            threshold = threshold_upper = None
        else:
            threshold = threshold_upper = _qe_numeric(input_text, "ELECTRONS", "conv_thr_init", 1e-3)
    valid = all(isinstance(value, (int, float)) and math.isfinite(value) for value in (residual, residual_upper, threshold, threshold_upper))
    status = "unverified"
    if valid:
        status = "verified" if residual >= 0 and residual_upper >= residual and threshold > 0 and residual_upper < threshold else "failed"
    evidence: dict[str, Any] = {"status": status, "residualRy": residual, "residualUpperRy": residual_upper,
                                "thresholdRy": threshold, "thresholdUpperRy": threshold_upper,
                                "requestedThresholdRy": outer_threshold, "source": source,
                                "adaptiveThreshold": bool(hybrid and adaptive)}
    if xml_path is not None:
        evidence.update({"xmlPath": f"evidence/{xml_path.name}", "xmlSha256": _file_sha256(xml_path)})
    return evidence


def parse_qe_output(text: str, calculation_mode: str | None = None, *,
                    input_text: str = "", xml_path: Path | None = None) -> dict[str, Any]:
    def values(pattern: str) -> list[float]:
        return [float(value.replace("D", "E").replace("d", "e"))
                for value in re.findall(pattern, text, re.I)]

    energies = values(r"!\s+total energy\s+=\s+([-+0-9.EeDd]+)\s+Ry")
    fermi_values = values(r"the Fermi energy is\s+([-+0-9.EeDd]+)\s+ev")
    iterations = [int(value) for value in re.findall(r"convergence has been achieved in\s+(\d+)\s+iterations", text, re.I)]
    residuals = values(r"estimated scf accuracy\s*[<=>]+\s*([-+0-9.EeDd]+)\s+Ry")
    exchange_residuals = values(r"est\. exchange err \(dexx\)\s*=\s*([-+0-9.EeDd]+)\s+Ry")
    phonon_residuals = values(r"\|ddv_scf\|\^2\s*=\s*([-+0-9.EeDd]+)")
    total_forces = values(r"Total force\s+=\s+([-+0-9.EeDd]+)")
    pressures = values(r"P=\s*([-+0-9.EeDd]+)")
    job_done = bool(re.search(r"(?m)^\s*JOB DONE\.\s*$", text))
    solver_error = bool(re.search(r"(?im)^\s*Error in routine\b", text))
    current_cycle = re.split(r"Calculation\s*\(EXX\)\s*restarted[^\n]*", text, flags=re.I)[-1]
    current_text = current_cycle if re.search(r"Calculation\s*\(EXX\)\s*restarted", text, re.I) else text
    electronic_events = ["failed" if re.search(r"\b(?:no|not)\b", match.group(0), re.I) else "converged"
                         for match in re.finditer(r"(?im)^\s*(?:No convergence has been achieved|convergence (?:has been achieved|NOT achieved))", text)]
    diagonalization = bool(re.search(r"End of (?:band structure|non-self-consistent) calculation", text, re.I))
    is_nscf = calculation_mode in {"bands", "nscf"}
    electronic = ("diagonalization-completed" if is_nscf and diagonalization else
                  electronic_events[-1] if electronic_events else "not-reported")
    if "failed" in electronic_events:
        electronic = "failed"
    final_diagonalization_pass = re.split(r"Calculation\s*\(EXX\)\s*restarted[^\n]*", text, flags=re.I)[-1]
    eigenvalue_warnings = [int(value) for value in re.findall(r"c_bands:\s*(\d+)\s+eigenvalues not converged", final_diagonalization_pass, re.I)] if is_nscf else []
    if eigenvalue_warnings:
        electronic = "failed"
    xml_input = xml_output = None
    xml_error = None
    if xml_path is not None:
        try:
            xml_input, xml_output = _xml_stage_parts(xml_path)
            modes = _elements(xml_input, "calculation") if xml_input is not None else []
            if len(modes) != 1 or (modes[0].text or "").strip().lower() != calculation_mode:
                xml_error = "Stage XML calculation mode does not match the executed stage"
            prefixes = _elements(xml_input, "prefix") if xml_input is not None else []
            expected_prefix = qe_string_value(input_text, "CONTROL", "prefix", "pwscf", lowercase=False)
            if input_text and (len(prefixes) != 1 or (prefixes[0].text or "").strip() != expected_prefix):
                xml_error = "Stage XML prefix does not match the executed stage"
            if calculation_mode in {"scf", "relax", "vc-relax"} and input_text:
                threshold_nodes = _elements(xml_input, "conv_thr") if xml_input is not None else []
                requested = _qe_numeric(input_text, "ELECTRONS", "conv_thr", 1e-6)
                threshold_interval = _printed_interval((threshold_nodes[0].text or "").strip()) if len(threshold_nodes) == 1 else None
                threshold = _xml_ry(xml_input, "conv_thr")
                xml_value = _xml_scalar(xml_input, "conv_thr")
                factor = threshold / xml_value if threshold is not None and xml_value not in {None, 0} else None
                if threshold_interval is None or requested is None or factor is None or not threshold_interval[0] * factor <= requested <= threshold_interval[1] * factor:
                    xml_error = "Stage XML SCF threshold does not match the executed input"
        except (ET.ParseError, OSError) as exc:
            xml_error = f"Stage XML could not be read: {exc}"
    hybrid_xml = xml_output is not None and (bool(_elements(xml_output, "hybrid")) or any((node.text or "").strip().lower() == "true" for node in _elements(xml_output, "dft_is_hybrid")))
    hybrid = hybrid_xml or bool(re.match(r"^(?:HSE|PBE0|B3LYP|HF)", qe_string_value(input_text, "SYSTEM", "input_dft", ""), re.I)) or bool(re.search(r"(?:Calculation\s*\(EXX\)|EXX self-consistency|EXX: now go back)", text, re.I))
    exx_events = ["converged" if "self-consistency" in match.group(0).lower() else "failed"
                  for match in re.finditer(r"(?im)^\s*(?:EXX self-consistency reached|Calculation\s*\(EXX\)\s*stopped[^\n]*|EXX convergence NOT achieved[^\n]*)", current_text)]
    exx = (exx_events[-1] if exx_events else "not-reported") if hybrid and not is_nscf else "not-applicable"
    if hybrid and current_text != text:
        electronic_events = ["failed" if re.search(r"\b(?:no|not)\b", match.group(0), re.I) else "converged" for match in re.finditer(r"(?im)^\s*(?:No convergence has been achieved|convergence (?:has been achieved|NOT achieved))", current_text)]
        if not is_nscf:
            electronic = "failed" if "failed" in electronic_events else electronic_events[-1] if electronic_events else "not-reported"
    # Include the restart boundary in numerical evidence so unknown restart tr2
    # cannot be replaced by an earlier cycle's threshold printout.
    accuracy_text = "Calculation (EXX) restarted\n" + current_text if current_text != text else text
    accuracy = _scf_accuracy(accuracy_text, input_text, xml_path, hybrid, xml_input, xml_output) if calculation_mode in {"scf", "relax", "vc-relax"} else None
    if accuracy is not None:
        if xml_path is not None and (_xml_ry(xml_output, "scf_error") is None or _xml_ry(xml_input, "conv_thr") is None):
            xml_error = "Stage XML lacks unambiguous SCF error/threshold with supported units"
        if xml_error:
            accuracy["status"] = "unverified"
            accuracy["reason"] = xml_error
        if accuracy["status"] != "verified":
            electronic = "failed" if accuracy["status"] == "failed" else "not-reported"
        achieved = _elements(xml_output, "convergence_achieved") if xml_output is not None else []
        if achieved and any((node.text or "").strip().lower() == "false" for node in achieved):
            electronic = "failed"
    if xml_error and calculation_mode in {"scf", "relax", "vc-relax", "nscf", "bands"}:
        electronic = "not-reported"
    if hybrid and not is_nscf and exx != "converged":
        electronic = "failed" if exx == "failed" else "not-reported"
    # QE 7.5 Modules/bfgs_module.f90, PW/src/dynamics_module.f90 and
    # PW/src/vcsmd.f90 emit these positive geometry stopping markers.
    response_segments = re.split(r"(?im)^\s*Self-consistent Calculation\s*$", text)[1:]
    response_blocks = len(response_segments)
    response_positive = sum(event == "converged" for event in electronic_events)
    response = ("failed" if "failed" in electronic_events else "converged" if response_blocks > 0 and response_positive > 0 and all(re.search(r"(?im)^\s*Convergence has been achieved", segment) for segment in response_segments) else "not-reported") if calculation_mode == "phonon" else "not-applicable"
    fixed_geometry = bool(re.search(r"(?im)^\s*(?:bfgs converged|(?:FIRE|Damped Dynamics): convergence achieved in)", text))
    cell_geometry = bool(re.search(r"(?im)^\s*(?:Parrinello-Rahman|Wentzcovitch|Beeman) Damped (?:Cell )?Dynamics Minimization:\s*\n\s*convergence achieved,", text))
    geometry = fixed_geometry or cell_geometry
    variable_cell_geometry = bool(re.search(r"(?im)^\s*bfgs converged", text)) or cell_geometry
    exhausted = bool(re.search(r"(?:maximum number of (?:steps|iterations)|bfgs (?:.*not converged|failed)|convergence not achieved|Maximum number of iterations reached)", text, re.I))
    ionic = ("converged" if geometry and not exhausted else "not-converged" if exhausted else "not-reported") if calculation_mode in {"relax", "vc-relax"} else "not-applicable"
    cell = ("converged" if variable_cell_geometry and not exhausted else "not-converged" if exhausted else "not-reported") if calculation_mode == "vc-relax" else "not-applicable"
    force_blocks = re.split(r"Forces acting on atoms", text, flags=re.I)[1:]
    forces = []
    if force_blocks:
        for match in re.finditer(r"atom\s+(\d+)\s+type\s+\d+\s+force\s*=\s*([^\n]+)", force_blocks[-1], re.I):
            vector = _numbers(match.group(2))[:3]
            if len(vector) == 3 and all(math.isfinite(value) for value in vector):
                forces.append({"atomIndex": int(match.group(1)), "forceRyBohr": vector})
    stress = []
    for match in re.finditer(r"total\s+stress[^\n]*\n([^\n]+)\n([^\n]+)\n([^\n]+)", text, re.I):
        rows = [_numbers(match.group(index)) for index in (1, 2, 3)]
        if all(len(row) >= 6 and all(math.isfinite(value) for value in row) for row in rows):
            stress = rows
    stopping = ("geometry-tolerances-achieved" if geometry and not exhausted else
                "maximum-steps-reached" if exhausted else "electronic-not-converged" if electronic == "failed" else
                "job-done" if job_done else "completion-not-reported")
    return {
        "totalEnergyRy": energies[-1] if energies else None,
        "fermiEnergyEv": fermi_values[-1] if fermi_values else None,
        "scfIterations": iterations[-1] if iterations else None,
        "scfResidualRy": accuracy["residualRy"] if accuracy is not None else residuals[-1] if residuals else None,
        "scfAccuracy": accuracy,
        "hybridConvergence": exx,
        "hybridFunctional": hybrid,
        "exchangeResidualRy": exchange_residuals[-1] if exchange_residuals else None,
        "phononResponseResidual": phonon_residuals[-1] if phonon_residuals else None,
        "phononResponseResidualDefinition": "|ddv_scf|^2 as printed by ph.x; compare with tr2_ph" if phonon_residuals else None,
        "totalForceRyBohr": total_forces[-1] if total_forces else None,
        "maximumForceRyBohr": max((math.sqrt(sum(value * value for value in force["forceRyBohr"])) for force in forces), default=None),
        "atomicForces": forces,
        "stressTensorRyBohr3": [row[:3] for row in stress] if stress else None,
        "stressTensorKbar": [row[3:6] for row in stress] if stress else None,
        "pressureKbar": pressures[-1] if pressures else None,
        "electronicConvergence": electronic,
        "phononResponseConvergence": response,
        "phononResponseCalculations": response_blocks if calculation_mode == "phonon" else None,
        "solverError": solver_error,
        "electronicConvergenceCycles": electronic_events,
        "nonconvergedEigenvalueWarnings": eigenvalue_warnings,
        "ionicConvergence": ionic,
        "cellConvergence": cell,
        "stoppingReason": stopping,
        "converged": response == "converged" if calculation_mode == "phonon" else electronic in {"converged", "diagonalization-completed"},
        "jobDone": job_done,
    }


def _xml_energy_factor(element: ET.Element) -> float:
    units = (element.attrib.get("units") or element.attrib.get("unit") or "hartree").lower()
    if "ev" in units:
        return 1.0
    if "ryd" in units or units == "ry":
        return RYDBERG_TO_EV
    return HARTREE_TO_EV


def _parse_qe_band_dataset(
    path: Path,
) -> tuple[np.ndarray, np.ndarray, float | None, np.ndarray | None]:
    root = ET.parse(path).getroot()
    band_structure = next(iter(_elements(root, "band_structure")), root)
    fermi_node = next(iter(_elements(band_structure, "fermi_energy")), None)
    fermi_ev = None
    if fermi_node is not None:
        value = _first_float(fermi_node.text)
        if value is not None:
            fermi_ev = value * _xml_energy_factor(fermi_node)

    kpoints: list[list[float]] = []
    eigenvalue_rows: list[list[float]] = []
    occupation_rows: list[list[float]] = []
    for ks in _elements(band_structure, "ks_energies"):
        k_node = next(iter(_elements(ks, "k_point")), None)
        eigen_node = next(iter(_elements(ks, "eigenvalues")), None)
        if k_node is None or eigen_node is None:
            continue
        kpoint = _numbers(k_node.text)
        eigenvalues = _numbers(eigen_node.text)
        if len(kpoint) < 3 or not eigenvalues:
            continue
        kpoints.append(kpoint[:3])
        eigenvalue_rows.append([value * _xml_energy_factor(eigen_node) for value in eigenvalues])
        occupation_node = next(iter(_elements(ks, "occupations")), None)
        occupation_rows.append(_numbers(occupation_node.text) if occupation_node is not None else [])

    if not kpoints or not eigenvalue_rows:
        raise ValueError(f"No k-point eigenvalues found in {path.name}")
    band_count = min(len(row) for row in eigenvalue_rows)
    eigenvalues = np.asarray([row[:band_count] for row in eigenvalue_rows], dtype=float)
    occupations = None
    if len(occupation_rows) == len(eigenvalue_rows) and all(len(row) >= band_count for row in occupation_rows):
        occupations = np.asarray([row[:band_count] for row in occupation_rows], dtype=float)
    points = np.asarray(kpoints, dtype=float)
    distances = np.zeros(len(points), dtype=float)
    if len(points) > 1:
        distances[1:] = np.cumsum(np.linalg.norm(np.diff(points, axis=0), axis=1))
    return distances, eigenvalues, fermi_ev, occupations


def parse_qe_band_xml(path: Path) -> tuple[np.ndarray, np.ndarray, float | None]:
    distances, eigenvalues, fermi_ev, _ = _parse_qe_band_dataset(path)
    return distances, eigenvalues, fermi_ev


def read_numeric_table(path: Path, minimum_columns: int = 2) -> np.ndarray:
    rows: list[list[float]] = []
    for raw_line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw_line.strip()
        if not line or line.startswith(("#", "!", "@")):
            continue
        try:
            values = [float(value.replace("D", "E").replace("d", "e")) for value in line.split()]
        except ValueError:
            continue
        if len(values) >= minimum_columns and all(math.isfinite(value) for value in values):
            rows.append(values)
    if not rows:
        raise ValueError(f"No numeric data found in {path.name}")
    width = min(len(row) for row in rows)
    return np.asarray([row[:width] for row in rows], dtype=float)


def parse_boltztrap_trace(path: Path, fermi_ev: float | None = None) -> dict[str, Any]:
    table = read_numeric_table(path, minimum_columns=10)
    raw_energy = table[:, 0]
    # Pinned BoltzTraP2 26.3.1 save_trace writes mu*2 in Ef[Ry]. The DOS
    # column stays per Hartree; do not infer energy units from the sampled grid.
    headers = [line.lstrip()[1:].strip().split() for line in path.read_text(encoding="utf-8", errors="replace").splitlines() if line.lstrip().startswith("#")]
    energy_headers = [fields[0] for fields in headers if fields and re.match(r"(?i)^Ef\[", fields[0])]
    if len(set(energy_headers)) != 1:
        raise ValueError("BoltzTraP2 trace requires one unambiguous Ef[Ry] or Ef[Ha] header; energy units cannot be inferred from numeric values")
    unit_match = re.fullmatch(r"(?i)Ef\[(Ry|Ha|Hartree)\]", energy_headers[0])
    if unit_match is None:
        raise ValueError("Unsupported BoltzTraP2 trace energy unit; expected explicit Ef[Ry] or Ef[Ha]")
    source_energy_unit = "rydberg" if unit_match.group(1).lower() == "ry" else "hartree"
    chemical_potential_ev = raw_energy * (RYDBERG_TO_EV if source_energy_unit == "rydberg" else HARTREE_TO_EV)
    if fermi_ev is not None:
        if not math.isfinite(fermi_ev):
            raise ValueError("Transport Fermi energy must be finite")
        chemical_potential_ev = chemical_potential_ev - fermi_ev
    return {
        "chemicalPotentialEv": chemical_potential_ev,
        "sourceEnergyUnit": source_energy_unit,
        "temperatureK": table[:, 1],
        "electronsPerCell": table[:, 2],
        "dosPerHartreeCell": table[:, 3],
        "seebeckVPerK": table[:, 4],
        "conductivityPerTau": table[:, 5],
        "hallM3PerC": table[:, 6],
        "electronicThermalConductivityPerTau": table[:, 7],
        "heatCapacityJMolK": table[:, 8],
        "susceptibilityM3Mol": table[:, 9],
    }


def _write_csv(path: Path, headers: Sequence[str], columns: Sequence[Iterable[float]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(headers)
        writer.writerows(zip(*columns, strict=True))


def _plot_style() -> None:
    plt.rcParams.update(
        {
            "font.family": "sans-serif",
            "font.sans-serif": ["DejaVu Sans"],
            "font.size": 8.0,
            "mathtext.fontset": "dejavusans",
            "figure.dpi": 160,
            "figure.facecolor": "white",
            "axes.facecolor": "white",
            "axes.linewidth": 0.8,
            "axes.edgecolor": "#252a35",
            "axes.labelcolor": "#252a35",
            "axes.labelsize": 8.5,
            "axes.titlesize": 9.0,
            "axes.titleweight": "semibold",
            "axes.grid": False,
            "lines.linewidth": 0.85,
            "lines.solid_capstyle": "round",
            "lines.solid_joinstyle": "round",
            "xtick.color": "#4d5563",
            "ytick.color": "#4d5563",
            "xtick.labelsize": 7.5,
            "ytick.labelsize": 7.5,
            "xtick.direction": "in",
            "ytick.direction": "in",
            "xtick.top": True,
            "ytick.right": True,
            "xtick.major.width": 0.7,
            "ytick.major.width": 0.7,
            "xtick.major.size": 3.2,
            "ytick.major.size": 3.2,
            "legend.fontsize": 7.0,
            "legend.frameon": False,
            "path.simplify": False,
            "svg.fonttype": "none",
            "pdf.fonttype": 42,
            "ps.fonttype": 42,
            "savefig.dpi": PLOT_DPI,
            "savefig.bbox": "tight",
            "savefig.pad_inches": 0.035,
        }
    )


def _optional_plot_limit(settings: dict[str, Any], name: str) -> float | None:
    value = settings.get(name)
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        raise ValueError(f"{name} must be a finite number")
    try:
        parsed = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{name} must be a finite number") from exc
    if not math.isfinite(parsed):
        raise ValueError(f"{name} must be a finite number")
    return parsed


def _apply_plot_limits(
    axis: plt.Axes,
    settings: dict[str, Any],
    *,
    default_xlim: tuple[float, float] | None = None,
    default_ylim: tuple[float, float] | None = None,
    allow_y: bool = True,
) -> dict[str, Any]:
    if default_xlim is not None:
        axis.set_xlim(*default_xlim)
    if default_ylim is not None:
        axis.set_ylim(*default_ylim)

    x_min = _optional_plot_limit(settings, "plotXMin")
    x_max = _optional_plot_limit(settings, "plotXMax")
    current_x = axis.get_xlim()
    requested_x = (
        current_x[0] if x_min is None else x_min,
        current_x[1] if x_max is None else x_max,
    )
    if requested_x[0] >= requested_x[1]:
        raise ValueError("Plot X min must be lower than Plot X max")
    axis.set_xlim(*requested_x)

    y_min = _optional_plot_limit(settings, "plotYMin") if allow_y else None
    y_max = _optional_plot_limit(settings, "plotYMax") if allow_y else None
    current_y = axis.get_ylim()
    requested_y = (
        current_y[0] if y_min is None else y_min,
        current_y[1] if y_max is None else y_max,
    )
    if requested_y[0] >= requested_y[1]:
        raise ValueError("Plot Y min must be lower than Plot Y max")
    if allow_y:
        axis.set_ylim(*requested_y)

    custom = x_min is not None or x_max is not None or y_min is not None or y_max is not None
    return {
        "plotXWindow": [float(value) for value in axis.get_xlim()],
        "plotYWindow": [float(value) for value in axis.get_ylim()],
        "plotRangeMode": "custom" if custom else "automatic",
    }


def _save_figure(fig: plt.Figure, output_base: Path, label: str) -> list[Artifact]:
    output_base.parent.mkdir(parents=True, exist_ok=True)
    artifacts: list[Artifact] = []
    for suffix, content_type in (("svg", "image/svg+xml"), ("pdf", "application/pdf"), ("png", "image/png")):
        path = output_base.with_suffix(f".{suffix}")
        kwargs: dict[str, Any] = {"transparent": False, "facecolor": "white"}
        if suffix == "png":
            kwargs["dpi"] = PLOT_DPI
        fig.savefig(path, **kwargs)
        artifacts.append(Artifact(path.as_posix(), f"{label} ({suffix.upper()})", "plot", content_type))
    plt.close(fig)
    return artifacts


def _relative_artifacts(artifacts: Iterable[Artifact], output_dir: Path) -> list[dict[str, str]]:
    normalized: list[dict[str, str]] = []
    for artifact in artifacts:
        path = Path(artifact.path)
        entry = artifact.as_dict()
        entry["path"] = path.relative_to(output_dir).as_posix()
        normalized.append(entry)
    return normalized


def _find_first(root: Path, patterns: Sequence[str]) -> Path | None:
    def scientific_file(path: Path) -> bool:
        # Resource dry runs produce valid-looking XML without eigenvalues.
        # Never let their alphabetically earlier scratch directory win over
        # the actual solver output (or substitute for missing scientific data).
        relative = path.relative_to(root)
        return path.is_file() and not any(
            part.startswith("preflight-") and part.endswith("tmp")
            for part in relative.parts[:-1]
        )

    for pattern in patterns:
        candidates = sorted(
            (path for path in root.rglob(pattern) if scientific_file(path)),
            key=lambda item: (len(item.parts), item.as_posix()),
        )
        if candidates:
            return candidates[0]
    return None


def _interpolated_zero_crossings(x_values: np.ndarray, y_values: np.ndarray) -> list[float]:
    finite = np.isfinite(x_values) & np.isfinite(y_values)
    x = np.asarray(x_values[finite], dtype=float)
    y = np.asarray(y_values[finite], dtype=float)
    if len(x) < 2:
        return []
    order = np.argsort(x)
    x = x[order]
    y = y[order]
    crossings: list[float] = []
    for index in range(len(x) - 1):
        x0, x1 = float(x[index]), float(x[index + 1])
        y0, y1 = float(y[index]), float(y[index + 1])
        if y0 == 0.0:
            crossings.append(x0)
        elif np.signbit(y0) != np.signbit(y1) and y1 != y0:
            crossings.append(x0 - y0 * (x1 - x0) / (y1 - y0))
    if y[-1] == 0.0:
        crossings.append(float(x[-1]))
    return list(dict.fromkeys(round(value, 12) for value in crossings))


def _transport_plot_reference(
    chemical_potential_ev: np.ndarray,
    temperature_k: np.ndarray,
    seebeck_uv_per_k: np.ndarray,
    analysis_window: tuple[float, float],
) -> tuple[float, float, float, list[float], str]:
    """Return the shared Seebeck transition used as the plot origin.

    Transport curves can converge again near the edge of the interpolation
    window. That is not the physically useful reference users identify as the
    common Seebeck crossing. Prefer the neighbourhood containing each
    temperature curve's sign change, then find the minimum-spread common
    intersection inside that neighbourhood.
    """
    window_mask = (
        (chemical_potential_ev >= analysis_window[0])
        & (chemical_potential_ev <= analysis_window[1])
    )
    temperatures = np.unique(temperature_k)
    crossings: list[float] = []
    interpolation_series: list[tuple[np.ndarray, np.ndarray]] = []
    for temperature in temperatures:
        mask = window_mask & (temperature_k == temperature)
        x = chemical_potential_ev[mask]
        y = seebeck_uv_per_k[mask]
        order = np.argsort(x)
        x = x[order]
        y = y[order]
        candidates = _interpolated_zero_crossings(x, y)
        if candidates:
            crossings.append(min(candidates, key=abs))
        if len(x) >= 2:
            interpolation_series.append((x, y))

    if len(interpolation_series) >= 2:
        overlap_min = max(float(series[0][0]) for series in interpolation_series)
        overlap_max = min(float(series[0][-1]) for series in interpolation_series)
        if overlap_min < overlap_max:
            reference_center = float(np.median(crossings)) if crossings else 0.0
            if crossings:
                crossing_span = float(np.ptp(crossings)) if len(crossings) > 1 else 0.0
                focus_half_width = max(0.05, crossing_span * 0.75)
                focus_min = max(overlap_min, reference_center - focus_half_width)
                focus_max = min(overlap_max, reference_center + focus_half_width)
                if focus_min >= focus_max:
                    focus_min, focus_max = overlap_min, overlap_max
            else:
                focus_min, focus_max = overlap_min, overlap_max

            grid = np.linspace(focus_min, focus_max, 4097)
            curves = np.vstack([np.interp(grid, x, y) for x, y in interpolation_series])
            spread = np.ptp(curves, axis=0)
            scale = max(1.0, float(np.nanpercentile(np.abs(curves), 90)))
            candidate_mu = [float(grid[int(np.nanargmin(spread))])]
            for first in range(len(curves)):
                for second in range(first + 1, len(curves)):
                    candidate_mu.extend(_interpolated_zero_crossings(grid, curves[first] - curves[second]))
            candidate_mu_array = np.asarray(candidate_mu, dtype=float)
            candidate_values = np.asarray(
                [
                    [np.interp(mu, grid, curve) for curve in curves]
                    for mu in candidate_mu_array
                ]
            )
            candidate_spreads = np.ptp(candidate_values, axis=1)
            minimum_spread = float(np.nanmin(candidate_spreads))
            equally_good = np.flatnonzero(candidate_spreads <= minimum_spread + scale * 1e-6)
            best_index = int(
                equally_good[
                    np.argmin(np.abs(candidate_mu_array[equally_good] - reference_center))
                ]
            )
            reference_ev = float(candidate_mu_array[best_index])
            reference_values = candidate_values[best_index]
            reference_seebeck = float(np.mean(reference_values))
            reference_spread = float(np.ptp(reference_values))
            if reference_spread <= max(scale * 0.075, 1e-6):
                return (
                    reference_ev,
                    reference_seebeck,
                    reference_spread,
                    crossings,
                    "seebeck-curve-intersection",
                )
            if crossings:
                return (
                    reference_ev,
                    reference_seebeck,
                    reference_spread,
                    crossings,
                    "seebeck-transition-center",
                )

    if not crossings:
        return 0.0, 0.0, 0.0, [], "fermi"
    reference_ev = float(np.median(crossings))
    return reference_ev, 0.0, 0.0, crossings, "seebeck-zero-crossing"


def _symmetric_zero_window(values: np.ndarray) -> tuple[float, float]:
    """Return a finite domain with the zero reference exactly at its center."""
    finite = np.asarray(values[np.isfinite(values)], dtype=float)
    if len(finite) == 0:
        raise ValueError("Plot data contains no finite horizontal coordinates")
    half_width = max(abs(float(np.min(finite))), abs(float(np.max(finite))))
    if half_width <= 0.0:
        half_width = 1.0
    return -half_width, half_width


def _transport_auto_window(
    chemical_potential_ev: np.ndarray,
    temperature_k: np.ndarray,
    reference_ev: float,
    analysis_window: tuple[float, float],
) -> tuple[float, float]:
    """Choose a symmetric, temperature-aware viewport around the plot reference."""
    finite_mu = chemical_potential_ev[np.isfinite(chemical_potential_ev)]
    finite_temperature = temperature_k[np.isfinite(temperature_k)]
    if len(finite_mu) == 0:
        raise ValueError("BoltzTraP2 produced no finite chemical-potential data")
    requested_half_width = max(
        abs(float(analysis_window[0]) - reference_ev),
        abs(float(analysis_window[1]) - reference_ev),
    )
    maximum_temperature = float(np.max(finite_temperature)) if len(finite_temperature) else 0.0
    thermal_half_width = TRANSPORT_THERMAL_WINDOW_FACTOR * BOLTZMANN_EV_PER_K * maximum_temperature
    target_half_width = max(requested_half_width, thermal_half_width) * TRANSPORT_WINDOW_PADDING
    available_left = reference_ev - float(np.min(finite_mu))
    available_right = float(np.max(finite_mu)) - reference_ev
    available_half_width = min(available_left, available_right)
    if available_half_width <= 0.0:
        raise ValueError("BoltzTraP2 trace does not bracket the transport plot reference")
    half_width = min(target_half_width, available_half_width)
    return -float(half_width), float(half_width)


def _band_summary(
    eigenvalues_ev: np.ndarray,
    fermi_ev: float | None,
    occupations: np.ndarray | None = None,
) -> dict[str, Any]:
    scope = {"bandGapScope": "sampled-k-path", "fullBrillouinZoneGapVerified": False}
    relative = eigenvalues_ev - (fermi_ev if fermi_ev is not None else 0.0)
    if occupations is not None and occupations.shape == relative.shape:
        # Smearing produces tiny non-zero occupation tails even in an
        # insulator. Only materially fractional occupations indicate a band
        # crossing; otherwise the 0.5 boundary still identifies VBM and CBM.
        partial = (
            (occupations > METALLIC_OCCUPATION_TOLERANCE)
            & (occupations < 1.0 - METALLIC_OCCUPATION_TOLERANCE)
        )
        if np.any(partial):
            return {
                **scope,
                "fermiEnergyEv": fermi_ev,
                "bandGapEv": 0.0,
                "electronicCharacter": "metallic",
            }
        occupied = np.where(occupations >= 0.5, relative, -np.inf)
        empty = np.where(occupations < 0.5, relative, np.inf)
    elif fermi_ev is None:
        return {**scope, "fermiEnergyEv": None, "bandGapEv": None, "electronicCharacter": "undetermined"}
    else:
        occupied = np.where(relative <= 1e-8, relative, -np.inf)
        empty = np.where(relative > 1e-8, relative, np.inf)
    if not np.isfinite(occupied).any() or not np.isfinite(empty).any():
        return {**scope, "fermiEnergyEv": fermi_ev, "bandGapEv": None, "electronicCharacter": "undetermined"}
    vbm_index = np.unravel_index(np.argmax(occupied), occupied.shape)
    cbm_index = np.unravel_index(np.argmin(empty), empty.shape)
    gap = float(empty[cbm_index] - occupied[vbm_index])
    return {
        **scope,
        "fermiEnergyEv": fermi_ev,
        "bandGapEv": max(0.0, gap),
        "electronicCharacter": "metallic" if gap < 1e-4 else ("direct-gap" if vbm_index[0] == cbm_index[0] else "indirect-gap"),
        "vbmEnergyEv": float(eigenvalues_ev[vbm_index]),
        "cbmEnergyEv": float(eigenvalues_ev[cbm_index]),
        "vbmKpointIndex": int(vbm_index[0]),
        "cbmKpointIndex": int(cbm_index[0]),
    }


def _band_plot_window(
    relative_eigenvalues_ev: np.ndarray,
    occupations: np.ndarray | None = None,
) -> tuple[float, float]:
    """Return a readable Fermi-level window without hiding a wide band gap."""
    finite = relative_eigenvalues_ev[np.isfinite(relative_eigenvalues_ev)]
    if finite.size == 0:
        return -BAND_FOCUS_HALF_WINDOW_EV, BAND_FOCUS_HALF_WINDOW_EV

    if occupations is not None and occupations.shape == relative_eigenvalues_ev.shape:
        occupied = relative_eigenvalues_ev[(occupations >= 0.5) & np.isfinite(relative_eigenvalues_ev)]
        empty = relative_eigenvalues_ev[(occupations < 0.5) & np.isfinite(relative_eigenvalues_ev)]
    else:
        occupied = finite[finite <= 1e-8]
        empty = finite[finite > 1e-8]

    lower = -BAND_FOCUS_HALF_WINDOW_EV
    upper = BAND_FOCUS_HALF_WINDOW_EV
    if occupied.size and empty.size:
        vbm = float(np.max(occupied))
        cbm = float(np.min(empty))
        lower = min(lower, vbm - BAND_EDGE_PADDING_EV)
        upper = max(upper, cbm + BAND_EDGE_PADDING_EV)

    # Half-eV boundaries remain stable between nearby calculations and produce
    # cleaner paper figures than arbitrary floating-point limits.
    return math.floor(lower * 2.0) / 2.0, math.ceil(upper * 2.0) / 2.0


def _plot_path_branches(axis: plt.Axes, distances: np.ndarray, values: np.ndarray, settings: dict[str, Any]) -> None:
    metadata = settings.get("_reciprocalPath") or {}
    boundaries = [0, *sorted({index for index in metadata.get("breakIndices", []) if isinstance(index, int) and 0 < index < len(distances)}), len(distances)]
    for start, end in zip(boundaries, boundaries[1:]):
        axis.plot(distances[start:end], values[start:end], color="#252a35", linewidth=0.72)


def _draw_band_axes(
    axis: plt.Axes,
    distances: np.ndarray,
    relative: np.ndarray,
    settings: dict[str, Any],
    has_fermi: bool = True,
) -> None:
    _plot_path_branches(axis, distances, relative, settings)
    if has_fermi:
        axis.axhline(0.0, color="#d24b40", linewidth=0.85, linestyle="--")
    axis.set_xlabel("k-path")
    axis.set_ylabel(r"Energy $E-E_F$ (eV)" if has_fermi else "Energy (source zero, eV)")
    axis.set_xlim(float(distances.min()), float(distances.max()))
    _apply_reciprocal_ticks(axis, distances, settings)


def exact_qe_stage_xml(work_dir: Path, output_dir: Path, stage: str, input_name: str) -> Path:
    retained_input = output_dir / "inputs" / input_name
    executed_input = retained_input if retained_input.is_file() else work_dir / input_name
    if not executed_input.is_file():
        raise ValueError(f"Cannot identify {stage} XML without its exact executed input")
    snapshot = output_dir / "evidence" / f"{stage}.xml"
    path = snapshot if snapshot.is_file() else qe_stage_xml_path(work_dir, executed_input.read_text(encoding="utf-8"))
    if not path.is_file():
        raise FileNotFoundError(f"Exact Quantum ESPRESSO {stage} XML was not produced")
    xml_input, xml_output = _xml_stage_parts(path)
    mode = qe_string_value(executed_input.read_text(encoding="utf-8"), "CONTROL", "calculation", "scf")
    modes = _elements(xml_input, "calculation") if xml_input is not None else []
    prefixes = _elements(xml_input, "prefix") if xml_input is not None else []
    prefix = qe_string_value(executed_input.read_text(encoding="utf-8"), "CONTROL", "prefix", "pwscf", lowercase=False)
    if xml_output is None or len(modes) != 1 or (modes[0].text or "").strip().lower() != mode or len(prefixes) != 1 or (prefixes[0].text or "").strip() != prefix:
        raise ValueError(f"Exact {stage} XML does not match its executed calculation mode")
    return path


def transport_fermi_reference(xml_path: Path, output_dir: Path) -> dict[str, Any]:
    _, xml_output = _xml_stage_parts(xml_path)
    structures = _elements(xml_output, "band_structure") if xml_output is not None else []
    if len(structures) != 1 or _elements(structures[0], "two_fermi_energies"):
        raise ValueError("Transport requires one finite Fermi energy; missing or two-spin Fermi references are not supported")
    nodes = _elements(structures[0], "fermi_energy")
    if len(nodes) != 1:
        raise ValueError("Transport Fermi reference is missing or ambiguous in the exact NSCF XML")
    node = nodes[0]
    value = _xml_scalar(structures[0], "fermi_energy")
    unit = (node.attrib.get("units") or node.attrib.get("unit") or "hartree").lower()
    factors = {"hartree": HARTREE_TO_EV, "ha": HARTREE_TO_EV, "rydberg": RYDBERG_TO_EV, "ry": RYDBERG_TO_EV, "ev": 1.0}
    if value is None or not math.isfinite(value) or unit not in factors:
        raise ValueError("Transport Fermi reference must have finite energy and explicit supported QE XML units")
    if not math.isfinite(value * factors[unit]):
        raise ValueError("Transport Fermi reference cannot be represented as finite eV")
    try:
        source = xml_path.relative_to(output_dir).as_posix()
    except ValueError:
        source = xml_path.relative_to(output_dir.parent).as_posix()
    return {"valueEv": value * factors[unit], "sourceValue": value, "sourceUnit": unit,
            "source": "qe-nscf-transport-xml", "path": source, "sha256": _file_sha256(xml_path)}


def _render_bands(work_dir: Path, output_dir: Path, settings: dict[str, Any]) -> tuple[dict[str, Any], list[Artifact]]:
    xml_path = exact_qe_stage_xml(work_dir, output_dir, "bands-nscf", "nscfbands.in")
    distances, eigenvalues, fermi_ev, occupations = _parse_qe_band_dataset(xml_path)
    reference = float(fermi_ev or 0.0)
    relative = eigenvalues - reference
    csv_path = output_dir / "data" / "band-structure.csv"
    _write_csv(
        csv_path,
        ["k_distance", *[f"band_{index + 1}_ev" + ("_relative_to_fermi" if fermi_ev is not None else "") for index in range(relative.shape[1])]],
        [distances, *[relative[:, index] for index in range(relative.shape[1])]],
    )
    _plot_style()
    focus_window = _band_plot_window(relative, occupations) if fermi_ev is not None else (float(np.nanmin(relative)), float(np.nanmax(relative)))
    fig, axis = plt.subplots(figsize=(3.39, 3.0), constrained_layout=True)
    _draw_band_axes(axis, distances, relative, settings, fermi_ev is not None)
    plot_viewport = _apply_plot_limits(
        axis,
        settings,
        default_xlim=(float(distances.min()), float(distances.max())),
        default_ylim=focus_window,
    )
    artifacts = [Artifact(csv_path.as_posix(), "Band structure data (CSV)", "data", "text/csv")]
    if settings.get("projectedBands") or (output_dir / "logs/projected-bands.out").is_file():
        input_path = output_dir / "inputs/nscfbands.in"
        prefix = qe_string_value(input_path.read_text(), "CONTROL", "prefix", "pwscf", lowercase=False)
        projection_path = work_dir / "tmp" / f"{prefix}.save" / "atomic_proj.xml"
        if not projection_path.is_file():
            raise ValueError("Projected bands requested, but the matching atomic_proj.xml was not produced.")
        root = ET.parse(xml_path).getroot()
        kpoints = np.asarray([_numbers(next(iter(_elements(ks, "k_point"))).text)[:3] for ks in _elements(root, "ks_energies")])
        projection = parse_projected_bands(projection_path, (output_dir / "logs/projected-bands.out").read_text(), kpoints, eigenvalues)
        projected_path = output_dir / "data/projected-bands.json"
        projected_path.write_text(json.dumps(projection, separators=(",", ":"), allow_nan=False))
        artifacts.append(Artifact(projected_path.as_posix(), "Atomic orbital band projections (JSON)", "data", "application/json"))
        retained_projection = output_dir / "data/atomic_proj.xml"
        shutil.copyfile(projection_path, retained_projection)
        artifacts.append(Artifact(retained_projection.as_posix(), "QE atomic projection amplitudes (XML)", "raw-data", "application/xml"))

    artifacts.extend(_save_figure(fig, output_dir / "plots" / "band-structure", "Band structure"))

    full_fig, full_axis = plt.subplots(figsize=(3.39, 3.0), constrained_layout=True)
    _draw_band_axes(full_axis, distances, relative, settings, fermi_ev is not None)
    artifacts.extend(_save_figure(
        full_fig,
        output_dir / "plots" / "band-structure-full-range",
        "Band structure full range",
    ))
    finite = relative[np.isfinite(relative)]
    summary = _band_summary(eigenvalues, fermi_ev, occupations)
    summary["fermiEnergyEv"] = fermi_ev
    custom_energy_window = any(settings.get(name) not in (None, "") for name in ("plotYMin", "plotYMax"))
    summary.update({
        "plotEnergyWindowEv": plot_viewport["plotYWindow"],
        "plotEnergyWindowMode": "custom" if custom_energy_window else "band-edge-aware",
        **plot_viewport,
        "fullEnergyRangeEv": [float(np.min(finite)), float(np.max(finite))],
    })
    return summary, artifacts


def _render_dos(
    work_dir: Path,
    output_dir: Path,
    fermi_ev: float | None,
    settings: dict[str, Any],
) -> tuple[dict[str, Any], list[Artifact]]:
    dos_path = _find_first(work_dir, ("*.dos.dat", "*.dos", "*dos.dat"))
    if dos_path is None:
        raise FileNotFoundError("Quantum ESPRESSO DOS data was not produced")
    table = read_numeric_table(dos_path, minimum_columns=2)
    energy = table[:, 0]
    header = "\n".join(dos_path.read_text(encoding="utf-8", errors="replace").splitlines()[:8]).lower()
    spin_resolved = table.shape[1] >= 4 and any(marker in header for marker in ("dosup", "dos_up", "dos(up)"))
    if spin_resolved:
        dos_up = table[:, 1]
        dos_down = table[:, 2]
        dos = dos_up + dos_down
    else:
        dos_up = dos_down = None
        dos = table[:, 1]
    reference = float(fermi_ev or 0.0)
    relative_energy = energy - reference
    csv_path = output_dir / "data" / "density-of-states.csv"
    headers = ["energy_ev_relative_to_fermi" if fermi_ev is not None else "energy_ev", "dos_states_per_ev"]
    columns: list[np.ndarray] = [relative_energy, dos]
    if spin_resolved and dos_up is not None and dos_down is not None:
        headers.extend(("dos_up_states_per_ev", "dos_down_states_per_ev"))
        columns.extend((dos_up, dos_down))
    if table.shape[1] > (3 if spin_resolved else 2):
        headers.append("integrated_dos")
        columns.append(table[:, 3] if spin_resolved else table[:, 2])
    _write_csv(csv_path, headers, columns)
    dos_at_fermi = float(np.interp(0.0, relative_energy, dos)) if fermi_ev is not None and relative_energy.min() <= 0 <= relative_energy.max() else None
    _plot_style()
    fig, axis = plt.subplots(figsize=(3.39, 3.0), constrained_layout=True)
    if spin_resolved and dos_up is not None and dos_down is not None:
        axis.plot(relative_energy, dos_up, color="#252a35", linewidth=1.05, label="Spin up")
        axis.plot(relative_energy, -dos_down, color="#737b89", linewidth=1.05, label="Spin down")
        axis.axhline(0.0, color="#d6d9df", linewidth=0.55)
    else:
        axis.plot(relative_energy, dos, color="#252a35", linewidth=1.05, label="Total DOS")
    if fermi_ev is not None:
        axis.axvline(0.0, color="white", linewidth=3.0, zorder=2)
        axis.axvline(
            0.0,
            color="#d24b40",
            linewidth=1.0,
            linestyle="--",
            label=r"Fermi energy ($E_F=0$ eV)",
            zorder=3,
        )
    axis.set_title("Density of States", loc="center", pad=38.0)
    axis.set_xlabel(r"Energy $E-E_F$ (eV)" if fermi_ev is not None else "Energy (source zero, eV)")
    axis.set_ylabel("DOS (states/eV)")
    legend = axis.legend(
        loc="lower center",
        bbox_to_anchor=(0.5, 1.01),
        ncol=1 if spin_resolved else 2,
        frameon=True,
        fancybox=False,
        framealpha=0.96,
        borderpad=0.45,
    )
    legend.get_frame().set_edgecolor("#d8dce2")
    legend.get_frame().set_linewidth(0.65)
    if not spin_resolved:
        axis.set_ylim(bottom=0.0)
    plot_viewport = _apply_plot_limits(
        axis,
        settings,
        default_xlim=_symmetric_zero_window(relative_energy) if fermi_ev is not None else (float(energy.min()), float(energy.max())),
    )
    artifacts = [Artifact(csv_path.as_posix(), "Density of states data (CSV)", "data", "text/csv")]
    artifacts.extend(_save_figure(fig, output_dir / "plots" / "density-of-states", "Density of states"))
    return {
        "fermiEnergyEv": fermi_ev,
        "dosAtFermiStatesPerEv": dos_at_fermi,
        "spinResolved": spin_resolved,
        **plot_viewport,
    }, artifacts


def _apply_reciprocal_ticks(axis: plt.Axes, distances: np.ndarray, settings: dict[str, Any]) -> None:
    path_metadata = settings.get("_reciprocalPath")
    if not isinstance(path_metadata, dict):
        return
    labels = path_metadata.get("labels")
    tick_indices = path_metadata.get("tickIndices")
    if not isinstance(labels, list) or not isinstance(tick_indices, list):
        return
    usable = [
        (int(index), str(label))
        for index, label in zip(tick_indices, labels)
        if isinstance(index, (int, float)) and 0 <= int(index) < len(distances)
    ]
    if not usable:
        return
    tick_positions = [distances[index] for index, _ in usable]
    tick_labels = ["Γ" if label.upper() == "GAMMA" else label for _, label in usable]
    axis.set_xticks(tick_positions, tick_labels)
    for position in tick_positions:
        axis.axvline(position, color="#d6d9df", linewidth=0.45, zorder=0)


def _render_phonon(
    work_dir: Path,
    output_dir: Path,
    settings: dict[str, Any],
) -> tuple[dict[str, Any], list[Artifact]]:
    frequency_path = _find_first(work_dir, ("*.freq.gp", "*.freq"))
    if frequency_path is None:
        raise FileNotFoundError("Quantum ESPRESSO matdyn frequency data was not produced")
    table = read_numeric_table(frequency_path, minimum_columns=2)
    q_distance = table[:, 0]
    frequencies_cm = table[:, 1:]
    csv_path = output_dir / "data" / "phonon-dispersion.csv"
    _write_csv(
        csv_path,
        ["q_distance", *[f"mode_{index + 1}_cm-1" for index in range(frequencies_cm.shape[1])]],
        [q_distance, *[frequencies_cm[:, index] for index in range(frequencies_cm.shape[1])]],
    )
    _plot_style()
    fig, axis = plt.subplots(figsize=(3.39, 3.0), constrained_layout=True)
    _plot_path_branches(axis, q_distance, frequencies_cm, settings)
    axis.axhline(0.0, color="#d24b40", linewidth=0.85, linestyle="--")
    axis.set_xlabel("q-path")
    axis.set_ylabel(r"Frequency (cm$^{-1}$)")
    _apply_reciprocal_ticks(axis, q_distance, settings)
    plot_viewport = _apply_plot_limits(
        axis,
        settings,
        default_xlim=(float(q_distance.min()), float(q_distance.max())),
    )
    artifacts = [Artifact(csv_path.as_posix(), "Phonon dispersion data (CSV)", "data", "text/csv")]
    artifacts.extend(_save_figure(fig, output_dir / "plots" / "phonon-dispersion", "Phonon dispersion"))
    minimum = float(np.min(frequencies_cm))
    def executed_asr(filename: str, variable: str) -> str | None:
        for path in (output_dir / "inputs" / filename, work_dir / filename):
            if path.is_file():
                source = "\n".join(line.split("!", 1)[0] for line in path.read_text(encoding="utf-8").splitlines())
                match = re.search(rf"\b{variable}\s*=\s*['\"]([^'\"]+)['\"]", source, re.I)
                return match.group(1).lower() if match else None
        return None
    asr = {"q2r": executed_asr("q2r.in", "zasr"), "matdyn": executed_asr("matdyn.in", "asr")}
    acoustic_scope = "sampled path; " + "; ".join(f"{stage} ASR {value if value is not None else 'unknown (executed setting not retained)'}" for stage, value in asr.items())
    return {
        "phononStabilityScope": "sampled-q-path",
        "fullBrillouinZoneStabilityVerified": False,
        "imaginaryModeReportingThresholdCmMinus1": -1.0,
        "acousticResidualScope": acoustic_scope,
        "acousticSumRule": asr,
        "preCorrectionAcousticResidualRetained": False,
        "minimumFrequencyCmMinus1": minimum,
        "maximumFrequencyCmMinus1": float(np.max(frequencies_cm)),
        "hasImaginaryModes": minimum < -1.0,
        **plot_viewport,
    }, artifacts


def _render_transport(
    work_dir: Path,
    output_dir: Path,
    fermi_ev: float | None,
    settings: dict[str, Any],
) -> tuple[dict[str, Any], list[Artifact]]:
    validate_transport_settings(settings)
    if fermi_ev is None or not math.isfinite(fermi_ev):
        raise ValueError("Transport requires a finite Fermi reference from the exact NSCF XML")
    trace_path = _find_first(work_dir, ("*.trace",))
    if trace_path is None:
        raise FileNotFoundError("BoltzTraP2 transport trace was not produced")
    transport = parse_boltztrap_trace(trace_path, fermi_ev)
    chemical_min = float(
        settings.get("transportChemicalPotentialMin", settings.get("chemicalPotentialMin", -0.5))
    )
    chemical_max = float(
        settings.get("transportChemicalPotentialMax", settings.get("chemicalPotentialMax", 0.5))
    )
    if chemical_min >= chemical_max:
        raise ValueError("The transport chemical-potential window is invalid")
    requested_window_mask = (
        (transport["chemicalPotentialEv"] >= chemical_min)
        & (transport["chemicalPotentialEv"] <= chemical_max)
    )
    if not np.any(requested_window_mask):
        raise ValueError("BoltzTraP2 produced no data inside the requested chemical-potential window")
    tau_fs = float(settings.get("transportRelaxationTime") or settings.get("relaxationTimeFs") or 10.0)
    tau_seconds = tau_fs * 1e-15
    conductivity = transport["conductivityPerTau"] * tau_seconds
    thermal_conductivity = transport["electronicThermalConductivityPerTau"] * tau_seconds
    seebeck_uv = transport["seebeckVPerK"] * 1e6
    power_factor_mw = transport["seebeckVPerK"] ** 2 * conductivity * 1e3
    (
        reference_ev,
        reference_seebeck_uv,
        reference_seebeck_spread_uv,
        zero_crossings_ev,
        reference_mode,
    ) = _transport_plot_reference(
        transport["chemicalPotentialEv"],
        transport["temperatureK"],
        seebeck_uv,
        (chemical_min, chemical_max),
    )
    plot_chemical_potential = transport["chemicalPotentialEv"] - reference_ev
    plot_seebeck_uv = seebeck_uv - reference_seebeck_uv
    default_xlim = _transport_auto_window(
        transport["chemicalPotentialEv"],
        transport["temperatureK"],
        reference_ev,
        (chemical_min, chemical_max),
    )

    _plot_style()
    fig, axes = plt.subplots(2, 2, figsize=(7.08, 5.2), constrained_layout=True, sharex=True)
    plot_viewport = _apply_plot_limits(
        axes[0, 0],
        settings,
        default_xlim=default_xlim,
        allow_y=False,
    )
    plot_window = tuple(plot_viewport["plotXWindow"])
    plot_mask = (
        np.isfinite(plot_chemical_potential)
        & (plot_chemical_potential >= plot_window[0])
        & (plot_chemical_potential <= plot_window[1])
    )
    temperatures = np.unique(transport["temperatureK"])
    colors = plt.cm.viridis(np.linspace(0.12, 0.88, max(1, len(temperatures))))
    quantities = (
        (
            plot_seebeck_uv,
            r"Seebeck $S-S_0$ ($\mu$V/K)"
            if reference_mode in {"seebeck-curve-intersection", "seebeck-transition-center"}
            else r"Seebeck ($\mu$V/K)",
            "Seebeck coefficient",
            "thermoelectric-seebeck",
        ),
        (conductivity, r"Conductivity (S/m)", "Electrical conductivity", "thermoelectric-conductivity"),
        (power_factor_mw, r"Power factor (mW m$^{-1}$ K$^{-2}$)", "Power factor", "thermoelectric-power-factor"),
        (thermal_conductivity, r"$\kappa_e$ (W m$^{-1}$ K$^{-1}$)", "Electronic thermal conductivity", "thermoelectric-thermal-conductivity"),
    )
    for color, temperature in zip(colors, temperatures, strict=True):
        mask = plot_mask & (transport["temperatureK"] == temperature)
        order = np.argsort(plot_chemical_potential[mask])
        chemical_potential = plot_chemical_potential[mask][order]
        for axis, (values, label, title, _) in zip(axes.flat, quantities, strict=True):
            axis.plot(chemical_potential, values[mask][order], color=color, linewidth=1.0, label=f"{temperature:g} K")
            axis.set_ylabel(label)
            axis.set_title(title, pad=5.0)
    for axis in axes.flat:
        axis.axvline(0.0, color="#9ca3af", linewidth=0.6, linestyle="--")
        axis.set_xlim(*plot_window)
    axes[0, 0].axhline(0.0, color="#9ca3af", linewidth=0.6, linestyle="--")
    for axis in axes[-1, :]:
        axis.set_xlabel(
            r"Chemical potential $\mu-\mu_0$ (eV)"
            if reference_mode != "fermi"
            else r"Chemical potential $\mu-E_F$ (eV)"
        )
    handles, labels = axes[0, 0].get_legend_handles_labels()
    fig.legend(
        handles,
        labels,
        loc="outside upper center",
        ncol=max(1, min(3, len(temperatures))),
    )
    fig.suptitle("Thermoelectric properties", fontsize=10.5, fontweight="semibold")

    csv_path = output_dir / "data" / "thermoelectric-properties.csv"
    _write_csv(
        csv_path,
        (
            "chemical_potential_ev_relative_to_fermi",
            "chemical_potential_ev_relative_to_plot_reference",
            "temperature_k",
            "seebeck_uv_per_k",
            "seebeck_uv_per_k_relative_to_plot_reference",
            "conductivity_s_per_m",
            "power_factor_mw_per_m_k2",
            "electronic_thermal_conductivity_w_per_m_k",
        ),
        (
            transport["chemicalPotentialEv"][requested_window_mask],
            plot_chemical_potential[requested_window_mask],
            transport["temperatureK"][requested_window_mask],
            seebeck_uv[requested_window_mask],
            plot_seebeck_uv[requested_window_mask],
            conductivity[requested_window_mask],
            power_factor_mw[requested_window_mask],
            thermal_conductivity[requested_window_mask],
        ),
    )
    artifacts = [Artifact(csv_path.as_posix(), "Thermoelectric data (CSV)", "data", "text/csv")]
    artifacts.extend(_save_figure(fig, output_dir / "plots" / "thermoelectric-properties", "Thermoelectric properties"))
    x_label = (
        r"Chemical potential $\mu-\mu_0$ (eV)"
        if reference_mode != "fermi"
        else r"Chemical potential $\mu-E_F$ (eV)"
    )
    for values, y_label, title, filename in quantities:
        single_figure, single_axis = plt.subplots(figsize=(3.54, 3.0), constrained_layout=True)
        for color, temperature in zip(colors, temperatures, strict=True):
            mask = (
                plot_mask
                & (transport["temperatureK"] == temperature)
                & np.isfinite(values)
            )
            order = np.argsort(plot_chemical_potential[mask])
            single_axis.plot(
                plot_chemical_potential[mask][order],
                values[mask][order],
                color=color,
                linewidth=1.0,
                label=f"{temperature:g} K",
            )
        single_axis.axvline(0.0, color="#9ca3af", linewidth=0.6, linestyle="--")
        if filename == "thermoelectric-seebeck":
            single_axis.axhline(0.0, color="#9ca3af", linewidth=0.6, linestyle="--")
        single_axis.set_xlim(*plot_window)
        single_axis.margins(x=0.0)
        single_axis.set_title(title, loc="center", pad=8.0)
        single_axis.set_xlabel(x_label)
        single_axis.set_ylabel(y_label)
        single_axis.legend(loc="upper center", ncol=max(1, min(3, len(temperatures))), frameon=False)
        artifacts.extend(
            _save_figure(
                single_figure,
                output_dir / "plots" / filename,
                title,
            )
        )
    analysis_indices = np.flatnonzero(requested_window_mask)
    peak_index = int(analysis_indices[int(np.nanargmax(power_factor_mw[requested_window_mask]))])
    return {
        "relaxationTimeFs": tau_fs,
        "peakPowerFactorMwPerMK2": float(power_factor_mw[peak_index]),
        "peakPowerFactorTemperatureK": float(transport["temperatureK"][peak_index]),
        "peakPowerFactorChemicalPotentialEv": float(transport["chemicalPotentialEv"][peak_index]),
        "peakPowerFactorChemicalPotentialRelativeToPlotReferenceEv": float(plot_chemical_potential[peak_index]),
        "seebeckAtPeakUvPerK": float(seebeck_uv[peak_index]),
        "scatteringApproximation": "constant relaxation time",
        "scatteringModel": "constant-relaxation-time",
        "transportSampling": "chemical-potential",
        "conductivityNormalization": "trace per second multiplied by relaxationTimeFs × 1e-15 s",
        "traceEnergyUnit": transport["sourceEnergyUnit"],
        "chemicalPotentialPlotReferenceMode": reference_mode,
        "chemicalPotentialPlotReferenceEvRelativeToFermi": reference_ev,
        "seebeckPlotReferenceUvPerK": reference_seebeck_uv,
        "seebeckPlotReferenceSpreadUvPerK": reference_seebeck_spread_uv,
        "seebeckZeroCrossingsEvRelativeToFermi": [float(value) for value in zero_crossings_ev],
        "transportRequestedWindowEvRelativeToFermi": [chemical_min, chemical_max],
        "plotXWindow": plot_viewport["plotXWindow"],
        "plotRangeMode": plot_viewport["plotRangeMode"],
    }, artifacts


def build_scientific_results(
    calculation_type: str,
    work_dir: Path,
    output_dir: Path,
    settings: dict[str, Any] | None = None,
    *,
    render_results: bool = True,
) -> dict[str, Any]:
    settings = settings or {}
    output_dir.mkdir(parents=True, exist_ok=True)
    if calculation_type == "Nudged elastic band":
        from neb import neb_results
        input_path = output_dir / "inputs" / "neb.in"
        if not input_path.is_file(): input_path = work_dir / "neb.in"
        summary, generated = neb_results(work_dir, output_dir, input_path.read_text(), require_success=render_results)
        for candidate in sorted((output_dir / "evidence").glob("neb-image-*.out")):
            generated.append({"path": candidate.relative_to(output_dir).as_posix(), "label": candidate.name, "role": "evidence", "contentType": "text/plain"})
        generated.append({"path":"logs/neb.out", "label":"NEB solver log", "role":"log", "contentType":"text/plain"})
        if render_results and summary.get("converged"):
            rows = np.loadtxt(output_dir / "data" / "neb-mep.csv", delimiter=",", skiprows=1)
            fig, ax = plt.subplots(figsize=(3.54,3.0), constrained_layout=True)
            ax.plot(rows[:,0], rows[:,1], "o-", linewidth=1)
            ax.set_xlabel("Normalized reaction coordinate"); ax.set_ylabel("Energy relative to initial state (eV)")
            generated.extend(_relative_artifacts(_save_figure(fig, output_dir / "plots" / "neb-mep", "Minimum energy path"), output_dir))
        return {"summary": summary, "artifacts": generated, "provenance": {"calculationType":calculation_type,"syntheticData":False,"source":"Retained QE NEB path and image SCF logs"}}
    qe_summary: dict[str, Any] = {}
    stages: list[dict[str, Any]] = []
    inputs_by_stage = {"scf": "scf.in", "bands-nscf": "nscfbands.in", "dos-nscf": "nscfdos.in", "nscf-transport": "nscftransport.in", "relax": "vcrelax.in", "phonon": "ph.in", "bands-postprocess": "bands.in", "dos-postprocess": "dos.in", "projected-dos": "projwfc.in", "projected-bands": "projwfc.in", "force-constants": "q2r.in", "phonon-dispersion": "matdyn.in"}
    logs = sorted((output_dir / "logs").glob("*.out"), key=lambda path: (path.stat().st_mtime_ns, path.name))
    for candidate in logs:
        if candidate.name.startswith("preflight-") or candidate.name.startswith("boltztrap2-"):
            continue
        input_name = inputs_by_stage.get(candidate.stem)
        input_path = output_dir / "inputs" / str(input_name)
        if candidate.stem == "relax" and not input_path.is_file():
            input_path = output_dir / "inputs" / "relax.in"
        input_text = input_path.read_text(encoding="utf-8") if input_path.is_file() else ""
        default_mode = "scf" if candidate.stem == "scf" else "nscf" if candidate.stem in {"bands-nscf", "dos-nscf", "nscf-transport"} else "phonon" if candidate.stem == "phonon" else ""
        mode = qe_string_value(input_text, "CONTROL", "calculation", default_mode) or None
        xml = output_dir / "evidence" / f"{candidate.stem}.xml"
        parsed = parse_qe_output(candidate.read_text(encoding="utf-8", errors="replace"), mode, input_text=input_text, xml_path=xml if xml.is_file() else None)
        thresholds = {}
        for key in ("conv_thr", "forc_conv_thr", "etot_conv_thr", "press_conv_thr", "press", "tr2_ph"):
            namelist = "ELECTRONS" if key == "conv_thr" else "CONTROL" if key in {"forc_conv_thr", "etot_conv_thr"} else "CELL" if key in {"press_conv_thr", "press"} else "INPUTPH"
            value = _qe_numeric(input_text, namelist, key)
            if value is not None:
                thresholds[key] = value
        stages.append({"stage": candidate.stem, "log": f"logs/{candidate.name}", "inputFile": input_path.name if input_text else None, "calculationMode": mode, "thresholds": thresholds, **parsed})
        for key in ("totalEnergyRy", "fermiEnergyEv", "scfIterations", "scfResidualRy", "totalForceRyBohr", "maximumForceRyBohr", "stressTensorRyBohr3", "stressTensorKbar", "pressureKbar"):
            if parsed[key] is not None:
                qe_summary[key] = parsed[key]
    inherited = settings.get("_inheritedScfStage")
    if inherited is not None:
        if not isinstance(inherited, dict) or inherited.get("execution") != "inherited" or inherited.get("stage") != "scf" or qe_stage_error(inherited):
            raise ValueError("Inherited SCF evidence is invalid.")
        if any(stage["stage"] == "scf" for stage in stages):
            raise ValueError("A shared-SCF consumer also executed SCF. Review its runtime.")
        stages.insert(0, inherited)
        # Scalars retain the source SCF's meaning and provenance. Branch NSCF
        # scalars take precedence when the branch reports them explicitly.
        for key in ("totalEnergyRy", "fermiEnergyEv", "scfIterations", "scfResidualRy", "totalForceRyBohr", "maximumForceRyBohr", "stressTensorRyBohr3", "stressTensorKbar", "pressureKbar"):
            if qe_summary.get(key) is None and inherited.get(key) is not None:
                qe_summary[key] = inherited[key]
    electronic_stages = [stage for stage in stages if stage["calculationMode"] is not None or stage["stage"] == "phonon"]
    qe_summary["converged"] = bool(electronic_stages) and all(stage["converged"] for stage in electronic_stages)
    qe_summary["jobDone"] = bool(stages) and all(stage["jobDone"] for stage in stages)
    qe_summary["stageConvergence"] = stages
    qe_summary["geometryConverged"] = all(stage["ionicConvergence"] in {"not-applicable", "converged"} and stage["cellConvergence"] in {"not-applicable", "converged"} for stage in stages) if any(stage["calculationMode"] in {"relax", "vc-relax"} for stage in stages) else None
    qe_summary["observableConvergence"] = {"status": "not-assessed", "reason": "Requires study-specific refinement series and observable tolerance"}
    qe_summary["physicalValidation"] = {"status": "not-assessed", "reason": "Solver convergence is separate from model validation"}
    fermi_ev = qe_summary.get("fermiEnergyEv")

    artifacts: list[Artifact] = []
    summary: dict[str, Any] = dict(qe_summary)
    if render_results:
        failure = dft_result_error({"status": "completed", "calculationType": calculation_type, "summary": summary})
        if failure:
            raise ValueError(failure)
    if render_results and calculation_type == "Band structure":
        specialized, generated = _render_bands(work_dir, output_dir, settings)
        summary.update(specialized)
        artifacts.extend(generated)
    elif render_results and calculation_type == "Density of states":
        specialized, generated = _render_dos(work_dir, output_dir, fermi_ev, settings)
        summary.update(specialized)
        artifacts.extend(generated)
    elif render_results and calculation_type == "Phonon dispersion":
        specialized, generated = _render_phonon(work_dir, output_dir, settings)
        summary.update(specialized)
        artifacts.extend(generated)
    elif render_results and calculation_type == "Thermoelectric properties":
        xml = exact_qe_stage_xml(work_dir, output_dir, "nscf-transport", "nscftransport.in")
        reference = transport_fermi_reference(xml, output_dir)
        summary["fermiEnergyEv"] = reference["valueEv"]
        summary["transportFermiReference"] = reference
        specialized, generated = _render_transport(work_dir, output_dir, reference["valueEv"], settings)
        summary.update(specialized)
        artifacts.extend(generated)

    for retained in sorted((output_dir / "inherited").rglob("*")):
        if retained.is_file():
            artifacts.append(Artifact(retained.as_posix(), f"Inherited SCF {retained.name}", "evidence", "application/xml" if retained.suffix == ".xml" else "text/plain"))
    for xml in sorted((output_dir / "evidence").glob("*.xml")):
        artifacts.append(Artifact(xml.as_posix(), f"{xml.stem} stage XML", "evidence", "application/xml"))
    for log in sorted((output_dir / "logs").glob("*.out")):
        artifacts.append(Artifact(log.as_posix(), log.name, "log", "text/plain"))
    return {
        "summary": summary,
        "artifacts": _relative_artifacts(artifacts, output_dir),
        "provenance": {
            "calculationType": calculation_type,
            "source": "Quantum ESPRESSO and BoltzTraP2 output files",
            "syntheticData": False,
            "plotDpi": PLOT_DPI,
        },
    }


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def write_result_manifest(path: Path, payload: dict[str, Any]) -> None:
    if payload.get("status") == "failed":
        # Failure evidence is best effort: an unreadable or disappearing
        # diagnostic must not erase the original scientific error.
        root = path.parent.resolve()
        available, unavailable = [], []
        for artifact in payload.get("artifacts", []):
            relative = Path(str(artifact.get("path", "")))
            try:
                source = (root / relative).resolve()
                if relative.is_absolute() or ".." in relative.parts or root not in source.parents or not source.is_file():
                    raise ValueError("missing or unsafe diagnostic")
                artifact["sha256"] = _file_sha256(source)
                artifact["sizeBytes"] = source.stat().st_size
            except (OSError, ValueError):
                unavailable.append(relative.as_posix())
                continue
            available.append(artifact)
        payload["artifacts"] = available
        if unavailable:
            payload["diagnosticsUnavailable"] = unavailable
        invalid_fields = []
        omitted = object()
        def finite_diagnostics(value: Any, field: str) -> Any:
            if isinstance(value, float) and not math.isfinite(value):
                invalid_fields.append(field)
                return omitted
            if isinstance(value, dict):
                cleaned = {}
                for key, child in value.items():
                    diagnostic = finite_diagnostics(child, f"{field}.{key}" if field else str(key))
                    if diagnostic is not omitted:
                        cleaned[key] = diagnostic
                return cleaned
            if isinstance(value, list):
                cleaned = [finite_diagnostics(child, f"{field}[{index}]") for index, child in enumerate(value)]
                # Keep vector/tensor positions meaningful by omitting the whole
                # invalid array rather than removing individual coordinates.
                return omitted if any(child is omitted for child in cleaned) else cleaned
            return value
        serializable = finite_diagnostics(payload, "")
        if invalid_fields:
            serializable["diagnosticsInvalidFields"] = invalid_fields
        path.write_text(json.dumps(serializable, indent=2, sort_keys=True, allow_nan=False), encoding="utf-8")
        return
    if payload.get("status") == "completed":
        sources, skipped = [], []
        total = 0
        root = path.parent.resolve()
        artifacts = payload.get("artifacts", [])
        for artifact in artifacts:
            relative = Path(str(artifact.get("path", "")))
            source = (root / relative).resolve()
            if relative.is_absolute() or ".." in relative.parts or root not in source.parents or not source.is_file():
                raise ValueError(f"Completed result has a missing or unsafe artifact: {relative}")
            artifact["sha256"] = _file_sha256(source)
            artifact["sizeBytes"] = source.stat().st_size
        # Executed inputs and run diagnostics are mandatory replay evidence;
        # plots and large binary scratch remain separately downloadable.
        for artifact in sorted(artifacts, key=lambda item: {"input": 0, "log": 1, "evidence": 2, "data": 3}.get(item.get("role"), 4)):
            relative = Path(str(artifact.get("path", "")))
            if artifact.get("role") not in {"data", "input", "raw-data", "log", "evidence"}:
                continue
            source = root / relative
            if source.suffix.lower() in {".bt2", ".btj", ".gz", ".zip"}:
                skipped.append(relative.as_posix())
                continue
            size = source.stat().st_size
            if size > 4_000_000 or total + size > 20_000_000:
                skipped.append(relative.as_posix())
                continue
            raw = source.read_bytes()
            try:
                source_text = raw.decode("utf-8")
            except UnicodeDecodeError:
                skipped.append(relative.as_posix())
                continue
            entry = {**artifact, "text": source_text}
            encoded_size = len(json.dumps(entry, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
            if total + encoded_size > 20_000_000:
                skipped.append(relative.as_posix())
                continue
            sources.append(entry)
            total += encoded_size
        mandatory = [item["path"] for item in artifacts if item.get("role") in {"input", "log", "evidence"}]
        retained_paths = {item["path"] for item in sources}
        missing = [name for name in mandatory if name not in retained_paths]
        provenance = payload.get("provenance", {})
        replay = {
            "schemaVersion": 1,
            "status": "incomplete-evidence" if missing or not mandatory else "requires-model-files-and-runtime",
            "missingRetainedEvidence": missing,
            "modelFilesIncluded": False,
            "modelDependencies": provenance.get("modelIdentity", provenance.get("pseudopotentials", [])),
            "workflowSettings": provenance.get("workflowSettings", {}),
            "software": provenance.get("software", {}),
            "solverExecutables": provenance.get("solverExecutables", []),
            "steps": payload.get("steps", []),
            "instructions": "Restore retained inputs and verified model files under their exact filenames. Obtain licensed UPFs from their recorded library/provider; do not substitute another model. Use the recorded QE/BoltzTraP2 runtime and settings. Run the recorded stages in order, then compare study observables using predeclared numerical tolerances. Binary wavefunctions/interpolation caches are not retained in this compact bundle and must be regenerated.",
            "observableComparison": "not-assessed; requires study-specific expected values and tolerances",
        }
        retained = root / "research" / "dataset.json"
        retained.parent.mkdir(parents=True, exist_ok=True)
        retained.write_text(json.dumps({"schemaVersion": 1, "calculationId": payload.get("calculationId"), "calculationType": payload.get("calculationType"), "summary": payload.get("summary", {}), "provenance": provenance, "sources": sources, "skippedSources": skipped, "replay": replay}, ensure_ascii=False, separators=(",", ":"), allow_nan=False), encoding="utf-8")
        payload["researchData"] = {"path": "research/dataset.json", "retention": "research-data", "skippedSources": skipped, "replayStatus": replay["status"]}
    path.write_text(json.dumps(payload, indent=2, sort_keys=True, allow_nan=False), encoding="utf-8")

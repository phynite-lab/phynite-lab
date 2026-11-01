"""Run real Phynite MD workflows with LAMMPS and OVITO.

Version 1 jobs retain the original single-recipe contract. Version 2 jobs use
the ordered workflow emitted by MD Lab. The worker performs all network I/O;
this process only reads its mounted workspace and writes verified artifacts.
"""
from __future__ import annotations
from backend.compute.compute_clock import measured_compute

import hashlib
import json
import math
import mimetypes
import os
import re
import shlex
import shutil
import subprocess
import time
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from ovito.io import export_file, import_file

try:
    from md_local.clock import instrument_clock, parse_clock, physical_time, repair_trajectory_clock, analysis_time_index
    from md_local.research_evidence import mechanical_series, stage_quality
    from md_local.source_snapshot import load_source_snapshot
except ModuleNotFoundError:
    from backend.md_local.clock import instrument_clock, parse_clock, physical_time, repair_trajectory_clock, analysis_time_index
    from backend.md_local.research_evidence import mechanical_series, stage_quality
    from backend.md_local.source_snapshot import load_source_snapshot

try:  # Container/package import.
    from md_local.legacy_runner import (
        build_recipe_data,
        generate_lammps_input,
        parse_thermo,
        strain_rate_per_ps,
        validate_lj_species,
    )
except ModuleNotFoundError:  # Repository test import.
    from backend.md_local.legacy_runner import (
        build_recipe_data,
        generate_lammps_input,
        parse_thermo,
        strain_rate_per_ps,
        validate_lj_species,
    )


WORK = Path(os.environ.get("PHYNITE_WORK_DIR", "/work")).resolve()
INPUT = WORK / "input.json"
RESULTS = WORK / "results"
RECIPES = {"equilibration", "tensile", "shear", "compression", "melting", "diffusion"}
WORKFLOW_STEP_KINDS = {
    "minimization", "velocity", "nve", "nvt", "npt", "heating", "cooling",
    "nph", "langevin", "temp-berendsen", "press-berendsen", "pressure-ramp",
    "annealing", "tensile", "compression", "shear", "diffusion", "rdf", "vacf",
    "coordination", "cna", "centrosymmetry", "voronoi", "stress-atom", "pe-atom",
    "ke-atom", "restart",
}
DIRECTIVE_BLOCK_KINDS = {
    "run", "minimize", "velocity", "thermostat", "barostat", "deform", "analysis", "checkpoint"
}
DIRECTIVE_BLOCK_LABELS = {
    "run": "Run", "minimize": "Minimize", "velocity": "Initialize velocity",
    "thermostat": "Temperature control", "barostat": "Pressure control",
    "deform": "Deformation", "analysis": "Analysis", "checkpoint": "Checkpoint",
}
PROJECT_POTENTIAL_FAMILIES = {"eam", "eam-alloy", "meam", "tersoff", "sw"}
SAFE_BOUNDARIES = {"p p p", "p p f", "p f p", "f p p", "p f f", "f p f", "f f p", "f f f"}
SAFE_IDENTIFIER = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
SAFE_ELEMENT = re.compile(r"^(?:[A-Z][a-z]?|Generic)$")
MAX_MANUAL_BYTES = 64_000
THERMO_FIELDS = (
    "step", "timePs", "tempK", "pressureBar", "potentialEnergyEv", "kineticEnergyEv",
    "totalEnergyEv", "volumeA3", "lx", "ly", "lz", "xy", "xz", "yz", "pxx",
    "pyy", "pzz", "pxy", "pxz", "pyz",
)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def finite(value: Any, label: str, minimum: float, maximum: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{label} must be numeric")
    result = float(value)
    if not math.isfinite(result) or result < minimum or result > maximum:
        raise ValueError(f"{label} is outside the supported range")
    return result


def whole_number(value: Any, label: str, minimum: int, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{label} must be a whole number")
    if value < minimum or value > maximum:
        raise ValueError(f"{label} is outside the supported range")
    return value


def safe_identifier(value: Any, label: str) -> str:
    result = str(value or "")
    if not SAFE_IDENTIFIER.fullmatch(result):
        raise ValueError(f"{label} is invalid")
    return result


def safe_filename(value: Any, label: str = "Filename") -> str:
    result = str(value or "")
    if (
        not result or len(result.encode("utf-8")) > 240 or result in {".", ".."}
        or Path(result).name != result or "/" in result or "\\" in result or "\x00" in result
    ):
        raise ValueError(f"{label} is unsafe")
    return result


def safe_work_file(value: Any, label: str) -> tuple[str, Path]:
    relative = Path(str(value or ""))
    if relative.is_absolute() or ".." in relative.parts or not relative.parts:
        raise ValueError(f"{label} is unsafe")
    resolved = (WORK / relative).resolve()
    try:
        resolved.relative_to(WORK)
    except ValueError as exc:
        raise ValueError(f"{label} is unsafe") from exc
    if not resolved.is_file() or resolved.is_symlink():
        raise ValueError(f"{label} is missing")
    return relative.as_posix(), resolved


def _manual_lines(body: str) -> list[str]:
    """Join LAMMPS continuations without reinterpreting quoted payloads."""
    lines: list[str] = []
    pending = ""
    continued = False
    for line in body.splitlines():
        # Check the raw last printable character before shlex removes quotes:
        # print "&" is a complete command, whereas print "a &\n b" continues.
        # A comment after '&' prevents continuation in LAMMPS itself.
        continued = line.rstrip().endswith("&")
        pending += line.rstrip()[:-1] if continued else line
        if continued:
            continue
        lines.append(pending)
        pending = ""
    if continued:
        raise ValueError("LAMMPS input ends with an incomplete continued command")
    return lines


def _manual_commands(body: str) -> list[list[str]]:
    """Parse executable command positions, including LAMMPS continuations."""
    commands: list[list[str]] = []
    for line in _manual_lines(body):
        try:
            tokens = shlex.split(line, comments=True, posix=True)
        except ValueError as exc:
            raise ValueError("LAMMPS input contains an unterminated quoted command") from exc
        if tokens:
            commands.append(tokens)
    return commands


def validate_manual_body(value: Any) -> str:
    """Repeat API checks inside the isolated runtime (defense in depth)."""
    if not isinstance(value, str):
        raise ValueError("LAMMPS input must be text")
    body = value.replace("\r\n", "\n").replace("\r", "\n").strip()
    if not body or len(body.encode("utf-8")) > MAX_MANUAL_BYTES or "\x00" in body:
        raise ValueError("LAMMPS input is empty or too large")
    blocked = {
        "shell", "python", "plugin", "include", "jump", "clear", "quit", "units", "dimension",
        "boundary", "atom_style", "create_box", "read_data", "read_restart", "log", "dump",
        "undump", "write_data", "write_dump", "write_restart", "write_coeff", "restart",
        "thermo", "thermo_style", "thermo_modify", "pair_style", "pair_coeff",
        "pair_modify", "pair_write", "mass", "create_atoms", "read_dump", "reset_timestep",
    }
    unsafe_path = re.compile(r"(?:^|\s)(?:/|~(?:/|\s)|\.\.(?:/|\\)|[a-z][a-z0-9+.-]*://)", re.I)
    has_execution = False
    commands = _manual_commands(body)
    if len(commands) > 500:
        raise ValueError("LAMMPS input contains too many commands")
    for tokens in commands:
        line = " ".join(tokens)
        command = tokens[0].lower()
        if command.startswith("$") or command in blocked:
            raise ValueError(f"LAMMPS command {command!r} is managed by Phynite or is not allowed")
        # Ordinary keywords such as `fix deform ... units box` are arguments.
        # Reject the constructs that actually execute nested command strings.
        if command == "if" or command == "run" and any(token.lower() == "every" for token in tokens[1:]):
            raise ValueError("Nested LAMMPS command strings are not allowed")
        if command == "variable" and len(tokens) >= 3 and tokens[2].lower() in {"atomfile", "file", "python"}:
            raise ValueError("LAMMPS variables cannot load files or Python")
        if command == "fix" and len(tokens) > 3 and tokens[3].lower() == "dt/reset":
            raise ValueError("Adaptive dt/reset is not supported by the retained analysis-time contract; use explicit fixed timesteps per stage")
        if unsafe_path.search(line.lower()):
            raise ValueError("LAMMPS input contains an unsafe path")
        if command in {"fix", "print", "variable", "info", "balance"} and any(
            token.lower() in {"file", "append", "out"} for token in tokens[1:]
        ):
            raise ValueError("LAMMPS input cannot create unmanaged output files")
        has_execution = has_execution or command in {"run", "minimize"}
    if not has_execution:
        raise ValueError("LAMMPS input must contain a run or minimize command")
    return body + "\n"


def _directive_params(block: dict[str, Any], expected: set[str]) -> dict[str, Any]:
    params = block.get("params")
    if not isinstance(params, dict) or set(params) != expected:
        raise ValueError(f"LAMMPS {block.get('kind')} block parameters are invalid")
    return params


def _directive_number_text(value: float) -> str:
    """Match the browser compiler's 12-significant-digit Number string."""
    if value == 0:
        return "0"
    raw = f"{value:.12g}".lower()
    if "e" not in raw:
        return raw.rstrip("0").rstrip(".") if "." in raw else raw
    mantissa, exponent_text = raw.split("e", 1)
    exponent = int(exponent_text)
    if -6 <= exponent < 21:
        fixed = format(Decimal(raw), "f")
        return fixed.rstrip("0").rstrip(".") if "." in fixed else fixed
    normalized_mantissa = mantissa.rstrip("0").rstrip(".")
    return f"{normalized_mantissa}e{exponent}"


def compile_directive_block(block: dict[str, Any], index: int) -> list[str]:
    kind = block.get("kind")
    suffix = f"{index:03d}"
    if kind == "run":
        params = _directive_params(block, {"steps"})
        return [f"fix ph_block_{suffix}_int all nve", f"run {whole_number(params.get('steps'), 'Run steps', 0, 100_000_000)}", f"unfix ph_block_{suffix}_int"]
    if kind == "minimize":
        params = _directive_params(block, {"style", "energyTolerance", "forceTolerance", "maxIterations", "maxEvaluations"})
        style = params.get("style")
        if style not in {"cg", "fire", "sd"}:
            raise ValueError("Minimization style is invalid")
        return [
            f"min_style {style}",
            "minimize " + " ".join((
                _directive_number_text(finite(params.get('energyTolerance'), 'Energy tolerance', 0, 1)),
                _directive_number_text(finite(params.get('forceTolerance'), 'Force tolerance', 0, 1)),
                str(whole_number(params.get("maxIterations"), "Maximum iterations", 1, 10_000_000)),
                str(whole_number(params.get("maxEvaluations"), "Maximum evaluations", 1, 100_000_000)),
            )),
        ]
    if kind == "velocity":
        params = _directive_params(block, {"temperatureK", "seed"})
        temperature = finite(params.get("temperatureK"), "Temperature", 0, 100_000)
        seed = whole_number(params.get("seed"), "Velocity seed", 1, 2_147_483_646)
        return [f"velocity all create {_directive_number_text(max(temperature, 1e-6))} {seed} mom yes rot yes dist gaussian"]
    if kind == "thermostat":
        params = _directive_params(block, {"style", "timestepFs", "totalSteps", "tempStartK", "tempEndK", "dampingPs", "seed"})
        style = params.get("style")
        if style not in {"nve", "nvt", "langevin", "temp-berendsen"}:
            raise ValueError("Temperature-control style is invalid")
        timestep = finite(params.get("timestepFs"), "Timestep", 0.0001, 100) / 1000
        steps = whole_number(params.get("totalSteps"), "Total steps", 0, 100_000_000)
        start = finite(params.get("tempStartK"), "Initial temperature", 0, 100_000)
        end = finite(params.get("tempEndK"), "Final temperature", 0, 100_000)
        damping = finite(params.get("dampingPs"), "Temperature damping", 1e-6, 10_000)
        identifier = f"ph_block_{suffix}"
        lines = [f"timestep {_directive_number_text(timestep)}"]
        if style == "nve":
            return lines + [f"fix {identifier} all nve", f"run {steps}", f"unfix {identifier}"]
        if style == "nvt":
            return lines + [f"fix {identifier} all nvt temp {_directive_number_text(start)} {_directive_number_text(end)} {_directive_number_text(damping)}", f"run {steps}", f"unfix {identifier}"]
        if style == "langevin":
            seed = whole_number(params.get("seed"), "Random seed", 1, 2_147_483_646)
            return lines + [f"fix {identifier}_int all nve", f"fix {identifier}_bath all langevin {_directive_number_text(start)} {_directive_number_text(end)} {_directive_number_text(damping)} {seed} zero yes", f"run {steps}", f"unfix {identifier}_bath", f"unfix {identifier}_int"]
        return lines + [f"fix {identifier}_int all nve", f"fix {identifier}_bath all temp/berendsen {_directive_number_text(start)} {_directive_number_text(end)} {_directive_number_text(damping)}", f"run {steps}", f"unfix {identifier}_bath", f"unfix {identifier}_int"]
    if kind == "barostat":
        params = _directive_params(block, {"style", "timestepFs", "totalSteps", "tempStartK", "tempEndK", "tempDampingPs", "pressureStartBar", "pressureEndBar", "pressureDampingPs"})
        style = params.get("style")
        if style not in {"npt", "nph", "press-berendsen"}:
            raise ValueError("Pressure-control style is invalid")
        timestep = finite(params.get("timestepFs"), "Timestep", 0.0001, 100) / 1000
        steps = whole_number(params.get("totalSteps"), "Total steps", 0, 100_000_000)
        p_start = finite(params.get("pressureStartBar"), "Initial pressure", -1_000_000, 1_000_000)
        p_end = finite(params.get("pressureEndBar"), "Final pressure", -1_000_000, 1_000_000)
        p_damp = finite(params.get("pressureDampingPs"), "Pressure damping", 1e-6, 100_000)
        pressure = f"{_directive_number_text(p_start)} {_directive_number_text(p_end)} {_directive_number_text(p_damp)}"
        identifier = f"ph_block_{suffix}"
        lines = [f"timestep {_directive_number_text(timestep)}"]
        if style == "npt":
            t_start = finite(params.get("tempStartK"), "Initial temperature", 0, 100_000)
            t_end = finite(params.get("tempEndK"), "Final temperature", 0, 100_000)
            t_damp = finite(params.get("tempDampingPs"), "Temperature damping", 1e-6, 10_000)
            return lines + [f"fix {identifier} all npt temp {_directive_number_text(t_start)} {_directive_number_text(t_end)} {_directive_number_text(t_damp)} iso {pressure}", f"run {steps}", f"unfix {identifier}"]
        if style == "nph":
            return lines + [f"fix {identifier} all nph iso {pressure}", f"run {steps}", f"unfix {identifier}"]
        return lines + [f"fix {identifier}_int all nve", f"fix {identifier}_bar all press/berendsen iso {pressure}", f"run {steps}", f"unfix {identifier}_bar", f"unfix {identifier}_int"]
    if kind == "deform":
        params = _directive_params(block, {"mode", "axis", "timestepFs", "totalSteps", "temperatureK", "tempDampingPs", "strainRatePerSecond", "maxStrain"})
        mode = params.get("mode")
        axis = params.get("axis")
        if mode not in {"tensile", "compression", "shear"} or axis not in ({"xy", "xz", "yz"} if mode == "shear" else {"x", "y", "z"}):
            raise ValueError("Deformation mode or axis is invalid")
        timestep = finite(params.get("timestepFs"), "Timestep", 0.0001, 100) / 1000
        steps = whole_number(params.get("totalSteps"), "Total steps", 0, 100_000_000)
        rate = finite(params.get("strainRatePerSecond"), "Strain rate", 1e-12, 1e18)
        maximum = finite(params.get("maxStrain"), "Maximum strain", 1e-9, 10)
        planned = rate * 1e-12 * timestep * steps
        if planned > maximum * (1 + 1e-9):
            raise ValueError(f"This block would reach {planned:.6g} strain, above the {maximum:.6g} safety limit")
        temperature = finite(params.get("temperatureK"), "Temperature", 0, 100_000)
        damping = finite(params.get("tempDampingPs"), "Temperature damping", 1e-6, 10_000)
        erate = rate * 1e-12 * (-1 if mode == "compression" else 1)
        identifier = f"ph_block_{suffix}"
        return [f"timestep {_directive_number_text(timestep)}", f"fix {identifier}_int all nvt temp {_directive_number_text(temperature)} {_directive_number_text(temperature)} {_directive_number_text(damping)}", f"fix {identifier}_def all deform 1 {axis} erate {_directive_number_text(erate)} units box remap x", f"run {steps}", f"unfix {identifier}_def", f"unfix {identifier}_int"]
    if kind == "analysis":
        params = _directive_params(block, {"style", "totalSteps", "sampleEvery", "cutoffAngstrom", "bins", "neighbors"})
        style = params.get("style")
        if style not in {"msd", "rdf", "vacf", "coordination", "cna", "centrosymmetry", "voronoi", "stress-atom", "pe-atom", "ke-atom"}:
            raise ValueError("Analysis style is invalid")
        steps = whole_number(params.get("totalSteps"), "Analysis run steps", 0, 100_000_000)
        identifier = f"ph_block_{suffix}"
        output = f"data/{style}-block-{suffix}-{safe_identifier(block.get('id'), 'LAMMPS block ID')}"
        if style in {"msd", "rdf", "vacf"}:
            if steps < 1:
                raise ValueError("Dynamic analysis requires at least one integration step")
            sample = whole_number(params.get("sampleEvery"), "Sampling interval", 1, steps)
            if style == "rdf":
                bins = whole_number(params.get("bins"), "RDF bins", 10, 10_000)
                cutoff = finite(params.get("cutoffAngstrom"), "RDF cutoff", 1e-6, 10_000)
                commands = [f"comm_modify cutoff {_directive_number_text(cutoff + 2)}", f"compute {identifier} all rdf {bins} cutoff {_directive_number_text(cutoff)}"]
                consumer = f"c_{identifier}[*] file {output}.dat mode vector"
            else:
                commands = [f"compute {identifier} all {'msd com yes' if style == 'msd' else 'vacf'}"]
                consumer = " ".join(f"c_{identifier}[{component}]" for component in range(1, 5)) + f" file {output}.dat"
            return commands + [f"fix {identifier}_avg all ave/time {sample} 1 {sample} {consumer}", f"fix {identifier}_int all nve", f"run {steps}", f"unfix {identifier}_int", f"unfix {identifier}_avg", f"uncompute {identifier}"]
        columns = f"c_{identifier}"
        prefix: list[str] = []
        if style in {"coordination", "cna"}:
            cutoff = finite(params.get("cutoffAngstrom"), "Analysis cutoff", 1e-6, 10_000)
            command = "coord/atom cutoff" if style == "coordination" else "cna/atom"
            compute = f"compute {identifier} all {command} {_directive_number_text(cutoff)}"
            prefix = [f"comm_modify cutoff {_directive_number_text(cutoff + 2)}"]
        elif style == "centrosymmetry":
            neighbors = whole_number(params.get("neighbors"), "Neighbor count", 2, 20)
            if neighbors % 2:
                raise ValueError("Centrosymmetry neighbor count must be even")
            compute = f"compute {identifier} all centro/atom {neighbors}"
        else:
            command = {"voronoi": "voronoi/atom", "stress-atom": "stress/atom NULL", "pe-atom": "pe/atom", "ke-atom": "ke/atom"}[str(style)]
            compute = f"compute {identifier} all {command}"
            if style in {"voronoi", "stress-atom"}:
                columns = " ".join(f"c_{identifier}[{component}]" for component in range(1, 3 if style == 'voronoi' else 7))
        return prefix + [compute, f"dump {identifier}_snapshot all custom 1 {output}.dump id type x y z ix iy iz {columns}", f"dump_modify {identifier}_snapshot first yes sort id", "run 0 post no", f"undump {identifier}_snapshot", f"uncompute {identifier}"]
    if kind == "checkpoint":
        params = _directive_params(block, {"label"})
        label = safe_identifier(params.get("label"), "Checkpoint label")
        return [f"write_restart data/{suffix}-{label}.restart"]
    raise ValueError("LAMMPS block type is not supported")


def validate_directive_blocks(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list) or not 1 <= len(value) <= 24:
        raise ValueError("LAMMPS block list is invalid")
    seen: set[str] = set()
    enabled = False
    for index, block in enumerate(value, 1):
        if not isinstance(block, dict) or set(block) != {"id", "kind", "enabled", "params"}:
            raise ValueError("LAMMPS block is invalid")
        block_id = safe_identifier(block.get("id"), "LAMMPS block ID")
        if block_id in seen:
            raise ValueError("LAMMPS block IDs must be unique")
        seen.add(block_id)
        if block.get("kind") not in DIRECTIVE_BLOCK_KINDS or not isinstance(block.get("enabled"), bool):
            raise ValueError("LAMMPS block state is invalid")
        if block["enabled"]:
            enabled = True
            compile_directive_block(block, index)
    if not enabled:
        raise ValueError("Enable at least one LAMMPS block")
    return value


def compile_directive_blocks(value: Any) -> list[str]:
    """Retain the preceding ensemble through run/analysis blocks until replaced."""
    blocks = validate_directive_blocks(value)
    lines: list[str] = []
    cleanup: list[str] = []
    for index, block in enumerate(blocks, 1):
        if not block["enabled"]:
            continue
        commands = compile_directive_block(block, index)
        control = block["kind"] in {"thermostat", "barostat", "deform"}
        if control or block["kind"] == "minimize":
            lines.extend(cleanup)
            cleanup = []
        if cleanup and block["kind"] in {"run", "analysis"}:
            guard = f"ph_block_{index:03d}_int"
            commands = [line for line in commands if line not in {f"fix {guard} all nve", f"unfix {guard}"}]
        if control:
            while commands and commands[-1].startswith("unfix "):
                cleanup.insert(0, commands.pop())
        if lines:
            lines.append("")
        lines.append(f"# Block {index}: {DIRECTIVE_BLOCK_LABELS[str(block['kind'])]}")
        lines.append(f'print "PHYNITE_BLOCK_BEGIN {index:03d} {block["id"]} {block["kind"]}"')
        lines.extend(commands)
        lines.append(f'print "PHYNITE_BLOCK_END {index:03d} {block["id"]} {block["kind"]}"')
    lines.extend(cleanup)
    return lines


def validate_workflow(workflow: Any) -> dict[str, Any]:
    if not isinstance(workflow, dict) or workflow.get("version") != 2:
        raise ValueError("MD workflow version is invalid")
    mode = workflow.get("mode")
    if mode not in {"simple", "guided", "manual"} or workflow.get("units") != "metal":
        raise ValueError("MD workflow mode or units are invalid")
    if workflow.get("boundaryType") not in SAFE_BOUNDARIES:
        raise ValueError("MD boundary condition is invalid")
    potential = workflow.get("potential")
    if not isinstance(potential, dict) or potential.get("kind") not in {"builtin", "project"}:
        raise ValueError("MD workflow potential is invalid")
    if potential["kind"] == "builtin":
        if potential.get("id") != "lj-generic":
            raise ValueError("The built-in potential is not supported")
        sigma = finite(potential.get("sigmaAngstrom", 3.4), "LJ sigma", 1e-6, 1_000)
        finite(potential.get("epsilonEv", 0.0103), "LJ epsilon", 1e-12, 1_000)
        finite(potential.get("cutoffAngstrom", 8.5), "LJ cutoff", sigma, 10_000)
    else:
        safe_identifier(potential.get("assetId"), "Potential asset ID")
    steps = workflow.get("steps")
    if not isinstance(steps, list) or len(steps) > 64:
        raise ValueError("MD workflow step list is invalid")
    seen: set[str] = set()
    for step in steps:
        if not isinstance(step, dict) or step.get("kind") not in WORKFLOW_STEP_KINDS:
            raise ValueError("MD workflow step is invalid")
        step_id = safe_identifier(step.get("id"), "Workflow step ID")
        if step_id in seen:
            raise ValueError("MD workflow step IDs must be unique")
        seen.add(step_id)
        if not isinstance(step.get("enabled"), bool) or not isinstance(step.get("params"), dict):
            raise ValueError("MD workflow step state is invalid")
        if "directives" in step:
            validate_directive_blocks(step.get("directives"))
    has_legacy_manual = mode == "manual" and isinstance(workflow.get("manualBody"), str) and bool(workflow["manualBody"].strip())
    if not any(step.get("enabled") for step in steps) and not has_legacy_manual:
        raise ValueError("Enable at least one workflow step")
    if has_legacy_manual:
        workflow = {**workflow, "manualBody": validate_manual_body(workflow.get("manualBody"))}
    output = workflow.get("output")
    if not isinstance(output, dict):
        raise ValueError("MD workflow output settings are invalid")
    whole_number(output.get("thermoFrequency"), "Thermo interval", 1, 100_000_000)
    whole_number(output.get("dumpFrequency"), "Dump interval", 1, 100_000_000)
    if "restartEverySteps" in output:
        whole_number(output["restartEverySteps"], "Restart interval", 1, 100_000_000)
    if "productionWindow" in output:
        window = output["productionWindow"]
        if not isinstance(window, dict) or set(window) != {"startPs", "endPs"}:
            raise ValueError("Production window requires startPs and endPs")
        start = finite(window["startPs"], "Production start", 0, 1e12)
        end = finite(window["endPs"], "Production end", 0, 1e12)
        if end <= start:
            raise ValueError("Production end must be later than production start")
    return workflow


def validate_job(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict) or payload.get("kind") != "md-simulation":
        raise ValueError("Unsupported MD simulation job")
    version = payload.get("version")
    if version not in {1, 2}:
        raise ValueError("Unsupported MD simulation job version")
    simulation_id = str(payload.get("simulationId") or "")
    if not simulation_id or payload.get("calculationId") != simulation_id:
        raise ValueError("Simulation identity is invalid")
    source_path, _ = safe_work_file(payload.get("localSourcePath"), "Simulation source")
    payload = {**payload, "localSourcePath": source_path}
    if version == 1:
        config = payload.get("config")
        if not isinstance(config, dict) or config.get("version") != 1 or config.get("recipeId") not in RECIPES:
            raise ValueError("Simulation configuration is invalid")
        if (config.get("forceField") or {}).get("kind") != "lennard-jones":
            raise ValueError("Only a verified Lennard-Jones potential is available for version 1 jobs")
    else:
        payload["workflow"] = validate_workflow(payload.get("workflow"))
    return payload


def _dynamic_params(step: dict[str, Any]) -> tuple[dict[str, Any], float, int, float, float, float]:
    params = step["params"]
    timestep_ps = finite(params.get("timestepFs"), "Timestep", 0.0001, 100) / 1000
    steps = whole_number(params.get("totalSteps"), "Total steps", 1, 100_000_000)
    start = finite(params.get("tempStartK", params.get("temperatureK", 300)), "Initial temperature", 0, 100_000)
    end = finite(params.get("tempEndK", start), "Final temperature", 0, 100_000)
    damping = finite(params.get("tempDampingPs", max(timestep_ps * 100, 0.01)), "Temperature damping", 1e-6, 10_000)
    return params, timestep_ps, steps, start, end, damping


def _marker(index: int, step: dict[str, Any], position: str) -> str:
    return f'print "PHYNITE_STAGE_{position} {index:03d} {step["id"]} {step["kind"]}"'


def _compile_dynamic_step(step: dict[str, Any], index: int) -> list[str]:
    kind = step["kind"]
    params, timestep, steps, start, end, damping = _dynamic_params(step)
    prefix = f"ph{index:03d}"
    lines = [_marker(index, step, "BEGIN"), f"timestep {timestep:.12g}"]
    if kind == "nve":
        lines.extend([f"fix {prefix}_int all nve", f"run {steps}", f"unfix {prefix}_int"])
    elif kind in {"nvt", "heating", "cooling"}:
        lines.extend([f"fix {prefix}_int all nvt temp {start:.12g} {end:.12g} {damping:.12g}", f"run {steps}", f"unfix {prefix}_int"])
    elif kind == "npt":
        pressure = finite(params.get("pressureBar", 0), "Initial pressure", -1_000_000, 1_000_000)
        pressure_end = finite(params.get("pressureEndBar", pressure), "Final pressure", -1_000_000, 1_000_000)
        pressure_damping = finite(params.get("pressureDampingPs", max(timestep * 1000, 0.1)), "Pressure damping", 1e-6, 100_000)
        lines.extend([
            f"fix {prefix}_int all npt temp {start:.12g} {end:.12g} {damping:.12g} iso {pressure:.12g} {pressure_end:.12g} {pressure_damping:.12g}",
            f"run {steps}", f"unfix {prefix}_int",
        ])
    elif kind in {"nph", "pressure-ramp"}:
        pressure = finite(params.get("pressureBar", 0), "Initial pressure", -1_000_000, 1_000_000)
        pressure_end = finite(params.get("pressureEndBar", pressure), "Final pressure", -1_000_000, 1_000_000)
        pressure_damping = finite(params.get("pressureDampingPs", max(timestep * 1000, 0.1)), "Pressure damping", 1e-6, 100_000)
        lines.extend([
            f"fix {prefix}_int all nph iso {pressure:.12g} {pressure_end:.12g} {pressure_damping:.12g}",
            f"run {steps}", f"unfix {prefix}_int",
        ])
    elif kind == "langevin":
        friction = finite(params.get("frictionDampingPs", 0.1), "Langevin damping", 1e-6, 10_000)
        seed = whole_number(params.get("velocitySeed", 4_928_459), "Random seed", 1, 2_147_483_646)
        lines.extend([
            f"fix {prefix}_int all nve",
            f"fix {prefix}_bath all langevin {start:.12g} {end:.12g} {friction:.12g} {seed} zero yes",
            f"run {steps}", f"unfix {prefix}_bath", f"unfix {prefix}_int",
        ])
    elif kind == "temp-berendsen":
        lines.extend([
            f"fix {prefix}_int all nve",
            f"fix {prefix}_bath all temp/berendsen {start:.12g} {end:.12g} {damping:.12g}",
            f"run {steps}", f"unfix {prefix}_bath", f"unfix {prefix}_int",
        ])
    elif kind == "press-berendsen":
        pressure = finite(params.get("pressureBar", 0), "Initial pressure", -1_000_000, 1_000_000)
        pressure_end = finite(params.get("pressureEndBar", pressure), "Final pressure", -1_000_000, 1_000_000)
        pressure_damping = finite(params.get("pressureDampingPs", max(timestep * 1000, 0.1)), "Pressure damping", 1e-6, 100_000)
        lines.extend([
            f"fix {prefix}_int all nve",
            f"fix {prefix}_bar all press/berendsen iso {pressure:.12g} {pressure_end:.12g} {pressure_damping:.12g}",
            f"run {steps}", f"unfix {prefix}_bar", f"unfix {prefix}_int",
        ])
    elif kind == "annealing":
        if steps == 1:
            phases = [(start, end, 1)]
        elif steps == 2:
            phases = [(start, end, 1), (end, start, 1)]
        else:
            heat = max(1, steps * 2 // 5)
            hold = max(1, steps // 5)
            cool = steps - heat - hold
            if cool < 1:
                hold -= 1
                cool = 1
            phases = [(start, end, heat), (end, end, hold), (end, start, cool)]
        for phase, (phase_start, phase_end, count) in enumerate(phases, 1):
            fix_id = f"{prefix}_a{phase}"
            lines.extend([f"fix {fix_id} all nvt temp {phase_start:.12g} {phase_end:.12g} {damping:.12g}", f"run {count}", f"unfix {fix_id}"])
    elif kind in {"tensile", "compression", "shear"}:
        rate = finite(params.get("strainRatePerSecond"), "Strain rate", 1e-12, 1e18) * 1e-12
        maximum = finite(params.get("maxStrain"), "Maximum strain", 1e-9, 10)
        planned = rate * timestep * steps
        if planned > maximum * (1 + 1e-9):
            raise ValueError(f"Step {step['name']!r} would reach {planned:.6g} strain, above the {maximum:.6g} safety limit")
        if kind == "shear":
            dimension = params.get("shearPlane")
            if dimension not in {"xy", "xz", "yz"}:
                raise ValueError("Shear plane is invalid")
        else:
            dimension = params.get("axis")
            if dimension not in {"x", "y", "z"}:
                raise ValueError("Deformation axis is invalid")
            if kind == "compression":
                rate = -rate
        lines.extend([
            f"fix {prefix}_int all nvt temp {start:.12g} {end:.12g} {damping:.12g}",
            f"fix {prefix}_def all deform 1 {dimension} erate {rate:.12g} units box remap x",
            f"run {steps}", f"unfix {prefix}_def", f"unfix {prefix}_int",
        ])
    elif kind == "diffusion":
        sample = max(1, min(steps, 100))
        lines.extend([
            f"compute {prefix}_msd all msd com yes",
            f"fix {prefix}_out all ave/time {sample} 1 {sample} c_{prefix}_msd[1] c_{prefix}_msd[2] c_{prefix}_msd[3] c_{prefix}_msd[4] file data/msd-{index:03d}.dat",
            f"fix {prefix}_int all nvt temp {start:.12g} {end:.12g} {damping:.12g}",
            f"run {steps}", f"unfix {prefix}_int", f"unfix {prefix}_out", f"uncompute {prefix}_msd",
        ])
    elif kind == "rdf":
        bins = whole_number(params.get("bins"), "RDF bins", 10, 10_000)
        cutoff = finite(params.get("cutoffAngstrom"), "RDF cutoff", 1e-6, 10_000)
        sample = whole_number(params.get("sampleEvery"), "RDF sampling interval", 1, steps)
        lines.extend([
            f"comm_modify cutoff {cutoff + 2:.12g}",
            f"compute {prefix}_rdf all rdf {bins} cutoff {cutoff:.12g}",
            f"fix {prefix}_out all ave/time {sample} 1 {sample} c_{prefix}_rdf[*] file data/rdf-{index:03d}.dat mode vector",
            f"fix {prefix}_int all nvt temp {start:.12g} {end:.12g} {damping:.12g}",
            f"run {steps}", f"unfix {prefix}_int", f"unfix {prefix}_out", f"uncompute {prefix}_rdf",
        ])
    elif kind == "vacf":
        sample = whole_number(params.get("sampleEvery"), "VACF sampling interval", 1, steps)
        lines.extend([
            f"compute {prefix}_vacf all vacf",
            f"fix {prefix}_out all ave/time {sample} 1 {sample} c_{prefix}_vacf[1] c_{prefix}_vacf[2] c_{prefix}_vacf[3] c_{prefix}_vacf[4] file data/vacf-{index:03d}.dat",
            f"fix {prefix}_int all nve", f"run {steps}", f"unfix {prefix}_int",
            f"unfix {prefix}_out", f"uncompute {prefix}_vacf",
        ])
    else:
        raise ValueError(f"Unsupported dynamics step {kind}")
    lines.append(_marker(index, step, "END"))
    return lines


def _compile_static_analysis_step(step: dict[str, Any], index: int) -> list[str]:
    kind = step["kind"]
    params = step["params"]
    prefix = f"ph{index:03d}"
    output = f"data/{kind}-{index:03d}.dump"
    if kind == "coordination":
        cutoff = finite(params.get("cutoffAngstrom"), "Coordination cutoff", 1e-6, 10_000)
        compute = f"compute {prefix}_value all coord/atom cutoff {cutoff:.12g}"
        columns = f"c_{prefix}_value"
    elif kind == "cna":
        cutoff = finite(params.get("cutoffAngstrom"), "CNA cutoff", 1e-6, 10_000)
        compute = f"compute {prefix}_value all cna/atom {cutoff:.12g}"
        columns = f"c_{prefix}_value"
    elif kind == "centrosymmetry":
        neighbors = whole_number(params.get("neighbors"), "Centrosymmetry neighbors", 2, 20)
        if neighbors % 2:
            raise ValueError("Centrosymmetry neighbor count must be even")
        compute = f"compute {prefix}_value all centro/atom {neighbors}"
        columns = f"c_{prefix}_value"
    elif kind == "voronoi":
        compute = f"compute {prefix}_value all voronoi/atom"
        columns = f"c_{prefix}_value[1] c_{prefix}_value[2]"
    elif kind == "stress-atom":
        compute = f"compute {prefix}_value all stress/atom NULL"
        columns = " ".join(f"c_{prefix}_value[{component}]" for component in range(1, 7))
    elif kind == "pe-atom":
        compute = f"compute {prefix}_value all pe/atom"
        columns = f"c_{prefix}_value"
    elif kind == "ke-atom":
        compute = f"compute {prefix}_value all ke/atom"
        columns = f"c_{prefix}_value"
    else:
        raise ValueError(f"Unsupported static analysis step {kind}")
    return [
        _marker(index, step, "BEGIN"), compute,
        f"dump {prefix}_snapshot all custom 1 {output} id type x y z ix iy iz {columns}",
        f"dump_modify {prefix}_snapshot first yes sort id", "run 0 post no",
        f"undump {prefix}_snapshot", f"uncompute {prefix}_value", _marker(index, step, "END"),
    ]


def _potential_commands(workflow: dict[str, Any], type_names: list[str], asset: dict[str, Any] | None) -> tuple[list[str], dict[str, Any]]:
    reference = workflow["potential"]
    if reference["kind"] == "builtin":
        validate_lj_species(set(type_names))
        sigma = finite(reference.get("sigmaAngstrom", 3.4), "LJ sigma", 1e-6, 1_000)
        epsilon = finite(reference.get("epsilonEv", 0.0103), "LJ epsilon", 1e-12, 1_000)
        cutoff = finite(reference.get("cutoffAngstrom", 8.5), "LJ cutoff", sigma, 10_000)
        return [f"pair_style lj/cut {cutoff:.12g}", f"pair_coeff * * {epsilon:.12g} {sigma:.12g} {cutoff:.12g}"], {
            "kind": "builtin", "id": "lj-generic", "epsilonEv": epsilon,
            "sigmaAngstrom": sigma, "cutoffAngstrom": cutoff, "files": [],
        }
    if not isinstance(asset, dict):
        raise ValueError("Project potential metadata is missing")
    asset_id = safe_identifier(asset.get("id"), "Potential asset ID")
    if asset_id != reference.get("assetId"):
        raise ValueError("Project potential does not match the workflow")
    family = str(asset.get("family") or "")
    if family not in PROJECT_POTENTIAL_FAMILIES:
        raise ValueError("Project potential family is not supported")
    if asset.get("units") != "metal" or asset.get("atomStyle") != "atomic":
        raise ValueError("Project potential units or atom style are incompatible")
    raw_elements = asset.get("elements")
    if not isinstance(raw_elements, list) or not raw_elements:
        raise ValueError("Project potential element mapping is missing")
    elements = [str(item) for item in raw_elements]
    if len(elements) != len(set(elements)) or any(not SAFE_ELEMENT.fullmatch(item) for item in elements):
        raise ValueError("Project potential element mapping is invalid")
    unknown = sorted(set(type_names) - set(elements))
    if unknown:
        raise ValueError(f"Project potential does not map particle types: {', '.join(unknown)}")
    raw_files = asset.get("files")
    if not isinstance(raw_files, list):
        raise ValueError("Project potential file metadata is missing")
    files = [{"filename": safe_filename(item.get("filename"), "Potential filename"), "role": str(item.get("role") or "potential"), "sizeBytes": item.get("sizeBytes"), "sha256": item.get("sha256")} for item in raw_files if isinstance(item, dict)]
    if len(files) != len(raw_files):
        raise ValueError("Project potential file metadata is invalid")
    by_role: dict[str, list[str]] = {}
    for item in files:
        by_role.setdefault(item["role"], []).append(item["filename"])
    mapping = " ".join(type_names)
    library_element_order: list[str] | None = None
    if family == "meam":
        if len(files) != 2 or len(by_role.get("library", [])) != 1 or len(by_role.get("parameter", [])) != 1:
            raise ValueError("MEAM requires one library file and one parameter file")
        raw_order = asset.get("libraryElementOrder")
        if not isinstance(raw_order, list) or not raw_order:
            raise ValueError("MEAM library element order is unverified. Re-upload the potential with libraryElementOrder matching the parameter file's numeric element indices; atom type order cannot establish this model order.")
        if any(not isinstance(item, str) or not SAFE_ELEMENT.fullmatch(item) for item in raw_order) or len(raw_order) != len(set(raw_order)) or set(raw_order) != set(elements):
            raise ValueError("MEAM libraryElementOrder must contain each potential element exactly once, in the parameter file's numeric index order")
        library_element_order = list(raw_order)
        # The parameter file's I/J/K indices refer to this immutable model
        # order, not to source atom types (which may be permuted or repeated).
        library_mapping = " ".join(library_element_order)
        commands = ["pair_style meam", f"pair_coeff * * potential/{by_role['library'][0]} {library_mapping} potential/{by_role['parameter'][0]} {mapping}"]
    else:
        if len(files) != 1:
            raise ValueError(f"{family} requires one potential file")
        filename = f"potential/{files[0]['filename']}"
        if family == "eam":
            if len(elements) != 1:
                raise ValueError("EAM funcfl potentials require exactly one potential element")
            commands = ["pair_style eam", f"pair_coeff * * {filename}"]
        else:
            style = {"eam-alloy": "eam/alloy", "tersoff": "tersoff", "sw": "sw"}[family]
            commands = [f"pair_style {style}", f"pair_coeff * * {filename} {mapping}"]
    return commands, {
        "kind": "project", "assetId": asset_id, "family": family, "elements": elements,
        "typeMapping": type_names, "citation": str(asset.get("citation") or "Not provided"),
        **({"libraryElementOrder": library_element_order} if library_element_order is not None else {}),
        "license": str(asset.get("license") or "Not specified"), "files": files,
        **{key: asset[key] for key in ("modelVersion", "validityDomain", "validationEvidence", "modelQualification", "acquisitionInstructions") if key in asset},
        "replayModelAcquisition": {"assetId": asset_id, "instructions": str(asset.get("acquisitionInstructions") or "Obtain these exact files from the cited model provider or your project potential library; respect the recorded license and verify every SHA-256 before replay."), "files": [{"filename": item["filename"], "sha256": item["sha256"]} for item in files]},
    }


def prepare_manual_analysis(body: str) -> tuple[list[str], list[dict[str, Any]]]:
    """Add collectors only for the exact analysis IDs generated by Guided.

    Raw preflight still rejects all user file/dump commands. These paths and
    consumers are chosen by the trusted runtime and appear in retained input.
    """
    styles = {"phynite_msd": "msd", "phynite_rdf": "rdf", "phynite_vacf": "vacf", "phynite_coordination": "coordination", "phynite_cna": "cna", "phynite_centrosymmetry": "centrosymmetry", "phynite_voronoi": "voronoi", "phynite_stress": "stress-atom", "phynite_pe": "pe-atom", "phynite_ke": "ke-atom"}
    expected_commands = {"msd": "msd", "rdf": "rdf", "vacf": "vacf", "coordination": "coord/atom", "cna": "cna/atom", "centrosymmetry": "centro/atom", "voronoi": "voronoi/atom", "stress-atom": "stress/atom", "pe-atom": "pe/atom", "ke-atom": "ke/atom"}
    active: dict[str, dict[str, Any]] = {}
    lines: list[str] = []
    inventory: list[dict[str, Any]] = []
    for line in _manual_lines(body):
        tokens = shlex.split(line, comments=True)
        if len(tokens) >= 4 and tokens[0] == "compute" and tokens[1] in styles:
            identifier, style = tokens[1], styles[tokens[1]]
            if identifier in active or tokens[2] != "all" or tokens[3] != expected_commands[style]:
                raise ValueError("Generated analysis ID was redefined; use supported Analysis blocks or a distinct Expert compute ID")
            if style == "msd" and tokens[4:] != ["com", "yes"]:
                raise ValueError("The reserved phynite_msd collector requires com yes and a single fixed reference. Use supported Analysis blocks or a distinct Expert compute ID for other MSD definitions")
            extension = "dat" if style in {"msd", "rdf", "vacf"} else "dump"
            item = {"stageId": "manual", "style": style, "path": f"data/manual-{style}-{len(inventory) + 1:03d}.{extension}", "schema": ANALYSIS_SCHEMAS[style], "collector": f"ph_runtime_{len(inventory) + 1:03d}", "consumerAdded": False}
            active[identifier] = item
            inventory.append(item)
            if style in {"rdf", "coordination", "cna"}:
                if style == "rdf" and (len(tokens) != 7 or tokens[5] != "cutoff"):
                    raise ValueError("The reserved phynite_rdf collector requires an explicit bin count and cutoff; use a supported RDF Analysis block")
                cutoff_index = tokens.index("cutoff") + 1 if "cutoff" in tokens else 4
                cutoff = float(tokens[cutoff_index])
                lines.append(f"comm_modify cutoff {finite(cutoff, 'Analysis cutoff', 1e-6, 10_000) + 2:.12g}")
            lines.append(line)
            if extension == "dump":
                width = 2 if style == "voronoi" else 6 if style == "stress-atom" else 1
                columns = " ".join(f"c_{identifier}[{component}]" for component in range(1, width + 1)) if width > 1 else f"c_{identifier}"
                lines.extend([f"dump {item['collector']} all custom 1 {item['path']} id type x y z ix iy iz {columns}", f"dump_modify {item['collector']} first yes sort id"])
                item["consumerAdded"] = True
            continue
        if len(tokens) >= 8 and tokens[0] == "fix" and tokens[1] in {"phynite_msd_output", "phynite_rdf_output", "phynite_vacf_output"}:
            identifier = tokens[1].removesuffix("_output")
            item = active.get(identifier)
            if not item or item["consumerAdded"] or tokens[2:4] != ["all", "ave/time"]:
                raise ValueError("Generated analysis consumer is incompatible; use a supported Analysis block")
            for token in tokens[4:7]:
                whole_number(int(token), "Analysis sampling interval", 1, 100_000_000)
            data_tokens = tokens[7:]
            if item["style"] == "rdf":
                if data_tokens != [f"c_{identifier}[*]", "mode", "vector"]:
                    raise ValueError("Generated RDF consumer is incompatible")
                line = " ".join(tokens[:7]) + f" c_{identifier}[*] file {item['path']} mode vector"
            else:
                valid = [[f"c_{identifier}[4]"], [f"c_{identifier}[{component}]" for component in range(1, 5)]]
                if data_tokens not in valid:
                    raise ValueError("Generated MSD/VACF consumer is incompatible")
                line = " ".join(tokens[:7] + valid[1]) + f" file {item['path']}"
            item["consumerAdded"] = True
        if len(tokens) == 2 and tokens[0] == "uncompute" and tokens[1] in active:
            item = active.pop(tokens[1])
            if not item["consumerAdded"]:
                raise ValueError("Generated dynamic analysis has no supported consumer; use an Analysis block")
            if item["path"].endswith(".dump"):
                lines.append(f"undump {item['collector']}")
        lines.append(line)
    if active:
        raise ValueError("Generated analysis must clean up its compute and collector; regenerate from Guided or use Analysis blocks")
    return lines, [{key: value for key, value in item.items() if key not in {"collector", "consumerAdded"}} for item in inventory]


def generate_workflow_lammps_input(
    workflow: dict[str, Any], *, type_names: list[str], potential_asset: dict[str, Any] | None = None,
    type_masses: list[float] | None = None, source_orthogonal: bool | None = None,
) -> tuple[str, dict[str, Any]]:
    workflow = validate_workflow(workflow)
    if not type_names:
        raise ValueError("The source has no particle type mapping")
    potential_lines, provenance = _potential_commands(workflow, type_names, potential_asset)
    steps = [item for item in workflow["steps"] if item["enabled"]]
    has_shear, _, has_pressure = _workflow_cell_controls(workflow)
    validate_berendsen_cell_contract(workflow, source_orthogonal=source_orthogonal)
    if workflow["boundaryType"] != "p p p" and has_pressure:
        raise ValueError("Pressure control requires periodic boundaries in all directions")
    lines = [
        "# Generated by Phynite MD Lab local runtime",
        "# Source, output, and provenance are managed by Phynite.",
        "units metal", "dimension 3", f"boundary {workflow['boundaryType']}",
        "atom_style atomic", "read_data data.structure",
    ]
    raw_manual = workflow["mode"] == "manual" and workflow.get("manualBody")
    explicit_triclinic = bool(raw_manual and any(tokens[0].lower() == "change_box" and "triclinic" in [token.lower() for token in tokens[2:]] for tokens in _manual_commands(workflow["manualBody"])))
    if has_shear and source_orthogonal is not False and not explicit_triclinic:
        lines.append("change_box all triclinic")
    lines.extend(potential_lines)
    if type_masses is not None:
        if len(type_masses) != len(type_names):
            raise ValueError("Source atomic masses do not match the particle type mapping")
        if any(isinstance(mass, bool) or not isinstance(mass, (int, float)) or not math.isfinite(mass) or mass <= 0 for mass in type_masses):
            raise ValueError("Source particle types require explicit positive atomic masses")
        # EAM pair_coeff reads its own masses. Restore the selected source masses
        # after loading the model, before any velocity creation or dynamics.
        lines.append("# Preserve source atomic masses after potential initialization")
        lines.extend(f"mass {index} {mass:.17g}" for index, mass in enumerate(type_masses, 1))
        provenance["atomicMasses"] = {"units": "amu", "policy": "source-masses-restored-after-potential", "types": [{"typeId": index, "element": name, "mass": mass} for index, (name, mass) in enumerate(zip(type_names, type_masses), 1)]}
    thermo = whole_number(workflow["output"]["thermoFrequency"], "Thermo interval", 1, 100_000_000)
    dump = whole_number(workflow["output"]["dumpFrequency"], "Dump interval", 1, 100_000_000)
    restart_every = whole_number(workflow["output"].get("restartEverySteps", 10_000), "Restart interval", 1, 100_000_000)
    lines.extend([
        f"restart {restart_every} data/checkpoint-a.restart data/checkpoint-b.restart",
        "neighbor 2.0 bin", "neigh_modify delay 0 every 1 check yes", f"thermo {thermo}",
        "thermo_style custom step time temp press pe ke etotal vol lx ly lz xy xz yz pxx pyy pzz pxy pxz pyz",
        "thermo_modify flush yes lost error format float %.17g",
        f"dump phynite all custom {dump} trajectory.lammpstrj id type element x y z xu yu zu ix iy iz vx vy vz",
        "dump_modify phynite sort id first yes time yes units yes format float %.17g element " + " ".join(type_names),
    ])
    if workflow["mode"] == "manual" and workflow.get("manualBody"):
        manual = validate_manual_body(workflow.get("manualBody"))
        manual_lines, manual_outputs = prepare_manual_analysis(manual)
        provenance["managedManualAnalysisOutputs"] = manual_outputs
        lines.extend(['print "PHYNITE_STAGE_BEGIN 001 manual manual"', "# Begin editable LAMMPS input", *manual_lines, "# End editable LAMMPS input", 'print "PHYNITE_STAGE_END 001 manual manual"'])
    else:
        for index, step in enumerate(steps, 1):
            kind = step["kind"]
            params = step["params"]
            if workflow["mode"] == "manual" and step.get("directives"):
                lines.extend([_marker(index, step, "BEGIN"), "# Begin block-composed LAMMPS input", *compile_directive_blocks(step["directives"]), "# End block-composed LAMMPS input", _marker(index, step, "END")])
                continue
            if kind == "minimization":
                style = params.get("style", "cg")
                if style not in {"cg", "fire", "sd"}:
                    raise ValueError("Minimization style is invalid")
                lines.extend([
                    _marker(index, step, "BEGIN"), f"min_style {style}",
                    "minimize " + " ".join((
                        f"{finite(params.get('energyTolerance'), 'Energy tolerance', 0, 1):.12g}",
                        f"{finite(params.get('forceTolerance'), 'Force tolerance', 0, 1):.12g}",
                        str(whole_number(params.get("maxIterations"), "Maximum iterations", 1, 10_000_000)),
                        str(whole_number(params.get("maxEvaluations"), "Maximum evaluations", 1, 100_000_000)),
                    )), _marker(index, step, "END"),
                ])
            elif kind == "velocity":
                temperature = finite(params.get("temperatureK"), "Temperature", 0, 100_000)
                seed = whole_number(params.get("velocitySeed"), "Velocity seed", 1, 2_147_483_646)
                lines.extend([_marker(index, step, "BEGIN"), f"velocity all create {max(temperature, 1e-6):.12g} {seed} mom yes rot yes dist gaussian", _marker(index, step, "END")])
            elif kind == "restart":
                label = safe_identifier(params.get("label"), "Restart label")
                lines.extend([_marker(index, step, "BEGIN"), f"write_restart data/{index:03d}-{label}.restart", _marker(index, step, "END")])
            elif kind in {"coordination", "cna", "centrosymmetry", "voronoi", "stress-atom", "pe-atom", "ke-atom"}:
                lines.extend(_compile_static_analysis_step(step, index))
            else:
                lines.extend(_compile_dynamic_step(step, index))
    # Guarantees an importable snapshot for preparation/checkpoint-only workflows.
    lines.extend(["dump_modify phynite first yes", "run 0 post no", "write_restart final.restart"])
    return "\n".join(instrument_clock("\n".join(lines).splitlines())) + "\n", provenance


def prepare_project_potential(payload: dict[str, Any]) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
    reference = (payload.get("workflow") or {}).get("potential") or {}
    if reference.get("kind") != "project":
        return None, []
    asset = payload.get("potentialAsset")
    local = payload.get("localPotentialFiles")
    if not isinstance(asset, dict) or not isinstance(local, list):
        raise ValueError("Project potential files are missing")
    expected = asset.get("files")
    if not isinstance(expected, list) or len(expected) != len(local):
        raise ValueError("Project potential file inventory is incomplete")
    expected_by_name = {safe_filename(item.get("filename"), "Potential filename"): item for item in expected if isinstance(item, dict)}
    if len(expected_by_name) != len(expected):
        raise ValueError("Project potential file inventory is invalid")
    destination_dir = RESULTS / "potential"
    destination_dir.mkdir(parents=True, exist_ok=True)
    copied: list[dict[str, Any]] = []
    for raw in local:
        if not isinstance(raw, dict):
            raise ValueError("Project potential file inventory is invalid")
        filename = safe_filename(raw.get("filename"), "Potential filename")
        metadata = expected_by_name.pop(filename, None)
        if metadata is None:
            raise ValueError("Project potential file does not match the asset")
        _, source = safe_work_file(raw.get("path"), f"Potential file {filename}")
        size = whole_number(metadata.get("sizeBytes"), "Potential file size", 1, 20 * 1024 * 1024)
        digest = str(metadata.get("sha256") or "").lower()
        role = str(metadata.get("role") or "potential")
        if not re.fullmatch(r"[a-f0-9]{64}", digest):
            raise ValueError("Project potential checksum is invalid")
        if raw.get("role") != role or raw.get("sizeBytes") != size or str(raw.get("sha256") or "").lower() != digest:
            raise ValueError("Project potential metadata does not match the verified asset")
        if source.stat().st_size != size or sha256_file(source) != digest:
            raise ValueError(f"Project potential {filename} failed its runtime integrity check")
        destination = destination_dir / filename
        shutil.copyfile(source, destination)
        if destination.stat().st_size != size or sha256_file(destination) != digest:
            raise ValueError(f"Project potential {filename} could not be staged safely")
        copied.append({"filename": filename, "role": role, "sizeBytes": size, "sha256": digest})
    if expected_by_name:
        raise ValueError("Project potential file inventory is incomplete")
    return {**asset, "files": copied}, copied


def _thermo_row(fields: list[str]) -> dict[str, float] | None:
    if len(fields) < len(THERMO_FIELDS):
        return None
    try:
        values = [float(item) for item in fields[:len(THERMO_FIELDS)]]
    except ValueError:
        return None
    return dict(zip(THERMO_FIELDS, values)) if all(math.isfinite(item) for item in values) else None


def parse_stage_thermo(log_text: str) -> dict[str, list[dict[str, float]]]:
    result: dict[str, list[dict[str, float]]] = {}
    active: list[str] = []
    collecting = False
    for raw in log_text.splitlines():
        marker = re.fullmatch(r"PHYNITE_(STAGE|BLOCK)_(BEGIN|END)\s+\d+\s+([A-Za-z0-9_-]+)\s+\S+", raw.strip())
        if marker:
            identifier = marker.group(3)
            if marker.group(2) == "BEGIN":
                active.append(identifier)
            elif identifier in active:
                active.remove(identifier)
            collecting = False
            continue
        fields = raw.split()
        if fields[:4] == ["Step", "Time", "Temp", "Press"]:
            collecting = True
            continue
        if not collecting:
            continue
        row = _thermo_row(fields)
        if row is None:
            collecting = False
        else:
            for identifier in active:
                result.setdefault(identifier, []).append(dict(row))
    return result


def parse_minimization_details(log_text: str) -> dict[str, list[dict[str, Any]]]:
    result: dict[str, list[dict[str, Any]]] = {}
    active: str | None = None
    lines = log_text.splitlines()
    for index, line in enumerate(lines):
        marker = re.fullmatch(r"PHYNITE_STAGE_(BEGIN|END)\s+\d+\s+([A-Za-z0-9_-]+)\s+\S+", line.strip())
        if marker:
            active = marker.group(2) if marker.group(1) == "BEGIN" else None
        if active is None or "Stopping criterion =" not in line:
            continue
        reason = line.split("Stopping criterion =", 1)[1].strip()
        details: dict[str, Any] = {"stoppingReason": reason, "converged": reason.lower() in {"force tolerance", "energy tolerance"}, "residualUnit": "eV/angstrom", "forceToleranceReached": reason.lower() == "force tolerance", "energyToleranceReached": reason.lower() == "energy tolerance"}
        for offset in range(index + 1, min(index + 15, len(lines))):
            heading = lines[offset].strip()
            if "=" not in heading or offset + 1 >= len(lines):
                continue
            label, inline = heading.split("=", 1)
            try:
                values = [float(item) for item in (inline.strip() or lines[offset + 1]).split()]
            except ValueError:
                continue
            if not values or not all(math.isfinite(value) for value in values):
                continue
            if heading.startswith("Force two-norm"):
                details["finalForceTwoNormEvPerAngstrom"] = values[-1]
            elif heading.startswith("Force max component"):
                details["finalMaxForceComponentEvPerAngstrom"] = values[-1]
            elif heading.startswith("Iterations, force evaluations") and len(values) == 2:
                details.update({"iterations": int(values[0]), "forceEvaluations": int(values[1])})
            elif heading.startswith("Energy initial"):
                details["finalEnergyEv"] = values[-1]
        result.setdefault(active, []).append(details)
    return result


def build_workflow_stage_data(step: dict[str, Any], rows: list[dict[str, float]], *, production_window: dict[str, Any] | None = None, block_rows: dict[str, list[dict[str, float]]] | None = None, minimizations: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    result: dict[str, Any] = {"id": step["id"], "kind": step["kind"], "name": step["name"], "parameters": step["params"], "thermoSamples": len(rows), "qualityEvidence": stage_quality({**step, "kind": "manual"} if step.get("directives") else step, rows, production_window)}
    if rows:
        result.update({"initial": rows[0], "final": rows[-1]})
    result.update(mechanical_series(step["kind"], step["params"], rows))
    if step["kind"] in {"npt", "nph", "pressure-ramp", "press-berendsen"}:
        result["pressureControlDefinition"] = "isotropic scalar pressure; anisotropic cell equilibrium is not established"
    if step.get("directives"):
        controls: str | None = None
        blocks: list[dict[str, Any]] = []
        for block in step["directives"]:
            if not block["enabled"]:
                continue
            kind, params = block["kind"], block["params"]
            if kind in {"thermostat", "barostat"}:
                controls = params["style"]
            elif kind == "deform":
                controls = params["mode"]
            elif kind == "minimize":
                controls = None
            interpreted = "minimization" if kind == "minimize" else controls or "nve" if kind in {"run", "analysis"} else controls or kind
            block_step = {"kind": interpreted, "params": params}
            block_data = (block_rows or {}).get(block["id"], [])
            record: dict[str, Any] = {"id": block["id"], "kind": kind, "parameters": params, "qualityEvidence": stage_quality(block_step, block_data, production_window)}
            if kind == "deform":
                mechanical_params = {**params, "shearPlane": params["axis"]}
                record.update(mechanical_series(params["mode"], mechanical_params, block_data))
            blocks.append(record)
        result["blocks"] = blocks
    if minimizations:
        result["minimizations"] = minimizations
        result["minimizerCriterionSatisfied"] = all(item["converged"] for item in minimizations)
        result["geometryConverged"] = all(item["forceToleranceReached"] for item in minimizations)
        result["geometryConvergenceDefinition"] = "force-tolerance termination; energy-tolerance termination alone does not establish force residual convergence"
    elif step["kind"] == "minimization":
        result.update({"geometryConverged": False, "minimizationEvidence": "stopping-reason-unavailable"})
    return result


ANALYSIS_SCHEMAS = {
    "msd": {"columns": ["step", "msdX", "msdY", "msdZ", "msdTotal"], "units": ["integration-step", "angstrom^2", "angstrom^2", "angstrom^2", "angstrom^2"], "definition": "LAMMPS compute msd com yes; single reference at compute creation, center-of-mass drift removed"},
    "rdf": {"columns": ["bin", "radius", "g(r)", "coordination"], "units": ["index", "angstrom", "dimensionless", "neighbors"], "definition": "LAMMPS compute rdf; fixed global density normalization; file has step/bin-count headers"},
    "vacf": {"columns": ["step", "vacfX", "vacfY", "vacfZ", "vacfTotal"], "units": ["integration-step", "angstrom^2/ps^2", "angstrom^2/ps^2", "angstrom^2/ps^2", "angstrom^2/ps^2"], "definition": "LAMMPS compute vacf; single velocity reference at compute creation"},
    "coordination": {"columns": ["coordination"], "units": ["neighbors"]},
    "cna": {"columns": ["cnaCode"], "units": ["LAMMPS structure code"]},
    "centrosymmetry": {"columns": ["centrosymmetry"], "units": ["angstrom^2"]},
    "voronoi": {"columns": ["atomicVolume", "faces"], "units": ["angstrom^3", "count"]},
    "stress-atom": {"columns": ["xx", "yy", "zz", "xy", "xz", "yz"], "units": ["bar*angstrom^3"] * 6, "definition": "LAMMPS stress/atom NULL: negative pressure-times-volume, includes kinetic and virial contributions; no per-atom volume division; not stress in GPa"},
    "pe-atom": {"columns": ["potentialEnergy"], "units": ["eV"]},
    "ke-atom": {"columns": ["kineticEnergy"], "units": ["eV"]},
}


def analysis_inventory(workflow: dict[str, Any]) -> list[dict[str, Any]]:
    inventory: list[dict[str, Any]] = []
    if workflow["mode"] == "manual" and workflow.get("manualBody"):
        return prepare_manual_analysis(validate_manual_body(workflow["manualBody"]))[1]
    for index, step in enumerate((item for item in workflow["steps"] if item["enabled"]), 1):
        if workflow["mode"] == "manual" and step.get("directives"):
            for block_index, block in enumerate(step["directives"], 1):
                if not block["enabled"] or block["kind"] != "analysis":
                    continue
                style = block["params"]["style"]
                extension = "dat" if style in {"msd", "rdf", "vacf"} else "dump"
                inventory.append({"stageId": step["id"], "blockId": block["id"], "style": style, "path": f"data/{style}-block-{block_index:03d}-{block['id']}.{extension}", "schema": ANALYSIS_SCHEMAS[style], "parameters": block["params"]})
        elif step["kind"] in {"diffusion", *ANALYSIS_SCHEMAS}:
            style = "msd" if step["kind"] == "diffusion" else step["kind"]
            extension = "dat" if style in {"msd", "rdf", "vacf"} else "dump"
            inventory.append({"stageId": step["id"], "style": style, "path": f"data/{style}-{index:03d}.{extension}", "schema": ANALYSIS_SCHEMAS[style], "parameters": step["params"]})
    return inventory


def _artifact(path: Path) -> dict[str, Any]:
    relative = path.relative_to(RESULTS).as_posix()
    content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    if path.suffix == ".lammpstrj" or path.name == "data.structure":
        content_type = "application/x-lammps"
    elif path.name in {"in.lammps", "log.lammps"} or path.suffix == ".dat":
        content_type = "text/plain"
    role = "trajectory" if path.suffix == ".lammpstrj" else "log" if path.name == "log.lammps" else "input" if path.name in {"in.lammps", "data.structure"} else "restart" if path.suffix == ".restart" else "data"
    return {"path": relative, "label": path.name, "role": role, "contentType": content_type, "sizeBytes": path.stat().st_size, "sha256": sha256_file(path)}


def result_artifacts() -> list[dict[str, Any]]:
    if not RESULTS.is_dir():
        return []
    return [_artifact(path) for path in sorted(RESULTS.rglob("*")) if path.is_file() and path.name != "result.json" and not path.is_symlink()]


def lammps_version(output: str) -> str:
    match = re.search(r"LAMMPS\s+\(([^\r\n)]+)\)", output)
    return match.group(1).strip() if match else "unknown"


def validate_particle_masses(particle_types: list[Any]) -> None:
    if any(not math.isfinite(float(item.mass)) or item.mass <= 0 for item in particle_types):
        raise ValueError(
            "The source has particle types without positive atomic masses. "
            "Import a structure with named elements (for example Ar in XYZ) or a LAMMPS data file with Masses."
        )


def is_axis_aligned_orthogonal_cell(cell: Any) -> bool:
    """Require exact alignment: never erase even a small physical cell tilt."""
    return cell is not None and all(
        math.isfinite(float(cell[row, column])) and
        (float(cell[row, column]) > 0 if row == column else float(cell[row, column]) == 0)
        for row in range(3) for column in range(3)
    )


def _workflow_cell_controls(workflow: dict[str, Any]) -> tuple[bool, bool, bool]:
    """Inspect only commands this mode executes, including expert overrides."""
    if workflow["mode"] == "manual" and workflow.get("manualBody"):
        # Print payloads are text; validated `if`/`run every` are forbidden.
        commands = [[token.lower() for token in tokens] for tokens in _manual_commands(validate_manual_body(workflow["manualBody"]))]
        fixes = [tokens for tokens in commands if tokens[0] == "fix" and len(tokens) > 3]
        berendsen = any(tokens[3].startswith("press/berendsen") for tokens in fixes)
        shear = any(tokens[0] == "change_box" and "triclinic" in tokens[2:] for tokens in commands) or any(tokens[3].startswith("deform") and any(axis in tokens[4:] for axis in ("xy", "xz", "yz")) for tokens in fixes)
        pressure = berendsen or any(tokens[3].split("/", 1)[0] in {"npt", "nph"} for tokens in fixes)
        return shear, berendsen, pressure
    shear = berendsen = pressure = False
    for step in workflow["steps"]:
        if not step["enabled"]:
            continue
        if workflow["mode"] == "manual" and step.get("directives"):
            for block in step["directives"]:
                if not block["enabled"]:
                    continue
                params = block["params"]
                shear = shear or (block["kind"] == "deform" and params.get("mode") == "shear")
                berendsen = berendsen or (block["kind"] == "barostat" and params.get("style") == "press-berendsen")
                pressure = pressure or block["kind"] == "barostat"
        else:
            shear = shear or step["kind"] == "shear"
            berendsen = berendsen or step["kind"] == "press-berendsen"
            pressure = pressure or step["kind"] in {"npt", "nph", "press-berendsen", "pressure-ramp"}
    return shear, berendsen, pressure


def validate_berendsen_cell_contract(workflow: dict[str, Any], *, source_orthogonal: bool | None = None) -> None:
    shear, berendsen, _ = _workflow_cell_controls(workflow)
    if berendsen and shear:
        raise ValueError("Pressure Berendsen cannot be combined with shear or triclinic box changes. Use NPT/NPH pressure control or separate workflows.")
    if berendsen and source_orthogonal is False:
        raise ValueError("Pressure Berendsen requires an axis-aligned orthogonal source cell. The source geometry is retained; use NPT/NPH for tilted or rotated cells.")


def export_source_data(data: Any, path: Path) -> bool:
    """Preserve the source basis; avoid general-triclinic for a diagonal box."""
    orthogonal = is_axis_aligned_orthogonal_cell(data.cell)
    export_file(data, str(path), "lammps/data", atom_style="atomic", precision=17, restricted_triclinic=orthogonal)
    return orthogonal


def write_recovery_contract(payload: dict[str, Any], solver_version: str = "unknown") -> dict[str, Any]:
    recovery = {"schemaVersion": 1, "periodicRestartEverySteps": payload.get("workflow", {}).get("output", {}).get("restartEverySteps", 10_000), "guiResumeSupported": False, "lammpsVersion": solver_version, "supportedRecovery": "expert external LAMMPS CLI using the identical build and verified potential files", "restartFiles": [path.relative_to(RESULTS).as_posix() for path in sorted(RESULTS.rglob("*.restart"))], "requirements": ["Use retained in.lammps and source/model hashes; replace read_data with read_restart for the chosen checkpoint.", "Recreate required fixes with identical IDs/styles to restore saved thermostat/barostat state; reconstruct workflow position and remaining run/ramp duration.", "LAMMPS restart files are build/platform specific; outputs and fixes are not automatically reconstructed by read_restart.", "Long trajectories are compared by observables within declared numerical/statistical tolerances, not bitwise identity."], "timeHistory": "time-history.json"}
    (RESULTS / "recovery.json").write_text(json.dumps(recovery, indent=2), encoding="utf-8")
    return recovery


def validate_finite_thermo(log_text: str) -> None:
    collecting = False
    for raw in log_text.splitlines():
        fields = raw.split()
        if fields[:4] == ["Step", "Time", "Temp", "Press"]:
            collecting = True
            continue
        if not collecting:
            continue
        try:
            if len(fields) < len(THERMO_FIELDS):
                collecting = False
                continue
            values = [float(item) for item in fields[:len(THERMO_FIELDS)]]
        except ValueError:
            collecting = False
            continue
        if not all(math.isfinite(value) for value in values):
            raise RuntimeError("LAMMPS emitted non-finite thermo data; this run cannot be accepted as successful")


def solver_timeout_seconds() -> int | None:
    """Honor the trusted worker's grant rather than imposing a second budget."""
    explicit = os.environ.get("PHYNITE_MD_TIMEOUT_SECONDS")
    if explicit is not None:
        if not re.fullmatch(r"\d+", explicit):
            raise ValueError("PHYNITE_MD_TIMEOUT_SECONDS must be a nonnegative integer; 0 means no child timeout")
        seconds = int(explicit)
        return seconds or None
    return None if os.environ.get("PHYNITE_FUNDING_MODE") == "paid" else 86_400


def solver_command(executable: str, input_name: str, vcpus: int) -> list[str]:
    command = [executable, "-in", input_name]
    raw_launcher = os.environ.get("PHYNITE_MPI_LAUNCHER")
    scheduler = os.environ.get("PHYNITE_HPC_SCHEDULER")
    raw_maximum = os.environ.get("PHYNITE_HPC_MAX_RANKS")
    if scheduler is not None and (scheduler not in {"slurm", "pbs"} or raw_launcher is None or raw_maximum is None):
        raise ValueError("An HPC allocation requires a supported scheduler, explicit MPI launcher, and maximum rank grant")
    if raw_maximum is not None:
        if not re.fullmatch(r"[1-9]\d*", raw_maximum) or int(raw_maximum) > 9_007_199_254_740_991:
            raise ValueError("PHYNITE_HPC_MAX_RANKS must be a positive safe integer")
        if vcpus > int(raw_maximum):
            raise ValueError("Selected LAMMPS ranks exceed the HPC allocation's maximum rank grant")
    if raw_launcher is not None:
        try:
            launcher = json.loads(raw_launcher)
        except (ValueError, TypeError) as exc:
            raise ValueError("PHYNITE_MPI_LAUNCHER must be a nonempty JSON argument array") from exc
        if not isinstance(launcher, list) or not 1 <= len(launcher) <= 64 or any(not isinstance(item, str) or not item or len(item) > 4096 or any(ord(char) < 32 or ord(char) == 127 for char in item) for item in launcher):
            raise ValueError("PHYNITE_MPI_LAUNCHER must be a nonempty JSON argument array")
        if Path(launcher[0]).name not in {"srun", "mpiexec", "mpirun"} or any(item.startswith("--oversubscribe") for item in launcher):
            raise ValueError("HPC launcher must use srun, mpiexec, or mpirun without oversubscription")
        if sum(item.count("{ranks}") for item in launcher) != 1 or any(("{" in item or "}" in item) and item not in {"{ranks}", "--ntasks={ranks}"} for item in launcher):
            raise ValueError("HPC launcher needs exactly one {ranks} placeholder as an argument or --ntasks={ranks}")
        return [item.replace("{ranks}", str(vcpus)) for item in launcher] + command
    if vcpus <= 1:
        return command
    mpi = shutil.which("mpirun")
    if not mpi:
        raise RuntimeError("The selected CPU profile requires the MPI-enabled LAMMPS runtime")
    return [mpi, "--oversubscribe", "-np", str(vcpus), *command]


def run() -> None:
    payload = validate_job(json.loads(INPUT.read_text(encoding="utf-8")))
    simulation_id = payload["simulationId"]
    source = WORK / payload["localSourcePath"]
    RESULTS.mkdir(parents=True, exist_ok=True)
    (RESULTS / "data").mkdir(exist_ok=True)
    source_identity: dict[str, Any]
    if source.name.endswith(".phynite-md.json"):
        data, source_identity = load_source_snapshot(source)
        requested_boundary = payload.get("workflow", payload.get("config", {})).get("boundaryType")
        if requested_boundary != " ".join("p" if periodic else "f" for periodic in data.cell.pbc):
            raise ValueError("Immutable frame periodicity does not match the simulation Boundary. Match the displayed periodic directions before running.")
    else:
        pipeline = import_file(str(source), multiple_frames=False)
        data = pipeline.compute(0)
        source_identity = {"schemaVersion": 1, "sourceSha256": sha256_file(source), "selection": "first-original-frame", "sourceFormat": source.suffix}
    source_copy = RESULTS / ("source.phynite-md.json" if source.name.endswith(".phynite-md.json") else f"source{source.suffix}")
    shutil.copyfile(source, source_copy)
    if data.particles is None or data.particles.count < 1:
        raise ValueError("The source contains no particles")
    ordered_types = sorted(data.particles.particle_types.types, key=lambda item: int(item.id))
    validate_particle_masses(ordered_types)
    if [int(item.id) for item in ordered_types] != list(range(1, len(ordered_types) + 1)):
        raise ValueError("Source particle type IDs must be consecutive starting at 1 for an exact potential mapping. Remap the source types before running.")
    type_names = [str(item.name or "Generic") for item in ordered_types]
    type_masses = [float(item.mass) for item in ordered_types]
    data_file = RESULTS / "data.structure"
    source_orthogonal = export_source_data(data, data_file)
    source_identity["executedParticleTypes"] = [{"typeId": int(item.id), "element": name, "massAmu": mass} for item, name, mass in zip(ordered_types, type_names, type_masses)]
    source_identity["lammpsDataCellFormat"] = "orthogonal" if source_orthogonal else "general-triclinic"
    (RESULTS / "source-identity.json").write_text(json.dumps(source_identity, indent=2, allow_nan=False), encoding="utf-8")

    copied_files: list[dict[str, Any]] = []
    if payload["version"] == 1:
        validate_lj_species(set(type_names))
        script = "\n".join(instrument_clock(generate_lammps_input(payload["config"], type_names=type_names).splitlines())) + "\n"
        potential: dict[str, Any] = {**payload["config"]["forceField"], "files": []}
    else:
        asset, copied_files = prepare_project_potential(payload)
        script, potential = generate_workflow_lammps_input(payload["workflow"], type_names=type_names, potential_asset=asset, type_masses=type_masses, source_orthogonal=source_orthogonal)
        if copied_files:
            potential["files"] = copied_files
    (RESULTS / "potential-provenance.json").write_text(json.dumps(potential, indent=2, allow_nan=False), encoding="utf-8")
    script_file = RESULTS / "in.lammps"
    script_file.write_text(script, encoding="utf-8")
    executable = shutil.which("lmp") or shutil.which("lammps")
    if not executable:
        raise RuntimeError("LAMMPS executable is not installed in the MD runtime")
    started = time.monotonic()
    vcpus = max(1, int(os.environ.get("PHYNITE_VCPUS", "1")))
    command = solver_command(executable, script_file.name, vcpus)
    timeout_seconds = solver_timeout_seconds()
    launch = {"schemaVersion": 1, "command": command, "mpiRanks": vcpus, "childTimeoutSeconds": timeout_seconds, "hpcAllocation": {"scheduler": os.environ.get("PHYNITE_HPC_SCHEDULER"), "launcher": json.loads(os.environ["PHYNITE_MPI_LAUNCHER"]) if "PHYNITE_MPI_LAUNCHER" in os.environ else None, "maximumRanks": int(os.environ["PHYNITE_HPC_MAX_RANKS"]) if "PHYNITE_HPC_MAX_RANKS" in os.environ else None}}
    (RESULTS / "execution-launch.json").write_text(json.dumps(launch, indent=2, allow_nan=False), encoding="utf-8")
    write_recovery_contract(payload)
    with measured_compute(WORK):
        process = subprocess.run(command, cwd=RESULTS, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=timeout_seconds, check=False)
    log_file = RESULTS / "log.lammps"
    if not log_file.is_file():
        log_file.write_text(process.stdout, encoding="utf-8")
    recovery = write_recovery_contract(payload, lammps_version(process.stdout))
    if process.returncode:
        raise RuntimeError(f"LAMMPS exited with code {process.returncode}: {process.stdout[-1500:]}")
    trajectory = RESULTS / "trajectory.lammpstrj"
    if not trajectory.is_file() or trajectory.stat().st_size < 1:
        raise RuntimeError("LAMMPS completed without a trajectory")
    log_text = log_file.read_text(encoding="utf-8", errors="replace")
    validate_finite_thermo(log_text)
    clock_history = parse_clock(log_text)
    if not clock_history:
        raise RuntimeError("LAMMPS completed without retained physical-time history")
    repair_trajectory_clock(trajectory, clock_history)
    (RESULTS / "time-history.json").write_text(json.dumps({"units": "ps", "minimizationAdvancesPhysicalTime": False, "origin": "elapsed dynamics since this job started", "operations": clock_history}, indent=2, allow_nan=False), encoding="utf-8")
    thermo = parse_thermo(log_text)
    for row in thermo:
        row["timePs"] = physical_time(row["timePs"], row["step"], clock_history)
    if not thermo:
        raise RuntimeError("LAMMPS completed without finite thermo output")
    (RESULTS / "thermo.json").write_text(json.dumps(thermo, separators=(",", ":"), allow_nan=False), encoding="utf-8")

    workflow_summary: dict[str, Any] | None = None
    if payload["version"] == 1:
        (RESULTS / "recipe-data.json").write_text(json.dumps(build_recipe_data(payload["config"], thermo), separators=(",", ":"), allow_nan=False), encoding="utf-8")
        recipe_id = payload["config"]["recipeId"]
    else:
        stage_rows = parse_stage_thermo(log_text)
        for rows in stage_rows.values():
            for row in rows:
                row["timePs"] = physical_time(row["timePs"], row["step"], clock_history)
        minimizations = parse_minimization_details(log_text)
        inventory = analysis_inventory(payload["workflow"])
        for item in inventory:
            path = RESULTS / item["path"]
            if not path.is_file() or not any(line.strip() and not line.lstrip().startswith("#") for line in path.read_text(encoding="utf-8").splitlines()):
                raise RuntimeError(f"Analysis {item['style']} did not produce saved numeric data")
            if item["style"] in {"msd", "rdf", "vacf"}:
                time_index = analysis_time_index(path, item["style"], clock_history)
                time_path = path.with_suffix(".time.json")
                time_path.write_text(json.dumps(time_index, separators=(",", ":"), allow_nan=False), encoding="utf-8")
                item["timeIndexArtifact"] = time_path.relative_to(RESULTS).as_posix()
        (RESULTS / "analysis-schema.json").write_text(json.dumps({"schemaVersion": 1, "outputs": inventory, "timeHistory": "time-history.json"}, indent=2, allow_nan=False), encoding="utf-8")
        stages: list[dict[str, Any]] = []
        stages_dir = RESULTS / "stages"
        stages_dir.mkdir(exist_ok=True)
        raw_manual = payload["workflow"]["mode"] == "manual" and payload["workflow"].get("manualBody")
        enabled_steps = [] if raw_manual else [item for item in payload["workflow"]["steps"] if item["enabled"]]
        for index, step in enumerate(enabled_steps, 1):
            stage_path = stages_dir / f"{index:03d}-{step['id']}.json"
            stage_data = build_workflow_stage_data(step, stage_rows.get(step["id"], []), production_window=payload["workflow"]["output"].get("productionWindow"), block_rows=stage_rows, minimizations=minimizations.get(step["id"]))
            stage_path.write_text(json.dumps(stage_data, separators=(",", ":"), allow_nan=False), encoding="utf-8")
            inline = {key: stage_data[key] for key in ("qualityEvidence", "mechanicalDefinition", "geometryConverged", "geometryConvergenceDefinition", "minimizerCriterionSatisfied", "minimizations", "pressureControlDefinition", "blocks") if key in stage_data}
            stages.append({"id": step["id"], "kind": step["kind"], "data": stage_path.relative_to(RESULTS).as_posix(), **inline})
        if payload["workflow"]["mode"] == "manual" and payload["workflow"].get("manualBody"):
            stage_path = stages_dir / "001-manual.json"
            stage_data = build_workflow_stage_data({"id": "manual", "kind": "manual", "name": "Expert LAMMPS input", "params": {}}, stage_rows.get("manual", []), production_window=payload["workflow"]["output"].get("productionWindow"), minimizations=minimizations.get("manual"))
            stage_path.write_text(json.dumps(stage_data, separators=(",", ":"), allow_nan=False), encoding="utf-8")
            stages.append({"id": "manual", "kind": "manual", "data": stage_path.relative_to(RESULTS).as_posix(), "qualityEvidence": stage_data["qualityEvidence"], **({"minimizations": stage_data["minimizations"]} if "minimizations" in stage_data else {})})
        workflow_summary = {"version": 2, "mode": payload["workflow"]["mode"], "stages": stages}
        (RESULTS / "workflow-data.json").write_text(json.dumps(workflow_summary, separators=(",", ":"), allow_nan=False), encoding="utf-8")
        first = next((item for item in payload["workflow"]["steps"] if item["enabled"]), None)
        recipe_id = "manual" if raw_manual else str(first["kind"] if first else "manual")

    manifest = {
        "version": payload["version"], "workflowVersion": 2 if payload["version"] == 2 else 1,
        "calculationId": simulation_id, "kind": "md-simulation", "status": "completed",
        "completedAt": utc_now(), "elapsedSeconds": round(time.monotonic() - started, 3),
        "recipeId": recipe_id, "artifacts": result_artifacts(),
        "trajectoryArtifact": {"path": "trajectory.lammpstrj", "filename": f"{recipe_id}-{simulation_id[-8:]}.lammpstrj", "sizeBytes": trajectory.stat().st_size, "sha256": sha256_file(trajectory)},
        "summary": {"atoms": int(data.particles.count), "thermoSamples": len(thermo), "stages": len(workflow_summary["stages"]) if workflow_summary else 1},
        **({"workflow": workflow_summary} if workflow_summary else {}),
        "provenance": {"runtime": "phynite-md-local", "executionMode": os.environ.get("PHYNITE_EXECUTION_MODE", "local-docker"), "executionLaunch": launch, "lammpsExecutable": Path(executable).name, "lammpsVersion": lammps_version(process.stdout + "\n" + log_text[:500]), "ovitoVersion": __import__("ovito").version_string, "potential": potential, "source": {"path": source_copy.name, "sha256": source_identity["sourceSha256"], "identityArtifact": "source-identity.json", "sourcePeriodic": list(data.cell.pbc), "executionBoundary": payload.get("workflow", payload.get("config", {})).get("boundaryType")}, "timeUnits": "ps", "positionUnits": "angstrom", "recovery": recovery, "syntheticData": False},
    }
    (RESULTS / "result.json").write_text(json.dumps(manifest, indent=2, allow_nan=False), encoding="utf-8")


def main() -> int:
    try:
        run()
        return 0
    except Exception as exc:
        RESULTS.mkdir(parents=True, exist_ok=True)
        simulation_id = os.environ.get("PHYNITE_CALCULATION_ID", "unknown")
        version = 1
        try:
            raw = json.loads(INPUT.read_text(encoding="utf-8"))
            simulation_id = str(raw.get("simulationId") or raw.get("calculationId") or simulation_id)
            version = raw.get("version") if raw.get("version") in {1, 2} else 1
        except Exception:
            pass
        failure = {"version": version, "workflowVersion": 2 if version == 2 else 1, "calculationId": simulation_id, "kind": "md-simulation", "status": "failed", "completedAt": utc_now(), "error": str(exc)[:1500], "artifacts": result_artifacts(), "provenance": {"runtime": "phynite-md-local", "executionMode": os.environ.get("PHYNITE_EXECUTION_MODE", "local-docker"), "syntheticData": False}}
        (RESULTS / "result.json").write_text(json.dumps(failure, indent=2), encoding="utf-8")
        print(str(exc), flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

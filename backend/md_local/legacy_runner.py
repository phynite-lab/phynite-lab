"""Execute one validated Phynite MD simulation with LAMMPS and OVITO.

The process reads /work/input.json, never contacts the network, and writes the
result manifest last. The personal worker owns all download/upload operations.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import shutil
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from ovito.io import export_file, import_file


WORK = Path(os.environ.get("PHYNITE_WORK_DIR", "/work")).resolve()
INPUT = WORK / "input.json"
RESULTS = WORK / "results"
RECIPES = {"equilibration", "tensile", "shear", "compression", "melting", "diffusion"}
LJ_SPECIES = {"Ar", "Kr", "Xe", "Generic"}


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


def validate_job(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict) or payload.get("version") != 1 or payload.get("kind") != "md-simulation":
        raise ValueError("Unsupported MD simulation job")
    simulation_id = str(payload.get("simulationId") or "")
    if not simulation_id or payload.get("calculationId") != simulation_id:
        raise ValueError("Simulation identity is invalid")
    source_path = Path(str(payload.get("localSourcePath") or ""))
    if source_path.is_absolute() or ".." in source_path.parts or not source_path.parts:
        raise ValueError("Simulation source path is unsafe")
    if not (WORK / source_path).is_file():
        raise ValueError("Simulation source is missing")
    config = payload.get("config")
    if not isinstance(config, dict) or config.get("version") != 1 or config.get("recipeId") not in RECIPES:
        raise ValueError("Simulation configuration is invalid")
    if (config.get("forceField") or {}).get("kind") != "lennard-jones":
        raise ValueError("Only a verified Lennard-Jones potential is available in this runtime")
    return payload


def validate_lj_species(type_names: set[str]) -> None:
    unsupported = sorted(name for name in type_names if name not in LJ_SPECIES)
    if unsupported:
        raise ValueError(
            "The bundled Lennard-Jones potential only supports Ar, Kr, Xe, or Generic particles; "
            f"unsupported particle types: {', '.join(unsupported)}"
        )


def strain_rate_per_ps(config: dict[str, Any]) -> float:
    """LAMMPS metal units use ps, while the UI contract uses s^-1."""
    return finite(config.get("strainRatePerSecond"), "Strain rate", 1e-12, 1e18) * 1e-12


def validate_mechanical_plan(config: dict[str, Any], timestep_ps: float, steps: int) -> float | None:
    if config.get("recipeId") not in {"tensile", "shear", "compression"}:
        return None
    maximum = finite(config.get("maxStrain"), "Maximum strain", 1e-9, 10.0)
    planned = strain_rate_per_ps(config) * timestep_ps * steps
    if planned > maximum * (1.0 + 1e-9):
        raise ValueError(
            f"This run would reach {planned:.6g} strain, above the {maximum:.6g} safety limit"
        )
    return planned


def generate_lammps_input(config: dict[str, Any], *, type_names: list[str] | None = None) -> str:
    recipe = str(config["recipeId"])
    timestep_ps = finite(config.get("timestepFs"), "Timestep", 0.0001, 100.0) / 1000.0
    steps = int(finite(config.get("totalSteps"), "Total steps", 1, 100_000_000))
    start_k = finite(config.get("tempStartK"), "Initial temperature", 0, 100_000)
    end_k = finite(config.get("tempEndK"), "Final temperature", 0, 100_000)
    pressure = finite(config.get("pressureBar"), "Pressure", -1_000_000, 1_000_000)
    seed = int(finite(config.get("velocitySeed"), "Velocity seed", 1, 2_147_483_646))
    thermo = int(finite(config.get("thermoFrequency"), "Thermo interval", 1, steps))
    dump = int(finite(config.get("dumpFrequency"), "Dump interval", 1, steps))
    ff = config["forceField"]
    epsilon = finite(ff.get("epsilonEv"), "LJ epsilon", 1e-12, 1000)
    sigma = finite(ff.get("sigmaAngstrom"), "LJ sigma", 1e-6, 1000)
    cutoff = finite(ff.get("cutoffAngstrom"), "LJ cutoff", sigma, 10_000)
    boundary = str(config.get("boundaryType", "p p p"))
    if boundary not in {"p p p", "p p f", "p f p", "f p p", "p f f", "f p f", "f f p", "f f f"}:
        raise ValueError("Boundary condition is invalid")
    validate_mechanical_plan(config, timestep_ps, steps)

    lines = [
        "# Generated by Phynite MD Lab local runtime",
        "units metal",
        "dimension 3",
        f"boundary {boundary}",
        "atom_style atomic",
        "read_data data.structure",
    ]
    if recipe == "shear":
        lines.append("change_box all triclinic")
    lines.extend([
        f"pair_style lj/cut {cutoff:.12g}",
        f"pair_coeff * * {epsilon:.12g} {sigma:.12g} {cutoff:.12g}",
        "restart 10000 data/checkpoint-a.restart data/checkpoint-b.restart",
        "neighbor 2.0 bin",
        "neigh_modify delay 0 every 1 check yes",
        f"timestep {timestep_ps:.12g}",
        f"velocity all create {max(start_k, 1e-6):.12g} {seed} mom yes rot yes dist gaussian",
        f"thermo {thermo}",
        "thermo_style custom step time temp press pe ke etotal vol lx ly lz xy xz yz pxx pyy pzz pxy pxz pyz",
        "thermo_modify flush yes lost error format float %.17g",
        f"dump phynite all custom {dump} trajectory.lammpstrj id type{' element' if type_names else ''} x y z xu yu zu ix iy iz vx vy vz",
        "dump_modify phynite sort id time yes units yes format float %.17g" + (" element " + " ".join(type_names) if type_names else ""),
    ])
    damp_t = max(timestep_ps * 100.0, 0.01)
    damp_p = max(timestep_ps * 1000.0, 0.1)
    if recipe == "equilibration":
        ensemble = config.get("ensemble", "nvt")
        if ensemble == "nve":
            lines.append("fix integrate all nve")
        elif ensemble == "npt" and boundary == "p p p":
            lines.append(f"fix integrate all npt temp {start_k:.12g} {end_k:.12g} {damp_t:.12g} iso {pressure:.12g} {pressure:.12g} {damp_p:.12g}")
        else:
            lines.append(f"fix integrate all nvt temp {start_k:.12g} {end_k:.12g} {damp_t:.12g}")
    elif recipe in {"tensile", "compression"}:
        axis = config.get("axis", "z")
        if axis not in {"x", "y", "z"}:
            raise ValueError("Deformation axis is invalid")
        rate = strain_rate_per_ps(config)
        if recipe == "compression":
            rate = -rate
        lines.extend([
            f"fix integrate all nvt temp {start_k:.12g} {start_k:.12g} {damp_t:.12g}",
            f"fix deform_box all deform 1 {axis} erate {rate:.12g} units box remap x",
        ])
    elif recipe == "shear":
        plane = config.get("shearPlane", "xy")
        if plane not in {"xy", "xz", "yz"}:
            raise ValueError("Shear plane is invalid")
        lines.extend([
            f"fix integrate all nvt temp {start_k:.12g} {start_k:.12g} {damp_t:.12g}",
            f"fix deform_box all deform 1 {plane} erate {strain_rate_per_ps(config):.12g} units box remap x",
        ])
    elif recipe == "melting":
        lines.append(f"fix integrate all nvt temp {start_k:.12g} {end_k:.12g} {damp_t:.12g}")
    elif recipe == "diffusion":
        lines.extend([
            f"fix integrate all nvt temp {start_k:.12g} {start_k:.12g} {damp_t:.12g}",
            "compute phynite_msd all msd com yes",
            f"fix phynite_msd_out all ave/time {thermo} 1 {thermo} c_phynite_msd[1] c_phynite_msd[2] c_phynite_msd[3] c_phynite_msd[4] file msd.dat",
        ])
    lines.extend([f"run {steps}", "write_restart final.restart"])
    return "\n".join(lines) + "\n"


THERMO_FIELDS = ("step", "timePs", "tempK", "pressureBar", "potentialEnergyEv", "kineticEnergyEv", "totalEnergyEv", "volumeA3", "lx", "ly", "lz", "xy", "xz", "yz", "pxx", "pyy", "pzz", "pxy", "pxz", "pyz")


def parse_thermo(log_text: str) -> list[dict[str, float]]:
    rows: list[dict[str, float]] = []
    collecting = False
    for raw in log_text.splitlines():
        fields = raw.split()
        if fields[:4] == ["Step", "Time", "Temp", "Press"]:
            collecting = True
            continue
        if not collecting:
            continue
        if len(fields) < len(THERMO_FIELDS):
            collecting = False
            continue
        try:
            values = [float(value) for value in fields[:len(THERMO_FIELDS)]]
        except ValueError:
            collecting = False
            continue
        if all(math.isfinite(value) for value in values):
            rows.append(dict(zip(THERMO_FIELDS, values)))
    return rows


def build_recipe_data(config: dict[str, Any], thermo: list[dict[str, float]]) -> dict[str, Any]:
    recipe = str(config["recipeId"])
    result: dict[str, Any] = {
        "recipeId": recipe,
        "initialCellAngstrom": {axis: thermo[0][axis] for axis in ("lx", "ly", "lz")},
        "finalCellAngstrom": {axis: thermo[-1][axis] for axis in ("lx", "ly", "lz")},
        "applied": config,
    }
    try:
        from md_local.research_evidence import mechanical_series, stage_quality
    except ModuleNotFoundError:
        from backend.md_local.research_evidence import mechanical_series, stage_quality
    result.update(mechanical_series(recipe, config, thermo))
    result["qualityEvidence"] = stage_quality({"kind": config.get("ensemble", "nvt") if recipe == "equilibration" else recipe}, thermo)
    return result


def run() -> None:
    payload = validate_job(json.loads(INPUT.read_text(encoding="utf-8")))
    simulation_id = payload["simulationId"]
    source = WORK / payload["localSourcePath"]
    RESULTS.mkdir(parents=True, exist_ok=True)
    data_file = RESULTS / "data.structure"
    pipeline = import_file(str(source), multiple_frames=False)
    data = pipeline.compute(0)
    if data.particles is None or data.particles.count < 1:
        raise ValueError("The source contains no particles")
    particle_types = data.particles.particle_types
    validate_lj_species({str(item.name or "Generic") for item in particle_types.types})
    export_file(data, str(data_file), "lammps/data", atom_style="atomic")
    type_names = [str(item.name) for item in sorted(particle_types.types, key=lambda item: item.id)]
    script = generate_lammps_input(payload["config"], type_names=type_names)
    script_file = RESULTS / "in.lammps"
    script_file.write_text(script, encoding="utf-8")
    executable = shutil.which("lmp") or shutil.which("lammps")
    if not executable:
        raise RuntimeError("LAMMPS executable is not installed in the MD runtime")
    started = time.monotonic()
    process = subprocess.run(
        [executable, "-in", script_file.name], cwd=RESULTS,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        timeout=int(os.environ.get("PHYNITE_MD_TIMEOUT_SECONDS", "86400")), check=False,
    )
    log_file = RESULTS / "log.lammps"
    if not log_file.is_file():
        log_file.write_text(process.stdout, encoding="utf-8")
    if process.returncode:
        raise RuntimeError(f"LAMMPS exited with code {process.returncode}: {process.stdout[-1500:]}")
    trajectory = RESULTS / "trajectory.lammpstrj"
    if not trajectory.is_file() or trajectory.stat().st_size < 1:
        raise RuntimeError("LAMMPS completed without a trajectory")
    thermo = parse_thermo(log_file.read_text(encoding="utf-8", errors="replace"))
    if not thermo:
        raise RuntimeError("LAMMPS completed without finite thermo output")
    thermo_file = RESULTS / "thermo.json"
    thermo_file.write_text(json.dumps(thermo, separators=(",", ":"), allow_nan=False), encoding="utf-8")
    recipe_file = RESULTS / "recipe-data.json"
    recipe_file.write_text(
        json.dumps(build_recipe_data(payload["config"], thermo), separators=(",", ":"), allow_nan=False),
        encoding="utf-8",
    )
    artifacts = []
    for path, role, content_type in (
        (script_file, "input", "text/plain"),
        (data_file, "input", "application/x-lammps"),
        (log_file, "log", "text/plain"),
        (trajectory, "trajectory", "application/x-lammps"),
        (thermo_file, "data", "application/json"),
        (recipe_file, "data", "application/json"),
    ):
        artifacts.append({
            "path": path.relative_to(RESULTS).as_posix(), "label": path.name,
            "role": role, "contentType": content_type,
            "sizeBytes": path.stat().st_size, "sha256": sha256_file(path),
        })
    msd_file = RESULTS / "msd.dat"
    if msd_file.is_file() and msd_file.stat().st_size:
        artifacts.append({
            "path": msd_file.name,
            "label": msd_file.name,
            "role": "data",
            "contentType": "text/plain",
            "sizeBytes": msd_file.stat().st_size,
            "sha256": sha256_file(msd_file),
        })
    manifest = {
        "version": 1,
        "calculationId": simulation_id,
        "kind": "md-simulation",
        "status": "completed",
        "completedAt": utc_now(),
        "elapsedSeconds": round(time.monotonic() - started, 3),
        "recipeId": payload["config"]["recipeId"],
        "artifacts": artifacts,
        "trajectoryArtifact": {
            "path": "trajectory.lammpstrj", "filename": f"{payload['config']['recipeId']}-{simulation_id[-8:]}.lammpstrj",
            "sizeBytes": trajectory.stat().st_size, "sha256": sha256_file(trajectory),
        },
        "summary": {"atoms": int(data.particles.count), "thermoSamples": len(thermo)},
        "provenance": {
            "runtime": "phynite-md-local", "executionMode": os.environ.get("PHYNITE_EXECUTION_MODE", "local-docker"), "lammpsExecutable": Path(executable).name,
            "ovitoVersion": __import__("ovito").version_string,
            "potential": payload["config"]["forceField"], "syntheticData": False,
        },
    }
    (RESULTS / "result.json").write_text(json.dumps(manifest, indent=2, allow_nan=False), encoding="utf-8")


def main() -> int:
    try:
        run()
        return 0
    except Exception as exc:
        RESULTS.mkdir(parents=True, exist_ok=True)
        simulation_id = os.environ.get("PHYNITE_CALCULATION_ID", "unknown")
        try:
            raw = json.loads(INPUT.read_text(encoding="utf-8"))
            simulation_id = str(raw.get("simulationId") or raw.get("calculationId") or simulation_id)
        except Exception:
            pass
        failure = {
            "version": 1, "calculationId": simulation_id, "kind": "md-simulation",
            "status": "failed", "completedAt": utc_now(), "error": str(exc)[:1500],
            "artifacts": [], "provenance": {"runtime": "phynite-md-local", "executionMode": os.environ.get("PHYNITE_EXECUTION_MODE", "local-docker"), "syntheticData": False},
        }
        (RESULTS / "result.json").write_text(json.dumps(failure, indent=2), encoding="utf-8")
        print(str(exc), flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

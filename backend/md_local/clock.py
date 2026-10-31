"""Retain physical dynamics time across changing dt and minimization iterations."""
from __future__ import annotations

import re
import math
from pathlib import Path
from typing import Any


def instrument_clock(lines: list[str]) -> list[str]:
    result: list[str] = []
    operation = 0
    for line in lines:
        command = line.strip().split(None, 1)[0] if line.strip() else ""
        if command in {"run", "minimize"}:
            operation += 1
            kind = "minimization" if command == "minimize" else "dynamics"
            result.extend([f'print "PHYNITE_CLOCK_BEGIN {operation:04d} {kind} $(step:%.0f) $(time:%.17g) $(dt:%.17g)"', line, f'print "PHYNITE_CLOCK_END {operation:04d} {kind} $(step:%.0f) $(time:%.17g) $(dt:%.17g)"'])
        else:
            result.append(line)
    return result


def parse_clock(log_text: str) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    active: dict[str, Any] | None = None
    elapsed = 0.0
    for line in log_text.splitlines():
        match = re.fullmatch(r"PHYNITE_CLOCK_(BEGIN|END) (\d+) (dynamics|minimization) (\d+) ([\deE+.-]+) ([\deE+.-]+)", line.strip())
        if not match:
            continue
        position, identifier, kind, step, raw_time, dt = match.groups()
        if position == "BEGIN":
            active = {"operation": int(identifier), "kind": kind, "startStep": int(step), "rawStartPs": float(raw_time), "timestepPs": float(dt), "startPs": elapsed}
        elif active and active["operation"] == int(identifier):
            duration = float(raw_time) - active["rawStartPs"] if kind == "dynamics" else 0.0
            if duration < -1e-12:
                raise ValueError("LAMMPS physical time moved backwards within a run")
            elapsed += max(0.0, duration)
            records.append({**active, "endStep": int(step), "rawEndPs": float(raw_time), "endPs": elapsed})
            active = None
    return records


def physical_time(raw_time: float, step: float, history: list[dict[str, Any]]) -> float:
    for record in history:
        if record["startStep"] <= step <= record["endStep"] and record["rawStartPs"] - 1e-10 <= raw_time <= record["rawEndPs"] + 1e-10:
            return record["startPs"] if record["kind"] == "minimization" else record["startPs"] + raw_time - record["rawStartPs"]
    if history and step >= history[-1]["endStep"]:
        return history[-1]["endPs"]
    raise ValueError("Trajectory time is outside the retained LAMMPS operation history")


def repair_trajectory_clock(path: Path, history: list[dict[str, Any]]) -> None:
    """Stream the dump; require actual recorded TIME, never infer a scalar dt."""
    temporary = path.with_suffix(path.suffix + ".tmp")
    header: list[str] = []
    body = False
    with path.open(encoding="utf-8") as source, temporary.open("w", encoding="utf-8") as destination:
        for line in source:
            if body and not line.startswith("ITEM:"):
                destination.write(line)
                continue
            body = False
            header.append(line)
            if line.startswith("ITEM: ATOMS"):
                labels = [value.strip() for value in header]
                if "ITEM: TIME" not in labels or "ITEM: TIMESTEP" not in labels:
                    raise ValueError("Managed trajectory is missing actual LAMMPS TIME/TIMESTEP")
                time_index, step_index = labels.index("ITEM: TIME") + 1, labels.index("ITEM: TIMESTEP") + 1
                header[time_index] = f"{physical_time(float(labels[time_index]), float(labels[step_index]), history):.17g}\n"
                destination.writelines(header)
                header = []
                body = True
        if header:
            raise ValueError("Managed trajectory ended inside a frame header")
    temporary.replace(path)


def time_at_step(step: float, history: list[dict[str, Any]]) -> float:
    for record in history:
        if record["startStep"] <= step <= record["endStep"]:
            return record["startPs"] if record["kind"] == "minimization" else record["startPs"] + (step - record["startStep"]) * record["timestepPs"]
    raise ValueError("Analysis sample timestep is outside the retained operation history")


def analysis_time_index(path: Path, style: str, history: list[dict[str, Any]]) -> dict[str, Any]:
    """Index original ave/time rows with the true elapsed dynamics clock.

    RDF vector files have step/bin-count headers; MSD/VACF scalar files have
    one data row per step. The original observable numbers remain untouched.
    """
    samples: list[dict[str, Any]] = []
    with path.open(encoding="utf-8") as source:
        lines = iter(enumerate(source, 1))
        for line_number, line in lines:
            if not line.strip() or line.lstrip().startswith("#"):
                continue
            try:
                values = [float(value) for value in line.split()]
            except ValueError as exc:
                raise ValueError(f"Saved {style} output contains a nonnumeric row") from exc
            if not all(math.isfinite(value) for value in values):
                raise ValueError(f"Saved {style} output contains non-finite values")
            if style == "rdf":
                if len(values) != 2 or int(values[1]) != values[1] or values[1] < 1:
                    raise ValueError("Saved RDF output has an invalid vector header")
                for _ in range(int(values[1])):
                    try:
                        _, data_line = next(lines)
                        data_values = [float(value) for value in data_line.split()]
                    except (ValueError, StopIteration) as exc:
                        raise ValueError("Saved RDF output has an incomplete numeric vector") from exc
                    if len(data_values) < 4 or not all(math.isfinite(value) for value in data_values):
                        raise ValueError("Saved RDF output has an invalid numeric vector")
            elif len(values) != 5:
                raise ValueError(f"Saved {style} output must contain step and four vector components")
            samples.append({"step": values[0], "timePs": time_at_step(values[0], history), "rawLine": line_number})
    if not samples:
        raise ValueError(f"Saved {style} output contains no evaluated samples; increase duration or decrease the sampling interval")
    return {"style": style, "rawArtifact": path.name, "timeUnit": "ps", "clockOrigin": "elapsed dynamics since this job started", "samples": samples}

from __future__ import annotations

import re
from typing import Any

import numpy as np

from qe_model import ATOMIC_NUMBERS


BOHR_TO_ANGSTROM = 0.529177210903


def _block(input_text: str, header: str, stop_headers: tuple[str, ...]) -> tuple[str, list[str]]:
    match = re.search(rf"^\s*{header}\b([^\n]*)\n", input_text, re.IGNORECASE | re.MULTILINE)
    if not match:
        raise ValueError(f"{header} is missing")
    tail = input_text[match.end():]
    stop = len(tail)
    for candidate in stop_headers:
        found = re.search(rf"^\s*{candidate}\b", tail, re.IGNORECASE | re.MULTILINE)
        if found:
            stop = min(stop, found.start())
    lines = [line.strip() for line in tail[:stop].splitlines() if line.strip() and not line.lstrip().startswith("!")]
    return match.group(1).strip().lower(), lines


def parse_qe_structure(input_text: str) -> tuple[list[list[float]], list[list[float]], list[int]]:
    atomic_numbers = ATOMIC_NUMBERS

    cell_unit, cell_lines = _block(
        input_text,
        "CELL_PARAMETERS",
        ("ATOMIC_POSITIONS", "K_POINTS", "ATOMIC_FORCES", "CONSTRAINTS", "OCCUPATIONS"),
    )
    if len(cell_lines) < 3:
        raise ValueError("CELL_PARAMETERS does not contain three vectors")
    cell = np.asarray([[float(value) for value in line.split()[:3]] for line in cell_lines[:3]], dtype=float)
    if "bohr" in cell_unit:
        cell *= BOHR_TO_ANGSTROM
    elif cell_unit and "angstrom" not in cell_unit:
        raise ValueError(f"Automatic k-path does not support CELL_PARAMETERS {cell_unit}")

    position_unit, position_lines = _block(
        input_text,
        "ATOMIC_POSITIONS",
        ("K_POINTS", "CELL_PARAMETERS", "ATOMIC_FORCES", "CONSTRAINTS", "OCCUPATIONS"),
    )
    positions: list[list[float]] = []
    numbers: list[int] = []
    for line in position_lines:
        fields = line.split()
        if len(fields) < 4:
            continue
        symbol_match = re.match(r"([A-Z][a-z]?)", fields[0])
        if not symbol_match or symbol_match.group(1) not in atomic_numbers:
            raise ValueError(f"Cannot resolve atomic species label {fields[0]}")
        positions.append([float(value) for value in fields[1:4]])
        numbers.append(int(atomic_numbers[symbol_match.group(1)]))
    if not positions:
        raise ValueError("ATOMIC_POSITIONS does not contain atoms")
    position_array = np.asarray(positions, dtype=float)
    if "crystal" not in position_unit:
        if "angstrom" in position_unit:
            position_array = position_array @ np.linalg.inv(cell)
        elif "bohr" in position_unit:
            position_array = (position_array * BOHR_TO_ANGSTROM) @ np.linalg.inv(cell)
        else:
            raise ValueError(f"Automatic k-path does not support ATOMIC_POSITIONS {position_unit}")
    return cell.tolist(), position_array.tolist(), numbers


def seek_path_for_qe(input_text: str) -> dict[str, Any]:
    import seekpath

    structure = parse_qe_structure(input_text)
    result = seekpath.get_path_orig_cell(structure, with_time_reversal=True)
    return {
        "pointCoords": result["point_coords"],
        "cellAngstrom": structure[0],
        "coordinateSystem": "reciprocal-fractional-original-cell",
        "path": [list(segment) for segment in result["path"]],
        "spaceGroupNumber": result["spacegroup_number"],
        "spaceGroupInternational": result["spacegroup_international"],
        "bravaisLattice": result["bravais_lattice"],
        "isSupercell": bool(result["is_supercell"]),
    }


def qe_path_lines(path_result: dict[str, Any], points_per_segment: int) -> tuple[str, list[str], list[int]]:
    point_coords = path_result["pointCoords"]
    segments = path_result["path"]
    entries: list[dict[str, Any]] = []
    for start, end in segments:
        if entries and entries[-1]["label"] == start:
            entries[-1]["weight"] = points_per_segment
        else:
            entries.append({"label": start, "coords": point_coords[start], "weight": points_per_segment})
        entries.append({"label": end, "coords": point_coords[end], "weight": 1})
    lines = [
        f"{entry['coords'][0]:.10f} {entry['coords'][1]:.10f} {entry['coords'][2]:.10f} {entry['weight']} ! {entry['label']}"
        for entry in entries
    ]
    labels = [str(entry["label"]) for entry in entries]
    tick_indices: list[int] = []
    cursor = 0
    for entry in entries:
        tick_indices.append(cursor)
        cursor += int(entry["weight"])
    return f"{len(lines)}\n" + "\n".join(lines) + "\n", labels, tick_indices


def qe_path_break_indices(path_result: dict[str, Any], tick_indices: list[int]) -> list[int]:
    """Identify the first sample after each disconnected branch, without dropping endpoints."""
    breaks: list[int] = []
    cursor = 0
    previous_end = None
    for start, end in path_result["path"]:
        if previous_end is not None and previous_end != start:
            cursor += 1
            breaks.append(tick_indices[cursor])
        cursor += 1
        previous_end = end
    return breaks


def requested_path_segments(path_result: dict[str, Any], requested_path: str) -> tuple[list[list[str]], list[str]]:
    """Resolve a user path such as Γ-M-K-Γ against SeeK-path labels."""
    raw_labels = [
        label.strip()
        for label in re.split(r"\s*(?:->|[—–→\-,;|])\s*", requested_path.strip())
        if label.strip()
    ]
    if len(raw_labels) < 2:
        raise ValueError("Custom reciprocal path must contain at least two high-symmetry labels")

    point_coords = path_result.get("pointCoords")
    if not isinstance(point_coords, dict) or not point_coords:
        raise ValueError("SeeK-path did not return high-symmetry point coordinates")

    def normalized(label: str) -> str:
        value = label.strip().replace("Γ", "GAMMA").replace("γ", "GAMMA")
        value = re.sub(r"^\\?GAMMA$", "GAMMA", value, flags=re.IGNORECASE)
        return re.sub(r"\s+", "", value).upper()

    available = {normalized(str(label)): str(label) for label in point_coords}
    labels: list[str] = []
    for raw_label in raw_labels:
        label = available.get(normalized(raw_label))
        if label is None:
            choices = ", ".join(str(item) for item in point_coords)
            raise ValueError(f"High-symmetry point {raw_label!r} is unavailable for this structure; available points: {choices}")
        labels.append(label)
    segments = [[start, end] for start, end in zip(labels, labels[1:])]
    return segments, labels


def crystal_b_path_metadata(input_text: str) -> dict[str, Any] | None:
    """Build tick and branch-break metadata from a pre-compiled K_POINTS crystal_b block."""
    if not input_text:
        return None
    try:
        unit, lines = _block(
            input_text,
            "K_POINTS",
            ("ATOMIC_SPECIES", "ATOMIC_POSITIONS", "CELL_PARAMETERS", "ATOMIC_FORCES", "CONSTRAINTS", "OCCUPATIONS", "HUBBARD"),
        )
    except ValueError:
        return None
    if not unit.split() or unit.split()[0] != "crystal_b" or not lines:
        return None
    try:
        count = int(lines[0].split()[0])
    except ValueError:
        return None
    if count < 2 or len(lines) < count + 1:
        return None

    labels: list[str] = []
    point_coords: dict[str, list[float]] = {}
    tick_indices: list[int] = []
    break_indices: list[int] = []
    cursor = 0
    prev_weight: int | None = None

    for idx, raw_line in enumerate(lines[1 : count + 1]):
        body, _, comment = raw_line.partition("!")
        fields = body.split()
        if len(fields) < 4:
            return None
        try:
            coords = [float(fields[0]), float(fields[1]), float(fields[2])]
            weight = int(round(float(fields[3])))
        except ValueError:
            return None
        label = comment.strip() or f"K{idx + 1}"
        if idx > 0 and prev_weight is not None and prev_weight <= 1:
            break_indices.append(cursor)
        labels.append(label)
        point_coords.setdefault(label, coords)
        tick_indices.append(cursor)
        cursor += 1 if weight <= 0 else weight
        prev_weight = weight

    break_set = set(break_indices)
    segments = [
        [labels[i], labels[i + 1]]
        for i in range(len(labels) - 1)
        if tick_indices[i + 1] not in break_set
    ]
    return {
        "labels": labels,
        "pointCoords": point_coords,
        "segments": segments,
        "tickIndices": tick_indices,
        "breakIndices": break_indices,
    }


def replace_pw_k_path(input_text: str, path_lines: str) -> str:
    replacement = f"K_POINTS crystal_b\n{path_lines.rstrip()}\n"
    match = re.search(r"^\s*K_POINTS\b", input_text, re.IGNORECASE | re.MULTILINE)
    if not match:
        return input_text.rstrip() + "\n\n" + replacement
    return input_text[:match.start()].rstrip() + "\n\n" + replacement


def replace_matdyn_q_path(input_text: str, path_lines: str) -> str:
    namelist_end = input_text.find("/", input_text.upper().find("&INPUT"))
    if namelist_end < 0:
        raise ValueError("matdyn input has no complete &INPUT namelist")
    return input_text[: namelist_end + 1].rstrip() + "\n" + path_lines

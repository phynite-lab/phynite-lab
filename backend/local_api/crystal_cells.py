"""Geometric cell standardization in the installed, isolated DFT runtime."""
from __future__ import annotations

import json
import math
import os
import subprocess
import tempfile
import threading
from pathlib import Path
from typing import Any

from backend.local_api.domain.elements import ELEMENT_SYMBOLS
from backend.local_api.domain.phynite_core import ApiError
from backend.local_api.sandbox import SandboxError

_SLOTS = threading.BoundedSemaphore(2)
# This fixed program receives only validated geometry as JSON. No submitted code,
# paths or solver commands are executed, and no project files enter its sandbox.
STANDARDIZE_PROGRAM = r'''
import json, sys
import numpy as np
import spglib
data = json.load(sys.stdin)
names = sorted(set(atom["species"] for atom in data["atoms"]))
positions = [[atom["x"], atom["y"], atom["z"]] for atom in data["atoms"]]
types = [names.index(atom["species"]) + 1 for atom in data["atoms"]]
cell = (data["vectors"], positions, types)
result = spglib.standardize_cell(cell, to_primitive=data["cell"] == "primitive",
    no_idealize=True, symprec=data["symprec"], angle_tolerance=-1.0)
if result is None:
    raise ValueError("No symmetry-consistent cell was found at the selected tolerance.")
vectors, points, numbers = result
if len(points) > 5000 or not np.isfinite(vectors).all() or not np.isfinite(points).all():
    raise ValueError("The standardized cell exceeds the supported geometry limits.")
before = np.bincount(types, minlength=len(names) + 1)[1:]
after = np.bincount(numbers, minlength=len(names) + 1)[1:]
if not np.allclose(before / sum(before), after / sum(after), atol=1e-10, rtol=0):
    raise ValueError("Cell standardization changed the composition ratio.")
ratio = abs(np.linalg.det(vectors) / np.linalg.det(data["vectors"]))
if not np.isclose(ratio, len(points) / len(positions), atol=1e-6, rtol=1e-6):
    raise ValueError("Cell standardization changed the atomic number density.")
json.dump({"vectors": vectors.tolist(), "sites": [
    {"species": names[int(number) - 1], "x": float(point[0] % 1),
     "y": float(point[1] % 1), "z": float(point[2] % 1)}
    for point, number in zip(points, numbers)], "version": spglib.__version__},
    sys.stdout, allow_nan=False)
'''


def validate_cell_request(payload: dict[str, Any], *, maximum_sites: int = 2000) -> dict[str, Any]:
    if not isinstance(payload, dict) or set(payload) != {"atoms", "vectors", "periodic", "cell", "symprec"}:
        raise ApiError(400, "Provide geometry, periodicity, a cell choice and symmetry tolerance.", "CRYSTAL_CELL_INVALID")
    if not isinstance(payload["cell"], str) or payload["cell"] not in {"primitive", "conventional"}:
        raise ApiError(400, "Choose a primitive or conventional cell.", "CRYSTAL_CELL_INVALID")
    if payload["periodic"] != [True, True, True] or any(type(value) is not bool for value in payload["periodic"]):
        raise ApiError(400, "Primitive/conventional conversion requires a fully periodic crystal. Use its source cell or a supercell for lower-dimensional structures.", "CRYSTAL_CELL_PERIODICITY")
    finite = lambda value: type(value) in {int, float} and math.isfinite(value)
    tolerance = payload["symprec"]
    if not finite(tolerance) or not 1e-6 <= tolerance <= 0.1:
        raise ApiError(400, "Use a symmetry tolerance between 0.000001 and 0.1 Å.", "CRYSTAL_CELL_INVALID")
    vectors = payload["vectors"]
    if not isinstance(vectors, list) or len(vectors) != 3 or any(not isinstance(row, list) or len(row) != 3 or any(not finite(value) for value in row) for row in vectors):
        raise ApiError(400, "Provide three finite cell vectors in Å.", "CRYSTAL_CELL_INVALID")
    a, b, c = vectors
    volume = a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])
    lengths = math.prod(math.hypot(*row) for row in vectors)
    if not math.isfinite(lengths) or lengths == 0 or abs(volume) / lengths < 1e-8:
        raise ApiError(400, "The cell must span a finite, nonzero volume.", "CRYSTAL_CELL_INVALID")
    atoms = payload["atoms"]
    if not isinstance(atoms, list) or not 1 <= len(atoms) <= maximum_sites:
        raise ApiError(400, f"Use a crystal with 1–{maximum_sites:,} sites for this operation.", "CRYSTAL_CELL_LIMIT")
    for atom in atoms:
        if not isinstance(atom, dict) or set(atom) != {"species", "x", "y", "z"} or not isinstance(atom["species"], str) or atom["species"] not in ELEMENT_SYMBOLS or any(not finite(atom[axis]) for axis in ("x", "y", "z")):
            raise ApiError(400, "Standardization requires explicit, fully occupied elemental sites and finite fractional positions.", "CRYSTAL_CELL_INVALID")
    return payload


def standardize_crystal(payload: dict[str, Any], runtime: Any) -> dict[str, Any]:
    data = validate_cell_request(payload)
    environment = runtime.environment() if runtime else {}
    python = environment.get("PHYNITE_RUNTIME_PYTHON_DFT")
    if not python:
        raise ApiError(503, "Install the DFT runtime in Settings → Compute to create primitive or conventional cells. The source cell and supercells remain available.", "CRYSTAL_CELL_RUNTIME_REQUIRED")
    if not _SLOTS.acquire(blocking=False):
        raise ApiError(429, "Two cell conversions are already running. Wait before retrying.", "CRYSTAL_CELL_BUSY")
    try:
        work = Path(runtime.data_dir) / "work"
        work.mkdir(mode=0o700, parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="crystal-cell-", dir=work) as directory:
            command = runtime.sandbox.command(Path(directory), [python, "-I", "-c", STANDARDIZE_PROGRAM])
            process = subprocess.run(command, input=json.dumps(data, allow_nan=False), text=True,
                                     capture_output=True, timeout=30, cwd=directory,
                                     env={"PATH": environment.get("PATH", os.defpath), "OMP_NUM_THREADS": "1", "OPENBLAS_NUM_THREADS": "1", "PYTHONDONTWRITEBYTECODE": "1"})
        if process.returncode != 0 or len(process.stdout) > 2_000_000:
            raise ApiError(422, "The DFT runtime could not standardize this crystal at the selected tolerance. Keep the source cell or adjust the tolerance.", "CRYSTAL_CELL_FAILED")
        result = json.loads(process.stdout)
        if not isinstance(result, dict) or set(result) != {"vectors", "sites", "version"} or not isinstance(result["version"], str):
            raise ValueError("Invalid cell result")
        # Validate the runtime's geometry independently before returning it.
        try:
            validate_cell_request({**data, "vectors": result["vectors"], "atoms": result["sites"]}, maximum_sites=5000)
        except ApiError:
            raise ValueError("Invalid runtime geometry") from None
        return {**result, "provenance": {"operation": "standardize-cell", "cell": data["cell"], "method": "spglib.standardize_cell", "version": result["version"], "symprecAngstrom": data["symprec"], "angleToleranceDegrees": -1, "noIdealize": True, "coordinateUnit": "fractional", "cellUnit": "angstrom"}}
    except subprocess.TimeoutExpired:
        raise ApiError(504, "Cell conversion timed out. Use a smaller source cell or keep the original cell.", "CRYSTAL_CELL_TIMEOUT") from None
    except SandboxError:
        raise ApiError(503, "Local runtime isolation is unavailable. Check Settings → Compute before converting this cell.", "CRYSTAL_CELL_ISOLATION") from None
    except (OSError, ValueError, TypeError, KeyError):
        raise ApiError(502, "The local runtime returned an invalid cell. The original structure was preserved.", "CRYSTAL_CELL_FAILED") from None
    finally:
        _SLOTS.release()

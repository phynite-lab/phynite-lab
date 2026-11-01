"""Load the immutable visible-frame wire format without losing source identities."""
from __future__ import annotations

import hashlib
import json
import math
import re
import tempfile
from pathlib import Path
from typing import Any

import numpy as np
from ovito.data import DataCollection, ParticleType
from ovito.io import import_file


def _finite_array(value: Any, count: int, label: str) -> list[float]:
    if not isinstance(value, list) or len(value) != count or any(isinstance(item, bool) or not isinstance(item, (int, float)) or not math.isfinite(float(item)) for item in value):
        raise ValueError(f"Source snapshot {label} must contain {count} finite numbers")
    return [float(item) for item in value]


def load_source_snapshot(source: Path) -> tuple[DataCollection, dict[str, Any]]:
    value = json.loads(source.read_text(encoding="utf-8"))
    if not isinstance(value, dict) or value.get("schemaVersion") != 1 or value.get("kind") != "phynite-md-frame" or value.get("units") != {"length": "angstrom", "time": "ps"}:
        raise ValueError("Source snapshot schema/units are unsupported; prepare a canonical angstrom/ps frame")
    frame = value.get("frame")
    if not isinstance(frame, dict) or frame.get("hasCell") is not True:
        raise ValueError("Source snapshot requires an explicit nondegenerate simulation cell")
    property_units = frame.get("propertyUnits") or {}
    if not isinstance(property_units, dict):
        raise ValueError("Source snapshot property units are invalid")
    ids, species = frame.get("ids"), frame.get("species")
    if not isinstance(ids, list) or not ids or any(not isinstance(item, str) or not item for item in ids) or len(set(ids)) != len(ids):
        raise ValueError("Source snapshot particle IDs must be unique nonempty strings")
    count = len(ids)
    if not isinstance(species, list) or len(species) != count or any(not isinstance(item, str) or not re.fullmatch(r"[A-Z][a-z]?|Generic", item) for item in species):
        raise ValueError("Source snapshot requires one recognized element name per particle")
    positions = np.asarray(_finite_array(frame.get("positions"), count * 3, "positions")).reshape((-1, 3))
    raw_vectors = frame.get("vectors")
    if not isinstance(raw_vectors, list) or len(raw_vectors) != 3:
        raise ValueError("Source snapshot cell must contain three vectors")
    vectors = np.asarray([_finite_array(vector, 3, "cell vector") for vector in raw_vectors])
    if np.linalg.det(vectors) <= 1e-10:
        raise ValueError("Source snapshot cell must be nondegenerate and right-handed")
    origin = _finite_array(frame.get("origin"), 3, "origin")
    periodic = frame.get("periodic")
    if not isinstance(periodic, list) or len(periodic) != 3 or any(not isinstance(item, bool) for item in periodic):
        raise ValueError("Source snapshot requires three explicit periodicity flags")
    properties = frame.get("properties", {})
    if not isinstance(properties, dict):
        raise ValueError("Source snapshot particle properties are invalid")
    masses = properties.get("Mass", properties.get("mass"))
    if masses is not None:
        if property_units.get("mass") != "amu" and frame.get("sourceUnits") != "metal":
            raise ValueError("Source snapshot initial masses must be normalized to amu")
        masses = _finite_array(masses, count, "masses")
        if any(item <= 0 for item in masses):
            raise ValueError("Source snapshot masses must be positive")
    names = list(dict.fromkeys(species))
    # OVITO's element database is authoritative for standard atomic weights;
    # do not invent a default mass for Generic or an unknown symbol.
    with tempfile.TemporaryDirectory(prefix="phynite-masses-") as folder:
        path = Path(folder) / "elements.xyz"
        path.write_text(str(len(names)) + "\nProperties=species:S:1:pos:R:3\n" + "".join(f"{name} 0 0 0\n" for name in names), encoding="utf-8")
        imported = import_file(str(path)).compute()
        known_masses = {item.name: float(item.mass) for item in imported.particles.particle_types.types}
    type_columns = [items for key, items in properties.items() if re.sub(r"[^a-z0-9]", "", key.lower()) in {"type", "particletype"}]
    if type_columns:
        values = _finite_array(type_columns[0], count, "particle types")
        if any(value != int(value) or value < 1 or value > 2_147_483_647 for value in values):
            raise ValueError("Source snapshot particle type IDs must be positive integers")
        source_type_ids = [int(value) for value in values]
        if any(_finite_array(column, count, "particle types") != values for column in type_columns[1:]):
            raise ValueError("Source snapshot particle type columns disagree")
    else:
        implicit_types = {name: index for index, name in enumerate(names, 1)}
        source_type_ids = [implicit_types[name] for name in species]
    type_names: dict[int, str] = {}
    for type_id, name in zip(source_type_ids, species):
        if type_id in type_names and type_names[type_id] != name:
            raise ValueError(f"Source snapshot particle type {type_id} maps to more than one element")
        type_names[type_id] = name
    type_mass: dict[int, float] = {}
    for type_id, name in sorted(type_names.items()):
        selected = [masses[i] for i, identifier in enumerate(source_type_ids) if identifier == type_id] if masses is not None else [known_masses.get(name, 0)]
        if any(mass <= 0 for mass in selected) or any(abs(mass - selected[0]) > 1e-12 for mass in selected):
            raise ValueError(f"Source particle type {type_id} ({name}) needs one explicit positive mass; isotope subtypes require distinct particle type IDs")
        type_mass[type_id] = selected[0]
    identity: dict[str, int] = {}
    used: set[int] = set()
    for item in ids:
        if re.fullmatch(r"[+]?\d+", item):
            number = int(item)
            if 0 < number <= 2_147_483_647 and number not in used:
                identity[item] = number
                used.add(number)
    next_id = 1
    for item in ids:
        if item in identity:
            continue
        while next_id in used:
            next_id += 1
        identity[item] = next_id
        used.add(next_id)
    data = DataCollection()
    data.create_cell(np.column_stack((vectors.T, origin)), pbc=tuple(periodic))
    particles = data.create_particles(count=count)
    particles.create_property("Position", data=positions)
    particles.create_property("Particle Identifier", data=[identity[item] for item in ids])
    types = particles.create_property("Particle Type", data=source_type_ids)
    for identifier, name in sorted(type_names.items()):
        types.types.append(ParticleType(id=identifier, name=name, mass=type_mass[identifier]))
    for native, candidates in {"Velocity": [("vx", "vy", "vz"), ("Velocity.X", "Velocity.Y", "Velocity.Z")], "Periodic Image": [("ix", "iy", "iz"), ("Periodic Image.X", "Periodic Image.Y", "Periodic Image.Z")]}.items():
        if native == "Periodic Image" and frame.get("coordinateMode") == "unwrapped":
            # An unwrapped Cartesian coordinate already contains its image
            # translation. LAMMPS remaps it with consistent new image flags.
            continue
        for columns in candidates:
            present = [column in properties for column in columns]
            if any(present):
                if not all(present):
                    raise ValueError(f"Source snapshot {native} must contain all three components")
                if native == "Velocity" and property_units.get("velocity") != "angstrom/ps" and frame.get("sourceUnits") not in {None, "metal"}:
                    raise ValueError("Source snapshot initial velocities must be normalized to angstrom/ps")
                values = np.asarray([_finite_array(properties[column], count, native) for column in columns]).T
                if native == "Periodic Image" and np.any(values != np.floor(values)):
                    raise ValueError("Source snapshot periodic images must be integers")
                particles.create_property(native, data=values)
                break
    source_types = [{"typeId": identifier, "element": name, "massAmu": type_mass[identifier]} for identifier, name in sorted(type_names.items())]
    identity_record = {"schemaVersion": 1, "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(), "units": value["units"], "frame": frame, "originalToExecutedIds": identity, "sourceParticleTypes": source_types, **({"particleTypeMassesAmu": {name: type_mass[identifier] for identifier, name in type_names.items()}} if len(set(type_names.values())) == len(type_names) else {}), "provenance": value.get("provenance", {})}
    return data, identity_record

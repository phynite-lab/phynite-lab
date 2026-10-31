"""Local, stateless scientific analysis service for Phynite MD Lab."""
from __future__ import annotations

import os
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
import math
import gzip
import io
from contextlib import nullcontext
import re
import secrets
import tempfile
from pathlib import Path
from typing import Any, Iterable, Literal

import numpy as np
from ovito.data import DataCollection, ParticleType
from ovito.pipeline import Pipeline, StaticSource
from ovito.io import import_file
from ovito import modifiers as mods
from fastapi import FastAPI, HTTPException, UploadFile, File, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, ConfigDict

app = FastAPI(title="Phynite MD Engine", version="1.0.0")
ENGINE_ID = "phynite-md"
ENGINE_NAME = "Phynite MD Engine"
ORIGINS = os.getenv("MD_CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
ENGINE_TOKEN = os.getenv("MD_ENGINE_SHARED_SECRET", "").strip()
app.add_middleware(CORSMiddleware, allow_origins=ORIGINS, allow_methods=["GET", "POST"], allow_headers=["Content-Type"])

@app.middleware("http")
async def local_origin(request: Request, call_next):
    # This local service accepts data, never arbitrary file paths or Python expressions.
    from fastapi.responses import JSONResponse
    if request.headers.get("origin") and request.headers["origin"] not in ORIGINS:
        return JSONResponse({"detail": "Origin is not allowed."}, status_code=403)
    if ENGINE_TOKEN and not secrets.compare_digest(request.headers.get("x-phynite-engine-token", ""), ENGINE_TOKEN):
        return JSONResponse({"detail": "A valid Phynite engine token is required."}, status_code=401)
    return await call_next(request)

def analysis_atom_limit() -> int:
    if os.environ.get("PHYNITE_HEADLESS_JOB") != "1": return 100_000
    # Trusted headless containers alone scale with their enforced RAM grant.
    # HTTP/browser imports retain their independent 100k/64MiB safeguards.
    memory = os.environ.get("PHYNITE_MEMORY_MIB", "2048")
    if not re.fullmatch(r"[1-9]\d*", memory):
        raise ValueError("PHYNITE_MEMORY_MIB must be a positive integer for a headless analysis grant")
    return max(100_000, min(10_000_000, int(memory) * 1024**2 // 8192))

class Frame(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    index: int = 0
    timestep: float | None = None
    time: float | None = None
    sourceUnits: str | None = None
    nativeTime: float | None = None
    coordinateMode: str | None = None
    propertyUnits: dict[str, str] | None = None
    massProvenance: Literal["element-database", "source-explicit", "unknown"] | None = None
    geometryProvenance: list[dict] = Field(default_factory=list)
    ids: list[str]
    species: list[str]
    positions: list[float] = Field(max_length=analysis_atom_limit() * 3)
    properties: dict[str, list[float | None]] = Field(default_factory=dict)
    stringProperties: dict[str, list[str]] = Field(default_factory=dict)
    vectors: list[list[float]]
    origin: list[float]
    periodic: list[bool]
    hasCell: bool = True

class Modifier(BaseModel):
    kind: str
    enabled: bool = True
    params: dict[str, Any] = Field(default_factory=dict)

class AnalysisRequest(BaseModel):
    frame: Frame
    reference: Frame | None = None
    modifiers: list[Modifier] = Field(default_factory=list, max_length=24)

def bounded(p, name, default, low, high, integer=False):
    value = float(p.get(name, default))
    if not math.isfinite(value) or value < low or value > high or (integer and value != int(value)):
        raise ValueError(name + " is outside its supported range.")
    return int(value) if integer else value

def source_identity_map(values: list[str]):
    """Keep source integer identifiers when possible and map only non-integer IDs."""
    unique = list(dict.fromkeys(values))
    identity: dict[str, int] = {}
    used: set[int] = set()
    for value in unique:
        raw = value.strip()
        if not re.fullmatch(r"[+-]?\d+", raw):
            continue
        candidate = int(raw)
        if -(2**63) <= candidate < 2**63 and candidate not in used:
            identity[value] = candidate
            used.add(candidate)
    candidate = 1
    for value in unique:
        if value in identity:
            continue
        while candidate in used:
            candidate += 1
        identity[value] = candidate
        used.add(candidate)
    return identity

def source_particle_types(frame: Frame):
    """Return valid numeric source type IDs and their display names when present."""
    columns = [items for name, items in frame.properties.items()
               if re.sub(r"[^a-z0-9]", "", name.lower()) in ("type", "particletype")]
    if not columns:
        return None
    values = columns[0]
    if len(values) != len(frame.species) or any(items != values for items in columns[1:]):
        raise ValueError("Particle type arrays must match the particle count and agree with one another")
    ids: list[int] = []
    names: dict[int, str] = {}
    for value, species in zip(values, frame.species):
        if value is None or not math.isfinite(float(value)) or float(value) != int(float(value)):
            raise ValueError("Particle type IDs must be positive integers")
        type_id = int(float(value))
        if type_id < 1 or type_id >= 2**31 or (type_id in names and names[type_id] != species):
            raise ValueError("Particle type IDs must be positive integers with one element name per type")
        ids.append(type_id)
        names[type_id] = species
    return ids, names

def data_from_frame(frame: Frame, identity: dict[str, int]):
    n = len(frame.species)
    if n < 1 or len(frame.positions) != n * 3 or len(frame.ids) != n or len(set(frame.ids)) != n:
        raise ValueError("Frame arrays must have matching lengths and unique particle IDs.")
    basis = np.array(frame.vectors, dtype=float)
    if basis.shape != (3, 3) or abs(np.linalg.det(basis)) < 1e-10 or len(frame.origin) != 3 or len(frame.periodic) != 3:
        raise ValueError("Frame has an invalid simulation cell.")
    data = DataCollection()
    cell = np.column_stack((basis.T, frame.origin))
    data.create_cell(cell, pbc=tuple(frame.periodic))
    particles = data.create_particles(count=n)
    particles.create_property("Position", data=np.array(frame.positions).reshape((-1, 3)))
    particles.create_property("Particle Identifier", data=[identity[value] for value in frame.ids])
    source_types = source_particle_types(frame)
    if source_types:
        type_values, type_names = source_types
    else:
        names = list(dict.fromkeys(frame.species))
        ids = {name: i + 1 for i, name in enumerate(names)}
        type_values, type_names = [ids[name] for name in frame.species], {type_id: name for name, type_id in ids.items()}
    types = particles.create_property("Particle Type", data=type_values)
    for type_id, name in sorted(type_names.items()):
        types.types.append(ParticleType(id=type_id, name=name))
    for name, values in frame.stringProperties.items():
        if name in {"Position", "Particle Type", "Particle Identifier"} or name in frame.properties or len(values) != n:
            raise ValueError(f"String particle property {name!r} is invalid or does not match the source particle count")
        particles.create_property(name, data=values, dtype=str)
    grouped: dict[str, dict[str, list[float | None]]] = {}
    for name, values in frame.properties.items():
        if name in ("Position", "Particle Type", "Particle Identifier"):
            continue
        if len(values) != n:
            raise ValueError(f"Particle property {name!r} does not match the source particle count")
        if "." in name:
            base, component = name.rsplit(".", 1)
            grouped.setdefault(base, {})[component] = values
        else:
            particles.create_property(name, data=np.array([np.nan if x is None else x for x in values], dtype=float))
    # The wire format exposes vector components separately. Reconstruct their
    # native property before analysis; OVITO forbids dots in property names.
    for base, columns in grouped.items():
        if particles.standard_property_type_id(base):
            prop = particles.create_property(base)
            components = list(prop.component_names)
            if not components or set(columns) - {"Magnitude"} != set(components):
                raise ValueError(f"Vector property {base!r} has incomplete or unsupported components")
            prop[...] = np.array([[np.nan if columns[component][i] is None else columns[component][i] for component in components] for i in range(n)])
        else:
            components = [component for component in columns if component != "Magnitude"]
            if not components:
                raise ValueError(f"Vector property {base!r} is missing its source components")
            # Numeric labels identify otherwise unnamed source components.
            # Sort them numerically so a JSON key reordering cannot swap axes.
            if all(component.isdigit() for component in components):
                components.sort(key=int)
            particles.create_property(base, components=components, data=np.array([[np.nan if columns[component][i] is None else columns[component][i] for component in components] for i in range(n)]))
    if frame.timestep is not None:
        data.attributes["Timestep"] = frame.timestep
    return data

def build_modifier(item: Modifier, reference: Frame | None, identity):
    p, kind = item.params, item.kind
    if kind == "ptm":
        mod = mods.PolyhedralTemplateMatchingModifier(rmsd_cutoff=bounded(p, "rmsd", .12, 0, 1), output_rmsd=True)
        for structure in mod.structures:
            structure.enabled = True
        return [mod]
    if kind == "cna":
        return [mods.CommonNeighborAnalysisModifier(mode=mods.CommonNeighborAnalysisModifier.Mode.FixedCutoff if p.get("mode") == "fixed" else mods.CommonNeighborAnalysisModifier.Mode.AdaptiveCutoff, cutoff=bounded(p, "cutoff", 3.5, .1, 30))]
    if kind == "dxa":
        lattice = str(p.get("lattice", "FCC")).upper()
        if lattice not in ("FCC", "BCC", "HCP", "CUBIC_DIAMOND", "HEX_DIAMOND"):
            raise ValueError("Choose a supported DXA lattice.")
        return [mods.DislocationAnalysisModifier(input_crystal_structure=getattr(mods.DislocationAnalysisModifier.Lattice, lattice))]
    if kind in ("rdf", "coordination"):
        return [mods.CoordinationAnalysisModifier(cutoff=bounded(p, "cutoff", 5, .1, 30), number_of_bins=bounded(p, "bins", 100, 10, 500, True))]
    if kind == "bonds":
        return [mods.CreateBondsModifier(cutoff=bounded(p, "cutoff", 2.8, .1, 20))]
    if kind == "surface":
        return [mods.ConstructSurfaceModifier(radius=bounded(p, "radius", 2.8, .1, 20), identify_regions=True)]
    if kind == "centrosymmetry":
        count = bounded(p, "neighbors", 12, 2, 32, True)
        if count % 2: raise ValueError("Centrosymmetry needs an even neighbor count.")
        return [mods.CentroSymmetryModifier(num_neighbors=count)]
    if kind == "strain":
        if reference is None: raise ValueError("Atomic strain requires a reference frame.")
        mod = mods.AtomicStrainModifier(cutoff=bounded(p, "cutoff", 3.2, .1, 30), output_nonaffine_squared_displacements=True)
        mod.reference = StaticSource(data=data_from_frame(reference, identity))
        return [mod]
    if kind == "cluster":
        return [mods.ClusterAnalysisModifier(cutoff=bounded(p, "cutoff", 3, .1, 30), sort_by_size=True)]
    if kind == "replicate":
        repeat = p.get("repeat", [2, 2, 1])
        if len(repeat) != 3 or any(not isinstance(x, int) or x < 1 or x > 8 for x in repeat):
            raise ValueError("Repeat counts must be integers from 1 to 8.")
        return [mods.ReplicateModifier(num_x=repeat[0], num_y=repeat[1], num_z=repeat[2], unique_ids=True)]
    if kind == "slice":
        normal = np.array(p.get("normal", [0, 0, 1]), dtype=float)
        if normal.shape != (3,) or not np.all(np.isfinite(normal)) or np.linalg.norm(normal) < 1e-9:
            raise ValueError("Slice needs a nonzero normal.")
        return [mods.SliceModifier(normal=normal, distance=bounded(p, "distance", 0, -1e6, 1e6), inverse=bool(p.get("reverse", False)))]
    if kind == "expression":
        expression = str(p.get("expression", "")).strip()
        if not expression or len(expression) > 500: raise ValueError("Expression must contain 1–500 characters.")
        chain = [mods.ExpressionSelectionModifier(expression=expression)]
        if p.get("action") == "remove": chain.append(mods.DeleteSelectedModifier())
        return chain
    if kind == "wrap": return [mods.WrapPeriodicImagesModifier()]
    raise ValueError("Unsupported modifier: " + kind)

def clean(values):
    arr = np.asarray(values)
    if arr.ndim > 1: return [clean(row) for row in arr]
    return [float(x) if np.isfinite(x) else None for x in arr]

def imported_type_mass_origin(pipeline) -> str:
    # Use the importer actually chosen by OVITO, not a filename suffix. A .lmp
    # or extensionless LAMMPS data file can carry the same explicit Masses table.
    importer = type(pipeline.source.importer).__name__
    if importer == "LAMMPSDataImporter":
        return "source-explicit"
    # These readers assign elemental type defaults; explicit dump/XYZ mass
    # columns instead become a per-particle Mass property. Verify the weights
    # independently below before assigning their units. Unqualified readers
    # may carry type weights in a different or undocumented unit convention.
    return "element-database" if importer in {"LAMMPSTextDumpImporter", "XYZImporter", "CIFImporter", "POSCARImporter"} else "unknown"

def serialize(data, source: Frame | None = None, index=0, *, native_mass_origin="unknown"):
    particles = data.particles
    n = particles.count
    names = {t.id: t.name or str(t.id) for t in particles.particle_types.types} if "Particle Type" in particles else {}
    species = [names.get(int(t), str(t)) for t in particles.particle_types] if names else ["X"] * n
    identity = [str(int(x)) for x in particles["Particle Identifier"]] if "Particle Identifier" in particles else [str(i + 1) for i in range(n)]
    props = {}
    string_props = {}
    property_units = dict(source.propertyUnits or {}) if source else {}
    mass_origin = source.massProvenance if source else None
    # Native source type IDs distinguish isotope subtypes sharing an element.
    # Do not serialize a synthetic grouping created for an untyped input.
    if "Particle Type" in particles and (source is None or source_particle_types(source) is not None):
        props["Particle Type"] = clean(np.asarray(particles["Particle Type"]))
        native_masses = {item.id: float(item.mass) for item in particles.particle_types.types}
        if "Mass" not in particles and all(int(type_id) in native_masses and math.isfinite(native_masses[int(type_id)]) and native_masses[int(type_id)] > 0 for type_id in particles.particle_types):
            props["Mass"] = [native_masses[int(type_id)] for type_id in particles.particle_types]
            mass_origin = (source.massProvenance or "unknown") if source else native_mass_origin
            if source is None and mass_origin == "element-database":
                for item in particles.particle_types.types:
                    default = ParticleType(name=item.name)
                    default.load_defaults()
                    if not math.isfinite(default.mass) or default.mass <= 0 or float(default.mass) != native_masses[item.id]:
                        mass_origin = "unknown"
                        break
            if source is None and mass_origin == "element-database":
                # OVITO's element defaults are physical atomic weights even if
                # the dump uses nano units. Explicit .data Masses are different.
                property_units["mass"] = "amu"
    for name in particles.keys():
        if name in ("Position", "Particle Identifier", "Particle Type"): continue
        if particles[name].dtype.kind in {"T", "U", "S"}:
            string_props[name] = [str(particles[name][i]) for i in range(n)]
            continue
        values = np.asarray(particles[name])
        if values.ndim == 1: props[name] = clean(values)
        else:
            components = list(particles[name].component_names)
            if len(components) != values.shape[1] or any(not component for component in components) or len(set(components)) != len(components):
                components = [str(col) for col in range(values.shape[1])]
            for col in range(values.shape[1]):
                props[name + "." + components[col]] = clean(values[:, col])
            props[name + ".Magnitude"] = clean(np.linalg.norm(values, axis=1))
    if "Mass" in particles or "mass" in props:
        mass_origin = mass_origin or "source-explicit"
    has_cell = data.cell is not None and abs(np.linalg.det(np.array(data.cell.matrix)[:, :3])) > 1e-10
    if has_cell:
        matrix = np.array(data.cell.matrix)
        periodic = list(data.cell.pbc)
    else:
        positions = np.asarray(particles.positions)
        lower = positions.min(axis=0) - 3 if n else np.array([-3, -3, -3])
        lengths = np.maximum(positions.max(axis=0) - lower + 3, 6) if n else np.array([6, 6, 6])
        matrix = np.column_stack((np.diag(lengths), lower))
        periodic = [False, False, False]
    attrs = {str(k): float(v) if isinstance(v, (int, float, np.number)) and np.isfinite(v) else str(v) for k, v in data.attributes.items()}
    attrs["atoms"] = n
    attrs["cell volume"] = abs(float(np.linalg.det(matrix[:, :3])))
    if "Coordination" in props and n: attrs["mean coordination"] = float(np.mean(props["Coordination"]))
    bonds = np.asarray(particles.bonds.topology).tolist() if particles.bonds is not None else []
    attrs["bonds"] = len(bonds)
    phases = []
    if "Structure Type" in particles:
        prop = particles["Structure Type"]
        for t in prop.types:
            phases.append({"id": t.id, "name": t.name, "color": "#" + "".join(f"{round(c * 255):02x}" for c in t.color), "count": int(np.count_nonzero(np.asarray(prop) == t.id))})
    rdf = []
    for key, table in data.tables.items():
        if key.startswith("coordination-rdf"):
            rdf = clean(table.xy())
    dislocations = []
    if data.dislocations is not None:
        for segment in data.dislocations.segments:
            dislocations.append({"points": clean(segment.points), "burgers": clean(segment.true_burgers_vector), "length": float(segment.length), "color": "#58c594"})
        attrs["dislocation length"] = sum(line["length"] for line in dislocations)
        attrs["dislocation density"] = attrs["dislocation length"] / max(attrs["cell volume"], 1e-12)
    surface, warnings = None, []
    if rdf and not all(periodic):
        rdf = []
        warnings.append("Bulk g(r) normalization requires a fully periodic cell; coordination values remain available.")
    for mesh in data.surfaces.values():
        try:
            triangles = mesh.to_triangle_mesh()
            if isinstance(triangles, tuple): triangles = triangles[0]
            surface = {"vertices": clean(triangles.get_vertices()), "faces": np.asarray(triangles.get_faces()).tolist()}
        except Exception as exc:
            warnings.append("Surface metrics computed; mesh unavailable: " + str(exc))
        break
    frame = {"index": source.index if source else index, "timestep": source.timestep if source else attrs.get("Timestep"), "time": source.time if source else None, "ids": identity, "species": species, "positions": clean(np.asarray(particles.positions).flatten()), "properties": props, "vectors": matrix[:, :3].T.tolist(), "origin": matrix[:, 3].tolist(), "periodic": periodic, "hasCell": source.hasCell if source else bool(has_cell)}
    if string_props:
        frame["stringProperties"] = string_props
    frame.update({"sourceUnits": source.sourceUnits if source else None, "nativeTime": source.nativeTime if source else attrs.get("Time"), "coordinateMode": source.coordinateMode if source else None, "propertyUnits": property_units or None, "massProvenance": mass_origin})
    return {"frame": frame, "attributes": attrs, "phases": phases, "rdf": rdf, "bonds": bonds, "dislocations": dislocations, "surface": surface, "warnings": warnings, "engine": ENGINE_NAME}

@app.get("/api/health")
async def health():
    return {"ok": True, "engine": ENGINE_ID, "name": ENGINE_NAME, "version": app.version, "protocol": 1}

def analyze_request(request: AnalysisRequest, compute_context=None):
    """Run one validated analysis request.

    The local HTTP adapter and the dormant AWS Batch runner share this function,
    which keeps modifier behavior and serialized scientific output identical.
    """
    ids = request.frame.ids + (request.reference.ids if request.reference else [])
    identity = source_identity_map(ids)
    pipeline = Pipeline(source=StaticSource(data=data_from_frame(request.frame, identity)))
    count = len(request.frame.ids)
    for item in request.modifiers:
        if not item.enabled: continue
        if item.kind in {"supercell", "surface_slab"}:
            from .geometry import transform_frame
            current = serialize(pipeline.compute(), request.frame)["frame"]
            reverse = {str(v): k for k,v in identity.items()}
            current["ids"] = [reverse.get(v,"replica:"+v) for v in current["ids"]]
            changed = Frame(**transform_frame(current,item.kind,item.params))
            if len(changed.ids)>analysis_atom_limit(): raise ValueError("Geometry exceeds allocated analysis memory.")
            identity = source_identity_map(changed.ids)
            pipeline = Pipeline(source=StaticSource(data=data_from_frame(changed,identity)))
            request.frame = changed
            count = len(changed.ids)
            continue
        if item.kind == "replicate":
            count *= math.prod(item.params.get("repeat", [2, 2, 1]))
            if count > analysis_atom_limit(): raise ValueError("Replication exceeds the allocated analysis memory. Choose a larger RAM profile.")
        pipeline.modifiers.extend(build_modifier(item, request.reference, identity))
    with compute_context or nullcontext():
        collection = pipeline.compute()
    result = serialize(collection, request.frame)
    # Preserve caller identities; generated replicas retain unique engine identities.
    reverse = {str(v): k for k, v in identity.items()}
    result["frame"]["ids"] = [reverse.get(v, "replica:" + v) for v in result["frame"]["ids"]]
    result["frame"]["geometryProvenance"] = request.frame.geometryProvenance
    return result


@app.post("/api/analyze")
async def analyze(request: AnalysisRequest):
    try:
        return analyze_request(request)
    except Exception as exc:
        raise HTTPException(422, str(exc)) from exc

LENGTH_TO_ANGSTROM = {"metal": 1.0, "real": 1.0, "nano": 10.0, "micro": 10_000.0, "electron": 0.529177210903, "si": 1e10, "cgs": 1e8}
TIME_TO_PS = {"metal": 1.0, "real": 1e-3, "nano": 1e3, "micro": 1e6, "electron": 1e-3, "si": 1e12, "cgs": 1e12}


def dump_frame_metadata(payload: bytes) -> list[dict[str, Any]]:
    if payload.startswith(b"\x1f\x8b"):
        with gzip.open(io.BytesIO(payload), "rt", encoding="utf-8", errors="replace") as source:
            return dump_metadata_lines(source)
    text = payload.decode("utf-8", errors="replace")
    if "ITEM: TIMESTEP" not in text:
        return []
    return dump_metadata_lines(text.splitlines())


def dump_metadata_lines(source_lines: Iterable[str]) -> list[dict[str, Any]]:
    """Stream metadata without loading a potentially large source file."""
    units: str | None = None
    native_time: float | None = None
    result: list[dict[str, Any]] = []
    lines = iter(source_lines)
    for line in lines:
        if line.startswith("ITEM: UNITS"):
            units = line[len("ITEM: UNITS"):].strip() or next(lines, "").strip()
            if units not in LENGTH_TO_ANGSTROM:
                raise ValueError(f"LAMMPS units {units!r} cannot be converted to physical angstrom/ps units")
        elif line.strip() == "ITEM: TIME":
            native_time = float(next(lines, "nan"))
            if not math.isfinite(native_time):
                raise ValueError("LAMMPS TIME must be finite")
        elif line.startswith("ITEM: ATOMS"):
            columns = line.split()[2:]
            mode = "wrapped" if all(name in columns for name in ("x", "y", "z")) or all(name in columns for name in ("xs", "ys", "zs")) else "unwrapped" if "xu" in columns or "xsu" in columns else None
            result.append({"sourceUnits": units, "nativeTime": native_time, "coordinateMode": mode})
            native_time = None
    return result


def normalize_imported_frame(frame: dict[str, Any], metadata: dict[str, Any]) -> dict[str, Any]:
    units = metadata["sourceUnits"]
    scale = LENGTH_TO_ANGSTROM.get(units, 1.0)
    frame["positions"] = [value * scale for value in frame["positions"]]
    frame["vectors"] = [[value * scale for value in vector] for vector in frame["vectors"]]
    frame["origin"] = [value * scale for value in frame["origin"]]
    frame.update(metadata)
    frame["time"] = metadata["nativeTime"] * TIME_TO_PS[units] if units and metadata["nativeTime"] is not None else None
    # Velocity and Mass properties retain native source units. The immutable
    # simulation snapshot normalizes these once using the explicit sourceUnits.
    return frame


@app.post("/api/import")
async def import_trajectory(file: UploadFile = File(...)):
    payload = await file.read(64 * 1024 * 1024 + 1)
    if len(payload) > 64 * 1024 * 1024: raise HTTPException(413, "Import limit is 64 MB.")
    with tempfile.TemporaryDirectory(prefix="phynite-md-") as folder:
        path = Path(folder) / Path(file.filename or "trajectory.dump").name
        path.write_bytes(payload)
        try:
            metadata = dump_frame_metadata(payload)
            pipeline = import_file(str(path))
            mass_origin = imported_type_mass_origin(pipeline)
            frames, total = [], 0
            for index in range(max(1, pipeline.source.num_frames)):
                data = pipeline.compute(index)
                total += data.particles.count * 3
                if data.particles.count > 100_000 or total > 12_000_000: raise ValueError("Trajectory exceeds the browser memory limit; split the file.")
                frame = serialize(data, index=index, native_mass_origin=mass_origin)["frame"]
                if metadata:
                    frame = normalize_imported_frame(frame, metadata[index])
                frames.append(frame)
            warnings = ["LAMMPS units are undeclared; geometry assumes angstrom and physical time remains unknown."] if metadata and metadata[0]["sourceUnits"] is None else []
            if mass_origin == "source-explicit" and any("Mass" in frame["properties"] for frame in frames):
                warnings.append("LAMMPS data files do not declare physical units. The exact imported masses are retained without an amu label. Before simulation, export a dump including the mass column and use dump_modify units yes in the original solver unit style.")
            return {"frames": frames, "warnings": warnings, "index": {"format": "structure", "name": file.filename, "offsets": list(range(len(frames))), "warnings": []}}
        except Exception as exc:
            raise HTTPException(422, str(exc)) from exc

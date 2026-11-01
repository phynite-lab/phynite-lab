import { validateCell, type CellVector, type CellVectors } from './crystal-cell.ts';
import type { MdFrame, MdModifier, MdSettings } from './md-types.ts';

export type MdRunSnapshot = {
  schemaVersion: 1;
  kind: 'phynite-md-frame';
  units: { length: 'angstrom'; time: 'ps' };
  frame: MdFrame;
  provenance: {
    sourceTrajectoryId: string;
    sourceSha256: string;
    sourceFrame: number;
    sourceUnits: string | null;
    modifiers: MdModifier[];
    typeMap: Record<string, string>;
    omittedProperties: string[];
    imageHistory: 'reset-for-displayed-frame' | 'preserved-wrapped-source';
    mass?: { origin: MdFrame['massProvenance'] | 'unspecified'; inputUnits: string | null; normalizedUnits: 'amu' };
  };
};

export function readMdRunSnapshot(text: string, maximumAtoms = 100000): MdRunSnapshot {
  if (!Number.isSafeInteger(maximumAtoms) || maximumAtoms < 1 || maximumAtoms > 1000000) throw new Error('MD snapshot atom limit must be an explicit runtime grant up to 1,000,000 particles.');
  const snapshot = JSON.parse(text) as MdRunSnapshot;
  if (snapshot.schemaVersion !== 1 || snapshot.kind !== 'phynite-md-frame' || snapshot.units?.length !== 'angstrom' || snapshot.units?.time !== 'ps') throw new Error('Unsupported MD frame snapshot units or version.');
  const f = snapshot.frame;
  if (!f || !Array.isArray(f.ids) || f.ids.length < 1 || f.ids.length > maximumAtoms || new Set(f.ids).size !== f.ids.length || f.ids.some(id => typeof id !== 'string' || !id.length || id.length > 160)) throw new Error(`MD snapshot requires unique particle IDs within the ${maximumAtoms.toLocaleString()}-atom runtime grant.`);
  if (!Array.isArray(f.species) || f.species.length !== f.ids.length || f.species.some(s => typeof s !== 'string' || !/^(?:[A-Z][a-z]?|Generic)$/.test(s))) throw new Error('Map snapshot species to valid elements before running.');
  if (!Array.isArray(f.positions) || f.positions.length !== f.ids.length * 3 || !f.positions.every(Number.isFinite)) throw new Error('MD snapshot positions must be finite.');
  if (!Array.isArray(f.origin) || f.origin.length !== 3 || !f.origin.every(Number.isFinite) || !Array.isArray(f.periodic) || f.periodic.length !== 3 || f.periodic.some(v => typeof v !== 'boolean') || f.hasCell !== true) throw new Error('MD snapshot requires a cell, origin and explicit periodicity.');
  validateCell(f.vectors as CellVectors);
  if ((f.time !== null && (!Number.isFinite(f.time) || f.time < 0)) || (f.timestep !== null && (!Number.isSafeInteger(f.timestep) || f.timestep < 0)) || !Number.isSafeInteger(f.index) || f.index < 0) throw new Error('MD snapshot clock is invalid.');
  if (!f.properties || typeof f.properties !== 'object' || Object.entries(f.properties).some(([key, values]) => !key || !Array.isArray(values) || values.length !== f.ids.length || !values.every(Number.isFinite))) throw new Error('MD snapshot particle properties are invalid.');
  if (f.stringProperties !== undefined && (!f.stringProperties || typeof f.stringProperties !== 'object' || Array.isArray(f.stringProperties) || Object.entries(f.stringProperties).some(([key, values]) => !key || !Array.isArray(values) || values.length !== f.ids.length || values.some(value => typeof value !== 'string')))) throw new Error('MD snapshot string particle properties are invalid.');
  return snapshot;
}

/** Capture the processed frame before any asynchronous upload or subsequent UI edit. */
export function createMdRunSnapshot(frame: MdFrame, settings: MdSettings, source: { trajectoryId: string; sha256: string }, maximumAtoms = 100000): MdRunSnapshot {
  const properties: Record<string, number[]> = {};
  const omittedProperties: string[] = [];
  for (const [key, values] of Object.entries(frame.properties)) {
    if (values.length === frame.ids.length && values.every(Number.isFinite)) properties[key] = [...values];
    else omittedProperties.push(key);
  }
  const resetImages = frame.coordinateMode === 'unwrapped' || settings.modifiers.some(modifier => modifier.enabled && ['wrap', 'replicate', 'supercell', 'surface_slab'].includes(modifier.kind));
  if (resetImages) for (const key of ['ix', 'iy', 'iz', 'Periodic Image.X', 'Periodic Image.Y', 'Periodic Image.Z']) if (key in properties) {
    // Displayed Cartesian positions are authoritative for the new run. Image
    // history copied through a changed basis or an already unwrapped position
    // would add a second cell translation in LAMMPS.
    delete properties[key]; omittedProperties.push(key);
  }
  // Imported velocities retain native units, unlike geometry. Normalize the
  // only properties consumed as initial state by the atomic solver.
  const velocityFactor: Record<string, number> = { metal: 1, real: 1000, nano: .01, micro: .01, si: .01, cgs: .0001, electron: .529177210903 / .00103275 };
  for (const key of ['vx', 'vy', 'vz', 'Velocity.X', 'Velocity.Y', 'Velocity.Z']) if (properties[key] && frame.propertyUnits?.velocity !== 'angstrom/ps') {
    if (!frame.sourceUnits || !(frame.sourceUnits in velocityFactor)) throw new Error('Initial velocity units are unknown. Export velocities using physical LAMMPS units.');
    properties[key] = properties[key].map(value => value * velocityFactor[frame.sourceUnits!]);
  }
  const massFactor: Record<string, number> = { metal: 1, real: 1, electron: 1, si: 6.02214076e26, cgs: 6.02214076e23, micro: 6.02214076e11, nano: 6.02214076e5 };
  for (const key of ['mass', 'Mass']) if (properties[key] && frame.propertyUnits?.mass !== 'amu') {
    if (!frame.sourceUnits || !(frame.sourceUnits in massFactor)) throw new Error('Initial mass units are unknown. Declare physical LAMMPS units.');
    properties[key] = properties[key].map(value => value * massFactor[frame.sourceUnits!]);
  }
  const snapshot: MdRunSnapshot = {
    schemaVersion: 1, kind: 'phynite-md-frame', units: { length: 'angstrom', time: 'ps' },
    frame: { ...frame, ids: [...frame.ids], species: [...frame.species], positions: [...frame.positions], properties, ...(frame.stringProperties ? { stringProperties: structuredClone(frame.stringProperties) } : {}), vectors: frame.vectors.map(v => [...v]) as CellVectors, origin: [...frame.origin] as CellVector, periodic: [...frame.periodic], propertyUnits: { velocity: 'angstrom/ps', mass: 'amu' } },
    provenance: { sourceTrajectoryId: source.trajectoryId, sourceSha256: source.sha256, sourceFrame: frame.index, sourceUnits: frame.sourceUnits ?? null, modifiers: structuredClone(settings.modifiers), typeMap: { ...settings.typeMap }, omittedProperties, imageHistory: resetImages ? 'reset-for-displayed-frame' : 'preserved-wrapped-source', ...((properties.Mass || properties.mass) ? { mass: { origin: frame.massProvenance ?? 'unspecified', inputUnits: frame.propertyUnits?.mass ?? frame.sourceUnits ?? null, normalizedUnits: 'amu' } } : {}) },
  };
  return readMdRunSnapshot(JSON.stringify(snapshot), maximumAtoms);
}

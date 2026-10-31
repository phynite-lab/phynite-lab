import type { JobDraft, MaterialContext } from '../components/JobComposer.tsx';
import { cartesianToFractionalWithVectors, fractionalVectorToCartesian, validateCell, type CellVectors, type CellVector } from './crystal-cell.ts';
import { orderedStructureIssue } from './structure-occupancy.ts';
import { atomicMass } from './qe-atomic-masses.ts';

export const BOHR_TO_ANGSTROM = 0.529177210903;

export function qeAlat(draft: Pick<JobDraft, 'cellParameterAlat'>, material: MaterialContext) {
  const value = draft.cellParameterAlat ?? (material ? Math.hypot(...material.cellVectors[0]) : Number.NaN);
  if (!Number.isFinite(value) || value <= 0) throw new Error('alat requires a finite positive reference lattice constant in Å.');
  return value;
}

export function qeCellInAngstrom(draft: JobDraft, material: MaterialContext, validate = true): CellVectors {
  if (!material) throw new Error('Select a crystal structure before generating input.');
  // Project geometry is already canonical. Card units apply only to stored overrides.
  const unit = draft.cellParameters ? draft.cellParameterUnit ?? 'angstrom' : 'angstrom';
  if (!['angstrom', 'bohr', 'alat'].includes(unit)) throw new Error(`Unsupported cell unit "${unit}".`);
  const factor = unit === 'bohr' ? BOHR_TO_ANGSTROM : unit === 'alat' ? qeAlat(draft, material) : 1;
  const source = draft.cellParameters ?? material.cellVectors;
  if (source.length !== 3) throw new Error('CELL_PARAMETERS requires exactly three vectors.');
  const vectors = source.map((vector) => vector.map((value) => value * factor)) as CellVectors;
  return validate ? validateCell(vectors) : vectors;
}

export function convertQePosition(position: CellVector, from: JobDraft['atomicPositionUnit'], to: JobDraft['atomicPositionUnit'], cell: CellVectors, alat: number): CellVector {
  if (from === 'crystal_sg' || to === 'crystal_sg') throw new Error('crystal_sg requires symmetry expansion, which the structure-card editor does not support. Use explicit crystal coordinates or expert input.');
  const cartesian = !from || from === 'crystal' ? fractionalVectorToCartesian(position, cell)
    : position.map((value) => value * (from === 'bohr' ? BOHR_TO_ANGSTROM : from === 'alat' ? alat : 1)) as CellVector;
  return !to || to === 'crystal' ? cartesianToFractionalWithVectors(cartesian, cell)
    : cartesian.map((value) => value / (to === 'bohr' ? BOHR_TO_ANGSTROM : to === 'alat' ? alat : 1)) as CellVector;
}

export function resolveQeStructure(draft: JobDraft, material: MaterialContext): NonNullable<MaterialContext> {
  if (!material) throw new Error('Select a crystal structure before generating input.');
  const cellVectors = qeCellInAngstrom(draft, material);
  const unit = draft.atomicPositions ? draft.atomicPositionUnit ?? 'crystal' : 'crystal';
  if (!['crystal', 'angstrom', 'bohr', 'alat'].includes(unit)) throw new Error(`Atomic coordinate unit "${unit}" is unsupported by the structure-card editor. Use explicit crystal coordinates or expert input.`);
  const alat = unit === 'alat' ? qeAlat(draft, material) : 1;
  const atoms = (draft.atomicPositions ?? material.atoms).map((atom, index) => {
    if (![atom.x, atom.y, atom.z].every(Number.isFinite)) throw new Error(`Atom ${index + 1} coordinates must be finite.`);
    const label = atom.label?.trim() || atom.species;
    if (!/^[A-Za-z][A-Za-z0-9_]{0,2}$/.test(label)) throw new Error(`QE species label "${label}" must use 1–3 letters, digits or underscores. Use labels such as Fe1 and Fe2 for distinct sublattices.`);
    if (!label.startsWith(atom.species) || /[a-z]/.test(label.slice(atom.species.length, atom.species.length + 1))) throw new Error(`QE label ${label} must identify element ${atom.species}; use ${atom.species} or a sublattice suffix.`);
    atomicMass(atom.species, draft.atomicMassOverrides?.[label]);
    const [x, y, z] = convertQePosition([atom.x, atom.y, atom.z], unit, 'crystal', cellVectors, alat);
    return { ...atom, id: atom.id ?? `atom-${index + 1}`, label, x, y, z };
  });
  if (!atoms.length) throw new Error('ATOMIC_POSITIONS requires at least one atom.');
  if (new Set(atoms.map(atom => atom.id)).size !== atoms.length) throw new Error('Structure cards contain duplicate atom identifiers. Give each atom a unique identity before submitting.');
  const labels = new Map<string, string>();
  for (const atom of atoms) {
    if (labels.has(atom.label) && labels.get(atom.label) !== atom.species) throw new Error(`QE species label ${atom.label} maps to multiple elements. Assign a distinct label to each species.`);
    labels.set(atom.label, atom.species);
  }
  const issue = orderedStructureIssue(atoms);
  if (issue) throw new Error(issue);
  if (material.periodic?.some((value) => !value) && draft.assumeIsolated === 'none') throw new Error('This structure has nonperiodic boundaries. Select an appropriate isolation treatment and vacuum cell, or use expert input to define the physical boundary model.');
  return { ...material, atoms, cellVectors, atomCount: atoms.length, species: Array.from(new Set(atoms.map((atom) => atom.species))), electronicReference: draft.atomicPositions || draft.cellParameters ? undefined : material.electronicReference };
}

export function qeStructureProvenance(draft: JobDraft, material: MaterialContext) {
  const resolved = resolveQeStructure(draft, material);
  return {
    version: 1,
    source: draft.cellParameters || draft.atomicPositions ? 'calculation-structure-cards' : 'project-structure',
    cellUnit: 'angstrom', positionUnit: 'crystal', massUnit: 'u',
    sourcePeriodic: material?.periodic ?? [true, true, true],
    solverPeriodic: [true, true, true], isolationTreatment: draft.assumeIsolated,
    cellVectors: resolved.cellVectors,
    atoms: resolved.atoms.map((atom, index) => ({ id: 'id' in atom ? atom.id : `atom-${index + 1}`, label: atom.label, species: atom.species, x: atom.x, y: atom.y, z: atom.z, mass: atomicMass(atom.species, draft.atomicMassOverrides?.[atom.label!]) })),
    massSource: 'CIAAW/IUPAC conventional atomic weights; explicit overrides specify isotope masses',
  };
}

import { applyCrystalModifier, MAX_BUILDER_ATOMS, type CrystalModifier } from './crystal-builder.ts';
import { cellVectorsFromLattice, latticeFromCellVectors, type CellVectors, type LatticeParameters } from './crystal-cell.ts';
import { applyWorkflowGeometry, type GeometryOperation } from './workflow-geometry.ts';
import { structureFormula } from './structure-formula.ts';
import type { CustomAtom } from '../components/CrystalViewer.tsx';

type Source = { atoms: CustomAtom[]; lattice: LatticeParameters; periodic?: [boolean, boolean, boolean]; geometryProvenance?: unknown[] };
const fields: Record<CrystalModifier['kind'], string[]> = { replicate: ['repeat'], vacuum: ['thickness'], translate: ['offset', 'space'], wrap: [], slice: ['normal', 'distance', 'reverse'], filter: ['expression', 'keep'] };
function geometry(atoms: CustomAtom[], lattice: LatticeParameters) {
  if (!Array.isArray(atoms) || !atoms.length || atoms.length > MAX_BUILDER_ATOMS) throw new Error(`Structures must contain 1–${MAX_BUILDER_ATOMS} atoms at every modifier step.`);
  if (atoms.some(atom => !atom || typeof atom.species !== 'string' || ![atom.x, atom.y, atom.z].every(Number.isFinite))) throw new Error('Preserve finite fractional coordinates and explicit species.');
  if (!lattice || ![lattice.a, lattice.b, lattice.c].every(value => Number.isFinite(value) && value > 0) || ![lattice.alpha, lattice.beta, lattice.gamma].every(value => Number.isFinite(value) && value > 0 && value < 180)
    || !Array.isArray(lattice.periodic) || lattice.periodic.length !== 3 || lattice.periodic.some(value => typeof value !== 'boolean')) throw new Error('A physical lattice and three explicit periodic axes are required.');
  const vectors = cellVectorsFromLattice(lattice);
  const [a, b, c] = vectors;
  const volume = a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  if (!vectors.flat().every(Number.isFinite) || !(Math.abs(volume) > 1e-10)) throw new Error('The structure cell must be nonsingular.');
}

/** Runs unchanged in the server's bounded QuickJS compiler; accepts data only. */
export function modifyAiStructure(source: Source, modifiers: unknown) {
  let result: { atoms: CustomAtom[]; lattice: LatticeParameters } = { atoms: structuredClone(source.atoms), lattice: { ...source.lattice, periodic: source.periodic ?? source.lattice?.periodic } };
  geometry(result.atoms, result.lattice);
  let evidence: unknown;
  if (Array.isArray(modifiers)) {
    if (!modifiers.length || modifiers.length > 12) throw new Error('Choose 1–12 Crystal Builder modifiers.');
    const ids = new Set<string>();
    for (const value of modifiers) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('A modifier must be an object.');
      const modifier = value as CrystalModifier;
      const allowed = Object.prototype.hasOwnProperty.call(fields, modifier.kind) ? ['id', 'enabled', 'kind', ...fields[modifier.kind]] : [];
      if (!allowed.length || Object.keys(modifier).some(key => !allowed.includes(key)) || allowed.some(key => !(key in modifier)) || typeof modifier.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(modifier.id) || ids.has(modifier.id) || typeof modifier.enabled !== 'boolean') throw new Error('Choose unique modifier IDs and the exact supported fields.');
      ids.add(modifier.id);
      if (modifier.kind === 'translate' && !['cartesian', 'fractional'].includes(modifier.space) || modifier.kind === 'slice' && typeof modifier.reverse !== 'boolean' || modifier.kind === 'filter' && (typeof modifier.keep !== 'boolean' || typeof modifier.expression !== 'string')) throw new Error('Modifier units and selection flags must be explicit.');
      result = applyCrystalModifier(result.atoms, result.lattice, modifier);
      geometry(result.atoms, result.lattice);
    }
    evidence = { kind: 'crystal_modifiers', modifiers };
  } else {
    if (!modifiers || typeof modifiers !== 'object' || !['supercell', 'surface_slab'].includes((modifiers as GeometryOperation).kind)) throw new Error('Choose Crystal Builder modifiers, supercell or surface_slab.');
    const allowed = (modifiers as GeometryOperation).kind === 'supercell' ? ['kind', 'matrix'] : ['kind', 'miller', 'layers', 'vacuumAngstrom', 'termination'];
    if (Object.keys(modifiers).some(key => !allowed.includes(key)) || allowed.some(key => !(key in modifiers))) throw new Error('Geometry operations accept only their exact supported fields.');
    const output = applyWorkflowGeometry({ atoms: result.atoms, cellVectors: cellVectorsFromLattice(result.lattice), periodic: result.lattice.periodic }, modifiers as GeometryOperation);
    result = { atoms: output.atoms, lattice: { ...latticeFromCellVectors(output.cellVectors as CellVectors), periodic: output.periodic } };
    geometry(result.atoms, result.lattice);
    evidence = { ...output.provenance, mapping: output.mapping };
  }
  const formula = structureFormula(result.atoms);
  if (!formula) throw new Error('The modified structure has no valid composition.');
  return { ...result, periodic: result.lattice.periodic, formula, source: 'Local', spaceGroup: 'P1', kind: 'Geometry output',
    geometryProvenance: [...(source.geometryProvenance ?? []), evidence] };
}

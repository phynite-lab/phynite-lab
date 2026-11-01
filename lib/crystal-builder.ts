import type { CustomAtom } from '@/components/CrystalViewer';
import {
  addCellVacuum, cartesianToFractionalWithVectors, cellVectorsFromLattice,
  fractionalVectorToCartesian, latticeFromCellVectors, type CellVector, type CellVectors, type LatticeParameters,
} from './crystal-cell.ts';

export const MAX_BUILDER_ATOMS = 1600;
export type CrystalModifier = { id: string; enabled: boolean } & (
  | { kind: 'replicate'; repeat: CellVector }
  | { kind: 'vacuum'; thickness: number }
  | { kind: 'translate'; offset: CellVector; space: 'cartesian' | 'fractional' }
  | { kind: 'wrap' }
  | { kind: 'slice'; normal: CellVector; distance: number; reverse: boolean }
  | { kind: 'filter'; expression: string; keep: boolean }
);
export type ModifierKind = CrystalModifier['kind'];
export const modifierLabels: Record<ModifierKind, string> = {
  replicate: 'Supercell', vacuum: 'Add vacuum', translate: 'Translate atoms',
  wrap: 'Wrap into cell', slice: 'Slice plane', filter: 'Filter atoms',
};
export function newCrystalModifier(kind: ModifierKind, id: string): CrystalModifier {
  const base = { id, enabled: true };
  switch (kind) {
    case 'replicate': return { ...base, kind, repeat: [2, 2, 1] };
    case 'vacuum': return { ...base, kind, thickness: 15 };
    case 'translate': return { ...base, kind, offset: [0, 0, 0], space: 'cartesian' };
    case 'wrap': return { ...base, kind };
    case 'slice': return { ...base, kind, normal: [0, 0, 1], distance: 0, reverse: false };
    case 'filter': return { ...base, kind, expression: 'Position.Z >= 0', keep: true };
  }
}

const wrap = (n: number) => ((n % 1) + 1) % 1;
const point = (atom: CustomAtom): CellVector => [atom.x, atom.y, atom.z];
const finiteVector = (vector: CellVector) => vector.length === 3 && vector.every(Number.isFinite);

/** Deliberately bounded comparison language; never evaluates JavaScript. AND binds before OR. */
export function compileAtomFilter(expression: string, lattice: LatticeParameters): (atom: CustomAtom) => boolean {
  if (!expression.trim() || expression.length > 500) throw new Error('Enter a filter of 1–500 characters.');
  const vectors = cellVectorsFromLattice(lattice);
  const groups = expression.split('||').map((group) => group.split('&&').map((part) => {
    const match = part.trim().match(/^(Species|Position\.[XYZ]|Fractional\.[XYZ])\s*(===|!==|==|!=|>=|<=|>|<)\s*(.+)$/);
    if (!match) throw new Error('Use Species, Position.X/Y/Z, or Fractional.X/Y/Z with a comparison. Combine with && or ||.');
    const [, property, op, raw] = match;
    if (property === 'Species') {
      const symbol = raw.match(/^(?:"([A-Z][a-z]?)"|'([A-Z][a-z]?)'|([A-Z][a-z]?))$/);
      if (!symbol || !['==', '!=', '===', '!=='].includes(op)) throw new Error('Compare Species with an element, for example Species == "Si".');
      const species = symbol[1] ?? symbol[2] ?? symbol[3];
      return (atom: CustomAtom) => op.startsWith('!') ? atom.species !== species : atom.species === species;
    }
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw) || !Number.isFinite(Number(raw))) throw new Error('Coordinate comparisons need a finite number, for example Position.Z >= 2.5.');
    const threshold = Number(raw);
    const axis = 'XYZ'.indexOf(property.slice(-1));
    return (atom: CustomAtom) => {
      const value = property.startsWith('Position') ? fractionalVectorToCartesian(point(atom), vectors)[axis] : point(atom)[axis];
      switch (op) {
        case '>': return value > threshold;
        case '<': return value < threshold;
        case '>=': return value >= threshold;
        case '<=': return value <= threshold;
        case '!=': case '!==': return value !== threshold;
        default: return value === threshold;
      }
    };
  }));
  return (atom) => groups.some((group) => group.every((compare) => compare(atom)));
}

export function applyCrystalModifier(atoms: CustomAtom[], lattice: LatticeParameters, modifier: CrystalModifier) {
  if (!modifier.enabled) return { atoms, lattice };
  const vectors = cellVectorsFromLattice(lattice);
  switch (modifier.kind) {
    case 'replicate': {
      const repeat = modifier.repeat;
      if (!finiteVector(repeat) || repeat.some((n) => !Number.isInteger(n) || n < 1 || n > 8)) throw new Error('Supercell repeats must be whole numbers from 1 to 8.');
      const count = atoms.length * repeat[0] * repeat[1] * repeat[2];
      if (count > MAX_BUILDER_ATOMS) throw new Error(`This supercell would contain ${count.toLocaleString()} atoms. Use at most ${MAX_BUILDER_ATOMS.toLocaleString()}.`);
      const nextVectors = vectors.map((vector, axis) => vector.map((n) => n * repeat[axis])) as CellVectors;
      const nextAtoms: CustomAtom[] = [];
      for (let a = 0; a < repeat[0]; a++) for (let b = 0; b < repeat[1]; b++) for (let c = 0; c < repeat[2]; c++) {
        atoms.forEach((atom, index) => {
          // Canonicalize periodic sites once so boundary sites are not duplicated by display images.
          const coordinates = point(atom).map((n, axis) => lattice.periodic?.[axis] === false ? n : wrap(n));
          nextAtoms.push({ ...atom, id: `${modifier.id}:${index}:${a},${b},${c}`, x: (coordinates[0] + a) / repeat[0], y: (coordinates[1] + b) / repeat[1], z: (coordinates[2] + c) / repeat[2] });
        });
      }
      return { atoms: nextAtoms, lattice: { ...latticeFromCellVectors(nextVectors), periodic: lattice.periodic } };
    }
    case 'vacuum': return addCellVacuum(atoms, lattice, modifier.thickness);
    case 'translate': {
      if (!finiteVector(modifier.offset)) throw new Error('Translation needs three finite coordinates.');
      const offset = modifier.space === 'cartesian' ? cartesianToFractionalWithVectors(modifier.offset, vectors) : modifier.offset;
      return { atoms: atoms.map((atom) => ({ ...atom, x: atom.x + offset[0], y: atom.y + offset[1], z: atom.z + offset[2] })), lattice };
    }
    case 'wrap': return { atoms: atoms.map((atom) => {
      const [x, y, z] = point(atom).map((n, axis) => lattice.periodic?.[axis] === false ? n : wrap(n));
      return { ...atom, x, y, z };
    }), lattice };
    case 'slice': {
      if (!finiteVector(modifier.normal) || Math.hypot(...modifier.normal) < 1e-10 || !Number.isFinite(modifier.distance)) throw new Error('Slice needs a nonzero normal and a finite distance.');
      const normal = modifier.normal.map((n) => n / Math.hypot(...modifier.normal));
      return { atoms: atoms.filter((atom) => {
        const position = fractionalVectorToCartesian(point(atom), vectors);
        const distance = position.reduce((sum, n, axis) => sum + n * normal[axis], 0) - modifier.distance;
        return modifier.reverse ? distance <= 1e-9 : distance >= -1e-9;
      }), lattice };
    }
    case 'filter': {
      const matches = compileAtomFilter(modifier.expression, lattice);
      return { atoms: atoms.filter((atom) => matches(atom) === modifier.keep), lattice };
    }
  }
}

export function previewCrystalModifiers(atoms: CustomAtom[], lattice: LatticeParameters, modifiers: CrystalModifier[]) {
  let result = { atoms, lattice };
  const steps: { id: string; count: number }[] = [];
  for (const modifier of modifiers) {
    try {
      result = applyCrystalModifier(result.atoms, result.lattice, modifier);
      if (result.atoms.some((atom) => !finiteVector(point(atom)))) throw new Error('This operation produces nonfinite coordinates. Reduce its values.');
      steps.push({ id: modifier.id, count: result.atoms.length });
    } catch (error) {
      // A failed stack never presents a partially transformed structure as its final result.
      return { atoms, lattice, steps, error: `${modifierLabels[modifier.kind]}: ${error instanceof Error ? error.message : 'Invalid settings'}`, errorId: modifier.id };
    }
  }
  // Imported forces do not describe newly edited geometry.
  if (modifiers.some((modifier) => modifier.enabled)) result = { ...result, atoms: result.atoms.map((atom) => ({ ...atom, fx: undefined, fy: undefined, fz: undefined })) };
  return { ...result, steps, error: null, errorId: null };
}

export type CrystalColorProperty = 'element' | 'x' | 'y' | 'z' | 'force';
export type CrystalColorMap = 'viridis' | 'coolwarm';
export const colorMapStops: Record<CrystalColorMap, string[]> = {
  viridis: ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'],
  coolwarm: ['#3b4cc0', '#8db0fe', '#dddddd', '#f4987a', '#b40426'],
};
export function crystalScalarColors(atoms: CustomAtom[], lattice: LatticeParameters, property: CrystalColorProperty, palette: CrystalColorMap) {
  const colors = new Map<string, string>();
  if (property === 'element') return { colors, min: null, max: null, missing: 0 };
  const vectors = cellVectorsFromLattice(lattice);
  const values = atoms.map((atom) => property === 'force'
    ? [atom.fx, atom.fy, atom.fz].every((n) => typeof n === 'number' && Number.isFinite(n)) ? Math.hypot(atom.fx!, atom.fy!, atom.fz!) : null
    : fractionalVectorToCartesian(point(atom), vectors)['xyz'.indexOf(property)]);
  const valid = values.filter((n): n is number => n !== null && Number.isFinite(n));
  if (!valid.length) return { colors, min: null, max: null, missing: atoms.length };
  const min = valid.reduce((a, b) => Math.min(a, b), Infinity);
  const max = valid.reduce((a, b) => Math.max(a, b), -Infinity);
  const stops = colorMapStops[palette];
  values.forEach((value, index) => {
    if (value === null || !Number.isFinite(value)) return;
    const t = max === min ? 0.5 : Math.max(0, Math.min(1, (value - min) / (max - min)));
    const lower = Math.min(stops.length - 2, Math.floor(t * (stops.length - 1)));
    const blend = t * (stops.length - 1) - lower;
    const rgb = [1, 3, 5].map((offset) => {
      const a = parseInt(stops[lower].slice(offset, offset + 2), 16);
      const b = parseInt(stops[lower + 1].slice(offset, offset + 2), 16);
      return Math.round(a + (b - a) * blend).toString(16).padStart(2, '0');
    });
    colors.set(atoms[index].id, `#${rgb.join('')}`);
  });
  return { colors, min, max, missing: atoms.length - valid.length };
}

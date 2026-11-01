import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCrystalModifier, compileAtomFilter, crystalScalarColors, newCrystalModifier, previewCrystalModifiers, type CrystalModifier } from '../lib/crystal-builder.ts';
import { cellVolume, cellVectorsFromLattice, fractionalVectorToCartesian, latticeFromCellVectors, type LatticeParameters } from '../lib/crystal-cell.ts';
import { createXYZ, parseStructureText } from '../lib/structure-parsers.ts';

const lattice: LatticeParameters = { ...latticeFromCellVectors([[0, 3, 0], [-4, 1, 0], [1, 2, 8]]), periodic: [true, true, false] };
const atoms = [
  { id: 'si', species: 'Si', x: 0.2, y: 0.3, z: 0.4, fx: 3, fy: 4, fz: 0 },
  { id: 'o', species: 'O', x: 0.7, y: 0.8, z: 0.9, fx: 0, fy: 0, fz: 0 },
];
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const position = (atom: typeof atoms[number], cell = lattice) => fractionalVectorToCartesian([atom.x, atom.y, atom.z], cellVectorsFromLattice(cell));
const modifier = (kind: CrystalModifier['kind']) => newCrystalModifier(kind, `test-${kind}`);

test('real supercells scale oriented vectors, preserve distances, and round-trip all atoms through export', () => {
  const result = applyCrystalModifier(atoms, lattice, { id: 'r', enabled: true, kind: 'replicate', repeat: [2, 3, 1] });
  assert.equal(result.atoms.length, 12);
  assert.equal(new Set(result.atoms.map((atom) => atom.id)).size, 12);
  assert.deepEqual(result.lattice.periodic, [true, true, false]);
  const vectors = cellVectorsFromLattice(lattice);
  close(Math.abs(cellVolume(cellVectorsFromLattice(result.lattice))), 6 * Math.abs(cellVolume(vectors)));
  const first = result.atoms[0];
  fractionalVectorToCartesian([first.x, first.y, first.z], cellVectorsFromLattice(result.lattice)).forEach((value, axis) => close(value, position(atoms[0])[axis]));
  const translated = result.atoms[2]; // second b image
  fractionalVectorToCartesian([translated.x, translated.y, translated.z], cellVectorsFromLattice(result.lattice)).forEach((value, axis) => close(value, position(atoms[0])[axis] + vectors[1][axis]));
  assert.equal(parseStructureText(createXYZ('supercell', result.atoms, result.lattice), 'supercell.xyz').atoms.length, 12);
});

test('supercell repeats reject invalid sizes before allocating and preserve finite-axis offsets', () => {
  for (const repeat of [[0, 1, 1], [1.5, 1, 1], [NaN, 1, 1], [9, 1, 1]]) assert.throws(() => applyCrystalModifier(atoms, lattice, { id: 'r', enabled: true, kind: 'replicate', repeat: repeat as [number, number, number] }), /whole numbers/);
  assert.throws(() => applyCrystalModifier(Array.from({ length: 4 }, () => atoms[0]), lattice, { id: 'r', enabled: true, kind: 'replicate', repeat: [8, 8, 8] }), /2,048/);
  const result = applyCrystalModifier([{ ...atoms[0], x: 1.2, z: -0.4 }], lattice, { id: 'r', enabled: true, kind: 'replicate', repeat: [2, 1, 2] });
  close(result.atoms[0].x, 0.1);
  close(result.atoms[0].z, -0.2);
});

test('Cartesian translation and wrapping respect tilted cells and nonperiodic axes', () => {
  const result = applyCrystalModifier(atoms, lattice, { id: 't', kind: 'translate', enabled: true, offset: [2, -1, 5], space: 'cartesian' });
  result.atoms.forEach((atom, i) => fractionalVectorToCartesian([atom.x, atom.y, atom.z], cellVectorsFromLattice(lattice)).forEach((n, axis) => close(n - position(atoms[i])[axis], [2, -1, 5][axis])));
  const wrapped = applyCrystalModifier([{ ...atoms[0], x: -0.2, y: 2.3, z: -0.8 }], lattice, modifier('wrap'));
  close(wrapped.atoms[0].x, 0.8); close(wrapped.atoms[0].y, 0.3); close(wrapped.atoms[0].z, -0.8);
});

test('slice uses the normalized Cartesian normal including tilted-cell contributions', () => {
  const slice: CrystalModifier = { id: 's', kind: 'slice', enabled: true, normal: [0, 0, 4], distance: 5, reverse: false };
  assert.deepEqual(applyCrystalModifier(atoms, lattice, slice).atoms.map((atom) => atom.id), ['o']);
  assert.deepEqual(applyCrystalModifier(atoms, lattice, { ...slice, reverse: true }).atoms.map((atom) => atom.id), ['si']);
  assert.throws(() => applyCrystalModifier(atoms, lattice, { ...slice, normal: [0, 0, 0] }), /nonzero/);
  const xCut = applyCrystalModifier(atoms, lattice, { ...slice, normal: [3, 0, 0], distance: -1 });
  assert.deepEqual(xCut.atoms.map((atom) => atom.id), ['si']);
});

test('filter supports element and coordinate comparisons, scientific notation, and AND-before-OR', () => {
  assert.deepEqual(atoms.filter(compileAtomFilter('Species == "Si" && Position.Z < 5', lattice)).map((atom) => atom.id), ['si']);
  assert.deepEqual(atoms.filter(compileAtomFilter('Species == O || Species == Si && Fractional.Z > 0.5', lattice)).map((atom) => atom.id), ['o']);
  assert.equal(atoms.filter(compileAtomFilter('Position.Z >= 3.2e0 && Fractional.X <= +.7', lattice)).length, 2);
  const removed = applyCrystalModifier(atoms, lattice, { id: 'f', kind: 'filter', enabled: true, expression: 'Species != O', keep: false });
  assert.deepEqual(removed.atoms.map((atom) => atom.id), ['o']);
  for (const expression of ['', 'Position.Z > Infinity', 'Species > Si', 'Position.Z >= 0; globalThis.foo = 1', 'process.exit()', 'Position.Z > 1 &&', 'Position.Z > (1+2)', 'Position.Z > 0x10']) assert.throws(() => compileAtomFilter(expression, lattice));
});

test('ordered modifier preview is atomic, skips disabled steps, and never mutates the source or its forces', () => {
  const before = structuredClone({ atoms, lattice });
  const translate: CrystalModifier = { id: 't', kind: 'translate', enabled: true, offset: [0, 0, 4], space: 'cartesian' };
  const slice: CrystalModifier = { id: 's', kind: 'slice', enabled: true, normal: [0, 0, 1], distance: 6, reverse: false };
  assert.equal(previewCrystalModifiers(atoms, lattice, [translate, slice]).atoms.length, 2);
  assert.equal(previewCrystalModifiers(atoms, lattice, [slice, translate]).atoms.length, 1);
  const result = previewCrystalModifiers(atoms, lattice, [{ ...translate, enabled: false }, slice]);
  assert.equal(result.atoms.length, 1);
  assert.equal(result.atoms[0].fx, undefined);
  const failed = previewCrystalModifiers(atoms, lattice, [translate, { ...slice, normal: [0, 0, 0] }]);
  assert.equal(failed.errorId, 's');
  assert.deepEqual(failed.atoms, atoms);
  assert.deepEqual(failed.lattice, lattice);
  assert.deepEqual({ atoms, lattice }, before);
});

test('a vacuum pipeline retains Cartesian pair displacements and clears stale forces', () => {
  const result = previewCrystalModifiers(atoms, lattice, [modifier('vacuum')]);
  const [a, b] = result.atoms.map((atom) => fractionalVectorToCartesian([atom.x, atom.y, atom.z], cellVectorsFromLattice(result.lattice)));
  a.forEach((n, axis) => close(b[axis] - n, position(atoms[1])[axis] - position(atoms[0])[axis]));
  assert.ok(result.atoms.every((atom) => atom.fx === undefined));
});

test('scalar colors preserve real ranges, handle equal values, and leave absent forces uncolored', () => {
  const forces = crystalScalarColors(atoms, lattice, 'force', 'viridis');
  assert.equal(forces.min, 0); assert.equal(forces.max, 5);
  assert.equal(forces.colors.get('si'), '#fde725'); assert.equal(forces.colors.get('o'), '#440154');
  const constant = crystalScalarColors([atoms[0], { ...atoms[0], id: 'same' }], lattice, 'z', 'coolwarm');
  assert.equal(constant.min, constant.max); assert.equal(constant.colors.get('si'), '#dddddd');
  const missing = crystalScalarColors([{ ...atoms[0], fx: undefined }, atoms[1]], lattice, 'force', 'viridis');
  assert.equal(missing.missing, 1); assert.equal(missing.colors.has('si'), false);
  assert.equal(crystalScalarColors(atoms, lattice, 'element', 'viridis').colors.size, 0);
});

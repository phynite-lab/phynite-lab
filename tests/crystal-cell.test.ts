import assert from 'node:assert/strict';
import test from 'node:test';
import { addCellVacuum, cellVectorsFromLattice, cellVolume, changeCellMetric, latticeFromCellVectors, type CellVectors } from '../lib/crystal-cell.ts';
import { createCIF, createPOSCAR, createXSF, createXYZ, fractionalToCartesian, parseStructureText } from '../lib/structure-parsers.ts';
import { buildCrystalRenderModel } from '../lib/crystal-render-model.ts';
import { orderedStructureIssue } from '../lib/structure-occupancy.ts';

const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);
const tilted: CellVectors = [[0, 3, 0], [-4, 1, 0], [1, 2, 8]];

test('cell metrics reject impossible angles and singular vectors without fabricating a cell', () => {
  assert.throws(() => cellVectorsFromLattice({ a: 1, b: 1, c: 1, alpha: 10, beta: 10, gamma: 170 }), /physical/);
  assert.throws(() => latticeFromCellVectors([[1, 0, 0], [2, 0, 0], [0, 0, 1]]), /volume/);
  assert.throws(() => cellVectorsFromLattice({ a: 0, b: 1, c: 1, alpha: 90, beta: 90, gamma: 90 }), /positive/);
});

test('cell orientation and Cartesian positions round-trip through XYZ and POSCAR', () => {
  const atoms = [{ id: 'a', species: 'Si', x: 0.2, y: 0.3, z: 0.4 }];
  const lattice = latticeFromCellVectors(tilted);
  for (const [name, text] of [['cell.xyz', createXYZ('cell', atoms, lattice)], ['POSCAR', createPOSCAR('cell', atoms, lattice)]]) {
    const parsed = parseStructureText(text, name);
    cellVectorsFromLattice(parsed.lattice).flat().forEach((value, i) => close(value, tilted.flat()[i]));
    fractionalToCartesian(parsed.atoms[0], parsed.lattice).forEach((value, i) => close(value, fractionalToCartesian(atoms[0], lattice)[i]));
  }
});

test('metric edits preserve the original cell orientation', () => {
  const changed = changeCellMetric(latticeFromCellVectors(tilted), 'a', 6);
  const vectors = cellVectorsFromLattice(changed);
  vectors[0].forEach((value, i) => close(value, tilted[0][i] * 2));
  vectors[1].forEach((value, i) => close(value, tilted[1][i]));
  vectors[2].forEach((value, i) => close(value, tilted[2][i]));
});

test('vacuum in a tilted cell increases normal thickness and preserves all interatomic vectors', () => {
  const lattice = latticeFromCellVectors(tilted);
  const atoms = [{ id: 'a', species: 'C', x: 0.1, y: 0.2, z: 0.3 }, { id: 'b', species: 'O', x: 0.6, y: 0.5, z: 0.4 }];
  const result = addCellVacuum(atoms, lattice, 7);
  close(result.lattice.vectors![2][2], 15);
  close(result.lattice.vectors![2][0], 1);
  const before = atoms.map((atom) => fractionalToCartesian(atom, lattice));
  const after = result.atoms.map((atom) => fractionalToCartesian(atom, result.lattice));
  for (let axis = 0; axis < 3; axis++) close(after[1][axis] - after[0][axis], before[1][axis] - before[0][axis]);
  close(after[0][2] - before[0][2], 3.5);
  assert.throws(() => addCellVacuum(atoms, lattice, NaN), /finite positive/);
});

test('negative POSCAR scale specifies target volume and scales Cartesian positions consistently', () => {
  const parsed = parseStructureText('Si\n-64\n2 0 0\n0 2 0\n0 0 2\nSi\n1\nCartesian\n1 0 0', 'POSCAR');
  close(Math.abs(cellVolume(cellVectorsFromLattice(parsed.lattice))), 64);
  close(parsed.atoms[0].x, 0.5);
  close(fractionalToCartesian(parsed.atoms[0], parsed.lattice)[0], 2);
});

test('POSCAR three-factor scaling acts on Cartesian components', () => {
  const parsed = parseStructureText('Si\n2 3 4\n1 1 0\n0 1 0\n0 0 1\nSi\n1\nCartesian\n0.5 0.5 0.5', 'POSCAR');
  assert.deepEqual(parsed.lattice.vectors, [[2, 3, 0], [0, 3, 0], [0, 0, 4]]);
  assert.deepEqual(fractionalToCartesian(parsed.atoms[0], parsed.lattice), [1, 1.5, 2]);
});

test('XYZ blank comments and finite-system periodicity survive import/export', () => {
  const parsed = parseStructureText('2\n\nH 0 0 0\nH 0 0 0.74', 'hydrogen.xyz');
  assert.equal(parsed.atoms.length, 2);
  assert.deepEqual(parsed.lattice.periodic, [false, false, false]);
  const model = buildCrystalRenderModel(parsed.atoms, parsed.lattice, [4, 4, 4], 1, 1, 'ball-stick');
  assert.equal(model.atoms.length, 2);
  const exported = parseStructureText(createXYZ('hydrogen', parsed.atoms, parsed.lattice), 'hydrogen.extxyz');
  assert.deepEqual(exported.lattice.periodic, [false, false, false]);
});

test('invalid numerical coordinates are rejected instead of becoming zero', () => {
  assert.throws(() => parseStructureText('1\n\nSi NaN 0 0', 'bad.xyz'), /finite|nonzero/);
});

const cif = `_cell_length_a 4\n_cell_length_b 4\n_cell_length_c 4\n_cell_angle_alpha 90\n_cell_angle_beta 90\n_cell_angle_gamma 90\n_symmetry_Int_Tables_number 2\nloop_\n_space_group_symop_id\n_space_group_symop_operation_xyz\n1 'x,y,z'\n2 '-x,-y,-z'\nloop_\n_atom_site_type_symbol\n_atom_site_label\n_atom_site_fract_x\n_atom_site_fract_y\n_atom_site_fract_z\n_atom_site_occupancy\nSi Si1 0.1 0.2 0.3 1`;

test('CIF symmetry expands unique sites and deduplicates special positions', () => {
  const expanded = parseStructureText(cif, 'inversion.cif');
  assert.equal(expanded.atoms.length, 2);
  close(expanded.atoms[1].x, 0.9);
  assert.equal(parseStructureText(cif.replace('0.1 0.2 0.3', '0 0 0'), 'special.cif').atoms.length, 1);
  assert.throws(() => parseStructureText(cif.replace(/loop_\n_space_group_symop_id[\s\S]+?2 '-x,-y,-z'\n/, ''), 'missing.cif'), /symmetry expansion/);
});

test('partial occupancies survive CIF export and block ordered-coordinate export', () => {
  const parsed = parseStructureText(cif.replace('0.1 0.2 0.3 1', '0.1 0.2 0.3 0.5'), 'partial.cif');
  assert.equal(parsed.atoms[0].occupancy, 0.5);
  assert.ok(orderedStructureIssue(parsed.atoms));
  assert.match(createCIF('partial', parsed.atoms, parsed.lattice), /0\.50000000/);
  assert.throws(() => createPOSCAR('partial', parsed.atoms, parsed.lattice), /ordered configuration/);
});

test('QE ibrav ratios are honored and undefined alat / symmetry positions are rejected', () => {
  const input = '&SYSTEM\nibrav=4, celldm(1)=6, celldm(3)=3, nat=1\n/\nATOMIC_POSITIONS crystal\nSi 0 0 0';
  const parsed = parseStructureText(input, 'cell.in');
  close(parsed.lattice.c / parsed.lattice.a, 3);
  assert.throws(() => parseStructureText(input.replace('ATOMIC_POSITIONS crystal', 'ATOMIC_POSITIONS crystal_sg'), 'sg.in'), /symmetry expansion/);
  assert.throws(() => parseStructureText('&SYSTEM\nibrav=0, nat=1\n/\nCELL_PARAMETERS alat\n1 0 0\n0 1 0\n0 0 1\nATOMIC_POSITIONS crystal\nSi 0 0 0', 'undefined.in'), /requires A/);
});

test('Cartesian neighbor search matches brute-force cutoff for skew cells', () => {
  const lattice = latticeFromCellVectors([[5, 0, 0], [4.6, 0.6, 0], [1, 0.2, 3]]);
  const atoms = [{ id: 'a', species: 'C', x: 0, y: 0, z: 0 }, { id: 'b', species: 'O', x: 0.3, y: 0.6, z: 0.2 }];
  const model = buildCrystalRenderModel(atoms, lattice, [4, 4, 1], 1, 1.5, 'ball-stick');
  const scale = 5.4 / Math.max(lattice.a, lattice.b, lattice.c);
  let expected = 0;
  model.atoms.forEach((atom, i) => model.atoms.slice(i + 1).forEach((other) => {
    const distance = Math.hypot(...atom.position.map((value, axis) => value - other.position[axis])) / scale;
    if (distance > 1e-6 && distance <= 1.5 + 1e-8) expected++;
  }));
  assert.equal(model.bonds.length, expected);
  assert.equal(model.omittedBonds, 0);
});


test('XSF retains slab periodicity and keeps forces in the original Cartesian frame', () => {
  const atoms = [{ id: 'a', species: 'Mo', x: 0.2, y: 0.3, z: 0.4, fx: 1, fy: 2, fz: 3 }];
  const lattice = { ...latticeFromCellVectors(tilted), periodic: [true, true, false] as [boolean, boolean, boolean] };
  const parsed = parseStructureText(createXSF('slab', atoms, lattice), 'slab.xsf');
  assert.deepEqual(parsed.lattice.periodic, [true, true, false]);
  assert.deepEqual([parsed.atoms[0].fx, parsed.atoms[0].fy, parsed.atoms[0].fz], [1, 2, 3]);
  fractionalToCartesian(parsed.atoms[0], parsed.lattice).forEach((value, axis) => close(value, fractionalToCartesian(atoms[0], lattice)[axis]));
  const finite = parseStructureText(createXSF('cluster', atoms, { ...lattice, periodic: [false, false, false] }), 'cluster.xsf');
  assert.deepEqual(finite.lattice.periodic, [false, false, false]);
  assert.equal(finite.atoms[0].fy, 2);
});

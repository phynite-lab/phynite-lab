import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { appearanceFor, buildCrystalRenderModel, cellOffsetFromAtomInstance, covalentRadiusFor, crystalRenderBounds, elementAppearance } from '../lib/crystal-render-model.ts';
import { isSupportedStructureFileName, parseStructureText } from '../lib/structure-parsers.ts';

const fixtureUrl = new URL('./fixtures/CoNi2O4.cif', import.meta.url);

test('structure import recognizes file-picker and drag-and-drop formats', () => {
  for (const fileName of ['CoNi2O4.cif', 'slab.XSF', 'POSCAR', 'CONTCAR', 'cell.vasp', 'molecule.xyz', 'protein.pdb', 'scf.in', 'relax.pwo']) {
    assert.equal(isSupportedStructureFileName(fileName), true, fileName);
  }
  for (const fileName of ['notes.txt', 'plot.png', 'structures.zip']) {
    assert.equal(isSupportedStructureFileName(fileName), false, fileName);
  }
});

test('CoNi2O4 CIF preserves its complete conventional cell', async () => {
  const parsed = parseStructureText(await readFile(fixtureUrl, 'utf8'), fileURLToPath(fixtureUrl));
  const counts = Object.groupBy(parsed.atoms, (atom) => atom.species);

  assert.equal(parsed.atoms.length, 56);
  assert.equal(counts.Co?.length, 8);
  assert.equal(counts.Ni?.length, 16);
  assert.equal(counts.O?.length, 32);
  assert.deepEqual(parsed.atoms.slice(0, 3).map((atom) => atom.label), ['Co0', 'Co1', 'Co2']);
  assert.deepEqual(parsed.lattice, {
    a: 8.12335021,
    b: 8.12335021,
    c: 8.12335021,
    alpha: 90,
    beta: 90,
    gamma: 90,
  });
});

test('CoNi2O4 preview clips periodic images while retaining atoms on the cell boundary', async () => {
  const parsed = parseStructureText(await readFile(fixtureUrl, 'utf8'), fileURLToPath(fixtureUrl));
  const model = buildCrystalRenderModel(parsed.atoms, parsed.lattice, [1, 1, 1], 1, 0, 'ball-stick');
  const fractionalPositions = model.atoms.map((atom) => model.worldToFractional(new THREE.Vector3(...atom.position)));

  assert.equal(model.atoms.length, model.primaryAtomCount);
  assert.ok(model.atoms.length >= parsed.atoms.length);
  assert.ok(model.bonds.length >= 104);
  assert.ok(fractionalPositions.every((position) => position.every((value) => value >= -1e-8 && value <= 1 + 1e-8)));
  assert.ok(fractionalPositions.some((position) => position.some((value) => Math.abs(value) < 1e-8 || Math.abs(value - 1) < 1e-8)));
  assert.deepEqual(cellOffsetFromAtomInstance('imported-atom-1', 'imported-atom-1@-1,0,1'), [-1, 0, 1]);
});

test('crystal viewport bounds center the complete rendered cell and atom radii', () => {
  const bounds = crystalRenderBounds({
    edges: [[[-1, -1, -1], [1, 1, 1]]],
    atoms: [{ position: [4, 0, 0], radius: 1 }],
  });

  assert.deepEqual(bounds.center.toArray(), [2, 0, 0]);
  assert.ok(bounds.radius >= Math.sqrt(11));
});

test('ZrBr2 repeated cells preserve species colors and never render dangling bonds', () => {
  const input = `
&SYSTEM
  ibrav = 0
  nat = 3
  ntyp = 2
/
ATOMIC_SPECIES
Zr  91.224  Zr.upf
Br  79.904  Br.upf
ATOMIC_POSITIONS crystal
Zr  0.3333333329  0.3333333330  1.0000000000
Br  0.6666666671  0.6666666670  1.1831773538
Br  0.6666666671  0.6666666670  0.8168226462
CELL_PARAMETERS angstrom
3.5604871040  0.0000000000  0.0000000000
1.7802435520  3.0834722820  0.0000000000
0.0000000000  0.0000000000  10.0000000000
K_POINTS automatic
4 4 1 0 0 0
`;
  const parsed = parseStructureText(input, 'zrbr2.scf.in');
  const model = buildCrystalRenderModel(parsed.atoms, parsed.lattice, [2, 2, 1], 1, 0, 'ball-stick');
  const counts = Object.groupBy(model.atoms, (atom) => atom.species);
  const fractionalPositions = model.atoms.map((atom) => model.worldToFractional(new THREE.Vector3(...atom.position)));

  assert.equal(model.primaryAtomCount, 16);
  assert.equal(model.atoms.length, model.primaryAtomCount);
  assert.ok(model.bonds.length > 0);
  assert.ok(model.bonds.every(([start, end]) => [start, end].every((point) => model.atoms.some((atom) => (
    atom.position.every((value, axis) => Math.abs(value - point[axis]) < 1e-8)
  )))));
  assert.ok((counts.Zr?.length ?? 0) >= 4);
  assert.ok((counts.Br?.length ?? 0) >= 8);
  assert.ok(model.atoms.every((atom) => atom.species === 'Zr' || atom.species === 'Br'));
  assert.ok(fractionalPositions.every((position) => position.every((value, axis) => value >= -1e-8 && value <= [2, 2, 1][axis] + 1e-8)));
  assert.ok(fractionalPositions.some((position) => Math.abs(position[2]) < 1e-8));
  assert.ok(fractionalPositions.some((position) => Math.abs(position[2] - 1) < 1e-8));
  assert.deepEqual(appearanceFor('Zr1'), appearanceFor('Zr'));
  assert.deepEqual(appearanceFor('Br2'), appearanceFor('Br'));
  assert.notEqual(appearanceFor('Zr').color, appearanceFor('H').color);
  assert.notEqual(appearanceFor('Br').color, appearanceFor('H').color);
});

test('MnTe QE input resolves distinct species colors and pure octahedral coordination', () => {
  const input = `
&SYSTEM
  ibrav = 0
  nat = 4
  ntyp = 2
/
ATOMIC_SPECIES
Mn 54.938 Mn.upf
Te 127.60 Te.upf
ATOMIC_POSITIONS crystal
Mn 0.000000 0.000000 0.000000
Mn 0.000000 0.000000 0.500000
Te 0.333333 0.666667 0.250000
Te 0.666667 0.333333 0.750000
CELL_PARAMETERS angstrom
 4.109300  0.000000  0.000000
-2.054650  3.558758  0.000000
 0.000000  0.000000  6.437975
K_POINTS automatic
4 4 2 0 0 0
`;
  const parsed = parseStructureText(input, 'scf.in');
  assert.equal(parsed.atoms.length, 4);

  const mnAppearance = appearanceFor('Mn');
  const teAppearance = appearanceFor('Te');
  assert.equal(mnAppearance.color, '#9c7ac7');
  assert.equal(teAppearance.color, '#d47a00');
  assert.notEqual(mnAppearance.color, teAppearance.color);
  assert.notEqual(mnAppearance.radius, teAppearance.radius);
  assert.ok(mnAppearance.radius > 0);
  assert.ok(teAppearance.radius > 0);

  const model = buildCrystalRenderModel(parsed.atoms, parsed.lattice, [1, 1, 1], 1, 0, 'ball-stick');
  assert.ok(model.bonds.length > 0);

  // Every bond in MnTe must connect Mn and Te (no spurious Mn-Mn vertical bonds or Te-Te bonds)
  for (const [start, end] of model.bonds) {
    const a1 = model.atoms.find((atom) => Math.hypot(atom.position[0] - start[0], atom.position[1] - start[1], atom.position[2] - start[2]) < 1e-4);
    const a2 = model.atoms.find((atom) => Math.hypot(atom.position[0] - end[0], atom.position[1] - end[1], atom.position[2] - end[2]) < 1e-4);
    assert.ok(a1 && a2, 'Both bond endpoints must map to visible atoms');
    const pair = [a1.species, a2.species].sort().join('-');
    assert.equal(pair, 'Mn-Te', 'Bonds in MnTe must strictly connect Mn and Te');
  }

  // Exactly 12 bonds representing the octahedral coordination of the 2 internal Mn atoms
  assert.equal(model.bonds.length, 12);
});

test('elementAppearance and covalent radii cover all periodic table elements', () => {
  assert.ok(Object.keys(elementAppearance).length >= 118);
  for (const species of ['H', 'C', 'N', 'O', 'Fe', 'Mn', 'Te', 'Au', 'Pt', 'U']) {
    const appearance = appearanceFor(species);
    assert.ok(appearance.color.startsWith('#'), `${species} color should be a hex code`);
    assert.ok(appearance.radius > 0, `${species} radius should be positive`);
    assert.ok(covalentRadiusFor(species) > 0, `${species} covalent radius should be positive`);
  }
});

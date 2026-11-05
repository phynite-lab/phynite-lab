import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { cellVolume, cellVectorsFromLattice } from '../lib/crystal-cell.ts';
import { prepareCrystalCell } from '../lib/crystal-database-cell.ts';
import type { CrystalDatabaseMaterial } from '../lib/crystal-database.ts';
import { crystalDatabaseFile, crystalDatabaseInput } from '../lib/crystal-database-input.ts';
import { parseStructureText } from '../lib/structure-parsers.ts';
const fixture = JSON.parse(await readFile(new URL('./fixtures/crystal-database-imports.json', import.meta.url), 'utf8')).materialsProject as CrystalDatabaseMaterial;

test('source import preserves the exact original object and all evidence', async () => {
  assert.strictEqual(await prepareCrystalCell(fixture, { cell: 'source', repeat: [1, 1, 1], symprec: .01 }), fixture);
});
test('a real imported supercell multiplies volume and sites, wraps coordinates, and retains original checksums', async () => {
  const original = structuredClone(fixture);
  const result = await prepareCrystalCell(fixture, { cell: 'source', repeat: [2, 3, 1], symprec: .01 });
  assert.equal(result.atoms.length, fixture.atoms.length * 6);
  assert.ok(Math.abs(cellVolume(cellVectorsFromLattice(result.lattice)) / cellVolume(cellVectorsFromLattice(fixture.lattice)) - 6) < 1e-10);
  assert.ok(result.atoms.every(atom => [atom.x, atom.y, atom.z].every(value => value >= 0 && value < 1)));
  assert.deepEqual(result.sourceData, fixture.sourceData); assert.deepEqual(result.provenance, fixture.provenance);
  assert.deepEqual(fixture, original);
  const transform = result.geometryTransforms![0]; assert.equal(transform.operation, 'supercell'); assert.equal(transform.multiplicity, 6);
  assert.equal(transform.sourceStructureSha256, fixture.provenance.structureSha256);
  assert.notEqual(transform.structureSha256, fixture.provenance.structureSha256);
  assert.equal(crystalDatabaseInput(result).geometryProvenance.length, 2);
  const file = crystalDatabaseFile(result);
  assert.equal(parseStructureText(file.content, file.filename).atoms.length, result.atoms.length);
});
test('lower-dimensional MD imports use extended XYZ to keep periodic axes and tilted cell vectors', () => {
  const material = { ...fixture, materialId: 'alexandria/public-example', lattice: { ...fixture.lattice, periodic: [true, false, true] as [boolean, boolean, boolean] } };
  const file = crystalDatabaseFile(material), parsed = parseStructureText(file.content, file.filename);
  assert.match(file.filename, /^[A-Za-z0-9_.-]+\.xyz$/);
  assert.deepEqual(parsed.lattice.periodic, [true, false, true]);
  assert.deepEqual(cellVectorsFromLattice(parsed.lattice), cellVectorsFromLattice(material.lattice));
  assert.equal(parsed.atoms.length, material.atoms.length);
});
test('primitive conversion sends exact source vectors and records the method before a supercell', async () => {
  const result = await prepareCrystalCell(fixture, { cell: 'primitive', repeat: [2, 1, 1], symprec: .002 }, async payload => {
    assert.deepEqual(payload.vectors, fixture.lattice.vectors);
    assert.equal(payload.cell, 'primitive'); assert.equal(payload.symprec, .002);
    return { vectors: cellVectorsFromLattice(fixture.lattice), sites: fixture.atoms, version: 'synthetic-test', provenance: { operation: 'standardize-cell', method: 'synthetic-fixture', noIdealize: true, symprecAngstrom: .002 } };
  });
  assert.deepEqual(result.geometryTransforms?.map(transform => transform.operation), ['standardize-cell', 'supercell']);
  assert.equal(result.numSites, fixture.numSites * 2);
  assert.equal(result.provenance.sourceSha256, fixture.provenance.sourceSha256);
});
test('invalid repeats, disordered, nonperiodic or magnetic reductions cannot silently change a crystal', async () => {
  for (const repeat of [[0, 1, 1], [1.5, 1, 1], [17, 1, 1]] as [number, number, number][]) await assert.rejects(prepareCrystalCell(fixture, { cell: 'source', repeat, symprec: .01 }));
  const options = { cell: 'primitive', repeat: [1, 1, 1], symprec: .01 } as const;
  let calls = 0; const convert = async () => { calls++; throw new Error('Unexpected conversion'); };
  for (const material of [
    { ...fixture, atoms: fixture.atoms.map(atom => ({ ...atom, occupancy: .5 })) },
    { ...fixture, lattice: { ...fixture.lattice, periodic: [true, true, false] as [boolean, boolean, boolean] } },
    { ...fixture, magneticOrdering: 'AFM' },
  ]) await assert.rejects(prepareCrystalCell(material, { ...options, repeat: [1, 1, 1] }, convert));
  assert.equal(calls, 0);
  await assert.rejects(prepareCrystalCell(fixture, { ...options, repeat: [1, 1, 1] }), /local DFT runtime/);
});

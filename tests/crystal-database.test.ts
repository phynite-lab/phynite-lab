import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { codQueryParameters, CrystalDatabaseError, searchCrystalDatabase } from '../lib/crystal-database.ts';

const cif = `data_public_fixture
_chemical_formula_sum 'Si'
_cell_length_a 5.43
_cell_length_b 5.43
_cell_length_c 5.43
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
_space_group_IT_number 1
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
_atom_site_occupancy
Si1 Si 0 0 0 1
`;
const mp = { material_id: 'mp-149', formula_pretty: 'Si', nsites: 1, structure: { lattice: { matrix: [[0, 2.715, 2.715], [2.715, 0, 2.715], [2.715, 2.715, 0]] }, sites: [{ label: 'Si1', species: [{ element: 'Si', occu: 1 }], abc: [.1, .2, .3] }] } };
const hash = (text: string) => createHash('sha256').update(text).digest('hex');

test('COD uses documented Hill formula, element and keyword parameters', () => {
  assert.equal(codQueryParameters('SiO2').get('formula'), 'O2 Si');
  assert.equal(codQueryParameters('CH3COOH').get('formula'), 'C2 H4 O2');
  assert.equal(codQueryParameters('MoS2').get('formula'), 'Mo S2');
  assert.deepEqual([...codQueryParameters('Si-O').entries()], [['format', 'json'], ['el1', 'Si'], ['el2', 'O']]);
  assert.equal(codQueryParameters('silicon carbide').get('text2'), 'carbide');
  assert.equal(codQueryParameters('cod-9000001').get('id'), '9000001');
});

test('public COD needs no account and retains exact CIF, checksums, source URL and expanded geometry', async () => {
  const requests: Request[] = [];
  const result = await searchCrystalDatabase('Si', { source: 'cod', limit: 1, fetcher: async (url, options) => {
    const request = new Request(url, options); requests.push(request);
    assert.equal(request.redirect, 'manual'); assert.equal(request.headers.has('X-API-KEY'), false);
    return request.url.includes('result.php') ? Response.json([{ file: '9000001', flags: 'has coordinates', calcformula: '- Si -', sg: 'P 1', sgNumber: '1', date: '2026-01-01' }, { file: '../../bad', flags: 'has coordinates' }]) : new Response(cif);
  } });
  assert.equal(requests.length, 2);
  assert.equal(new URL(requests[0].url).searchParams.get('formula'), 'Si');
  const material = result.materials[0];
  assert.equal(material.materialId, 'cod-9000001'); assert.equal(material.formula, 'Si');
  assert.equal(material.sourceData.content, cif); assert.equal(material.sourceData.sha256, hash(cif));
  assert.equal(material.provenance.sourceSha256, hash(cif));
  assert.equal(material.provenance.structureSha256, hash(JSON.stringify({ lattice: material.lattice, atoms: material.atoms })));
  assert.equal(material.provenance.sourceUpdatedAt, '2026-01-01');
  assert.equal(material.provenance.id, material.materialId);
  assert.equal(material.sourceUrl, 'https://www.crystallography.net/cod/9000001.html');
  assert.equal(material.atoms.length, 1); assert.deepEqual(material.lattice.periodic, [true, true, true]);
  assert.equal(material.bandGap, undefined); assert.equal(material.theoretical, undefined);
});

test('an exact COD ID uses a fixed CIF endpoint without a search and preserves partial occupancy', async () => {
  const urls: string[] = [];
  const result = await searchCrystalDatabase('cod-9000001', { source: 'cod', fetcher: async url => { urls.push(String(url)); return new Response(cif.replace('0 0 0 1', '0 0 0 0.5')); } });
  assert.deepEqual(urls, ['https://www.crystallography.net/cod/9000001.cif']);
  assert.equal(result.materials[0].atoms[0].occupancy, .5);
  assert.match(result.materials[0].warnings[0], /partial or mixed/);
});

test('MP preserves exact vectors, mixed-site species and missing reference values without invented defaults', async () => {
  const document = { ...mp, structure: { ...mp.structure, sites: [{ ...mp.structure.sites[0], species: [{ element: 'Si', occu: .6 }, { element: 'C', occu: .4 }] }] } };
  const result = await searchCrystalDatabase('mp-149', { source: 'materials-project', apiKey: 'private-fixture-key', fetcher: async (url, options) => {
    const request = new Request(url, options); assert.equal(new URL(request.url).hostname, 'api.materialsproject.org');
    assert.equal(request.headers.get('X-API-KEY'), 'private-fixture-key'); assert.equal(new URL(request.url).searchParams.get('material_ids'), 'mp-149');
    return Response.json({ data: [document] });
  } });
  const material = result.materials[0];
  assert.deepEqual(material.lattice.vectors, mp.structure.lattice.matrix);
  assert.deepEqual(material.atoms[0].siteSpecies?.map(value => value.occupancy), [.6, .4]);
  assert.deepEqual([material.atoms[0].x, material.atoms[0].y, material.atoms[0].z], [.1, .2, .3]);
  assert.equal(material.bandGap, undefined); assert.equal(material.density, undefined); assert.equal(material.spaceGroupNumber, undefined);
  assert.equal(material.sourceData.content, JSON.stringify(document)); assert.equal(material.sourceData.sha256, hash(JSON.stringify(document)));
  assert.equal(JSON.stringify(result).includes('private-fixture-key'), false);
});

test('invalid MP geometry is omitted with an explicit warning and no fallback to COD', async () => {
  let calls = 0;
  const result = await searchCrystalDatabase('Si', { source: 'materials-project', apiKey: 'fixture', fetcher: async () => { calls++; return Response.json({ data: [{ ...mp, structure: { ...mp.structure, sites: [{ ...mp.structure.sites[0], abc: [0, null, 0] }] } }] }); } });
  assert.equal(calls, 1); assert.equal(result.materials.length, 0); assert.match(result.warnings[0], /could not be validated/);
});

test('invalid/private queries and missing MP keys fail before network access', async () => {
  let calls = 0; const fetcher = async () => { calls++; return new Response(cif); };
  for (const query of ['https://example.com', 'bearer secret', 'api_key private', '', '../1234567', 'cod-123']) await assert.rejects(searchCrystalDatabase(query, { fetcher }), error => error instanceof CrystalDatabaseError && error.status === 400);
  await assert.rejects(searchCrystalDatabase('mp-149', { fetcher }), error => error instanceof CrystalDatabaseError && error.code === 'MP_API_KEY_MISSING');
  await assert.rejects(searchCrystalDatabase('cod-9000001', { source: 'materials-project', apiKey: 'fixture', fetcher }), error => error instanceof CrystalDatabaseError && error.code === 'CRYSTAL_SOURCE_INVALID');
  assert.equal(calls, 0);
});

test('redirects and oversized responses are rejected without following a provider elsewhere', async () => {
  let calls = 0;
  await assert.rejects(searchCrystalDatabase('cod-9000001', { fetcher: async (_url, options) => { calls++; assert.equal(options?.redirect, 'manual'); return new Response(null, { status: 302, headers: { Location: 'https://example.invalid/secret' } }); } }), error => error instanceof CrystalDatabaseError && error.code === 'CRYSTAL_DATABASE_UNAVAILABLE');
  assert.equal(calls, 1);
  await assert.rejects(searchCrystalDatabase('cod-9000001', { fetcher: async () => new Response(cif, { headers: { 'Content-Length': '2000001' } }) }), error => error instanceof CrystalDatabaseError && error.code === 'CRYSTAL_RESPONSE_LIMIT');
});

test('an aborted search never returns late structures', async () => {
  const controller = new AbortController();
  await assert.rejects(searchCrystalDatabase('cod-9000001', { signal: controller.signal, fetcher: async () => { controller.abort(); return new Response(cif); } }), error => error instanceof Error && error.name === 'AbortError');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { normalizeOptimade, optimadeParameters } from '../lib/crystal-database-optimade.ts';
import { searchCrystalDatabase } from '../lib/crystal-database.ts';
import { crystalSources, type CrystalSource } from '../lib/crystal-database-options.ts';

// Synthetic geometry exercises protocol semantics, not a claimed database result.
const record = { type: 'structures', id: 'synthetic-public-id', attributes: { chemical_formula_reduced: 'OSi', nsites: 2,
  lattice_vectors: [[4, 0, 0], [1, 5, 0], [0, 0, 6]], cartesian_site_positions: [[0, 0, 0], [2.5, 2.5, 3]],
  species_at_sites: ['O', 'Si'], species: [{ name: 'O', chemical_symbols: ['O'], concentration: [1] }, { name: 'Si', chemical_symbols: ['Si'], concentration: [1] }],
  dimension_types: [1, 1, 0], structure_features: [] as string[], last_modified: '2026-01-01T00:00:00Z' } };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

test('recorded public provider records retain their geometry, while incomplete captures fail closed', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/crystal-optimade-records.json', import.meta.url), 'utf8'));
  for (const [source, value] of Object.entries(fixture.records) as Array<[CrystalSource, { record: unknown; retrievedAt?: string; expectedError?: string; sourceUrl: string }]>) {
    if (value.expectedError) await assert.rejects(normalizeOptimade(value.record, source, '2026-01-02T00:00:00Z'), new RegExp(value.expectedError));
    else {
      const material = await normalizeOptimade(value.record, source, value.retrievedAt!);
      assert.equal(material.sourceUrl, value.sourceUrl);
      assert.equal(material.sourceData.sha256, hash(JSON.stringify(value.record)));
      assert.equal(material.atoms.length, (value.record as typeof record).attributes.nsites);
    }
  }
});
test('all five source identities match the shared Python import contract', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/crystal-optimade-imports.json', import.meta.url), 'utf8'));
  for (const [source, expected] of Object.entries(fixture.materials) as Array<[CrystalSource, Awaited<ReturnType<typeof normalizeOptimade>>]>) {
    assert.deepEqual(await normalizeOptimade(JSON.parse(expected.sourceData.content), source, expected.provenance.retrievedAt), expected);
  }
});

for (const source of ['oqmd', 'aflow', 'jarvis', 'alexandria', 'nomad'] as const) {
  test(`${source} keeps exact geometry, periodicity, source bytes and documented property units`, async () => {
    const provider = crystalSources[source];
    const attributes = { ...record.attributes, ...(provider.gap ? { [provider.gap]: 1.25 } : {}), ...(provider.hull ? { [provider.hull]: 0.012 } : {}), ...(provider.spaceGroup ? { [provider.spaceGroup]: source === 'jarvis' ? '14' : 14 } : {}) };
    const raw = { ...record, attributes }, material = await normalizeOptimade(raw, source, '2026-01-02T00:00:00Z');
    assert.deepEqual(material.lattice.vectors, record.attributes.lattice_vectors);
    assert.deepEqual(material.lattice.periodic, [true, true, false]);
    assert.deepEqual([material.atoms[1].x, material.atoms[1].y, material.atoms[1].z], [.5, .5, .5]);
    assert.equal(material.sourceData.content, JSON.stringify(raw));
    assert.equal(material.provenance.sourceSha256, hash(JSON.stringify(raw)));
    assert.equal(material.provenance.structureSha256, hash(JSON.stringify({ lattice: material.lattice, atoms: material.atoms })));
    assert.equal(material.provenance.database, source);
    assert.equal(material.bandGap, provider.gap ? 1.25 : undefined);
    assert.equal(material.energyAboveHull, provider.hull ? .012 : undefined);
    assert.equal(material.spaceGroupNumber, 14);
    assert.equal(material.density, undefined);
    assert.equal(material.isStable, undefined);
  });
}
test('provider field names, units, formula reduction and page controls are explicit', () => {
  const alexandria = optimadeParameters('SiO2', 'alexandria', { limit: 12, offset: 24, filters: { minBandGap: 1, maxEnergyAboveHull: .05, spaceGroup: 152 }, sort: '-band-gap' }).parameters;
  assert.match(alexandria.get('filter')!, /chemical_formula_reduced="O2Si"/);
  assert.match(alexandria.get('filter')!, /_alexandria_hull_distance<=0.05/);
  assert.match(alexandria.get('filter')!, /_alexandria_space_group=152/);
  assert.equal(alexandria.get('sort'), '-_alexandria_band_gap');
  assert.equal(alexandria.get('page_offset'), '24');
  const aflow = optimadeParameters('Si-O', 'aflow', { limit: 12, offset: 24 }).parameters;
  assert.equal(aflow.get('page_number'), '3'); assert.equal(aflow.has('page_offset'), false);
  assert.match(aflow.get('filter')!, /nelements=2/);
  const jarvis = optimadeParameters('Si-O', 'jarvis', {});
  assert.equal(jarvis.parameters.get('filter'), 'elements HAS ALL "O","Si"');
  assert.ok(jarvis.warnings.length);
  assert.match(optimadeParameters('Si', 'nomad', {}).parameters.get('filter')!, /nperiodic_dimensions>0/);
});
test('unsupported filters, paging, sorting, credentials and mismatched IDs fail before network access', async () => {
  let calls = 0; const fetcher = async () => { calls++; return Response.json({ data: [] }); };
  for (const [query, options] of [
    ['Si', { source: 'jarvis', offset: 20 }], ['Si', { source: 'aflow', sort: 'sites' }],
    ['Si', { source: 'nomad', filters: { minBandGap: 1 } }], ['SiO2', { source: 'aflow' }],
    ['Si', { source: 'alexandria', filters: { minSites: 8, maxSites: 2 } }],
    ['nomad/public-record', { source: 'oqmd' }], ['mp-149', { source: 'nomad' }],
    ['oqmd/sk-12345678901234567890', { source: 'oqmd' }], ['oqmd/..', { source: 'oqmd' }],
    ['Si', { source: 'toString' }],
    ['Si999999999999999999999', { source: 'alexandria' }],
  ] as const) await assert.rejects(searchCrystalDatabase(query, { ...options, fetcher } as Parameters<typeof searchCrystalDatabase>[1]));
  assert.equal(calls, 0);
});
test('only fixed HTTPS endpoints are fetched, never untrusted next-page links or inherited MP keys', async () => {
  const calls: Request[] = [];
  const result = await searchCrystalDatabase('Si', { source: 'alexandria', offset: 12, limit: 12, apiKey: 'private-fixture-key', fetcher: async (url, init) => {
    const request = new Request(url, init); calls.push(request);
    assert.equal(request.headers.has('X-API-KEY'), false); assert.equal(request.redirect, 'manual');
    assert.equal(new URL(request.url).origin, 'https://alexandria.icams.rub.de');
    return Response.json({ data: [record], meta: { more_data_available: true, data_returned: 50 }, links: { next: 'https://untrusted.invalid/secret' } });
  } });
  assert.equal(calls.length, 1); assert.equal(new URL(calls[0].url).searchParams.get('page_offset'), '12');
  assert.equal(result.pagination?.nextOffset, 24); assert.equal(result.pagination?.total, 50);
});
test('JARVIS fixed first page remains visible without pretending that paging or sorting worked', async () => {
  const result = await searchCrystalDatabase('Si', { source: 'jarvis', fetcher: async () => Response.json({ data: [record], meta: { more_data_available: true, data_returned: 39 } }) });
  assert.equal(result.pagination?.hasMore, false); assert.equal(result.pagination?.nextOffset, null);
  assert.match(result.warnings.join(' '), /fixed first page/);
});
test('source records that ignore a filter cannot be presented as matching it', async () => {
  const result = await searchCrystalDatabase('Si', { source: 'alexandria', filters: { maxSites: 1 }, fetcher: async () => Response.json({ data: [record] }) });
  assert.equal(result.materials.length, 0);
  assert.match(result.warnings[0], /does not meet the selected filters/);
});
test('an ignored source sort remains an error instead of silently sorting only the current page', async () => {
  const smaller = { ...record, id: 'smaller-synthetic', attributes: { ...record.attributes, nsites: 1, chemical_formula_reduced: 'O', cartesian_site_positions: [[0, 0, 0]], species_at_sites: ['O'] } };
  await assert.rejects(searchCrystalDatabase('Si-O', { source: 'alexandria', sort: 'sites', fetcher: async () => Response.json({ data: [record, smaller] }) }), { code: 'CRYSTAL_SORT_NOT_HONORED' });
});
test('public database access failures never ask for an unrelated Materials Project key', async () => {
  await assert.rejects(searchCrystalDatabase('Si', { source: 'nomad', fetcher: async () => new Response(null, { status: 403 }) }), { code: 'CRYSTAL_DATABASE_UNAVAILABLE' });
});
test('reported negative formation-stability distances are preserved rather than replaced with zero', async () => {
  const material = await normalizeOptimade({ ...record, attributes: { ...record.attributes, _oqmd_stability: -.002 } }, 'oqmd', '2026-01-02T00:00:00Z');
  assert.equal(material.energyAboveHull, -.002);
});
test('mixed sites and vacancies are retained; missing and sentinel properties remain unavailable', async () => {
  const raw = structuredClone(record);
  raw.attributes.structure_features = ['disorder'];
  raw.attributes.species[0] = { name: 'O', chemical_symbols: ['O', 'vacancy'], concentration: [.6, .4] };
  const material = await normalizeOptimade({ ...raw, attributes: { ...raw.attributes, _jarvis_optb88vdw_bandgap: -99999, _jarvis_ehull: -99999 } }, 'jarvis', '2026-01-02T00:00:00Z');
  assert.equal(material.atoms[0].occupancy, .6); assert.equal(material.bandGap, undefined); assert.equal(material.energyAboveHull, undefined);
  assert.match(material.warnings[0], /partial or mixed/);
});
test('invalid source cells, bulk-fraction occupancies and unsupported assemblies are never substituted', async () => {
  await assert.rejects(normalizeOptimade({ ...record, id: '..' }, 'aflow', '2026-01-02T00:00:00Z'), /structure identity/);
  for (const attributes of [
    { lattice_vectors: [[0, 0, 0], [0, 0, 0], [0, 0, 0]] },
    { species: [{ name: 'O', chemical_symbols: ['O'], concentration: [.5] }] },
    { structure_features: ['assemblies'] }, { nsites: 3 }, { dimension_types: [1, 1] },
  ]) {
    const result = await searchCrystalDatabase('Si', { source: 'aflow', fetcher: async () => Response.json({ data: [{ ...record, attributes: { ...record.attributes, ...attributes } }] }) });
    assert.equal(result.materials.length, 0); assert.match(result.warnings[0], /omitted/);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { strFromU8, unzipSync } from 'fflate';
import { createFigure, datasetFromText } from '../lib/research-figures.ts';
import { manuscriptFigure } from '../lib/manuscript-evidence.ts';
import { buildManuscriptArchive, escapeLatex, manuscriptBibtex, manuscriptHash, validateManuscript, type ManuscriptSnapshot } from '../lib/manuscript.ts';
import { aiMcpControlPlaneTimeout } from '../lib/ai-mcp.ts';
import { aiTools, executeAiTool } from '../lib/ai-tools.ts';

export async function manuscriptFixture(withFigure = true): Promise<ManuscriptSnapshot> {
  const input = "! Synthetic control-plane fixture only\n&SYSTEM ecutwfc=60 /\n", csv = 'x,energy_eV\n0,1\n1,2\n';
  const file = async (path: string, text: string, role: string) => ({ path, text, role, sha256: await manuscriptHash(text), sizeBytes: new TextEncoder().encode(text).length });
  const dataset = await datasetFromText(csv, { name: 'Synthetic fixture', projectId: 'prj_fixture', filename: 'data/energy.csv', calculationType: 'Total energy', source: { calculationId: 'calc_fixture' } }); dataset.id = 'dataset_fixture'; dataset.createdAt = '2026-01-01T00:00:00Z';
  const figure = createFigure('prj_fixture', [dataset], 'single', 'Synthetic figure'); figure.id = 'figure_fixture'; figure.createdAt = figure.updatedAt = '2026-01-01T00:00:00Z'; figure.panels[0].id = 'panel_fixture'; figure.panels[0].layers[0].id = 'layer_fixture'; figure.caption = 'Synthetic fixture & numerical source.';
  const result = { calculationId: 'calc_fixture', calculationType: 'Total energy', summary: { totalEnergyRy: -12.5 }, provenance: { qeVersion: 'Synthetic fixture' } };
  const svg = manuscriptFigure(figure, [dataset], [result]);
  return { schemaVersion: 1, template: 'aps-prb-revtex4-2', status: 'draft', title: 'Synthetic fixture & exact evidence', authors: [{ name: 'A Fixture', affiliation: 'Synthetic test institution' }], projectId: 'prj_fixture', conversationId: 'aic_fixture', createdAt: '2026-01-01T00:00:00Z', sourceStamp: 'a'.repeat(64), requestSha256: 'b'.repeat(64), rendererSha256: withFigure ? 'f'.repeat(64) : null,
    jobs: [{ id: 'calc_fixture', revision: 0, calculationType: 'Total energy', manifestSha256: 'c'.repeat(64), result, methodFingerprint: 'd'.repeat(64), parameters: [{ name: 'system.ecutwfc', valueText: '60', unit: 'Ry', sourcePath: 'inputs/scf.in', start: input.indexOf('60'), end: input.indexOf('60') + 2 }], files: [await file('inputs/scf.in', input, 'input'), await file('logs/scf.out', 'Synthetic fixture log.\n', 'log'), await file('data/energy.csv', csv, 'data')] }],
    quantities: [{ calculationId: 'calc_fixture', label: 'Total energy', value: -12.5, unit: 'Ry', scope: 'retained final solver summary', jsonPointer: '/summary/totalEnergyRy', methodFingerprint: 'd'.repeat(64) }],
    figures: withFigure ? [{ figure, revision: 1, datasets: [dataset], svg, svgSha256: await manuscriptHash(svg) }] : [],
    references: [{ title: 'Synthetic bibliographic fixture', authors: ['A Fixture'], year: 2024, doi: '10.1234/synthetic', source: 'Crossref', url: 'https://doi.org/10.1234/synthetic', retrievedAt: '2026-01-01T00:00:00Z', providerSha256: 'e'.repeat(64) }], materialsProject: [], missingInformation: ['Synthetic test fixture requires author review.'] };
}

test('APS ZIP binds every file, number, method, figure and immutable source with checksums', async () => {
  const snapshot = await manuscriptFixture(), { bytes, manifest } = await buildManuscriptArchive(snapshot), files = unzipSync(bytes);
  assert.match(strFromU8(files['main.tex']), /documentclass\[aps,prb,reprint\]\{revtex4-2\}/);
  assert.match(strFromU8(files['main.tex']), /Synthetic fixture \\& exact evidence/);
  assert.match(strFromU8(files['tables/results-J1.tex']), /-12.5 & Ry/);
  assert.match(strFromU8(files['tables/methods-J1.tex']), /60 & Ry/);
  assert.equal(manifest.quantityBindings[0].jsonPointer, '/summary/totalEnergyRy');
  assert.equal(manifest.figureBindings[0].datasets[0].sourceSha256, snapshot.jobs[0].files[2].sha256);
  assert.equal(strFromU8(files['figures/figure-1.svg']), snapshot.figures[0].svg);
  for (const entry of manifest.entries) { assert.equal(files[entry.path].length, entry.sizeBytes); assert.equal(await manuscriptHash(files[entry.path]), entry.sha256); }
  for (const line of strFromU8(files['SHA256SUMS']).trim().split('\n')) { const [checksum, path] = line.split('  '); assert.equal(await manuscriptHash(files[path]), checksum); }
  assert.equal(manifest.status, 'draft'); assert.match(strFromU8(files['MISSING-INFORMATION.md']), /convert the retained SVG/);
  assert.deepEqual((await buildManuscriptArchive(snapshot)).bytes, bytes);
});

test('scientific number, units, method, source file, path and gap sampling tampering block export', async () => {
  const snapshot = await manuscriptFixture();
  const changes: Array<(s: ManuscriptSnapshot) => void> = [
    s => { s.quantities[0].value = 100; }, s => { s.quantities[0].unit = 'eV'; }, s => { s.quantities[0].methodFingerprint = 'f'.repeat(64); },
    s => { s.jobs[0].files[0].text += 'modified'; }, s => { s.jobs[0].files[0].path = '../main.tex'; },
    s => { s.jobs[0].parameters![0].valueText = '999'; }, s => { s.quantities[0].value = NaN; },
    s => { s.quantities[0] = { ...s.quantities[0], jsonPointer: '/summary/bandGapEv', label: 'Band gap', unit: 'eV' }; s.jobs[0].result.summary.bandGapEv = -12.5; },
  ];
  for (const change of changes) { const changed = structuredClone(snapshot); change(changed); await assert.rejects(() => buildManuscriptArchive(changed)); }
});

test('reparsing the executed CSV rejects invented curves, energy references and foreign sources', async () => {
  const snapshot = await manuscriptFixture(), original = snapshot.figures[0];
  const changes: Array<(s: ManuscriptSnapshot) => void> = [
    s => { s.figures[0].datasets[0].data.quantities[0].series[0].points[0][1] = 999; },
    s => { s.figures[0].datasets[0].metadata.energy.fermiEv = 99; },
    s => { s.figures[0].datasets[0].source.calculationId = 'foreign'; },
    s => { s.figures[0].svg += '<script>alert(1)</script>'; },
    s => { s.figures[0].figure.panels[0].layers[0].normalization = 'atom'; },
  ];
  for (const change of changes) { const changed = structuredClone(snapshot); change(changed); await assert.rejects(() => validateManuscript(changed)); }
  assert.match(manuscriptFigure(original.figure, original.datasets, [{ ...snapshot.jobs[0].result, calculationType: 'Total energy' }]), /^<svg/);
});

test('TeX and BibTeX text is inert and absent journal, volume, pages and DOI stay absent', async () => {
  const payload = '\\input{secret}%&#_$^~\n\\write18{touch BAD}', snapshot = await manuscriptFixture(false);
  snapshot.title = payload; snapshot.references[0].title = payload; snapshot.references[0].authors = [payload];
  const bib = manuscriptBibtex(snapshot.references), { bytes } = await buildManuscriptArchive(snapshot), main = strFromU8(unzipSync(bytes)['main.tex']);
  assert.ok(main.includes(escapeLatex(payload))); assert.ok(bib.includes(escapeLatex(payload)));
  assert.ok(!main.includes('\\write18{')); assert.ok(!bib.includes('\\input{secret}'));
  assert.doesNotMatch(bib, /\b(?:journal|volume|pages)\s*=/);
  const arxiv = manuscriptBibtex([{ ...snapshot.references[0], doi: undefined, arxivId: '2401.00001v1' }]);
  assert.doesNotMatch(arxiv, /\bdoi\s*=/); assert.match(arxiv, /archivePrefix = \{arXiv\}/);
});

test('known MP methods retain separate reference units and unknown methods suppress comparison values', async () => {
  const snapshot = await manuscriptFixture(false);
  snapshot.materialsProject = [{ structureId: 'str_fixture', mpId: 'mp-1', snapshotAt: '2024-01-01', sourceSha256: 'f'.repeat(64), snapshot: { band_gap: 987.654, energy_above_hull: .25 }, method: null, units: { band_gap: 'eV', energy_above_hull: 'eV/atom' } }];
  let main = strFromU8(unzipSync((await buildManuscriptArchive(snapshot)).bytes)['main.tex']);
  assert.doesNotMatch(main, /987.654/); assert.match(main, /comparison pending/);
  snapshot.materialsProject[0].method = 'GGA+U';
  main = strFromU8(unzipSync((await buildManuscriptArchive(snapshot)).bytes)['main.tex']);
  assert.match(main, /987.654 eV/); assert.match(main, /0.25 eV\/atom/);
  assert.match(main, /mp-1/); assert.match(main, /2024-01-01/);
});

test('vector conversion failure cannot be reported as a successful PDF export', async () => {
  const snapshot = await manuscriptFixture();
  await assert.rejects(() => buildManuscriptArchive(snapshot, async () => new Uint8Array([1, 2])), /PDF conversion failed/);
});

test('manuscript tool is read-only, scopes the snapshot and carries idempotency and custom-skill limits', async () => {
  assert.ok(aiTools('chat', true).some(tool => tool.name === 'create_manuscript'));
  assert.ok(!aiTools('chat', true, ['read_artifact']).some(tool => tool.name === 'create_manuscript'));
  const calls: Array<[string, Record<string, unknown> | undefined]> = [];
  const backend = async <T>(operation: string, payload?: Record<string, unknown>) => { calls.push([operation, payload]); return (operation === 'context' ? { stamp: 'exact-snapshot' } : { artifact: { kind: 'manuscript' } }) as T; };
  await executeAiTool('create_manuscript', { title: 'Fixture', calculationIds: [] }, 'chat', backend, new AbortController().signal, 'call-manuscript');
  assert.deepEqual(calls.map(call => call[0]), ['context', 'manuscript_create']);
  assert.equal(calls[1][1]?.stamp, 'exact-snapshot'); assert.equal(calls[1][1]?.toolCallId, 'call-manuscript'); assert.equal(calls[1][1]?.toolName, 'create_manuscript');
});

test('bounded bibliography creation has enough local transport time without changing ordinary reads', () => {
  assert.equal(aiMcpControlPlaneTimeout('conversations/aic_fixture/manuscript_create', true), 90_000);
  assert.equal(aiMcpControlPlaneTimeout('conversations/aic_fixture/context', true), 20_000);
  assert.equal(aiMcpControlPlaneTimeout('conversations/aic_fixture/manuscript_create', false), 20_000);
});

test('common scientific Greek and mathematical symbols use fixed inert TeX commands', () => {
  assert.equal(escapeLatex('Γ α ℏ'), String.raw`\ensuremath{\Gamma} \ensuremath{\alpha} \ensuremath{\hbar}`);
  assert.equal(escapeLatex('a≤b'), String.raw`a\ensuremath{\leq}b`);
});

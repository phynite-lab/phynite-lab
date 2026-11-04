import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { aiTools, executeAiTool, type AiBackend, type AiContext } from '../lib/ai-tools.ts';
import { emptyProjectWorkflow } from '../lib/project-workflow.ts';
import { searchCrystalDatabase } from '../lib/crystal-database.ts';

const cif = `data_9000001
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
Si1 Si 0 0 0
`;
const sourceSha256 = createHash('sha256').update(cif).digest('hex');
const context: AiContext = { project: { id: 'prj_test', name: 'Public structure study', kind: 'canvas', remoteId: 'prj_test' }, stamp: 'stamp', workspaceRevision: 1, resources: {}, workspace: null };
const signal = () => new AbortController().signal;
function backendMock() {
  const calls: Array<{ operation: string; payload?: Record<string, unknown> }> = [];
  const backend: AiBackend = async <T,>(operation: string, payload?: Record<string, unknown>) => {
    calls.push({ operation, payload });
    return (operation === 'context' ? context : operation === 'canvas' ? { workflow: emptyProjectWorkflow('prj_test'), revision: 3 } : operation === 'prepare' ? { action: { id: 'aia_import', status: 'pending', payloadHash: 'reviewed' } } : operation === 'execute' ? { action: { id: 'aia_import', status: 'succeeded' } } : {}) as T;
  };
  return { backend, calls };
}
async function withCif(run: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    assert.equal(url.hostname, 'www.crystallography.net');
    assert.equal(url.pathname, '/cod/9000001.cif');
    return new Response(cif);
  };
  try { await run(); } finally { globalThis.fetch = original; }
}

test('crystal search is read-only and database import follows project permission modes', () => {
  assert.ok(aiTools('chat', false).some(tool => tool.name === 'search_crystal_structures'));
  assert.ok(!aiTools('chat', true).some(tool => tool.name === 'import_crystal_structure'));
  assert.ok(aiTools('approval', true).some(tool => tool.name === 'import_crystal_structure'));
});

test('AI crystal search returns source identity without copying raw coordinates or fabricating properties', async () => withCif(async () => {
  const mock = backendMock();
  const { result } = await executeAiTool('search_crystal_structures', { query: 'cod-9000001' }, 'chat', mock.backend, signal());
  const material = (result as { materials: Array<Record<string, unknown>> }).materials[0];
  assert.equal(material.materialId, 'cod-9000001');
  assert.equal(material.atoms, undefined);
  assert.equal(material.sourceData, undefined);
  assert.equal(material.bandGap, undefined);
  assert.equal((material.provenance as Record<string, unknown>).sourceSha256, sourceSha256);
  assert.equal(mock.calls.length, 0);
}));

test('AI import prepares exact source and geometry for approval without submitting a solver job', async () => withCif(async () => {
  const mock = backendMock();
  const response = await executeAiTool('import_crystal_structure', { source: 'cod', id: 'cod-9000001', sourceSha256 }, 'approval', mock.backend, signal());
  assert.equal(response.awaitingApproval, true);
  const prepared = mock.calls.find(call => call.operation === 'prepare')!.payload!;
  assert.equal(prepared.kind, 'import_structure');
  const payload = prepared.payload as { baseRevision: number; node: { resources: unknown[]; configuration: { structure: { atoms: unknown[]; sourceData: { content: string; sha256: string }; provenance: { sourceSha256: string } } } } };
  assert.equal(payload.baseRevision, 3);
  assert.equal(payload.node.configuration.structure.atoms.length, 1);
  assert.equal(payload.node.configuration.structure.sourceData.content, cif);
  assert.equal(payload.node.configuration.structure.provenance.sourceSha256, sourceSha256);
  assert.deepEqual(payload.node.resources, []);
  assert.equal(mock.calls.some(call => call.operation === 'execute'), false);
}));

test('changed crystal source cannot prepare an action or silently import different coordinates', async () => withCif(async () => {
  const mock = backendMock();
  await assert.rejects(executeAiTool('import_crystal_structure', { source: 'cod', id: 'cod-9000001', sourceSha256: '0'.repeat(64) }, 'full', mock.backend, signal()), { code: 'AI_CRYSTAL_SOURCE_CHANGED' });
  assert.equal(mock.calls.some(call => ['prepare', 'execute'].includes(call.operation)), false);
}));

test('chat mode cannot fetch or apply an import action', async () => {
  const mock = backendMock();
  await assert.rejects(executeAiTool('import_crystal_structure', { source: 'cod', id: 'cod-9000001', sourceSha256 }, 'chat', mock.backend, signal()), { code: 'AI_PERMISSION_DENIED' });
  assert.equal(mock.calls.some(call => ['prepare', 'execute'].includes(call.operation)), false);
});

test('both database adapters match the exact shared backend import contract', async () => {
  const fixtures = JSON.parse(await readFile(new URL('./fixtures/crystal-database-imports.json', import.meta.url), 'utf8'));
  for (const [key, source] of [['cod', 'cod'], ['materialsProject', 'materials-project']] as const) {
    const expected = fixtures[key];
    const response = await searchCrystalDatabase(expected.materialId, { source, apiKey: source === 'materials-project' ? 'fixture-only' : undefined, fetcher: async () => source === 'cod' ? new Response(expected.sourceData.content) : Response.json({ data: [JSON.parse(expected.sourceData.content)] }) });
    const actual = response.materials[0];
    actual.provenance.retrievedAt = expected.provenance.retrievedAt;
    assert.deepEqual(actual, expected);
  }
});

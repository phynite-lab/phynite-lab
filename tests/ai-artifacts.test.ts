import test from 'node:test';
import assert from 'node:assert/strict';
import { aiArtifactComparable, aiArtifactCsv, aiArtifactDiff, aiArtifactGroup, latestAiArtifacts } from '../lib/ai-artifacts.ts';
import { aiTools, executeAiTool, type AiBackend } from '../lib/ai-tools.ts';
import { aiEffectivePermission, type AiArtifactSummary } from '../lib/ai-workbench.ts';

const artifact = (id: string, version?: number): AiArtifactSummary => ({ id, version, conversationId: 'aic_fixture', runId: 'air_fixture', artifactGroupId: version ? 'aig_fixture' : undefined, kind: 'report', status: 'complete', createdAt: '' });

test('one card per group retains the newest immutable version and legacy artifacts', () => {
  const items = [artifact('first', 1), artifact('legacy'), artifact('third', 3), artifact('second', 2)];
  assert.deepEqual(latestAiArtifacts(items).map(row => row.id), ['third', 'legacy']);
  assert.equal(aiArtifactGroup(items[1]), 'legacy');
});

test('CSV retains units, exact finite values, Unicode and quoting without spreadsheet formula execution', () => {
  const csv = aiArtifactCsv({ columns: [{ key: 'energy', label: 'Energy', unit: 'Ry', numeric: true }, { key: 'label', label: 'Label' }], rows: [{ energy: -12.3456789, label: '=IMPORTXML("https://example.invalid")' }, { energy: null, label: '科学, "source"\nsecond line' }], sourceIds: ['C1'] });
  assert.match(csv, /Energy \(Ry\)/); assert.match(csv, /-12.3456789/); assert.ok(csv.includes("'=")); assert.ok(csv.includes('科学, ""source""'));
});

test('bounded linear diff preserves unchanged context and explicitly marks removed/added text', () => {
  const diff = aiArtifactDiff('&SYSTEM\n ecutwfc=40\n/', '&SYSTEM\n ecutwfc=80\n/');
  assert.match(diff.text, /- ecutwfc=40/); assert.match(diff.text, /\+ ecutwfc=80/); assert.equal(diff.truncated, false);
  assert.equal(aiArtifactDiff('a\n'.repeat(20000), 'b\n'.repeat(20000), 100).truncated, true);
});

test('version comparisons retain actual typed values when the Markdown narrative is empty', () => {
  const input = { ...artifact('input'), kind: 'input_file' as const, text: '', contextManifest: [], evidence: [], modelId: 'fixture', sourceStamp: '', structuredData: { format: 'qe' as const, filename: 'qe.in', text: 'ecutwfc=80' } };
  assert.equal(aiArtifactComparable(input), 'ecutwfc=80');
  const table = { ...input, kind: 'table' as const, structuredData: { columns: [{ key: 'energy', label: 'Energy', unit: 'Ry' }], rows: [{ energy: -12.75 }], sourceIds: ['C1'] } };
  assert.match(aiArtifactComparable(table), /-12.75/);
  assert.match(aiArtifactComparable(table), /Ry/);
});

test('conversation artifacts remain available in every task mode without project mutation approvals', async () => {
  for (const task of ['work', 'plan', 'research', 'summary'] as const) for (const mode of ['chat', 'approval', 'full'] as const) {
    const effective = aiEffectivePermission(mode, task), names = aiTools(effective, false).map(tool => tool.name);
    for (const name of ['publish_artifact', 'update_artifact', 'read_artifact']) assert.ok(names.includes(name));
    const calls: Array<[string, unknown]> = [];
    const backend: AiBackend = async <T,>(op: string, payload?: Record<string, unknown>) => { calls.push([op, payload]); return { artifact: artifact('new', 1) } as T; };
    await executeAiTool('publish_artifact', { kind: 'report', title: 'Evidence', content: 'C1', status: 'complete' }, effective, backend, new AbortController().signal, 'artifact_call');
    assert.deepEqual(calls.map(([op]) => op), ['artifact_publish']);
    assert.equal((calls[0][1] as Record<string, unknown>).toolCallId, 'artifact_call');
    assert.ok(!names.includes('run_dft'));
  }
});

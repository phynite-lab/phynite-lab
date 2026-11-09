import test from 'node:test';
import assert from 'node:assert/strict';
import { aiQeCompute, configureAiQeCompute } from '../lib/ai-canvas.ts';
import { aiTools, compileAiDft, executeAiTool, type AiBackend, type AiContext } from '../lib/ai-tools.ts';
import { emptyProjectWorkflow } from '../lib/project-workflow.ts';
import { createDefaultQeDraft } from '../lib/qe-defaults.ts';
import { prepareNodes } from '../lib/project-workflow-control-compiler.ts';

const compute = { computeTarget: 'hpc', hpc: { clusterId: 'cluster-one', profileSha256: 'a'.repeat(64), nodes: 2, ranksPerNode: 16, wallSeconds: 3600, memoryMiBPerNode: 8192 } };
function graph() {
  return { ...emptyProjectWorkflow('p1'), nodes: [
    { id: 's', kind: 'structure' as const, name: 'Si', position: { x: 0, y: 0 }, resources: [{ kind: 'structure' as const, id: 'str1' }], configuration: { structure: { name: 'Si', atoms: [{ id: 'Si1', species: 'Si', x: 0, y: 0, z: 0 }], lattice: { a: 5, b: 5, c: 5, alpha: 90, beta: 90, gamma: 90 } } } },
    { id: 'qe', kind: 'scf' as const, name: 'SCF', position: { x: 1, y: 0 }, resources: [], configuration: { compilerVersion: 1, draft: { ...createDefaultQeDraft(), cutoffPolicy: 'manual', cutoff: 80, chargeDensityCutoff: 640 }, execution: { computeTarget: 'personal' }, vcpus: 4 } },
    { id: 'md', kind: 'md' as const, name: 'MD', position: { x: 2, y: 0 }, resources: [], configuration: {} },
  ], edges: [{ id: 'e', source: 's', target: 'qe', port: 'structure' as const }] };
}

test('HPC compute tools respect Chat and project permissions', () => {
  assert.ok(aiTools('chat', false).some(tool => tool.name === 'read_compute'));
  assert.ok(!aiTools('chat', true).some(tool => tool.name === 'configure_qe_compute'));
  assert.ok(!aiTools('full', false).some(tool => tool.name === 'configure_qe_compute'));
  assert.ok(aiTools('approval', true).some(tool => tool.name === 'configure_qe_compute'));
});

test('QE compute changes preserve exact science and other nodes, clear old wire allocation, and support personal selection', () => {
  const original = graph(), before = structuredClone(original);
  const saved = configureAiQeCompute(original, ['qe'], compute);
  assert.deepEqual(original, before);
  assert.deepEqual(saved.workflow.nodes[1].configuration.draft, before.nodes[1].configuration.draft);
  assert.deepEqual(saved.workflow.nodes[0], before.nodes[0]);
  assert.deepEqual(saved.workflow.nodes[2], before.nodes[2]);
  assert.deepEqual(saved.workflow.nodes[1].configuration.hpc, compute.hpc);
  assert.equal(saved.workflow.nodes[1].configuration.execution, undefined);
  assert.equal(saved.workflow.nodes[1].configuration.vcpus, undefined);
  const personal = configureAiQeCompute(saved.workflow, ['qe'], { computeTarget: 'personal' });
  assert.equal(personal.workflow.nodes[1].configuration.hpc, undefined);
});

test('AI rejects remote MD, made-up compute fields, unknown nodes, missing checksums and auto restart', () => {
  for (const ids of [['md'], ['s'], ['missing'], ['qe', 'qe']]) assert.throws(() => configureAiQeCompute(graph(), ids, compute));
  for (const input of [{ computeTarget: 'shared' }, { ...compute, executionAffinity: {} }, { ...compute, hpc: { ...compute.hpc, profileSha256: undefined } }, { ...compute, hpc: { ...compute.hpc, nodes: 0 } }, { ...compute, hpc: { ...compute.hpc, autoRestartOnWalltime: true } }]) assert.throws(() => aiQeCompute(input));
});

test('a saved QE draft configured by AI compiles without requiring another editor save', () => {
  const saved = configureAiQeCompute(graph(), ['qe'], compute);
  const compiled = prepareNodes(saved.workflow, ['qe']).qe;
  assert.equal(compiled.issue, undefined);
  assert.match(String(compiled.execution?.qeInput), /ecutwfc\s*=\s*80/);
  assert.equal(compiled.execution?.computeTarget, 'hpc');
});

test('read_compute and monitoring use read operations; compute configuration uses normal approval without submission', async () => {
  const calls: string[] = [];
  let payload: Record<string, unknown> = {};
  const backend: AiBackend = async <T,>(operation: string, input?: Record<string, unknown>) => {
    calls.push(operation);
    if (operation === 'context') return { project: { id: 'p1', kind: 'canvas', name: 'Research' }, stamp: 'stamp' } as T;
    if (operation === 'canvas') return { workflow: graph(), revision: 3 } as T;
    if (operation === 'prepare') { payload = input!; return { action: { id: 'action1', status: 'pending', payloadHash: 'hash' } } as T; }
    return { clusters: [compute.hpc], status: 'RUNNING' } as T;
  };
  await executeAiTool('read_compute', {}, 'chat', backend, new AbortController().signal);
  await executeAiTool('read_resource', { kind: 'calculation', id: 'calc1' }, 'chat', backend, new AbortController().signal);
  const action = await executeAiTool('configure_qe_compute', { nodeIds: ['qe'], compute }, 'approval', backend, new AbortController().signal);
  assert.equal(action.awaitingApproval, true);
  assert.deepEqual(calls, ['compute', 'read', 'context', 'canvas', 'prepare']);
  assert.equal(payload.kind, 'save_workflow');
  assert.equal((payload.payload as { baseRevision: number }).baseRevision, 3);
});

test('legacy DFT HPC selection preserves compiled science and saved target', () => {
  const context: AiContext = { project: { id: 'p1', kind: 'dft', name: 'Research', remoteId: null }, stamp: 's', workspaceRevision: 1, resources: {}, workspace: { materials: [{ id: 'm1', name: 'Si', formula: 'Si', atoms: [{ id: 'Si1', species: 'Si', x: 0, y: 0, z: 0 }], lattice: { a: 5, b: 5, c: 5, alpha: 90, beta: 90, gamma: 90 } }], configurations: [] } };
  const input = { materialId: 'm1', name: 'SCF', calculation: 'Total energy', settingsPatch: {} };
  const personal = compileAiDft(context, input), hpc = compileAiDft(context, { ...input, compute });
  assert.deepEqual(hpc.submission, personal.submission);
  assert.deepEqual(hpc.compute, compute);
  context.workspace!.configurations.push({ id: 'cfg1', materialId: 'm1', calculation: 'Total energy', draft: hpc.draft, ...compute } as NonNullable<AiContext['workspace']>['configurations'][number]);
  assert.deepEqual(compileAiDft(context, { ...input, configurationId: 'cfg1' }).compute, compute);
});

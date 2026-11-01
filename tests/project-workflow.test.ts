import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultQeDraft } from '../lib/qe-defaults.ts';
import { compileWorkflowDft, workflowQeDraft } from '../lib/project-workflow-compiler.ts';
import { emptyProjectWorkflow, parseProjectWorkflow, workflowConnectionError, workflowFingerprints, workflowOrder, copyWorkflowNodes, pasteWorkflowNodes, type ProjectWorkflow, type WorkflowNode } from '../lib/project-workflow.ts';

const node = (id: string, kind: WorkflowNode['kind']): WorkflowNode => ({ id, kind, name: id, position: { x: 0, y: 0 }, configuration: {}, resources: [] });
function branched(): ProjectWorkflow {
  return { ...emptyProjectWorkflow('prj_1'), nodes: [node('structure', 'structure'), node('scf', 'scf'), node('bands', 'bands'), node('dos', 'dos'), node('btp2', 'btp2'), node('figure', 'figure')], edges: [
    { id: 'a', source: 'structure', target: 'scf', port: 'structure' },
    ...['bands', 'dos', 'btp2'].map(id => ({ id, source: 'scf', target: id, port: 'electronic' as const })),
    { id: 'f', source: 'bands', target: 'figure', port: 'dataset' },
  ] };
}
test('shared prerequisites appear exactly once and cycles / invalid ports fail', () => {
  const graph = parseProjectWorkflow(branched());
  const selected = workflowOrder(graph, ['bands', 'dos', 'btp2']);
  assert.equal(selected.filter(id => id === 'scf').length, 1);
  assert.equal(selected.length, 5);
  assert.match(workflowConnectionError(graph, { source: 'dos', target: 'scf', port: 'structure' })!, /incompatible/);
  graph.nodes.push(node('figure2', 'figure'));
  assert.match(workflowConnectionError(graph, { source: 'figure', target: 'figure2', port: 'dataset' })!, /output/);
  graph.nodes.push(node('relax1', 'relax'), node('relax2', 'relax'));
  graph.edges.push({ id: 'r1', source: 'relax1', target: 'relax2', port: 'structure' });
  assert.match(workflowConnectionError(graph, { source: 'relax2', target: 'relax1', port: 'structure' })!, /cycle/);
});
test('layout, names and groups do not invalidate scientific state; SCF changes invalidate descendants only', async () => {
  const graph = branched(), before = await workflowFingerprints(graph);
  const moved = structuredClone(graph); moved.nodes[1].name = 'Renamed'; moved.nodes[1].position = { x: 240, y: 120 };
  assert.deepEqual(await workflowFingerprints(moved), before);
  graph.nodes[1].configuration = { cutoffRy: 80 };
  const changed = await workflowFingerprints(graph);
  assert.equal(changed.structure, before.structure);
  for (const id of ['scf', 'bands', 'dos', 'btp2', 'figure']) assert.notEqual(changed[id], before[id]);
});
test('clipboard preserves internal connections and configuration, rejects cross-project local paste', () => {
  const graph = branched(), clipboard = copyWorkflowNodes(graph, ['scf', 'bands'], 4);
  let id = 0;
  const pasted = pasteWorkflowNodes(graph, clipboard, () => `copied_${id++}`);
  assert.equal(pasted.nodes.length, 8); assert.equal(pasted.edges.length, graph.edges.length + 1);
  assert.equal(pasted.edges.at(-1)?.source, 'copied_0');
  assert.throws(() => pasteWorkflowNodes({ ...graph, projectId: 'other' }, clipboard, () => 'no'), /project API/);
});
test('untrusted graphs reject duplicates, bad coordinates, foreign identities and unsupported resource hashes', () => {
  const graph = branched();
  assert.throws(() => parseProjectWorkflow(graph, 'foreign'));
  assert.throws(() => parseProjectWorkflow({ ...graph, nodes: [...graph.nodes, graph.nodes[0]] }));
  graph.nodes[0].position.x = Infinity; assert.throws(() => parseProjectWorkflow(graph));
  graph.nodes[0].position.x = 0; graph.nodes[0].resources = [{ kind: 'structure', id: 's', sha256: 'bad' }];
  assert.throws(() => parseProjectWorkflow(graph));
});

test('MD stage display names do not invalidate results while enabled state and parameters do', async () => {
  const graph = emptyProjectWorkflow('p'); graph.nodes.push({ ...node('md', 'md'), configuration: { components: [{ id: 'stage', name: 'NVT', selected: true, config: { name: 'NVT', tempStartK: 300 } }], execution: { workflow: 'derived' } } });
  const before = await workflowFingerprints(graph);
  const stages = graph.nodes[0].configuration.components as Array<{ name: string; selected: boolean; config: { name: string; tempStartK: number } }>;
  stages[0].name = 'Renamed'; stages[0].config.name = 'Renamed';
  assert.deepEqual(await workflowFingerprints(graph), before);
  stages[0].selected = false; assert.notDeepEqual(await workflowFingerprints(graph), before);
  stages[0].selected = true; stages[0].config.tempStartK = 450; assert.notDeepEqual(await workflowFingerprints(graph), before);
});

test('shared SCF keeps fatband projection as a branch choice and preserves the exact source input', () => {
  const graph = branched(), source = graph.nodes.find(node => node.id === 'scf')!, bands = graph.nodes.find(node => node.id === 'bands')!;
  graph.nodes[0].configuration.structure = { name: 'Si fixture', atoms: [{ species: 'Si', x: 0, y: 0, z: 0 }], lattice: { a: 5, b: 5, c: 5, alpha: 90, beta: 90, gamma: 90 } };
  graph.nodes[0].resources = [{ kind: 'structure', id: 'saved-structure' }];
  source.configuration.draft = { ...createDefaultQeDraft(), projectedBands: false };
  bands.configuration.draft = { projectedBands: true };
  assert.equal(workflowQeDraft(graph, bands).projectedBands, true);
  const files = (node: WorkflowNode) => compileWorkflowDft(graph, node, 'fixture').inputFiles as Record<string, string>;
  const projected = files(bands), scf = files(source);
  assert.ok('projwfc.in' in projected);
  assert.equal(projected['scf.in'], scf['scf.in']);
  source.configuration.draft = { ...source.configuration.draft as object, projectedBands: true };
  bands.configuration.draft = { projectedBands: false };
  assert.equal(workflowQeDraft(graph, bands).projectedBands, false);
  assert.ok(!('projwfc.in' in files(bands)));
});

test('DFT execution compiler forwards resource allocation without changing scientific inputs', () => {
  const graph = branched(), source = graph.nodes.find(node => node.id === 'scf')!;
  graph.nodes[0].configuration.structure = { name: 'Si', atoms: [{ species: 'Si', x: 0, y: 0, z: 0 }], lattice: { a: 5, b: 5, c: 5, alpha: 90, beta: 90, gamma: 90 } };
  graph.nodes[0].resources = [{ kind: 'structure', id: 'saved' }];
  source.configuration.draft = createDefaultQeDraft();
  const before = compileWorkflowDft(graph, source, 'fixture');
  source.configuration = { ...source.configuration, computeTarget: 'personal', vcpus: 3, memoryMiB: 6144, estimatedComputeSeconds: 90 };
  const after = compileWorkflowDft(graph, source, 'fixture');
  assert.equal(after.vcpus, 3);
  assert.equal(after.memoryMiB, 6144);
  assert.equal('estimatedComputeSeconds' in after, false);
  assert.deepEqual(after.inputFiles, before.inputFiles);
  assert.deepEqual(after.settings, before.settings);
});

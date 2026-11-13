import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutWorkflow, frozenCanvasPreview, canvasPreviewCurrent, canvasPreviewChanges } from '../lib/workflow-auto-layout.ts';
import { emptyProjectWorkflow, type ProjectWorkflow, type WorkflowNode } from '../lib/project-workflow.ts';

const node = (id: string, kind: WorkflowNode['kind'], x = 0, y = 0): WorkflowNode => ({ id, name: id, kind, position: { x, y }, configuration: {}, resources: [] });
function fixture(): ProjectWorkflow {
  return { ...emptyProjectWorkflow('prj_layout'), nodes: [node('s', 'structure'), node('scf', 'scf'), node('bands', 'bands'), node('dos', 'dos'), node('fixed', 'structure', 1000, 1000)],
    edges: [{ id: 'e1', source: 's', target: 'scf', port: 'structure' }, { id: 'e2', source: 'scf', target: 'bands', port: 'electronic' }, { id: 'e3', source: 'scf', target: 'dos', port: 'electronic' }],
    groups: [{ id: 'analysis', name: 'Electronic analysis', nodeIds: ['bands', 'dos'] }] };
}
test('layered layout is deterministic for DAG/group/port input regardless of storage order and preserves science', async () => {
  const graph = fixture(), before = structuredClone(graph), sizes = { bands: { width: 300, height: 240 }, dos: { width: 230, height: 320 } };
  const first = await layoutWorkflow(graph, [], 'all', sizes), second = await layoutWorkflow({ ...graph, nodes: [...graph.nodes].reverse(), edges: [...graph.edges].reverse() }, [], 'all', sizes);
  assert.deepEqual(first.nodes.map(n => [n.id, n.position]).sort(), second.nodes.map(n => [n.id, n.position]).sort());
  assert.deepEqual(graph, before);
  const pos = Object.fromEntries(first.nodes.map(n => [n.id, n.position]));
  assert.ok(pos.s.x < pos.scf.x && pos.scf.x < pos.bands.x && pos.scf.x < pos.dos.x);
  assert.ok(Math.abs(pos.bands.y - pos.dos.y) >= (pos.bands.y < pos.dos.y ? 240 : 320));
  assert.deepEqual(first.edges, graph.edges); assert.deepEqual(first.groups, graph.groups);
  for (const n of first.nodes) { const source = before.nodes.find(old => old.id === n.id)!; assert.deepEqual(n.configuration, source.configuration); assert.deepEqual(n.resources, source.resources); }
});
test('touched layout expands a group, keeps all outside positions exact and avoids fixed nodes', async () => {
  const graph = fixture(); graph.nodes[4].position = { x: 12, y: 12 };
  const next = await layoutWorkflow(graph, ['bands']);
  for (const id of ['s', 'scf', 'fixed']) assert.deepEqual(next.nodes.find(n => n.id === id), graph.nodes.find(n => n.id === id));
  for (const n of next.nodes.filter(n => ['bands', 'dos'].includes(n.id))) assert.ok(n.position.y >= 164);
  const byGroup = await layoutWorkflow(graph, ['analysis']);
  assert.deepEqual(next, byGroup);
  assert.deepEqual(await layoutWorkflow(graph, []), graph);
  await assert.rejects(layoutWorkflow(graph, ['bands'], 'touched', { bands: { width: NaN, height: 120 } }), /dimensions/);
});
test('frozen preview retains exact coordinates and rejects graph/revision/expiry/project drift', async () => {
  const graph = fixture(), proposal = await layoutWorkflow(graph, [], 'all');
  const preview = frozenCanvasPreview(graph, { conversationId: 'aic_test', actionId: 'aia_test', payloadHash: 'a'.repeat(64), expiresAt: 2000, baseRevision: 7, workflow: proposal });
  proposal.nodes[0].position.x = 99999;
  assert.notEqual(preview.workflow.nodes[0].position.x, 99999);
  assert.equal(canvasPreviewCurrent(preview, graph, 7, 1000000), true);
  assert.equal(canvasPreviewCurrent(preview, graph, 8, 1000000), false);
  assert.equal(canvasPreviewCurrent(preview, graph, 7, 2000000), false);
  const changed = structuredClone(graph); changed.nodes[0].name = 'edited';
  assert.equal(canvasPreviewCurrent(preview, changed, 7, 1000000), false);
  assert.throws(() => frozenCanvasPreview({ ...graph, projectId: 'other' }, preview), /workflow/);
});
test('ghost diff contains removed/added/edge-only changes and grouped changes', () => {
  const graph = fixture(), next = structuredClone(graph); next.edges.pop();
  assert.deepEqual([...canvasPreviewChanges(graph, next).edges], ['e3']);
  next.nodes.find(n => n.id === 'bands')!.position.y = 300;
  const changes = canvasPreviewChanges(graph, next);
  assert.ok(changes.nodes.has('bands')); assert.ok(changes.groups.has('analysis')); assert.ok(changes.edges.has('e2'));
});

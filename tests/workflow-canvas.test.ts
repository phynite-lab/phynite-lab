import assert from 'node:assert/strict';
import test from 'node:test';
import { alignCanvasSelection, snapCanvasPositions } from '../lib/workflow-canvas.ts';
import { copyWorkflowNodes, parseWorkflowClipboard, pasteWorkflowSelection, workflowFingerprints, type ProjectWorkflow } from '../lib/project-workflow.ts';
const graph = (): ProjectWorkflow => ({ version: 1, projectId: 'p', nodes: ['a', 'b', 'c'].map((id, index) => ({ id, kind: index ? 'scf' : 'structure', name: id, position: { x: index * 300, y: index * 150 }, configuration: { draft: { cutoff: 72 }, result: { success: true } }, resources: [] })), edges: [{ id: 'e', source: 'a', target: 'b', port: 'structure' }], groups: [] });

test('guides take priority over grid in screen pixels and Alt bypass preserves rigid selection', () => {
  const g = graph(), sizes = { a: { width: 100, height: 80 }, b: { width: 100, height: 80 }, c: { width: 100, height: 80 } };
  const desired = { a: { x: 297, y: 45 } };
  const guided = snapCanvasPositions(g, ['a'], desired, sizes, 1, { grid: true, guides: true });
  assert.equal(guided.positions.a.x, 300); assert.equal(guided.positions.a.y, 48);
  assert.deepEqual(guided.guides, [{ axis: 'x', position: 300 }]);
  assert.equal(snapCanvasPositions(g, ['a'], desired, sizes, 2.5, { grid: true, guides: true }).positions.a.x, 288);
  assert.deepEqual(snapCanvasPositions(g, ['a'], desired, sizes, 1, { grid: true, guides: true }, true).positions, desired);
  const multi = snapCanvasPositions(g, ['a', 'b'], { a: { x: 27, y: 27 }, b: { x: 327, y: 177 } }, sizes, .5, { grid: true, guides: false });
  assert.deepEqual(multi.positions, { a: { x: 24, y: 24 }, b: { x: 324, y: 174 } });
});

test('align/distribute use measured dimensions and preserve whole group geometry and science', async () => {
  const g = graph(), sizes = { a: { width: 100, height: 80 }, b: { width: 200, height: 100 }, c: { width: 100, height: 80 } };
  const before = await workflowFingerprints(g);
  const aligned = alignCanvasSelection(g, ['a', 'b', 'c'], sizes, 'right');
  assert.deepEqual(aligned.nodes.map(node => node.position.x), [600, 500, 600]);
  const distributed = alignCanvasSelection(g, ['a', 'b', 'c'], sizes, 'horizontal');
  assert.deepEqual(distributed.nodes.map(node => node.position.x), [0, 250, 600]);
  assert.deepEqual(await workflowFingerprints(distributed), before);
  g.groups = [{ id: 'g', name: 'Pair', nodeIds: ['a', 'b'] }];
  const grouped = alignCanvasSelection(g, ['g', 'c'], sizes, 'top');
  assert.equal(grouped.nodes[1].position.y - grouped.nodes[0].position.y, 150);
  assert.equal(grouped.nodes[2].position.y, 0);
});

test('clipboard v2 keeps selected groups, internal edges, anchors and snapshot after Cut with fresh identities', () => {
  const g = graph(); g.groups = [{ id: 'g', name: 'Pair', nodeIds: ['a', 'b'] }];
  g.nodes[0].groupId = 'g'; g.nodes[1].groupId = 'g';
  const copied = copyWorkflowNodes(g, ['a', 'b'], 4, { e: { source: 'bottom', target: 'top' } });
  assert.equal(copied.nodes[0].configuration.result, undefined);
  const empty = { ...g, nodes: [], edges: [], groups: [] }; let next = 0;
  const pasted = pasteWorkflowSelection(empty, copied, () => `new${next++}`, { x: 96, y: 144 });
  assert.deepEqual(pasted.workflow.nodes.map(node => node.position), [{ x: 96, y: 144 }, { x: 396, y: 294 }]);
  assert.equal(pasted.workflow.groups[0].id, pasted.workflow.nodes[0].groupId);
  assert.deepEqual(pasted.edgeAnchors[Object.values(pasted.edgeIds)[0]], { source: 'bottom', target: 'top' });
  assert.deepEqual(copyWorkflowNodes(g, ['b'], 4).groups, []);
  assert.deepEqual(copyWorkflowNodes(g, ['b'], 4).edges, []);
  assert.deepEqual(parseWorkflowClipboard({ phyniteWorkflow: { ...copied, version: 1 } }).groups, []);
  assert.throws(() => parseWorkflowClipboard({ ...copied, edges: [{ ...copied.edges[0], target: 'missing' }] }));
  assert.throws(() => parseWorkflowClipboard({ ...copied, nodes: [] }));
});

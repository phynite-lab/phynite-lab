import test from 'node:test';
import assert from 'node:assert/strict';
import { workflowNodeSummary, workflowPathFocus } from '../lib/workflow-canvas-presentation.ts';
import { canvasSelection } from '../lib/workflow-canvas.ts';
import { emptyProjectWorkflow, type ProjectWorkflow, type WorkflowNode } from '../lib/project-workflow.ts';

const node = (id: string, kind: WorkflowNode['kind']): WorkflowNode => ({ id, kind, name: id, position: { x: 0, y: 0 }, configuration: {}, resources: [] });
const graph: ProjectWorkflow = { ...emptyProjectWorkflow('test'), nodes: [node('s', 'structure'), node('scf', 'scf'), node('bands', 'bands'), node('dos', 'dos'), node('figure', 'figure'), node('other', 'md')], edges: [
  { id: 's-scf', source: 's', target: 'scf', port: 'structure' },
  { id: 'bands', source: 'scf', target: 'bands', port: 'electronic' },
  { id: 'dos', source: 'scf', target: 'dos', port: 'electronic' },
  { id: 'figure', source: 'bands', target: 'figure', port: 'dataset' },
] };

test('SCF focus includes its prerequisite and all descendants without unrelated nodes', () => {
  const before = structuredClone(graph), focus = workflowPathFocus(graph, ['scf']);
  assert.deepEqual([...focus.edges].sort(), ['bands', 'dos', 'figure', 's-scf']);
  assert.equal(focus.nodes.has('other'), false);
  assert.deepEqual(graph, before);
});
test('analysis focus follows its own path without highlighting sibling analyses', () => {
  const focus = workflowPathFocus(graph, ['bands']);
  assert.deepEqual([...focus.edges].sort(), ['bands', 'figure', 's-scf']);
  assert.equal(focus.nodes.has('dos'), false);
  assert.equal(focus.nodes.has('figure'), true);
});
test('group focus expands members and selecting only an edge emphasizes its endpoints', () => {
  const grouped = { ...graph, groups: [{ id: 'g', name: 'Analyses', nodeIds: ['bands', 'dos'] }] };
  assert.equal(workflowPathFocus(grouped, canvasSelection(grouped, ['g'])).edges.size, 4);
  const edge = workflowPathFocus(graph, [], ['bands']);
  assert.deepEqual([...edge.nodes].sort(), ['bands', 'scf']);
  assert.equal(edge.edges.size, 1);
  assert.equal(workflowPathFocus(graph, ['removed'], ['removed']).active, false);
});
test('node summaries reflect saved composition and real wiring, omit malformed inputs', () => {
  const structure = { ...graph.nodes[0], configuration: { structure: { atoms: [{ species: 'Si' }, { species: 'Si' }] } } };
  assert.deepEqual(workflowNodeSummary(graph, structure).composition, { formula: 'Si', atoms: 2 });
  assert.deepEqual(workflowNodeSummary(graph, graph.nodes[1]), { composition: undefined, sources: ['s'], outputs: 2 });
  for (const atoms of [[null], [{ species: 12 }], [{ species: 'Si', occupancy: -1 }], []]) {
    assert.equal(workflowNodeSummary(graph, { ...structure, configuration: { structure: { atoms } } }).composition, undefined);
  }
});

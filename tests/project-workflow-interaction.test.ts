import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyProjectWorkflow, parseProjectWorkflow, type WorkflowNode } from '../lib/project-workflow.ts';
import { workflowCanvasConnection, workflowConnectionAnchors, workflowModuleChoices, workflowNewNodeConnection } from '../lib/project-workflow-interaction.ts';
const node = (id: string, kind: WorkflowNode['kind']): WorkflowNode => ({ id, kind, name: id, configuration: {}, resources: [], position: { x: 0, y: 0 } });
const graph = { ...emptyProjectWorkflow('p'), nodes: [node('s', 'structure'), node('scf', 'scf'), node('bands', 'bands'), node('fig', 'figure'), node('relax1', 'relax'), node('relax2', 'relax')] };

test('canvas validates typed handles, occupied inputs, duplicate edges and cycles before accepting a drop', () => {
  const connect = { source: 's', target: 'scf', sourceHandle: 'structure', targetHandle: 'structure' };
  const edge = workflowCanvasConnection(graph, connect);
  assert.deepEqual(edge, { source: 's', target: 'scf', port: 'structure' });
  assert.equal(workflowCanvasConnection(graph, { ...connect, target: 'bands', targetHandle: 'electronic' }), null);
  assert.equal(workflowCanvasConnection(graph, { ...connect, sourceHandle: null }), null);
  assert.equal(workflowCanvasConnection(graph, { ...connect, target: 'missing' }), null);
  const linked = { ...graph, edges: [{ ...edge!, id: 'e' }, { id: 'r', source: 'relax1', target: 'relax2', port: 'structure' as const }] };
  assert.equal(workflowCanvasConnection(linked, connect), null);
  assert.equal(workflowCanvasConnection(linked, { ...connect, source: 'relax1' }), null);
  assert.equal(workflowCanvasConnection(linked, { ...connect, source: 'relax2', target: 'relax1' }), null);
  assert.equal(workflowCanvasConnection(graph, { source: 'fig', target: 'fig', sourceHandle: 'dataset', targetHandle: 'dataset' }), null);
  parseProjectWorkflow(linked);
});

test('module picker follows drag direction and every offered choice creates a valid graph', () => {
  assert.deepEqual(workflowModuleChoices(graph, { nodeId: 's', type: 'source' }), ['scf', 'relax', 'md']);
  assert.deepEqual(workflowModuleChoices(graph, { nodeId: 'bands', type: 'target' }), ['scf']);
  assert.deepEqual(workflowModuleChoices(graph, { nodeId: 'scf', type: 'target' }), ['structure', 'relax', 'extract-frame']);
  assert.deepEqual(workflowModuleChoices(graph, { nodeId: 'fig', type: 'source' }), []);
  assert.deepEqual(workflowModuleChoices(graph, { nodeId: 'missing', type: 'source' }), []);
  for (const current of graph.nodes) for (const type of ['source', 'target'] as const) {
    const anchor = { nodeId: current.id, type };
    for (const kind of workflowModuleChoices(graph, anchor)) {
      const added = node('added', kind), edge = workflowNewNodeConnection(graph, added, anchor);
      assert.ok(edge);
      parseProjectWorkflow({ ...graph, nodes: [...graph.nodes, added], edges: [{ ...edge, id: 'new' }] });
      assert.equal(type === 'target' ? edge.target : edge.source, current.id);
    }
  }
  const occupied = { ...graph, edges: [{ id: 'e', source: 's', target: 'scf', port: 'structure' as const }] };
  assert.deepEqual(workflowModuleChoices(occupied, { nodeId: 'scf', type: 'target' }), []);
});

test('top and bottom handles preserve typed ports and reject invalid endpoint directions', () => {
  for (const sourceHandle of ['structure', 'structure:bottom']) for (const targetHandle of ['structure', 'structure:top']) {
    const edge = workflowCanvasConnection(graph, { source: 's', target: 'scf', sourceHandle, targetHandle });
    assert.deepEqual(edge, { source: 's', target: 'scf', port: 'structure' });
    parseProjectWorkflow({ ...graph, edges: [{ ...edge!, id: 'vertical' }] });
    assert.deepEqual(workflowConnectionAnchors({ sourceHandle, targetHandle }), { source: sourceHandle.endsWith(':bottom') ? 'bottom' : 'right', target: targetHandle.endsWith(':top') ? 'top' : 'left' });
  }
  for (const sourceHandle of ['structure:top', 'structure:left', 'structure:bottom:bottom']) assert.equal(workflowCanvasConnection(graph, { source: 's', target: 'scf', sourceHandle, targetHandle: 'structure:top' }), null);
  for (const targetHandle of ['structure:bottom', 'structure:right', 'electronic:top']) assert.equal(workflowCanvasConnection(graph, { source: 's', target: 'scf', sourceHandle: 'structure:bottom', targetHandle }), null);
  assert.equal(workflowCanvasConnection(graph, { source: 's', target: 'bands', sourceHandle: 'structure:bottom', targetHandle: 'electronic:top' }), null);
  const linked = { ...graph, edges: [{ id: 'r', source: 'relax1', target: 'relax2', port: 'structure' as const }] };
  assert.equal(workflowCanvasConnection(linked, { source: 'relax2', target: 'relax1', sourceHandle: 'structure:bottom', targetHandle: 'structure:top' }), null);
});

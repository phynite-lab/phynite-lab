import assert from 'node:assert/strict';
import test from 'node:test';
import { nextWorkflowModuleName, workflowModuleTree } from '../lib/workflow-navigation.ts';
import { emptyProjectWorkflow, type WorkflowNode } from '../lib/project-workflow.ts';
const node = (id: string): WorkflowNode => ({ id, name: id, kind: 'scf', position: { x: 0, y: 0 }, configuration: { draft: { cutoff: 60 } }, resources: [] });

test('one SCF and multiple analyses form one stable hierarchy without mutating graph or extra inputs', () => {
  const graph = { ...emptyProjectWorkflow('project'), nodes: ['structure', 'scf', 'bands', 'dos', 'figure', 'independent'].map(node), edges: [
    { id: 'one', source: 'structure', target: 'scf', port: 'structure' as const },
    { id: 'two', source: 'scf', target: 'bands', port: 'electronic' as const },
    { id: 'three', source: 'scf', target: 'dos', port: 'electronic' as const },
    { id: 'four', source: 'bands', target: 'figure', port: 'dataset' as const },
    { id: 'five', source: 'dos', target: 'figure', port: 'dataset' as const },
  ] };
  const original = structuredClone(graph), tree = workflowModuleTree(graph);
  assert.deepEqual(tree.map(entry => [entry.node.id, entry.parentId, entry.depth]), [
    ['structure', undefined, 0], ['scf', 'structure', 1], ['bands', 'scf', 2], ['figure', 'bands', 3], ['dos', 'scf', 2], ['independent', undefined, 0],
  ]);
  assert.deepEqual(tree.find(entry => entry.node.id === 'figure')?.additionalInputs, ['dos']);
  assert.deepEqual(workflowModuleTree({ ...graph, edges: [...graph.edges].reverse() }), tree);
  assert.deepEqual(graph, original);
  const disconnected = workflowModuleTree({ ...graph, edges: graph.edges.filter(edge => edge.target !== 'scf') });
  assert.equal(disconnected.find(entry => entry.node.id === 'scf')?.parentId, undefined);
});

test('hierarchy safely handles stale connections, duplicate edges and malformed cycles without losing nodes', () => {
  const graph = { nodes: ['a', 'b', 'c'].map(node), edges: [
    { id: '1', source: 'a', target: 'b', port: 'electronic' as const },
    { id: '2', source: 'b', target: 'c', port: 'electronic' as const },
    { id: '3', source: 'c', target: 'a', port: 'electronic' as const },
    { id: '4', source: 'missing', target: 'a', port: 'electronic' as const },
    { id: '5', source: 'a', target: 'b', port: 'electronic' as const },
    { id: '6', source: 'a', target: 'a', port: 'electronic' as const },
  ] };
  const tree = workflowModuleTree(graph);
  assert.equal(tree.length, 3); assert.equal(new Set(tree.map(entry => entry.node.id)).size, 3);
  assert.equal(tree.filter(entry => !entry.parentId).length, 1);
});

test('duplicate additions get unambiguous numeric names without renaming custom modules', () => {
  const names = ['Crystal structure', 'Crystal structure (2)', 'Crystal structure (4)', 'Custom sample'].map(name => ({ name }));
  assert.equal(nextWorkflowModuleName(names, 'Crystal structure'), 'Crystal structure (3)');
  assert.equal(nextWorkflowModuleName(names, 'SCF / Total energy'), 'SCF / Total energy');
  assert.equal(nextWorkflowModuleName([{ name: ' crystal STRUCTURE ' }], 'Crystal structure'), 'Crystal structure (2)');
  assert.equal(names[0].name, 'Crystal structure');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { workflowFigureBinding, workflowFigureInputs, workflowFigurePhase } from '../lib/workflow-figure-state.ts';
import { emptyProjectWorkflow, type WorkflowAttempt, type WorkflowNode } from '../lib/project-workflow.ts';

const attempt = (status: WorkflowAttempt['status']): WorkflowAttempt => ({ nodeId: 'figure', fingerprint: 'f', status });
const binding = { figureRevision: 'a'.repeat(64), sources: [{ nodeId: 'bands', result: { jobId: 'calc_1', jobKind: 'CALCULATION' } }, { nodeId: 'md', result: { jobId: 'analysis_1', jobKind: 'MD_ANALYSIS' } }] };
test('Figure accepts only prepared retained numerical bindings, including multiple source types', () => {
  assert.deepEqual(workflowFigureBinding(binding), binding);
  for (const invalid of [undefined, {}, { ...binding, figureRevision: undefined }, { ...binding, figureRevision: 'undefined' }, { ...binding, sources: [] }, { ...binding, sources: [null] }, { ...binding, sources: [binding.sources[0], binding.sources[0]] }, ...[{}, { nodeId: 'bands' }, { nodeId: 'bands', result: { jobId: ' ', jobKind: 'CALCULATION' } }, { nodeId: 'md', result: { jobId: 'simulation', jobKind: 'MD_SIMULATION' } }].map(source => ({ ...binding, sources: [source] }))]) {
    assert.throws(() => workflowFigureBinding(invalid), /valid source binding/);
  }
});
test('result metadata alone never turns queued or failed Figure attempts into an endless loading state', () => {
  assert.equal(workflowFigurePhase(), 'idle');
  for (const status of ['pending', 'queued', 'running'] as const) assert.equal(workflowFigurePhase({ ...attempt(status), result: binding }), 'running');
  for (const status of ['failed', 'blocked', 'cancelled'] as const) assert.equal(workflowFigurePhase({ ...attempt(status), result: binding }), 'failed');
  for (const status of ['ready', 'reused'] as const) assert.equal(workflowFigurePhase(attempt(status)), 'ready');
  assert.equal(workflowFigurePhase(attempt('completed')), 'idle');
});
test('Figure source list follows incoming dataset edges and latest attempts, excluding unrelated modules', () => {
  const graph = emptyProjectWorkflow('project');
  graph.nodes = ['figure', 'bands', 'dos', 'other'].map(id => ({ id, kind: id === 'figure' ? 'figure' : 'bands', name: id, position: { x: 0, y: 0 }, configuration: {}, resources: [] } as WorkflowNode));
  graph.edges = [{ id: 'a', source: 'bands', target: 'figure', port: 'dataset' }, { id: 'b', source: 'dos', target: 'figure', port: 'dataset' }, { id: 'c', source: 'other', target: 'bands', port: 'electronic' }];
  const latest = { ...attempt('failed'), nodeId: 'bands', error: 'Not converged' }, older = { ...attempt('completed'), nodeId: 'bands' };
  const inputs = workflowFigureInputs(graph, 'figure', [latest, older]);
  assert.deepEqual(inputs.map(input => input.node.id), ['bands', 'dos']);
  assert.equal(inputs[0].attempt, latest); assert.equal(inputs[1].attempt, undefined);
  assert.deepEqual(workflowFigureInputs(graph, 'other', [latest]), []);
});

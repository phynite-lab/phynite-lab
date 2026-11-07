import test from 'node:test';
import assert from 'node:assert/strict';
import { editAiCanvas, aiCanvasCatalogue } from '../lib/ai-canvas.ts';
import { aiCapabilities, aiOutputTokens, isAiEffort } from '../lib/ai-contract.ts';
import { aiConversationTab, restoreWorkflowEditor, workflowEditorReducer, initialWorkflowEditorState } from '../lib/workflow-editor-state.ts';
import { emptyProjectWorkflow, parseProjectWorkflow, type ProjectWorkflow } from '../lib/project-workflow.ts';
import { workflowQeDraft } from '../lib/project-workflow-compiler.ts';

function fixture(): ProjectWorkflow {
  return { ...emptyProjectWorkflow('project_1'), nodes: [
    { id: 's', kind: 'structure', name: 'Silicon', position: { x: 0, y: 0 }, resources: [], configuration: { structure: { name: 'Si', atoms: [{ id: 'Si1', species: 'Si', x: 0, y: 0, z: 0 }], lattice: { a: 5, b: 5, c: 5, alpha: 90, beta: 90, gamma: 90, periodic: [true, true, true] } } } },
    { id: 'scf', kind: 'scf', name: 'Reference SCF', position: { x: 300, y: 0 }, resources: [], configuration: { draft: { cutoffPolicy: 'manual', cutoff: 80, chargeDensityCutoff: 640, totalCharge: 0.1 }, pseudopotentials: { Si: 'verified-source' } } },
  ], edges: [{ id: 'e', source: 's', target: 'scf', port: 'structure' }] };
}
test('model-generated malformed whole graphs fail while structured operations create a valid analysis chain', async () => {
  assert.throws(() => parseProjectWorkflow({ nodes: [{ type: 'bandstructure' }] }));
  const before = fixture(), copy = structuredClone(before);
  const result = await editAiCanvas(before, [
    { type: 'add', kind: 'bands', source: 'scf', ref: 'b', name: 'Bands' },
    { type: 'add', kind: 'dos', source: 'scf', ref: 'd' },
    { type: 'add', kind: 'btp2', source: 'scf', ref: 't' },
    { type: 'configure', nodeId: 'b', patch: { draft: { numberOfBands: 24 } } },
    { type: 'group', nodeIds: ['b', 'd', 't'], name: 'Electronic analyses' },
  ]);
  assert.deepEqual(before, copy);
  assert.equal(result.workflow.nodes.length, 5);
  for (const node of result.workflow.nodes.slice(2)) {
    assert.equal(result.workflow.edges.find(edge => edge.target === node.id)?.port, 'electronic');
    assert.equal(workflowQeDraft(result.workflow, node).cutoff, 80);
    assert.equal(workflowQeDraft(result.workflow, node).totalCharge, 0.1);
  }
  assert.equal(workflowQeDraft(result.workflow, result.workflow.nodes[2]).numberOfBands, 24);
  assert.deepEqual(result.workflow.nodes.slice(0, 2), before.nodes);
});
test('atomic edits preserve originals on invalid ports, unknown settings or forbidden fields', async () => {
  const graph = fixture(), before = structuredClone(graph);
  await assert.rejects(editAiCanvas(graph, [{ type: 'rename', nodeId: 's', name: 'Changed' }, { type: 'add', kind: 'dos', source: 's' }]), /incompatible|electronic/i);
  await assert.rejects(editAiCanvas(graph, [{ type: 'configure', nodeId: 'scf', patch: { draft: { madeUpCutoff: 90 } } }]), /Unknown DFT/);
  await assert.rejects(editAiCanvas(graph, [{ type: 'configure', nodeId: 'scf', patch: { computeTarget: 'shared' } }]), /Cannot edit/);
  await assert.rejects(editAiCanvas(graph, [{ type: 'configure', nodeId: 'scf', patch: { draft: { cutoff: -1 } } }]), /cutoff|Cutoff/);
  assert.deepEqual(graph, before);
});
test('source settings propagate, branch overrides are explicit, duplicates retain no execution state', async () => {
  const graph = fixture(); graph.nodes[1].configuration.execution = { result: 'old' };
  graph.nodes[0].resources = [{ kind: 'structure', id: 'str_saved' }];
  graph.nodes[0].configuration.savedStructureSignature = '{"atoms":[{"species":"Si","x":0,"y":0,"z":0}]}';
  const added = await editAiCanvas(graph, [{ type: 'add', kind: 'dos', source: 'scf', ref: 'd' }, { type: 'configure', nodeId: 'scf', patch: { draft: { cutoff: 100 } } }, { type: 'duplicate', nodeId: 'scf', ref: 'copy' }, { type: 'duplicate', nodeId: 's', ref: 's_copy' }]);
  assert.equal(workflowQeDraft(added.workflow, added.workflow.nodes[2]).cutoff, 100);
  assert.equal(added.workflow.nodes.at(-2)!.configuration.execution, undefined);
  assert.equal(added.workflow.nodes.at(-1)!.configuration.savedStructureSignature, '{"atoms":[{"species":"Si","x":0,"y":0,"z":0}]}');
  await assert.rejects(editAiCanvas(added.workflow, [{ type: 'configure', nodeId: added.workflow.nodes[2].id, patch: { draft: { totalCharge: 2 } } }]), /source SCF/);
});
test('parameter study uses the shared generator and retains per-case SCF/analysis settings', async () => {
  const graph = fixture();
  const result = await editAiCanvas(graph, [{ type: 'add', kind: 'bands', source: 'scf' }, { type: 'parameter_study', study: { name: 'Strain', templateId: 'scf', parameter: 'strain-a', values: [-1, 0, 1] } }]);
  assert.equal(result.workflow.groups.length, 3);
  assert.equal(result.workflow.nodes.filter(node => node.kind === 'scf').length, 4);
  assert.equal(result.workflow.nodes.filter(node => node.kind === 'bands').length, 4);
});
test('effort catalogue and conversation tabs preserve supported choices and distinct histories', () => {
  assert.deepEqual(aiCapabilities('claude-haiku-4-5-20251001').efforts, ['auto']);
  assert.equal(isAiEffort('claude-sonnet-4-6', 'xhigh'), false);
  assert.equal(isAiEffort('claude-opus-5-5', 'xhigh'), true);
  assert.ok(aiOutputTokens('high') > 4096);
  assert.ok(aiCanvasCatalogue().modules.some(module => module.kind === 'btp2'));
  const first = aiConversationTab('aic_first'), second = aiConversationTab('aic_second');
  const state = restoreWorkflowEditor({ ...initialWorkflowEditorState, tabs: [first, second], activeTab: first, pinnedTabs: [first] }, [], '');
  assert.deepEqual(state.tabs, [first, second]);
  assert.ok(workflowEditorReducer(state, { type: 'reconcile', ids: [] }).tabs.includes(second));
  assert.equal(restoreWorkflowEditor(null, [], '?tab=tool:ai&chat=aic_first').activeTab, first);
});

test('MD analysis patches reach the editor execution pipeline and Figure styles validate without fake result data', async () => {
  const graph = fixture();
  const result = await editAiCanvas(graph, [
    { type: 'add', kind: 'md-analysis', ref: 'analysis' },
    { type: 'configure', nodeId: 'analysis', patch: { pipeline: { modifiers: [{ id: 'rdf1', type: 'rdf', enabled: true, params: { cutoff: 4.5, bins: 160 } }] } } },
    { type: 'add', kind: 'figure', ref: 'figure' },
    { type: 'configure', nodeId: 'figure', patch: { style: { fontPt: 11, widthMm: 160, panels: [{ xMin: -2, xMax: 2 }] } } },
  ]);
  const analysis = result.workflow.nodes[2].configuration.execution as {computeTarget:string;pipeline:{modifiers:Array<{params:{cutoff:number}}>;frameRange:{stride:number}}};
  assert.equal(analysis.computeTarget, 'personal');
  assert.equal(analysis.pipeline.modifiers[0].params.cutoff, 4.5);
  assert.equal(analysis.pipeline.frameRange.stride, 1);
  assert.equal(result.workflow.nodes[3].configuration.style && (result.workflow.nodes[3].configuration.style as {fontPt:number}).fontPt, 11);
  await assert.rejects(editAiCanvas(result.workflow, [{ type: 'configure', nodeId: result.workflow.nodes[3].id, patch: { style: { panels: [{ xMin: 3, xMax: 2 }] } } }]), /maximum/);
  await assert.rejects(editAiCanvas(result.workflow, [{ type: 'configure', nodeId: result.workflow.nodes[3].id, patch: { style: { fontPt: 100 } } }]), /typography/);
});

test('crystal configuration edits use the shared cell/species validation and retain the original on rejection', async () => {
  const graph = fixture(), original = structuredClone(graph);
  await assert.rejects(editAiCanvas(graph, [{ type: 'configure', nodeId: 's', patch: { structure: { lattice: { a: -1 } } } }]), /lengths|positive/);
  await assert.rejects(editAiCanvas(graph, [{ type: 'configure', nodeId: 's', patch: { structure: { atoms: [{species:'UnknownElement',x:0,y:0,z:0}] } } }]), /species|mass|element/i);
  assert.deepEqual(graph, original);
  const updated = await editAiCanvas(graph, [{ type: 'configure', nodeId: 's', patch: { structure: { lattice: { a: 5.1 } } } }]);
  assert.equal((updated.workflow.nodes[0].configuration.structure as {lattice:{a:number}}).lattice.a,5.1);
});

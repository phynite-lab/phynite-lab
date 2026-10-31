import test from 'node:test';
import assert from 'node:assert/strict';
import { createParameterStudy, previewParameterStudy, studyRange, studyValues, type ParameterStudy } from '../lib/workflow-parameter-study.ts';
import { cellVectorsFromLattice, cellVolume } from '../lib/crystal-cell.ts';
import { emptyProjectWorkflow, type ProjectWorkflow } from '../lib/project-workflow.ts';
import { workflowQeDraft } from '../lib/project-workflow-compiler.ts';
import { restoreWorkflowEditor, workflowEditorReducer, workflowStudyTab } from '../lib/workflow-editor-state.ts';

function fixture(): ProjectWorkflow {
  return { ...emptyProjectWorkflow('project_study'), nodes: [
    { id: 'crystal', kind: 'structure', name: 'MnTe', position: { x: 0, y: 0 }, resources: [], configuration: { structure: { name: 'MnTe', lattice: { a: 4.2557, b: 4.2557, c: 6.8279, alpha: 90, beta: 90, gamma: 120, periodic: [true, true, true] }, atoms: [{ id: 'mn', species: 'Mn', x: 0, y: 0, z: 0 }, { id: 'te', species: 'Te', x: 1 / 3, y: 2 / 3, z: 0.25 }] } } },
    { id: 'scf', kind: 'scf', name: 'SCF template', position: { x: 300, y: 0 }, resources: [], configuration: { compilerVersion: 1, draft: { cutoffPolicy: 'manual', cutoff: 90, chargeDensityCutoff: 1080, functional: 'PBE', kPoint: 8, kPointY: 8, kPointZ: 8 }, execution: { old: true }, result: { jobId: 'must_not_copy' } } },
    ...(['bands', 'dos', 'btp2'] as const).map((kind, i) => ({ id: kind, kind, name: kind, position: { x: 600, y: i * 150 }, resources: [], configuration: { draft: { kPoint: 12, kPointY: 12, kPointZ: 12, transportTemperatureMax: 850 } } })),
  ], edges: [{ id: 'input', source: 'crystal', target: 'scf', port: 'structure' }, ...(['bands', 'dos', 'btp2'] as const).map(kind => ({ id: `e_${kind}`, source: 'scf', target: kind, port: 'electronic' as const }))] };
}
const study = (parameter: ParameterStudy['parameter'] = 'biaxial-ab', values = [-2, 0, 2]): ParameterStudy => ({ name: 'MnTe study', templateId: 'scf', parameter, values });
const near = (actual: number, expected: number, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);

test('hexagonal biaxial cases deform independently and retain fractional atom identity/PBC', () => {
  const graph = fixture(), before = structuredClone(graph), cases = previewParameterStudy(graph, study());
  const initial = cases[1].structure;
  cases.forEach(item => {
    const scale = 1 + item.value / 100;
    near(item.structure.lattice.a, initial.lattice.a * scale);
    near(item.structure.lattice.b, initial.lattice.b * scale);
    near(item.structure.lattice.c, initial.lattice.c);
    near(item.structure.lattice.gamma, 120);
    near(item.volume / cases[1].volume, scale ** 2);
    assert.deepEqual(item.structure.atoms, initial.atoms);
    assert.deepEqual(item.structure.lattice.periodic, [true, true, true]);
  });
  assert.deepEqual(graph, before);
});

test('linear strain, volume changes and c/a at fixed volume have different exact meanings', () => {
  const graph = fixture(), base = previewParameterStudy(graph, study())[1].volume;
  const linear = previewParameterStudy(graph, study('isotropic', [0, 10]))[1];
  const volume = previewParameterStudy(graph, study('volume', [0, 10]))[1];
  const ratio = previewParameterStudy(graph, study('ca-ratio', [0, 10]))[1];
  near(linear.volume / base, 1.1 ** 3);
  near(volume.volume / base, 1.1);
  near(ratio.volume, base);
  const initial = previewParameterStudy(graph, study())[1].structure.lattice;
  near((ratio.structure.lattice.c / ratio.structure.lattice.a) / (initial.c / initial.a), 1.1);
});

test('simple Cartesian shear preserves volume/orientation and does not reinterpret lattice-axis strain', () => {
  const graph = fixture(), original = previewParameterStudy(graph, study())[1];
  const deformedXy = previewParameterStudy(graph, study('shear-xy', [0, 10]))[1];
  const before = cellVectorsFromLattice(original.structure.lattice);
  const afterXy = cellVectorsFromLattice(deformedXy.structure.lattice);
  before.forEach(([x, y, z], index) => { near(afterXy[index][0], x + 0.1 * y); near(afterXy[index][1], y); near(afterXy[index][2], z); });
  near(cellVolume(afterXy), original.volume);
  assert.deepEqual(deformedXy.transforms.cartesianDeformation, [[1, 0.1, 0], [0, 1, 0], [0, 0, 1]]);

  const deformedXz = previewParameterStudy(graph, study('shear-xz', [0, 10]))[1];
  const afterXz = cellVectorsFromLattice(deformedXz.structure.lattice);
  before.forEach(([x, y, z], index) => { near(afterXz[index][0], x + 0.1 * z); near(afterXz[index][1], y); near(afterXz[index][2], z); });
  near(cellVolume(afterXz), original.volume);
  assert.deepEqual(deformedXz.transforms.cartesianDeformation, [[1, 0, 0.1], [0, 1, 0], [0, 0, 1]]);

  const deformedYz = previewParameterStudy(graph, study('shear-yz', [0, 10]))[1];
  const afterYz = cellVectorsFromLattice(deformedYz.structure.lattice);
  before.forEach(([x, y, z], index) => { near(afterYz[index][0], x); near(afterYz[index][1], y + 0.1 * z); near(afterYz[index][2], z); });
  near(cellVolume(afterYz), original.volume);
  assert.deepEqual(deformedYz.transforms.cartesianDeformation, [[1, 0, 0], [0, 1, 0.1], [0, 0, 1]]);
});

test('study branches retain one own SCF per case, inherit analyses and never copy result/execution state', async () => {
  const graph = fixture(), before = structuredClone(graph);
  let nextId = 0;
  const result = await createParameterStudy(graph, study(), { x: 1000, y: 0 }, () => `case_${++nextId}`);
  assert.deepEqual(graph, before);
  assert.equal(result.targets.length, 12);
  const added = result.workflow.nodes.filter(node => result.nodeIds.includes(node.id));
  assert.equal(added.length, 15);
  assert.equal(added.filter(node => node.kind === 'scf').length, 3);
  for (const node of added.filter(node => ['bands', 'dos', 'btp2'].includes(node.kind))) {
    const input = result.workflow.edges.find(edge => edge.target === node.id)!;
    const scf = result.workflow.nodes.find(item => item.id === input.source)!;
    assert.equal(scf.kind, 'scf'); assert.equal(scf.groupId, node.groupId);
    const effective = workflowQeDraft(result.workflow, node);
    assert.equal(effective.cutoff, 90); assert.equal(effective.kPoint, 12); assert.equal(effective.transportTemperatureMax, 850);
    assert.equal(scf.configuration.execution, undefined); assert.equal(scf.configuration.result, undefined);
    const provenance = scf.configuration.parameterStudy as { sourceSha256: string; templateSha256: string };
    assert.match(provenance.sourceSha256, /^[a-f0-9]{64}$/); assert.match(provenance.templateSha256, /^[a-f0-9]{64}$/);
  }
});

test('SCF sweeps freeze unvaried cutoffs and snapshot the shared reference away from original edits', async () => {
  const graph = fixture();
  const result = await createParameterStudy(graph, study('cutoff', [60, 80, 100]), { x: 1000, y: 0 });
  const scfs = result.workflow.nodes.filter(node => result.nodeIds.includes(node.id) && node.kind === 'scf');
  assert.deepEqual(scfs.map(node => workflowQeDraft(result.workflow, node).cutoff), [60, 80, 100]);
  assert.ok(scfs.every(node => workflowQeDraft(result.workflow, node).chargeDensityCutoff === 1080));
  const sourceIds = scfs.map(node => result.workflow.edges.find(edge => edge.target === node.id)!.source);
  assert.equal(new Set(sourceIds).size, 1); assert.notEqual(sourceIds[0], 'crystal');
  const reference = result.workflow.nodes.find(node => node.id === sourceIds[0])!;
  (graph.nodes[0].configuration.structure as { lattice: { a: number } }).lattice.a = 99;
  assert.equal((reference.configuration.structure as { lattice: { a: number } }).lattice.a, 4.2557);
  assert.throws(() => previewParameterStudy(fixture(), study('cutoff', [60, 1200])), /fixed charge-density cutoff/);
});

test('vacuum axes, manual overrides, malformed ranges and invalid scientific states are rejected', () => {
  const graph = fixture();
  (graph.nodes[0].configuration.structure as { lattice: { periodic: boolean[] } }).lattice.periodic = [true, true, false];
  assert.throws(() => previewParameterStudy(graph, study('strain-c')), /nonperiodic/);
  assert.throws(() => previewParameterStudy(graph, study('volume')), /nonperiodic/);
  assert.throws(() => previewParameterStudy(graph, study('charge', [-0.1, 0])), /Charged slabs/);
  const mesh = previewParameterStudy(graph, study('k-grid', [6, 8]));
  assert.equal(mesh[0].draft.kPointZ, 1);
  assert.throws(() => previewParameterStudy(fixture(), study('strain-a', [-100, 0])), /nonsingular/);
  const manual = fixture(); manual.nodes[1].configuration.draft = { rawInput: '&SYSTEM' };
  assert.throws(() => previewParameterStudy(manual, study()), /manual input/);
  assert.deepEqual(studyRange(-2, 2, 1), [-2, -1, 0, 1, 2]);
  assert.deepEqual(studyRange(0.1, 0.3, 0.1), [0.1, 0.2, 0.3]);
  for (const value of ['', '1,', '1,1', 'a,2', '1,Infinity']) assert.throws(() => studyValues(value));
  assert.throws(() => studyRange(0, 100, 1)); assert.throws(() => studyRange(0, 2, 0));
});

test('the authoring tab restores and reconciles without entering the scientific DAG', () => {
  const restored = restoreWorkflowEditor({}, [], '?tab=tool%3Astudy&layout=split');
  assert.equal(restored.activeTab, workflowStudyTab); assert.equal(restored.layout, 'split');
  assert.equal(workflowEditorReducer(restored, { type: 'reconcile', ids: [] }).activeTab, workflowStudyTab);
});

test('structures without explicit periodic property default to bulk periodic and deform correctly', () => {
  const graph = fixture();
  delete (graph.nodes[0].configuration.structure as { lattice: { periodic?: boolean[] } }).lattice.periodic;
  const cases = previewParameterStudy(graph, study('biaxial-ab', [-1, 0, 1]));
  assert.equal(cases.length, 3);
  cases.forEach(item => {
    assert.deepEqual(item.structure.lattice.periodic, [true, true, true]);
    assert.ok(item.volume > 0);
  });
});

test('triclinic crystal deforms cleanly under shear and large volume scaling', () => {
  const graph: ProjectWorkflow = {
    ...emptyProjectWorkflow('project_triclinic'),
    nodes: [
      { id: 'crystal', kind: 'structure', name: 'Triclinic', position: { x: 0, y: 0 }, resources: [], configuration: { structure: { name: 'Triclinic', lattice: { a: 4, b: 5, c: 6, alpha: 75, beta: 80, gamma: 85 }, atoms: [{ id: 'x', species: 'Si', x: 0.1, y: 0.2, z: 0.3 }] } } },
      { id: 'scf', kind: 'scf', name: 'SCF template', position: { x: 300, y: 0 }, resources: [], configuration: { draft: {} } },
    ],
    edges: [{ id: 'input', source: 'crystal', target: 'scf', port: 'structure' }],
    groups: [],
  };
  const volumeCases = previewParameterStudy(graph, { name: 'Volume study', templateId: 'scf', parameter: 'volume', values: [-30, 0, 30] });
  const baseVolume = volumeCases[1].volume;
  near(volumeCases[0].volume / baseVolume, 0.7);
  near(volumeCases[2].volume / baseVolume, 1.3);

  const shearCases = previewParameterStudy(graph, { name: 'Shear study', templateId: 'scf', parameter: 'shear-xz', values: [-10, 0, 10] });
  near(shearCases[0].volume, baseVolume);
  near(shearCases[2].volume, baseVolume);
});

test('extract-frame module is recognized as a valid study template source', () => {
  const graph: ProjectWorkflow = {
    ...emptyProjectWorkflow('project_extracted'),
    nodes: [
      { id: 'frame', kind: 'extract-frame', name: 'Extracted frame', position: { x: 0, y: 0 }, resources: [], configuration: { structure: { name: 'Extracted', lattice: { a: 5, b: 5, c: 5, alpha: 90, beta: 90, gamma: 90 }, atoms: [{ id: 'a1', species: 'C', x: 0, y: 0, z: 0 }] } } },
      { id: 'scf', kind: 'scf', name: 'SCF template', position: { x: 300, y: 0 }, resources: [], configuration: { draft: {} } },
    ],
    edges: [{ id: 'input', source: 'frame', target: 'scf', port: 'structure' }],
    groups: [],
  };
  const cases = previewParameterStudy(graph, { name: 'Extracted study', templateId: 'scf', parameter: 'isotropic', values: [-2, 0, 2] });
  assert.equal(cases.length, 3);
  near(cases[1].volume, 125);
});

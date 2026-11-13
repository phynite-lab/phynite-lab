import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultQeDraft } from '../lib/qe-defaults.ts';
import { compileWorkflowDft, workflowQeDraft } from '../lib/project-workflow-compiler.ts';
import { emptyProjectWorkflow, parseProjectWorkflow, scientificWorkflowConfiguration, workflowConnectionError, workflowFingerprints, workflowOrder, copyWorkflowNodes, pasteWorkflowNodes, type ProjectWorkflow, type WorkflowNode } from '../lib/project-workflow.ts';

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

test('workflowFingerprints canonicalizes structure geometry, resource hashes, DFT defaults and non-scientific metadata', async () => {
  const full = branched(), minimal = branched();
  full.nodes[0].resources = [{ kind: 'structure', id: 'str_1', sha256: 'a'.repeat(64) }];
  full.nodes[0].configuration = {
    formula: 'ZnNi2O4',
    missingInputs: [],
    savedStructureSignature: '{"atoms":[]}',
    structure: {
      id: 'local-1', name: 'ZnNi2O4', formula: 'ZnNi2O4', source: 'cif', spaceGroup: 'Fd-3m',
      externalId: 'mp-123', sourceUrl: 'https://example.org/mp-123', sourceUpdatedAt: '2026-01-01',
      sourceData: { energyAboveHull: 0 }, geometryProvenance: 'relaxed', bandGap: 1.4,
      provenance: { importedAt: '2026-01-01' },
      atoms: [{ id: 'a1', species: 'Zn', label: 'Zn', x: 0, y: 0, z: 0 }],
      lattice: { a: 8.3, b: 8.3, c: 8.3, alpha: 90, beta: 90, gamma: 90, periodic: [true, true, true] },
    },
  };
  full.nodes[1].configuration = {
    draft: { ...createDefaultQeDraft(), cutoffPolicy: 'manual', cutoff: 60, chargeDensityCutoff: 480, plotYMin: -10, plotYMax: 10 },
    execution: { structureId: 'str_1', computeTarget: 'shared', vcpus: 4, memoryMiB: 8192 },
    computeTarget: 'personal', cloudMode: 'spot', computeProfileId: 'std', vcpus: 8, memoryMiB: 16384,
    pseudopotentialChecksums: { Zn: 'abc' }, parameterStudy: { id: 'study_1' }, missingInputs: [],
  };
  full.nodes[2].configuration = {
    compilerVersion: 1,
    draft: { ...createDefaultQeDraft(), cutoffPolicy: 'manual', cutoff: 60, chargeDensityCutoff: 480, projectedBands: true },
  };
  full.nodes[3].configuration = {
    compilerVersion: 1,
    draft: createDefaultQeDraft(),
  };

  minimal.nodes[0].resources = [{ kind: 'structure', id: 'str_1' }];
  minimal.nodes[0].configuration = {
    structure: {
      atoms: [{ species: 'Zn', x: 0, y: 0, z: 0 }],
      lattice: { a: 8.3, b: 8.3, c: 8.3, alpha: 90, beta: 90, gamma: 90 },
      periodic: [true, true, true],
    },
  };
  minimal.nodes[1].configuration = { draft: { cutoffPolicy: 'manual', cutoff: 60, chargeDensityCutoff: 480 } };
  minimal.nodes[2].configuration = { draft: { projectedBands: true } };
  minimal.nodes[3].configuration = {};

  assert.deepEqual(await workflowFingerprints(full), await workflowFingerprints(minimal));
});

test('standalone band structure node can connect directly to crystal structure without SCF intermediate', () => {
  const base = {
    ...emptyProjectWorkflow('prj_standalone'),
    nodes: [
      node('structure_1', 'structure'),
      node('bands_1', 'bands'),
    ],
    edges: [],
  };
  assert.equal(workflowConnectionError(base, { source: 'structure_1', target: 'bands_1', port: 'structure' }), null);
  const graph = {
    ...base,
    edges: [
      { id: 'edge_sb', source: 'structure_1', target: 'bands_1', port: 'structure' as const },
    ],
  };
  const parsed = parseProjectWorkflow(graph);
  assert.equal(parsed.edges.length, 1);
  assert.equal(parsed.edges[0].port, 'structure');

  graph.nodes[0].configuration.structure = {
    name: 'Si Crystal',
    atoms: [{ species: 'Si', x: 0, y: 0, z: 0 }, { species: 'Si', x: 1.35, y: 1.35, z: 1.35 }],
    lattice: { a: 5.43, b: 5.43, c: 5.43, alpha: 90, beta: 90, gamma: 90 },
  };
  graph.nodes[0].resources = [{ kind: 'structure', id: 'str_si' }];
  graph.nodes[1].configuration = {
    standalone: true,
    draft: { ...createDefaultQeDraft(), functional: 'PBEsol', cutoffPolicy: 'manual', cutoff: 80 },
  };

  const compiled = compileWorkflowDft(graph, graph.nodes[1], 'standalone-test');
  assert.equal(compiled.calculationType, 'Band structure');
  assert.equal(compiled.structureId, 'str_si');
  const inputFiles = compiled.inputFiles as Record<string, string>;
  assert.ok('scf.in' in inputFiles);
  assert.ok('nscfbands.in' in inputFiles);
  assert.ok('bands.in' in inputFiles);
  assert.match(inputFiles['scf.in'], /ecutwfc\s*=\s*80/);

  // Test scientificWorkflowConfiguration draft preservation
  const standaloneConfig = scientificWorkflowConfiguration({
    standalone: true,
    draft: { ...createDefaultQeDraft(), functional: 'PBEsol', cutoffPolicy: 'manual', cutoff: 80 },
  }, 'bands');
  assert.equal(standaloneConfig.standalone, undefined);
  assert.equal((standaloneConfig.draft as Record<string, unknown>)?.functional, 'PBEsol');
  assert.equal((standaloneConfig.draft as Record<string, unknown>)?.cutoff, 80);

  const branchConfig = scientificWorkflowConfiguration({
    standalone: false,
    draft: { ...createDefaultQeDraft(), functional: 'PBEsol', cutoffPolicy: 'manual', cutoff: 80 },
  }, 'bands');
  assert.equal(branchConfig.standalone, undefined);
  // Branch config should have functional stripped since it inherits from SCF
  assert.equal((branchConfig.draft as Record<string, unknown>)?.functional, undefined);
});

test('standalone band fingerprints use actual edges even with absent or stale UI flags', async () => {
  const graph: ProjectWorkflow = { ...emptyProjectWorkflow('test'), nodes: [node('structure', 'structure'), node('bands', 'bands')], edges: [{ id: 'e', source: 'structure', target: 'bands', port: 'structure' }] };
  graph.nodes[1].configuration = { draft: { cutoff: 60, functional: 'PBEsol' } };
  const initial = await workflowFingerprints(graph);
  graph.nodes[1].configuration.standalone = false;
  assert.deepEqual(await workflowFingerprints(graph), initial);
  graph.nodes[1].configuration.draft = { cutoff: 80, functional: 'PBEsol' };
  assert.notEqual((await workflowFingerprints(graph)).bands, initial.bands);
  const inherited = branched();
  const before = await workflowFingerprints(inherited);
  inherited.nodes.find(n => n.kind === 'bands')!.configuration = { standalone: true, draft: { cutoff: 200, functional: 'PBEsol' } };
  assert.deepEqual(await workflowFingerprints(inherited), before);
});

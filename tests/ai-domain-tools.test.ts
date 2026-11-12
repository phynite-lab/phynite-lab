import assert from 'node:assert/strict';
import test from 'node:test';
import { readAiGuide, inspectAiDftSetup, diagnoseAiCalculation, diagnoseAiFigure } from '../lib/ai-domain-tools.ts';
import { modifyAiStructure } from '../lib/ai-structure-tools.ts';
import { aiTools, executeAiTool, type AiBackend, type AiContext } from '../lib/ai-tools.ts';
import { createDefaultQeDraft } from '../lib/qe-defaults.ts';
import { createFigure, datasetFromText } from '../lib/research-figures.ts';
import type { MaterialContext } from '../components/JobComposer.tsx';

const structure = { atoms: [{ id: 'Si1', species: 'Si', x: 0.25, y: 0.5, z: 0.75 }], lattice: { a: 5, b: 5, c: 5, alpha: 90, beta: 90, gamma: 90, periodic: [true, true, false] as [boolean, boolean, boolean] } };
const material: MaterialContext = { name: 'Si', formula: 'Si', databaseName: 'Workspace', projectName: 'Study', atomCount: 1, species: ['Si'], atoms: structure.atoms, cellVectors: [[5, 0, 0], [0, 5, 0], [0, 0, 5]], periodic: structure.lattice.periodic };
const wrap = { id: 'wrap', enabled: true, kind: 'wrap' };
const signal = () => new AbortController().signal;

test('guide reader searches actual localized content, preserves sources and bounds the window', () => {
  const result = readAiGuide({ query: 'pseudopotentials', locale: 'en', maxSections: 2 });
  assert.ok(result.totalMatches > 0);
  assert.ok(result.sections.length <= 2);
  assert.match(JSON.stringify(result.sections), /pseudopotential/i);
  assert.ok(result.sections.every(section => section.blocks.length && section.source.startsWith('/guide/')));
  assert.ok(JSON.stringify(result).length < 16000);
  const indonesian = readAiGuide({ query: 'konvergensi', locale: 'id' });
  assert.ok(indonesian.totalMatches > 0);
  assert.notEqual(indonesian.sections[0].title, result.sections[0].title);
  assert.ok(readAiGuide({}).sections.length);
  for (const input of [{ locale: 'fr' }, { maxSections: 6 }, { query: '' }, { topicId: '../private' }]) assert.throws(() => readAiGuide(input));
});

test('DFT inspection preserves manual settings and accurately identifies SSSP checksum evidence', () => {
  const draft = { ...createDefaultQeDraft(), cutoffPolicy: 'manual' as const, cutoff: 85, chargeDensityCutoff: 680 };
  const original = structuredClone(draft);
  const result = inspectAiDftSetup(draft, material, 'Total energy');
  assert.ok(result.settings && result.resolved);
  assert.deepEqual(draft, original);
  assert.equal(result.settings.cutoffRy, 85);
  assert.equal(result.resolved.stages.scf?.cutoff.ecutwfc, 85);
  assert.match(result.species[0].publishedMd5!, /^[a-f0-9]{32}$/);
  assert.equal(result.species[0].sha256, null);
  assert.equal(result.species[0].functional, 'PBE');
  assert.match(result.note, /not SHA-256/);
  const dojo = inspectAiDftSetup({ ...draft, pseudoFamily: 'PseudoDojo', soc: true }, material, 'Total energy');
  assert.equal(dojo.species[0].filename, null);
  assert.equal(dojo.species[0].availability, 'not checked by this metadata inspection');
  const manual = inspectAiDftSetup({ ...draft, rawInput: '&SYSTEM ecutwfc=150, ecutrho=1200 /' }, material, 'Total energy');
  assert.equal(manual.resolved, null);
  assert.equal(manual.settings, null);
  assert.match(manual.inputAuthority, /expert-raw-input/);
});

test('calculation diagnosis needs complete numeric proof and never accepts scheduler success alone', () => {
  const calculation = { id: 'calc', status: 'COMPLETED', calculationType: 'Total energy' };
  const stage = { stage: 'scf', calculationMode: 'scf', jobDone: true, electronicConvergence: 'converged', hybridConvergence: 'not-applicable', scfResidualRy: 1e-10, scfAccuracy: { source: 'qe-log-bound', status: 'verified', residualRy: 1e-10, residualUpperRy: 2e-10, thresholdRy: 1e-8 } };
  const summary = { jobDone: true, converged: true, stageConvergence: [stage] };
  assert.equal(diagnoseAiCalculation(calculation, summary).accepted, true);
  const invalid = { ...summary, stageConvergence: [{ ...stage, scfAccuracy: { ...stage.scfAccuracy, residualUpperRy: 1e-7 } }] };
  assert.equal(diagnoseAiCalculation(calculation, invalid).accepted, false);
  assert.equal(diagnoseAiCalculation({ ...calculation, status: 'RUNNING' }, summary).accepted, false);
  assert.equal(diagnoseAiCalculation(calculation).accepted, false);
  assert.match(diagnoseAiCalculation(calculation, summary).description, /Ry/);
  assert.deepEqual(diagnoseAiCalculation(calculation, summary).physicalValidation, { status: 'not-assessed' });
});

test('figure diagnosis reports missing sources without fabricating plots or mutating the document', async () => {
  const dataset = await datasetFromText('x,y\n0,1\n1,2\n', { projectId: 'project', name: 'Exact data', filename: 'data.csv' });
  const figure = createFigure('project', [dataset], 'single', 'Observed');
  const original = structuredClone(figure);
  assert.equal(diagnoseAiFigure(figure, [dataset]).valid, true);
  const result = diagnoseAiFigure(figure, []);
  assert.equal(result.valid, false);
  assert.ok(result.issues.length);
  assert.deepEqual(figure, original);
  assert.equal(diagnoseAiFigure({ wrong: true }, []).valid, false);
});

test('structure modifiers preserve original geometry, provenance, units and nonperiodic axes', () => {
  const original = structuredClone(structure);
  const output = modifyAiStructure(structure, [{ id: 'shift', kind: 'translate', enabled: true, space: 'cartesian', offset: [5, 0, 5] }, wrap]);
  assert.deepEqual(structure, original);
  assert.deepEqual(output.periodic, [true, true, false]);
  assert.equal(output.atoms[0].x, 0.25);
  assert.equal(output.atoms[0].z, 1.75);
  assert.equal(output.geometryProvenance.length, 1);
  const filtered = modifyAiStructure(structure, [{ id: 'filter', kind: 'filter', enabled: true, expression: 'Position.Z >= 3', keep: true }]);
  assert.equal(filtered.atoms.length, 1);
  const supercell = modifyAiStructure(structure, { kind: 'supercell', matrix: [[2, 0, 0], [0, 1, 0], [0, 0, 1]] });
  assert.equal(supercell.atoms.length, 2);
  assert.equal(supercell.lattice.a, 10);
});

test('all modifier operations enforce atom bounds, safe selection syntax and explicit flags', () => {
  const large = { ...structure, atoms: Array.from({ length: 801 }, (_, index) => ({ ...structure.atoms[0], id: `Si${index}` })) };
  assert.throws(() => modifyAiStructure(large, [{ id: 'rep', kind: 'replicate', enabled: true, repeat: [2, 1, 1] }]), /1,600|1600/);
  assert.throws(() => modifyAiStructure(large, { kind: 'supercell', matrix: [[2, 0, 0], [0, 1, 0], [0, 0, 1]] }), /1600/);
  for (const modifiers of [[], Array(13).fill(wrap), [wrap, wrap], [{ ...wrap, kind: 'unknown' }], [{ id: 't', enabled: true, kind: 'translate', space: 'invented', offset: [1, 2, 3] }], [{ id: 'f', enabled: true, kind: 'filter', keep: true, expression: 'globalThis.process.exit()' }]]) assert.throws(() => modifyAiStructure(structure, modifiers));
  assert.throws(() => modifyAiStructure({ ...structure, atoms: Array(1601).fill(structure.atoms[0]) }, [wrap]), /1600/);
  assert.throws(() => modifyAiStructure(structure, { kind: 'supercell', matrix: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], operation: 'forged-provenance' }), /supported fields/);
});

test('new readers are available in Chat while all new mutations stay action-gated', async () => {
  const names = aiTools('chat', true).map(tool => tool.name);
  for (const name of ['read_job_file', 'query_dataset', 'diagnose_calculation', 'inspect_dft_setup', 'preview_md_input', 'get_worker_status', 'search_crystal_db']) assert.ok(names.includes(name));
  for (const name of ['modify_structure', 'import_md_potential', 'import_structure']) {
    assert.ok(!names.includes(name));
    await assert.rejects(executeAiTool(name, {}, 'chat', async () => { throw new Error('No backend call is authorized'); }, signal()), /not available/);
  }
  const calls: Array<[string, unknown]> = [];
  const backend: AiBackend = async <T>(operation: string, payload?: Record<string, unknown>) => { calls.push([operation, payload]); return { source: 'real fixture' } as T; };
  await executeAiTool('read_job_file', { resourceId: 'calc', resourceKind: 'calculation', path: 'logs/scf.out', mode: 'tail' }, 'chat', backend, signal());
  assert.equal(calls[0][0], 'job_file');
});

test('new mutations use exact action payload/hash and never execute before approval', async () => {
  const context = { project: { id: 'project', name: 'Study', kind: 'canvas', remoteId: 'project' }, stamp: 'stamp', resources: {}, workspaceRevision: 0, workspace: null } satisfies AiContext;
  const action = { id: 'action', status: 'pending', payloadHash: 'exact-reviewed-payload' };
  const calls: Array<[string, unknown]> = [];
  const backend: AiBackend = async <T>(operation: string, payload?: Record<string, unknown>) => { calls.push([operation, payload]); return (operation === 'context' ? context : { action }) as T; };
  const input = { target: { kind: 'canvas_node', nodeId: 'node', baseRevision: 1 }, name: 'Variant', modifiers: [wrap] };
  const pending = await executeAiTool('modify_structure', input, 'approval', backend, signal());
  assert.equal(pending.awaitingApproval, true);
  assert.ok(!calls.some(([operation]) => operation === 'execute'));
  assert.deepEqual((calls.find(([operation]) => operation === 'prepare')![1] as { payload: unknown }).payload, input);
  calls.length = 0;
  await executeAiTool('import_md_potential', { provider: 'nist', identifier: 'exact-model', elements: ['Si'] }, 'full', backend, signal());
  assert.deepEqual(calls.find(([operation]) => operation === 'execute')![1], { actionId: 'action', payloadHash: action.payloadHash, toolName: 'import_md_potential' });
});

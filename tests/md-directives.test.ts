import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  compileMdDirectiveBlocks,
  createMdDirectiveBlock,
  createMdDirectiveShortcut,
  deleteMdDirectiveBlock,
  defaultMdDirectiveBlocks,
  duplicateMdDirectiveBlock,
  MD_DIRECTIVE_SHORTCUTS,
  reorderMdDirectiveBlocks,
  validateMdDirectiveBlocks,
} from '../lib/md-directives.ts';
import {
  createMdSimulationWorkflowV2,
  defaultSimulationConfig,
  mdWorkflowToComponents,
  type MdSimulationComponentInstance,
  type MdDirectiveBlock,
} from '../lib/md-simulation-types.ts';

function component(recipe: Parameters<typeof defaultSimulationConfig>[0] = 'nvt'): MdSimulationComponentInstance {
  const config = defaultSimulationConfig(recipe);
  return { id: 'step-one', materialId: 'structure-one', materialName: 'Silicon', recipeId: recipe, name: config.name, selected: true, config };
}

test('LAMMPS blocks compile deterministically without raw command injection', () => {
  const nvt = component('nvt');
  const blocks = defaultMdDirectiveBlocks(nvt.config);
  const first = compileMdDirectiveBlocks(blocks);
  const second = compileMdDirectiveBlocks(structuredClone(blocks));
  assert.equal(first, second);
  assert.match(first, /fix ph_block_001 all nvt temp 300 300 0\.1/);
  assert.match(first, /run 20000/);
  assert.equal(validateMdDirectiveBlocks(blocks), '');
});

test('TypeScript compiler matches the shared runtime fixture byte for byte', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/md-directive-compiler.json', import.meta.url), 'utf8')) as {
    blocks: MdDirectiveBlock[];
    expected: string;
  };
  assert.equal(compileMdDirectiveBlocks(fixture.blocks), fixture.expected);
});

test('the block library exposes the eight supported shortcuts with controlled parameters', () => {
  assert.deepEqual(MD_DIRECTIVE_SHORTCUTS.map((shortcut) => shortcut.label), [
    'Run', 'Minimization', 'Maxwell velocity', 'NVT', 'NPT', 'Tensile strain', 'MSD', 'RDF',
  ]);
  const blocks = MD_DIRECTIVE_SHORTCUTS.map((shortcut) => createMdDirectiveShortcut(shortcut.id));
  assert.deepEqual(blocks.map((block) => block.kind), ['run', 'minimize', 'velocity', 'thermostat', 'barostat', 'deform', 'analysis', 'analysis']);
  assert.equal(blocks[3].kind === 'thermostat' && blocks[3].params.style, 'nvt');
  assert.equal(blocks[4].kind === 'barostat' && blocks[4].params.style, 'npt');
  assert.equal(blocks[5].kind === 'deform' && blocks[5].params.mode, 'tensile');
  assert.equal(blocks[6].kind === 'analysis' && blocks[6].params.style, 'msd');
  assert.equal(blocks[7].kind === 'analysis' && blocks[7].params.style, 'rdf');
});

test('blocks reorder, duplicate, and delete without losing directive data', () => {
  const run = createMdDirectiveShortcut('run');
  const nvt = createMdDirectiveShortcut('nvt');
  const original = [run, nvt];
  const reordered = reorderMdDirectiveBlocks(original, nvt.id, run.id);
  assert.deepEqual(reordered.map((block) => block.id), [nvt.id, run.id]);
  const duplicated = duplicateMdDirectiveBlock(reordered, nvt.id);
  assert.equal(duplicated.length, 3);
  assert.notEqual(duplicated[0].id, duplicated[1].id);
  assert.deepEqual(duplicated[0].params, duplicated[1].params);
  assert.deepEqual(deleteMdDirectiveBlock(duplicated, duplicated[1].id), reordered);
  const only = [run];
  assert.equal(deleteMdDirectiveBlock(only, run.id), only);
});

test('LAMMPS blocks reject invalid bounds and unsafe checkpoint labels', () => {
  const run = createMdDirectiveBlock('run');
  assert.equal(run.kind, 'run');
  if (run.kind !== 'run') throw new Error('Expected a run block.');
  run.params.steps = -1;
  assert.match(validateMdDirectiveBlocks([run]), /Run steps/);
  const checkpoint = createMdDirectiveBlock('checkpoint');
  assert.equal(checkpoint.kind, 'checkpoint');
  if (checkpoint.kind !== 'checkpoint') throw new Error('Expected a checkpoint block.');
  checkpoint.params.label = '../../outside';
  assert.match(validateMdDirectiveBlocks([checkpoint]), /Checkpoint label/);
});

test('structured LAMMPS blocks survive workflow cloud round trips while Expert text stays authoritative', () => {
  const nvt = component('nvt');
  nvt.config.mode = 'manual';
  nvt.config.directives = defaultMdDirectiveBlocks(nvt.config);
  const workflow = createMdSimulationWorkflowV2([nvt]);
  assert.equal(workflow.mode, 'manual');
  assert.deepEqual(workflow.steps[0].directives, nvt.config.directives);
  const [restored] = mdWorkflowToComponents(structuredClone(workflow));
  assert.deepEqual(restored.config.directives, nvt.config.directives);

  restored.config.manualBody = 'run 7';
  const expert = createMdSimulationWorkflowV2([restored]);
  assert.equal(expert.manualBody, 'run 7');
  assert.deepEqual(expert.steps[0].directives, nvt.config.directives);
});

test('analysis blocks retain named consumers and an active integrator', () => {
  for (const style of ['msd', 'rdf', 'vacf'] as const) {
    const block = createMdDirectiveBlock('analysis');
    if (block.kind !== 'analysis') throw new Error('Expected analysis.');
    block.id = `analysis-${style}`;
    block.params.style = style;
    const compiled = compileMdDirectiveBlocks([block]);
    assert.match(compiled, new RegExp(`file data/${style}-block-001-analysis-${style}\\.dat`));
    assert.match(compiled, /fix ph_block_001_int all nve/);
    assert.ok(compiled.indexOf('ave/time') < compiled.indexOf('run '));
  }
});

test('following analysis keeps the preceding ensemble until it is replaced', () => {
  const thermal = createMdDirectiveShortcut('nvt');
  const msd = createMdDirectiveShortcut('msd');
  const compiled = compileMdDirectiveBlocks([thermal, msd]);
  assert.doesNotMatch(compiled, /all nve/);
  assert.ok(compiled.indexOf('unfix ph_block_001') > compiled.indexOf('uncompute ph_block_002'));
});

test('static analysis establishes a saved dump consumer before run zero', () => {
  const block = createMdDirectiveBlock('analysis');
  if (block.kind !== 'analysis') throw new Error('Expected analysis.');
  block.id = 'stress';
  block.params.style = 'stress-atom';
  const compiled = compileMdDirectiveBlocks([block]);
  assert.match(compiled, /data\/stress-atom-block-001-stress.dump/);
  assert.ok(compiled.indexOf('dump ph_block_001_snapshot') < compiled.indexOf('run 0'));
  assert.match(compiled, /c_ph_block_001\[6\]/);
});

test('dynamic analysis rejects zero steps and odd centrosymmetry neighbors', () => {
  const block = createMdDirectiveBlock('analysis');
  if (block.kind !== 'analysis') throw new Error('Expected analysis.');
  block.params.totalSteps = 0;
  assert.match(validateMdDirectiveBlocks([block]), /at least one integration step/);
  block.params.style = 'centrosymmetry';
  block.params.neighbors = 11;
  assert.match(validateMdDirectiveBlocks([block]), /must be even/);
});

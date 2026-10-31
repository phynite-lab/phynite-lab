import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MD_FORCE_FIELD_PRESETS,
  MD_SIMULATION_RECIPES,
  createMdSimulationWorkflowV2,
  createSimulationComponentInstance,
  defaultSimulationConfig,
  generateMdStepInputPreview,
  mdWorkflowToComponents,
  mdMechanicalStrainPlan,
  validateMdManualBody,
  validateMdSimulationConfig,
} from '../lib/md-simulation-types.ts';

test('MD Lab exposes every workflow implemented by the local LAMMPS runtime', () => {
  assert.deepEqual(
    new Set(MD_SIMULATION_RECIPES.map((recipe) => recipe.id)),
    new Set([
      'minimization', 'velocity', 'nve', 'nvt', 'npt', 'nph', 'langevin',
      'temp-berendsen', 'press-berendsen', 'pressure-ramp', 'heating', 'cooling', 'annealing',
      'tensile', 'compression', 'shear', 'diffusion', 'rdf', 'vacf', 'coordination',
      'cna', 'centrosymmetry', 'voronoi', 'stress-atom', 'pe-atom', 'ke-atom', 'restart',
      'equilibration', 'melting',
    ]),
  );
  assert.equal(MD_SIMULATION_RECIPES.filter((recipe) => recipe.catalog !== false).length, 27);
  assert.equal(MD_SIMULATION_RECIPES.some((recipe) => recipe.id === ('custom' as never)), false);
});

test('the initial local recipe uses the real personal-compute contract', () => {
  const config = defaultSimulationConfig('equilibration');
  assert.equal(config.computeTarget, 'personal');
  assert.equal(config.units, 'metal');
  assert.equal(config.forceFieldId, 'lj-generic');
  assert.equal(config.ensemble, 'npt');
  assert.equal(validateMdSimulationConfig(config), '');
  assert.deepEqual(MD_FORCE_FIELD_PRESETS[0].supportedElements, ['Ar', 'Kr', 'Xe', 'Generic']);
});

test('mechanical recipes use NVT and retain their actual deformation parameters', () => {
  const tensile = defaultSimulationConfig('tensile');
  const shear = defaultSimulationConfig('shear');
  const compression = defaultSimulationConfig('compression');
  assert.equal(tensile.ensemble, 'nvt');
  assert.equal(tensile.tensileAxis, 'z');
  assert.equal(shear.shearPlane, 'xy');
  assert.equal(compression.compressionAxis, 'z');
  assert.equal(tensile.strainRate, 1e8);
  assert.equal(shear.shearRate, 1e8);
  assert.equal(compression.compressionRate, 1e8);
  assert.equal(mdMechanicalStrainPlan(tensile)?.planned, 0.005);
});

test('frontend validation mirrors the finite interval and LJ cutoff constraints', () => {
  const interval = defaultSimulationConfig('diffusion');
  interval.dumpFrequency = interval.totalSteps + 1;
  assert.match(validateMdSimulationConfig(interval), /Dump interval/);

  const cutoff = defaultSimulationConfig('equilibration');
  cutoff.cutoffRadiusAngstrom = cutoff.sigmaAngstrom - 0.1;
  assert.match(validateMdSimulationConfig(cutoff), /cutoff must be at least sigma/i);

  const boundary = defaultSimulationConfig('equilibration');
  boundary.boundaryType = 'p p f';
  assert.match(validateMdSimulationConfig(boundary), /NPT requires periodic boundaries/);

  const unsafe = defaultSimulationConfig('shear');
  unsafe.shearRate = 1e12;
  unsafe.maxShearStrain = 0.1;
  assert.match(validateMdSimulationConfig(unsafe), /above the .* safety limit/);
});

test('workflow v2 preserves minimizer style and explicit manual override', () => {
  const minimization = createSimulationComponentInstance('minimization');
  minimization.config.minimizeStyle = 'fire';
  minimization.config.maxEvaluations = 4321;
  minimization.config.mode = 'manual';
  minimization.config.manualBody = 'minimize 1e-8 1e-10 100 1000';
  const workflow = createMdSimulationWorkflowV2([minimization]);
  assert.equal(workflow.version, 2);
  assert.equal(workflow.mode, 'manual');
  assert.equal(workflow.steps[0].kind, 'minimization');
  assert.equal(workflow.steps[0].params.style, 'fire');
  assert.equal(workflow.steps[0].params.maxEvaluations, 4321);
  const [restored] = mdWorkflowToComponents(workflow);
  assert.equal(restored.config.minimizeStyle, 'fire');
  assert.equal(restored.config.manualBody, minimization.config.manualBody);
});

test('LAMMPS input mode falls back to its guided workflow until an override exists', () => {
  const langevin = createSimulationComponentInstance('langevin');
  langevin.config.mode = 'manual';
  langevin.config.manualBody = '';
  langevin.config.frictionDampingPs = 0.2;
  const workflow = createMdSimulationWorkflowV2([langevin]);
  assert.equal(workflow.mode, 'manual');
  assert.equal(workflow.manualBody, undefined);
  assert.equal(workflow.steps[0].kind, 'langevin');
  assert.equal(validateMdSimulationConfig(langevin.config), '');
});

test('new dynamics and analysis controls generate real LAMMPS operations', () => {
  assert.match(generateMdStepInputPreview(defaultSimulationConfig('nph')), /fix phynite_barostat all nph/);
  assert.match(generateMdStepInputPreview(defaultSimulationConfig('langevin')), /fix phynite_thermostat all langevin/);
  assert.match(generateMdStepInputPreview(defaultSimulationConfig('temp-berendsen')), /temp\/berendsen/);
  assert.match(generateMdStepInputPreview(defaultSimulationConfig('vacf')), /compute phynite_vacf all vacf/);
  assert.match(generateMdStepInputPreview(defaultSimulationConfig('coordination')), /compute phynite_coordination all coord\/atom/);
  assert.match(generateMdStepInputPreview(defaultSimulationConfig('stress-atom')), /compute phynite_stress all stress\/atom/);
});

test('generated manual input uses real damping values and never writes unmanaged output', () => {
  const npt = defaultSimulationConfig('npt');
  npt.tempDampingPs = 0.25;
  npt.pressureDampingPs = 2.5;
  npt.pressureBar = 1;
  npt.pressureEndBar = 10;
  const input = generateMdStepInputPreview(npt);
  assert.match(input, /temp 300 300 0\.25 iso 1 10 2\.5/);
  assert.equal(validateMdManualBody(input), '');

  const checkpoint = generateMdStepInputPreview(defaultSimulationConfig('restart'));
  assert.equal(validateMdManualBody(checkpoint), '');
  assert.doesNotMatch(checkpoint, /write_restart/);
});

test('browser manual preflight rejects nested commands, output paths, and potential replacement', () => {
  for (const input of [
    'run 10 every 1 "shell whoami"',
    'run &\n10 every 1 "shell whoami"',
    'r&\nun 10 every 1 "shell whoami"',
    'run 1\nfix thermostat all &',
    'run 1\n&',
    'if "1 == 1" then "run 10"',
    'pair_style zero 10\nrun 0',
    'fix leak all print 1 hello file leaked.txt\nrun 1',
    'variable values file ../secret\nrun 0',
  ]) assert.notEqual(validateMdManualBody(input), '');
});

test('manual preflight preserves quoted ampersands and continues actual command text', () => {
  for (const body of ['print "&"\nrun 1', 'print "# &" # payload\nrun 1', 'print "a &\n b"\nrun 1', 'fix integrator all &\n nve # a continued command\nrun 1']) {
    assert.equal(validateMdManualBody(body), '');
  }
});

test('mechanical previews accept box units and annealing keeps the requested run budget', () => {
  for (const recipe of ['tensile', 'compression', 'shear'] as const) {
    const body = generateMdStepInputPreview(defaultSimulationConfig(recipe));
    assert.equal(validateMdManualBody(body), '');
    assert.match(body, /units box remap x/);
  }
  for (const totalSteps of [1, 2, 3, 4, 5, 6, 7, 101, 100_003]) {
    const config = { ...defaultSimulationConfig('annealing'), totalSteps };
    const body = generateMdStepInputPreview(config);
    const runSteps = [...body.matchAll(/^run (\d+)$/gm)].map(match => Number(match[1]));
    assert.equal(runSteps.reduce((sum, count) => sum + count, 0), totalSteps);
    assert.equal(runSteps.length, Math.min(totalSteps, 3));
    assert.ok(runSteps.every(count => count > 0));
    assert.equal(validateMdManualBody(body), '');
  }
});

test("active manual body override validates and promotes workflow mode even from guided tab", () => {
  const nvt = createSimulationComponentInstance("nvt");
  nvt.config.mode = "guided";
  nvt.config.manualBody = 'run 10 every 1 "shell whoami"';
  assert.equal(validateMdSimulationConfig(nvt.config), "Nested command strings are not allowed.");

  nvt.config.manualBody = "fix phynite_thermostat all nvt temp 300 300 0.1\nrun 1000\nunfix phynite_thermostat";
  assert.equal(validateMdSimulationConfig(nvt.config), "");
  const workflow = createMdSimulationWorkflowV2([nvt]);
  assert.equal(workflow.mode, "manual");
  assert.equal(workflow.manualBody, nvt.config.manualBody);

  const npt = createSimulationComponentInstance("npt");
  npt.config.mode = "guided";
  npt.config.manualBody = "";
  const multiWorkflow = createMdSimulationWorkflowV2([nvt, npt]);
  assert.equal(multiWorkflow.mode, "manual");
  assert.match(multiWorkflow.manualBody ?? "", /fix phynite_thermostat all nvt temp 300 300 0\.1/);
  assert.match(multiWorkflow.manualBody ?? "", /fix phynite_barostat all npt/);
});

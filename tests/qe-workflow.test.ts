import assert from 'node:assert/strict';
import test from 'node:test';
import { applyQeAccuracy, createDefaultQeDraft, qeAccuracyProfile } from '../lib/qe-defaults.ts';
import { generateQuantumEspressoInput, generateQuantumEspressoInputFiles, qeSubmissionSettings, qeExecutionIdentity } from '../lib/qe-workflow.ts';
import { BOHR_TO_ANGSTROM, resolveQeStructure } from '../lib/qe-structure.ts';
import { atomicMass, atomicMasses } from '../lib/qe-atomic-masses.ts';
import { qeConvergenceDescription, qeRelaxationConverged } from '../lib/qe-convergence.ts';
import { qeIonDynamicsOptions, qeMethodIssue } from '../lib/qe-input.ts';
import type { JobDraft, MaterialContext } from '../components/JobComposer.tsx';

const material: NonNullable<MaterialContext> = {
  name: 'Iron', formula: 'Fe', databaseName: 'Regression fixture', atomCount: 2, species: ['Fe'],
  atoms: [{ id: 'a', species: 'Fe', label: 'Fe1', x: 0, y: 0, z: 0 }, { id: 'b', species: 'Fe', label: 'Fe2', x: 0.5, y: 0.5, z: 0.5 }],
  cellVectors: [[4, 0, 0], [1, 5, 0], [0, 1, 6]], periodic: [true, true, true],
};
const draft = (patch: Partial<JobDraft> = {}) => ({ ...createDefaultQeDraft(), ...patch });
const input = (value: JobDraft) => generateQuantumEspressoInputFiles(value, 'Total energy', material)[0].content;

test('DFT+U changes executable input with explicit labels, manifolds, projector and eV values', () => {
  const base = input(draft());
  const corrected = input(draft({ dftU: true, hubbardProjector: 'ortho-atomic', hubbardCorrections: [{ species: 'Fe1', manifold: '3d', u: 8 }, { species: 'Fe2', manifold: '3d', u: 4 }] }));
  assert.notEqual(corrected, base);
  assert.match(corrected, /HUBBARD ortho-atomic\nU Fe1-3d 8\nU Fe2-3d 4/);
  assert.doesNotMatch(base, /HUBBARD/);
  assert.throws(() => input(draft({ dftU: true, hubbardU: 8 })), /explicit QE species label/);
  assert.throws(() => input(draft({ dftU: true, hubbardProjector: 'atomic', hubbardCorrections: [{ species: 'Ni', manifold: '3d', u: 4 }] })), /does not occur/);
  assert.throws(() => input(draft({ dftU: true, hubbardProjector: 'atomic', hubbardCorrections: [{ species: 'Fe1', manifold: '2d', u: 4 }] })), /Invalid Hubbard manifold/);
});

test('resolved structure cards are the same in preview, all input stages and submission provenance', () => {
  const configured = draft({ cellParameterUnit: 'angstrom', cellParameters: [[9, 0, 0], [2, 9, 0], [0, 0, 9]], atomicPositionUnit: 'angstrom', atomicPositions: [{ id: 'override', species: 'Bi', x: 5.5, y: 4.5, z: 4.5 }] });
  const preview = generateQuantumEspressoInput(configured, 'Band structure', material);
  const files = generateQuantumEspressoInputFiles(configured, 'Band structure', material);
  const provenance = qeSubmissionSettings(configured, 'Band structure', material).submittedStructure;
  assert.ok('atoms' in provenance);
  assert.equal(provenance.atoms[0].id, 'override');
  assert.equal(provenance.atoms[0].species, 'Bi');
  assert.equal(provenance.atoms[0].x, 0.5);
  assert.equal(provenance.atoms[0].mass, 208.9804);
  assert.deepEqual(provenance.cellVectors, configured.cellParameters);
  for (const text of [preview, files[0].content, files[1].content]) {
    assert.match(text, /nat = 1/);
    assert.match(text, /Bi\s+0\.5000000000 0\.5000000000 0\.5000000000/);
    assert.match(text, /CELL_PARAMETERS angstrom\n9\.0000000000 0\.0000000000 0\.0000000000/);
    assert.doesNotMatch(text, /Fe1\s+0\./);
  }
});

test('structure cards convert Bohr and alat exactly once, including skew cells', () => {
  const bohr = draft({ cellParameterUnit: 'bohr', cellParameters: material.cellVectors.map((v) => v.map((x) => x / BOHR_TO_ANGSTROM) as [number, number, number]), atomicPositionUnit: 'bohr', atomicPositions: [{ species: 'Fe', x: 2.5 / BOHR_TO_ANGSTROM, y: 3 / BOHR_TO_ANGSTROM, z: 3 / BOHR_TO_ANGSTROM }] });
  const alat = draft({ cellParameterUnit: 'alat', cellParameterAlat: 4, cellParameters: material.cellVectors.map((v) => v.map((x) => x / 4) as [number, number, number]), atomicPositionUnit: 'alat', atomicPositions: [{ species: 'Fe', x: 2.5 / 4, y: 3 / 4, z: 3 / 4 }] });
  for (const value of [bohr, alat]) {
    const resolved = resolveQeStructure(value, material);
    assert.deepEqual(resolved.cellVectors, material.cellVectors);
    assert.equal(resolved.atoms[0].x, 0.5);
    assert.equal(resolved.atoms[0].y, 0.5);
    assert.equal(resolved.atoms[0].z, 0.5);
    assert.match(input(value), /Fe\s+0\.5000000000 0\.5000000000 0\.5000000000/);
  }
});

test('invalid geometry, unknown elements, empty cards and unsupported symmetry units fail before submission', () => {
  for (const patch of [
    { cellParameters: [[1, 0, 0], [2, 0, 0], [3, 0, 0]] as Array<[number, number, number]> },
    { atomicPositions: [] },
    { atomicPositions: [{ species: 'Xx', x: 0, y: 0, z: 0 }] },
    { atomicPositionUnit: 'crystal_sg' as const, atomicPositions: [{ species: 'Fe', x: 0, y: 0, z: 0 }] },
    { atomicPositions: [{ species: 'Fe', x: NaN, y: 0, z: 0 }] },
    { atomicPositions: [{ id: 'duplicate', species: 'Fe', x: 0, y: 0, z: 0 }, { id: 'duplicate', species: 'Fe', x: .5, y: .5, z: .5 }] },
    { cellParameterUnit: 'alat' as const, cellParameterAlat: 0, cellParameters: material.cellVectors },
  ]) assert.throws(() => input(draft(patch)));
  assert.throws(() => input(draft({ atomicPositions: [{ species: 'Fe', occupancy: 0.5, x: 0, y: 0, z: 0 }] })), /partial or mixed/);
  // A unit preference alone cannot reinterpret the canonical project structure.
  assert.deepEqual(resolveQeStructure(draft({ cellParameterUnit: 'bohr', atomicPositionUnit: 'bohr' }), material).cellVectors, material.cellVectors);
});

test('all elements with standard weights are covered; missing weights require explicit isotope masses', () => {
  assert.equal(Object.keys(atomicMasses).length, 84);
  for (const [symbol, expected] of Object.entries({ Bi: 208.9804, W: 183.84, Pb: 207.2, Zn: 65.38, K: 39.0983 })) {
    const single = { ...material, species: [symbol], atoms: [{ species: symbol, x: 0, y: 0, z: 0 }] };
    const scf = generateQuantumEspressoInputFiles(draft(), 'Phonon dispersion', single)[0].content;
    assert.equal(atomicMass(symbol), expected);
    assert.match(scf, new RegExp(`${symbol}  ${expected.toFixed(8)}`));
  }
  assert.throws(() => atomicMass('Tc'), /isotope mass/);
  assert.throws(() => atomicMass('Unknown', 12), /Unknown element/);
  assert.throws(() => atomicMass('Fe', -1), /finite and positive/);
  assert.match(input(draft({ atomicMassOverrides: { Fe1: 56.935392 } })), /Fe1  56\.93539200/);
});

test('unconstrained seeds apply to every species and fixed-total mode excludes seeds', () => {
  const seeded = input(draft({ spin: true, startingMagnetizations: { Fe1: 0.5, Fe2: -0.5 } }));
  assert.match(seeded, /starting_magnetization\(1\) = 0\.5/);
  assert.match(seeded, /starting_magnetization\(2\) = -0\.5/);
  assert.doesNotMatch(seeded, /tot_magnetization/);
  const constrained = input(draft({ spin: true, magnetizationConstraint: 'total', totalMagnetization: 0 }));
  assert.match(constrained, /tot_magnetization = 0/);
  assert.doesNotMatch(constrained, /starting_magnetization/);
  const soc = input(draft({ spin: true, soc: true, noncollinear: true, startingMagnetizations: { Fe1: 0.5, Fe2: -0.5 } }));
  assert.match(soc, /noncolin = \.true\.[\s\S]*lspinorb = \.true\./);
  assert.match(soc, /starting_magnetization\(2\) = -0\.5/);
  assert.doesNotMatch(soc, /nspin|tot_magnetization/);
  assert.throws(() => input(draft({ soc: true, magnetizationConstraint: 'total' })), /unsupported with SOC/);
});

test('unsupported DFPT and transport methods fail with an actionable error', () => {
  for (const value of [draft({ functional: 'HSE' }), draft({ vdwCorrection: 'ts-vdw' })]) assert.throws(() => generateQuantumEspressoInputFiles(value, 'Phonon dispersion', material), /ph.x does not support/);
  for (const patch of [{ transportScatteringModel: 'constant-mean-free-path' as const }, { transportChemicalPotentialStep: 0.01 }, { transportDopingMin: 1e17 }, { transportDopingMax: 1e21 }, { transportDopingPoints: 9 }]) assert.throws(() => generateQuantumEspressoInputFiles(draft(patch), 'Thermoelectric properties', material), /unavailable|unsupported/);
  const settings = qeSubmissionSettings(draft(), 'Thermoelectric properties', material);
  assert.equal(settings.transportSampling, 'chemical-potential');
  assert.ok(!('transportChemicalPotentialStep' in settings));
  assert.ok(!('transportDopingMin' in settings));
});

test('band workflows reject the QE constrained-magnetization boundary before any calculation', () => {
  assert.throws(() => generateQuantumEspressoInputFiles(draft({ spin: true, magnetizationConstraint: 'total', totalMagnetization: 0 }), 'Band structure', material), /bands.x does not support constrained magnetization/);
  const raw = (system: string) => `&CONTROL calculation='bands', title="tot_magnetization=0 / &SYSTEM" /\n&SYSTEM ${system} /`;
  for (const system of ['tot_magnetization=0', 'tot_magnetization=2d0', "constrained_magnetization='total'"]) {
    assert.match(qeMethodIssue(draft({ rawInput: raw(system) }), 'Band structure', true) ?? '', /unconstrained magnetization/);
  }
  for (const system of ["nspin=2 ! tot_magnetization=0\n", "tot_magnetization=-1d4, constrained_magnetization='none'", "nspin=2"]) {
    assert.equal(qeMethodIssue(draft({ rawInput: raw(system) }), 'Band structure', true), null);
  }
  assert.doesNotThrow(() => generateQuantumEspressoInputFiles(draft({ spin: true, magnetizationConstraint: 'total', totalMagnetization: 0 }), 'Total energy', material));
});

test('expert input remains authoritative and Hubbard cards survive automatic SCF grid replacement', () => {
  const raw = `${input(draft())}\nHUBBARD atomic\nU Fe1-3d 6\n`;
  const files = generateQuantumEspressoInputFiles(draft({ dftU: true, rawInput: raw, atomicPositions: [{ species: 'Xx', x: 0, y: 0, z: 0 }] }), 'Band structure', material);
  assert.match(files[0].content, /HUBBARD atomic\nU Fe1-3d 6/);
  assert.match(files[1].content, /HUBBARD atomic\nU Fe1-3d 6/);
  assert.match(files[2].content, /&BANDS/);
  const invalidReference = { ...material, atoms: [{ species: 'Xx', x: 0, y: 0, z: 0 }] };
  assert.match(generateQuantumEspressoInputFiles(draft({ rawInput: raw }), 'Band structure', invalidReference)[2].content, /&BANDS/);
  assert.throws(() => generateQuantumEspressoInputFiles(draft({ rawInput: raw.replace("input_dft = 'PBE'", "input_dft = 'HSE'") }), 'Phonon dispersion', material), /hybrid DFPT/);
});

test('per-stage result evidence distinguishes completion, geometry and observable convergence', () => {
  const text = qeConvergenceDescription({ stageConvergence: [
    { stage: 'relax', electronicConvergence: 'converged', ionicConvergence: 'not-converged', cellConvergence: 'not-applicable', scfResidualRy: 1e-9, maximumForceRyBohr: 0.2, pressureKbar: 1, jobDone: true, stoppingReason: 'maximum ionic steps', thresholds: { conv_thr: 1e-8, forc_conv_thr: 1e-3 } },
    { stage: 'nscf', electronicConvergence: 'failed', ionicConvergence: 'not-applicable', jobDone: false },
  ] });
  assert.match(text, /relax: electronic converged; EXX not-reported; ions not-converged/);
  assert.match(text, /maximum atomic force 2\.000e-1 Ry\/Bohr/);
  assert.match(text, /stopping reason maximum ionic steps/);
  assert.match(text, /nscf: electronic failed/);
  assert.match(text, /Observable refinement.*separate study evidence/);
  assert.match(qeConvergenceDescription({ converged: true }), /Per-stage convergence evidence unavailable/);
});


test('execution reuse tracks exact scientific input and transport settings instead of summary labels', () => {
  const base = qeExecutionIdentity(draft({ spin: true }), 'Total energy', material);
  assert.ok(base);
  assert.notEqual(base, qeExecutionIdentity(draft({ spin: true, startingMagnetizations: { Fe2: -0.5 } }), 'Total energy', material));
  assert.notEqual(base, qeExecutionIdentity(draft({ spin: true, cellParameters: [[9, 0, 0], [0, 9, 0], [0, 0, 9]] }), 'Total energy', material));
  assert.equal(base, qeExecutionIdentity(draft({ spin: true, plotYMin: -10 }), 'Total energy', material));
  assert.notEqual(qeExecutionIdentity(draft(), 'Thermoelectric properties', material), qeExecutionIdentity(draft({ transportRelaxationTime: 100 }), 'Thermoelectric properties', material));
  assert.equal(qeExecutionIdentity(draft({ dftU: true }), 'Total energy', material), null);
});

test('transport rejects values the runtime would otherwise change and accepts exact boundaries', () => {
  for (const patch of [
    { transportEnergyBins: 100000 }, { transportEnergyBins: 499 }, { transportEnergyBins: 500.5 },
    { transportInterpolationMultiplier: 17 }, { transportInterpolationMultiplier: 1.5 },
    { transportTemperatureMin: 100.9 }, { transportTemperatureMax: Infinity }, { transportTemperatureStep: .5 },
    { transportTemperatureMin: 900, transportTemperatureMax: 100 },
    { transportRelaxationTime: 0 }, { transportChemicalPotentialMin: NaN },
    { transportChemicalPotentialMin: 1, transportChemicalPotentialMax: 1 },
  ]) {
    const configured = draft(patch);
    assert.throws(() => generateQuantumEspressoInputFiles(configured, 'Thermoelectric properties', material));
    assert.throws(() => qeSubmissionSettings(configured, 'Thermoelectric properties', material));
    assert.equal(qeExecutionIdentity(configured, 'Thermoelectric properties', material), null);
  }
  for (const bins of [500, 50000]) {
    const configured = draft({ transportEnergyBins: bins, transportTemperatureMin: 100, transportTemperatureMax: 100, transportTemperatureStep: 1, transportInterpolationMultiplier: 12 });
    assert.equal(qeSubmissionSettings(configured, 'Thermoelectric properties', material).transportEnergyBins, bins);
    assert.equal(generateQuantumEspressoInputFiles(configured, 'Thermoelectric properties', material).length, 2);
  }
});

test('variable-cell relaxation requires compatible optimizers while fixed-cell FIRE remains available', () => {
  for (const cellDynamics of ['bfgs', 'damp-pr', 'damp-w'] as const) {
    const required = cellDynamics === 'bfgs' ? 'bfgs' : 'damp';
    for (const ionDynamics of ['bfgs', 'damp', 'fire'] as const) {
      const configured = draft({ relaxCell: true, cellDynamics, ionDynamics });
      if (ionDynamics === required) assert.equal(generateQuantumEspressoInputFiles(configured, 'Structural relaxation', material).length, 1);
      else assert.throws(() => generateQuantumEspressoInputFiles(configured, 'Structural relaxation', material), /requires ion_dynamics/);
      assert.equal(qeIonDynamicsOptions(configured).find(option => option.value === ionDynamics)?.disabled, ionDynamics !== required);
    }
  }
  const fixed = draft({ relaxCell: false, ionDynamics: 'fire' });
  assert.match(generateQuantumEspressoInputFiles(fixed, 'Structural relaxation', material)[0].content, /ion_dynamics = 'fire'/);
  assert.ok(qeIonDynamicsOptions(fixed).every(option => !option.disabled));
  const raw = generateQuantumEspressoInputFiles(draft(), 'Structural relaxation', material)[0].content.replace("ion_dynamics = 'bfgs'", "ion_dynamics = 'fire'");
  assert.throws(() => generateQuantumEspressoInputFiles(draft({ rawInput: raw }), 'Structural relaxation', material), /requires ion_dynamics/);
});

test('legacy phonon DOS deltaE is absent from dispersion preview, submission and execution identity', () => {
  const first = draft({ matdynDeltaE: 1 }), second = draft({ matdynDeltaE: 17 });
  assert.doesNotMatch(generateQuantumEspressoInput(first, 'Phonon dispersion', material), /deltaE/);
  assert.ok(!('matdynDeltaE' in qeSubmissionSettings(second, 'Phonon dispersion', material)));
  assert.equal(qeExecutionIdentity(first, 'Phonon dispersion', material), qeExecutionIdentity(second, 'Phonon dispersion', material));
});

test('raw relaxation validation reads namelist settings outside titles and comments', () => {
  const raw = (mode: string, title: string) => `&CONTROL\n title="${title}", calculation='${mode}'\n/\n&IONS\n ion_dynamics='fire'\n/\n&CELL\n cell_dynamics='bfgs'\n/`;
  assert.match(qeMethodIssue(draft({ rawInput: raw('vc-relax', "calculation = 'relax'") }), 'Structural relaxation', true) ?? '', /requires ion_dynamics/);
  assert.equal(qeMethodIssue(draft({ rawInput: raw('relax', "calculation = 'vc-relax'") }), 'Structural relaxation', true), null);
  assert.match(qeMethodIssue(draft({ rawInput: raw('vc-relax', "look! ions='bfgs'") }), 'Structural relaxation', true) ?? '', /requires ion_dynamics/);
  assert.equal(qeMethodIssue(draft({ rawInput: raw('relax', 'value').replace("calculation='relax'", "calculation='relax' ! calculation='vc-relax'") }), 'Structural relaxation', true), null);
  assert.match(qeMethodIssue(draft({ rawInput: raw('vc-relax', 'value').replace("calculation='vc-relax'", "calculation= ! mode\n'vc-relax'") }), 'Structural relaxation', true) ?? '', /requires ion_dynamics/);
  assert.match(qeMethodIssue(draft({ rawInput: raw('relax', 'value').replace("calculation='relax'", "calculation='relax', calculation='vc-relax'") }), 'Structural relaxation', true) ?? '', /requires ion_dynamics/);
});

test('relaxed geometry eligibility requires explicit electronic, ionic and cell stage evidence', () => {
  const stage = { calculationMode: 'vc-relax', jobDone: true, electronicConvergence: 'converged', hybridConvergence: 'not-applicable', scfAccuracy: { status: 'verified', source: 'qe-log-bound', residualRy: 1e-9, residualUpperRy: 1.05e-9, thresholdRy: 1e-6 }, ionicConvergence: 'converged', cellConvergence: 'converged' };
  const summary = { converged: true, geometryConverged: true, jobDone: true, stageConvergence: [stage] };
  assert.equal(qeRelaxationConverged(summary), true);
  assert.equal(qeRelaxationConverged({ ...summary, stageConvergence: [{ ...stage, calculationMode: 'relax', cellConvergence: 'not-applicable' }] }), true);
  for (const invalid of [undefined, { converged: true }, { ...summary, geometryConverged: false }, { ...summary, jobDone: false }, { ...summary, stageConvergence: [] }, { ...summary, stageConvergence: [stage, stage] }]) assert.equal(qeRelaxationConverged(invalid), false);
  for (const field of ['jobDone', 'electronicConvergence', 'ionicConvergence', 'cellConvergence']) assert.equal(qeRelaxationConverged({ ...summary, stageConvergence: [{ ...stage, [field]: false }] }), false);
});

test('generateQuantumEspressoInput produces crystal-aware K_POINTS crystal_b for hexagonal structures', () => {
  const mnTeMaterial: NonNullable<MaterialContext> = {
    name: 'Manganese Telluride',
    formula: 'MnTe',
    databaseName: 'Testing database',
    atomCount: 4,
    species: ['Mn', 'Te'],
    atoms: [
      { id: '1', species: 'Mn', label: 'Mn1', x: 0, y: 0, z: 0 },
      { id: '2', species: 'Mn', label: 'Mn2', x: 0, y: 0, z: 0.5 },
      { id: '3', species: 'Te', label: 'Te1', x: 1 / 3, y: 2 / 3, z: 0.25 },
      { id: '4', species: 'Te', label: 'Te2', x: 2 / 3, y: 1 / 3, z: 0.75 },
    ],
    cellVectors: [
      [4.148, 0, 0],
      [-2.074, 3.59227, 0],
      [0, 0, 6.711],
    ],
    periodic: [true, true, true],
    spaceGroup: 'P6_3/mmc · 194',
  };

  const generated = generateQuantumEspressoInput(draft({ kPathMode: 'automatic', kPathPoints: 20 }), 'Band structure', mnTeMaterial);
  assert.match(generated, /K_POINTS crystal_b\n8\n/);
  assert.match(generated, /! Γ\n.*! M\n.*! K\n.*! Γ\n.*! A\n.*! L\n.*! H\n.*! A/);
});

test('qeAccuracyProfile returns comprehensive numerical profiles for Fast, Balanced, and High accuracy', () => {
  const fast = qeAccuracyProfile('Fast');
  assert.equal(fast.kPoint, 4);
  assert.equal(fast.kPointY, 4);
  assert.equal(fast.kPointZ, 4);
  assert.equal(fast.scfThreshold, 1e-6);
  assert.equal(fast.forceThreshold, 0.002);
  assert.equal(fast.qPoint, 2);
  assert.equal(fast.phononThreshold, 1e-10);
  assert.equal(fast.kPathPoints, 16);
  assert.equal(fast.dosEnergyStep, 0.05);

  const balanced = qeAccuracyProfile('Balanced');
  assert.equal(balanced.kPoint, 8);
  assert.equal(balanced.scfThreshold, 1e-8);
  assert.equal(balanced.forceThreshold, 0.001);
  assert.equal(balanced.qPoint, 4);
  assert.equal(balanced.kPathPoints, 24);
  assert.equal(balanced.dosEnergyStep, 0.02);

  const high = qeAccuracyProfile('High accuracy');
  assert.equal(high.kPoint, 12);
  assert.equal(high.scfThreshold, 1e-10);
  assert.equal(high.forceThreshold, 0.0005);
  assert.equal(high.qPoint, 6);
  assert.equal(high.kPathPoints, 48);
  assert.equal(high.dosEnergyStep, 0.01);
});

test('applyQeAccuracy updates grid, threshold, and rawInput while respecting manual cutoff policies', () => {
  const base = createDefaultQeDraft();
  assert.equal(base.accuracy, 'Balanced');
  assert.equal(base.kPoint, 8);

  // Switching to High accuracy in auto mode updates cutoffs and grids
  const high = applyQeAccuracy({ ...base, rawInput: '&CONTROL\n/' }, 'High accuracy');
  assert.equal(high.accuracy, 'High accuracy');
  assert.equal(high.kPoint, 12);
  assert.equal(high.kPointY, 12);
  assert.equal(high.kPointZ, 12);
  assert.equal(high.scfThreshold, 1e-10);
  assert.equal(high.forceThreshold, 0.0005);
  assert.equal(high.cutoff, 100);
  assert.equal(high.chargeDensityCutoff, 800);
  assert.equal(high.rawInput, '');

  // Switching to Fast with manual cutoff override preserves custom cutoffs
  const manualCutoff = { ...base, cutoffPolicy: 'manual' as const, cutoff: 85, chargeDensityCutoff: 1020 };
  const fast = applyQeAccuracy(manualCutoff, 'Fast');
  assert.equal(fast.accuracy, 'Fast');
  assert.equal(fast.kPoint, 4);
  assert.equal(fast.scfThreshold, 1e-6);
  assert.equal(fast.forceThreshold, 0.002);
  assert.equal(fast.cutoff, 85);
  assert.equal(fast.chargeDensityCutoff, 1020);
});

test('dft-d3-bj formats as vdw_corr = dft-d3 with dftd3_version = 4 for official QE compliance', () => {
  const bj = input(draft({ vdwCorrection: 'dft-d3-bj' }));
  assert.match(bj, /vdw_corr = 'dft-d3'/);
  assert.match(bj, /dftd3_version = 4/);
  assert.doesNotMatch(bj, /vdw_corr = 'dft-d3-bj'/);

  const d3 = input(draft({ vdwCorrection: 'dft-d3' }));
  assert.match(d3, /vdw_corr = 'dft-d3'/);
  assert.doesNotMatch(d3, /dftd3_version/);
});

test('fixed occupations with unconstrained collinear spin (LSDA) fails with an actionable error', () => {
  assert.throws(
    () => generateQuantumEspressoInputFiles(draft({ occupationPolicy: 'manual', occupations: 'fixed', spin: true, magnetizationConstraint: 'unconstrained' }), 'Total energy', material),
    /collinear spin polarization \(nspin=2\) with fixed occupations requires tot_magnetization/,
  );

  // Constraining total magnetization allows fixed occupations in LSDA
  const constrained = input(draft({ occupationPolicy: 'manual', occupations: 'fixed', spin: true, magnetizationConstraint: 'total', totalMagnetization: 0 }));
  assert.match(constrained, /occupations = 'fixed'/);
  assert.match(constrained, /tot_magnetization = 0/);
});

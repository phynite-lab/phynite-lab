import assert from 'node:assert/strict';
import test from 'node:test';
import { qeResultAccepted } from '../lib/qe-convergence.ts';

const scf = { stage: 'scf', calculationMode: 'scf', jobDone: true, electronicConvergence: 'converged', hybridConvergence: 'not-applicable', scfAccuracy: { status: 'verified', source: 'qe-log-bound', residualRy: 1e-9, residualUpperRy: 1.05e-9, thresholdRy: 1e-6 } };
const nscf = { stage: 'bands-nscf', calculationMode: 'bands', jobDone: true, electronicConvergence: 'diagonalization-completed' };
const post = { stage: 'bands-postprocess', calculationMode: null, jobDone: true };
const summary = (stages: Array<Record<string, unknown>>) => ({ converged: true, jobDone: true, stageConvergence: stages });
test('completion acceptance requires every configured scientific stage, even when process completed', () => {
  assert.equal(qeResultAccepted(summary([scf]), 'Total energy'), true);
  assert.equal(qeResultAccepted(summary([scf, nscf, post]), 'Band structure'), true);
  for (const bad of [undefined, { converged: true }, summary([]), summary([{ ...scf, electronicConvergence: 'failed' }]), summary([{ ...scf, jobDone: false }]), summary([scf, scf])]) assert.equal(qeResultAccepted(bad, 'Total energy'), false);
  assert.equal(qeResultAccepted(summary([scf, nscf]), 'Band structure'), false);
  assert.equal(qeResultAccepted(summary([scf, { ...nscf, electronicConvergence: 'failed' }, post]), 'Band structure'), false);
  assert.equal(qeResultAccepted(summary([scf, nscf, { ...post, solverError: true }]), 'Band structure'), false);
  assert.equal(qeResultAccepted(summary([scf, nscf, post]), 'Total energy'), false);
});
test('phonon response and postprocessing have method-specific positive evidence', () => {
  const phonon = { stage: 'phonon', calculationMode: 'phonon', jobDone: true, phononResponseConvergence: 'converged' };
  const stages = [scf, phonon, { ...post, stage: 'force-constants' }, { ...post, stage: 'phonon-dispersion' }];
  assert.equal(qeResultAccepted(summary(stages), 'Phonon dispersion'), true);
  for (const evidence of ['failed', 'not-reported', undefined]) assert.equal(qeResultAccepted(summary([scf, { ...phonon, phononResponseConvergence: evidence }, ...stages.slice(2)]), 'Phonon dispersion'), false);
});
test('DOS requires a completed DOS postprocessor and relaxation preserves geometry acceptance', () => {
  assert.equal(qeResultAccepted(summary([scf, { ...nscf, stage: 'dos-nscf', calculationMode: 'nscf' }]), 'Density of states'), false);
  assert.equal(qeResultAccepted(summary([scf, { ...nscf, stage: 'dos-nscf', calculationMode: 'nscf' }, { ...post, stage: 'projected-dos' }]), 'Density of states'), true);
  const relax = { ...scf, stage: 'relax', calculationMode: 'vc-relax', ionicConvergence: 'converged', cellConvergence: 'converged' };
  assert.equal(qeResultAccepted({ ...summary([relax]), geometryConverged: true }, 'Structural relaxation'), true);
  assert.equal(qeResultAccepted({ ...summary([relax]), geometryConverged: false }, 'Structural relaxation'), false);
});

test('SCF and EXX acceptance checks finite numerical proof rather than declared success', () => {
  const xml = { ...scf, scfAccuracy: { status: 'verified', source: 'qe-stage-xml', residualRy: 4.74445928082557e-10, residualUpperRy: 4.74445928082557e-10, thresholdRy: 1e-8, xmlPath: 'evidence/scf.xml', xmlSha256: 'a'.repeat(64) } };
  assert.equal(qeResultAccepted(summary([xml]), 'Total energy'), true);
  for (const changes of [{ scfAccuracy: undefined }, { hybridConvergence: undefined }, { hybridFunctional: true }, { hybridConvergence: 'failed' }, { hybridConvergence: 'not-reported' }]) assert.equal(qeResultAccepted(summary([{ ...xml, ...changes }]), 'Total energy'), false);
  for (const changes of [{ status: 'unverified' }, { residualRy: -1 }, { residualRy: true }, { residualUpperRy: 1e-8 }, { thresholdRy: Infinity }, { thresholdRy: 0 }, { source: 'guessed' }, { xmlSha256: '' }]) assert.equal(qeResultAccepted(summary([{ ...xml, scfAccuracy: { ...xml.scfAccuracy, ...changes } }]), 'Total energy'), false);
  assert.equal(qeResultAccepted(summary([{ ...xml, hybridFunctional: true, hybridConvergence: 'converged' }]), 'Total energy'), true);
  // Real QE forced-success negative control: 0.09761543 Ry versus 1e-20 Ry.
  assert.equal(qeResultAccepted(summary([{ ...xml, scfAccuracy: { ...xml.scfAccuracy, residualRy: .09761543, residualUpperRy: .09761543, thresholdRy: 1e-20 } }]), 'Total energy'), false);
});

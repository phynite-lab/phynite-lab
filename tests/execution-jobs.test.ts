import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canMergeBackendCalculation,
  createExecutionJobId,
  duplicateExecutionJobIds,
  ensureUniqueExecutionJobIds,
  reusableDependencyExecution,
  resultManifestMatchesCalculation,
  completedExecutionAccepted,
} from '../lib/execution-jobs.ts';

test('execution jobs use collision-resistant UUID identities', () => {
  assert.equal(
    createExecutionJobId(() => '7af83d47-6eca-46d5-ac39-2d3038f61d19'),
    'job-run-7af83d47-6eca-46d5-ac39-2d3038f61d19',
  );
});

test('completed relaxation reuse requires positive scientific acceptance, including legacy records', () => {
  const base = { componentId: 'relax', settings: 'same', status: 'Completed', backendCalculationId: 'calc-relax', calculationType: 'Structural relaxation' };
  assert.equal(completedExecutionAccepted(base), false);
  assert.equal(completedExecutionAccepted({ ...base, relaxationConverged: false }), false);
  assert.equal(completedExecutionAccepted({ ...base, relaxationConverged: true }), false);
  assert.equal(completedExecutionAccepted({ ...base, relaxationConverged: true, scientificAccepted: true }), true);
  assert.equal(completedExecutionAccepted({ ...base, calculationType: 'Band structure' }), false);
  assert.equal(completedExecutionAccepted({ ...base, calculationType: 'Band structure', scientificAccepted: true }), true);
  assert.equal(reusableDependencyExecution([base], 'relax', 'same'), undefined);
  assert.equal(reusableDependencyExecution([{ ...base, calculationType: undefined }], 'relax', 'same', 'Structural relaxation'), undefined);
  assert.equal(reusableDependencyExecution([{ ...base, relaxationConverged: true, scientificAccepted: true }], 'relax', 'same')?.backendCalculationId, 'calc-relax');
  for (const status of ['Queued', 'Running']) assert.ok(reusableDependencyExecution([{ ...base, status }], 'relax', 'same'));
});

test('legacy duplicate local job IDs are repaired during hydration', () => {
  const ids = ['first-replacement'];
  const jobs = ensureUniqueExecutionJobIds(
    [{ id: 'job-run-1', name: 'relax' }, { id: 'job-run-1', name: 'band' }],
    () => ids.shift() ?? 'fallback',
  );
  assert.deepEqual(jobs.map((job) => job.id), ['job-run-1', 'job-run-first-replacement']);
  assert.deepEqual([...duplicateExecutionJobIds([{ id: 'job-run-1' }, { id: 'job-run-1' }])], ['job-run-1']);
});

test('a local execution record cannot be overwritten by another backend calculation', () => {
  assert.equal(canMergeBackendCalculation(undefined, 'calc-relax'), true);
  assert.equal(canMergeBackendCalculation('calc-relax', 'calc-relax'), true);
  assert.equal(canMergeBackendCalculation('calc-relax', 'calc-band'), false);
});

test('result artifacts are accepted only from the matching calculation', () => {
  assert.equal(resultManifestMatchesCalculation('calc-band', 'calc-band'), true);
  assert.equal(resultManifestMatchesCalculation('calc-relax', 'calc-band'), false);
  assert.equal(resultManifestMatchesCalculation(undefined, 'calc-band'), false);
});

test('queued, running, and completed dependency executions are reused', () => {
  const base = { componentId: 'relax-component', settings: 'matching relaxation' };
  const jobs = [
    { ...base, status: 'Failed', backendCalculationId: 'calc-failed' },
    { ...base, status: 'Running', backendCalculationId: 'calc-running' },
    { ...base, status: 'Completed', backendCalculationId: 'calc-completed' },
  ];
  assert.equal(
    reusableDependencyExecution(jobs, 'relax-component', 'matching relaxation')?.backendCalculationId,
    'calc-running',
  );
  assert.equal(reusableDependencyExecution(jobs, 'relax-component', 'changed relaxation'), undefined);
});

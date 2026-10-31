import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryLabel, readComputeResources, resourceSummary } from '../lib/compute-resources.ts';

test('resource details preserve allocation separately from per-step MPI width and QE estimates', () => {
  const info = readComputeResources({ id: 'run-1', computeBackend: 'LOCAL_MAC', vcpus: 6, memoryMiB: 8192 }, {
    version: 2, calculationId: 'run-1', status: 'completed', elapsedSeconds: 13.1,
    steps: [{ name: 'scf', mpiRanks: 6, memoryEstimateMiB: 3072, elapsedSeconds: 10 }, { name: 'dos-postprocess', mpiRanks: 1, elapsedSeconds: 0 }],
  });
  assert.equal(info.vcpus, 6);
  assert.equal(info.memoryMiB, 8192);
  assert.equal(info.steps?.[1].mpiRanks, 1);
  assert.equal(info.steps?.[1].elapsedSeconds, 0);
  assert.equal(info.steps?.[0].memoryEstimateMiB, 3072);
  assert.equal(resourceSummary(info), '6 vCPUs · 8 GiB RAM limit');
});

test('legacy results without allocation never receive invented CPU or RAM defaults', () => {
  assert.equal(resourceSummary(readComputeResources({ id: 'legacy' })), '');
  assert.equal(memoryLabel(undefined), 'Not reported');
  assert.equal(memoryLabel(0), 'Not reported');
  assert.equal(memoryLabel(2560), '2.5 GiB');
  const info = readComputeResources({ vcpus: Number.NaN, memoryMiB: -1024 });
  assert.equal(info.vcpus, undefined);
  assert.equal(info.memoryMiB, undefined);
});

test('execution timing and resource estimates cannot come from another calculation', () => {
  const info = readComputeResources({ id: 'run-1', vcpus: 4 }, {
    version: 2, calculationId: 'run-2', status: 'completed', elapsedSeconds: 99,
    steps: [{ name: 'scf', mpiRanks: 8, memoryEstimateMiB: 4096 }],
  });
  assert.equal(info.vcpus, 4);
  assert.equal(info.elapsedSeconds, undefined);
  assert.equal(info.steps, undefined);
});

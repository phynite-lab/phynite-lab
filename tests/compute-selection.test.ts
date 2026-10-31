import test from 'node:test';
import assert from 'node:assert/strict';
import { computeCapacityChoices, computeCapacityLabel, estimateQuanta, type ComputeProfile } from '../lib/compute-selection.ts';
import { computeReturnPath } from '../lib/billing-return.ts';

const profile: ComputeProfile = { id: 'm7i.large', family: 'm7i', vcpus: 2, memoryMiB: 6144, machineMemoryMiB: 8192, hourlyMicros: 3_600_001, hourlyQuanta: 3.600001 };
test('resource estimates apply one minimum and micro-Quanta rounding', () => {
  assert.equal(estimateQuanta(profile, 0), 0);
  assert.equal(estimateQuanta(profile, 1), 0.060001);
  assert.equal(estimateQuanta(profile, 59), 0.060001);
  assert.equal(estimateQuanta(profile, 3600), 3.600001);
  assert.equal(estimateQuanta(profile, 7200), 7.200002);
});
test('checkout retains only local scientific configuration destinations', () => {
  for (const value of ['/workspace/project?drawer=calculate', '/md?project=one#configuration', '/calculation/job', '/projects/owner-project?layout=full#run', '/account/compute#your-computer']) assert.equal(computeReturnPath(value), value);
  for (const value of ['https://outside.test', '//outside.test/md', '/billing', '/md\\outside', '/md\nlocation']) assert.equal(computeReturnPath(value), null);
});
test('capacity choices retain exact rate identities and collapse equal pilot allocations', () => {
  const cpu = { ...profile, id: 'c7i.large', memoryMiB: 2048, hourlyMicros: 1_000_000, hourlyQuanta: 1 };
  const memory = { ...profile, id: 'r7i.large', memoryMiB: 14336, hourlyMicros: 5_000_000, hourlyQuanta: 5 };
  const larger = { ...profile, id: 'm7i.xlarge', vcpus: 4 };
  const inputs = [memory, profile, cpu, larger];
  assert.deepEqual(computeCapacityChoices(inputs).map(x => x.id), ['c7i.large', 'm7i.large', 'r7i.large', 'm7i.xlarge']);
  const pilot = computeCapacityChoices(inputs, { vcpus: 2, memoryMiB: 2048 });
  assert.deepEqual(pilot.map(x => [x.id, x.memoryMiB]), [['c7i.large', 2048]]);
  assert.equal(computeCapacityChoices(inputs, { vcpus: 2, memoryMiB: 2048, selectedId: memory.id })[0].id, memory.id);
  assert.equal(memory.memoryMiB, 14336);
  assert.equal(profile.memoryMiB, 6144);
  assert.equal(computeCapacityLabel(profile, 'en-US'), '2 vCPU · 6 GiB RAM');
  assert.equal(computeCapacityLabel(undefined, 'en-US'), null);
});

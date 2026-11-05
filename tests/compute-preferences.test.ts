import test from 'node:test';
import assert from 'node:assert/strict';
import { affordableComputeHours, computeDurationSeconds, computeDurationValue, personalComputeRequest, validPersonalAllocation } from '../lib/compute-preferences.ts';

test('affordable hours use spendable credit and respect the one-job minimum', () => {
  const wallet = { balance: 10, reserved: 8, available: 2 };
  assert.equal(affordableComputeHours(wallet.available, 0.5), 4);
  assert.equal(affordableComputeHours(wallet.available, 1), 2);
  assert.equal(affordableComputeHours(0, 1), 0);
  assert.equal(affordableComputeHours(0.009999, 0.6), 0);
  assert.equal(affordableComputeHours(0.01, 0.6), 1 / 60);
  for (const rate of [null, undefined, 0, -1, NaN, Infinity]) assert.equal(affordableComputeHours(wallet.available, rate), null);
  for (const balance of [null, undefined, -1, NaN, Infinity]) assert.equal(affordableComputeHours(balance, 1), null);
});
test('duration units round-trip exact whole seconds and reject invalid input', () => {
  assert.equal(computeDurationSeconds('1.5', 'hours'), 5400);
  assert.equal(computeDurationSeconds('90', 'minutes'), 5400);
  for (const seconds of [1, 59, 60, 3599, 3600, 86_400]) {
    for (const unit of ['minutes', 'hours'] as const) assert.equal(computeDurationSeconds(computeDurationValue(seconds, unit), unit), seconds);
  }
  for (const value of ['', ' ', 'no', 'Infinity', '-1', '0', '0.001']) assert.equal(computeDurationSeconds(value, 'minutes'), null);
});
test('local resource resolution preserves explicit overrides and legacy omissions', () => {
  const defaults = { vcpus: 4, memoryMiB: 8192 };
  assert.deepEqual(personalComputeRequest({}, defaults), defaults);
  assert.deepEqual(personalComputeRequest({ vcpus: 2 }, defaults), { vcpus: 2, memoryMiB: 8192 });
  assert.deepEqual(personalComputeRequest({ vcpus: 0, memoryMiB: 123 }, defaults), { vcpus: 0, memoryMiB: 123 });
  assert.deepEqual(personalComputeRequest({}), {});
  assert.deepEqual(defaults, { vcpus: 4, memoryMiB: 8192 });
});
test('the local 1 GiB minimum accepts one vCPU with one GiB and rejects less', () => {
  // Limits reported by the local backend for a computer larger than the allocation.
  const local = { vcpus: 8, memoryMiB: 16384, minimumMemoryMiB: 1024, memoryMiBPerVcpu: 0 };
  const analysis = { ...local, memoryMiBPerVcpu: 1024 };
  assert.equal(validPersonalAllocation({ vcpus: 1, memoryMiB: 1024 }, local), true);
  assert.equal(validPersonalAllocation({ vcpus: 1, memoryMiB: 1023 }, local), false);
  assert.equal(validPersonalAllocation({ vcpus: 1, memoryMiB: 1024 }, analysis), true);
  assert.equal(validPersonalAllocation({ vcpus: 2, memoryMiB: 1024 }, analysis), false);
});
test('workload caps are explicit and analysis memory follows allocated CPU count', () => {
  const dft = { vcpus: 4, memoryMiB: 8192, minimumMemoryMiB: 2048 };
  const analysis = { vcpus: 8, memoryMiB: 16384, minimumMemoryMiB: 2048, memoryMiBPerVcpu: 1024 };
  assert.equal(validPersonalAllocation({ vcpus: 4, memoryMiB: 2048 }, dft), true);
  assert.equal(validPersonalAllocation({ vcpus: 4, memoryMiB: 2048 }, analysis), false);
  assert.equal(validPersonalAllocation({ vcpus: 4, memoryMiB: 4096 }, analysis), true);
  assert.equal(validPersonalAllocation({ vcpus: 8, memoryMiB: 8192 }, dft), false);
  assert.equal(validPersonalAllocation({ vcpus: 4, memoryMiB: 8192 }), false);
  for (const value of [{ vcpus: 1.5, memoryMiB: 8192 }, { vcpus: 0, memoryMiB: 8192 }, { vcpus: 2, memoryMiB: 16384 }]) assert.equal(validPersonalAllocation(value, dft), false);
});

test('submission binds the selected workload defaults and explicit duration without quoting local work', async (t) => {
  const { prepareComputeRequest } = await import('../lib/compute-selection.ts');
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  const account = { computeTarget: 'personal', computeProfileId: 'verified-cpu', estimatedComputeSeconds: 3600, personalDefaults: { qe: { vcpus: 6, memoryMiB: 8192 }, 'md-analysis': { vcpus: 2, memoryMiB: 4096 } } };
  t.mock.method(globalThis, 'fetch', async () => Response.json({ account }));
  const calls: Array<{ request: Record<string, unknown>; estimatedSeconds: number }> = [];
  const quote = async (request: { request: Record<string, unknown>; estimatedSeconds: number }) => { calls.push(request); return { quote: { id: 'quote-bound' } }; };
  try {
    assert.deepEqual(await prepareComputeRequest({ vcpus: 1 }, quote, 'md-analysis'), { computeTarget: 'personal', vcpus: 1, memoryMiB: 4096 });
    assert.equal(calls.length, 0);
    account.computeTarget = 'shared';
    assert.deepEqual(await prepareComputeRequest({ estimatedComputeSeconds: 90 }, quote, 'md-analysis'), { computeTarget: 'personal', vcpus: 2, memoryMiB: 4096 });
    assert.equal(calls.length, 0);
    const payload = { computeTarget: 'shared' as const, computeProfileId: 'verified-cpu', estimatedComputeSeconds: 5400, name: 'Exact scientific request', qeInput: 'unchanged' };
    const result = await prepareComputeRequest(payload, quote);
    assert.equal(result.quoteId, 'quote-bound');
    assert.equal(calls[0].estimatedSeconds, 5400);
    assert.equal(calls[0].request.qeInput, 'unchanged');
    assert.equal(calls[0].request.computeProfileId, 'verified-cpu');
    assert.equal(calls[0].request.vcpus, undefined);
    assert.equal(calls[0].request.estimatedComputeSeconds, undefined);
    assert.equal(result.estimatedComputeSeconds, undefined);
    assert.deepEqual(payload, { computeTarget: 'shared', computeProfileId: 'verified-cpu', estimatedComputeSeconds: 5400, name: 'Exact scientific request', qeInput: 'unchanged' });
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'window', descriptor);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

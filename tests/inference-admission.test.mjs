import assert from 'node:assert/strict';
import test from 'node:test';
import { InferenceAdmission } from '../packages/phynite-lab/lib/inference-admission.mjs';

test('native admission shares two slots, FIFO order, cancellation and idempotent release', async () => {
  const admission = new InferenceAdmission(), order = [];
  const first = await admission.acquire(), second = await admission.acquire();
  const abort = new AbortController();
  const third = admission.acquire().then(release => { order.push(3); return release; });
  const cancelled = admission.acquire(abort.signal);
  const rejected = assert.rejects(cancelled, /cancelled/);
  const fifth = admission.acquire().then(release => { order.push(5); return release; });
  abort.abort(new Error('cancelled')); await rejected;
  assert.equal(admission.active, 2); first(); first();
  const releaseThird = await third; assert.deepEqual(order, [3]);
  second(); const releaseFifth = await fifth; assert.deepEqual(order, [3, 5]);
  releaseThird(); releaseFifth(); assert.equal(admission.active, 0); assert.equal(admission.queue.length, 0);
});
test('native admission expires capacity without running an inference', async () => {
  const admission = new InferenceAdmission({ limit: 1, timeoutMs: 10 });
  const release = await admission.acquire();
  await assert.rejects(admission.acquire(), error => error.code === 'AI_QUEUE_TIMEOUT');
  assert.equal(admission.active, 1); assert.equal(admission.queue.length, 0); release();
});

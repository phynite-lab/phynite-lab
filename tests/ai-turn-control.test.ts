import assert from 'node:assert/strict';
import test from 'node:test';
import type { AiRun } from '../lib/ai-contract.ts';
import { stopAiTurn } from '../lib/ai-turn-control.ts';

const run = (status: AiRun['status']): AiRun => ({ id: 'previous', status, modelId: 'fixture', mode: 'approval', steps: 0, revision: 1, expiresAt: 1 });

test('Stop while a new claim is starting omits previous terminal run IDs', async () => {
  for (const previous of [null, run('failed'), run('completed'), run('stopped')]) {
    await stopAiTurn(previous, async payload => { assert.deepEqual(payload, {}); });
  }
});

test('Stop fences known running and approval turns', async () => {
  for (const status of ['running', 'awaiting_approval'] as const) {
    await stopAiTurn(run(status), async payload => { assert.deepEqual(payload, { runId: 'previous' }); });
  }
});

test('revision retries preserve the captured target through concurrent checkpoints', async () => {
  const payloads: Array<{ runId?: string }> = [];
  await stopAiTurn(run('running'), async payload => {
    payloads.push(payload);
    if (payloads.length < 3) throw { code: 'AI_CONFLICT' };
  });
  assert.deepEqual(payloads, Array(3).fill({ runId: 'previous' }));
});

test('Stop never switches to another tab\'s replacement turn or retries authentication failures', async () => {
  for (const code of ['AI_RUN_INACTIVE', 'AI_PERMISSION_DENIED', 'AI_AUTH_REQUIRED']) {
    let calls = 0;
    await assert.rejects(stopAiTurn(run('running'), async () => { calls++; throw { code }; }), { code });
    assert.equal(calls, 1);
  }
});

test('an initial claim revision race retries without a stale ID and remains bounded', async () => {
  let calls = 0;
  await assert.rejects(stopAiTurn(run('failed'), async payload => {
    assert.deepEqual(payload, {}); calls++; throw { code: 'AI_CONFLICT' };
  }), { code: 'AI_CONFLICT' });
  assert.equal(calls, 3);
});

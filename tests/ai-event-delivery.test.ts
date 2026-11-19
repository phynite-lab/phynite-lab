import assert from 'node:assert/strict';
import test from 'node:test';
import type { AiEvent } from '../lib/ai-contract.ts';
import { createAiEventWriter } from '../lib/ai-event-writer.ts';
import { aiEventPollDelay, waitForAiEvents } from '../lib/ai-event-poll.ts';

test('token bursts use two durable writes without losing text, control order or final flush', async () => {
  const saved: AiEvent[] = [];
  const writer = createAiEventWriter(async event => { saved.push(event); });
  writer.send({ type: 'response_start' });
  for (const text of '🧪 80 Ry; convergence remains unverified.\n'.repeat(20)) writer.send({ type: 'text', text });
  writer.send({ type: 'activity', text: 'Checking saved evidence' });
  await writer.flush(); writer.dispose();
  assert.deepEqual(saved.map(event => event.type), ['response_start', 'text', 'text', 'activity']);
  assert.equal(saved.filter(event => event.type === 'text').map(event => event.text).join(''), '🧪 80 Ry; convergence remains unverified.\n'.repeat(20));
});
test('failed persistence rejects flush and never delivers later control events', async () => {
  const writer = createAiEventWriter(async () => { throw new Error('Storage unavailable'); });
  writer.send({ type: 'text', text: 'Partial evidence' }); writer.send({ type: 'activity', text: 'Later' });
  await assert.rejects(writer.flush(), /Storage unavailable/); writer.dispose();
});
test('timed batches stay ordered across response boundaries, and dispose cancels pending work', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const saved: AiEvent[] = [];
  const writer = createAiEventWriter(async event => { saved.push(event); });
  writer.send({ type: 'text', text: 'First' });
  writer.send({ type: 'text', text: ' timed' });
  await Promise.resolve();
  assert.deepEqual(saved, [{ type: 'text', text: 'First' }]);
  t.mock.timers.tick(40);
  await writer.flush();
  assert.deepEqual(saved.at(-1), { type: 'text', text: ' timed' });
  writer.send({ type: 'response_start' });
  writer.send({ type: 'text', text: 'Next response' });
  await writer.flush();
  assert.deepEqual(saved.slice(-2), [{ type: 'response_start' }, { type: 'text', text: 'Next response' }]);
  writer.send({ type: 'text', text: ' discarded after disposal' });
  writer.dispose();
  t.mock.timers.tick(40);
  await writer.flush();
  assert.equal(saved.length, 4);
});
test('full event pages drain immediately; active streaming is quick and idle polling backs off', () => {
  assert.equal(aiEventPollDelay(100, 0, true), 0);
  assert.equal(aiEventPollDelay(1, 0, true), 100);
  assert.equal(aiEventPollDelay(1, 0, false), 250);
  assert.equal(aiEventPollDelay(0, 1, true), 200);
  assert.equal(aiEventPollDelay(0, 20, true), 1000);
});
test('disconnect interrupts the next poll immediately', async () => {
  const abort = new AbortController(), waiting = waitForAiEvents(1000, abort.signal);
  abort.abort(new Error('Detached')); await assert.rejects(waiting, /Detached/);
});

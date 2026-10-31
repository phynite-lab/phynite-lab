import test from 'node:test';
import assert from 'node:assert/strict';
import { startBrowserPoll, type PollEnvironment } from '../lib/browser-poll.ts';
test('polling pauses hidden/offline, backs off failures, avoids overlap and cleans up', async () => {
  let active = true, event = () => {}, task: (() => void) | undefined, delay = 0, reads = 0, unsubscribed = false;
  const environment: PollEnvironment = { active: () => active, schedule(fn, ms) { task = fn; delay = ms; return fn; }, cancel() { task = undefined; }, subscribe(fn) { event = fn; return () => { unsubscribed = true; }; } };
  const tick = async () => { const current = task; if (current) await current(); };
  let resolve: (() => void) | undefined;
  const stop = startBrowserPoll(async () => { reads++; if (reads === 1) throw new Error('offline'); await new Promise<void>(r => { resolve = r; }); }, 5000, environment);
  await tick(); assert.equal(delay, 10000);
  active = false; event(); assert.equal(task, undefined);
  active = true; event(); assert.equal(delay, 0);
  const running = tick(); event(); assert.equal(task, undefined); assert.equal(reads, 2);
  resolve?.(); await running; assert.equal(delay, 5000);
  stop(); assert.equal(task, undefined); assert.equal(unsubscribed, true);
});

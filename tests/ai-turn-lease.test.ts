import assert from 'node:assert/strict';
import test from 'node:test';
import { maintainAiTurnLease } from '../lib/ai-turn-lease.ts';

test('an active stream renews past the former time limit and Stop cancels future renewal', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const abort = new AbortController(); let renewals = 0;
  const stop = maintainAiTurnLease({ renew: async () => { renewals++; }, signal: abort.signal, onFailure: error => assert.fail(String(error)) });
  for (let i = 0; i < 12; i++) { context.mock.timers.tick(240000); await Promise.resolve(); }
  assert.equal(renewals, 12);
  abort.abort(); context.mock.timers.tick(240000); await Promise.resolve();
  assert.equal(renewals, 12); stop();
});

test('renewal failure stops the provider once; finishing ignores a late in-flight failure', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let failures = 0;
  const failure = new Error('lease stopped');
  maintainAiTurnLease({ renew: async () => { throw failure; }, signal: new AbortController().signal, onFailure: error => { assert.equal(error, failure); failures++; } });
  context.mock.timers.tick(240000); await Promise.resolve();
  context.mock.timers.tick(240000); await Promise.resolve(); assert.equal(failures, 1);
  let reject!: (error: Error) => void;
  const pending = new Promise((_, fail) => { reject = fail; });
  const stop = maintainAiTurnLease({ renew: () => pending, signal: new AbortController().signal, onFailure: () => { failures++; } });
  context.mock.timers.tick(240000); stop(); reject(failure); await Promise.resolve();
  assert.equal(failures, 1);
});

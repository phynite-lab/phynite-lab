import test from 'node:test';
import assert from 'node:assert/strict';
import { runtimeProgressDisplay } from '../lib/runtime-progress.ts';

test('download byte percentages never imply package extraction is complete', () => {
  const bytes = { downloadedBytes: 100, totalBytes: 100 };
  assert.deepEqual(runtimeProgressDisplay({ state: 'downloading', ...bytes }), { stage: 'downloading', downloadPercent: '100' });
  assert.deepEqual(runtimeProgressDisplay({ state: 'installing', phase: 'unpacking', ...bytes }), { stage: 'unpacking', downloadPercent: undefined });
  for (const state of ['installing', 'verifying', 'complete', 'failed']) {
    assert.deepEqual(runtimeProgressDisplay({ state, ...bytes }), { stage: state, downloadPercent: undefined });
  }
  assert.equal(runtimeProgressDisplay({ state: 'failed', phase: 'unpacking', ...bytes }).stage, 'failed');
  assert.equal(runtimeProgressDisplay({ state: 'downloading', downloadedBytes: 10, totalBytes: 0 }).downloadPercent, undefined);
});

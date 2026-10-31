import assert from 'node:assert/strict';
import test from 'node:test';
import { observeAiEvent } from '../lib/ai-event-cursor.ts';

test('a failed snapshot cannot consume the late error side effect or rewind the stream cursor', () => {
  const snapshot = { cursor: '030', lastError: '' };
  const error = { type: 'error' as const, id: '020' };
  const observed = observeAiEvent(snapshot, error, true);
  assert.deepEqual(observed, { cursor: '030', lastError: '020', apply: true });
  assert.equal(observeAiEvent(observed, error, true).apply, false);
  assert.equal(observeAiEvent(observed, { type: 'error', id: '010' }, true).apply, false);
  assert.equal(observeAiEvent(observed, { type: 'text', id: '025' }, true).apply, false);
});

test('fresh errors deduplicate and late errors cannot resurface after stop, retry or success', () => {
  const observed = observeAiEvent({ cursor: '010', lastError: '' }, { type: 'error', id: '020' }, false);
  assert.deepEqual(observed, { cursor: '020', lastError: '020', apply: true });
  assert.equal(observeAiEvent(observed, { type: 'error', id: '020' }, true).apply, false);
  assert.equal(observeAiEvent({ cursor: '030', lastError: '' }, { type: 'error', id: '020' }, false).apply, false);
});

test('fresh stream events advance once while ID-less events remain compatible', () => {
  const state = { cursor: '010', lastError: '' };
  const observed = observeAiEvent(state, { type: 'text', id: '020' }, false);
  assert.deepEqual(observed, { cursor: '020', lastError: '', apply: true });
  for (const type of ['text', 'response_start', 'activity', 'done'] as const) assert.equal(observeAiEvent(observed, { type, id: '020' }, false).apply, false);
  assert.deepEqual(observeAiEvent(observed, { type: 'error' }, false), { ...observed, apply: true });
});

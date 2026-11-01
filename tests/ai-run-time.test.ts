import test from 'node:test';
import assert from 'node:assert/strict';
import { aiRunElapsedSeconds } from '../lib/ai-run-time.ts';

const message = (runId: string, role: 'user' | 'tool', createdAt: string, steering = false) => ({ runId, role, createdAt, steering });
test('working duration follows the original recorded request across reloads and ignores later steering', () => {
  const messages = [message('old', 'user', '2026-10-25T15:00:00Z'), message('run', 'user', '2026-10-25T16:00:00Z'), message('run', 'tool', '2026-10-25T15:59:00Z'), message('run', 'user', '2026-10-25T16:00:20Z', true)];
  const now = Date.parse('2026-10-25T16:01:30Z');
  assert.equal(aiRunElapsedSeconds('run', messages, now, now), 90);
  assert.equal(aiRunElapsedSeconds('run', messages, now + 1000, now + 1000), 91);
});
test('a request without a recorded timestamp uses the current submission and never reports negative or invalid duration', () => {
  assert.equal(aiRunElapsedSeconds(undefined, [], 15100, 10000), 5);
  assert.equal(aiRunElapsedSeconds('run', [message('run', 'user', 'invalid')], 15100, 10000), 5);
  assert.equal(aiRunElapsedSeconds('run', [message('run', 'user', '2026-10-25T16:00:00Z')], 0, 0), 0);
  assert.equal(aiRunElapsedSeconds(undefined, [], NaN, 0), 0);
});

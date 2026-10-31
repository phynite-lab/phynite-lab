import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAiFailure } from '../lib/ai-failure.ts';
import { AiError } from '../lib/ai-provider.ts';

test('public failure keeps safe cause and tracking details while arbitrary exception details stay private', () => {
  const failure = normalizeAiFailure(new AiError(503, 'AI_PROVIDER_UNAVAILABLE', 'The selected source is unavailable.', { requestId: 'backend-tracking', issues: [{ nodeId: 'node1', path: 'cutoff', message: 'Check this field.' }] }), 'fallback-tracking');
  assert.deepEqual(failure, { code: 'AI_PROVIDER_UNAVAILABLE', message: 'The selected source is unavailable.', requestId: 'backend-tracking', issues: [{ nodeId: 'node1', path: 'cutoff', message: 'Check this field.' }] });
  assert.doesNotMatch(JSON.stringify(normalizeAiFailure(new Error('private upstream payload'), 'fallback-tracking')), /private upstream/);
  assert.equal(normalizeAiFailure(new Error('private upstream payload'), 'fallback-tracking').requestId, 'fallback-tracking');
});

test('public failure bounds details and redacts credentials and signed artifact URLs', () => {
  const value = normalizeAiFailure(new AiError(500, 'AI_TURN_FAILED', 'token=fixture-secret https://example.test/file?X-Amz-Signature=fixture ' + 'x'.repeat(3000), { issues: Array.from({ length: 25 }, () => ({ nodeId: 'x'.repeat(300), path: 'x'.repeat(500), message: 'Bearer fixture-credential ' + 'x'.repeat(1500) })) }));
  assert.equal(value.message.length, 2000);
  assert.doesNotMatch(JSON.stringify(value), /fixture-secret|fixture-credential|X-Amz-Signature/);
  assert.equal(value.issues?.length, 20);
  assert.equal(value.issues?.[0].nodeId?.length, 200);
  assert.equal(value.issues?.[0].path?.length, 400);
  assert.equal(value.issues?.[0].message.length, 1000);
});

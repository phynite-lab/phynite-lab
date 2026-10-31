import assert from 'node:assert/strict';
import test from 'node:test';
import type { AiConversation, AiDetail, AiMessage, AiRun } from '../lib/ai-contract.ts';
import { aiFailureReason, aiNeedsTurnStatus, aiOperationFailure, aiRetryRunId, aiTurnSummary, mergeAiHistory } from '../lib/ai-turn-status.ts';

const conversation: AiConversation = { id: 'chat', title: 'Research', projectKey: 'project:p', modelId: 'ag/gemini-3.8-flash', mode: 'approval', revision: 1, activeRunId: 'new', createdAt: '', updatedAt: '', queuePaused: true };
const run: AiRun = { id: 'new', status: 'failed', modelId: conversation.modelId, mode: conversation.mode, steps: 1, revision: 2, expiresAt: 1, queueId: 'q' };
const detail = (patch: Partial<AiDetail> = {}): AiDetail => ({ conversation, messages: [], actions: [], run, ...patch });
const message = (id: string, runId: string): AiMessage => ({ id, runId, conversationId: conversation.id, role: 'assistant', text: id, modelId: conversation.modelId, createdAt: id });

test('saved turn failures remain available after settings clear the active run or another turn starts', () => {
  const failure = { code: 'AI_PROVIDER_STREAM_INVALID', message: 'Safe public reason', requestId: 'tracking' };
  const turns = { old: { status: 'failed' as const, failure } };
  assert.deepEqual(aiTurnSummary(detail({ turns, run: null }), 'old'), turns.old);
  assert.deepEqual(aiTurnSummary(detail({ turns }), 'old'), turns.old);
  assert.deepEqual(aiTurnSummary(detail({ turns }), 'new'), { status: 'failed' });
  assert.equal(aiTurnSummary(detail({ turns }), 'missing'), undefined);
});

test('retry is available only for the latest failed queued turn in a paused inbox', () => {
  assert.equal(aiRetryRunId(detail()), 'new');
  for (const status of ['running', 'awaiting_approval', 'completed', 'stopped'] as const) assert.equal(aiRetryRunId(detail({ run: { ...run, status } })), undefined);
  assert.equal(aiRetryRunId(detail({ run: { ...run, queueId: undefined } })), undefined);
  assert.equal(aiRetryRunId(detail({ conversation: { ...conversation, queuePaused: false } })), undefined);
  assert.equal(aiRetryRunId(detail({ run: null })), undefined);
});

test('polling retains loaded older messages and failure summaries while replacing current status', () => {
  const previous = detail({ messages: [message('001', 'old'), message('002', 'new')], turns: { old: { status: 'failed' }, new: { status: 'running' } }, before: '001', hasOlderMessages: false });
  const next = detail({ messages: [message('002', 'new'), message('003', 'new')], turns: { new: { status: 'completed' } }, run: { ...run, status: 'completed' }, before: '002', hasOlderMessages: true });
  const merged = mergeAiHistory(previous, next);
  assert.deepEqual(merged.messages.map(item => item.id), ['001', '002', '003']);
  assert.deepEqual(merged.turns, { old: { status: 'failed' }, new: { status: 'completed' } });
  assert.equal(merged.run?.status, 'completed');
  assert.equal(merged.before, '001'); assert.equal(merged.hasOlderMessages, false);
  assert.deepEqual(previous.turns?.new, { status: 'running' });
});

test('history from another conversation never crosses into a refreshed conversation', () => {
  const previous = detail({ messages: [message('old', 'old')], turns: { old: { status: 'failed' } } });
  const next = detail({ conversation: { ...conversation, id: 'other' } });
  assert.equal(mergeAiHistory(previous, next), next);
});

test('operation failures keep public diagnostics separate and preserve local validation text', () => {
  const failure = Object.assign(new Error('The request failed.'), { code: 'AI_UNAVAILABLE', requestId: 'tracking', issues: [{ nodeId: 'scf', path: 'cutoff', message: 'Check this value.' }] });
  assert.deepEqual(aiOperationFailure(failure), { code: 'AI_UNAVAILABLE', message: 'The request failed.', requestId: 'tracking', issues: failure.issues });
  assert.equal(aiOperationFailure('Save the Canvas first.').message, 'Save the Canvas first.');
  assert.equal(aiOperationFailure(null).code, 'AI_REQUEST_FAILED');
});


test('status retrieval notices remain scoped to the current unresolved run', () => {
  const running = detail({ run: { ...run, status: 'running' } });
  assert.equal(aiNeedsTurnStatus(running, 'new'), true);
  assert.equal(aiNeedsTurnStatus(running, 'old'), false);
  assert.equal(aiNeedsTurnStatus(detail(), 'new'), false);
  assert.equal(aiNeedsTurnStatus(detail({ run: { ...run, status: 'stopped' } }), 'new'), false);
  assert.equal(aiNeedsTurnStatus(detail({ conversation: { ...conversation, activeRunId: 'next' } }), 'new'), false);
});

test('public provider failure categories have actionable Indonesian copy', () => {
  for (const code of ['AI_PROVIDER_AUTH_FAILED', 'AI_CONFIGURATION_INVALID', 'AI_MODEL_INVALID', 'AI_MODEL_UNVERIFIED', 'AI_PROVIDER_UNAVAILABLE', 'AI_EFFORT_UNSUPPORTED', 'AI_PDF_UNSUPPORTED', 'AI_IMAGE_UNSUPPORTED', 'AI_OUTPUT_LIMIT', 'AI_REQUEST_LIMIT', 'AI_TOOL_INPUT_INVALID', 'AI_ATTACHMENT_CHECKSUM', 'AI_PERMISSION_DENIED', 'AI_RUN_INACTIVE', 'AI_TURN_FAILED']) {
    const text = aiFailureReason({ code, message: 'Raw English diagnostics.' }, 'id');
    assert.notEqual(text, 'Raw English diagnostics.');
    assert.ok(text.length > 30);
  }
  assert.match(aiFailureReason({ code: 'AI_PROVIDER_UNAVAILABLE', message: '' }, 'en'), /selected model is unavailable/);
});

test('overlapping history pages and polls preserve the oldest pagination cursor', () => {
  const oldest = detail({ messages: [message('001', 'old'), message('002', 'old')], before: '001', hasOlderMessages: true });
  const latest = detail({ messages: [message('002', 'old'), message('003', 'new')], before: '002', hasOlderMessages: true });
  const combined = mergeAiHistory(oldest, latest);
  const polled = mergeAiHistory(combined, latest);
  assert.deepEqual(polled.messages.map(item => item.id), ['001', '002', '003']);
  assert.equal(polled.before, '001'); assert.equal(polled.hasOlderMessages, true);
});


test('background failure events may request status only for their current unresolved run', () => {
  const running = detail({ run: { ...run, status: 'running' } });
  const oldError = { type: 'error' as const, runId: 'old', code: 'AI_TURN_FAILED', message: 'Old failure' };
  const currentError = { ...oldError, runId: 'new' };
  assert.equal(aiNeedsTurnStatus(running, oldError.runId), false);
  assert.equal(aiNeedsTurnStatus(running, currentError.runId), true);
  assert.equal(aiNeedsTurnStatus(detail({ run: { ...run, status: 'completed' } }), currentError.runId), false);
});

test('a delayed snapshot cannot move newly saved messages ahead of older messages', () => {
  const latest = detail({ messages: [message('001', 'old'), message('002', 'old'), message('003', 'new')] });
  const stale = detail({ messages: [message('001', 'old'), { ...message('002', 'old'), text: 'Updated saved content' }] });
  const merged = mergeAiHistory(latest, stale);
  assert.deepEqual(merged.messages.map(item => item.id), ['001', '002', '003']);
  assert.equal(merged.messages[1].text, 'Updated saved content');
});

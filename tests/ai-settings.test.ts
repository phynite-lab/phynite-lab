import assert from 'node:assert/strict';
import test from 'node:test';
import { aiModels, type AiConversation, type AiDetail } from '../lib/ai-contract.ts';
import { acceptAiDetail, saveAiSettings } from '../lib/ai-settings.ts';

const original: AiConversation = { id: 'chat', title: 'Research', projectKey: 'project:p', modelId: aiModels[0].id, mode: 'chat', revision: 5, activeRunId: null, createdAt: '', updatedAt: '' };
const requested = { ...original, modelId: aiModels[1].id, mode: 'full' as const };
const detail = (conversation = original): AiDetail => ({ conversation, messages: [], actions: [], run: null });
const conflict = () => Object.assign(new Error('Revision changed'), { code: 'AI_CONFLICT' });

test('settings retry the runner finalization revision once with the original user choice', async () => {
  const revisions: number[] = [];
  const saved = await saveAiSettings(original, requested, async conversation => {
    revisions.push(conversation.revision);
    if (revisions.length === 1) throw conflict();
    return { ...conversation, ...requested, revision: conversation.revision + 1 };
  }, async () => detail({ ...original, revision: 6 }));
  assert.deepEqual(revisions, [5, 6]); assert.equal(saved.revision, 7); assert.equal(saved.mode, 'full'); assert.equal(saved.modelId, requested.modelId);
});

test('settings already saved by another request need no duplicate write', async () => {
  let writes = 0;
  const latest = { ...requested, revision: 6 };
  assert.equal(await saveAiSettings(original, requested, async () => { writes++; throw conflict(); }, async () => detail(latest)), latest);
  assert.equal(writes, 1);
});

test('settings never overwrite another user choice or write across an active or queued turn', async () => {
  const changed = detail({ ...original, effort: 'high', revision: 6 });
  const active = { ...detail(), run: { id: 'run', status: 'running' as const, modelId: original.modelId, mode: original.mode, steps: 0, revision: 0, expiresAt: 1 } };
  const approval = { ...active, run: { ...active.run, status: 'awaiting_approval' as const } };
  const queued = { ...detail(), queue: [{ id: 'q', conversationId: original.id, clientMessageId: 'client', text: 'next', attachmentIds: [], status: 'queued' as const, revision: 0, createdAt: '' }] };
  const claimed = { ...queued, queue: [{ ...queued.queue[0], status: 'claimed' as const }] };
  for (const latest of [changed, active, approval, queued, claimed, detail({ ...original, id: 'other' })]) {
    let writes = 0; const failure = conflict();
    await assert.rejects(saveAiSettings(original, requested, async () => { writes++; throw failure; }, async () => latest), error => error === failure);
    assert.equal(writes, 1);
  }
});

test('settings do not retry other failures and stop after one revision retry', async () => {
  for (const code of ['AI_RUN_ACTIVE', 'UNAUTHORIZED', 'AI_CONFLICT']) {
    let writes = 0, reads = 0; const failure = Object.assign(new Error('Rejected'), { code });
    await assert.rejects(saveAiSettings(original, requested, async () => { writes++; throw failure; }, async () => { reads++; return detail({ ...original, revision: 6 }); }), error => error === failure);
    assert.equal(writes, code === 'AI_CONFLICT' ? 2 : 1); assert.equal(reads, code === 'AI_CONFLICT' ? 1 : 0);
  }
});

test('detail snapshots cannot roll back saved settings, while same-revision run progress still hydrates', () => {
  const saved = detail({ ...requested, revision: 7 });
  assert.equal(acceptAiDetail(saved, detail({ ...original, revision: 6 })), false);
  assert.equal(acceptAiDetail(saved, { ...saved, streamText: 'new progress' }), true);
  assert.equal(acceptAiDetail(saved, detail({ ...requested, revision: 8 })), true);
  assert.equal(acceptAiDetail(null, detail()), true);
});

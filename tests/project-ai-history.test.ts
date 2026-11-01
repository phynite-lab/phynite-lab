import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectAiHistory } from '../lib/project-ai-history.ts';
import type { AiConversation } from '../lib/ai-contract.ts';

const chat = (id: string, projectKey: string | null = 'project:current', updatedAt = '2026-10-27T10:00:00Z'): AiConversation => ({ id, title: id, projectKey, updatedAt, createdAt: '2026-10-26T10:00:00Z', modelId: 'ag/gemini-3.8-flash', mode: 'approval', activeRunId: null, revision: 1 });
const deferred = <T>() => { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; }); return { promise, resolve, reject }; };

test('history includes only canonical and migrated aliases in newest first order', async () => {
  const history = new ProjectAiHistory('current', 'legacy', async () => [chat('aic_old'), chat('aic_other', 'project:other'), chat('aic_dft', 'dft:legacy', '2026-10-27T12:00:00Z'), chat('aic_md', 'md:current', '2026-10-27T11:00:00Z'), chat('aic_global', null)]);
  assert.deepEqual((await history.refresh()).map(row => row.id), ['aic_dft', 'aic_md', 'aic_old']);
  assert.equal(history.getSnapshot().status, 'ready');
});

test('refresh failure retains last good history and retry replaces it', async () => {
  let failure = false, rows = [chat('aic_first')];
  const history = new ProjectAiHistory('current', undefined, async () => { if (failure) throw new Error('offline'); return rows; });
  await history.refresh(); failure = true;
  await assert.rejects(history.refresh(), /offline/);
  assert.equal(history.getSnapshot().status, 'error');
  assert.deepEqual(history.getSnapshot().conversations.map(row => row.id), ['aic_first']);
  failure = false; rows = [];
  assert.deepEqual(await history.refresh(), []);
  assert.deepEqual(history.getSnapshot(), { conversations: [], status: 'ready' });
});

test('concurrent refreshes share a request and cancelled responses cannot replace a newer scope', async () => {
  const stale = deferred<AiConversation[]>(), latest = deferred<AiConversation[]>();
  const signals: AbortSignal[] = [];
  const history = new ProjectAiHistory('current', undefined, signal => { signals.push(signal); return signals.length === 1 ? stale.promise : latest.promise; });
  const first = history.refresh(); assert.equal(history.refresh(), first); assert.equal(signals.length, 1);
  history.cancel(); assert.equal(signals[0].aborted, true);
  const second = history.refresh(); latest.resolve([chat('aic_latest')]); await second;
  stale.resolve([chat('aic_stale')]); await assert.rejects(first, { name: 'AbortError' });
  assert.deepEqual(history.getSnapshot().conversations.map(row => row.id), ['aic_latest']);
  assert.equal(history.getSnapshot().status, 'ready');
});

test('new and deleted conversations fence stale refresh results without leaking other projects', async () => {
  const pending = deferred<AiConversation[]>();
  const history = new ProjectAiHistory('current', undefined, () => pending.promise);
  const refresh = history.refresh(); history.add(chat('aic_new'));
  pending.resolve([]); await assert.rejects(refresh, { name: 'AbortError' });
  history.add(chat('aic_other', 'project:other'));
  assert.deepEqual(history.getSnapshot().conversations.map(row => row.id), ['aic_new']);
  history.remove('aic_new'); assert.deepEqual(history.getSnapshot().conversations, []);
});

test('cancellation prevents late errors from changing a detached history', async () => {
  const pending = deferred<AiConversation[]>();
  const history = new ProjectAiHistory('current', undefined, () => pending.promise);
  const refresh = history.refresh(); const snapshot = history.getSnapshot();
  history.cancel(); pending.reject(new Error('late failure')); await assert.rejects(refresh, /late failure/);
  assert.equal(history.getSnapshot(), snapshot);
});

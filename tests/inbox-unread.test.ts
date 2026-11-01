import assert from 'node:assert/strict';
import test from 'node:test';
import { watchInboxUnread } from '../lib/inbox-unread.ts';

function deferred() {
  let resolve!: (value: { hasUnread: boolean }) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<{ hasUnread: boolean }>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function settle() { await Promise.resolve(); await Promise.resolve(); }

function watcher() {
  const events = new EventTarget();
  const visibility = new EventTarget();
  const requests: ReturnType<typeof deferred>[] = [];
  const changes: boolean[] = [];
  let visible = true;
  const stop = watchInboxUnread({
    load: () => { const request = deferred(); requests.push(request); return request.promise; },
    onChange: unread => changes.push(unread),
    events,
    visibility,
    isVisible: () => visible,
  });
  return { events, visibility, requests, changes, stop, setVisible: (value: boolean) => { visible = value; } };
}

test('unread refreshes initially, after messages are read, and when the page becomes visible', async () => {
  const state = watcher();
  state.requests[0].resolve({ hasUnread: true });
  await settle();
  assert.deepEqual(state.changes, [true]);
  state.events.dispatchEvent(new Event('phynite:inbox-updated'));
  state.requests[1].resolve({ hasUnread: false });
  await settle();
  assert.deepEqual(state.changes, [true, false]);
  state.setVisible(false);
  state.visibility.dispatchEvent(new Event('visibilitychange'));
  assert.equal(state.requests.length, 2);
  state.setVisible(true);
  state.visibility.dispatchEvent(new Event('visibilitychange'));
  state.requests[2].resolve({ hasUnread: true });
  await settle();
  assert.deepEqual(state.changes, [true, false, true]);
  state.stop();
});

test('failed refresh retains the last unread value', async () => {
  const state = watcher();
  state.requests[0].resolve({ hasUnread: true });
  await settle();
  state.events.dispatchEvent(new Event('phynite:inbox-updated'));
  state.requests[1].reject(new Error('offline'));
  await settle();
  assert.deepEqual(state.changes, [true]);
  state.stop();
});

test('older responses cannot overwrite the latest status', async () => {
  const state = watcher();
  state.events.dispatchEvent(new Event('phynite:inbox-updated'));
  state.requests[1].resolve({ hasUnread: false });
  await settle();
  state.requests[0].resolve({ hasUnread: true });
  await settle();
  assert.deepEqual(state.changes, [false]);
  state.stop();
});

test('disposing on account change ignores pending responses and removes event listeners', async () => {
  const previous = watcher();
  previous.stop();
  const next = watcher();
  previous.requests[0].resolve({ hasUnread: true });
  next.requests[0].resolve({ hasUnread: false });
  await settle();
  assert.deepEqual(previous.changes, []);
  assert.deepEqual(next.changes, [false]);
  previous.events.dispatchEvent(new Event('phynite:inbox-updated'));
  previous.visibility.dispatchEvent(new Event('visibilitychange'));
  assert.equal(previous.requests.length, 1);
  next.stop();
});

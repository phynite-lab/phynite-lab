import assert from 'node:assert/strict';
import test from 'node:test';
import { invalidateSessionRequest, requestSession } from '../lib/session-request.ts';

test('a logout invalidates an in-flight read and all consumers receive the new identity', async t => {
  invalidateSessionRequest();
  const replies: Array<(response: Response) => void> = [];
  t.mock.method(globalThis, 'fetch', () => new Promise<Response>(resolve => replies.push(resolve)));
  const first = requestSession();
  const shared = requestSession();
  assert.equal(replies.length, 1);
  invalidateSessionRequest();
  const afterLogout = requestSession();
  assert.equal(replies.length, 2);
  replies[0](Response.json({ cloud: { authenticated: true } }));
  await Promise.resolve();
  replies[1](Response.json({ cloud: { authenticated: false } }));
  for (const request of [first, shared, afterLogout]) assert.deepEqual(await (await request).json(), { cloud: { authenticated: false } });
});

test('a stale failure cannot discard a newer session or clear its pending read', async t => {
  invalidateSessionRequest();
  const calls: Array<{ resolve: (r: Response) => void; reject: (e: Error) => void }> = [];
  t.mock.method(globalThis, 'fetch', () => new Promise<Response>((resolve, reject) => calls.push({ resolve, reject })));
  const old = requestSession();
  invalidateSessionRequest();
  const current = requestSession();
  calls[0].reject(new Error('Old request failed.'));
  await Promise.resolve();
  const another = requestSession();
  assert.equal(calls.length, 2);
  calls[1].resolve(Response.json({ user: { id: 'new-owner' } }));
  for (const request of [old, current, another]) assert.deepEqual(await (await request).json(), { user: { id: 'new-owner' } });
});

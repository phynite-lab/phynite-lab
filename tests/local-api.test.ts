import assert from 'node:assert/strict';
import test from 'node:test';
import { localRequest } from '../lib/local-api.ts';
import { mutationFailure } from '../lib/request-security.ts';

test('local empty cloud mutations send valid same-origin JSON', async t => {
  const calls: RequestInit[] = [];
  t.mock.method(globalThis, 'fetch', async (path: string, init: RequestInit) => {
    assert.equal(path, '/api/local/cloud/logout');
    calls.push(init);
    const headers = new Headers(init.headers);
    headers.set('Origin', 'http://127.0.0.1:3000');
    assert.equal(mutationFailure(new Request('http://127.0.0.1:3000' + path, { ...init, headers })), null);
    return Response.json({ configured: false });
  });
  for (const method of ['POST', 'DELETE']) {
    assert.deepEqual(await localRequest('cloud/logout', method), { configured: false });
  }
  assert.deepEqual(calls.map(call => JSON.parse(String(call.body))), [{}, {}]);
  assert.ok(calls.every(call => call.credentials === 'same-origin' && new Headers(call.headers).get('content-type') === 'application/json'));
});

test('local reads omit bodies and failed mutations retain the server error', async t => {
  t.mock.method(globalThis, 'fetch', async (_path: string, init: RequestInit) => {
    assert.equal(init.body, undefined);
    assert.equal(init.headers, undefined);
    return Response.json({ configured: true });
  });
  assert.deepEqual(await localRequest('ai/status'), { configured: true });
  t.mock.restoreAll();
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'Cloud sign-in expired.' }, { status: 401 }));
  await assert.rejects(localRequest('cloud/logout', 'POST'), /Cloud sign-in expired/);
});

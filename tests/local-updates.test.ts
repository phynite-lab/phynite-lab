import assert from 'node:assert/strict';
import test from 'node:test';
import { createLocalUpdateChecker, newerLocalVersion } from '../lib/local-updates.ts';

test('npm versions compare numerically and never suggest a downgrade or an invalid version', () => {
  assert.equal(newerLocalVersion('0.1.10', '0.1.9'), true);
  assert.equal(newerLocalVersion('1.0.0', '0.99.99'), true);
  for (const latest of ['0.1.2', '0.1.1', '0.01.3', '1.0.0-beta.1', '99999999999999999999.0.0', 'https://example.test']) assert.equal(newerLocalVersion(latest, '0.1.2'), false);
});

test('development builds do not contact npm', async () => {
  const check = createLocalUpdateChecker({ fetcher: async () => { throw new Error('Unexpected network'); } });
  for (const version of [undefined, '', 'development', '0.1.3-dev']) assert.equal((await check(version)).status, 'development');
});

test('update requests have a fixed destination and omit credentials, research data and redirects', async () => {
  let calls = 0;
  const check = createLocalUpdateChecker({ fetcher: async (url, init) => {
    calls++;
    assert.equal(url, 'https://registry.npmjs.org/phynite-lab/latest');
    assert.equal(init?.credentials, 'omit');
    assert.equal(init?.redirect, 'error');
    assert.equal(init?.body, undefined);
    assert.deepEqual(Object.fromEntries(new Headers(init?.headers)), { accept: 'application/json' });
    return Response.json({ name: 'phynite-lab', version: '0.1.10', scripts: { install: 'ignored' }, homepage: 'https://untrusted.test' });
  } });
  const result = await check('0.1.2');
  assert.equal(result.status, 'available');
  assert.equal(result.latestVersion, '0.1.10');
  result.status = 'unknown';
  assert.equal((await check('0.1.2')).status, 'available');
  assert.equal(calls, 1);
});

test('successful checks coalesce and cache for six hours, retrying on expiry or an installed version change', async () => {
  let calls = 0, time = 1_000_000;
  const check = createLocalUpdateChecker({ now: () => time, fetcher: async () => { calls++; return Response.json({ name: 'phynite-lab', version: '0.1.2' }); } });
  assert.deepEqual((await Promise.all([check('0.1.2'), check('0.1.2'), check('0.1.2')])).map(item => item.status), ['current', 'current', 'current']);
  assert.equal(calls, 1);
  time += 6 * 60 * 60 * 1000 - 1;
  await check('0.1.2'); assert.equal(calls, 1);
  time++;
  await check('0.1.2'); assert.equal(calls, 2);
  await check('0.1.3'); assert.equal(calls, 3);
});

test('offline, invalid and oversized registry replies stay unknown and retry after five minutes', async () => {
  for (const reply of [
    () => Promise.reject(new Error('offline')),
    async () => new Response('unavailable', { status: 503 }),
    async () => new Response('not json'),
    async () => Response.json({ name: 'another-package', version: '99.0.0' }),
    async () => Response.json({ name: 'phynite-lab', version: '99.0.0-beta' }),
    async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(64 * 1024)); controller.enqueue(new Uint8Array(1)); controller.close(); } })),
  ]) {
    let time = 0, calls = 0;
    const check = createLocalUpdateChecker({ now: () => time, fetcher: async () => { calls++; return reply(); } });
    assert.deepEqual(await check('0.1.2'), { status: 'unknown', currentVersion: '0.1.2' });
    time = 299_999;
    await check('0.1.2'); assert.equal(calls, 1);
    time++;
    await check('0.1.2'); assert.equal(calls, 2);
  }
});

test('a timed out registry is aborted without blocking local work', async () => {
  let aborted = false;
  const check = createLocalUpdateChecker({ timeoutMs: 10, fetcher: async (_url, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => { aborted = true; reject(new Error('timeout')); }, { once: true });
  }) });
  assert.equal((await check('0.1.2')).status, 'unknown');
  assert.equal(aborted, true);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { AI_ATTACHMENT_BODY_BYTES, mutationFailure, readBodyBytes, readJsonBody, requestBodyLimit, securityHeaders } from '../lib/request-security.ts';
import { publicSiteOrigin, privatePage } from '../lib/site-metadata.ts';
import { controlPlaneFetch, controlPlaneJson, ControlPlaneTimeoutError } from '../lib/control-plane-fetch.ts';
const request = (headers: HeadersInit, body = '{}') => new Request('https://phynite.example/api/waitlist', { method: 'POST', headers, body });
test('cookie mutations reject external, null and missing origins; same-origin JSON works', () => {
  for (const origin of ['https://evil.example', 'null', '']) {
    assert.equal(mutationFailure(request({ cookie: 'session=value', 'content-type': 'application/json', ...(origin ? { origin } : {}) }))?.status, 403);
  }
  assert.equal(mutationFailure(request({ origin: 'https://phynite.example', 'content-type': 'application/json' })), null);
  assert.equal(mutationFailure(request({ origin: 'https://phynite.example', 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' }))?.status, 403);
});
test('bodyless same-origin logout and delete work; cross-origin logout is rejected', () => {
  for (const method of ['POST', 'DELETE']) assert.equal(mutationFailure(new Request('https://phynite.example/api/auth/logout', { method, headers: { origin: 'https://phynite.example' } })), null);
  assert.equal(mutationFailure(new Request('https://phynite.example/api/auth/logout', { method: 'POST', headers: { origin: 'https://evil.example' } }))?.status, 403);
});
test('oversized streamed bodies are cancelled without trusting Content-Length', async () => {
  let cancelled = false;
  const body = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(20)); }, cancel() { cancelled = true; } });
  const req = new Request('https://phynite.example/api/contact', { method: 'POST', body, duplex: 'half' } as RequestInit);
  await assert.rejects(readBodyBytes(req, 10), { status: 413 });
  assert.equal(cancelled, true);
});
test('JSON arrays, invalid UTF-8 and malformed input are rejected; science body limits are retained', async () => {
  for (const raw of ['[]', '{', 'null']) await assert.rejects(readJsonBody(request({ 'content-type': 'application/json' }, raw)), { status: 400 });
  const invalid = new Request('https://phynite.example/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: new Uint8Array([255]) });
  await assert.rejects(readJsonBody(invalid), { code: 'INVALID_JSON' });
  assert.ok(requestBodyLimit('/api/phynite/worker/v1/jobs/a/complete') >= 8_000_000);
});
test('metadata rejects misconfigured origins and private routes are not indexable', () => {
  assert.equal(publicSiteOrigin('https://phynite.example'), 'https://phynite.example');
  for (const origin of ['http://localhost:3000', 'https://user:pass@phynite.example', 'https://phynite.example/private']) assert.throws(() => publicSiteOrigin(origin));
  assert.equal(privatePage('/workspace/project'), true);
  assert.equal(privatePage('/projects/project-one'), true);
  assert.equal(privatePage('/privacy'), false);
  assert.equal(privatePage('/workspace-public'), false);
  assert.match(securityHeaders(true)['Content-Security-Policy'], /worker-src 'self' blob:/);
});
test('control-plane timeout is bounded and never retries accepted mutations', async () => {
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_input, init) => { calls++; return new Promise((_resolve, reject) => { init?.signal?.addEventListener('abort', () => reject(init.signal?.reason)); }); };
  const keepAlive = setTimeout(() => undefined, 100);
  try { await assert.rejects(controlPlaneFetch('https://backend.example/jobs', { method: 'POST' }, 5), ControlPlaneTimeoutError); assert.equal(calls, 1); }
  finally { clearTimeout(keepAlive); globalThis.fetch = previous; }
});

test('unreadable response bodies fail instead of appearing successful; Retry-After accepts dates', async () => {
  await assert.rejects(controlPlaneJson(new Response('not JSON')), /unreadable response/);
  const {retryAfterSeconds} = await import('../lib/http-response.ts');
  assert.equal(retryAfterSeconds(new Response('{}', {status:429,headers:{'Retry-After':'45'}})),45);
  assert.equal(retryAfterSeconds(new Response('{}', {status:429,headers:{'Retry-After':'Wed, 30 Sep 2026 12:00:20 GMT'}}),Date.parse('2026-09-30T12:00:00Z')),20);
  assert.equal(retryAfterSeconds(new Response('{}', {status:403,headers:{'Retry-After':'45'}})),null);
});

test('AI attachment binary uploads retain same-origin and exact-path restrictions', () => {
  const target = 'https://phynite.example/api/ai/conversations/aic_abc123/attachments/aif_abc123/content';
  const make = (url: string, origin = 'https://phynite.example') => new Request(url, { method: 'PUT', headers: { origin, 'content-type': 'application/octet-stream' }, body: new Uint8Array([1, 2]) });
  assert.equal(mutationFailure(make(target)), null);
  assert.equal(requestBodyLimit(new URL(target).pathname), AI_ATTACHMENT_BODY_BYTES);
  assert.match(securityHeaders(true, new URL(target).pathname)['Content-Security-Policy'], /sandbox; default-src 'none'/);
  assert.equal(mutationFailure(make(target, 'https://foreign.example'))?.code, 'INVALID_ORIGIN');
  assert.equal(mutationFailure(make(target.replace('/content', '/settings')))?.code, 'JSON_REQUIRED');
});
test('local archive binary parts require the exact transfer path and retain a bounded size', () => {
  const path = `/api/local/projects/imports/${'a'.repeat(32)}/parts/0`;
  const make = (target: string, origin = 'http://127.0.0.1:3000') => new Request(`http://127.0.0.1:3000${target}`, { method: 'PUT', headers: { origin, 'Content-Type': 'application/octet-stream' }, body: new Uint8Array([1]) });
  assert.equal(mutationFailure(make(path)), null);
  assert.equal(requestBodyLimit(path), 4 * 1024 ** 2);
  assert.equal(mutationFailure(make(path, 'https://foreign.example'))?.code, 'INVALID_ORIGIN');
  assert.equal(mutationFailure(make(path.replace('/parts/0', '/complete')))?.code, 'JSON_REQUIRED');
});

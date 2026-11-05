import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { NextRequest } from 'vinext/shims/server';

// Run the real BFF routes and transport; only Workers bindings are unavailable in Node.
const modules = new Map<string, string>();
const moduleUrl = (source: string) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
async function compiled(file: string): Promise<string> {
  const url = new URL(file, import.meta.url);
  if (modules.has(url.href)) return modules.get(url.href)!;
  let source = ts.transpileModule(await readFile(url, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  for (const match of [...source.matchAll(/from ['"]([^'"]+)['"]/g)]) {
    const name = match[1];
    let replacement: string;
    if (name === 'next/server') replacement = import.meta.resolve('vinext/shims/server');
    else if (name === 'cloudflare:workers') replacement = moduleUrl('export const env = {};');
    else {
      const dependency = new URL(name.startsWith('@/') ? '../' + name.slice(2) : name, name.startsWith('@/') ? import.meta.url : url);
      replacement = await compiled(dependency.href.endsWith('.ts') ? dependency.href : dependency.href + '.ts');
    }
    source = source.replace(match[0], `from '${replacement}'`);
  }
  const result = moduleUrl(source);
  modules.set(url.href, result);
  return result;
}
const login = (await import(await compiled('../app/api/auth/login/route.ts'))).POST as (request: NextRequest) => Promise<Response>;
const logout = (await import(await compiled('../app/api/auth/logout/route.ts'))).POST as (request: NextRequest) => Promise<Response>;
const session = (await import(await compiled('../app/api/auth/session/route.ts'))).GET as (request: NextRequest) => Promise<Response>;
const localRoute = await import(await compiled('../app/api/local/[...path]/route.ts'));

test('npm update route is local-only, read-only and never forwards a service token to npm', async t => {
  fixture(t);
  const oldVersion = process.env.PHYNITE_RELEASE_VERSION;
  t.after(() => { if (oldVersion === undefined) delete process.env.PHYNITE_RELEASE_VERSION; else process.env.PHYNITE_RELEASE_VERSION = oldVersion; });
  process.env.PHYNITE_RELEASE_VERSION = '0.1.1';
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    calls++;
    assert.equal(url, 'https://registry.npmjs.org/phynite-lab/latest');
    assert.equal(new Headers(init.headers).get('authorization'), null);
    return Response.json({ name: 'phynite-lab', version: '0.1.2' });
  });
  const context = { params: Promise.resolve({ path: ['updates'] }) };
  process.env.PHYNITE_BUILD_TARGET = 'hosted';
  assert.equal((await localRoute.GET(new NextRequest('http://127.0.0.1:3000/api/local/updates'), context)).status, 404);
  assert.equal(calls, 0);
  process.env.PHYNITE_BUILD_TARGET = 'local';
  assert.equal((await localRoute.POST(request('/api/local/updates'), context)).status, 404);
  assert.equal(calls, 0);
  const response = await localRoute.GET(new NextRequest('http://127.0.0.1:3000/api/local/updates'), context);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.json()).status, 'available');
  assert.equal(calls, 1);
});

function fixture(t: TestContext) {
  for (const [key, value] of Object.entries({
    PHYNITE_BUILD_TARGET: 'local', PHYNITE_APP_MODE: 'local',
    PHYNITE_LOCAL_API_URL: 'http://127.0.0.1:49125', PHYNITE_LOCAL_SERVICE_TOKEN: 'fixture-local-service',
  })) {
    const previous = process.env[key]; process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
}
const request = (path: string, payload = {}) => new NextRequest('http://127.0.0.1:3000' + path, {
  method: 'POST', headers: { Origin: 'http://127.0.0.1:3000', 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
});

test('local cloud login verifies connection without issuing a hosted cookie or changing local identity', async t => {
  fixture(t);
  t.mock.method(globalThis, 'fetch', async (input: string, init: RequestInit) => {
    assert.equal(input, 'http://127.0.0.1:49125/__local/cloud/login');
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer fixture-local-service');
    assert.deepEqual(JSON.parse(String(init.body)), { identifier: 'researcher@example.test', password: 'fixture-password' });
    return Response.json({ authenticated: true, connected: true, accountId: 'cloud-account', account: 'researcher@example.test' });
  });
  const response = await login(request('/api/auth/login', { identifier: ' Researcher@Example.Test ', password: 'fixture-password' }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('set-cookie'), null);
  assert.deepEqual(await response.json(), { authenticated: false, mode: 'local', cloud: { authenticated: true, connected: true, accountId: 'cloud-account', account: 'researcher@example.test' } });
});

test('failed or incomplete cloud login cannot become a successful local cloud session', async t => {
  fixture(t);
  for (const [status, payload, expected] of [
    [401, { error: 'Credentials rejected.', code: 'CLOUD_LOGIN_FAILED' }, 401],
    [503, { error: 'Service unavailable.', code: 'CLOUD_NOT_CONFIGURED' }, 503],
    [200, { connected: false, authenticated: false }, 502],
    [200, {}, 502],
  ] as const) {
    t.mock.method(globalThis, 'fetch', async () => Response.json(payload, { status }));
    const response = await login(request('/api/auth/login', { identifier: 'researcher', password: 'fixture-password' }));
    assert.equal(response.status, expected);
    assert.equal(response.headers.get('set-cookie'), null);
    const result = await response.json() as { authenticated?: boolean };
    assert.equal(result.authenticated, undefined);
    t.mock.restoreAll();
  }
});

test('local logout and session use the local cloud connection without replacing the workspace identity', async t => {
  fixture(t);
  const localSession = { authenticated: false, mode: 'local', user: { id: 'local-stable-owner', email: '', name: 'Local Researcher' }, cloud: { authenticated: false, connected: false } };
  const paths: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string, init: RequestInit) => {
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer fixture-local-service');
    paths.push(input);
    return Response.json(input.endsWith('/session') ? localSession : { connected: false });
  });
  const response = await logout(request('/api/auth/logout'));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { signedOut: true, mode: 'local' });
  const current = await session(new NextRequest('http://127.0.0.1:3000/api/auth/session'));
  assert.deepEqual(await current.json(), localSession);
  assert.deepEqual(paths, ['http://127.0.0.1:49125/__local/cloud/logout', 'http://127.0.0.1:49125/__local/session']);
});

test('Materials Project settings use the authenticated local backend and return uncached status only', async t => {
  fixture(t);
  const key = '0123456789abcdef0123456789abcdef';
  const status = { configured: true, source: 'settings', credentialStorage: 'os-keychain', persistent: true, verified: false, checkedAt: null };
  const requests: Array<{ method: string; path: string; payload?: unknown }> = [];
  t.mock.method(globalThis, 'fetch', async (input: string, init: RequestInit) => {
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer fixture-local-service');
    const payload = init.body ? JSON.parse(new TextDecoder().decode(init.body as Uint8Array)) : undefined;
    requests.push({ method: init.method!, path: input, payload });
    return Response.json(status);
  });
  for (const method of ['GET', 'PUT', 'DELETE'] as const) {
    const response = await localRoute[method](new NextRequest('http://127.0.0.1:3000/api/local/materials-project', {
      method,
      ...(method === 'GET' ? {} : { headers: { Origin: 'http://127.0.0.1:3000', 'Content-Type': 'application/json' }, body: JSON.stringify(method === 'PUT' ? { apiKey: key } : {}) }),
    }), { params: Promise.resolve({ path: ['materials-project'] }) });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), status);
  }
  assert.deepEqual(requests, [
    { method: 'GET', path: 'http://127.0.0.1:49125/__local/materials-project', payload: undefined },
    { method: 'PUT', path: 'http://127.0.0.1:49125/__local/materials-project', payload: { apiKey: key } },
    { method: 'DELETE', path: 'http://127.0.0.1:49125/__local/materials-project', payload: {} },
  ]);
});

test('Materials Project settings reject foreign origins, hidden endpoints and hosted requests', async t => {
  fixture(t);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('Rejected settings request reached backend'); });
  const context = (path: string[]) => ({ params: Promise.resolve({ path }) });
  const foreign = new NextRequest('http://127.0.0.1:3000/api/local/materials-project', {
    method: 'PUT', headers: { Origin: 'https://foreign.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey: 'fixture-only-key' }),
  });
  assert.equal((await localRoute.PUT(foreign, context(['materials-project']))).status, 403);
  for (const path of [['materials-project', 'environment'], ['materials-project', 'key'], ['materials-project', 'search', 'extra']]) {
    assert.equal((await localRoute.GET(new NextRequest('http://127.0.0.1:3000/api/local/' + path.join('/')), context(path))).status, 404);
  }
  assert.equal((await localRoute.POST(request('/api/local/materials-project/search'), context(['materials-project', 'search']))).status, 404);
  process.env.PHYNITE_BUILD_TARGET = 'hosted';
  assert.equal((await localRoute.GET(new NextRequest('http://127.0.0.1:3000/api/local/materials-project'), context(['materials-project']))).status, 404);
  assert.equal(calls, 0);
});

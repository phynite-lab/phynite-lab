import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { readFile } from 'node:fs/promises';
import { searchServerCrystalDatabase } from '../lib/crystal-database-server.ts';
import { executeAiTool } from '../lib/ai-tools.ts';

function localFixture(t: TestContext) {
  for (const [key, value] of Object.entries({
    PHYNITE_BUILD_TARGET: 'local', PHYNITE_APP_MODE: 'local',
    PHYNITE_LOCAL_API_URL: 'http://127.0.0.1:49125', PHYNITE_LOCAL_SERVICE_TOKEN: 'fixture-service',
    MP_API_KEY: 'fixture-env-not-forwarded',
  })) {
    const previous = process.env[key]; process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
}

test('local manual and AI crystal searches use the native credential connection without receiving its key', async t => {
  localFixture(t);
  const fixture = JSON.parse(await readFile(new URL('./fixtures/crystal-database-imports.json', import.meta.url), 'utf8')).materialsProject;
  const paths: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string, init: RequestInit) => {
    const url = new URL(input);
    assert.equal(url.origin, 'http://127.0.0.1:49125');
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer fixture-service');
    assert.equal(new Headers(init.headers).get('x-api-key'), null);
    assert.equal(init.cache, 'no-store');
    assert.equal(init.redirect, 'error');
    assert.equal(String(input).includes('fixture-env'), false);
    paths.push(url.pathname);
    return Response.json(url.pathname.endsWith('/search') ? { data: [JSON.parse(fixture.sourceData.content)] } : { configured: true });
  });
  const manual = await searchServerCrystalDatabase('Si');
  assert.equal(manual.source, 'Materials Project');
  assert.equal(manual.materials[0].provenance.sourceSha256, fixture.provenance.sourceSha256);
  const ai = await executeAiTool('search_crystal_structures', { query: fixture.materialId, source: 'materials-project' }, 'chat', async () => { throw new Error('Unexpected project operation.'); }, new AbortController().signal);
  const material = (ai.result as { materials: Array<Record<string, unknown>> }).materials[0];
  assert.equal(material.materialId, fixture.materialId);
  assert.equal(material.atoms, undefined);
  assert.equal(material.sourceData, undefined);
  assert.deepEqual(paths, ['/__local/materials-project', '/__local/materials-project/search', '/__local/materials-project/search']);
});

test('local Materials Project connection failure remains visible without substituting COD', async t => {
  localFixture(t);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (input: string) => {
    calls++;
    assert.equal(new URL(input).pathname, '/__local/materials-project/search');
    return Response.json({ code: 'MP_API_KEY_MISSING', error: 'Add your key in Settings → Compute.' }, { status: 503 });
  });
  await assert.rejects(searchServerCrystalDatabase('mp-149'), { code: 'MP_API_KEY_MISSING', status: 503 });
  assert.equal(calls, 1);
});

test('COD lookup does not need the native credential connection', async t => {
  localFixture(t);
  const fixture = JSON.parse(await readFile(new URL('./fixtures/crystal-database-imports.json', import.meta.url), 'utf8')).cod;
  t.mock.method(globalThis, 'fetch', async (input: URL) => {
    assert.equal(new URL(input).hostname, 'www.crystallography.net');
    return new Response(fixture.sourceData.content);
  });
  const result = await searchServerCrystalDatabase(fixture.materialId, { source: 'cod' });
  assert.equal(result.materials[0].provenance.sourceSha256, fixture.provenance.sourceSha256);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import 'fake-indexeddb/auto';
import { createFigure, datasetFromText } from '../lib/research-figures.ts';
import { deleteResearchFigure, loadFigureDrafts, loadResearch, saveFigureDraft, saveFigureResearch, saveResearch } from '../lib/research-storage.ts';

Object.defineProperty(globalThis, 'window', { value: new EventTarget(), configurable: true });
const source = () => datasetFromText('k_distance,band_1_ev\n0,1\n1,2', { projectId: 'project-1', name: 'Source', filename: 'bands.csv' });

test('local research survives reopen and is isolated by authenticated owner', async () => {
  const data = await source();
  const saved = await saveResearch('owner-a', 'datasets', data, 0, false);
  assert.equal(saved.status, 'local');
  assert.equal((await loadResearch('owner-a', false)).records[0].document.id, data.id);
  assert.equal((await loadResearch('owner-b', false)).records.length, 0);
  assert.equal((await saveResearch('owner-a', 'datasets', data, 1, false)).history.length, 1);
  await assert.rejects(saveResearch('owner-a', 'datasets', { ...data, name: 'Changed' }, 1, false), /immutable/);
});

test('concurrent edits fail the local revision check without overwriting the winner', async () => {
  const data = await source(), figure = createFigure('project-1', [data], 'single');
  await saveResearch('race-owner', 'figures', figure, 0, false);
  const outcomes = await Promise.allSettled([
    saveResearch('race-owner', 'figures', { ...figure, name: 'First' }, 1, false),
    saveResearch('race-owner', 'figures', { ...figure, name: 'Second' }, 1, false),
  ]);
  assert.equal(outcomes.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter((result) => result.status === 'rejected').length, 1);
  const current = (await loadResearch('race-owner', false)).records[0];
  assert.equal(current.localVersion, 2); assert.equal(current.history.length, 2);
});

test('cloud conflicts retain a local document and never claim a synchronized revision', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Changed elsewhere', code: 'RESEARCH_CONFLICT' }), { status: 409 });
    const data = await source(), figure = createFigure('project-1', [data], 'single');
    const saved = await saveResearch('conflict-owner', 'figures', figure);
    assert.equal(saved.status, 'conflict'); assert.equal(saved.cloudRevision, 0);
    assert.equal((await loadResearch('conflict-owner', false)).records[0].document.id, figure.id);
  } finally { globalThis.fetch = originalFetch; }
});

test('a delayed cloud reply cannot overwrite a more recent local edit', async () => {
  const originalFetch = globalThis.fetch;
  let finish!: (response: Response) => void;
  let started!: () => void;
  const pending = new Promise<void>((resolve) => { started = resolve; });
  try {
    globalThis.fetch = async () => { started(); return new Promise<Response>((resolve) => { finish = resolve; }); };
    const data = await source(), figure = createFigure('project-1', [data], 'single');
    const first = saveResearch('delayed-owner', 'figures', figure);
    await pending;
    await saveResearch('delayed-owner', 'figures', { ...figure, name: 'Newer local edit' }, 1, false);
    finish(new Response(JSON.stringify({ revision: 1 }), { status: 200 }));
    await assert.rejects(first, /changed in another tab/);
    assert.equal((await loadResearch('delayed-owner', false)).records[0].document.name, 'Newer local edit');
  } finally { globalThis.fetch = originalFetch; }
});

test('autosaved drafts remain separate from explicitly saved revision history', async () => {
  const data = await source(), figure = createFigure('project-1', [data], 'single');
  await saveResearch('draft-owner', 'figures', figure, 0, false);
  await saveFigureDraft('draft-owner', { ...figure, name: 'Unsaved draft' });
  const records = (await loadResearch('draft-owner', false)).records;
  assert.equal(records[0].document.name, 'Untitled figure'); assert.equal(records[0].history.length, 1);
  assert.equal((await loadFigureDrafts('draft-owner', 'project-1'))[0].name, 'Unsaved draft');
  assert.equal((await loadFigureDrafts('another-owner', 'project-1')).length, 0);
});

test('deleting a local figure removes its draft but retains numerical source data', async () => {
  const data = await source(), figure = createFigure('project-1', [data], 'single');
  await saveResearch('delete-owner', 'datasets', data, 0, false);
  await saveResearch('delete-owner', 'figures', figure, 0, false);
  await saveFigureDraft('delete-owner', { ...figure, name: 'Working draft' });
  await deleteResearchFigure('delete-owner', figure.id, false);
  const records = (await loadResearch('delete-owner', false)).records;
  assert.equal(records.some((record) => record.collection === 'figures'), false);
  assert.equal(records.some((record) => record.collection === 'datasets' && record.document.id === data.id), true);
  assert.equal((await loadFigureDrafts('delete-owner', 'project-1')).length, 0);
});

test('an older server rejecting deletion retains the local figure and draft', async () => {
  const originalFetch = globalThis.fetch;
  const owner = 'unsupported-delete-owner';
  const data = await source(), figure = createFigure('project-1', [data], 'single');
  await saveResearch(owner, 'figures', figure, 0, false);
  await saveFigureDraft(owner, figure);
  try {
    globalThis.fetch = async (_url, options) => {
      assert.equal(options?.method, 'DELETE');
      return new Response(JSON.stringify({ error: 'Research revisions are retained. Archive a figure in its document instead.', code: 'METHOD_NOT_ALLOWED' }), { status: 405 });
    };
    await assert.rejects(deleteResearchFigure(owner, figure.id), /server needs an update/);
    assert.equal((await loadResearch(owner, false)).records[0].document.id, figure.id);
    assert.equal((await loadFigureDrafts(owner, 'project-1'))[0].id, figure.id);
  } finally { globalThis.fetch = originalFetch; }
});

test('late navigation cleanup cannot overwrite a newer autosaved draft', async () => {
  const data = await source(), figure = createFigure('project-1', [data], 'single');
  const oldDraft = { ...figure, caption: 'Old caption', updatedAt: '2026-09-06T00:00:00.000Z' };
  const newDraft = { ...figure, caption: 'Latest caption', updatedAt: '2026-09-06T00:00:01.000Z' };
  await saveFigureDraft('navigation-owner', newDraft);
  await saveFigureDraft('navigation-owner', oldDraft);
  assert.equal((await loadFigureDrafts('navigation-owner', 'project-1'))[0].caption, 'Latest caption');
});

test('explicitly accepting a cloud revision can replace a newer local draft', async () => {
  const data = await source(), figure = createFigure('project-1', [data], 'single');
  const cloudFigure = { ...figure, caption: 'Chosen cloud revision', updatedAt: '2026-09-06T00:00:00.000Z' };
  await saveFigureDraft('adopt-cloud-owner', { ...figure, caption: 'Local conflict', updatedAt: '2026-09-06T00:00:01.000Z' });
  await saveFigureDraft('adopt-cloud-owner', cloudFigure, { replace: true });
  assert.equal((await loadFigureDrafts('adopt-cloud-owner', 'project-1'))[0].caption, 'Chosen cloud revision');
});

test('an unavailable cloud research API preserves local figures without repeated missing-route requests', async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  try {
    const data = await source(), figure = createFigure('project-1', [data], 'single');
    await saveResearch('missing-api-owner', 'figures', figure, 0, false);
    globalThis.fetch = async () => { requests += 1; return new Response(JSON.stringify({ error: 'API route was not found.', code: 'NOT_FOUND' }), { status: 404 }); };
    const loaded = await loadResearch('missing-api-owner');
    assert.equal(loaded.records[0].document.id, figure.id);
    assert.match(loaded.warning ?? '', /saved on this device/);
    assert.equal(requests, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test('frequent autosaves replace the working copy and preserve manual checkpoints', async () => {
  const data = await source(), figure = createFigure('project-1', [data], 'single');
  let saved = await saveResearch('auto-history', 'figures', figure, 0, false);
  for (let index = 0; index < 120; index += 1) {
    saved = await saveResearch('auto-history', 'figures', { ...figure, caption: `Edit ${index}` }, saved.localVersion, false, { autosave: true });
  }
  assert.equal(saved.history.length, 2);
  assert.equal(saved.history[0].document.caption, '');
  assert.equal(saved.history[1].document.caption, 'Edit 119');
  saved = await saveResearch('auto-history', 'figures', saved.document, saved.localVersion, false);
  assert.equal(saved.history.length, 2);
  assert.equal(saved.history[1].autosave, undefined);
});

test('queued figure saves upload sources first and retain edits made during a cloud request', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ path: string; body: { document: { caption?: string }; baseRevision: number; autosave?: boolean } }> = [];
  let finish!: () => void, started!: () => void;
  const pending = new Promise<void>((resolve) => { started = resolve; });
  try {
    globalThis.fetch = async (path, options) => {
      const body = JSON.parse(options?.body as string);
      calls.push({ path: String(path), body });
      if (String(path).includes('/figures/') && body.baseRevision === 0) { started(); await new Promise<void>((resolve) => { finish = resolve; }); }
      return new Response(JSON.stringify({ revision: body.baseRevision + 1 }), { status: 200 });
    };
    const data = await source(), figure = createFigure('project-1', [data], 'single');
    const first = saveFigureResearch('auto-queue', figure, [data], 0, true);
    await pending;
    const second = saveFigureResearch('auto-queue', { ...figure, caption: 'Typed while saving' }, [data], 0, true);
    finish();
    await first;
    const saved = await second;
    assert.match(calls[0].path, /datasets/);
    assert.deepEqual(calls.filter((call) => call.path.includes('/figures/')).map((call) => [call.body.baseRevision, call.body.autosave]), [[0, true], [1, true]]);
    assert.equal(saved.record.status, 'synced');
    assert.equal(saved.record.document.caption, 'Typed while saving');
    assert.equal(saved.record.history.length, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test('source upload failure keeps a local figure and retries its sources before claiming cloud save', async () => {
  const originalFetch = globalThis.fetch;
  let online = false;
  const calls: string[] = [];
  try {
    globalThis.fetch = async (path, options) => {
      calls.push(String(path));
      if (!online) throw new TypeError('Failed to fetch');
      const body = JSON.parse(options?.body as string);
      return new Response(JSON.stringify({ revision: body.baseRevision + 1 }), { status: 200 });
    };
    const data = await source(), figure = createFigure('project-1', [data], 'single');
    const offline = await saveFigureResearch('auto-retry', figure, [data], 0, true);
    assert.equal(offline.record.status, 'local');
    assert.equal(calls.filter((path) => path.includes('/figures/')).length, 0);
    online = true;
    const saved = await saveFigureResearch('auto-retry', figure, [data], offline.record.localVersion, true);
    assert.equal(saved.record.status, 'synced');
    assert.equal(saved.record.history.length, 1);
    assert.equal(calls.length, 3);
  } finally { globalThis.fetch = originalFetch; }
});

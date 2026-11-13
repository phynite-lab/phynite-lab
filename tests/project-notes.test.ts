import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { NoteDraftSaver, NoteRecovery } from '../lib/note-recovery.ts';
import { noteContentIssue, noteSelection, type NoteDraft } from '../lib/project-notes.ts';
const draft = (sequence: number): NoteDraft => ({ key: 'owner:project:note:editor', owner: 'owner', projectId: 'project', noteId: 'note', editorId: 'editor', sequence, text: `typed ${sequence}`, name: 'Title', baseRevision: 'rev1', updatedAt: 1 });
test('IndexedDB recovery preserves exact text and rejects late older writes', async () => {
  const recovery = new NoteRecovery(new IDBFactory());
  const latest = { ...draft(2), text: '\ufeffα\r\n😀' }; await recovery.put(latest);
  await assert.rejects(recovery.put(draft(1)));
  assert.deepEqual(await recovery.get(latest.key), latest);
  assert.equal(await recovery.get('other-owner:project:note:editor'), undefined);
  assert.deepEqual(await recovery.list('owner', 'project'), [latest]);
  assert.deepEqual(await recovery.list('other-owner', 'project'), []);
  await assert.rejects(recovery.put({ ...latest, name: 'late title' }));
});
test('acceptance flush waits for the in-flight draft and all newer queued text', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let completed = false;
  const written: number[] = [];
  const saver = new NoteDraftSaver(async () => {}, async d => { if (d.sequence === 1) await gate; written.push(d.sequence); }, () => {});
  saver.update(draft(1)); const first = saver.flush('core');
  saver.update(draft(2)); const accepting = saver.flush('core').then(() => { completed = true; });
  await Promise.resolve(); assert.equal(completed, false);
  release(); await Promise.all([first, accepting]); assert.deepEqual(written, [1, 2]); saver.dispose();
});
test('core saves serialize changes typed during an in-flight request and preserve failures', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const written: number[] = [], observed: number[] = [];
  const saver = new NoteDraftSaver(async () => {}, async value => { written.push(value.sequence); if (value.sequence === 1) await gate; }, status => observed.push(status.coreSequence));
  saver.update(draft(1)); const pending = saver.flush('core'); saver.update(draft(2)); release(); await pending;
  assert.deepEqual(written, [1, 2]); assert.equal(observed.at(-1), 2); saver.dispose();
  let failure = '';
  const failing = new NoteDraftSaver(async () => { throw new Error('quota'); }, async () => { throw new Error('disk full'); }, status => { failure = status.browserError ?? status.coreError ?? ''; });
  failing.update(draft(3)); await failing.flush('browser'); assert.equal(failure, 'quota'); failing.dispose();
});
test('Unicode selections and byte limits use different units intentionally', () => {
  assert.deepEqual(noteSelection('😀α first', 2, 9), { start: 1, end: 8 });
  assert.ok(noteContentIssue('α'.repeat(524289)));
  assert.ok(noteContentIssue('![x](data:image/png;base64,x)'));
  assert.equal(noteContentIssue('a formula: $E = mc^2$'), null);
});
test('continuous typing reaches browser and core maximum save deadlines', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const browser: number[] = [], core: number[] = [];
  const saver = new NoteDraftSaver(async d => { browser.push(d.sequence); }, async d => { core.push(d.sequence); }, () => {});
  for (let i = 1; i <= 14; i++) { saver.update(draft(i)); t.mock.timers.tick(400); await Promise.resolve(); await Promise.resolve(); }
  assert.ok(browser.length >= 2); assert.equal(browser[0], 5);
  assert.ok(core.length >= 1); assert.equal(core[0], 13);
  saver.dispose();
});

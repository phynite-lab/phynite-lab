import assert from 'node:assert/strict';
import test from 'node:test';
import { ProjectWorkflowClient } from '../lib/project-workflow-cache.ts';
import { emptyProjectWorkflow } from '../lib/project-workflow.ts';
import { isWorkflowServiceUnavailable } from '../lib/project-workflow-service.ts';
const deferred = <T>() => { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const graph = emptyProjectWorkflow('p');
const modified = { ...graph, nodes: [{ id: 's', kind: 'structure' as const, name: 'Si', position: { x: 0, y: 0 }, resources: [], configuration: { cutoff: 60 } }] };
test('navigation flush without edits preserves an in-flight initial workflow refresh', async () => {
  const read = deferred<{ workflow: typeof graph; revision: number }>(); let writes = 0;
  const client = new ProjectWorkflowClient('owner', 'p', { get: () => read.promise, save: async (workflow, revision) => { writes++; return { workflow, revision: revision + 1 }; } });
  const refreshing = client.refresh();
  await client.flush(); await client.flush();
  assert.equal(client.getSnapshot().status, 'loading'); assert.equal(writes, 0);
  read.resolve({ workflow: modified, revision: 2 }); await refreshing;
  assert.equal(client.getSnapshot().status, 'synced'); assert.equal(client.getSnapshot().revision, 2);
  assert.deepEqual(client.getSnapshot().workflow, modified); assert.equal(client.getSnapshot().error, ''); assert.equal(writes, 0);
});
test('own imported snapshot keeps history epoch and undo writes the current server revision', async () => {
  const revisions: number[] = [];
  const client = new ProjectWorkflowClient('a', 'p', { get: async () => ({ workflow: graph, revision: 0 }), save: async (workflow, revision) => { revisions.push(revision); return { workflow, revision: revision + 1 }; } });
  await client.refresh(); const epoch = client.getSnapshot().historyEpoch;
  assert.equal(client.applyImported({ workflow: modified, revision: 1 }, 0), true);
  assert.equal(client.getSnapshot().historyEpoch, epoch);
  client.change(graph); await client.flush();
  assert.deepEqual(revisions, [1]); assert.deepEqual(client.getSnapshot().workflow, graph);
  client.change(modified);
  assert.equal(client.applyImported({ workflow: graph, revision: 3 }, 2), false);
  assert.equal(client.getSnapshot().status, 'conflict');
  assert.deepEqual(client.getSnapshot().workflow, modified);
  assert.deepEqual(client.getSnapshot().remote, { workflow: graph, revision: 3, migrated: undefined });
});
test('late refresh cannot overwrite an edited scientific draft', async () => {
  const read = deferred<{ workflow: typeof graph; revision: number }>();
  const client = new ProjectWorkflowClient('owner', 'p', { get: () => read.promise, save: async workflow => ({ workflow, revision: 1 }) });
  const refreshing = client.refresh(); client.change(modified); read.resolve({ workflow: graph, revision: 0 }); await refreshing;
  assert.deepEqual(client.getSnapshot().workflow, modified); await client.flush(); assert.equal(client.getSnapshot().status, 'synced');
});
test('edits during a save are serialized and retain the newest draft', async () => {
  const saving = deferred<{ workflow: typeof graph; revision: number }>(), revisions: number[] = [];
  const client = new ProjectWorkflowClient('owner', 'p', { get: async () => ({ workflow: graph, revision: 0 }), save: async (workflow, revision) => { revisions.push(revision); return revision === 0 ? saving.promise : { workflow, revision: revision + 1 }; } });
  client.change(modified); const flush = client.flush(); const newest = { ...modified, nodes: modified.nodes.map(node => ({ ...node, configuration: { cutoff: 80 } })) }; client.change(newest);
  saving.resolve({ workflow: modified, revision: 1 }); await flush;
  assert.deepEqual(revisions, [0, 1]); assert.deepEqual(client.getSnapshot().workflow, newest); assert.equal(client.getSnapshot().revision, 2);
});
test('conflict preserves local input and requires an explicit choice', async () => {
  const remote = { workflow: graph, revision: 2 };
  const client = new ProjectWorkflowClient('owner', 'p', { get: async () => remote, save: async () => { throw { status: 409 }; } });
  client.change(modified); await client.flush(); assert.equal(client.getSnapshot().status, 'conflict'); assert.deepEqual(client.getSnapshot().workflow, modified);
  await client.resolve('remote'); assert.deepEqual(client.getSnapshot().workflow, graph); assert.equal(client.getSnapshot().revision, 2);
});
test('offline draft survives reload and another account cannot read it', async () => {
  const data = new Map<string, string>(), cache = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
  const transport = { get: async () => ({ workflow: graph, revision: 0 }), save: async () => { throw new Error('offline'); } };
  const client = new ProjectWorkflowClient('a', 'p', transport, cache); client.change(modified); await client.flush(); assert.equal(client.getSnapshot().status, 'offline');
  assert.deepEqual(new ProjectWorkflowClient('a', 'p', transport, cache).getSnapshot().workflow, modified);
  assert.deepEqual(new ProjectWorkflowClient('b', 'p', transport, cache).getSnapshot().workflow, graph);
});
test('late account response and conflict fetch failure cannot replace current state', async () => {
  const read = deferred<{ workflow: typeof graph; revision: number }>();
  const client = new ProjectWorkflowClient('a', 'p', { get: () => read.promise, save: async () => { throw { status: 409 }; } });
  client.change(modified); const pending = client.refresh(); client.dispose(); read.reject(new Error('offline')); await pending;
  assert.deepEqual(client.getSnapshot().workflow, modified);
});

test('drag interaction ignores in-flight and newly requested remote refreshes until committed', async () => {
  const read = deferred<{ workflow: typeof graph; revision: number }>(); let reads = 0;
  const client = new ProjectWorkflowClient('a', 'p', { get: () => { reads++; return read.promise; }, save: async workflow => ({ workflow, revision: 1 }) });
  const pending = client.refresh(); client.beginInteraction(); await client.refresh();
  read.resolve({ workflow: graph, revision: 3 }); await pending;
  assert.equal(reads, 1); assert.equal(client.getSnapshot().revision, 0);
  client.change(modified); client.endInteraction(); await client.flush();
  assert.deepEqual(client.getSnapshot().workflow, modified); assert.equal(client.getSnapshot().revision, 1);
});
test('an accepted external revision resets undo history and malformed revisions cannot be saved', async () => {
  const client = new ProjectWorkflowClient('a', 'p', { get: async () => ({ workflow: modified, revision: 2 }), save: async workflow => ({ workflow, revision: -1 }) });
  await client.refresh(); assert.equal(client.getSnapshot().historyEpoch, 1);
  client.change(graph); await client.flush(); assert.equal(client.getSnapshot().status, 'offline');
  assert.equal(client.getSnapshot().revision, 2); assert.deepEqual(client.getSnapshot().workflow, graph);
});

const missingRoute = () => Object.assign(new Error('API route was not found.'), { status: 404, code: 'NOT_FOUND' });
test('older backend preserves local edits across reload, stops autosave retries and recovers on availability check', async () => {
  const data = new Map<string, string>(), cache = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
  let available = false, writes = 0;
  const transport = { get: async () => { if (!available) throw missingRoute(); return { workflow: graph, revision: 0 }; }, save: async (workflow: typeof graph, revision: number) => { writes++; return { workflow, revision: revision + 1 }; } };
  const client = new ProjectWorkflowClient('a', 'p', transport, cache);
  await client.refresh(); assert.equal(client.getSnapshot().status, 'unavailable');
  client.change(modified); await client.flush();
  assert.equal(writes, 0); assert.equal(client.getSnapshot().status, 'unavailable'); assert.equal(client.getSnapshot().localSaved, true);
  client.dispose(); const reloaded = new ProjectWorkflowClient('a', 'p', transport, cache);
  await reloaded.refresh(); assert.deepEqual(reloaded.getSnapshot().workflow, modified);
  assert.equal(new ProjectWorkflowClient('b', 'p', transport, cache).getSnapshot().workflow.nodes.length, 0);
  available = true; await reloaded.refresh();
  assert.equal(writes, 1); assert.equal(reloaded.getSnapshot().status, 'synced'); assert.deepEqual(reloaded.getSnapshot().workflow, modified);
});
test('missing route on save preserves revision and never masks a missing project or authentication failure', async () => {
  const client = new ProjectWorkflowClient('a', 'p', { get: async () => ({ workflow: graph, revision: 3 }), save: async () => { throw missingRoute(); } });
  await client.refresh(); client.change(modified); await client.flush();
  assert.equal(client.getSnapshot().status, 'unavailable'); assert.equal(client.getSnapshot().revision, 3);
  assert.equal(client.getSnapshot().localSaved, false); assert.deepEqual(client.getSnapshot().workflow, modified);
  for (const error of [Object.assign(new Error('Project was not found.'), { status: 404, code: 'NOT_FOUND' }), { status: 401, code: 'UNAUTHORIZED' }, new Error('offline')]) assert.equal(isWorkflowServiceUnavailable(error), false);
});
test('availability recovery still requires an explicit choice if another device saved a newer revision', async () => {
  let available = false;
  const client = new ProjectWorkflowClient('a', 'p', { get: async () => { if (!available) throw missingRoute(); return { workflow: graph, revision: 2 }; }, save: async () => { throw new Error('Must not overwrite remote'); } });
  await client.refresh(); client.change(modified); available = true; await client.refresh();
  assert.equal(client.getSnapshot().status, 'conflict'); assert.deepEqual(client.getSnapshot().workflow, modified); assert.equal(client.getSnapshot().remote?.revision, 2);
});
test('first synchronization never overwrites migrated inputs at revision zero with an unseen local draft', async () => {
  let available = false, writes = 0;
  const remote = { ...modified, nodes: modified.nodes.map(node => ({ ...node, id: 'retained', name: 'Retained scientific input' })) };
  const client = new ProjectWorkflowClient('a', 'p', { get: async () => { if (!available) throw missingRoute(); return { workflow: remote, revision: 0 }; }, save: async workflow => { writes++; return { workflow, revision: 1 }; } });
  await client.refresh(); client.change(modified); available = true; await client.refresh();
  assert.equal(client.getSnapshot().status, 'conflict'); assert.equal(writes, 0);
  assert.deepEqual(client.getSnapshot().workflow, modified); assert.deepEqual(client.getSnapshot().remote?.workflow, remote);
  await client.resolve('local'); assert.equal(writes, 1); assert.equal(client.getSnapshot().status, 'synced');
});
test('unavailable storage and late unsupported-backend responses do not claim a saved draft', async () => {
  const read = deferred<{ workflow: typeof graph; revision: number }>();
  const client = new ProjectWorkflowClient('a', 'p', { get: () => read.promise, save: async workflow => ({ workflow, revision: 1 }) }, { getItem: () => null, removeItem: () => {}, setItem: () => { throw new Error('blocked'); } });
  client.change(modified); assert.equal(client.getSnapshot().localSaved, false); assert.match(client.getSnapshot().error, /storage is unavailable/);
  const pending = client.refresh(); client.dispose(); read.reject(missingRoute()); await pending;
  assert.notEqual(client.getSnapshot().status, 'unavailable');
});

test('storage contention retries serially without inventing a scientific revision conflict', async () => {
  let writes = 0, reads = 0;
  const client = new ProjectWorkflowClient('owner', 'p', {
    get: async () => { reads++; return { workflow: graph, revision: 0 }; },
    save: async (workflow, revision) => {
      if (++writes === 1) throw Object.assign(new Error('Retry the storage reservation.'), {status:409,code:'STORAGE_RESERVATION_BUSY'});
      return {workflow,revision:revision+1};
    },
  });
  client.change(modified);await client.flush();
  assert.equal(writes,2);assert.equal(reads,0);assert.equal(client.getSnapshot().status,'synced');assert.equal(client.getSnapshot().revision,1);
});

test('an invalid input response preserves the actionable error instead of offering to overwrite another device', async () => {
  const client = new ProjectWorkflowClient('owner','p',{
    get: async () => { throw new Error('A validation error must not fetch a conflict version.'); },
    save: async () => { throw Object.assign(new Error('Select the current input revision.'),{status:409,code:'WORKFLOW_RESOURCE_CHANGED'}); },
  });
  client.change(modified);await client.flush();
  assert.equal(client.getSnapshot().status,'offline');assert.equal(client.getSnapshot().error,'Select the current input revision.');assert.deepEqual(client.getSnapshot().workflow,modified);assert.equal(client.getSnapshot().remote,undefined);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { openProjectWorkflow, preservedProjectEditorHref } from '../lib/project-workflow-opening.ts';
import { emptyProjectWorkflow, type WorkflowEnvelope } from '../lib/project-workflow.ts';
import type { PhyniteProject } from '../lib/phynite-api.ts';
import type { StoredWorkspaceSnapshot } from '../lib/workspace-storage.ts';

const project: PhyniteProject = { id: 'canonical', legacyId: 'old', name: 'Old study', description: '', tags: [], createdAt: '', updatedAt: '', lastOpenedAt: '' };
const snapshot: StoredWorkspaceSnapshot = { version: 1, projects: [{ id: 'old', name: 'Old study' }], materials: [{ id: 'Si', projectId: 'old', name: 'Silicon', formula: 'Si', atoms: [{ species: 'Si', x: 0, y: 0, z: 0 }] }], calculationComponents: [{ id: 'scf', materialId: 'Si', name: 'Exact input' }], calculationConfigurations: [{ materialId: 'Si', input: 'preserve exact settings' }], jobs: [{ id: 'job', materialId: 'Si', componentId: 'scf', name: 'Previous run', status: 'Completed' }] };
function fixture(revision = 0) {
  const saved: WorkflowEnvelope[] = [];
  const envelope = { workflow: emptyProjectWorkflow(project.id), revision } as WorkflowEnvelope;
  const api = { project: async () => ({ project }), migrate: async (input: { legacyId: string; remoteId?: string; name: string; description?: string }) => { assert.equal(input.legacyId, 'old'); return { project }; }, get: async () => envelope, save: async (_id: string, workflow: typeof envelope.workflow, baseRevision: number) => { assert.equal(baseRevision, 0); const result = { ...envelope, workflow, revision: 1 }; saved.push(result); return result; } };
  return { api, saved, envelope };
}
test('canonical legacy alias restores local structures and exact input/history without stored remoteId', async () => {
  const { api, saved } = fixture();
  assert.deepEqual(await openProjectWorkflow('canonical', snapshot, api), { projectId: 'canonical' });
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].workflow.nodes.map(node => node.id), ['Si', 'legacy_scf']);
  assert.deepEqual(saved[0].workflow.nodes[1].configuration.preservedConfigurations, snapshot.calculationConfigurations);
  assert.deepEqual(saved[0].workflow.nodes[1].configuration.preservedHistory, snapshot.jobs);
  assert.equal(snapshot.projects![0].remoteId, undefined);
});
test('a direct link to an older local project id migrates it without treating the id as canonical', async () => {
  const { api, saved } = fixture(); let migration: { legacyId: string; remoteId?: string } | undefined;
  api.project = async () => { throw new Error('A legacy local ID is not a server project.'); };
  api.migrate = async input => {
    migration = input;
    if (input.remoteId) throw Object.assign(new Error('Project was not found.'), { status: 404, code: 'PROJECT_NOT_FOUND' });
    return { project, alias: 'legacy-old' };
  };
  assert.deepEqual(await openProjectWorkflow('old', snapshot, api), { projectId: 'canonical' });
  assert.equal(migration?.legacyId, 'old');
  assert.equal(migration?.remoteId, undefined);
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].workflow.nodes[1].configuration.preservedConfigurations, snapshot.calculationConfigurations);
  assert.deepEqual(saved[0].workflow.nodes[1].configuration.preservedHistory, snapshot.jobs);
});
test('direct legacy links fall back to their original editor on an older server', async () => {
  const { api } = fixture();
  api.migrate = async () => { throw { status: 404, code: 'NOT_FOUND', message: 'API route was not found.' }; };
  assert.deepEqual(await openProjectWorkflow('old', snapshot, api), { projectId: '', legacyHref: '/calculation?legacy=1&project=old' });
});
test('original-editor recovery resolves old and linked URLs only inside the verified snapshot', () => {
  assert.equal(preservedProjectEditorHref('old', snapshot), '/calculation?legacy=1&project=old');
  assert.equal(preservedProjectEditorHref('legacy-old', snapshot), '/calculation?legacy=1&project=old');
  const linked = { ...snapshot, projects: [{ ...snapshot.projects![0], remoteId: 'canonical' }] };
  assert.equal(preservedProjectEditorHref('canonical', linked), '/calculation?legacy=1&project=old');
  assert.equal(preservedProjectEditorHref('canonical', snapshot), undefined);
  assert.equal(preservedProjectEditorHref('legacy-other', snapshot), undefined);
  assert.equal(preservedProjectEditorHref('legacy-old', null), undefined);
});
test('legacy URL resolves once and never overwrites an existing canonical revision', async () => {
  const { api, saved } = fixture(3);
  api.project = async () => { throw new Error('Legacy route needs no metadata lookup'); };
  assert.deepEqual(await openProjectWorkflow('legacy-old', snapshot, api), { projectId: 'canonical' });
  assert.equal(saved.length, 0);
});
test('a raced migration rereads the canonical revision, without overwriting it', async () => {
  const { api, envelope } = fixture(); let reads = 0;
  api.get = async () => ({ ...envelope, revision: reads++ ? 1 : 0 });
  api.save = async () => { throw Object.assign(new Error('Changed elsewhere'), { status: 409 }); };
  assert.deepEqual(await openProjectWorkflow('canonical', snapshot, api), { projectId: 'canonical' });
  assert.equal(reads, 2);
  reads = 0; api.get = async () => envelope;
  await assert.rejects(openProjectWorkflow('canonical', snapshot, api), /Changed elsewhere/);
});
test('failed initial migration is retryable and does not mutate the local snapshot', async () => {
  const { api, saved } = fixture(); const original = structuredClone(snapshot), save = api.save;
  api.save = async () => { throw new Error('Temporary outage'); };
  await assert.rejects(openProjectWorkflow('canonical', snapshot, api), /Temporary outage/);
  assert.deepEqual(snapshot, original);
  api.save = save;
  await openProjectWorkflow('canonical', snapshot, api);
  assert.equal(saved.length, 1);
});
test('canonical opening without an owner-verified snapshot makes no migration calls', async () => {
  const { api } = fixture();
  api.project = api.migrate = async () => { throw new Error('Do not read another owner snapshot'); };
  assert.deepEqual(await openProjectWorkflow('canonical', null, api), { projectId: 'canonical' });
  await assert.rejects(openProjectWorkflow('legacy-old', null, api), /could not be found/);
});
test('an older server still opens the preserved local editor; permission failures stay explicit', async () => {
  const { api } = fixture();
  api.migrate = async () => { throw { status: 404, code: 'NOT_FOUND', message: 'API route was not found.' }; };
  assert.equal((await openProjectWorkflow('legacy-old', snapshot, api)).legacyHref, '/calculation?legacy=1&project=old');
  assert.equal((await openProjectWorkflow('old', snapshot, api)).legacyHref, '/calculation?legacy=1&project=old');
  const linked = { ...snapshot, projects: [{ ...snapshot.projects![0], remoteId: 'canonical' }] };
  assert.equal((await openProjectWorkflow('canonical', linked, api)).legacyHref, '/calculation?legacy=1&project=old');
  api.migrate = async () => { throw Object.assign(new Error('Forbidden'), { status: 403 }); };
  await assert.rejects(openProjectWorkflow('legacy-old', snapshot, api), /Forbidden/);
});
test('a missing linked project opens the preserved local copy without recreating or rewriting research', async () => {
  const { api, saved } = fixture();
  const linked = { ...snapshot, projects: [{ ...snapshot.projects![0], remoteId: 'missing' }] };
  const original = structuredClone(linked); let calls = 0;
  api.migrate = async () => { calls += 1; throw Object.assign(new Error('Project was not found.'), { status: 404, code: 'PROJECT_NOT_FOUND' }); };
  assert.deepEqual(await openProjectWorkflow('missing', linked, api), { projectId: '', legacyHref: '/calculation?legacy=1&project=old' });
  assert.equal(calls, 1);
  assert.equal(saved.length, 0);
  assert.deepEqual(linked, original);
  api.migrate = async () => { throw Object.assign(new Error('Stored workflow is corrupt.'), { status: 409, code: 'WORKFLOW_CORRUPT' }); };
  await assert.rejects(openProjectWorkflow('missing', linked, api), /corrupt/);
});

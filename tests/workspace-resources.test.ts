import test from 'node:test';
import assert from 'node:assert/strict';
import { ResourceAccountStore } from '../lib/resource-account-store.ts';
import { jobElapsedSeconds, activeWorkspaceJobs, workspaceJobPath } from '../lib/workspace-resource-metrics.ts';
import { resolvedWorkflowCompute, freezeWorkflowCompute, workflowExecutionCompute } from '../lib/workflow-compute.ts';
import type { AccountResponse, LabAccount } from '../lib/account-api.ts';
import type { ProjectRun, WorkflowNode } from '../lib/project-workflow.ts';
const account = { computeTarget: 'shared', cloudMode: 'paid', computeProfileId: 'verified-profile', estimatedComputeSeconds: 3600,
  personalDefaults: { qe: { vcpus: 4, memoryMiB: 8192 }, 'md-simulation': { vcpus: 2, memoryMiB: 4096 } },
  quanta: { balance: 10, available: 7, reserved: 3, usedThisMonth: 1, usdPerQuanta: 1 } } as LabAccount;
const node = { id: 'n', kind: 'scf', name: 'Si', configuration: {}, resources: [], position: { x: 0, y: 0 } } as WorkflowNode;
test('run allocations preserve explicit settings and MD stays local with its own defaults', () => {
  assert.deepEqual(resolvedWorkflowCompute({ ...node, configuration: { computeTarget: 'personal', vcpus: 8, memoryMiB: 16384 } }, account), { computeTarget: 'personal', vcpus: 8, memoryMiB: 16384, estimatedComputeSeconds: 3600 });
  assert.deepEqual(resolvedWorkflowCompute({ ...node, kind: 'md' }, account), { computeTarget: 'personal', vcpus: 2, memoryMiB: 4096, estimatedComputeSeconds: 3600 });
  assert.equal(resolvedWorkflowCompute(node, account).computeProfileId, 'verified-profile');
  assert.equal(resolvedWorkflowCompute(node, account).vcpus, undefined);
  assert.equal(resolvedWorkflowCompute({ ...node, kind: 'md-analysis' }, account).vcpus, undefined);
});
test('elapsed uses valid worker start and end; waiting, malformed and reversed intervals stay unknown', () => {
  const start = '2026-10-28T08:00:00Z', end = '2026-10-28T09:30:00Z';
  assert.equal(jobElapsedSeconds(start, end, Date.parse(end) + 60_000), 5400);
  assert.equal(jobElapsedSeconds(start, undefined, Date.parse(end)), 5400);
  assert.equal(jobElapsedSeconds(undefined, undefined, Date.now()), null);
  assert.equal(jobElapsedSeconds('invalid', end, Date.now()), null);
  assert.equal(jobElapsedSeconds(end, start, Date.now()), null);
});
test('active project jobs deduplicate reused branches and never mix elapsed durations', () => {
  const runs = [{ attempts: [{ nodeId: 'n', jobId: 'j', jobKind: 'CALCULATION', status: 'running' }, { nodeId: 'n', jobId: 'old', jobKind: 'CALCULATION', status: 'completed' }] }, { attempts: [{ nodeId: 'n', jobId: 'j', jobKind: 'CALCULATION', status: 'running' }] }] as ProjectRun[];
  const jobs = activeWorkspaceJobs(runs, [node]);
  assert.equal(jobs.length, 1); assert.equal(jobs[0].name, 'Si');
  assert.equal(workspaceJobPath(jobs[0]), '/v1/calculations/j');
  assert.equal(workspaceJobPath({ ...jobs[0], kind: 'unknown' }), null);
});
test('shared resource store deduplicates requests, retains last data on failure and isolates stores', async () => {
  let resolve!: (value: AccountResponse) => void, calls = 0;
  const store = new ResourceAccountStore(() => { calls++; return new Promise(done => { resolve = done; }); });
  const first = store.refresh(), second = store.refresh();
  assert.equal(calls, 1); assert.equal(first, second);
  resolve({ account } as AccountResponse); await first;
  assert.equal(store.getSnapshot().account?.quanta.available, 7);
  const other = new ResourceAccountStore(async () => { throw new Error('Temporarily unavailable'); });
  other.setAccount({ ...account, quanta: { ...account.quanta, balance: 2 } });
  await assert.rejects(other.refresh());
  assert.equal(other.getSnapshot().account?.quanta.balance, 2);
  assert.equal(store.getSnapshot().account?.quanta.balance, 10);
  assert.equal(other.getSnapshot().error, 'Temporarily unavailable');
});

test('MD and analysis execution receive frozen resources without client estimate fields', () => {
  for (const kind of ['md', 'md-analysis', 'extract-frame'] as const) {
    const old = { ...node, kind, configuration: { execution: { vcpus: 3, memoryMiB: 6144, name: 'preserved' }, estimatedComputeSeconds: 90 } };
    const frozen = freezeWorkflowCompute(old, account);
    assert.deepEqual(frozen.configuration.execution, { name: 'preserved', computeTarget: 'personal', vcpus: 3, memoryMiB: 6144 });
    assert.equal(frozen.configuration.estimatedComputeSeconds, 90);
  }
  assert.deepEqual(workflowExecutionCompute({ computeTarget: 'personal', vcpus: 2, memoryMiB: 4096, estimatedComputeSeconds: 90 }), { computeTarget: 'personal', vcpus: 2, memoryMiB: 4096 });
});

test('late account polls cannot overwrite a newer saved default', async () => {
  let resolve!: (value: AccountResponse) => void;
  const store = new ResourceAccountStore(() => new Promise(done => { resolve = done; }));
  const pending = store.refresh();
  const saved = { ...account, personalDefaults: { qe: { vcpus: 2, memoryMiB: 4096 } } };
  store.setAccount(saved);
  resolve({ account } as AccountResponse);
  assert.equal((await pending).account, saved);
  assert.equal(store.getSnapshot().account?.personalDefaults?.qe?.vcpus, 2);
});

test('profile hydration finishes before account-ready subscribers can mount forms', async () => {
  let profileReady = false;
  const store = new ResourceAccountStore(async () => ({ account } as AccountResponse), () => { profileReady = true; });
  store.subscribe(() => { if (store.getSnapshot().account) assert.equal(profileReady, true); });
  await store.refresh();
  assert.equal(profileReady, true);
});

test('a stale account failure cannot replace saved state or republish after logout', async () => {
  let reject!: (error: Error) => void;
  const store = new ResourceAccountStore(() => new Promise((_done, failure) => { reject = failure; }));
  const pending = store.refresh();
  store.setAccount(account);
  reject(new Error('old read failed'));
  await assert.rejects(pending);
  assert.equal(store.getSnapshot().error, '');
  assert.equal(store.getSnapshot().account, account);
  let resolve!: (result: AccountResponse) => void, hydrations = 0;
  const beforeLogout = new ResourceAccountStore(() => new Promise(done => { resolve = done; }), () => { hydrations++; });
  const oldRequest = beforeLogout.refresh();
  beforeLogout.clear();
  resolve({ account }); await oldRequest;
  assert.equal(beforeLogout.getSnapshot().account, null);
  assert.equal(hydrations, 0);
});

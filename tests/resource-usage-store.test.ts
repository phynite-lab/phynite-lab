import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ResourceUsageStore, resourceUsageStore, measuredStorageCapacity, invalidateResourceUsageStores } from '../lib/resource-usage-store.ts';
import type { AccountUsage } from '../lib/account-api.ts';

const usage = { measuredAt: '2026-10-28T11:00:00Z', storage: { bytes: 100, complete: true, researchQuotaBytes: 1000, uploadReservedBytes: 50 } } as AccountUsage;
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

test('inventory is lazy, deduplicated and reused after invalidation until explicitly refreshed', async () => {
  const gate = deferred<AccountUsage>(); let calls = 0;
  const store = new ResourceUsageStore(() => { calls++; return gate.promise; });
  const unsubscribe = store.subscribe(() => {});
  store.invalidate();
  assert.equal(calls, 0);
  const first = store.ensure(), second = store.refresh();
  assert.equal(calls, 1); assert.equal(first, second);
  gate.resolve(usage); await first;
  store.invalidate(); await store.ensure();
  assert.equal(calls, 1); assert.equal(store.getSnapshot().stale, true);
  await store.refresh(); assert.equal(calls, 2);
  assert.equal(store.getSnapshot().usage?.measuredAt, usage.measuredAt);
  unsubscribe();
});

test('failed inventory retains measured data and timestamp while an initial failure stays unknown', async () => {
  const store = new ResourceUsageStore(async () => { throw new Error('Inventory unavailable'); });
  await assert.rejects(store.ensure());
  assert.equal(store.getSnapshot().usage, null);
  store.setUsage(usage); await assert.rejects(store.refresh());
  assert.equal(store.getSnapshot().usage, usage);
  assert.equal(store.getSnapshot().usage?.measuredAt, usage.measuredAt);
  assert.equal(store.getSnapshot().error, 'Inventory unavailable');
  assert.equal(store.getSnapshot().stale, true);
});

test('newer measurements win over late inventory successes and failures', async () => {
  for (const fail of [false, true]) {
    const gate = deferred<AccountUsage>(), store = new ResourceUsageStore(() => gate.promise);
    const pending = store.refresh();
    const newer = { ...usage, measuredAt: '2026-10-28T12:00:00Z' };
    store.setUsage(newer);
    if (fail) { gate.reject(new Error('Late failure')); await assert.rejects(pending); }
    else { gate.resolve(usage); await pending; }
    assert.equal(store.getSnapshot().usage, newer);
    assert.equal(store.getSnapshot().error, '');
    assert.equal(store.getSnapshot().loading, false);
  }
});

test('invalidation during an inventory request keeps the successful snapshot marked stale', async () => {
  const gate = deferred<AccountUsage>(), store = new ResourceUsageStore(() => gate.promise);
  const pending = store.refresh();
  store.invalidate(); gate.resolve(usage); await pending;
  assert.equal(store.getSnapshot().usage, usage);
  assert.equal(store.getSnapshot().stale, true);
});

test('owner stores never expose another owner measurement or pending request', async () => {
  const alpha = resourceUsageStore('usage-alpha'), beta = resourceUsageStore('usage-beta');
  const project = resourceUsageStore('usage-alpha', { projectId: 'project-a' });
  alpha.setUsage(usage);
  assert.equal(resourceUsageStore('usage-alpha'), alpha);
  assert.notEqual(project, alpha);
  assert.equal(resourceUsageStore('usage-alpha', { projectId: 'project-a' }), project);
  assert.equal(beta.getSnapshot().usage, null);
  beta.invalidate();
  assert.equal(alpha.getSnapshot().stale, false);
  assert.equal(alpha.getSnapshot().usage, usage);
});

test('clearing inventory rejects stale publication without cancelling a newer request', async () => {
  for (const fail of [false, true]) {
    const old = deferred<AccountUsage>(), next = deferred<AccountUsage>(); let calls = 0;
    const store = new ResourceUsageStore(() => ++calls === 1 ? old.promise : next.promise);
    const first = store.refresh(); store.clear(); const second = store.refresh();
    if (fail) { old.reject(new Error('Late error')); await assert.rejects(first); }
    else { old.resolve(usage); await first; }
    assert.equal(store.getSnapshot().usage, null);
    assert.equal(store.getSnapshot().error, '');
    assert.equal(store.getSnapshot().loading, true);
    assert.equal(store.refresh(), second);
    next.resolve(usage); await second;
    assert.equal(store.getSnapshot().usage, usage);
  }
});

test('storage free capacity requires complete inventory and known reservations; quota stays current', () => {
  assert.equal(measuredStorageCapacity(null, 2000).free, null);
  assert.equal(measuredStorageCapacity(usage, 2000).free, 1850);
  assert.equal(measuredStorageCapacity({ ...usage, storage: { ...usage.storage, complete: false } }).free, null);
  assert.equal(measuredStorageCapacity({ ...usage, storage: { ...usage.storage, uploadReservedBytes: undefined } }).free, null);
  assert.equal(measuredStorageCapacity({ ...usage, storage: { ...usage.storage, cloudQuotaBytes: 3000 } }).quota, 3000);
  assert.equal(measuredStorageCapacity({ ...usage, storage: { ...usage.storage, bytes: 2000 } }).free, 0);
  assert.equal(measuredStorageCapacity({ ...usage, storage: { ...usage.storage, scope: 'project-objects' } }, 2000).free, null);
});

test('storage purchase invalidates all cached scopes for its owner without starting inventories', () => {
  const account = resourceUsageStore('purchase-owner'), projectA = resourceUsageStore('purchase-owner', { projectId: 'a' }), projectB = resourceUsageStore('purchase-owner', { projectId: 'b' });
  const other = resourceUsageStore('purchase-other', { projectId: 'a' });
  for (const store of [account, projectA, projectB, other]) store.setUsage(usage);
  invalidateResourceUsageStores('purchase-owner');
  for (const store of [account, projectA, projectB]) { assert.equal(store.getSnapshot().stale, true); assert.equal(store.getSnapshot().loading, false); }
  assert.equal(other.getSnapshot().stale, false);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { buildComputePlan } from '../lib/compute-plan.ts';
import { buildResearchContextPack, redactResearchContext } from '../lib/research-context-pack.ts';
import { makeResearchNotification, unseenResearchNotifications } from '../lib/research-notifications.ts';

test('context packs preserve scientific values and omit credential-like keys', () => {
  const value = redactResearchContext({ cutoffRy: 80, token: 'do-not-send', nested: { apiKey: 'secret', energy: -1.25 } });
  assert.deepEqual(value, { cutoffRy: 80, nested: { energy: -1.25 } });
  const pack = buildResearchContextPack('project_1', [{ sourceId: 'run:1', kind: 'resource', id: 'run_1', label: 'SCF run', sha256: 'a'.repeat(64), value: { energyEv: -10 } }], '2026-01-01T00:00:00.000Z');
  assert.equal(pack.readOnly, true);
  assert.equal(pack.sources[0]?.sha256, 'a'.repeat(64));
  assert.equal((pack.sources[0]?.value as { energyEv: number }).energyEv, -10);
});

test('compute plan blocks missing runtime and disk while leaving settings unchanged', () => {
  const plan = buildComputePlan({ destination: 'local', runtimeInstalled: false, solverCapability: true, isolationAvailable: true, potentialsReady: true, inputSaved: true, diskFreeBytes: 100, estimatedBytes: 200, resources: { vcpus: 4, memoryMiB: 4096, maxParallelJobs: 1 } });
  assert.equal(plan.ready, false);
  assert.equal(plan.checks.find(item => item.id === 'runtime')?.status, 'blocked');
  assert.equal(plan.checks.find(item => item.id === 'disk')?.status, 'blocked');
});

test('research notifications are deterministic and deduplicate on device', () => {
  const first = makeResearchNotification({ category: 'run-failed', subjectId: 'run_1', title: 'Run failed', detail: 'preflight', fingerprint: 'preflight:runtime' }, '2026-01-01T00:00:00.000Z');
  const same = makeResearchNotification({ category: 'run-failed', subjectId: 'run_1', title: 'Run failed', detail: 'preflight', fingerprint: 'preflight:runtime' }, '2026-02-01T00:00:00.000Z');
  assert.equal(first.id, same.id);
  assert.equal(unseenResearchNotifications([first, same], new Set([first.id])).length, 0);
});

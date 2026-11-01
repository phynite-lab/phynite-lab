import assert from 'node:assert/strict';
import test from 'node:test';
import { appendWorkspaceProject, createWorkspaceProject, deleteWorkspaceProject, duplicateWorkspaceProject, forceDeleteWorkspaceProject, purgeExpiredWorkspaceProjects, removeDeletedCloudProject, restoreWorkspaceProject, summarizeCalculationWorkspace, updateWorkspaceProject, type StoredWorkspaceSnapshot } from '../lib/workspace-storage.ts';

const timestamp = '2026-09-06T06:00:00.000Z';
test('project accents reflect latest setup outcomes without an old failure overriding a successful rerun', () => {
  const snapshot = { version: 1, projects: [{ id: 'p', name: 'Silicon' }], materials: [{ id: 'm', projectId: 'p', name: 'Si', formula: 'Si' }], calculationComponents: [{ id: 'c', materialId: 'm' }], jobs: [] as { id: string; componentId: string; materialId: string; name: string; status: string }[] };
  const state = () => summarizeCalculationWorkspace(JSON.stringify(snapshot)).projects[0].activityState;
  assert.equal(state(), 'idle');
  snapshot.jobs.unshift({ id: 'failed', componentId: 'c', materialId: 'm', name: 'SCF', status: 'Failed' });
  assert.equal(state(), 'error');
  snapshot.jobs.unshift({ id: 'rerun', componentId: 'c', materialId: 'm', name: 'SCF', status: 'Running' });
  assert.equal(state(), 'running');
  snapshot.jobs[0].status = 'Completed';
  assert.equal(state(), 'completed');
});
test('project creation preserves all existing workspace payloads and uses builder database identity', () => {
  const original = { version: 1 as const, projects: [{ id: 'existing', name: 'Original' }], materials: [{ id: 'atom-model', projectId: 'existing', name: 'Si', formula: 'Si' }], jobs: [], calculationComponents: [], calculationConfigurations: [{ custom: true }], jobDraft: { rawInput: 'keep exactly' }, extraFutureField: { value: 42 }, activeMaterialId: 'atom-model' };
  const result = appendWorkspaceProject(original, '  Strain series  ', '  Compare variants  ', 'new-id', timestamp);
  assert.equal(result.projects?.length, 2);
  assert.equal(result.projects?.[1].databaseId, 'db-workspace');
  assert.equal(result.projects?.[1].name, 'Strain series');
  assert.equal(result.projects?.[1].description, 'Compare variants');
  assert.equal(result.activeProjectId, 'new-id');
  assert.equal(result.activeMaterialId, '');
  assert.equal(result.materials, original.materials);
  assert.equal((result as unknown as typeof original).jobDraft, original.jobDraft);
  assert.equal((result as unknown as typeof original).extraFutureField, original.extraFutureField);
  assert.equal(original.projects.length, 1);
});
test('a first project creates a valid empty builder workspace', () => {
  const result = appendWorkspaceProject(null, 'First study', '', 'new-id', timestamp);
  assert.equal(result.version, 1);
  assert.deepEqual(result.materials, []);
  assert.deepEqual(result.jobs, []);
  assert.equal(result.savedAt, timestamp);
});
test('invalid details and conflicting identity do not overwrite a snapshot', () => {
  for (const name of ['', '   ', 'x'.repeat(101)]) assert.throws(() => appendWorkspaceProject(null, name, '', 'id', timestamp));
  assert.throws(() => appendWorkspaceProject(null, 'Study', 'x'.repeat(501), 'id', timestamp));
  assert.throws(() => appendWorkspaceProject({ version: 1, projects: [{ id: 'id', name: 'Original' }] }, 'New', '', 'id', timestamp));
  assert.throws(() => appendWorkspaceProject({ version: 1, projects: 'invalid' } as unknown as StoredWorkspaceSnapshot, 'New', '', 'id', timestamp));
});
test('browser creation enforces owner and rejects unreadable data before writing', () => {
  const values = new Map<string, string>(); let notifications = 0;
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) }, dispatchEvent: () => { notifications += 1; } } });
  try {
    values.set('phynite:calculation-workspace-owner:v1', 'another-owner');
    assert.throws(() => createWorkspaceProject('owner', 'New', ''));
    assert.equal(notifications, 0);
    values.set('phynite:calculation-workspace-owner:v1', 'owner');
    values.set('phynite:calculation-workspace:v1', '{unreadable');
    assert.throws(() => createWorkspaceProject('owner', 'New', ''));
    assert.equal(values.get('phynite:calculation-workspace:v1'), '{unreadable');
    values.delete('phynite:calculation-workspace:v1');
    const id = createWorkspaceProject('owner', 'New', '');
    assert.equal(JSON.parse(values.get('phynite:calculation-workspace:v1')!).projects[0].id, id);
    assert.equal(notifications, 1);
  } finally { if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window'); }
});

test('workspace project actions preserve scientific history boundaries', () => {
  const values = new Map<string, string>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  let sequence = 0;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) }, dispatchEvent: () => undefined } });
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { randomUUID: () => `uuid-${++sequence}` } });
  try {
    values.set('phynite:calculation-workspace-owner:v1', 'owner');
    values.set('phynite:calculation-workspace:v1', JSON.stringify({ version: 1, projects: [{ id: 'p1', databaseId: 'db-workspace', name: 'Silicon', description: 'Original study' }, { id: 'p2', databaseId: 'db-workspace', name: 'Fallback' }], materials: [{ id: 'm1', projectId: 'p1', name: 'Si', formula: 'Si', atoms: [{ id: 'a1' }], remoteId: 'remote-structure' }, { id: 'm2', projectId: 'p2', name: 'Ge', formula: 'Ge' }], jobs: [{ id: 'j1', materialId: 'm1', name: 'SCF', status: 'Completed' }], calculationConfigurations: [{ id: 'cfg1', materialId: 'm1', name: 'High accuracy' }], calculationComponents: [{ id: 'c1', materialId: 'm1', name: 'SCF', calculation: 'Total energy' }], activeProjectId: 'p1', activeMaterialId: 'm1' }));
    updateWorkspaceProject('owner', 'p1', { name: 'Silicon strain', description: 'Compare ±2% strain' });
    let stored = JSON.parse(values.get('phynite:calculation-workspace:v1')!);
    assert.equal(stored.projects[0].description, 'Compare ±2% strain');
    const copyId = duplicateWorkspaceProject('owner', 'p1');
    stored = JSON.parse(values.get('phynite:calculation-workspace:v1')!);
    assert.equal(stored.projects.find((project: { id: string }) => project.id === copyId).name, 'Silicon strain copy');
    const copiedMaterial = stored.materials.find((material: { projectId: string }) => material.projectId === copyId);
    assert.equal(copiedMaterial.formula, 'Si');
    assert.equal(copiedMaterial.remoteId, undefined);
    assert.equal(stored.jobs.length, 1, 'completed jobs remain historical and are not duplicated');
    assert.equal(stored.calculationConfigurations.filter((configuration: { materialId: string }) => configuration.materialId === copiedMaterial.id).length, 1, 'reusable calculation presets are duplicated');
    assert.equal(stored.calculationComponents.filter((component: { materialId: string }) => component.materialId === copiedMaterial.id).length, 1, 'calculation setup is duplicated without result history');
    deleteWorkspaceProject('owner', 'p1', new Date('2026-09-06T06:00:00.000Z'));
    stored = JSON.parse(values.get('phynite:calculation-workspace:v1')!);
    assert.equal(stored.projects.some((project: { id: string }) => project.id === 'p1'), false);
    assert.equal(stored.materials.some((material: { id: string }) => material.id === 'm1'), false);
    assert.equal(stored.jobs.length, 0);
    assert.equal(stored.calculationConfigurations.some((configuration: { materialId: string }) => configuration.materialId === 'm1'), false);
    assert.equal(stored.calculationComponents.some((component: { materialId: string }) => component.materialId === 'm1'), false);
    assert.equal(stored.projectTrash[0].project.id, 'p1');
    assert.equal(stored.projectTrash[0].expiresAt, '2026-09-21T06:00:00.000Z');
    restoreWorkspaceProject('owner', 'p1', new Date('2026-09-10T06:00:00.000Z'));
    stored = JSON.parse(values.get('phynite:calculation-workspace:v1')!);
    assert.equal(stored.projects.some((project: { id: string }) => project.id === 'p1'), true);
    assert.equal(stored.jobs.some((job: { id: string }) => job.id === 'j1'), true);
    assert.equal(stored.projectTrash.length, 0);
    deleteWorkspaceProject('owner', 'p1', new Date('2026-09-10T06:00:00.000Z'));
    forceDeleteWorkspaceProject('owner', 'p1', new Date('2026-09-11T06:00:00.000Z'));
    stored = JSON.parse(values.get('phynite:calculation-workspace:v1')!);
    assert.equal(stored.projectTrash.length, 0);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window');
    if (previousCrypto) Object.defineProperty(globalThis, 'crypto', previousCrypto); else Reflect.deleteProperty(globalThis, 'crypto');
  }
});

test('expired trash entries are excluded from summaries and purged after 15 days', () => {
  const values = new Map<string, string>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) }, dispatchEvent: () => undefined } });
  try {
    values.set('phynite:calculation-workspace-owner:v1', 'owner');
    values.set('phynite:calculation-workspace:v1', JSON.stringify({ version: 1, projects: [], materials: [], jobs: [], calculationComponents: [], projectTrash: [{ project: { id: 'expired', name: 'Expired' }, materials: [], jobs: [], calculationConfigurations: [], calculationComponents: [], deletedAt: '2026-08-01T00:00:00.000Z', expiresAt: '2026-08-16T00:00:00.000Z' }, { project: { id: 'recoverable', name: 'Recoverable' }, materials: [], jobs: [], calculationConfigurations: [], calculationComponents: [], deletedAt: '2026-09-01T00:00:00.000Z', expiresAt: '2026-09-16T00:00:00.000Z' }] }));
    const summary = summarizeCalculationWorkspace(values.get('phynite:calculation-workspace:v1')!, new Date('2026-09-06T00:00:00.000Z'));
    assert.deepEqual(summary.trashProjects.map((project) => project.id), ['recoverable']);
    assert.equal(summary.trashProjects[0].daysRemaining, 10);
    assert.equal(purgeExpiredWorkspaceProjects('owner', new Date('2026-09-06T00:00:00.000Z')), 1);
    const stored = JSON.parse(values.get('phynite:calculation-workspace:v1')!);
    assert.deepEqual(stored.projectTrash.map((entry: { project: { id: string } }) => entry.project.id), ['recoverable']);
  } finally { if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window'); }
});


test('canonical deletion removes only its linked device data and preserves other projects', () => {
  const values = new Map<string, string>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) }, dispatchEvent: () => undefined } });
  try {
    const snapshot = { version: 1, activeProjectId: 'old', activeMaterialId: 'Si', projects: [{ id: 'old', name: 'Old' }, { id: 'keep', name: 'Keep' }], materials: [{ id: 'Si', projectId: 'old' }, { id: 'C', projectId: 'keep' }], jobs: [{ id: 'oldJob', materialId: 'Si' }, { id: 'keepJob', materialId: 'C' }], calculationComponents: [{ id: 'oldComponent', materialId: 'Si' }], calculationConfigurations: [{ materialId: 'Si', exactInput: 'preserved until successful cloud delete' }] };
    values.set('phynite:calculation-workspace:v1', JSON.stringify(snapshot));
    values.set('phynite:calculation-workspace-owner:v1', 'other');
    assert.throws(() => removeDeletedCloudProject('owner', 'canonical', ['old']));
    assert.deepEqual(JSON.parse(values.get('phynite:calculation-workspace:v1')!), snapshot);
    values.set('phynite:calculation-workspace-owner:v1', 'owner');
    removeDeletedCloudProject('owner', 'canonical', ['old']);
    const saved = JSON.parse(values.get('phynite:calculation-workspace:v1')!);
    assert.deepEqual(saved.projects, [{ id: 'keep', name: 'Keep' }]);
    assert.deepEqual(saved.materials, [{ id: 'C', projectId: 'keep' }]);
    assert.deepEqual(saved.jobs, [{ id: 'keepJob', materialId: 'C' }]);
    assert.deepEqual(saved.calculationConfigurations, []);
    assert.deepEqual(saved.calculationComponents, []);
    assert.equal(saved.activeProjectId, 'keep'); assert.equal(saved.activeMaterialId, 'C');
    removeDeletedCloudProject('owner', 'canonical', ['old']);
    assert.equal(values.get('phynite:calculation-workspace:v1'), JSON.stringify(saved), 'retries are idempotent');
  } finally { if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window'); }
});

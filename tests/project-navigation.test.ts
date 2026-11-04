import assert from 'node:assert/strict';
import test from 'node:test';
import type { PhyniteProject } from '../lib/phynite-api.ts';
import { mergeStudioProjects, projectCreateRequest, recentStudioProjects } from '../lib/project-navigation.ts';
import type { CalculationProjectSummary } from '../lib/workspace-storage.ts';

const localProject = (values: Partial<CalculationProjectSummary> = {}): CalculationProjectSummary => ({
  id: 'local-one',
  name: 'Silicon convergence',
  description: 'Plane-wave cutoff study',
  isActive: false,
  primaryStructure: null,
  structures: [],
  structureCount: 0,
  calculationCount: 0,
  runCount: 0,
  runningCount: 0,
  completedCount: 0,
  activityState: 'idle',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-02T00:00:00.000Z',
  lastOpenedAt: '2026-09-03T00:00:00.000Z',
  ...values,
});

const remoteProject = (values: Partial<PhyniteProject> = {}): PhyniteProject => ({
  id: 'remote-one',
  name: 'Argon melt',
  description: 'Molecular dynamics trajectories',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-04T00:00:00.000Z',
  lastOpenedAt: '2026-09-05T00:00:00.000Z',
  tags: ['MD'],
  ...values,
});

test('recent project navigation merges legacy and canonical projects without choosing a lab', () => {
  const projects = mergeStudioProjects([localProject()], [remoteProject()]);
  assert.deepEqual(projects.map(project => [project.kind, project.href]), [
    ['md', '/projects/remote-one'],
    ['dft', '/projects/legacy-local-one'],
  ]);
});

test('linked cloud records enrich local DFT projects without becoming duplicate rows', () => {
  const projects = mergeStudioProjects([
    localProject({ remoteId: 'remote-one' }),
  ], [
    remoteProject({ tags: ['QE', 'MD'], mdTrajectoryCount: 2 }),
  ]);
  assert.equal(projects.length, 1);
  assert.equal(projects[0]?.kind, 'dft');
  assert.deepEqual(projects[0]?.tags, ['QE', 'MD']);
});

test('a preserved local project remains listed when its linked remote inventory row is absent', () => {
  const projects = mergeStudioProjects([localProject({ remoteId: 'stale-id', structureCount: 1 })], []);
  assert.equal(projects.length, 1);
  assert.equal(projects[0].id, 'local-one');
  assert.equal(projects[0].structureCount, 1);
  assert.equal(projects[0].href, '/projects/stale-id');
});

test('canonical cloud calculation projects remain accessible without a device snapshot', () => {
  const projects = mergeStudioProjects([], [
    remoteProject({ id: 'cloud-qe', description: 'Crystal project', tags: ['QE'] }),
  ]);
  assert.equal(projects.length, 1);
  assert.equal(projects[0].href, '/projects/cloud-qe');
});

test('last-opened time wins over update time and names break exact ties', () => {
  const projects = mergeStudioProjects([
    localProject({ id: 'older', name: 'Zinc', updatedAt: '2026-09-20T00:00:00.000Z', lastOpenedAt: '2026-09-10T00:00:00.000Z' }),
    localProject({ id: 'beta', name: 'Beta', updatedAt: '2026-09-18T00:00:00.000Z', lastOpenedAt: '2026-09-19T00:00:00.000Z' }),
    localProject({ id: 'alpha', name: 'Alpha', updatedAt: '2026-09-18T00:00:00.000Z', lastOpenedAt: '2026-09-19T00:00:00.000Z' }),
  ], []);
  assert.deepEqual(projects.map(project => project.id), ['alpha', 'beta', 'older']);
});

test('recent project navigation is capped without changing the merged order', () => {
  const projects = mergeStudioProjects([
    localProject({ id: 'one', lastOpenedAt: '2026-09-05T00:00:00.000Z' }),
    localProject({ id: 'two', lastOpenedAt: '2026-09-04T00:00:00.000Z' }),
    localProject({ id: 'three', lastOpenedAt: '2026-09-03T00:00:00.000Z' }),
    localProject({ id: 'four', lastOpenedAt: '2026-09-02T00:00:00.000Z' }),
    localProject({ id: 'five', lastOpenedAt: '2026-09-01T00:00:00.000Z' }),
  ], []);
  assert.deepEqual(recentStudioProjects(projects).map(project => project.id), ['one', 'two', 'three', 'four']);
});

test('project creation request is one-shot and preserves unrelated URL state', () => {
  assert.deepEqual(projectCreateRequest('/workspace?view=projects&create=1#projects'), {
    requested: true,
    nextHref: '/workspace?view=projects#projects',
  });
  assert.deepEqual(projectCreateRequest('/workspace?view=projects&create=0'), {
    requested: false,
    nextHref: '/workspace?view=projects&create=0',
  });
});

test('previously trashed legacy aliases do not reappear as canonical project rows', () => {
  const remote = remoteProject({ id: 'canonical', legacyId: 'old' });
  assert.deepEqual(mergeStudioProjects([], [remote], [{ id: 'old' }]), []);
  assert.deepEqual(mergeStudioProjects([], [remote], [{ id: 'other', remoteId: 'canonical' }]), []);
  assert.equal(mergeStudioProjects([], [remote], [{ id: 'unrelated' }]).length, 1);
  assert.equal(mergeStudioProjects([], [remote], []).length, 1, 'restore reveals the canonical project');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveFigureEntry } from '../lib/research-figure-entry.ts';
import { createFigure, datasetFromText } from '../lib/research-figures.ts';
import type { FigureJob } from '../lib/research-import.ts';

const source = (calculationId = 'run-1', projectId = 'project-1') => datasetFromText('k_distance,band_1_ev_relative_to_fermi\n0,-1\n1,0\n2,-1', {
  projectId, name: 'Si bands', filename: 'bands.csv', source: { calculationId },
});
const job: FigureJob = { id: 'local-run-1', backendCalculationId: 'run-1', materialId: 'si', name: 'Si bands', status: 'Completed', calculationType: 'Band structure' };

test('the project entry opens its latest active figure and excludes other projects and archives', async () => {
  const dataset = await source();
  const older = createFigure('project-1', [dataset], 'single', 'older'); older.updatedAt = '2026-09-01';
  const latest = { ...older, id: 'latest', name: 'latest', updatedAt: '2026-09-02' };
  const archived = { ...latest, id: 'archived', archived: true, updatedAt: '2026-09-03' };
  const other = { ...latest, id: 'other', projectId: 'project-2', updatedAt: '2026-09-04' };
  assert.deepEqual(resolveFigureEntry('project-1', [older, archived, other, latest], [dataset], []), { kind: 'figure', figure: latest });
});

test('an explicit calculation takes priority over the most recently edited unrelated figure', async () => {
  const requested = await source(), unrelated = await source('run-2');
  const previous = createFigure('project-1', [requested]); previous.updatedAt = '2026-09-01';
  const recent = createFigure('project-1', [unrelated]); recent.updatedAt = '2026-09-02';
  assert.deepEqual(resolveFigureEntry('project-1', [recent, previous], [requested, unrelated], [job], job.id), { kind: 'figure', figure: previous });
});

test('a calculation uses all of its retained local datasets before requesting artifacts', async () => {
  const first = await source(), second = await source(), unrelated = await source('run-2'), otherProject = await source('run-1', 'project-2');
  first.createdAt = '2026-09-01'; second.createdAt = '2026-09-02';
  assert.deepEqual(resolveFigureEntry('project-1', [], [first, unrelated, second, otherProject], [job], job.id), { kind: 'datasets', datasets: [second, first], job });
  assert.deepEqual(resolveFigureEntry('project-1', [], [unrelated, otherProject], [job], job.id), { kind: 'job', job });
});

test('late calculation records remain resolvable and never select an unrelated figure', async () => {
  const dataset = await source('run-2'), figure = createFigure('project-1', [dataset]);
  assert.deepEqual(resolveFigureEntry('project-1', [figure], [dataset], [], job.id), { kind: 'missing-job' });
  assert.deepEqual(resolveFigureEntry('project-1', [figure], [dataset], [job], job.id), { kind: 'job', job });
  const legacy = { ...job, backendCalculationId: undefined };
  const unlinked = await source(); delete unlinked.source.calculationId;
  assert.deepEqual(resolveFigureEntry('project-1', [], [unlinked], [legacy], legacy.id), { kind: 'job', job: legacy });
});

test('a project with results creates a plot while only a project without plottable results stays empty', async () => {
  const dataset = await source();
  assert.deepEqual(resolveFigureEntry('project-1', [], [dataset], [job]), { kind: 'datasets', datasets: [dataset] });
  const noPlots = [
    { ...job, id: 'running', status: 'Running' },
    { ...job, id: 'scf', calculationType: 'Total energy' },
    { ...job, id: 'legacy', backendCalculationId: undefined },
  ];
  assert.deepEqual(resolveFigureEntry('project-1', [], [], [...noPlots, job]), { kind: 'job', job });
  assert.deepEqual(resolveFigureEntry('project-1', [], [], noPlots), { kind: 'empty' });
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFigure, datasetFromText, figureIssues, figureTemplate, instantiateTemplate, latestFigureForCalculation, migratePlotSettings, newLayer, newPanel, newResearchId, renderFigure, replaceLayerDataset, replacementPanelTitle, scientificPlotSettingsFromFigure, sourceScientificPlotSettings, transformedLayer, updateFigurePanel, validateDataset, validateFigure } from '../lib/research-figures.ts';
import { defaultScientificPlotSettings, renderScientificPlotSvg } from '../lib/result-plot.ts';
import { buildSourcePackage, readSourcePackage } from '../lib/research-package.ts';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

const bandCsv = 'k_distance,band_1_ev_relative_to_fermi,band_2_ev_relative_to_fermi\n0,-1,2\n1,-0.5,1\n2,-1,2';
const band = (name = 'Si', csv = bandCsv) => datasetFromText(csv, { projectId: 'project-1', name, filename: `${name}.csv`, source: { pairingKey: 'verified-state' }, metadata: { energy: { kind: 'fermi', fermiEv: 5, vbmEv: 4.5 } } });
const dos = () => datasetFromText('energy_ev_relative_to_fermi,dos_states_per_ev,dos_up_states_per_ev,dos_down_states_per_ev\n-1,3,1,2\n0,0,0,0\n1,4,3,1', { projectId: 'project-1', name: 'Si DOS', filename: 'dos.csv', source: { pairingKey: 'verified-state' }, metadata: { energy: { kind: 'fermi', fermiEv: 5 }, dosBasis: 'cell', atomCount: 2 } });

test('overlay retains identically named bands as independently styled result bindings', async () => {
  const sources = [await band(), await band('Ge')];
  const figure = createFigure('project-1', sources, 'overlay');
  const svg = renderFigure(figure, sources);
  assert.match(svg, /#0072b2/); assert.match(svg, /#d55e00/);
  assert.equal((svg.match(/data-series=/g) ?? []).length, 4);
  assert.match(svg, />Si<\/tspan>/); assert.match(svg, />Ge<\/tspan>/);
  assert.doesNotMatch(svg, /Si \/ Band/);
});

test('source packages round trip complete data and reject modified figure or numerical content', async () => {
  const source = await band(), figure = createFigure('project-1', [source], 'single');
  const bytes = await buildSourcePackage(figure, [source], renderFigure(figure, [source]), 'Font license');
  const reopened = await readSourcePackage(bytes);
  assert.deepEqual(reopened.figure, figure); assert.deepEqual(reopened.datasets, [source]);
  const entries = unzipSync(bytes), name = `datasets/${source.id}.json`;
  const changed = JSON.parse(strFromU8(entries[name])); changed.data.quantities[0].series[0].points[0][1] = 99;
  entries[name] = strToU8(JSON.stringify(changed));
  await assert.rejects(readSourcePackage(zipSync(entries)), /Dataset checksum/);
  const figureEntries = unzipSync(bytes); const changedFigure = { ...figure, name: 'Altered' };
  figureEntries['figure.json'] = strToU8(JSON.stringify(changedFigure));
  await assert.rejects(readSourcePackage(zipSync(figureEntries)), /Figure checksum/);
});

test('long publication panel titles wrap while paired energy axes retain the same physical height', async () => {
  const sources = [await band(), await dos()], figure = createFigure('project-1', sources, 'band-dos');
  figure.panels[1].title = 'Projected density of states for the reference calculation at zero strain';
  const svg = renderFigure(figure, sources);
  assert.match(svg, /<tspan x="[^"]+" dy="[1-9]/);
  const frames = [...svg.matchAll(/<rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)" fill="none"/g)];
  const panels = [...svg.matchAll(/data-panel-id="[^"]+" x="[^"]+" y="([^"]+)" width="[^"]+" height="([^"]+)" viewBox="0 0 [^ ]+ ([^"]+)"/g)];
  assert.equal(frames.length, 2);
  const physicalTop = frames.map((frame, index) => Number(panels[index][1]) + Number(frame[2]) * Number(panels[index][2]) / Number(panels[index][3]));
  assert.ok(Math.abs(physicalTop[0] - physicalTop[1]) < .1);
});

test('Band+DOS pairs require matching scientific source identity and known energy zero', async () => {
  const b = await band(), d = await dos();
  const figure = createFigure('project-1', [d, b], 'band-dos');
  assert.equal(figure.panels[0].energyGroup, figure.panels[1].energyGroup);
  assert.match(renderFigure(figure, [b, d]), /DOS/);
  d.source.pairingKey = 'different-state';
  assert.throws(() => renderFigure(figure, [b, d]), /no longer form a verified pair/);
  assert.throws(() => createFigure('project-1', [b, d], 'band-dos'), /No verified DOS/);
  d.source.pairingKey = b.source.pairingKey; d.metadata.energy.kind = 'unknown';
  assert.throws(() => createFigure('project-1', [b, d], 'band-dos'), /No verified DOS/);
});

test('CSV gap rows are retained and malformed advanced imports fail without dropping samples', async () => {
  const source = await band('gaps', 'k_distance,band_1_ev\n0,1\n,\n2,3\nNaN,NaN\n3,4');
  const points = source.data.quantities[0].series[0].points;
  assert.equal(points.length, 5); assert.ok(Number.isNaN(points[1][0])); assert.ok(Number.isNaN(points[3][0]));
  await assert.rejects(datasetFromText('0 -1 0.1\n1 BAD 0.5\n2 1 0.9', { projectId: 'project-1', name: 'Unfolded', filename: 'bad.dat', format: 'unfolded' }), /never silently dropped/);
  const pdos = await datasetFromText('# energy d_xy d_z2\n0.0d0 1.0d-3 2.0d-3\n1.0d0 2.0d-3 3.0d-3', { projectId: 'project-1', name: 'PDOS', filename: 'pdos.dat', format: 'pdos' });
  assert.equal(pdos.data.quantities[0].series[0].points[0][1], .001);
});

test('Fermi, VBM and manual shifts transform a view without mutating retained samples', async () => {
  const source = await band(), snapshot = JSON.stringify(source);
  const layer = newLayer(source); layer.energy = 'vbm';
  assert.equal(transformedLayer(source, layer).quantities[0].series[0].points[0][1], -0.5);
  layer.energy = 'manual'; layer.shiftEv = -0.25;
  assert.equal(transformedLayer(source, layer).quantities[0].series[0].points[0][1], -1.25);
  assert.equal(JSON.stringify(source), snapshot);
  source.metadata.energy.kind = 'unknown'; layer.energy = 'fermi';
  assert.throws(() => transformedLayer(source, layer), /zero is unknown/);
  source.metadata.energy = { kind: 'source', fermiEv: 0 };
  assert.equal(transformedLayer(source, layer).quantities[0].series[0].points[0][1], -1);
});

test('DOS normalization and spin mirroring are explicit reversible display transforms', async () => {
  const source = await dos(), layer = newLayer(source);
  const down = source.data.quantities[0].series.find((series) => /down/.test(series.id))!;
  assert.equal(down.points[0][1], 2);
  layer.normalization = 'atom'; layer.energyVertical = true;
  const transformed = transformedLayer(source, layer).quantities[0].series.find((series) => /down/.test(series.id))!;
  assert.deepEqual(transformed.points[0], [-1, -1]);
  layer.mirrorSpin = false;
  assert.deepEqual(transformedLayer(source, layer).quantities[0].series.find((series) => /down/.test(series.id))!.points[0], [1, -1]);
  source.metadata.dosBasis = 'unknown';
  assert.throws(() => transformedLayer(source, layer), /computational-cell basis/);
});

test('disconnected k paths retain endpoints, insert a gap, and carry symmetry ticks', async () => {
  const source = await band('path', 'k_distance,band_1_ev_relative_to_fermi\n0,-1\n1,0\n2,1\n5,2\n6,1\n7,0');
  source.metadata.path = { labels: ['GAMMA', 'X', 'L', 'GAMMA'], tickIndices: [0, 2, 3, 5], breakIndices: [3], segments: [['GAMMA', 'X'], ['L', 'GAMMA']] };
  const layer = newLayer(source); layer.normalizedPath = true;
  const data = transformedLayer(source, layer), points = data.quantities[0].series[0].points;
  assert.equal(points.length, 7); assert.ok(Number.isNaN(points[3][0]));
  assert.deepEqual(points[2], [1, 1]); assert.deepEqual(points[4], [1, 2]);
  assert.deepEqual(points.at(-1), [2, 0]);
  assert.equal(data.xTicks?.[1].label, 'X|L');
  assert.match(renderFigure(createFigure('project-1', [source], 'single'), [source]), /\u0393/);
  const roundtrip = validateDataset(JSON.parse(JSON.stringify(source)));
  assert.deepEqual(roundtrip.metadata.path, source.metadata.path);
});

test('source gaps survive JSON round trips and dense publication paths retain every peak', async () => {
  const source = await band();
  source.data.quantities[0].series[0].points = Array.from({ length: 10001 }, (_, i) => [i, i === 4321 ? 123 : 0]);
  source.data.quantities[0].series = source.data.quantities[0].series.slice(0, 1);
  source.data.quantities[0].series[0].points[5000] = [NaN, NaN];
  const loaded = validateDataset(JSON.parse(JSON.stringify(source)));
  assert.ok(Number.isNaN(loaded.data.quantities[0].series[0].points[5000][0]));
  const svg = renderFigure(createFigure('project-1', [loaded], 'single'), [loaded]);
  const path = svg.match(/<g data-series="[^"]+"><path d="([^"]+)"/);
  assert.ok(path); assert.equal((path[1].match(/[ML]/g) ?? []).length, 10000);
});

test('templates remove source bindings and preserve layout/style when rebound', async () => {
  const sources = [await band(), await band('Ge')];
  const figure = createFigure('project-1', sources, 'grid');
  figure.panels[0].layers[0].lineStyle = 'dash'; figure.panels[0].yMin = -2.25;
  const template = figureTemplate(figure, sources);
  assert.ok(template.panels.every((panel) => panel.layers.every((layer) => layer.datasetId === '')));
  const next = instantiateTemplate(template, 'project-2', [...sources].reverse());
  assert.equal(next.panels[0].layers[0].datasetId, sources[1].id);
  assert.equal(next.panels[0].title, sources[1].name);
  assert.equal(replacementPanelTitle(figure.panels[0], sources[0], sources[1]), sources[1].name);
  assert.equal(replacementPanelTitle({ ...figure.panels[0], title: 'Custom caption' }, sources[0], sources[1]), 'Custom caption');
  assert.equal(next.panels[0].layers[0].lineStyle, 'dash'); assert.equal(next.panels[0].yMin, -2.25);
  assert.throws(() => instantiateTemplate(template, 'project-1', [sources[0]]), /needs 2/);
  const replacement = replaceLayerDataset(figure.panels[0].layers[0], sources[0], sources[1]);
  assert.equal(replacement.color, figure.panels[0].layers[0].color);
  assert.throws(() => replaceLayerDataset(replacement, sources[1], { ...sources[0], data: { ...sources[0].data, kind: 'dos' } }), /same scientific plot kind/);
});

test('an inset template reuses one selected source for repeated bindings', async () => {
  const source = await band(), next = await band('Next');
  const figure = createFigure('project-1', [source], 'single');
  figure.panels.push({ ...newPanel([newLayer(source)]), inset: { parentId: figure.panels[0].id, x: .5, y: .1, width: .45, height: .45 } });
  const rebound = instantiateTemplate(figureTemplate(figure, [source]), 'project-1', [next]);
  assert.ok(rebound.panels.every((panel) => panel.layers[0].datasetId === next.id));
  assert.doesNotThrow(() => renderFigure(rebound, [next]));
});

test('parameter series orders numeric values and rejects mixed dimensions', async () => {
  const sources = [await band('plus'), await band('minus')];
  sources.forEach((source, index) => { source.metadata.condition = { parameter: 'strain', value: index ? -2 : 2, unit: '%' }; });
  assert.equal(createFigure('project-1', sources, 'parameter').panels[0].layers[0].datasetId, sources[1].id);
  sources[1].metadata.condition!.unit = 'K';
  assert.throws(() => createFigure('project-1', sources, 'parameter'), /same recorded parameter/);
});

test('insets use an independent viewport and linked panels reject inconsistent conventions', async () => {
  const b = await band(), d = await dos();
  const figure = createFigure('project-1', [b, d], 'band-dos');
  const inset = { ...newPanel([newLayer(b)]), showLegend: false, inset: { parentId: figure.panels[0].id, x: 0.5, y: 0.15, width: 0.45, height: 0.45 } };
  figure.panels.push(inset);
  assert.equal((renderFigure(figure, [b, d]).match(/data-panel-id=/g) ?? []).length, 3);
  figure.panels[1].layers[0].energy = 'manual'; figure.panels[1].layers[0].shiftEv = 1;
  assert.throws(() => renderFigure(figure, [b, d]), /same energy convention/);
});

test('precomputed unfolded bands render weighted samples without invented connecting bands', async () => {
  const source = await datasetFromText('0 -1 0.1\n0 1 1\n1 0 0', { projectId: 'project-1', name: 'Unfolded', filename: 'weights.dat', format: 'unfolded' });
  const svg = renderFigure(createFigure('project-1', [source], 'single'), [source]);
  assert.match(svg, /data-spectral-weight/); assert.equal((svg.match(/<circle /g) ?? []).length, 2);
  assert.doesNotMatch(svg, /data-series=/);
  await assert.rejects(datasetFromText('0 1 -0.1', { projectId: 'project-1', name: 'Invalid', filename: 'bad.dat', format: 'unfolded' }), /cannot be negative/);
});

test('large weighted datasets and linked axes do not use argument-spread extrema', async () => {
  const source = await band();
  source.data.quantities[0].series = [{ id: 'spectral', label: 'Weights', points: Array.from({ length: 150000 }, (_, i) => [i, i % 3]), weights: Array.from({ length: 150000 }, () => 0) }];
  const figure = createFigure('project-1', [source], 'single'); figure.panels[0].energyGroup = 'shared';
  assert.match(renderFigure(figure, [source]), /data-spectral-weight/);
});

test('untrusted source packages cannot inject SVG through identifiers or colors', async () => {
  const source = await band(); const figure = createFigure('project-1', [source], 'single');
  figure.panels[0].id = 'x" onload="alert(1)';
  assert.throws(() => renderFigure(figure, [source]), /identity/);
  figure.panels[0].id = newResearchId(); figure.panels[0].layers[0].color = 'url(https://external.example)';
  assert.throws(() => validateFigure(figure), /color/);
  source.data.quantities[0].series[0].weights = [-1, 1, 2];
  assert.throws(() => validateDataset(source), /weights/);
});

test('different physical k paths produce a visible compatibility warning', async () => {
  const sources = [await band(), await band('strained')];
  sources[0].metadata.path = { labels: ['G', 'X'], tickIndices: [0, 2], cellAngstrom: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] };
  sources[1].metadata.path = { ...sources[0].metadata.path, cellAngstrom: [[2, 0, 0], [0, 1, 0], [0, 0, 1]] };
  assert.ok(figureIssues(createFigure('project-1', sources, 'overlay'), sources).some((issue) => issue.includes('k-paths differ')));
  const data = transformedLayer(sources[0], newLayer(sources[0]));
  assert.match(renderScientificPlotSvg(data, defaultScientificPlotSettings(data)), />G<\/text>/);
});


test('editing energy limits updates linked panels and leaves density limits independent', async () => {
  const sources = [await band(), await dos()];
  const figure = createFigure('project-1', sources, 'band-dos');
  const edited = updateFigurePanel(figure, figure.panels[0].id, { yMin: -0.25, yMax: 0.75, xMax: 1.5 });
  assert.deepEqual(edited.panels.map((panel) => [panel.yMin, panel.yMax]), [[-0.25, 0.75], [-0.25, 0.75]]);
  assert.equal(edited.panels[1].xMax, figure.panels[1].xMax);
  assert.equal(figure.panels[0].yMin, null);
  assert.doesNotThrow(() => renderFigure(edited, sources));
  const reset = updateFigurePanel(edited, edited.panels[1].id, { yMin: null, yMax: null });
  assert.ok(reset.panels.every((panel) => panel.yMin === null && panel.yMax === null));
});


test('opening a completed run resumes its latest figure without matching unlinked imports', async () => {
  const source = await band(); source.source.calculationId = 'run-1';
  const older = createFigure('project-1', [source], 'single', 'older'); older.updatedAt = '2026-09-01T00:00:00.000Z';
  const latest = createFigure('project-1', [source], 'single', 'latest'); latest.updatedAt = '2026-09-02T00:00:00.000Z';
  assert.equal(latestFigureForCalculation([older, latest], [source], 'run-1')?.id, latest.id);
  assert.equal(latestFigureForCalculation([older, { ...latest, archived: true }], [source], 'run-1')?.id, older.id);
  assert.equal(latestFigureForCalculation([latest], [source], undefined), undefined);
  assert.equal(latestFigureForCalculation([latest], [source], 'other-run'), undefined);
});

test('a result-opened figure inherits the computed viewport and keeps compatible edits in the result preview', async () => {
  const source = await band();
  source.metadata.provenance = { sourceSummary: { plotXWindow: [0, 2], plotYWindow: [-5, 5] } };
  const inherited = sourceScientificPlotSettings(source);
  assert.deepEqual([inherited.xMin, inherited.xMax, inherited.yMin, inherited.yMax], [0, 2, -5, 5]);
  const figure = migratePlotSettings(createFigure('project-1', [source], 'single', 'Band structure'), inherited);
  assert.equal(figure.resultStyleVersion, 1);
  assert.deepEqual([figure.panels[0].yMin, figure.panels[0].yMax], [-5, 5]);
  assert.equal(figure.panels[0].showYZero, false);
  assert.equal(figure.panels[0].yReference, 0);
  assert.match(renderFigure(figure, [source]), /#252a35/);
  assert.match(renderFigure(figure, [source]), /#c04d44/);
  figure.panels[0].yMin = -2.5;
  figure.panels[0].yMax = 3.75;
  figure.panels[0].layers[0].color = '#d55e00';
  const preview = scientificPlotSettingsFromFigure(figure, source, inherited);
  assert.ok(preview);
  assert.deepEqual([preview.yMin, preview.yMax], [-2.5, 3.75]);
  assert.ok(Object.values(preview.seriesStyles).every((style) => style.color === '#d55e00'));
});

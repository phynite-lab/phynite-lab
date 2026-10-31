import assert from 'node:assert/strict';
import test from 'node:test';
import { millimetersPerUnit, requiredFigureRows, removeFigurePanel } from '../lib/figure-layout.ts';
import { createFigure, datasetFromText, renderFigure } from '../lib/research-figures.ts';

test('figure units preserve physical size with explicit pixel DPI', () => {
  assert.equal(millimetersPerUnit('cm'), 10);
  assert.equal(millimetersPerUnit('in'), 25.4);
  assert.equal(millimetersPerUnit('pt') * 72, 25.4);
  assert.ok(Math.abs(millimetersPerUnit('px', 300) * 1200 - 101.6) < 1e-10);
  for (const unit of ['mm', 'cm', 'in', 'px', 'pt'] as const) {
    assert.ok(Math.abs(85 / millimetersPerUnit(unit) * millimetersPerUnit(unit) - 85) < 1e-10);
  }
});

test('rows account for panel spans, wrapping and insets', () => {
  assert.equal(requiredFigureRows([{ span: 2 }, { span: 1 }, { span: 2 }, { span: 1 }], 3), 2);
  assert.equal(requiredFigureRows([{ span: 2 }, { span: 2 }, { span: 1 }], 3), 2);
  assert.equal(requiredFigureRows([{ span: 1 }, { span: 1, inset: {} }], 1), 1);
});

test('explicit rows reserve space while render retains all panels', async () => {
  const data = await datasetFromText('k_distance,band_1_ev\n0,1\n1,2', { projectId: 'project-1', name: 'Source', filename: 'bands.csv' });
  const figure = createFigure('project-1', [data], 'single');
  figure.heightMm = 180;
  const auto = renderFigure(figure, [data]);
  figure.rows = 2;
  assert.notEqual(renderFigure(figure, [data]), auto);
  figure.rows = 0;
  assert.throws(() => renderFigure(figure, [data]), /rows/);
});

test('removing seven of eight panels shrinks the paper to one balanced panel', async () => {
  const data = await datasetFromText('k_distance,band_1_ev\n0,1\n1,2', { projectId: 'project-1', name: 'Source', filename: 'bands.csv' });
  let figure = createFigure('project-1', Array(8).fill(data), 'grid');
  figure.rows = 4;
  for (let index = 0; index < 7; index++) figure = removeFigurePanel(figure, figure.panels[0].id);
  assert.equal(figure.panels.length, 1);
  assert.equal(figure.columns, 1);
  assert.equal(figure.rows, undefined);
  assert.equal(figure.heightMm, 80);
  assert.equal(figure.widthMm, 89);
  assert.doesNotThrow(() => renderFigure(figure, [data]));
  assert.equal(removeFigurePanel(figure, figure.panels[0].id), figure);
});

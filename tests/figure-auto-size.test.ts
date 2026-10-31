import assert from 'node:assert/strict';
import test from 'node:test';
import { autoSizeFigure } from '../lib/figure-layout.ts';
import type { FigureDocument } from '../lib/research-figures.ts';
const figure = (columns: number, spans: number[], mode: 'auto' | 'manual' = 'auto') => ({ sizeMode: mode, columns, widthMm: 120, heightMm: 90, panels: spans.map(span => ({ span })) }) as FigureDocument;
test('auto uses journal columns and adapts to rows, excluding insets', () => {
  const single = autoSizeFigure(figure(1, [1]));
  assert.equal(single.widthMm, 89);
  const grid = autoSizeFigure(figure(2, [1,1,1,1]));
  assert.equal(grid.widthMm, 183);
  assert.ok(grid.heightMm > single.heightMm);
  assert.ok(grid.heightMm <= 170);
  const inset = { ...single, panels: [...single.panels, { span: 1, inset: { parentId: 'p' } }] } as FigureDocument;
  assert.equal(autoSizeFigure(inset).heightMm, single.heightMm);
});
test('manual and legacy documents retain physical dimensions', () => {
  const manual = figure(2,[1,1],'manual');
  assert.deepEqual(autoSizeFigure(manual), manual);
  const legacy = { ...manual, sizeMode: undefined };
  assert.deepEqual(autoSizeFigure(legacy), legacy);
});
test('paired panels and tall grids stay within journal bounds', () => {
  assert.equal(autoSizeFigure(figure(3,[2,1])).widthMm, 183);
  assert.equal(autoSizeFigure(figure(1,Array(20).fill(1))).heightMm, 170);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { colormapGradient, sampleColormap } from '../components/md-prototype/utils/colormaps.ts';

const rgb8 = (value: [number, number, number]) => value.map(channel => Math.round(channel * 255));

test('particle colors and legend share the same scientific palette stops', () => {
  assert.deepEqual(rgb8(sampleColormap(.5, 'viridis')), [33, 145, 140]);
  assert.deepEqual(rgb8(sampleColormap(.5, 'turbo')), [162, 252, 60]);
  assert.match(colormapGradient('viridis'), /#21918c 50%/);
  assert.match(colormapGradient('turbo'), /#a2fc3c 50%/);
});

test('colormap sampling clamps finite range and falls back to viridis', () => {
  assert.deepEqual(rgb8(sampleColormap(-2, 'coolwarm')), [59, 76, 192]);
  assert.deepEqual(rgb8(sampleColormap(2, 'coolwarm')), [180, 4, 38]);
  assert.deepEqual(sampleColormap(.25, 'unknown'), sampleColormap(.25, 'viridis'));
});

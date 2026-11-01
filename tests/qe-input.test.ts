import assert from 'node:assert/strict';
import test from 'node:test';
import { totalMagnetizationLine } from '../lib/qe-input.ts';

test('total magnetization is omitted for a non-spin-polarized calculation', () => {
  assert.equal(totalMagnetizationLine(false, false, 0), '');
});

test('total magnetization is written only for collinear spin polarization', () => {
  assert.equal(totalMagnetizationLine(true, false, 2), '\n  tot_magnetization = 2');
  assert.equal(totalMagnetizationLine(true, true, 2), '');
});

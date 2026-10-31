import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeMdFrame, generateDemoTrajectory, neighborGeometry, propertyRange } from '../lib/md-analysis.ts';
import { parseMdText } from '../lib/md-parser.ts';
import type { MdModifier } from '../lib/md-types.ts';
const modifier = (kind: MdModifier['kind'], params: MdModifier['params'] = {}): MdModifier => ({ id: kind, kind, params, enabled: true });

test('FCC first shell has twelve neighbors without sampling or fabricated classifications', () => {
  const frame = generateDemoTrajectory(1, 4)[0], before = structuredClone(frame);
  const result = analyzeMdFrame(frame, { bondCutoff: 2.8, rdfCutoff: 2.8, rdfBins: 30 });
  assert.equal(result.frame.ids.length, 256);
  assert.equal(result.bonds.length, 256 * 12 / 2);
  assert.ok(result.coordination.every(n => n === 12));
  assert.equal(result.rdf.length, 30);
  assert.deepEqual(result.phases, []);
  assert.deepEqual(frame, before);
});
test('minimum image respects each periodic axis and finite systems have no bulk RDF', () => {
  const f = parseMdText('2\nLattice="10 0 0 0 10 0 0 0 10" pbc="T F F"\nCu .1 0 0\nCu 9.9 0 0\n').frames[0];
  assert.equal(neighborGeometry(f, 1).bonds.length, 1);
  assert.deepEqual(neighborGeometry(f, 1).rdf, []);
  assert.equal(neighborGeometry({ ...f, periodic: [false, false, false] }, 1).bonds.length, 0);
});
test('scientifically unsupported local geometry is rejected explicitly', () => {
  const f = generateDemoTrajectory(1, 4)[0];
  assert.throws(() => neighborGeometry(f, 8), /half/);
  assert.throws(() => neighborGeometry({ ...f, vectors: [[10, 0, 0], [1, 10, 0], [0, 0, 10]] }, 3), /tilted/);
  assert.throws(() => neighborGeometry(f, 3, 10.5), /whole/);
  const result = analyzeMdFrame(generateDemoTrajectory(1, 10)[0]);
  assert.equal(result.frame.ids.length, 4000);
  assert.equal(result.bonds.length, 0);
  assert.match(result.warnings.join(' '), /Personal Compute/);
});
test('local pipeline ordering, selection, replication, wrap, and disabled modifiers work', () => {
  const f = parseMdText('2\nLattice="10 0 0 0 10 0 0 0 10" pbc="T F F"\nCu 11 2 1\nNi 5 2 4\n').frames[0];
  const result = analyzeMdFrame(f, { modifiers: [
    modifier('wrap'), modifier('slice', { normal: [0, 0, 1], distance: 2, reverse: false }),
    modifier('replicate', { repeat: [2, 1, 1] }),
    modifier('expression', { expression: 'Position.X > 5', action: 'select' }),
    { ...modifier('expression', { expression: 'Position.X > 5', action: 'remove' }), enabled: false },
  ] });
  assert.equal(result.frame.ids.length, 2);
  assert.deepEqual(result.frame.properties.Selection, [0, 1]);
  assert.equal(result.frame.vectors[0][0], 20);
  assert.ok(Math.abs(result.frame.positions[0] - 1) < 1e-10);
  assert.equal(new Set(result.frame.ids).size, 2);
  const removed = analyzeMdFrame(result.frame, { modifiers: [modifier('expression', { expression: 'Selection == 1', action: 'remove' })] });
  assert.equal(removed.frame.ids.length, 1);
});
test('advanced modifiers direct users to Personal Compute and numeric ranges ignore missing values', () => {
  const result = analyzeMdFrame(generateDemoTrajectory(1, 3)[0], { modifiers: [modifier('ptm')] });
  assert.match(result.warnings[0], /Personal Compute/);
  assert.deepEqual(result.phases, []);
  assert.deepEqual(propertyRange([NaN, 2, -1, Infinity]), [-1, 2]);
  assert.equal(propertyRange([NaN]), null);
});

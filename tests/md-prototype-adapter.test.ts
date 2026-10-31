import assert from 'node:assert/strict';
import test from 'node:test';
import { mdAppearanceFor } from '../lib/md-element-appearance.ts';
import { fromPrototypeModifier, mdFormula, prototypeCell, toPrototypeFrame, toPrototypeMetric, toPrototypeModifier } from '../lib/md-prototype-adapter.ts';
import { parseMdText } from '../lib/md-parser.ts';
import { defaultMdSettings, type MdAnalysis, type MdModifier } from '../lib/md-types.ts';
const frame = parseMdText('3\nLattice="10 0 0 2 8 0 1 2 9" pbc="T F T"\nCu 1 2 3\nNi 4 5 6\nXe 3 3 3\n').frames[0];
const source = (): MdAnalysis => ({ frame: structuredClone(frame), attributes: {}, phases: [], rdf: [], bonds: [], dislocations: [], surface: null, warnings: [], engine: 'Source data' });
test('fork adapter preserves tilted basis, periodic axes, positions and particle identities', () => {
  const input = source(), before = structuredClone(input), data = toPrototypeFrame(input, defaultMdSettings(), 12);
  assert.deepEqual(data.cell.matrix, [[10, 2, 1, 0], [0, 8, 2, 0], [0, 0, 9, 0]]);
  assert.deepEqual(data.cell.pbc, [true, false, true]); assert.deepEqual(data.ids, frame.ids);
  assert.deepEqual(data.positions, frame.positions); assert.equal(data.totalFrames, 12);
  assert.notEqual(prototypeCell(data).gamma, 90); assert.ok(data.colors.every(Number.isFinite));
  assert.deepEqual(input, before); assert.deepEqual(data.phaseCounts, {}); assert.equal(data.dislocations, null);
});
test('species appearance follows OVITO element presets and preserves explicit particle radii', () => {
  const input = source();
  input.frame.species = ['O', 'Ni', 'Zn2+'];
  input.frame.properties.Radius = [0, 0.91, Number.NaN];
  const data = toPrototypeFrame(input, defaultMdSettings(), 1);
  assert.deepEqual(data.radii, [0.74, 0.91, 1.37]);
  assert.deepEqual(['O', 'Ni', 'Zn2+'].map(mdAppearanceFor), [
    { color: '#ff0d0d', radius: 0.74 },
    { color: '#50d050', radius: 1.25 },
    { color: '#7d80b0', radius: 1.37 },
  ]);
  assert.ok(data.colors.every(Number.isFinite));
});
test('all renamed modifier parameters round trip without mutating pipeline history', () => {
  for (const m of [
    { kind: 'ptm', params: { rmsd: .15 } }, { kind: 'dxa', params: { lattice: 'BCC' } },
    { kind: 'replicate', params: { repeat: [2, 3, 1] } }, { kind: 'slice', params: { normal: [1, 2, 3], distance: 3, reverse: false } },
  ] as Pick<MdModifier, 'kind' | 'params'>[]) {
    const original: MdModifier = { ...m, id: 'saved-step', enabled: false }, before = structuredClone(original);
    assert.deepEqual(fromPrototypeModifier(toPrototypeModifier(original)), original); assert.deepEqual(original, before);
  }
});
test('formula derives from composition rather than guessing a material from the filename', () => {
  assert.equal(mdFormula({ Co: 8, Ni: 16, O: 32 }), 'CoNi2O4');
  assert.equal(mdFormula({ Cu: 2048 }), 'Cu'); assert.equal(mdFormula({}), '—');
});
test('timeline distinguishes uncomputed data from measured zero and uses phase percentages', () => {
  const input = source(), settings = defaultMdSettings();
  assert.deepEqual(toPrototypeMetric(input, settings), { frame: 0, timestep: 0, phases: {}, avgPotentialEnergy: null, dislocationDensity: undefined });
  input.frame.properties.c_pe = [-3, NaN, -5]; input.phases = [{ id: 1, name: 'FCC', count: 2, color: '#38c158' }, { id: 0, name: 'Other', count: 1, color: '#888888' }];
  input.engine = 'Phynite MD Engine'; settings.modifiers = [{ id: 'dxa', kind: 'dxa', enabled: true, params: { lattice: 'FCC' } }];
  const metric = toPrototypeMetric(input, settings); assert.equal(metric.avgPotentialEnergy, -4); assert.equal(metric.dislocationDensity, 0); assert.equal(metric.phases.FCC, 2 / 3 * 100);
});
test('numeric colors ignore missing values, retain every atom, and show selected atoms', () => {
  const input = source(), settings = defaultMdSettings(); settings.colorBy = 'stress'; settings.palette = 'jet';
  input.frame.properties.stress = [NaN, 1, 3]; input.frame.properties.Selection = [1, 0, 0];
  const data = toPrototypeFrame(input, settings, 1); assert.equal(data.numParticles, 3); assert.equal(data.selection, undefined);
  assert.ok(data.colors.every(Number.isFinite)); assert.equal(data.scalarRange?.histogram?.reduce((n, b) => n + b.count, 0), 2);
});
test('surface statistics use OVITO filled volume and do not manufacture missing measurements', () => {
  const input = source(); input.surface = { vertices: [], faces: [] }; input.attributes = { 'ConstructSurfaceMesh.surface_area': 310.14, 'ConstructSurfaceMesh.filled_volume': 21829.81 };
  const data = toPrototypeFrame(input, defaultMdSettings(), 1); assert.equal(data.surface?.solidVolume, 21829.81); assert.equal(data.surface?.surfaceArea, 310.14);
  input.attributes = {}; assert.ok(Number.isNaN(toPrototypeFrame(input, defaultMdSettings(), 1).surface?.solidVolume));
});

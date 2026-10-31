import test from 'node:test';
import assert from 'node:assert/strict';
import { createMdRunSnapshot, readMdRunSnapshot } from '../lib/md-run-snapshot.ts';
import { parseMdText } from '../lib/md-parser.ts';
import { analyzeMdFrame } from '../lib/md-analysis.ts';
import { defaultMdSettings } from '../lib/md-types.ts';

test('run snapshot preserves the processed frame identity and remains immutable after capture', () => {
  const original = parseMdText('2\nLattice="10 0 0 0 10 0 0 0 10" pbc="T F T"\nAr 1 2 3\nAr 8 2 3\n').frames[0];
  const settings = defaultMdSettings();
  settings.modifiers = [{ id: 'keep-left', kind: 'slice', enabled: true, params: { normal: [1, 0, 0], distance: 4, reverse: false } }];
  const processed = analyzeMdFrame(original, { modifiers: settings.modifiers }).frame;
  const snapshot = createMdRunSnapshot(processed, settings, { trajectoryId: 'source-one', sha256: 'a'.repeat(64) });
  assert.equal(snapshot.frame.ids.length, 1);
  assert.deepEqual(snapshot.frame.positions, [1, 2, 3]);
  assert.deepEqual(snapshot.frame.periodic, [true, false, true]);
  processed.positions[0] = 9; settings.modifiers[0].params.distance = 8;
  assert.equal(snapshot.frame.positions[0], 1);
  assert.equal(snapshot.provenance.modifiers[0].params.distance, 4);
  assert.deepEqual(parseMdText(JSON.stringify(snapshot), 'frame.phynite-md.json').frames[0], snapshot.frame);
});

test('snapshot converts initial velocities and masses exactly once and retains arbitrary replica IDs', () => {
  const frame = parseMdText('1\nLattice="10 0 0 0 10 0 0 0 10"\nAr 1 2 3\n').frames[0];
  frame.sourceUnits = 'nano'; frame.ids = ['source@1,0,0']; frame.properties = { vx: [2], vy: [0], vz: [0], mass: [1] };
  const captured = createMdRunSnapshot(frame, defaultMdSettings(), { trajectoryId: 'source', sha256: 'a'.repeat(64) });
  assert.equal(captured.frame.properties.vx[0], .02);
  assert.equal(captured.frame.properties.mass[0], 6.02214076e5);
  assert.equal(captured.frame.ids[0], 'source@1,0,0');
  assert.deepEqual(createMdRunSnapshot(captured.frame, defaultMdSettings(), { trajectoryId: 'source', sha256: 'a'.repeat(64) }).frame.properties, captured.frame.properties);
  frame.sourceUnits = undefined;
  assert.throws(() => createMdRunSnapshot(frame, defaultMdSettings(), { trajectoryId: 'source', sha256: 'a'.repeat(64) }), /velocity units are unknown/);
  const malformed = { ...captured, units: { length: 'nm', time: 'ps' } };
  assert.throws(() => readMdRunSnapshot(JSON.stringify(malformed)), /snapshot units/);
});

test('inferred elemental mass uses amu independently of geometry units and keeps its provenance', () => {
  for (const [sourceUnits, mass] of [['nano', 39.948], [undefined, 28.0855]] as const) {
    const frame = parseMdText('1\nLattice="10 0 0 0 10 0 0 0 10"\nAr 1 2 3\n').frames[0];
    frame.sourceUnits = sourceUnits;
    frame.properties = { Mass: [mass] };
    frame.propertyUnits = { mass: 'amu' };
    frame.massProvenance = 'element-database';
    const captured = createMdRunSnapshot(frame, defaultMdSettings(), { trajectoryId: 'source', sha256: 'a'.repeat(64) });
    assert.equal(captured.frame.properties.Mass[0], mass);
    assert.equal(captured.provenance.mass?.origin, 'element-database');
    assert.equal(captured.provenance.mass?.inputUnits, 'amu');
    const repeated = createMdRunSnapshot(captured.frame, defaultMdSettings(), { trajectoryId: 'source', sha256: 'a'.repeat(64) });
    assert.equal(repeated.frame.properties.Mass[0], mass);
  }
  const frame = parseMdText('1\nLattice="10 0 0 0 10 0 0 0 10"\nAr 1 2 3\n').frames[0];
  frame.properties = { Mass: [37.9627] };
  frame.massProvenance = 'source-explicit';
  assert.throws(() => createMdRunSnapshot(frame, defaultMdSettings(), { trajectoryId: 'source', sha256: 'a'.repeat(64) }), /mass units are unknown/);
});

test('new runs avoid double counting unwrapped coordinates and stale geometry image flags', () => {
  const frame = parseMdText('ITEM: UNITS\nmetal\nITEM: TIMESTEP\n0\nITEM: NUMBER OF ATOMS\n1\nITEM: BOX BOUNDS pp pp pp\n0 10\n0 10\n0 10\nITEM: ATOMS id element xu yu zu ix iy iz\n1 Ar 21 0 0 2 0 0\n').frames[0];
  const snapshot = createMdRunSnapshot(frame, defaultMdSettings(), { trajectoryId: 'source', sha256: 'a'.repeat(64) });
  assert.equal(snapshot.frame.positions[0], 21);
  assert.equal(snapshot.frame.properties.ix, undefined);
  assert.equal(snapshot.provenance.imageHistory, 'reset-for-displayed-frame');
  assert.ok(snapshot.provenance.omittedProperties.includes('ix'));
});

test('source labels remain aligned after geometry edits and immutable in the captured snapshot', () => {
  const frame = parseMdText('2\nLattice="10 0 0 0 10 0 0 0 10"\nAr 1 2 3\nAr 4 2 3\n').frames[0];
  frame.stringProperties = { 'Atom Name': ['Ar1', 'Ar2'] };
  const settings = defaultMdSettings();
  settings.modifiers = [{ id: 'replicate', kind: 'replicate', enabled: true, params: { repeat: [2, 1, 1] } }, { id: 'delete', kind: 'expression', enabled: true, params: { expression: 'Position.X < 3', action: 'remove' } }];
  const processed = analyzeMdFrame(frame, { modifiers: settings.modifiers }).frame;
  assert.deepEqual(processed.positions.filter((_, index) => index % 3 === 0), [4, 11, 14]);
  assert.deepEqual(processed.stringProperties?.['Atom Name'], ['Ar2', 'Ar1', 'Ar2']);
  const snapshot = createMdRunSnapshot(processed, settings, { trajectoryId: 'source', sha256: 'a'.repeat(64) });
  processed.stringProperties!['Atom Name'][0] = 'edited';
  assert.deepEqual(snapshot.frame.stringProperties?.['Atom Name'], ['Ar2', 'Ar1', 'Ar2']);
  snapshot.frame.stringProperties!['Atom Name'] = ['missing labels'];
  assert.throws(() => readMdRunSnapshot(JSON.stringify(snapshot)), /string particle properties/);
});

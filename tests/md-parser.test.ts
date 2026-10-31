import assert from 'node:assert/strict';
import test from 'node:test';
import { frameTimePs, parseMdText } from '../lib/md-parser.ts';

test('LAMMPS dump parser reads multiple frames, cell, ids, species and properties', () => {
  const dump = [
    'ITEM: TIMESTEP', '0', 'ITEM: NUMBER OF ATOMS', '2', 'ITEM: BOX BOUNDS pp pp pp',
    '0 4', '0 4', '0 4', 'ITEM: ATOMS id type x y z vx',
    '2 Cu 2 2 2 0.2', '1 Ni 1 1 1 0.1',
    'ITEM: TIMESTEP', '10', 'ITEM: NUMBER OF ATOMS', '2', 'ITEM: BOX BOUNDS pp pp pp',
    '0 4', '0 4', '0 4', 'ITEM: ATOMS id element xu yu zu vx',
    '1 Ni 1.1 1 1 0.3', '2 Cu 2.1 2 2 0.4',
  ].join('\n');
  const result = parseMdText(dump, 'sample.dump');
  assert.equal(result.frames.length, 2);
  assert.deepEqual(result.frames[0].ids, ['2', '1']);
  assert.deepEqual(result.frames[0].species, ['Cu', 'Ni']);
  assert.equal(result.frames[1].timestep, 10);
  assert.equal(result.frames[0].properties.vx[1], 0.1);
  assert.deepEqual(result.frames[0].vectors, [[4, 0, 0], [0, 4, 0], [0, 0, 4]]);
  assert.equal(frameTimePs(result.frames[1], 1, 0.5), 5);
});

test('LAMMPS optional units, pre-timestep time, and typelabel headers are accepted', () => {
  const result = parseMdText(`ITEM: UNITS
metal
ITEM: TIME
0.25
ITEM: TIMESTEP
5
ITEM: NUMBER OF ATOMS
1
ITEM: BOX BOUNDS pp pp pp
0 4
0 4
0 4
ITEM: ATOMS id typelabel x y z
1 Cu 1 2 3
`, 'optional.dump');
  assert.equal(result.frames[0].timestep, 5);
  assert.deepEqual(result.frames[0].species, ['Cu']);
  assert.match(result.warnings.join(' '), /unit style: metal/);
  assert.equal(result.frames[0].time, .25);
});

test('physical LAMMPS units convert cell, origin, positions and actual frame TIME', () => {
  const dump = (units: string, coordinate = 'x y z') => `ITEM: UNITS\n${units}\nITEM: TIME\n0.3\nITEM: TIMESTEP\n200\nITEM: NUMBER OF ATOMS\n1\nITEM: BOX BOUNDS abc origin pp pp pp\n10 0 0 1\n0 10 0 2\n0 0 10 3\nITEM: ATOMS id element ${coordinate}\n1 Cu 1 2 3\n`;
  const nano = parseMdText(dump('nano')).frames[0];
  assert.deepEqual(nano.positions, [10, 20, 30]);
  assert.deepEqual(nano.origin, [10, 20, 30]);
  assert.equal(nano.vectors[0][0], 100);
  assert.equal(frameTimePs(nano, 0, 10), 300);
  assert.equal(parseMdText(dump('real')).frames[0].time, .0003);
  assert.equal(parseMdText(dump('si')).frames[0].vectors[0][0], 1e11);
  assert.equal(parseMdText(dump('electron')).frames[0].positions[0], .529177210903);
  const scaled = parseMdText(dump('nano', 'xs ys zs')).frames[0];
  assert.deepEqual(scaled.positions, [110, 220, 330]);
  assert.throws(() => parseMdText(dump('lj')), /explicit length and time scales/);
  assert.throws(() => parseMdText(dump('unknown')), /cannot be converted/);
  assert.equal(parseMdText(dump('metal') + dump('metal')).frames.length, 2);
  assert.throws(() => parseMdText(dump('metal') + dump('nano')), /changes between frames/);
});

test('XYZ parser handles extXYZ lattice and finite systems', () => {
  const xyz = [
    '2', 'Lattice="3 0 0 0 3 0 0 0 3" pbc="T T T"',
    'Si 0 0 0', 'Si 1.5 1.5 1.5',
    '1', 'molecule', 'H 0 0 0',
  ].join('\n');
  const result = parseMdText(xyz, 'trajectory.xyz');
  assert.equal(result.frames.length, 2);
  assert.equal(result.frames[0].hasCell, true);
  assert.deepEqual(result.frames[0].periodic, [true, true, true]);
  assert.equal(result.frames[1].hasCell, false);
  assert.equal(result.frames[1].species[0], 'H');
});

test('empty and malformed trajectories fail clearly', () => {
  assert.throws(() => parseMdText(''), /empty/i);
  assert.throws(() => parseMdText('not a trajectory', 'sample.xyz'), /No readable/i);
});

test('restricted triclinic bounds are converted to the actual origin and tilted vectors', () => {
  const dump = ['ITEM: TIMESTEP', '200', 'ITEM: NUMBER OF ATOMS', '1',
    'ITEM: BOX BOUNDS xy xz yz pp ff pp', '-2 13 2', '3 15 -1', '4 14 2',
    'ITEM: ATOMS id type xs ys zs', '1 1 .5 .5 .5'].join('\n');
  const frame = parseMdText(dump).frames[0];
  assert.deepEqual(frame.origin, [-1, 3, 4]);
  assert.deepEqual(frame.vectors, [[12, 0, 0], [2, 10, 0], [-1, 2, 10]]);
  assert.deepEqual(frame.positions, [5.5, 9, 9]);
  assert.deepEqual(frame.periodic, [true, false, true]);
  assert.equal(frameTimePs(frame, 0, null), null);
  assert.equal(frameTimePs(frame, 0, .001), .2);
});
test('general triclinic cell vectors and origins are preserved', () => {
  const dump = ['ITEM: TIMESTEP', '0', 'ITEM: NUMBER OF ATOMS', '1',
    'ITEM: BOX BOUNDS abc origin pp pp pp', '4 1 0 10', '0 5 1 20', '1 0 6 30',
    'ITEM: ATOMS id element xs ys zs', '42 Si .5 .5 .5'].join('\n');
  const frame = parseMdText(dump).frames[0];
  assert.deepEqual(frame.origin, [10, 20, 30]);
  assert.deepEqual(frame.positions, [12.5, 23, 33.5]);
});
test('extXYZ property schemas can reorder species and position and retain numeric vectors', () => {
  const f = parseMdText('2\nProperties=id:I:1:force:R:3:species:S:1:pos:R:3\n4 1 2 3 Si 0 0 0\n8 4 5 6 C 1 2 3\n').frames[0];
  assert.deepEqual(f.ids, ['4', '8']);
  assert.deepEqual(f.species, ['Si', 'C']);
  assert.deepEqual(f.properties['force.Y'], [2, 5]);
  assert.equal(frameTimePs(f, 10, .001), null);
});
test('invalid coordinates, duplicate IDs, missing atoms and cell-free periodic flags fail', () => {
  assert.throws(() => parseMdText('1\n\nCu NaN 1 2\n'), /finite/i);
  assert.throws(() => parseMdText('2\n\nCu 0 0 0\n'), /Incomplete/);
  assert.throws(() => parseMdText('2\nProperties=id:I:1:species:S:1:pos:R:3\n1 Cu 0 0 0\n1 Cu 1 1 1\n'), /unique/);
  assert.throws(() => parseMdText('1\npbc="T T T"\nCu 1 1 1\n'), /Lattice/);
});
test('structures with partial or disordered occupancies parse successfully and include a warning', () => {
  const cif = [
    'data_test',
    '_cell_length_a 5.0',
    '_cell_length_b 5.0',
    '_cell_length_c 5.0',
    '_cell_angle_alpha 90',
    '_cell_angle_beta 90',
    '_cell_angle_gamma 90',
    'loop_',
    ' _atom_site_label',
    ' _atom_site_type_symbol',
    ' _atom_site_fract_x',
    ' _atom_site_fract_y',
    ' _atom_site_fract_z',
    ' _atom_site_occupancy',
    ' Ni1 Ni 0.0 0.0 0.0 0.5',
    ' Zn1 Zn 0.5 0.5 0.5 0.5',
  ].join('\n');
  const result = parseMdText(cif, 'disordered.cif');
  assert.equal(result.frames.length, 1);
  assert.equal(result.frames[0].ids.length, 2);
  assert.match(result.warnings.join(' '), /partial or disordered site occupancies/i);
});

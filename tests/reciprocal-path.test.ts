import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LEGACY_AUTOMATIC_K_PATH,
  reciprocalPathSubmission,
  requestedReciprocalPath,
  resolveReciprocalPathMode,
  detectLatticeSystem,
  defaultKPathForMaterial,
  highSymmetryChipsForMaterial,
  formatQeKPointsCrystalB,
} from '../lib/reciprocal-path.ts';

test('new automatic drafts do not submit a requested reciprocal path', () => {
  const draft = { kPath: 'Γ — M — K — Γ', kPathMode: 'automatic' as const };
  assert.equal(resolveReciprocalPathMode(draft), 'automatic');
  assert.equal(requestedReciprocalPath(draft), undefined);
});

test('custom reciprocal paths are submitted exactly as saved', () => {
  const draft = { kPath: 'Γ — M - K - Γ', kPathMode: 'custom' as const };
  assert.equal(resolveReciprocalPathMode(draft), 'custom');
  assert.equal(requestedReciprocalPath(draft), 'Γ — M - K - Γ');
  assert.deepEqual(reciprocalPathSubmission('Band structure', draft, ''), {
    autoKPath: false,
    requestedKPath: 'Γ — M - K - Γ',
  });
});

test('legacy drafts distinguish the old automatic placeholder from user paths', () => {
  assert.equal(resolveReciprocalPathMode({ kPath: LEGACY_AUTOMATIC_K_PATH }), 'automatic');
  assert.equal(resolveReciprocalPathMode({ kPath: 'Γ - M - K - Γ' }), 'custom');
});

test('expert raw input remains authoritative over the visual path controls', () => {
  assert.deepEqual(
    reciprocalPathSubmission(
      'Band structure',
      { kPath: 'Γ - M - K - Γ', kPathMode: 'custom' },
      '&CONTROL\n/\nK_POINTS crystal_b',
    ),
    { autoKPath: false },
  );
});

test('detectLatticeSystem accurately identifies hexagonal, cubic, tetragonal, and orthorhombic crystals', () => {
  // Hexagonal MnTe cell vectors
  const hexVectors: Array<[number, number, number]> = [
    [4.148, 0, 0],
    [-2.074, 3.59227, 0],
    [0, 0, 6.711],
  ];
  assert.equal(detectLatticeSystem(hexVectors, 'P6_3/mmc · 194'), 'hexagonal');
  assert.equal(defaultKPathForMaterial({ cellVectors: hexVectors, spaceGroup: 'P6_3/mmc' }), 'Γ — M — K — Γ — A — L — H — A');
  assert.deepEqual(highSymmetryChipsForMaterial({ cellVectors: hexVectors }), ['Γ', 'M', 'K', 'A', 'L', 'H']);

  // Cubic FCC Silicon
  const fccVectors: Array<[number, number, number]> = [
    [0, 2.715, 2.715],
    [2.715, 0, 2.715],
    [2.715, 2.715, 0],
  ];
  assert.equal(detectLatticeSystem(fccVectors, 'Fd-3m · 227'), 'cubic-fcc');
  assert.equal(defaultKPathForMaterial({ cellVectors: fccVectors, spaceGroup: 'Fd-3m' }), 'Γ — X — W — K — Γ — L');

  // Tetragonal Rutile TiO2
  const tetVectors: Array<[number, number, number]> = [
    [4.594, 0, 0],
    [0, 4.594, 0],
    [0, 0, 2.959],
  ];
  assert.equal(detectLatticeSystem(tetVectors, 'P4_2/mnm · 136'), 'tetragonal');
  assert.equal(defaultKPathForMaterial({ cellVectors: tetVectors }), 'Γ — X — M — Γ — Z — R — A — Z');
});

test('formatQeKPointsCrystalB generates crystal-aware K_POINTS block with proper coordinates and labels', () => {
  const hexVectors: Array<[number, number, number]> = [
    [4.148, 0, 0],
    [-2.074, 3.59227, 0],
    [0, 0, 6.711],
  ];
  const block = formatQeKPointsCrystalB(
    { kPathPoints: 20, kPathMode: 'automatic' },
    { cellVectors: hexVectors, spaceGroup: 'P6_3/mmc' },
  );
  assert.match(block, /^K_POINTS crystal_b\n8\n/);
  assert.match(block, /0\.0000 0\.0000 0\.0000 20 ! Γ/);
  assert.match(block, /0\.5000 0\.0000 0\.0000 20 ! M/);
  assert.match(block, /0\.3333 0\.3333 0\.0000 20 ! K/);
  assert.match(block, /0\.0000 0\.0000 0\.5000 1 ! A$/);
});

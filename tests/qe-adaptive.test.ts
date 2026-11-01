import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyResolvedQeSystem,
  cutoffUserOverride,
  dosIntegrationInputLines,
  occupationUserOverride,
  qeRecommendationDraft,
  recommendedCutoffFields,
  recommendedOccupationFields,
  resolveQeAdaptiveParameters,
  resolveAdaptiveBands,
  recommendedHubbardCorrections,
  type AdaptiveQeDraft,
  type AdaptiveQeMaterial,
} from '../lib/qe-adaptive.ts';

const baseDraft: AdaptiveQeDraft = {
  accuracy: 'Balanced',
  functional: 'PBE',
  occupationPolicy: 'auto',
  occupations: 'smearing',
  smearingType: 'marzari-vanderbilt',
  smearing: 0.02,
  cutoffPolicy: 'auto',
  cutoff: 70,
  chargeDensityCutoff: 560,
  pseudoFamily: 'SSSP precision',
  totalCharge: 0,
  spin: false,
  soc: false,
  noncollinear: false,
  startingMagnetization: 0.5,
  totalMagnetization: 0,
  dftU: false,
  hubbardU: 0,
  vdwCorrection: 'none',
  assumeIsolated: 'none',
};

const mose2: AdaptiveQeMaterial = { species: ['Mo', 'Se'] };

test('auto occupations use fixed for a gapped material reference', () => {
  const resolved = resolveQeAdaptiveParameters(baseDraft, {
    species: ['Si'],
    electronicReference: {
      character: 'indirect-gap',
      bandGapEv: 1.1,
      source: 'Materials Project',
      confidence: 'medium',
    },
  }, 'Total energy', 'scf');

  assert.equal(resolved.occupation.value, 'fixed');
  assert.equal(resolved.occupation.source, 'Materials Project');
  assert.equal(resolved.occupation.degauss, undefined);
});

test('auto occupations use smearing for a gapped reference when unconstrained collinear spin is active', () => {
  const resolved = resolveQeAdaptiveParameters({ ...baseDraft, spin: true, magnetizationConstraint: 'unconstrained' }, {
    species: ['Si'],
    electronicReference: {
      character: 'indirect-gap',
      bandGapEv: 1.1,
      source: 'completed calculation',
      confidence: 'high',
      spin: true,
    },
  }, 'Total energy', 'scf');

  assert.equal(resolved.occupation.value, 'smearing');
  assert.equal(resolved.occupation.smearingType, 'marzari-vanderbilt');
  assert.equal(resolved.occupation.degauss, 0.01);
});

test('auto occupations use accuracy-scaled cold smearing for a metal', () => {
  const resolved = resolveQeAdaptiveParameters({ ...baseDraft, accuracy: 'High accuracy' }, {
    species: ['Al'],
    electronicReference: {
      character: 'metallic',
      bandGapEv: 0,
      source: 'completed calculation',
      confidence: 'high',
      functional: 'PBE',
      spin: false,
      soc: false,
      totalCharge: 0,
    },
  }, 'Total energy', 'scf');

  assert.equal(resolved.occupation.value, 'smearing');
  assert.equal(resolved.occupation.smearingType, 'marzari-vanderbilt');
  assert.equal(resolved.occupation.degauss, 0.005);
});

test('an incompatible electronic reference falls back instead of being trusted', () => {
  const resolved = resolveQeAdaptiveParameters({ ...baseDraft, soc: true }, {
    species: ['Mo', 'Se'],
    electronicReference: {
      character: 'indirect-gap',
      bandGapEv: 1.4,
      source: 'completed calculation',
      confidence: 'high',
      functional: 'PBE',
      spin: false,
      soc: false,
      totalCharge: 0,
    },
  }, 'Band structure', 'scf');

  assert.equal(resolved.occupation.value, 'smearing');
  assert.equal(resolved.occupation.confidence, 'provisional');
  assert.equal(resolved.occupation.source, 'configuration changed');
});

test('Materials Project band gaps are not reused for incompatible electronic settings', () => {
  const reference: AdaptiveQeMaterial = {
    species: ['Si'],
    electronicReference: {
      character: 'indirect-gap',
      bandGapEv: 1.1,
      source: 'Materials Project',
      confidence: 'medium',
    },
  };
  const hse = resolveQeAdaptiveParameters({ ...baseDraft, functional: 'HSE' }, reference, 'Total energy', 'scf');
  const soc = resolveQeAdaptiveParameters({ ...baseDraft, soc: true }, reference, 'Total energy', 'scf');

  assert.equal(hse.occupation.value, 'smearing');
  assert.equal(soc.occupation.value, 'smearing');
  assert.equal(hse.occupation.source, 'configuration changed');
  assert.equal(soc.occupation.source, 'configuration changed');
});

test('DOS NSCF always uses optimized tetrahedra independent of SCF character', () => {
  const resolved = resolveQeAdaptiveParameters(baseDraft, mose2, 'Density of states', 'nscf-dos');
  assert.equal(resolved.occupation.policy, 'workflow');
  assert.equal(resolved.occupation.value, 'tetrahedra_opt');
  assert.equal(resolved.occupation.degauss, undefined);
});

test('DOS post-processing requests tetrahedra without Gaussian broadening', () => {
  const input = dosIntegrationInputLines();
  assert.match(input, /bz_sum = 'tetrahedra_opt'/);
  assert.doesNotMatch(input, /degauss|ngauss/);
});

test('SSSP mixed-species cutoffs take the strictest recommendation per basis', () => {
  const resolved = resolveQeAdaptiveParameters(baseDraft, mose2, 'Total energy', 'scf');
  assert.equal(resolved.cutoff.ecutwfc, 35);
  assert.equal(resolved.cutoff.ecutrho, 240);
  assert.equal(resolved.cutoff.metadataComplete, true);
  assert.deepEqual(resolved.cutoff.limitingSpecies.sort(), ['Mo', 'Se']);
  assert.deepEqual(resolved.cutoff.pseudopotentialTypes.sort(), ['NC', 'USPP']);
});

test('bundled SSSP metadata covers imported elements outside the legacy UI list', () => {
  const resolved = resolveQeAdaptiveParameters(baseDraft, { species: ['Zr', 'Br'] }, 'Total energy', 'scf');
  assert.equal(resolved.cutoff.ecutwfc, 90);
  assert.equal(resolved.cutoff.ecutrho, 720);
  assert.equal(resolved.cutoff.metadataComplete, true);
  assert.deepEqual(resolved.cutoff.limitingSpecies, ['Br']);
});

test('manual cutoffs and occupations remain exact expert overrides', () => {
  const resolved = resolveQeAdaptiveParameters({
    ...baseDraft,
    occupationPolicy: 'manual',
    occupations: 'smearing',
    smearingType: 'fermi-dirac',
    smearing: 0.012,
    cutoffPolicy: 'manual',
    cutoff: 88,
    chargeDensityCutoff: 704,
  }, mose2, 'Total energy', 'scf');

  assert.equal(resolved.occupation.value, 'smearing');
  assert.equal(resolved.occupation.smearingType, 'fermi-dirac');
  assert.equal(resolved.occupation.degauss, 0.012);
  assert.equal(resolved.cutoff.ecutwfc, 88);
  assert.equal(resolved.cutoff.ecutrho, 704);
});

test('editing an auto-filled occupation creates an explicit override that can be reset', () => {
  const recommended = resolveQeAdaptiveParameters(baseDraft, {
    species: ['Si'],
    electronicReference: {
      character: 'indirect-gap',
      bandGapEv: 1.1,
      source: 'Materials Project',
      confidence: 'medium',
    },
  }, 'Total energy', 'scf').occupation;
  const custom = occupationUserOverride(baseDraft, recommended, recommended, {
    occupations: 'smearing',
    smearingType: 'fermi-dirac',
    smearing: 0.015,
  });

  assert.deepEqual(custom, {
    occupationPolicy: 'manual',
    occupations: 'smearing',
    smearingType: 'fermi-dirac',
    smearing: 0.015,
  });
  assert.deepEqual(recommendedOccupationFields({ ...baseDraft, ...custom }, recommended), {
    occupationPolicy: 'auto',
    occupations: 'fixed',
    smearingType: 'fermi-dirac',
    smearing: 0.015,
  });
});

test('editing one auto-filled cutoff preserves the other recommendation and supports reset', () => {
  const recommended = resolveQeAdaptiveParameters(baseDraft, mose2, 'Total energy', 'scf').cutoff;
  const custom = cutoffUserOverride(recommended, { cutoff: 42 });

  assert.deepEqual(custom, {
    cutoffPolicy: 'manual',
    cutoff: 42,
    chargeDensityCutoff: 240,
  });
  assert.deepEqual(recommendedCutoffFields(recommended), {
    cutoffPolicy: 'auto',
    cutoff: 35,
    chargeDensityCutoff: 240,
  });
});

test('PseudoDojo recommendations do not inherit a previous custom cutoff', () => {
  const customized = {
    ...baseDraft,
    pseudoFamily: 'PseudoDojo' as const,
    cutoffPolicy: 'manual' as const,
    cutoff: 88,
    chargeDensityCutoff: 704,
  };
  const recommended = resolveQeAdaptiveParameters(qeRecommendationDraft(customized), mose2, 'Total energy', 'scf').cutoff;

  assert.equal(recommended.policy, 'auto');
  assert.equal(recommended.ecutwfc, 70);
  assert.equal(recommended.ecutrho, 280);
});

test('stage application removes stale smearing variables for DOS tetrahedra', () => {
  const input = `&CONTROL
  calculation = 'nscf'
/
&SYSTEM
  ibrav = 0
  ecutwfc = 70
  ecutrho = 560
  occupations = 'smearing'
  smearing = 'gaussian'
  degauss = 0.02
/
K_POINTS automatic
8 8 8 0 0 0`;
  const resolved = resolveQeAdaptiveParameters(baseDraft, mose2, 'Density of states', 'nscf-dos');
  const updated = applyResolvedQeSystem(input, resolved);

  assert.match(updated, /ecutwfc = 35/);
  assert.match(updated, /ecutrho = 240/);
  assert.match(updated, /occupations = 'tetrahedra_opt'/);
  assert.doesNotMatch(updated, /^\s*smearing\s*=/m);
  assert.doesNotMatch(updated, /^\s*degauss\s*=/m);
});


test('a positive gap on a sampled path cannot establish full-BZ insulating occupations', () => {
  const resolved = resolveQeAdaptiveParameters(baseDraft, { species: ['Si'], electronicReference: { source: 'completed calculation', confidence: 'medium', bandGapEv: 1, character: 'indirect-gap', bandGapScope: 'sampled-k-path' } }, 'Total energy');
  assert.equal(resolved.occupation.value, 'smearing');
  assert.equal(resolved.occupation.confidence, 'provisional');
});

test('resolveAdaptiveBands calculates valence electrons, occupied states, and recommended nbnd with buffer', () => {
  // MnTe (2 Mn atoms + 2 Te atoms): 2*15 + 2*6 = 42 valence electrons -> 21 occupied bands
  const mnTeMaterial = {
    species: ['Mn', 'Te'],
    atoms: [
      { species: 'Mn' },
      { species: 'Mn' },
      { species: 'Te' },
      { species: 'Te' },
    ],
  };
  const bands = resolveAdaptiveBands({ numberOfBands: 32 }, mnTeMaterial, 'Band structure');
  assert.equal(bands.valenceElectrons, 42);
  assert.equal(bands.occupiedBands, 21);
  assert.equal(bands.recommendedNbnd, 29); // max(16, ceil(21*1.3)=28, 21+8=29) = 29
  assert.equal(bands.isSufficient, true);

  // Insufficient bands warning check (e.g. user set nbnd = 10 < 21)
  const insufficient = resolveAdaptiveBands({ numberOfBands: 10 }, mnTeMaterial, 'Band structure');
  assert.equal(insufficient.isSufficient, false);

  // Large system: 100 valence electrons -> 50 occupied bands -> recommended 65 bands (not 32!)
  const largeSystem = {
    atoms: Array.from({ length: 25 }, () => ({ species: 'Si' })), // 25 Si atoms * 4 = 100 e-
  };
  const largeBands = resolveAdaptiveBands({}, largeSystem, 'Band structure');
  assert.equal(largeBands.valenceElectrons, 100);
  assert.equal(largeBands.occupiedBands, 50);
  assert.equal(largeBands.recommendedNbnd, 65); // ceil(50*1.3) = 65
});

test('recommendedHubbardCorrections provides standard Materials Project U values for 3d/4f elements', () => {
  const mnTeU = recommendedHubbardCorrections(['Mn', 'Te']);
  assert.equal(mnTeU.length, 1);
  assert.equal(mnTeU[0].species, 'Mn');
  assert.equal(mnTeU[0].manifold, '3d');
  assert.equal(mnTeU[0].u, 3.9);

  const feOU = recommendedHubbardCorrections(['Fe1', 'O']);
  assert.equal(feOU.length, 1);
  assert.equal(feOU[0].species, 'Fe1');
  assert.equal(feOU[0].u, 5.3);

  const nonMagnetic = recommendedHubbardCorrections(['Si', 'C']);
  assert.equal(nonMagnetic.length, 0);
});

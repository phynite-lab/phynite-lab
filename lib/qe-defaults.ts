import type { Accuracy, JobDraft } from '../components/JobComposer.tsx';

/** Fresh drafts keep magnetization unconstrained; saved legacy constraints are migrated separately. */
export function createDefaultQeDraft(): JobDraft {
  return {
    calculations: [],
    accuracy: 'Balanced',
    functional: 'PBE',
    kPoint: 8,
    cutoff: 70,
    chargeDensityCutoff: 560,
    occupationPolicy: 'auto',
    occupations: 'smearing',
    smearingType: 'marzari-vanderbilt',
    smearing: 0.02,
    cutoffPolicy: 'auto',
    spin: false,
    startingMagnetization: 0.5,
    magnetizationConstraint: 'unconstrained',
    startingMagnetizations: {},
    soc: false,
    noncollinear: false,
    kPath: 'Γ — X — W — K — Γ — L',
    kPathMode: 'automatic',
    kPathPoints: 24,
    numberOfBands: 32,
    relaxCell: true,
    ionDynamics: 'bfgs',
    forceThreshold: 0.001,
    targetPressure: 0,
    qPoint: 4,
    phononThreshold: 1e-12,
    acousticSumRule: true,
    scfThreshold: 0.00000001,
    electronMaxSteps: 100,
    mixingBeta: 0.7,
    dosEnergyMin: -12,
    dosEnergyMax: 8,
    dosEnergyStep: 0.02,
    projectedDos: true,
    projectedBands: false,
    prefix: 'calculation',
    restartMode: 'from_scratch',
    verbosity: 'low',
    diskIO: 'low',
    maxSeconds: 86400,
    pseudoFamily: 'SSSP precision',
    kPointShift: '0 0 0',
    totalCharge: 0,
    useSymmetry: true,
    useInversion: true,
    vdwCorrection: 'none',
    mixingMode: 'plain',
    mixingNdim: 8,
    diagonalization: 'david',
    diagonalizationThreshold: 0.00001,
    scfMustConverge: true,
    exxFraction: 0.25,
    dftU: false,
    hubbardU: 4,
    hubbardProjector: 'ortho-atomic',
    hubbardCorrections: [],
    energyThreshold: 0.0001,
    cellDynamics: 'bfgs',
    cellDoFree: 'all',
    pressureThreshold: 0.5,
    trustRadius: 0.5,
    bandSymmetry: true,
    bandOverlap: false,
    firstBand: 1,
    lastBand: 0,
    dosBroadening: 0,
    dosNgauss: 0,
    dosSymmetrize: true,
    pawProjection: false,
    phononIterations: 100,
    phononMixing: 0.7,
    phononMixingNdim: 4,
    dielectricTensor: false,
    effectiveCharges: false,
    phononAsr: 'crystal',
    electronPhonon: 'none',
    qeVersion: '7.5',
    rawInput: '',
    title: 'Untitled calculation',
    outdir: './tmp',
    pseudoDir: './pseudo',
    nstep: 100,
    printForces: true,
    printStress: true,
    kPointY: 8,
    kPointZ: 8,
    fftGridMode: 'automatic',
    nr1: 48,
    nr2: 48,
    nr3: 48,
    totalMagnetization: 0,
    assumeIsolated: 'none',
    dipoleCorrection: false,
    dipolePlacement: 'automatic',
    dipolePosition: 0.9,
    dipoleRegion: 0.05,
    electricFieldAmplitude: 0,
    startingPotential: 'atomic',
    startingWavefunctions: 'atomic+random',
    realSpace: false,
    diagoFullAccuracy: false,
    potentialExtrapolation: 'atomic',
    wavefunctionExtrapolation: 'none',
    removeRigidRotation: false,
    refoldPositions: false,
    cellFactor: 2,
    qPointY: 4,
    qPointZ: 4,
    matdynDeltaE: 1,
    transportInterpolationMultiplier: 3,
    transportTemperatureMin: 100,
    transportTemperatureMax: 900,
    transportTemperatureStep: 50,
    transportChemicalPotentialMin: -0.5,
    transportChemicalPotentialMax: 0.5,
    transportScatteringModel: 'constant-relaxation-time',
    transportSampling: 'chemical-potential',
    transportRelaxationTime: 10,
    transportEnergyBins: 5000,
  };
}

export function qeAccuracyProfile(accuracy: Accuracy): {
  kPoint: number;
  kPointY: number;
  kPointZ: number;
  cutoff: number;
  chargeDensityCutoff: number;
  scfThreshold: number;
  forceThreshold: number;
  qPoint: number;
  qPointY: number;
  qPointZ: number;
  phononThreshold: number;
  kPathPoints: number;
  dosEnergyStep: number;
} {
  switch (accuracy) {
    case 'Fast':
      return {
        kPoint: 4,
        kPointY: 4,
        kPointZ: 4,
        cutoff: 45,
        chargeDensityCutoff: 360,
        scfThreshold: 0.000001,
        forceThreshold: 0.002,
        qPoint: 2,
        qPointY: 2,
        qPointZ: 2,
        phononThreshold: 1e-10,
        kPathPoints: 16,
        dosEnergyStep: 0.05,
      };
    case 'Balanced':
      return {
        kPoint: 8,
        kPointY: 8,
        kPointZ: 8,
        cutoff: 70,
        chargeDensityCutoff: 560,
        scfThreshold: 0.00000001,
        forceThreshold: 0.001,
        qPoint: 4,
        qPointY: 4,
        qPointZ: 4,
        phononThreshold: 1e-12,
        kPathPoints: 24,
        dosEnergyStep: 0.02,
      };
    case 'High accuracy':
      return {
        kPoint: 12,
        kPointY: 12,
        kPointZ: 12,
        cutoff: 100,
        chargeDensityCutoff: 800,
        scfThreshold: 0.0000000001,
        forceThreshold: 0.0005,
        qPoint: 6,
        qPointY: 6,
        qPointZ: 6,
        phononThreshold: 1e-14,
        kPathPoints: 48,
        dosEnergyStep: 0.01,
      };
  }
}

/** Apply full numerical basis and solver convergence profile while preserving manual overrides and clearing raw input. */
export function applyQeAccuracy(draft: JobDraft, accuracy: Accuracy): JobDraft {
  const profile = qeAccuracyProfile(accuracy);
  return {
    ...draft,
    accuracy,
    ...profile,
    ...(draft.cutoffPolicy === 'manual' ? {
      cutoff: draft.cutoff,
      chargeDensityCutoff: draft.chargeDensityCutoff,
    } : {}),
    rawInput: '',
  };
}

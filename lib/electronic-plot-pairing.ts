export type ElectronicPlotRun = {
  id: string;
  calculationType?: string;
  status: string;
  settings?: string;
  materialId?: string;
  artifactsExpired?: boolean;
  structureSourceId?: string;
  structureSourceCalculationId?: string;
  referenceElectronicFingerprint?: string;
  referenceFunctional?: string;
  referencePseudoFamily?: string;
  referenceSpin?: boolean;
  referenceSoc?: boolean;
  referenceNoncollinear?: boolean;
  referenceStartingMagnetization?: number;
  referenceTotalMagnetization?: number;
  referenceDftU?: boolean;
  referenceHubbardU?: number;
  referenceVdwCorrection?: string;
  referenceTotalCharge?: number;
  referenceMaterialUpdatedAt?: string;
};

export type ElectronicReferenceDraft = {
  rawInput?: string;
  functional: string;
  pseudoFamily: string;
  cutoff: number;
  chargeDensityCutoff: number;
  cutoffPolicy: string;
  occupationPolicy: string;
  occupations: string;
  smearingType: string;
  smearing: number;
  spin: boolean;
  startingMagnetization: number;
  startingMagnetizations?: Record<string, number>;
  magnetizationConstraint?: 'unconstrained' | 'total';
  totalMagnetization: number;
  soc: boolean;
  noncollinear: boolean;
  totalCharge: number;
  useSymmetry: boolean;
  useInversion: boolean;
  vdwCorrection: string;
  exxFraction: number;
  dftU: boolean;
  hubbardU: number;
  hubbardProjector?: string;
  hubbardCorrections?: Array<{ species: string; manifold: string; u: number }>;
  atomicMassOverrides?: Record<string, number>;
  cellParameterUnit?: string;
  cellParameterAlat?: number;
  cellParameters?: Array<[number, number, number]>;
  atomicPositionUnit?: string;
  atomicPositions?: Array<{ species: string; label?: string; x: number; y: number; z: number }>;
  scfThreshold: number;
  electronMaxSteps: number;
  mixingBeta: number;
  mixingMode: string;
  mixingNdim: number;
  diagonalization: string;
  diagonalizationThreshold: number;
  scfMustConverge: boolean;
  diagoFullAccuracy: boolean;
  numberOfBands: number;
  assumeIsolated: string;
  fftGridMode: string;
  nr1: number;
  nr2: number;
  nr3: number;
  startingPotential: string;
  startingWavefunctions: string;
  realSpace: boolean;
  restartMode: string;
  kPoint: number;
  kPointY: number;
  kPointZ: number;
  kPointShift: string;
};

/** The effective SCF values, before DOS-specific tetrahedron integration is applied. */
export type ElectronicScfResolution = {
  stage: string;
  cutoff: { ecutwfc: number; ecutrho: number };
  occupation: { value: string; smearingType?: string; degauss?: number };
};

const oppositeElectronicPlot: Record<string, string> = {
  'Band structure': 'Density of states',
  'Density of states': 'Band structure',
};

export function electronicReferenceFingerprint(draft: ElectronicReferenceDraft, resolvedScf?: ElectronicScfResolution) {
  if (draft.rawInput?.trim()) return null;
  if (typeof draft.kPointShift !== 'string' || !draft.kPointShift.trim()) return null;
  if (resolvedScf && resolvedScf.stage !== 'scf') return null;
  // An adaptive draft is not the executed input. Its material/reference-dependent
  // defaults must be resolved at submission, not reconstructed when plots open.
  if (!resolvedScf && (draft.occupationPolicy !== 'manual' || draft.cutoffPolicy !== 'manual')) return null;
  const occupation = resolvedScf ? resolvedScf.occupation.value : draft.occupations;
  const settings = {
    version: 3,
    functional: draft.functional,
    pseudoFamily: draft.pseudoFamily,
    cutoff: resolvedScf ? resolvedScf.cutoff.ecutwfc : draft.cutoff,
    chargeDensityCutoff: resolvedScf ? resolvedScf.cutoff.ecutrho : draft.chargeDensityCutoff,
    occupations: occupation,
    smearingType: occupation === 'smearing' ? (resolvedScf ? resolvedScf.occupation.smearingType : draft.smearingType) : null,
    smearing: occupation === 'smearing' ? (resolvedScf ? resolvedScf.occupation.degauss : draft.smearing) : null,
    spin: draft.spin,
    startingMagnetization: (draft.spin || draft.soc || draft.noncollinear) && draft.magnetizationConstraint !== 'total' ? draft.startingMagnetization : null,
    startingMagnetizations: draft.magnetizationConstraint !== 'total' && (draft.spin || draft.soc || draft.noncollinear) ? Object.fromEntries(Object.entries(draft.startingMagnetizations ?? {}).sort(([a], [b]) => a.localeCompare(b))) : null,
    magnetizationConstraint: draft.spin || draft.soc || draft.noncollinear ? draft.magnetizationConstraint ?? 'unconstrained' : null,
    totalMagnetization: draft.spin && !draft.soc && !draft.noncollinear && draft.magnetizationConstraint === 'total' ? draft.totalMagnetization : null,
    structureCards: draft.cellParameters || draft.atomicPositions ? { cellParameters: draft.cellParameters ?? null, cellParameterUnit: draft.cellParameterUnit ?? 'angstrom', cellParameterAlat: draft.cellParameterAlat ?? null, atomicPositions: draft.atomicPositions ?? null, atomicPositionUnit: draft.atomicPositionUnit ?? 'crystal' } : null,
    atomicMassOverrides: Object.fromEntries(Object.entries(draft.atomicMassOverrides ?? {}).sort(([a], [b]) => a.localeCompare(b))),
    soc: draft.soc,
    noncollinear: draft.noncollinear,
    totalCharge: draft.totalCharge,
    useSymmetry: draft.useSymmetry,
    useInversion: draft.useInversion,
    vdwCorrection: draft.vdwCorrection,
    exxFraction: draft.functional === 'HSE' ? draft.exxFraction : null,
    dftU: draft.dftU,
    hubbardU: draft.dftU ? draft.hubbardU : null,
    hubbardProjector: draft.dftU ? draft.hubbardProjector ?? null : null,
    hubbardCorrections: draft.dftU ? draft.hubbardCorrections ?? null : null,
    scfThreshold: draft.scfThreshold,
    electronMaxSteps: draft.electronMaxSteps,
    mixingBeta: draft.mixingBeta,
    mixingMode: draft.mixingMode,
    mixingNdim: draft.mixingNdim,
    diagonalization: draft.diagonalization,
    diagonalizationThreshold: draft.diagonalizationThreshold,
    scfMustConverge: draft.scfMustConverge,
    diagoFullAccuracy: draft.diagoFullAccuracy,
    numberOfBands: draft.numberOfBands,
    assumeIsolated: draft.assumeIsolated,
    fftGrid: draft.fftGridMode === 'automatic' ? null : draft.fftGridMode === 'manual' ? [draft.nr1, draft.nr2, draft.nr3] : undefined,
    startingPotential: draft.startingPotential,
    startingWavefunctions: draft.startingWavefunctions,
    realSpace: draft.realSpace,
    restartMode: draft.restartMode,
    kGrid: [draft.kPoint, draft.kPointY, draft.kPointZ],
    kShift: draft.kPointShift.trim().split(/\s+/).map(Number),
  };
  if (!validElectronicSettings(settings)) return null;
  return JSON.stringify(settings);
}

function sourceSignature(run: ElectronicPlotRun) {
  if (run.structureSourceId === 'original') {
    return run.structureSourceCalculationId ? null : `original:${run.referenceMaterialUpdatedAt ?? ''}`;
  }
  if (run.structureSourceId && run.structureSourceCalculationId) return `calculation:${run.structureSourceCalculationId}`;
  return null;
}

function validElectronicSettings(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const settings = value as Record<string, unknown>;
  const finite = (entry: unknown): entry is number => typeof entry === 'number' && Number.isFinite(entry);
  const positive = (entry: unknown): entry is number => finite(entry) && entry > 0;
  const count = (entry: unknown) => positive(entry) && Number.isInteger(entry);
  const text = (entry: unknown) => typeof entry === 'string' && Boolean(entry.trim());
  const triple = (entry: unknown, check: (value: unknown) => boolean) => Array.isArray(entry) && entry.length === 3 && entry.every(check);
  if (settings.version !== 3) return false;
  if (!['functional', 'pseudoFamily', 'vdwCorrection', 'mixingMode', 'diagonalization', 'assumeIsolated', 'startingPotential', 'startingWavefunctions', 'restartMode'].every((key) => text(settings[key]))) return false;
  if (!['fixed', 'smearing', 'tetrahedra', 'tetrahedra_opt', 'tetrahedra_lin'].includes(String(settings.occupations))) return false;
  if (!['spin', 'soc', 'noncollinear', 'useSymmetry', 'useInversion', 'dftU', 'scfMustConverge', 'diagoFullAccuracy', 'realSpace'].every((key) => typeof settings[key] === 'boolean')) return false;
  if (!['cutoff', 'chargeDensityCutoff', 'scfThreshold', 'mixingBeta', 'diagonalizationThreshold'].every((key) => positive(settings[key]))) return false;
  if (!['electronMaxSteps', 'mixingNdim', 'numberOfBands'].every((key) => count(settings[key]))) return false;
  if (!finite(settings.totalCharge) || !triple(settings.kGrid, count) || !triple(settings.kShift, (entry) => entry === 0 || entry === 1)) return false;
  if (settings.fftGrid !== null && !triple(settings.fftGrid, count)) return false;
  if (settings.occupations === 'smearing') {
    if (!text(settings.smearingType) || !positive(settings.smearing)) return false;
  } else if (settings.smearingType !== null || settings.smearing !== null) return false;
  if (settings.spin || settings.soc || settings.noncollinear) {
    if (!['total', 'unconstrained'].includes(String(settings.magnetizationConstraint))) return false;
    if (settings.magnetizationConstraint === 'total') {
      if (settings.soc || settings.noncollinear || !finite(settings.totalMagnetization) || settings.startingMagnetization !== null || settings.startingMagnetizations !== null) return false;
    } else if (!finite(settings.startingMagnetization) || settings.totalMagnetization !== null || !settings.startingMagnetizations || typeof settings.startingMagnetizations !== 'object' || !Object.values(settings.startingMagnetizations).every(finite)) return false;
  } else if (settings.startingMagnetization !== null || settings.totalMagnetization !== null || settings.startingMagnetizations !== null || settings.magnetizationConstraint !== null) return false;
  if (settings.structureCards !== null && (!settings.structureCards || typeof settings.structureCards !== 'object')) return false;
  if (!settings.atomicMassOverrides || typeof settings.atomicMassOverrides !== 'object' || !Object.values(settings.atomicMassOverrides).every(positive)) return false;
  if (settings.functional === 'HSE' ? !finite(settings.exxFraction) : settings.exxFraction !== null) return false;
  if (settings.dftU) {
    if (!finite(settings.hubbardU) || !text(settings.hubbardProjector) || !Array.isArray(settings.hubbardCorrections) || !settings.hubbardCorrections.length) return false;
  } else if (settings.hubbardU !== null || settings.hubbardCorrections !== null || settings.hubbardProjector !== null) return false;
  return true;
}

function supportedFingerprint(value: string | undefined) {
  if (!value) return false;
  try {
    return validElectronicSettings(JSON.parse(value));
  } catch {
    return false;
  }
}

export function bandDosCompatibility(left: ElectronicPlotRun, right: ElectronicPlotRun) {
  if (left.id === right.id || oppositeElectronicPlot[left.calculationType ?? ''] !== right.calculationType) {
    return { compatible: false, reason: 'Band structure and DOS are required.' } as const;
  }
  if (left.status !== 'Completed' || right.status !== 'Completed' || left.artifactsExpired || right.artifactsExpired) {
    return { compatible: false, reason: 'Both calculation results must still be available.' } as const;
  }
  if (!left.materialId || left.materialId !== right.materialId) {
    return { compatible: false, reason: 'Results belong to different structures.' } as const;
  }
  if (!left.referenceMaterialUpdatedAt || left.referenceMaterialUpdatedAt !== right.referenceMaterialUpdatedAt) {
    return { compatible: false, reason: 'Geometry versions do not match.' } as const;
  }
  const leftSource = sourceSignature(left);
  const rightSource = sourceSignature(right);
  if (!leftSource || leftSource !== rightSource) {
    return { compatible: false, reason: 'Structure sources do not match.' } as const;
  }
  if (!supportedFingerprint(left.referenceElectronicFingerprint) || !supportedFingerprint(right.referenceElectronicFingerprint)) {
    return { compatible: false, reason: 'Verified SCF settings are unavailable for this run. Run Band structure and DOS again with matching settings.' } as const;
  }
  if (left.referenceElectronicFingerprint !== right.referenceElectronicFingerprint) {
    return { compatible: false, reason: 'Electronic ground-state settings do not match.' } as const;
  }
  return { compatible: true, reason: 'Same geometry, structure source, and electronic ground-state settings.' } as const;
}

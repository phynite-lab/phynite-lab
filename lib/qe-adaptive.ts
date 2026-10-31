import ssspEfficiencyMetadata from '../data/sssp/SSSP_1.3.0_PBE_efficiency.json' with { type: 'json' };
import ssspPrecisionMetadata from '../data/sssp/SSSP_1.3.0_PBE_precision.json' with { type: 'json' };

export type OccupationPolicy = 'auto' | 'manual';
export type CutoffPolicy = 'auto' | 'manual';
export type QeOccupation = 'fixed' | 'smearing' | 'tetrahedra' | 'tetrahedra_opt';
export type QeSmearing = 'gaussian' | 'methfessel-paxton' | 'marzari-vanderbilt' | 'fermi-dirac';
export type QePwStage = 'scf' | 'relax' | 'bands' | 'nscf-dos' | 'nscf-transport';
export type PseudopotentialType = 'NC' | 'USPP' | 'PAW' | 'unknown';

export type ElectronicReference = {
  character?: 'metallic' | 'direct-gap' | 'indirect-gap' | 'undetermined' | string;
  bandGapEv?: number;
  source: 'completed calculation' | 'Materials Project';
  confidence: 'high' | 'medium';
  confidenceScope?: 'source-identity';
  bandGapScope?: 'sampled-k-path' | 'full-brillouin-zone';
  functional?: string;
  pseudoFamily?: AdaptiveQeDraft['pseudoFamily'];
  spin?: boolean;
  soc?: boolean;
  noncollinear?: boolean;
  startingMagnetization?: number;
  totalMagnetization?: number;
  dftU?: boolean;
  hubbardU?: number;
  vdwCorrection?: AdaptiveQeDraft['vdwCorrection'];
  totalCharge?: number;
  updatedAt?: string;
};

export type AdaptiveQeMaterial = {
  species: string[];
  electronicReference?: ElectronicReference;
} | null;

export type AdaptiveQeDraft = {
  accuracy: 'Fast' | 'Balanced' | 'High accuracy';
  functional: 'PBE' | 'LDA' | 'HSE';
  occupationPolicy?: OccupationPolicy;
  occupations: QeOccupation;
  smearingType: QeSmearing;
  smearing: number;
  cutoffPolicy?: CutoffPolicy;
  cutoff: number;
  chargeDensityCutoff: number;
  pseudoFamily: 'SSSP efficiency' | 'SSSP precision' | 'PseudoDojo';
  totalCharge: number;
  spin: boolean;
  soc: boolean;
  noncollinear: boolean;
  startingMagnetization: number;
  startingMagnetizations?: Record<string, number>;
  magnetizationConstraint?: 'unconstrained' | 'total';
  totalMagnetization: number;
  dftU: boolean;
  hubbardU: number;
  hubbardProjector?: string;
  hubbardCorrections?: Array<{ species: string; manifold: string; u: number }>;
  vdwCorrection: 'none' | 'dft-d3' | 'dft-d3-bj' | 'ts-vdw';
  assumeIsolated: 'none' | 'esm' | '2D' | 'makov-payne' | 'martyna-tuckerman';
};

type SsspRecommendation = {
  filename: string;
  type: PseudopotentialType;
  ecutwfc: number;
  ecutrho: number;
};

type SsspFamily = 'SSSP efficiency' | 'SSSP precision';

type RawSsspRecommendation = {
  filename: string;
  cutoff_wfc: number;
  cutoff_rho: number;
};

const ssspMetadata: Record<SsspFamily, Record<string, RawSsspRecommendation>> = {
  'SSSP efficiency': ssspEfficiencyMetadata,
  'SSSP precision': ssspPrecisionMetadata,
};

function pseudopotentialType(filename: string): PseudopotentialType {
  const normalized = filename.toLowerCase();
  if (normalized.includes('kjpaw') || normalized.includes('.paw.')) return 'PAW';
  if (normalized.includes('rrkjus') || normalized.includes('.uspp.') || normalized.includes('.us.')) return 'USPP';
  if (normalized.includes('oncv') || normalized.includes('.nc.') || normalized.includes('sg15')) return 'NC';
  return 'unknown';
}

function ssspRecommendation(family: SsspFamily, element: string): SsspRecommendation | undefined {
  const record = ssspMetadata[family][element];
  if (!record) return undefined;
  return {
    filename: record.filename,
    type: pseudopotentialType(record.filename),
    ecutwfc: record.cutoff_wfc,
    ecutrho: record.cutoff_rho,
  };
}

export type ResolvedOccupation = {
  policy: OccupationPolicy | 'workflow';
  value: QeOccupation;
  smearingType?: QeSmearing;
  degauss?: number;
  source: string;
  detail: string;
  confidence: 'high' | 'medium' | 'provisional';
};

export type ResolvedCutoff = {
  policy: CutoffPolicy;
  ecutwfc: number;
  ecutrho: number;
  ratio: number;
  source: string;
  detail: string;
  limitingSpecies: string[];
  pseudopotentialTypes: PseudopotentialType[];
  metadataComplete: boolean;
  advisories: string[];
};

export type ResolvedQeParameters = {
  occupation: ResolvedOccupation;
  cutoff: ResolvedCutoff;
  stage: QePwStage;
};

export type ResolvedQeWorkflow = {
  version: 1;
  calculation: string;
  stages: Partial<Record<QePwStage, ResolvedQeParameters>>;
};

type OccupationFieldPatch = Partial<Pick<AdaptiveQeDraft, 'occupations' | 'smearingType' | 'smearing'>>;
type CutoffFieldPatch = Partial<Pick<AdaptiveQeDraft, 'cutoff' | 'chargeDensityCutoff'>>;

/** Convert an auto-filled occupation field edit into an explicit, persistent user override. */
export function occupationUserOverride(
  draft: AdaptiveQeDraft,
  effective: ResolvedOccupation,
  recommended: ResolvedOccupation,
  patch: OccupationFieldPatch,
): Pick<AdaptiveQeDraft, 'occupationPolicy' | 'occupations' | 'smearingType' | 'smearing'> {
  return {
    occupationPolicy: 'manual',
    occupations: effective.value,
    smearingType: effective.smearingType ?? recommended.smearingType ?? draft.smearingType,
    smearing: effective.degauss ?? recommended.degauss ?? draft.smearing,
    ...patch,
  };
}

/** Re-apply the latest material recommendation while retaining editable draft fields. */
export function recommendedOccupationFields(
  draft: AdaptiveQeDraft,
  recommended: ResolvedOccupation,
): Pick<AdaptiveQeDraft, 'occupationPolicy' | 'occupations' | 'smearingType' | 'smearing'> {
  return {
    occupationPolicy: 'auto',
    occupations: recommended.value,
    smearingType: recommended.smearingType ?? draft.smearingType,
    smearing: recommended.degauss ?? draft.smearing,
  };
}

/** Convert an auto-filled cutoff field edit into an explicit, persistent user override. */
export function cutoffUserOverride(
  effective: ResolvedCutoff,
  patch: CutoffFieldPatch,
): Pick<AdaptiveQeDraft, 'cutoffPolicy' | 'cutoff' | 'chargeDensityCutoff'> {
  return {
    cutoffPolicy: 'manual',
    cutoff: effective.ecutwfc,
    chargeDensityCutoff: effective.ecutrho,
    ...patch,
  };
}

/** Re-apply the latest pseudopotential recommendation to the editable cutoff fields. */
export function recommendedCutoffFields(
  recommended: ResolvedCutoff,
): Pick<AdaptiveQeDraft, 'cutoffPolicy' | 'cutoff' | 'chargeDensityCutoff'> {
  return {
    cutoffPolicy: 'auto',
    cutoff: recommended.ecutwfc,
    chargeDensityCutoff: recommended.ecutrho,
  };
}

const smearingByAccuracy: Record<AdaptiveQeDraft['accuracy'], number> = {
  Fast: 0.02,
  Balanced: 0.01,
  'High accuracy': 0.005,
};

const cutoffBaselineByAccuracy: Record<AdaptiveQeDraft['accuracy'], { cutoff: number; chargeDensityCutoff: number }> = {
  Fast: { cutoff: 45, chargeDensityCutoff: 180 },
  Balanced: { cutoff: 70, chargeDensityCutoff: 280 },
  'High accuracy': { cutoff: 100, chargeDensityCutoff: 400 },
};

/** Build a recommendation-only view that cannot accidentally reuse a previous user override. */
export function qeRecommendationDraft(draft: AdaptiveQeDraft): AdaptiveQeDraft {
  return {
    ...draft,
    occupationPolicy: 'auto',
    cutoffPolicy: 'auto',
    ...cutoffBaselineByAccuracy[draft.accuracy],
  };
}

function normalizedSpecies(material: AdaptiveQeMaterial) {
  return Array.from(new Set((material?.species ?? []).map((species) => species.trim()).filter(Boolean)));
}

function referenceMatchesDraft(reference: ElectronicReference, draft: AdaptiveQeDraft) {
  if (reference.source === 'Materials Project') {
    return draft.functional === 'PBE'
      && draft.totalCharge === 0
      && !draft.spin
      && !draft.soc;
  }
  if (draft.hubbardCorrections?.length || Object.keys(draft.startingMagnetizations ?? {}).length) return false;
  return (reference.functional === undefined || reference.functional === draft.functional)
    && (reference.pseudoFamily === undefined || reference.pseudoFamily === draft.pseudoFamily)
    && (reference.spin === undefined || reference.spin === draft.spin)
    && (reference.soc === undefined || reference.soc === draft.soc)
    && (reference.noncollinear === undefined || reference.noncollinear === draft.noncollinear)
    && (reference.startingMagnetization === undefined || Math.abs(reference.startingMagnetization - draft.startingMagnetization) < 1e-8)
    && (reference.totalMagnetization === undefined || Math.abs(reference.totalMagnetization - draft.totalMagnetization) < 1e-8)
    && (reference.dftU === undefined || reference.dftU === draft.dftU)
    && (reference.hubbardU === undefined || Math.abs(reference.hubbardU - draft.hubbardU) < 1e-8)
    && (reference.vdwCorrection === undefined || reference.vdwCorrection === draft.vdwCorrection)
    && (reference.totalCharge === undefined || Math.abs(reference.totalCharge - draft.totalCharge) < 1e-8);
}

function automaticOccupation(draft: AdaptiveQeDraft, material: AdaptiveQeMaterial): ResolvedOccupation {
  const reference = material?.electronicReference;
  const degauss = smearingByAccuracy[draft.accuracy];
  if (reference && referenceMatchesDraft(reference, draft)) {
    const metallic = reference.character === 'metallic'
      || (Number.isFinite(reference.bandGapEv) && Number(reference.bandGapEv) <= 0.05);
    const gapped = reference.bandGapScope !== 'sampled-k-path' && (reference.character === 'direct-gap'
      || reference.character === 'indirect-gap'
      || (Number.isFinite(reference.bandGapEv) && Number(reference.bandGapEv) > 0.05));
    if (metallic) {
      return {
        policy: 'auto',
        value: 'smearing',
        smearingType: 'marzari-vanderbilt',
        degauss,
        source: reference.source,
        detail: `Metallic or near-zero-gap reference; cold smearing at ${degauss} Ry.`,
        confidence: reference.confidence,
      };
    }
    if (gapped) {
      if (draft.spin && !draft.soc && !draft.noncollinear && draft.magnetizationConstraint !== 'total') {
        return {
          policy: 'auto',
          value: 'smearing',
          smearingType: 'marzari-vanderbilt',
          degauss,
          source: reference.source,
          detail: 'A resolved band gap is present, but unconstrained collinear spin (LSDA) requires smearing occupations.',
          confidence: reference.confidence,
        };
      }
      return {
        policy: 'auto',
        value: 'fixed',
        source: reference.source,
        detail: `A resolved band gap${Number.isFinite(reference.bandGapEv) ? ` of ${Number(reference.bandGapEv).toFixed(3)} eV` : ''} supports fixed occupations.`,
        confidence: reference.confidence,
      };
    }
  }
  const invalidReference = reference && !referenceMatchesDraft(reference, draft);
  return {
    policy: 'auto',
    value: 'smearing',
    smearingType: 'marzari-vanderbilt',
    degauss,
    source: invalidReference ? 'configuration changed' : 'safe fallback',
    detail: invalidReference
      ? `The electronic reference does not match the current electronic model; cold smearing is used provisionally.`
      : `Electronic character is unknown; cold smearing is the robust first-run fallback.`,
    confidence: 'provisional',
  };
}

export function resolveOccupation(
  draft: AdaptiveQeDraft,
  material: AdaptiveQeMaterial,
  stage: QePwStage,
): ResolvedOccupation {
  if (stage === 'nscf-dos') {
    return {
      policy: 'workflow',
      value: 'tetrahedra_opt',
      source: 'DOS workflow',
      detail: 'Optimized tetrahedra on a dense, unshifted uniform k-grid; smearing and degauss are omitted.',
      confidence: 'high',
    };
  }
  if ((draft.occupationPolicy ?? 'auto') === 'manual') {
    return {
      policy: 'manual',
      value: draft.occupations,
      smearingType: draft.occupations === 'smearing' ? draft.smearingType : undefined,
      degauss: draft.occupations === 'smearing' ? draft.smearing : undefined,
      source: 'manual override',
      detail: draft.occupations === 'smearing'
        ? `${draft.smearingType} smearing at ${draft.smearing} Ry.`
        : `${draft.occupations} occupations selected explicitly.`,
      confidence: 'high',
    };
  }
  return automaticOccupation(draft, material);
}

function fallbackRatio(type: PseudopotentialType, accuracy: AdaptiveQeDraft['accuracy']) {
  if (type === 'USPP') return accuracy === 'Fast' ? 8 : accuracy === 'Balanced' ? 10 : 12;
  return 4;
}

function roundUpRy(value: number) {
  return Math.ceil(value - 1e-9);
}

export function resolveCutoff(draft: AdaptiveQeDraft, material: AdaptiveQeMaterial): ResolvedCutoff {
  if ((draft.cutoffPolicy ?? 'auto') === 'manual') {
    const advisories: string[] = [];
    if (draft.chargeDensityCutoff < draft.cutoff) advisories.push('ecutrho must not be lower than ecutwfc.');
    if (draft.chargeDensityCutoff < 4 * draft.cutoff) advisories.push('ecutrho is below the Quantum ESPRESSO 4× default.');
    return {
      policy: 'manual',
      ecutwfc: draft.cutoff,
      ecutrho: draft.chargeDensityCutoff,
      ratio: draft.cutoff > 0 ? draft.chargeDensityCutoff / draft.cutoff : 0,
      source: 'manual override',
      detail: 'Explicit cutoff values are preserved in every workflow stage.',
      limitingSpecies: [],
      pseudopotentialTypes: [],
      metadataComplete: false,
      advisories,
    };
  }

  const species = normalizedSpecies(material);
  const advisories: string[] = [];
  if (draft.pseudoFamily === 'SSSP efficiency' || draft.pseudoFamily === 'SSSP precision') {
    const resolved = species
      .map((element) => ({ element, recommendation: ssspRecommendation(draft.pseudoFamily as SsspFamily, element) }))
      .filter((entry): entry is { element: string; recommendation: SsspRecommendation } => Boolean(entry.recommendation));
    const missing = species.filter((element) => !ssspRecommendation(draft.pseudoFamily as SsspFamily, element));
    if (resolved.length) {
      const ecutwfc = Math.max(...resolved.map((entry) => entry.recommendation.ecutwfc), draft.cutoff > 0 && missing.length ? draft.cutoff : 0);
      const knownRho = Math.max(...resolved.map((entry) => entry.recommendation.ecutrho));
      const fallbackRho = missing.length ? Math.max(4 * ecutwfc, draft.chargeDensityCutoff) : 0;
      const ecutrho = Math.max(knownRho, fallbackRho);
      const limitingSpecies = resolved
        .filter((entry) => entry.recommendation.ecutwfc === ecutwfc || entry.recommendation.ecutrho === ecutrho)
        .map((entry) => entry.element);
      const types = Array.from(new Set(resolved.map((entry) => entry.recommendation.type)));
      if (missing.length) advisories.push(`No bundled SSSP recommendation for ${missing.join(', ')}; the manual baseline is retained for those species.`);
      if (draft.functional !== 'PBE') advisories.push(`${draft.pseudoFamily} metadata is PBE-based while input_dft is ${draft.functional}; verify pseudopotential compatibility.`);
      if (draft.assumeIsolated === '2D') advisories.push('The cell uses a 2D/vacuum correction; charge-density cutoff convergence should be checked explicitly.');
      return {
        policy: 'auto',
        ecutwfc,
        ecutrho,
        ratio: ecutwfc > 0 ? ecutrho / ecutwfc : 0,
        source: `${draft.pseudoFamily} 1.3.0 metadata`,
        detail: `${resolved.length}/${species.length || resolved.length} species resolved; the strictest library recommendation controls the shared plane-wave basis.`,
        limitingSpecies,
        pseudopotentialTypes: types,
        metadataComplete: missing.length === 0 && species.length > 0,
        advisories,
      };
    }
  }

  const assumedType: PseudopotentialType = draft.pseudoFamily === 'PseudoDojo' ? 'NC' : 'unknown';
  const ratio = fallbackRatio(assumedType, draft.accuracy);
  const ecutwfc = Math.max(1, draft.cutoff);
  const ecutrho = roundUpRy(Math.max(draft.chargeDensityCutoff, ratio * ecutwfc));
  advisories.push('No per-element cutoff metadata is available; run a cutoff-convergence study before production use.');
  if (draft.assumeIsolated === '2D') advisories.push('Vacuum systems can require a higher charge-density cutoff.');
  return {
    policy: 'auto',
    ecutwfc,
    ecutrho,
    ratio: ecutrho / ecutwfc,
    source: draft.pseudoFamily === 'PseudoDojo' ? 'PseudoDojo NC fallback' : 'conservative fallback',
    detail: `The selected wavefunction cutoff is retained and a ${ratio}× charge-density floor is applied.`,
    limitingSpecies: species,
    pseudopotentialTypes: [assumedType],
    metadataComplete: false,
    advisories,
  };
}

export function defaultPwStage(calculation: string): QePwStage {
  if (calculation === 'Structural relaxation') return 'relax';
  if (calculation === 'Band structure') return 'bands';
  if (calculation === 'Density of states') return 'nscf-dos';
  if (calculation === 'Thermoelectric properties') return 'nscf-transport';
  return 'scf';
}

export function resolveQeAdaptiveParameters(
  draft: AdaptiveQeDraft,
  material: AdaptiveQeMaterial,
  calculation: string,
  stage: QePwStage = defaultPwStage(calculation),
): ResolvedQeParameters {
  return {
    stage,
    occupation: resolveOccupation(draft, material, stage),
    cutoff: resolveCutoff(draft, material),
  };
}

export function resolveQeWorkflowParameters(
  draft: AdaptiveQeDraft,
  material: AdaptiveQeMaterial,
  calculation: string,
): ResolvedQeWorkflow {
  const stages: QePwStage[] = calculation === 'Band structure'
    ? ['scf', 'bands']
    : calculation === 'Density of states'
      ? ['scf', 'nscf-dos']
      : calculation === 'Thermoelectric properties'
        ? ['scf', 'nscf-transport']
        : calculation === 'Structural relaxation'
          ? ['relax']
          : ['scf'];
  return {
    version: 1,
    calculation,
    stages: Object.fromEntries(stages.map((stage) => [
      stage,
      resolveQeAdaptiveParameters(draft, material, calculation, stage),
    ])),
  };
}

export function occupationInputLines(resolved: ResolvedOccupation) {
  const provenance = `  ! occupation: ${resolved.source} · ${resolved.confidence}`;
  if (resolved.value === 'smearing') {
    return `${provenance}\n  occupations = 'smearing'\n  smearing = '${resolved.smearingType ?? 'marzari-vanderbilt'}'\n  degauss = ${resolved.degauss ?? 0.01}`;
  }
  return `${provenance}\n  occupations = '${resolved.value}'`;
}

export function dosIntegrationInputLines() {
  return "  ! DOS integration: optimized tetrahedra on the NSCF grid\n  bz_sum = 'tetrahedra_opt'";
}

export function applyResolvedQeSystem(input: string, resolved: ResolvedQeParameters) {
  const systemMatch = input.match(/(^|\n)([ \t]*&SYSTEM\b)([\s\S]*?)(\n[ \t]*\/)/i);
  if (!systemMatch) return input;
  let body = systemMatch[3];
  body = body
    .replace(/^\s*! occupation:.*(?:\r?\n)?/gim, '')
    .replace(/^\s*occupations\s*=.*(?:\r?\n)?/gim, '')
    .replace(/^\s*smearing\s*=.*(?:\r?\n)?/gim, '')
    .replace(/^\s*degauss\s*=.*(?:\r?\n)?/gim, '')
    .replace(/^\s*ecutwfc\s*=.*$/gim, `  ecutwfc = ${resolved.cutoff.ecutwfc}`)
    .replace(/^\s*ecutrho\s*=.*$/gim, `  ecutrho = ${resolved.cutoff.ecutrho}`);
  const updatedBody = `${body.trimEnd()}\n${occupationInputLines(resolved.occupation)}`;
  return input.replace(systemMatch[0], `${systemMatch[1]}${systemMatch[2]}${updatedBody}${systemMatch[4]}`);
}

/** Conventional SSSP / QE pseudopotential valence electron counts per element (Z_val). */
export const STANDARD_VALENCE_ELECTRONS: Readonly<Record<string, number>> = {
  H: 1, He: 2,
  Li: 3, Be: 4, B: 3, C: 4, N: 5, O: 6, F: 7, Ne: 8,
  Na: 9, Mg: 10, Al: 3, Si: 4, P: 5, S: 6, Cl: 7, Ar: 8,
  K: 9, Ca: 10, Sc: 11, Ti: 12, V: 13, Cr: 14, Mn: 15, Fe: 16, Co: 17, Ni: 18, Cu: 11, Zn: 12,
  Ga: 13, Ge: 14, As: 15, Se: 6, Br: 7, Kr: 8,
  Rb: 9, Sr: 10, Y: 11, Zr: 12, Nb: 13, Mo: 14, Tc: 15, Ru: 16, Rh: 17, Pd: 16, Ag: 11, Cd: 12,
  In: 13, Sn: 14, Sb: 15, Te: 6, I: 7, Xe: 8,
  Cs: 9, Ba: 10, La: 11, Ce: 12, Pr: 13, Nd: 14, Pm: 15, Sm: 16, Eu: 17, Gd: 18, Tb: 19, Dy: 20,
  Ho: 21, Er: 22, Tm: 23, Yb: 24, Lu: 25, Hf: 12, Ta: 13, W: 14, Re: 15, Os: 16, Ir: 17, Pt: 16,
  Au: 11, Hg: 12, Tl: 13, Pb: 14, Bi: 15, Po: 6, At: 17, Rn: 8,
  Fr: 19, Ra: 20, Ac: 11, Th: 12, Pa: 13, U: 14, Np: 15, Pu: 16, Am: 17, Cm: 18, Bk: 19, Cf: 20,
  Es: 21, Fm: 22, Md: 23, No: 24, Lr: 25,
};

export type ResolvedBands = {
  valenceElectrons: number;
  occupiedBands: number;
  recommendedNbnd: number;
  isSufficient: boolean;
  detail: string;
};

/**
 * Calculates total valence electrons, occupied Kohn-Sham states, and recommended nbnd
 * with a conduction band buffer (+20% to +30%) to prevent fatal QE crashes.
 */
export function resolveAdaptiveBands(
  draft: { numberOfBands?: number; totalCharge?: number; spin?: boolean },
  material?: {
    atoms?: Array<{ species: string }>;
    species?: string[];
  } | null,
  calculation?: string,
): ResolvedBands {
  const atoms = material?.atoms;
  let totalValence = 0;

  if (atoms && atoms.length > 0) {
    for (const atom of atoms) {
      const el = atom.species.replace(/[^A-Za-z]/g, '').slice(0, 2);
      const symbol = el.charAt(0).toUpperCase() + el.slice(1).toLowerCase();
      totalValence += STANDARD_VALENCE_ELECTRONS[symbol] ?? 4;
    }
  } else if (material?.species && material.species.length > 0) {
    for (const sp of material.species) {
      const el = sp.replace(/[^A-Za-z]/g, '').slice(0, 2);
      const symbol = el.charAt(0).toUpperCase() + el.slice(1).toLowerCase();
      totalValence += (STANDARD_VALENCE_ELECTRONS[symbol] ?? 4) * 2; // Assume at least dimer/pair
    }
  } else {
    totalValence = 16;
  }

  const netElectrons = Math.max(1, totalValence - (draft.totalCharge ?? 0));
  const occupiedBands = Math.ceil(netElectrons / 2);

  const isBandStructure = calculation === 'Band structure';
  const recommendedNbnd = isBandStructure
    ? Math.max(16, Math.ceil(occupiedBands * 1.3), occupiedBands + 8)
    : Math.max(8, Math.ceil(occupiedBands * 1.2), occupiedBands + 4);

  const currentNbnd = draft.numberOfBands ?? recommendedNbnd;
  const isSufficient = currentNbnd >= occupiedBands;

  const detail = `${netElectrons} valence e⁻ (${occupiedBands} occupied) · ${recommendedNbnd} recommended (+${Math.round(((recommendedNbnd - occupiedBands) / occupiedBands) * 100)}% buffer)`;

  return {
    valenceElectrons: netElectrons,
    occupiedBands,
    recommendedNbnd,
    isSufficient,
    detail,
  };
}

export type HubbardRecommendation = {
  species: string;
  manifold: string;
  u: number;
  source: string;
};

/** Materials Project standard effective U (U_eff = U - J) reference values (eV). */
export const STANDARD_HUBBARD_U: Readonly<Record<string, { manifold: string; u: number }>> = {
  Mn: { manifold: '3d', u: 3.9 },
  Fe: { manifold: '3d', u: 5.3 },
  Co: { manifold: '3d', u: 3.32 },
  Ni: { manifold: '3d', u: 6.2 },
  V: { manifold: '3d', u: 3.25 },
  Ti: { manifold: '3d', u: 2.58 },
  Cr: { manifold: '3d', u: 3.7 },
  Cu: { manifold: '3d', u: 4.0 },
  Mo: { manifold: '4d', u: 4.38 },
  W: { manifold: '5d', u: 4.0 },
  Ce: { manifold: '4f', u: 4.5 },
  U: { manifold: '5f', u: 4.0 },
};

/**
 * Returns recommended Hubbard U corrections for any transition metal or rare-earth
 * species present in the material.
 */
export function recommendedHubbardCorrections(species: string[]): HubbardRecommendation[] {
  const recommendations: HubbardRecommendation[] = [];
  for (const item of species) {
    const el = item.replace(/[^A-Za-z]/g, '').slice(0, 2);
    const symbol = el.charAt(0).toUpperCase() + el.slice(1).toLowerCase();
    const standard = STANDARD_HUBBARD_U[symbol];
    if (standard) {
      recommendations.push({
        species: item,
        manifold: standard.manifold,
        u: standard.u,
        source: 'Materials Project',
      });
    }
  }
  return recommendations;
}

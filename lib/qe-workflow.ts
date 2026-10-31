import type { CalculationType, JobDraft, MaterialContext } from '../components/JobComposer.tsx';
import { applyResolvedQeSystem, defaultPwStage, dosIntegrationInputLines, occupationInputLines, resolveQeAdaptiveParameters, type QePwStage } from './qe-adaptive.ts';
import { hubbardInputCard, spinInputLines, qeMethodIssue, supportedTransportSettings } from './qe-input.ts';
import { resolveQeStructure, qeStructureProvenance } from './qe-structure.ts';
import { atomicMass } from './qe-atomic-masses.ts';
import { formatQeKPointsCrystalB } from './reciprocal-path.ts';

import { resolveSlabDipole } from './qe-dipole.ts';

const qeBoolean = (value: boolean) => value ? '.true.' : '.false.';

function calculationKeyword(calculation: CalculationType, draft: JobDraft) {
  if (calculation === 'Structural relaxation') return draft.relaxCell ? 'vc-relax' : 'relax';
  if (calculation === 'Band structure') return 'bands';
  if (calculation === 'Density of states') return 'nscf';
  if (calculation === 'Thermoelectric properties') return 'nscf';
  return 'scf';
}

function bandProjectionInput(draft: JobDraft) {
  return `&PROJWFC\n  prefix = '${draft.prefix}'\n  outdir = '${draft.outdir}'\n  filpdos = '${draft.prefix}.band-projections'\n  lsym = .false.\n  kresolveddos = .true.\n  diag_basis = .false.\n  pawproj = .false.\n  degauss = 0.01\n/`;
}

function generatedAuxiliaryInput(draft: JobDraft, calculation: CalculationType) {
  return calculation === 'Band structure' ? `

! ---------- bands.x ----------
&BANDS
  prefix = '${draft.prefix}'
  outdir = '${draft.outdir}'
  filband = '${draft.prefix}.bands.dat'
  lsym = ${qeBoolean(draft.bandSymmetry)}
  no_overlap = ${qeBoolean(!draft.bandOverlap)}
/
${draft.projectedBands ? '! ---------- projwfc.x ----------\n' + bandProjectionInput(draft) + '\n' : ''}` : calculation === 'Density of states' ? `

! ---------- dos.x ----------
&DOS
  prefix = '${draft.prefix}'
  outdir = '${draft.outdir}'
  fildos = '${draft.prefix}.dos.dat'
${dosIntegrationInputLines()}
  Emin = ${draft.dosEnergyMin}
  Emax = ${draft.dosEnergyMax}
  DeltaE = ${draft.dosEnergyStep}
/
${draft.projectedDos ? `
! ---------- projwfc.x ----------
&PROJWFC
  prefix = '${draft.prefix}'
  outdir = '${draft.outdir}'
  filpdos = '${draft.prefix}.pdos'
  Emin = ${draft.dosEnergyMin}
  Emax = ${draft.dosEnergyMax}
  DeltaE = ${draft.dosEnergyStep}
  lsym = ${qeBoolean(draft.dosSymmetrize)}
  pawproj = ${qeBoolean(draft.pawProjection)}
/
` : ''}` : calculation === 'Thermoelectric properties' ? `

! ---------- QE + BoltzTraP2 transport workflow ----------
! 1. Run this dense NSCF calculation and export eigenvalues as BoltzTraP2 GENE data.
! 2. Interpolate the bands:
!    btp2 interpolate -m ${draft.transportInterpolationMultiplier} ./gene
! 3. Integrate the interpolated bands across temperature and chemical potential.
! temperature_K = ${draft.transportTemperatureMin}:${draft.transportTemperatureStep}:${draft.transportTemperatureMax}
! chemical_potential_window_eV = ${draft.transportChemicalPotentialMin}:${draft.transportChemicalPotentialMax}
! chemical_potential_sampling = BoltzTraP2 native energy-bin grid (no imposed mu step or doping sweep)
! scattering_model = '${draft.transportScatteringModel}'
! relaxation_time_fs = ${draft.transportRelaxationTime}
! energy_bins = ${draft.transportEnergyBins}
! outputs = Seebeck, sigma/tau, kappa_e/tau, Hall coefficient, power factor
` : calculation === 'Phonon dispersion' ? `

! ---------- ph.x ----------
&INPUTPH
  prefix = '${draft.prefix}'
  outdir = '${draft.outdir}'
  fildyn = '${draft.prefix}.dyn'
  tr2_ph = ${draft.phononThreshold}
  niter_ph = ${draft.phononIterations}
  alpha_mix(1) = ${draft.phononMixing}
  nmix_ph = ${draft.phononMixingNdim}
  ldisp = .true.
  nq1 = ${draft.qPoint}
  nq2 = ${draft.qPointY}
  nq3 = ${draft.qPointZ}
  epsil = ${qeBoolean(draft.dielectricTensor)}
  zeu = ${qeBoolean(draft.effectiveCharges)}
  electron_phonon = '${draft.electronPhonon}'
/

! q2r.x -> matdyn.x
&INPUT
  flfrc = '${draft.prefix}.fc'
  asr = '${draft.phononAsr === 'none' ? 'no' : draft.phononAsr}'
  q_in_band_form = .true.
  q_in_cryst_coord = .true.
/
` : '';
}

export function generateQuantumEspressoInput(
  draft: JobDraft,
  calculation: CalculationType,
  material: MaterialContext,
  stage: QePwStage = defaultPwStage(calculation),
) {
  if (!material) return '! Select a crystal structure to generate Quantum ESPRESSO input.';
  try {
    material = resolveQeStructure(draft, material);
    const issue = qeMethodIssue(draft, calculation);
    if (issue) throw new Error(issue);
    resolveSlabDipole(draft, material);
    if (draft.dipoleCorrection && calculation === 'Structural relaxation' && draft.relaxCell && draft.cellDoFree !== '2Dxy') throw new Error('Dipole correction requires a fixed vacuum axis. Use fixed-cell relaxation or cell_dofree = 2Dxy.');
    if (draft.dipoleCorrection && calculation === 'Phonon dispersion') throw new Error('Slab dipole correction is not supported by this DFPT workflow.');
  } catch (error) {
    return `! Cannot generate input: ${error instanceof Error ? error.message : String(error)}`;
  }
  const keyword = calculationKeyword(calculation, draft);
  const resolved = resolveQeAdaptiveParameters(draft, material, calculation, stage);
  const atomicPositions = material.atoms;
  const structureSpecies = Array.from(new Map(atomicPositions.map((atom) => [atom.label ?? atom.species, atom.species])).entries());
  const shift = draft.kPointShift.split(' ').join(' ');
  let spinLines: string;
  let hubbardCard: string;
  try {
    spinLines = spinInputLines(draft, structureSpecies.map(([label]) => label));
    hubbardCard = hubbardInputCard(draft, structureSpecies.map(([label]) => label));
  } catch (error) {
    return `! Cannot generate input: ${error instanceof Error ? error.message : String(error)}`;
  }
  const occupationLines = occupationInputLines(resolved.occupation);
  const fftLines = draft.fftGridMode === 'manual' ? `\n  nr1 = ${draft.nr1}\n  nr2 = ${draft.nr2}\n  nr3 = ${draft.nr3}` : '';
  const hybridLines = draft.functional === 'HSE' ? `\n  exx_fraction = ${draft.exxFraction}` : '';
  const vdwLines = draft.vdwCorrection === 'dft-d3-bj'
    ? "\n  vdw_corr = 'dft-d3'\n  dftd3_version = 4"
    : `\n  vdw_corr = '${draft.vdwCorrection}'`;
  const dipole = resolveSlabDipole(draft, material);
  const dipoleControl = dipole ? '\n  tefield = .true.\n  dipfield = .true.' : '';
  const dipoleSystem = dipole ? `\n  edir = 3\n  emaxpos = ${dipole.position}\n  eopreg = ${dipole.region}\n  eamp = ${dipole.amplitude}` : '';
  const isolatedLine = draft.assumeIsolated === 'none' ? '' : `\n  assume_isolated = '${draft.assumeIsolated}'`;
  const relaxationControl = calculation === 'Structural relaxation'
    ? `\n  nstep = ${draft.nstep}\n  etot_conv_thr = ${draft.energyThreshold}\n  forc_conv_thr = ${draft.forceThreshold}`
    : '';
  const ions = calculation === 'Structural relaxation' ? `
&IONS
  ion_dynamics = '${draft.ionDynamics}'
  pot_extrapolation = '${draft.potentialExtrapolation}'
  wfc_extrapolation = '${draft.wavefunctionExtrapolation}'
  remove_rigid_rot = ${qeBoolean(draft.removeRigidRotation)}
  refold_pos = ${qeBoolean(draft.refoldPositions)}
  trust_radius_ini = ${draft.trustRadius}
/
${draft.relaxCell ? `&CELL
  cell_dynamics = '${draft.cellDynamics}'
  press = ${draft.targetPressure}
  press_conv_thr = ${draft.pressureThreshold}
  cell_dofree = '${draft.cellDoFree}'
  cell_factor = ${draft.cellFactor}
/
` : ''}` : '';
  const species = structureSpecies.map(([label, element]) => {
    const family = draft.pseudoFamily.toLowerCase().replace(/\s+/g, '-');
    return `${label}  ${atomicMass(element, draft.atomicMassOverrides?.[label]).toFixed(8)}  ${element}.${draft.functional.toLowerCase()}.${family}.upf`;
  }).join('\n');
  const atoms = atomicPositions.map((atom) => `${(atom.label ?? atom.species).padEnd(8)} ${atom.x.toFixed(10)} ${atom.y.toFixed(10)} ${atom.z.toFixed(10)}`).join('\n');
  const vectors = material.cellVectors.map((vector) => vector.map((value) => value.toFixed(10)).join(' ')).join('\n');
  const kPoints = calculation === 'Band structure'
    ? formatQeKPointsCrystalB(draft, material)
    : `K_POINTS automatic\n${draft.kPoint} ${draft.kPointY} ${draft.kPointZ} ${shift}`;
  const postProcessing = generatedAuxiliaryInput(draft, calculation);

  return `! Quantum ESPRESSO ${draft.qeVersion} · generated by DFT Lab
! ${material.databaseName} / ${material.name} / ${calculation}
! resolved stage: ${stage}
! cutoff source: ${resolved.cutoff.source}${resolved.cutoff.limitingSpecies.length ? ` · limiting species ${resolved.cutoff.limitingSpecies.join(', ')}` : ''}
&CONTROL
  calculation = '${keyword}'
  title = '${draft.title}'
  prefix = '${draft.prefix}'
  outdir = '${draft.outdir}'
  pseudo_dir = '${draft.pseudoDir}'
  restart_mode = '${draft.restartMode}'
  verbosity = '${draft.verbosity}'
  disk_io = '${draft.diskIO}'
  tstress = ${qeBoolean(draft.printStress)}
  tprnfor = ${qeBoolean(draft.printForces)}
  max_seconds = ${draft.maxSeconds}${relaxationControl}${dipoleControl}
/
&SYSTEM
  ibrav = 0
  nat = ${atomicPositions.length}
  ntyp = ${structureSpecies.length}
  input_dft = '${draft.functional}'
  ecutwfc = ${resolved.cutoff.ecutwfc}
  ecutrho = ${resolved.cutoff.ecutrho}
  nbnd = ${draft.numberOfBands}
  tot_charge = ${draft.totalCharge}
${occupationLines}
${spinLines}
  nosym = ${qeBoolean(!draft.useSymmetry)}
  noinv = ${qeBoolean(!draft.useInversion)}${vdwLines}${hybridLines}${isolatedLine}${dipoleSystem}${fftLines}
/
&ELECTRONS
  electron_maxstep = ${draft.electronMaxSteps}
  scf_must_converge = ${qeBoolean(draft.scfMustConverge)}
  conv_thr = ${draft.scfThreshold}
  mixing_mode = '${draft.mixingMode}'
  mixing_beta = ${draft.mixingBeta}
  mixing_ndim = ${draft.mixingNdim}
  diagonalization = '${draft.diagonalization}'
  diago_thr_init = ${draft.diagonalizationThreshold}
  diago_full_acc = ${qeBoolean(draft.diagoFullAccuracy)}
  startingpot = '${draft.startingPotential}'
  startingwfc = '${draft.startingWavefunctions}'
  real_space = ${qeBoolean(draft.realSpace)}
/
${ions}ATOMIC_SPECIES
${species}

ATOMIC_POSITIONS crystal
${atoms}

CELL_PARAMETERS angstrom
${vectors}

${hubbardCard ? `${hubbardCard}\n\n` : ''}${kPoints}${postProcessing}`;
}

export type QuantumEspressoInputFile = {
  name: string;
  content: string;
};

function completeInputFile(content: string) {
  return `${content.trim()}\n`;
}

function extractNamelist(input: string, name: string) {
  const match = input.match(new RegExp(`(?:^|\\n)\\s*&${name}\\b[\\s\\S]*?\\n\\s*\\/\\s*(?=\\n|$)`, 'i'));
  return match?.[0]?.trim() ?? null;
}

function extractPwInput(input: string) {
  const auxiliaryStart = input.search(/\n(?:\s*!\s*-+\s*(?:bands\.x|dos\.x|projwfc\.x|ph\.x|QE\s*\+)|\s*!\s*q2r\.x|\s*&(BANDS|DOS|PROJWFC|INPUTPH)\b)/i);
  return (auxiliaryStart >= 0 ? input.slice(0, auxiliaryStart) : input).trim();
}

function setPwCalculation(input: string, calculation: 'scf' | 'nscf' | 'bands') {
  let updated: string;
  if (/\bcalculation\s*=\s*['"][^'"]+['"]/i.test(input)) {
    updated = input.replace(/\bcalculation\s*=\s*['"][^'"]+['"]/i, `calculation = '${calculation}'`);
  } else {
    updated = input.replace(/&CONTROL\b/i, `&CONTROL\n  calculation = '${calculation}'`);
  }
  if (calculation !== 'scf') {
    updated = updated.replace(
      /^[ \t]*startingpot[ \t]*=[ \t]*['"][^'"]*['"][ \t]*,?/im,
      "  startingpot = 'file'",
    );
  }
  return updated;
}

function replaceWithAutomaticKGrid(input: string, draft: JobDraft, shift = draft.kPointShift) {
  const automaticGrid = `K_POINTS automatic\n${draft.kPoint} ${draft.kPointY} ${draft.kPointZ} ${shift}`;
  if (/\n\s*K_POINTS\b/i.test(input)) {
    return input.replace(/\n[ \t]*K_POINTS[^\n]*\n[\s\S]*?(?=\n[ \t]*(?:ATOMIC_SPECIES|ATOMIC_POSITIONS|CELL_PARAMETERS|HUBBARD|CONSTRAINTS|OCCUPATIONS|ATOMIC_FORCES|ATOMIC_VELOCITIES)\b|$)/i, `\n\n${automaticGrid}`);
  }
  return `${input.trim()}\n\n${automaticGrid}`;
}

function generatedNamelist(input: string, fallbackInput: string, name: string) {
  return extractNamelist(input, name) ?? extractNamelist(fallbackInput, name);
}

/**
 * Builds the runnable input-file set from the component's persisted draft.
 * rawInput is the expert-mode source of truth when present, so user-authored
 * variables are retained while workflow-specific files are separated.
 */
export function generateQuantumEspressoInputFiles(
  draft: JobDraft,
  calculation: CalculationType,
  material: MaterialContext,
): QuantumEspressoInputFile[] {
  const methodIssue = qeMethodIssue(draft, calculation, Boolean(draft.rawInput.trim()));
  if (methodIssue) throw new Error(methodIssue);
  if (!draft.rawInput.trim()) {
    material = resolveQeStructure(draft, material);
    hubbardInputCard(draft, Array.from(new Set(material!.atoms.map((atom) => atom.label ?? atom.species))));
  }
  // Do not resolve cards twice: the generator receives the original material and draft.
  const generatedInput = generateQuantumEspressoInput({ ...draft, cellParameters: undefined, atomicPositions: undefined, rawInput: '', ...(draft.rawInput.trim() ? { dftU: false, magnetizationConstraint: 'unconstrained' as const, atomicMassOverrides: undefined } : {}) }, calculation, material);
  if (!draft.rawInput.trim() && generatedInput.startsWith('! Cannot generate input:')) throw new Error(generatedInput.slice('! Cannot generate input:'.length).trim());
  const configuredInput = draft.rawInput.trim() || generatedInput;
  const auxiliaryFallback = draft.rawInput.trim() ? generatedAuxiliaryInput(draft, calculation) : generatedInput;
  const pwInput = extractPwInput(configuredInput);
  const applyStage = (input: string, stage: QePwStage) => draft.rawInput.trim()
    ? input
    : applyResolvedQeSystem(input, resolveQeAdaptiveParameters(draft, material, calculation, stage));

  if (calculation === 'Band structure') {
    if (draft.projectedBands && draft.diskIO === 'none') throw new Error('Projected bands require stored wavefunctions. Select disk_io=low or higher before running projwfc.x.');
    const bandsInput = generatedNamelist(configuredInput, auxiliaryFallback, 'BANDS');
    if (!bandsInput) throw new Error('No bands.x namelist is available for this workflow.');
    return [
      { name: 'scf.in', content: completeInputFile(applyStage(replaceWithAutomaticKGrid(setPwCalculation(pwInput, 'scf'), draft), 'scf')) },
      { name: 'nscfbands.in', content: completeInputFile(applyStage(setPwCalculation(pwInput, 'bands'), 'bands')) },
      { name: 'bands.in', content: completeInputFile(bandsInput) },
      ...(draft.projectedBands ? [{ name: 'projwfc.in', content: completeInputFile(generatedNamelist(configuredInput, auxiliaryFallback, 'PROJWFC') ?? bandProjectionInput(draft)) }] : []),
    ];
  }

  if (calculation === 'Density of states') {
    const files: QuantumEspressoInputFile[] = [
      { name: 'scf.in', content: completeInputFile(applyStage(setPwCalculation(pwInput, 'scf'), 'scf')) },
      { name: 'nscfdos.in', content: completeInputFile(applyStage(replaceWithAutomaticKGrid(setPwCalculation(pwInput, 'nscf'), draft, '0 0 0'), 'nscf-dos')) },
    ];
    const dosInput = generatedNamelist(configuredInput, auxiliaryFallback, 'DOS');
    const projectedDosInput = generatedNamelist(configuredInput, auxiliaryFallback, 'PROJWFC');
    if (dosInput) files.push({ name: 'dos.in', content: completeInputFile(dosInput) });
    if (draft.projectedDos && projectedDosInput) files.push({ name: 'projwfc.in', content: completeInputFile(projectedDosInput) });
    return files;
  }

  if (calculation === 'Phonon dispersion') {
    const phononInput = generatedNamelist(configuredInput, auxiliaryFallback, 'INPUTPH');
    if (!phononInput) throw new Error('No ph.x namelist is available for this workflow.');
    const asr = draft.phononAsr === 'none' ? 'no' : draft.phononAsr;
    const qPointsBlock = formatQeKPointsCrystalB(draft, material);
    const qPath = qPointsBlock.replace(/^K_POINTS\s+crystal_b\s*\n/i, '');
    return [
      { name: 'scf.in', content: completeInputFile(applyStage(setPwCalculation(pwInput, 'scf'), 'scf')) },
      { name: 'ph.in', content: completeInputFile(phononInput) },
      { name: 'q2r.in', content: completeInputFile(`&INPUT\n  fildyn = '${draft.prefix}.dyn'\n  zasr = '${asr}'\n  flfrc = '${draft.prefix}.fc'\n/`) },
      { name: 'matdyn.in', content: completeInputFile(`&INPUT\n  flfrc = '${draft.prefix}.fc'\n  flfrq = '${draft.prefix}.freq'\n  asr = '${asr}'\n  q_in_band_form = .true.\n  q_in_cryst_coord = .true.\n/\n${qPath}`) },
    ];
  }

  if (calculation === 'Thermoelectric properties') {
    return [
      { name: 'scf.in', content: completeInputFile(applyStage(setPwCalculation(pwInput, 'scf'), 'scf')) },
      { name: 'nscftransport.in', content: completeInputFile(applyStage(setPwCalculation(pwInput, 'nscf'), 'nscf-transport')) },
    ];
  }

  const filename = calculation === 'Structural relaxation'
    ? draft.relaxCell ? 'vcrelax.in' : 'relax.in'
    : 'scf.in';
  return [{ name: filename, content: completeInputFile(configuredInput) }];
}

export function summarizeJobDraft(draft: JobDraft, calculation: CalculationType, material?: MaterialContext) {
  const resolved = material ? resolveQeAdaptiveParameters(draft, material, calculation) : null;
  const ecutwfc = resolved?.cutoff.ecutwfc ?? draft.cutoff;
  const ecutrho = resolved?.cutoff.ecutrho ?? draft.chargeDensityCutoff;
  const occupations = resolved?.occupation.value ?? draft.occupations;
  const base = `${draft.functional} · ${draft.kPoint}×${draft.kPointY}×${draft.kPointZ} k-grid · ${ecutwfc}/${ecutrho} Ry · ${occupations}`;
  const specific = calculation === 'Band structure'
    ? `${draft.kPathPoints} pts/segment · ${draft.numberOfBands} bands`
    : calculation === 'Density of states'
      ? `${draft.dosEnergyMin}:${draft.dosEnergyMax} eV · optimized tetrahedra`
      : calculation === 'Structural relaxation'
        ? `${draft.relaxCell ? 'cell + ions' : 'ions only'} · ${draft.forceThreshold} Ry/Bohr`
        : calculation === 'Phonon dispersion'
          ? `${draft.qPoint}×${draft.qPointY}×${draft.qPointZ} q-grid · tr2 ${draft.phononThreshold}`
          : calculation === 'Thermoelectric properties'
            ? `${draft.transportTemperatureMin}–${draft.transportTemperatureMax} K · ${draft.transportInterpolationMultiplier}× interpolation · τ ${draft.transportRelaxationTime} fs`
          : `SCF ${draft.scfThreshold} · ${draft.electronMaxSteps} steps`;
  return `${base} · ${specific}${draft.spin ? ' · spin' : ''}${draft.soc ? ' · SOC' : ''}`;
}

export function qeSubmissionSettings(draft: JobDraft, calculation: CalculationType, material: MaterialContext) {
  const settings = calculation === 'Thermoelectric properties' ? supportedTransportSettings(draft) : { ...draft };
  // Legacy drafts may retain this phonon-DOS setting; dispersion does not use it.
  if (calculation === 'Phonon dispersion') delete (settings as Record<string, unknown>).matdynDeltaE;
  const result = { ...settings, ...(material?.geometryProvenance ? { geometryProvenance: material.geometryProvenance } : {}), submittedStructure: draft.rawInput.trim()
    ? { version: 1, source: 'expert-raw-input', detail: 'The retained pw.x input defines the structure; project geometry is a reference.' }
    : qeStructureProvenance(draft, material), ...(!draft.rawInput.trim() && draft.dipoleCorrection ? { dipolePlacementEvidence: resolveSlabDipole(draft, resolveQeStructure(draft, material)) } : {}) };
  return result as typeof result & Record<string, unknown>;
}


/** A readable summary is insufficient to identify a reusable execution. */
export function qeExecutionIdentity(draft: JobDraft, calculation: CalculationType, material: MaterialContext, sourceIdentity: unknown = null) {
  try {
    const settings: Record<string, unknown> = { ...qeSubmissionSettings(draft, calculation, material) };
    for (const field of ['plotXMin', 'plotXMax', 'plotYMin', 'plotYMax', 'calculations']) delete settings[field];
    return JSON.stringify({ version: 1, calculation, inputFiles: generateQuantumEspressoInputFiles(draft, calculation, material), settings, sourceIdentity });
  } catch { return null; }
}

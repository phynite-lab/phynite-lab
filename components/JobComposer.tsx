'use client';

import { qeIonDynamicsOptions } from '@/lib/qe-input';

import {
  BarChart3,
  Braces,
  ChartSpline,
  Check,
  Clipboard,
  Database,
  ChevronDown,
  ChevronRight,
  Gauge,
  Play,
  RotateCcw,
  Save,
  Search,
  Settings2,
  ThermometerSun,
  Waves,
  X,
  type LucideIcon,
} from 'lucide-react';
import { generateQuantumEspressoInput, summarizeJobDraft } from '@/lib/qe-workflow';
export { generateQuantumEspressoInput, generateQuantumEspressoInputFiles, summarizeJobDraft } from '@/lib/qe-workflow';
export type { QuantumEspressoInputFile } from '@/lib/qe-workflow';
import {
  type CutoffPolicy,
  type ElectronicReference,
  type OccupationPolicy,
  type QeOccupation,
  type QeSmearing,
} from '@/lib/qe-adaptive';
import { QeMethodFields, TransportSamplingNotice } from '@/components/QeMethodFields';
import { useState } from 'react';
import { UiSelect, type UiSelectOption } from '@/components/UiSelect';
import { CommittedNumberInput } from '@/components/CommittedNumberInput';
import { LabSwitch } from '@/components/LabControls';
import type { ReciprocalPathMode } from '@/lib/reciprocal-path';
import type { ScientificPlotSettings } from '@/lib/result-plot';
import { cn } from '@/lib/utils';

export type Accuracy = 'Fast' | 'Balanced' | 'High accuracy';
export type Functional = 'PBE' | 'LDA' | 'HSE';
export type CalculationType = 'Nudged elastic band' | 'Total energy' | 'Structural relaxation' | 'Band structure' | 'Density of states' | 'Phonon dispersion' | 'Thermoelectric properties';
export type JobStatus = 'Draft' | 'Completed' | 'Running' | 'Queued' | 'Failed' | 'Cancelled';
export type CellParameterUnit = 'angstrom' | 'bohr' | 'alat';
export type AtomicPositionUnit = 'crystal' | 'angstrom' | 'bohr' | 'alat' | 'crystal_sg';
export type StructureAtomInput = { species: string; label?: string; id?: string; occupancy?: number; siteSpecies?: Array<{ element: string; species: string; occupancy: number }>; x: number; y: number; z: number };

export type JobDraft = {
  calculations: CalculationType[];
  accuracy: Accuracy;
  functional: Functional;
  kPoint: number;
  cutoff: number;
  chargeDensityCutoff: number;
  occupationPolicy: OccupationPolicy;
  occupations: QeOccupation;
  smearingType: QeSmearing;
  smearing: number;
  cutoffPolicy: CutoffPolicy;
  spin: boolean;
  startingMagnetization: number;
  startingMagnetizations?: Record<string, number>;
  magnetizationConstraint?: 'unconstrained' | 'total';
  soc: boolean;
  noncollinear: boolean;
  kPath: string;
  kPathMode?: ReciprocalPathMode;
  kPathPoints: number;
  numberOfBands: number;
  relaxCell: boolean;
  ionDynamics: 'bfgs' | 'damp' | 'fire';
  forceThreshold: number;
  targetPressure: number;
  qPoint: number;
  phononThreshold: number;
  acousticSumRule: boolean;
  scfThreshold: number;
  electronMaxSteps: number;
  mixingBeta: number;
  dosEnergyMin: number;
  dosEnergyMax: number;
  dosEnergyStep: number;
  projectedDos: boolean;
  projectedBands?: boolean;
  prefix: string;
  restartMode: 'from_scratch' | 'restart';
  verbosity: 'low' | 'high';
  diskIO: 'none' | 'low' | 'medium' | 'high';
  maxSeconds: number;
  pseudoFamily: 'SSSP efficiency' | 'SSSP precision' | 'PseudoDojo';
  kPointShift: '0 0 0' | '1 1 1' | '1 0 0' | '0 1 0' | '0 0 1';
  totalCharge: number;
  useSymmetry: boolean;
  useInversion: boolean;
  vdwCorrection: 'none' | 'dft-d3' | 'dft-d3-bj' | 'ts-vdw';
  mixingMode: 'plain' | 'TF' | 'local-TF';
  mixingNdim: number;
  diagonalization: 'david' | 'cg' | 'rmm-davidson';
  diagonalizationThreshold: number;
  scfMustConverge: boolean;
  exxFraction: number;
  dftU: boolean;
  hubbardU: number;
  hubbardProjector?: 'atomic' | 'ortho-atomic' | 'norm-atomic';
  hubbardCorrections?: Array<{ species: string; manifold: string; u: number }>;
  atomicMassOverrides?: Record<string, number>;
  energyThreshold: number;
  cellDynamics: 'bfgs' | 'damp-pr' | 'damp-w';
  cellDoFree: 'all' | 'ibrav' | 'shape' | 'volume' | '2Dxy';
  pressureThreshold: number;
  trustRadius: number;
  bandSymmetry: boolean;
  bandOverlap: boolean;
  firstBand: number;
  lastBand: number;
  dosBroadening: number;
  dosNgauss: number;
  dosSymmetrize: boolean;
  pawProjection: boolean;
  phononIterations: number;
  phononMixing: number;
  phononMixingNdim: number;
  dielectricTensor: boolean;
  effectiveCharges: boolean;
  phononAsr: 'none' | 'simple' | 'crystal' | 'all';
  electronPhonon: 'none' | 'simple' | 'lambda_tetra';
  qeVersion: '7.5';
  rawInput: string;
  title: string;
  outdir: string;
  pseudoDir: string;
  nstep: number;
  printForces: boolean;
  printStress: boolean;
  kPointY: number;
  kPointZ: number;
  fftGridMode: 'automatic' | 'manual';
  nr1: number;
  nr2: number;
  nr3: number;
  totalMagnetization: number;
  dipoleCorrection?: boolean;
  dipolePlacement?: 'automatic' | 'manual';
  dipolePosition?: number;
  dipoleRegion?: number;
  electricFieldAmplitude?: number;
  assumeIsolated: 'none' | 'esm' | '2D' | 'makov-payne' | 'martyna-tuckerman';
  startingPotential: 'atomic' | 'file';
  startingWavefunctions: 'atomic+random' | 'random' | 'file';
  realSpace: boolean;
  diagoFullAccuracy: boolean;
  potentialExtrapolation: 'atomic' | 'first_order' | 'second_order';
  wavefunctionExtrapolation: 'none' | 'first_order' | 'second_order';
  removeRigidRotation: boolean;
  refoldPositions: boolean;
  cellFactor: number;
  qPointY: number;
  qPointZ: number;
  matdynDeltaE: number;
  transportInterpolationMultiplier: number;
  transportTemperatureMin: number;
  transportTemperatureMax: number;
  transportTemperatureStep: number;
  transportChemicalPotentialMin: number;
  transportChemicalPotentialMax: number;
  transportChemicalPotentialStep?: number;
  transportSampling?: 'chemical-potential';
  transportScatteringModel: 'constant-relaxation-time' | 'constant-mean-free-path';
  transportRelaxationTime: number;
  transportDopingMin?: number;
  transportDopingMax?: number;
  transportDopingPoints?: number;
  transportEnergyBins: number;
  /** Optional scientific-plot viewport. Undefined keeps the data-driven range. */
  plotXMin?: number;
  plotXMax?: number;
  plotYMin?: number;
  plotYMax?: number;
  /** Calculation-local structure cards; resolved together for preview and submission. */
  cellParameterUnit?: CellParameterUnit;
  cellParameterAlat?: number;
  cellParameters?: Array<[number, number, number]>;
  atomicPositionUnit?: AtomicPositionUnit;
  atomicPositions?: StructureAtomInput[];
};

export type CalculationConfiguration = {
  id: string;
  name: string;
  calculation: CalculationType;
  databaseId: string;
  databaseName: string;
  materialId: string;
  materialName: string;
  updated: string;
  draft: JobDraft;
};

export type CalculationJob = {
  computeResources?: import('@/lib/compute-resources').ComputeResources;
  id: string;
  componentId?: string;
  calculationType?: string;
  relaxationConverged?: boolean;
  scientificAccepted?: boolean;
  materialId?: string;
  name: string;
  status: JobStatus;
  settings: string;
  updated: string;
  progress?: number;
  startedAt?: string;
  completedAt?: string;
  duration?: string;
  result?: string;
  resultDetail?: string;
  liveLogTail?: string;
  scfConvergence?: import('../lib/qe-live-scf').ScfConvergence;
  cancelRequested?: boolean;
  outputFiles?: string;
  backendCalculationId?: string;
  artifactsExpireAt?: string;
  artifactsExpired?: boolean;
  plotSettings?: ScientificPlotSettings;
  structureSourceId?: 'original' | string;
  structureSourceCalculationId?: string;
  referenceElectronicFingerprint?: string;
  referenceExecutionFingerprint?: string;
  referenceFunctional?: JobDraft['functional'];
  referencePseudoFamily?: JobDraft['pseudoFamily'];
  referenceSpin?: boolean;
  referenceSoc?: boolean;
  referenceNoncollinear?: boolean;
  referenceStartingMagnetization?: number;
  referenceTotalMagnetization?: number;
  referenceDftU?: boolean;
  referenceHubbardU?: number;
  referenceVdwCorrection?: JobDraft['vdwCorrection'];
  referenceTotalCharge?: number;
  referenceMaterialUpdatedAt?: string;
  resultArtifacts?: Array<{
    path: string;
    label: string;
    role: string;
    contentType: string;
    viewUrl?: string;
    downloadUrl: string;
  }>;
};

export type MaterialContext = {
  name: string;
  formula: string;
  databaseName: string;
  projectName?: string;
  spaceGroup?: string;
  atomCount: number;
  species: string[];
  atoms: Array<{ species: string; label?: string; id?: string; x: number; y: number; z: number; occupancy?: number; siteSpecies?: Array<{ element: string; species: string; occupancy: number }> }>;
  cellVectors: Array<[number, number, number]>;
  periodic?: [boolean, boolean, boolean];
  geometryProvenance?: unknown[];
  electronicReference?: ElectronicReference;
} | null;

const calculations: Array<{
  id: CalculationType;
  label: string;
  detail: string;
  icon: LucideIcon;
}> = [
  { id: 'Total energy', label: 'Total energy', detail: 'SCF ground state', icon: Gauge },
  { id: 'Structural relaxation', label: 'Structural relaxation', detail: 'Optimize ions and cell', icon: RotateCcw },
  { id: 'Band structure', label: 'Band structure', detail: 'Electronic dispersion', icon: ChartSpline },
  { id: 'Density of states', label: 'Density of states', detail: 'DOS and projected DOS', icon: BarChart3 },
  { id: 'Phonon dispersion', label: 'Phonon dispersion', detail: 'Lattice dynamics', icon: Waves },
  { id: 'Thermoelectric properties', label: 'Thermoelectric properties', detail: 'Boltzmann transport with BoltzTraP2', icon: ThermometerSun },
];

const accuracyMeta: Record<Accuracy, { runtime: string }> = {
  Fast: { runtime: '~8 min each' },
  Balanced: { runtime: '~30 min each' },
  'High accuracy': { runtime: '~2 hr each' },
};


function calculationMatches(name: string, calculation: CalculationType) {
  const normalized = name.toLowerCase();
  if (calculation === 'Total energy') return normalized.includes('total') || normalized.includes('scf');
  if (calculation === 'Structural relaxation') return normalized.includes('relax');
  if (calculation === 'Band structure') return normalized.includes('band');
  if (calculation === 'Density of states') return normalized.includes('density') || normalized.includes('dos');
  if (calculation === 'Thermoelectric properties') return normalized.includes('thermo') || normalized.includes('transport') || normalized.includes('boltz');
  return normalized.includes('phonon');
}

function SettingToggle({ label, detail, checked, onChange }: { label: string; detail: string; checked: boolean; onChange: () => void }) {
  return (
    <LabSwitch checked={checked} onCheckedChange={onChange} aria-label={label} className="py-2 text-left">
      <span className="block min-w-0">
        <span className="block text-[11px] font-medium text-[var(--panel-text)]">{label}</span>
        <span className="mt-0.5 block text-[10px] leading-3.5 text-[var(--panel-muted)]">{detail}</span>
      </span>
    </LabSwitch>
  );
}

function NumberField({ label, value, unit, min, max, step = 1, onChange }: { label: string; value: number; unit?: string; min?: number; max?: number; step?: number; onChange: (value: number) => void }) {
  return (
    <label className="block text-[10px] text-[#7f8994]">
      {label}
      <span className="mt-1 flex h-8 items-center rounded-[4px] border border-[#d9dee4] bg-white focus-within:border-[var(--field-focus-border)]">
        <CommittedNumberInput value={value} min={min} max={max} step={step} onCommit={onChange} className="min-w-0 flex-1 bg-transparent px-2 font-mono text-[11px] text-[#414b56] outline-none" />
        {unit && <span className="pr-2 font-mono text-[9px] text-[#98a1aa]">{unit}</span>}
      </span>
    </label>
  );
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: UiSelectOption[]; onChange: (value: string) => void }) {
  return <UiSelect label={label} value={value} options={options} onChange={onChange} />;
}

type LifecycleStatus = JobStatus | 'Not configured' | 'Ready';

function StatusBadge({ status }: { status: LifecycleStatus }) {
  const shownStatus = status === 'Draft' ? 'Ready' : status;
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap text-[10px] font-medium', (status === 'Draft' || status === 'Ready') && 'text-[#4b5563]', status === 'Not configured' && 'text-[#9aa3ac]', status === 'Completed' && 'text-[#3f8359]', status === 'Running' && 'text-[var(--panel-text,var(--ink))] font-semibold', status === 'Queued' && 'text-[#7d8791]', status === 'Failed' && 'text-[#b94f55]')}>
      <i className={cn('h-1.5 w-1.5 rounded-full', (status === 'Draft' || status === 'Ready') && 'border border-[#9ca3af] bg-[#f3f4f6]', status === 'Not configured' && 'border border-[#b9c0c7] bg-white', status === 'Completed' && 'bg-[#5aa372]', status === 'Running' && 'animate-pulse bg-[var(--accent)]', status === 'Queued' && 'bg-[#a8b0b8]', status === 'Failed' && 'bg-[#c85a61]')} />
      {shownStatus}
    </span>
  );
}

function AdvancedParameterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="group overflow-hidden rounded-[5px] border border-[#e3e7eb] bg-[#fafbfc]">
      <summary className="flex h-8 cursor-pointer list-none items-center gap-2 px-2.5 text-[10px] font-medium text-[#66717d]">
        <Settings2 className="h-3 w-3 text-[#85909b]" />
        <span className="flex-1">{title}</span>
        <ChevronRight className="h-3 w-3 text-[#9aa3ac] transition-transform group-open:rotate-90" />
      </summary>
      <div className="grid grid-cols-2 gap-2 border-t border-[#e6e9ec] bg-white p-2.5">{children}</div>
    </details>
  );
}

function CalculationParameters({ calculation, draft, onChange }: { calculation: CalculationType; draft: JobDraft; onChange: (patch: Partial<JobDraft>) => void }) {
  if (calculation === 'Total energy') {
    return <div className="space-y-2"><div className="grid grid-cols-2 gap-2"><NumberField label="conv_thr · default 1e−6" value={draft.scfThreshold} min={1e-12} step={1e-8} onChange={(scfThreshold) => onChange({ scfThreshold })} /><NumberField label="electron_maxstep · 100" value={draft.electronMaxSteps} min={10} max={500} onChange={(electronMaxSteps) => onChange({ electronMaxSteps })} /><NumberField label="mixing_beta · 0.7" value={draft.mixingBeta} min={0.05} max={0.95} step={0.05} onChange={(mixingBeta) => onChange({ mixingBeta })} /><SelectField label="diagonalization · david" value={draft.diagonalization} options={[{ value: 'david', label: 'Davidson' }, { value: 'cg', label: 'Conjugate gradient' }, { value: 'rmm-davidson', label: 'RMM–Davidson' }]} onChange={(diagonalization) => onChange({ diagonalization: diagonalization as JobDraft['diagonalization'] })} /></div><AdvancedParameterGroup title="SCF convergence & solver"><SelectField label="mixing_mode" value={draft.mixingMode} options={[{ value: 'plain', label: 'Plain' }, { value: 'TF', label: 'Thomas–Fermi' }, { value: 'local-TF', label: 'Local TF' }]} onChange={(mixingMode) => onChange({ mixingMode: mixingMode as JobDraft['mixingMode'] })} /><NumberField label="mixing_ndim · 8" value={draft.mixingNdim} min={1} max={32} onChange={(mixingNdim) => onChange({ mixingNdim })} /><NumberField label="diago_thr_init" value={draft.diagonalizationThreshold} min={1e-12} step={1e-8} onChange={(diagonalizationThreshold) => onChange({ diagonalizationThreshold })} /><div className="col-span-2 rounded-[4px] border border-[#e3e7eb] px-2"><SettingToggle label="scf_must_converge" detail="Stop if the electronic loop does not converge" checked={draft.scfMustConverge} onChange={() => onChange({ scfMustConverge: !draft.scfMustConverge })} /></div></AdvancedParameterGroup></div>;
  }
  if (calculation === 'Structural relaxation') {
    return <div className="space-y-2"><div className="rounded-[4px] border border-[#e3e7eb] px-2"><SettingToggle label="Variable-cell relaxation" detail="vc-relax: optimize lattice vectors and ionic positions" checked={draft.relaxCell} onChange={() => onChange({ relaxCell: !draft.relaxCell })} /></div><div className="grid grid-cols-2 gap-2"><SelectField label="ion_dynamics · bfgs" value={draft.ionDynamics} options={qeIonDynamicsOptions(draft)} onChange={(ionDynamics) => onChange({ ionDynamics: ionDynamics as JobDraft['ionDynamics'] })} /><NumberField label="forc_conv_thr · 1e−3" value={draft.forceThreshold} unit="Ry/Bohr" min={0.0001} step={0.0005} onChange={(forceThreshold) => onChange({ forceThreshold })} /><NumberField label="etot_conv_thr · 1e−4" value={draft.energyThreshold} unit="Ry" min={0.000001} step={0.00001} onChange={(energyThreshold) => onChange({ energyThreshold })} /><NumberField label="press · 0" value={draft.targetPressure} unit="kbar" step={0.5} onChange={(targetPressure) => onChange({ targetPressure })} /></div>{draft.relaxCell && <AdvancedParameterGroup title="Cell dynamics & trust region"><SelectField label="cell_dynamics · bfgs" value={draft.cellDynamics} options={[{ value: 'bfgs', label: 'BFGS' }, { value: 'damp-pr', label: 'Damped Parrinello–Rahman' }, { value: 'damp-w', label: 'Damped Wentzcovitch' }]} onChange={(cellDynamics) => onChange({ cellDynamics: cellDynamics as JobDraft['cellDynamics'] })} /><SelectField label="cell_dofree · all" value={draft.cellDoFree} options={[{ value: 'all', label: 'All degrees' }, { value: 'ibrav', label: 'Preserve Bravais lattice' }, { value: 'shape', label: 'Shape only' }, { value: 'volume', label: 'Volume only' }, { value: '2Dxy', label: '2D xy' }]} onChange={(cellDoFree) => onChange({ cellDoFree: cellDoFree as JobDraft['cellDoFree'] })} /><NumberField label="press_conv_thr · 0.5" value={draft.pressureThreshold} unit="kbar" min={0.01} step={0.1} onChange={(pressureThreshold) => onChange({ pressureThreshold })} /><NumberField label="trust_radius_ini" value={draft.trustRadius} unit="Bohr" min={0.01} step={0.05} onChange={(trustRadius) => onChange({ trustRadius })} /></AdvancedParameterGroup>}</div>;
  }
  if (calculation === 'Band structure') {
    return <div className="space-y-2"><label className="block text-[10px] text-[#7f8994]">K_POINTS crystal_b path<input value={draft.kPath} onChange={(event) => onChange({ kPath: event.target.value })} className="mt-1 h-8 w-full rounded-[4px] border border-[#d9dee4] px-2 font-mono text-[10px] text-[#414b56] outline-none focus:border-[var(--field-focus-border)]" /></label><div className="grid grid-cols-2 gap-2"><NumberField label="Points / segment" value={draft.kPathPoints} min={5} max={200} onChange={(kPathPoints) => onChange({ kPathPoints })} /><NumberField label="nbnd" value={draft.numberOfBands} min={1} max={1000} onChange={(numberOfBands) => onChange({ numberOfBands })} /></div><AdvancedParameterGroup title="bands.x ordering"><div className="rounded-[4px] border border-[#e3e7eb] px-2"><SettingToggle label="lsym · true" detail="Classify bands by irreducible representation" checked={draft.bandSymmetry} onChange={() => onChange({ bandSymmetry: !draft.bandSymmetry })} /></div><div className="rounded-[4px] border border-[#e3e7eb] px-2"><SettingToggle label="Overlap ordering" detail="Track adjacent bands by wavefunction overlap" checked={draft.bandOverlap} onChange={() => onChange({ bandOverlap: !draft.bandOverlap })} /></div></AdvancedParameterGroup></div>;
  }
  if (calculation === 'Density of states') {
    return <div className="space-y-2"><div className="grid grid-cols-3 gap-2"><NumberField label="Emin" value={draft.dosEnergyMin} unit="eV" step={0.5} onChange={(dosEnergyMin) => onChange({ dosEnergyMin })} /><NumberField label="Emax" value={draft.dosEnergyMax} unit="eV" step={0.5} onChange={(dosEnergyMax) => onChange({ dosEnergyMax })} /><NumberField label="DeltaE" value={draft.dosEnergyStep} unit="eV" min={0.001} step={0.005} onChange={(dosEnergyStep) => onChange({ dosEnergyStep })} /></div><div className="rounded-[4px] border border-[#d9e2ed] bg-[#f7faff] px-2.5 py-2 text-[9px] leading-3.5 text-[#66778a]">The dense NSCF grid and dos.x use optimized tetrahedra. Gaussian broadening is omitted.</div><div className="rounded-[4px] border border-[#e3e7eb] px-2"><SettingToggle label="Projected DOS" detail="Run projwfc.x for atom- and orbital-resolved DOS" checked={draft.projectedDos} onChange={() => onChange({ projectedDos: !draft.projectedDos })} /></div><AdvancedParameterGroup title="Projection controls"><div className="rounded-[4px] border border-[#e3e7eb] px-2"><SettingToggle label="lsym · true" detail="Symmetrize orbital projections" checked={draft.dosSymmetrize} onChange={() => onChange({ dosSymmetrize: !draft.dosSymmetrize })} /></div><div className="rounded-[4px] border border-[#e3e7eb] px-2"><SettingToggle label="pawproj · false" detail="Use PAW projectors and all-electron basis" checked={draft.pawProjection} onChange={() => onChange({ pawProjection: !draft.pawProjection })} /></div></AdvancedParameterGroup></div>;
  }
  if (calculation === 'Thermoelectric properties') {
    return <div className="space-y-2"><div className="grid grid-cols-3 gap-2"><NumberField label="Temperature min" value={draft.transportTemperatureMin} unit="K" min={1} step={25} onChange={(transportTemperatureMin) => onChange({ transportTemperatureMin })} /><NumberField label="Temperature max" value={draft.transportTemperatureMax} unit="K" min={1} step={25} onChange={(transportTemperatureMax) => onChange({ transportTemperatureMax })} /><NumberField label="Temperature step" value={draft.transportTemperatureStep} unit="K" min={1} step={5} onChange={(transportTemperatureStep) => onChange({ transportTemperatureStep })} /></div><div className="grid grid-cols-2 gap-2"><NumberField label="Interpolation multiplier" value={draft.transportInterpolationMultiplier} unit="×" min={1} max={12} onChange={(transportInterpolationMultiplier) => onChange({ transportInterpolationMultiplier })} /><NumberField label="Relaxation time" value={draft.transportRelaxationTime} unit="fs" min={0.01} step={1} onChange={(transportRelaxationTime) => onChange({ transportRelaxationTime })} /></div><AdvancedParameterGroup title="BoltzTraP2 integration window"><NumberField label="μ min" value={draft.transportChemicalPotentialMin} unit="eV" step={0.05} onChange={(transportChemicalPotentialMin) => onChange({ transportChemicalPotentialMin })} /><NumberField label="μ max" value={draft.transportChemicalPotentialMax} unit="eV" step={0.05} onChange={(transportChemicalPotentialMax) => onChange({ transportChemicalPotentialMax })} /><NumberField label="Energy bins" value={draft.transportEnergyBins} min={500} max={50000} step={500} onChange={(transportEnergyBins) => onChange({ transportEnergyBins })} /><SelectField label="Scattering model" value={draft.transportScatteringModel} options={[{ value: 'constant-relaxation-time', label: 'Constant relaxation time' }]} onChange={(transportScatteringModel) => onChange({ transportScatteringModel: transportScatteringModel as JobDraft['transportScatteringModel'] })} /></AdvancedParameterGroup></div>;
  }
  return <div className="space-y-2"><div className="grid grid-cols-3 gap-2"><NumberField label="nq1" value={draft.qPoint} min={1} max={32} onChange={(qPoint) => onChange({ qPoint })} /><NumberField label="nq2" value={draft.qPointY} min={1} max={32} onChange={(qPointY) => onChange({ qPointY })} /><NumberField label="nq3" value={draft.qPointZ} min={1} max={32} onChange={(qPointZ) => onChange({ qPointZ })} /></div><div className="grid grid-cols-2 gap-2"><NumberField label="tr2_ph · 1e−12" value={draft.phononThreshold} min={1e-16} step={1e-12} onChange={(phononThreshold) => onChange({ phononThreshold })} /><NumberField label="niter_ph · 100" value={draft.phononIterations} min={1} max={100} onChange={(phononIterations) => onChange({ phononIterations })} /><NumberField label="alpha_mix(1) · 0.7" value={draft.phononMixing} min={0.05} max={0.95} step={0.05} onChange={(phononMixing) => onChange({ phononMixing })} /></div><AdvancedParameterGroup title="DFPT response & interpolation"><NumberField label="nmix_ph · 4" value={draft.phononMixingNdim} min={1} max={20} onChange={(phononMixingNdim) => onChange({ phononMixingNdim })} /><SelectField label="asr" value={draft.phononAsr} options={[{ value: 'none', label: 'None' }, { value: 'simple', label: 'Simple' }, { value: 'crystal', label: 'Crystal' }, { value: 'all', label: 'All constraints' }]} onChange={(phononAsr) => onChange({ phononAsr: phononAsr as JobDraft['phononAsr'], acousticSumRule: phononAsr !== 'none' })} /><div className="rounded-[4px] border border-[#e3e7eb] px-2"><SettingToggle label="epsil" detail="Macroscopic dielectric tensor at q = 0" checked={draft.dielectricTensor} onChange={() => onChange({ dielectricTensor: !draft.dielectricTensor })} /></div><div className="rounded-[4px] border border-[#e3e7eb] px-2"><SettingToggle label="zeu" detail="Born effective charges" checked={draft.effectiveCharges} onChange={() => onChange({ effectiveCharges: !draft.effectiveCharges })} /></div><div className="col-span-2"><SelectField label="electron_phonon" value={draft.electronPhonon} options={[{ value: 'none', label: 'None' }, { value: 'simple', label: 'Simple linewidth' }, { value: 'lambda_tetra', label: 'λ with optimized tetrahedra' }]} onChange={(electronPhonon) => onChange({ electronPhonon: electronPhonon as JobDraft['electronPhonon'] })} /></div></AdvancedParameterGroup></div>;
}

export function JobComposer({
  draft,
  material,
  jobs,
  configurations,
  onChange,
  onApplyAccuracy,
  onAdd,
  onRunCalculation,
  onRunSelected,
  onRunJob,
  onImportConfiguration,
  onClose,
}: {
  draft: JobDraft;
  material: MaterialContext;
  jobs: CalculationJob[];
  configurations: CalculationConfiguration[];
  onChange: (patch: Partial<JobDraft>) => void;
  onApplyAccuracy: (accuracy: Accuracy) => void;
  onAdd: () => void;
  onRunCalculation: (calculation: CalculationType) => void;
  onRunSelected: () => void;
  onRunJob: (id: string) => void;
  onImportConfiguration: (configuration: CalculationConfiguration) => void;
  onClose?: () => void;
}) {
  const [expandedCalculation, setExpandedCalculation] = useState<CalculationType | null>('Band structure');
  const [importOpen, setImportOpen] = useState(false);
  const [configurationQuery, setConfigurationQuery] = useState('');
  const [expertView, setExpertView] = useState<'parameters' | 'input'>('parameters');
  const [copied, setCopied] = useState(false);
  const selectedCount = draft.calculations.length;
  const runtime = accuracyMeta[draft.accuracy].runtime;
  const activeCalculation = expandedCalculation ?? draft.calculations[0] ?? 'Total energy';
  const generatedInput = generateQuantumEspressoInput(draft, activeCalculation, material);
  const inputValue = draft.rawInput || generatedInput;
  const externalConfigurations = configurations.filter((configuration) => configuration.databaseName !== material?.databaseName && `${configuration.databaseName} ${configuration.materialName} ${configuration.name} ${configuration.calculation}`.toLowerCase().includes(configurationQuery.toLowerCase()));

  const copyInput = async () => {
    await navigator.clipboard.writeText(inputValue);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  const toggleCalculation = (calculation: CalculationType) => {
    const selected = draft.calculations.includes(calculation);
    onChange({ calculations: selected ? draft.calculations.filter((item) => item !== calculation) : [...draft.calculations, calculation] });
    if (!selected) setExpandedCalculation(calculation);
    if (selected && expandedCalculation === calculation) setExpandedCalculation(null);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <section className="flex items-center gap-2.5 border-b border-[#e2e5e9] px-3 py-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[6px] border border-[#cae6f8] bg-[#f0f9ff] font-mono text-[11px] font-semibold text-[#087fc9]">{material?.formula ?? '—'}</span>
          <span className="min-w-0 flex-1"><span className="block truncate text-[11px] font-medium text-[#39434e]">{material?.name ?? 'Select a structure'}</span><span className="mt-0.5 block truncate text-[10px] text-[#929ba5]">{material ? `${material.databaseName} · Quantum ESPRESSO` : 'Calculations use the active structure'}</span></span>
          {onClose && <button type="button" onClick={onClose} className="text-[#949da7] lg:hidden"><X className="h-3.5 w-3.5" /></button>}
        </section>

        <section className="border-b border-[#e2e5e9] bg-[#fafbfc] px-3 py-2.5">
          <button type="button" onClick={() => setImportOpen((current) => !current)} className="flex h-8 w-full items-center gap-2 rounded-[5px] border border-[#d8dfe6] bg-white px-2.5 text-left hover:border-[var(--line-strong)] hover:bg-[#fbfcfd]"><Database className="h-3.5 w-3.5 text-[#5e6973]" /><span className="min-w-0 flex-1"><span className="block text-[11px] font-medium text-[#4c5865]">Import calculation configuration</span><span className="block text-[9px] text-[#98a1aa]">Reuse parameters from another crystal database</span></span><ChevronRight className={cn('h-3.5 w-3.5 text-[#8c96a0] transition-transform', importOpen && 'rotate-90')} /></button>
          {importOpen && <div className="mt-2 overflow-hidden rounded-[6px] border border-[#dce2e8] bg-white"><div className="flex h-8 items-center gap-2 border-b border-[#e6eaee] px-2.5"><Search className="h-3 w-3 text-[#8d97a1]" /><input value={configurationQuery} onChange={(event) => setConfigurationQuery(event.target.value)} placeholder="Search database, material, or job" className="h-full min-w-0 flex-1 text-[10px] text-[#56616d] outline-none placeholder:text-[#a5adb5]" /></div><div className="max-h-[210px] overflow-y-auto p-1.5">{externalConfigurations.length ? externalConfigurations.map((configuration) => <div key={configuration.id} className="mb-1 flex items-center gap-2 rounded-[4px] border border-transparent px-2 py-2 hover:border-[#e0e6eb] hover:bg-[#fafbfc]"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-[4px] border border-[#d7e1e9] bg-[#f5f9fc] font-mono text-[9px] font-semibold text-[#4e5863]">QE</span><span className="min-w-0 flex-1"><span className="flex items-center gap-1.5"><span className="truncate text-[11px] font-medium text-[#46525f]">{configuration.name}</span><span className="shrink-0 rounded-[3px] bg-[#eef3f7] px-1 py-0.5 font-mono text-[8px] text-[#77848f]">{configuration.calculation}</span></span><span className="mt-0.5 block truncate text-[9px] text-[#929ca5]">{configuration.databaseName} / {configuration.materialName} · {summarizeJobDraft(configuration.draft, configuration.calculation)}</span></span><button type="button" onClick={() => { onImportConfiguration(configuration); setExpandedCalculation(configuration.calculation); setImportOpen(false); }} className="h-6 shrink-0 rounded-[4px] border border-[var(--line)] bg-white px-2 text-[9px] font-semibold text-[var(--ink)] hover:bg-[#f4f5f7]">Import</button></div>) : <div className="p-4 text-center"><p className="text-[11px] font-medium text-[#65717d]">No matching external configuration</p><p className="mt-1 text-[9px] leading-3.5 text-[#9aa3ac]">Save a setup in another database and it will appear here.</p></div>}</div></div>}
        </section>

        <section className="border-b border-[#e2e5e9] px-3 py-3">
          <div className="mb-2 flex items-center justify-between"><p className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-[#7f8994]">Calculations</p><span className="font-mono text-[10px] font-medium text-[var(--surface-text,var(--ink))]">{selectedCount} selected</span></div>
          <div className="space-y-1.5">
            {calculations.map((option) => {
              const Icon = option.icon;
              const selected = draft.calculations.includes(option.id);
              const expanded = expandedCalculation === option.id && selected;
              const linkedJobs = jobs.filter((job) => calculationMatches(job.name, option.id));
              const latestJob = linkedJobs[0];
              const lifecycle: LifecycleStatus = latestJob?.status ?? (selected ? 'Ready' : 'Not configured');
              const canRun = selected && lifecycle !== 'Running';
              return (
                <div key={option.id} className={cn('overflow-hidden rounded-[6px] border transition-colors', selected ? 'border-[var(--line-strong)] bg-[#f6f7f9]' : 'border-[#e5e8eb] bg-white')}>
                  <div className="flex items-center gap-2 px-2 py-2">
                    <button type="button" onClick={() => toggleCalculation(option.id)} aria-label={`${selected ? 'Remove' : 'Add'} ${option.label}`} className={cn('grid h-4 w-4 shrink-0 place-items-center rounded-[3px] border', selected ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--on-accent)]' : 'border-[#b8c0c8] bg-white')}>
                      {selected && <Check className="h-3 w-3" />}
                    </button>
                    <Icon className={cn('h-3.5 w-3.5 shrink-0', selected ? 'text-[var(--ink)]' : 'text-[#8c96a0]')} />
                    <button type="button" onClick={() => toggleCalculation(option.id)} className="min-w-0 flex-1 text-left"><span className="flex items-center gap-2"><span className="block text-[11px] font-medium text-[#424c57]">{option.label}</span><StatusBadge status={lifecycle} /></span><span className="mt-0.5 block text-[10px] text-[#929ba5]">{option.detail}{linkedJobs.length ? ` · ${linkedJobs.length} run${linkedJobs.length > 1 ? 's' : ''}` : ''}</span></button>
                    {selected && <button type="button" disabled={!canRun} onClick={() => onRunCalculation(option.id)} title={`Run ${option.label}`} className="grid h-6 w-6 place-items-center rounded-[4px] text-[var(--ink)] hover:bg-[#eaecef] disabled:text-[#c4cbd2]"><Play className="h-2.5 w-2.5 fill-current" /></button>}
                    <button type="button" onClick={() => { if (!selected) toggleCalculation(option.id); else setExpandedCalculation(expanded ? null : option.id); }} aria-label={`Configure ${option.label}`} className="grid h-6 w-6 place-items-center rounded-[4px] text-[#87919b] hover:bg-[#edf0f2]">{expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</button>
                  </div>
                  {expanded && <div className="border-t border-[#e6eaee] bg-white px-2.5 py-2.5"><CalculationParameters calculation={option.id} draft={draft} onChange={onChange} /></div>}
                  {linkedJobs.length > 0 && <div className="border-t border-[#e7eaed] bg-[#fafbfc] px-2.5 py-1">{linkedJobs.map((job) => { const runnable = job.status === 'Draft' || job.status === 'Queued'; return <div key={job.id} className="flex h-7 items-center gap-2"><StatusBadge status={job.status} /><span className="min-w-0 flex-1 truncate font-mono text-[9px] text-[#8b949e]">{job.settings}</span><span className="text-[9px] text-[#a0a8b0]">{job.updated}</span><button type="button" disabled={!runnable} onClick={() => onRunJob(job.id)} aria-label={`Run ${job.name}`} className="grid h-5 w-5 place-items-center rounded-[3px] text-[var(--ink)] hover:bg-[#eaecef] disabled:text-[#c4cbd2] disabled:hover:bg-transparent"><Play className="h-2.5 w-2.5 fill-current" /></button></div>; })}</div>}
                </div>
              );
            })}
          </div>
        </section>

        <section className="border-b border-[#e2e5e9] px-3 py-3">
          <div className="mb-2 flex items-center justify-between"><p className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-[#7f8994]">Accuracy</p><span className="font-mono text-[10px] font-medium text-[var(--surface-text,var(--ink))]">{runtime}</span></div>
          <div className="grid grid-cols-3 overflow-hidden rounded-[5px] border border-[#dce1e6]">
            {(['Fast', 'Balanced', 'High accuracy'] as Accuracy[]).map((option) => <button key={option} type="button" onClick={() => onApplyAccuracy(option)} className={cn('h-8 border-r border-[#dce1e6] px-1 text-[10px] font-medium last:border-r-0', draft.accuracy === option ? 'bg-[var(--accent)] text-[var(--on-accent)] font-semibold' : 'bg-white text-[#75808b] hover:bg-[#f5f7f9]')}>{option === 'High accuracy' ? 'High' : option}</button>)}
          </div>
        </section>

        <section className="px-3 py-3">
          <div className="mb-2 flex items-center justify-between"><p className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-[#7f8994]">Electronic parameters</p><span className="font-mono text-[9px] text-[#9aa3ac]">pw.x defaults included</span></div>
          <div className="grid grid-cols-2 gap-2">
            <SelectField label="XC functional" value={draft.functional} options={[{ value: 'PBE', label: 'PBE' }, { value: 'LDA', label: 'LDA' }, { value: 'HSE', label: 'HSE' }]} onChange={(functional) => onChange({ functional: functional as Functional })} />
            <NumberField label="nk1" value={draft.kPoint} min={1} max={64} onChange={(kPoint) => onChange({ kPoint })} />
            <NumberField label="nk2" value={draft.kPointY} min={1} max={64} onChange={(kPointY) => onChange({ kPointY })} />
            <NumberField label="nk3" value={draft.kPointZ} min={1} max={64} onChange={(kPointZ) => onChange({ kPointZ })} />
            <NumberField label="Wavefunction cutoff" value={draft.cutoff} unit="Ry" min={20} max={240} onChange={(cutoff) => onChange({ cutoff })} />
            <NumberField label="Charge-density cutoff" value={draft.chargeDensityCutoff} unit="Ry" min={80} max={1200} onChange={(chargeDensityCutoff) => onChange({ chargeDensityCutoff })} />
            <SelectField label="Occupations" value={draft.occupations} options={[{ value: 'fixed', label: 'Fixed' }, { value: 'smearing', label: 'Smearing' }, { value: 'tetrahedra', label: 'Tetrahedra' }]} onChange={(occupations) => onChange({ occupations: occupations as JobDraft['occupations'] })} />
            {draft.occupations === 'smearing' && <SelectField label="Smearing method" value={draft.smearingType} options={[{ value: 'gaussian', label: 'Gaussian' }, { value: 'methfessel-paxton', label: 'Methfessel–Paxton' }, { value: 'marzari-vanderbilt', label: 'Marzari–Vanderbilt' }]} onChange={(smearingType) => onChange({ smearingType: smearingType as JobDraft['smearingType'] })} />}
            {draft.occupations === 'smearing' && <NumberField label="Smearing width" value={draft.smearing} unit="Ry" min={0.001} max={0.2} step={0.005} onChange={(smearing) => onChange({ smearing })} />}

          </div>

          <div className="mt-3 overflow-hidden rounded-[6px] border border-[#e1e5e9] px-2.5">
            <SettingToggle label="Spin polarization" detail="Collinear magnetic calculation (nspin = 2)" checked={draft.spin} onChange={() => onChange({ spin: !draft.spin })} />
            {draft.spin && <div className="border-t border-[#edf0f2] py-2"><NumberField label="Default seed for unconfigured species" value={draft.startingMagnetization} min={-1} max={1} step={0.05} onChange={(startingMagnetization) => onChange({ startingMagnetization })} /></div>}
          </div>

          <div className="mt-2 overflow-hidden rounded-[6px] border border-[#e1e5e9] px-2.5">
            <SettingToggle label="Spin–orbit coupling" detail="Relativistic SOC using fully relativistic pseudopotentials" checked={draft.soc} onChange={() => onChange({ soc: !draft.soc, noncollinear: !draft.soc ? true : draft.noncollinear })} />
            {draft.soc && <div className="border-t border-[#edf0f2]"><SettingToggle label="Noncollinear magnetism" detail="Required for Quantum ESPRESSO lspinorb" checked={draft.noncollinear} onChange={() => onChange({ noncollinear: !draft.noncollinear })} /></div>}
          </div>

          <QeMethodFields draft={draft} material={material} onChange={onChange} />
          {activeCalculation === 'Thermoelectric properties' && <TransportSamplingNotice draft={draft} onChange={onChange} />}
          <details className="group mt-3 overflow-hidden rounded-[6px] border border-[#dfe4e9] bg-[#fafbfc]">
            <summary className="flex h-9 cursor-pointer list-none items-center gap-2 px-2.5 text-[11px] font-medium text-[#5f6b77]"><Settings2 className="h-3.5 w-3.5 text-[#7d8995]" /><span className="flex-1">Advanced Quantum ESPRESSO</span><ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" /></summary>
            <div className="space-y-3 border-t border-[#e3e7eb] bg-white p-2.5">
              <div><p className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-[#8c96a0]">&amp;CONTROL</p><div className="grid grid-cols-2 gap-2"><label className="block text-[10px] text-[#7f8994]">prefix<input value={draft.prefix} onChange={(event) => onChange({ prefix: event.target.value })} className="mt-1 h-8 w-full rounded-[4px] border border-[#d9dee4] px-2 font-mono text-[11px] outline-none focus:border-[var(--field-focus-border)]" /></label><SelectField label="restart_mode" value={draft.restartMode} options={[{ value: 'from_scratch', label: 'From scratch' }, { value: 'restart', label: 'Restart' }]} onChange={(restartMode) => onChange({ restartMode: restartMode as JobDraft['restartMode'] })} /><SelectField label="verbosity" value={draft.verbosity} options={[{ value: 'low', label: 'Low' }, { value: 'high', label: 'High' }]} onChange={(verbosity) => onChange({ verbosity: verbosity as JobDraft['verbosity'] })} /><SelectField label="disk_io" value={draft.diskIO} options={[{ value: 'none', label: 'None' }, { value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }]} onChange={(diskIO) => onChange({ diskIO: diskIO as JobDraft['diskIO'] })} /><NumberField label="max_seconds" value={draft.maxSeconds} unit="s" min={60} step={60} onChange={(maxSeconds) => onChange({ maxSeconds })} /><SelectField label="Pseudopotentials" value={draft.pseudoFamily} options={[{ value: 'SSSP efficiency', label: 'SSSP efficiency' }, { value: 'SSSP precision', label: 'SSSP precision' }, { value: 'PseudoDojo', label: 'PseudoDojo' }]} onChange={(pseudoFamily) => onChange({ pseudoFamily: pseudoFamily as JobDraft['pseudoFamily'] })} /></div></div>
              <div><p className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-[#8c96a0]">&amp;SYSTEM</p><div className="grid grid-cols-2 gap-2"><SelectField label="K-point shift" value={draft.kPointShift} options={['0 0 0', '1 1 1', '1 0 0', '0 1 0', '0 0 1'].map((value) => ({ value, label: value }))} onChange={(kPointShift) => onChange({ kPointShift: kPointShift as JobDraft['kPointShift'] })} /><NumberField label="tot_charge" value={draft.totalCharge} unit="e" step={0.1} onChange={(totalCharge) => onChange({ totalCharge })} /><SelectField label="vdw_corr" value={draft.vdwCorrection} options={[{ value: 'none', label: 'None' }, { value: 'dft-d3', label: 'DFT-D3' }, { value: 'dft-d3-bj', label: 'DFT-D3(BJ)' }, { value: 'ts-vdw', label: 'Tkatchenko–Scheffler' }]} onChange={(vdwCorrection) => onChange({ vdwCorrection: vdwCorrection as JobDraft['vdwCorrection'] })} />{draft.functional === 'HSE' && <NumberField label="exx_fraction" value={draft.exxFraction} min={0} max={1} step={0.05} onChange={(exxFraction) => onChange({ exxFraction })} />}<div className="rounded-[4px] border border-[#e3e7eb] px-2"><SettingToggle label="Use symmetry" detail="nosym = .false." checked={draft.useSymmetry} onChange={() => onChange({ useSymmetry: !draft.useSymmetry })} /></div><div className="rounded-[4px] border border-[#e3e7eb] px-2"><SettingToggle label="Use inversion" detail="noinv = .false." checked={draft.useInversion} onChange={() => onChange({ useInversion: !draft.useInversion })} /></div></div></div>
              <div className="rounded-[5px] border border-[#e4e8ec] bg-[#f7f9fb] p-2.5 font-mono text-[9px] leading-4 text-[#6d7884]"><span className="font-semibold text-[var(--ink)]">&amp;ELECTRONS</span><br />conv_thr = {draft.scfThreshold.toExponential(2)}, mixing_beta = {draft.mixingBeta.toFixed(2)},<br />mixing_mode = &apos;{draft.mixingMode}&apos;, diagonalization = &apos;{draft.diagonalization}&apos;<br /><span className="font-semibold text-[var(--ink)]">K_POINTS automatic</span><br />{draft.kPoint} {draft.kPointY} {draft.kPointZ} {draft.kPointShift}</div>
            </div>
          </details>

          <details className="group mt-2 overflow-hidden rounded-[6px] border border-[#dfe4e9] bg-[#fafbfc]">
            <summary className="flex h-9 cursor-pointer list-none items-center gap-2 px-2.5 text-[11px] font-medium text-[#5f6b77]"><Braces className="h-3.5 w-3.5 text-[#7d8995]" /><span className="flex-1">Full pw.x controls</span><span className="font-mono text-[9px] text-[#9aa3ac]">CONTROL · SYSTEM · ELECTRONS · IONS · CELL</span><ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" /></summary>
            <div className="space-y-3 border-t border-[#e3e7eb] bg-white p-2.5">
              <div><p className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-[#8c96a0]">&amp;CONTROL · paths and output</p><div className="grid grid-cols-2 gap-2"><label className="block text-[10px] text-[#7f8994]">title<input value={draft.title} onChange={(event) => onChange({ title: event.target.value })} className="mt-1 h-8 w-full rounded-[4px] border border-[#d9dee4] px-2 font-mono text-[10px] outline-none focus:border-[var(--field-focus-border)]" /></label><label className="block text-[10px] text-[#7f8994]">outdir<input value={draft.outdir} onChange={(event) => onChange({ outdir: event.target.value })} className="mt-1 h-8 w-full rounded-[4px] border border-[#d9dee4] px-2 font-mono text-[10px] outline-none focus:border-[var(--field-focus-border)]" /></label><label className="block text-[10px] text-[#7f8994]">pseudo_dir<input value={draft.pseudoDir} onChange={(event) => onChange({ pseudoDir: event.target.value })} className="mt-1 h-8 w-full rounded-[4px] border border-[#d9dee4] px-2 font-mono text-[10px] outline-none focus:border-[var(--field-focus-border)]" /></label><NumberField label="nstep" value={draft.nstep} min={1} max={10000} onChange={(nstep) => onChange({ nstep })} /><div className="rounded-[4px] border border-[#e3e7eb] px-2"><SettingToggle label="tstress" detail="Print the stress tensor" checked={draft.printStress} onChange={() => onChange({ printStress: !draft.printStress })} /></div><div className="rounded-[4px] border border-[#e3e7eb] px-2"><SettingToggle label="tprnfor" detail="Print forces on atoms" checked={draft.printForces} onChange={() => onChange({ printForces: !draft.printForces })} /></div></div></div>
              <div><p className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-[#8c96a0]">&amp;SYSTEM · grids and boundaries</p><div className="grid grid-cols-2 gap-2"><SelectField label="assume_isolated" value={draft.assumeIsolated} options={[{ value: 'none', label: 'Periodic / none' }, { value: '2D', label: '2D correction' }, { value: 'esm', label: 'Effective screening medium' }, { value: 'makov-payne', label: 'Makov–Payne' }, { value: 'martyna-tuckerman', label: 'Martyna–Tuckerman' }]} onChange={(assumeIsolated) => onChange({ assumeIsolated: assumeIsolated as JobDraft['assumeIsolated'] })} /><SelectField label="FFT grid" value={draft.fftGridMode} options={[{ value: 'automatic', label: 'Automatic from cutoff' }, { value: 'manual', label: 'Manual nr1/nr2/nr3' }]} onChange={(fftGridMode) => onChange({ fftGridMode: fftGridMode as JobDraft['fftGridMode'] })} />{draft.fftGridMode === 'manual' && <><NumberField label="nr1" value={draft.nr1} min={1} max={1024} onChange={(nr1) => onChange({ nr1 })} /><NumberField label="nr2" value={draft.nr2} min={1} max={1024} onChange={(nr2) => onChange({ nr2 })} /><NumberField label="nr3" value={draft.nr3} min={1} max={1024} onChange={(nr3) => onChange({ nr3 })} /></>}</div></div>
              <div><p className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-[#8c96a0]">&amp;ELECTRONS · initialization</p><div className="grid grid-cols-2 gap-2"><SelectField label="startingpot" value={draft.startingPotential} options={[{ value: 'atomic', label: 'Atomic' }, { value: 'file', label: 'File' }]} onChange={(startingPotential) => onChange({ startingPotential: startingPotential as JobDraft['startingPotential'] })} /><SelectField label="startingwfc" value={draft.startingWavefunctions} options={[{ value: 'atomic+random', label: 'Atomic + random' }, { value: 'random', label: 'Random' }, { value: 'file', label: 'File' }]} onChange={(startingWavefunctions) => onChange({ startingWavefunctions: startingWavefunctions as JobDraft['startingWavefunctions'] })} /><div className="rounded-[4px] border border-[#e3e7eb] px-2"><SettingToggle label="diago_full_acc" detail="Use full diagonalization accuracy" checked={draft.diagoFullAccuracy} onChange={() => onChange({ diagoFullAccuracy: !draft.diagoFullAccuracy })} /></div><div className="rounded-[4px] border border-[#e3e7eb] px-2"><SettingToggle label="real_space" detail="Use real-space projectors when supported" checked={draft.realSpace} onChange={() => onChange({ realSpace: !draft.realSpace })} /></div></div></div>
              {activeCalculation === 'Structural relaxation' && <div><p className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-[#8c96a0]">&amp;IONS / &amp;CELL</p><div className="grid grid-cols-2 gap-2"><SelectField label="pot_extrapolation" value={draft.potentialExtrapolation} options={[{ value: 'atomic', label: 'Atomic' }, { value: 'first_order', label: 'First order' }, { value: 'second_order', label: 'Second order' }]} onChange={(potentialExtrapolation) => onChange({ potentialExtrapolation: potentialExtrapolation as JobDraft['potentialExtrapolation'] })} /><SelectField label="wfc_extrapolation" value={draft.wavefunctionExtrapolation} options={[{ value: 'none', label: 'None' }, { value: 'first_order', label: 'First order' }, { value: 'second_order', label: 'Second order' }]} onChange={(wavefunctionExtrapolation) => onChange({ wavefunctionExtrapolation: wavefunctionExtrapolation as JobDraft['wavefunctionExtrapolation'] })} /><NumberField label="cell_factor" value={draft.cellFactor} min={1} max={8} step={0.1} onChange={(cellFactor) => onChange({ cellFactor })} /><div className="rounded-[4px] border border-[#e3e7eb] px-2"><SettingToggle label="remove_rigid_rot" detail="Remove rigid-body rotation" checked={draft.removeRigidRotation} onChange={() => onChange({ removeRigidRotation: !draft.removeRigidRotation })} /></div><div className="rounded-[4px] border border-[#e3e7eb] px-2"><SettingToggle label="refold_pos" detail="Fold ions back into the cell" checked={draft.refoldPositions} onChange={() => onChange({ refoldPositions: !draft.refoldPositions })} /></div></div></div>}
            </div>
          </details>

          <div className="mt-2 overflow-hidden rounded-[6px] border border-[#cfdbe5] bg-white">
            <div className="flex h-9 items-center border-b border-[#dde5eb] bg-[#f8fafc] p-1"><button type="button" onClick={() => setExpertView('parameters')} className={cn('h-7 flex-1 rounded-[4px] text-[10px] font-medium transition-colors', expertView === 'parameters' ? 'bg-white text-[#3d4b58] shadow-xs' : 'text-[#8a949e]')}>Structured</button><button type="button" onClick={() => setExpertView('input')} className={cn('h-7 flex-1 rounded-[4px] text-[10px] font-medium transition-colors', expertView === 'input' ? 'bg-white text-[var(--ink)] font-semibold shadow-xs' : 'text-[#8a949e]')}>QE input file</button></div>
            {expertView === 'parameters' ? <div className="p-2.5"><p className="text-[10px] leading-4 text-[#75818d]">The structured controls generate complete pw.x cards from the active crystal. Switch to QE input to inspect or override every variable manually.</p><div className="mt-2 flex gap-2 font-mono text-[9px] text-[#7f8a94]"><span>nat {material?.atomCount ?? 0}</span><span>·</span><span>ntyp {material?.species.length ?? 0}</span><span>·</span><span>ibrav 0</span></div></div> : <div><div className="flex h-8 items-center gap-1.5 border-b border-[#e2e7eb] px-2"><span className="font-mono text-[9px] text-[#87929d]">QE {draft.qeVersion} · {activeCalculation}</span><button type="button" onClick={() => onChange({ rawInput: '' })} className="ml-auto h-5 rounded-[3px] px-1.5 text-[9px] text-[#667581] hover:bg-[#eef2f5]">Regenerate</button><button type="button" onClick={() => void copyInput()} className="flex h-5 items-center gap-1 rounded-[3px] px-1.5 text-[9px] font-semibold text-[var(--ink)] hover:bg-[#eef1f4]"><Clipboard className="h-2.5 w-2.5" /> {copied ? 'Copied' : 'Copy'}</button></div><textarea spellCheck={false} value={inputValue} onChange={(event) => onChange({ rawInput: event.target.value })} className="h-[360px] w-full resize-y bg-[#fbfcfd] p-3 font-mono text-[10px] leading-4 text-[#46525e] outline-none focus:bg-white" /><div className="flex items-center gap-1.5 border-t border-[#e2e7eb] bg-[#fafbfc] px-2 py-1.5 text-[9px] text-[#87919b]"><i className="h-1.5 w-1.5 rounded-full bg-[#5aa372]" /> Parsed as editable expert input · arbitrary QE variables are preserved</div></div>}
          </div>
        </section>
      </div>

      <footer className="shrink-0 border-t border-[#d9dee4] bg-[#fafbfc] p-3">
        <div className="mb-2 flex items-center justify-between text-[10px]"><span className="text-[#7d8791]">{material ? `Will use ${material.name}` : 'Select a structure first'}</span><span className="font-mono font-medium text-[var(--surface-text,var(--ink))]">{selectedCount} calculation{selectedCount === 1 ? '' : 's'}</span></div>
        <div className="grid grid-cols-[1fr_1.25fr] gap-2"><button type="button" disabled={!material || !selectedCount} onClick={onAdd} className="flex h-9 items-center justify-center gap-1.5 rounded-[5px] border border-[#cfd6dd] bg-white text-[11px] font-medium text-[#5e6a76] hover:bg-[#f5f7f9] disabled:text-[#b8c0c8]"><Save className="h-3 w-3" /> Save setup</button><button type="button" disabled={!material || !selectedCount} onClick={onRunSelected} className="flex h-9 items-center justify-center gap-2 rounded-[5px] bg-[var(--accent)] text-[11px] font-semibold text-[var(--on-accent)] hover:bg-[var(--accent-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:bg-[#b8c2cc]"><Play className="h-3.5 w-3.5 fill-current" /> Run selected · {selectedCount || 0}</button></div>
      </footer>
    </div>
  );
}

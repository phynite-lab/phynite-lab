import { compileMdSimulationWorkflow } from './md-workflow-compiler.ts';
export { workflowStepKindForRecipe, mdComponentToWorkflowStep, generateMdStepInputPreview } from './md-workflow-compiler.ts';
import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  BarChart3,
  Boxes,
  CircleGauge,
  Crosshair,
  Flame,
  Gauge,
  Hexagon,
  Minimize2,
  MoveDiagonal2,
  Network,
  Play,
  RotateCcw,
  ScanLine,
  Scissors,
  Snowflake,
  Thermometer,
  Wind,
  Waves,
  Zap,
} from 'lucide-react';
import { validateMdDirectiveBlocks } from './md-directives.ts';

/** UI preset ids. The two legacy aliases remain readable for old drafts. */
export type MdSimulationRecipeId =
  | 'minimization'
  | 'velocity'
  | 'nve'
  | 'nvt'
  | 'npt'
  | 'nph'
  | 'langevin'
  | 'temp-berendsen'
  | 'press-berendsen'
  | 'pressure-ramp'
  | 'heating'
  | 'cooling'
  | 'annealing'
  | 'tensile'
  | 'shear'
  | 'compression'
  | 'diffusion'
  | 'rdf'
  | 'vacf'
  | 'coordination'
  | 'cna'
  | 'centrosymmetry'
  | 'voronoi'
  | 'stress-atom'
  | 'pe-atom'
  | 'ke-atom'
  | 'restart'
  | 'equilibration'
  | 'melting';

export type MdWorkflowStepKind = Exclude<MdSimulationRecipeId, 'equilibration' | 'melting'>;
export type MdSimulationMode = 'guided' | 'manual';
export type MdEnsemble = 'nve' | 'nvt' | 'npt';
export type MdBoundaryType = 'p p p' | 'p p f' | 'p f p' | 'f p p' | 'p f f' | 'f p f' | 'f f p' | 'f f f';
export type MdSimulationRecipeCategory = 'preparation' | 'dynamics' | 'mechanical' | 'analysis';

type MdDirectiveBlockBase<K extends string, P> = {
  id: string;
  kind: K;
  enabled: boolean;
  params: P;
};

/**
 * Auditable no-code LAMMPS commands. These are deliberately narrower than raw
 * LAMMPS: file access, managed prelude/output commands, and nested command
 * strings remain available only to neither Blocks nor Expert mode.
 */
export type MdDirectiveBlock =
  | MdDirectiveBlockBase<'run', { steps: number }>
  | MdDirectiveBlockBase<'minimize', { style: 'cg' | 'fire' | 'sd'; energyTolerance: number; forceTolerance: number; maxIterations: number; maxEvaluations: number }>
  | MdDirectiveBlockBase<'velocity', { temperatureK: number; seed: number }>
  | MdDirectiveBlockBase<'thermostat', { style: 'nve' | 'nvt' | 'langevin' | 'temp-berendsen'; timestepFs: number; totalSteps: number; tempStartK: number; tempEndK: number; dampingPs: number; seed: number }>
  | MdDirectiveBlockBase<'barostat', { style: 'npt' | 'nph' | 'press-berendsen'; timestepFs: number; totalSteps: number; tempStartK: number; tempEndK: number; tempDampingPs: number; pressureStartBar: number; pressureEndBar: number; pressureDampingPs: number }>
  | MdDirectiveBlockBase<'deform', { mode: 'tensile' | 'compression' | 'shear'; axis: 'x' | 'y' | 'z' | 'xy' | 'xz' | 'yz'; timestepFs: number; totalSteps: number; temperatureK: number; tempDampingPs: number; strainRatePerSecond: number; maxStrain: number }>
  | MdDirectiveBlockBase<'analysis', { style: 'msd' | 'rdf' | 'vacf' | 'coordination' | 'cna' | 'centrosymmetry' | 'voronoi' | 'stress-atom' | 'pe-atom' | 'ke-atom'; totalSteps: number; sampleEvery: number; cutoffAngstrom: number; bins: number; neighbors: number }>
  | MdDirectiveBlockBase<'checkpoint', { label: string }>;

export interface MdForceFieldPreset {
  id: 'lj-generic';
  name: string;
  family: 'lj';
  supportedElements: string[];
  description: string;
  citation: string;
}

export interface MdSimulationRecipePreset {
  id: MdSimulationRecipeId;
  name: string;
  label: string;
  code: string;
  detail: string;
  category: MdSimulationRecipeCategory;
  keywords: string[];
  icon: LucideIcon;
  defaultEnsemble: MdEnsemble;
  defaultTempStart: number;
  defaultTempEnd: number;
  defaultPressure: number;
  defaultTimestepFs: number;
  defaultSteps: number;
  defaultDumpFreq: number;
  /** LAMMPS packages that must be reported by the paired local runtime. */
  requiredPackages?: string[];
  /** Legacy aliases render in saved projects but stay out of the Add catalog. */
  catalog?: boolean;
}

export const MD_RECIPE_CATEGORY_LABELS: Record<MdSimulationRecipeCategory, string> = {
  preparation: 'Preparation',
  dynamics: 'Dynamics',
  mechanical: 'Mechanical',
  analysis: 'Analysis & output',
};

export const MD_FORCE_FIELD_PRESETS: MdForceFieldPreset[] = [{
  id: 'lj-generic',
  name: 'Lennard-Jones 12-6',
  family: 'lj',
  supportedElements: ['Ar', 'Kr', 'Xe', 'Generic'],
  description: 'Classical 12-6 pair potential for noble gases and reference fluids.',
  citation: 'Lennard-Jones (1924)',
}];

const preset = (value: Omit<MdSimulationRecipePreset, 'catalog'> & { catalog?: boolean }): MdSimulationRecipePreset => ({ catalog: true, ...value });

export const MD_SIMULATION_RECIPES: MdSimulationRecipePreset[] = [
  preset({ id: 'minimization', name: 'Energy minimization', label: 'Energy minimization', code: 'minimize · relax geometry', detail: 'Relax atomic positions to a local potential-energy minimum.', category: 'preparation', keywords: ['minimize', 'cg', 'fire', 'relax', 'energy'], icon: Minimize2, defaultEnsemble: 'nve', defaultTempStart: 300, defaultTempEnd: 300, defaultPressure: 0, defaultTimestepFs: 1, defaultSteps: 10_000, defaultDumpFreq: 100 }),
  preset({ id: 'velocity', name: 'Velocity initialization', label: 'Initialize velocity', code: 'velocity create · Maxwell-Boltzmann', detail: 'Assign reproducible thermal velocities before dynamics.', category: 'preparation', keywords: ['velocity', 'create', 'seed', 'temperature', 'maxwell'], icon: Zap, defaultEnsemble: 'nve', defaultTempStart: 300, defaultTempEnd: 300, defaultPressure: 0, defaultTimestepFs: 1, defaultSteps: 1, defaultDumpFreq: 1 }),
  preset({ id: 'nve', name: 'NVE dynamics', label: 'NVE dynamics', code: 'fix nve · microcanonical', detail: 'Integrate an isolated system at constant energy and volume.', category: 'dynamics', keywords: ['nve', 'microcanonical', 'fix nve', 'constant energy'], icon: Play, defaultEnsemble: 'nve', defaultTempStart: 300, defaultTempEnd: 300, defaultPressure: 0, defaultTimestepFs: 1, defaultSteps: 20_000, defaultDumpFreq: 200 }),
  preset({ id: 'nvt', name: 'NVT equilibration', label: 'NVT equilibration', code: 'fix nvt · thermostat', detail: 'Equilibrate temperature at constant particle count and volume.', category: 'dynamics', keywords: ['nvt', 'thermostat', 'fix nvt', 'equilibration'], icon: Activity, defaultEnsemble: 'nvt', defaultTempStart: 300, defaultTempEnd: 300, defaultPressure: 0, defaultTimestepFs: 1, defaultSteps: 20_000, defaultDumpFreq: 200 }),
  preset({ id: 'npt', name: 'NPT equilibration', label: 'NPT equilibration', code: 'fix npt · thermostat + barostat', detail: 'Equilibrate temperature and pressure with a periodic cell.', category: 'dynamics', keywords: ['npt', 'barostat', 'pressure', 'fix npt', 'equilibration'], icon: Gauge, defaultEnsemble: 'npt', defaultTempStart: 300, defaultTempEnd: 300, defaultPressure: 1, defaultTimestepFs: 1, defaultSteps: 20_000, defaultDumpFreq: 200 }),
  preset({ id: 'nph', name: 'NPH dynamics', label: 'NPH dynamics', code: 'fix nph · pressure control', detail: 'Integrate at constant enthalpy while controlling periodic-cell pressure.', category: 'dynamics', keywords: ['nph', 'barostat', 'enthalpy', 'fix nph', 'pressure'], icon: CircleGauge, defaultEnsemble: 'nve', defaultTempStart: 300, defaultTempEnd: 300, defaultPressure: 1, defaultTimestepFs: 1, defaultSteps: 20_000, defaultDumpFreq: 200 }),
  preset({ id: 'langevin', name: 'Langevin dynamics', label: 'Langevin dynamics', code: 'fix langevin + nve', detail: 'Apply stochastic temperature control with explicit NVE integration.', category: 'dynamics', keywords: ['langevin', 'stochastic', 'brownian', 'thermostat', 'fix langevin'], icon: Wind, defaultEnsemble: 'nve', defaultTempStart: 300, defaultTempEnd: 300, defaultPressure: 0, defaultTimestepFs: 1, defaultSteps: 20_000, defaultDumpFreq: 200 }),
  preset({ id: 'temp-berendsen', name: 'Berendsen thermostat', label: 'Berendsen thermostat', code: 'fix temp/berendsen + nve', detail: 'Relax temperature with Berendsen coupling and explicit time integration.', category: 'dynamics', keywords: ['berendsen', 'temp/berendsen', 'thermostat', 'temperature'], icon: Thermometer, defaultEnsemble: 'nve', defaultTempStart: 300, defaultTempEnd: 300, defaultPressure: 0, defaultTimestepFs: 1, defaultSteps: 20_000, defaultDumpFreq: 200 }),
  preset({ id: 'press-berendsen', name: 'Berendsen barostat', label: 'Berendsen barostat', code: 'fix press/berendsen + nve', detail: 'Relax isotropic pressure with Berendsen cell coupling.', category: 'dynamics', keywords: ['berendsen', 'press/berendsen', 'barostat', 'pressure'], icon: Gauge, defaultEnsemble: 'nve', defaultTempStart: 300, defaultTempEnd: 300, defaultPressure: 1, defaultTimestepFs: 1, defaultSteps: 20_000, defaultDumpFreq: 200 }),
  preset({ id: 'pressure-ramp', name: 'Hydrostatic pressure ramp', label: 'Pressure ramp', code: 'fix nph · pressure ramp', detail: 'Ramp isotropic pressure while conserving enthalpy in a periodic cell.', category: 'mechanical', keywords: ['hydrostatic', 'pressure', 'ramp', 'compression', 'fix nph'], icon: CircleGauge, defaultEnsemble: 'nve', defaultTempStart: 300, defaultTempEnd: 300, defaultPressure: 0, defaultTimestepFs: 1, defaultSteps: 50_000, defaultDumpFreq: 500 }),
  preset({ id: 'heating', name: 'Heating ramp', label: 'Heating ramp', code: 'fix nvt · temperature ramp', detail: 'Increase temperature continuously between two targets.', category: 'dynamics', keywords: ['heat', 'heating', 'ramp', 'fix nvt', 'temperature'], icon: Flame, defaultEnsemble: 'nvt', defaultTempStart: 300, defaultTempEnd: 1800, defaultPressure: 0, defaultTimestepFs: 1, defaultSteps: 100_000, defaultDumpFreq: 1000 }),
  preset({ id: 'cooling', name: 'Cooling / quench', label: 'Cooling / quench', code: 'fix nvt · cooling ramp', detail: 'Cool or quench a system between two target temperatures.', category: 'dynamics', keywords: ['cool', 'cooling', 'quench', 'ramp', 'temperature'], icon: Snowflake, defaultEnsemble: 'nvt', defaultTempStart: 1800, defaultTempEnd: 300, defaultPressure: 0, defaultTimestepFs: 1, defaultSteps: 100_000, defaultDumpFreq: 1000 }),
  preset({ id: 'annealing', name: 'Annealing cycle', label: 'Annealing', code: 'fix nvt · heat + hold + cool', detail: 'Run a controlled thermal cycle for structural relaxation.', category: 'dynamics', keywords: ['anneal', 'annealing', 'heat', 'hold', 'cool'], icon: RotateCcw, defaultEnsemble: 'nvt', defaultTempStart: 300, defaultTempEnd: 1200, defaultPressure: 0, defaultTimestepFs: 1, defaultSteps: 100_000, defaultDumpFreq: 1000 }),
  preset({ id: 'tensile', name: 'Tensile test', label: 'Tensile test', code: 'fix deform · uniaxial strain', detail: 'Apply uniaxial extension at a controlled engineering strain rate.', category: 'mechanical', keywords: ['tensile', 'fix deform', 'strain', 'stress', 'uniaxial'], icon: MoveDiagonal2, defaultEnsemble: 'nvt', defaultTempStart: 300, defaultTempEnd: 300, defaultPressure: 0, defaultTimestepFs: 1, defaultSteps: 50_000, defaultDumpFreq: 500 }),
  preset({ id: 'compression', name: 'Compression test', label: 'Compression test', code: 'fix deform · compressive strain', detail: 'Apply uniaxial compression along x, y, or z.', category: 'mechanical', keywords: ['compression', 'compress', 'fix deform', 'strain', 'stress'], icon: Minimize2, defaultEnsemble: 'nvt', defaultTempStart: 300, defaultTempEnd: 300, defaultPressure: 0, defaultTimestepFs: 1, defaultSteps: 50_000, defaultDumpFreq: 500 }),
  preset({ id: 'shear', name: 'Shear test', label: 'Shear test', code: 'fix deform · shear strain', detail: 'Apply affine shear in the xy, xz, or yz plane.', category: 'mechanical', keywords: ['shear', 'fix deform', 'xy', 'xz', 'yz', 'strain'], icon: Scissors, defaultEnsemble: 'nvt', defaultTempStart: 300, defaultTempEnd: 300, defaultPressure: 0, defaultTimestepFs: 1, defaultSteps: 50_000, defaultDumpFreq: 500 }),
  preset({ id: 'diffusion', name: 'Diffusion / MSD', label: 'Diffusion (MSD)', code: 'compute msd · trajectory', detail: 'Measure mean squared displacement during thermalized dynamics.', category: 'analysis', keywords: ['diffusion', 'msd', 'compute msd', 'trajectory', 'einstein'], icon: Waves, defaultEnsemble: 'nvt', defaultTempStart: 800, defaultTempEnd: 800, defaultPressure: 0, defaultTimestepFs: 1, defaultSteps: 80_000, defaultDumpFreq: 400 }),
  preset({ id: 'rdf', name: 'Radial distribution', label: 'Radial distribution', code: 'compute rdf · g(r)', detail: 'Sample pair correlations and write a radial distribution table.', category: 'analysis', keywords: ['rdf', 'radial distribution', 'compute rdf', 'pair correlation', 'g(r)'], icon: BarChart3, defaultEnsemble: 'nvt', defaultTempStart: 300, defaultTempEnd: 300, defaultPressure: 0, defaultTimestepFs: 1, defaultSteps: 20_000, defaultDumpFreq: 200 }),
  preset({ id: 'vacf', name: 'Velocity autocorrelation', label: 'Velocity autocorrelation', code: 'compute vacf · dynamics', detail: 'Sample the velocity autocorrelation function during NVE dynamics.', category: 'analysis', keywords: ['vacf', 'velocity autocorrelation', 'compute vacf', 'diffusion'], icon: Activity, defaultEnsemble: 'nve', defaultTempStart: 300, defaultTempEnd: 300, defaultPressure: 0, defaultTimestepFs: 1, defaultSteps: 20_000, defaultDumpFreq: 200 }),
  preset({ id: 'coordination', name: 'Coordination number', label: 'Coordination number', code: 'compute coord/atom', detail: 'Measure neighbor counts inside a configurable radial cutoff.', category: 'analysis', keywords: ['coordination', 'neighbors', 'compute coord/atom', 'cutoff'], icon: Network, defaultEnsemble: 'nve', defaultTempStart: 300, defaultTempEnd: 300, defaultPressure: 0, defaultTimestepFs: 1, defaultSteps: 1, defaultDumpFreq: 1 }),
  preset({ id: 'cna', name: 'Common neighbor analysis', label: 'Common neighbor analysis', code: 'compute cna/atom', detail: 'Classify local crystal environments with common-neighbor analysis.', category: 'analysis', keywords: ['cna', 'common neighbor', 'compute cna/atom', 'structure'], icon: Boxes, defaultEnsemble: 'nve', defaultTempStart: 300, defaultTempEnd: 300, defaultPressure: 0, defaultTimestepFs: 1, defaultSteps: 1, defaultDumpFreq: 1 }),
  preset({ id: 'centrosymmetry', name: 'Centrosymmetry parameter', label: 'Centrosymmetry', code: 'compute centro/atom', detail: 'Measure local inversion-symmetry breaking around each atom.', category: 'analysis', keywords: ['centro', 'centrosymmetry', 'compute centro/atom', 'defect'], icon: Crosshair, defaultEnsemble: 'nve', defaultTempStart: 300, defaultTempEnd: 300, defaultPressure: 0, defaultTimestepFs: 1, defaultSteps: 1, defaultDumpFreq: 1 }),
  preset({ id: 'voronoi', name: 'Voronoi analysis', label: 'Voronoi analysis', code: 'compute voronoi/atom', detail: 'Calculate per-atom Voronoi volume and face count.', category: 'analysis', keywords: ['voronoi', 'volume', 'faces', 'compute voronoi/atom'], icon: Hexagon, defaultEnsemble: 'nve', defaultTempStart: 300, defaultTempEnd: 300, defaultPressure: 0, defaultTimestepFs: 1, defaultSteps: 1, defaultDumpFreq: 1, requiredPackages: ['VORONOI'] }),
  preset({ id: 'stress-atom', name: 'Per-atom stress', label: 'Per-atom stress', code: 'compute stress/atom', detail: 'Write the six-component per-atom stress tensor.', category: 'analysis', keywords: ['stress', 'virial', 'compute stress/atom', 'tensor'], icon: ScanLine, defaultEnsemble: 'nve', defaultTempStart: 300, defaultTempEnd: 300, defaultPressure: 0, defaultTimestepFs: 1, defaultSteps: 1, defaultDumpFreq: 1 }),
  preset({ id: 'pe-atom', name: 'Per-atom potential energy', label: 'Potential energy / atom', code: 'compute pe/atom', detail: 'Write potential-energy contributions for every atom.', category: 'analysis', keywords: ['potential energy', 'pe/atom', 'compute pe/atom', 'per atom'], icon: Flame, defaultEnsemble: 'nve', defaultTempStart: 300, defaultTempEnd: 300, defaultPressure: 0, defaultTimestepFs: 1, defaultSteps: 1, defaultDumpFreq: 1 }),
  preset({ id: 'ke-atom', name: 'Per-atom kinetic energy', label: 'Kinetic energy / atom', code: 'compute ke/atom', detail: 'Write kinetic energy for every atom.', category: 'analysis', keywords: ['kinetic energy', 'ke/atom', 'compute ke/atom', 'per atom'], icon: Zap, defaultEnsemble: 'nve', defaultTempStart: 300, defaultTempEnd: 300, defaultPressure: 0, defaultTimestepFs: 1, defaultSteps: 1, defaultDumpFreq: 1 }),
  preset({ id: 'restart', name: 'Restart checkpoint', label: 'Restart checkpoint', code: 'restart · recoverable state', detail: 'Write periodic restart files for long local runs.', category: 'analysis', keywords: ['restart', 'checkpoint', 'continue', 'write_restart'], icon: RotateCcw, defaultEnsemble: 'nve', defaultTempStart: 300, defaultTempEnd: 300, defaultPressure: 0, defaultTimestepFs: 1, defaultSteps: 20_000, defaultDumpFreq: 1000 }),
  preset({ id: 'equilibration', name: 'NVT / NPT equilibration', label: 'Equilibration', code: 'fix nvt / npt · legacy setup', detail: 'Legacy equilibration setup retained for saved projects.', category: 'dynamics', keywords: ['equilibration', 'nvt', 'npt'], icon: Activity, defaultEnsemble: 'npt', defaultTempStart: 300, defaultTempEnd: 300, defaultPressure: 1, defaultTimestepFs: 1, defaultSteps: 20_000, defaultDumpFreq: 200, catalog: false }),
  preset({ id: 'melting', name: 'Melting / annealing', label: 'Melting / Annealing', code: 'fix nvt · legacy ramp', detail: 'Legacy temperature-ramp setup retained for saved projects.', category: 'dynamics', keywords: ['melting', 'annealing', 'temperature'], icon: Flame, defaultEnsemble: 'nvt', defaultTempStart: 300, defaultTempEnd: 1800, defaultPressure: 0, defaultTimestepFs: 1, defaultSteps: 100_000, defaultDumpFreq: 1000, catalog: false }),
];

export function filterMdSimulationRecipes(query: string): MdSimulationRecipePreset[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return MD_SIMULATION_RECIPES.filter((recipe) => recipe.catalog !== false && words.every((word) => [recipe.label, recipe.name, recipe.code, recipe.detail, recipe.category, ...recipe.keywords].join(' ').toLowerCase().includes(word)));
}

/** Legacy single-recipe configuration accepted by existing personal-compute runs. */
export interface MdSimulationConfig {
  recipeId: MdSimulationRecipeId;
  name: string;
  computeTarget: 'personal';
  units: 'metal';
  boundaryType: MdBoundaryType;
  restartEverySteps?: number;
  productionStartPs?: number;
  productionEndPs?: number;
  ensemble: MdEnsemble;
  timestepFs: number;
  totalSteps: number;
  tempStartK: number;
  tempEndK: number;
  pressureBar: number;
  velocitySeed: number;
  thermoFrequency: number;
  dumpFrequency: number;
  forceFieldId: 'lj-generic';
  epsilonEv: number;
  sigmaAngstrom: number;
  cutoffRadiusAngstrom: number;
  tensileAxis: 'x' | 'y' | 'z';
  strainRate: number;
  maxStrain: number;
  shearPlane: 'xy' | 'xz' | 'yz';
  shearRate: number;
  maxShearStrain: number;
  compressionAxis: 'x' | 'y' | 'z';
  compressionRate: number;
  maxCompressionStrain: number;
  minimizeStyle?: 'cg' | 'fire' | 'sd';
  energyTolerance?: number;
  forceTolerance?: number;
  maxIterations?: number;
  maxEvaluations?: number;
  tempDampingPs?: number;
  pressureDampingPs?: number;
  pressureEndBar?: number;
  frictionDampingPs?: number;
  rdfBins?: number;
  rdfCutoffAngstrom?: number;
  analysisCutoffAngstrom?: number;
  analysisNeighbors?: number;
  sampleFrequency?: number;
  restartLabel?: string;
  mode?: MdSimulationMode;
  manualBody?: string;
  directives?: MdDirectiveBlock[];
  potentialAssetId?: string;
}

export interface MdSimulationComponentInstance {
  id: string;
  materialId: string;
  materialName: string;
  recipeId: MdSimulationRecipeId;
  name: string;
  selected: boolean;
  config: MdSimulationConfig;
}

export type MdPotentialFamily = 'lj' | 'eam' | 'eam-alloy' | 'meam' | 'tersoff' | 'sw' | 'custom';
export type MdPotentialAssetStatus = 'UPLOAD_PENDING' | 'READY' | 'FAILED';

export interface MdPotentialFile {
  filename: string;
  role: 'potential' | 'library' | 'parameter';
  sizeBytes: number;
  sha256: string;
}

export interface MdPotentialAsset {
  id: string;
  projectId: string;
  name: string;
  family: MdPotentialFamily;
  elements: string[];
  /** Indexed MEAM model order; independent of source particle-type mapping. */
  libraryElementOrder?: string[];
  units: 'metal';
  atomStyle: string;
  citation?: string;
  license?: string;
  modelVersion?: string;
  validityDomain?: string;
  validationEvidence?: string;
  modelQualification?: 'unassessed' | 'user-documented';
  files: MdPotentialFile[];
  sizeBytes: number;
  status: MdPotentialAssetStatus;
  createdAt?: string;
  updatedAt?: string;
  integrityCheckedAt?: string;
  runtimeValidatedAt?: string;
  runtimeValidatedSimulationId?: string;
}

export type MdPotentialReference =
  | { kind: 'builtin'; id: 'lj-generic'; epsilonEv?: number; sigmaAngstrom?: number; cutoffAngstrom?: number }
  | { kind: 'project'; assetId: string };

type MdStepBase<K extends MdWorkflowStepKind, P> = { id: string; kind: K; name: string; enabled: boolean; params: P; directives?: MdDirectiveBlock[] };

export type MdWorkflowStep =
  | MdStepBase<'minimization', { style: 'cg' | 'fire' | 'sd'; energyTolerance: number; forceTolerance: number; maxIterations: number; maxEvaluations: number }>
  | MdStepBase<'velocity', { temperatureK: number; velocitySeed: number }>
  | MdStepBase<'nve', { timestepFs: number; totalSteps: number }>
  | MdStepBase<'nvt', { timestepFs: number; totalSteps: number; tempStartK: number; tempEndK: number; tempDampingPs: number }>
  | MdStepBase<'npt', { timestepFs: number; totalSteps: number; tempStartK: number; tempEndK: number; tempDampingPs: number; pressureBar: number; pressureEndBar: number; pressureDampingPs: number }>
  | MdStepBase<'nph' | 'pressure-ramp', { timestepFs: number; totalSteps: number; pressureBar: number; pressureEndBar: number; pressureDampingPs: number }>
  | MdStepBase<'langevin', { timestepFs: number; totalSteps: number; tempStartK: number; tempEndK: number; frictionDampingPs: number; velocitySeed: number }>
  | MdStepBase<'temp-berendsen', { timestepFs: number; totalSteps: number; tempStartK: number; tempEndK: number; tempDampingPs: number }>
  | MdStepBase<'press-berendsen', { timestepFs: number; totalSteps: number; pressureBar: number; pressureEndBar: number; pressureDampingPs: number }>
  | MdStepBase<'heating' | 'cooling' | 'annealing', { timestepFs: number; totalSteps: number; tempStartK: number; tempEndK: number; tempDampingPs: number }>
  | MdStepBase<'tensile', { timestepFs: number; totalSteps: number; tempStartK: number; tempEndK: number; tempDampingPs: number; axis: 'x' | 'y' | 'z'; strainRatePerSecond: number; maxStrain: number }>
  | MdStepBase<'compression', { timestepFs: number; totalSteps: number; tempStartK: number; tempEndK: number; tempDampingPs: number; axis: 'x' | 'y' | 'z'; strainRatePerSecond: number; maxStrain: number }>
  | MdStepBase<'shear', { timestepFs: number; totalSteps: number; tempStartK: number; tempEndK: number; tempDampingPs: number; shearPlane: 'xy' | 'xz' | 'yz'; strainRatePerSecond: number; maxStrain: number }>
  | MdStepBase<'diffusion', { timestepFs: number; totalSteps: number; tempStartK: number; tempEndK: number; tempDampingPs: number }>
  | MdStepBase<'rdf', { timestepFs: number; totalSteps: number; tempStartK: number; tempEndK: number; tempDampingPs: number; bins: number; cutoffAngstrom: number; sampleEvery: number }>
  | MdStepBase<'vacf', { timestepFs: number; totalSteps: number; sampleEvery: number }>
  | MdStepBase<'coordination' | 'cna', { cutoffAngstrom: number }>
  | MdStepBase<'centrosymmetry', { neighbors: number }>
  | MdStepBase<'voronoi' | 'stress-atom' | 'pe-atom' | 'ke-atom', Record<string, never>>
  | MdStepBase<'restart', { label: string }>;

export interface MdSimulationWorkflowV2 {
  version: 2;
  mode: MdSimulationMode;
  units: 'metal';
  boundaryType: MdBoundaryType;
  potential: MdPotentialReference;
  steps: MdWorkflowStep[];
  manualBody?: string;
  output: { thermoFrequency: number; dumpFrequency: number; restartEverySteps?: number; productionWindow?: { startPs: number; endPs: number } };
}

export interface MdSimulationConfiguration {
  id: string;
  projectId?: string;
  name: string;
  materialName?: string;
  workflow: MdSimulationWorkflowV2;
  createdAt: string;
  updatedAt?: string;
}

export function defaultSimulationConfig(recipeId: MdSimulationRecipeId = 'equilibration'): MdSimulationConfig {
  const recipe = MD_SIMULATION_RECIPES.find((candidate) => candidate.id === recipeId) ?? MD_SIMULATION_RECIPES[0];
  return {
    recipeId, name: recipe.name, computeTarget: 'personal', units: 'metal', boundaryType: 'p p p',
    ensemble: recipe.id === 'nve' ? 'nve' : recipe.id === 'npt' ? 'npt' : recipe.defaultEnsemble,
    timestepFs: recipe.defaultTimestepFs, totalSteps: recipe.defaultSteps, tempStartK: recipe.defaultTempStart,
    tempEndK: recipe.defaultTempEnd, pressureBar: recipe.defaultPressure, velocitySeed: 1 + crypto.getRandomValues(new Uint32Array(1))[0] % 2_147_483_646,
    thermoFrequency: Math.min(100, recipe.defaultSteps), dumpFrequency: recipe.defaultDumpFreq,
    forceFieldId: 'lj-generic', epsilonEv: 0.0103, sigmaAngstrom: 3.4, cutoffRadiusAngstrom: 8.5,
    tensileAxis: 'z', strainRate: 1e8, maxStrain: 0.2, shearPlane: 'xy', shearRate: 1e8,
    maxShearStrain: 0.2, compressionAxis: 'z', compressionRate: 1e8, maxCompressionStrain: 0.2,
    minimizeStyle: 'cg', energyTolerance: 1e-8, forceTolerance: 1e-10, maxIterations: 10_000, maxEvaluations: 100_000,
    tempDampingPs: Math.max(recipe.defaultTimestepFs * 0.1, 0.01), pressureDampingPs: Math.max(recipe.defaultTimestepFs, 0.1),
    pressureEndBar: recipe.defaultPressure, frictionDampingPs: 0.1, rdfBins: 200, rdfCutoffAngstrom: 8,
    analysisCutoffAngstrom: 3.5, analysisNeighbors: 12, sampleFrequency: 100,
    restartLabel: 'checkpoint', mode: 'guided', manualBody: '',
  };
}

function finiteBetween(value: number, minimum: number, maximum: number): boolean {
  return Number.isFinite(value) && value >= minimum && value <= maximum;
}

export function mdMechanicalStrainPlan(config: MdSimulationConfig): { ratePerSecond: number; maximum: number; planned: number } | null {
  if (!['tensile', 'shear', 'compression'].includes(config.recipeId)) return null;
  const ratePerSecond = config.recipeId === 'shear' ? config.shearRate : config.recipeId === 'compression' ? config.compressionRate : config.strainRate;
  const maximum = config.recipeId === 'shear' ? config.maxShearStrain : config.recipeId === 'compression' ? config.maxCompressionStrain : config.maxStrain;
  return { ratePerSecond, maximum, planned: ratePerSecond * 1e-12 * (config.timestepFs / 1000) * config.totalSteps };
}

export function validateMdManualBody(body: string): string {
  const text = body.trim().replace(/&[ \t]*\r?\n/g, '');
  if (!text) return 'LAMMPS input is empty.';
  if (/&[ \t]*$/.test(text)) return 'LAMMPS input ends with an incomplete continued command.';
  const forbidden = [
    { pattern: /^\s*(shell|python|plugin|clear|quit)\b/im, message: 'External execution and runtime reset commands are not allowed.' },
    { pattern: /^\s*(include|jump)\b/im, message: 'include and jump commands are not allowed.' },
    { pattern: /(?:^|\s)(?:\/[^\s]+|~(?:\/|\s)|\.\.(?:\/|\\)|[a-z][a-z0-9+.-]*:\/\/)/im, message: 'Paths outside the job workspace are not allowed.' },
    { pattern: /^\s*(units|dimension|boundary|atom_style|create_box|create_atoms|mass|read_data|read_dump|read_restart|pair_style|pair_coeff|pair_modify|pair_write|log|dump|undump|write_data|write_dump|write_restart|write_coeff|restart|thermo|thermo_style|thermo_modify|reset_timestep)\b/im, message: 'Source, potential, clock and output commands are managed by Phynite.' },
    { pattern: /^\s*if\b/im, message: 'Nested command strings are not allowed.' },
    { pattern: /^\s*run\b[^\n]*\bevery\b/im, message: 'Nested command strings are not allowed.' },
    { pattern: /^\s*variable\s+\S+\s+(?:atomfile|file|python)\b/im, message: 'Variables cannot load files or Python.' },
    { pattern: /^\s*fix\s+\S+\s+\S+\s+dt\/reset\b/im, message: 'Adaptive timestep is unsupported by the retained physical-time contract. Use fixed timesteps per stage.' },
    { pattern: /^\s*(?:fix|print|variable|info|balance)\b[^\n]*\b(?:file|append|out)\b/im, message: 'LAMMPS input cannot create unmanaged output files.' },
  ];
  const blocked = forbidden.find(({ pattern }) => pattern.test(text))?.message;
  if (blocked) return blocked;
  if (!/^\s*(?:run|minimize)\b/im.test(text)) return 'LAMMPS input must contain a run or minimize command.';
  return '';
}

export function validateMdSimulationConfig(config: MdSimulationConfig): string {
  if (config.restartEverySteps !== undefined && (!Number.isInteger(config.restartEverySteps) || config.restartEverySteps < 1 || config.restartEverySteps > 100_000_000)) return 'Use a whole periodic restart interval from 1 to 100,000,000 steps.';
  if (config.productionStartPs !== undefined || config.productionEndPs !== undefined) {
    if (!Number.isFinite(config.productionStartPs) || !Number.isFinite(config.productionEndPs) || config.productionStartPs! < 0 || config.productionEndPs! <= config.productionStartPs!) return 'Choose an explicit production end after its start, in ps.';
  }
  // A manual body overrides the typed Guided workflow. An empty manual tab still
  // compiles from Guided controls, preserving older V2 drafts without raw text.
  const hasManualOverride = Boolean((config.manualBody ?? "").trim());
  if ((config.mode === "manual" || hasManualOverride) && hasManualOverride) return validateMdManualBody(config.manualBody ?? "");
  if (config.mode === 'manual' && config.directives?.length) return validateMdDirectiveBlocks(config.directives);
  if (!finiteBetween(config.timestepFs, 0.0001, 100)) return 'Timestep must be between 0.0001 and 100 fs.';
  if (!Number.isInteger(config.totalSteps) || !finiteBetween(config.totalSteps, 1, 100_000_000)) return 'Total steps must be a positive whole number.';
  if (!Number.isInteger(config.thermoFrequency) || !finiteBetween(config.thermoFrequency, 1, Math.max(1, config.totalSteps))) return 'Thermo interval cannot exceed total steps.';
  if (!Number.isInteger(config.dumpFrequency) || !finiteBetween(config.dumpFrequency, 1, Math.max(1, config.totalSteps))) return 'Dump interval cannot exceed total steps.';
  if (!finiteBetween(config.tempStartK, 0, 100_000) || !finiteBetween(config.tempEndK, 0, 100_000)) return 'Temperature is outside the supported range.';
  if (!Number.isInteger(config.velocitySeed) || !finiteBetween(config.velocitySeed, 1, 2_147_483_646)) return 'Velocity seed must be a positive whole number.';
  if (!config.potentialAssetId) {
    if (!finiteBetween(config.epsilonEv, 1e-12, 1000)) return 'Lennard-Jones epsilon is outside the supported range.';
    if (!finiteBetween(config.sigmaAngstrom, 1e-6, 1000)) return 'Lennard-Jones sigma is outside the supported range.';
    if (!finiteBetween(config.cutoffRadiusAngstrom, config.sigmaAngstrom, 10_000)) return 'Lennard-Jones cutoff must be at least sigma.';
  }
  if (config.recipeId === 'minimization') {
    if (!['cg', 'fire', 'sd'].includes(config.minimizeStyle ?? 'cg')) return 'Minimization style is not supported.';
    if (!finiteBetween(config.energyTolerance ?? 0, 0, 1)) return 'Energy tolerance must be finite and non-negative.';
    if (!finiteBetween(config.forceTolerance ?? 0, 0, 1)) return 'Force tolerance must be finite and non-negative.';
    if (!Number.isInteger(config.maxIterations) || !finiteBetween(config.maxIterations ?? 0, 1, 100_000_000)) return 'Maximum iterations must be a positive whole number.';
    if (!Number.isInteger(config.maxEvaluations) || !finiteBetween(config.maxEvaluations ?? 0, 1, 100_000_000)) return 'Maximum evaluations must be a positive whole number.';
  }
  if (config.recipeId === 'rdf' && (!Number.isInteger(config.rdfBins) || !finiteBetween(config.rdfBins ?? 0, 2, 1_000_000))) return 'RDF bins must be a whole number of at least 2.';
  if (['coordination', 'cna'].includes(config.recipeId) && !finiteBetween(config.analysisCutoffAngstrom ?? 0, 1e-6, 10_000)) return 'Analysis cutoff is outside the supported range.';
  if (config.recipeId === 'centrosymmetry' && (!Number.isInteger(config.analysisNeighbors) || ![2, 4, 6, 8, 10, 12, 14, 16, 18, 20].includes(config.analysisNeighbors ?? 0))) return 'Centrosymmetry neighbors must be an even number from 2 to 20.';
  if (['vacf', 'rdf'].includes(config.recipeId) && (!Number.isInteger(config.sampleFrequency) || !finiteBetween(config.sampleFrequency ?? 0, 1, Math.max(1, config.totalSteps)))) return 'Sampling interval cannot exceed total steps.';
  if (config.recipeId === 'langevin' && !finiteBetween(config.frictionDampingPs ?? 0, 1e-6, 10_000)) return 'Langevin damping is outside the supported range.';
  if (config.recipeId === 'restart' && !/^[A-Za-z0-9_-]{1,60}$/.test(config.restartLabel ?? '')) return 'Restart label may use letters, numbers, dashes, and underscores.';
  const mechanicalPlan = mdMechanicalStrainPlan(config);
  if (mechanicalPlan) {
    if (!finiteBetween(mechanicalPlan.ratePerSecond, 1e-12, 1e18)) return 'Strain rate is outside the supported range.';
    if (!finiteBetween(mechanicalPlan.maximum, 1e-9, 10)) return 'Maximum strain is outside the supported range.';
    if (mechanicalPlan.planned > mechanicalPlan.maximum * (1 + 1e-9)) return `This run would reach ${mechanicalPlan.planned.toPrecision(4)} strain, above the ${mechanicalPlan.maximum.toPrecision(4)} safety limit.`;
  }
  if ((config.ensemble === 'npt' || config.recipeId === 'npt') && config.boundaryType !== 'p p p') return 'NPT requires periodic boundaries in all directions.';
  if (['nph', 'press-berendsen', 'pressure-ramp'].includes(config.recipeId) && config.boundaryType !== 'p p p') return 'Pressure control requires periodic boundaries in all directions.';
  return '';
}

export function mdWorkflowToComponents(workflow: MdSimulationWorkflowV2, materialId = 'active-structure', materialName = 'Current structure'): MdSimulationComponentInstance[] {
  return workflow.steps.map((step) => {
    const config = defaultSimulationConfig(step.kind);
    config.boundaryType = workflow.boundaryType;
    config.thermoFrequency = workflow.output.thermoFrequency;
    config.dumpFrequency = workflow.output.dumpFrequency;
    config.restartEverySteps = workflow.output.restartEverySteps;
    config.productionStartPs = workflow.output.productionWindow?.startPs;
    config.productionEndPs = workflow.output.productionWindow?.endPs;
    config.mode = workflow.mode === 'manual' ? 'manual' : 'guided';
    config.manualBody = workflow.manualBody ?? '';
    config.directives = step.directives?.length ? structuredClone(step.directives) : undefined;
    if (workflow.potential.kind === 'project') config.potentialAssetId = workflow.potential.assetId;
    else {
      config.epsilonEv = workflow.potential.epsilonEv ?? config.epsilonEv;
      config.sigmaAngstrom = workflow.potential.sigmaAngstrom ?? config.sigmaAngstrom;
      config.cutoffRadiusAngstrom = workflow.potential.cutoffAngstrom ?? config.cutoffRadiusAngstrom;
    }
    switch (step.kind) {
      case 'minimization':
        config.minimizeStyle = step.params.style;
        config.energyTolerance = step.params.energyTolerance;
        config.forceTolerance = step.params.forceTolerance;
        config.maxIterations = step.params.maxIterations;
        config.maxEvaluations = step.params.maxEvaluations;
        break;
      case 'velocity':
        config.tempStartK = step.params.temperatureK;
        config.tempEndK = step.params.temperatureK;
        config.velocitySeed = step.params.velocitySeed;
        break;
      case 'restart':
        config.restartLabel = step.params.label;
        break;
      case 'coordination':
      case 'cna':
        config.analysisCutoffAngstrom = step.params.cutoffAngstrom;
        break;
      case 'centrosymmetry':
        config.analysisNeighbors = step.params.neighbors;
        break;
      case 'voronoi':
      case 'stress-atom':
      case 'pe-atom':
      case 'ke-atom':
        break;
      default:
        config.timestepFs = step.params.timestepFs;
        config.totalSteps = step.params.totalSteps;
        if ('tempStartK' in step.params) config.tempStartK = step.params.tempStartK;
        if ('tempEndK' in step.params) config.tempEndK = step.params.tempEndK;
        if ('tempDampingPs' in step.params) config.tempDampingPs = step.params.tempDampingPs;
        if (step.kind === 'npt' || step.kind === 'nph' || step.kind === 'pressure-ramp' || step.kind === 'press-berendsen') {
          config.pressureBar = step.params.pressureBar;
          config.pressureEndBar = step.params.pressureEndBar;
          config.pressureDampingPs = step.params.pressureDampingPs;
        } else if (step.kind === 'langevin') {
          config.frictionDampingPs = step.params.frictionDampingPs;
          config.velocitySeed = step.params.velocitySeed;
        } else if (step.kind === 'tensile') {
          config.tensileAxis = step.params.axis;
          config.strainRate = step.params.strainRatePerSecond;
          config.maxStrain = step.params.maxStrain;
        } else if (step.kind === 'compression') {
          config.compressionAxis = step.params.axis;
          config.compressionRate = step.params.strainRatePerSecond;
          config.maxCompressionStrain = step.params.maxStrain;
        } else if (step.kind === 'shear') {
          config.shearPlane = step.params.shearPlane;
          config.shearRate = step.params.strainRatePerSecond;
          config.maxShearStrain = step.params.maxStrain;
        } else if (step.kind === 'rdf') {
          config.rdfBins = step.params.bins;
          config.rdfCutoffAngstrom = step.params.cutoffAngstrom;
          config.sampleFrequency = step.params.sampleEvery;
        } else if (step.kind === 'vacf') {
          config.sampleFrequency = step.params.sampleEvery;
        }
    }
    return { id: step.id, materialId, materialName, recipeId: step.kind, name: step.name, selected: step.enabled, config: { ...config, name: step.name } };
  });
}

export function createSimulationComponentInstance(recipeId: MdSimulationRecipeId, materialId = 'active-structure', materialName = 'Current structure'): MdSimulationComponentInstance {
  const config = defaultSimulationConfig(recipeId);
  const componentId = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${recipeId}`;
  return { id: `md-comp-${componentId}`, materialId, materialName, recipeId, name: config.name, selected: true, config };
}

export type { MdRuntimeManifest } from './phynite-api.ts';

export function createMdSimulationWorkflowV2(components: MdSimulationComponentInstance[], options: Partial<Pick<MdSimulationWorkflowV2, 'mode' | 'boundaryType' | 'potential' | 'manualBody' | 'output'>> = {}): MdSimulationWorkflowV2 {
  return compileMdSimulationWorkflow(components, options, components[0]?.config ?? defaultSimulationConfig('nvt'));
}

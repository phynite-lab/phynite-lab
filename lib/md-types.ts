import type { CellVector, CellVectors } from './crystal-cell';
import type { MdSimulationWorkflowV2 } from './md-simulation-types';

export type MdFrame = {
  geometryProvenance?: unknown[];
  index: number;
  timestep: number | null;
  time: number | null;
  ids: string[];
  species: string[];
  positions: number[];
  properties: Record<string, number[]>;
  /** Source labels are retained separately from numeric analysis properties. */
  stringProperties?: Record<string, string[]>;
  vectors: CellVectors;
  origin: CellVector;
  periodic: [boolean, boolean, boolean];
  hasCell: boolean;
  /** Geometry is always Å and physical time is ps; other properties retain source units. */
  sourceUnits?: string;
  nativeTime?: number | null;
  coordinateMode?: 'wrapped' | 'unwrapped' | 'unknown';
  propertyUnits?: { velocity?: 'angstrom/ps'; mass?: 'amu' };
  /** Element defaults are amu; explicit source masses require source units. */
  massProvenance?: 'element-database' | 'source-explicit' | 'unknown' | null;
};
export type MdIndex = { format: 'lammps' | 'xyz' | 'structure' | 'ovito' | 'phynite-frame'; offsets: number[]; name: string; warnings: string[] };
export type MdModifierKind = 'ptm' | 'cna' | 'dxa' | 'rdf' | 'surface' | 'centrosymmetry' | 'strain' | 'cluster' | 'coordination' | 'bonds' | 'replicate' | 'supercell' | 'surface_slab' | 'slice' | 'expression' | 'wrap';
export type MdModifier = { id: string; kind: MdModifierKind; enabled: boolean; params: Record<string, number | string | boolean | number[]> };
export type MdAnalysis = {
  frame: MdFrame;
  attributes: Record<string, number | string>;
  phases: Array<{ id: number; name: string; color: string; count: number }>;
  rdf: Array<[number, number]>;
  bonds: Array<[number, number]>;
  dislocations: Array<{ points: number[][]; burgers: number[]; length: number; color?: string }>;
  surface: { vertices: number[][]; faces: number[][] } | null;
  warnings: string[];
  engine: string;
};
export type MdSettings = {
  modifiers: MdModifier[]; colorBy: string; palette: 'viridis' | 'coolwarm' | 'turbo' | 'jet';
  atomScale: number; showCell: boolean; showBonds: boolean; hideBulk: boolean;
  periodic?: [boolean, boolean, boolean]; timeStepPs: number | null; fps: number; loop: boolean; typeMap: Record<string, string>;
};
export type MdCloudLink = {
  trajectoryId: string;
  projectId: string;
  sha256: string;
  uploadedAt: string;
  settingsSignature: string;
  revision?: number;
};
export type MdSyncState = 'local' | 'pending' | 'synced' | 'conflict';
export type MdTrajectoryRecord = {
  id: string;
  owner: string;
  /** Legacy device records store the project name here; cloud-backed records use the cloud project id. */
  projectId: string;
  projectName?: string;
  name: string;
  sourceFilename?: string;
  file: Blob;
  createdAt: string;
  settings: MdSettings;
  simulationWorkflow?: MdSimulationWorkflowV2;
  cloud?: MdCloudLink;
  syncState?: MdSyncState;
  syncError?: string;
};
export const defaultMdSettings = (): MdSettings => ({ modifiers: [], colorBy: 'Species', palette: 'viridis', atomScale: 1, showCell: true, showBonds: true, hideBulk: false, timeStepPs: null, fps: 15, loop: true, typeMap: {} });
export const mdModifierCatalog: Record<MdModifierKind, { label: string; description: string; params: MdModifier['params']; engine: boolean }> = {
  ptm: { label: 'Polyhedral template matching', description: 'Identify FCC, HCP, BCC, diamond, and other local structures.', params: { rmsd: 0.12 }, engine: true },
  cna: { label: 'Common neighbor analysis', description: 'Classify local structure by neighbor topology.', params: { mode: 'adaptive', cutoff: 3.5 }, engine: true },
  dxa: { label: 'Dislocation analysis', description: 'Extract line geometry and Burgers vectors.', params: { lattice: 'FCC' }, engine: true },
  rdf: { label: 'Radial distribution function', description: 'Pair correlation g(r) for a bulk periodic cell.', params: { cutoff: 5, bins: 100 }, engine: false },
  surface: { label: 'Surface & void mesh', description: 'Alpha-shape surface reconstruction.', params: { radius: 2.8 }, engine: true },
  centrosymmetry: { label: 'Centrosymmetry', description: 'Measure local inversion symmetry.', params: { neighbors: 12 }, engine: true },
  strain: { label: 'Atomic strain', description: 'Shear and volumetric strain relative to a reference frame.', params: { cutoff: 3.2, referenceFrame: 0 }, engine: true },
  cluster: { label: 'Cluster analysis', description: 'Identify groups connected within a distance cutoff.', params: { cutoff: 3 }, engine: true },
  coordination: { label: 'Coordination number', description: 'Count neighbors within a distance cutoff.', params: { cutoff: 3.2 }, engine: false },
  bonds: { label: 'Create neighbor bonds', description: 'Connect pairs within a chosen distance.', params: { cutoff: 2.8 }, engine: false },
  supercell: { label: 'Supercell matrix', description: 'Integer 3×3 transformation preserving atom provenance.', params: { matrix: [2,0,0,0,2,0,0,0,2] }, engine: false },
  surface_slab: { label: 'Miller surface slab', description: 'Atomic layers, termination and vacuum; open boundary along the surface normal.', params: { miller: [0,0,1], layers: 4, vacuumAngstrom: 15, termination: 0 }, engine: false },
  replicate: { label: 'Replicate cell', description: 'Repeat atoms and cell in the visualized result.', params: { repeat: [2, 2, 1] }, engine: false },
  slice: { label: 'Slice plane', description: 'Keep one side of an oriented Cartesian plane.', params: { normal: [0, 0, 1], distance: 0, reverse: false }, engine: false },
  expression: { label: 'Expression selection', description: 'Select or remove atoms using property comparisons.', params: { expression: 'Position.Z > 0', action: 'select' }, engine: false },
  wrap: { label: 'Wrap periodic images', description: 'Bring positions inside periodic cell boundaries.', params: {}, engine: false },
};

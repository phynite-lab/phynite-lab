export type TrajectorySummary = {
  id: string;
  filename: string;
  sizeBytes: number;
  category?: string;
  projectId?: string;
  format?: string;
  storage?: 'cloud' | 'device';
};

export type TrajectoryInfo = {
  filename: string;
  path: string;
  numFrames: number;
  numParticles: number;
  properties: string[];
  cellMatrix: number[][];
  pbc: boolean[];
  currentConfig: {
    modifiers: ModifierItem[];
    colorProperty: string;
    colormap?: string;
  };
};

export type DislocationLine = {
  points: number[][]; // [[x, y, z], ...]
  burgersVector: number[];
  type: string;
  color: number[]; // [r, g, b]
  length: number;
};

export type DislocationData = {
  lines: DislocationLine[];
  totalLineLength: number;
  dislocationDensity: number;
};

export type SurfaceMesh = {
  vertices: number[][]; // [[x, y, z], ...]
  faces: number[][];    // [[i, j, k], ...]
  surfaceArea: number;
  solidVolume: number;
};

export type RdfPoint = {
  r: number;
  g_r: number;
};

export type HistogramBin = {
  x0: number;
  x1: number;
  count: number;
  colorHex: string;
};

export type ScalarRange = {
  min: number;
  max: number;
  property: string;
  colormap?: string;
  histogram?: HistogramBin[];
};

export type FrameData = {
  ids: string[];
  species: string[];
  phaseLabels: Record<number, string>;
  phaseColors: Record<string, string>;
  bulkStructureType?: number;
  frame: number;
  totalFrames: number;
  numParticles: number;
  positions: number[]; // Flat [x0, y0, z0, x1, y1, z1, ...]
  colors: number[];    // Flat [r0, g0, b0, r1, g1, b1, ...]
  radii?: number[];    // Per-particle atomic radius [r0, r1, r2, ...]
  types: number[];
  structureTypes: number[];
  phaseCounts: Record<string, number>;
  speciesCounts?: Record<string, number>;
  scalarValues?: number[];
  scalarRange?: ScalarRange | null;
  selection?: number[]; // 1 if selected, 0 if unselected
  cell: {
    matrix: number[][];
    pbc: boolean[];
  };
  dislocations?: DislocationData | null;
  surface?: SurfaceMesh | null;
  rdf?: RdfPoint[];
  bonds?: number[][] | null; // [[atom_i, atom_j], ...]
  attributes: Record<string, number | string>;
};

export type ModifierType =
  | 'wrap'
  | 'ptm'
  | 'cna'
  | 'dxa'
  | 'rdf'
  | 'surface'
  | 'expression'
  | 'slice'
  | 'centrosymmetry'
  | 'strain'
  | 'cluster'
  | 'coordination'
  | 'bonds'
  | 'supercell'
  | 'surface_slab'
  | 'replicate';

export type ModifierItem = {
  id?: string;
  type: ModifierType;
  enabled: boolean;
  params: { [key: string]: string | number | boolean | number[] | undefined; numX?: number; numY?: number; numZ?: number; rmsdCutoff?: number; crystalStructure?: string; cutoff?: number; bins?: number; radius?: number; neighbors?: number; referenceFrame?: number; normal?: number[]; distance?: number; reverse?: boolean; mode?: string; expression?: string; action?: string; };
};

export type TimelineMetric = {
  frame: number;
  timestep: number;
  phases: Record<string, number>;
  avgPotentialEnergy?: number | null;
  dislocationDensity?: number;
};

export type TrajectoryMetrics = {
  trajectoryId: string;
  numFrames: number;
  timeline: TimelineMetric[];
};

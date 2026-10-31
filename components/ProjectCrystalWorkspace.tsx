'use client';
import { WorkspaceLoading } from '@/components/WorkspaceLoading';

import { CrystalBuilderEditor } from './CrystalBuilderEditor';
import { WorkflowOperationDialog } from '@/components/WorkflowOperationDialog';
import { applyWorkflowGeometry } from '@/lib/workflow-geometry';
import { sweepDrafts, generateNebInput } from '@/lib/workflow-operations';
import { datasetFromText } from '@/lib/research-figures';
import { saveResearch } from '@/lib/research-storage';

import { guidePath } from '@/lib/guide-routing';
import { ANALYSES, connectWorkflow, defaultWorkflowCanvas, inheritedAnalysisDraft, migrateWorkflow, remapWorkflowComponents, structureNodeId, workflowOrder, editWorkflow, undoWorkflow, redoWorkflow, type DftWorkflowCanvas as WorkflowCanvasState, type WorkflowDocument, type WorkflowHistory, type WorkflowClipboard, type WorkflowMaterial, type WorkflowPoint } from '@/lib/dft-workflow';
import { phyniteWorkflowRuns, type DftWorkflowRequest } from '@/lib/phynite-api';
import '@/app/dft-workflow.css';
import { AnimatePresence, motion, useDragControls } from 'framer-motion';
import { strToU8, zipSync } from 'fflate';
import {
  Axis3D,
  Box,
  Boxes,
  ChevronRight,
  CircleHelp,
  Info,
  CirclePlus,
  CircleDot,
  Copy,
  Crosshair,
  DatabaseSearch,
  Eye,
  FileDown,
  FolderKanban,
  Grid3X3,
  LockKeyhole,
  ListFilter,
  Maximize2,
  Moon,
  MousePointer2,
  Move3D,
  Menu,
  Play,
  Redo2,
  Ruler,
  Search,
  SlidersHorizontal,
  Sun,
  Trash2,
  Undo2,
  Upload,
  X,
  type LucideIcon,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, type DragEvent as ReactDragEvent } from 'react';
import { startBrowserPoll } from '@/lib/browser-poll';
import type { CameraViewRequest } from '@/components/CrystalEditorViewport';
import { editCrystalCell } from '@/lib/crystal-editor';
import { CrystalStructureEditor } from '@/components/CrystalStructureEditor';
import { CrystalDisplayPanel, type CrystalDisplaySettings } from '@/components/CrystalDisplayPanel';
import type { CrystalSceneExporter } from '@/components/CrystalSceneExport';
import { crystalScalarColors } from '@/lib/crystal-builder';
import { mdTransferKey, readMdTransfer } from '@/lib/md-workspace';
import {
  clampRightPanelWidth,
  getDynamicRightPanelMaxWidth,
  RIGHT_PANEL_DEFAULT_WIDTH,
  RIGHT_PANEL_MIN_WIDTH,
} from '@/lib/workspace-panel';
import '@/app/crystal-builder.css';
import type { CustomAtom, LatticeParameters } from '@/components/CrystalViewer';
import { appearanceFor, atomInstanceId, cellOffsetFromAtomInstance } from '@/lib/crystal-render-model';
import { LAB_VIEW_PRESETS, type LabViewPresetId } from '@/lib/lab-camera';
import { CalculationConfigDrawer } from '@/components/CalculationConfigDrawer';
import dynamic from 'next/dynamic';
import { addCellVacuum, cellVolume, changeCellMetric, type CellMetric } from '@/lib/crystal-cell';
import { readComputeResources } from '@/lib/compute-resources';
import { AccountMenu } from '@/app/lab-header';
import { useSiteTheme } from '@/app/use-site-theme';
import type { PhyniteSession } from '@/app/auth-client';
import { WorkspaceProductHeader } from '@/components/WorkspaceProductHeader';
import { WorkspaceAssetGate, WorkspaceProjectGate } from '@/components/WorkspaceProjectGate';
import { DftProjectStructureSidebar } from '@/components/DftProjectStructureSidebar';
import { useResearchShell, useResearchNavigation } from './ResearchShellContext';
import { LabViewAngleMenu } from '@/components/LabViewAngleMenu';
const CrystalEditorViewport = dynamic(() => import('@/components/CrystalEditorViewport').then((module) => module.CrystalEditorViewport), { ssr: false, loading: () => <WorkspaceLoading label="Loading crystal view…" /> });
const FiguresWorkspace = dynamic(() => import('@/components/FiguresWorkspace').then((module) => module.FiguresWorkspace), { loading: () => <WorkspaceLoading label="Opening Figure Lab…" /> });
const DftWorkflowCanvas = dynamic(() => import('@/components/DftWorkflowCanvas').then(module => module.DftWorkflowCanvas), { ssr: false, loading: () => <div className="workspace-loading">Opening workflow...</div> });
import { CalculationPanel, type CalculationComponentInstance } from '@/components/CalculationPanel';
import { CommittedNumberInput } from '@/components/CommittedNumberInput';
import { CellRepeatControl, type CellRepeat } from '@/components/CellRepeatControl';
import { ElementPalette } from '@/components/ElementPalette';
import { generateQuantumEspressoInputFiles, summarizeJobDraft, type Accuracy, type CalculationConfiguration, type CalculationType, type JobDraft, type MaterialContext } from '@/components/JobComposer';
import { reciprocalPathSubmission } from '@/lib/reciprocal-path';
import { resolveQeAdaptiveParameters, resolveQeWorkflowParameters } from '@/lib/qe-adaptive';
import type { ScientificPlotSettings } from '@/lib/result-plot';
import { MaterialsProjectBrowser, type MaterialsProjectMaterial } from '@/components/MaterialsProjectBrowser';
import { UiSelect } from '@/components/UiSelect';
import { LabInspectorSection, LabSwitch } from '@/components/LabControls';
import { useWorkspaceSaveShortcut } from '@/components/use-workspace-save-shortcut';
import { StudyEvidenceDialog } from '@/components/StudyEvidenceDialog';
import { applyQeAccuracy, createDefaultQeDraft } from '@/lib/qe-defaults';
import { qeConvergenceDescription, qeRelaxationConverged, qeResultAccepted } from '@/lib/qe-convergence';
import { qeSubmissionSettings, qeExecutionIdentity } from '@/lib/qe-workflow';
import { resolveQeStructure } from '@/lib/qe-structure';
import { STRUCTURE_FILE_ACCEPT, cartesianToFractional, cellVectorsFromLattice, createCIF, createPOSCAR, createXSF, createXYZ, fractionalToCartesian, isSupportedStructureFileName, latticeFromCellVectors, parseStructureText } from '@/lib/structure-parsers';
import { cn } from '@/lib/utils';
import {
  canMergeBackendCalculation,
  createExecutionJobId,
  duplicateExecutionJobIds,
  ensureUniqueExecutionJobIds,
  reusableDependencyExecution,
  resultManifestMatchesCalculation,
  completedExecutionAccepted,
} from '@/lib/execution-jobs';
import { electronicReferenceFingerprint } from '@/lib/electronic-plot-pairing';
import { calculationNavigationUrl, canHydrateCalculationWorkspace, resolveCalculationNavigation, resolveCalculationProjectSelection, type CalculationView } from '@/lib/calculation-navigation';
import {
  PhyniteApiError,
  phyniteCalculations,
  phyniteProjects,
  phyniteStructures,
  type PhyniteCalculation,
  type PhyniteResultArtifact,
  type PhyniteResultManifest,
} from '@/lib/phynite-api';
import {
  CALCULATION_WORKSPACE_STORAGE_KEY,
  notifyCalculationWorkspaceChange,
} from '@/lib/workspace-storage';
import { moveItemById, reorderItemsById } from '@/lib/ordered-items';

type ToolId = 'select' | 'move' | 'measure' | 'add' | 'delete';
type ViewAngleId = LabViewPresetId;
type JobStatus = 'Draft' | 'Completed' | 'Running' | 'Queued' | 'Failed' | 'Cancelled';
type RightTab = 'structure' | 'calculations';
type MoveSpace = 'world' | 'local';
type MoveConstraint = 'free' | 'x' | 'y' | 'z' | 'xy' | 'xz' | 'yz';
type CoordinateMode = 'fractional' | 'cartesian' | 'delta';
type MeasureMode = 'atom' | 'distance' | 'angle';
type ElementPaletteMode = 'add' | 'substitute';
type CloudSyncState = {
  status: 'idle' | 'syncing' | 'synced' | 'error';
  sizeBytes: number;
  lastSyncedAt: string;
  flush: () => Promise<void>;
};
type MeasurementSelection = { atomId: string; instanceId: string };
type ConfirmationState = {
  title: string;
  description: string;
  confirmLabel: string;
  tone?: 'default' | 'danger';
};

type MaterialViewSettings = CrystalDisplaySettings;

type MaterialRecord = {
  geometryProvenance?: unknown[];
  id: string;
  databaseId: string;
  projectId: string;
  name: string;
  formula: string;
  spaceGroup: string;
  kind: string;
  atoms: CustomAtom[];
  lattice: LatticeParameters;
  source?: 'Local' | 'Materials Project';
  externalId?: string;
  sourceUpdatedAt?: string | null;
  geometryUpdatedAt?: string;
  sourceGeometryUpdatedAt?: string;
  bandGap?: number;
  energyAboveHull?: number;
  sourceFileName?: string;
  viewSettings?: MaterialViewSettings;
  createdAt?: string;
  updatedAt?: string;
  lastOpenedAt?: string;
  remoteId?: string;
};

type CrystalDatabase = {
  id: string;
  name: string;
  description: string;
};

type ResearchProject = {
  id: string;
  databaseId: string;
  name: string;
  description: string;
  createdAt?: string;
  updatedAt?: string;
  lastOpenedAt?: string;
  remoteId?: string;
};

type JobRecord = {
  sweepValue?: number; workflowRunId?: string; totalEnergyRy?: number;
  computeResources?: import('@/lib/compute-resources').ComputeResources;
  id: string;
  componentId?: string;
  calculationType?: string;
  relaxationConverged?: boolean;
  scientificAccepted?: boolean;
  name: string;
  databaseId: string;
  database: string;
  materialId: string;
  material: string;
  engine: string;
  status: JobStatus;
  progress: number;
  updated: string;
  settings: string;
  startedAt?: string;
  completedAt?: string;
  duration?: string;
  result?: string;
  resultDetail?: string;
  liveLogTail?: string;
  scfConvergence?: import('@/lib/qe-live-scf').ScfConvergence;
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
  resultArtifacts?: PhyniteResultArtifact[];
  bandGapEv?: number;
  electronicCharacter?: string;
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
};

type HistorySnapshot = {
  atoms: CustomAtom[];
  rotation: [number, number, number];
  lattice: LatticeParameters;
};

const emptyLattice: LatticeParameters = { a: 1, b: 1, c: 1, alpha: 90, beta: 90, gamma: 90 };
const MAX_REPEAT_AXIS = 8;
const MAX_DISPLAYED_ATOMS = 1600;
const defaultMaterialViewSettings: MaterialViewSettings = {
  displayStyle: 'ball-stick',
  showBonds: true,
  showCell: true,
  showLabels: false,
  showForces: false,
  atomScale: 0.95,
  bondScale: 1.1,
  bondCutoff: 0,
  forceScale: 2.5,
  supercell: [1, 1, 1],
};

function resolveMaterialViewSettings(
  settings?: Partial<MaterialViewSettings>,
): MaterialViewSettings {
  const repeat = Array.isArray(settings?.supercell) && settings.supercell.length === 3
    ? settings.supercell.map((value) => Math.max(1, Math.min(MAX_REPEAT_AXIS, Math.round(Number(value) || 1)))) as CellRepeat
    : defaultMaterialViewSettings.supercell;

  return {
    displayStyle: settings?.displayStyle === 'spacefill' || settings?.displayStyle === 'wireframe' ? settings.displayStyle : 'ball-stick',
    showBonds: typeof settings?.showBonds === 'boolean' ? settings.showBonds : defaultMaterialViewSettings.showBonds,
    showCell: typeof settings?.showCell === 'boolean' ? settings.showCell : defaultMaterialViewSettings.showCell,
    showLabels: typeof settings?.showLabels === 'boolean' ? settings.showLabels : defaultMaterialViewSettings.showLabels,
    showForces: typeof settings?.showForces === 'boolean' ? settings.showForces : defaultMaterialViewSettings.showForces,
    atomScale: Number.isFinite(settings?.atomScale) ? Number(settings?.atomScale) : defaultMaterialViewSettings.atomScale,
    bondScale: Number.isFinite(settings?.bondScale) ? Number(settings?.bondScale) : defaultMaterialViewSettings.bondScale,
    bondCutoff: Number.isFinite(settings?.bondCutoff) ? Math.max(0, Number(settings?.bondCutoff)) : defaultMaterialViewSettings.bondCutoff,
    forceScale: Number.isFinite(settings?.forceScale) ? Number(settings?.forceScale) : defaultMaterialViewSettings.forceScale,
    supercell: [...repeat] as CellRepeat,
  };
}

const initialMaterials: MaterialRecord[] = [];

const initialDatabases: CrystalDatabase[] = [
  { id: 'db-workspace', name: 'Workspace', description: 'Local projects and structures' },
];

const initialProjects: ResearchProject[] = [];
const initialJobs: JobRecord[] = [];
type WorkspaceSnapshot = {
  version: 1;
  activeDatabaseId: string;
  activeProjectId: string;
  activeMaterialId: string;
  projects: ResearchProject[];
  materials: MaterialRecord[];
  jobs: JobRecord[];
  calculationConfigurations: CalculationConfiguration[];
  calculationComponents: CalculationComponentInstance[];
  projectTrash?: unknown[];
  workflowCanvases?: Record<string, WorkflowCanvasState>;
  workflowRunIds?: Record<string, string>;
  workflowPending?: Record<string, { fingerprint: string; projectId: string; request: DftWorkflowRequest }>;
  jobDraft: JobDraft;
  savedAt?: string;
};

const workspaceTimestamp = () => new Date().toISOString();

function normalizeLifecycle<T extends {
  createdAt?: string;
  updatedAt?: string;
  lastOpenedAt?: string;
}>(record: T, fallback: string): T {
  const createdAt = record.createdAt ?? fallback;
  const updatedAt = record.updatedAt ?? createdAt;
  return {
    ...record,
    createdAt,
    updatedAt,
    lastOpenedAt: record.lastOpenedAt ?? updatedAt,
  };
}

function normalizeJobDraft(draft: JobDraft): JobDraft {
  return {
    ...draft,
    occupationPolicy: draft.occupationPolicy ?? 'auto',
    cutoffPolicy: draft.cutoffPolicy ?? 'auto',
    // Old generated collinear inputs always had tot_magnetization. Preserve that explicit state.
    magnetizationConstraint: draft.magnetizationConstraint ?? (draft.soc || draft.noncollinear ? 'unconstrained' : 'total'),
  };
}

function normalizeMaterialLifecycle(record: MaterialRecord, fallback: string): MaterialRecord {
  const normalized = normalizeLifecycle(record, fallback);
  return {
    ...normalized,
    geometryUpdatedAt: normalized.geometryUpdatedAt ?? normalized.updatedAt,
  };
}

function formatWorkspaceTimestamp(value?: string) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not recorded';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatProjectSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;

  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

const elementNames: Record<string, string> = {
  H: 'Hydrogen', C: 'Carbon', N: 'Nitrogen', O: 'Oxygen', Al: 'Aluminium', Si: 'Silicon',
  P: 'Phosphorus', S: 'Sulfur', Ti: 'Titanium', Fe: 'Iron', Ga: 'Gallium', As: 'Arsenic', Mo: 'Molybdenum',
};

const tools: Array<{ id: ToolId; label: string; shortcut?: string; icon: LucideIcon; dividerBefore?: boolean }> = [
  { id: 'select', label: 'Select', shortcut: 'V', icon: MousePointer2 },
  { id: 'measure', label: 'Measure', shortcut: 'M', icon: Ruler },
  { id: 'move', label: 'Move atom', shortcut: 'G', icon: Move3D, dividerBefore: true },
  { id: 'add', label: 'Add atom', shortcut: 'A', icon: CirclePlus },
  { id: 'delete', label: 'Delete atoms', shortcut: 'Del', icon: Trash2 },
];

const viewAngles = LAB_VIEW_PRESETS;

function cloneAtoms(atoms: CustomAtom[]) {
  return atoms.map((atom) => ({
    ...atom,
    siteSpecies: atom.siteSpecies?.map((entry) => ({ ...entry })),
  }));
}

function nextAvailableId(prefix: string, ids: string[]) {
  let index = ids.length + 1;
  while (ids.includes(`${prefix}-${index}`)) index += 1;
  return `${prefix}-${index}`;
}

function cellOffsetFromInstance(atomId: string, instanceId: string): [number, number, number] {
  return cellOffsetFromAtomInstance(atomId, instanceId);
}

type CartesianPoint = [number, number, number];
type MeasuredAtomCoordinate = {
  instanceId: string;
  name: string;
  species: string;
  fractional: CartesianPoint;
  cartesian: CartesianPoint;
};
type MeasurementResult = {
  mode: MeasureMode;
  species: string[];
  value?: number;
};

function vectorBetween(left: CartesianPoint, right: CartesianPoint): CartesianPoint {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function vectorDot(left: CartesianPoint, right: CartesianPoint) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function vectorLength(vector: CartesianPoint) {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

function normalized(vector: CartesianPoint): CartesianPoint {
  const length = vectorLength(vector) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function angleBetween(left: CartesianPoint, center: CartesianPoint, right: CartesianPoint) {
  const a = normalized(vectorBetween(left, center));
  const b = normalized(vectorBetween(right, center));
  return Math.acos(Math.max(-1, Math.min(1, vectorDot(a, b)))) * 180 / Math.PI;
}

function measurementTargetCount(mode: MeasureMode): 1 | 2 | 3 {
  if (mode === 'atom') return 1;
  return mode === 'distance' ? 2 : 3;
}

function resolveMeasurementPoint(
  selection: MeasurementSelection,
  atoms: CustomAtom[],
  lattice: LatticeParameters,
): { atom: CustomAtom; fractional: CartesianPoint; cartesian: CartesianPoint } | null {
  const atom = atoms.find((item) => item.id === selection.atomId);
  if (!atom) return null;
  const offset = cellOffsetFromInstance(atom.id, selection.instanceId);
  const fractional: CartesianPoint = [atom.x + offset[0], atom.y + offset[1], atom.z + offset[2]];
  return {
    atom,
    fractional,
    cartesian: fractionalToCartesian({ x: fractional[0], y: fractional[1], z: fractional[2] }, lattice),
  };
}

function measurementResultFor(
  mode: MeasureMode,
  selection: MeasurementSelection[],
  atoms: CustomAtom[],
  lattice: LatticeParameters,
): MeasurementResult | null {
  if (selection.length !== measurementTargetCount(mode)) return null;
  const points = selection.map((entry) => resolveMeasurementPoint(entry, atoms, lattice));
  if (points.some((entry) => !entry)) return null;
  const resolved = points as Array<NonNullable<(typeof points)[number]>>;
  const species = resolved.map((entry) => entry.atom.label?.trim() || entry.atom.species);
  if (mode === 'atom') return { mode, species };
  if (mode === 'distance') {
    return {
      mode,
      species,
      value: vectorLength(vectorBetween(resolved[0].cartesian, resolved[1].cartesian)),
    };
  }
  return {
    mode,
    species,
    value: angleBetween(resolved[0].cartesian, resolved[1].cartesian, resolved[2].cartesian),
  };
}

function MeasurementResultView({ result }: { result: MeasurementResult }) {
  const label = result.mode === 'distance' ? 'Distance' : 'Angle';
  const unit = result.mode === 'distance' ? 'Å' : '°';
  return <motion.div key={`${result.mode}-${result.value}`} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.12 }} className="mt-2 rounded-[6px] border border-[#303030] bg-[#111111] p-2.5">
    <div className="flex items-end justify-between gap-3">
      <span className="min-w-0">
        <span className="block text-[10px] font-semibold uppercase tracking-[.08em] text-[#8e8e93]">Atoms</span>
        <span className="mt-1 flex min-w-0 items-center gap-1.5 overflow-hidden">{result.species.map((species, index) => <span key={`${species}-${index}`} className="contents"><span className="shrink-0 font-mono text-[11px] font-medium text-[#ededed]">{index + 1} · {species}</span>{index < result.species.length - 1 && <span className="text-[10px] text-[#71717a]">—</span>}</span>)}</span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-[10px] font-semibold uppercase tracking-[.08em] text-[#8e8e93]">{label}</span>
        <span className="mt-0.5 block font-mono text-[18px] font-semibold tabular-nums text-[#ededed]">{result.value?.toFixed(3)}<span className="ml-1 text-[11px] text-[#a1a1aa]">{unit}</span></span>
      </span>
    </div>
    {result.mode === 'angle' && <div className="mt-2 border-t border-[#262626] pt-1.5 text-[10px] text-[#8e8e93]">Vertex · <span className="font-mono text-[#ededed]">2 · {result.species[1]}</span></div>}
  </motion.div>;
}

function AtomInformation({ entry }: { entry?: MeasuredAtomCoordinate }) {
  if (!entry) return null;
  return <div className="mt-2 overflow-hidden rounded-[6px] border border-[#303030] bg-[#111111]">
    <div className="flex h-8 items-center justify-between border-b border-[#2a2a2a] px-2.5">
      <span className="text-[10px] font-semibold uppercase tracking-[.08em] text-[#8e8e93]">Atom information</span>
      <span className="font-mono text-[12px] font-semibold text-[#ededed]">{entry.name}</span>
    </div>
    <div className="flex items-center justify-between border-b border-[#242424] px-2.5 py-1.5">
      <span className="text-[11px] text-[#8e8e93]">Element</span>
      <span className="font-mono text-[11px] font-medium text-[#ededed]">{entry.species}</span>
    </div>
    <div className="px-2.5 py-2">
      <div className="grid grid-cols-[68px_repeat(3,minmax(0,1fr))] items-center gap-x-2 font-mono text-[10.5px] tabular-nums">
        <span />
        <span className="text-right font-sans text-[10px] font-semibold text-[#8e8e93]">X</span>
        <span className="text-right font-sans text-[10px] font-semibold text-[#8e8e93]">Y</span>
        <span className="text-right font-sans text-[10px] font-semibold text-[#8e8e93]">Z</span>
        <span className="font-sans text-[10px] text-[#8e8e93]">Fractional</span>
        {entry.fractional.map((value, index) => <span key={`fractional-${entry.instanceId}-${index}`} className="text-right text-[#c7c7cc]">{value.toFixed(4)}</span>)}
        <span className="font-sans text-[10px] text-[#8e8e93]">Cartesian</span>
        {entry.cartesian.map((value, index) => <span key={`cartesian-${entry.instanceId}-${index}`} className="text-right text-[#c7c7cc]">{value.toFixed(3)}</span>)}
      </div>
    </div>
    <div className="border-t border-[#242424] px-2.5 py-1.5 text-right font-mono text-[9px] text-[#71717a]">Fractional · crystal&nbsp;&nbsp; Cartesian · Å</div>
  </div>;
}

function gcd(left: number, right: number): number {
  return right === 0 ? left : gcd(right, left % right);
}

function formulaFromAtoms(atoms: Array<Pick<CustomAtom, 'species' | 'siteSpecies' | 'occupancy'>>) {
  const counts = new Map<string, number>();
  atoms.forEach((atom) => {
    const siteSpecies = atom.siteSpecies?.length
      ? atom.siteSpecies
      : [{ element: atom.species || 'X', occupancy: atom.occupancy ?? 1 }];
    siteSpecies.forEach((entry) => {
      counts.set(entry.element, (counts.get(entry.element) ?? 0) + entry.occupancy);
    });
  });
  const scaledCounts = Array.from(counts.values()).map((count) => Math.max(1, Math.round(count * 10_000)));
  const divisor = scaledCounts.reduce((value, count) => gcd(value, count), 0) || 1;
  return Array.from(counts.entries()).map(([species], index) => {
    const reduced = scaledCounts[index] / divisor;
    return `${species}${reduced > 1 ? reduced : ''}`;
  }).join('');
}

function engineForCalculation(calculation: CalculationType) {
  return calculation === 'Thermoelectric properties' ? 'QE + BoltzTraP2' : 'QE';
}

function backendJobStatus(status: string): JobStatus {
  if (status === 'COMPLETED') return 'Completed';
  if (status === 'FAILED') return 'Failed';
  if (status === 'CANCELLED') return 'Cancelled';
  if (status === 'RUNNING' || status === 'CANCEL_REQUESTED') return 'Running';
  if (status === 'QUEUED' || status === 'PREPARING') return 'Queued';
  return 'Draft';
}

function formatMetric(value: unknown, digits = 4) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('en-US', { maximumFractionDigits: digits }) : null;
}

function resultCopy(manifest?: PhyniteResultManifest) {
  const summary = manifest?.summary;
  if (!summary) return { result: manifest?.error ?? 'Result manifest is not available yet', resultDetail: 'The backend did not return parsed scientific metrics.' };
  const bandGap = formatMetric(summary.bandGapEv);
  if (bandGap) return { result: `Gap on sampled path · ${bandGap} eV`, resultDetail: `${String(summary.electronicCharacter ?? 'Electronic structure completed')} · off-path extrema are not ruled out` };
  const dos = formatMetric(summary.dosAtFermiStatesPerEv);
  if (dos) return { result: `DOS(EF) · ${dos} states/eV`, resultDetail: 'Parsed from the Quantum ESPRESSO DOS output.' };
  const powerFactor = formatMetric(summary.peakPowerFactorMwPerMK2);
  if (powerFactor) return { result: `Peak power factor · ${powerFactor} mW m⁻¹ K⁻²`, resultDetail: `At ${formatMetric(summary.peakPowerFactorTemperatureK, 1) ?? '—'} K · constant relaxation-time result` };
  if (typeof summary.hasImaginaryModes === 'boolean') return { result: summary.hasImaginaryModes ? 'Imaginary modes on sampled path' : 'No imaginary modes on sampled path', resultDetail: `Minimum frequency ${formatMetric(summary.minimumFrequencyCmMinus1, 2) ?? '—'} cm⁻¹ · sampled q-path only; full-BZ stability requires convergence checks` };
  const barrier = formatMetric(summary.forwardBarrierEv, 6);
  if (barrier) return { result: `Forward barrier · ${barrier} eV`, resultDetail: `Converged NEB images · reverse barrier ${formatMetric(summary.reverseBarrierEv, 6) ?? '—'} eV · path error ${formatMetric(summary.maximumPathErrorEvAngstrom, 6) ?? '—'} eV/Å. Refine image count and endpoint states for the study.` };
  const energy = formatMetric(summary.totalEnergyRy, 8);
  if (energy) return { result: `Total energy · ${energy} Ry`, resultDetail: summary.converged ? `SCF converged in ${summary.scfIterations ?? '—'} iterations` : 'Review the SCF log before using this result.' };
  return { result: 'Calculation completed', resultDetail: 'Scientific outputs are available in the result artifacts.' };
}

function mergeBackendJob(job: JobRecord, calculation: PhyniteCalculation, manifest?: PhyniteResultManifest): JobRecord {
  if (!canMergeBackendCalculation(job.backendCalculationId, calculation.id)) return job;
  if (job.calculationType && job.calculationType !== calculation.calculationType) {
    return {
      ...job,
      backendCalculationId: undefined,
      status: 'Failed',
      progress: 0,
      updated: workspaceTimestamp(),
      result: 'Execution record repaired',
      resultDetail: 'A legacy local record pointed at a different backend calculation. Run this calculation again to create a clean result.',
    };
  }
  const calculationManifest = manifest && resultManifestMatchesCalculation(manifest.calculationId, calculation.id)
    ? manifest
    : undefined;
  const status = backendJobStatus(calculation.status);
  const localCompute = calculation.computeBackend === 'LOCAL_MAC';
  const artifactsExpired = Boolean(
    calculation.artifactsExpireAtEpoch
    && calculation.artifactsExpireAtEpoch * 1000 <= Date.now(),
  );
  const parsed = status === 'Cancelled'
    ? {
      result: calculation.statusMessage ?? 'Calculation cancelled',
      resultDetail: 'No local compute process remains. Completed artifacts from earlier stages are preserved.',
    }
    : status === 'Failed' && calculation.failureReason
      ? {
        result: calculation.failureReason.startsWith('Insufficient compute memory')
          ? 'Insufficient compute memory'
          : 'Calculation failed',
        resultDetail: calculation.failureReason,
      }
    : (status === 'Completed' || status === 'Failed') && artifactsExpired ? {
      result: job.result ?? (status === 'Completed' ? 'Calculation completed' : 'Calculation failed'),
      resultDetail: 'Output files and plot previews expired after the 3-day retention window.',
    }
    : status === 'Completed' || status === 'Failed' ? resultCopy(calculationManifest) : {
    result: status === 'Running'
      ? calculation.status === 'CANCEL_REQUESTED' ? 'Stopping local calculation' : calculation.statusMessage ?? 'Quantum ESPRESSO is running'
      : status === 'Queued'
        ? localCompute ? calculation.statusMessage ?? 'Waiting for the local Mac worker' : 'Queued for compute'
        : 'Saved as a cloud draft',
    resultDetail: status === 'Draft'
      ? 'No compute resource has been started.'
      : localCompute && status === 'Queued'
        ? calculation.statusMessage?.startsWith('Waiting for ')
          && calculation.statusMessage !== 'Waiting for the local Mac worker'
          ? 'This calculation will start automatically after its required structure calculation completes.'
          : 'Queued for the one-at-a-time local compute worker.'
      : localCompute && status === 'Running'
        ? 'Quantum ESPRESSO is running on the connected local worker; completed artifacts remain in the cloud workspace.'
        : 'Progress is reported by the compute service.',
  };
  return {
    ...job,
    backendCalculationId: calculation.id,
    computeResources: { ...job.computeResources, ...Object.fromEntries(Object.entries(readComputeResources(calculation, calculationManifest)).filter(([, value]) => value !== undefined)) },
    status,
    relaxationConverged: calculationManifest ? qeRelaxationConverged(calculationManifest.summary) : job.relaxationConverged,
    scientificAccepted: calculationManifest ? calculationManifest.status === 'completed' && qeResultAccepted(calculationManifest.summary, calculation.calculationType) : job.scientificAccepted,
    progress: calculation.progress ?? (status === 'Completed' ? 100 : job.progress),
    updated: calculation.updatedAt ?? workspaceTimestamp(),
    completedAt: status === 'Completed' || status === 'Failed' || status === 'Cancelled' ? calculation.completedAt ?? calculation.updatedAt : undefined,
    duration: calculationManifest?.elapsedSeconds !== undefined ? `${calculationManifest.elapsedSeconds.toFixed(1)} s` : job.duration,
    result: parsed.result,
    resultDetail: [parsed.resultDetail, qeConvergenceDescription(calculationManifest?.summary)].filter(Boolean).join('\n'),
    liveLogTail: status === 'Running' ? calculation.logTail : undefined,
    scfConvergence: calculation.scfConvergence ?? job.scfConvergence,
    cancelRequested: calculation.status === 'CANCEL_REQUESTED',
    artifactsExpireAt: calculation.artifactsExpireAt,
    artifactsExpired,
    outputFiles: artifactsExpired ? undefined : calculationManifest?.artifacts?.map((artifact) => artifact.label).join(' · ') ?? job.outputFiles,
    resultArtifacts: artifactsExpired ? [] : calculationManifest?.artifacts ?? job.resultArtifacts,
    totalEnergyRy: typeof calculationManifest?.summary?.totalEnergyRy === 'number' ? calculationManifest.summary.totalEnergyRy : job.totalEnergyRy,
    bandGapEv: typeof calculationManifest?.summary?.bandGapEv === 'number'
      ? calculationManifest.summary.bandGapEv
      : job.bandGapEv,
    electronicCharacter: typeof calculationManifest?.summary?.electronicCharacter === 'string'
      ? calculationManifest.summary.electronicCharacter
      : job.electronicCharacter,
  };
}

function FlatNumberField({ label, value, suffix, step = 0.01, onChange }: { label: string; value: number; suffix?: string; step?: number; onChange: (value: number) => void }) {
  return (
    <label className="workspace-field flex min-w-0 items-center overflow-hidden rounded-[6px] border border-[var(--panel-border)] bg-[var(--panel-raised)]">
      <span className="pl-2 font-mono text-[11px] font-semibold text-[var(--panel-accent)]">{label}</span>
      <CommittedNumberInput step={step} value={Number(value.toFixed(6))} onCommit={onChange} className="h-7 min-w-0 flex-1 bg-transparent px-1.5 text-right font-mono text-[11px] text-[var(--panel-text)] outline-none" />
      {suffix && <span className="pr-1.5 font-mono text-[10px] text-[var(--panel-muted)]">{suffix}</span>}
    </label>
  );
}

function WorkspaceConfirmDialog({ state, onCancel, onConfirm }: { state: ConfirmationState | null; onCancel: () => void; onConfirm: () => void }) {
  useEffect(() => {
    if (!state) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onCancel(); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel, state]);
  if (!state) return null;
  const danger = state.tone === 'danger';
  return createPortal(
    <div className="fixed inset-0 z-[140] grid place-items-center bg-black/60 px-4" onPointerDown={(event) => event.target === event.currentTarget && onCancel()}>
      <motion.div role="alertdialog" aria-modal="true" aria-labelledby="workspace-confirm-title" aria-describedby="workspace-confirm-description" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.1 }} className="workspace-dark-surface w-full max-w-[380px] overflow-hidden rounded-[6px] border border-[#303030] bg-[#111111]">
        <div className="flex gap-3 px-4 pb-4 pt-4"><span className={cn('mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-[6px] border', danger ? 'workspace-danger-symbol' : 'border-[#333333] bg-[#1b1b1b] text-[#ededed]')}>{danger ? <Trash2 className="h-3.5 w-3.5" /> : <Boxes className="h-3.5 w-3.5" />}</span><span className="min-w-0"><h2 id="workspace-confirm-title" className="text-[12px] font-semibold text-[#ededed]">{state.title}</h2><p id="workspace-confirm-description" className="mt-1.5 text-[10px] leading-4 text-[#a1a1aa]">{state.description}</p></span></div>
        <div className="flex justify-end gap-2 border-t border-[#2a2a2a] bg-[#0e0e0e] px-3 py-3"><button autoFocus type="button" onClick={onCancel} className="h-8 rounded-[5px] border border-[#333333] px-3 text-[10px] font-medium text-[#b4b4ba] hover:bg-[#1b1b1b] hover:text-[#ededed]">Cancel</button><button type="button" onClick={onConfirm} className={cn('h-8 rounded-[5px] px-3 text-[10px] font-semibold', danger ? 'workspace-confirm-danger-button' : 'bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-strong)]')}>{state.confirmLabel}</button></div>
      </motion.div>
    </div>,
    document.body,
  );
}

function PropertySection({ title, icon: Icon, defaultOpen = false, children }: { title: string; icon: LucideIcon; defaultOpen?: boolean; children: React.ReactNode }) {
  return <LabInspectorSection title={title} icon={<Icon size={14} />} defaultOpen={defaultOpen}><div className="space-y-3">{children}</div></LabInspectorSection>;
}

function DataRow({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-4 text-[11px]"><span className="text-[var(--panel-muted)]">{label}</span><span title={typeof value === 'string' ? value : undefined} className="truncate font-mono font-medium text-[var(--panel-text)]">{value}</span></div>;
}


function CommandMenu({ open, onClose, commands }: { open: boolean; onClose: () => void; commands: Array<{ label: string; hint?: string; icon: LucideIcon; action: () => void }> }) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const filtered = commands.filter((command) => command.label.toLowerCase().includes(query.toLowerCase()));
  if (!open) return null;
  const close = () => { setQuery(''); setActiveIndex(0); onClose(); };
  const run = (action: () => void) => { close(); action(); };
  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/50 px-4 pt-[12vh]" onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <motion.div role="dialog" aria-modal="true" aria-label="Actions" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="w-full max-w-[560px] overflow-hidden rounded-[6px] border border-[var(--panel-border)] bg-[var(--panel-bg)] shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
        <div className="flex h-14 items-center gap-3 border-b border-[var(--panel-border)] px-4"><Search className="h-4 w-4 text-[var(--panel-muted)]" /><input autoFocus value={query} onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }} onKeyDown={(event) => { if (event.key === 'ArrowDown' && filtered.length) { event.preventDefault(); setActiveIndex((current) => (current + 1) % filtered.length); } if (event.key === 'ArrowUp' && filtered.length) { event.preventDefault(); setActiveIndex((current) => (current - 1 + filtered.length) % filtered.length); } if (event.key === 'Enter' && filtered[activeIndex]) run(filtered[activeIndex].action); if (event.key === 'Escape') close(); }} placeholder="Search actions, tools, and exports" className="h-full flex-1 bg-transparent text-[13px] text-[var(--panel-text)] outline-none placeholder:text-[var(--panel-muted)]" /><kbd className="rounded-[4px] border border-[var(--panel-border)] bg-[var(--panel-raised)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--panel-muted)]">ESC</kbd></div>
        <div role="listbox" aria-label="Available actions" className="max-h-[380px] overflow-y-auto p-1.5">{filtered.map((command, index) => { const Icon = command.icon; return <button key={command.label} type="button" role="option" aria-selected={index === activeIndex} onPointerMove={() => setActiveIndex(index)} onClick={() => run(command.action)} className={cn('flex h-11 w-full items-center gap-3 rounded-[6px] px-3 text-left text-[12px] text-[var(--panel-muted)] hover:bg-[var(--panel-hover)] hover:text-[var(--panel-text)]', index === activeIndex && 'bg-[var(--panel-selected)] font-medium text-[var(--panel-text)]')}><Icon className="h-4 w-4 text-[var(--panel-muted)]" /><span className="flex-1">{command.label}</span>{command.hint && <kbd className="font-mono text-[10px] text-[var(--panel-muted)]">{command.hint}</kbd>}</button>; })}{!filtered.length && <div className="px-4 py-10 text-center text-[11px] text-[var(--panel-muted)]">No matching action</div>}</div>
      </motion.div>
    </div>
  );
}

export function ProjectCrystalWorkspace({ cloudSync, ownerId, session: headerSession }: { cloudSync: CloudSyncState; ownerId: string; session?: PhyniteSession }) {
  const shell = useResearchShell();
  const integratedShell = Boolean(shell);
  const shellWidth = shell?.contentWidth;
  const [showFigures, setShowFigures] = useState(false);
  const [showWorkflow, setShowWorkflow] = useState(false);
  const [workflowCanvases, setWorkflowCanvases] = useState<Record<string, WorkflowCanvasState>>({});
  const [workflowRunIds, setWorkflowRunIds] = useState<Record<string, string>>({});
  const [workflowPending, setWorkflowPending] = useState<Record<string, { fingerprint: string; projectId: string; request: DftWorkflowRequest }>>({});
  const [workflowSubmitting, setWorkflowSubmitting] = useState(false);
  const workflowHistories = useRef(new Map<string, WorkflowHistory<WorkflowDocument>>());
  const workflowConfigBase = useRef<WorkflowDocument | null>(null);
  useEffect(() => {
    document.title = `${showFigures ? 'Figure Lab' : 'DFT Lab'} — Phynite`;
  }, [showFigures]);
  const [figureInitialJobId, setFigureInitialJobId] = useState<string>();
  const fileInput = useRef<HTMLInputElement>(null);
  const structureDragDepth = useRef(0);
  const atomsRef = useRef<CustomAtom[]>([]);
  const historyRef = useRef<HistorySnapshot[]>([]);
  const redoRef = useRef<HistorySnapshot[]>([]);
  const remoteProjectPromisesRef = useRef(new Map<string, Promise<string>>());
  const remoteStructurePromisesRef = useRef(new Map<string, Promise<string>>());
  const pollingJobsRef = useRef<JobRecord[]>([]);
  const calculationSubmissionPromisesRef = useRef(new Map<string, Promise<string | null>>());
  const resizeRef = useRef<{ side: 'left' | 'right'; startX: number; startWidth: number } | null>(null);
  const confirmationResolverRef = useRef<((confirmed: boolean) => void) | null>(null);
  const [databases] = useState<CrystalDatabase[]>(initialDatabases);
  const [activeDatabaseId, setActiveDatabaseId] = useState('db-workspace');
  const [projects, setProjects] = useState<ResearchProject[]>(initialProjects);
  const [activeProjectId, setActiveProjectId] = useState('');
  const navigateWorkspaceView = (view: CalculationView, jobId?: string) => {
    if (view === 'figures' && !projects.some((project) => project.id === activeProjectId)) return;
    const href = calculationNavigationUrl(window.location.href, activeProjectId, view, activeMaterialId);
    if (href !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.pushState(window.history.state, '', href);
    }
    setFigureInitialJobId(jobId);
    setShowFigures(view === 'figures');
    setShowWorkflow(view === 'workflow');
    window.dispatchEvent(new Event('phynite:navigation-change'));
  };
  const openFigures = (jobId?: string) => navigateWorkspaceView('figures', jobId);
  const closeFigures = () => navigateWorkspaceView('builder');
  useResearchNavigation('dft', async (target, href) => {
    if (target === 'figures' && href === '/calculation?view=figures' && activeProjectId) { openFigures(); return true; }
    if (target === 'dft' && href === '/calculation') { closeFigures(); return true; }
    persistWorkspaceSnapshot();
    await cloudSync.flush();
    return false;
  });
  const [materials, setMaterials] = useState<MaterialRecord[]>(initialMaterials.map((record) => ({ ...record, atoms: cloneAtoms(record.atoms), lattice: { ...record.lattice } })));
  const [activeMaterialId, setActiveMaterialId] = useState('');
  const [atoms, setAtoms] = useState<CustomAtom[]>([]);
  const [lattice, setLattice] = useState<LatticeParameters>({ ...emptyLattice });
  const [materialName, setMaterialName] = useState('No structure selected');
  const [selectedAtomId, setSelectedAtomId] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<ToolId>('select');
  const [objectRotation, setObjectRotation] = useState<[number, number, number]>([0, 0, 0]);
  const [moveSpace, setMoveSpace] = useState<MoveSpace>('world');
  const [moveConstraint, setMoveConstraint] = useState<MoveConstraint>('free');
  const [coordinateMode, setCoordinateMode] = useState<CoordinateMode>('fractional');
  const [moveSnapEnabled, setMoveSnapEnabled] = useState(false);
  const [moveSnap, setMoveSnap] = useState(0.1);
  const [moveOrigin, setMoveOrigin] = useState<[number, number, number] | null>(null);
  const [supercell, setSupercell] = useState<CellRepeat>([1, 1, 1]);
  const [vacuumSize] = useState(15);
  const [focusRequest, setFocusRequest] = useState(0);
  const [fitRequest, setFitRequest] = useState(0);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [activeViewAngle, setActiveViewAngle] = useState<ViewAngleId>('isometric');
  const [cameraViewRequest, setCameraViewRequest] = useState<CameraViewRequest | null>(null);
  const [showBonds, setShowBonds] = useState(true);
  const [showCell, setShowCell] = useState(false);
  const [showLabels, setShowLabels] = useState(false);
  const [showForces, setShowForces] = useState(false);
  const [atomScale, setAtomScale] = useState(defaultMaterialViewSettings.atomScale);
  const [bondScale, setBondScale] = useState(defaultMaterialViewSettings.bondScale);
  const [bondCutoff, setBondCutoff] = useState(defaultMaterialViewSettings.bondCutoff);
  const [forceScale, setForceScale] = useState(defaultMaterialViewSettings.forceScale);
  const [displayStyle, setDisplayStyle] = useState<CrystalDisplaySettings['displayStyle']>('ball-stick');
  const sceneExportRef = useRef<CrystalSceneExporter | null>(null);
  const [sceneExporting, setSceneExporting] = useState(false);
  const [structureDropActive, setStructureDropActive] = useState(false);
  const [structureDropSupported, setStructureDropSupported] = useState<boolean | null>(null);

  const [rightTab, setRightTab] = useState<RightTab>('structure');
  const [crystalMode, setCrystalMode] = useState<'simple' | 'manual'>('simple');
  const [showLeftPanel, setShowLeftPanel] = useState(false);
  const [showInspector, setShowInspector] = useState(false);
  const [projectCreateRequest, setProjectCreateRequest] = useState(0);
  // Keep the editor, calculation drawer, figures and global header on one
  // external theme store. A local light default caused a visible light-mode
  // flash whenever this workspace was mounted again after navigation.
  const { theme: workspaceTheme, toggleTheme: toggleWorkspaceTheme } = useSiteTheme();
  const [leftPanelWidth, setLeftPanelWidth] = useState(232);
  const [rightPanelWidth, setRightPanelWidth] = useState(420);
  const [isResizing, setIsResizing] = useState<'left' | 'right' | null>(null);
  useEffect(() => { if (shellWidth) setRightPanelWidth(current => clampRightPanelWidth(current, 0, shellWidth)); }, [shellWidth]);

  useEffect(() => {
    try {
      const savedLeft = window.localStorage.getItem('phynite_dft_left_panel_width');
      const parsedLeft = Number(savedLeft);
      const restoredLeft = savedLeft && Number.isFinite(parsedLeft)
        ? Math.max(190, Math.min(420, parsedLeft))
        : leftPanelWidth;
      if (restoredLeft !== leftPanelWidth) setLeftPanelWidth(restoredLeft);

      const savedRight = window.localStorage.getItem('phynite_dft_right_panel_width');
      if (savedRight) {
        const val = Number(savedRight);
        if (Number.isFinite(val)) setRightPanelWidth(clampRightPanelWidth(val, integratedShell ? 0 : restoredLeft, shellWidth || undefined));
      }
    } catch {}
    // Panel preferences are hydrated once. Re-running this while dragging would
    // restore the previous localStorage value and make the splitter jump.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleWindowResize = () => {
      setRightPanelWidth((current) => clampRightPanelWidth(current, integratedShell ? 0 : leftPanelWidth, shellWidth || undefined));
    };
    window.addEventListener('resize', handleWindowResize);
    return () => window.removeEventListener('resize', handleWindowResize);
  }, [leftPanelWidth, integratedShell, shellWidth]);

  useEffect(() => {
    try {
      window.localStorage.setItem('phynite_dft_right_panel_width', String(rightPanelWidth));
    } catch {}
  }, [rightPanelWidth]);

  useEffect(() => {
    try {
      window.localStorage.setItem('phynite_dft_left_panel_width', String(leftPanelWidth));
    } catch {}
  }, [leftPanelWidth, integratedShell, shellWidth]);
  const [jobs, setJobs] = useState<JobRecord[]>(initialJobs);
  const [commandOpen, setCommandOpen] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);
  const [showStudyEvidence, setShowStudyEvidence] = useState(false);
  const [materialsProjectOpen, setMaterialsProjectOpen] = useState(false);
  const [elementPaletteMode, setElementPaletteMode] = useState<ElementPaletteMode | null>(null);
  const [operationId, setOperationId] = useState<string | null>(null);
  const [configuringComponentId, setConfiguringComponentId] = useState<string | null>(null);
  const [calculationComponents, setCalculationComponents] = useState<CalculationComponentInstance[]>([]);
  const [jobDraft, setJobDraft] = useState<JobDraft>(createDefaultQeDraft);
  const [calculationConfigurations, setCalculationConfigurations] = useState<CalculationConfiguration[]>([]);
  const [status, setStatus] = useState('Workspace ready');
  const [confirmation, setConfirmation] = useState<ConfirmationState | null>(null);
  const [measureMode, setMeasureMode] = useState<MeasureMode>('atom');
  const measureModeRef = useRef<MeasureMode>('atom');
  const [measureSelection, setMeasureSelection] = useState<MeasurementSelection[]>([]);
  const measureSelectionRef = useRef<MeasurementSelection[]>([]);
  const [workspaceHydrated, setWorkspaceHydrated] = useState(false);
  const viewportStageRef = useRef<HTMLElement | null>(null);
  const measureDragControls = useDragControls();
  const projectTrashRef = useRef<WorkspaceSnapshot['projectTrash']>([]);
  const measurementInstanceIds = measureSelection.map((selection) => selection.instanceId);

  useWorkspaceSaveShortcut(async () => {
    setStatus(cloudSync.status === 'idle' ? 'Saving workspace…' : 'Saving to cloud…');
    try {
      await cloudSync.flush();
      setStatus(cloudSync.status === 'idle' ? 'Saved on this device' : 'Saved to cloud');
    } catch {
      setStatus('Cloud save failed · changes remain on this device');
    }
  }, !showFigures);

  const replaceMeasureSelection = useCallback((next: MeasurementSelection[]) => {
    measureSelectionRef.current = next;
    setMeasureSelection(next);
  }, []);

  const markProjectEdited = useCallback((projectId: string, timestamp = workspaceTimestamp()) => {
    if (!projectId) return;
    setProjects((current) => current.map((project) => project.id === projectId
      ? { ...project, updatedAt: timestamp }
      : project));
  }, []);

  const applyMaterialViewSettings = useCallback((settings?: Partial<MaterialViewSettings>) => {
    const resolved = resolveMaterialViewSettings(settings);
    setDisplayStyle(resolved.displayStyle);
    setShowBonds(resolved.showBonds);
    setShowCell(resolved.showCell);
    setShowLabels(resolved.showLabels);
    setShowForces(resolved.showForces);
    setAtomScale(resolved.atomScale);
    setBondScale(resolved.bondScale);
    setBondCutoff(resolved.bondCutoff);
    setForceScale(resolved.forceScale);
    setSupercell([...resolved.supercell] as CellRepeat);
  }, []);

  const updateMaterialViewSettings = useCallback((patch: Partial<MaterialViewSettings>) => {
    if (patch.displayStyle !== undefined) setDisplayStyle(patch.displayStyle);
    if (patch.showBonds !== undefined) setShowBonds(patch.showBonds);
    if (patch.showCell !== undefined) setShowCell(patch.showCell);
    if (patch.showLabels !== undefined) setShowLabels(patch.showLabels);
    if (patch.showForces !== undefined) setShowForces(patch.showForces);
    if (patch.atomScale !== undefined) setAtomScale(patch.atomScale);
    if (patch.bondScale !== undefined) setBondScale(patch.bondScale);
    if (patch.bondCutoff !== undefined) setBondCutoff(patch.bondCutoff);
    if (patch.forceScale !== undefined) setForceScale(patch.forceScale);
    if (patch.supercell !== undefined) setSupercell([...patch.supercell] as CellRepeat);

    if (!activeMaterialId) return;
    const editedAt = workspaceTimestamp();
    setMaterials((current) => current.map((record) => record.id === activeMaterialId
      ? {
          ...record,
          updatedAt: editedAt,
          viewSettings: {
            ...resolveMaterialViewSettings(record.viewSettings),
            ...patch,
            supercell: patch.supercell
              ? [...patch.supercell] as CellRepeat
              : resolveMaterialViewSettings(record.viewSettings).supercell,
          },
        }
      : record));
    markProjectEdited(activeProjectId, editedAt);
  }, [activeMaterialId, activeProjectId, markProjectEdited]);

  useEffect(() => {
    if (workspaceHydrated || cloudSync.status === 'syncing' || cloudSync.status === 'idle') return;
    let snapshot: WorkspaceSnapshot | null = null;

    try {
      const snapshotOwner = window.localStorage.getItem('phynite:calculation-workspace-owner:v1');
      // A stale snapshot from another account must never hydrate, but it must not
      // leave the current owner's studio on an infinite loading screen either.
      if (canHydrateCalculationWorkspace(cloudSync.status, snapshotOwner, ownerId)) {
        const stored = window.localStorage.getItem(CALCULATION_WORKSPACE_STORAGE_KEY);
        if (stored) snapshot = JSON.parse(stored) as WorkspaceSnapshot;
      }
    } catch {
      // Start with an empty workspace when local data is unavailable or invalid.
    }

    const hydrationFrame = window.requestAnimationFrame(() => {
      if (snapshot?.version === 1) {
        projectTrashRef.current = Array.isArray(snapshot.projectTrash) ? snapshot.projectTrash : [];
        const fallbackTimestamp = snapshot.savedAt ?? workspaceTimestamp();
        const restoredProjects = (Array.isArray(snapshot.projects) ? snapshot.projects : [])
          .map((project) => normalizeLifecycle(project, fallbackTimestamp));
        const restoredMaterials = (Array.isArray(snapshot.materials) ? snapshot.materials : [])
          .map((material) => normalizeMaterialLifecycle(material, fallbackTimestamp));
        const restoredNavigation = resolveCalculationProjectSelection(
          window.location.search,
          restoredProjects.map((project) => project.id),
          restoredMaterials,
        );
        const restoredProjectId = restoredNavigation.projectId;
        const restoredMaterial = restoredMaterials.find(
          (material) => material.id === restoredNavigation.materialId,
        ) ?? (restoredProjectId ? restoredMaterials.find((material) => material.projectId === restoredProjectId) : undefined);
        const openedAt = workspaceTimestamp();
        const hydratedProjects = restoredProjects.map((project) => project.id === restoredProjectId
          ? { ...project, lastOpenedAt: openedAt }
          : project);
        const hydratedMaterials = restoredMaterials.map((material) => material.id === restoredMaterial?.id
          ? { ...material, lastOpenedAt: openedAt }
          : material);
        const hydratedMaterial = hydratedMaterials.find(
          (material) => material.id === restoredMaterial?.id,
        );

        setActiveDatabaseId(snapshot.activeDatabaseId || 'db-workspace');
        setProjects(hydratedProjects);
        setActiveProjectId(restoredProjectId);
        setShowFigures(restoredNavigation.view === 'figures');
        setShowWorkflow(restoredNavigation.view === 'workflow');
        setWorkflowCanvases(snapshot.workflowCanvases ?? {});
        setWorkflowRunIds(snapshot.workflowRunIds ?? {});
        setWorkflowPending(snapshot.workflowPending ?? {});
        setMaterials(hydratedMaterials);
        setActiveMaterialId(hydratedMaterial?.id ?? '');
        const snapshotJobs = snapshot.jobs ?? [];
        const duplicateJobIds = duplicateExecutionJobIds(snapshotJobs);
        setJobs(ensureUniqueExecutionJobIds(snapshotJobs.map((job) => ({
          ...job,
          calculationType: job.calculationType
            ?? snapshot.calculationComponents?.find((component) => component.id === job.componentId)?.calculation,
          ...(duplicateJobIds.has(job.id) ? {
            backendCalculationId: undefined,
            status: 'Failed' as const,
            progress: 0,
            completedAt: undefined,
            duration: undefined,
            result: 'Legacy execution record repaired',
            resultDetail: 'This entry previously shared its local identity with another calculation, so its result could not be trusted. Run it again.',
            outputFiles: undefined,
            resultArtifacts: undefined,
          } : {}),
        }))));
        setCalculationConfigurations((snapshot.calculationConfigurations ?? []).map((configuration) => ({
          ...configuration,
          draft: normalizeJobDraft(configuration.draft),
        })));
        const normalizedComponents = (snapshot.calculationComponents ?? []).map(component => ({ ...component, draft: normalizeJobDraft(component.draft) }));
        setCalculationComponents(migrateWorkflow(normalizedComponents, component => {
          const record = hydratedMaterials.find(m => m.id === component.materialId);
          if (!record) throw new Error('Missing workflow structure');
          return generateQuantumEspressoInputFiles(component.draft, component.calculation, { name: record.name, formula: record.formula, databaseName: '', atomCount: record.atoms.length, species: [...new Set(record.atoms.map(a => a.species))], atoms: record.atoms, cellVectors: cellVectorsFromLattice(record.lattice), periodic: record.lattice.periodic }).find(f => f.name === 'scf.in')?.content ?? '';
        }));
        if (snapshot.jobDraft) setJobDraft(normalizeJobDraft(snapshot.jobDraft));

        if (hydratedMaterial) {
          // Edit commands read this ref, so restore it before the first user action.
          const restoredAtoms = cloneAtoms(hydratedMaterial.atoms);
          atomsRef.current = restoredAtoms;
          setAtoms(restoredAtoms);
          setLattice({ ...hydratedMaterial.lattice });
          setMaterialName(hydratedMaterial.name);
          applyMaterialViewSettings(hydratedMaterial.viewSettings);
        }
      }

      setWorkspaceHydrated(true);
    });

    return () => window.cancelAnimationFrame(hydrationFrame);
  }, [applyMaterialViewSettings, cloudSync.status, ownerId, workspaceHydrated]);

  const persistWorkspaceSnapshot = useCallback(() => {
    if (!workspaceHydrated) return;
      const snapshot: WorkspaceSnapshot = {
        version: 1,
        activeDatabaseId,
        activeProjectId,
        activeMaterialId,
        projects,
        materials,
        jobs,
        calculationConfigurations,
        calculationComponents,
        projectTrash: projectTrashRef.current,
        workflowCanvases, workflowRunIds, workflowPending,
        jobDraft,
        savedAt: workspaceTimestamp(),
      };

    window.localStorage.setItem(CALCULATION_WORKSPACE_STORAGE_KEY, JSON.stringify(snapshot));
    notifyCalculationWorkspaceChange();
  }, [
    activeDatabaseId,
    activeMaterialId,
    activeProjectId,
    calculationComponents,
    calculationConfigurations,
    workflowCanvases, workflowRunIds, workflowPending,
    jobDraft,
    jobs,
    materials,
    projects,
    workspaceHydrated,
  ]);
  useEffect(() => {
    if (!workspaceHydrated) return;
    const saveTimer = window.setTimeout(() => {
      try { persistWorkspaceSnapshot(); }
      catch { setStatus('Workspace could not be saved on this device. Keep this page open and retry.'); }
    }, 240);
    return () => window.clearTimeout(saveTimer);
  }, [persistWorkspaceSnapshot, workspaceHydrated]);

  useEffect(() => {
    if (!workspaceHydrated) return;
    // Keep project changes refreshable without creating history entries for atom edits.
    const href = calculationNavigationUrl(window.location.href, activeProjectId, showFigures ? 'figures' : showWorkflow ? 'workflow' : 'builder', activeMaterialId);
    if (href !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.replaceState(window.history.state, '', href);
    }
  }, [activeMaterialId, activeProjectId, showFigures, showWorkflow, workspaceHydrated]);

  const formula = useMemo(() => formulaFromAtoms(atoms), [atoms]);
  const viewedAtoms = atoms;
  const viewedLattice = lattice;
  const scalarColors = useMemo(() => crystalScalarColors(viewedAtoms, viewedLattice, 'element', 'viridis'), [viewedAtoms, viewedLattice]);
  const composition = useMemo(() => {
    const counts = new Map<string, number>();
    viewedAtoms.forEach((atom) => {
      const species = atom.siteSpecies?.length ? atom.siteSpecies : [{ element: atom.species, occupancy: atom.occupancy ?? 1 }];
      species.forEach((entry) => counts.set(entry.element, (counts.get(entry.element) ?? 0) + entry.occupancy));
    });
    return [...counts].sort((a, b) => b[1] - a[1]);
  }, [viewedAtoms]);
  const selectedAtom = atoms.find((atom) => atom.id === selectedAtomId) ?? null;
  const hasForces = atoms.some((atom) => [atom.fx, atom.fy, atom.fz].every((value) => typeof value === 'number' && Number.isFinite(value)));
  const measureTargetCount = measurementTargetCount(measureMode);
  const measurement = useMemo(
    () => measurementResultFor(measureMode, measureSelection, atoms, lattice),
    [atoms, lattice, measureMode, measureSelection],
  );
  const selectedCartesian = useMemo(() => selectedAtom ? fractionalToCartesian(selectedAtom, lattice) : null, [lattice, selectedAtom]);
  const moveOriginCartesian = useMemo(() => moveOrigin ? fractionalToCartesian({ x: moveOrigin[0], y: moveOrigin[1], z: moveOrigin[2] }, lattice) : null, [lattice, moveOrigin]);
  const viewportMoveSnap = moveSnapEnabled ? moveSnap * 5.4 / Math.max(lattice.a, lattice.b, lattice.c, 0.1) : null;
  const cellVectors = useMemo(() => cellVectorsFromLattice(lattice), [lattice]);
  const activeDatabase = databases.find((database) => database.id === activeDatabaseId) ?? databases[0];
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null;
  const activeMaterial = materials.find((record) => record.id === activeMaterialId) ?? null;
  const hasSelectedStructure = Boolean(activeProject && activeMaterialId && atoms.length > 0);
  useEffect(() => {
    if (!activeMaterial && rightTab === 'calculations') setRightTab('structure');
  }, [activeMaterial, rightTab]);
  const activeProjectSize = useMemo(() => {
    if (!activeProject) return '0 B';

    const projectStructures = materials.filter((record) => record.projectId === activeProject.id);
    const structureIds = new Set(projectStructures.map((record) => record.id));
    const serializedProject = JSON.stringify({
      project: activeProject,
      structures: projectStructures,
      calculations: calculationComponents.filter((component) => structureIds.has(component.materialId)),
      configurations: calculationConfigurations.filter((configuration) => structureIds.has(configuration.materialId)),
      jobs: jobs.filter((job) => structureIds.has(job.materialId)),
    });

    return formatProjectSize(new TextEncoder().encode(serializedProject).byteLength);
  }, [activeProject, calculationComponents, calculationConfigurations, jobs, materials]);
  const markStudyEdited = useCallback((materialId = activeMaterialId, projectId = activeProjectId) => {
    const editedAt = workspaceTimestamp();
    if (materialId) {
      setMaterials((current) => current.map((record) => record.id === materialId
        ? { ...record, updatedAt: editedAt }
        : record));
    }
    markProjectEdited(projectId, editedAt);
  }, [activeMaterialId, activeProjectId, markProjectEdited]);
  const activeCalculationComponents = calculationComponents.filter((component) => component.materialId === activeMaterialId && !component.geometry);
  const selectedCalculationComponents = activeCalculationComponents.filter((component) => component.selected);
  const configuringComponent = calculationComponents.find((component) => component.id === configuringComponentId) ?? null;
  const structureInputOptions = configuringComponent ? [
    { value: 'original', label: 'Original structure', detail: 'Current project geometry' },
    ...calculationComponents.filter(c=>c.geometry && c.materialId===configuringComponent.materialId && c.id!==configuringComponent.id).map(c=>({value:c.id,label:`${c.name} output`,detail:'Transformed structure · exact atom mapping and PBC'})),
    ...calculationComponents
      .filter((component) => component.materialId === configuringComponent.materialId && component.calculation === 'Structural relaxation' && component.id !== configuringComponent.id)
      .map((component) => {
        const latest = jobs.find((job) => job.componentId === component.id);
        return { value: component.id, label: `${component.name} output`, detail: latest && completedExecutionAccepted(latest, 'Structural relaxation') ? 'Converged geometry ready' : latest?.status === 'Completed' ? 'Convergence unverified; will run again' : latest?.status === 'Running' ? 'Running now' : 'Will run first' };
      }),
  ] : [];
  const compatibleCalculationSources = configuringComponent ? calculationComponents
    .filter((component) => component.id !== configuringComponent.id && component.calculation === configuringComponent.calculation)
    .map((component) => ({
      id: component.id,
      name: component.name,
      materialName: materials.find((record) => record.id === component.materialId)?.name ?? 'Unknown structure',
      detail: summarizeJobDraft(component.draft, component.calculation),
    })) : [];
  const latestElectronicReference = activeMaterial ? jobs.find((job) => (
    job.materialId === activeMaterial.id
    && job.status === 'Completed'
    && typeof job.electronicCharacter === 'string'
    && job.referenceMaterialUpdatedAt !== undefined
    && job.referenceMaterialUpdatedAt === (activeMaterial.geometryUpdatedAt ?? activeMaterial.updatedAt)
  )) : undefined;
  const hasUneditedMaterialsProjectGeometry = Boolean(
    activeMaterial?.source === 'Materials Project'
    && activeMaterial.sourceGeometryUpdatedAt
    && activeMaterial.sourceGeometryUpdatedAt === activeMaterial.geometryUpdatedAt,
  );
  const activeMaterialContext: MaterialContext = activeMaterial && activeDatabase ? {
    name: activeMaterial.name,
    formula: activeMaterial.formula,
    databaseName: activeDatabase.name,
    projectName: activeProject?.name,
    spaceGroup: activeMaterial.spaceGroup,
    atomCount: atoms.length,
    species: Array.from(new Set(atoms.map((atom) => atom.species))),
    atoms: cloneAtoms(atoms),
    cellVectors,
    periodic: lattice.periodic,
    geometryProvenance: activeMaterial.geometryProvenance,
    electronicReference: latestElectronicReference ? {
      character: latestElectronicReference.electronicCharacter,
      bandGapEv: latestElectronicReference.bandGapEv,
      source: 'completed calculation',
      confidence: 'medium',
      confidenceScope: 'source-identity',
      bandGapScope: 'sampled-k-path',
      functional: latestElectronicReference.referenceFunctional,
      pseudoFamily: latestElectronicReference.referencePseudoFamily,
      spin: latestElectronicReference.referenceSpin,
      soc: latestElectronicReference.referenceSoc,
      noncollinear: latestElectronicReference.referenceNoncollinear,
      startingMagnetization: latestElectronicReference.referenceStartingMagnetization,
      totalMagnetization: latestElectronicReference.referenceTotalMagnetization,
      dftU: latestElectronicReference.referenceDftU,
      hubbardU: latestElectronicReference.referenceHubbardU,
      vdwCorrection: latestElectronicReference.referenceVdwCorrection,
      totalCharge: latestElectronicReference.referenceTotalCharge,
      updatedAt: latestElectronicReference.completedAt,
    } : hasUneditedMaterialsProjectGeometry && activeMaterial.bandGap !== undefined ? {
      character: activeMaterial.bandGap <= 0.05 ? 'metallic' : 'undetermined',
      bandGapEv: activeMaterial.bandGap,
      source: 'Materials Project',
      confidence: 'medium',
      updatedAt: activeMaterial.sourceUpdatedAt ?? undefined,
    } : undefined,
  } : null;
  const projectMaterials = materials.filter((record) => record.projectId === activeProjectId);
  const materialContextForComponent = (component: CalculationComponentInstance, seen = new Set<string>()): MaterialContext => {
    if (seen.has(component.id)) throw new Error('Geometry contains a cycle.');
    const next = new Set(seen).add(component.id);
    const source = calculationComponents.find(c => c.id === (ANALYSES.includes(component.calculation) ? component.scfSourceId : component.structureSourceId));
    if (source?.geometry) {
      const input = materialContextForComponent(source, next);
      if (!input) throw new Error('Geometry source is missing.');
      const output = applyWorkflowGeometry({ ...input, cellVectors: input.cellVectors as [[number, number, number], [number, number, number], [number, number, number]] }, source.geometry);
      return { ...input, ...output, electronicReference: undefined, species: Array.from(new Set(output.atoms.map(a=>a.species))), formula: formulaFromAtoms(output.atoms), atomCount: output.atoms.length, geometryProvenance: [...(input.geometryProvenance ?? []), { nodeId: source.id, ...output.provenance, mapping: output.mapping }] };
    }
    if (source && ANALYSES.includes(component.calculation)) return materialContextForComponent(source, next);
    if (component.geometry && source) throw new Error('Save the completed relaxed structure before applying geometry operations.');
    const record = materials.find(item => item.id === component.materialId);
    if (!record) return null;
    if (record.id === activeMaterialId) return activeMaterialContext;
    return { name: record.name, formula: record.formula, databaseName: databases.find(item => item.id === record.databaseId)?.name ?? '', spaceGroup: record.spaceGroup, atomCount: record.atoms.length, species: Array.from(new Set(record.atoms.map(atom => atom.species))), atoms: record.atoms.map(atom => ({ ...atom })), cellVectors: cellVectorsFromLattice(record.lattice), periodic: record.lattice.periodic, geometryProvenance: record.geometryProvenance };
  };
  const workflowSourceContext = (id: string): MaterialContext => {
    if (id.startsWith('structure:')) return materialContextForComponent({ id: '__source', materialId: id.slice(10), structureSourceId: 'original', calculation: 'Total energy' } as CalculationComponentInstance);
    const node = calculationComponents.find(c => c.id === id);
    if (!node?.geometry) throw new Error('Choose a project structure or a geometry output.');
    return materialContextForComponent({ ...node, id: `output:${node.id}`, geometry: undefined, structureSourceId: node.id });
  };
  const executionSettingsForComponent = (component: CalculationComponentInstance) => {
    const source = calculationComponents.find((item) => item.id === component.structureSourceId);
    return `${summarizeJobDraft(component.draft, component.calculation, materialContextForComponent(component))} · input ${source?.name ?? 'original structure'}`;
  };
  const executionIdentityForComponent = (component: CalculationComponentInstance, seen = new Set<string>()): string | null => {
    if (seen.has(component.id)) return null;
    const sourceId = ANALYSES.includes(component.calculation) && component.scfSourceId ? component.scfSourceId : component.structureSourceId;
    const source = calculationComponents.find(item => item.id === sourceId);
    if (sourceId === 'unbound' || (sourceId !== 'original' && sourceId && !source)) return null;
    const upstream = source ? executionIdentityForComponent(source, new Set(seen).add(component.id)) : null;
    if (source && !upstream) return null;
    const effective = source?.calculation === 'Total energy' && ANALYSES.includes(component.calculation) ? inheritedAnalysisDraft(component.draft, source.draft) : component.draft;
    const selectedScfCalculationId = component.scfReuse?.mode === 'selected' ? component.scfReuse.calculationId : undefined;
    const provenance = source || selectedScfCalculationId ? { ...(source ? { componentId: source.id, identity: upstream } : {}), ...(selectedScfCalculationId ? { selectedScfCalculationId } : {}) } : null;
    if (component.geometry || component.sweep || component.neb) { try { return JSON.stringify({ upstream, geometry: component.geometry, sweep: component.sweep, neb: component.neb, ...(component.neb ? { final: workflowSourceContext(component.neb.finalSourceId), intermediate: component.neb.intermediateSourceId ? workflowSourceContext(component.neb.intermediateSourceId) : undefined } : {}), input: materialContextForComponent(component), draft: effective }); } catch { return null; } }
    return qeExecutionIdentity(effective, component.calculation, materialContextForComponent(component), provenance);
  };
  const reusableCompletedJob = (component: CalculationComponentInstance) => {
    const expectedSettings = executionSettingsForComponent(component);
    const identity = executionIdentityForComponent(component);
    if (!identity) return undefined;
    return jobs.find((job) => (
      job.componentId === component.id
      && completedExecutionAccepted(job, component.calculation)
      && Boolean(job.backendCalculationId)
      && job.settings === expectedSettings
      && job.referenceExecutionFingerprint === identity
    ));
  };
  const reusableDependencyJob = (component: CalculationComponentInstance) => (
    reusableDependencyExecution(jobs.filter((job) => job.referenceExecutionFingerprint === executionIdentityForComponent(component)), component.id, executionSettingsForComponent(component), component.calculation)
  );
  const persistedRunnableCount = jobs.filter((job) => job.materialId === activeMaterialId && job.status === 'Draft').length;
  const configuredReadyCount = activeCalculationComponents.filter((component) => (
    component.selected
    && !reusableCompletedJob(component)
    && !jobs.some((job) => job.componentId === component.id && ['Draft', 'Queued', 'Running'].includes(job.status))
  )).length;
  const runnableJobCount = persistedRunnableCount + configuredReadyCount;

  const requestConfirmation = (next: ConfirmationState) => new Promise<boolean>((resolve) => {
    confirmationResolverRef.current?.(false);
    confirmationResolverRef.current = resolve;
    setConfirmation(next);
  });

  const settleConfirmation = (confirmed: boolean) => {
    const resolve = confirmationResolverRef.current;
    confirmationResolverRef.current = null;
    setConfirmation(null);
    resolve?.(confirmed);
  };

  const syncActiveMaterial = (nextAtoms: CustomAtom[], nextLattice = lattice) => {
    nextAtoms = nextAtoms.map((atom) => ({ ...atom, fx: undefined, fy: undefined, fz: undefined }));
    const editedAt = workspaceTimestamp();
    atomsRef.current = nextAtoms;
    setAtoms(nextAtoms);
    setLattice({ ...nextLattice });
    setMaterials((current) => current.map((record) => record.id === activeMaterialId ? {
      ...record,
      atoms: cloneAtoms(nextAtoms),
      lattice: { ...nextLattice },
      formula: formulaFromAtoms(nextAtoms),
      name: materialName,
      spaceGroup: 'Not recalculated',
      updatedAt: editedAt,
      geometryUpdatedAt: editedAt,
    } : record));
    markProjectEdited(activeProjectId, editedAt);
  };

  const pushHistory = () => {
    historyRef.current.push({ atoms: cloneAtoms(atomsRef.current), rotation: [...objectRotation] as [number, number, number], lattice: { ...lattice } });
    if (historyRef.current.length > 50) historyRef.current.shift();
    redoRef.current = [];
  };

  const commitAtoms = (next: CustomAtom[]) => {
    pushHistory();
    syncActiveMaterial(next);
  };

  const exportScene = async (format: 'png' | 'glb') => {
    if (!sceneExportRef.current || sceneExporting) return;
    setSceneExporting(true);
    try {
      const blob = await sceneExportRef.current(format);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${materialName.replace(/[^a-zA-Z0-9_-]+/g, '-') || 'crystal'}.${format}`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus(`${format.toUpperCase()} ${format === 'png' ? 'image' : 'scene'} exported`);
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Scene export failed'); }
    finally { setSceneExporting(false); }
  };

  const restoreSnapshot = useCallback((snapshot: HistorySnapshot) => {
    const editedAt = workspaceTimestamp();
    const restoredAtoms = cloneAtoms(snapshot.atoms);
    atomsRef.current = restoredAtoms;
    setAtoms(restoredAtoms);
    setLattice({ ...snapshot.lattice });
    setObjectRotation([...snapshot.rotation] as [number, number, number]);
    setMaterials((current) => current.map((record) => record.id === activeMaterialId ? {
      ...record,
      atoms: cloneAtoms(restoredAtoms),
      lattice: { ...snapshot.lattice },
      spaceGroup: 'Not recalculated',
      formula: formulaFromAtoms(restoredAtoms),
      updatedAt: editedAt,
      geometryUpdatedAt: editedAt,
    } : record));
    markProjectEdited(activeProjectId, editedAt);
  }, [activeMaterialId, activeProjectId, markProjectEdited]);

  const undo = useCallback(() => {
    const previous = historyRef.current.pop();
    if (!previous) { setStatus('Nothing to undo'); return; }
    redoRef.current.push({ atoms: cloneAtoms(atomsRef.current), rotation: [...objectRotation] as [number, number, number], lattice: { ...lattice } });
    if (redoRef.current.length > 50) redoRef.current.shift();
    restoreSnapshot(previous);
    setStatus('Undid last edit');
  }, [lattice, objectRotation, restoreSnapshot]);

  const redo = useCallback(() => {
    const next = redoRef.current.pop();
    if (!next) { setStatus('Nothing to redo'); return; }
    historyRef.current.push({ atoms: cloneAtoms(atomsRef.current), rotation: [...objectRotation] as [number, number, number], lattice: { ...lattice } });
    if (historyRef.current.length > 50) historyRef.current.shift();
    restoreSnapshot(next);
    setStatus('Redid last edit');
  }, [lattice, objectRotation, restoreSnapshot]);

  const updateLattice = (key: CellMetric, value: number) => {
    let next: LatticeParameters;
    try { next = changeCellMetric(lattice, key, value); } catch (error) { setStatus(error instanceof Error ? error.message : 'Invalid cell'); return; }
    pushHistory();
    syncActiveMaterial(cloneAtoms(atomsRef.current), next);
    setStatus('Cell updated; symmetry and forces need recalculation');
  };

  const updateCellVectors = (vectors: [[number, number, number], [number, number, number], [number, number, number]]) => {
    let nextLattice: LatticeParameters;
    try { nextLattice = editCrystalCell(lattice, vectors); } catch (error) { setStatus(error instanceof Error ? error.message : 'Invalid cell'); return; }
    pushHistory();
    syncActiveMaterial(cloneAtoms(atomsRef.current), nextLattice);
    setStatus('CELL_PARAMETERS updated');
  };

  const updateStructureAtom = (id: string, patch: Partial<CustomAtom>) => {
    commitAtoms(atomsRef.current.map((atom) => atom.id === id ? { ...atom, ...patch } : atom));
    setStatus('ATOMIC_POSITIONS updated');
  };

  const wrapAtomsIntoCell = () => {
    const wrap = (value: number) => ((value % 1) + 1) % 1;
    commitAtoms(atomsRef.current.map((atom) => ({ ...atom, x: lattice.periodic?.[0] === false ? atom.x : wrap(atom.x), y: lattice.periodic?.[1] === false ? atom.y : wrap(atom.y), z: lattice.periodic?.[2] === false ? atom.z : wrap(atom.z) })));
    setStatus('Wrapped coordinates along periodic directions');
  };

  const updateDisplayedCells = (nextValue: CellRepeat) => {
    const next = nextValue.map((value) => Math.max(1, Math.min(MAX_REPEAT_AXIS, Math.round(value)))) as CellRepeat;
    const cellCount = next[0] * next[1] * next[2];
    const visibleAtomCount = atomsRef.current.length * cellCount;
    if (visibleAtomCount > MAX_DISPLAYED_ATOMS) {
      setStatus(`Preview limited to ${MAX_DISPLAYED_ATOMS.toLocaleString()} atoms · ${next.join(' × ')} would display ${visibleAtomCount.toLocaleString()}`);
      return;
    }
    updateMaterialViewSettings({ supercell: next, showCell: true });
    setStatus(next.every((value) => value === 1)
      ? 'Showing the primary unit cell'
      : `Showing ${next.join(' × ')} cells · preview only`);
  };

  const addVacuumLayer = () => {
    try {
      const next = addCellVacuum(atomsRef.current, lattice, vacuumSize);
      pushHistory();
      syncActiveMaterial(next.atoms, next.lattice);
      setStatus(`Added ${vacuumSize.toFixed(1)} Å normal to the a-b plane; atomic distances preserved`);
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Invalid vacuum thickness'); }
  };

  const selectMaterial = (record: MaterialRecord) => {
    const openedAt = workspaceTimestamp();
    setRecordOpen(false);
    setConfiguringComponentId(null);
    setRightTab('structure');
    setCrystalMode('simple');
    setShowLeftPanel(false);
    setActiveDatabaseId(record.databaseId);
    setActiveProjectId(record.projectId);
    setActiveMaterialId(record.id);
    setProjects((current) => current.map((project) => project.id === record.projectId
      ? { ...project, lastOpenedAt: openedAt }
      : project));
    setMaterials((current) => current.map((material) => material.id === record.id
      ? { ...material, lastOpenedAt: openedAt }
      : material));
    const nextAtoms = cloneAtoms(record.atoms);
    atomsRef.current = nextAtoms;
    setAtoms(nextAtoms);
    setLattice({ ...record.lattice });
    setMaterialName(record.name);
    setSelectedAtomId(null);
    setMoveOrigin(null);
    replaceMeasureSelection([]);
    setObjectRotation([0, 0, 0]);
    applyMaterialViewSettings(record.viewSettings);
    historyRef.current = [];
    redoRef.current = [];
    setStatus(`Opened ${record.name}`);
  };

  useEffect(() => {
    if (!workspaceHydrated || !activeDatabase || new URLSearchParams(window.location.search).get('from') !== 'md') return;
    let transfer: ReturnType<typeof readMdTransfer> | null = null;
    try {
      const raw = window.localStorage.getItem(mdTransferKey(ownerId));
      if (raw) transfer = readMdTransfer(raw, ownerId);
    } catch (error) {
      const update = requestAnimationFrame(() => setStatus(error instanceof Error ? error.message : 'Invalid MD frame transfer.'));
      return () => cancelAnimationFrame(update);
    }
    if (!transfer) return;
    const atoms = transfer.atoms;
    const timestamp = workspaceTimestamp();
    const project = activeProject ?? {
      id: nextAvailableId('project-md', projects.map(p => p.id)), databaseId: activeDatabase.id,
      name: 'MD frame studies', description: 'Frames transferred from MD Lab',
      createdAt: timestamp, updatedAt: timestamp, lastOpenedAt: timestamp,
    };
    const id = nextAvailableId('mat-md', materials.map((record) => record.id));
    const record: MaterialRecord = {
      id,
      databaseId: project.databaseId,
      projectId: project.id,
      name: transfer.name || 'MD frame',
      formula: formulaFromAtoms(atoms),
      spaceGroup: 'P1 · 1',
      kind: 'MD frame',
      atoms,
      lattice: transfer.lattice,
      source: 'Local',
      sourceFileName: transfer.sourceTrajectory,
      geometryUpdatedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastOpenedAt: timestamp,
    };
    const transferFrame = window.requestAnimationFrame(() => {
      if (!activeProject) setProjects(current => current.concat(project));
      setMaterials((current) => current.concat(record));
      markProjectEdited(project.id, timestamp);
      selectMaterial(record);
      setStatus('Imported frame from MD Lab');
      try { window.localStorage.removeItem(mdTransferKey(ownerId)); } catch {}
      const url = new URL(window.location.href);
      url.searchParams.delete('from');
      window.history.replaceState(window.history.state, '', url.pathname + (url.searchParams.toString() ? '?' + url.searchParams.toString() : '') + url.hash);
    });
    return () => window.cancelAnimationFrame(transferFrame);
  // selectMaterial is intentionally kept out: it is an event-style helper whose
  // identity changes with the workspace render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDatabase, activeProject, materials, markProjectEdited, ownerId, projects, workspaceHydrated]);

  const selectProject = (projectId: string) => {
    const project = projects.find((item) => item.id === projectId);
    if (!project) return;
    setRecordOpen(false);
    setConfiguringComponentId(null);
    setRightTab('structure');
    setActiveDatabaseId(project.databaseId);
    setActiveProjectId(project.id);
    setProjects((current) => current.map((item) => item.id === project.id
      ? { ...item, lastOpenedAt: workspaceTimestamp() }
      : item));
    const projectMaterials = materials.filter((record) => record.projectId === project.id);
    const targetMaterial = projectMaterials.find((record) => record.id === activeMaterialId)
      ?? projectMaterials[0];
    if (targetMaterial) {
      selectMaterial(targetMaterial);
    } else {
      setActiveMaterialId('');
      atomsRef.current = [];
      setAtoms([]);
      setMaterialName('No structure selected');
      setShowCell(false);
      setSelectedAtomId(null);
      replaceMeasureSelection([]);
      historyRef.current = [];
      redoRef.current = [];
      setStatus(`${project.name} has no structures yet · import one to begin`);
    }
  };

  const restoreShellNavigation = useEffectEvent(() => {
    const navigation = resolveCalculationNavigation(window.location.search, projects.map(project => project.id));
    if (navigation.projectId && navigation.projectId !== activeProjectId) selectProject(navigation.projectId);
    else if (!navigation.projectId && activeProjectId) clearStructureSelection('db-workspace', 'Workspace');
    if (showFigures !== (navigation.view === 'figures')) {
      setFigureInitialJobId(undefined);
      setShowFigures(navigation.view === 'figures');
    }
  });
  useEffect(() => {
    if (shell?.location && workspaceHydrated) restoreShellNavigation();
  }, [shell?.location, workspaceHydrated]);

  // Rebind after a commit so browser navigation sees the latest project/material records.
  useEffect(() => {
    if (!workspaceHydrated) return;
    const workspacePath = window.location.pathname;
    const restoreNavigation = () => {
      if (window.location.pathname !== workspacePath) return;
      const navigation = resolveCalculationNavigation(window.location.search, projects.map((project) => project.id));
      if (navigation.projectId && navigation.projectId !== activeProjectId) selectProject(navigation.projectId);
      else if (!navigation.projectId && activeProjectId) clearStructureSelection('db-workspace', 'Workspace');
      setFigureInitialJobId(undefined);
      setShowFigures(navigation.view === 'figures');
      setShowWorkflow(navigation.view === 'workflow');
    };
    window.addEventListener('popstate', restoreNavigation);
    return () => window.removeEventListener('popstate', restoreNavigation);
  });

  const createProject = (name?: string) => {
    const projectName = name?.trim() ?? '';
    if (!projectName || !activeDatabase) { setStatus('Enter a research project name'); return; }
    const id = nextAvailableId('project-custom', projects.map((project) => project.id));
    const timestamp = workspaceTimestamp();
    setProjects((current) => [...current, { id, databaseId: activeDatabase.id, name: projectName, description: 'Structures and calculations for this research topic', createdAt: timestamp, updatedAt: timestamp, lastOpenedAt: timestamp }]);
    setActiveProjectId(id);
    setActiveMaterialId('');
    atomsRef.current = [];
    setAtoms([]);
    setMaterialName('No structure selected');
    setShowCell(false);
    historyRef.current = [];
    redoRef.current = [];
    setStatus(`${projectName} project created`);
  };

  const clearStructureSelection = (databaseId: string, projectName: string, projectId = '') => {
    setRecordOpen(false);
    setConfiguringComponentId(null);
    setRightTab('structure');
    setActiveDatabaseId(databaseId);
    setActiveProjectId(projectId);
    setActiveMaterialId('');
    atomsRef.current = [];
    setAtoms([]);
    setMaterialName('No structure selected');
    setShowCell(false);
    setSelectedAtomId(null);
    setMoveOrigin(null);
    replaceMeasureSelection([]);
    historyRef.current = [];
    redoRef.current = [];
    setStatus(`${projectName} has no structures yet · import one to begin`);
  };

  const deleteProject = async (projectId: string) => {
    const project = projects.find((item) => item.id === projectId);
    if (!project) return;
    const projectStructureIds = new Set(materials.filter((record) => record.projectId === projectId).map((record) => record.id));
    const jobCount = jobs.filter((job) => projectStructureIds.has(job.materialId)).length;
    if (!await requestConfirmation({
      title: 'Delete project?',
      description: `${project.name} contains ${projectStructureIds.size} structure${projectStructureIds.size === 1 ? '' : 's'} and ${jobCount} calculation job${jobCount === 1 ? '' : 's'}. They will be removed together.`,
      confirmLabel: 'Delete project',
      tone: 'danger',
    })) return;
    const fallbackProject = projects.find((item) => item.id !== projectId) ?? null;
    const fallbackMaterial = fallbackProject ? materials.find((record) => record.projectId === fallbackProject.id) : undefined;
    setProjects((current) => current.filter((item) => item.id !== projectId));
    setMaterials((current) => current.filter((record) => record.projectId !== projectId));
    setJobs((current) => current.filter((job) => !projectStructureIds.has(job.materialId)));
    setCalculationComponents((current) => current.filter((component) => !projectStructureIds.has(component.materialId)));
    setCalculationConfigurations((current) => current.filter((configuration) => !projectStructureIds.has(configuration.materialId)));
    if (activeProjectId === projectId) {
      if (fallbackMaterial) selectMaterial(fallbackMaterial);
      else if (fallbackProject) clearStructureSelection(fallbackProject.databaseId, fallbackProject.name, fallbackProject.id);
      else {
        clearStructureSelection(activeDatabase?.id ?? 'db-workspace', 'Workspace');
        setShowCell(false);
      }
    }
    setStatus(`${project.name} deleted`);
  };

  const duplicateProject = (projectId: string) => {
    const source = projects.find((project) => project.id === projectId);
    if (!source) return;
    const timestamp = workspaceTimestamp();
    const id = nextAvailableId('project-copy', projects.map((project) => project.id));
    const projectCopy: ResearchProject = { ...source, id, name: `${source.name} copy`, createdAt: timestamp, updatedAt: timestamp, lastOpenedAt: timestamp };
    const occupiedMaterialIds = materials.map((record) => record.id);
    const structureCopies = materials.filter((record) => record.projectId === source.id).map((record) => {
      const materialId = nextAvailableId('mat-copy', occupiedMaterialIds);
      occupiedMaterialIds.push(materialId);
      return {
        ...record,
        id: materialId,
        projectId: id,
        atoms: record.atoms.map((atom, index) => ({ ...atom, id: `${materialId}-atom-${index + 1}` })),
        lattice: { ...record.lattice },
        source: 'Local' as const,
        externalId: undefined,
        sourceUpdatedAt: undefined,
        sourceGeometryUpdatedAt: undefined,
        geometryUpdatedAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
        lastOpenedAt: timestamp,
      } satisfies MaterialRecord;
    });
    setProjects((current) => [...current, projectCopy]);
    setMaterials((current) => [...current, ...structureCopies]);
    if (structureCopies[0]) selectMaterial(structureCopies[0]);
    else {
      setActiveDatabaseId(projectCopy.databaseId);
      setActiveProjectId(projectCopy.id);
      setActiveMaterialId('');
      atomsRef.current = [];
      setAtoms([]);
      setMaterialName('No structure selected');
    }
    setStatus(`${projectCopy.name} created with ${structureCopies.length} structure${structureCopies.length === 1 ? '' : 's'}`);
  };

  const duplicateMaterial = (materialId = activeMaterialId) => {
    const source = materials.find((record) => record.id === materialId);
    if (!source) { setStatus('Select a structure to duplicate'); return; }
    const timestamp = workspaceTimestamp();
    const id = nextAvailableId('mat-copy', materials.map((record) => record.id));
    const record: MaterialRecord = { ...source, id, name: `${source.name} copy`, kind: 'Variant', atoms: source.atoms.map((atom, index) => ({ ...atom, id: `${id}-atom-${index + 1}` })), lattice: { ...source.lattice }, source: 'Local', externalId: undefined, sourceUpdatedAt: undefined, sourceGeometryUpdatedAt: undefined, geometryUpdatedAt: timestamp, createdAt: timestamp, updatedAt: timestamp, lastOpenedAt: timestamp };
    setMaterials((current) => [...current, record]);
    markProjectEdited(record.projectId, timestamp);
    selectMaterial(record);
    setStatus(`${record.name} added to ${projects.find((project) => project.id === record.projectId)?.name ?? 'the project'}`);
  };

  const createStructure = () => {
    if (!activeProject) { setStatus('Select a research project first'); return; }
    const siblings = materials.filter((record) => record.projectId === activeProject.id && record.kind === 'Draft');
    const ordinal = siblings.length + 1;
    const id = nextAvailableId('mat-draft', materials.map((record) => record.id));
    const timestamp = workspaceTimestamp();
    const record: MaterialRecord = {
      id,
      databaseId: activeProject.databaseId,
      projectId: activeProject.id,
      name: ordinal === 1 ? 'Untitled structure' : `Untitled structure ${ordinal}`,
      formula: 'Si',
      spaceGroup: 'P1 · 1',
      kind: 'Draft',
      atoms: [{ id: `${id}-si-1`, species: 'Si', x: 0.5, y: 0.5, z: 0.5 }],
      lattice: { a: 5, b: 5, c: 5, alpha: 90, beta: 90, gamma: 90 },
      geometryUpdatedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastOpenedAt: timestamp,
    };
    setMaterials((current) => [...current, record]);
    markProjectEdited(activeProject.id, timestamp);
    selectMaterial(record);
    setStatus(`${record.name} added to ${activeProject.name}`);
  };

  const deleteMaterial = async (materialId: string) => {
    const record = materials.find((item) => item.id === materialId);
    if (!record) return;
    const linkedJobs = jobs.filter((job) => job.materialId === materialId).length;
    if (!await requestConfirmation({
      title: 'Delete structure?',
      description: `${record.name}${linkedJobs ? ` is linked to ${linkedJobs} calculation job${linkedJobs === 1 ? '' : 's'}. The linked history` : ' and its calculation history'} will also be removed.`,
      confirmLabel: 'Delete structure',
      tone: 'danger',
    })) return;
    const fallback = materials.find((item) => item.projectId === record.projectId && item.id !== materialId);
    setMaterials((current) => current.filter((item) => item.id !== materialId));
    setJobs((current) => current.filter((job) => job.materialId !== materialId));
    setCalculationComponents((current) => current.filter((component) => component.materialId !== materialId));
    setCalculationConfigurations((current) => current.filter((configuration) => configuration.materialId !== materialId));
    markProjectEdited(record.projectId);
    if (activeMaterialId === materialId) {
      if (fallback) selectMaterial(fallback);
      else clearStructureSelection(record.databaseId, activeProject?.name ?? 'Project', record.projectId);
    }
    setStatus(`${record.name} deleted`);
  };

  const renameProject = (projectId: string, name: string) => {
    const editedAt = workspaceTimestamp();
    setProjects((current) => current.map((project) => project.id === projectId ? { ...project, name, updatedAt: editedAt } : project));
    setStatus(`Project renamed to ${name}`);
  };

  const renameMaterial = (materialId: string, name: string) => {
    const editedAt = workspaceTimestamp();
    const projectId = materials.find((record) => record.id === materialId)?.projectId ?? '';
    setMaterials((current) => current.map((record) => record.id === materialId ? { ...record, name, updatedAt: editedAt } : record));
    markProjectEdited(projectId, editedAt);
    if (activeMaterialId === materialId) setMaterialName(name);
    setStatus(`Structure renamed to ${name}`);
  };

  const addAtomAtCenter = (speciesOverride?: string) => {
    if (!activeMaterialId) { setStatus('Import or select a structure before adding atoms'); return; }
    const species = speciesOverride ?? selectedAtom?.species ?? atoms[0]?.species ?? 'Si';
    let index = atomsRef.current.length + 1;
    while (atomsRef.current.some((item) => item.id === `atom-${activeMaterialId}-${index}`)) index += 1;
    const atom: CustomAtom = { id: `atom-${activeMaterialId}-${index}`, species, label: species, x: 0.5, y: 0.5, z: 0.5 };
    commitAtoms([...atomsRef.current, atom]);
    setSelectedAtomId(atom.id);
    setActiveTool('move');
    setStatus(`${species} atom added · drag the arrows to place it`);
  };

  const chooseElement = (species: string) => {
    if (elementPaletteMode === 'substitute') {
      if (!selectedAtomId) { setStatus('Select an atom before substituting its species'); return; }
      updateSelectedAtom('species', species);
      setStatus(`Selected atom substituted with ${species}`);
    } else {
      addAtomAtCenter(species);
    }
    setElementPaletteMode(null);
  };

  const deleteAtom = (id: string | null) => {
    if (!id) { setStatus('Select an atom to delete'); return; }
    if (atomsRef.current.length <= 1) { setStatus('A structure must contain at least one atom'); return; }
    const removed = atomsRef.current.find((atom) => atom.id === id);
    const next = atomsRef.current.filter((atom) => atom.id !== id);
    pushHistory();
    syncActiveMaterial(next);
    setSelectedAtomId(next[0]?.id ?? null);
    setStatus(`${removed?.species ?? 'Atom'} deleted · Undo is available`);
  };

  const deleteSelected = () => deleteAtom(selectedAtomId);

  const updateSelectedAtom = (key: 'species' | 'x' | 'y' | 'z', value: string | number) => {
    if (!selectedAtomId) return;
    commitAtoms(atomsRef.current.map((atom) => atom.id === selectedAtomId
      ? key === 'species' ? { ...atom, species: String(value), label: String(value) } : { ...atom, [key]: value }
      : atom));
  };

  const updateSelectedPosition = (position: [number, number, number], recordHistory = true) => {
    if (!selectedAtomId) return;
    const next = atomsRef.current.map((atom) => atom.id === selectedAtomId ? { ...atom, x: position[0], y: position[1], z: position[2] } : atom);
    if (recordHistory) commitAtoms(next);
    else syncActiveMaterial(next);
  };

  const setCoordinateValue = (axis: number, value: number) => {
    if (!selectedAtom || !Number.isFinite(value)) return;
    const fractional: [number, number, number] = [selectedAtom.x, selectedAtom.y, selectedAtom.z];
    if (coordinateMode === 'fractional') {
      fractional[axis] = value;
      updateSelectedPosition(fractional);
      return;
    }
    const cartesian = fractionalToCartesian(selectedAtom, lattice);
    if (coordinateMode === 'cartesian') cartesian[axis] = value;
    else {
      const origin = moveOrigin ?? fractional;
      const originCartesian = fractionalToCartesian({ x: origin[0], y: origin[1], z: origin[2] }, lattice);
      cartesian[axis] = originCartesian[axis] + value;
    }
    updateSelectedPosition(cartesianToFractional(cartesian, lattice));
  };

  const nudgeSelectedAtom = (axis: number, direction: -1 | 1) => {
    if (!selectedAtom) return;
    const cartesian = fractionalToCartesian(selectedAtom, lattice);
    cartesian[axis] += direction * moveSnap;
    updateSelectedPosition(cartesianToFractional(cartesian, lattice));
    setStatus(`Moved ${direction > 0 ? '+' : '−'}${['X', 'Y', 'Z'][axis]} by ${moveSnap} Å`);
  };

  const duplicateSelectedAtom = () => {
    if (!selectedAtom || !activeMaterialId) return;
    const id = nextAvailableId(`atom-${activeMaterialId}`, atomsRef.current.map((atom) => atom.id));
    const cartesian = fractionalToCartesian(selectedAtom, lattice);
    cartesian[0] += moveSnap;
    const fractional = cartesianToFractional(cartesian, lattice);
    const duplicate: CustomAtom = { ...selectedAtom, id, x: fractional[0], y: fractional[1], z: fractional[2] };
    commitAtoms([...atomsRef.current, duplicate]);
    setSelectedAtomId(id);
    setMoveOrigin([duplicate.x, duplicate.y, duplicate.z]);
    setActiveTool('move');
    setStatus(`${duplicate.species} atom duplicated · offset ${moveSnap} Å`);
  };

  const resetMoveSession = () => {
    if (!moveOrigin || !selectedAtomId) return;
    updateSelectedPosition(moveOrigin);
    setStatus('Move reset to session origin');
  };

  const applyMoveSession = () => {
    if (!selectedAtom) return;
    setMoveOrigin([selectedAtom.x, selectedAtom.y, selectedAtom.z]);
    setStatus('Atom position applied');
  };

  const moveAtomFromGizmo = (id: string, position: [number, number, number]) => {
    const next = atomsRef.current.map((atom) => atom.id === id ? { ...atom, x: position[0], y: position[1], z: position[2] } : atom);
    syncActiveMaterial(next);
    setStatus('Atom moved');
  };

  const selectedMeasurementCoordinates = measureSelection.flatMap((selection) => {
    const resolved = resolveMeasurementPoint(selection, atoms, lattice);
    if (!resolved) return [];
    return [{
      instanceId: selection.instanceId,
      name: resolved.atom.label?.trim() || resolved.atom.species,
      species: resolved.atom.species,
      fractional: resolved.fractional,
      cartesian: resolved.cartesian,
    }];
  });

  const startMeasurement = (mode: MeasureMode) => {
    measureModeRef.current = mode;
    setMeasureMode(mode);
    setSelectedAtomId(null);
    replaceMeasureSelection([]);
    setActiveTool('measure');
    setStatus(`${mode === 'atom' ? 'Atom info' : mode[0].toUpperCase() + mode.slice(1)} · select ${mode === 'atom' ? 'an atom' : `the first of ${mode === 'distance' ? 2 : 3} atoms`}`);
  };

  const handleSelectAtom = (id: string | null, instanceId?: string) => {
    if (!id) {
      setSelectedAtomId(null);
      if (activeTool === 'measure') {
        replaceMeasureSelection([]);
        setStatus(`Measure ${measureModeRef.current} · selection cleared`);
      }
      return;
    }
    setShowLeftPanel(false);
    if (activeTool === 'delete') { deleteAtom(id); return; }
    if (activeTool !== 'measure') {
      setSelectedAtomId(id);
      setRightTab('structure');
      const atom = atomsRef.current.find((item) => item.id === id);
      if (atom && id !== selectedAtomId) setMoveOrigin([atom.x, atom.y, atom.z]);
      return;
    }
    const currentMode = measureModeRef.current;
    const selectedInstance = instanceId ?? atomInstanceId(id, [0, 0, 0]);
    const candidate = { atomId: id, instanceId: selectedInstance };
    const targetCount = measurementTargetCount(currentMode);
    const currentSelection = measureSelectionRef.current;
    const startingNewMeasurement = currentSelection.length >= targetCount;
    const current = startingNewMeasurement ? [] : currentSelection;
    if (current.some((selection) => selection.instanceId === selectedInstance)) {
      setStatus('Choose a different atom instance for this measurement');
      return;
    }
    const next = [...current, candidate];
    replaceMeasureSelection(next);
    if (next.length < targetCount) {
      setStatus(`Measure ${currentMode} · select atom ${next.length + 1} of ${targetCount}`);
      return;
    }
    setStatus(`${currentMode === 'atom' ? 'Atom information' : currentMode[0].toUpperCase() + currentMode.slice(1)} measured`);
  };

  const importStructure = async (file?: File) => {
    if (!file) return;
    if (!activeProjectId) { setStatus('Create or select a research project before importing'); return; }
    try {
      const content = await file.text();
      const parsed = parseStructureText(content, file.name);
      const id = nextAvailableId('mat-import', materials.map((record) => record.id));
      const isQuantumEspresso = /\.(in|pwi|pw|qe|out|pwo)$/i.test(file.name);
      const timestamp = workspaceTimestamp();
      const record: MaterialRecord = {
        id,
        databaseId: activeDatabaseId,
        projectId: activeProjectId,
        name: parsed.name,
        formula: formulaFromAtoms(parsed.atoms),
        spaceGroup: 'Not determined',
        kind: isQuantumEspresso ? 'Quantum ESPRESSO' : 'Imported',
        atoms: parsed.atoms,
        lattice: parsed.lattice,
        source: 'Local',
        sourceFileName: file.name,
        geometryUpdatedAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
        lastOpenedAt: timestamp,
      };
      setMaterials((current) => [...current, record]);
      markProjectEdited(activeProjectId, timestamp);
      selectMaterial(record);
      setStatus(`${file.name} added to ${activeProject?.name ?? 'the research project'}`);
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Import failed'); }
  };

  const resetStructureDrop = () => {
    structureDragDepth.current = 0;
    setStructureDropActive(false);
    setStructureDropSupported(null);
  };

  const droppedStructureFiles = (event: ReactDragEvent<HTMLElement>) => Array.from(event.dataTransfer.files);
  const isFileDrag = (event: ReactDragEvent<HTMLElement>) => Array.from(event.dataTransfer.types).includes('Files');

  const handleStructureDragEnter = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    structureDragDepth.current += 1;
    const files = Array.from(event.dataTransfer.items)
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    setStructureDropSupported(files.length ? files.length === 1 && isSupportedStructureFileName(files[0].name) : null);
    setStructureDropActive(true);
  };

  const handleStructureDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = activeProjectId && structureDropSupported !== false ? 'copy' : 'none';
  };

  const handleStructureDragLeave = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    structureDragDepth.current = Math.max(0, structureDragDepth.current - 1);
    if (structureDragDepth.current === 0) resetStructureDrop();
  };

  const handleStructureDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const files = droppedStructureFiles(event);
    resetStructureDrop();
    if (!activeProjectId) {
      setStatus('Create or select a research project before importing');
      return;
    }
    if (files.length !== 1) {
      setStatus(files.length ? 'Drop one structure file at a time' : 'No structure file found in this drop');
      return;
    }
    if (!isSupportedStructureFileName(files[0].name)) {
      setStatus('Unsupported file. Use CIF, XSF, POSCAR, VASP, XYZ, PDB, or Quantum ESPRESSO input/output.');
      return;
    }
    void importStructure(files[0]);
  };

  const importFromMaterialsProject = (incoming: MaterialsProjectMaterial[]) => {
    if (!incoming.length || !activeDatabase || !activeProject) return;

    const duplicates = new Set(
      materials
        .filter((record) => record.projectId === activeProject.id && record.externalId)
        .map((record) => record.externalId),
    );
    const occupiedIds = materials.map((record) => record.id);
    const timestamp = workspaceTimestamp();
    const records = incoming
      .filter((material) => !duplicates.has(material.materialId))
      .map((material) => {
        const id = nextAvailableId('mat-mp', occupiedIds);
        occupiedIds.push(id);
        return {
          id,
          databaseId: activeDatabase.id,
          projectId: activeProject.id,
          name: `${material.formula} · ${material.materialId}`,
          formula: material.formula,
          spaceGroup: `${material.spaceGroupSymbol} · ${material.spaceGroupNumber}`,
          kind: 'Materials Project',
          atoms: cloneAtoms(material.atoms),
          lattice: { ...material.lattice },
          source: 'Materials Project' as const,
          externalId: material.materialId,
          sourceUpdatedAt: material.lastUpdated,
          geometryUpdatedAt: timestamp,
          sourceGeometryUpdatedAt: timestamp,
          bandGap: material.bandGap,
          energyAboveHull: material.energyAboveHull,
          createdAt: timestamp,
          updatedAt: timestamp,
          lastOpenedAt: timestamp,
        } satisfies MaterialRecord;
      });

    if (!records.length) {
      const existing = materials.find(
        (record) => record.projectId === activeProject.id && record.externalId === incoming[0]?.materialId,
      );
      if (existing) selectMaterial(existing);
      setStatus('Selected Materials Project structures already exist in this project');
      return;
    }

    setMaterials((current) => [...current, ...records]);
    markProjectEdited(activeProject.id, timestamp);
    selectMaterial(records[0]);
    setStatus(`${records.length} Materials Project structure${records.length > 1 ? 's' : ''} imported to ${activeProject.name}`);
  };

  const exportStructure = (format: 'cif' | 'xyz' | 'xsf' | 'poscar') => {
    try {
    const content = format === 'cif'
      ? createCIF(materialName, atomsRef.current, lattice)
      : format === 'xyz'
        ? createXYZ(materialName, atomsRef.current, lattice)
        : format === 'xsf'
          ? createXSF(materialName, atomsRef.current, lattice)
          : createPOSCAR(materialName, atomsRef.current, lattice);
    const url = URL.createObjectURL(new Blob([content], { type: 'text/plain' }));
    const slug = materialName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const extension = format === 'poscar' ? 'vasp' : format;
    const link = document.createElement('a'); link.href = url; link.download = `${slug}.${extension}`; link.click(); URL.revokeObjectURL(url);
    setStatus(`${format === 'poscar' ? 'POSCAR' : format.toUpperCase()} exported`);
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Structure export failed'); }
  };

  const focusSelected = useCallback(() => {
    if (!selectedAtomId) { setStatus('Select an atom first'); return; }
    setFocusRequest((current) => current + 1);
  }, [selectedAtomId]);

  const fitStructure = useCallback(() => {
    setViewMenuOpen(false);
    setActiveViewAngle('isometric');
    setFitRequest((current) => current + 1);
    setStatus('Reset view to default isometric');
  }, []);

  const snapCameraView = useCallback((viewId: ViewAngleId) => {
    const view = viewAngles.find((item) => item.id === viewId);
    if (!view) return;
    setActiveViewAngle(viewId);
    setCameraViewRequest((current) => ({ id: (current?.id ?? 0) + 1, direction: view.direction, up: view.up }));
    setViewMenuOpen(false);
    setStatus(`${view.label} view · ${view.axis}`);
  }, []);

  const activateTool = (tool: ToolId) => {
    setViewMenuOpen(false);
    if (activeTool === 'measure' && tool !== 'measure') {
      setActiveTool('select');
      setSelectedAtomId(null);
      replaceMeasureSelection([]);
    }
    if (tool === 'add') { setElementPaletteMode('add'); return; }
    if (tool === 'measure') { startMeasurement('atom'); return; }
    if (tool === 'delete') {
      if (atomsRef.current.length <= 1) { setStatus('A structure must contain at least one atom'); return; }
      setActiveTool('delete');
      replaceMeasureSelection([]);
      setStatus('Delete · click any atom to remove it, then use Undo if needed');
      return;
    }
    if (tool === 'move' && !selectedAtomId) { setActiveTool('select'); setStatus('Select an atom before moving it'); return; }
    setActiveTool(tool);
    replaceMeasureSelection([]);
    if (tool === 'move') {
      const atom = atomsRef.current.find((item) => item.id === selectedAtomId);
      if (atom) setMoveOrigin([atom.x, atom.y, atom.z]);
      setStatus('Move · drag an axis or plane handle, or enter exact coordinates');
      return;
    }
    setStatus('Select · click an atom or scene object');
  };

  const openJobSetup = () => {
    setRightTab('calculations');
    setShowLeftPanel(false);
    setShowInspector(true);
  };

  const toggleProjectPanel = () => {
    if (shell) { shell.openSidebar(); return; }
    setShowLeftPanel((current) => {
      const next = !current;
      if (next) setShowInspector(false);
      return next;
    });
  };

  const toggleInspectorPanel = () => {
    shell?.closeMobileNavigation();
    setShowInspector((current) => {
      const next = !current;
      if (next) setShowLeftPanel(false);
      return next;
    });
  };

  useEffect(() => {
    const closeDrawersForViewport = () => {
      if (window.innerWidth >= 1280) {
        setShowLeftPanel(false);
        setShowInspector(false);
      } else if (window.innerWidth >= 1024) {
        setShowInspector(false);
      }
    };
    const closeDrawersOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (window.innerWidth < 1280) setShowLeftPanel(false);
      if (window.innerWidth < 1024) setShowInspector(false);
    };
    window.addEventListener('resize', closeDrawersForViewport);
    window.addEventListener('keydown', closeDrawersOnEscape);
    return () => {
      window.removeEventListener('resize', closeDrawersForViewport);
      window.removeEventListener('keydown', closeDrawersOnEscape);
    };
  }, []);

  const updateCalculationDraft = (patch: Partial<JobDraft>) => {
    const next = { ...jobDraft, ...patch };
    setJobDraft(next);
    if (configuringComponentId) {
      setCalculationComponents((current) => current.map((component) => component.id === configuringComponentId ? { ...component, draft: { ...next, calculations: [component.calculation] } } : component));
      markStudyEdited();
    }
  };

  const addCalculationComponent = (calculation: CalculationType, sourceDraft?: JobDraft, dependentComponentId?: string) => {
    if (!activeMaterial) { setStatus('Select a structure before adding calculations'); return; }
    const siblings = calculationComponents.filter((component) => component.materialId === activeMaterial.id && component.calculation === calculation);
    const ordinal = siblings.length + 1;
    const name = ordinal === 1 ? calculation : `${calculation} ${ordinal}`;
    const id = nextAvailableId('calc-component', calculationComponents.map((component) => component.id));
    const basePrefix = activeMaterial.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'crystal';
    const draft = normalizeJobDraft({
      ...(sourceDraft ?? jobDraft),
      calculations: [calculation],
      title: `${activeMaterial.name} · ${name}`,
      prefix: `${basePrefix}-${calculation.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${ordinal}`,
      rawInput: '',
    } satisfies JobDraft);
    const latestRelaxation = [...calculationComponents].reverse().find((component) => component.materialId === activeMaterial.id && component.calculation === 'Structural relaxation');
    const structureSourceId = calculation === 'Structural relaxation' ? 'original' : latestRelaxation?.id ?? 'original';
    const component: CalculationComponentInstance = { id, materialId: activeMaterial.id, calculation, name, selected: true, structureSourceId, draft };
    setCalculationComponents((current) => migrateWorkflow([...current.map((item) => item.id === dependentComponentId ? { ...item, structureSourceId: id } : item), component], c => generateQuantumEspressoInputFiles(c.draft, c.calculation, materialContextForComponent(c)).find(f => f.name === 'scf.in')?.content ?? ''));
    markStudyEdited(activeMaterial.id, activeMaterial.projectId);
    setJobDraft(draft);
    setConfiguringComponentId(id);
    setStatus(dependentComponentId ? `${name} added and linked as the relaxed geometry source` : `${name} added to ${activeMaterial.name}`);
    if (window.innerWidth < 1024) setShowInspector(false);
  };

  const toggleCalculationComponent = (id: string) => {
    setCalculationComponents((current) => current.map((component) => component.id === id ? { ...component, selected: !component.selected } : component));
    markStudyEdited();
  };

  const reorderCalculationComponent = useCallback((sourceId: string, targetId: string) => {
    setCalculationComponents((current) => {
      const source = current.find((component) => component.id === sourceId);
      const target = current.find((component) => component.id === targetId);
      if (!source || !target || source.materialId !== target.materialId) return current;
      return reorderItemsById(current, sourceId, targetId);
    });
    markStudyEdited();
  }, [markStudyEdited]);

  const moveCalculationComponent = useCallback((id: string, direction: -1 | 1) => {
    setCalculationComponents((current) => {
      const source = current.find((component) => component.id === id);
      if (!source) return current;
      return moveItemById(current, id, direction, (component) => component.materialId === source.materialId);
    });
    markStudyEdited();
  }, [markStudyEdited]);

  const duplicateCalculationComponent = (id: string) => {
    const source = calculationComponents.find((component) => component.id === id);
    if (!source) return;
    const siblings = calculationComponents.filter((component) => component.materialId === source.materialId && component.calculation === source.calculation);
    const ordinal = siblings.length + 1;
    const duplicateId = nextAvailableId('calc-component', calculationComponents.map((component) => component.id));
    const name = `${source.calculation} ${ordinal}`;
    const duplicate: CalculationComponentInstance = { ...source, id: duplicateId, name, selected: true, draft: { ...source.draft, title: `${activeMaterial?.name ?? 'Material'} · ${name}`, prefix: `${source.draft.prefix}-${ordinal}` } };
    setCalculationComponents((current) => [...current, duplicate]);
    markStudyEdited(source.materialId, materials.find((record) => record.id === source.materialId)?.projectId ?? activeProjectId);
    setStatus(`${name} duplicated with an independent configuration`);
  };

  const downloadCalculationInputFiles = (id: string) => {
    const component = calculationComponents.find((item) => item.id === id);
    if (!component || !activeMaterialContext) {
      setStatus('Select a calculation with an active structure first');
      return;
    }
    try {
      const files = generateQuantumEspressoInputFiles(component.draft, component.calculation, materialContextForComponent(component));
      const archive = zipSync(Object.fromEntries(files.map((file) => [file.name, strToU8(file.content)])), { level: 6 });
      const blob = new Blob([new Uint8Array(archive)], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const archiveName = `${component.draft.prefix || component.name}-input-files`
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
      link.href = url;
      link.download = `${archiveName}.zip`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setStatus(`${files.length} input file${files.length === 1 ? '' : 's'} downloaded for ${component.name}`);
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Invalid QE input'); }
  };

  const deleteCalculationComponent = (id: string) => {
    const component = calculationComponents.find((item) => item.id === id);
    setCalculationComponents((current) => current.filter((item) => item.id !== id).map((item) => item.structureSourceId === id ? { ...item, structureSourceId: 'original' } : item));
    if (component) markStudyEdited(component.materialId, materials.find((record) => record.id === component.materialId)?.projectId ?? activeProjectId);
    if (configuringComponentId === id) setConfiguringComponentId(null);
    setStatus(component ? `${component.name} removed from the calculation stack` : 'Calculation removed');
  };

  const changeCalculationStructureSource = (sourceId: string) => {
    if (!configuringComponentId || !configuringComponent) return;
    try { if (!ANALYSES.includes(configuringComponent.calculation)) connectWorkflow({components:calculationComponents,canvas:defaultWorkflowCanvas()},projectMaterials,sourceId==='original'?structureNodeId(configuringComponent.materialId):sourceId,configuringComponentId); } catch(error) { setStatus(error instanceof Error?error.message:'Invalid geometry source.'); return; }
    setCalculationComponents((current) => current.map((component) => component.id === configuringComponentId ? { ...component, structureSourceId: sourceId } : component));
    markStudyEdited();
    const source = calculationComponents.find((component) => component.id === sourceId);
    setStatus(source ? `${configuringComponent?.name ?? 'Calculation'} will use ${source.geometry ? 'the geometry output' : 'the relaxed output'} from ${source.name}` : `${configuringComponent?.name ?? 'Calculation'} will use the original structure`);
  };

  const importDraftFromCalculation = (sourceId: string) => {
    if (!configuringComponent) return;
    const source = calculationComponents.find((component) => component.id === sourceId && component.calculation === configuringComponent.calculation);
    if (!source) { setStatus('Compatible calculation configuration was not found'); return; }
    const next = {
      ...source.draft,
      calculations: [configuringComponent.calculation],
      title: configuringComponent.draft.title,
      prefix: configuringComponent.draft.prefix,
      rawInput: '',
    };
    setJobDraft(next);
    setCalculationComponents((current) => current.map((component) => component.id === configuringComponent.id ? { ...component, draft: next } : component));
    markStudyEdited();
    setStatus(`Configuration imported from ${source.name}; structure input was not changed`);
  };

  const configureCalculationComponent = (id: string) => {
    if (configuringComponentId === id) { setConfiguringComponentId(null); return; }
    const component = calculationComponents.find((item) => item.id === id);
    if (!component) return;
    if (component.geometry || component.sweep || component.neb) { setOperationId(component.id); return; }
    setJobDraft({ ...component.draft, calculations: [component.calculation] });
    setConfiguringComponentId(id);
    if (window.innerWidth < 1024) setShowInspector(false);
  };

  const applyAccuracy = (next: Accuracy) => {
    const activeDraft = configuringComponent?.draft ?? jobDraft;
    updateCalculationDraft(applyQeAccuracy(activeDraft, next));
  };

  const addJobs = () => {
    if (!activeDatabase || !activeMaterial) { setStatus('Select a structure before adding calculations'); return; }
    if (!selectedCalculationComponents.length) { setStatus('Select at least one calculation component'); return; }
    const occupiedIds = jobs.map((job) => job.id);
    const nextJobs = selectedCalculationComponents.map((component) => {
      const id = nextAvailableId('job-draft', occupiedIds);
      occupiedIds.push(id);
      return {
        id,
        componentId: component.id,
        name: component.name,
        databaseId: activeDatabase.id,
        database: activeDatabase.name,
        materialId: activeMaterial.id,
        material: activeMaterial.name,
        engine: engineForCalculation(component.calculation),
        status: 'Draft' as JobStatus,
        progress: 0,
        updated: 'now',
        settings: summarizeJobDraft(component.draft, component.calculation, materialContextForComponent(component)),
      };
    });
    setJobs((current) => [...nextJobs, ...current]);
    setCalculationConfigurations((current) => {
      const occupiedIds = current.map((configuration) => configuration.id);
      const savedConfigurations = selectedCalculationComponents.map((component) => {
        const id = nextAvailableId('config', occupiedIds);
        occupiedIds.push(id);
        return {
          id,
          name: `${activeMaterial.name} · ${component.name}`,
          calculation: component.calculation,
          databaseId: activeDatabase.id,
          databaseName: activeDatabase.name,
          materialId: activeMaterial.id,
          materialName: activeMaterial.name,
          updated: 'now',
          draft: { ...component.draft, calculations: [component.calculation] },
        } satisfies CalculationConfiguration;
      });
      return [...savedConfigurations, ...current];
    });
    markStudyEdited(activeMaterial.id, activeMaterial.projectId);
    setStatus(`${nextJobs.length} calculation component${nextJobs.length > 1 ? 's' : ''} saved for ${activeMaterial.name}`);
  };

  const saveCalculationConfiguration = (component: CalculationComponentInstance) => {
    if (!activeDatabase || !activeMaterial) { setStatus('Select a structure first'); return; }
    setCalculationConfigurations((current) => {
      const id = nextAvailableId('config', current.map((configuration) => configuration.id));
      return [{
        id,
        name: `${activeMaterial.name} · ${component.name}`,
        calculation: component.calculation,
        databaseId: activeDatabase.id,
        databaseName: activeDatabase.name,
        materialId: activeMaterial.id,
        materialName: activeMaterial.name,
        updated: 'now',
        draft: { ...component.draft, calculations: [component.calculation] },
      }, ...current];
    });
    markStudyEdited(activeMaterial.id, activeMaterial.projectId);
    setStatus(`${component.name} configuration saved for ${activeMaterial.name}`);
    setConfiguringComponentId(null);
  };

  const importCalculationConfiguration = (configuration: CalculationConfiguration) => {
    if (!activeMaterial || !activeDatabase) { setStatus('Select a destination structure first'); return; }
    setRightTab('calculations');
    setShowLeftPanel(false);
    setShowInspector(true);
    addCalculationComponent(configuration.calculation, configuration.draft);
    setStatus(`Imported ${configuration.name} from ${configuration.databaseName}; structure remains ${activeMaterial.name}`);
  };

  const deleteJob = (id: string) => {
    const job = jobs.find((item) => item.id === id);
    setJobs((current) => current.filter((item) => item.id !== id));
    if (job) markStudyEdited(job.materialId, materials.find((record) => record.id === job.materialId)?.projectId ?? activeProjectId);
    setStatus(job ? `${job.name} run deleted` : 'Calculation run deleted');
  };

  const saveJobPlotSettings = (id: string, plotSettings: ScientificPlotSettings) => {
    const job = jobs.find((item) => item.id === id);
    setJobs((current) => current.map((item) => item.id === id ? { ...item, plotSettings } : item));
    if (job) markStudyEdited(job.materialId, materials.find((record) => record.id === job.materialId)?.projectId ?? activeProjectId);
  };

  const cancelJob = async (id: string) => {
    const job = jobs.find((item) => item.id === id);
    if (job?.cancelRequested) {
      setStatus(`${job.name} cancellation is already pending`);
      return;
    }
    if (!job?.backendCalculationId || !['Queued', 'Running'].includes(job.status)) {
      setStatus('This calculation cannot be cancelled');
      return;
    }
    if (!await requestConfirmation({
      title: 'Cancel calculation?',
      description: job.status === 'Running'
        ? `${job.name} is running. Its local compute container will stop after the next worker heartbeat.`
        : `${job.name} will be removed from the local compute queue.`,
      confirmLabel: 'Cancel calculation',
      tone: 'danger',
    })) return;
    setStatus(`Cancelling ${job.name}`);
    try {
      const { calculation } = await phyniteCalculations.cancel(job.backendCalculationId);
      setJobs((current) => current.map((item) => item.id === id ? mergeBackendJob(item, calculation) : item));
      setStatus(`${job.name} cancellation requested`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Calculation cancellation failed');
    }
  };

  const deleteCalculationConfiguration = (id: string) => {
    const configuration = calculationConfigurations.find((item) => item.id === id);
    setCalculationConfigurations((current) => current.filter((item) => item.id !== id));
    if (configuration) markStudyEdited(configuration.materialId, materials.find((record) => record.id === configuration.materialId)?.projectId ?? activeProjectId);
    setStatus(configuration ? `${configuration.name} configuration deleted` : 'Configuration deleted');
  };

  const ensureRemoteProject = async (project: ResearchProject) => {
    if (project.remoteId) return project.remoteId;
    const pending = remoteProjectPromisesRef.current.get(project.id);
    if (pending) return pending;
    const request = phyniteProjects.create({ name: project.name, description: project.description, tags: ['QE'] })
      .then(({ project: remoteProject }) => {
        setProjects((current) => current.map((item) => item.id === project.id ? { ...item, remoteId: remoteProject.id } : item));
        return remoteProject.id;
      })
      .finally(() => remoteProjectPromisesRef.current.delete(project.id));
    remoteProjectPromisesRef.current.set(project.id, request);
    return request;
  };

  const ensureRemoteStructure = async (material: MaterialRecord, remoteProjectId: string) => {
    if (material.remoteId) return material.remoteId;
    const pending = remoteStructurePromisesRef.current.get(material.id);
    if (pending) return pending;
    const request = phyniteStructures.create(remoteProjectId, {
      name: material.name,
      formula: material.formula,
      spaceGroup: material.spaceGroup,
      source: material.source ?? 'Phynite',
      lattice: { ...material.lattice },
      atoms: material.atoms.map((atom) => ({ ...atom })),
    }).then(({ structure }) => {
      setMaterials((current) => current.map((item) => item.id === material.id ? { ...item, remoteId: structure.id } : item));
      return structure.id;
    }).finally(() => remoteStructurePromisesRef.current.delete(material.id));
    remoteStructurePromisesRef.current.set(material.id, request);
    return request;
  };

  const createLocalJob = (component: CalculationComponentInstance, structureSourceCalculationId?: string | null): JobRecord | null => {
    const material = materials.find((record) => record.id === component.materialId);
    const database = databases.find((record) => record.id === material?.databaseId);
    if (!material || !database) return null;
    return {
      id: createExecutionJobId(),
      componentId: component.id,
      calculationType: component.calculation,
      name: component.name,
      databaseId: database.id,
      database: database.name,
      materialId: material.id,
      material: material.name,
      engine: engineForCalculation(component.calculation),
      status: 'Queued',
      progress: 0,
      updated: 'now',
      startedAt: workspaceTimestamp(),
      result: 'Submitting calculation',
      resultDetail: 'Creating the private project, structure, and calculation record.',
      settings: executionSettingsForComponent(component),
      structureSourceId: component.structureSourceId,
      structureSourceCalculationId: structureSourceCalculationId ?? undefined,
      referenceExecutionFingerprint: executionIdentityForComponent(component) ?? undefined,
      referenceElectronicFingerprint: electronicReferenceFingerprint(component.draft, resolveQeAdaptiveParameters(component.draft, materialContextForComponent(component), component.calculation, 'scf')) ?? undefined,
      referenceFunctional: component.draft.functional,
      referencePseudoFamily: component.draft.pseudoFamily,
      referenceSpin: component.draft.spin,
      referenceSoc: component.draft.soc,
      referenceNoncollinear: component.draft.noncollinear,
      referenceStartingMagnetization: component.draft.startingMagnetization,
      referenceTotalMagnetization: component.draft.totalMagnetization,
      referenceDftU: component.draft.dftU,
      referenceHubbardU: component.draft.hubbardU,
      referenceVdwCorrection: component.draft.vdwCorrection,
      referenceTotalCharge: component.draft.totalCharge,
      referenceMaterialUpdatedAt: material.geometryUpdatedAt ?? material.updatedAt,
    };
  };

  const updateLocalJobFromBackend = (jobId: string, calculation: PhyniteCalculation, manifest?: PhyniteResultManifest) => {
    setJobs((current) => current.map((job) => job.id === jobId ? mergeBackendJob(job, calculation, manifest) : job));
  };

  const submitCalculationComponent = async (
    component: CalculationComponentInstance,
    submitted: Map<string, string>,
    asDependency = false,
  ): Promise<string | null> => {
    if (submitted.has(component.id)) return submitted.get(component.id) ?? null;
    if (asDependency) {
      const reusable = reusableDependencyJob(component);
      if (reusable?.backendCalculationId) {
        submitted.set(component.id, reusable.backendCalculationId);
        return reusable.backendCalculationId;
      }
    }
    const inFlight = calculationSubmissionPromisesRef.current.get(component.id);
    if (inFlight) {
      const calculationId = await inFlight;
      if (calculationId) submitted.set(component.id, calculationId);
      return calculationId;
    }
    const submission = (async () => {
      const material = materials.find((record) => record.id === component.materialId);
      const project = projects.find((record) => record.id === material?.projectId);
      if (!material || !project) return null;
      const source = component.structureSourceId === 'original' ? null : calculationComponents.find((item) => item.id === component.structureSourceId);
      try {
        if (source && (component.draft.cellParameters || component.draft.atomicPositions)) throw new Error('Calculation-local structure cards cannot be combined with a relaxation dependency. Reset the cards or select the original structure source.');
        generateQuantumEspressoInputFiles(component.draft, component.calculation, materialContextForComponent(component));
      } catch (error) { setStatus(error instanceof Error ? error.message : 'Invalid QE input'); return null; }
      const dependencyId = source ? await submitCalculationComponent(source, submitted, true) : null;
      if (source && !dependencyId) { setStatus('The source relaxation could not be submitted. Resolve its input error before running this dependent calculation.'); return null; }
      const localJob = createLocalJob(component, dependencyId);
      if (!localJob) return null;
      setJobs((current) => [localJob, ...current.filter((job) => !(job.componentId === component.id && ['Draft', 'Queued'].includes(job.status)))]);
      const idempotencyKey = globalThis.crypto.randomUUID();
      try {
        const sourceMaterial = materialContextForComponent(component);
        if (dependencyId && (component.draft.cellParameters || component.draft.atomicPositions)) throw new Error('Calculation-local structure cards cannot be combined with a relaxation dependency. Reset the cards or select the original structure source.');
        const files = generateQuantumEspressoInputFiles(component.draft, component.calculation, sourceMaterial);
        const submissionSettings = qeSubmissionSettings(component.draft, component.calculation, sourceMaterial);
        if (dependencyId) submissionSettings.submittedStructure = {
          version: 1, source: 'relaxation-dependency', detail: 'The retained executed input records the final structure from the source calculation.',
        };
        const remoteProjectId = await ensureRemoteProject(project);
        // Every generated run stores the resolved structure snapshot; saved project IDs may refer to an earlier edit.
        const resolvedStructure = component.draft.rawInput.trim() ? null : resolveQeStructure(component.draft, sourceMaterial);
        const remoteStructureId = resolvedStructure
          ? (await phyniteStructures.create(remoteProjectId, {
              name: `${material.name} · ${component.name} input`, formula: formulaFromAtoms(resolvedStructure.atoms),
              source: component.draft.cellParameters || component.draft.atomicPositions ? 'Calculation structure cards' : 'Project structure snapshot', lattice: { ...latticeFromCellVectors(resolvedStructure.cellVectors as [[number, number, number], [number, number, number], [number, number, number]]), periodic: material.lattice.periodic },
              atoms: resolvedStructure.atoms.map((atom) => ({ ...atom })),
            })).structure.id
          : await ensureRemoteStructure(material, remoteProjectId);
        const inputFiles = Object.fromEntries(files.map((file) => [file.name, file.content]));
        const qeInput = files.find((file) => /&CONTROL\b/i.test(file.content))?.content;
        if (!qeInput) throw new Error('Generated workflow has no pw.x input file');
        const reciprocalPath = reciprocalPathSubmission(
          component.calculation,
          component.draft,
          component.draft.rawInput,
        );
        const request = {
          structureId: remoteStructureId,
          name: component.name,
          calculationType: component.calculation,
          qeInput,
          inputFiles,
          settings: {
            ...submissionSettings,
            ...reciprocalPath,
            qeParameterResolution: component.draft.rawInput.trim()
              ? {
                  version: 1,
                  mode: 'expert-raw-input',
                  detail: 'The submitted expert input is authoritative; adaptive occupation and cutoff resolution was not applied.',
                }
              : {
                  mode: 'adaptive',
                  interaction: 'editable-smart-defaults',
                  userOverrides: {
                    occupation: component.draft.occupationPolicy === 'manual',
                    cutoff: component.draft.cutoffPolicy === 'manual',
                  },
                  ...resolveQeWorkflowParameters(component.draft, resolvedStructure, component.calculation),
                },
            ...(dependencyId && source ? {
              structureSource: {
                calculationId: dependencyId,
                calculationType: source.calculation,
                prefix: source.draft.prefix,
              },
            } : {}),
          } as Record<string, unknown>,
          dependsOnCalculationIds: dependencyId ? [dependencyId] : [],
          idempotencyKey,
          run: true,
        };
        let calculation: PhyniteCalculation;
        try {
          calculation = (await phyniteCalculations.create(remoteProjectId, request)).calculation;
        } catch (error) {
          if (!(error instanceof PhyniteApiError) || !['COMPUTE_DISABLED', 'PSEUDOPOTENTIALS_REQUIRED'].includes(error.code)) throw error;
          calculation = (await phyniteCalculations.create(remoteProjectId, { ...request, run: false })).calculation;
          setStatus(error.code === 'COMPUTE_DISABLED'
            ? `${component.name} saved as a cloud draft · cloud compute remains disabled`
            : `${component.name} saved as a cloud draft · upload the required UPF files before running`);
        }
        updateLocalJobFromBackend(localJob.id, calculation);
        markStudyEdited(component.materialId, project.id);
        return calculation.id;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Calculation submission failed';
        setJobs((current) => current.map((job) => job.id === localJob.id ? { ...job, status: 'Failed', result: 'Submission failed', resultDetail: message, updated: workspaceTimestamp() } : job));
        setStatus(message);
        return null;
      }
    })();
    calculationSubmissionPromisesRef.current.set(component.id, submission);
    try {
      const calculationId = await submission;
      if (calculationId) submitted.set(component.id, calculationId);
      return calculationId;
    } finally {
      if (calculationSubmissionPromisesRef.current.get(component.id) === submission) {
        calculationSubmissionPromisesRef.current.delete(component.id);
      }
    }
  };

  const submitCalculations = async (requested: CalculationComponentInstance[]) => {
    const submitted = new Map<string, string>();
    for (const component of requested) await submitCalculationComponent(component, submitted);
  };

  const runCalculation = (componentId: string) => {
    const component = calculationComponents.find((item) => item.id === componentId);
    if (component && (component.scfSourceId || component.sweep || component.neb || component.geometry || calculationComponents.find(c=>c.id===component.structureSourceId)?.geometry)) { void runWorkflow([componentId]); return; }
    if (!component) { setStatus('Calculation component no longer exists'); return; }
    if (calculationSubmissionPromisesRef.current.has(componentId)) {
      setStatus(`${component.name} is already being submitted`);
      return;
    }
    if (jobs.some((job) => job.componentId === componentId && ['Queued', 'Running'].includes(job.status))) {
      setStatus(`${component.name} is already queued or running`);
      return;
    }
    setStatus(`Submitting ${component.name}`);
    void submitCalculations([component]);
  };

  const runSelectedCalculations = () => {
    if (!selectedCalculationComponents.length) { setStatus('Select at least one calculation component'); return; }
    const pending = selectedCalculationComponents.filter((component) => (
      !reusableCompletedJob(component)
      && !jobs.some((job) => job.componentId === component.id && ['Queued', 'Running'].includes(job.status))
    ));
    if (!pending.length) { setStatus('All selected calculations already have completed results'); return; }
    setStatus(`Submitting ${pending.length} selected calculation${pending.length > 1 ? 's' : ''}; completed dependencies will be reused`);
    if (pending.some(c=>c.scfSourceId || c.sweep || c.neb || calculationComponents.find(p=>p.id===c.structureSourceId)?.geometry)) { void runWorkflow(pending.map(c=>c.id)); return; }
    void submitCalculations(pending);
  };

  const runAllJobs = () => {
    const selected = activeCalculationComponents.filter((component) => (
      component.selected
      && !reusableCompletedJob(component)
      && !jobs.some((job) => job.componentId === component.id && ['Queued', 'Running'].includes(job.status))
    ));
    if (!selected.length) { setStatus('Select at least one configured calculation'); openJobSetup(); return; }
    setStatus(`Submitting ${selected.length} calculation${selected.length > 1 ? 's' : ''} in dependency order; completed dependencies will be reused`);
    if (selected.some(c => c.scfSourceId || c.sweep || c.neb || calculationComponents.find(p => p.id === c.structureSourceId)?.geometry)) { void runWorkflow(selected.map(c => c.id)); return; }
    void submitCalculations(selected);
  };

  const workflowComponents = calculationComponents.filter(c => projectMaterials.some(m => m.id === c.materialId));
  const workflowDocument: WorkflowDocument = { components: workflowComponents, canvas: workflowCanvases[activeProjectId] ?? defaultWorkflowCanvas() };
  const applyWorkflowDocument = (next: WorkflowDocument) => {
    const ownIds = new Set(projectMaterials.map(m => m.id));
    setCalculationComponents(current => [...current.filter(c => !ownIds.has(c.materialId)), ...next.components]);
    setWorkflowCanvases(current => ({ ...current, [activeProjectId]: next.canvas }));
    markProjectEdited(activeProjectId);
  };
  const commitWorkflow = (next: WorkflowDocument) => {
    const prior = workflowHistories.current.get(activeProjectId) ?? { past: [], present: workflowDocument, future: [] };
    const history = editWorkflow({ ...prior, present: workflowDocument }, next);
    workflowHistories.current.set(activeProjectId, history);
    applyWorkflowDocument(next);
  };
  const moveWorkflowHistory = (redo: boolean) => {
    const current = workflowHistories.current.get(activeProjectId);
    if (!current) return;
    const next = redo ? redoWorkflow(current) : undoWorkflow(current);
    workflowHistories.current.set(activeProjectId, next);
    applyWorkflowDocument(next.present);
  };
  const finishWorkflowConfiguration = () => {
    const base = workflowConfigBase.current;
    if (base) {
      const prior = workflowHistories.current.get(activeProjectId) ?? { past: [], present: base, future: [] };
      workflowHistories.current.set(activeProjectId, editWorkflow({ ...prior, present: base }, workflowDocument));
      workflowConfigBase.current = null;
    }
    setConfiguringComponentId(null);
  };
  const configureWorkflowNode = (id: string) => {
    const component = calculationComponents.find(c => c.id === id);
    const material = materials.find(m => m.id === component?.materialId);
    if (!component || !material) return;
    if (component.geometry || component.sweep || component.neb) { setOperationId(id); return; }
    workflowConfigBase.current = structuredClone(workflowDocument);
    selectMaterial(material);
    setJobDraft({ ...component.draft, calculations: [component.calculation] });
    setConfiguringComponentId(id);
  };
  const addWorkflowNode = (calculation: CalculationType, sourceId?: string) => {
    const source = workflowComponents.find(c => c.id === sourceId);
    const material = projectMaterials.find(m => structureNodeId(m.id) === sourceId || m.id === source?.materialId)
      ?? projectMaterials.find(m => m.id === activeMaterialId) ?? projectMaterials[0];
    if (!material) { setStatus('Import a crystal structure before adding calculation nodes.'); return; }
    const id = `calc-${crypto.randomUUID()}`;
    const draft = normalizeJobDraft({ ...(source?.draft ?? jobDraft), calculations: [calculation], prefix: source?.draft.prefix ?? `crystal-${material.id.replace(/[^a-z0-9]/gi, '').slice(-24)}`, title: `${material.name} · ${calculation}`, rawInput: '', diskIO: 'low', restartMode: 'from_scratch' });
    const node: CalculationComponentInstance = { id, materialId: material.id, name: calculation === 'Total energy' ? 'SCF' : calculation, calculation, selected: true, structureSourceId: source?.geometry || source?.calculation === 'Structural relaxation' ? source.id : 'original', draft,
      ...(ANALYSES.includes(calculation) ? { scfSourceId: source?.calculation === 'Total energy' && !source.geometry && !source.sweep && !source.neb ? source.id : 'unbound' } : {}), scfReuse: { mode: 'auto' } };
    const components = [...workflowComponents, node];
    if (ANALYSES.includes(calculation) && node.scfSourceId === 'unbound' && !sourceId) {
      const existingScf = [...workflowComponents].reverse().find(c => c.materialId === material.id && c.calculation === 'Total energy' && !c.geometry && !c.sweep && !c.neb);
      if (existingScf) node.scfSourceId = existingScf.id;
      else { const root: CalculationComponentInstance = { ...node, id: `calc-${crypto.randomUUID()}`, calculation: 'Total energy', name: 'SCF', scfSourceId: undefined, draft: { ...draft, calculations: ['Total energy'] } }; components.unshift(root); node.scfSourceId = root.id; }
    }
    const anchor = sourceId ? workflowDocument.canvas.positions[sourceId] : undefined;
    commitWorkflow({ components, canvas: { ...workflowDocument.canvas, hiddenStructures: workflowDocument.canvas.hiddenStructures.filter(id => id !== material.id), positions: { ...workflowDocument.canvas.positions, ...(anchor ? { [id]: { x: anchor.x + 304, y: anchor.y + 144 } } : {}) } } });
  };
  const addWorkflowOperation = (kind: 'supercell' | 'surface_slab' | 'parameter_sweep' | 'dft_neb', sourceId?: string) => {
    const source = workflowComponents.find(c => c.id === sourceId);
    const material = projectMaterials.find(m => structureNodeId(m.id) === sourceId || m.id === source?.materialId) ?? projectMaterials.find(m => m.id === activeMaterialId) ?? projectMaterials[0];
    if (!material) { setStatus('Import a structure first.'); return; }
    const id = `calc-${crypto.randomUUID()}`;
    const node: CalculationComponentInstance = { id, materialId: material.id, calculation: kind === 'dft_neb' ? 'Nudged elastic band' : 'Total energy', name: kind, selected: true, structureSourceId: source?.geometry ? source.id : 'original', draft: normalizeJobDraft({ ...(source?.draft ?? jobDraft), rawInput: '', calculations: ['Total energy'], diskIO: 'low' }),
      ...(kind === 'supercell' ? { geometry: { kind, matrix: [[2,0,0],[0,2,0],[0,0,2]] } } : kind === 'surface_slab' ? { geometry: { kind, miller: [0,0,1], layers: 4, vacuumAngstrom: 15, termination: 0 } } : kind === 'parameter_sweep' ? { sweep: { parameter: 'k-grid', values: [4,6,8,10] } } : { neb: { finalSourceId: '', images: 7, steps: 100, thresholdEvAngstrom: .05, climbing: true, mapping: [] } }) };
    commitWorkflow({ ...workflowDocument, components: [...workflowComponents, node] }); setOperationId(id);
  };
  const aggregateSweep = async (component: CalculationComponentInstance) => {
    try {
      const rows = jobs.filter(j => j.componentId === component.id && j.workflowRunId === workflowRunIds[activeProjectId] && j.status === 'Completed' && j.scientificAccepted && j.sweepValue !== undefined && Number.isFinite(j.totalEnergyRy));
      if (rows.length < 2 || new Set(rows.map(j => j.workflowRunId)).size !== 1 || rows.some(j => j.referenceExecutionFingerprint !== executionIdentityForComponent(component))) throw new Error('Complete at least two values from the same current sweep before aggregating.');
      const text = 'parameter,total_energy_Ry\n'+rows.sort((a,b)=>a.sweepValue!-b.sweepValue!).map(j=>`${j.sweepValue},${j.totalEnergyRy}`).join('\n');
      const dataset = await datasetFromText(text, { projectId: activeProjectId, name: `${component.name} convergence`, filename: 'parameter-sweep.csv', metadata: { provenance: { operation: component.sweep, workflowRunId: rows[0].workflowRunId, calculationIds: rows.map(j=>j.backendCalculationId), settings: component.draft } } });
      dataset.data.xLabel = component.sweep?.parameter === 'cutoff' ? 'Wavefunction cutoff (Ry)' : 'Uniform k mesh (n × n × n)'; dataset.data.quantities[0].yLabel = 'Total energy (Ry)';
      await saveResearch(ownerId, 'datasets', dataset); setOperationId(null); openFigures();
    } catch(error) { setStatus(error instanceof Error ? error.message : 'Aggregation failed.'); }
  };
  const pasteWorkflow = (data: WorkflowClipboard<WorkflowMaterial>, point: WorkflowPoint): string[] => {
    const timestamp = workspaceTimestamp(), materialIds = new Map<string, string>();
    const copies: MaterialRecord[] = [];
    for (const snapshot of data.materials) {
      const same = data.sourceProjectId === activeProjectId && projectMaterials.find(m => m.id === snapshot.id);
      if (same) { materialIds.set(snapshot.id, same.id); continue; }
      const raw = snapshot as Partial<MaterialRecord>;
      if (!Array.isArray(raw.atoms) || !raw.atoms.length || !raw.lattice || raw.atoms.some(a => !a || typeof a.species !== 'string' || ![a.x, a.y, a.z].every(Number.isFinite))) throw new Error('Copied structure is incomplete. Copy a valid crystal structure.');
      cellVectorsFromLattice(raw.lattice);
      const id = `mat-${crypto.randomUUID()}`;
      const copy: MaterialRecord = { id, projectId: activeProjectId, databaseId: activeDatabaseId, name: snapshot.name, formula: raw.formula ?? formulaFromAtoms(raw.atoms), spaceGroup: raw.spaceGroup ?? 'P1', kind: 'Imported', atoms: cloneAtoms(raw.atoms), lattice: structuredClone(raw.lattice), source: 'Local', createdAt: timestamp, updatedAt: timestamp, geometryUpdatedAt: timestamp };
      // Resolve validates finite, nonsingular geometry and known scientific species.
      resolveQeStructure(createDefaultQeDraft(), { name: copy.name, formula: copy.formula, databaseName: '', atomCount: copy.atoms.length, species: [...new Set(copy.atoms.map(a => a.species))], atoms: copy.atoms, cellVectors: cellVectorsFromLattice(copy.lattice), periodic: copy.lattice.periodic });
      copies.push(copy); materialIds.set(snapshot.id, id);
    }
    const safeComponents = data.components.map(c => ({ id: c.id, materialId: c.materialId, name: c.name.slice(0, 100), calculation: c.calculation, draft: normalizeJobDraft(c.draft), selected: true, structureSourceId: c.structureSourceId, scfSourceId: c.scfSourceId, geometry: c.geometry, sweep: c.sweep, neb: c.neb }));
    if (safeComponents.some(c => !materialIds.has(c.materialId))) throw new Error('Copied workflow is missing its structure snapshot.');
    const mapped = remapWorkflowComponents(safeComponents, materialIds, () => `calc-${crypto.randomUUID()}`);
    const positions = { ...workflowDocument.canvas.positions }, allOld = Object.values(data.positions);
    const minX = Math.min(0, ...allOld.map(p => p.x)), minY = Math.min(0, ...allOld.map(p => p.y));
    const selected: string[] = [];
    for (const id of data.selected) {
      const next = id.startsWith('structure:') ? materialIds.has(id.slice(10)) ? structureNodeId(materialIds.get(id.slice(10))!) : undefined : mapped.ids.get(id);
      if (!next) continue;
      const p = data.positions[id] ?? { x: 0, y: 0 };
      positions[next] = { x: point.x + p.x - minX + 16, y: point.y + p.y - minY + 16 }; selected.push(next);
    }
    setMaterials(current => [...current, ...copies]);
    commitWorkflow({ components: [...workflowComponents, ...mapped.components], canvas: { ...workflowDocument.canvas, positions, hiddenStructures: workflowDocument.canvas.hiddenStructures.filter(id => ![...materialIds.values()].includes(id)) } });
    setStatus(`Pasted ${selected.length} workflow nodes; run results were not copied.`);
    return selected;
  };
  const runWorkflow = async (targets?: string[]) => {
    if (!activeProject || workflowSubmitting) return;
    setWorkflowSubmitting(true);
    try {
      const expanded = workflowComponents.flatMap(c => c.sweep ? sweepDrafts(c.draft, c.sweep).map((draft, index) => ({ ...c, id: `${c.id}-value-${index}`, name: `${c.name} · ${c.sweep!.values[index]}`, sweep: undefined, draft })) : [c]);
      const expandedTargets = (targets ?? workflowComponents.map(c => c.id)).flatMap(id => { const c = workflowComponents.find(c => c.id === id); return c?.geometry ? [] : c?.sweep ? c.sweep.values.map((_, i) => `${id}-value-${i}`) : [id]; });
      if (expandedTargets.length > 256) throw new Error('A workflow run supports at most 256 calculation rows. Reduce the sweep values or run selected nodes.');
      const ordered = workflowOrder(expanded, projectMaterials, expandedTargets).filter(c => !c.geometry);
      if (!ordered.length) throw new Error('Geometry is ready locally. Save its output as a project structure or connect a calculation.');
      const fingerprint = JSON.stringify({ components: workflowComponents, targets });
      let pending = workflowPending[activeProjectId];
      if (!pending || pending.fingerprint !== fingerprint) {
        const projectId = await ensureRemoteProject(activeProject);
        const requests = new Map<string, DftWorkflowRequest['nodes'][number]>();
        for (const component of ordered) {
          const source = expanded.find(c => c.id === component.scfSourceId);
          if (source && component.draft.rawInput.trim()) throw new Error(`${component.name}: reset its expert override before inheriting SCF, or keep using a standalone calculation.`);
          const effective = source ? inheritedAnalysisDraft(component.draft, source.draft) : component.draft;
          const context = materialContextForComponent(component);
          const neb = component.neb ? generateNebInput(effective, context, workflowSourceContext(component.neb.finalSourceId), component.neb, component.neb.intermediateSourceId ? workflowSourceContext(component.neb.intermediateSourceId) : undefined) : null;
          const generated = neb ? [neb] : generateQuantumEspressoInputFiles(effective, component.calculation, context);
          const inputFiles = Object.fromEntries(generated.map(f => [f.name, f.content]));
          if (source) inputFiles['scf.in'] = requests.get(source.id)!.request.inputFiles['scf.in'];
          const record = projectMaterials.find(m => m.id === component.materialId)!;
          const resolved = effective.rawInput.trim() ? null : resolveQeStructure(effective, context);
          const structureId = resolved ? (await phyniteStructures.create(projectId, { name: `${record.name} · workflow input`, formula: formulaFromAtoms(resolved.atoms), source: 'Workflow structure snapshot', lattice: { ...latticeFromCellVectors(resolved.cellVectors as [[number, number, number], [number, number, number], [number, number, number]]), periodic: context?.periodic }, atoms: resolved.atoms.map(a => ({ ...a })) })).structure.id : await ensureRemoteStructure(record, projectId);
          const parent = source?.id ?? (component.structureSourceId === 'original' || workflowComponents.find(c => c.id === component.structureSourceId)?.geometry ? undefined : component.structureSourceId);
          const sweepSource = workflowComponents.find(c => c.sweep && component.id.startsWith(`${c.id}-value-`));
          const request: DftWorkflowRequest['nodes'][number] = { id: component.id, dependsOnNodeIds: parent ? [parent] : [], scfReuse: component.scfReuse, request: { structureId, name: component.name, calculationType: component.neb ? 'Nudged elastic band' : component.calculation, qeInput: inputFiles['scf.in'] ?? generated[0].content, inputFiles, settings: { ...qeSubmissionSettings(effective, component.calculation, context), ...(neb ? { neb: neb.provenance } : {}), ...(sweepSource ? { parameterSweep: { nodeId: sweepSource.id, parameter: sweepSource.sweep!.parameter, value: sweepSource.sweep!.values[Number(component.id.split('-value-').at(-1))] } } : {}), ...reciprocalPathSubmission(component.calculation, effective, effective.rawInput), ...(component.calculation === 'Total energy' ? { retainScfBundle: true } : {}) }, run: true } };
          requests.set(component.id, request);
        }
        pending = { fingerprint, projectId, request: { idempotencyKey: crypto.randomUUID(), nodes: [...requests.values()], targetNodeIds: expandedTargets } };
        setWorkflowPending(current => ({ ...current, [activeProjectId]: pending }));
        // Retain the exact submission before crossing the network so retries never duplicate jobs.
        const snapshot = JSON.parse(localStorage.getItem(CALCULATION_WORKSPACE_STORAGE_KEY) ?? '{}');
        snapshot.workflowPending = { ...snapshot.workflowPending, [activeProjectId]: pending };
        localStorage.setItem(CALCULATION_WORKSPACE_STORAGE_KEY, JSON.stringify(snapshot));
      }
      const result = await phyniteWorkflowRuns.submit(pending.projectId, pending.request);
      setWorkflowRunIds(current => ({ ...current, [activeProjectId]: result.workflowRun.id }));
      const localJobs: JobRecord[] = [];
      for (const [nodeId, binding] of Object.entries(result.workflowRun.nodes)) {
        const component = workflowComponents.find(c => c.id === nodeId || c.sweep && nodeId.startsWith(`${c.id}-value-`)), backend = result.calculations.find(c => c.id === binding.calculationId);
        if (!component || !backend) continue;
        const local = createLocalJob(component);
        if (local) localJobs.push({ ...mergeBackendJob({ ...local, ...(component.neb ? { calculationType: 'Nudged elastic band' as CalculationType } : {}) }, backend), workflowRunId: result.workflowRun.id, ...(component.sweep ? { sweepValue: component.sweep.values[Number(nodeId.split('-value-').at(-1))], name: backend.name } : {}), ...(binding.reused ? { resultDetail: `Reusing SCF ${binding.calculationId}` } : {}) });
      }
      setJobs(current => [...localJobs, ...current.filter(j => !localJobs.some(next => next.componentId === j.componentId && next.backendCalculationId === j.backendCalculationId))]);
      if (result.workflowRun.status !== 'SUBMISSION_FAILED') setWorkflowPending(current => { const next = { ...current }; delete next[activeProjectId]; return next; });
      setStatus(result.workflowRun.submissionError || `Workflow submitted · ${localJobs.length} nodes; shared SCF is executed once.`);
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Workflow submission failed. Retry to resume.'); }
    finally { setWorkflowSubmitting(false); }
  };
  const cancelWorkflow = async () => {
    const id = workflowRunIds[activeProjectId];
    if (!id) { setStatus('No submitted workflow is available to cancel.'); return; }
    try { await phyniteWorkflowRuns.cancel(id); setStatus('Workflow cancellation requested; shared SCF sources remain available.'); }
    catch (error) { setStatus(error instanceof Error ? error.message : 'Workflow cancellation failed.'); }
  };

  const commands = [
    { label: 'Move selected atom', hint: 'G', icon: Move3D, action: () => activateTool('move') },
    { label: 'Add atom', hint: 'A', icon: CirclePlus, action: () => activateTool('add') },
    { label: 'Substitute selected atom', icon: CircleDot, action: () => selectedAtomId ? setElementPaletteMode('substitute') : setStatus('Select an atom first') },
    { label: 'Measure atom information', hint: 'M', icon: Ruler, action: () => startMeasurement('atom') },
    { label: 'Measure distance', icon: Ruler, action: () => startMeasurement('distance') },
    { label: 'Measure bond angle', icon: Ruler, action: () => startMeasurement('angle') },
    { label: 'Delete selected atom', hint: 'Del', icon: Trash2, action: deleteSelected },
    { label: 'Enter delete mode', icon: Trash2, action: () => activateTool('delete') },
    { label: 'Duplicate material record', icon: Copy, action: duplicateMaterial },
    { label: 'Delete active material', icon: Trash2, action: () => activeMaterialId && deleteMaterial(activeMaterialId) },
    { label: 'Display 2 × 2 × 2 unit cells', icon: Grid3X3, action: () => updateDisplayedCells([2, 2, 2]) },
    { label: 'Reset displayed unit cells', icon: Box, action: () => updateDisplayedCells([1, 1, 1]) },
    { label: 'Open appearance and export controls', icon: Eye, action: () => { setRightTab('structure'); setShowInspector(true); } },
    { label: 'Wrap atoms into unit cell', icon: Box, action: wrapAtomsIntoCell },
    { label: `Add ${vacuumSize} Å vacuum normal to a-b`, icon: Boxes, action: addVacuumLayer },
    { label: 'Import structure into project', icon: Upload, action: () => fileInput.current?.click() },
    { label: 'Search Materials Project', icon: DatabaseSearch, action: () => { setConfiguringComponentId(null); setMaterialsProjectOpen(true); } },
    ...viewAngles.map((view) => ({ label: `${view.label} camera view`, icon: Axis3D, action: () => snapCameraView(view.id) })),
    { label: 'Export CIF', icon: FileDown, action: () => exportStructure('cif') },
    { label: 'Export XSF', icon: FileDown, action: () => exportStructure('xsf') },
    { label: 'Export POSCAR', icon: FileDown, action: () => exportStructure('poscar') },
    { label: 'Export XYZ', icon: FileDown, action: () => exportStructure('xyz') },
    { label: 'Fit structure', hint: 'F', icon: Crosshair, action: fitStructure },
    { label: 'Focus selected atom', icon: Maximize2, action: focusSelected },
    { label: 'Open calculations', icon: Play, action: openJobSetup },
    { label: 'Run all draft jobs', icon: Play, action: runAllJobs },
    { label: 'Show calculation jobs', icon: ListFilter, action: openJobSetup },
  ];


  useEffect(() => {
    if (!recordOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setRecordOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [recordOpen]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (showFigures || showWorkflow) return;
      const target = event.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName)) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setCommandOpen(true); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); return; }
      if (event.code === 'Space') { event.preventDefault(); setCommandOpen(true); return; }
      if (activeTool === 'move' && event.key === 'Escape') { event.preventDefault(); resetMoveSession(); return; }
      if (activeTool === 'move' && event.key === 'Enter') { event.preventDefault(); applyMoveSession(); return; }
      if (activeTool === 'delete' && event.key === 'Escape') { event.preventDefault(); setActiveTool('select'); setStatus('Delete mode closed'); return; }
      if (activeTool === 'measure' && event.key === 'Escape') { event.preventDefault(); setActiveTool('select'); setSelectedAtomId(null); replaceMeasureSelection([]); setStatus('Measurement closed'); return; }
      if (activeTool === 'move' && ['x', 'y', 'z'].includes(event.key.toLowerCase())) {
        event.preventDefault();
        const axis = event.key.toLowerCase() as 'x' | 'y' | 'z';
        const plane = axis === 'x' ? 'yz' : axis === 'y' ? 'xz' : 'xy';
        setMoveConstraint(event.shiftKey ? plane : axis);
        setStatus(`Move constrained to ${event.shiftKey ? plane.toUpperCase() + ' plane' : axis.toUpperCase() + ' axis'}`);
        return;
      }
      if (event.key.toLowerCase() === 'f') { event.preventDefault(); fitStructure(); }
      if (event.key.toLowerCase() === 'v') activateTool('select');
      if (event.key.toLowerCase() === 'g') activateTool('move');
      if (event.key.toLowerCase() === 'm') activateTool('measure');
      if (event.key.toLowerCase() === 'a') activateTool('add');
      if (event.key === 'Delete' || event.key === 'Backspace') deleteSelected();
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  });

  const beginResize = (side: 'left' | 'right', event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {}
    resizeRef.current = { side, startX: event.clientX, startWidth: side === 'left' ? leftPanelWidth : rightPanelWidth };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    setIsResizing(side);
  };

  const leftPanelWidthRef = useRef(leftPanelWidth);
  useEffect(() => {
    leftPanelWidthRef.current = leftPanelWidth;
  }, [leftPanelWidth, integratedShell, shellWidth]);

  const resizePanelFromKeyboard = (side: 'left' | 'right', event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const delta = event.key === 'ArrowRight' ? 16 : -16;
    if (side === 'left') setLeftPanelWidth((width) => Math.max(190, Math.min(420, width + delta)));
    else setRightPanelWidth((width) => clampRightPanelWidth(width + delta, integratedShell ? 0 : leftPanelWidth, shellWidth || undefined));
  };

  useEffect(() => {
    const resize = (event: PointerEvent) => {
      const active = resizeRef.current;
      if (!active) return;
      const delta = event.clientX - active.startX;
      if (active.side === 'left') setLeftPanelWidth(Math.max(190, Math.min(420, active.startWidth + delta)));
      else setRightPanelWidth(clampRightPanelWidth(active.startWidth - delta, integratedShell ? 0 : leftPanelWidthRef.current, shellWidth || undefined));
    };
    const finish = () => {
      if (!resizeRef.current) return;
      resizeRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setIsResizing(null);
    };
    window.addEventListener('pointermove', resize);
    window.addEventListener('pointerup', finish);
    return () => {
      window.removeEventListener('pointermove', resize);
      window.removeEventListener('pointerup', finish);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setIsResizing(null);
    };
  }, [integratedShell, shellWidth]);

  useEffect(() => {
    pollingJobsRef.current = jobs;
  }, [jobs]);

  useEffect(() => {
    let disposed = false;
    const refresh = async () => {
      const active = pollingJobsRef.current.filter((job) => job.backendCalculationId && (job.status === 'Queued' || job.status === 'Running'));
      await Promise.all(active.map(async (job) => {
        if (!job.backendCalculationId) return;
        try {
          const payload = await phyniteCalculations.get(job.backendCalculationId);
          if (!disposed) setJobs((current) => current.map((item) => item.backendCalculationId === job.backendCalculationId ? mergeBackendJob(item, payload.calculation, payload.result) : item));
        } catch (error) {
          if (!disposed) setStatus(error instanceof Error ? error.message : 'Calculation status refresh failed');
          throw error;
        }
      }));
    };
    const stop = startBrowserPoll(refresh, 2000);
    return () => {
      disposed = true;
      stop();
    };
  }, []);

  const cloudSyncLabel = cloudSync.status === 'syncing'
    ? 'Saving...'
    : cloudSync.status === 'synced'
      ? 'Saved to cloud'
      : cloudSync.status === 'error'
        ? 'Save failed'
        : 'Autosave';
  const cloudSyncTitle = cloudSync.status === 'synced'
    ? `${cloudSync.lastSyncedAt ? `Saved ${formatWorkspaceTimestamp(cloudSync.lastSyncedAt)}` : 'Saved'} · ${formatProjectSize(cloudSync.sizeBytes)} stored in cloud`
    : cloudSyncLabel;
  const headerCloudLabel = !activeProject && cloudSync.status === 'synced' ? 'Cloud ready' : cloudSyncLabel;
  const headerCloudTitle = !activeProject && cloudSync.status === 'synced' ? 'Your private cloud workspace is available' : cloudSyncTitle;

  if (!workspaceHydrated) {
    return <div className="workspace-loading" role="status">{cloudSync.status === 'error'
      ? 'Unable to load this account’s workspace. Refresh to try again.'
      : 'Opening DFT Lab...'}</div>;
  }

  return (
    <div
      className="crystal-workspace relative flex h-[100svh] min-h-[620px] flex-col overflow-hidden"
      onDragEnter={showFigures ? undefined : handleStructureDragEnter}
      onDragOver={showFigures ? undefined : handleStructureDragOver}
      onDragLeave={handleStructureDragLeave}
      onDrop={showFigures ? undefined : handleStructureDrop}
    >
      <input ref={fileInput} type="file" accept={STRUCTURE_FILE_ACCEPT} aria-label="Import structure file" className="hidden" onChange={(event) => { void importStructure(event.target.files?.[0]); event.currentTarget.value = ''; }} />
      <span role="status" aria-live="polite" className="sr-only">{status}</span>
      <AnimatePresence>
        {structureDropActive && <motion.div
          role="status"
          aria-live="polite"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          className={cn('pointer-events-none absolute inset-0 z-[90] grid place-items-center p-5', workspaceTheme === 'light' ? 'bg-[#f4f7fb]/96' : 'bg-[#070707]/96')}
        >
          <motion.div
            initial={{ y: 8, scale: 0.98 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 5, scale: 0.99 }}
            transition={{ duration: 0.14, ease: 'easeOut' }}
            className={cn(
              'w-full max-w-[420px] overflow-hidden rounded-[6px] border',
              workspaceTheme === 'light' ? 'bg-white' : 'bg-[#111111]',
              !activeProjectId || structureDropSupported === false ? 'border-[#e3a5a5]' : 'border-[var(--line-strong)]',
            )}
          >
            <div className={cn('h-1', !activeProjectId || structureDropSupported === false ? 'bg-[#d75a63]' : 'bg-[var(--accent)]')} />
            <div className="px-7 py-8 text-center">
              <span className={cn('mx-auto grid h-12 w-12 place-items-center rounded-full', !activeProjectId || structureDropSupported === false ? 'bg-[#fff1f1] text-[#c94852]' : 'bg-[var(--surface-subtle)] text-[var(--ink)]')}>
                <Upload className="h-5 w-5" />
              </span>
              <p className={cn('mt-4 text-[15px] font-semibold', workspaceTheme === 'light' ? 'text-[#28313c]' : 'text-[#f1f1f3]')}>
                {!activeProjectId ? 'Select a project first' : structureDropSupported === false ? 'This file is not supported' : 'Drop to import structure'}
              </p>
              <p className={cn('mx-auto mt-2 max-w-[330px] text-[11px] leading-5', workspaceTheme === 'light' ? 'text-[#6f7a86]' : 'text-[#94949c]')}>
                {!activeProjectId
                  ? 'Create or select a research project, then drop the structure again.'
                  : structureDropSupported === false
                    ? 'Use a crystallographic file or Quantum ESPRESSO input/output.'
                    : `One file will be added to ${activeProject?.name ?? 'the active project'}.`}
              </p>
              <p className={cn('mt-5 font-mono text-[9px] tracking-[.08em]', workspaceTheme === 'light' ? 'text-[#8994a0]' : 'text-[#73737b]')}>CIF · XSF · POSCAR · VASP · XYZ · PDB · QE</p>
            </div>
          </motion.div>
        </motion.div>}
      </AnimatePresence>

      <WorkspaceProductHeader
        hidden={showFigures}
        className="workspace-topbar relative z-50"
        activeProduct="crystal"
        resourceOwnerId={ownerId}
        resourceUnlimited={Boolean(headerSession?.user.isDeveloper)}
        saveState={cloudSync.status === 'syncing' ? 'saving' : cloudSync.status}
        saveLabel={headerCloudLabel}
        saveDetail={headerCloudTitle}
        destinations={{ figures: { disabled: !activeProject, onSelect: () => openFigures(), title: 'Open Figure Lab' } }}
        context={activeProject && <nav className="workspace-product-breadcrumb" aria-label="DFT Lab location"><span>{activeProject.name}</span><ChevronRight size={12} /><strong>DFT Lab</strong>{activeMaterial && <><ChevronRight size={12} /><span>{materialName}</span></>}</nav>}
        actions={<div className="workspace-product-actions workspace-topbar-actions">
          {hasSelectedStructure && configuringComponent && !showWorkflow && <><button type="button" disabled={showFigures} onClick={undo} aria-label="Undo last edit" title="Undo · Ctrl Z" className="workspace-product-button workspace-product-button--icon"><Undo2 size={16} /></button>
          <button type="button" disabled={showFigures} onClick={redo} aria-label="Redo last edit" title="Redo · Ctrl Shift Z" className="workspace-product-button workspace-product-button--icon"><Redo2 size={16} /></button>
          <span className="workspace-product-divider" aria-hidden="true" /></>}
          {!shell && <a href={guidePath('en')} aria-label="Open user guide" title="User guide" className="workspace-product-button workspace-product-guide"><CircleHelp size={16} /><span>Guide</span></a>}
          {activeMaterial && <div className="relative flex items-center">
            <button type="button" disabled={!activeProject} onClick={() => setShowStudyEvidence(true)} className="workspace-product-button">Study evidence</button>
            <button type="button" aria-label="Open structure record" aria-expanded={recordOpen} title="Structure record" onClick={() => setRecordOpen((current) => !current)} className={cn('workspace-product-button workspace-product-button--icon', recordOpen && 'is-active')}><Info size={16} /></button>
            <AnimatePresence>
              {recordOpen && activeMaterial && <>
                <div aria-hidden="true" onPointerDown={() => setRecordOpen(false)} className="fixed inset-0 z-[80]" />
                <motion.section role="dialog" aria-label="Structure record" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.1 }} className="workspace-dark-surface absolute right-0 top-10 z-[90] w-[min(340px,calc(100vw-20px))] overflow-hidden rounded-[6px] border border-[#303030] bg-[#111111]">
                  <div className="flex h-12 items-center gap-2.5 border-b border-[#303030] px-3.5">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[5px] bg-[#202020] text-[#ededed]"><Info className="h-3.5 w-3.5" /></span>
                    <span className="min-w-0 flex-1"><span className="block text-[9px] uppercase tracking-[0.1em] text-[#77777f]">Structure record</span><span className="mt-0.5 block truncate text-[11px] font-semibold text-[#ededed]">{activeMaterial.name}</span></span>
                    <button type="button" aria-label="Close structure record" onClick={() => setRecordOpen(false)} className="grid h-7 w-7 place-items-center text-[#85858d] hover:bg-[#242424] hover:text-[#ededed]"><X className="h-3.5 w-3.5" /></button>
                  </div>
                  <div className="max-h-[min(520px,calc(100svh-76px))] overflow-y-auto">
                    <div className="border-b border-[#2a2a2a] px-3.5 py-3">
                      <p className="mb-2 font-mono text-[8px] uppercase tracking-[0.1em] text-[#66666e]">Overview</p>
                      <div className="space-y-2"><DataRow label="Project" value={activeProject?.name ?? 'Unassigned'} /><DataRow label="Project size" value={activeProjectSize} /><DataRow label="Structure type" value={activeMaterial.kind || 'Structure'} /><DataRow label="Source" value={activeMaterial.source ?? 'Local workspace'} /><DataRow label="Atoms" value={String(atoms.length)} /></div>
                    </div>
                    <div className="border-b border-[#2a2a2a] px-3.5 py-3">
                      <p className="mb-2 font-mono text-[8px] uppercase tracking-[0.1em] text-[#66666e]">Structure timeline</p>
                      <div className="space-y-2"><DataRow label="Created" value={formatWorkspaceTimestamp(activeMaterial.createdAt)} /><DataRow label="Last edited" value={formatWorkspaceTimestamp(activeMaterial.updatedAt)} /><DataRow label="Last opened" value={formatWorkspaceTimestamp(activeMaterial.lastOpenedAt)} /></div>
                    </div>
                    <div className="border-b border-[#2a2a2a] px-3.5 py-3">
                      <p className="mb-2 font-mono text-[8px] uppercase tracking-[0.1em] text-[#66666e]">Project timeline</p>
                      <div className="space-y-2"><DataRow label="Created" value={formatWorkspaceTimestamp(activeProject?.createdAt)} /><DataRow label="Last edited" value={formatWorkspaceTimestamp(activeProject?.updatedAt)} /></div>
                    </div>
                    <div className="px-3.5 py-3">
                      <p className="mb-2 font-mono text-[8px] uppercase tracking-[0.1em] text-[#66666e]">Identifiers</p>
                      <div className="space-y-2"><DataRow label="Storage" value={cloudSync.status === 'error' ? 'Device copy · cloud sync failed' : cloudSync.status === 'syncing' ? 'Saving to cloud' : 'Cloud workspace'} /><DataRow label="Project ID" value={activeProject?.id ?? 'Unassigned'} /><DataRow label="Structure ID" value={activeMaterial.id} /></div>
                    </div>
                  </div>
                </motion.section>
              </>}
            </AnimatePresence>
          </div>}
          {!shell && <button type="button" onClick={toggleWorkspaceTheme} aria-label={workspaceTheme === 'dark' ? 'Use light mode' : 'Use dark mode'} title={workspaceTheme === 'dark' ? 'Light mode' : 'Dark mode'} className="workspace-product-button workspace-product-button--icon">{workspaceTheme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}</button>}
          <button type="button" onClick={toggleProjectPanel} aria-label={showLeftPanel ? 'Close project panel' : 'Open project panel'} aria-pressed={showLeftPanel} className={cn('workspace-compact-panel-toggle workspace-project-panel-toggle workspace-product-button workspace-product-button--icon', showLeftPanel && 'is-active')}><Menu size={16} /></button>
          {activeMaterial && (configuringComponent || rightTab === 'calculations') && <button type="button" onClick={toggleInspectorPanel} aria-label={showInspector ? 'Close inspector' : 'Open inspector'} aria-pressed={showInspector} className={cn('workspace-compact-panel-toggle workspace-inspector-panel-toggle workspace-product-button workspace-product-button--icon', showInspector && 'is-active')}><SlidersHorizontal size={16} /></button>}
          {headerSession && <AccountMenu session={headerSession} />}
        </div>}
      />

      {showStudyEvidence && activeProject && <StudyEvidenceDialog key={`${ownerId}:${activeProject.id}:dft`} storageKey={`phynite:study-evidence:${ownerId}:${activeProject.id}:dft`} onClose={() => setShowStudyEvidence(false)} />}
      {showFigures && activeProject && <FiguresWorkspace onBeforeNavigate={async () => { persistWorkspaceSnapshot(); await cloudSync.flush(); }} session={headerSession} key={`${ownerId}/${activeProject.id}`} ownerId={ownerId} projectId={activeProject.id} projectName={activeProject.name} jobs={jobs.filter((job) => projectMaterials.some((material) => material.id === job.materialId)).map((job) => ({ ...job, structureName: projectMaterials.find((material) => material.id === job.materialId)?.name }))} initialJobId={figureInitialJobId} theme={workspaceTheme} onToggleTheme={toggleWorkspaceTheme} onUpdateResultPlot={saveJobPlotSettings} onClose={closeFigures} />}
      {showFigures && !activeProject && <div className={cn('flex min-h-0 flex-1 flex-col', workspaceTheme === 'light' ? 'bg-[#f7f8fa] text-[#303a46]' : 'bg-[#0a0a0a] text-[#ededed]')}>
        <WorkspaceProductHeader className="research-topbar workspace-topbar" activeProduct="figures" saveState={cloudSync.status === 'syncing' ? 'saving' : cloudSync.status} saveLabel={headerCloudLabel} saveDetail={headerCloudTitle} destinations={{ crystal: { onSelect: closeFigures, title: 'Open DFT Lab' } }} actions={shell ? undefined : <div className="workspace-product-actions workspace-topbar-actions"><a href={guidePath('en')} aria-label="Open user guide" title="User guide" className="workspace-product-button workspace-product-guide"><CircleHelp size={16} /><span>Guide</span></a><button type="button" onClick={toggleWorkspaceTheme} aria-label={workspaceTheme === 'dark' ? 'Use light mode' : 'Use dark mode'} title={workspaceTheme === 'dark' ? 'Light mode' : 'Dark mode'} className="workspace-product-button workspace-product-button--icon">{workspaceTheme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}</button>{headerSession && <AccountMenu session={headerSession} />}</div>} />
        <WorkspaceProjectGate theme={workspaceTheme} className="min-h-0 flex-1 overflow-y-auto" description="Select the project whose calculation results you want to prepare as publication figures." actionLabel={projects.length ? undefined : 'Create project'} onAction={projects.length ? undefined : () => { closeFigures(); setShowLeftPanel(true); setProjectCreateRequest((current) => current + 1); }}>
          {projects.length > 0 && <div className={cn('mt-6 overflow-hidden rounded-[6px] border text-left', workspaceTheme === 'light' ? 'border-[#dfe3e8] bg-white' : 'border-[#303030] bg-[#111111]')}>{projects.map(project => <button key={project.id} type="button" onClick={() => selectProject(project.id)} className={cn('flex min-h-14 w-full items-center gap-3 border-b px-4 text-left transition-colors last:border-b-0', workspaceTheme === 'light' ? 'border-[#eceef1] hover:bg-[#f4f6f8]' : 'border-[#292929] hover:bg-[#191919]')}><FolderKanban size={16} className="shrink-0 text-[#7188a5]" /><span className="min-w-0 flex-1"><strong className="block truncate text-[12px] font-semibold">{project.name}</strong><small className={cn('mt-1 block truncate text-[10px]', workspaceTheme === 'light' ? 'text-[#7b8590]' : 'text-[#85858d]')}>{project.description}</small></span><ChevronRight size={15} className="shrink-0 opacity-55" /></button>)}</div>}
        </WorkspaceProjectGate>
      </div>}
      <div className="relative flex min-h-0 flex-1" style={showFigures ? { display: 'none' } : undefined}>
        {showLeftPanel && <button type="button" aria-label="Close project panel" onClick={() => setShowLeftPanel(false)} className="workspace-panel-backdrop absolute inset-0 z-20 hidden lg:block xl:hidden" />}
        {showLeftPanel && <button type="button" aria-label="Close project panel" onClick={() => setShowLeftPanel(false)} className="workspace-panel-backdrop absolute inset-0 z-20 lg:hidden" />}
        {activeMaterial && showInspector && (configuringComponent || rightTab === 'calculations') && <button type="button" aria-label="Close inspector" onClick={() => setShowInspector(false)} className="workspace-panel-backdrop absolute inset-0 z-30 lg:hidden" />}
        <DftProjectStructureSidebar
          key={`dft-sidebar-${projectCreateRequest}`}
          projects={projects}
          activeProjectId={activeProjectId}
          onSelectProject={selectProject}
          onCreateProject={createProject}
          onRenameProject={renameProject}
          onDuplicateProject={duplicateProject}
          onDeleteProject={deleteProject}
          materials={materials}
          activeMaterialId={activeMaterialId}
          onSelectMaterial={selectMaterial}
          onCreateStructure={createStructure}
          onImportFile={() => fileInput.current?.click()}
          onOpenMaterialsProject={() => { setConfiguringComponentId(null); setMaterialsProjectOpen(true); }}
          onRenameMaterial={renameMaterial}
          onDuplicateMaterial={duplicateMaterial}
          onDeleteMaterial={deleteMaterial}
          width={leftPanelWidth}
          onWidthChange={setLeftPanelWidth}
          initialCreateProjectOpen={projectCreateRequest > 0}
          isOpen={showLeftPanel}
          onClose={() => setShowLeftPanel(false)}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          {activeProject && <div className="dft-view-tabs" role="tablist" aria-label="DFT view"><button role="tab" aria-selected={!showWorkflow} onClick={() => { finishWorkflowConfiguration(); navigateWorkspaceView('builder'); }}>Structure</button><button role="tab" aria-selected={showWorkflow} onClick={() => { finishWorkflowConfiguration(); navigateWorkspaceView('workflow'); }}>Workflow</button></div>}
          <main ref={viewportStageRef} className="workspace-crystal-stage relative min-h-0 flex-1">
            {showWorkflow && activeProject && <div className="absolute inset-0 z-30 flex"><DftWorkflowCanvas key={`${ownerId}:${activeProjectId}`} ownerId={ownerId} projectId={activeProjectId} theme={workspaceTheme} document={workflowDocument} outdatedNodeIds={workflowComponents.filter(c => jobs.some(j => j.componentId === c.id && j.status === 'Completed') && !reusableCompletedJob(c)).map(c => c.id)} materials={projectMaterials} jobs={jobs.filter(j => projectMaterials.some(m => m.id === j.materialId))} canUndo={!!workflowHistories.current.get(activeProjectId)?.past.length} canRedo={!!workflowHistories.current.get(activeProjectId)?.future.length} busy={workflowSubmitting || jobs.some(j => projectMaterials.some(m => m.id === j.materialId) && ['Queued', 'Running'].includes(j.status))} onChange={commitWorkflow} onUndo={() => moveWorkflowHistory(false)} onRedo={() => moveWorkflowHistory(true)} onAdd={addWorkflowNode} onAddOperation={addWorkflowOperation} onConfigure={configureWorkflowNode} onOpenStructure={id => { const record = materials.find(m => m.id === id); if (record) selectMaterial(record); navigateWorkspaceView('builder'); }} onImportStructure={() => fileInput.current?.click()} onPaste={pasteWorkflow} onRun={ids => { void runWorkflow(ids); }} onCancel={() => { void cancelWorkflow(); }} /></div>}
            {hasSelectedStructure && !configuringComponent && !showWorkflow ? <CrystalBuilderEditor
              key={activeMaterialId} structure={{name:activeMaterial?.name ?? 'Crystal',atoms,lattice}}
              metadata={{externalId:activeMaterial?.externalId,bandGap:activeMaterial?.bandGap}}
              viewKey={`phynite:crystal-editor:v2:${ownerId}:legacy:${activeProject?.id}:${activeMaterialId}`}
              theme={workspaceTheme} saveStatus={cloudSync.status} inspectorVisible={rightTab!=='calculations' || !showInspector}
              actions={<button onClick={()=>{setRightTab('calculations');setShowInspector(true);}}>Calculate</button>}
              onChange={next=>{pushHistory();syncActiveMaterial(next.atoms,next.lattice);}}
              onSave={async()=>{persistWorkspaceSnapshot();await cloudSync.flush();}}
            /> : <>
            {hasSelectedStructure && !showWorkflow && (
              <CrystalEditorViewport atoms={viewedAtoms} lattice={viewedLattice} supercell={supercell} selectedAtomId={selectedAtomId} onSelectAtom={handleSelectAtom} displayStyle={displayStyle} atomColors={scalarColors.colors} exportRef={sceneExportRef} focusRequest={focusRequest} viewRequest={cameraViewRequest} fitKey={`${activeMaterialId}-${fitRequest}`} atomScale={atomScale} bondScale={bondScale} bondCutoff={bondCutoff} showBonds={showBonds} showCell={showCell} showLabels={showLabels} showForces={showForces} forceScale={forceScale} objectRotation={objectRotation} activeTool={activeTool} moveSpace={moveSpace} moveConstraint={moveConstraint} moveSnap={viewportMoveSnap} measurementInstanceIds={measurementInstanceIds} showNavigationGizmo={!configuringComponent} theme={workspaceTheme} onTransformStart={pushHistory} onMoveAtom={moveAtomFromGizmo} onRotateObject={(rotation) => { setObjectRotation(rotation); setStatus('Crystal rotated'); }} onEmptyClick={() => addAtomAtCenter()} />
            )}
            <AnimatePresence>{configuringComponent && <CalculationConfigDrawer calculation={configuringComponent.calculation} draft={configuringComponent.scfSourceId && calculationComponents.some(c => c.id === configuringComponent.scfSourceId) ? inheritedAnalysisDraft(configuringComponent.draft, calculationComponents.find(c => c.id === configuringComponent.scfSourceId)!.draft) : configuringComponent.draft} material={materialContextForComponent(configuringComponent)} structureSourceId={configuringComponent.structureSourceId} structureInputOptions={structureInputOptions} configurationSources={compatibleCalculationSources} onChange={updateCalculationDraft} onStructureSourceChange={changeCalculationStructureSource} onAddRelaxationSource={() => addCalculationComponent('Structural relaxation', undefined, configuringComponent.id)} onImportCalculationDraft={importDraftFromCalculation} onApplyAccuracy={applyAccuracy} scfSourceLabel={configuringComponent.scfSourceId && configuringComponent.scfSourceId !== 'unbound' ? calculationComponents.find(c => c.id === configuringComponent.scfSourceId)?.name : undefined} onClose={finishWorkflowConfiguration} onSave={() => { finishWorkflowConfiguration(); saveCalculationConfiguration(configuringComponent); }} onRun={() => { finishWorkflowConfiguration(); if (configuringComponent.scfSourceId || showWorkflow) void runWorkflow([configuringComponent.id]); else runCalculation(configuringComponent.id); }} />}</AnimatePresence>
            {hasSelectedStructure && (
              <div role="toolbar" aria-label="DFT Lab editing tools" className="workspace-canvas-toolbar absolute left-3 top-1/2 z-20 -translate-y-1/2 select-none rounded-[9px] border border-[#262626] bg-[#0A0A0A] p-1 shadow-[0_12px_32px_rgba(0,0,0,.22)]">
                {/* Cluster 1: Inspect & Cluster 2: Edit */}
                {tools.map((tool) => {
                  const Icon = tool.icon;
                  const active = activeTool === tool.id;
                  return <div key={tool.id} className={cn(tool.dividerBefore && 'my-1 border-t border-[#262626]')}>
                    <button
                      type="button"
                      aria-label={tool.label}
                      aria-pressed={active}
                      onClick={() => activateTool(tool.id)}
                      className={cn(
                        'group relative grid h-9 w-9 place-items-center rounded-[6px] text-[#697480] transition-colors hover:bg-[#1a1a1a] hover:text-[#ededed]',
                        active && tool.id !== 'delete' && 'bg-[#2e3b59] text-[#9bc2ff]',
                        active && tool.id === 'delete' && 'bg-[#2b1215] text-[#ff858c]'
                      )}
                    >
                      <Icon className="h-4 w-4" aria-hidden="true" />
                      <span role="tooltip" className="pointer-events-none absolute left-11 z-50 hidden h-7 items-center whitespace-nowrap rounded-[5px] border border-[#2d2d2d] bg-[#1a1a1a] px-2.5 text-[11px] font-medium text-white shadow-lg group-hover:flex">
                        {tool.label}
                        {tool.shortcut && <kbd className="ml-1.5 font-mono text-[9px] text-[#929ba5]">{tool.shortcut}</kbd>}
                      </span>
                    </button>
                  </div>;
                })}

                {/* Divider before Cluster 3 */}
                <div className="my-1 border-t border-[#262626]" />

                {/* Cluster 3: Camera & Viewport */}
                <button
                  type="button"
                  aria-label="View angle"
                  aria-expanded={viewMenuOpen}
                  aria-pressed={viewMenuOpen}
                  onClick={() => setViewMenuOpen((current) => !current)}
                  className={cn(
                    'group relative grid h-9 w-9 place-items-center rounded-[6px] text-[#697480] transition-colors hover:bg-[#1a1a1a] hover:text-[#ededed]',
                    viewMenuOpen && 'bg-[#2e3b59] text-[#9bc2ff]'
                  )}
                >
                  <Axis3D className="h-4 w-4" aria-hidden="true" />
                  <span role="tooltip" className="pointer-events-none absolute left-11 z-50 hidden h-7 items-center whitespace-nowrap rounded-[5px] border border-[#2d2d2d] bg-[#1a1a1a] px-2.5 text-[11px] font-medium text-white shadow-lg group-hover:flex">
                    View angle
                  </span>
                </button>

                <button
                  type="button"
                  aria-label="Fit structure"
                  onClick={fitStructure}
                  className="group relative grid h-9 w-9 place-items-center rounded-[6px] text-[#697480] transition-colors hover:bg-[#1a1a1a] hover:text-[#ededed]"
                >
                  <Crosshair className="h-4 w-4" aria-hidden="true" />
                  <span role="tooltip" className="pointer-events-none absolute left-11 z-50 hidden h-7 items-center whitespace-nowrap rounded-[5px] border border-[#2d2d2d] bg-[#1a1a1a] px-2.5 text-[11px] font-medium text-white shadow-lg group-hover:flex">
                    Fit structure
                    <kbd className="ml-1.5 font-mono text-[9px] text-[#929ba5]">F</kbd>
                  </span>
                </button>
              </div>
            )}
            {hasSelectedStructure && (
              <AnimatePresence>
                {viewMenuOpen && <LabViewAngleMenu activeView={activeViewAngle} onSelect={snapCameraView} onClose={() => setViewMenuOpen(false)} className="absolute left-16 top-1/2 z-30 -translate-y-1/2" />}
              </AnimatePresence>
            )}
            {hasSelectedStructure && (
              <AnimatePresence initial={false}>{activeTool === 'delete' && atoms.length > 0 && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.1 }} className="absolute left-16 right-2 top-3 max-w-[256px] overflow-hidden rounded-[6px] border border-[var(--panel-border)] bg-[var(--panel-bg)] shadow-lg">
                <div className="flex items-center gap-2 border-b border-[var(--panel-border)] bg-[var(--panel-raised)] px-3 py-2.5"><span className="workspace-danger-button grid h-7 w-7 place-items-center rounded-[4px] text-white"><Trash2 className="h-3.5 w-3.5" /></span><span className="min-w-0 flex-1"><span className="block text-[12px] font-medium text-[var(--panel-text)]">Delete atoms</span><span className="block text-[10px] text-[var(--panel-muted)]">{atoms.length} atoms in this structure</span></span><button type="button" onClick={() => setActiveTool('select')} aria-label="Exit delete mode" className="grid h-6 w-6 place-items-center rounded-[4px] text-[var(--panel-muted)] hover:bg-[var(--panel-hover)] hover:text-[var(--panel-text)]"><X className="h-3.5 w-3.5" /></button></div>
                <div className="p-3"><p className="text-[10px] text-[var(--panel-muted)]">Click an atom to delete.</p>{selectedAtom && <button type="button" disabled={atoms.length <= 1} onClick={deleteSelected} className="workspace-danger-button mt-3 flex h-8 w-full items-center justify-center gap-1.5 rounded-[4px] text-[11px] font-semibold text-white disabled:opacity-45"><Trash2 className="h-3 w-3" /> Delete selected · {selectedAtom.species}</button>}<button type="button" onClick={() => setActiveTool('select')} className="mt-1.5 h-8 w-full rounded-[4px] border border-[var(--panel-border)] bg-[var(--panel-raised)] text-[11px] font-medium text-[var(--panel-text)] hover:bg-[var(--panel-hover)]">Done</button></div>
              </motion.div>}</AnimatePresence>
            )}
            {hasSelectedStructure && (
              <AnimatePresence initial={false}>{selectedAtom && activeTool === 'move' ? <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.1 }} className="absolute left-16 right-2 top-3 max-w-[284px] overflow-hidden rounded-[6px] border border-[var(--panel-border)] bg-[var(--panel-bg)] shadow-lg">
                <div className="flex h-11 items-center gap-2 border-b border-[var(--panel-border)] bg-[var(--panel-raised)] px-3"><span className="grid h-7 w-7 place-items-center rounded-[4px] border border-[var(--panel-border)] bg-[var(--panel-bg)] font-mono text-[11px] font-semibold text-[var(--panel-text)]">{selectedAtom.species}</span><span className="min-w-0 flex-1"><span className="block truncate text-[12px] font-medium text-[var(--panel-text)]">Move {elementNames[selectedAtom.species] ?? selectedAtom.species}</span><span className="block font-mono text-[9px] text-[var(--panel-muted)]">{selectedAtom.id}</span></span><button type="button" onClick={() => setActiveTool('select')} aria-label="Close move tool" className="grid h-6 w-6 place-items-center text-[var(--panel-muted)] hover:bg-[var(--panel-hover)] hover:text-[var(--panel-text)]"><X className="h-3.5 w-3.5" /></button></div>
                <div className="space-y-3 p-3">
                  <div><div className="mb-1.5 flex items-center justify-between"><span className="text-[10px] font-medium text-[var(--panel-muted)]">Coordinate input</span><span className="text-[9px] text-[var(--panel-muted)]">Live preview</span></div><div className="grid grid-cols-3 overflow-hidden rounded-[4px] border border-[var(--panel-border)]">{(['fractional', 'cartesian', 'delta'] as CoordinateMode[]).map((mode) => <button key={mode} type="button" onClick={() => setCoordinateMode(mode)} className={cn('h-7 border-r border-[var(--panel-border)] text-[10px] capitalize last:border-r-0', coordinateMode === mode ? 'bg-[var(--panel-selected)] font-medium text-[var(--panel-text)]' : 'bg-[var(--panel-raised)] text-[var(--panel-muted)] hover:bg-[var(--panel-hover)]')}>{mode === 'cartesian' ? 'Cartesian' : mode === 'fractional' ? 'Fractional' : 'Δ offset'}</button>)}</div></div>
                  <div className="grid grid-cols-3 gap-1.5">{(['x', 'y', 'z'] as const).map((axis, index) => {
                    const value = coordinateMode === 'fractional' ? selectedAtom[axis] : coordinateMode === 'cartesian' ? (selectedCartesian?.[index] ?? 0) : (selectedCartesian?.[index] ?? 0) - (moveOriginCartesian?.[index] ?? 0);
                    return <FlatNumberField key={axis} label={axis.toUpperCase()} value={value} suffix={coordinateMode === 'fractional' ? undefined : 'Å'} step={coordinateMode === 'fractional' ? 0.01 : 0.05} onChange={(next) => setCoordinateValue(index, next)} />;
                  })}</div>
                  <div><div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium text-[var(--panel-muted)]"><LockKeyhole className="h-3 w-3 text-[var(--panel-muted)]" /> Constraint</div><div className="grid grid-cols-7 overflow-hidden rounded-[4px] border border-[var(--panel-border)]">{(['free', 'x', 'y', 'z', 'xy', 'xz', 'yz'] as MoveConstraint[]).map((constraint) => <button key={constraint} type="button" onClick={() => setMoveConstraint(constraint)} aria-label={constraint === 'free' ? 'Free 3D movement' : constraint.length === 1 ? `${constraint.toUpperCase()} axis only` : `${constraint.toUpperCase()} plane only`} className={cn('h-7 border-r border-[var(--panel-border)] font-mono text-[9px] uppercase last:border-r-0', moveConstraint === constraint ? 'bg-[var(--panel-selected)] font-semibold text-[var(--panel-text)]' : 'bg-[var(--panel-raised)] text-[var(--panel-muted)] hover:bg-[var(--panel-hover)]')}>{constraint}</button>)}</div></div>
                  <div className="grid grid-cols-2 gap-2"><UiSelect label="Gizmo space" value={moveSpace} options={[{ value: 'world', label: 'World XYZ', detail: 'Fixed viewport axes' }, { value: 'local', label: 'Crystal local', detail: 'Axes follow crystal rotation' }]} onChange={(value) => setMoveSpace(value as MoveSpace)} /><div><LabSwitch checked={moveSnapEnabled} onCheckedChange={setMoveSnapEnabled} aria-label="Snap movement" className="mb-1 h-4 text-[10px] text-[var(--panel-muted)]">Snap movement</LabSwitch><FlatNumberField label="STEP" value={moveSnap} suffix="Å" step={0.05} onChange={(value) => setMoveSnap(Math.max(0.001, value))} /></div></div>
                  <div><div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium text-[var(--panel-muted)]"><Crosshair className="h-3 w-3 text-[var(--panel-muted)]" /> Precision nudge · {moveSnap} Å</div><div className="grid grid-cols-6 overflow-hidden rounded-[4px] border border-[var(--panel-border)]">
                    <button type="button" onClick={() => nudgeSelectedAtom(0, -1)} className="h-7 border-r border-[var(--panel-border)] bg-[var(--panel-raised)] font-mono text-[10px] text-[var(--panel-text)] hover:bg-[var(--panel-hover)]">−X</button><button type="button" onClick={() => nudgeSelectedAtom(0, 1)} className="h-7 border-r border-[var(--panel-border)] bg-[var(--panel-raised)] font-mono text-[10px] text-[var(--panel-text)] hover:bg-[var(--panel-hover)]">+X</button><button type="button" onClick={() => nudgeSelectedAtom(1, -1)} className="h-7 border-r border-[var(--panel-border)] bg-[var(--panel-raised)] font-mono text-[10px] text-[var(--panel-text)] hover:bg-[var(--panel-hover)]">−Y</button><button type="button" onClick={() => nudgeSelectedAtom(1, 1)} className="h-7 border-r border-[var(--panel-border)] bg-[var(--panel-raised)] font-mono text-[10px] text-[var(--panel-text)] hover:bg-[var(--panel-hover)]">+Y</button><button type="button" onClick={() => nudgeSelectedAtom(2, -1)} className="h-7 border-r border-[var(--panel-border)] bg-[var(--panel-raised)] font-mono text-[10px] text-[var(--panel-text)] hover:bg-[var(--panel-hover)]">−Z</button><button type="button" onClick={() => nudgeSelectedAtom(2, 1)} className="h-7 bg-[var(--panel-raised)] font-mono text-[10px] text-[var(--panel-text)] hover:bg-[var(--panel-hover)]">+Z</button>
                  </div></div>
                </div>
                <div className="grid grid-cols-[auto_auto_1fr_auto] gap-1 border-t border-[var(--panel-border)] bg-[var(--panel-raised)] p-2"><button type="button" onClick={duplicateSelectedAtom} aria-label="Duplicate and move" className="flex h-7 items-center gap-1 rounded-[4px] px-2 text-[10px] text-[var(--panel-muted)] hover:bg-[var(--panel-hover)] hover:text-[var(--panel-text)]"><Copy className="h-3 w-3" /> Duplicate</button><button type="button" onClick={resetMoveSession} className="h-7 rounded-[4px] px-2 text-[10px] text-[var(--panel-muted)] hover:bg-[var(--panel-hover)] hover:text-[var(--panel-text)]">Reset</button><button type="button" onClick={focusSelected} aria-label="Focus selected atom" className="ml-auto grid h-7 w-7 place-items-center rounded-[4px] text-[var(--panel-muted)] hover:bg-[var(--panel-hover)] hover:text-[var(--panel-text)]"><Maximize2 className="h-3 w-3" /></button><button type="button" onClick={applyMoveSession} className="h-7 rounded-[4px] bg-[var(--panel-accent)] px-3 text-[10px] font-semibold text-[var(--on-accent)] hover:brightness-110">Apply</button></div>
              </motion.div> : null}</AnimatePresence>
            )}
            {activeProject && !hasSelectedStructure && (
              <WorkspaceAssetGate
                className="absolute inset-0 z-10"
                title={projectMaterials.length ? 'Choose a structure' : 'Add your first structure'}
                description={projectMaterials.length
                  ? 'Open a structure from the project panel to continue in DFT Lab.'
                  : `Import a structure into ${activeProject.name} to start DFT Lab.`}
                actionLabel={projectMaterials.length ? undefined : 'Browse files'}
                onAction={projectMaterials.length ? undefined : () => fileInput.current?.click()}
              />
            )}
            {!activeProject && (
              <WorkspaceProjectGate
                theme={workspaceTheme}
                className="absolute inset-0 z-10"
                description="Select or create a project before adding structures and configuring calculations."
                actionLabel={projects.length ? 'Choose project' : 'Create project'}
                onAction={() => {
                  setShowLeftPanel(true);
                  if (projects.length) {
                    window.requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.workspace-selection-row > button')?.focus());
                  } else {
                    setProjectCreateRequest((current) => current + 1);
                  }
                }}
              />
            )}
            {hasSelectedStructure && (
              <AnimatePresence initial={false}>{activeTool === 'measure' && <motion.div
                drag
                dragListener={false}
                dragControls={measureDragControls}
                dragConstraints={viewportStageRef}
                dragMomentum={false}
                dragElastic={0.05}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.1 }}
                className="workspace-dark-surface absolute left-16 top-3 w-[360px] max-w-[calc(100%-80px)] overflow-hidden rounded-[6px] border border-[#303030] bg-[#111111]/97 shadow-[0_14px_40px_rgba(0,0,0,.34)] backdrop-blur z-30 pointer-events-auto select-none"
              >
                <div
                  onPointerDown={(e) => {
                    if ((e.target as HTMLElement).closest('button, a, input')) return;
                    measureDragControls.start(e);
                  }}
                  className="flex h-10 cursor-grab active:cursor-grabbing items-center gap-2 border-b border-[#2d2d2d] px-3 select-none"
                >
                  <Ruler className="h-3.5 w-3.5 text-[#ededed]" /><span className="text-[12px] font-medium text-[#ededed]">Measure</span><span className="ml-auto text-[10.5px] tabular-nums text-[#8d8d95]">{measureSelection.length}/{measureTargetCount}</span><button type="button" aria-label="Close measure" onClick={() => { setActiveTool('select'); setSelectedAtomId(null); replaceMeasureSelection([]); }} className="grid h-6 w-6 place-items-center rounded-[5px] text-[#85858d] hover:bg-[#242424] hover:text-[#ededed]"><X className="h-3.5 w-3.5" /></button></div>
                <div className="p-3">
                  <div className="grid grid-cols-3 gap-1 rounded-[7px] bg-[#0d0d0d] p-1">{(['atom', 'distance', 'angle'] as MeasureMode[]).map((mode) => <button key={mode} type="button" aria-pressed={measureMode === mode} onClick={() => startMeasurement(mode)} className={cn('h-7 rounded-[5px] text-[11px] font-medium capitalize text-[#85858d] hover:bg-[#1b1b1b] hover:text-[#d4d4d8]', measureMode === mode && 'bg-[#242424] text-[#ededed]')}>{mode === 'atom' ? 'Atom' : mode}</button>)}</div>
                  <div className="mt-3 rounded-[7px] border border-[#303030] bg-[#151515] p-3">
                    <div className="flex items-center justify-between gap-2"><p className="text-[10px] font-semibold uppercase tracking-[.08em] text-[#8e8e93]">{measureMode === 'atom' ? 'Atom info' : measureMode === 'angle' ? 'Angle' : 'Distance'}</p></div>
                    <AnimatePresence mode="wait">{measurement && measurement.mode !== 'atom' ? <MeasurementResultView result={measurement} /> : !measurement ? <motion.div key={`${measureMode}-${measureSelection.length}`} initial={{ opacity: 0, y: 2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} transition={{ duration: 0.1 }}><p className="mt-2 text-[11px] text-[#a1a1aa]">Select atom {Math.min(measureSelection.length + 1, measureTargetCount)} of {measureTargetCount}</p>{measureSelection.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{measureSelection.map((selection, index) => <span key={selection.instanceId} className="rounded bg-[#1a1a1a] px-1.5 py-0.5 font-mono text-[10px] text-[#d4d4d8] border border-[#2a2a2a]">{index + 1} · {atoms.find((atom) => atom.id === selection.atomId)?.species}</span>)}</div>}</motion.div> : null}</AnimatePresence>
                    {measureMode === 'atom' && <AtomInformation entry={selectedMeasurementCoordinates[0]} />}
                  </div>
                  <div className="mt-2 flex justify-end"><button type="button" onClick={() => { setSelectedAtomId(null); replaceMeasureSelection([]); setStatus(`Measure ${measureMode} · select atom 1 of ${measureTargetCount}`); }} className="h-7 rounded-[5px] border border-[#343434] px-3 text-[10.5px] font-medium text-[#a1a1aa] hover:bg-[#202020] hover:text-[#ededed]">Clear</button></div>
                </div>
              </motion.div>}</AnimatePresence>
            )}
            </>}
          </main>

        </div>

        {activeMaterial && !showWorkflow && (configuringComponent || (rightTab==='calculations' && showInspector)) && <aside style={{ width: `min(${rightPanelWidth}px, calc(100vw - 44px))` }} data-shell-open={showInspector} className={cn('workspace-panel-right workspace-sidebar absolute bottom-0 right-0 top-0 z-40 shrink-0 border-l border-[var(--panel-border)] bg-[var(--panel-bg)] lg:relative lg:block', showInspector ? 'block' : 'hidden lg:block')}>
          <div
            role="separator"
            aria-label="Resize properties panel"
            aria-orientation="vertical"
            aria-valuemin={RIGHT_PANEL_MIN_WIDTH}
            aria-valuemax={getDynamicRightPanelMaxWidth(integratedShell ? 0 : leftPanelWidth, shellWidth || undefined)}
            aria-valuenow={rightPanelWidth}
            tabIndex={0}
            onKeyDown={(event) => resizePanelFromKeyboard('right', event)}
            onPointerDown={(event) => beginResize('right', event)}
            onDoubleClick={() => setRightPanelWidth(RIGHT_PANEL_DEFAULT_WIDTH)}
            title={`Drag to resize (${RIGHT_PANEL_MIN_WIDTH}px – ${getDynamicRightPanelMaxWidth(integratedShell ? 0 : leftPanelWidth, shellWidth || undefined)}px) · Double click to reset`}
            className="group absolute -left-1.5 top-0 z-50 h-full w-3 cursor-col-resize touch-none outline-none"
          >
            <span
              className={cn(
                'absolute bottom-0 left-1/2 top-0 w-0.5 -translate-x-1/2 bg-transparent transition-colors',
                'group-hover:bg-[var(--panel-accent)] group-focus-visible:bg-[var(--panel-accent)]',
                isResizing === 'right' && 'bg-[var(--panel-accent)]'
              )}
            />
          </div>
          <div className="workspace-tab-strip crystal-inspector-tabs relative grid h-9 grid-cols-2 gap-0.5 border-b border-[var(--panel-border)] bg-[var(--panel-bg)] p-0.5 pr-9 lg:pr-0.5">
            <button type="button" onClick={() => {setRightTab('structure');setShowInspector(false);}} aria-pressed={rightTab === 'structure'} className={cn('text-[11px] font-semibold text-[var(--panel-muted)] transition-colors hover:text-[var(--panel-text)]', rightTab === 'structure' && 'bg-[var(--panel-selected)] text-[var(--panel-text)]')}>Inspect</button>
            <button type="button" disabled={!activeMaterial} onClick={() => setRightTab('calculations')} aria-pressed={rightTab === 'calculations'} className={cn('text-[11px] font-semibold text-[var(--panel-muted)] transition-colors hover:text-[var(--panel-text)] disabled:cursor-not-allowed disabled:opacity-40', rightTab === 'calculations' && 'bg-[var(--panel-selected)] text-[var(--panel-text)]')}>Calculate</button>
            <button type="button" aria-label="Close inspector" onClick={() => setShowInspector(false)} className="workspace-compact-panel-close absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-[4px] text-[var(--panel-muted)] hover:bg-[var(--panel-hover)] lg:hidden"><X className="h-3.5 w-3.5" /></button>
          </div>
          <div className="h-[calc(100%-36px)] overflow-hidden">
            {rightTab !== 'calculations' ? activeMaterial ? <div className="crystal-inspector-content h-full overflow-y-auto">
          <PropertySection title="Structure" icon={Box} defaultOpen>
            <div className="rounded-[8px] border border-[var(--panel-border)] bg-[var(--panel-raised)] p-3 space-y-2.5">
              <div className="grid grid-cols-3 gap-2">
                <div className="flex flex-col">
                  <span className="font-mono text-[15px] font-semibold tracking-tight text-[var(--panel-text)] tabular-nums">
                    {viewedAtoms.length.toLocaleString()}
                  </span>
                  <span className="text-[10px] font-medium text-[var(--panel-muted)]">Atoms</span>
                </div>
                <div className="flex flex-col">
                  <span className="font-mono text-[15px] font-semibold tracking-tight text-[var(--panel-text)] tabular-nums">
                    {composition.length}
                  </span>
                  <span className="text-[10px] font-medium text-[var(--panel-muted)]">Species</span>
                </div>
                <div className="flex flex-col">
                  <span className="font-mono text-[15px] font-semibold tracking-tight text-[var(--panel-text)] tabular-nums">
                    {Math.abs(cellVolume(cellVectorsFromLattice(viewedLattice))).toFixed(2)} Å³
                  </span>
                  <span className="text-[10px] font-medium text-[var(--panel-muted)]">Cell volume</span>
                </div>
              </div>

              <div className="space-y-1.5 border-t border-[var(--panel-border)]/50 pt-2">
                <div className="flex h-1.5 overflow-hidden rounded-[2px]" aria-hidden="true">
                  {composition.map(([species, count]) => (
                    <i key={species} style={{ flex: count, background: appearanceFor(species).color }} />
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  {composition.map(([species, count]) => (
                    <span key={species} className="flex items-center gap-1.5 text-[11px] tabular-nums text-[var(--panel-text)]">
                      <i className="h-2 w-2 rounded-full" style={{ background: appearanceFor(species).color }} />
                      <span className="font-medium">{species}</span>
                      <b className="font-normal text-[var(--panel-muted)]">{Number(count.toFixed(3))}</b>
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-1.5 px-0.5">
              <DataRow label="Formula" value={formula} />
              {activeMaterial?.externalId && <DataRow label="External ID" value={activeMaterial.externalId} />}
              {activeMaterial?.bandGap !== undefined && <DataRow label="MP band gap" value={`${activeMaterial.bandGap.toFixed(3)} eV`} />}
            </div>

            <div className="flex flex-col gap-2 border-t border-[var(--panel-border)] pt-2.5">
              <strong className="text-[11px] font-medium text-[var(--panel-text)]">
                Structure parameters
              </strong>
              <div className="grid h-8 grid-cols-2 rounded-[6px] border border-[var(--panel-border)] bg-[var(--panel-bg)] p-0.5">
                <button type="button" aria-pressed={crystalMode === 'simple'} onClick={() => setCrystalMode('simple')} className={cn('rounded-[4px] text-[10px] font-semibold text-[var(--panel-muted)] transition-colors hover:text-[var(--panel-text)]', crystalMode === 'simple' && 'bg-[var(--panel-selected)] text-[var(--panel-text)] shadow-sm')}>Simple</button>
                <button type="button" aria-pressed={crystalMode === 'manual'} onClick={() => setCrystalMode('manual')} className={cn('rounded-[4px] text-[10px] font-semibold text-[var(--panel-muted)] transition-colors hover:text-[var(--panel-text)]', crystalMode === 'manual' && 'bg-[var(--panel-selected)] text-[var(--panel-text)] shadow-sm')}>Manual</button>
              </div>
              {crystalMode === 'simple' ? (
                <div className="lattice-parameter-grid">
                  <div className="grid grid-cols-3 divide-x divide-[var(--panel-border)]">
                    {(['a', 'b', 'c'] as const).map((axis) => (
                      <label key={axis} className="lattice-parameter-cell">
                        <span className="font-mono text-[11px] font-semibold text-[var(--panel-muted)] shrink-0 select-none">{axis}</span>
                        <CommittedNumberInput
                          step={0.01}
                          value={Number(lattice[axis].toFixed(6))}
                          onCommit={(val) => updateLattice(axis, val)}
                          aria-label={`Lattice parameter ${axis.toUpperCase()}`}
                          className="lattice-parameter-input"
                        />
                        <span className="font-mono text-[9px] text-[var(--panel-muted)] shrink-0 select-none">Å</span>
                      </label>
                    ))}
                  </div>
                  <div className="grid grid-cols-3 divide-x divide-[var(--panel-border)] border-t border-[var(--panel-border)]">
                    {(['alpha', 'beta', 'gamma'] as const).map((axis, index) => (
                      <label key={axis} className="lattice-parameter-cell">
                        <span className="font-mono text-[11px] font-semibold text-[var(--panel-muted)] shrink-0 select-none">{['α', 'β', 'γ'][index]}</span>
                        <CommittedNumberInput
                          step={1}
                          value={Number(lattice[axis].toFixed(6))}
                          onCommit={(val) => updateLattice(axis, val)}
                          aria-label={`Lattice angle ${['alpha', 'beta', 'gamma'][index]}`}
                          className="lattice-parameter-input"
                        />
                        <span className="font-mono text-[9px] text-[var(--panel-muted)] shrink-0 select-none">°</span>
                      </label>
                    ))}
                  </div>
                </div>
              ) : (
                <CrystalStructureEditor key={activeMaterialId ?? 'no-structure'} atoms={atoms} lattice={lattice} onCellVectorsChange={updateCellVectors} onAtomChange={updateStructureAtom} onAddAtom={() => addAtomAtCenter()} onDeleteAtom={deleteAtom} />
              )}
            </div>

            <div className="border-t border-[var(--panel-border)] pt-2.5">
              <CellRepeatControl value={supercell} atomCount={viewedAtoms.length} maxAxis={8} onChange={updateDisplayedCells} />
            </div>
          </PropertySection>

          <CrystalDisplayPanel settings={{ displayStyle, atomScale, bondScale, bondCutoff, forceScale, showBonds, showCell, showLabels, showForces, supercell }} onChange={updateMaterialViewSettings} hasForces={hasForces} onExport={exportStructure} onSceneExport={(format) => void exportScene(format)} exporting={sceneExporting} />
            </div> : <div className="grid h-full place-items-center px-8 text-center"><div><Box className="mx-auto h-5 w-5 text-[var(--panel-muted)]" /><p className="mt-3 text-[11px] font-medium text-[var(--panel-text)]">No structure</p></div></div> : <CalculationPanel
              material={activeMaterialContext}
              jobs={jobs.filter((job) => job.materialId === activeMaterialId)}
              configurations={calculationConfigurations}
              components={activeCalculationComponents}
              onAddCalculation={addCalculationComponent}
              onToggleCalculation={toggleCalculationComponent}
              onReorderCalculation={reorderCalculationComponent}
              onMoveCalculation={moveCalculationComponent}
              onDuplicateCalculation={duplicateCalculationComponent}
              onDownloadInputFiles={downloadCalculationInputFiles}
              onDeleteCalculation={deleteCalculationComponent}
              onSaveSelected={addJobs}
              onRunCalculation={runCalculation}
              onRunSelected={runSelectedCalculations}
              onRunAll={runAllJobs}
              runnableCount={runnableJobCount}
              onDeleteJob={deleteJob}
              onRenameJob={(id, name) => {
                const job = jobs.find((item) => item.id === id);
                if (!job || !name.trim()) return;
                setJobs((current) => current.map((item) => item.id === id ? { ...item, name: name.trim().slice(0, 200) } : item));
                markStudyEdited(job.materialId, materials.find((item) => item.id === job.materialId)?.projectId ?? activeProjectId);
                setStatus('Result name saved');
              }}
              onCancelJob={cancelJob}
              onSaveJobPlotSettings={saveJobPlotSettings}
              onAddToFigure={openFigures}
              cloudSyncStatus={cloudSync.status}
              onImportConfiguration={importCalculationConfiguration}
              onDeleteConfiguration={deleteCalculationConfiguration}
              onConfigureCalculation={configureCalculationComponent}
              activeConfigurationId={configuringComponentId}
              onClose={() => setShowInspector(false)}
            />}
          </div>
        </aside>}
      </div>

      {operationId && (() => { const component = workflowComponents.find(c => c.id === operationId); if (!component) return null; return <WorkflowOperationDialog key={component.id} component={component} context={materialContextForComponent(component)} sources={[...projectMaterials.map(m => ({ id: structureNodeId(m.id), name: m.name })), ...workflowComponents.filter(c => c.geometry && c.id !== component.id).map(c => ({ id: c.id, name: c.name }))]} resolveSource={workflowSourceContext} onSave={next => commitWorkflow({ ...workflowDocument, components: workflowComponents.map(c => c.id === next.id ? next : c) })} onClose={() => setOperationId(null)} onAggregate={next => void aggregateSweep(next)} onElectronicSettings={next => { commitWorkflow({ ...workflowDocument, components: workflowComponents.map(c=>c.id===next.id?next:c) }); setOperationId(null); const material = materials.find(m => m.id === component.materialId); if (material) selectMaterial(material); setJobDraft(next.draft); setConfiguringComponentId(component.id); }} onSaveStructure={next => { try { const input = materialContextForComponent(next); if (!input || !next.geometry) return; const output = applyWorkflowGeometry({ ...input, cellVectors: input.cellVectors as [[number,number,number],[number,number,number],[number,number,number]] },next.geometry); const context = { ...input,...output, geometryProvenance: [...(input.geometryProvenance??[]), {nodeId:next.id,...output.provenance,mapping:output.mapping}] }; const timestamp = workspaceTimestamp(); const copy: MaterialRecord = { projectId: activeProjectId, databaseId: projectMaterials.find(m => m.id === component.materialId)!.databaseId, spaceGroup: 'P1', kind: 'Geometry output', geometryProvenance: context.geometryProvenance, id: `mat-${crypto.randomUUID()}`, name: `${component.name} output`, atoms: context.atoms.map((a,i) => ({ ...a, id: a.id ?? `atom-${i}` })), lattice: { ...latticeFromCellVectors(context.cellVectors as [[number,number,number],[number,number,number],[number,number,number]]), periodic: context.periodic }, formula: formulaFromAtoms(context.atoms), source: 'Local', createdAt: timestamp, updatedAt: timestamp, geometryUpdatedAt: timestamp }; setMaterials(current => [...current, copy]); markProjectEdited(activeProjectId); setStatus(`${copy.name} saved with ${copy.atoms.length} atoms.`); setOperationId(null); } catch(error) { setStatus(error instanceof Error ? error.message : 'Geometry failed.'); } }} />; })()}
      <CommandMenu open={commandOpen} onClose={() => setCommandOpen(false)} commands={commands} />
      <MaterialsProjectBrowser open={materialsProjectOpen} databaseName={activeProject?.name ?? 'Research project'} onClose={() => setMaterialsProjectOpen(false)} onImport={importFromMaterialsProject} />
      <ElementPalette open={elementPaletteMode !== null} title={elementPaletteMode === 'substitute' ? `Substitute ${selectedAtom?.species ?? 'atom'}` : 'Add atom'} selected={elementPaletteMode === 'substitute' ? selectedAtom?.species : undefined} onSelect={chooseElement} onClose={() => setElementPaletteMode(null)} />
      <WorkspaceConfirmDialog state={confirmation} onCancel={() => settleConfirmation(false)} onConfirm={() => settleConfirmation(true)} />


    </div>
  );
}

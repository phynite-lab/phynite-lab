'use client';
import React, { useEffect, useRef, useState } from 'react';
import { useResearchShell } from '@/components/ResearchShellContext';
import {
  ArrowUp, ArrowDown, Box,
  BarChart2,
  BarChart3,
  Eye,
  Clock3,
  Plus,
  Trash2,
  Link,
  Flame,
  GitBranch,
  Sparkles,
  Download,
  LoaderCircle,
  EyeOff,
} from 'lucide-react';
import type { FrameData, ModifierItem, ModifierType, TrajectoryInfo, TrajectoryMetrics } from '../types/trajectory';
import { RdfChart } from './RdfChart';
import { TimeSeriesChart } from './TimeSeriesChart';
import { ModifierParameters } from './ModifierParameters';
import { mdFormula, prototypeCell } from '@/lib/md-prototype-adapter';
import { downloadMdFile } from '@/lib/md-workspace';
import {
  clampRightPanelWidth,
  getDynamicRightPanelMaxWidth,
  RIGHT_PANEL_DEFAULT_WIDTH,
  RIGHT_PANEL_MIN_WIDTH,
} from '@/lib/workspace-panel';
import { cn } from '@/lib/utils';
import { LabCheckbox, LabInspectorSection, LabSlider, LabSwitch } from '@/components/LabControls';
import { UiSelect } from '@/components/UiSelect';

interface RightInspectorPanelProps {
  width?: number;
  onWidthChange?: (width: number) => void;
  sidebarWidth?: number;
  panel: 'inspect' | 'simulate'; onPanel: (panel: 'inspect' | 'simulate') => void;
  canSimulate?: boolean;
  simulationContent?: React.ReactNode;
  computeContent?: React.ReactNode;
  onPeriodicChange: (periodic: [boolean, boolean, boolean]) => void;
  extraDisplay?: React.ReactNode;
  onComputeMetrics: () => void; onCancelMetrics: () => void; metricsBusy: boolean; metricsStatus: string;
  frameData: FrameData | null;
  trajInfo: TrajectoryInfo | null;
  metrics: TrajectoryMetrics | null;
  modifiers: ModifierItem[];
  onModifiersChange: (modifiers: ModifierItem[]) => void;
  colorProperty: string;
  onColorPropertyChange: (prop: string) => void;
  colormap?: string;
  onColormapChange?: (cmap: string) => void;
  availableProperties: string[];
  hideBulkCrystal: boolean;
  onHideBulkToggle: (val: boolean) => void;
  showBonds: boolean; canAddBonds: boolean;
  onToggleBonds: (val: boolean) => void;
  showCellBox: boolean;
  onToggleCellBox: (val: boolean) => void;
  onExportGlb: () => void;
  isExportingGlb: boolean;
  onExportData?: (format: 'xyz' | 'dump' | 'cif' | 'poscar' | 'xsf' | 'png' | 'glb') => void;
  isExporting?: boolean;
  exportingFormat?: 'xyz' | 'dump' | 'cif' | 'poscar' | 'xsf' | 'png' | 'glb' | null;
  exportDisabledReason?: (format: 'xyz' | 'dump' | 'cif' | 'poscar' | 'xsf' | 'png' | 'glb') => string | undefined;
  atomScale: number;
  onAtomScaleChange: (scale: number) => void;
  currentFrame?: number;
  onSeekFrame?: (frame: number) => void;
}

const PHASE_COLORS: Record<string, string> = {
  FCC: '#38c158',
  'HCP (Stacking Fault)': '#e64040',
  BCC: '#4073e6',
  Icosahedral: '#f2bf33',
  'Other / Defect': '#8e98a5',
};

export const RightInspectorPanel: React.FC<RightInspectorPanelProps> = ({
  width,
  onWidthChange,
  frameData,
  trajInfo,
  metrics,
  modifiers,
  onModifiersChange,
  colorProperty,
  onColorPropertyChange,
  colormap = 'viridis',
  onColormapChange,
  availableProperties,
  hideBulkCrystal,
  onHideBulkToggle,
  showBonds, canAddBonds,
  onToggleBonds,
  showCellBox,
  onToggleCellBox,
  onExportData,
  isExporting = false,
  exportingFormat,
  exportDisabledReason,
  atomScale,
  onAtomScaleChange,
  currentFrame = 0,
  onSeekFrame, panel, onPanel, canSimulate = true, simulationContent, computeContent, onPeriodicChange, extraDisplay, onComputeMetrics, onCancelMetrics, metricsBusy, metricsStatus,
  sidebarWidth = 232,
}) => {
  const [isResizing, setIsResizing] = useState(false);
  const resizeCleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => resizeCleanup.current?.(), []);

  const shell = useResearchShell();
  const clampWidth = (w: number) => clampRightPanelWidth(w, shell ? 0 : sidebarWidth, shell?.contentWidth || undefined);

  const beginResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {}
    setIsResizing(true);
    const startX = event.clientX;
    const startWidth = width ?? RIGHT_PANEL_DEFAULT_WIDTH;
    const move = (moveEvent: PointerEvent) => onWidthChange?.(clampWidth(startWidth - (moveEvent.clientX - startX)));
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      resizeCleanup.current = null;
      setIsResizing(false);
    };
    resizeCleanup.current?.();
    resizeCleanup.current = stop;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  };

  const activeTab = panel, setActiveTab = onPanel;
  const [structureOpen, setStructureOpen] = useState<boolean>(true);
  const [metricsOpen, setMetricsOpen] = useState<boolean>(true);
  const [metricsSubTab, setMetricsSubTab] = useState<'distribution' | 'timeseries' | 'rdf'>('distribution');
  const [displayOpen, setDisplayOpen] = useState<boolean>(true);
  const [selectedAddType, setSelectedAddType] = useState<ModifierType>('replicate');

  const periodic = frameData?.cell.pbc ?? [false, false, false];
  const [periodicA, periodicB, periodicC] = periodic;
  const [crystalMode, setCrystalMode] = useState<'simple' | 'manual'>('simple');

  const totalParticles = frameData?.numParticles || trajInfo?.numParticles || 0;
  const phaseCounts = frameData?.phaseCounts || {};
  const attrs = frameData?.attributes || {};
  const disloc = frameData?.dislocations;
  const surface = frameData?.surface;
  const hasStrain = attrs.MaxShearStrain !== undefined;
  const clusterCount = attrs['ClusterAnalysis.cluster_count'];
  const avgCoordination = attrs.AvgCoordination;
  const totalBonds = attrs.TotalBondsCount ?? null;

  const formula = mdFormula(frameData?.speciesCounts ?? {});
  const cell = frameData ? prototypeCell(frameData) : null;
  const lenA = cell?.a ?? 0, lenB = cell?.b ?? 0, lenC = cell?.c ?? 0;

  // Modifier actions
  const toggleModifier = (index: number) => {
    const next = [...modifiers];
    next[index] = { ...next[index], enabled: !next[index].enabled };
    onModifiersChange(next);
  };

  const removeModifier = (index: number) => {
    const next = modifiers.filter((_, i) => i !== index);
    onModifiersChange(next);
  };

  const updateParam = (index: number, paramKey: string, value: ModifierItem['params'][string]) => {
    const next = [...modifiers];
    next[index] = { ...next[index], enabled: true, params: { ...next[index].params, [paramKey]: value } };
    onModifiersChange(next);
  };

  const addModifier = () => {
    const defaults: Record<ModifierType, ModifierItem['params']> = {
      wrap: {},
      supercell: { matrix: [2,0,0,0,2,0,0,0,2] },
      surface_slab: { miller: [0,0,1], layers: 4, vacuumAngstrom: 15, termination: 0 },
      replicate: { numX: 2, numY: 2, numZ: 2 },
      ptm: { rmsdCutoff: 0.12 },
      cna: { mode: 'adaptive', cutoff: 3.5 },
      dxa: { crystalStructure: 'FCC' },
      rdf: { cutoff: 6.0, bins: 100 },
      surface: { radius: 2.8 },
      expression: { expression: 'Position.Z > 14', action: 'select' },
      slice: { normal: [0, 0, 1], distance: 0, reverse: false },
      centrosymmetry: { neighbors: 12 },
      strain: { cutoff: 3.2, referenceFrame: 0 },
      cluster: { cutoff: 3.0 },
      coordination: { cutoff: 3.2 },
      bonds: { cutoff: 2.8 },
    };

    onModifiersChange([
      ...modifiers,
      { id: crypto.randomUUID(), type: selectedAddType, enabled: true, params: defaults[selectedAddType] || {} },
    ]);
  };

  // Check if replicate is currently in modifiers stack
  const replicateIdx = modifiers.findIndex((m) => m.type === 'replicate');
  const replicateMod = replicateIdx !== -1 ? modifiers[replicateIdx] : null;

  return (
    <aside className="md-inspector workspace-sidebar md-prototype-inspector relative w-full h-full bg-[var(--md-panel)] border-l border-[var(--md-border)] flex flex-col shrink-0 select-none text-xs">
      <div
        role="separator"
        aria-label="Resize properties panel"
        aria-orientation="vertical"
        aria-valuemin={RIGHT_PANEL_MIN_WIDTH}
        aria-valuemax={getDynamicRightPanelMaxWidth(shell ? 0 : sidebarWidth, shell?.contentWidth || undefined)}
        aria-valuenow={width ?? RIGHT_PANEL_DEFAULT_WIDTH}
        tabIndex={0}
        onKeyDown={event => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          onWidthChange?.(clampWidth((width ?? RIGHT_PANEL_DEFAULT_WIDTH) + (event.key === 'ArrowLeft' ? 16 : -16)));
        }}
        onPointerDown={beginResize}
        onDoubleClick={() => onWidthChange?.(RIGHT_PANEL_DEFAULT_WIDTH)}
        title={`Drag to resize (${RIGHT_PANEL_MIN_WIDTH}px – ${getDynamicRightPanelMaxWidth(shell ? 0 : sidebarWidth, shell?.contentWidth || undefined)}px) · Double click to reset`}
        className="group absolute -left-1.5 top-0 z-50 h-full w-3 cursor-col-resize touch-none outline-none"
      >
        <span
          className={cn(
            'absolute bottom-0 left-1/2 top-0 w-0.5 -translate-x-1/2 bg-transparent transition-colors',
            'group-hover:bg-[var(--md-accent)] group-focus-visible:bg-[var(--md-accent)]',
            isResizing && 'bg-[var(--md-accent)]'
          )}
        />
      </div>
      {/* Segmented Top Tab Strip */}
      <div className="workspace-tab-strip crystal-inspector-tabs relative grid h-9 shrink-0 grid-cols-2 gap-0.5 border-b border-[var(--md-border)] bg-[var(--md-panel)] p-0.5">
        <button
          type="button"
          onClick={() => setActiveTab('inspect')}
          aria-pressed={activeTab === 'inspect'}
          className={cn(
            'text-[11px] font-semibold text-[var(--md-muted)] transition-colors hover:text-[var(--md-text)]',
            activeTab === 'inspect' && 'bg-[var(--md-hover)] text-[var(--md-text)]'
          )}
        >
          Inspect
        </button>
        <button
          type="button"
          disabled={!canSimulate}
          aria-disabled={!canSimulate}
          title={!canSimulate ? 'Open a structure or trajectory first' : undefined}
          onClick={() => { if (canSimulate) setActiveTab('simulate'); }}
          aria-pressed={activeTab === 'simulate'}
          className={cn(
            'text-[11px] font-semibold text-[var(--md-muted)] transition-colors hover:text-[var(--md-text)] disabled:cursor-not-allowed disabled:opacity-40',
            activeTab === 'simulate' && 'bg-[var(--md-hover)] text-[var(--md-text)]'
          )}
        >
          Simulate
        </button>
      </div>

      {/* Main Tab Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'simulate' ? (
          simulationContent ? (
            simulationContent
          ) : (
            <div className="grid h-full min-h-[320px] place-items-center px-8 text-center">
              <div>
                <Sparkles className="mx-auto h-5 w-5 text-[var(--md-muted)]" />
                <p className="mt-3 text-[11px] font-medium text-[var(--md-text)]">Simulation Runner</p>
                <p className="mt-1 text-[9px] text-[var(--md-muted)]">Select a recipe to run MD on your connected computer.</p>
              </div>
            </div>
          )
        ) : !frameData ? (
          <div className="grid h-full min-h-[320px] place-items-center px-8 text-center">
            <div>
              <Box className="mx-auto h-5 w-5 text-[var(--md-muted)]" />
              <p className="mt-3 text-[11px] font-medium text-[var(--md-text)]">No trajectory loaded</p>
              <p className="mt-1 text-[9px] text-[var(--md-muted)]">Open a trajectory from the sidebar to inspect it or configure a simulation.</p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col">
            {/* Accordion 1: Structure */}
            <LabInspectorSection title="Structure" icon={<Box size={14} />} open={structureOpen} onOpenChange={setStructureOpen}>
                <div className="flex flex-col gap-3">
                  {/* Formula & Space group Key-Values */}
                  <div className="flex flex-col gap-1.5 pt-1 text-[11px]">
                    <div className="flex items-center justify-between">
                      <span className="text-[var(--md-muted)]">Formula</span>
                      <span className="font-mono font-bold text-[var(--md-text)]">{formula}</span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-[var(--md-muted)]">Total atoms</span>
                      <span className="font-mono text-[var(--md-text)]">{totalParticles.toLocaleString()}</span>
                    </div>
                  </div>

                  {/* Periodic directions */}
                  <div className="flex flex-col gap-1.5 pt-2 border-t border-[var(--md-border)]">
                    <span className="text-[11px] font-medium text-[var(--md-text)]">
                      Periodic directions
                    </span>
                    <div className="grid grid-cols-3 gap-2">
                      <LabCheckbox className="md-periodic-option" checked={periodicA} aria-label="Periodic a" onCheckedChange={(checked) => onPeriodicChange(periodic.map((v, i) => i === 0 ? checked : v) as [boolean, boolean, boolean])}>a</LabCheckbox>
                      <LabCheckbox className="md-periodic-option" checked={periodicB} aria-label="Periodic b" onCheckedChange={(checked) => onPeriodicChange(periodic.map((v, i) => i === 1 ? checked : v) as [boolean, boolean, boolean])}>b</LabCheckbox>
                      <LabCheckbox className="md-periodic-option" checked={periodicC} aria-label="Periodic c" onCheckedChange={(checked) => onPeriodicChange(periodic.map((v, i) => i === 2 ? checked : v) as [boolean, boolean, boolean])}>c</LabCheckbox>
                    </div>
                  </div>

                  {/* Bulk crystal / Supercell */}
                  <div className="flex flex-col gap-1.5 pt-2 border-t border-[var(--md-border)]">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-[var(--md-text)]">Bulk crystal (Supercell)</span>
                      {replicateMod && (
                        <span className="text-[10px] font-mono text-[var(--md-accent)] font-semibold">
                          {(replicateMod.params.numX ?? 2) * (replicateMod.params.numY ?? 2) * (replicateMod.params.numZ ?? 2)}×
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-[var(--md-muted)] leading-tight">
                      Choose which lattice directions repeat in the viewer and neighbor search.
                    </p>

                    {/* Simple vs Manual Toggle */}
                    <div className="grid grid-cols-2 rounded-[5px] border border-[var(--md-border)] bg-[var(--md-panel)] p-0.5 mt-1">
                      <button
                        type="button"
                        onClick={() => setCrystalMode('simple')}
                        className={`h-6 rounded-[4px] text-[10px] font-semibold transition-colors ${
                          crystalMode === 'simple'
                            ? 'bg-[var(--md-hover)] text-[var(--md-text)]'
                            : 'text-[var(--md-muted)] hover:text-[var(--md-text)]'
                        }`}
                      >
                        Simple
                      </button>
                      <button
                        type="button"
                        onClick={() => setCrystalMode('manual')}
                        className={`h-6 rounded-[4px] text-[10px] font-semibold transition-colors ${
                          crystalMode === 'manual'
                            ? 'bg-[var(--md-hover)] text-[var(--md-text)]'
                            : 'text-[var(--md-muted)] hover:text-[var(--md-text)]'
                        }`}
                      >
                        Manual
                      </button>
                    </div>

                    {/* Supercell Replicate Multiplier controls */}
                    <div className="grid grid-cols-3 gap-1.5 mt-1.5">
                      {(['numX', 'numY', 'numZ'] as const).map((axis) => {
                        const label = axis === 'numX' ? 'Nx' : axis === 'numY' ? 'Ny' : 'Nz';
                        const val = replicateMod ? (replicateMod.params[axis] ?? 2) : 1;
                        return (
                          <div
                            key={axis}
                            className="flex flex-col gap-1 bg-[var(--md-raised)] border border-[var(--md-border)] p-1.5 rounded-[5px]"
                          >
                            <span className="text-[10px] font-mono text-[var(--md-muted)] text-center font-bold">
                              {label}
                            </span>
                            <div className="flex items-center justify-between gap-1">
                              <button
                                type="button"
                                aria-label={'Decrease ' + label} disabled={val <= 1}
                                onClick={() => {
                                  if (replicateIdx !== -1) {
                                    updateParam(replicateIdx, axis, Math.max(1, val - 1));
                                  } else {
                                    onModifiersChange([
                                      ...modifiers,
                                      { type: 'replicate', enabled: true, params: { numX: 1, numY: 1, numZ: 1, [axis]: 1 } },
                                    ]);
                                  }
                                }}
                                className="w-5 h-5 bg-[var(--md-raised)] hover:bg-[var(--md-hover)] disabled:opacity-20 rounded text-center text-xs text-[var(--md-text)] font-bold"
                              >
                                -
                              </button>
                              {crystalMode === 'manual' ? <input aria-label={label + ' repeat'} type="number" min={1} max={8} step={1} value={val} onChange={e => {
                                const next = Math.max(1, Math.min(8, Math.trunc(Number(e.target.value))));
                                if (replicateIdx !== -1) updateParam(replicateIdx, axis, next);
                                else onModifiersChange([...modifiers, { id: crypto.randomUUID(), type: 'replicate', enabled: true, params: { numX: 1, numY: 1, numZ: 1, [axis]: next } }]);
                              }} /> : <span className="font-mono text-xs text-center font-semibold text-[var(--md-text)]">{val}</span>}
                              <button
                                type="button"
                                aria-label={'Increase ' + label} disabled={val >= 8 || (replicateIdx === -1 && modifiers.length >= 24)}
                                onClick={() => {
                                  if (replicateIdx !== -1) {
                                    updateParam(replicateIdx, axis, Math.min(8, val + 1));
                                  } else {
                                    onModifiersChange([
                                      ...modifiers,
                                      { type: 'replicate', enabled: true, params: { numX: 1, numY: 1, numZ: 1, [axis]: 2 } },
                                    ]);
                                  }
                                }}
                                className="w-5 h-5 bg-[var(--md-raised)] hover:bg-[var(--md-hover)] disabled:opacity-20 rounded text-center text-xs text-[var(--md-text)] font-bold"
                              >
                                +
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Lattice Parameters */}
                  <div className="flex flex-col gap-1.5 pt-2 border-t border-[var(--md-border)]">
                    <span className="text-[11px] font-medium text-[var(--md-text)]">
                      Lattice parameters
                    </span>
                    <div className="grid grid-cols-3 gap-1.5">
                      <div className="flex items-center justify-between bg-[var(--md-raised)] border border-[var(--md-border)] px-2 py-1.5 rounded-[5px]">
                        <span className="text-[10px] font-mono font-bold text-[var(--md-muted)]">a</span>
                        <span className="font-mono text-[11px] text-[var(--md-text)]">{lenA.toFixed(3)} Å</span>
                      </div>
                      <div className="flex items-center justify-between bg-[var(--md-raised)] border border-[var(--md-border)] px-2 py-1.5 rounded-[5px]">
                        <span className="text-[10px] font-mono font-bold text-[var(--md-muted)]">b</span>
                        <span className="font-mono text-[11px] text-[var(--md-text)]">{lenB.toFixed(3)} Å</span>
                      </div>
                      <div className="flex items-center justify-between bg-[var(--md-raised)] border border-[var(--md-border)] px-2 py-1.5 rounded-[5px]">
                        <span className="text-[10px] font-mono font-bold text-[var(--md-muted)]">c</span>
                        <span className="font-mono text-[11px] text-[var(--md-text)]">{lenC.toFixed(3)} Å</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5 mt-0.5">
                      <div className="flex items-center justify-between bg-[var(--md-raised)] border border-[var(--md-border)] px-2 py-1.5 rounded-[5px]">
                        <span className="text-[10px] font-mono font-bold text-[var(--md-muted)]">α</span>
                        <span className="font-mono text-[11px] text-[var(--md-text)]">{cell?.alpha.toFixed(3)} °</span>
                      </div>
                      <div className="flex items-center justify-between bg-[var(--md-raised)] border border-[var(--md-border)] px-2 py-1.5 rounded-[5px]">
                        <span className="text-[10px] font-mono font-bold text-[var(--md-muted)]">β</span>
                        <span className="font-mono text-[11px] text-[var(--md-text)]">{cell?.beta.toFixed(3)} °</span>
                      </div>
                      <div className="flex items-center justify-between bg-[var(--md-raised)] border border-[var(--md-border)] px-2 py-1.5 rounded-[5px]">
                        <span className="text-[10px] font-mono font-bold text-[var(--md-muted)]">γ</span>
                        <span className="font-mono text-[11px] text-[var(--md-text)]">{cell?.gamma.toFixed(3)} °</span>
                      </div>
                    </div>
                  </div>
                </div>
            </LabInspectorSection>

            {/* Analysis pipeline and results share one instrument section. */}
            <LabInspectorSection
              title="Analysis"
              icon={<BarChart2 size={14} />}
              open={metricsOpen}
              onOpenChange={setMetricsOpen}
              trailing={
                <span className="font-mono text-[9px] text-[var(--md-muted)]">
                  {modifiers.filter((m) => m.enabled).length} active
                </span>
              }
            >
              <div className="flex flex-col gap-2.5">
                <div className="md-inspector-subhead">Pipeline</div>
                {/* Add Modifier Form */}
                <div className="flex items-center gap-2">
                  <UiSelect
                    ariaLabel="Modifier type"
                    value={selectedAddType}
                    options={[
                      ['wrap', 'Wrap Periodic Images'],
                      ['replicate', 'Replicate (Supercell)'],
                      ['supercell', 'Supercell matrix'],
                      ['surface_slab', 'Miller surface slab'],
                      ['ptm', 'PTM (Crystal Structure)'],
                      ['cna', 'CNA (Neighbor Analysis)'],
                      ['dxa', 'DXA (Dislocations)'],
                      ['strain', 'Atomic Strain (Deformation)'],
                      ['cluster', 'Cluster Analysis'],
                      ['coordination', 'Coordination Analysis'],
                      ['bonds', 'Create Chemical Bonds'],
                      ['rdf', 'RDF (Radial Distribution)'],
                      ['surface', 'Surface & Void Mesh'],
                      ['expression', 'Expression Filter'],
                      ['slice', 'Slice Plane'],
                      ['centrosymmetry', 'Centrosymmetry'],
                    ].map(([value, label]) => ({ value, label }))}
                    onChange={(value) => setSelectedAddType(value as ModifierType)}
                  />
                  <button
                    type="button"
                    disabled={modifiers.length >= 24}
                    onClick={addModifier}
                    className="shrink-0 px-2.5 py-1.5 bg-[var(--md-accent)] text-white rounded-[5px] text-[11px] flex items-center gap-1 font-semibold transition-[filter] hover:brightness-90 disabled:opacity-40"
                  >
                    <Plus size={13} /> Add
                  </button>
                </div>

                {/* Modifiers List */}
                {modifiers.length === 0 ? (
                  <p className="text-[10px] text-[var(--md-muted)] py-2 text-center">
                    No modifiers active. Add a modifier above.
                  </p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {modifiers.map((mod, idx) => (
                      <div
                        key={mod.id ?? idx}
                        className={`border rounded-[6px] p-2 flex flex-col gap-1.5 transition-colors ${
                          mod.enabled
                            ? 'bg-[var(--md-raised)] border-[var(--md-border)]'
                            : 'bg-[var(--md-panel)] border-[var(--md-border)] opacity-50'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              aria-label={'Toggle ' + mod.type}
                              aria-pressed={mod.enabled}
                              onClick={() => toggleModifier(idx)}
                              className="text-[var(--md-muted)] hover:text-[var(--md-text)] transition-colors"
                            >
                              {mod.enabled ? <Eye size={13} /> : <EyeOff size={13} />}
                            </button>
                            <span className="text-[10px] font-semibold text-[var(--md-text)] uppercase tracking-wide">
                              {mod.type === 'wrap' && 'Wrap Periodic'}
                              {mod.type === 'supercell' && 'Supercell matrix'}
                              {mod.type === 'surface_slab' && 'Miller surface slab'}
                              {mod.type === 'replicate' && 'Replicate (Supercell)'}
                              {mod.type === 'ptm' && 'PTM (Lattice Matching)'}
                              {mod.type === 'cna' && 'CNA (Neighbor Analysis)'}
                              {mod.type === 'dxa' && 'DXA (Dislocations)'}
                              {mod.type === 'rdf' && 'RDF (Pair Correlation)'}
                              {mod.type === 'surface' && 'Surface Mesh / Voids'}
                              {mod.type === 'expression' && 'Expression Selection'}
                              {mod.type === 'slice' && 'Slice (Cutting Plane)'}
                              {mod.type === 'centrosymmetry' && 'Centrosymmetry'}
                              {mod.type === 'strain' && 'Atomic Strain'}
                              {mod.type === 'cluster' && 'Cluster Analysis'}
                              {mod.type === 'coordination' && 'Coordination'}
                              {mod.type === 'bonds' && 'Create Bonds'}
                            </span>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              aria-label={'Move ' + mod.type + ' up'}
                              disabled={idx === 0}
                              onClick={() => {
                                const next = [...modifiers];
                                [next[idx], next[idx - 1]] = [next[idx - 1], next[idx]];
                                onModifiersChange(next);
                              }}
                              className="text-[var(--md-muted)] hover:text-[var(--md-text)] disabled:opacity-30"
                            >
                              <ArrowUp size={12} />
                            </button>
                            <button
                              type="button"
                              aria-label={'Move ' + mod.type + ' down'}
                              disabled={idx === modifiers.length - 1}
                              onClick={() => {
                                const next = [...modifiers];
                                [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
                                onModifiersChange(next);
                              }}
                              className="text-[var(--md-muted)] hover:text-[var(--md-text)] disabled:opacity-30"
                            >
                              <ArrowDown size={12} />
                            </button>
                            <button
                              type="button"
                              aria-label={'Remove ' + mod.type}
                              onClick={() => removeModifier(idx)}
                              className="text-[var(--md-muted)] hover:text-[#cf5b62] transition-colors ml-1"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>

                        {mod.enabled && (
                          <ModifierParameters
                            modifier={mod}
                            total={trajInfo?.numFrames ?? 1}
                            onChange={(params) =>
                              onModifiersChange(
                                modifiers.map((item, i) => (i === idx ? { ...item, params } : item))
                              )
                            }
                          />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
                <div className="md-analysis-results flex flex-col gap-3">
                  <div className="md-inspector-subhead">Results</div>
                  {/* Sub-tab strip */}
                  <div className="md-segmented-control flex items-center gap-0.5 p-0.5">
                    {(['distribution', 'timeseries', 'rdf'] as const).map((tab) => (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => setMetricsSubTab(tab)}
                        className={`flex-1 py-1 rounded text-[10px] font-semibold transition-colors capitalize ${
                          metricsSubTab === tab
                            ? 'bg-[var(--md-hover)] text-[var(--md-accent)]'
                            : 'text-[var(--md-muted)] hover:text-[var(--md-text)]'
                        }`}
                      >
                        {tab === 'timeseries' ? 'Time Series' : tab === 'distribution' ? 'Distribution' : 'RDF'}
                      </button>
                    ))}
                  </div>

                  {metricsSubTab === 'distribution' && (
                    <>
                      {/* Property Distribution Histogram */}
                      {frameData?.scalarRange?.histogram && frameData.scalarRange.histogram.length > 0 && (() => {
                    const hist = frameData.scalarRange.histogram;
                    const maxCount = Math.max(...hist.map((b) => b.count), 1);
                    const totalHistCount = hist.reduce((acc, b) => acc + b.count, 0);

                    return (
                      <div className="md-data-block flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--md-muted)] flex items-center gap-1.5">
                            <BarChart3 size={12} className="text-[var(--md-muted)]" />
                            Property Distribution
                          </span>
                          <span className="text-[10px] font-mono text-[var(--md-text)]">
                            {frameData.scalarRange.property}
                          </span>
                        </div>

                        {/* Bars */}
                        <div className="relative h-24 w-full flex items-end justify-between gap-[2px] pt-3 pb-1 border-b border-[var(--md-border)]">
                          {hist.map((bin, i) => {
                            const heightPct = Math.max(4, (bin.count / maxCount) * 100);
                            return (
                              <div key={i} className="group relative flex-1 h-full flex items-end">
                                <div
                                  style={{
                                    height: `${heightPct}%`,
                                    backgroundColor: bin.colorHex,
                                  }}
                                  className="w-full rounded-t-[1px] opacity-90 group-hover:opacity-100 group-hover:brightness-125 transition-all"
                                />
                                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover:flex flex-col items-center pointer-events-none z-30">
                                  <div className="bg-[var(--md-raised)] border border-[var(--md-border)] text-[10px] text-[var(--md-text)] px-2 py-1 rounded shadow-lg whitespace-nowrap font-mono">
                                    <div className="font-bold text-[var(--md-text)]">
                                      {bin.count.toLocaleString()} ({((bin.count / totalHistCount) * 100).toFixed(1)}%)
                                    </div>
                                    <div className="text-[var(--md-muted)] text-[9px]">
                                      [{bin.x0.toFixed(3)}, {bin.x1.toFixed(3)}]
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {/* Axis */}
                        <div className="flex items-center justify-between text-[9px] font-mono text-[var(--md-muted)]">
                          <span>{frameData.scalarRange.min.toFixed(3)}</span>
                          <span>{frameData.scalarRange.max.toFixed(3)}</span>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Local Crystal Structure */}
                  {Object.keys(phaseCounts).length > 0 && (
                    <div className="md-data-block flex flex-col gap-2">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--md-muted)]">
                        Local Crystal Structure
                      </span>
                      {/* Stacked bar */}
                      <div className="h-2 w-full bg-[var(--md-raised)] rounded-full overflow-hidden flex">
                        {Object.entries(phaseCounts).map(([phase, count]) => {
                          const pct = (count / Math.max(1, totalParticles)) * 100;
                          const color = frameData?.phaseColors[phase] || PHASE_COLORS[phase] || '#606a78';
                          return (
                            <div
                              key={phase}
                              title={`${phase}: ${pct.toFixed(1)}%`}
                              style={{ width: `${pct}%`, backgroundColor: color }}
                              className="h-full"
                            />
                          );
                        })}
                      </div>
                      {/* Breakdown */}
                      <div className="flex flex-col gap-1 text-[11px] pt-1">
                        {Object.entries(phaseCounts).map(([phase, count]) => {
                          const pct = ((count / Math.max(1, totalParticles)) * 100).toFixed(1);
                          const color = frameData?.phaseColors[phase] || PHASE_COLORS[phase] || '#606a78';
                          return (
                            <div key={phase} className="flex items-center justify-between">
                              <div className="flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                                <span className="text-[var(--md-text)]">{phase}</span>
                              </div>
                              <span className="font-mono text-[var(--md-muted)]">
                                {count.toLocaleString()} ({pct}%)
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Chemical Composition */}
                  {frameData?.speciesCounts && Object.keys(frameData.speciesCounts).length > 0 && (
                    <div className="md-data-block flex flex-col gap-2">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--md-muted)]">
                        Chemical Composition
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {Object.entries(frameData.speciesCounts).map(([elem, count]) => {
                          const pct = ((count / Math.max(1, totalParticles)) * 100).toFixed(1);
                          return (
                            <div
                              key={elem}
                              className="flex items-center gap-1.5 bg-[var(--md-raised)] border border-[var(--md-border)] px-2 py-1 rounded-[5px]"
                            >
                              <span className="font-bold text-[var(--md-text)] font-mono text-[11px]">{elem}</span>
                              <span className="text-[var(--md-muted)] font-mono text-[10px]">
                                {count.toLocaleString()} ({pct}%)
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {clusterCount !== undefined && <div className="md-field"><span>Clusters</span><strong>{clusterCount.toLocaleString()}</strong></div>}
                  {/* Atomic Strain */}
                  {hasStrain && (
                    <div className="md-data-block flex flex-col gap-1.5">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--md-muted)] flex items-center gap-1.5">
                        <Sparkles size={12} className="text-[var(--md-muted)]" />
                        Atomic Strain (von Mises)
                      </span>
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-[var(--md-muted)]">Peak Shear:</span>
                        <span className="font-mono text-[var(--md-text)] font-semibold">
                          {typeof attrs.MaxShearStrain === 'number' ? attrs.MaxShearStrain.toFixed(4) : attrs.MaxShearStrain}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Dislocation DXA */}
                  {disloc && (
                    <div className="md-data-block flex flex-col gap-1.5">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--md-muted)] flex items-center gap-1.5">
                        <GitBranch size={12} className="text-[var(--md-muted)]" />
                        Dislocations (DXA)
                      </span>
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-[var(--md-muted)]">Line Length:</span>
                        <span className="font-mono text-[var(--md-text)]">{disloc.totalLineLength.toFixed(1)} Å</span>
                      </div>
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-[var(--md-muted)]">Density:</span>
                        <span className="font-mono text-[var(--md-text)]">{disloc.dislocationDensity.toExponential(2)} Å⁻²</span>
                      </div>
                    </div>
                  )}

                  {/* Coordination & Bonds */}
                  {(avgCoordination !== undefined || totalBonds !== null) && (
                    <div className="md-data-block flex flex-col gap-1.5">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--md-muted)] flex items-center gap-1.5">
                        <Link size={12} className="text-[var(--md-accent)]" />
                        Coordination & Bonds
                      </span>
                      {avgCoordination !== undefined && (
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-[var(--md-muted)]">Avg CN:</span>
                          <span className="font-mono text-[var(--md-text)] font-semibold">
                            {typeof avgCoordination === 'number' ? avgCoordination.toFixed(2) : avgCoordination}
                          </span>
                        </div>
                      )}
                      {totalBonds !== null && (
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-[var(--md-muted)]">Bonds:</span>
                          <span className="font-mono text-[var(--md-text)]">{totalBonds.toLocaleString()}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Surface & Void Topology */}
                  {surface && (
                    <div className="md-data-block flex flex-col gap-1.5">
                      <span className="text-[11px] font-medium text-[var(--md-text)]">
                        Surface & void topology
                      </span>
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-[var(--md-muted)]">Area:</span>
                        <span className="font-mono text-[var(--md-text)]">{Number.isFinite(surface.surfaceArea) ? surface.surfaceArea.toFixed(1) : '—'} Å²</span>
                      </div>
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-[var(--md-muted)]">Volume:</span>
                        <span className="font-mono text-[var(--md-text)]">{Number.isFinite(surface.solidVolume) ? surface.solidVolume.toFixed(1) : '—'} Å³</span>
                      </div>
                    </div>
                  )}

                    </>
                  )}

                  {metricsSubTab === 'timeseries' && (
                    <>{computeContent}<div className="md-prototype-metrics-actions"><button className="md-button" disabled={metricsBusy || (frameData?.totalFrames ?? 0) < 2} onClick={onComputeMetrics}>Compute all frames</button>{metricsBusy && <button className="md-button" onClick={onCancelMetrics}>Cancel</button>}<span role="status">{metricsStatus}</span></div><TimeSeriesChart
                      metrics={metrics}
                      currentFrame={currentFrame}
                      onSeekFrame={onSeekFrame}
                    /><button className="md-text-button" disabled={!metrics?.timeline.length} onClick={() => downloadMdFile('trajectory-metrics.csv', 'frame,mean_source_c_pe,FCC_percent,dislocation_density_A-2\n' + (metrics?.timeline ?? []).map(t => [t.frame, t.avgPotentialEnergy ?? '', t.phases.FCC ?? '', t.dislocationDensity ?? ''].join(',')).join('\n'))}>Export time series CSV</button></>
                  )}

                  {metricsSubTab === 'rdf' && (
                    <div className="flex flex-col gap-2">
                      {frameData?.rdf && frameData.rdf.length > 0 ? (
                        <><RdfChart rdfData={frameData.rdf} /><button className="md-text-button" onClick={() => downloadMdFile('rdf-frame-' + (currentFrame + 1) + '.csv', 'r_A,g_r\n' + frameData.rdf!.map(p => p.r + ',' + p.g_r).join('\n'))}>Export RDF CSV</button></>
                      ) : (
                        <div className="md-empty-note text-center text-[11px] text-[var(--md-muted)]">
                          Radial distribution function (RDF) is not computed for this frame.
                        </div>
                      )}
                    </div>
                  )}
                </div>
            </LabInspectorSection>

            {/* Accordion 3: Display Settings */}
            <LabInspectorSection title="Display" icon={<Eye size={14} />} open={displayOpen} onOpenChange={setDisplayOpen}>
                <div className="flex flex-col gap-2.5">
                  {/* Color Coding Property */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[11px] font-medium text-[var(--md-text)]">
                      Color coding property
                    </label>
                    <UiSelect ariaLabel="Color by" value={colorProperty} options={availableProperties.map(property => ({ value: property, label: property === 'Species' ? 'Particle Type / Species' : property }))} onChange={onColorPropertyChange} />
                  </div>

                  {/* Colormap Selector */}
                  {colorProperty !== 'Structure Type' && colorProperty !== 'Species' && onColormapChange && (
                    <div className="flex items-center justify-between pt-1 text-[11px]">
                      <span className="text-[var(--md-muted)] flex items-center gap-1">
                        <Flame size={12} className="text-[var(--md-muted)]" />
                        Palette:
                      </span>
                      <UiSelect ariaLabel="Color map" compact value={colormap} options={[['viridis', 'Viridis (Scientific)'], ['coolwarm', 'Coolwarm (Blue-Red)'], ['turbo', 'Turbo (Rainbow)'], ['jet', 'Jet (Spectrum)']].map(([value, label]) => ({ value, label }))} onChange={onColormapChange} />
                    </div>
                  )}

                  {/* Atom Radius Scale Slider */}
                  <div className="flex flex-col gap-1 pt-1.5 border-t border-[var(--md-border)]">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-[var(--md-muted)]">Atom radius scale:</span>
                      <span className="font-mono text-[var(--md-text)] font-semibold">{atomScale.toFixed(2)}×</span>
                    </div>
                    <LabSlider
                      aria-label="Atom radius"
                      min="0.2"
                      max="2"
                      step="0.05"
                      value={atomScale}
                      onValueChange={onAtomScaleChange}
                    />
                  </div>

                  {/* Display Toggles */}
                  <div className="flex flex-col gap-2 pt-2 border-t border-[var(--md-border)]">
                    <LabSwitch disabled={!canAddBonds} checked={showBonds} onCheckedChange={onToggleBonds}>Chemical bonds</LabSwitch>
                    {!canAddBonds
                      ? <p className="md-control-help">Remove a modifier before adding bonds; the pipeline is limited to 24 steps.</p>
                      : !showBonds && <p className="md-control-help">Turning this on adds a neighbor-bond modifier to the analysis pipeline.</p>}
                    <LabSwitch checked={showCellBox} onCheckedChange={onToggleCellBox}>Unit cell box</LabSwitch>
                    <LabSwitch disabled={!Object.keys(frameData?.phaseCounts ?? {}).length} checked={hideBulkCrystal && !!Object.keys(frameData?.phaseCounts ?? {}).length} onCheckedChange={onHideBulkToggle}>Hide dominant crystal phase</LabSwitch>
                  </div>
                </div>
            </LabInspectorSection>
            {onExportData && (
              <LabInspectorSection title="Export" icon={<Download size={14} />} trailing={<span className="font-mono text-[9px]">Frame {(currentFrame ?? 0) + 1}</span>}>
                <div className="grid grid-cols-2 gap-1.5">
                  {(['cif', 'poscar', 'xyz', 'dump', 'xsf', 'png', 'glb'] as const).map((format) => {
                    const disabledReason = exportDisabledReason?.(format);
                    const active = exportingFormat === format;
                    const stateLabel = active
                      ? 'Preparing…'
                      : disabledReason
                        ? disabledReason
                        : isExporting
                          ? 'Waiting'
                          : 'Ready';
                    return <button
                      key={format}
                      type="button"
                      disabled={isExporting || !!disabledReason}
                      aria-busy={active || undefined}
                      aria-label={`${({ cif: 'CIF Crystal', poscar: 'VASP POSCAR', xyz: 'XYZ Coords', dump: 'LAMMPS Frame', xsf: 'XSF Structure', png: 'PNG Snapshot', glb: 'GLB 3D Scene' })[format]}. ${stateLabel}`}
                      data-active={active || undefined}
                      onClick={() => onExportData(format)}
                      className="flex min-h-12 items-center justify-between gap-2 rounded-[5px] border border-[var(--md-border)] bg-[var(--md-panel)] px-2 py-1.5 text-left text-[11px] font-medium text-[var(--md-text)] transition-colors hover:bg-[var(--md-hover)] disabled:opacity-50"
                    >
                      <span className="min-w-0"><span className="block truncate">{({ cif: 'CIF Crystal', poscar: 'VASP POSCAR', xyz: 'XYZ Coords', dump: 'LAMMPS Frame', xsf: 'XSF Structure', png: 'PNG Snapshot', glb: 'GLB 3D Scene' })[format]}</span><small className="mt-0.5 block truncate text-[8px] font-normal text-[var(--md-muted)]">{stateLabel}</small></span>
                      <small className="grid h-3.5 w-8 shrink-0 place-items-center font-mono text-[9px] uppercase text-[var(--md-muted)]">{active ? <LoaderCircle className="md-spin" size={12} /> : format}</small>
                    </button>
                  })}
                </div>
                <p className="md-control-help" role="status">{exportingFormat ? `Preparing ${exportingFormat.toUpperCase()} for frame ${(currentFrame ?? 0) + 1}…` : 'Exports use the current processed frame and its simulation cell.'}</p>
              </LabInspectorSection>
            )}
            {extraDisplay && <LabInspectorSection title="Trajectory" icon={<Clock3 size={14} />}>{extraDisplay}</LabInspectorSection>}
          </div>
        )}
      </div>
    </aside>
  );
};

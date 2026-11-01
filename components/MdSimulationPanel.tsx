'use client';

import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Check,
  CheckCircle2,
  CircleStop,
  Clock3,
  Copy,
  Download,
  FileCode2,
  FileText,
  GripVertical,
  History,
  Library,
  ListChecks,
  LoaderCircle,
  MoreHorizontal,
  Play,
  Plus,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ComputeJobReceipt } from '@/components/ComputeJobReceipt';
import { LabComputeDestination } from '@/components/ComputeDestination';
import { LabCheckbox } from '@/components/LabControls';
import { MdSimulationConfigDrawer } from '@/components/MdSimulationConfigDrawer';
import { MdRunEvidence } from '@/components/MdRunEvidence';
import {
  MD_SIMULATION_RECIPES,
  generateMdStepInputPreview,
  validateMdSimulationConfig,
  type MdPotentialAsset,
  type MdSimulationComponentInstance,
  type MdSimulationConfig,
  type MdSimulationConfiguration,
  type MdSimulationRecipeId,
  type MdWorkflowStepKind,
} from '@/lib/md-simulation-types';
import { downloadMdFile } from '@/lib/md-workspace';
import type { MdRuntimeManifest, MdSimulationRun, PhyniteComputeStatus } from '@/lib/phynite-api';
import { cn } from '@/lib/utils';

export type MdSimulationSubTab = 'setup' | 'runs' | 'library';

interface MdSimulationPanelProps {
  activeStructureName?: string;
  formula?: string;
  totalAtoms?: number;
  projectName?: string;
  components: MdSimulationComponentInstance[];
  onAddSimulation: (recipeId: MdSimulationRecipeId) => void;
  onToggleSimulation: (id: string) => void;
  onDeleteSimulation: (id: string) => void;
  onDuplicateSimulation?: (id: string) => void;
  onReorderSimulation?: (sourceId: string, targetId: string) => void;
  onMoveSimulation?: (id: string, direction: -1 | 1) => void;
  onConfigureSimulation: (id: string) => void;
  onChangeConfiguration: (id: string, patch: Partial<MdSimulationConfig>) => void;
  activeConfigurationId?: string | null;
  jobs: MdSimulationRun[];
  onRunSimulation: (componentId: string) => void;
  onRunSelected: () => void;
  onRunAll: () => void;
  onCancelSimulation?: (jobId: string) => void;
  onOpenResultTrajectory?: (job: MdSimulationRun) => void;
  potentialAssets?: MdPotentialAsset[];
  mappedElements?: string[];
  onUploadPotential?: (files: File[]) => void;
  onDeletePotential?: (assetId: string) => void;
  configurations?: MdSimulationConfiguration[];
  onSaveConfiguration?: (componentId?: string) => void;
  onLoadConfiguration?: (configuration: MdSimulationConfiguration) => void;
  onDeleteConfiguration?: (configurationId: string) => void;
  computeStatus?: PhyniteComputeStatus['compute'] | null;
  runtimeManifest?: MdRuntimeManifest | null;
  busyAction?: string;
  runDisabledReason?: string;
  getStepDisabledReason?: (component: MdSimulationComponentInstance) => string;
  onClose?: () => void;
  onStudyEvidence?: () => void;
}

const finalStatuses = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

function StatusIcon({ status }: { status: MdSimulationRun['status'] }) {
  if (status === 'COMPLETED') return <CheckCircle2 className="text-[var(--success)]" />;
  if (status === 'FAILED') return <AlertCircle className="text-[var(--danger)]" />;
  if (status === 'RUNNING' || status === 'CANCEL_REQUESTED') return <LoaderCircle className="animate-spin text-[var(--panel-accent)]" />;
  return <Clock3 className="text-[var(--panel-muted)]" />;
}

function stepSummary(component: MdSimulationComponentInstance) {
  const { config } = component;
  if (component.recipeId === 'minimization') return `${(config.maxIterations ?? 10_000).toLocaleString()} iterations · ${config.minimizeStyle ?? 'cg'}`;
  if (component.recipeId === 'velocity') return `${config.tempStartK.toLocaleString()} K · seed ${config.velocitySeed}`;
  if (component.recipeId === 'restart') return `${config.restartLabel ?? 'checkpoint'}.restart`;
  return `${config.totalSteps.toLocaleString()} steps · ${config.timestepFs} fs · ${config.tempStartK.toLocaleString()} K`;
}

function WorkflowRowMenu({ component, index, count, onConfigure, onDuplicate, onMove, onDelete }: {
  component: MdSimulationComponentInstance;
  index: number;
  count: number;
  onConfigure: () => void;
  onDuplicate?: () => void;
  onMove?: (direction: -1 | 1) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', keydown); };
  }, [open]);
  const input = generateMdStepInputPreview(component.config);
  return <div ref={ref} className="md-sim-row-menu-wrap">
    <button type="button" className="workspace-item-action lab-icon-button md-sim-row-menu-trigger" aria-label={`Actions for ${component.name}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(value => !value)}><MoreHorizontal size={15} /></button>
    {open && <div className="md-sim-row-menu" role="menu">
      <button type="button" role="menuitem" onClick={() => { onConfigure(); setOpen(false); }}><Settings2 size={13} /> Configure</button>
      <button type="button" role="menuitem" onClick={() => { onDuplicate?.(); setOpen(false); }} disabled={!onDuplicate}><Copy size={13} /> Duplicate</button>
      <button type="button" role="menuitem" onClick={() => { downloadMdFile(`${component.name.replace(/[^A-Za-z0-9._-]+/g, '-') || 'step'}.in`, input); setOpen(false); }}><Download size={13} /> Download input</button>
      <button type="button" role="menuitem" onClick={() => { onMove?.(-1); setOpen(false); }} disabled={!onMove || index === 0}><ArrowUp size={13} /> Move up</button>
      <button type="button" role="menuitem" onClick={() => { onMove?.(1); setOpen(false); }} disabled={!onMove || index === count - 1}><ArrowDown size={13} /> Move down</button>
      <button type="button" role="menuitem" className="is-danger" onClick={() => { onDelete(); setOpen(false); }}><Trash2 size={13} /> Delete</button>
    </div>}
  </div>;
}

interface CatalogCategoryItem {
  id: string;
  label: string;
  recipeIds?: readonly MdSimulationRecipeId[];
}

const POPULAR_RECIPE_IDS: readonly MdSimulationRecipeId[] = [
  'minimization',
  'nvt',
  'npt',
  'tensile',
  'heating',
  'rdf',
  'diffusion',
] as const;

const CATALOG_CATEGORIES: readonly CatalogCategoryItem[] = [
  { id: 'all', label: 'All calculations' },
  { id: 'popular', label: 'Popular', recipeIds: POPULAR_RECIPE_IDS },
  { id: 'preparation', label: 'Preparation', recipeIds: ['minimization', 'velocity', 'restart'] },
  { id: 'dynamics', label: 'Dynamics & Ensembles', recipeIds: ['nvt', 'npt', 'nve', 'nph', 'langevin', 'temp-berendsen', 'press-berendsen'] },
  { id: 'mechanical', label: 'Mechanical & Loading', recipeIds: ['tensile', 'compression', 'shear', 'pressure-ramp'] },
  { id: 'thermal', label: 'Thermal Processing', recipeIds: ['heating', 'cooling', 'annealing'] },
  { id: 'analysis', label: 'Structure & Analysis', recipeIds: ['diffusion', 'rdf', 'vacf', 'coordination', 'cna', 'centrosymmetry', 'voronoi', 'stress-atom', 'pe-atom', 'ke-atom'] },
  { id: 'custom', label: 'Custom' },
] as const;

const CUSTOM_RECIPE_ITEM = {
  id: 'custom' as const,
  name: 'Custom simulation step',
  label: 'Custom simulation step',
  code: 'custom · UI builder',
  detail: 'Configure ensemble, thermostat, and output parameters in UI',
  category: 'custom' as const,
  keywords: ['custom', 'script', 'manual', 'parameters', 'nvt', 'ensemble', 'thermostat'],
  icon: Terminal,
};

function RecipePicker({
  open,
  runtimeManifest,
  onOpenChange,
  onAdd,
}: {
  open: boolean;
  runtimeManifest?: MdRuntimeManifest | null;
  onOpenChange: (open: boolean) => void;
  onAdd: (recipeId: MdSimulationRecipeId) => void;
}) {
  const [portalTarget, setPortalTarget] = useState<Element | null>(null);
  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [activeIndex, setActiveIndex] = useState(0);
  const modalRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const updateTarget = () => {
      if (typeof document === 'undefined') return;
      const isMobile = window.innerWidth < 1024;
      const target = document.querySelector(isMobile ? '.md-studio' : '.md-studio .md-canvas-stage') ?? document.body;
      setPortalTarget(target);
    };
    updateTarget();
    window.addEventListener('resize', updateTarget);
    return () => window.removeEventListener('resize', updateTarget);
  }, []);

  const unavailableReason = (item: (typeof MD_SIMULATION_RECIPES)[number] | typeof CUSTOM_RECIPE_ITEM) => {
    if (item.id === 'custom') return '';
    if (!runtimeManifest) return '';
    if (!runtimeManifest.stepKinds.includes(item.id as MdWorkflowStepKind)) {
      return 'Connected runtime does not support this step.';
    }
    const recipe = item as (typeof MD_SIMULATION_RECIPES)[number];
    const missing = (recipe.requiredPackages ?? []).filter((name) => !runtimeManifest.runtime?.packages.includes(name));
    return missing.length ? `Requires LAMMPS package ${missing.join(', ')}` : '';
  };

  const catalogRecipes = useMemo(
    () => MD_SIMULATION_RECIPES.filter((recipe) => recipe.catalog !== false),
    [],
  );

  const displayedList = useMemo(() => {
    let list: Array<(typeof MD_SIMULATION_RECIPES)[number] | typeof CUSTOM_RECIPE_ITEM> = [];

    if (selectedCategory === 'all') {
      list = [...catalogRecipes, CUSTOM_RECIPE_ITEM];
    } else if (selectedCategory === 'custom') {
      list = [CUSTOM_RECIPE_ITEM];
    } else {
      const cat = CATALOG_CATEGORIES.find((c) => c.id === selectedCategory);
      if (cat?.recipeIds) {
        list = cat.recipeIds
          .map((id) => catalogRecipes.find((r) => r.id === id))
          .filter((r): r is (typeof MD_SIMULATION_RECIPES)[number] => Boolean(r));
      }
    }

    if (!query.trim()) return list;

    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return list.filter((item) => {
      const searchableText = [
        item.label,
        item.name,
        item.code,
        item.detail,
        item.category,
        ...item.keywords,
      ].join(' ').toLowerCase();
      return words.every((w) => searchableText.includes(w));
    });
  }, [catalogRecipes, selectedCategory, query]);

  const getCategoryCount = (catId: string) => {
    const matchesItem = (item: (typeof MD_SIMULATION_RECIPES)[number] | typeof CUSTOM_RECIPE_ITEM) => {
      if (!query.trim()) return true;
      const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
      const searchableText = [
        item.label,
        item.name,
        item.code,
        item.detail,
        item.category,
        ...item.keywords,
      ].join(' ').toLowerCase();
      return words.every((w) => searchableText.includes(w));
    };

    if (catId === 'all') {
      return (matchesItem(CUSTOM_RECIPE_ITEM) ? 1 : 0) + catalogRecipes.filter(matchesItem).length;
    }
    if (catId === 'custom') {
      return matchesItem(CUSTOM_RECIPE_ITEM) ? 1 : 0;
    }
    const cat = CATALOG_CATEGORIES.find((c) => c.id === catId);
    if (!cat?.recipeIds) return 0;
    const catRecipes = cat.recipeIds
      .map((id) => catalogRecipes.find((r) => r.id === id))
      .filter((r): r is (typeof MD_SIMULATION_RECIPES)[number] => Boolean(r));
    return catRecipes.filter(matchesItem).length;
  };

  const handleSelectItem = (item: (typeof MD_SIMULATION_RECIPES)[number] | typeof CUSTOM_RECIPE_ITEM) => {
    if (unavailableReason(item)) return;
    if (item.id === 'custom') {
      onAdd('nvt');
    } else {
      onAdd(item.id as MdSimulationRecipeId);
    }
    onOpenChange(false);
    setQuery('');
  };

  useEffect(() => {
    if (!open) return;
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 0);

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (modalRef.current && !modalRef.current.contains(target as Node) && !target?.closest('.md-sim-add-btn')) {
        onOpenChange(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onOpenChange(false);
      } else if (event.key === 'Tab' && modalRef.current) {
        const focusable = Array.from(modalRef.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'
        ));
        const first = focusable[0];
        const last = focusable.at(-1);
        if (first && last && event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (first && last && !event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onOpenChange]);

  if (!open || !portalTarget) return null;

  const activeCategory = CATALOG_CATEGORIES.find((category) => category.id === selectedCategory);

  return createPortal(
    <div className="lab-config-drawer-layer">
      <button
        type="button"
        className="lab-config-drawer-backdrop"
        aria-label="Close add calculation"
        onClick={() => onOpenChange(false)}
      />
      <section
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="md-catalog-title"
        className="md-catalog-dialog workspace-dark-surface"
      >
        <header className="md-catalog-header">
          <div className="md-catalog-heading">
            <h2 id="md-catalog-title">Add calculation</h2>
            <p>Browse supported LAMMPS recipes and add one to the active workflow.</p>
          </div>
          <button
            type="button"
            className="md-catalog-close"
            onClick={() => onOpenChange(false)}
            aria-label="Close add calculation"
          >
            <X size={16} />
          </button>
        </header>

        <div className="md-catalog-search">
          <Search aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            placeholder="Search recipes by name, ensemble, or command"
            aria-label="Filter calculation steps"
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                onOpenChange(false);
              } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                setActiveIndex((index) =>
                  Math.max(0, Math.min(displayedList.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))
                );
              } else if (event.key === 'Enter') {
                const item = displayedList[activeIndex];
                if (item) {
                  event.preventDefault();
                  handleSelectItem(item);
                }
              }
            }}
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                inputRef.current?.focus();
              }}
              aria-label="Clear filter"
              className="md-catalog-search-clear"
            >
              <X size={13} />
            </button>
          )}
          <span className="md-catalog-search-hint">Try nvt, tensile, rdf</span>
        </div>

        <div className="md-catalog-layout">
          <nav
            className="md-catalog-nav"
            aria-label="Calculation categories"
          >
            <div className="md-catalog-nav-heading">
              <span>Browse</span>
              <small>{getCategoryCount('all')} recipes</small>
            </div>
            {CATALOG_CATEGORIES.map((cat) => {
              const isSelected = selectedCategory === cat.id;
              const count = getCategoryCount(cat.id);
              return (
                <Fragment key={cat.id}>
                  {cat.id === 'custom' && (
                    <div className="md-catalog-nav-separator" role="separator" />
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCategory(cat.id);
                      setActiveIndex(0);
                    }}
                    aria-pressed={isSelected}
                    className={cn(
                      'md-catalog-category',
                      isSelected && 'is-selected'
                    )}
                  >
                    <span>{cat.label}</span>
                    <span className="md-catalog-count">{count}</span>
                  </button>
                </Fragment>
              );
            })}
          </nav>

          <div className="md-catalog-results">
            <div className="md-catalog-results-heading">
              <div>
                <span>{activeCategory?.label ?? 'Calculations'}</span>
                <p>{query ? `Results for “${query}”` : 'Choose a recipe to add as the next workflow step.'}</p>
              </div>
              <strong>{displayedList.length} {displayedList.length === 1 ? 'recipe' : 'recipes'}</strong>
            </div>
            <div className="md-catalog-grid">
              {displayedList.map((item, index) => {
                const reason = unavailableReason(item);
                const isHighlighted = index === activeIndex;
                const RecipeIcon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    disabled={!!reason}
                    aria-disabled={!!reason}
                    data-highlighted={isHighlighted || undefined}
                    onPointerMove={() => setActiveIndex(index)}
                    onClick={() => handleSelectItem(item)}
                    className={cn(
                      'md-catalog-row',
                      isHighlighted && 'is-highlighted',
                      reason && 'is-unavailable'
                    )}
                  >
                    <span className="md-catalog-recipe-icon" aria-hidden="true"><RecipeIcon size={17} /></span>
                    <span className="md-catalog-recipe-copy">
                      <span className="md-catalog-recipe-title">
                        <strong>{item.label}</strong>
                        {item.id === 'custom' && <em>Custom</em>}
                      </span>
                      <span className={cn('md-catalog-recipe-detail', reason && 'is-error')}>
                        {reason || item.detail}
                      </span>
                    </span>
                    <span className="md-catalog-recipe-meta">
                      <code>{item.code}</code>
                      <span><Plus size={12} /> Add</span>
                    </span>
                  </button>
                );
              })}
              {!displayedList.length && (
                <div className="md-catalog-empty">
                  <Search size={18} aria-hidden="true" />
                  <p>No calculations match &ldquo;{query}&rdquo; in this category.</p>
                  {query && (
                    <button
                      type="button"
                      onClick={() => {
                        setQuery('');
                        setSelectedCategory('all');
                        inputRef.current?.focus();
                      }}
                    >
                      Reset filters
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>,
    portalTarget
  );
}

function JobRunItem({
  job,
  onOpenResultTrajectory,
  onCancelSimulation,
}: {
  job: MdSimulationRun;
  onOpenResultTrajectory?: (job: MdSimulationRun) => void;
  onCancelSimulation?: (jobId: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const copyLog = () => {
    if (!job.logTail) return;
    navigator.clipboard.writeText(job.logTail).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const isFinal = finalStatuses.has(job.status);

  return (
    <article className="md-sim-run">
      <div className="md-sim-run-head">
        <StatusIcon status={job.status} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <strong>{job.name}</strong>
            <span className="md-sim-job-recipe-tag">{job.recipeId}</span>
          </div>
          <span className="md-sim-job-status-sub">{job.status.replaceAll('_', ' ').toLowerCase()}</span>
        </div>
        <code className="tabular-nums">{job.progress}%</code>
      </div>
      {!isFinal && (
        <div className="md-sim-progress">
          <i style={{ width: `${job.progress}%` }} />
        </div>
      )}
      <ComputeJobReceipt job={job} />
      <p className="md-sim-status-message">{job.failureReason || job.statusMessage || 'Waiting for runtime status.'}</p>
      {['COMPLETED', 'FAILED', 'CANCELLED'].includes(job.status) && <MdRunEvidence job={job} />}
      {job.logTail && (
        <div className="md-sim-terminal-log">
          <div className="md-sim-terminal-head">
            <span className="flex items-center gap-1">
              <Terminal size={11} />
              <code>log.lammps · stdout</code>
            </span>
            <button type="button" onClick={copyLog} className="md-sim-terminal-copy" title="Copy log">
              {copied ? <Check size={11} /> : <Copy size={11} />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
          </div>
          <pre className="md-sim-terminal-body">{job.logTail}</pre>
        </div>
      )}
      <div className="md-sim-run-actions">
        {job.status === 'COMPLETED' && job.resultTrajectoryId && onOpenResultTrajectory && (
          <button type="button" className="lab-secondary-button" onClick={() => onOpenResultTrajectory(job)}>
            <Play size={13} /> Open trajectory
          </button>
        )}
        {!isFinal && onCancelSimulation && (
          <button type="button" className="lab-secondary-button" onClick={() => onCancelSimulation(job.id)}>
            <CircleStop size={13} /> Cancel
          </button>
        )}
      </div>
    </article>
  );
}

export function MdSimulationPanel({
  activeStructureName = 'No trajectory selected', formula = '—', totalAtoms = 0, projectName = 'Project',
  components, onAddSimulation, onToggleSimulation, onDeleteSimulation, onDuplicateSimulation,
  onReorderSimulation, onMoveSimulation, onConfigureSimulation, onChangeConfiguration,
  activeConfigurationId, jobs, onRunSimulation, onRunSelected, onRunAll, onCancelSimulation,
  onOpenResultTrajectory, potentialAssets = [], mappedElements = [], onUploadPotential, onDeletePotential,
  configurations = [], onSaveConfiguration, onLoadConfiguration, onDeleteConfiguration,
  computeStatus, runtimeManifest, busyAction, runDisabledReason, getStepDisabledReason, onClose, onStudyEvidence,
}: MdSimulationPanelProps) {
  const [tab, setTab] = useState<MdSimulationSubTab>('setup');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [libraryQuery, setLibraryQuery] = useState('');
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const selectedCount = components.filter(component => component.selected).length;
  const activeConfig = components.find(component => component.id === activeConfigurationId) ?? null;
  const activeRuns = jobs.filter(job => !finalStatuses.has(job.status)).length;
  const sortedJobs = useMemo(() => [...jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [jobs]);
  const configurationErrors = useMemo(() => new Map(components.map(component => [component.id, validateMdSimulationConfig(component.config)])), [components]);
  const selectedConfigurationError = components.filter(component => component.selected).map(component => configurationErrors.get(component.id)).find(Boolean);
  const anyConfigurationError = components.map(component => configurationErrors.get(component.id)).find(Boolean);
  const runtimeReady = computeStatus?.status === 'connected' && computeStatus.capabilities?.includes('md-simulation');
  const q = libraryQuery.trim().toLowerCase();
  const visibleConfigurations = configurations.filter(item => !q || `${item.name} ${item.workflow.steps.map(step => `${step.name} ${step.kind}`).join(' ')}`.toLowerCase().includes(q));
  const visiblePotentials = potentialAssets.filter(item => !q || `${item.name} ${item.family} ${item.elements.join(' ')} ${item.files.map(file => file.filename).join(' ')} ${item.citation ?? ''}`.toLowerCase().includes(q));

  return <>
    <div className="md-simulation-panel">
      <header className="md-sim-context">
        <code className="md-sim-context-formula">{formula}</code>
        <div><strong>{activeStructureName}</strong><span>{projectName} · {totalAtoms.toLocaleString()} atoms</span></div>
        <span className={cn('md-sim-compute-state', runtimeReady && 'is-connected')}><i />{runtimeReady ? 'Compute connected' : computeStatus?.status === 'connected' ? 'Update required' : 'Compute offline'}</span>
        {onClose && <button type="button" className="lab-icon-button md-sim-close" onClick={onClose} aria-label="Close simulate panel"><X size={15} /></button>}
      </header>
      <nav className="workspace-tab-strip md-sim-tabs" aria-label="Simulation panel">
        {([
          { id: 'setup', label: 'Setup', icon: ListChecks },
          { id: 'runs', label: 'Runs', icon: History },
          { id: 'library', label: 'Library', icon: Library },
        ] as const).map(item => {
          const Icon = item.icon;
          return <button key={item.id} type="button" aria-pressed={tab === item.id} onClick={() => { setPickerOpen(false); setTab(item.id); }}><Icon aria-hidden="true" /><span>{item.label}</span>{item.id === 'runs' && jobs.length > 0 && <small>{jobs.length}</small>}</button>;
        })}
      </nav>
      <div className="md-sim-scroll">
        {onStudyEvidence && <button type="button" className="md-text-button m-3" onClick={onStudyEvidence}>Study evidence</button>}
        {tab === 'setup' && <>
          <LabComputeDestination requiredCapability="md-simulation" status={computeStatus} ariaLabel="MD compute destination" />
          <section className="md-sim-section md-sim-workflow">
            <div className="md-sim-section-heading md-sim-workflow-heading">
              <div>
                <strong title="Selected steps compile in this order into one local job.">LAMMPS workflow</strong>
                <span>{components.length} steps · {selectedCount} selected</span>
              </div>
              <div className="md-sim-heading-actions">
                <button
                  type="button"
                  className="md-sim-add-btn"
                  aria-expanded={pickerOpen}
                  onClick={(event) => {
                    event.stopPropagation();
                    setPickerOpen((prev) => !prev);
                  }}
                >
                  <Plus aria-hidden="true" />
                  Add calculation
                </button>
                <button type="button" className="workspace-primary-action md-sim-run-all" disabled={!components.length || !!runDisabledReason || !!anyConfigurationError || !!busyAction} onClick={onRunAll}>
                  {busyAction ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Play aria-hidden="true" />}
                  Run all <span>{components.length}</span>
                </button>
              </div>
            </div>
            {components.length === 0 ? (
              <div className="md-sim-empty">
                <Settings2 size={20} />
                <strong>No workflow steps</strong>
                <span>Add a calculation, then configure it in Simple or Advanced.</span>
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  className="mt-2 flex items-center gap-1.5 rounded-[6px] border border-[var(--panel-border)] bg-[var(--panel-raised)] px-2.5 py-1 text-[10px] font-medium text-[var(--panel-text)] hover:bg-[var(--panel-hover)]"
                >
                  <Plus className="h-3 w-3" /> Add calculation
                </button>
              </div>
            ) : (
              <div className="md-sim-list">
                {components.map((component, index) => {
                  const recipe = MD_SIMULATION_RECIPES.find(item => item.id === component.recipeId) ?? MD_SIMULATION_RECIPES[0];
                  const configurationError = configurationErrors.get(component.id);
                  const stepDisabledReason = getStepDisabledReason?.(component) ?? runDisabledReason;
                  return (
                    <article
                      key={component.id}
                      draggable
                      onDragStart={event => { setDraggedId(component.id); event.dataTransfer.effectAllowed = 'move'; }}
                      onDragEnd={() => setDraggedId(null)}
                      onDragOver={event => { if (draggedId && draggedId !== component.id) event.preventDefault(); }}
                      onDrop={event => { event.preventDefault(); if (draggedId && draggedId !== component.id) onReorderSimulation?.(draggedId, component.id); setDraggedId(null); }}
                      data-selected={activeConfigurationId === component.id}
                      className={cn('workspace-selection-row md-sim-row', activeConfigurationId === component.id && 'is-active', draggedId === component.id && 'is-dragging')}
                    >
                      <button type="button" className="md-sim-drag" aria-label={`Drag ${component.name} to reorder`}><GripVertical size={14} /></button>
                      <LabCheckbox checked={component.selected} onCheckedChange={() => onToggleSimulation(component.id)} aria-label={`${component.selected ? 'Deselect' : 'Select'} ${component.name}`} className="md-sim-check" />
                      <button type="button" className="md-sim-row-main" onClick={() => onConfigureSimulation(component.id)}><code className="md-sim-step-index">{String(index + 1).padStart(2, '0')}</code><span><strong data-selection-label>{component.name || recipe.label}</strong><small className={cn(configurationError && 'is-error')}>{configurationError || stepSummary(component)}</small></span></button>
                      <WorkflowRowMenu component={component} index={index} count={components.length} onConfigure={() => onConfigureSimulation(component.id)} onDuplicate={onDuplicateSimulation ? () => onDuplicateSimulation(component.id) : undefined} onMove={onMoveSimulation ? direction => onMoveSimulation(component.id, direction) : undefined} onDelete={() => onDeleteSimulation(component.id)} />
                      <button type="button" className="calculation-run-button md-sim-row-run" disabled={!!stepDisabledReason || !!configurationError || !!busyAction} title={configurationError || stepDisabledReason || undefined} onClick={() => onRunSimulation(component.id)} aria-label={`Run ${component.name}`}><Play size={14} /></button>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </>}
        {tab === 'runs' && (
          <section className="md-sim-section md-sim-runs">
            <div className="md-sim-section-heading md-sim-flat-heading">
              <div>
                <strong>Simulation runs</strong>
                <span>{activeRuns ? `${activeRuns} active on compute` : 'Backend-verified simulation history'}</span>
              </div>
            </div>
            {sortedJobs.length === 0 ? (
              <div className="md-sim-empty">
                <FileText size={20} />
                <strong>No runs yet</strong>
                <span>Queued, running, completed, and failed jobs appear here with live logs.</span>
              </div>
            ) : (
              <div className="md-sim-run-list">
                {sortedJobs.map(job => (
                  <JobRunItem
                    key={job.id}
                    job={job}
                    onOpenResultTrajectory={onOpenResultTrajectory}
                    onCancelSimulation={onCancelSimulation}
                  />
                ))}
              </div>
            )}
          </section>
        )}
        {tab === 'library' && <section className="md-sim-section md-sim-library">
          <div className="md-sim-section-heading md-sim-flat-heading"><div><strong>Project library</strong><span>Configurations and verified potential assets stay within this project.</span></div></div>
          <label className="md-sim-search"><Search size={14} /><input value={libraryQuery} onChange={event => setLibraryQuery(event.target.value)} placeholder="Search setup, family, element, or file" aria-label="Search project MD library" /></label>
          <div className="md-sim-library-group"><h4><Library size={13} /> Configurations <code>{visibleConfigurations.length}</code></h4>{visibleConfigurations.map(item => <article key={item.id}><FileCode2 size={15} /><span><strong>{item.name}</strong><small>{item.workflow.steps.length} steps · {item.workflow.mode}</small></span><button type="button" className="lab-secondary-button" onClick={() => onLoadConfiguration?.(item)}>Load</button><button type="button" className="lab-icon-button" aria-label={`Delete ${item.name}`} onClick={() => onDeleteConfiguration?.(item.id)}><Trash2 size={13} /></button></article>)}{!visibleConfigurations.length && <p>No saved configuration matches.</p>}</div>
          <div className="md-sim-library-group">
            <h4><ShieldCheck size={13} /> Potentials <code>{visiblePotentials.length}</code></h4>
            {visiblePotentials.map(item => {
              const mapped = mappedElements.length > 0 && mappedElements.every(element => item.elements.includes(element));
              return <article key={item.id}>
                <ShieldCheck size={15} className={item.status === 'READY' ? 'is-ready' : undefined} />
                <span>
                  <strong>{item.name}</strong>
                  <small>{item.family.toUpperCase()} · {item.elements.join(', ')}</small>
                  <small className="md-potential-checks">
                    <i data-ready={item.status === 'READY'}>Integrity</i>
                    <i data-ready={mapped}>Elements</i>
                    <i data-ready={!!item.runtimeValidatedAt}>Runtime</i>
                  </small>
                  <details className="mt-2 text-[10px]"><summary>Model source and scope</summary><p>{item.citation || 'Citation unprovided (legacy asset)'}</p><p>Version: {item.modelVersion || 'Unspecified'} · License: {item.license || 'Unspecified'}</p><p>Domain: {item.validityDomain || 'Unassessed'}</p><p>Validation: {item.modelQualification || 'unassessed'} · {item.validationEvidence || 'No study validation evidence provided'}</p><p>Integrity and a successful runtime check do not establish physical accuracy for the study.</p></details>
                </span>
                <button type="button" className="lab-icon-button" aria-label={`Delete ${item.name}`} onClick={() => onDeletePotential?.(item.id)}><Trash2 size={13} /></button>
              </article>;
            })}
            {!visiblePotentials.length && <p>No project potential matches.</p>}
          </div>
        </section>}
      </div>
      {tab === 'setup' && <footer className="md-sim-footer">{(runDisabledReason || selectedConfigurationError || anyConfigurationError) && <p><AlertCircle size={13} />{runDisabledReason || selectedConfigurationError || anyConfigurationError}</p>}<div>{onSaveConfiguration && <button type="button" className="lab-secondary-button" disabled={!components.length || !!busyAction} onClick={() => onSaveConfiguration()}><Save size={13} /> Save setup</button>}<button type="button" className="lab-primary-button" disabled={!selectedCount || !!runDisabledReason || !!selectedConfigurationError || !!busyAction} onClick={onRunSelected}>{busyAction ? <LoaderCircle size={13} className="animate-spin" /> : <Play size={13} />} Run selected · {selectedCount}</button></div></footer>}
    </div>
    {pickerOpen && (
      <RecipePicker
        open={pickerOpen}
        runtimeManifest={runtimeManifest}
        onOpenChange={setPickerOpen}
        onAdd={onAddSimulation}
      />
    )}
    {activeConfig && <MdSimulationConfigDrawer
      component={activeConfig}
      materialName={activeStructureName}
      formula={formula}
      totalAtoms={totalAtoms}
      potentialAssets={potentialAssets}
      mappedElements={mappedElements}
      generatedInput={generateMdStepInputPreview(activeConfig.config)}
      runDisabledReason={getStepDisabledReason ? getStepDisabledReason(activeConfig) : runDisabledReason}
      onChange={patch => onChangeConfiguration(activeConfig.id, patch)}
      onUploadPotential={onUploadPotential}
      onSaveToLibrary={onSaveConfiguration ? () => onSaveConfiguration(activeConfig.id) : undefined}
      onRunSimulation={() => onRunSimulation(activeConfig.id)}
      onClose={() => onConfigureSimulation(activeConfig.id)}
    />}
  </>;
}

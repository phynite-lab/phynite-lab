'use client';

import { exportNumericalDataset, type DatasetExportFormat } from '@/lib/dataset-export';
import { downloadBlob } from '@/lib/plot-download';
import { BandProjectionControls } from './BandProjectionControls';
import { guidePath } from '@/lib/guide-routing';
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { AccountMenu } from '@/app/lab-header';
import type { PhyniteSession } from '@/app/auth-client';
import { ArrowDown, ArrowUp, ArchiveRestore, ChevronRight, CircleHelp, Copy, Download, FolderOpen, Keyboard, Layers3, LoaderCircle, Moon, MoreHorizontal, Pencil, Plus, Redo2, Settings2, Sun, Trash2, Undo2, Upload, X, ZoomIn, ZoomOut } from 'lucide-react';
import { readSourcePackage } from '@/lib/research-package';
import { createFigure, datasetFromText, figureTemplate, finite, instantiateTemplate, migratePlotSettings, newLayer, newPanel, newResearchId, renderFigure, replaceLayerDataset, replacementPanelTitle, researchHash, scientificPlotSettingsFromFigure, sourceScientificPlotSettings, validateDataset, updateFigurePanel, templateSourceCount, FIGURE_COLORS, type FigureDocument, type FigureLayer, type FigurePanel, type FigureTemplate, type ResearchDataset } from '@/lib/research-figures';
import { acceptCloudFigure, cloudFigureRevision, deleteResearchFigure, loadFigureDrafts, loadResearch, markResearchConflict, saveFigureDraft, saveFigureResearch, saveResearch, type ResearchRecord } from '@/lib/research-storage';
import { importRunDatasets, type FigureJob } from '@/lib/research-import';
import { activeViewports, viewportChecksum } from '@/lib/ai-viewport';
import { useAiViewportScope } from './AiViewportScope';
import { renderPlotPngBlob } from '@/lib/plot-download';
import { useFigurePreview } from '@/lib/use-figure-preview';
import { resolveFigureEntry, type FigureEntry } from '@/lib/research-figure-entry';
import type { WorkspaceSaveState } from '@/components/WorkspaceIdentity';
import { WorkspaceProductHeader } from '@/components/WorkspaceProductHeader';
import { FigureSelect, FigureColorField } from '@/components/FigureControls';
import { ComputeResourceDetails } from '@/components/ComputeResourceDetails';
import { AddFigureDialog } from '@/components/AddFigureDialog';
import { formatRunDate } from '@/lib/run-date';
import { autoSizeFigure, millimetersPerUnit, requiredFigureRows, removeFigurePanel, type FigureUnit } from '@/lib/figure-layout';
import { useWorkspaceSaveShortcut } from '@/components/use-workspace-save-shortcut';
import { LabCheckbox } from '@/components/LabControls';
import { ResearchSidebarSlot, useResearchShell, useResearchNavigation } from './ResearchShellContext';

type Props = { embedded?: boolean; initialFigureId?: string; onWorkflowFigureChange?: (figure: FigureDocument) => void; session?: PhyniteSession; ownerId: string; projectId: string; projectName: string; jobs: FigureJob[]; onClose: () => void; onBeforeNavigate?: () => Promise<void>; onUpdateResultPlot?: (jobId: string, settings: NonNullable<FigureJob['plotSettings']>) => void; initialJobId?: string; cloud?: boolean; theme?: 'light' | 'dark'; onToggleTheme?: () => void };
type EditorTab = 'figure' | 'panel' | 'data' | 'history';
type Edit = (figure: FigureDocument) => FigureDocument;
type FigureAction = { kind: 'rename' | 'delete'; figure: FigureDocument };
type FigureMenu = { id: string; top: number; left: number };

function NumberField({ label, value, onChange, unit = '' }: { label: string; value: number | null | undefined; onChange: (value: number | null) => void; unit?: string }) {
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const cancelled = useRef(false);
  return <label className="research-field"><span>{label}{unit && <small>{unit}</small>}</span><input aria-label={label} inputMode="decimal" value={editing ? draft : value ?? ''} placeholder="Auto" onFocus={() => { cancelled.current = false; setDraft(value == null ? '' : String(value)); setEditing(true); }} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelled.current = true; event.currentTarget.blur(); } }} onBlur={() => { if (!cancelled.current) { const number = Number(draft.replace(',', '.')); if (!draft.trim()) onChange(null); else if (finite(number) && number !== value) onChange(number); } setEditing(false); }} /></label>;
}

function datasetListPresentation(dataset: ResearchDataset, activeProjectId: string, jobs: FigureJob[]) {
  const run = jobs.find((job) => !!job.backendCalculationId && job.backendCalculationId === dataset.source.calculationId);
  const scopedName = dataset.name.split(/\s+\/\s+/);
  const context = scopedName.length > 1 ? scopedName.shift()?.trim() : '';
  const rawTitle = scopedName.join(' / ').trim() || dataset.name.trim();
  const formatMatch = rawTitle.match(/\s+\(([A-Za-z0-9]+)\)\s*$/);
  const format = formatMatch?.[1]?.toUpperCase() ?? dataset.source.filename.split('.').at(-1)?.toUpperCase();
  const withoutFormat = rawTitle.replace(/\s+\([A-Za-z0-9]+\)\s*$/, '').trim();
  const canonicalTitle = dataset.metadata.plotType === 'pdos'
    ? 'Projected density of states'
    : dataset.metadata.plotType === 'unfolded'
      ? 'Unfolded band structure'
      : ({ band: 'Band structure', dos: 'Density of states', phonon: 'Phonon dispersion', thermoelectric: 'Thermoelectric properties' } as const)[dataset.data.kind as 'band' | 'dos' | 'phonon' | 'thermoelectric'];
  const title = canonicalTitle && withoutFormat.toLowerCase() === `${canonicalTitle} data`.toLowerCase() ? canonicalTitle : withoutFormat;
  const condition = dataset.metadata.condition;
  const details = [
    run?.name ?? context,
    run?.structureName ? `Structure: ${run.structureName}` : '',
    format,
    condition ? `${condition.parameter} ${condition.value} ${condition.unit}` : '',
    dataset.projectId !== activeProjectId ? 'Other project' : '',
  ].filter(Boolean);
  return { title: title || dataset.name, detail: details.join(' · ') || dataset.data.kind.toUpperCase() };
}

export function FiguresWorkspace({ embedded = false, initialFigureId, onWorkflowFigureChange, session: headerSession, ownerId, projectId, projectName, jobs, onClose, onBeforeNavigate, onUpdateResultPlot, initialJobId, cloud = true, theme = 'dark', onToggleTheme }: Props) {
  const contextShell = useResearchShell();
  const shell = embedded ? null : contextShell;
  const [records, setRecords] = useState<ResearchRecord[]>([]);
  const [drafts, setDrafts] = useState<FigureDocument[]>([]);
  const [figure, setFigure] = useState<FigureDocument | null>(null);
  const reportWorkflowFigure = useEffectEvent((value: FigureDocument) => onWorkflowFigureChange?.(value));
  useEffect(() => { if (figure && embedded) reportWorkflowFigure(figure); }, [figure, embedded]);
  useResearchNavigation(embedded ? 'projects' : 'figures', async (target, href) => {
    await onBeforeNavigate?.();
    if (figure) await saveFigureDraft(ownerId, figure);
    if (target === 'dft' && href === '/calculation') { onClose(); return true; }
    return target === 'figures' && href === '/calculation?view=figures';
  });
  const [past, setPast] = useState<FigureDocument[]>([]);
  const [future, setFuture] = useState<FigureDocument[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [panelId, setPanelId] = useState('');
  const [layerId, setLayerId] = useState('');
  const [tab, setTab] = useState<EditorTab>('figure');
  const [query, setQuery] = useState('');
  const [allProjects, setAllProjects] = useState(false);
  const [message, setMessage] = useState('Loading saved figures...');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [entryComplete, setEntryComplete] = useState(false);
  const [entryError, setEntryError] = useState('');
  const [entryAttempt, setEntryAttempt] = useState(0);
  const [savedDraftJson, setSavedDraftJson] = useState('');
  const [draftSaveError, setDraftSaveError] = useState('');
  const [savingCloud, setSavingCloud] = useState(false);
  const [cloudReady, setCloudReady] = useState(!cloud);
  const [cloudSaveError, setCloudSaveError] = useState('');
  const [retryAt, setRetryAt] = useState(0);
  const [online, setOnline] = useState(true);
  const pendingSaves = useRef(0);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const savedLocalVersions = useRef(new Map<string, number>());
  const retryCount = useRef(0);
  const failedDraft = useRef('');
  const [drawer, setDrawer] = useState<'results' | 'inspector' | null>(null);
  const [datasetFormat, setDatasetFormat] = useState<DatasetExportFormat>('csv');
  const [format, setFormat] = useState<'svg' | 'pdf' | 'png' | 'zip'>('svg');
  const dpi = figure?.rasterDpi ?? 600;
  const sizeUnit = figure?.sizeUnit ?? 'mm';
  const unitScale = millimetersPerUnit(sizeUnit, dpi);
  const [fileFormat, setFileFormat] = useState<'csv' | 'pdos' | 'unfolded'>('csv');
  const [metadataEdit, setMetadataEdit] = useState<ResearchDataset | null>(null);
  const [pathText, setPathText] = useState('');
  const [cloudHistory, setCloudHistory] = useState<Array<{ revision: number; savedAt: string; autosave?: boolean }>>([]);
  const [zoom, setZoom] = useState(100);
  const [fitWidth, setFitWidth] = useState(640);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [figureMenu, setFigureMenu] = useState<FigureMenu | null>(null);
  const [figureAction, setFigureAction] = useState<FigureAction | null>(null);
  const [figureNameDraft, setFigureNameDraft] = useState('');
  const [addingFigure, setAddingFigure] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const spaceHeld = useRef(false);
  const changeZoom = (factor: number) => setZoom((value) => Math.max(25, Math.min(400, Math.round(value * factor))));
  const fileInput = useRef<HTMLInputElement>(null);
  const workspace = useRef<HTMLElement>(null);
  const initializedEntry = useRef<string | null>(null);
  const synchronizedResultPreview = useRef('');
  const datasets = useMemo(() => records.filter((record) => record.collection === 'datasets').map((record) => record.document as ResearchDataset), [records]);
  const templates = records.filter((record) => record.collection === 'templates' && record.document.projectId === projectId).map((record) => record.document as FigureTemplate);
  const archivedFigures = records.filter((record) => record.collection === 'figures' && record.document.projectId === projectId && (record.document as FigureDocument).archived);
  const figures = useMemo(() => {
    const values = new Map(records.filter((record) => record.collection === 'figures' && record.document.projectId === projectId).map((record) => [record.document.id, record.document as FigureDocument]));
    drafts.forEach((draft) => { const saved = values.get(draft.id); if (!saved || draft.updatedAt > saved.updatedAt) values.set(draft.id, draft); });
    if (figure) values.set(figure.id, figure);
    return [...values.values()].filter((item) => !item.archived);
  }, [records, drafts, figure, projectId]);
  const record = records.find((entry) => entry.collection === 'figures' && entry.document.id === figure?.id) as ResearchRecord<FigureDocument> | undefined;
  const figureJson = useMemo(() => JSON.stringify(figure), [figure]);
  const dirty = useMemo(() => Boolean(figure && figureJson !== JSON.stringify(record?.document)), [figure, figureJson, record?.document]);
  const pendingDraft = Boolean(figure && dirty && savedDraftJson !== figureJson);
  const panel = figure?.panels.find((item) => item.id === panelId) ?? figure?.panels[0];
  const layer = panel?.layers.find((item) => item.id === layerId) ?? panel?.layers[0];
  const layerDataset = datasets.find((item) => item.id === layer?.datasetId);
  const sourceJob = jobs.find((job) => !!job.backendCalculationId && job.backendCalculationId === layerDataset?.source.calculationId);
  const selectedQuantity = layerDataset?.data.quantities.find((quantity) => quantity.id === layer?.quantityId);
  const hasSpinDown = selectedQuantity?.series.some((series) => /dos_down|spin_down/i.test(series.id)) ?? false;
  const hasEnergyYAxis = (item: FigurePanel) => item.layers.length > 0 && item.layers.every((entry) => {
    const kind = datasets.find((source) => source.id === entry.datasetId)?.data.kind;
    return kind === 'band' || (kind === 'dos' && entry.energyVertical);
  });
  const energyLinkTargets = panel && hasEnergyYAxis(panel) ? figure?.panels.filter((item) => item.id !== panel.id && hasEnergyYAxis(item)) ?? [] : [];
  const figureSourceCount = new Set(figure?.panels.flatMap((panel) => panel.layers.map((layer) => layer.datasetId))).size;
  const selectedData = selected.map((id) => datasets.find((dataset) => dataset.id === id)).filter((dataset): dataset is ResearchDataset => !!dataset);
  const visibleDatasets = datasets.filter((dataset) => (allProjects || dataset.projectId === projectId) && `${datasetListPresentation(dataset, projectId, jobs).detail} ${dataset.name} ${dataset.source.filename} ${dataset.metadata.condition?.value ?? ''}`.toLowerCase().includes(query.toLowerCase()));
  const availableJobs = jobs.filter((job) => job.status === 'Completed' && ['Band structure', 'Density of states', 'Phonon dispersion', 'Thermoelectric properties'].includes(job.calculationType ?? '') && !(job.backendCalculationId && datasets.some((dataset) => dataset.source.calculationId === job.backendCalculationId)));
  const datasetDate = (dataset: ResearchDataset) => {
    const job = jobs.find((item) => !!item.backendCalculationId && item.backendCalculationId === dataset.source.calculationId);
    const completed = dataset.source.runCompletedAt ?? job?.completedAt;
    const started = dataset.source.runStartedAt ?? job?.startedAt;
    return completed ? `Completed ${formatRunDate(completed)}` : started ? `Started ${formatRunDate(started)}` : `Imported ${formatRunDate(dataset.createdAt)}`;
  };
  const rendered = useFigurePreview(figure, datasets);
  const captureScope = useAiViewportScope();
  useEffect(() => {
    const element = viewport.current;
    if (!captureScope || !element || !figure || !rendered.svg || rendered.pending) return;
    return activeViewports.register({ scope: captureScope, element, capture: async signal => {
      signal.throwIfAborted();
      const width = Math.min(2048, Math.round(figure.widthMm / 25.4 * 150)), height = Math.round(width * figure.heightMm / figure.widthMm);
      const blob = await renderPlotPngBlob(rendered.svg, width, height, 1);
      return { blob, metadata: { kind: 'figure', camera: null, projection: '2d', selection: [], periodicImages: null, axes: figure.panels, units: datasets.map(d => ({ id: d.id, metadata: d.metadata, xLabel: d.data.xLabel, yLabels: d.data.quantities.map(q => q.yLabel) })), energyReference: datasets.map(d => ({ id: d.id, reference: d.data.energyReference ?? 'unknown' })), scientificRunId: captureScope.runId ?? null, datasetSources: datasets.map(d => ({ id: d.id, sha256: d.source.sha256 })), displaySha256: await viewportChecksum({ figure, datasets }) } };
    } });
  }, [captureScope, figure, datasets, rendered.svg, rendered.pending]);

  const figureId = figure?.id;
  const aspectRatio = figure ? figure.widthMm / figure.heightMm : 1;
  useEffect(() => {
    const element = viewport.current;
    if (!element || !figureId) return;
    const resize = () => setFitWidth(Math.max(1, Math.min(element.clientWidth - 48, (element.clientHeight - 48) * aspectRatio)));
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    return () => observer.disconnect();
  }, [figureId, aspectRatio]);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const zoomWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setZoom((value) => Math.max(25, Math.min(400, Math.round(value * (event.deltaY < 0 ? 1.1 : 1 / 1.1)))));
    };
    element.addEventListener('wheel', zoomWheel, { passive: false });
    return () => element.removeEventListener('wheel', zoomWheel);
  }, [figureId]);

  useEffect(() => {
    if (!figureMenu) return;
    const close = (event: PointerEvent) => { if (!(event.target instanceof Element && event.target.closest('[data-figure-actions]'))) setFigureMenu(null); };
    const closeForViewportChange = () => setFigureMenu(null);
    document.addEventListener('pointerdown', close);
    window.addEventListener('resize', closeForViewportChange);
    window.addEventListener('scroll', closeForViewportChange, true);
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-figure-menu="${figureMenu.id}"] button`)?.focus());
    return () => {
      document.removeEventListener('pointerdown', close);
      window.removeEventListener('resize', closeForViewportChange);
      window.removeEventListener('scroll', closeForViewportChange, true);
    };
  }, [figureMenu]);

  const upsertRecord = useCallback((next: ResearchRecord) => setRecords((current) => current.some((entry) => entry.key === next.key && entry.localVersion > next.localVersion) ? current : [...current.filter((entry) => entry.key !== next.key), next]), []);
  const busyRef = useRef(false);
  const run = async (task: () => Promise<unknown>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setActionError('');
    try { await task(); } catch (error) {
      const detail = error instanceof Error ? error.message : 'This action could not be completed.';
      setMessage(detail); setActionError(detail);
    }
    finally { busyRef.current = false; setBusy(false); }
  };
  const mergeCloudLibrary = useEffectEvent((synced: Awaited<ReturnType<typeof loadResearch>>) => {
    const incoming = synced.records.find((entry) => entry.collection === 'figures' && entry.document.id === figure?.id);
    if (incoming && figure && incoming.cloudRevision > (record?.cloudRevision ?? 0)) {
      if (!dirty) setFigure(structuredClone(incoming.document as FigureDocument));
      else {
        incoming.status = 'conflict'; incoming.message = 'This figure changed on another device. Choose a version in History.';
        setFigure({ ...figure, updatedAt: new Date().toISOString() });
        void markResearchConflict(incoming).catch((error) => setCloudSaveError(error.message));
      }
    }
    setRecords((current) => {
      const merged = new Map(current.map((record) => [record.key, record]));
      for (const record of synced.records) if (!merged.has(record.key) || merged.get(record.key)!.localVersion < record.localVersion) merged.set(record.key, record);
      return [...merged.values()];
    });
    if (synced.warning) setCloudSaveError(synced.warning);
    setCloudReady(true);
  });
  useEffect(() => {
    let disposed = false;
    void Promise.all([loadResearch(ownerId, false), loadFigureDrafts(ownerId, projectId)]).then(async ([library, savedDrafts]) => {
      if (disposed) return;
      setRecords(library.records); setDrafts(savedDrafts.filter((draft) => { const saved = library.records.find((record) => record.collection === 'figures' && record.document.id === draft.id)?.document as FigureDocument | undefined; return !saved || draft.updatedAt > saved.updatedAt; })); setReady(true);
      setMessage(library.warning ? `Local workspace ready. ${library.warning}` : 'Choose results to create a figure.');
      if (library.warning) setActionError(library.warning);
      if (cloud) {
        const synced = await loadResearch(ownerId, true);
        if (disposed) return;
        mergeCloudLibrary(synced);
      }
    }).catch((error) => { if (!disposed) { setMessage(error.message); setEntryError(error.message); } });
    return () => { disposed = true; };
  }, [ownerId, projectId, cloud, entryAttempt]);
  useEffect(() => {
    if (!figure || !dirty) return;
    let disposed = false;
    const timer = window.setTimeout(() => {
      void saveFigureDraft(ownerId, figure).then(() => {
        if (disposed) return;
        setDrafts((items) => [...items.filter((item) => item.id !== figure.id), figure]);
        setSavedDraftJson(figureJson); setDraftSaveError('');
      }).catch((error) => { if (!disposed) { setDraftSaveError(error.message); setMessage(error.message); } });
    }, 350);
    return () => { disposed = true; window.clearTimeout(timer); };
  }, [figure, figureJson, dirty, ownerId]);
  const performSave = async (autosave = false) => {
    if (!figure) return;
    if (record?.status === 'conflict') throw new Error('Resolve the cloud revision in History before saving.');
    const localVersion = Math.max(record?.localVersion ?? 0, savedLocalVersions.current.get(figure.id) ?? 0);
    pendingSaves.current += 1;
    setSavingCloud(true);
    try {
    if (!autosave) renderFigure(figure, datasets);
    const { record: saved, sources } = await saveFigureResearch(ownerId, figure, datasets, localVersion, cloud, autosave);
    savedLocalVersions.current.set(figure.id, saved.localVersion);
    sources.forEach(upsertRecord);
    upsertRecord(saved); await saveFigureDraft(ownerId, figure);
    setSavedDraftJson(figureJson); setDraftSaveError('');
    if (saved.status === 'synced') { retryCount.current = 0; failedDraft.current = ''; setCloudSaveError(''); }
    else if (cloud) {
      setCloudSaveError(saved.message ?? 'Cloud is unavailable. Your changes are saved on this device.');
      setRetryAt(Date.now() + Math.min(60000, 5000 * 2 ** retryCount.current++));
    }
    if (!autosave) setMessage(saved.status === 'synced' ? `Cloud revision ${saved.cloudRevision} saved.` : `Saved on this device. ${saved.message ?? ''}`);
    return saved;
    } catch (error) {
      failedDraft.current = figureJson;
      setCloudSaveError(error instanceof Error ? error.message : 'Could not save the figure.');
      throw error;
    } finally { pendingSaves.current -= 1; setSavingCloud(pendingSaves.current > 0); }
  };
  const saveCurrent = (autosave = false) => {
    const queued = saveQueue.current.catch(() => undefined).then(async () => { await performSave(autosave); });
    saveQueue.current = queued.then(() => undefined, () => undefined);
    return queued;
  };
  useWorkspaceSaveShortcut(async () => {
    setActionError('');
    try {
      await saveCurrent(false);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'This figure could not be saved.';
      setMessage(detail);
      setActionError(detail);
    }
  });
  useEffect(() => {
    const reconcilePanels = () => {
      if (window.innerWidth >= 1280) setDrawer(null);
      else if (window.innerWidth >= 1024) setDrawer(currentDrawer => currentDrawer === 'inspector' ? null : currentDrawer);
    };
    window.addEventListener('resize', reconcilePanels);
    return () => window.removeEventListener('resize', reconcilePanels);
  }, []);
  const flushLeavingDraft = useEffectEvent(() => {
    if (figure && pendingDraft) {
      void saveFigureDraft(ownerId, figure).catch((error) => {
        console.error('Could not save the figure draft when leaving Figure Lab.', error);
      });
    }
    if (cloud && cloudReady && figure && (dirty || record?.status === 'local') && record?.status !== 'conflict') void saveCurrent(true).catch(() => {});
  });
  useEffect(() => {
    // Browser Back can unmount Figure Lab before the autosave debounce expires.
    return () => flushLeavingDraft();
  }, []);
  useEffect(() => {
    if (!pendingDraft) return;
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [pendingDraft]);
  const edit = (change: Edit) => {
    if (!figure) return;
    const next = autoSizeFigure(change(structuredClone(figure)));
    if (JSON.stringify(next) === figureJson) return;
    setPast((items) => [...items.slice(-49), figure]); setFuture([]);
    setFigure({ ...next, updatedAt: new Date().toISOString() });
  };
  const editPanel = (patch: Partial<FigurePanel>) => edit((current) => updateFigurePanel(current, panel?.id ?? '', patch));
  const editLayer = (patch: Partial<FigureLayer>) => editPanel({ layers: panel!.layers.map((item) => item.id === layer?.id ? { ...item, ...patch } : item) });
  // History restores content, while the draft timestamp records the latest action.
  const undo = () => { if (figure && past.length) { setFuture((items) => [figure, ...items]); setFigure({ ...past[past.length - 1], updatedAt: new Date().toISOString() }); setPast(past.slice(0, -1)); } };
  const redo = () => { if (figure && future.length) { setPast((items) => [...items, figure]); setFigure({ ...future[0], updatedAt: new Date().toISOString() }); setFuture(future.slice(1)); } };

  const keepDataset = async (dataset: ResearchDataset, sync = cloud) => {
    if (dataset.source.text && await researchHash(dataset.source.text) !== dataset.source.sha256) throw new Error('Source checksum does not match this dataset.');
    const previous = records.find((entry) => entry.collection === 'datasets' && entry.document.id === dataset.id);
    const saved = await saveResearch(ownerId, 'datasets', dataset, previous?.localVersion ?? 0, sync);
    upsertRecord(saved);
    if (sync && saved.status !== 'synced') setActionError(saved.message ?? 'Dataset saved on this device, but cloud sync failed.');
    setMessage(saved.status === 'synced' ? 'Dataset saved to research storage.' : `Dataset saved on this device. ${saved.message ?? ''}`);
    return saved.document;
  };
  const openFigure = async (next: FigureDocument) => {
    if (figure && dirty) {
      await saveFigureDraft(ownerId, figure); setDrafts((items) => [...items.filter((item) => item.id !== figure.id), figure]);
      if (cloud && cloudReady && record?.status !== 'conflict') void saveCurrent(true).catch(() => {});
    }
    setFigure(autoSizeFigure(structuredClone(next))); setPanelId(next.panels[0]?.id ?? ''); setLayerId(''); setPast([]); setFuture([]); setCloudHistory([]);
    setDrawer(null);
    setMetadataEdit(null); setTab('figure'); setDraftSaveError(''); setCloudSaveError('');
    initializedEntry.current = `${initialJobId ?? 'project'}/${entryAttempt}`;
    setEntryError(''); setEntryComplete(true);
  };
  const saveFigureIdentity = async (next: FigureDocument) => {
    const previous = records.find((entry) => entry.collection === 'figures' && entry.document.id === next.id) as ResearchRecord<FigureDocument> | undefined;
    const { record: saved } = await saveFigureResearch(ownerId, next, datasets, previous?.localVersion ?? 0, cloud, false);
    upsertRecord(saved);
    await saveFigureDraft(ownerId, saved.document, { replace: true });
    setDrafts((items) => [...items.filter((item) => item.id !== saved.document.id), saved.document]);
    if (figure?.id === saved.document.id) { setFigure(saved.document); setSavedDraftJson(JSON.stringify(saved.document)); setPast([]); setFuture([]); }
    return saved.document;
  };
  const duplicateFigure = async (source: FigureDocument) => {
    setFigureMenu(null);
    const timestamp = new Date().toISOString();
    const next = { ...structuredClone(source), id: newResearchId(), name: `${source.name} copy`.slice(0, 200), updatedAt: timestamp };
    const saved = await saveFigureIdentity(next);
    await openFigure(saved);
    setMessage(`${saved.name} created.`);
  };
  const beginFigureAction = (kind: FigureAction['kind'], source: FigureDocument) => {
    setFigureMenu(null); setFigureNameDraft(source.name); setFigureAction({ kind, figure: source });
  };
  const toggleFigureMenu = (id: string, button: HTMLButtonElement) => {
    if (figureMenu?.id === id) { setFigureMenu(null); return; }
    const rect = button.getBoundingClientRect();
    const width = 164;
    const height = 116;
    const gap = 5;
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width));
    const top = rect.bottom + gap + height <= window.innerHeight - 8 ? rect.bottom + gap : Math.max(8, rect.top - height - gap);
    setFigureMenu({ id, top, left });
  };
  const commitFigureRename = async () => {
    if (!figureAction || figureAction.kind !== 'rename') return;
    const name = figureNameDraft.trim();
    if (!name) throw new Error('Figure name cannot be empty.');
    const saved = await saveFigureIdentity({ ...figureAction.figure, name: name.slice(0, 200), updatedAt: new Date().toISOString() });
    setFigureAction(null); setMessage(`Renamed to ${saved.name}.`);
  };
  const commitFigureDelete = async () => {
    if (!figureAction || figureAction.kind !== 'delete') return;
    const deleted = figureAction.figure;
    await deleteResearchFigure(ownerId, deleted.id, cloud);
    setRecords((items) => items.filter((entry) => !(entry.collection === 'figures' && entry.document.id === deleted.id)));
    setDrafts((items) => items.filter((item) => item.id !== deleted.id));
    if (figure?.id === deleted.id) { setFigure(null); setPanelId(''); setLayerId(''); setPast([]); setFuture([]); }
    setFigureAction(null); setMessage(`${deleted.name} deleted. Source datasets were retained.`);
  };
  const autosaveCurrent = useEffectEvent(() => { void saveCurrent(true).catch(() => {}); });
  useEffect(() => {
    if (!cloud || !cloudReady || !ready || !figure || !online || busy || savingCloud || record?.status === 'conflict' || (!dirty && record?.status === 'synced') || failedDraft.current === figureJson) return;
    const timer = window.setTimeout(() => {
      if (navigator.onLine) autosaveCurrent();
    }, Math.max(1200, retryAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [cloud, cloudReady, ready, figure, figureJson, online, busy, savingCloud, dirty, record?.status, retryAt]);
  useEffect(() => {
    const retry = () => { setOnline(navigator.onLine); failedDraft.current = ''; retryCount.current = 0; setRetryAt(Date.now()); };
    queueMicrotask(retry);
    window.addEventListener('online', retry);
    window.addEventListener('offline', retry);
    window.addEventListener('focus', retry);
    return () => { window.removeEventListener('online', retry); window.removeEventListener('offline', retry); window.removeEventListener('focus', retry); };
  }, []);
  const loadJobs = async (ids: string[], localOnly = false) => {
    const added: ResearchDataset[] = [];
    for (const id of ids) {
      const job = jobs.find((item) => item.id === id);
      if (!job) continue;
      const result = await importRunDatasets(projectId, job);
      for (const dataset of result.datasets) added.push(await keepDataset(dataset, localOnly ? false : cloud));
      if (result.warning) { setMessage(result.warning); setActionError(result.warning); }
    }
    setSelected((items) => [...new Set([...items, ...added.map((item) => item.id)])]);
    return added;
  };
  const openEntry = useEffectEvent(async (entry: FigureEntry) => {
    setEntryError('');
    try {
      if (entry.kind === 'empty' || entry.kind === 'missing-job') return;
      setMessage(entry.kind === 'job' ? `Loading results for ${entry.job.name}...` : 'Opening saved figure...');
      let next: FigureDocument;
      if (entry.kind === 'figure') {
        next = entry.figure;
        const requestedJob = initialJobId ? jobs.find((job) => job.id === initialJobId) : undefined;
        const requestedDataset = requestedJob?.backendCalculationId
          ? datasets.find((dataset) => dataset.source.calculationId === requestedJob.backendCalculationId && next.panels.some((panel) => panel.layers.some((layer) => layer.datasetId === dataset.id)))
          : undefined;
        if (requestedDataset && next.resultStyleVersion !== 1 && next.panels.length === 1 && next.panels[0].layers.length === 1) {
          next = migratePlotSettings(next, sourceScientificPlotSettings(requestedDataset, requestedJob?.plotSettings));
        }
      }
      else {
        const added = entry.kind === 'datasets' ? entry.datasets : await loadJobs([entry.job.id], true);
        if (!added.length) throw new Error('No numerical data is available for this calculation. Import a saved CSV or source package.');
        next = createFigure(projectId, added, 'single', entry.job?.name ?? added[0].name);
        next = migratePlotSettings(next, sourceScientificPlotSettings(added[0], entry.job?.plotSettings));
      }
      setSelected([...new Set(next.panels.flatMap((panel) => panel.layers.map((layer) => layer.datasetId)))]);
      await openFigure(next);
      setMessage(`Opened ${next.name}.`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'The calculation result could not be opened.';
      setEntryError(detail); setMessage(detail);
    } finally { setEntryComplete(true); }
  });
  const openInitialFigure = useEffectEvent((next: FigureDocument) => openFigure(next));
  const runEntry = useEffectEvent((entry: FigureEntry) => run(() => openEntry(entry)));
  useEffect(() => {
    const key = `${initialJobId ?? 'project'}/${entryAttempt}`;
    if (!ready || busy || initializedEntry.current === key) return;
    if (initialFigureId) {
      const selectedFigure = drafts.find(item => item.id === initialFigureId) ?? figures.find(item => item.id === initialFigureId);
      if (selectedFigure) queueMicrotask(() => { initializedEntry.current = key; void openInitialFigure(selectedFigure); setEntryComplete(true); });
      return;
    }
    const entry = resolveFigureEntry(projectId, figures, datasets, jobs, initialJobId);
    let disposed = false;
    queueMicrotask(() => {
      if (disposed || busyRef.current) return;
      if (entry.kind === 'missing-job') {
        setEntryError('The selected calculation is not available yet. Retry after the execution log has loaded, or open a saved figure from the library.');
        return;
      }
      if (entry.kind === 'empty') {
        setEntryComplete(true);
        return;
      }
      // Consume the request only once it can start; late-arriving jobs remain eligible.
      initializedEntry.current = key;
      void runEntry(entry);
    });
    return () => { disposed = true; };
  }, [ready, busy, initialJobId, entryAttempt, projectId, figures, datasets, jobs, initialFigureId, drafts]);

  const updateResultPreview = useEffectEvent((jobId: string, settings: NonNullable<FigureJob['plotSettings']>) => onUpdateResultPlot?.(jobId, settings));
  useEffect(() => {
    if (!initialJobId || !figure || !onUpdateResultPlot) return;
    const job = jobs.find((candidate) => candidate.id === initialJobId);
    if (!job) return;
    const source = datasets.find((dataset) => figure.panels[0]?.layers[0]?.datasetId === dataset.id && (!job.backendCalculationId || dataset.source.calculationId === job.backendCalculationId));
    if (!source) return;
    const settings = scientificPlotSettingsFromFigure(figure, source, job.plotSettings);
    if (!settings) return;
    const key = `${job.id}:${JSON.stringify(settings)}`;
    if (key === synchronizedResultPreview.current || JSON.stringify(job.plotSettings) === JSON.stringify(settings)) return;
    const timer = window.setTimeout(() => {
      synchronizedResultPreview.current = key;
      updateResultPreview(job.id, settings);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [datasets, figure, figureJson, initialJobId, jobs, onUpdateResultPlot]);

  const importFiles = async (files: FileList | null) => {
    if (!files) return;
    const added: ResearchDataset[] = [];
    for (const file of Array.from(files)) {
      if (file.size > (file.name.endsWith('.zip') ? 200_000_000 : 20_000_000)) throw new Error('Import data files up to 20 MB or source packages up to 200 MB; each dataset must fit within 4 MB.');
      if (file.name.endsWith('.zip')) {
        const bundle = await readSourcePackage(new Uint8Array(await file.arrayBuffer()));
        renderFigure(bundle.figure, bundle.datasets);
        const mapping = new Map<string, string>();
        for (const dataset of bundle.datasets) {
          const previous = dataset.id;
          dataset.id = newResearchId(); dataset.projectId = projectId;
          added.push(await keepDataset(dataset)); mapping.set(previous, dataset.id);
        }
        const imported = bundle.figure;
        imported.id = newResearchId(); imported.projectId = projectId; imported.name = `${imported.name.slice(0, 190)} imported`;
        imported.panels.forEach((item) => item.layers.forEach((entry) => { entry.datasetId = mapping.get(entry.datasetId)!; }));
        renderFigure(imported, [...datasets, ...added]); await openFigure(imported);
      } else if (file.name.endsWith('.json')) {
        const dataset = validateDataset(JSON.parse(await file.text())); dataset.id = newResearchId(); dataset.projectId = projectId;
        added.push(await keepDataset(dataset));
      } else added.push(await keepDataset(await datasetFromText(await file.text(), { projectId, filename: file.name, name: file.name.replace(/\.[^.]+$/, ''), format: fileFormat })));
    }
    setSelected((items) => [...items, ...added.map((item) => item.id)]);
  };
  const movePanel = (direction: number) => edit((current) => {
    const index = current.panels.findIndex((item) => item.id === panel?.id), destination = index + direction;
    if (index >= 0 && destination >= 0 && destination < current.panels.length) [current.panels[index], current.panels[destination]] = [current.panels[destination], current.panels[index]];
    return current;
  });
  const startMetadata = (dataset: ResearchDataset) => { setMetadataEdit(structuredClone(dataset)); setPathText(JSON.stringify(dataset.metadata.path ?? {}, null, 2)); setTab('data'); setDrawer('inspector'); };
  const changeMetadata = (patch: Partial<ResearchDataset['metadata']>) => setMetadataEdit((current) => current ? { ...current, metadata: { ...current.metadata, ...patch } } : null);

  const exportDataset = (dataset: ResearchDataset) => void run(async () => {
    const output = exportNumericalDataset(dataset, datasetFormat);
    downloadBlob(new Blob([output.text], { type: output.mime }), output.filename);
    setMessage(`Exported every source sample as ${datasetFormat.toUpperCase()}; figure transformations do not alter the numerical export.`);
  });
  const exportCurrent = () => void run(async () => {
    if (!figure) return;
    const { exportFigure } = await import('@/lib/figure-export');
    await exportFigure(figure, datasets, format, dpi, !dirty && record?.status === 'synced' ? record.cloudRevision : 0);
    setMessage(`${format.toUpperCase()} exported. ${format === 'zip' ? 'Numerical sources and metadata included.' : 'Use Source package to include numerical data.'}`);
  });
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.target instanceof Element && event.target.closest('dialog[open]')) return;
      const primary = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      const editable = event.target instanceof Element && !!event.target.closest('input,textarea,select,[contenteditable="true"],[role="combobox"],[role="listbox"]');
      if (editable || busy) return;
      if (primary && key === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); }
      else if (primary && key === 'y') { event.preventDefault(); redo(); }
      else if (primary && event.shiftKey && key === 'e') { event.preventDefault(); exportCurrent(); }
      else if (key === '+' || key === '=') { event.preventDefault(); changeZoom(1.25); }
      else if (key === '-') { event.preventDefault(); changeZoom(0.8); }
      else if (key === '0') { event.preventDefault(); setZoom(100); }
      else if (key === '?') { event.preventDefault(); setShortcutsOpen((value) => !value); }
      else if (key === ' ') { event.preventDefault(); spaceHeld.current = true; }
      else if (key === 'escape') { setShortcutsOpen(false); setDrawer(null); }
    };
    const releaseSpace = () => { spaceHeld.current = false; pan.current = null; };
    const keyup = (event: KeyboardEvent) => { if (event.code === 'Space') releaseSpace(); };
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', releaseSpace);
    return () => { window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup); window.removeEventListener('blur', releaseSpace); };
  });

  const pendingCloud = cloud && figure && (dirty || record?.status !== 'synced');
  const saveConflict = record?.status === 'conflict';
  const saveState: WorkspaceSaveState = draftSaveError || saveConflict ? 'error' : pendingDraft || savingCloud || (pendingCloud && online && !cloudSaveError) ? 'saving' : !figure ? 'idle' : !dirty && record?.status === 'synced' ? 'synced' : 'local';
  const saveLabel = draftSaveError ? 'Save failed' : saveConflict ? 'Sync conflict' : saveState === 'saving' ? 'Saving...' : !figure ? 'Autosave' : saveState === 'synced' ? 'Saved to cloud' : cloud && !online ? 'Saved on device · Offline' : cloud && cloudSaveError ? 'Saved on device · Sync pending' : 'Saved on device';
  const saveDetail = draftSaveError || (saveConflict ? 'Your local changes are safe. Resolve the cloud revision in History.' : cloudSaveError || (saveState === 'synced' ? 'All changes are automatically saved to cloud.' : cloud ? 'Changes save automatically after a short pause.' : 'Changes autosave on this device. Cloud sync is disabled.'));

  return <section ref={workspace} className="research-workspace" aria-label="Project figures workspace" onKeyDown={(event) => { if (!event.defaultPrevented && event.key === 'Escape' && drawer && !(event.target instanceof Element && event.target.closest('[role="combobox"],[role="listbox"]'))) { setDrawer(null); workspace.current?.querySelector<HTMLButtonElement>(`button[aria-controls="research-${drawer}"]`)?.focus(); } }}>
    <WorkspaceProductHeader
      inline={embedded}
      className="research-topbar"
      activeProduct="figures"
      saveState={saveState}
      saveLabel={saveLabel}
      saveDetail={saveDetail}
      destinations={{ crystal: { onSelect: () => void run(async () => { if (figure) await saveFigureDraft(ownerId, figure); onClose(); }), title: 'Back to DFT Lab' } }}
      context={<nav className="workspace-product-breadcrumb research-breadcrumb" aria-label="Figure Lab location"><span>{projectName}</span><ChevronRight size={12} /><strong>Figure Lab</strong></nav>}
      actions={<><div className="research-toolbar-actions" role="group" aria-label="Figure editing tools">
        <button type="button" className="workspace-product-button workspace-product-button--icon research-mobile research-mobile-results" aria-label="Show results" aria-controls="research-results" aria-expanded={drawer === 'results'} onClick={() => shell ? shell.openSidebar() : setDrawer(drawer === 'results' ? null : 'results')}><FolderOpen size={15} /></button>
        <button type="button" className="workspace-product-button workspace-product-button--icon" disabled={!past.length || busy} onClick={undo} aria-label="Undo figure change" title="Undo · Ctrl/Cmd Z"><Undo2 size={16} /></button>
        <button type="button" className="workspace-product-button workspace-product-button--icon" disabled={!future.length || busy} onClick={redo} aria-label="Redo figure change" title="Redo · Ctrl/Cmd Shift Z"><Redo2 size={16} /></button>
        <FigureSelect aria-label="Dataset export format" value={datasetFormat} onChange={value => setDatasetFormat(value as DatasetExportFormat)}><option value="csv">Dataset CSV</option><option value="json">Dataset JSON</option><option value="dat">Dataset DAT</option></FigureSelect>
        <button type="button" aria-label="Export Dataset" title="Export complete numerical dataset" className="workspace-product-button research-dataset-export" disabled={busy || (!layerDataset && !selectedData.length)} onClick={() => { const dataset = layerDataset ?? selectedData[0]; if (dataset) exportDataset(dataset); }}><Download size={15} /><span>Export Dataset</span></button>
        <FigureSelect aria-label="Export format" value={format} onChange={(value) => setFormat(value as typeof format)}><option value="svg">SVG</option><option value="pdf">PDF</option><option value="png">PNG</option><option value="zip">Source package</option></FigureSelect>
        <button type="button" aria-label="Export figure" className="workspace-product-button workspace-product-button--accent research-primary" disabled={!rendered.svg || rendered.pending || busy} onClick={exportCurrent}><Download size={15} /><span>Export</span></button>
        <button type="button" className="workspace-product-button workspace-product-button--icon research-mobile research-mobile-inspector" aria-label="Show figure inspector" aria-controls="research-inspector" aria-expanded={drawer === 'inspector'} onClick={() => { shell?.closeMobileNavigation(); setDrawer(drawer === 'inspector' ? null : 'inspector'); }}><Settings2 size={15} /></button>
      </div>
      {!shell && <nav className="research-topbar-actions" aria-label="Workspace navigation">
        <a href={guidePath('en')} className="workspace-product-button workspace-product-guide" aria-label="Open user guide" title="User guide"><CircleHelp size={16} /><span>Guide</span></a>
        {onToggleTheme && <button type="button" className="workspace-product-button workspace-product-button--icon" aria-label={theme === 'dark' ? 'Use light mode' : 'Use dark mode'} onClick={onToggleTheme}>{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}</button>}
        {headerSession && <AccountMenu session={headerSession} />}
      </nav>}</>}
    />
    {actionError && <div className="research-action-alert" role="alert"><span>{actionError}</span><button type="button" aria-label="Dismiss notification" onClick={() => setActionError('')}><X size={14} /></button></div>}
    {figureAction && <div className="research-dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setFigureAction(null)}><form className="research-dialog" role="dialog" aria-modal="true" aria-labelledby="figure-action-title" onSubmit={(event) => { event.preventDefault(); void run(figureAction.kind === 'rename' ? commitFigureRename : commitFigureDelete); }}><header><div className={figureAction.kind === 'delete' ? 'is-danger' : ''}>{figureAction.kind === 'rename' ? <Pencil size={17} /> : <Trash2 size={17} />}</div><button type="button" aria-label="Close" onClick={() => setFigureAction(null)}><X size={15} /></button></header><h2 id="figure-action-title">{figureAction.kind === 'rename' ? 'Rename figure' : 'Delete figure?'}</h2>{figureAction.kind === 'rename' ? <label>Figure name<input autoFocus required maxLength={200} value={figureNameDraft} onChange={(event) => setFigureNameDraft(event.target.value)} /></label> : <p><strong>{figureAction.figure.name}</strong> and its saved figure revisions will be permanently deleted. Numerical source datasets remain available.</p>}<footer><button type="button" onClick={() => setFigureAction(null)}>Cancel</button><button className={figureAction.kind === 'delete' ? 'is-danger' : 'is-primary'} disabled={busy || (figureAction.kind === 'rename' && !figureNameDraft.trim())}>{figureAction.kind === 'rename' ? 'Save name' : 'Delete figure'}</button></footer></form></div>}
    {addingFigure && <AddFigureDialog defaultName={`${projectName} figure ${figures.length + 1}`} choices={[
      ...datasets.map((dataset) => { const presentation = datasetListPresentation(dataset, projectId, jobs); return { id: `dataset:${dataset.id}`, title: presentation.title, detail: presentation.detail, date: datasetDate(dataset), otherProject: dataset.projectId !== projectId }; }),
      ...availableJobs.map((job) => ({ id: `run:${job.id}`, title: job.calculationType ?? job.name, detail: `${job.name} · Structure: ${job.structureName ?? job.material ?? 'Not recorded'}`, date: formatRunDate(job.completedAt ?? job.startedAt), otherProject: false })),
    ]} onClose={() => setAddingFigure(false)} onCreate={async (name, ids, layout) => {
      const chosen = datasets.filter((dataset) => ids.includes(`dataset:${dataset.id}`));
      const runIds = ids.filter((id) => id.startsWith('run:')).map((id) => id.slice(4));
      const retained = datasets.filter((dataset) => runIds.some((id) => jobs.some((job) => job.id === id && !!job.backendCalculationId && job.backendCalculationId === dataset.source.calculationId)));
      const added = await loadJobs(runIds.filter((id) => !retained.some((dataset) => dataset.source.calculationId === jobs.find((job) => job.id === id)?.backendCalculationId)));
      const sources = [...chosen, ...retained, ...added];
      let next = createFigure(projectId, sources, sources.length > 1 && layout === 'single' ? 'grid' : layout, name);
      if (sources.length === 1) next = migratePlotSettings(next, sourceScientificPlotSettings(sources[0], jobs.find((job) => !!job.backendCalculationId && job.backendCalculationId === sources[0].source.calculationId)?.plotSettings));
      renderFigure(next, [...datasets, ...added]);
      await saveFigureDraft(ownerId, next);
      await openFigure(next);
      setSelected(sources.map((dataset) => dataset.id));
    }} />}
    {shortcutsOpen && <div className="research-shortcuts" role="region" aria-label="Keyboard shortcuts"><div><strong>Keyboard shortcuts</strong><button aria-label="Close shortcuts" onClick={() => setShortcutsOpen(false)}><X size={14} /></button></div><dl><dt>Save</dt><dd>Ctrl / Cmd S</dd><dt>Undo / Redo</dt><dd>Ctrl / Cmd Z / Shift Z</dd><dt>Export</dt><dd>Ctrl / Cmd Shift E</dd><dt>Zoom / Fit</dt><dd>+ / - / 0</dd><dt>Pan canvas</dt><dd>Space + drag / middle drag</dd><dt>Zoom with wheel</dt><dd>Ctrl / Cmd + scroll</dd></dl><p>Text fields keep their native undo. Canvas zoom does not change export size.</p></div>}
    <div className="research-body" inert={busy || (!ready && !entryError)}>
      {drawer && <button className="research-drawer-backdrop" aria-label="Close sidebar" onClick={() => setDrawer(null)} />}
      <ResearchSidebarSlot inline={embedded} section="figures" className="research-workspace"><aside inert={busy || (!ready && !entryError)} id="research-results" className={`research-library ${drawer === 'results' ? 'is-open' : ''}`} aria-label="Figure library and results">
        {shell && <label className="research-field">Project<FigureSelect aria-label="Figure project" value={projectId} onChange={value => shell.navigate('figures', `/calculation?project=${encodeURIComponent(value)}&view=figures`)}>{shell.projects.filter(project => project.kind === 'dft').map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</FigureSelect></label>}
        <div className="research-section-heading"><h2>Figures <span>{figures.length}</span></h2><button type="button" disabled={busy} onClick={() => setAddingFigure(true)}><Plus size={13} />Add figure</button></div>
        <div className="research-figure-list">{figures.map((item) => <div className="research-figure-row" data-active={item.id === figure?.id} key={item.id}><button type="button" className="research-figure-open" aria-pressed={item.id === figure?.id} onClick={() => void run(() => openFigure(item))}><Layers3 size={13} /><span title={item.name}>{item.name}</span></button><div className="research-figure-actions" data-figure-actions><button type="button" aria-label={`Actions for ${item.name}`} aria-controls={`figure-menu-${item.id}`} aria-expanded={figureMenu?.id === item.id} onClick={(event) => toggleFigureMenu(item.id, event.currentTarget)}><MoreHorizontal size={14} /></button></div>{figureMenu?.id === item.id && <div id={`figure-menu-${item.id}`} className="research-figure-menu" role="menu" data-figure-actions data-figure-menu={item.id} style={{ top: figureMenu.top, left: figureMenu.left }}><button role="menuitem" type="button" onClick={() => beginFigureAction('rename', item)}><Pencil size={13} /><span>Rename</span></button><button role="menuitem" type="button" onClick={() => void run(() => duplicateFigure(item))}><Copy size={13} /><span>Duplicate</span></button><span className="research-figure-menu-rule" aria-hidden="true" /><button role="menuitem" type="button" className="is-danger" onClick={() => beginFigureAction('delete', item)}><Trash2 size={13} /><span>Delete</span></button></div>}</div>)}{!figures.length && <p className="research-help">Click Add figure to choose data for your first figure.</p>}</div>
        {!!archivedFigures.length && <details className="research-details research-archive"><summary><span>Archived figures</span><span className="research-section-count">{archivedFigures.length}</span></summary><div className="research-archive-list">{archivedFigures.map((entry) => <div key={entry.key}><span title={entry.document.name}>{entry.document.name}</span><button type="button" title={`Restore ${entry.document.name}`} aria-label={`Restore ${entry.document.name}`} onClick={() => void run(async () => { const restored = { ...entry.document as FigureDocument, archived: false, updatedAt: new Date().toISOString() }; const { record: saved } = await saveFigureResearch(ownerId, restored, datasets, entry.localVersion, cloud, false); upsertRecord(saved); await openFigure(restored); })}><ArchiveRestore size={13} />Restore</button></div>)}</div></details>}
        <div className="research-section-heading"><h2>Results</h2><span>{selected.length} selected</span></div>
        <div className="research-library-controls"><input aria-label="Search research results" placeholder="Search material or result" value={query} onChange={(event) => setQuery(event.target.value)} /><LabCheckbox className="research-check" checked={allProjects} onCheckedChange={setAllProjects}>Include other projects</LabCheckbox></div>
        <div className="research-datasets">{visibleDatasets.map((dataset) => { const presentation = datasetListPresentation(dataset, projectId, jobs); return <div key={dataset.id} className="research-dataset-row" data-selected={selected.includes(dataset.id)}><LabCheckbox checked={selected.includes(dataset.id)} onCheckedChange={() => setSelected((items) => items.includes(dataset.id) ? items.filter((id) => id !== dataset.id) : [...items, dataset.id])}><span><strong title={dataset.name}>{presentation.title}</strong><small>{presentation.detail}</small><small className="research-result-date">{datasetDate(dataset)}</small></span></LabCheckbox><button type="button" title={`Export Dataset (${datasetFormat.toUpperCase()})`} aria-label={`Export Dataset for ${dataset.name}`} onClick={() => exportDataset(dataset)}><Download size={12} /></button><button type="button" aria-label={`Metadata for ${dataset.name}`} onClick={() => startMetadata(dataset)}><Settings2 size={12} /></button></div>; })}{!visibleDatasets.length && !availableJobs.length && <p className="research-help">Load a completed run or import numerical data.</p>}</div>
        <div className="research-datasets">{availableJobs.filter((job) => `${job.name} ${job.structureName ?? ''} ${job.calculationType ?? ''} ${formatRunDate(job.completedAt)}`.toLowerCase().includes(query.toLowerCase())).map((job) => { const plottable = availableJobs.some((item) => item.id === job.id); return <div className="research-dataset-row" key={job.id}><LabCheckbox checked={false} disabled={busy || !plottable} onCheckedChange={() => void run(() => loadJobs([job.id]))}><span><strong>{job.calculationType ?? job.name}</strong><small>{job.name} · Structure: {job.structureName ?? job.material ?? 'Not recorded'}</small><small className="research-result-date">Completed {formatRunDate(job.completedAt)}</small>{!plottable && <small>No supported plot data; output is available in Log.</small>}</span></LabCheckbox></div>; })}</div>
        <div className="research-create-controls">{figure && <button type="button" disabled={!selectedData.length || busy} onClick={() => edit((current) => ({ ...current, panels: [...current.panels, ...selectedData.map((dataset, index) => newPanel([newLayer(dataset, index)], dataset.name))], heightMm: Math.min(700, Math.max(current.heightMm, Math.ceil((current.panels.length + selectedData.length) / current.columns) * 75)) }))}><Plus size={14} />Add as panels</button>}</div>

        <details className="research-details"><summary>Import data</summary><FigureSelect aria-label="Import data format" value={fileFormat} onChange={(value) => setFileFormat(value as typeof fileFormat)}><option value="csv">Result CSV</option><option value="pdos">Projected DOS columns</option><option value="unfolded">Unfolded k / E / weight</option></FigureSelect><p className="research-help">PDOS: energy then projection channels. Unfolding: k, energy, spectral weight from an unfolding calculation. JSON datasets and source ZIP packages keep their metadata.</p><button type="button" disabled={busy} onClick={() => fileInput.current?.click()}><Upload size={13} />Choose files</button><input hidden ref={fileInput} type="file" multiple accept=".csv,.dat,.txt,.json,.zip" aria-label="Import research data files" onChange={(event) => { const files = event.target.files; void run(() => importFiles(files)); event.currentTarget.value = ''; }} /></details>
        {!!templates.length && <details className="research-details"><summary>Templates ({templates.length})</summary>{templates.map((template) => <button type="button" key={template.id} disabled={busy} onClick={() => void run(async () => { const next = instantiateTemplate(template, projectId, selectedData); renderFigure(next, datasets); await openFigure(next); })}>{template.name}<small>{templateSourceCount(template)} sources in selection order</small></button>)}{!templates.length && <p className="research-help">Save a figure as a template to reuse its layout and style.</p>}</details>}
      </aside>
      </ResearchSidebarSlot><main className="research-stage">
        {figure ? <><div ref={viewport} className="research-canvas-scroll" aria-label="Figure canvas" tabIndex={0} aria-busy={rendered.pending}
          onPointerDown={(event) => { if (event.button !== 1 && !(event.button === 0 && (spaceHeld.current || event.altKey))) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); pan.current = { x: event.clientX, y: event.clientY, left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop }; }}
          onPointerMove={(event) => { if (!pan.current) return; event.currentTarget.scrollLeft = pan.current.left - event.clientX + pan.current.x; event.currentTarget.scrollTop = pan.current.top - event.clientY + pan.current.y; }}
          onPointerUp={(event) => { pan.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
          onPointerCancel={() => { pan.current = null; }}>{rendered.svg ? <div className="research-paper" style={{ width: `${fitWidth * zoom / 100}px` }} onClick={(event) => { const target = (event.target as Element).closest('[data-panel-id]'); if (target) { setPanelId(target.getAttribute('data-panel-id')!); setLayerId(''); setTab('panel'); setDrawer('inspector'); } }} dangerouslySetInnerHTML={{ __html: rendered.svg }} /> : <div role={rendered.pending ? "status" : "alert"} className="research-render-error">{rendered.pending ? 'Rendering plot...' : rendered.error}</div>}</div>{!!rendered.issues.length && <details className="research-scientific-notes"><summary>Scientific context ({rendered.issues.length})</summary>{rendered.issues.map((issue) => <p key={issue}>{issue}</p>)}</details>}<div className="research-preview-controls"><div className="research-zoom-controls" role="group" aria-label="Canvas zoom"><button type="button" aria-label="Zoom out" title="Zoom out (-)" disabled={zoom <= 25} onClick={() => changeZoom(0.8)}><ZoomOut size={15} /></button><output aria-label="Zoom level">{zoom}%</output><button type="button" aria-label="Zoom in" title="Zoom in (+)" disabled={zoom >= 400} onClick={() => changeZoom(1.25)}><ZoomIn size={15} /></button><button type="button" title="Fit figure (0)" onClick={() => setZoom(100)}>Fit</button></div><span className="research-preview-state">{rendered.pending ? 'Updating preview...' : `${figure.panels.length} panel${figure.panels.length === 1 ? '' : 's'} · ${figureSourceCount} source${figureSourceCount === 1 ? '' : 's'}`}</span><button type="button" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" aria-expanded={shortcutsOpen} onClick={() => setShortcutsOpen((value) => !value)}><Keyboard size={15} /></button></div></> : entryError ? <div className="research-empty" role="alert"><h1>Could not open this plot</h1><p>{entryError}</p><div className="research-entry-actions"><button type="button" className="research-primary" onClick={() => { setEntryError(''); setEntryComplete(false); setEntryAttempt((value) => value + 1); }}>Retry opening plot</button><button type="button" onClick={() => setDrawer('results')}>Browse results</button></div></div> : !ready || !entryComplete ? <div className="research-empty" role="status" aria-live="polite"><LoaderCircle className="research-opening-icon" size={24} /><h1>Opening your plot...</h1><p>{!ready ? 'Loading saved figures and results.' : 'Preparing the calculation data for your figure.'}</p></div> : <div className="research-empty"><Layers3 size={26} /><h1>No plots yet</h1><p>Complete a band structure, DOS, phonon or transport calculation, or import numerical data to create your first figure.</p><button type="button" onClick={() => setDrawer('results')}>Browse results</button></div>}
      </main>
      <aside id="research-inspector" className={`research-inspector ${drawer === 'inspector' ? 'is-open' : ''}`} aria-label="Figure inspector">
        <div role="tablist" aria-label="Figure inspector sections" className="research-tabs">{(['figure', 'panel', 'data', 'history'] as const).map((item) => <button role="tab" type="button" aria-selected={tab === item} key={item} onClick={() => setTab(item)}>{item[0].toUpperCase() + item.slice(1)}</button>)}</div>
        <div className="research-inspector-content" role="tabpanel" aria-label={`${tab} controls`}>
          {tab === 'figure' && figure && <>
            <label className="research-field">Figure name<input value={figure.name} onChange={(event) => edit((current) => ({ ...current, name: event.target.value }))} /></label>
            <h3>Figure size</h3>
            <label className="research-field">Sizing<FigureSelect aria-label="Figure sizing mode" value={figure.sizeMode ?? 'manual'} onChange={(value) => edit((current) => ({ ...current, sizeMode: value as 'auto' | 'manual' }))}><option value="auto">Auto · journal columns</option><option value="manual">Manual</option></FigureSelect></label>
            {figure.sizeMode === 'auto' && <p className="research-help">Auto: {figure.widthMm} × {figure.heightMm} mm. Uses Nature’s 89 / 183 mm column widths and adapts height to the panel grid, up to 170 mm. Check your target journal’s requirements; dense grids may need separate figures.</p>}
            <label className="research-field">Units<FigureSelect aria-label="Figure size units" value={sizeUnit} onChange={(value) => edit((current) => ({ ...current, sizeUnit: value as FigureUnit }))}><option value="mm">Millimeters (mm)</option><option value="cm">Centimeters (cm)</option><option value="in">Inches (in)</option><option value="px">Pixels (px)</option><option value="pt">Points (pt)</option></FigureSelect></label>
            <div className="research-two"><NumberField label="Width" unit={sizeUnit} value={Number((figure.widthMm / unitScale).toFixed(4))} onChange={(value) => { if (value !== null) edit((current) => ({ ...current, sizeMode: 'manual', widthMm: value * unitScale })); }} /><NumberField label="Height" unit={sizeUnit} value={Number((figure.heightMm / unitScale).toFixed(4))} onChange={(value) => { if (value !== null) edit((current) => ({ ...current, sizeMode: 'manual', heightMm: value * unitScale })); }} /></div>
            {(sizeUnit === 'px' || format === 'png') && <><NumberField label="Raster resolution" unit="DPI" value={dpi} onChange={(value) => edit((current) => ({ ...current, rasterDpi: Math.max(72, Math.min(1200, value ?? 600)) }))} /><p className="research-help">Pixels use this export DPI. Changing units keeps the physical size; changing DPI changes PNG pixel dimensions.</p></>}
            <h3>Panel grid</h3><div className="research-two"><NumberField label="Columns" value={figure.columns} onChange={(value) => edit((current) => ({ ...current, columns: Math.max(1, Math.min(6, Math.round(value ?? 1))) }))} /><NumberField label="Rows" value={figure.rows} onChange={(value) => edit((current) => ({ ...current, rows: value === null ? undefined : Math.max(requiredFigureRows(current.panels, current.columns), Math.min(64, Math.round(value))) }))} /></div>
            <p className="research-help">{Math.max(figure.rows ?? 1, requiredFigureRows(figure.panels, figure.columns))} rows × {figure.columns} columns. Clear Rows for Auto. Extra rows reserve empty space; the grid expands to keep every panel visible.</p>
            <div className="research-two"><button onClick={() => edit((current) => ({ ...current, sizeMode: 'manual', widthMm: 85, columns: 1 }))}>85 mm column</button><button onClick={() => edit((current) => ({ ...current, sizeMode: 'manual', widthMm: 180 }))}>180 mm wide</button></div>
            <h3>Shared style</h3><div className="research-two"><NumberField label="Font size" unit="pt" value={figure.fontPt} onChange={(value) => edit((current) => ({ ...current, fontPt: value ?? 9 }))} /><NumberField label="Line width" unit="pt" value={figure.lineWidthPt} onChange={(value) => edit((current) => ({ ...current, lineWidthPt: value ?? 0.7 }))} /></div><label className="research-field">Typeface<FigureSelect aria-label="Typeface" value={figure.fontFamily} onChange={(value) => edit((current) => ({ ...current, fontFamily: value as FigureDocument['fontFamily'] }))}><option value="sans">Sans serif</option><option value="serif">Serif</option><option value="mono">Monospace</option></FigureSelect></label><LabCheckbox className="research-check" checked={figure.showGrid} onCheckedChange={(showGrid) => edit((current) => ({ ...current, showGrid }))}>Show grid</LabCheckbox><LabCheckbox className="research-check" checked={figure.panelLabels} onCheckedChange={(panelLabels) => edit((current) => ({ ...current, panelLabels }))}>Panel letters</LabCheckbox><label className="research-field">Caption notes<textarea value={figure.caption} onChange={(event) => edit((current) => ({ ...current, caption: event.target.value }))} /></label>
            <h3>Reuse</h3><button disabled={busy} onClick={() => void run(async () => { await openFigure({ ...structuredClone(figure), id: newResearchId(), name: `${figure.name} copy` }); })}><Copy size={13} />Duplicate figure</button><button disabled={busy} onClick={() => void run(async () => { const template = figureTemplate(figure, datasets); const saved = await saveResearch(ownerId, 'templates', template, 0, cloud); upsertRecord(saved); setMessage(`Template saved${saved.status === 'synced' ? ' to cloud' : ' on this device'}. Choose matching sources to reuse it.`); })}>Save as template</button><button disabled={busy} onClick={() => void run(async () => { const archived = { ...figure, archived: true, updatedAt: new Date().toISOString() }; const { record: saved } = await saveFigureResearch(ownerId, archived, datasets, record?.localVersion ?? 0, cloud, false); upsertRecord(saved); await saveFigureDraft(ownerId, archived); setDrafts((items) => items.filter((item) => item.id !== figure.id)); setFigure(null); setMessage('Figure archived. Its sources and revisions are retained.'); })}>Archive figure</button><button type="button" disabled={busy} onClick={() => beginFigureAction('delete', figure)}><Trash2 size={13} />Delete figure</button>
          </>}
          {tab === 'panel' && panel && figure && <>
            {figure.panels.length > 1 && <label className="research-field">Panel<FigureSelect aria-label="Selected panel" value={panel.id} onChange={(value) => { setPanelId(value); setLayerId(''); }}>{figure.panels.map((item, index) => <option key={item.id} value={item.id}>{item.inset ? 'Inset' : `(${String.fromCharCode(97 + index)})`} {item.title || 'Panel'}</option>)}</FigureSelect></label>}
            <h3>Selected panel</h3><label className="research-field">Title<input value={panel.title} onChange={(event) => editPanel({ title: event.target.value })} /></label><div className="research-two"><button disabled={figure.panels[0].id === panel.id} onClick={() => movePanel(-1)}><ArrowUp size={12} />Earlier</button><button disabled={figure.panels.at(-1)?.id === panel.id} onClick={() => movePanel(1)}><ArrowDown size={12} />Later</button></div><NumberField label="Column span" value={panel.span} onChange={(value) => editPanel({ span: value ?? 1 })} /><LabCheckbox className="research-check" checked={panel.showLegend} onCheckedChange={(showLegend) => editPanel({ showLegend })}>Show legend</LabCheckbox><h3>Axis limits</h3><div className="research-two"><NumberField label="X minimum" value={panel.xMin} onChange={(xMin) => editPanel({ xMin })} /><NumberField label="X maximum" value={panel.xMax} onChange={(xMax) => editPanel({ xMax })} /><NumberField label="Y minimum" value={panel.yMin} onChange={(yMin) => editPanel({ yMin })} /><NumberField label="Y maximum" value={panel.yMax} onChange={(yMax) => editPanel({ yMax })} /></div><button onClick={() => editPanel({ xMin: null, xMax: null, yMin: null, yMax: null })}>Auto range</button>{energyLinkTargets.length > 0 && <label className="research-field">Link energy axis<FigureSelect aria-label="Link energy axis" value={panel.energyGroup ? figure.panels.find((item) => item.energyGroup === panel.energyGroup && item.id !== panel.id)?.id ?? 'linked' : ''} onChange={(value) => { const target = figure.panels.find((item) => item.id === value); if (!target) editPanel({ energyGroup: '' }); else { const group = target.energyGroup || newResearchId(); edit((current) => ({ ...current, panels: current.panels.map((item) => item.id === target.id || item.id === panel.id ? { ...item, energyGroup: group } : item) })); } }}><option value="">Independent</option>{energyLinkTargets.map((item, index) => <option key={item.id} value={item.id}>{item.title || `Panel ${index + 1}`}</option>)}</FigureSelect></label>}{energyLinkTargets.length > 0 && <p className="research-help">Changing an energy limit updates every linked panel. Auto range uses their combined coverage.</p>}
            {panel.pairingGroup && <button onClick={() => edit((current) => ({ ...current, panels: current.panels.map((item) => item.pairingGroup === panel.pairingGroup ? { ...item, pairingGroup: undefined } : item) }))}>Use as comparison panels</button>}<h3>Results in this panel</h3>{panel.layers.map((item) => <button key={item.id} aria-pressed={item.id === layer?.id} onClick={() => { setLayerId(item.id); setTab('data'); }}>{item.label || 'Result'}</button>)}<button disabled={!selectedData.length} onClick={() => editPanel({ layers: [...panel.layers, ...selectedData.map((dataset, index) => newLayer(dataset, panel.layers.length + index))] })}><Plus size={12} />Overlay selected results</button><button onClick={() => edit((current) => ({ ...current, panels: [...current.panels, { ...structuredClone(panel), layers: panel.layers.map((item) => ({ ...structuredClone(item), id: newResearchId() })), id: newResearchId(), pairingGroup: undefined, energyGroup: '', title: `${panel.title} copy` }] }))}>Duplicate panel</button>{!panel.inset && <button onClick={() => edit((current) => ({ ...current, panels: [...current.panels, { ...structuredClone(panel), layers: panel.layers.map((item) => ({ ...structuredClone(item), id: newResearchId() })), id: newResearchId(), title: '', pairingGroup: undefined, energyGroup: '', showLegend: false, inset: { parentId: panel.id, x: 0.55, y: 0.12, width: 0.4, height: 0.4 } }] }))}>Add inset from this panel</button>}{panel.inset && <div className="research-two">{(['x', 'y', 'width', 'height'] as const).map((key) => <NumberField key={key} label={`Inset ${key}`} value={panel.inset![key]} onChange={(value) => editPanel({ inset: { ...panel.inset!, [key]: value ?? panel.inset![key] } })} />)}</div>}<button disabled={figure.panels.filter((item) => !item.inset).length <= 1 && !panel.inset} onClick={() => edit((current) => removeFigurePanel(current, panel.id))}><Trash2 size={12} />Remove panel</button>
          </>}
          {tab === 'data' && metadataEdit ? <>
            <h3>Dataset metadata</h3><p className="research-help">Saving creates a new immutable dataset revision. Existing figures retain their original source.</p><label className="research-field">Name<input value={metadataEdit.name} onChange={(event) => setMetadataEdit({ ...metadataEdit, name: event.target.value })} /></label><label className="research-field">Source energy zero<FigureSelect aria-label="Source energy zero" value={metadataEdit.metadata.energy.kind} onChange={(value) => changeMetadata({ energy: { ...metadataEdit.metadata.energy, kind: value as 'fermi' | 'source' | 'unknown' } })}><option value="unknown">Not recorded</option><option value="fermi">Already relative to Fermi</option><option value="source">Original energy zero</option></FigureSelect></label>{(['fermiEv', 'vbmEv', 'vacuumEv'] as const).map((key) => <NumberField key={key} label={key === 'fermiEv' ? 'Fermi energy' : key === 'vbmEv' ? 'VBM energy' : 'Vacuum reference'} unit="eV, original zero" value={metadataEdit.metadata.energy[key]} onChange={(value) => changeMetadata({ energy: { ...metadataEdit.metadata.energy, [key]: value ?? undefined } })} />)}<label className="research-field">Reference evidence<input value={metadataEdit.metadata.energy.note ?? ''} onChange={(event) => changeMetadata({ energy: { ...metadataEdit.metadata.energy, note: event.target.value } })} /></label><h3>Parameter series</h3><label className="research-field">Parameter<input value={metadataEdit.metadata.condition?.parameter ?? 'strain'} onChange={(event) => changeMetadata({ condition: { ...metadataEdit.metadata.condition, parameter: event.target.value, value: metadataEdit.metadata.condition?.value ?? 0, unit: metadataEdit.metadata.condition?.unit ?? '%' } })} /></label><NumberField label="Parameter value" value={metadataEdit.metadata.condition?.value} onChange={(value) => changeMetadata({ condition: value == null ? undefined : { ...metadataEdit.metadata.condition, parameter: metadataEdit.metadata.condition?.parameter ?? 'strain', value, unit: metadataEdit.metadata.condition?.unit ?? '%' } })} /><label className="research-field">Parameter unit<input value={metadataEdit.metadata.condition?.unit ?? '%'} onChange={(event) => changeMetadata({ condition: { ...metadataEdit.metadata.condition, parameter: metadataEdit.metadata.condition?.parameter ?? 'strain', value: metadataEdit.metadata.condition?.value ?? 0, unit: event.target.value } })} /></label>{(['reference', 'relaxation'] as const).map((key) => <label className="research-field" key={key}>{key === 'reference' ? 'Reference structure / strain convention' : 'Relaxation protocol'}<input value={metadataEdit.metadata.condition?.[key] ?? ''} onChange={(event) => changeMetadata({ condition: { parameter: 'strain', value: 0, unit: '%', ...metadataEdit.metadata.condition, [key]: event.target.value } })} /></label>)}<h3>DOS normalization</h3><label className="research-field">Original basis<FigureSelect aria-label="Original basis" value={metadataEdit.metadata.dosBasis ?? 'unknown'} onChange={(value) => changeMetadata({ dosBasis: value as 'cell' | 'unknown' })}><option value="unknown">Not verified</option><option value="cell">States/eV/computational cell</option></FigureSelect></label><NumberField label="Atoms in cell" value={metadataEdit.metadata.atomCount} onChange={(value) => changeMetadata({ atomCount: value ?? undefined })} /><NumberField label="Formula units in cell" value={metadataEdit.metadata.formulaUnits} onChange={(value) => changeMetadata({ formulaUnits: value ?? undefined })} /><NumberField label="Cell volume" unit="angstrom^3" value={metadataEdit.metadata.volumeAngstrom3} onChange={(value) => changeMetadata({ volumeAngstrom3: value ?? undefined })} /><details className="research-details"><summary>Reciprocal path metadata</summary><p className="research-help">Recorded labels, tickIndices, breakIndices, segments, pointCoords and reciprocal basis. Do not infer a path from names alone.</p><textarea aria-label="Reciprocal path metadata JSON" rows={10} value={pathText} onChange={(event) => setPathText(event.target.value)} /></details><button disabled={busy} onClick={() => void run(async () => { const next = validateDataset(JSON.parse(JSON.stringify({ ...metadataEdit, id: newResearchId(), projectId, metadata: { ...metadataEdit.metadata, path: JSON.parse(pathText), provenance: { ...metadataEdit.metadata.provenance, metadataEditedFrom: metadataEdit.id } } }))); await keepDataset(next); setSelected([next.id]); setMetadataEdit(null); setMessage('New dataset revision saved and selected. Replace a figure source explicitly to use it.'); })}>Save new dataset revision</button><button onClick={() => setMetadataEdit(null)}>Close metadata</button>
          </> : tab === 'data' && layer && layerDataset ? <>
                        <h3>Selected result</h3>{layerDataset.metadata.orbitalProjection && <BandProjectionControls channels={layerDataset.metadata.orbitalProjection.channels} selected={layer.projectionIds} onChange={projectionIds => editLayer({ projectionIds })} />}{panel!.layers.length > 1 && <label className="research-field">Result / condition<FigureSelect aria-label="Result / condition" value={layer.id} onChange={(value) => setLayerId(value)}>{panel?.layers.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</FigureSelect></label>}<label className="research-field">Legend label<input value={layer.label} onChange={(event) => editLayer({ label: event.target.value })} /></label><div className="research-two"><div className="research-field"><span>Color</span><FigureColorField label="Result color" value={layer.color} onChange={(value) => editLayer({ color: value })} /></div><label className="research-field">Line<FigureSelect aria-label="Line" value={layer.lineStyle} onChange={(value) => editLayer({ lineStyle: value as FigureLayer['lineStyle'] })}><option value="solid">Solid</option><option value="dash">Dashed</option><option value="dot">Dotted</option><option value="dashdot">Dash-dot</option></FigureSelect></label></div><LabCheckbox className="research-check" checked={layer.visible} onCheckedChange={(visible) => editLayer({ visible })}>Show result</LabCheckbox>{layerDataset.data.quantities.length > 1 && <label className="research-field">Quantity<FigureSelect aria-label="Quantity" value={layer.quantityId} onChange={(value) => editLayer({ quantityId: value, seriesIds: null })}>{layerDataset.data.quantities.map((quantity) => <option key={quantity.id} value={quantity.id}>{quantity.label}</option>)}</FigureSelect></label>}{['band', 'dos', 'thermoelectric'].includes(layerDataset.data.kind) && <><label className="research-field">Energy alignment<FigureSelect aria-label="Energy alignment" value={layer.energy} onChange={(value) => editLayer({ energy: value as FigureLayer['energy'] })}><option value="source">Keep source reference</option><option value="fermi">Each Fermi = 0</option><option value="vbm">Each VBM = 0</option><option value="vacuum">Recorded vacuum reference</option><option value="manual">Manual shift</option></FigureSelect></label>{layer.energy === 'manual' && <NumberField label="Energy shift" unit="eV" value={layer.shiftEv} onChange={(value) => editLayer({ shiftEv: value ?? 0 })} />}<p className="research-help">Individual Fermi/VBM zeros compare shapes, not absolute band offsets.</p></>}{layerDataset.data.kind === 'dos' && <><label className="research-field">Normalize DOS<FigureSelect aria-label="Normalize DOS" value={layer.normalization} onChange={(value) => editLayer({ normalization: value as FigureLayer['normalization'] })}><option value="source">Keep source units</option><option value="atom">Per atom</option><option value="formula">Per formula unit</option><option value="volume">Per volume</option></FigureSelect></label><LabCheckbox className="research-check" checked={layer.energyVertical} onCheckedChange={(energyVertical) => editLayer({ energyVertical })}>Energy on vertical axis</LabCheckbox>{hasSpinDown && <LabCheckbox className="research-check" checked={layer.mirrorSpin} onCheckedChange={(mirrorSpin) => editLayer({ mirrorSpin })}>Mirror spin-down display</LabCheckbox>}</>}{layerDataset.data.kind === 'band' && <LabCheckbox className="research-check" checked={layer.normalizedPath} onCheckedChange={(normalizedPath) => editLayer({ normalizedPath })}>Normalize recorded path segments</LabCheckbox>}{(selectedQuantity?.series.length ?? 0) > 1 && <details className="research-details"><summary>Individual channels</summary>{layerDataset.data.quantities.find((item) => item.id === layer.quantityId)?.series.map((series, index) => <div className="research-channel" key={series.id}><LabCheckbox className="research-check" checked={!layer.seriesIds || layer.seriesIds.includes(series.id)} onCheckedChange={(checked) => { const all = layerDataset.data.quantities.find((item) => item.id === layer.quantityId)!.series.map((item) => item.id); editLayer({ seriesIds: checked ? [...new Set([...(layer.seriesIds ?? all), series.id])] : (layer.seriesIds ?? all).filter((id) => id !== series.id) }); }}>{series.label}</LabCheckbox><div className="research-channel-style"><FigureColorField label={`Color for ${series.label}`} value={layer.channelStyles?.[series.id]?.color ?? (index && !['band', 'phonon'].includes(layerDataset.data.kind) ? FIGURE_COLORS[index % FIGURE_COLORS.length] : layer.color)} onChange={(value) => editLayer({ channelStyles: { ...layer.channelStyles, [series.id]: { ...layer.channelStyles?.[series.id], color: value } } })} /><input aria-label={`Legend for ${series.label}`} placeholder={series.label} value={layer.channelStyles?.[series.id]?.label ?? ''} onChange={(event) => editLayer({ channelStyles: { ...layer.channelStyles, [series.id]: { ...layer.channelStyles?.[series.id], label: event.target.value } } })} /></div></div>)}</details>}{!!layerDataset.source.calculationId && <ComputeResourceDetails key={layerDataset.source.calculationId ?? layerDataset.id} calculationId={layerDataset.source.calculationId} resources={sourceJob?.computeResources} />}<label className="research-field">Replace source (keep style)<FigureSelect aria-label="Replace source (keep style)" value="" onChange={(value) => { const next = datasets.find((item) => item.id === value); if (next) void run(async () => editPanel({ title: replacementPanelTitle(panel!, layerDataset, next), layers: panel!.layers.map((item) => item.id === layer.id ? replaceLayerDataset(layer, layerDataset, next) : item) })); }}><option value="">Choose a result</option>{datasets.filter((item) => item.id !== layerDataset.id && (item.projectId === projectId || allProjects)).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</FigureSelect></label>{figure && figure.panels.flatMap((item) => item.layers).filter((entry) => entry.datasetId === layer.datasetId).length > 1 && <button onClick={() => edit((current) => ({ ...current, panels: current.panels.map((item) => ({ ...item, layers: item.layers.map((entry) => entry.datasetId === layer.datasetId ? { ...entry, color: layer.color, lineStyle: layer.lineStyle } : entry) })) }))}>Apply style to this result in all panels</button>}<button onClick={() => startMetadata(layerDataset)}>Edit metadata as new revision</button><details className="research-details"><summary>Source details</summary><p>{layerDataset.source.filename}</p><p className="research-hash">SHA-256 {layerDataset.source.sha256}</p><pre>{JSON.stringify({ source: { ...layerDataset.source, text: undefined }, metadata: layerDataset.metadata }, null, 2)}</pre></details><button disabled={panel!.layers.length <= 1} onClick={() => editPanel({ layers: panel!.layers.filter((item) => item.id !== layer.id) })}>Remove result from panel</button>
          </> : tab === 'data' && <p className="research-help">Choose a panel result, or open metadata beside a dataset.</p>}
          {tab === 'history' && figure && <><h3>Saved revisions</h3><p className="research-help">Changes autosave to cloud. Saved versions and the latest autosave appear here.</p>{record?.history.slice().reverse().map((version, index) => <button key={`${version.savedAt}-${index}`} onClick={() => edit(() => structuredClone(version.document))}>{new Date(version.savedAt).toLocaleString()}<small>{version.autosave ? 'Latest autosave on this device' : 'Saved on this device'}</small></button>)}{cloud && <button disabled={busy} onClick={() => void run(async () => { const loaded = await cloudFigureRevision(figure.id); setCloudHistory(loaded.metadata.history.slice().reverse()); })}>Load cloud history</button>}{cloudHistory.map((version) => <button key={version.revision} disabled={busy} onClick={() => void run(async () => { const loaded = await cloudFigureRevision(figure.id, version.revision); edit(() => loaded.document); })}>{version.autosave ? 'Latest cloud autosave' : `Cloud revision ${version.revision}`}<small>{new Date(version.savedAt).toLocaleString()}</small></button>)}{record?.status === 'conflict' && <><p role="alert">A different revision exists in cloud. Your local version is retained.</p><button disabled={busy} onClick={() => void run(async () => { const latest = await acceptCloudFigure(ownerId, figure.id); upsertRecord(latest); await openFigure(latest.document); await saveFigureDraft(ownerId, latest.document, { replace: true }); setDrafts((items) => items.filter((item) => item.id !== latest.document.id)); })}>Use latest cloud revision</button><button onClick={() => { setFigure({ ...figure, id: newResearchId(), name: `${figure.name} local copy` }); setPast([]); setFuture([]); }}>Keep local as a new figure</button></>}</>}
          {!figure && tab !== 'data' && <p className="research-help">Create or open a figure to edit its panels, style and revisions.</p>}
        </div>
      </aside>
    </div>
    <span className="sr-only" role="status" aria-live="polite">{busy ? 'Working...' : message}</span>
  </section>;
}

'use client';

import { ScfConvergenceMonitor } from './ScfConvergenceMonitor';

import { completedExecutionAccepted } from '@/lib/execution-jobs';
import { formatRunDate } from '@/lib/run-date';
import { DftStudyDownload } from '@/components/DftStudyDownload';

import {
  Activity,
  ArrowDown,
  ArrowUp,
  ChartNoAxesCombined,
  ChartSpline,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock3,
  Copy,
  Database,
  FileDown,
  GripVertical,
  ImageDown,
  Loader2,
  Maximize2,
  MoreHorizontal,
  Minimize2,
  Play,
  Plus,
  MoveDiagonal2,
  Save,
  Sparkles,
  Search,
  Sigma,
  SlidersHorizontal,
  CircleStop,
  ThermometerSun,
  Trash2,
  Waves,
  X,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ComputeResourceDetails } from '@/components/ComputeResourceDetails';
import { ComputeDestination } from '@/components/ComputeDestination';
import { UiSelect } from '@/components/UiSelect';
import { LabCheckbox } from '@/components/LabControls';
import type { CalculationConfiguration, CalculationJob, CalculationType, JobDraft, MaterialContext } from '@/components/JobComposer';
import type { ResultPlotCompanion } from '@/components/ResultPlotEditor';
import { summarizeJobDraft } from '@/components/JobComposer';
import { PhyniteApiError, phyniteCalculations } from '@/lib/phynite-api';
import { downloadRenderedPlotArchive, downloadRenderedPlotPng } from '@/lib/plot-download';
import {
  defaultScientificPlotSettings,
  mergeScientificPlotSettings,
  parseScientificPlotCsv,
  plotDownloadFilename,
  renderScientificPlotExports,
  renderScientificPlotSvg,
  type ScientificPlotExport,
  type ScientificPlotSettings,
} from '@/lib/result-plot';
import { cn } from '@/lib/utils';
import { bandDosCompatibility } from '@/lib/electronic-plot-pairing';

type View = 'dft' | 'log' | 'library';

export type CalculationComponentInstance = {
  geometry?: import('@/lib/workflow-geometry').GeometryOperation;
  sweep?: import('@/lib/workflow-operations').ParameterSweep;
  neb?: import('@/lib/workflow-operations').NebOperation;
  scfSourceId?: string;
  scfReuse?: import('@/lib/dft-workflow').ScfReusePolicy;
  id: string;
  materialId: string;
  calculation: CalculationType;
  name: string;
  selected: boolean;
  structureSourceId: 'original' | string;
  draft: JobDraft;
};

const options: Array<{ id: CalculationType; label: string; code: string; tool: string; detail: string; icon: LucideIcon }> = [
  { id: 'Total energy', label: 'Total energy', code: 'pw.x · scf', tool: 'QE', detail: 'SCF ground-state energy', icon: Sigma },
  { id: 'Structural relaxation', label: 'Structural relaxation', code: 'pw.x · relax / vc-relax', tool: 'QE', detail: 'Optimize ions or the full cell', icon: MoveDiagonal2 },
  { id: 'Band structure', label: 'Band structure', code: 'pw.x · bands.x', tool: 'QE', detail: 'Electronic bands along a k-path', icon: ChartSpline },
  { id: 'Density of states', label: 'Density of states', code: 'pw.x · dos.x · projwfc.x', tool: 'QE', detail: 'Total and projected DOS', icon: ChartNoAxesCombined },
  { id: 'Phonon dispersion', label: 'Phonon dispersion', code: 'ph.x · q2r.x · matdyn.x', tool: 'QE', detail: 'Lattice dynamics and phonons', icon: Waves },
  { id: 'Thermoelectric properties', label: 'Thermoelectric properties', code: 'QE · NSCF → GENE · BoltzTraP2', tool: 'QE + BoltzTraP2', detail: 'Seebeck, conductivity, and power factor', icon: ThermometerSun },
];

function Status({ value, showLabel = false }: { value: CalculationJob['status'] | 'Ready' | 'Not configured'; showLabel?: boolean }) {
  if (value === 'Completed') {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5" title="Status: Completed (Output ready)" aria-label="Status: Completed">
        <CheckCircle2 className="h-3.5 w-3.5 text-[#4ea86e]" strokeWidth={2.5} />
        {showLabel && <span className="text-[9px] font-medium text-[#4ea86e]">Completed</span>}
      </span>
    );
  }
  if (value === 'Failed') {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5" title="Status: Failed (SCF convergence error)" aria-label="Status: Failed">
        <XCircle className="h-3.5 w-3.5 text-[#cf5b62]" strokeWidth={2.5} />
        {showLabel && <span className="text-[9px] font-medium text-[#cf5b62]">Failed</span>}
      </span>
    );
  }
  if (value === 'Running') {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5" title="Status: Running Quantum ESPRESSO" aria-label="Status: Running">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--panel-text)]" strokeWidth={2.5} />
        {showLabel && <span className="text-[9px] font-medium text-[var(--panel-text)]">Running</span>}
      </span>
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5" title={`Status: ${value === 'Draft' ? 'Ready to run' : value}`} aria-label={`Status: ${value === 'Draft' ? 'Ready' : value}`}>
      <Circle className="h-3.5 w-3.5 text-[var(--panel-muted)] opacity-70" strokeDasharray="2.5 2.5" strokeWidth={2} />
      {showLabel && <span className="text-[9px] font-medium text-[var(--panel-muted)]">{value === 'Draft' ? 'Ready' : value}</span>}
    </span>
  );
}

type ResultArtifact = NonNullable<CalculationJob['resultArtifacts']>[number];

function plotDataArtifact(job: CalculationJob) {
  return job.resultArtifacts?.find((artifact) => artifact.role === 'data' && (artifact.contentType.includes('csv') || artifact.path.toLowerCase().endsWith('.csv')));
}

function artifactFilename(artifact: ResultArtifact) {
  return artifact.path.split('/').filter(Boolean).at(-1) ?? artifact.label;
}

function formatArtifactDeadline(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function dispatchHiddenDownload(url: string) {
  const frame = document.createElement('iframe');
  frame.src = url;
  frame.hidden = true;
  frame.setAttribute('aria-hidden', 'true');
  document.body.appendChild(frame);
  window.setTimeout(() => frame.remove(), 60_000);
}

async function downloadResultArtifact(artifact: ResultArtifact) {
  const filename = artifactFilename(artifact);
  let response: Response;
  try {
    response = await fetch(artifact.downloadUrl, { cache: 'no-store', credentials: artifact.downloadUrl.startsWith('/api/cloud-artifacts/') ? 'same-origin' : 'omit' });
  } catch {
    dispatchHiddenDownload(artifact.downloadUrl);
    return;
  }
  if (!response.ok) throw new Error(`Artifact download failed with ${response.status}`);
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
}

function plotDataUrl(artifact: ResultArtifact, backendCalculationId?: string) {
  if (!backendCalculationId) return artifact.viewUrl ?? artifact.downloadUrl;
  const query = new URLSearchParams({ calculationId: backendCalculationId, path: artifact.path });
  return `/api/calculation-artifact?${query.toString()}`;
}

function PlotPreviewDialog({ open, artifact, previewUrl, calculationName, downloading, multiPlotDownload, onClose, onDownload, onEdit }: {
  open: boolean;
  artifact: ResultArtifact;
  previewUrl: string;
  calculationName: string;
  downloading: boolean;
  multiPlotDownload?: boolean;
  onClose: () => void;
  onDownload: () => void;
  onEdit?: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    closeRef.current?.focus();
    return () => {
      window.removeEventListener('keydown', closeOnEscape);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [onClose, open]);

  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div className="plot-preview-overlay fixed inset-0 z-[180] grid place-items-center p-2 backdrop-blur-[2px] sm:p-3" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-label={`${calculationName} result plot`} className="plot-preview workspace-dark-surface flex h-[calc(100dvh-16px)] w-full max-w-[1600px] flex-col overflow-hidden rounded-[9px] border border-[#34373d] bg-[#0d0f12] shadow-[0_28px_100px_rgba(0,0,0,.58)] sm:h-[calc(100dvh-24px)]">
        <header className="plot-preview-header flex h-12 shrink-0 items-center gap-3 border-b border-[#2c3036] px-3 sm:px-4">
          <span className="plot-preview-raised grid h-7 w-7 shrink-0 place-items-center rounded-[5px] border border-[#343a43] bg-[#171a1f] text-[#9aa6b3]"><ChartNoAxesCombined className="h-3.5 w-3.5" /></span>
          <span className="min-w-0 flex-1"><span className="block truncate text-[11px] font-semibold text-[#eef1f4]">{calculationName}</span><span className="block truncate font-mono text-[8px] text-[#89929d]">{artifact.label}</span></span>
          {onEdit && <button type="button" onClick={onEdit} className="flex h-8 shrink-0 items-center gap-1.5 rounded-[5px] border border-[#373d46] px-2.5 text-[9px] font-medium text-[#c8d0d9] hover:bg-[#1b1f25]"><SlidersHorizontal className="h-3.5 w-3.5" />Open in Figure Lab</button>}
          <button type="button" disabled={downloading} onClick={onDownload} className="flex h-8 shrink-0 items-center gap-1.5 rounded-[5px] border border-[#373d46] px-2.5 text-[9px] font-medium text-[#c8d0d9] hover:bg-[#1b1f25] disabled:opacity-50"><ImageDown className="h-3.5 w-3.5" />{downloading ? 'Downloading…' : multiPlotDownload ? 'Download 4 PNGs' : artifact.contentType === 'image/png' ? 'Download PNG' : 'Download plot'}</button>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close plot preview" className="grid h-8 w-8 shrink-0 place-items-center rounded-[5px] text-[#969fa9] hover:bg-[#1b1f25] hover:text-white"><X className="h-4 w-4" /></button>
        </header>
        <div className="plot-preview-stage grid min-h-0 flex-1 place-items-center overflow-auto bg-[#090a0c] p-2 sm:p-4">
          {/* Signed scientific artifacts are remote and have runtime dimensions. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUrl} alt={`${calculationName} enlarged result plot`} className="plot-preview-image max-h-full max-w-full object-contain shadow-[0_0_0_1px_rgba(255,255,255,.06)]" />
        </div>
        <footer className="plot-preview-footer flex h-8 shrink-0 items-center justify-between border-t border-[#24272c] px-3 font-mono text-[8px] text-[#747d88] sm:px-4"><span>{artifactFilename(artifact)}</span><span>Esc to close</span></footer>
      </section>
    </div>,
    document.body,
  );
}

function LogJobRow({ job, compatibleCompanions, onDeleteJob, onCancelJob, onAddToFigure, onRenameJob }: {
  job: CalculationJob;
  compatibleCompanions: ResultPlotCompanion[];
  onRenameJob?: (id: string, name: string) => void;
  onDeleteJob: (id: string) => void;
  onCancelJob: (id: string) => void;
  onAddToFigure?: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(job.status === 'Queued' || job.status === 'Running');
  const [actionsOpen, setActionsOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [runName, setRunName] = useState(job.name);
  const [failedPreviewUrl, setFailedPreviewUrl] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewRefreshAttempted, setPreviewRefreshAttempted] = useState(false);
  const [downloadingPath, setDownloadingPath] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [refreshedArtifacts, setRefreshedArtifacts] = useState<ResultArtifact[] | null>(null);
  const [retentionExpired, setRetentionExpired] = useState(false);
  const [editedPreviewSvg, setEditedPreviewSvg] = useState<string | null>(null);
  const [editedPreviewUrl, setEditedPreviewUrl] = useState<string | null>(null);
  const [editedPlotExports, setEditedPlotExports] = useState<ScientificPlotExport[]>([]);
  const [editedPreviewSettingsKey, setEditedPreviewSettingsKey] = useState<string | null>(null);
  const [previewRenderError, setPreviewRenderError] = useState<string | null>(null);
  const [diagnosis, setDiagnosis] = useState<string | null>(null);
  const [diagnosisError, setDiagnosisError] = useState<string | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);
  const editedPreviewSettingsKeyRef = useRef<string | null>(null);
  const editedPreviewUrlRef = useRef<string | null>(null);
  const actionRef = useRef<HTMLDivElement>(null);
  const artifactDeadline = formatArtifactDeadline(job.artifactsExpireAt);
  const artifactsExpired = job.artifactsExpired || retentionExpired;
  const artifacts = artifactsExpired ? [] : refreshedArtifacts ?? job.resultArtifacts ?? [];
  const preferredOutputNames: Record<string, string[]> = {
    'Band structure': ['bands-postprocess.out', 'bands-nscf.out', 'scf.out'],
    'Density of states': ['projected-dos.out', 'dos-postprocess.out', 'dos-nscf.out', 'scf.out'],
    'Phonon dispersion': ['phonon-dispersion.out', 'phonon.out', 'scf.out'],
    'Thermoelectric properties': ['boltztrap2-integrate.out', 'boltztrap2-interpolate.out', 'nscf-transport.out', 'scf.out'],
    'Structural relaxation': ['relax.out'],
    'Total energy': ['scf.out'],
  };
  const logArtifacts = artifacts.filter((artifact) => artifact.role === 'log');
  const outputArtifact = (preferredOutputNames[job.calculationType ?? ''] ?? [])
    .map((name) => logArtifacts.find((artifact) => artifact.path.toLowerCase().endsWith(`/${name}`) || artifact.path.toLowerCase() === name))
    .find(Boolean)
    ?? logArtifacts.at(-1);
  const imageArtifacts = artifacts.filter((artifact) => artifact.role === 'plot' && artifact.contentType.startsWith('image/'));
  const plotArtifact = imageArtifacts.find((artifact) => artifact.contentType === 'image/png' && !artifact.path.toLowerCase().includes('full-range'))
    ?? imageArtifacts.find((artifact) => artifact.contentType === 'image/png')
    ?? imageArtifacts.find((artifact) => !artifact.path.toLowerCase().includes('full-range'))
    ?? imageArtifacts[0];
  const previewUrl = plotArtifact?.viewUrl ?? plotArtifact?.downloadUrl;
  const dataArtifact = artifacts.find((artifact) => artifact.role === 'data' && (artifact.contentType.includes('csv') || artifact.path.toLowerCase().endsWith('.csv')));
  const savedSettingsKey = job.plotSettings ? JSON.stringify(job.plotSettings) : null;
  const pairUnavailable = job.plotSettings?.layout === 'band-dos' && !compatibleCompanions.some((candidate) => candidate.jobId === job.plotSettings?.pairedJobId);
  const currentEditedPreview = !artifactsExpired && !pairUnavailable && editedPreviewSettingsKey === savedSettingsKey && !!editedPreviewSvg;
  const displayPreviewUrl = artifactsExpired || pairUnavailable ? undefined : currentEditedPreview ? editedPreviewUrl : job.plotSettings ? undefined : previewUrl;
  const cancellationPending = job.cancelRequested === true;
  const cancellable = !cancellationPending && (job.status === 'Queued' || job.status === 'Running');
  const plottable = job.status === 'Completed' && ['Band structure', 'Density of states', 'Phonon dispersion', 'Thermoelectric properties'].includes(job.calculationType ?? '');
  const detailsId = `calculation-log-${job.id}`;
  const closePreview = useCallback(() => setPreviewOpen(false), []);
  const diagnoseFailure = async () => {
    if (!job.backendCalculationId || diagnosing) return;
    setDiagnosing(true);
    setDiagnosisError(null);
    try {
      const payload = await phyniteCalculations.diagnose(job.backendCalculationId);
      setDiagnosis(payload.diagnosis);
    } catch (error) {
      setDiagnosisError(error instanceof PhyniteApiError ? error.message : 'The calculation assistant is unavailable');
    } finally {
      setDiagnosing(false);
    }
  };
  const replaceEditedPreview = useCallback((svg: string | null, settingsKey: string | null, exports: ScientificPlotExport[] = []) => {
    if (editedPreviewUrlRef.current) URL.revokeObjectURL(editedPreviewUrlRef.current);
    const objectUrl = svg ? URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })) : null;
    editedPreviewUrlRef.current = objectUrl;
    editedPreviewSettingsKeyRef.current = settingsKey;
    setEditedPreviewSettingsKey(settingsKey);
    setPreviewRenderError(null);
    setEditedPreviewSvg(svg);
    setEditedPreviewUrl(objectUrl);
    setEditedPlotExports(exports);
  }, []);
  const refreshArtifacts = useCallback(async () => {
    if (!job.backendCalculationId) throw new Error('This calculation has no cloud artifact record');
    const payload = await phyniteCalculations.get(job.backendCalculationId);
    if (payload.artifactsExpired) {
      setRetentionExpired(true);
      throw new Error('Result files expired after the 3-day retention window');
    }
    const next = payload.result?.artifacts ?? [];
    if (!next.length) throw new Error('Result files are not available');
    setRefreshedArtifacts(next);
    return next;
  }, [job.backendCalculationId]);
  const loadCompanionPlotData = useCallback(async (plotSettings: ScientificPlotSettings, signal?: AbortSignal) => {
    if (plotSettings.layout !== 'band-dos') return null;
    const companion = compatibleCompanions.find((candidate) => candidate.jobId === plotSettings.pairedJobId);
    if (!companion) throw new Error('The verified Band/DOS pair is no longer available');
    const response = await fetch(plotDataUrl(companion.dataArtifact, companion.backendCalculationId), {
      cache: 'no-store',
      credentials: companion.backendCalculationId ? 'same-origin' : 'omit',
      signal,
    });
    if (!response.ok) throw new Error(`Matched ${companion.calculationType} data is unavailable (${response.status})`);
    return parseScientificPlotCsv(await response.text(), companion.calculationType);
  }, [compatibleCompanions]);
  const handleDownload = async (artifact: ResultArtifact) => {
    setActionsOpen(false);
    setDownloadError(null);
    setDownloadingPath(artifact.path);
    try {
      await downloadResultArtifact(artifact);
    } catch (error) {
      try {
        const refreshed = await refreshArtifacts();
        const replacement = refreshed.find((candidate) => candidate.path === artifact.path);
        if (!replacement) throw error;
        await downloadResultArtifact(replacement);
      } catch (refreshError) {
        setDownloadError(refreshError instanceof Error ? refreshError.message : 'Artifact download failed');
      }
    } finally {
      setDownloadingPath(null);
    }
  };
  const handlePlotDownload = async () => {
    setActionsOpen(false);
    setDownloadError(null);
    if (!plotArtifact) return;
    let plotSvg = currentEditedPreview ? editedPreviewSvg : null;
    let plotExports = currentEditedPreview ? editedPlotExports : [];
    let plotSettings = job.plotSettings;
    if (pairUnavailable) {
      setDownloadError('The selected Band/DOS result is unavailable. Open Figure Lab to select compatible results');
      return;
    }
    const missingThermoelectricExports = job.calculationType === 'Thermoelectric properties' && plotExports.length !== 4;
    const missingCustomizedPlot = !!plotSettings && !plotSvg;
    if ((missingThermoelectricExports || missingCustomizedPlot) && !dataArtifact) {
      setDownloadError('The data needed to render this figure is no longer available');
      return;
    }
    if ((missingThermoelectricExports || missingCustomizedPlot) && dataArtifact) {
      setDownloadingPath(plotArtifact.path);
      try {
        const response = await fetch(plotDataUrl(dataArtifact, job.backendCalculationId), {
          cache: 'no-store',
          credentials: job.backendCalculationId ? 'same-origin' : 'omit',
        });
        if (!response.ok) throw new Error(`Plot data is unavailable (${response.status})`);
        const plotData = parseScientificPlotCsv(await response.text(), job.calculationType);
        plotSettings = mergeScientificPlotSettings(defaultScientificPlotSettings(plotData), job.plotSettings ?? {});
        const companionData = await loadCompanionPlotData(plotSettings);
        plotSvg = renderScientificPlotSvg(plotData, plotSettings, companionData);
        plotExports = renderScientificPlotExports(plotData, plotSettings, companionData);
        replaceEditedPreview(plotSvg, JSON.stringify(plotSettings), plotExports);
      } catch (error) {
        setDownloadError(error instanceof Error ? error.message : 'Plot export failed');
        setDownloadingPath(null);
        return;
      }
    }
    if (plotExports.length === 4 && plotSettings) {
      setDownloadingPath(plotArtifact.path);
      try {
        await downloadRenderedPlotArchive(plotExports, 'png', plotSettings.exportScale, 'thermoelectric-properties-png.zip');
      } catch (error) {
        setDownloadError(error instanceof Error ? error.message : 'Thermoelectric plot export failed');
      } finally {
        setDownloadingPath(null);
      }
      return;
    }
    if (!plotSvg || !plotSettings) {
      if (plotArtifact) await handleDownload(plotArtifact);
      return;
    }
    setDownloadingPath(plotArtifact.path);
    try {
      await downloadRenderedPlotPng(
        plotSvg,
        plotSettings.width,
        plotSettings.height,
        plotSettings.exportScale,
        plotDownloadFilename(plotSettings.layout === 'band-dos' ? 'Electronic structure band DOS' : job.name, 'png'),
      );
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : 'Customized plot download failed');
    } finally {
      setDownloadingPath(null);
    }
  };
  const handlePreviewError = async () => {
    if (editedPreviewUrl) {
      replaceEditedPreview(null, null, []);
      return;
    }
    if (!previewRefreshAttempted && job.backendCalculationId) {
      setPreviewRefreshAttempted(true);
      try {
        await refreshArtifacts();
        return;
      } catch (refreshError) {
        setDownloadError(refreshError instanceof Error ? refreshError.message : 'Plot preview refresh failed');
      }
    }
    if (previewUrl) setFailedPreviewUrl(previewUrl);
  };

  useEffect(() => {
    return () => {
      if (editedPreviewUrlRef.current) URL.revokeObjectURL(editedPreviewUrlRef.current);
    };
  }, []);

  useEffect(() => {
    const savedSettings = job.plotSettings;
    const settingsKey = savedSettings ? JSON.stringify(savedSettings) : null;
    if (!savedSettings || !dataArtifact) {
      editedPreviewSettingsKeyRef.current = null;
      return;
    }
    if ((!expanded && !previewOpen) || pairUnavailable || editedPreviewSettingsKeyRef.current === settingsKey) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(plotDataUrl(dataArtifact, job.backendCalculationId), {
          cache: 'no-store',
          credentials: job.backendCalculationId ? 'same-origin' : 'omit',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Plot data is unavailable (${response.status})`);
        const plotData = parseScientificPlotCsv(await response.text(), job.calculationType);
        const settings = mergeScientificPlotSettings(defaultScientificPlotSettings(plotData), savedSettings);
        const companionData = await loadCompanionPlotData(settings, controller.signal);
        const svg = renderScientificPlotSvg(plotData, settings, companionData);
        const exports = renderScientificPlotExports(plotData, settings, companionData);
        if (controller.signal.aborted) return;
        replaceEditedPreview(svg, settingsKey, exports);
      } catch (error) {
        if (!controller.signal.aborted) {
          editedPreviewSettingsKeyRef.current = null;
          setPreviewRenderError(error instanceof Error ? error.message : 'The customized preview could not be loaded');
        }
      }
    })();
    return () => controller.abort();
  }, [dataArtifact, expanded, job.backendCalculationId, job.calculationType, job.plotSettings, loadCompanionPlotData, pairUnavailable, previewOpen, replaceEditedPreview]);

  useEffect(() => {
    if (!actionsOpen) return;
    const closeOnOutsideInteraction = (event: PointerEvent) => {
      if (!actionRef.current?.contains(event.target as Node)) setActionsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActionsOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsideInteraction);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideInteraction);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [actionsOpen]);

  return <><article className="execution-job" data-status={job.status}>
    <div className="flex items-start gap-1.5">
      <button type="button" aria-expanded={expanded} aria-controls={detailsId} onClick={() => setExpanded((current) => !current)} className="group flex min-w-0 flex-1 items-start gap-2 rounded-[5px] text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--line-strong)]/25">
        <ChevronDown className={cn('mt-0.5 h-3.5 w-3.5 shrink-0 text-[#9aa0a7] transition-transform duration-150', !expanded && '-rotate-90')} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2"><span className="execution-job-name">{job.name}</span><Status value={job.status} showLabel /></span>
          <span className="execution-job-summary">{job.calculationType}</span>
          <span className="execution-job-summary" title="Run time in your local timezone">{job.completedAt ? 'Completed' : 'Started'} {formatRunDate(job.completedAt ?? job.startedAt)} · {job.id.slice(-8)}</span>
        </span>
      </button>
      <div ref={actionRef} className="relative shrink-0">
        <button type="button" aria-expanded={actionsOpen} aria-haspopup="menu" aria-label={`More actions for ${job.name}`} onClick={() => setActionsOpen((current) => !current)} className="grid h-7 w-7 place-items-center rounded-[5px] text-[var(--panel-muted)] hover:bg-[var(--panel-hover)] hover:text-[var(--panel-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--line-strong)]/25"><MoreHorizontal className="h-4 w-4" /></button>
        {actionsOpen && <div role="menu" className="workspace-popover-motion absolute right-0 top-8 z-40 w-48 overflow-hidden rounded-[7px] border border-[var(--panel-border)] bg-[var(--panel-raised)] p-1 shadow-[0_12px_32px_rgba(0,0,0,.35)]">
          {onRenameJob && <button role="menuitem" type="button" onClick={() => { setRunName(job.name); setRenaming(true); setActionsOpen(false); }} className="flex min-h-9 w-full items-center gap-2 rounded-[5px] px-2.5 text-left text-[10px] font-medium text-[var(--panel-text)] hover:bg-[var(--panel-hover)]">Rename result</button>}
          {job.status === 'Completed' && dataArtifact && !artifactsExpired && <div className="execution-result-actions"><button type="button" disabled={downloadingPath === dataArtifact.path} onClick={() => void handleDownload(dataArtifact)}><FileDown className="h-3.5 w-3.5" />Export Dataset (CSV)</button><span>All source samples</span></div>}
    {onAddToFigure && plottable && <button role="menuitem" type="button" onClick={() => { setActionsOpen(false); onAddToFigure(job.id); }} className="flex min-h-9 w-full items-center gap-2 rounded-[5px] px-2.5 text-left text-[10px] font-medium text-[var(--panel-text)] hover:bg-[var(--panel-hover)]"><Plus className="h-3.5 w-3.5" />Open in Figure Lab</button>}

          {outputArtifact ? <button role="menuitem" type="button" disabled={downloadingPath !== null} onClick={() => void handleDownload(outputArtifact)} className="flex min-h-9 w-full items-center gap-2 rounded-[5px] px-2.5 text-left text-[10px] font-medium text-[var(--panel-text)] hover:bg-[var(--panel-hover)] disabled:opacity-50"><FileDown className="h-3.5 w-3.5" /><span className="min-w-0"><span className="block">{downloadingPath === outputArtifact.path ? 'Downloading output…' : 'Download output file'}</span><span className="block truncate font-mono text-[8px] font-normal text-[var(--panel-muted)]">{outputArtifact.label}</span></span></button> : <span aria-disabled="true" className="flex min-h-9 w-full cursor-not-allowed items-center gap-2 rounded-[5px] px-2.5 text-[10px] text-[var(--panel-muted)]"><FileDown className="h-3.5 w-3.5" />Output file unavailable</span>}
          {plotArtifact ? <button role="menuitem" type="button" disabled={downloadingPath !== null} onClick={() => void handlePlotDownload()} className="flex min-h-9 w-full items-center gap-2 rounded-[5px] px-2.5 text-left text-[10px] font-medium text-[var(--panel-text)] hover:bg-[var(--panel-hover)] disabled:opacity-50"><ImageDown className="h-3.5 w-3.5" /><span className="min-w-0"><span className="block">{downloadingPath === plotArtifact.path ? 'Downloading plot…' : 'Download plot'}</span><span className="block truncate font-mono text-[8px] font-normal text-[var(--panel-muted)]">{job.calculationType === 'Thermoelectric properties' ? 'ZIP · 4 separate PNG figures' : editedPreviewSvg ? `Customized PNG · ${job.plotSettings?.exportScale ?? 1}×` : plotArtifact.contentType === 'image/png' ? 'PNG · 600 dpi' : plotArtifact.contentType}</span></span></button> : <span aria-disabled="true" className="flex min-h-9 w-full cursor-not-allowed items-center gap-2 rounded-[5px] px-2.5 text-[10px] text-[var(--panel-muted)]"><ImageDown className="h-3.5 w-3.5" />Plot image unavailable</span>}
          <div className="my-1 border-t border-[var(--panel-border)]" />
          <button role="menuitem" type="button" onClick={() => { if (cancellable) onCancelJob(job.id); else onDeleteJob(job.id); setActionsOpen(false); }} className={cn('flex h-8 w-full items-center gap-2 rounded-[5px] px-2.5 text-[10px] font-medium', cancellable ? 'text-amber-500 hover:bg-[var(--panel-hover)]' : 'text-rose-500 hover:bg-[var(--panel-hover)]')}>{cancellable ? <CircleStop className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}{cancellable ? 'Cancel calculation' : cancellationPending ? 'Remove from log' : 'Delete log entry'}</button>
        </div>}
      </div>
    </div>
    {renaming && <form className="execution-rename-form" onSubmit={(event) => { event.preventDefault(); if (runName.trim()) { onRenameJob?.(job.id, runName.trim()); setRenaming(false); } }}><label>Result name<input autoFocus required maxLength={200} value={runName} onChange={(event) => setRunName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); setRenaming(false); } }} /></label><div><button type="button" onClick={() => setRenaming(false)}>Cancel</button><button type="submit" disabled={!runName.trim()}>Save name</button></div></form>}
    {onAddToFigure && plottable && <div className="execution-result-actions"><button type="button" onClick={() => onAddToFigure(job.id)}><ChartNoAxesCombined className="h-3.5 w-3.5" />Open in Figure Lab</button><span>Compare, style &amp; export</span></div>}
    {job.status === 'Running' && <ScfConvergenceMonitor evidence={job.scfConvergence} />}
    {(job.backendCalculationId || job.computeResources) && <ComputeResourceDetails calculationId={job.backendCalculationId} resources={job.computeResources} running={job.status === 'Running'} />}
    {expanded && <div id={detailsId} className="execution-job-details"><p className="execution-settings">{job.settings}</p>
      {job.status === 'Completed' && job.backendCalculationId && !artifactsExpired && <DftStudyDownload calculationId={job.backendCalculationId} name={job.name} />}
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[9px] tabular-nums text-[#878a8f]"><span className="flex min-w-0 items-center gap-1.5"><Clock3 className="h-2.5 w-2.5 shrink-0 text-[#9a9da2]" /><span className="truncate">Started {formatRunDate(job.startedAt ?? job.updated)}</span></span><span className="flex min-w-0 items-center gap-1.5"><Activity className="h-2.5 w-2.5 shrink-0 text-[#9a9da2]" /><span className="truncate">{job.status === 'Running' ? job.duration ?? 'Running' : `Duration ${job.duration ?? '—'}`}</span></span>{job.completedAt && <span className="col-span-2 flex min-w-0 items-center gap-1.5"><ChevronRight className="h-2.5 w-2.5 shrink-0 text-[#9a9da2]" /><span className="truncate">Completed {formatRunDate(job.completedAt)}</span></span>}{artifactDeadline && <span className="col-span-2 flex min-w-0 items-center gap-1.5"><Clock3 className="h-2.5 w-2.5 shrink-0 text-[#9a9da2]" /><span className="truncate">{artifactsExpired ? 'Files expired' : `Files available until ${artifactDeadline}`}</span></span>}</div>
      {job.status === 'Running' && <div className="mt-2"><div className="mb-1 flex items-center justify-between text-[9px] tabular-nums text-[var(--panel-muted)]"><span>{job.result ?? 'Running Quantum ESPRESSO'}</span><span>{job.progress ?? 0}%</span></div><div className="h-1 overflow-hidden rounded-full bg-[var(--panel-border)]"><i style={{ width: `${job.progress ?? 0}%` }} className="block h-full rounded-full bg-[var(--panel-accent)] transition-[width]" /></div>{job.liveLogTail && <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap break-words rounded-[5px] bg-[#15181c] p-2 font-mono text-[11px] leading-5 text-[#bac4cf]">{job.liveLogTail}</pre>}</div>}
      <div className="mt-2 rounded-[5px] border border-[var(--panel-border)] bg-[var(--panel-raised)] px-2.5 py-2"><span className="block text-[10px] font-medium text-[var(--panel-text)]">{job.result ?? 'Calculation ended without a parsed result'}</span><span className="mt-0.5 block text-[9px] leading-3.5 text-[var(--panel-muted)]">{job.resultDetail ?? 'Open the raw output for full Quantum ESPRESSO details.'}</span></div>
      {job.status === 'Failed' && job.backendCalculationId && <div className="mt-2">
        {!diagnosis && <button type="button" disabled={diagnosing} onClick={() => void diagnoseFailure()} className="inline-flex h-7 items-center gap-1.5 rounded-[5px] border border-[var(--panel-border)] bg-[var(--panel-bg)] px-2.5 text-[9px] font-medium text-[var(--panel-text)] hover:bg-[var(--panel-hover)] disabled:cursor-wait disabled:opacity-60"><Sparkles className="h-3 w-3 text-[var(--panel-text)]" />{diagnosing ? 'Analyzing error…' : 'Explain error'}</button>}
        {diagnosis && <section aria-label="Calculation error explanation" className="rounded-[6px] border border-[var(--panel-border)] bg-[var(--panel-raised)] px-3 py-2.5"><div className="mb-1.5 flex items-center gap-1.5 text-[9px] font-semibold text-[var(--panel-text)]"><Sparkles className="h-3 w-3 text-[var(--panel-text)]" />Phynite calculation assistant</div><div className="whitespace-pre-wrap text-[9px] leading-4 text-[var(--panel-muted)]">{diagnosis}</div></section>}
        {diagnosisError && <div role="alert" className="mt-1.5 flex items-start justify-between gap-2 text-[9px] text-rose-400"><span>{diagnosisError}</span><button type="button" onClick={() => setDiagnosisError(null)} aria-label="Dismiss assistant error"><X className="h-3 w-3" /></button></div>}
      </div>}
      {job.status === 'Completed' && displayPreviewUrl && failedPreviewUrl !== displayPreviewUrl && <figure className="mt-2 overflow-hidden rounded-[6px] border border-[var(--panel-border)] bg-[var(--panel-raised)]">
        <figcaption className="flex h-8 items-center gap-2 border-b border-[var(--panel-border)] bg-[var(--panel-bg)] px-2.5"><ChartNoAxesCombined className="h-3 w-3 shrink-0 text-[var(--panel-muted)]" /><span className="text-[9px] font-semibold text-[var(--panel-text)]">Result preview</span><span className="min-w-0 flex-1 truncate text-right font-mono text-[8px] text-[var(--panel-muted)]">{editedPreviewSvg ? 'Saved plot style' : plotArtifact?.label}</span></figcaption>
        <button type="button" onClick={() => setPreviewOpen(true)} aria-label={`Enlarge ${job.name} result plot`} className="group relative grid max-h-[240px] min-h-[128px] w-full cursor-zoom-in place-items-center overflow-hidden p-2 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--panel-accent)]/50">
          {/* Signed scientific artifacts are remote and have runtime dimensions. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={displayPreviewUrl} alt={`${job.name} result plot`} loading="lazy" onError={() => void handlePreviewError()} className="max-h-[224px] w-full object-contain" />
          <span className="pointer-events-none absolute bottom-2 right-2 flex h-7 items-center gap-1.5 rounded-[5px] border border-[var(--panel-border)] bg-[var(--panel-bg)]/90 px-2 text-[8px] font-semibold text-[var(--panel-text)] opacity-0 shadow-sm backdrop-blur transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"><Maximize2 className="h-3 w-3" />Open larger</span>
        </button>
      </figure>}
      {job.status === 'Completed' && !artifactsExpired && job.plotSettings && !displayPreviewUrl && <div role="status" className="mt-2 rounded-[5px] border border-[var(--panel-border)] bg-[var(--panel-raised)] px-2.5 py-2 text-[9px] text-[var(--panel-muted)]">{pairUnavailable ? 'The selected Band/DOS run is no longer available.' : previewRenderError ?? 'Preparing your customized preview…'}{dataArtifact && (pairUnavailable || previewRenderError) && <button type="button" onClick={() => onAddToFigure?.(job.id)} className="ml-2 font-medium text-[var(--panel-text)] underline">Open in Figure Lab</button>}</div>}
      {job.status === 'Completed' && previewUrl && failedPreviewUrl === previewUrl && <div className="mt-2 rounded-[5px] border border-[var(--panel-border)] bg-[var(--panel-raised)] px-2.5 py-2 text-[9px] text-[var(--panel-muted)]">Plot preview expired or could not be loaded. Refresh the calculation log to request a new preview link.</div>}
      {artifactsExpired && <div className="mt-2 rounded-[5px] border border-[var(--panel-border)] bg-[var(--panel-raised)] px-2.5 py-2 text-[9px] text-[var(--panel-muted)]">Temporary outputs and previews have expired. Use Open in Figure Lab to open retained numerical data when available.</div>}
      {downloadError && <div role="alert" className="mt-2 flex items-start justify-between gap-2 rounded-[5px] border border-rose-500/30 bg-rose-500/10 px-2.5 py-2 text-[9px] text-rose-400"><span>{downloadError}. Refresh the calculation log and try again.</span><button type="button" onClick={() => setDownloadError(null)} aria-label="Dismiss download error" className="grid h-4 w-4 shrink-0 place-items-center"><X className="h-3 w-3" /></button></div>}
    </div>}
  </article>{plotArtifact && displayPreviewUrl && <PlotPreviewDialog open={previewOpen} artifact={plotArtifact} previewUrl={displayPreviewUrl} calculationName={job.name} downloading={downloadingPath === plotArtifact.path} multiPlotDownload={job.calculationType === 'Thermoelectric properties'} onClose={closePreview} onDownload={() => void handlePlotDownload()} onEdit={onAddToFigure && plottable ? () => { setPreviewOpen(false); onAddToFigure(job.id); } : undefined} />}</>;
}

export function CalculationPanel({ material, jobs, configurations, components, onAddCalculation, onToggleCalculation, onReorderCalculation, onMoveCalculation, onDuplicateCalculation, onDownloadInputFiles, onDeleteCalculation, onSaveSelected, onRunCalculation, onRunSelected, onDeleteJob, onRenameJob, onCancelJob, onAddToFigure, onImportConfiguration, onDeleteConfiguration, onConfigureCalculation, activeConfigurationId, onClose }: {
  material: MaterialContext;
  jobs: CalculationJob[];
  configurations: CalculationConfiguration[];
  components: CalculationComponentInstance[];
  onAddCalculation: (calculation: CalculationType) => void;
  onToggleCalculation: (id: string) => void;
  onReorderCalculation?: (sourceId: string, targetId: string) => void;
  onMoveCalculation?: (id: string, direction: -1 | 1) => void;
  onDuplicateCalculation: (id: string) => void;
  onDownloadInputFiles: (id: string) => void;
  onDeleteCalculation: (id: string) => void;
  onSaveSelected: () => void;
  onRunCalculation: (id: string) => void;
  onRunSelected: () => void;
  onRunAll: () => void;
  runnableCount: number;
  onRenameJob?: (id: string, name: string) => void;
  onDeleteJob: (id: string) => void;
  onCancelJob: (id: string) => void;
  onSaveJobPlotSettings: (id: string, settings: ScientificPlotSettings) => void;
  onAddToFigure?: (id: string) => void;
  cloudSyncStatus: 'idle' | 'syncing' | 'synced' | 'error';
  onImportConfiguration: (configuration: CalculationConfiguration) => void;
  onDeleteConfiguration: (id: string) => void;
  onConfigureCalculation: (id: string) => void;
  activeConfigurationId?: string | null;
  onClose?: () => void;
}) {
  const [view, setView] = useState<View>('dft');
  const [query, setQuery] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [logExpanded, setLogExpanded] = useState(false);
  const [logQuery, setLogQuery] = useState('');
  const [logStatus, setLogStatus] = useState('all');
  const [logLimit, setLogLimit] = useState(30);
  const visibleConfigurations = configurations.filter((configuration) => `${configuration.name} ${configuration.databaseName} ${configuration.materialName} ${configuration.calculation}`.toLowerCase().includes(query.toLowerCase()));
  const executionJobs = jobs.filter((job) => job.status === 'Queued' || job.status === 'Running' || job.status === 'Completed' || job.status === 'Failed' || job.status === 'Cancelled');
  const plotCompanionsByJobId = useMemo(() => {
    const completed = jobs.filter((job) => job.status === 'Completed' && !job.artifactsExpired && plotDataArtifact(job));
    return Object.fromEntries(completed.filter((job) => job.plotSettings?.layout === 'band-dos').map((job) => [job.id, completed
      .filter((candidate) => bandDosCompatibility(job, candidate).compatible)
      .sort((left, right) => (right.completedAt ?? '').localeCompare(left.completedAt ?? ''))
      .flatMap((candidate): ResultPlotCompanion[] => {
        const dataArtifact = plotDataArtifact(candidate);
        if (!dataArtifact || (candidate.calculationType !== 'Band structure' && candidate.calculationType !== 'Density of states')) return [];
        return [{
          jobId: candidate.id,
          calculationName: candidate.name,
          calculationType: candidate.calculationType,
          backendCalculationId: candidate.backendCalculationId,
          completedAt: candidate.completedAt,
          dataArtifact,
        }];
      })]));
  }, [jobs]);
  const filteredJobs = executionJobs.filter((job) => (logStatus === 'all' || job.status === logStatus) && `${job.name} ${job.calculationType} ${job.settings}`.toLowerCase().includes(logQuery.toLowerCase()));
  const selectedCount = components.filter((component) => component.selected).length;
  const selectedRunCount = components.filter((component) => {
    if (!component.selected) return false;
    const source = components.find((item) => item.id === component.structureSourceId);
    const expectedSettings = `${summarizeJobDraft(component.draft, component.calculation)} · input ${source?.name ?? 'original structure'}`;
    const linked = jobs.filter((job) => job.componentId === component.id && job.settings === expectedSettings);
    return !linked.some((job) => (['Queued', 'Running'].includes(job.status) || completedExecutionAccepted(job, component.calculation)));
  }).length;
  const activeView = view;
  const closePicker = () => setPickerOpen(false);

  useEffect(() => {
    if (!logExpanded) return;
    const collapseOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLogExpanded(false);
    };
    window.addEventListener('keydown', collapseOnEscape);
    return () => window.removeEventListener('keydown', collapseOnEscape);
  }, [logExpanded]);

  return <div className={cn(
    'calculation-panel relative flex h-full min-h-0 flex-col bg-[var(--panel-bg)] text-[var(--panel-text)]',
    logExpanded && 'fixed bottom-3 left-3 right-3 top-[60px] z-[110] overflow-hidden rounded-[10px] border border-[var(--panel-border)] shadow-[0_0_0_9999px_rgba(0,0,0,.38),0_24px_72px_rgba(0,0,0,.42)]',
  )}>
    <div className="flex items-center gap-1.5 border-b border-[var(--panel-border)] bg-[var(--panel-bg)] p-2">
      <div className="grid flex-1 grid-cols-3 gap-1 rounded-[7px] border border-[var(--panel-border)] bg-[var(--panel-bg)] p-0.5">
        {(['dft', 'log', 'library'] as View[]).map((tabId) => {
          const label = tabId === 'dft' ? 'DFT' : tabId === 'log' ? 'Log' : 'Library';
          const isActive = activeView === tabId;
          return (
            <button
              key={tabId}
              type="button"
              aria-pressed={isActive}
              onClick={() => {
                closePicker();
                setView(tabId);
                if (tabId !== 'log') setLogExpanded(false);
              }}
              className={cn(
                'flex h-7 min-w-0 items-center justify-center gap-1.5 rounded-[5px] text-[11px] font-semibold transition-all',
                isActive
                  ? 'bg-[var(--panel-selected)] text-[var(--panel-text)] shadow-xs'
                  : 'text-[var(--panel-muted)] hover:bg-[var(--panel-hover)] hover:text-[var(--panel-text)]'
              )}
            >
              <span className="truncate">{label}</span>
              {tabId === 'log' && executionJobs.length > 0 && (
                <span className="rounded-full bg-white/10 px-1.5 py-0.2 font-mono text-[9px] tabular-nums text-[var(--panel-muted)]">
                  {executionJobs.length}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Close calculation panel"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-[5px] text-[var(--panel-muted)] hover:bg-[var(--panel-hover)] hover:text-[var(--panel-text)] lg:hidden"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>

    <div className="relative min-h-0 flex-1 overflow-y-auto">
      {activeView === 'dft' && <ComputeDestination />}

      {activeView === 'dft' && <div className="relative">
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-[var(--panel-border)] px-3">
          <span className="text-[11px] font-semibold text-[var(--panel-muted)]">
            Workflow
          </span>
          <button
            type="button"
            disabled={!material}
            aria-expanded={pickerOpen}
            onClick={() => setPickerOpen((current) => !current)}
            className="workspace-text-action inline-flex items-center gap-1 rounded-none border-0 bg-transparent p-0 text-[11px] font-medium text-[var(--panel-accent)] transition-colors hover:bg-transparent hover:text-[var(--panel-text)] disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" />
            Add calculation
          </button>
        </div>
        {pickerOpen && <div className="workspace-popover-motion absolute left-2 right-2 top-[46px] z-40 rounded-[8px] border border-[var(--panel-border)] bg-[var(--panel-raised)] p-2 shadow-[0_14px_38px_rgba(0,0,0,.24)]"><div className="mb-1.5 px-1"><span className="text-[10px] font-semibold text-[var(--panel-muted)]">Add calculation</span></div><div className="space-y-0.5">{options.map((option) => { const Icon = option.icon; return <button key={option.id} type="button" onClick={() => { onAddCalculation(option.id); closePicker(); }} className="flex w-full items-center gap-2.5 rounded-[6px] px-2 py-2 text-left hover:bg-[var(--panel-hover)]"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-[6px] bg-[var(--panel-bg)] text-[var(--panel-accent)]"><Icon className="h-4 w-4" /></span><span className="min-w-0 flex-1"><span className="block text-[11px] font-semibold text-[var(--panel-text)]">{option.label}</span><span className="block truncate text-[9px] text-[var(--panel-muted)]">{option.detail}</span></span><span className="max-w-[108px] shrink-0 truncate rounded-[4px] border border-[var(--panel-border)] bg-[var(--panel-bg)] px-1.5 py-1 font-mono text-[8px] font-medium text-[var(--panel-muted)]">{option.tool}</span></button>; })}</div></div>}
        {!components.length && !pickerOpen && <div className="px-5 py-12 text-center"><span className="mx-auto grid h-9 w-9 place-items-center rounded-[7px] border border-[var(--panel-border)] bg-[var(--panel-raised)] text-[var(--panel-muted)]"><Plus className="h-4 w-4" /></span><p className="mt-3 text-[11px] font-medium text-[var(--panel-muted)]">No calculations added</p></div>}
        {components.map((component, index) => {
          const linked = jobs.filter((job) => job.componentId === component.id);
          const source = components.find((item) => item.id === component.structureSourceId);
          const expectedSettings = `${summarizeJobDraft(component.draft, component.calculation)} · input ${source?.name ?? 'original structure'}`;
          const latest = linked.find((job) => job.settings === expectedSettings);
          const status = latest?.status ?? 'Ready';
          const configuring = activeConfigurationId === component.id;
          const sourceJob = source ? jobs.find((job) => job.componentId === source.id) : undefined;
          const sourceLabel = source ? source.name : 'Original structure';
          const dependencyState = source ? sourceJob && completedExecutionAccepted(sourceJob, 'Structural relaxation') ? 'output ready' : sourceJob?.status === 'Completed' ? 'convergence unverified' : 'runs first' : '';
          return <article
            key={component.id}
            role="button"
            tabIndex={0}
            onClick={() => onConfigureCalculation(component.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onConfigureCalculation(component.id);
              }
            }}
            draggable={Boolean(onReorderCalculation)}
            onDragStart={(event) => { setDraggedId(component.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', component.id); }}
            onDragEnd={() => setDraggedId(null)}
            onDragOver={(event) => { if (draggedId && draggedId !== component.id) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } }}
            onDrop={(event) => { event.preventDefault(); if (draggedId && draggedId !== component.id) onReorderCalculation?.(draggedId, component.id); setDraggedId(null); }}
            data-selected={configuring}
            className={cn(
              'workspace-selection-row group relative mx-2.5 my-1.5 grid min-h-[56px] cursor-pointer grid-cols-[14px_16px_22px_minmax(0,1fr)_auto_auto_auto] items-center gap-2 rounded-[7px] border px-3 py-2 transition-all',
              configuring
                ? 'border-[rgba(255,255,255,0.18)] bg-[var(--panel-selected)] shadow-sm'
                : 'border-[var(--panel-border)] bg-transparent hover:border-[var(--line-strong)] hover:bg-[var(--panel-hover)]',
              draggedId === component.id && 'opacity-50',
            )}
          >
            <button
              type="button"
              disabled={!onReorderCalculation}
              onClick={(event) => event.stopPropagation()}
              aria-label={`Drag ${component.name} to reorder`}
              className="flex h-full w-full cursor-grab items-center justify-center border-0 bg-transparent text-[var(--panel-muted)] opacity-30 transition-opacity hover:opacity-100 group-hover:opacity-70 active:cursor-grabbing disabled:cursor-default"
            >
              <GripVertical className="h-3.5 w-3.5" />
            </button>
            <div onClick={(event) => event.stopPropagation()} className="flex items-center justify-center">
              <LabCheckbox
                checked={component.selected}
                onCheckedChange={() => onToggleCalculation(component.id)}
                aria-label={`${component.selected ? 'Deselect' : 'Select'} ${component.name}`}
                className="flex shrink-0 justify-center"
              />
            </div>
            <span
              data-selection-symbol
              className="inline-flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-[4px] border border-[var(--panel-border)] bg-[var(--panel-raised)] font-mono text-[10px] font-bold tabular-nums text-[var(--panel-muted)]"
              style={{ lineHeight: 1, padding: 0 }}
            >
              {String(index + 1).padStart(2, '0')}
            </span>
            <div className="flex min-w-0 flex-col justify-center">
              <span data-selection-label className="truncate text-[12.5px] font-semibold tracking-tight text-[var(--panel-text)]">{component.name}</span>
              <span className="truncate font-sans text-[10.5px] font-normal text-[#8e96a4] mt-0.5">
                {component.calculation !== 'Structural relaxation'
                  ? `Input: ${sourceLabel}${dependencyState ? ` (${dependencyState})` : ''}${linked.length ? ` · ${linked.length} run${linked.length > 1 ? 's' : ''}` : ''}`
                  : linked.length
                    ? `${linked.length} run${linked.length > 1 ? 's' : ''}`
                    : 'Original structure'}
              </span>
            </div>
            <Status value={status} />
            <div className="relative flex items-center justify-center">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setMenuOpen((current) => current === component.id ? null : component.id);
                }}
                aria-expanded={menuOpen === component.id}
                aria-label={`More actions for ${component.name}`}
                className={cn(
                  'workspace-item-action grid h-7 w-7 shrink-0 place-items-center rounded-[5px] text-[var(--panel-muted)] transition-colors hover:bg-[var(--panel-hover)] hover:text-[var(--panel-text)]',
                  menuOpen === component.id && 'is-open opacity-100 bg-[var(--panel-hover)] text-[var(--panel-text)]',
                )}
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
              {menuOpen === component.id && <div onClick={(event) => event.stopPropagation()} className="workspace-popover-motion workspace-dark-surface absolute right-0 top-8 z-30 w-44 overflow-hidden rounded-[7px] border border-[var(--surface-border)] bg-[var(--surface-bg)] p-1 shadow-[0_10px_30px_rgba(0,0,0,.24)]">
                <button type="button" onClick={() => { onDuplicateCalculation(component.id); setMenuOpen(null); }} className="flex h-8 w-full items-center gap-2 rounded-[4px] px-2.5 text-[10px] font-medium text-[var(--surface-text)] hover:bg-[var(--surface-hover)]"><Copy className="h-3 w-3" />Duplicate</button>
                <button type="button" onClick={() => { onDownloadInputFiles(component.id); setMenuOpen(null); }} className="flex h-8 w-full items-center gap-2 rounded-[4px] px-2.5 text-[10px] font-medium text-[var(--surface-text)] hover:bg-[var(--surface-hover)]"><FileDown className="h-3 w-3" />Download input files</button>
                <button type="button" disabled={!onMoveCalculation || index === 0} onClick={() => { onMoveCalculation?.(component.id, -1); setMenuOpen(null); }} className="flex h-8 w-full items-center gap-2 rounded-[4px] px-2.5 text-[10px] font-medium text-[var(--surface-text)] hover:bg-[var(--surface-hover)] disabled:opacity-40"><ArrowUp className="h-3 w-3" />Move up</button>
                <button type="button" disabled={!onMoveCalculation || index === components.length - 1} onClick={() => { onMoveCalculation?.(component.id, 1); setMenuOpen(null); }} className="flex h-8 w-full items-center gap-2 rounded-[4px] px-2.5 text-[10px] font-medium text-[var(--surface-text)] hover:bg-[var(--surface-hover)] disabled:opacity-40"><ArrowDown className="h-3 w-3" />Move down</button>
                <div className="my-1 border-t border-[var(--surface-border)]" />
                <button type="button" onClick={() => { onDeleteCalculation(component.id); setMenuOpen(null); }} className="flex h-8 w-full items-center gap-2 rounded-[4px] px-2.5 text-[10px] font-medium text-[var(--surface-danger)] hover:bg-[var(--surface-hover)]"><Trash2 className="h-3 w-3" />Remove</button>
              </div>}
            </div>
            <button
              type="button"
              disabled={latest?.status === 'Running'}
              onClick={(event) => {
                event.stopPropagation();
                onRunCalculation(component.id);
              }}
              aria-label={`Run ${component.name}`}
              className="calculation-run-button grid h-7 w-7 shrink-0 place-items-center rounded-[5px] disabled:opacity-40"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
            </button>
          </article>;
        })}
      </div>}

      {activeView === 'log' && <section className="execution-log" aria-label="Execution log">
        <header className="execution-log-header"><div><h2>Execution log</h2><p>{executionJobs.filter((job) => job.status === 'Running' || job.status === 'Queued').length} active · {executionJobs.filter((job) => job.status === 'Completed').length} completed</p></div><button type="button" aria-label={logExpanded ? 'Collapse execution log' : 'Expand execution log'} aria-pressed={logExpanded} onClick={() => setLogExpanded((value) => !value)}>{logExpanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button></header>
        <div className="execution-log-filters"><label><Search size={14} /><input aria-label="Search execution log" placeholder="Search runs" value={logQuery} onChange={(event) => { setLogQuery(event.target.value); setLogLimit(30); }} /></label><UiSelect compact ariaLabel="Filter execution status" value={logStatus} onChange={(value) => { setLogStatus(value); setLogLimit(30); }} options={[{ value: 'all', label: 'All statuses' }, ...['Running', 'Queued', 'Completed', 'Failed', 'Cancelled'].map((status) => ({ value: status, label: status }))]} /></div>
        <div>{filteredJobs.slice(0, logLimit).map((job) => <LogJobRow key={job.id} job={job} compatibleCompanions={plotCompanionsByJobId[job.id] ?? []} onDeleteJob={onDeleteJob} onRenameJob={onRenameJob} onCancelJob={onCancelJob} onAddToFigure={onAddToFigure} />)}</div>
        {!filteredJobs.length && <p className="execution-log-empty">{executionJobs.length ? 'No runs match these filters.' : 'Run a calculation to see its progress and results here.'}</p>}
        {filteredJobs.length > logLimit && <button className="execution-log-more" onClick={() => setLogLimit((value) => value + 30)}>Show more runs ({filteredJobs.length - logLimit})</button>}
      </section>}


      {activeView === 'library' && <div><div className="calculation-library-search flex h-10 items-center gap-2 border-b border-[var(--panel-border)] px-3"><Search className="h-3.5 w-3.5 text-[var(--panel-muted)]" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search configurations" className="h-full min-w-0 flex-1 bg-transparent text-[var(--panel-text)] outline-none placeholder:text-[var(--panel-muted)]" /></div>{visibleConfigurations.length ? visibleConfigurations.map((configuration) => { const external = configuration.databaseName !== material?.databaseName; return <div key={configuration.id} className="border-b border-[var(--panel-border)] px-3 py-3"><div className="flex items-start gap-2"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-[5px] bg-[var(--panel-raised)] font-mono text-[10px] font-semibold text-[var(--panel-accent)]">QE</span><span className="min-w-0 flex-1"><span className="block truncate text-[11px] font-medium">{configuration.name}</span><span className="block truncate text-[10px] text-[var(--panel-muted)]">{configuration.databaseName} / {configuration.materialName}</span></span>{external && <button type="button" onClick={() => onImportConfiguration(configuration)} className="h-6 rounded-[4px] bg-[var(--panel-hover)] px-2 text-[10px] font-medium text-[var(--panel-accent)]">Import</button>}<button type="button" onClick={() => onDeleteConfiguration(configuration.id)} className="grid h-6 w-6 place-items-center text-[var(--panel-muted)] hover:bg-[var(--panel-hover)] hover:text-[var(--panel-danger)]"><Trash2 className="h-3 w-3" /></button></div><p className="mt-2 truncate font-mono text-[10px] text-[var(--panel-muted)]">{summarizeJobDraft(configuration.draft, configuration.calculation)}</p></div>; }) : <div className="px-6 py-12 text-center"><Database className="mx-auto h-5 w-5 text-[var(--panel-muted)]" /><p className="mt-3 text-[11px] font-medium text-[var(--panel-muted)]">No saved configurations</p></div>}</div>}
    </div>

    {activeView === 'dft' && <div className="shrink-0 border-t border-[var(--panel-border)] bg-[var(--panel-bg)] p-2.5"><div className="grid grid-cols-[0.9fr_1.1fr] gap-2"><button type="button" disabled={!material || !selectedCount} onClick={onSaveSelected} className="flex h-9 items-center justify-center gap-1.5 rounded-[5px] border border-[var(--panel-border)] bg-transparent text-[11px] font-medium text-[var(--panel-text)] hover:bg-[var(--panel-hover)] disabled:text-[var(--panel-muted)]"><Save className="h-3 w-3" />Save selected</button><button type="button" disabled={!material || !selectedRunCount} onClick={onRunSelected} className="workspace-primary-action flex h-9 items-center justify-center gap-1.5 rounded-[5px] bg-[#e4e7ec] text-[11px] font-semibold text-black hover:bg-[#f0f2f5] disabled:bg-[var(--panel-raised)] disabled:text-[var(--panel-muted)]"><Play className="h-3 w-3 fill-current" />Run selected · {selectedRunCount}</button></div></div>}
  </div>;
}

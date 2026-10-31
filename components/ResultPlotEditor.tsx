'use client';

import { FigureColorField } from '@/components/FigureControls';
import { LabSlider, LabSwitch } from '@/components/LabControls';

import {
  Check,
  ChartNoAxesCombined,
  ChevronDown,
  Cloud,
  CloudCheck,
  CloudOff,
  Copy,
  Download,
  Eye,
  EyeOff,
  ImageDown,
  Lock,
  Maximize2,
  Minus,
  Plus,
  Redo2,
  RotateCcw,
  SlidersHorizontal,
  Undo2,
  Unlock,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { downloadBlob, downloadRenderedPlotArchive, downloadRenderedPlotPng } from '@/lib/plot-download';
import {
  bandDosEnergyBounds,
  defaultScientificPlotSettings,
  mergeScientificPlotSettings,
  parseScientificPlotCsv,
  plotDownloadFilename,
  plotSeriesColor,
  renderScientificPlotExports,
  renderScientificPlotSvg,
  type PlotAxisScale,
  type PlotFont,
  type PlotLegendPosition,
  type PlotLineStyle,
  type PlotMarker,
  type PlotPalette,
  type PlotTheme,
  type PlotTickFormat,
  type ScientificPlotData,
  type ScientificPlotExport,
  type ScientificPlotSeriesStyle,
  type ScientificPlotSettings,
} from '@/lib/result-plot';

type PlotArtifact = {
  path: string;
  label: string;
  role: string;
  contentType: string;
  viewUrl?: string;
  downloadUrl: string;
};

export type ResultPlotCompanion = {
  jobId: string;
  calculationName: string;
  calculationType: 'Band structure' | 'Density of states';
  backendCalculationId?: string;
  completedAt?: string;
  dataArtifact: PlotArtifact;
};

type ResultPlotEditorProps = {
  open: boolean;
  jobId: string;
  backendCalculationId?: string;
  calculationName: string;
  calculationType?: string;
  dataArtifact: PlotArtifact;
  compatibleCompanions?: ResultPlotCompanion[];
  savedSettings?: ScientificPlotSettings;
  cloudSyncStatus: 'idle' | 'syncing' | 'synced' | 'error';
  onSaveSettings: (settings: ScientificPlotSettings) => void;
  onPreviewChange?: (svg: string, settings: ScientificPlotSettings, exports: ScientificPlotExport[]) => void;
  onClose: () => void;
  onAddToFigure?: () => void;
  onRefreshArtifacts?: () => Promise<PlotArtifact[]>;
};

type InspectorTab = 'series' | 'axes' | 'style' | 'export';

const CONTROL_LABEL = 'figure-studio-label grid min-w-0 gap-1.5';
const INPUT_CLASS = 'figure-studio-control min-w-0 w-full';
const NO_COMPANIONS: ResultPlotCompanion[] = [];

function companionLabel(candidate: ResultPlotCompanion) {
  const date = candidate.completedAt ? new Date(candidate.completedAt) : null;
  const completed = date && Number.isFinite(date.getTime()) ? date.toLocaleString() : 'Completed';
  return `${candidate.calculationName} · ${completed} · ${(candidate.backendCalculationId ?? candidate.jobId).slice(-8)}`;
}

function maximumSafeRasterScale(width: number, height: number) {
  for (let scale = 4; scale >= 1; scale -= 1) {
    if (width * scale <= 16_384 && height * scale <= 16_384 && width * height * scale * scale <= 80_000_000) return scale;
  }
  return 1;
}

function artifactUrl(artifact: PlotArtifact) {
  return artifact.viewUrl ?? artifact.downloadUrl;
}

function plotDataUrl(artifact: PlotArtifact, backendCalculationId?: string) {
  if (!backendCalculationId) return artifactUrl(artifact);
  const query = new URLSearchParams({ calculationId: backendCalculationId, path: artifact.path });
  return `/api/calculation-artifact?${query.toString()}`;
}

async function plotDataError(response: Response) {
  const payload = await response.clone().json().catch(() => null) as { error?: string } | null;
  return payload?.error || `Plot data is unavailable (${response.status})`;
}

function NumericControl({ label, value, placeholder, min, max, step = 'any', onChange }: {
  label: string;
  value: number | null;
  placeholder: string;
  min?: number;
  max?: number;
  step?: number | 'any';
  onChange: (value: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value === null ? '' : String(value));

  const commitDraft = () => {
    const normalized = draft.trim().replace(',', '.');
    if (!normalized) {
      setDraft('');
      setEditing(false);
      onChange(null);
      return;
    }
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) {
      setDraft(value === null ? '' : String(value));
      setEditing(false);
      return;
    }
    const stepped = step === 1 ? Math.round(parsed) : parsed;
    const bounded = Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, stepped));
    setDraft(String(bounded));
    setEditing(false);
    onChange(bounded);
  };

  return <label className={CONTROL_LABEL}>
    {label}
    <input
      type="text"
      inputMode="decimal"
      value={editing ? draft : value === null ? '' : String(value)}
      placeholder={placeholder}
      onFocus={() => {
        setDraft(value === null ? '' : String(value));
        setEditing(true);
      }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commitDraft}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.blur();
        }
      }}
      className={`${INPUT_CLASS} font-mono`}
    />
  </label>;
}

function TextControl({ label, value, placeholder, onChange }: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return <label className={CONTROL_LABEL}>
    {label}
    <input value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} className={INPUT_CLASS} />
  </label>;
}

function SelectControl<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const [highlightedIndex, setHighlightedIndex] = useState(selectedIndex);
  const rootRef = useRef<HTMLDivElement>(null);
  const labelId = useId();
  const listboxId = useId();
  const selectedOption = options[selectedIndex] ?? options[0];

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', closeOnOutsidePress);
    return () => window.removeEventListener('pointerdown', closeOnOutsidePress);
  }, [open]);

  const choose = (index: number) => {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    setHighlightedIndex(index);
    setOpen(false);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Escape') {
      if (open) {
        event.preventDefault();
        event.stopPropagation();
      }
      setOpen(false);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      setOpen(true);
      setHighlightedIndex((index) => (index + direction + options.length) % options.length);
      return;
    }
    if ((event.key === 'Enter' || event.key === ' ') && open) {
      event.preventDefault();
      choose(highlightedIndex);
    }
  };

  return <div ref={rootRef} className={CONTROL_LABEL}>
    <span id={labelId}>{label}</span>
    <div className="relative">
      <button
        type="button"
        aria-labelledby={labelId}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => {
          setHighlightedIndex(selectedIndex);
          setOpen((current) => !current);
        }}
        onKeyDown={handleKeyDown}
        className={`${INPUT_CLASS} flex w-full items-center justify-between gap-3 text-left`}
      >
        <span className="truncate">{selectedOption?.label ?? value}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-[#737c87] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div id={listboxId} role="listbox" aria-labelledby={labelId} className="figure-studio-dropdown absolute left-0 right-0 top-[calc(100%+4px)] z-[80] max-h-56 overflow-y-auto p-1">
        {options.map((option, index) => <button
          key={option.value}
          type="button"
          role="option"
          aria-selected={option.value === value}
          onMouseEnter={() => setHighlightedIndex(index)}
          onClick={() => choose(index)}
          data-highlighted={highlightedIndex === index}
          className="figure-studio-option flex w-full items-center justify-between gap-3 text-left"
        >
          <span className="truncate">{option.label}</span>
          {option.value === value && <Check className="h-3.5 w-3.5 shrink-0 text-[#87a8dc]" />}
        </button>)}
      </div>}
    </div>
  </div>;
}

function ToggleControl({ label, checked, onChange }: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return <LabSwitch className="figure-studio-toggle" checked={checked} onCheckedChange={onChange}>{label}</LabSwitch>;
}

function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return <div className="flex items-center justify-between gap-3">
    <h3 className="figure-studio-section-title">{children}</h3>
    {action}
  </div>;
}

export function ResultPlotEditor({ open, jobId, backendCalculationId, calculationName, calculationType, dataArtifact, compatibleCompanions = NO_COMPANIONS, savedSettings, cloudSyncStatus, onSaveSettings, onPreviewChange, onClose, onRefreshArtifacts, onAddToFigure }: ResultPlotEditorProps) {
  const [plotData, setPlotData] = useState<ScientificPlotData | null>(null);
  const [companionResult, setCompanionResult] = useState<{ key: string; data: ScientificPlotData | null; error: string | null } | null>(null);
  const [companionRetry, setCompanionRetry] = useState(0);
  const [seriesPanel, setSeriesPanel] = useState<'primary' | 'companion'>('primary');
  const [settings, setSettings] = useState<ScientificPlotSettings | null>(null);
  const [past, setPast] = useState<ScientificPlotSettings[]>([]);
  const [future, setFuture] = useState<ScientificPlotSettings[]>([]);
  const [activeTab, setActiveTab] = useState<InspectorTab>('series');
  const [selectedSeriesId, setSelectedSeriesId] = useState<string | null>(null);
  const [previewScale, setPreviewScale] = useState(100);
  const [previewMode, setPreviewMode] = useState<'fit' | 'manual'>('fit');
  const [aspectLocked, setAspectLocked] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [exporting, setExporting] = useState<'svg' | 'png' | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const savedSettingsRef = useRef(savedSettings);
  const onSaveSettingsRef = useRef(onSaveSettings);
  const onCloseRef = useRef(onClose);
  const loadControllerRef = useRef<AbortController | null>(null);
  const legacyStorageKey = `phynite:plot-editor:${jobId}`;

  useEffect(() => {
    onSaveSettingsRef.current = onSaveSettings;
    onCloseRef.current = onClose;
    if (!open) savedSettingsRef.current = savedSettings;
  }, [onClose, onSaveSettings, open, savedSettings]);

  const loadArtifact = useCallback(async () => {
    loadControllerRef.current?.abort();
    const controller = new AbortController();
    loadControllerRef.current = controller;
    setLoading(true);
    setError(null);
    let artifact = dataArtifact;
    try {
      const requestPlotData = (candidate: PlotArtifact) => fetch(plotDataUrl(candidate, backendCalculationId), {
        cache: 'no-store',
        credentials: backendCalculationId ? 'same-origin' : 'omit',
        signal: controller.signal,
      });
      let response: Response;
      try {
        response = await requestPlotData(artifact);
      } catch (requestError) {
        if (controller.signal.aborted) return;
        if (!onRefreshArtifacts) throw new Error('The browser could not reach the plot data file.');
        const refreshed = await onRefreshArtifacts();
        artifact = refreshed.find((candidate) => candidate.path === dataArtifact.path)
          ?? refreshed.find((candidate) => candidate.role === 'data' && candidate.contentType.includes('csv'))
          ?? artifact;
        try {
          response = await requestPlotData(artifact);
        } catch {
          throw new Error(requestError instanceof Error && requestError.message !== 'Load failed'
            ? requestError.message
            : 'The browser could not reach the plot data service.');
        }
      }
      if (!response.ok && onRefreshArtifacts && !backendCalculationId) {
        const refreshed = await onRefreshArtifacts();
        artifact = refreshed.find((candidate) => candidate.path === dataArtifact.path)
          ?? refreshed.find((candidate) => candidate.role === 'data' && candidate.contentType.includes('csv'))
          ?? artifact;
        response = await requestPlotData(artifact);
      }
      if (!response.ok) throw new Error(await plotDataError(response));
      const parsed = parseScientificPlotCsv(await response.text(), calculationType);
      if (controller.signal.aborted) return;
      const defaults = defaultScientificPlotSettings(parsed);
      let saved: Partial<ScientificPlotSettings> = savedSettingsRef.current ?? {};
      let migratedLegacySettings = false;
      if (!savedSettingsRef.current) {
        try {
          const legacy = window.localStorage.getItem(legacyStorageKey);
          if (legacy) {
            saved = JSON.parse(legacy) as Partial<ScientificPlotSettings>;
            migratedLegacySettings = true;
          }
        } catch {
          saved = {};
        }
      }
      const quantityId = parsed.quantities.some((quantity) => quantity.id === saved.quantityId)
        ? saved.quantityId as string
        : defaults.quantityId;
      const quantity = parsed.quantities.find((candidate) => candidate.id === quantityId) ?? parsed.quantities[0];
      const merged = mergeScientificPlotSettings(defaults, { ...saved, quantityId });
      merged.width = Math.max(480, Math.min(6000, Math.round(merged.width)));
      merged.height = Math.max(360, Math.min(6000, Math.round(merged.height)));
      merged.exportScale = Math.min(merged.exportScale, maximumSafeRasterScale(merged.width, merged.height));
      if (!saved.yLabel) merged.yLabel = quantity.yLabel;
      setPlotData(parsed);
      setSettings(merged);
      setSelectedSeriesId(quantity.series[0]?.id ?? null);
      setPast([]);
      setFuture([]);
      if (migratedLegacySettings) {
        onSaveSettingsRef.current(merged);
        window.localStorage.removeItem(legacyStorageKey);
      }
    } catch (loadError) {
      if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : 'Plot data could not be loaded');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [backendCalculationId, calculationType, dataArtifact, legacyStorageKey, onRefreshArtifacts]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => void loadArtifact(), 0);
    return () => {
      window.clearTimeout(timer);
      loadControllerRef.current?.abort();
    };
  }, [loadArtifact, open]);

  const selectedCompanion = useMemo(() => compatibleCompanions.find((candidate) => candidate.jobId === settings?.pairedJobId) ?? null, [compatibleCompanions, settings?.pairedJobId]);
  const companionUrl = selectedCompanion ? plotDataUrl(selectedCompanion.dataArtifact, selectedCompanion.backendCalculationId) : null;
  const companionType = selectedCompanion?.calculationType;
  const companionCredentials = selectedCompanion?.backendCalculationId ? 'same-origin' : 'omit';
  const companionKey = selectedCompanion ? JSON.stringify([jobId, selectedCompanion.jobId, companionUrl, companionType, companionRetry]) : null;
  const companionCurrent = companionResult?.key === companionKey ? companionResult : null;
  const companionData = companionCurrent?.data ?? null;
  const companionError = companionCurrent?.error ?? null;
  const companionLoading = settings?.layout === 'band-dos' && !!selectedCompanion && !companionCurrent;

  useEffect(() => {
    if (!open || settings?.layout !== 'band-dos' || !companionKey || !companionUrl) return;
    const controller = new AbortController();
    let timedOut = false;
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 30_000);
    void (async () => {
      try {
        const response = await fetch(companionUrl, {
          cache: 'no-store',
          credentials: companionCredentials,
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(await plotDataError(response));
        const parsed = parseScientificPlotCsv(await response.text(), companionType);
        if (!((plotData?.kind === 'band' && parsed.kind === 'dos') || (plotData?.kind === 'dos' && parsed.kind === 'band'))) {
          throw new Error('The matched result does not contain the complementary Band/DOS data.');
        }
        if (controller.signal.aborted) return;
        setCompanionResult({ key: companionKey, data: parsed, error: null });
      } catch (loadError) {
        if (!controller.signal.aborted || timedOut) {
          setCompanionResult({ key: companionKey, data: null, error: timedOut ? 'The matched result took too long to load. Retry when the connection is available.' : loadError instanceof Error ? loadError.message : 'Matched Band/DOS data could not be loaded' });
        }
      } finally {
        window.clearTimeout(timeout);
      }
    })();
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [companionCredentials, companionKey, companionType, companionUrl, open, plotData?.kind, settings?.layout]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', closeOnEscape);
    closeRef.current?.focus();
    return () => {
      window.removeEventListener('keydown', closeOnEscape);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [open]);

  const rendered = useMemo(() => {
    if (loading || !plotData || !settings) return { svg: null, issue: null };
    if (settings.layout === 'band-dos' && !selectedCompanion) return { svg: null, issue: 'No compatible Band/DOS result is available for this saved pairing.' };
    if (settings.layout === 'band-dos' && companionLoading) return { svg: null, issue: 'Loading matched Band/DOS data…' };
    if (settings.layout === 'band-dos' && companionError) return { svg: null, issue: companionError };
    try {
      return { svg: renderScientificPlotSvg(plotData, settings, companionData), issue: null };
    } catch (renderError) {
      return { svg: null, issue: renderError instanceof Error ? renderError.message : 'Plot settings are invalid' };
    }
  }, [companionData, companionError, companionLoading, loading, plotData, selectedCompanion, settings]);

  const plotExports = useMemo(() => {
    if (!plotData || !settings || !rendered.svg) return [];
    try {
      return renderScientificPlotExports(plotData, settings, companionData);
    } catch {
      return [];
    }
  }, [companionData, plotData, rendered.svg, settings]);

  useEffect(() => {
    if (!open || !rendered.svg || !settings) return;
    onPreviewChange?.(rendered.svg, settings, plotExports);
  }, [onPreviewChange, open, plotExports, rendered.svg, settings]);

  const editablePlotData = settings?.layout === 'band-dos' && seriesPanel === 'companion' && companionData ? companionData : plotData;
  const activeQuantity = useMemo(() => editablePlotData && settings
    ? editablePlotData.quantities.find((quantity) => quantity.id === settings.quantityId) ?? editablePlotData.quantities[0]
    : null, [editablePlotData, settings]);
  const selectedSeries = activeQuantity?.series.find((series) => series.id === selectedSeriesId) ?? activeQuantity?.series[0] ?? null;
  const selectedSeriesIndex = activeQuantity && selectedSeries ? activeQuantity.series.indexOf(selectedSeries) : 0;
  const defaultStyles = useMemo(() => editablePlotData ? defaultScientificPlotSettings(editablePlotData).seriesStyles : {}, [editablePlotData]);
  const selectedStyle = settings && selectedSeries ? settings.seriesStyles[selectedSeries.id] ?? defaultStyles[selectedSeries.id] : null;
  const multiPlotExport = plotData?.kind === 'thermoelectric' && plotExports.length === 4;
  const combinedBandDos = settings?.layout === 'band-dos';
  const bandDosEligible = plotData?.kind === 'band' || plotData?.kind === 'dos';
  const combinedBounds = useMemo(() => {
    if (!plotData || !companionData || !combinedBandDos) return null;
    try { return bandDosEnergyBounds(plotData, companionData); } catch { return null; }
  }, [combinedBandDos, companionData, plotData]);
  const maximumRasterScale = settings ? maximumSafeRasterScale(settings.width, settings.height) : 1;
  const visibleCount = activeQuantity && settings
    ? activeQuantity.series.filter((series) => settings.seriesStyles[series.id]?.visible !== false).length
    : 0;
  const dataExtent = useMemo(() => {
    if (!activeQuantity || !settings) return null;
    let xMin = Number.POSITIVE_INFINITY;
    let xMax = Number.NEGATIVE_INFINITY;
    let yMin = Number.POSITIVE_INFINITY;
    let yMax = Number.NEGATIVE_INFINITY;
    for (const series of activeQuantity.series) {
      if (settings.seriesStyles[series.id]?.visible === false) continue;
      for (const [x, y] of series.points) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        xMin = Math.min(xMin, x);
        xMax = Math.max(xMax, x);
        yMin = Math.min(yMin, y);
        yMax = Math.max(yMax, y);
      }
    }
    return Number.isFinite(xMin) ? { xMin, xMax, yMin, yMax } : null;
  }, [activeQuantity, settings]);

  const figureWidth = settings?.width ?? 1200;
  const figureHeight = settings?.height ?? 800;
  const fitPreview = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const availableWidth = Math.max(1, stage.clientWidth - 40);
    const availableHeight = Math.max(1, stage.clientHeight - 94);
    const figureAspect = figureWidth / figureHeight;
    const fittedWidth = Math.min(availableWidth, availableHeight * figureAspect);
    setPreviewScale(Math.max(35, Math.min(100, Math.round((fittedWidth / availableWidth) * 100))));
    setPreviewMode('fit');
  }, [figureHeight, figureWidth]);

  const setManualPreviewScale = (value: number) => {
    setPreviewScale(Math.max(35, Math.min(200, value)));
    setPreviewMode('manual');
  };

  useEffect(() => {
    if (!open || !settings || previewMode !== 'fit') return;
    const stage = stageRef.current;
    if (!stage) return;
    const frame = window.requestAnimationFrame(() => fitPreview());
    const observer = new ResizeObserver(fitPreview);
    observer.observe(stage);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [fitPreview, open, previewMode, settings]);

  const commit = (next: ScientificPlotSettings | ((current: ScientificPlotSettings) => ScientificPlotSettings)) => {
    if (!settings) return;
    const resolved = typeof next === 'function' ? next(settings) : next;
    if (JSON.stringify(resolved) === JSON.stringify(settings)) return;
    setPast((history) => [...history, settings].slice(-50));
    setFuture([]);
    setSettings(resolved);
    onSaveSettingsRef.current(resolved);
    setError(null);
    setNotice(null);
  };
  const update = <Key extends keyof ScientificPlotSettings>(key: Key, value: ScientificPlotSettings[Key]) => {
    commit((current) => ({ ...current, [key]: value }));
  };
  const updateSeries = (seriesId: string, patch: Partial<ScientificPlotSeriesStyle>) => {
    commit((current) => ({
      ...current,
      seriesStyles: editablePlotData?.kind === 'thermoelectric'
        ? Object.fromEntries(Object.entries(current.seriesStyles).map(([id, style]) => {
          const selected = editablePlotData.quantities.flatMap((quantity) => quantity.series).find((series) => series.id === seriesId);
          const candidate = editablePlotData.quantities.flatMap((quantity) => quantity.series).find((series) => series.id === id);
          return [id, selected && candidate?.label === selected.label ? { ...style, ...patch } : style];
        }))
        : {
          ...current.seriesStyles,
          [seriesId]: { ...defaultStyles[seriesId], ...current.seriesStyles[seriesId], ...patch },
        },
    }));
  };
  const undo = useCallback(() => {
    if (!settings || !past.length) return;
    const previous = past[past.length - 1];
    setPast((history) => history.slice(0, -1));
    setFuture((history) => [settings, ...history].slice(0, 50));
    setSettings(previous);
    onSaveSettingsRef.current(previous);
  }, [past, settings]);
  const redo = useCallback(() => {
    if (!settings || !future.length) return;
    const next = future[0];
    setFuture((history) => history.slice(1));
    setPast((history) => [...history, settings].slice(-50));
    setSettings(next);
    onSaveSettingsRef.current(next);
  }, [future, settings]);

  useEffect(() => {
    if (!open) return;
    const handleEditorShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditing = target?.matches('input, textarea, select, [contenteditable="true"]');
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (isEditing || modifier || event.altKey) return;
      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        setManualPreviewScale(previewScale + 10);
      } else if (event.key === '-') {
        event.preventDefault();
        setManualPreviewScale(previewScale - 10);
      } else if (event.key === '0') {
        event.preventDefault();
        fitPreview();
      }
    };
    window.addEventListener('keydown', handleEditorShortcut);
    return () => window.removeEventListener('keydown', handleEditorShortcut);
  }, [fitPreview, open, previewScale, redo, undo]);
  const chooseQuantity = (quantityId: string) => {
    if (!editablePlotData) return;
    const quantity = editablePlotData.quantities.find((candidate) => candidate.id === quantityId);
    if (!quantity) return;
    commit((current) => ({ ...current, quantityId, yLabel: quantity.yLabel, yMin: null, yMax: null }));
    setSelectedSeriesId(quantity.series[0]?.id ?? null);
  };
  const chooseSeriesPanel = (panel: 'primary' | 'companion') => {
    const data = panel === 'companion' ? companionData : plotData;
    if (!data) return;
    setSeriesPanel(panel);
    setSelectedSeriesId(data.quantities[0]?.series[0]?.id ?? null);
  };
  const setFigureLayout = (layout: 'single' | 'band-dos') => {
    if (layout === 'single') {
      commit((current) => ({ ...current, layout, pairedJobId: null, title: current.title === 'Electronic band structure and density of states' ? plotData?.title ?? current.title : current.title }));
      setSeriesPanel('primary');
      return;
    }
    const companion = selectedCompanion ?? compatibleCompanions[0];
    if (!companion) {
      setNotice('Run a matching Band structure and Density of states calculation first.');
      return;
    }
    commit((current) => ({
      ...current,
      layout,
      pairedJobId: companion.jobId,
      showYZero: true,
      showLegend: true,
      title: current.title === plotData?.title ? 'Electronic band structure and density of states' : current.title,
      combinedEnergyMin: null,
      combinedEnergyMax: null,
      combinedDosMin: null,
      combinedDosMax: null,
    }));
  };
  const setAllSeriesVisibility = (visible: boolean) => {
    if (!activeQuantity) return;
    commit((current) => ({
      ...current,
      seriesStyles: {
        ...current.seriesStyles,
        ...Object.fromEntries(activeQuantity.series.map(({ id }) => [id, { ...defaultStyles[id], ...current.seriesStyles[id], visible }])),
      },
    }));
  };
  const setSymmetricRange = (axis: 'x' | 'y') => {
    if (!dataExtent) return;
    const magnitude = axis === 'x'
      ? Math.max(Math.abs(dataExtent.xMin), Math.abs(dataExtent.xMax))
      : Math.max(Math.abs(dataExtent.yMin), Math.abs(dataExtent.yMax));
    if (!(magnitude > 0)) return;
    commit((current) => axis === 'x'
      ? { ...current, xMin: -magnitude, xMax: magnitude, xScale: 'linear' }
      : { ...current, yMin: -magnitude, yMax: magnitude, yScale: 'linear' });
  };
  const updateFigureDimension = (axis: 'width' | 'height', value: number | null) => {
    if (value === null || !Number.isFinite(value)) return;
    const nextValue = Math.max(axis === 'width' ? 480 : 360, Math.min(6000, Math.round(value)));
    commit((current) => {
      if (!aspectLocked) {
        const dimensions = { ...current, [axis]: nextValue };
        return { ...dimensions, exportScale: Math.min(dimensions.exportScale, maximumSafeRasterScale(dimensions.width, dimensions.height)) };
      }
      const aspect = current.width / current.height;
      const dimensions = axis === 'width'
        ? { ...current, width: nextValue, height: Math.max(360, Math.min(6000, Math.round(nextValue / aspect))) }
        : { ...current, height: nextValue, width: Math.max(480, Math.min(6000, Math.round(nextValue * aspect))) };
      return { ...dimensions, exportScale: Math.min(dimensions.exportScale, maximumSafeRasterScale(dimensions.width, dimensions.height)) };
    });
  };
  const applyFigureSize = (width: number, height: number) => {
    commit((current) => ({ ...current, width, height, exportScale: Math.min(current.exportScale, maximumSafeRasterScale(width, height)) }));
  };
  const reset = () => {
    if (!plotData) return;
    const defaults = defaultScientificPlotSettings(plotData);
    setPast(settings ? [...past, settings].slice(-50) : past);
    setFuture([]);
    setSettings(defaults);
    onSaveSettingsRef.current(defaults);
    setSelectedSeriesId(plotData.quantities[0].series[0]?.id ?? null);
    window.localStorage.removeItem(legacyStorageKey);
  };
  const exportPlot = async (format: 'svg' | 'png') => {
    if (!rendered.svg || !settings) return;
    setExporting(format);
    setError(null);
    try {
      const exportName = plotDownloadFilename(combinedBandDos ? 'Electronic structure band DOS' : calculationName, format);
      if (multiPlotExport) {
        const archiveName = exportName.replace(`.${format}`, `-${format}.zip`);
        await downloadRenderedPlotArchive(plotExports, format, settings.exportScale, archiveName);
      } else if (format === 'svg') {
        downloadBlob(new Blob([rendered.svg], { type: 'image/svg+xml;charset=utf-8' }), exportName);
      } else {
        await downloadRenderedPlotPng(rendered.svg, settings.width, settings.height, settings.exportScale, exportName);
      }
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : 'Plot export failed');
    } finally {
      setExporting(null);
    }
  };
  const copySvg = async () => {
    if (!rendered.svg) return;
    try {
      await navigator.clipboard.writeText(rendered.svg);
      setNotice('SVG copied to clipboard');
    } catch {
      setError('Clipboard access is unavailable');
    }
  };

  const CloudStatusIcon = cloudSyncStatus === 'synced' ? CloudCheck : cloudSyncStatus === 'error' ? CloudOff : Cloud;
  const cloudStatusLabel = cloudSyncStatus === 'synced'
    ? 'Saved in cloud'
    : cloudSyncStatus === 'syncing'
      ? 'Saving to cloud…'
      : cloudSyncStatus === 'error'
        ? 'Cloud sync unavailable'
        : 'Cloud workspace';

  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div className="figure-studio-overlay fixed inset-0 z-[190] grid place-items-center p-2 backdrop-blur-[2px] sm:p-3" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-label={`${calculationName} figure studio`} className="figure-studio workspace-dark-surface flex h-[calc(100dvh-16px)] w-full max-w-[1780px] flex-col overflow-hidden rounded-[9px] border border-[#34373d] bg-[#0d0f12] shadow-[0_30px_110px_rgba(0,0,0,.62)] sm:h-[calc(100dvh-24px)]">
        <header className="figure-studio-header flex h-12 shrink-0 items-center gap-3 border-b border-[#2b2f35] px-3 sm:px-4">
          <span className="figure-studio-raised grid h-7 w-7 place-items-center rounded-[5px] border border-[#353a42] bg-[#171a1f] text-[#a7b0ba]"><SlidersHorizontal className="h-3.5 w-3.5" /></span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[11px] font-semibold text-[#edf0f3]">Figure studio</span>
            <span className="block truncate font-mono text-[8px] text-[#7f8994]">{calculationName} · {plotData?.kind ?? 'CSV'} · {visibleCount}/{activeQuantity?.series.length ?? 0} series</span>
          </span>
          <div className="hidden items-center gap-1 sm:flex">
            <button type="button" onClick={undo} disabled={!past.length} aria-label="Undo plot change" title="Undo (⌘Z)" className="figure-studio-button figure-studio-button--icon figure-studio-button--ghost"><Undo2 className="h-3.5 w-3.5" /></button>
            <button type="button" onClick={redo} disabled={!future.length} aria-label="Redo plot change" title="Redo (⇧⌘Z)" className="figure-studio-button figure-studio-button--icon figure-studio-button--ghost"><Redo2 className="h-3.5 w-3.5" /></button>
          </div>
          {settings && <span className="hidden items-center gap-1.5 font-mono text-[8px] text-[#737d88] md:flex"><CloudStatusIcon className={`h-3 w-3 ${cloudSyncStatus === 'synced' ? 'text-[#68a97b]' : cloudSyncStatus === 'error' ? 'text-[#c98286]' : 'text-[#8ea5c7]'}`} />{cloudStatusLabel}</span>}
          <button type="button" disabled={!rendered.svg || exporting !== null} onClick={() => void exportPlot('png')} className="figure-studio-button figure-studio-quick-export hidden md:inline-flex"><ImageDown className="h-3.5 w-3.5" />{exporting === 'png' ? 'Exporting…' : 'Export PNG'}</button>
          {onAddToFigure && <button type="button" onClick={onAddToFigure} className="figure-studio-button">Add to figure</button>}
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close figure studio" className="figure-studio-button figure-studio-button--icon figure-studio-button--ghost"><X className="h-4 w-4" /></button>
        </header>

        <div className="grid min-h-0 flex-1 grid-rows-[minmax(260px,1fr)_minmax(260px,46%)] lg:grid-cols-[minmax(0,1fr)_410px] lg:grid-rows-1">
          <main ref={stageRef} className="figure-studio-stage relative grid min-h-0 place-items-center overflow-auto bg-[#08090b] p-3 pb-14 sm:p-5 sm:pb-16">
            {loading && <div className="font-mono text-[9px] text-[#78828d]">Loading scientific data…</div>}
            {!loading && error && !plotData && <div className="figure-studio-error max-w-sm rounded-[7px] border border-[#4b3437] bg-[#1b1315] p-4 text-center"><span className="block text-[11px] font-semibold text-[#e1c2c5]">Figure studio unavailable</span><span className="mt-1 block text-[9px] leading-4 text-[#aa8f93]">{error}</span><button type="button" onClick={() => void loadArtifact()} className="figure-studio-button mt-3">Retry</button></div>}
            {!loading && rendered.svg && <div style={{ width: `${previewScale}%` }} className="figure-studio-preview max-w-none overflow-hidden rounded-[3px] shadow-[0_18px_60px_rgba(0,0,0,.42)] transition-[width] duration-150 [&_svg]:block [&_svg]:h-auto [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: rendered.svg }} />}
            {!loading && plotData && settings && !rendered.svg && <div role="status" aria-live="polite" className={`${companionLoading ? 'figure-studio-well text-[#89929d]' : 'figure-studio-error text-[#c79da3]'} max-w-md rounded-[6px] border border-[#343941] px-4 py-3 text-center text-[10px] leading-5`}><span>{rendered.issue}</span>{companionError && <button type="button" onClick={() => setCompanionRetry((value) => value + 1)} className="figure-studio-button mx-auto mt-3">Retry matched data</button>}</div>}
            {plotData && settings && <div className="figure-studio-floating absolute bottom-2.5 left-1/2 z-10 flex max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-1 overflow-x-auto rounded-[6px] border border-[#292e35] p-1">
              <button type="button" onClick={() => setManualPreviewScale(previewScale - 10)} aria-label="Zoom out" className="figure-studio-button figure-studio-button--icon figure-studio-button--ghost"><Minus className="h-3.5 w-3.5" /></button>
              <label className="flex items-center gap-2 whitespace-nowrap px-1 text-[8px] text-[#858f9a]"><LabSlider aria-label="Preview zoom" min="35" max="200" step="5" value={previewScale} onValueChange={setManualPreviewScale} className="w-20 sm:w-28" /><span className="w-8 text-right font-mono text-[#b0b8c1]">{previewScale}%</span></label>
              <button type="button" onClick={() => setManualPreviewScale(previewScale + 10)} aria-label="Zoom in" className="figure-studio-button figure-studio-button--icon figure-studio-button--ghost"><Plus className="h-3.5 w-3.5" /></button>
              <span className="figure-studio-rule mx-1 h-4 w-px shrink-0 bg-[#30353d]" />
              <button type="button" onClick={fitPreview} aria-pressed={previewMode === 'fit'} className="figure-studio-button figure-studio-button--ghost"><Maximize2 className="h-3 w-3" />Fit</button>
            </div>}
          </main>

          <aside className="figure-studio-inspector flex min-h-0 flex-col border-t border-[#2b2f35] bg-[#111318] lg:border-l lg:border-t-0">
            <nav aria-label="Figure controls" role="tablist" className="figure-studio-tabs grid shrink-0 grid-cols-4 gap-1 border-b border-[#2a2e34] p-1.5">
              {([
                ['series', 'Series'],
                ['axes', 'Axes'],
                ['style', 'Style'],
                ['export', 'Export'],
              ] as Array<[InspectorTab, string]>).map(([tab, label]) => <button key={tab} id={`figure-studio-tab-${tab}`} type="button" role="tab" aria-controls={`figure-studio-panel-${tab}`} aria-selected={activeTab === tab} onClick={() => setActiveTab(tab)} className="figure-studio-button figure-studio-button--ghost figure-studio-tab">{label}</button>)}
            </nav>

            <div className="min-h-0 flex-1 overflow-y-auto p-3.5">
              {plotData && settings && activeQuantity && <div id={`figure-studio-panel-${activeTab}`} role="tabpanel" aria-labelledby={`figure-studio-tab-${activeTab}`} className="grid gap-4">
                {activeTab === 'series' && <>
                  {bandDosEligible && <section className="grid gap-2.5 border-b border-[#2a2e34] pb-4">
                    <SectionTitle>Figure composition</SectionTitle>
                    <div className="figure-studio-segmented grid grid-cols-2">
                      <button type="button" aria-pressed={!combinedBandDos} onClick={() => setFigureLayout('single')} className="figure-studio-button figure-studio-button--segment">Single plot</button>
                      <button type="button" aria-pressed={combinedBandDos} disabled={!compatibleCompanions.length && !combinedBandDos} onClick={() => setFigureLayout('band-dos')} className="figure-studio-button figure-studio-button--segment"><ChartNoAxesCombined className="h-3.5 w-3.5" />Band + DOS</button>
                    </div>
                    {!compatibleCompanions.length && <p className="figure-studio-well rounded-[5px] border border-[#30353d] px-2.5 py-2 text-[10px] leading-4 text-[#7f8994]">No matching run available. Complete Band structure and DOS using the same structure source and SCF settings. Older results may not include the matching details.</p>}
                    {combinedBandDos && compatibleCompanions.length > 0 && <>
                      <SelectControl label="Matched calculation" value={settings.pairedJobId ?? ''} options={[...(!selectedCompanion ? [{ value: '', label: 'Choose a matching run' }] : []), ...compatibleCompanions.map((candidate) => ({ value: candidate.jobId, label: companionLabel(candidate) }))]} onChange={(pairedJobId) => { if (pairedJobId) commit((current) => ({ ...current, pairedJobId, combinedEnergyMin: null, combinedEnergyMax: null, combinedDosMin: null, combinedDosMax: null })); }} />
                      {selectedCompanion && <div className="figure-studio-well rounded-[5px] border border-[#30353d] px-2.5 py-2 text-[10px] leading-4 text-[#89929d]"><span className="block break-all font-mono text-[9px]">{selectedCompanion.backendCalculationId ?? selectedCompanion.jobId}</span><span className="mt-1 block">Same geometry and SCF settings. Each panel is relative to its run’s Fermi energy.</span></div>}
                      <div className="figure-studio-segmented grid grid-cols-2">
                        <button type="button" aria-pressed={editablePlotData?.kind === 'band'} onClick={() => chooseSeriesPanel(plotData.kind === 'band' ? 'primary' : 'companion')} className="figure-studio-button figure-studio-button--segment">Band curves</button>
                        <button type="button" aria-pressed={editablePlotData?.kind === 'dos'} onClick={() => chooseSeriesPanel(plotData.kind === 'dos' ? 'primary' : 'companion')} className="figure-studio-button figure-studio-button--segment">DOS curves</button>
                      </div>
                    </>}
                  </section>}
                  {editablePlotData && editablePlotData.quantities.length > 1 && <SelectControl label={editablePlotData.kind === 'thermoelectric' ? 'Edit panel' : 'Displayed quantity'} value={settings.quantityId} options={editablePlotData.quantities.map((quantity) => ({ value: quantity.id, label: quantity.label }))} onChange={chooseQuantity} />}
                  <section className="grid gap-2.5">
                    <SectionTitle action={<span className="flex gap-2"><button type="button" onClick={() => setAllSeriesVisibility(true)} className="figure-studio-button figure-studio-button--text">Show all</button><button type="button" onClick={() => setAllSeriesVisibility(false)} className="figure-studio-button figure-studio-button--text">Hide all</button></span>}>Data series · {visibleCount}/{activeQuantity.series.length}</SectionTitle>
                    <div className="figure-studio-well max-h-[250px] overflow-y-auto rounded-[6px] border border-[#30353d] bg-[#0e1014] p-1">
                      {activeQuantity.series.map((series, index) => {
                        const style = settings.seriesStyles[series.id];
                        const color = plotSeriesColor(settings, editablePlotData?.kind === 'band' || editablePlotData?.kind === 'phonon' ? 0 : index, style?.color);
                        const selected = selectedSeries?.id === series.id;
                        return <div key={series.id} data-selected={selected} className="figure-studio-series-row flex items-center gap-1 px-1">
                          <button type="button" onClick={() => updateSeries(series.id, { visible: style?.visible === false })} aria-label={`${style?.visible === false ? 'Show' : 'Hide'} ${style?.label || series.label}`} className="figure-studio-button figure-studio-button--icon figure-studio-button--ghost">{style?.visible === false ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}</button>
                          <button type="button" onClick={() => setSelectedSeriesId(series.id)} className="figure-studio-series-button flex min-w-0 flex-1 items-center gap-2 text-left">
                            <span className="h-0.5 w-5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                            <span className={`truncate text-[9px] ${style?.visible === false ? 'text-[#5f6873] line-through' : 'text-[#bfc6ce]'}`}>{style?.label || series.label}</span>
                          </button>
                        </div>;
                      })}
                    </div>
                  </section>

                  {selectedSeries && selectedStyle && <section className="grid gap-2.5 border-t border-[#2a2e34] pt-4">
                    <SectionTitle>Selected curve</SectionTitle>
                    <TextControl label="Legend label" value={selectedStyle.label} onChange={(value) => updateSeries(selectedSeries.id, { label: value })} />
                    <div className="grid grid-cols-[1fr_92px] gap-2">
                      <div className={CONTROL_LABEL}>Curve color<FigureColorField label="Curve color" value={selectedStyle.color ?? plotSeriesColor(settings, editablePlotData?.kind === 'band' || editablePlotData?.kind === 'phonon' ? 0 : selectedSeriesIndex)} onChange={(color) => updateSeries(selectedSeries.id, { color })} /></div>
                      <button type="button" onClick={() => updateSeries(selectedSeries.id, { color: null })} className="figure-studio-button self-end">Use palette</button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <SelectControl<PlotLineStyle> label="Line pattern" value={selectedStyle.lineStyle} options={[{ value: 'solid', label: 'Solid' }, { value: 'dash', label: 'Dashed' }, { value: 'dot', label: 'Dotted' }, { value: 'dashdot', label: 'Dash · dot' }]} onChange={(value) => updateSeries(selectedSeries.id, { lineStyle: value })} />
                      <SelectControl<PlotMarker> label="Markers" value={selectedStyle.marker} options={[{ value: 'none', label: 'None' }, { value: 'circle', label: 'Circle' }, { value: 'square', label: 'Square' }, { value: 'diamond', label: 'Diamond' }]} onChange={(value) => updateSeries(selectedSeries.id, { marker: value })} />
                    </div>
                    <label className={CONTROL_LABEL}>Curve width <span className="figure-studio-control flex h-9 items-center gap-2 rounded-[5px] border border-[#343941] bg-[#15181d] px-2.5"><LabSlider aria-label="Curve width" min="0.4" max="6" step="0.1" value={selectedStyle.lineWidth ?? settings.lineWidth} onValueChange={(lineWidth) => updateSeries(selectedSeries.id, { lineWidth })} className="min-w-0 flex-1" /><span className="w-8 text-right font-mono text-[9px] font-normal normal-case tracking-normal text-[#c7cdd4]">{(selectedStyle.lineWidth ?? settings.lineWidth).toFixed(1)}</span></span></label>
                    {selectedStyle.marker !== 'none' && <label className={CONTROL_LABEL}>Marker size <span className="figure-studio-control flex h-9 items-center gap-2 rounded-[5px] border border-[#343941] bg-[#15181d] px-2.5"><LabSlider aria-label="Marker size" min="2" max="10" step="0.5" value={selectedStyle.markerSize} onValueChange={(markerSize) => updateSeries(selectedSeries.id, { markerSize })} className="min-w-0 flex-1" /><span className="w-8 text-right font-mono text-[9px] font-normal normal-case tracking-normal text-[#c7cdd4]">{selectedStyle.markerSize}</span></span></label>}
                  </section>}
                </>}

                {activeTab === 'axes' && <>
                  <section className="grid gap-2.5 border-b border-[#2a2e34] pb-4">
                    <SectionTitle action={<button type="button" onClick={() => combinedBandDos ? commit((current) => ({ ...current, combinedEnergyMin: null, combinedEnergyMax: null, combinedDosMin: null, combinedDosMax: null })) : commit((current) => ({ ...current, xMin: null, xMax: null, yMin: null, yMax: null }))} className="figure-studio-button figure-studio-button--text">Auto range</button>}>{combinedBandDos ? 'Shared energy viewport' : 'Viewport'}</SectionTitle>
                    {combinedBandDos ? <>
                      <div className="grid grid-cols-2 gap-2"><NumericControl label="Energy min (eV)" value={settings.combinedEnergyMin} placeholder="Auto overlap" onChange={(value) => update('combinedEnergyMin', value)} /><NumericControl label="Energy max (eV)" value={settings.combinedEnergyMax} placeholder="Auto overlap" onChange={(value) => update('combinedEnergyMax', value)} /></div>
                      {combinedBounds && <><span className="text-[9px] text-[#89929d]">Shared data coverage: {combinedBounds.min.toFixed(3)} to {combinedBounds.max.toFixed(3)} eV</span><button type="button" disabled={Math.min(5, combinedBounds.max) <= Math.max(-5, combinedBounds.min)} onClick={() => commit((current) => ({ ...current, combinedEnergyMin: Math.max(-5, combinedBounds.min), combinedEnergyMax: Math.min(5, combinedBounds.max) }))} className="figure-studio-button">Focus near Fermi · ±5 eV</button></>}
                      <div className="grid grid-cols-2 gap-2"><NumericControl label="DOS min" value={settings.combinedDosMin} placeholder="Auto" onChange={(value) => update('combinedDosMin', value)} /><NumericControl label="DOS max" value={settings.combinedDosMax} placeholder="Auto" onChange={(value) => update('combinedDosMax', value)} /></div>
                      <label className={CONTROL_LABEL}>DOS panel width <span className="figure-studio-control flex h-9 items-center gap-2 rounded-[5px] border border-[#343941] bg-[#15181d] px-2.5"><LabSlider aria-label="DOS panel width" min="20" max="45" step="1" value={settings.combinedDosWidthPercent} onValueChange={(value) => update('combinedDosWidthPercent', value)} className="min-w-0 flex-1" /><span className="w-8 text-right font-mono text-[9px] font-normal normal-case tracking-normal text-[#c7cdd4]">{settings.combinedDosWidthPercent}%</span></span></label>
                    </> : <>
                      <div className="grid grid-cols-2 gap-2"><NumericControl label="X min" value={settings.xMin} placeholder="Auto" onChange={(value) => update('xMin', value)} /><NumericControl label="X max" value={settings.xMax} placeholder="Auto" onChange={(value) => update('xMax', value)} /><NumericControl label="Y min" value={settings.yMin} placeholder="Auto" onChange={(value) => update('yMin', value)} /><NumericControl label="Y max" value={settings.yMax} placeholder="Auto" onChange={(value) => update('yMax', value)} /></div>
                      <div className="grid grid-cols-2 gap-2"><button type="button" disabled={!dataExtent} onClick={() => setSymmetricRange('x')} className="figure-studio-button">Center X at 0</button><button type="button" disabled={!dataExtent} onClick={() => setSymmetricRange('y')} className="figure-studio-button">Center Y at 0</button></div>
                      <div className="grid grid-cols-2 gap-2"><SelectControl<PlotAxisScale> label="X scale" value={settings.xScale} options={[{ value: 'linear', label: 'Linear' }, { value: 'log', label: 'Log₁₀' }]} onChange={(value) => update('xScale', value)} /><SelectControl<PlotAxisScale> label="Y scale" value={settings.yScale} options={[{ value: 'linear', label: 'Linear' }, { value: 'log', label: 'Log₁₀' }]} onChange={(value) => update('yScale', value)} /></div>
                    </>}
                  </section>
                  <section className="grid gap-2.5 border-b border-[#2a2e34] pb-4">
                    <SectionTitle>Ticks & frame</SectionTitle>
                    <div className="grid grid-cols-2 gap-2"><NumericControl label="X tick target" value={settings.xTickCount} placeholder="6" min={2} max={12} step={1} onChange={(value) => update('xTickCount', value ?? 6)} /><NumericControl label="Y tick target" value={settings.yTickCount} placeholder="6" min={2} max={12} step={1} onChange={(value) => update('yTickCount', value ?? 6)} /></div>
                    <div className="grid grid-cols-2 gap-2"><SelectControl<PlotTickFormat> label="Number format" value={settings.tickFormat} options={[{ value: 'auto', label: 'Automatic' }, { value: 'fixed', label: 'Fixed decimal' }, { value: 'scientific', label: 'Scientific' }]} onChange={(value) => update('tickFormat', value)} /><NumericControl label="Decimals" value={settings.tickDecimals} placeholder="2" min={0} max={6} step={1} onChange={(value) => update('tickDecimals', value ?? 2)} /></div>
                    <div className="grid grid-cols-2 gap-2"><ToggleControl label="Major grid" checked={settings.showGrid} onChange={(value) => update('showGrid', value)} /><ToggleControl label="Minor grid" checked={settings.showMinorGrid} onChange={(value) => update('showMinorGrid', value)} /><ToggleControl label="Full frame" checked={settings.showFrame} onChange={(value) => update('showFrame', value)} />{!combinedBandDos && <ToggleControl label="X = 0 line" checked={settings.showXZero} onChange={(value) => update('showXZero', value)} />}<ToggleControl label={combinedBandDos ? 'Fermi · E = 0' : 'Y = 0 line'} checked={settings.showYZero} onChange={(value) => update('showYZero', value)} /></div>
                  </section>
                  {!combinedBandDos && <section className="grid gap-2.5">
                    <SectionTitle>Reference guide</SectionTitle>
                    <div className="grid grid-cols-2 gap-2"><NumericControl label="Vertical at X" value={settings.xReference} placeholder="None" onChange={(value) => update('xReference', value)} /><NumericControl label="Horizontal at Y" value={settings.yReference} placeholder="None" onChange={(value) => update('yReference', value)} /></div>
                    <TextControl label="Guide label" value={settings.referenceLabel} placeholder="e.g. Fermi level" onChange={(value) => update('referenceLabel', value)} />
                  </section>}
                </>}

                {activeTab === 'style' && <>
                  <section className="grid gap-2.5 border-b border-[#2a2e34] pb-4">
                    <SectionTitle>Figure text</SectionTitle>
                    <TextControl label="Title" value={settings.title} onChange={(value) => update('title', value)} />
                    <TextControl label="Subtitle" value={settings.subtitle} placeholder="Optional method, material, or condition" onChange={(value) => update('subtitle', value)} />
                    {!combinedBandDos && <><TextControl label="X axis label" value={settings.xLabel} onChange={(value) => update('xLabel', value)} /><TextControl label="Y axis label" value={settings.yLabel} onChange={(value) => update('yLabel', value)} /></>}
                  </section>
                  <section className="grid gap-2.5 border-b border-[#2a2e34] pb-4">
                    <SectionTitle>Typography</SectionTitle>
                    <SelectControl<PlotFont> label="Typeface" value={settings.fontFamily} options={[{ value: 'sans', label: 'Sans serif' }, { value: 'serif', label: 'Serif' }, { value: 'mono', label: 'Monospace' }]} onChange={(value) => update('fontFamily', value)} />
                    <div className="grid grid-cols-3 gap-2"><NumericControl label="Title pt" value={settings.titleFontSize} placeholder="25" min={12} max={52} step={1} onChange={(value) => update('titleFontSize', value ?? 25)} /><NumericControl label="Axis pt" value={settings.labelFontSize} placeholder="20" min={10} max={40} step={1} onChange={(value) => update('labelFontSize', value ?? 20)} /><NumericControl label="Tick pt" value={settings.tickFontSize} placeholder="17" min={8} max={32} step={1} onChange={(value) => update('tickFontSize', value ?? 17)} /></div>
                  </section>
                  <section className="grid gap-2.5">
                    <SectionTitle>Canvas & legend</SectionTitle>
                    <div className="grid grid-cols-2 gap-2"><SelectControl<PlotPalette> label="Palette" value={settings.palette} options={[{ value: 'colorblind', label: 'Colorblind safe' }, { value: 'graphite', label: 'Graphite' }, { value: 'viridis', label: 'Viridis' }, { value: 'cobalt', label: 'Cobalt' }, { value: 'warm', label: 'Warm' }, { value: 'mono', label: 'Monochrome' }]} onChange={(value) => update('palette', value)} /><SelectControl<PlotTheme> label="Canvas" value={settings.theme} options={[{ value: 'paper', label: 'White paper' }, { value: 'warm-paper', label: 'Warm paper' }, { value: 'dark', label: 'Dark' }, { value: 'transparent', label: 'Transparent' }]} onChange={(value) => update('theme', value)} /></div>
                    <label className={CONTROL_LABEL}>Default line width <span className="figure-studio-control flex h-9 items-center gap-2 rounded-[5px] border border-[#343941] bg-[#15181d] px-2.5"><LabSlider aria-label="Default line width" min="0.4" max="6" step="0.1" value={settings.lineWidth} onValueChange={(value) => update('lineWidth', value)} className="min-w-0 flex-1" /><span className="w-8 text-right font-mono text-[9px] font-normal normal-case tracking-normal text-[#c7cdd4]">{settings.lineWidth.toFixed(1)}</span></span></label>
                    <ToggleControl label="Show legend" checked={settings.showLegend} onChange={(value) => update('showLegend', value)} />
                    {settings.showLegend && !combinedBandDos && <SelectControl<PlotLegendPosition> label="Legend position" value={settings.legendPosition} options={[{ value: 'top', label: 'Above plot' }, { value: 'right', label: 'Outside right' }, { value: 'inside-ne', label: 'Inside · upper right' }, { value: 'inside-nw', label: 'Inside · upper left' }]} onChange={(value) => update('legendPosition', value)} />}
                  </section>
                </>}

                {activeTab === 'export' && <>
                  <section className="grid gap-2.5 border-b border-[#2a2e34] pb-4">
                    <SectionTitle action={<button type="button" aria-pressed={aspectLocked} onClick={() => setAspectLocked((locked) => !locked)} className="figure-studio-button figure-studio-button--text">{aspectLocked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}{aspectLocked ? 'Ratio locked' : 'Free ratio'}</button>}>Canvas size</SectionTitle>
                    <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2"><NumericControl label="Width" value={settings.width} placeholder="1200" min={480} max={6000} step={1} onChange={(value) => updateFigureDimension('width', value)} /><span className="mb-3 font-mono text-[10px] text-[#5f6873]">×</span><NumericControl label="Height" value={settings.height} placeholder="800" min={360} max={6000} step={1} onChange={(value) => updateFigureDimension('height', value)} /></div>
                    <span className="-mt-1 font-mono text-[8px] text-[#68727e]">480–6000 px per side · current ratio {(settings.width / settings.height).toFixed(3)}</span>
                    <div className="figure-studio-size-presets">{[[1200, 800, 'Paper landscape'], [1600, 1600, 'Square'], [1200, 1600, 'Portrait'], [1920, 1080, 'Screen 16:9']].map(([width, height, label]) => <button key={label} type="button" onClick={() => applyFigureSize(Number(width), Number(height))} aria-pressed={settings.width === width && settings.height === height} className="figure-studio-button figure-studio-size-preset"><span>{label}</span><span className="figure-studio-size-detail">{width} × {height}</span></button>)}</div>
                    <SelectControl label="PNG output resolution" value={String(settings.exportScale)} options={[
                      { value: '1', label: `Standard · ${settings.width} × ${settings.height} px` },
                      { value: '2', label: `High · ${settings.width * 2} × ${settings.height * 2} px` },
                      { value: '3', label: `Ultra · ${settings.width * 3} × ${settings.height * 3} px` },
                      { value: '4', label: `Maximum · ${settings.width * 4} × ${settings.height * 4} px` },
                    ].slice(0, maximumRasterScale)} onChange={(value) => update('exportScale', Number(value))} />
                  </section>
                  <section className="grid gap-2.5">
                    <SectionTitle>Export files</SectionTitle>
                    <div className="figure-studio-well rounded-[6px] border border-[#30353d] bg-[#0e1014] p-3 font-mono text-[8px] leading-4 text-[#7d8792]"><span className="block truncate text-[#b8c0c9]">{multiPlotExport ? 'thermoelectric-properties · 4 figures' : plotDownloadFilename(combinedBandDos ? 'Electronic structure band DOS' : calculationName, 'png')}</span><span className="block">{multiPlotExport ? `ZIP · 4 PNG files · ${settings.exportScale}×` : `PNG · ${settings.width * settings.exportScale} × ${settings.height * settings.exportScale}px`}</span><span className="block">{multiPlotExport ? 'Preview remains a combined 2 × 2 figure' : combinedBandDos ? 'Band and DOS share the same energy axis' : 'SVG · editable vectors and text'}</span></div>
                    <div className="grid grid-cols-2 gap-2"><button type="button" disabled={!rendered.svg || exporting !== null} onClick={() => void exportPlot('png')} className="figure-studio-button figure-studio-button--primary"><ImageDown className="h-3.5 w-3.5" />{exporting === 'png' ? 'Exporting…' : multiPlotExport ? '4 PNG · ZIP' : `PNG · ${settings.exportScale}×`}</button><button type="button" disabled={!rendered.svg || exporting !== null} onClick={() => void exportPlot('svg')} className="figure-studio-button"><Download className="h-3.5 w-3.5" />{exporting === 'svg' ? 'Exporting…' : multiPlotExport ? '4 SVG · ZIP' : 'SVG'}</button></div>
                    <button type="button" disabled={!rendered.svg} onClick={() => void copySvg()} className="figure-studio-button figure-studio-button--ghost"><Copy className="h-3 w-3" />Copy editable SVG</button>
                  </section>
                </>}

                {(error || notice || rendered.issue) && <div role="status" className={`rounded-[5px] border px-2.5 py-2 text-[9px] leading-4 ${error || rendered.issue ? 'figure-studio-error border-[#4b3437] bg-[#1b1315] text-[#c69da2]' : 'figure-studio-notice border-[#30473a] bg-[#111b15] text-[#8fb49a]'}`}>{error ?? rendered.issue ?? notice}</div>}
                <button type="button" onClick={reset} className="figure-studio-button figure-studio-button--ghost"><RotateCcw className="h-3 w-3" />Reset figure</button>
              </div>}
            </div>
          </aside>
        </div>
      </section>
    </div>,
    document.body,
  );
}

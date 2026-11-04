'use client';

import { AnimatePresence, motion } from 'framer-motion';
import {
  Check,
  CircleAlert,
  Database,
  ExternalLink,
  DatabaseSearch,
  LoaderCircle,
  Search,
  X,
} from 'lucide-react';
import { FormEvent, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { CrystalDatabaseMaterial, CrystalDatabaseSource } from '@/lib/crystal-database';
import { cn } from '@/lib/utils';

export type MaterialsProjectMaterial = CrystalDatabaseMaterial;

type SearchResponse = {
  materials?: MaterialsProjectMaterial[];
  source?: MaterialsProjectMaterial['source'];
  error?: string;
  code?: string;
  warnings?: string[];
};

const quickSearches = ['Si', 'MoS2', 'Fe2O3', 'Si-O', 'cod-1526655'];

function Metric({ label, value }: { label: string; value: string }) {
  return <span className="min-w-0"><span className="block text-[9px] uppercase tracking-[0.06em] text-[var(--panel-muted)]">{label}</span><span className="mt-0.5 block truncate font-mono text-[10px] text-[var(--panel-text)]">{value}</span></span>;
}

export function MaterialsProjectBrowser({
  open,
  databaseName,
  onClose,
  onImport,
  target = 'project',
}: {
  open: boolean;
  databaseName: string;
  onClose: () => void;
  onImport: (materials: MaterialsProjectMaterial[]) => void | Promise<void>;
  target?: 'project' | 'structure';
}) {
  const [query, setQuery] = useState('Si');
  const [materials, setMaterials] = useState<MaterialsProjectMaterial[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [missingKey, setMissingKey] = useState(false);
  const [source, setSource] = useState<MaterialsProjectMaterial['source']>('Crystallography Open Database');
  const [provider, setProvider] = useState<CrystalDatabaseSource>('cod');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => { if (!open) { request.current?.abort(); queueMicrotask(() => setLoading(false)); } }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose, open]);

  const selectedMaterials = useMemo(
    () => materials.filter((material) => selected.has(material.materialId)),
    [materials, selected],
  );

  const search = async (event?: FormEvent, nextQuery?: string) => {
    event?.preventDefault();
    const value = (nextQuery ?? query).trim();
    if (!value) return;
    setQuery(value);
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setLoading(true);
    setWarnings([]);
    setError(null);
    setImportError(null);
    setMissingKey(false);
    setSource(provider === 'cod' ? 'Crystallography Open Database' : 'Materials Project');
    setSelected(new Set());
    try {
      const response = await fetch(`/api/materials-project?q=${encodeURIComponent(value)}&source=${provider}&limit=12`, { signal: controller.signal });
      const payload = await response.json() as SearchResponse;
      if (controller.signal.aborted) return;
      setWarnings(payload.warnings ?? []);
      if (!response.ok) {
        setMaterials([]);
        setMissingKey(payload.code === 'MP_API_KEY_MISSING');
        setError(payload.error ?? 'Search failed.');
        return;
      }
      setSource(payload.source ?? (provider === 'cod' ? 'Crystallography Open Database' : 'Materials Project'));
      setMaterials(payload.materials ?? []);
    } catch (requestError) {
      if (controller.signal.aborted) return;
      setMaterials([]);
      setError(requestError instanceof Error ? requestError.message : 'Search failed.');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  };

  const toggle = (materialId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(materialId)) next.delete(materialId);
      else { if (target === 'structure') next.clear(); next.add(materialId); }
      return next;
    });
  };

  const importSelected = async () => {
    if (!selectedMaterials.length || importing) return;
    setImporting(true); setImportError(null);
    try { await onImport(selectedMaterials); setSelected(new Set()); onClose(); }
    catch (failure) { setImportError(failure instanceof Error ? failure.message : 'Import could not be saved. Your existing structures were preserved.'); }
    finally { setImporting(false); }
  };

  const sourceLabel = source === 'Crystallography Open Database' ? 'Crystallography Open Database' : 'Materials Project';
  return typeof document === 'undefined' ? null : createPortal(<AnimatePresence>{open && <motion.div style={{ '--panel-bg':'var(--surface)', '--panel-raised':'var(--raised)', '--panel-hover':'var(--surface-subtle)', '--panel-selected':'var(--surface-subtle)', '--panel-border':'var(--line)', '--panel-text':'var(--ink)', '--panel-muted':'var(--muted-ink)' } as CSSProperties} className="fixed inset-0 z-[110] flex items-center justify-center bg-black/55 p-3 backdrop-blur-[2px] sm:p-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <motion.section role="dialog" aria-modal="true" aria-label={`${sourceLabel} browser`} initial={{ opacity: 0, y: 12, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.99 }} transition={{ duration: 0.16, ease: 'easeOut' }} className="workspace-dark-surface flex h-[min(680px,calc(100svh-24px))] w-full max-w-[860px] flex-col overflow-hidden rounded-[11px] border border-[var(--panel-border)] bg-[var(--panel-bg)] shadow-[0_28px_80px_rgba(0,0,0,.46)]">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--panel-border)] bg-[var(--panel-bg)] px-4"><span className="grid h-8 w-8 place-items-center rounded-[7px] border border-[var(--line)] bg-[var(--surface-subtle)] text-[var(--panel-text)]"><DatabaseSearch className="h-4 w-4" /></span><span className="min-w-0"><span className="block text-[12px] font-semibold text-[var(--panel-text)]">Crystal database</span><span className="block text-[10px] text-[var(--panel-muted)]">{target === 'structure' ? 'Choose a structure for' : 'Import crystal structures into'} {databaseName}</span></span><a href={source === 'Crystallography Open Database' ? 'https://www.crystallography.net/' : 'https://materialsproject.org'} target="_blank" rel="noreferrer" className="ml-auto hidden h-7 items-center gap-1.5 rounded-[5px] px-2 text-[10px] text-[var(--panel-muted)] hover:bg-[var(--panel-hover)] sm:flex">{source === 'Crystallography Open Database' ? 'crystallography.net' : 'materialsproject.org'} <ExternalLink className="h-3 w-3" /></a><button type="button" onClick={onClose} aria-label="Close crystal database browser" className="grid h-8 w-8 place-items-center rounded-[6px] text-[var(--panel-muted)] hover:bg-[var(--panel-hover)] hover:text-[var(--panel-text)]"><X className="h-4 w-4" /></button></header>

      <div className="shrink-0 border-b border-[var(--panel-border)] bg-[var(--panel-raised)] p-3.5"><form onSubmit={(event) => void search(event)} className="flex flex-wrap gap-2"><label className="flex h-9 items-center gap-2 text-[10px] text-[var(--panel-muted)]">Source<select aria-label="Crystal database source" value={provider} onChange={event => { request.current?.abort(); setLoading(false); setProvider(event.target.value as CrystalDatabaseSource); setSource(event.target.value === 'cod' ? 'Crystallography Open Database' : 'Materials Project'); setMaterials([]); setSelected(new Set()); setWarnings([]); setError(null); setImportError(null); setMissingKey(false); }} className="h-9 rounded-[6px] border border-[var(--panel-border)] bg-[var(--panel-bg)] px-2 text-[11px] text-[var(--panel-text)]"><option value="cod">COD · no account</option><option value="materials-project">Materials Project · API key</option></select></label><label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-[6px] border border-[var(--panel-border)] bg-[var(--panel-bg)] px-3 focus-within:border-[var(--field-focus-border)]"><Search className="h-3.5 w-3.5 shrink-0 text-[var(--panel-muted)]" /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={provider === 'cod' ? 'Formula, elements, keyword, or cod-1234567' : 'Formula, elements, chemical system, or mp-149'} className="min-w-0 flex-1 bg-transparent text-[11px] text-[var(--panel-text)] outline-none placeholder:text-[var(--panel-muted)]" /></label><button type="submit" disabled={loading || !query.trim()} className="flex h-9 items-center gap-1.5 rounded-[6px] bg-[var(--accent)] px-4 text-[11px] font-semibold text-[var(--on-accent)] hover:bg-[var(--accent-strong)] disabled:bg-[var(--panel-border)] disabled:text-[var(--panel-muted)]">{loading ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}Search</button></form><div className="mt-2 flex flex-wrap items-center gap-1.5"><span className="mr-1 text-[9px] uppercase tracking-[0.08em] text-[var(--panel-muted)]">Examples</span>{(provider === 'cod' ? quickSearches : ['Si', 'MoS2', 'Fe2O3', 'Si-O', 'mp-149']).map((value) => <button key={value} type="button" onClick={() => void search(undefined, value)} className="h-6 rounded-[5px] border border-[var(--panel-border)] bg-[var(--panel-bg)] px-2 font-mono text-[10px] text-[var(--panel-muted)] hover:border-[var(--line-strong)] hover:bg-[var(--panel-hover)] hover:text-[var(--panel-text)]">{value}</button>)}</div></div>

      {target === 'structure' && <p className="border-b border-[var(--panel-border)] px-4 py-2 text-[11px] text-[var(--panel-muted)]">Replaces the geometry in this Crystal module. Undo restores the previous structure.</p>}
      <div className="min-h-0 flex-1 overflow-auto">
        {importError && <div role="alert" className="border-b border-[var(--panel-border)] px-4 py-3 text-[11px] leading-4 text-rose-400"><strong className="block">Import could not be saved</strong><p>{importError}</p></div>}
        {warnings.length > 0 && <div role="status" className="border-b border-[var(--panel-border)] px-4 py-3 text-[10px] leading-4 text-[var(--panel-muted)]">{warnings.map(warning => <p key={warning}>{warning}</p>)}</div>}
        {loading && <div className="grid h-full min-h-[240px] place-items-center"><span className="text-center"><LoaderCircle className="mx-auto h-5 w-5 animate-spin text-[var(--accent)]" /><span className="mt-3 block text-[11px] font-medium text-[var(--panel-text)]">Searching crystal databases</span><span className="mt-1 block text-[10px] text-[var(--panel-muted)]">Retrieving structures and source metadata</span></span></div>}
        {!loading && error && <div className="mx-auto flex max-w-[480px] flex-col items-center px-6 py-14 text-center"><span className={cn('grid h-10 w-10 place-items-center rounded-full', missingKey ? 'bg-[var(--panel-raised)] text-[var(--panel-muted)]' : 'bg-rose-500/10 text-rose-400')}><CircleAlert className="h-5 w-5" /></span><p className="mt-4 text-[12px] font-semibold text-[var(--panel-text)]">{missingKey ? 'Materials Project unavailable' : 'Search unavailable'}</p><p className="mt-1.5 text-[11px] leading-4 text-[var(--panel-muted)]">{missingKey ? 'Set MP_API_KEY in the server/launcher environment and restart. You can select COD to search without an account; sources are never substituted silently.' : error}</p></div>}
        {!loading && !error && !materials.length && <div className="grid h-full min-h-[240px] place-items-center px-6 text-center"><span><Database className="mx-auto h-5 w-5 text-[var(--panel-muted)]" /><span className="mt-3 block text-[11px] font-medium text-[var(--panel-muted)]">Search a formula or material name</span></span></div>}
        {!loading && !error && materials.length > 0 && <div className="min-w-[440px]"><div className="sticky top-0 z-10 grid grid-cols-[28px_minmax(150px,1.4fr)_minmax(120px,1fr)_96px] border-b border-[var(--panel-border)] bg-[var(--panel-raised)]/95 px-3 py-2 text-[9px] uppercase tracking-[0.08em] text-[var(--panel-muted)] backdrop-blur sm:grid-cols-[28px_minmax(170px,1.5fr)_minmax(150px,1fr)_repeat(3,90px)]"><span /><span>Material</span><span>Structure</span><span>Band gap</span><span className="hidden sm:block">E above hull</span><span className="hidden sm:block">Density</span></div>{materials.map((material) => { const checked = selected.has(material.materialId); return <button key={material.materialId} type="button" onClick={() => toggle(material.materialId)} className={cn('grid w-full grid-cols-[28px_minmax(150px,1.4fr)_minmax(120px,1fr)_96px] items-center border-b border-[var(--panel-border)] px-3 py-2.5 text-left hover:bg-[var(--panel-hover)] sm:grid-cols-[28px_minmax(170px,1.5fr)_minmax(150px,1fr)_repeat(3,90px)]', checked && 'bg-[var(--panel-selected)] hover:bg-[var(--panel-hover)]')}>
          <span className={cn('grid h-4 w-4 place-items-center rounded-[3px] border', checked ? 'border-[var(--line-strong)] bg-white text-black' : 'border-[var(--panel-border)] bg-[var(--panel-bg)]')}>{checked && <Check className="h-3 w-3" />}</span><span className="min-w-0"><span className="flex items-center gap-2"><span className="truncate text-[12px] font-semibold text-[var(--panel-text)]">{material.formula}</span>{material.isStable && <span className="rounded-[3px] border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-medium text-emerald-400">stable</span>}</span><span className="mt-0.5 block font-mono text-[10px] text-[var(--panel-muted)]">{material.materialId} · {material.numSites} sites{material.warnings.length > 0 ? ' · ordering required' : ''}</span></span><span className="min-w-0"><span className="block truncate text-[11px] text-[var(--panel-text)]">{material.spaceGroupSymbol}{material.spaceGroupNumber === undefined ? '' : ` · ${material.spaceGroupNumber}`}</span><span className="mt-0.5 block truncate text-[10px] capitalize text-[var(--panel-muted)]">{material.crystalSystem} · {material.theoretical === undefined ? 'source record' : material.theoretical ? 'theoretical' : 'reported'}</span></span><Metric label="Eg" value={material.bandGap === undefined ? '—' : `${material.bandGap.toFixed(3)} eV`} /><span className="hidden sm:block"><Metric label="Ehull" value={material.energyAboveHull === undefined ? '—' : `${material.energyAboveHull.toFixed(4)} eV`} /></span><span className="hidden sm:block"><Metric label="ρ" value={material.density === undefined ? '—' : `${material.density.toFixed(3)} g/cm³`} /></span></button>; })}</div>}
      </div>

      <footer className="flex h-14 shrink-0 items-center gap-3 border-t border-[var(--panel-border)] bg-[var(--panel-bg)] px-4"><span className="min-w-0 flex-1 text-[11px] font-medium text-[var(--panel-muted)]">{selected.size ? `${selected.size} selected · original source, SHA-256 and provenance retained` : 'Imports preserve the original source, SHA-256 and provenance.'}</span><button type="button" onClick={onClose} className="h-8 rounded-[6px] px-3 text-[11px] font-medium text-[var(--panel-muted)] hover:bg-[var(--panel-hover)] hover:text-[var(--panel-text)]">Cancel</button><button type="button" disabled={!selected.size || importing || loading} onClick={() => void importSelected()} className="flex h-8 items-center gap-1.5 rounded-[6px] bg-[var(--accent)] px-4 text-[11px] font-semibold text-[var(--on-accent)] hover:bg-[var(--accent-strong)] disabled:bg-[var(--panel-border)] disabled:text-[var(--panel-muted)]">{importing ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Database className="h-3.5 w-3.5" />}{importing ? target === 'structure' ? 'Applying…' : 'Saving…' : target === 'structure' ? 'Use structure' : 'Import'}</button></footer>
    </motion.section>
  </motion.div>}</AnimatePresence>, document.body);
}

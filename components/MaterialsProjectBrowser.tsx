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
import { FormEvent, useEffect, useMemo, useState } from 'react';
import type { CustomAtom, LatticeParameters } from '@/components/CrystalViewer';
import { cn } from '@/lib/utils';

export type MaterialsProjectMaterial = {
  materialId: string;
  formula: string;
  spaceGroupSymbol: string;
  spaceGroupNumber: number;
  crystalSystem: string;
  numSites: number;
  bandGap: number;
  energyAboveHull: number;
  isStable: boolean;
  density: number;
  magneticOrdering: string;
  theoretical: boolean;
  lastUpdated: string | null;
  lattice: LatticeParameters;
  atoms: CustomAtom[];
};

type SearchResponse = {
  materials?: MaterialsProjectMaterial[];
  error?: string;
  code?: string;
};

const quickSearches = ['Si', 'MoS2', 'Fe2O3', 'Si-O', 'mp-149'];

function Metric({ label, value }: { label: string; value: string }) {
  return <span className="min-w-0"><span className="block text-[9px] uppercase tracking-[0.06em] text-[var(--panel-muted)]">{label}</span><span className="mt-0.5 block truncate font-mono text-[10px] text-[var(--panel-text)]">{value}</span></span>;
}

export function MaterialsProjectBrowser({
  open,
  databaseName,
  onClose,
  onImport,
}: {
  open: boolean;
  databaseName: string;
  onClose: () => void;
  onImport: (materials: MaterialsProjectMaterial[]) => void;
}) {
  const [query, setQuery] = useState('Si');
  const [materials, setMaterials] = useState<MaterialsProjectMaterial[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missingKey, setMissingKey] = useState(false);

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
    setLoading(true);
    setError(null);
    setMissingKey(false);
    setSelected(new Set());
    try {
      const response = await fetch(`/api/materials-project?q=${encodeURIComponent(value)}&limit=20`);
      const payload = await response.json() as SearchResponse;
      if (!response.ok) {
        setMaterials([]);
        setMissingKey(payload.code === 'MP_API_KEY_MISSING');
        setError(payload.error ?? 'Search failed.');
        return;
      }
      setMaterials(payload.materials ?? []);
    } catch (requestError) {
      setMaterials([]);
      setError(requestError instanceof Error ? requestError.message : 'Search failed.');
    } finally {
      setLoading(false);
    }
  };

  const toggle = (materialId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(materialId)) next.delete(materialId);
      else next.add(materialId);
      return next;
    });
  };

  const importSelected = () => {
    if (!selectedMaterials.length) return;
    onImport(selectedMaterials);
    setSelected(new Set());
    onClose();
  };

  return <AnimatePresence>{open && <motion.div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/55 p-3 backdrop-blur-[2px] sm:p-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <motion.section role="dialog" aria-modal="true" aria-label="Materials Project browser" initial={{ opacity: 0, y: 12, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.99 }} transition={{ duration: 0.16, ease: 'easeOut' }} className="workspace-dark-surface flex h-[min(680px,calc(100svh-24px))] w-full max-w-[860px] flex-col overflow-hidden rounded-[11px] border border-[var(--panel-border)] bg-[var(--panel-bg)] shadow-[0_28px_80px_rgba(0,0,0,.46)]">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--panel-border)] bg-[var(--panel-bg)] px-4"><span className="grid h-8 w-8 place-items-center rounded-[7px] border border-[var(--line)] bg-[var(--surface-subtle)] text-[var(--panel-text)]"><DatabaseSearch className="h-4 w-4" /></span><span className="min-w-0"><span className="block text-[12px] font-semibold text-[var(--panel-text)]">Materials Project</span><span className="block text-[10px] text-[var(--panel-muted)]">Import computed crystal structures into {databaseName}</span></span><a href="https://materialsproject.org" target="_blank" rel="noreferrer" className="ml-auto hidden h-7 items-center gap-1.5 rounded-[5px] px-2 text-[10px] text-[var(--panel-muted)] hover:bg-[var(--panel-hover)] sm:flex">materialsproject.org <ExternalLink className="h-3 w-3" /></a><button type="button" onClick={onClose} aria-label="Close Materials Project browser" className="grid h-8 w-8 place-items-center rounded-[6px] text-[var(--panel-muted)] hover:bg-[var(--panel-hover)] hover:text-[var(--panel-text)]"><X className="h-4 w-4" /></button></header>

      <div className="shrink-0 border-b border-[var(--panel-border)] bg-[var(--panel-raised)] p-3.5"><form onSubmit={(event) => void search(event)} className="flex gap-2"><label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-[6px] border border-[var(--panel-border)] bg-[var(--panel-bg)] px-3 focus-within:border-[var(--field-focus-border)]"><Search className="h-3.5 w-3.5 shrink-0 text-[var(--panel-muted)]" /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Formula, elements, chemical system, or MP-ID" className="min-w-0 flex-1 bg-transparent text-[11px] text-[var(--panel-text)] outline-none placeholder:text-[var(--panel-muted)]" /></label><button type="submit" disabled={loading || !query.trim()} className="flex h-9 items-center gap-1.5 rounded-[6px] bg-[var(--accent)] px-4 text-[11px] font-semibold text-[var(--on-accent)] hover:bg-[var(--accent-strong)] disabled:bg-[var(--panel-border)] disabled:text-[var(--panel-muted)]">{loading ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}Search</button></form><div className="mt-2 flex flex-wrap items-center gap-1.5"><span className="mr-1 text-[9px] uppercase tracking-[0.08em] text-[var(--panel-muted)]">Examples</span>{quickSearches.map((value) => <button key={value} type="button" onClick={() => void search(undefined, value)} className="h-6 rounded-[5px] border border-[var(--panel-border)] bg-[var(--panel-bg)] px-2 font-mono text-[10px] text-[var(--panel-muted)] hover:border-[var(--line-strong)] hover:bg-[var(--panel-hover)] hover:text-[var(--panel-text)]">{value}</button>)}</div></div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && <div className="grid h-full min-h-[240px] place-items-center"><span className="text-center"><LoaderCircle className="mx-auto h-5 w-5 animate-spin text-[var(--accent)]" /><span className="mt-3 block text-[11px] font-medium text-[var(--panel-text)]">Searching Materials Project</span><span className="mt-1 block text-[10px] text-[var(--panel-muted)]">Retrieving structures and summary properties</span></span></div>}
        {!loading && error && <div className="mx-auto flex max-w-[480px] flex-col items-center px-6 py-14 text-center"><span className={cn('grid h-10 w-10 place-items-center rounded-full', missingKey ? 'bg-[var(--panel-raised)] text-[var(--panel-muted)]' : 'bg-rose-500/10 text-rose-400')}><CircleAlert className="h-5 w-5" /></span><p className="mt-4 text-[12px] font-semibold text-[var(--panel-text)]">{missingKey ? 'Materials Project unavailable' : 'Search unavailable'}</p><p className="mt-1.5 text-[11px] leading-4 text-[var(--panel-muted)]">{missingKey ? 'MP_API_KEY is not configured.' : error}</p></div>}
        {!loading && !error && !materials.length && <div className="grid h-full min-h-[240px] place-items-center px-6 text-center"><span><Database className="mx-auto h-5 w-5 text-[var(--panel-muted)]" /><span className="mt-3 block text-[11px] font-medium text-[var(--panel-muted)]">Materials Project</span></span></div>}
        {!loading && !error && materials.length > 0 && <div><div className="sticky top-0 z-10 grid grid-cols-[28px_minmax(150px,1.4fr)_minmax(120px,1fr)_96px] border-b border-[var(--panel-border)] bg-[var(--panel-raised)]/95 px-3 py-2 text-[9px] uppercase tracking-[0.08em] text-[var(--panel-muted)] backdrop-blur sm:grid-cols-[28px_minmax(170px,1.5fr)_minmax(150px,1fr)_repeat(3,90px)]"><span /><span>Material</span><span>Structure</span><span>Band gap</span><span className="hidden sm:block">E above hull</span><span className="hidden sm:block">Density</span></div>{materials.map((material) => { const checked = selected.has(material.materialId); return <button key={material.materialId} type="button" onClick={() => toggle(material.materialId)} className={cn('grid w-full grid-cols-[28px_minmax(150px,1.4fr)_minmax(120px,1fr)_96px items-center border-b border-[var(--panel-border)] px-3 py-2.5 text-left hover:bg-[var(--panel-hover)] sm:grid-cols-[28px_minmax(170px,1.5fr)_minmax(150px,1fr)_repeat(3,90px)]', checked && 'bg-[var(--panel-selected)] hover:bg-[var(--panel-hover)]')}>
          <span className={cn('grid h-4 w-4 place-items-center rounded-[3px] border', checked ? 'border-[var(--line-strong)] bg-white text-black' : 'border-[var(--panel-border)] bg-[var(--panel-bg)]')}>{checked && <Check className="h-3 w-3" />}</span><span className="min-w-0"><span className="flex items-center gap-2"><span className="truncate text-[12px] font-semibold text-[var(--panel-text)]">{material.formula}</span>{material.isStable && <span className="rounded-[3px] border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-medium text-emerald-400">stable</span>}</span><span className="mt-0.5 block font-mono text-[10px] text-[var(--panel-muted)]">{material.materialId} · {material.numSites} sites</span></span><span className="min-w-0"><span className="block truncate text-[11px] text-[var(--panel-text)]">{material.spaceGroupSymbol} · {material.spaceGroupNumber}</span><span className="mt-0.5 block truncate text-[10px] capitalize text-[var(--panel-muted)]">{material.crystalSystem} · {material.theoretical ? 'theoretical' : 'reported'}</span></span><Metric label="Eg" value={`${material.bandGap.toFixed(3)} eV`} /><span className="hidden sm:block"><Metric label="Ehull" value={`${material.energyAboveHull.toFixed(4)} eV`} /></span><span className="hidden sm:block"><Metric label="ρ" value={`${material.density.toFixed(3)} g/cm³`} /></span></button>; })}</div>}
      </div>

      <footer className="flex h-14 shrink-0 items-center gap-3 border-t border-[var(--panel-border)] bg-[var(--panel-bg)] px-4"><span className="min-w-0 flex-1 text-[11px] font-medium text-[var(--panel-muted)]">{selected.size ? `${selected.size} material${selected.size > 1 ? 's' : ''} selected` : databaseName}</span><button type="button" onClick={onClose} className="h-8 rounded-[6px] px-3 text-[11px] font-medium text-[var(--panel-muted)] hover:bg-[var(--panel-hover)] hover:text-[var(--panel-text)]">Cancel</button><button type="button" disabled={!selected.size} onClick={importSelected} className="flex h-8 items-center gap-1.5 rounded-[6px] bg-[var(--accent)] px-4 text-[11px] font-semibold text-[var(--on-accent)] hover:bg-[var(--accent-strong)] disabled:bg-[var(--panel-border)] disabled:text-[var(--panel-muted)]"><Database className="h-3.5 w-3.5" />Import</button></footer>
    </motion.section>
  </motion.div>}</AnimatePresence>;
}

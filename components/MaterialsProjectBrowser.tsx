'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { CircleAlert, Database, DatabaseSearch, ExternalLink, LoaderCircle, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useSession } from '@/app/use-session';
import { useLocale } from '@/app/locale-provider';
import { useSiteTheme } from '@/app/use-site-theme';
import type { CrystalDatabaseMaterial, CrystalDatabaseResult } from '@/lib/crystal-database';
import { crystalSearchParameters, crystalSourceIds, crystalSources, type CrystalSource, type CrystalFilters, type CrystalSort, type CrystalPage } from '@/lib/crystal-database-options';
import { prepareCrystalCell, type CrystalCellOptions, type StandardizedCrystal } from '@/lib/crystal-database-cell';
import { UiSelect } from './UiSelect';
import { cn } from '@/lib/utils';

const CrystalEditorViewport = dynamic(() => import('./CrystalEditorViewport').then(module => module.CrystalEditorViewport), { ssr: false });
export type MaterialsProjectMaterial = CrystalDatabaseMaterial;
const sortLabels: Record<CrystalSort, string> = { default: 'Source order', sites: 'Fewest sites', '-sites': 'Most sites', 'band-gap': 'Lowest band gap', '-band-gap': 'Highest band gap', 'energy-above-hull': 'Lowest energy above hull' };
const filterLabels: Record<keyof CrystalFilters, string> = { spaceGroup: 'Space group (1–230)', minSites: 'Minimum sites', maxSites: 'Maximum sites', minBandGap: 'Minimum gap (eV)', maxBandGap: 'Maximum gap (eV)', maxEnergyAboveHull: 'Maximum E above hull (eV/atom)' };
const emptySelection = () => new Set<string>();
function Metric({ label, value }: { label: string; value: string }) {
  return <span className="min-w-0"><span className="block text-[10px] text-[var(--muted-ink)]">{label}</span><span className="mt-0.5 block break-words font-mono text-[11px] text-[var(--ink)]">{value}</span></span>;
}
function spaceGroupLabel(material: MaterialsProjectMaterial) {
  return [material.spaceGroupSymbol === 'unknown' ? '' : material.spaceGroupSymbol, material.spaceGroupNumber === undefined ? '' : `No. ${material.spaceGroupNumber}`].filter(Boolean).join(' · ') || 'Unavailable';
}
async function standardize(payload: Record<string, unknown>, signal?: AbortSignal): Promise<StandardizedCrystal> {
  const response = await fetch('/api/local/crystals/standardize', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const result = await response.json() as StandardizedCrystal & { error?: string };
  if (!response.ok) throw new Error(result.error || 'The cell could not be converted. Your source structure was preserved.');
  return result;
}

export function MaterialsProjectBrowser({ open, databaseName, onClose, onImport, target = 'project' }: {
  open: boolean; databaseName: string; onClose: () => void; onImport: (materials: MaterialsProjectMaterial[]) => void | Promise<void>; target?: 'project' | 'structure';
}) {
  const { session } = useSession(), { t } = useLocale(), reducedMotion = useReducedMotion();
  const { theme } = useSiteTheme();
  const [query, setQuery] = useState('Si'), [provider, setProvider] = useState<CrystalSource>('cod');
  const [materials, setMaterials] = useState<MaterialsProjectMaterial[]>([]), [selected, setSelected] = useState<Set<string>>(emptySelection);
  const [page, setPage] = useState<CrystalPage | null>(null), [loading, setLoading] = useState(false), [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null), [importError, setImportError] = useState<string | null>(null), [missingKey, setMissingKey] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]), [filters, setFilters] = useState<CrystalFilters>({}), [sort, setSort] = useState<CrystalSort>('default');
  const [previewId, setPreviewId] = useState<string | null>(null), [preview, setPreview] = useState<{ key: string; material: MaterialsProjectMaterial } | null>(null);
  const [cell, setCell] = useState<CrystalCellOptions['cell']>('source'), [repeat, setRepeat] = useState<[number, number, number]>([1, 1, 1]), [symprec, setSymprec] = useState(0.01);
  const [cellLoading, setCellLoading] = useState(false), [cellError, setCellError] = useState<string | null>(null);
  const [mobilePanel, setMobilePanel] = useState<'results' | 'preview'>('results');
  const request = useRef<AbortController | null>(null), dialog = useRef<HTMLElement | null>(null), content = useRef<HTMLDivElement | null>(null);
  const filterDetails = useRef<HTMLDetailsElement | null>(null);
  const active = materials.find(material => material.materialId === previewId) ?? null;
  const options = useMemo(() => ({ cell, repeat, symprec }), [cell, repeat, symprec]);
  const previewKey = JSON.stringify([active?.materialId, active?.provenance.sourceSha256, active?.provenance.structureSha256, options]);
  const prepared = preview?.key === previewKey ? preview.material : null;
  const visiblePreview = preview?.material.materialId === active?.materialId && preview?.material.provenance.sourceSha256 === active?.provenance.sourceSha256 ? preview?.material : null;
  const source = crystalSources[provider];
  const selectedMaterials = materials.filter(material => selected.has(material.materialId));
  const activeFilterCount = Object.values(filters).filter(value => value !== undefined).length + (sort === 'default' ? 0 : 1);
  const showPanel = (panel: 'results' | 'preview') => {
    setMobilePanel(panel); content.current?.scrollTo({ top: 0 });
    if (panel === 'preview' && window.matchMedia('(max-width: 1023px)').matches && filterDetails.current) filterDetails.current.open = false;
  };

  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => { if (!open) { request.current?.abort(); queueMicrotask(() => setLoading(false)); } }, [open]);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => previous?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !importing) onClose();
      if (event.key !== 'Tab' || event.defaultPrevented || !dialog.current) return;
      const controls = [...dialog.current.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),a[href],[tabindex="0"]')].filter(node => node.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first && last) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last && first) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose, importing]);
  useEffect(() => {
    if (!open || !active) return;
    const controller = new AbortController();
    void Promise.resolve().then(async () => {
      if (controller.signal.aborted) return;
      setCellLoading(true); setCellError(null);
      try {
        const material = await prepareCrystalCell(active, options, session?.mode === 'local' ? payload => standardize(payload, controller.signal) : undefined);
        if (!controller.signal.aborted) setPreview({ key: previewKey, material });
      } catch (failure) { if (!controller.signal.aborted) setCellError(failure instanceof Error ? failure.message : 'The cell could not be prepared.'); }
      finally { if (!controller.signal.aborted) setCellLoading(false); }
    });
    return () => controller.abort();
  }, [open, active, options, previewKey, session?.mode]);

  const search = async (event?: FormEvent, nextQuery?: string, offset = 0) => {
    event?.preventDefault();
    const value = (nextQuery ?? query).trim(); if (!value) return;
    setQuery(value); request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setLoading(true); setWarnings([]); setError(null); setImportError(null); setMissingKey(false); setSelected(emptySelection()); setPreviewId(null); setMobilePanel('results');
    const parameters = crystalSearchParameters({ offset, filters, sort }); parameters.set('q', value); parameters.set('source', provider); parameters.set('limit', provider === 'jarvis' ? '20' : '12');
    try {
      const response = await fetch(`/api/materials-project?${parameters}`, { signal: controller.signal });
      const payload = await response.json() as CrystalDatabaseResult & { error?: string; code?: string };
      if (controller.signal.aborted) return;
      setWarnings(payload.warnings ?? []);
      if (!response.ok) { setMaterials([]); setPage(null); setMissingKey(payload.code === 'MP_API_KEY_MISSING'); setError(payload.error ?? 'Search failed.'); return; }
      setMaterials(payload.materials ?? []); setPage(payload.pagination ?? null); setPreviewId(payload.materials?.[0]?.materialId ?? null);
    } catch (failure) { if (!controller.signal.aborted) { setMaterials([]); setPage(null); setError(failure instanceof Error ? failure.message : 'Search failed.'); } }
    finally { if (!controller.signal.aborted) setLoading(false); }
  };
  const changeSource = (value: string) => {
    request.current?.abort(); setLoading(false); setProvider(value as CrystalSource); setMaterials([]); setSelected(emptySelection()); setPreviewId(null); setPage(null); setFilters({}); setSort('default'); setWarnings([]); setError(null); setMissingKey(false); setImportError(null);
  };
  const toggle = (materialId: string) => setSelected(current => {
    const next = new Set(current); if (next.has(materialId)) next.delete(materialId); else { if (target === 'structure') next.clear(); next.add(materialId); } return next;
  });
  const importSelected = async () => {
    if (!selectedMaterials.length || importing) return;
    setImporting(true); setImportError(null);
    try {
      const incoming: MaterialsProjectMaterial[] = [];
      for (const material of selectedMaterials) incoming.push(material === active && prepared ? prepared : await prepareCrystalCell(material, options, session?.mode === 'local' ? payload => standardize(payload) : undefined));
      await onImport(incoming); setSelected(emptySelection()); onClose();
    } catch (failure) { setImportError(failure instanceof Error ? failure.message : 'Import could not be saved. Your existing structures were preserved.'); }
    finally { setImporting(false); }
  };
  const examples = provider === 'cod' ? ['Si', 'MoS2', 'Si-O', 'cod-1526655'] : provider === 'aflow' ? ['Si', 'Si-O', 'Fe-O'] : provider === 'materials-project' ? ['Si', 'MoS2', 'Si-O', 'mp-149'] : ['Si', 'MoS2', 'Si-O'];
  const transition = { duration: reducedMotion ? 0 : 0.16 };
  return typeof document === 'undefined' ? null : createPortal(<AnimatePresence>{open && <motion.div style={{ '--panel-bg': 'var(--surface)', '--panel-text': 'var(--ink)', '--panel-muted': 'var(--muted-ink)' } as CSSProperties} className="fixed inset-0 z-[110] flex items-center justify-center bg-black/55 p-2 sm:p-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={transition} onMouseDown={event => { if (event.target === event.currentTarget && !importing) onClose(); }}>
    <motion.section ref={dialog} role="dialog" aria-modal="true" aria-label="Crystal database browser" initial={{ opacity: 0, y: reducedMotion ? 0 : 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={transition} className="workspace-dark-surface flex h-[min(820px,calc(100svh-16px))] w-full max-w-[1100px] flex-col overflow-hidden rounded-[11px] border border-[var(--line)] bg-[var(--surface)] text-[var(--ink)] shadow-2xl">
      <header className="flex shrink-0 items-center gap-3 border-b border-[var(--line)] px-4 py-3"><DatabaseSearch className="h-5 w-5 shrink-0 text-[var(--muted-ink)]" /><span className="min-w-0 flex-1"><h2 className="text-sm font-semibold">{t('Crystal database', 'Database kristal')}</h2><p className="truncate text-[11px] text-[var(--muted-ink)]">{target === 'structure' ? t('Choose a structure for', 'Pilih struktur untuk') : t('Import structures into', 'Impor struktur ke')} {databaseName}</p></span><button type="button" disabled={importing} onClick={onClose} aria-label="Close crystal database browser" className="grid h-8 w-8 place-items-center rounded-md hover:bg-[var(--surface-subtle)]"><X className="h-4 w-4" /></button></header>
      <div className="shrink-0 border-b border-[var(--line)] bg-[var(--raised)] p-3">
        <form onSubmit={event => void search(event)} className="flex flex-wrap items-end gap-2"><div className="w-full sm:w-52"><UiSelect compact label={t('Source', 'Sumber')} ariaLabel="Crystal database source" value={provider} options={crystalSourceIds.map(value => ({ value, label: crystalSources[value].label, detail: value === 'materials-project' ? 'API key in Settings → Compute' : 'Public database · no account' }))} onChange={changeSource} /></div><label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-[var(--line)] bg-[var(--surface)] px-3"><Search className="h-4 w-4 shrink-0 text-[var(--muted-ink)]" /><input autoFocus aria-label="Crystal search query" value={query} onChange={event => { setQuery(event.target.value); setPage(null); }} placeholder={provider === 'aflow' ? 'Elements or AFLOW source ID' : 'Formula, elements or source ID'} className="min-w-0 flex-1 bg-transparent text-xs outline-none" /></label><button type="submit" disabled={loading || !query.trim()} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-[var(--accent)] px-3 text-xs font-medium text-[var(--on-accent)] hover:bg-[var(--accent-strong)] disabled:bg-[var(--line)] disabled:text-[var(--muted-ink)]">{loading ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}{t('Search', 'Cari')}</button></form>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">{examples.map(value => <button key={value} type="button" onClick={() => void search(undefined, value)} className="rounded border border-[var(--line)] bg-[var(--surface)] px-2 py-1 font-mono text-[10px] text-[var(--muted-ink)] hover:text-[var(--ink)]">{value}</button>)}<a href={source.homepage} target="_blank" rel="noreferrer" className="ml-auto flex items-center gap-1 text-[10px] text-[var(--muted-ink)]">{source.label}<ExternalLink className="h-3 w-3" /></a></div>
        {(source.filters.length > 0 || source.sorts.length > 1) && <details ref={filterDetails} className="mt-2 text-xs"><summary className="w-fit cursor-pointer text-[var(--muted-ink)]">{t('Filters and sorting', 'Filter dan urutan')}{activeFilterCount > 0 && <span> · {activeFilterCount} {t('active', 'aktif')}</span>}</summary><div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">{source.filters.map(key => <label key={key} className="text-[10px] text-[var(--muted-ink)]">{filterLabels[key]}<input aria-label={filterLabels[key]} type="number" min={key === 'spaceGroup' || key.endsWith('Sites') ? 1 : undefined} max={key === 'spaceGroup' ? 230 : undefined} step={key === 'spaceGroup' || key.endsWith('Sites') ? 1 : 'any'} value={filters[key] ?? ''} onChange={event => { setFilters(current => ({ ...current, [key]: event.target.value === '' ? undefined : Number(event.target.value) })); setPage(null); }} className="mt-1 h-8 w-full rounded border border-[var(--line)] bg-[var(--surface)] px-2 text-xs text-[var(--ink)]" /></label>)}{source.sorts.length > 1 && <UiSelect compact label={t('Order', 'Urutan')} ariaLabel="Crystal result sort" value={sort} options={source.sorts.map(value => ({ value, label: sortLabels[value] }))} onChange={value => { setSort(value as CrystalSort); setPage(null); }} />}</div></details>}
      </div>
      <nav aria-label="Crystal browser panels" className="flex shrink-0 gap-1 border-b border-[var(--line)] p-2 text-xs lg:hidden">{(["results", "preview"] as const).map(panel => <button key={panel} type="button" aria-pressed={mobilePanel === panel} onClick={() => showPanel(panel)} className={cn("flex-1 rounded px-3 py-2", mobilePanel === panel ? "bg-[var(--surface-subtle)] text-[var(--ink)]" : "text-[var(--muted-ink)]")}>{panel === "results" ? t("Search results", "Hasil pencarian") : t("Structure preview", "Preview struktur")}</button>)}</nav>
      <div ref={content} className="min-h-0 flex-1 overflow-auto lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:overflow-hidden">
        <div className={cn("min-w-0 lg:overflow-y-auto", mobilePanel === "preview" && "hidden lg:block")}>
          {target === 'structure' && <p className="border-b border-[var(--line)] px-4 py-2 text-[11px] text-[var(--muted-ink)]">{t('Replaces this Crystal module. Undo restores its previous structure.', 'Mengganti struktur modul Crystal ini. Undo mengembalikan struktur sebelumnya.')}</p>}
          {(error || importError) && <div role="alert" className="m-3 rounded-md border border-rose-500/30 p-3 text-xs"><CircleAlert className="mb-2 h-4 w-4 text-rose-400" /><p>{importError ?? error}</p>{missingKey && session?.mode === 'local' && <Link href="/account/compute#materials-project" className="mt-2 inline-block underline">{t('Open Materials Project settings', 'Buka pengaturan Materials Project')}</Link>}</div>}
          {warnings.length > 0 && <details role="status" className="m-3 rounded-md border border-[var(--line)] p-2 text-[11px] text-[var(--muted-ink)]"><summary className="cursor-pointer">{t('Source notes', 'Catatan sumber')} · {warnings.length}</summary>{warnings.map(warning => <p key={warning} className="mt-1.5 leading-relaxed">{warning}</p>)}</details>}
          {loading ? <div className="grid min-h-52 place-items-center gap-2 p-6 text-center text-xs text-[var(--muted-ink)]"><span><LoaderCircle className="mx-auto mb-3 h-5 w-5 animate-spin" />{t('Retrieving structures and source metadata…', 'Mengambil struktur dan metadata sumber…')}</span></div> : materials.length ? <><div className="flex items-center justify-between gap-2 border-b border-[var(--line)] px-3 py-2 text-[10px] text-[var(--muted-ink)]"><span>{materials.length} {t('records', 'record')}{page?.total === null || page?.total === undefined ? '' : ` · ${page.total} ${t('source matches', 'kecocokan sumber')}`}</span><span>{t('Select to import · click a record to preview', 'Centang untuk impor · klik record untuk preview')}</span></div>{materials.map(material => <div key={material.materialId} className={cn('flex items-center gap-2 border-b border-[var(--line)] px-3', material.materialId === previewId && 'bg-[var(--surface-subtle)]')}><input type="checkbox" aria-label={`Select ${material.materialId}`} checked={selected.has(material.materialId)} onChange={() => toggle(material.materialId)} className="h-4 w-4 shrink-0 accent-[var(--accent)]" /><button type="button" aria-label={`Preview ${material.materialId}`} aria-pressed={previewId === material.materialId} onClick={() => { setPreviewId(material.materialId); showPanel("preview"); }} className="min-w-0 flex-1 py-3 text-left"><span className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm font-semibold">{material.formula}</strong><span className="font-mono text-[11px] text-[var(--muted-ink)]">{material.numSites} {t('sites', 'situs')}</span></span><span className="mt-1 block break-all font-mono text-[10px] text-[var(--muted-ink)]">{material.materialId}</span><span className="mt-1 block text-[11px] text-[var(--muted-ink)]">{spaceGroupLabel(material)}{material.bandGap === undefined ? '' : ` · ${material.bandGap.toFixed(3)} eV`}{material.isStable ? ' · stable' : ''}</span></button></div>)}</> : !error && <div className="grid min-h-52 place-items-center px-6 text-center text-xs text-[var(--muted-ink)]"><span><Database className="mx-auto mb-3 h-5 w-5" />{t('Search a formula, elements or source ID. Unvalidated records are never substituted.', 'Cari rumus, unsur, atau ID sumber. Record tidak valid tidak pernah diganti diam-diam.')}</span></div>}
          {page && !loading && <nav aria-label="Crystal result pages" className="flex items-center justify-between gap-2 p-3 text-xs"><button type="button" disabled={page.offset === 0} onClick={() => void search(undefined, undefined, Math.max(0, page.offset - page.limit))} className="rounded-md border border-[var(--line)] px-3 py-1.5 hover:bg-[var(--surface-subtle)] disabled:opacity-40">{t('Previous', 'Sebelumnya')}</button><span className="font-mono text-[10px] text-[var(--muted-ink)]">{t('Page', 'Halaman')} {Math.floor(page.offset / page.limit) + 1}</span><button type="button" disabled={!page.hasMore || page.nextOffset === null} onClick={() => void search(undefined, undefined, page.nextOffset ?? 0)} className="rounded-md border border-[var(--line)] px-3 py-1.5 hover:bg-[var(--surface-subtle)] disabled:opacity-40">{t('Next', 'Berikutnya')}</button></nav>}
        </div>
        <aside aria-label="Structure preview and cell options" className={cn("min-w-0 border-t border-[var(--line)] bg-[var(--raised)] p-3 lg:overflow-y-auto lg:border-l lg:border-t-0", mobilePanel === "results" && "hidden lg:block")}>
          <h3 className="mb-2 text-xs font-semibold">{t('Structure preview', 'Preview struktur')}</h3>
          <div className="relative h-56 overflow-hidden rounded-md border border-[var(--line)] bg-[var(--surface)]" data-testid="crystal-database-preview">{visiblePreview ? <CrystalEditorViewport key={visiblePreview.materialId} atoms={visiblePreview.atoms} lattice={visiblePreview.lattice} supercell={[1, 1, 1]} selectedAtomId={null} onSelectAtom={() => undefined} focusRequest={0} fitKey={visiblePreview.materialId} theme={theme === "light" ? "light" : "dark"} showBonds={false} showLabels={false} showNavigationGizmo /> : <div className="grid h-full place-items-center p-4 text-center text-xs text-[var(--muted-ink)]">{t('Choose a record to inspect its geometry.', 'Pilih record untuk memeriksa geometrinya.')}</div>}{cellLoading && <span className="pointer-events-none absolute right-2 top-2 rounded bg-[var(--surface)] p-1.5" aria-label="Updating cell preview"><LoaderCircle className="h-4 w-4 animate-spin" /></span>}{cellError && visiblePreview && !prepared && <span className="absolute bottom-2 left-2 rounded bg-[var(--surface)] px-2 py-1 text-[10px]">{t('Previous cell preview', 'Preview sel sebelumnya')}</span>}</div>
          <div className="mt-4 border-t border-[var(--line)] pt-3"><UiSelect compact label={t('Import cell', 'Sel impor')} ariaLabel="Import cell" value={cell} options={[{ value: 'source', label: 'Cell from source' }, { value: 'primitive', label: 'Primitive cell', detail: 'Local DFT runtime · geometric symmetry', disabled: session?.mode !== 'local' }, { value: 'conventional', label: 'Conventional cell', detail: 'Local DFT runtime · geometric symmetry', disabled: session?.mode !== 'local' }]} onChange={value => setCell(value as CrystalCellOptions['cell'])} />{cell !== 'source' && <label className="mt-2 block text-[10px] text-[var(--muted-ink)]">{t('Symmetry tolerance (Å)', 'Toleransi simetri (Å)')}<input aria-label="Symmetry tolerance (Å)" type="number" min="0.000001" max="0.1" step="0.001" value={symprec} onChange={event => setSymprec(Number(event.target.value))} className="mt-1 h-8 w-full rounded border border-[var(--line)] bg-[var(--surface)] px-2 text-xs text-[var(--ink)]" /></label>}<p className="mb-1 mt-3 text-[10px] text-[var(--muted-ink)]">{t('Supercell repeats · actual imported sites', 'Pengulangan supercell · situs yang diimpor')}</p><div className="grid grid-cols-3 gap-2">{repeat.map((value, axis) => <label key={axis} className="text-[10px] text-[var(--muted-ink)]">{['a', 'b', 'c'][axis]}<input aria-label={`Supercell repeat ${['a', 'b', 'c'][axis]}`} type="number" min="1" max="16" step="1" value={value} onChange={event => setRepeat(current => current.map((item, index) => index === axis ? Number(event.target.value) : item) as [number, number, number])} className="mt-1 h-8 w-full rounded border border-[var(--line)] bg-[var(--surface)] px-2 text-xs text-[var(--ink)]" /></label>)}</div></div>
          {cellError && <p role="alert" className="mt-3 text-[11px] leading-relaxed text-rose-400">{cellError}</p>}
          {active && <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2"><Metric label="Formula" value={active.formula} /><Metric label="Periodic axes" value={(active.lattice.periodic ?? [true, true, true]).map((value, axis) => value ? ["a", "b", "c"][axis] : "").filter(Boolean).join(", ") || "None"} /><Metric label="Sites in chosen cell" value={prepared ? String(prepared.numSites) : '—'} /><Metric label="Space group · source" value={spaceGroupLabel(active)} /><Metric label="Density · source" value={active.density === undefined ? 'Unavailable' : `${active.density.toFixed(3)} g/cm³`} /><Metric label="Band gap · source" value={active.bandGap === undefined ? 'Unavailable' : `${active.bandGap.toFixed(3)} eV`} /><Metric label="E above hull · source" value={active.energyAboveHull === undefined ? 'Unavailable' : `${active.energyAboveHull.toFixed(4)} eV/atom`} />{prepared && <><Metric label="a / b / c (Å)" value={[prepared.lattice.a, prepared.lattice.b, prepared.lattice.c].map(value => value.toFixed(4)).join(' / ')} /><Metric label="α / β / γ (°)" value={[prepared.lattice.alpha, prepared.lattice.beta, prepared.lattice.gamma].map(value => value.toFixed(2)).join(' / ')} /></>}</div>}
          {active && <details className="mt-4 border-t border-[var(--line)] pt-3 text-[10px] text-[var(--muted-ink)]"><summary className="cursor-pointer">{t('Source and provenance', 'Sumber dan provenance')}</summary><a href={active.sourceUrl} target="_blank" rel="noreferrer" className="mt-2 block break-all underline">{active.source} · {active.materialId}</a><p className="mt-2">{t('Retrieved', 'Diambil')}: {active.provenance.retrievedAt}</p><p className="mt-2 break-all font-mono">SHA-256: {active.provenance.sourceSha256}</p>{prepared?.geometryTransforms?.map((transform, index) => <p key={index} className="mt-2">{String(transform.operation)}{transform.method ? ` · ${String(transform.method)} ${String(transform.version)}` : ''}</p>)}{active.warnings.map(warning => <p key={warning} className="mt-2 leading-relaxed">{warning}</p>)}</details>}
        </aside>
      </div>
      <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-[var(--line)] px-4 py-3"><p className="min-w-0 flex-1 text-[10px] text-[var(--muted-ink)]">{selected.size ? `${selected.size} ${t('selected', 'dipilih')} · ` : ''}{t('Source files, SHA-256 and cell transformations are retained.', 'File sumber, SHA-256, dan transformasi sel disimpan.')}</p><button type="button" disabled={importing} onClick={onClose} className="inline-flex items-center justify-center rounded-md border border-[var(--line)] px-3 py-1.5 text-xs hover:bg-[var(--surface-subtle)] disabled:opacity-40">{t('Cancel', 'Batal')}</button><button type="button" disabled={!selected.size || importing || loading || cellLoading || Boolean(cellError && active && selected.has(active.materialId))} onClick={() => void importSelected()} className="inline-flex items-center justify-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--on-accent)] hover:bg-[var(--accent-strong)] disabled:bg-[var(--line)] disabled:text-[var(--muted-ink)]">{importing && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}{importing ? t('Saving…', 'Menyimpan…') : target === 'structure' ? t('Use structure', 'Gunakan struktur') : t('Import', 'Impor')}</button></footer>
    </motion.section>
  </motion.div>}</AnimatePresence>, document.body);
}

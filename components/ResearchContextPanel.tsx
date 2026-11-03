'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, CheckCircle2, Cloud, ExternalLink, RefreshCw, ShieldCheck, X, XCircle } from 'lucide-react';
import { phyniteApi } from '@/lib/phynite-api';
import { useLocale } from '@/app/locale-provider';

type ResearchRun = {
  id?: string;
  kind?: string;
  name?: string;
  status?: string;
  statusMessage?: string;
  failureReason?: string;
  failureCategory?: string;
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string;
  inputSha256?: string;
  provenance?: unknown;
  effectiveResources?: { vcpus?: number; memoryMiB?: number; diskBytes?: number };
  resultSummary?: Record<string, unknown>;
};
type ResearchEvent = { id: string; eventType?: string; title?: string; summary?: string; createdAt?: string; runId?: string; inputSha256?: string; metadata?: Record<string, unknown>; artifactRefs?: unknown[] };
type ResearchContext = { project?: { name?: string; updatedAt?: string }; events: ResearchEvent[]; runs: ResearchRun[]; failures: ResearchRun[]; generatedAt?: string };
type SyncState = { enabled?: boolean; state?: string; revision?: number };

function formatTime(value?: string, locale = 'en-US') {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function statusIcon(status?: string) {
  if (status === 'COMPLETED' || status === 'completed') return <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5 text-emerald-400" />;
  if (status === 'FAILED' || status === 'failed' || status === 'CANCELLED' || status === 'cancelled') return <XCircle aria-hidden="true" className="h-3.5 w-3.5 text-rose-400" />;
  return <Activity aria-hidden="true" className="h-3.5 w-3.5 text-amber-300" />;
}

function shortDigest(value?: string) {
  return value && value.length > 16 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
}

export function ResearchContextPanel({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const { t, intlLocale } = useLocale();
  const [context, setContext] = useState<ResearchContext | null>(null);
  const [sync, setSync] = useState<SyncState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dashboard, setDashboard] = useState<'summary' | 'compare' | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const result = await phyniteApi<{ context: ResearchContext }>(`/v1/projects/${encodeURIComponent(projectId)}/research-context`);
      setContext(result.context);
      try {
        const response = await fetch(`/api/local/sync/${encodeURIComponent(projectId)}`, { credentials: 'same-origin', cache: 'no-store' });
        if (response.ok) setSync(await response.json() as SyncState);
        else setSync(null);
      } catch { setSync(null); }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('Research context is unavailable.', 'Konteks riset belum tersedia.'));
    } finally { setLoading(false); }
  }, [projectId, t]);

  useEffect(() => { void load(); }, [load]);
  const runs = useMemo(() => (context?.runs ?? []).slice().sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''))), [context]);
  const latest = runs[0];
  const completed = runs.filter(run => run.status === 'COMPLETED' || run.status === 'completed').slice(0, 2);
  const summary = latest ? `${latest.name ?? latest.kind ?? t('Latest run', 'Run terbaru')} · ${latest.status ?? '—'}${latest.failureCategory ? ` · ${latest.failureCategory}` : ''}${latest.resultSummary ? ` · ${Object.entries(latest.resultSummary).slice(0, 3).map(([key, value]) => `${key}: ${String(value)}`).join(', ')}` : ''}` : t('No run data has been recorded yet.', 'Belum ada data run yang tercatat.');

  return <aside className="research-context-panel" aria-label={t('Research context', 'Konteks riset')}>
    <header className="research-context-panel__header"><div><strong>{t('Research context', 'Konteks riset')}</strong><small>{context?.project?.name ?? t('Project timeline', 'Timeline project')}</small></div><div className="research-context-panel__actions"><button type="button" onClick={() => void load()} disabled={loading} aria-label={t('Refresh research context', 'Muat ulang konteks riset')} title={t('Refresh', 'Muat ulang')}><RefreshCw className={loading ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} /></button><button type="button" onClick={onClose} aria-label={t('Close research context', 'Tutup konteks riset')}><X className="h-4 w-4" /></button></div></header>
    <div className="research-context-panel__body">
      <section className="research-context-privacy"><ShieldCheck className="h-4 w-4" /><div><strong>{sync?.enabled ? t('Team visibility enabled', 'Visibilitas tim aktif') : t('Local context only', 'Konteks lokal saja')}</strong><p>{sync?.enabled ? t(`Cloud Sync revision ${sync.revision ?? 0}. Only the project scope already approved for sync is visible.`, `Revisi Cloud Sync ${sync.revision ?? 0}. Hanya cakupan project yang sudah disetujui untuk sync yang terlihat.`) : t('This timeline stays on this computer. Enable Cloud Sync per project in Settings when you want approved revisions visible on another device.', 'Timeline ini tetap di komputer ini. Aktifkan Cloud Sync per project di Settings jika ingin revisi yang disetujui terlihat di perangkat lain.')}</p></div></section>
      <div className="research-context-actions"><button type="button" className="research-context-action" onClick={() => setDashboard('summary')} disabled={!latest}><Activity className="h-3.5 w-3.5" />{t('Summarize latest run', 'Ringkas run terbaru')}</button><button type="button" className="research-context-action" onClick={() => setDashboard('compare')} disabled={completed.length < 2}><Activity className="h-3.5 w-3.5" />{t('Compare recent runs', 'Bandingkan run terbaru')}</button></div>
      {dashboard === 'summary' && latest && <section className="research-context-dashboard"><header><strong>{t('Latest run summary', 'Ringkasan run terbaru')}</strong><button type="button" onClick={() => setDashboard(null)} aria-label={t('Close summary', 'Tutup ringkasan')}><X className="h-3 w-3" /></button></header><p>{summary}</p><dl><div><dt>{t('Input checksum', 'Checksum input')}</dt><dd>{shortDigest(latest.inputSha256) ?? '—'}</dd></div><div><dt>{t('Resources', 'Resource')}</dt><dd>{latest.effectiveResources ? `${latest.effectiveResources.vcpus ?? '—'} CPU · ${latest.effectiveResources.memoryMiB ?? '—'} MiB` : '—'}</dd></div><div><dt>{t('Provenance', 'Provenance')}</dt><dd>{latest.provenance ? t('Recorded', 'Tercatat') : t('Not recorded', 'Belum tercatat')}</dd></div></dl></section>}
      {dashboard === 'compare' && completed.length >= 2 && <section className="research-context-dashboard"><header><strong>{t('Recent run comparison', 'Perbandingan run terbaru')}</strong><button type="button" onClick={() => setDashboard(null)} aria-label={t('Close comparison', 'Tutup perbandingan')}><X className="h-3 w-3" /></button></header><div className="research-context-compare"><span></span><strong>{completed[0].name ?? completed[0].kind ?? 'Run A'}</strong><strong>{completed[1].name ?? completed[1].kind ?? 'Run B'}</strong>{[['Status', completed[0].status, completed[1].status], ['Input', shortDigest(completed[0].inputSha256), shortDigest(completed[1].inputSha256)], ['Completed', formatTime(completed[0].completedAt, intlLocale), formatTime(completed[1].completedAt, intlLocale)]].map(([label, left, right]) => <><span key={`${label}-label`}>{label}</span><span key={`${label}-left`}>{String(left ?? '—')}</span><span key={`${label}-right`}>{String(right ?? '—')}</span></>)}</div></section>}
      {error && <p className="research-context-error" role="alert">{error}</p>}
      {loading && !context && <p className="research-context-muted">{t('Loading project evidence…', 'Memuat bukti project…')}</p>}
      {!loading && context && <>
        <section><h3>{t('Run ledger', 'Ledger run')}</h3>{runs.slice(0, 8).map((run, index) => <article className="research-context-run" key={`${run.id ?? run.createdAt}-${index}`}>{statusIcon(run.status)}<div><strong>{run.name ?? run.kind ?? t('Run', 'Run')}</strong><small>{formatTime(run.createdAt, intlLocale)} · {run.status ?? '—'}{run.failureCategory ? ` · ${run.failureCategory}` : ''}</small>{run.failureReason && <p>{run.failureReason}</p>}{run.inputSha256 && <code title={run.inputSha256}>sha256 {shortDigest(run.inputSha256)}</code>}</div></article>)}{!runs.length && <p className="research-context-muted">{t('No runs yet.', 'Belum ada run.')}</p>}</section>
        <section><h3>{t('Timeline', 'Timeline')}</h3>{(context.events ?? []).slice(0, 8).map((event, index) => <article className="research-context-event" key={`${event.id}-${index}`}><span>{formatTime(event.createdAt, intlLocale)}</span><div><strong>{event.title ?? event.eventType ?? t('Research event', 'Event riset')}</strong>{event.summary && <p>{event.summary}</p>}{event.inputSha256 && <code>sha256 {shortDigest(event.inputSha256)}</code>}</div></article>)}{!context.events?.length && <p className="research-context-muted">{t('Timeline entries appear after project and run activity.', 'Entri timeline muncul setelah ada aktivitas project dan run.')}</p>}</section>
        <footer className="research-context-footer"><span>{t('Read-only evidence · generated', 'Bukti read-only · dibuat')} {formatTime(context.generatedAt, intlLocale)}</span>{!sync?.enabled && <a href="/local#cloud">{t('Open Cloud Sync settings', 'Buka pengaturan Cloud Sync')} <ExternalLink className="h-3 w-3" /></a>}{sync?.enabled && <span><Cloud className="inline h-3 w-3" /> {t('Approved sync scope only', 'Hanya cakupan sync yang disetujui')}</span>}</footer>
      </>}
    </div>
  </aside>;
}

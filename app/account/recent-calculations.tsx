'use client';
import { WorkspaceLoading } from '@/components/WorkspaceLoading';

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { accountRequest, type AccountUsage } from '@/lib/account-api';
import { displayDuration, displayQuanta, measuredComputeSeconds, recordedRunSeconds } from '@/lib/usage-display';
import { computeCapacityLabel } from '@/lib/compute-selection';
import { useLocale } from '../locale-provider';

export type CalculationPage = { runs: AccountUsage['recentRuns']; total: number; nextCursor: string | null };

export function RecentCalculations({ measuredAt }: { measuredAt: string }) {
  const { t, intlLocale } = useLocale();
  const [cursors, setCursors] = useState(['']);
  const [page, setPage] = useState<CalculationPage | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const cursor = cursors[cursors.length - 1];
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) { setLoading(true); setError(false); } });
    void accountRequest<CalculationPage>(`/calculations?limit=6&cursor=${encodeURIComponent(cursor)}`).then(result => { if (!cancelled) setPage(result); }).catch(() => { if (!cancelled) setError(true); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [cursor, measuredAt, retry]);
  return <div aria-busy={loading}>{error ? <div className="lab-notice" role="alert">{t('Calculation records could not be loaded.', 'Catatan kalkulasi belum dapat dimuat.')}<button className="lab-button" onClick={() => setRetry(value => value + 1)}>{t('Retry', 'Coba lagi')}</button></div> : loading ? <WorkspaceLoading layout="list" label={t('Loading calculations…', 'Memuat kalkulasi…')} /> : page?.runs.length ? <>
    <div className="lab-table-scroll settings-runs-scroll" tabIndex={0} role="region" aria-label={t('Job usage records', 'Catatan pemakaian job')}><table className="lab-table settings-runs-table"><thead><tr><th scope="col">{t('Job', 'Job')}</th><th scope="col">{t('Created', 'Dibuat')}</th><th scope="col">{t('Target / resources', 'Tujuan / sumber daya')}</th><th scope="col">{t('Run / compute time', 'Waktu run / compute')}</th><th scope="col">{t('Charge / refund', 'Biaya / refund')}</th><th scope="col">Status</th></tr></thead><tbody>{page.runs.map(run => {
      const timestamp = run.createdAt || run.startedAt || run.completedAt;
      const elapsed = recordedRunSeconds(run), compute = measuredComputeSeconds(run);
      const cores = typeof run.vcpus === 'number' && Number.isFinite(run.vcpus) && run.vcpus > 0 ? `${run.vcpus.toLocaleString(intlLocale)} vCPU` : '—';
      const memory = typeof run.memoryMiB === 'number' && Number.isFinite(run.memoryMiB) && run.memoryMiB > 0 ? `${(run.memoryMiB / 1024).toLocaleString(intlLocale)} GiB RAM` : '—';
      return <tr key={run.id}><th scope="row"><strong>{run.name}</strong><small>{run.calculationType}</small></th><td>{timestamp && Number.isFinite(Date.parse(timestamp)) ? <time dateTime={timestamp}>{new Date(timestamp).toLocaleDateString(intlLocale, { day: 'numeric', month: 'short', year: 'numeric' })}<small>{new Date(timestamp).toLocaleTimeString(intlLocale, { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })}</small></time> : '—'}</td><td>{run.computeTarget === 'personal' ? t('Your computer', 'Komputer Anda') : run.computeTarget === 'shared' ? 'Phynite Cloud' : '—'}<small>{t('Requested', 'Diminta')}: {cores} · {memory}</small><small>{t('Worker', 'Worker')}: {computeCapacityLabel({ vcpus: run.effectiveVcpus, memoryMiB: run.effectiveMemoryMiB }, intlLocale) ?? '—'}</small>{run.cloudMode && <small>{run.cloudMode === 'paid' ? t('Paid · Quanta', 'Paid · Quanta') : run.cloudMode === 'pilot' ? t('Pilot grant', 'Grant pilot') : run.cloudMode}</small>}</td><td>{displayDuration(elapsed, intlLocale)}<small>{t('Compute', 'Compute')}: {displayDuration(compute, intlLocale)}</small></td><td>{displayQuanta(run.chargedQuanta, intlLocale)}<small>{t('Refund', 'Refund')}: {displayQuanta(run.refundedQuanta, intlLocale)}</small></td><td><span className="lab-tag">{run.status.toLowerCase().replaceAll('_', ' ')}</span></td></tr>;
    })}</tbody></table></div>
    <div className="account-pagination"><span>{(cursors.length - 1) * 6 + 1}–{(cursors.length - 1) * 6 + page.runs.length} {t('of', 'dari')} {page.total} · {t('Page', 'Halaman')} {cursors.length}</span><div><button className="lab-button" disabled={cursors.length === 1} onClick={() => setCursors(current => current.slice(0, -1))}><ChevronLeft size={15} />{t('Previous', 'Sebelumnya')}</button><button className="lab-button" disabled={!page.nextCursor} onClick={() => { if (page.nextCursor) setCursors(current => [...current, page.nextCursor!]); }}>{t('Next', 'Berikutnya')}<ChevronRight size={15} /></button></div></div>
  </> : <div className="lab-empty">{t('No calculations here yet.', 'Belum ada kalkulasi di sini.')} <a href="/calculation">{t('Open DFT Lab', 'Buka DFT Lab')}</a></div>}</div>;
}

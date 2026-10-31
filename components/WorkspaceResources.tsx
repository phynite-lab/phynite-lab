'use client';

import Link from 'next/link';
import { ArrowUpRight, ChevronRight, Clock3, Cpu, Gauge, HardDrive, RefreshCw, Wallet } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAccountUsage } from '@/app/use-account-usage';
import { useAccountComputeUsage } from '@/app/use-account-compute-usage';
import { formatBytes } from '@/lib/account-api';
import { measuredStorageCapacity, invalidateResourceUsageStores } from '@/lib/resource-usage-store';
import { displayDuration, displayQuanta, recordedCpuSeconds } from '@/lib/usage-display';
import { ResearchResourcesSlot, useResearchShell } from './ResearchShellContext';
import { useLabAccount } from '@/app/use-lab-account';
import { useComputeCatalog } from '@/app/use-compute-catalog';
import { useLocale } from '@/app/locale-provider';
import { computeCapacityChoices, computeCapacityLabel, type ComputeSelection } from '@/lib/compute-selection';
import { affordableComputeHours, personalComputeRequest } from '@/lib/compute-preferences';
import type { AccountUsageRun, ComputeWorkload } from '@/lib/account-api';
import { phyniteApi } from '@/lib/phynite-api';
import { jobElapsedSeconds, workspaceJobPath, type WorkspaceJob } from '@/lib/workspace-resource-metrics';
import { LabComputeDestination } from './ComputeDestination';
import { LabConfigurationDrawer } from './LabConfigurationDrawer';
import { UiSelect } from './UiSelect';
import '@/app/workspace-resources.css';

type JobDetails = { startedAt?: string; completedAt?: string; status?: string; computePhase?: string; computeSeconds?: number; vcpus?: number; memoryMiB?: number };
type ResourceScopeProps = { scope: 'workspace'; projectId?: never; selection?: never; onChange?: never }
  | { scope: 'project'; projectId: string; selection: ComputeSelection; onChange: (selection: ComputeSelection) => void };
export function WorkspaceResources({ owner, workload, selection = {}, onChange = () => undefined, jobs, open, onOpen, onClose, scope, projectId }: {
  open: boolean; onOpen: () => void; onClose: () => void;
  owner: string; workload: ComputeWorkload; jobs: WorkspaceJob[];
} & ResourceScopeProps) {
  const { t, intlLocale } = useLocale();
  const resource = useLabAccount(owner), account = resource.account;
  const { catalog } = useComputeCatalog();
  const shell = useResearchShell();
  const [mode, setMode] = useState<'overview' | 'compute'>('overview');
  const inventory = useAccountUsage(owner, open, { projectId: scope === 'project' ? projectId : undefined });
  const computeUsage = useAccountComputeUsage(owner, true, scope === 'project' ? projectId : undefined);
  const [chosenJob, setChosenJob] = useState(''), [jobData, setJobData] = useState<{ owner: string; id: string; value: JobDetails }>();
  const [jobFailure, setJobFailure] = useState<{ owner: string; id: string }>(), [now, setNow] = useState<number | null>(null);
  const [jobRetry, setJobRetry] = useState(0);

  const usageJobs = (computeUsage.usage?.activeRuns ?? []).map((run: AccountUsageRun): WorkspaceJob => ({ id: run.id, nodeId: run.id, name: run.name, kind: run.calculationType === 'LAMMPS simulation' ? 'MD_SIMULATION' : run.calculationType === 'OVITO analysis' ? 'MD_ANALYSIS' : 'CALCULATION', status: run.status.toLowerCase() }));
  const visibleJobs = scope === 'workspace' ? usageJobs : [...jobs, ...usageJobs.filter(run => !jobs.some(job => job.id === run.id))];
  const job = visibleJobs.find(item => item.id === chosenJob) ?? visibleJobs[0];
  const jobId = job?.id, jobPath = job ? workspaceJobPath(job) : null;
  const usageJob = computeUsage.usage?.activeRuns?.find(item => item.id === jobId);
  const jobError = !usageJob && jobFailure?.owner === owner && jobFailure.id === jobId;
  const fetchedDetails = jobData?.owner === owner && jobData?.id === jobId ? jobData?.value : undefined;
  const details = usageJob ?? fetchedDetails;
  const refreshAccount = resource.refresh;
  const refreshComputeUsage = computeUsage.refresh;
  const hasActiveJobs = visibleJobs.length > 0 || (computeUsage.usage?.compute.activeRuns ?? 0) > 0;
  const jobSignature = jobs.map(item => `${item.id}:${item.status}`).join('|');
  const receiptSignature = computeUsage.usage ? JSON.stringify([computeUsage.usage.compute, computeUsage.usage.activeRuns?.map(run => [run.id, run.status, run.computePhase]), computeUsage.usage.recentRuns.map(run => [run.id, run.status, run.completedAt])]) : null;
  const previousReceipt = useRef<{ key: string; signature: string } | null>(null);
  useEffect(() => {
    if (receiptSignature === null) return;
    const key = `${owner}:${scope}:${projectId ?? ''}`;
    if (previousReceipt.current?.key === key && previousReceipt.current.signature !== receiptSignature) {
      invalidateResourceUsageStores(owner);
      void refreshAccount();
    }
    previousReceipt.current = { key, signature: receiptSignature };
  }, [owner, scope, projectId, receiptSignature, refreshAccount]);
  useEffect(() => {
    const update = () => {
      if (document.visibilityState === 'hidden') return;
      void refreshAccount();
      void refreshComputeUsage().catch(() => undefined);
    };
    const timer = setInterval(update, hasActiveJobs ? 15_000 : 60_000);
    const focus = () => update();
    window.addEventListener('focus', focus); document.addEventListener('visibilitychange', focus);
    return () => { clearInterval(timer); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus); };
  }, [refreshAccount, refreshComputeUsage, hasActiveJobs]);
  const priorJobs = useRef<string | null>(null);
  useEffect(() => {
    if (priorJobs.current !== null && priorJobs.current !== jobSignature) {
      void refreshAccount(); window.dispatchEvent(new Event('phynite:usage-change'));
    }
    priorJobs.current = jobSignature;
  }, [jobSignature, refreshAccount]);
  useEffect(() => {
    if (!jobId || !jobPath || usageJob) return;
    let live = true, pending = false;
    const refresh = async () => {
      if (pending || document.visibilityState === 'hidden') return;
      pending = true;
      try {
        const data = await phyniteApi<{ calculation?: JobDetails; simulation?: JobDetails; analysis?: JobDetails }>(jobPath, { cache: 'no-store' });
        const value = data.calculation ?? data.simulation ?? data.analysis;
        if (live && value) { setJobData({ owner, id: jobId, value }); setJobFailure(undefined); }
      } catch { if (live) setJobFailure({ owner, id: jobId }); }
      finally { pending = false; }
    };
    void refresh(); const timer = setInterval(() => void refresh(), 15_000);
    return () => { live = false; clearInterval(timer); };
  }, [owner, jobId, jobPath, jobRetry, usageJob]);
  useEffect(() => {
    if (!jobId) return;
    const update = () => setNow(Date.now());
    const timer = setInterval(update, 1000); update();
    return () => clearInterval(timer);
  }, [jobId]);
  const target = workload === 'qe' ? selection.computeTarget ?? account?.computeTarget ?? 'personal' : 'personal';
  const profile = catalog?.profiles.find(item => item.id === (selection.computeProfileId ?? account?.computeProfileId));
  const cloudMode = selection.cloudMode ?? account?.cloudMode ?? 'paid';
  const cloudAllocation = cloudMode === 'pilot' ? computeCapacityChoices(catalog?.profiles ?? [], { selectedId: profile?.id, vcpus: account?.pilotCompute?.limits.vcpus ?? 2, memoryMiB: account?.pilotCompute?.limits.memoryMiB ?? 6144 }).find(item => item.id === profile?.id) : profile;
  const allocation = target === 'shared' ? cloudAllocation : personalComputeRequest(selection, account?.personalDefaults?.[workload]);
  const balance = account?.quanta.available ?? account?.quanta.balance;
  const affordable = affordableComputeHours(balance, profile?.hourlyQuanta, catalog?.minimumSeconds);
  const format = (value: number, digits = 2) => value.toLocaleString(intlLocale, { maximumFractionDigits: digits });
  const capacity = computeCapacityLabel(allocation, intlLocale) ?? t('Choose CPU / RAM', 'Pilih CPU / RAM');
  const elapsed = now && details ? jobElapsedSeconds(details.startedAt, details.completedAt, now) : null;
  const elapsedLabel = elapsed === null ? '—' : elapsed >= 3600 ? `${format(elapsed / 3600)} ${t('h', 'jam')}` : `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;
  const phase = details?.status && ['COMPLETED', 'FAILED', 'CANCELLED'].includes(details.status) ? details.status : details?.computePhase ?? details?.status ?? job?.status;
  const phases: Record<string, string> = { queued: t('Queued', 'Antre'), pending: t('Preparing', 'Persiapan'), preparing: t('Preparing', 'Persiapan'), running: t('Running', 'Berjalan'), cancel_requested: t('Cancelling', 'Membatalkan'), CANCEL_REQUESTED: t('Cancelling', 'Membatalkan'), QUEUED: t('Queued', 'Antre'), PREPARING: t('Preparing', 'Persiapan'), RUNNING: t('Running', 'Berjalan'), COMPUTING: t('Computing', 'Compute'), FINALIZING: t('Saving results', 'Menyimpan hasil'), COMPLETED: t('Completed', 'Selesai'), FAILED: t('Failed', 'Gagal'), CANCELLED: t('Cancelled', 'Dibatalkan') };
  const compute = computeUsage.usage?.compute;
  const wallSeconds = compute && (compute.measuredRuns > 0 || compute.totalRuns === 0) ? compute.wallSeconds : null;
  const cpuSeconds = compute ? recordedCpuSeconds(compute) : null;
  const solverSeconds = compute?.reportedSolverRuns ? compute.reportedSolverSeconds : null;
  const storage = measuredStorageCapacity(inventory.usage, account?.limits.researchBytes);
  const bytes = (value: number) => formatBytes(value, intlLocale);
  const storageLabel = storage.storage ? `${storage.storage.complete ? '' : '≥ '}${bytes(storage.storage.bytes)}` : t('Not measured', 'Belum diukur');
  const quotaLabel = storage.quota === undefined ? '—' : bytes(storage.quota);
  const connection = account?.computer.status === 'connected' ? t('Connected', 'Terhubung') : account?.computer.status === 'offline' ? 'Offline' : t('Not connected', 'Belum terhubung');
  const phaseLabel = phase ? phases[phase] ?? phase : '—';
  const close = () => { setMode('overview'); onClose(); };
  const meter = useRef<HTMLButtonElement>(null);
  const closeRef = useRef(close);
  useEffect(() => { closeRef.current = close; });
  useEffect(() => {
    const media = matchMedia('(max-width: 960px)');
    const change = () => {
      const restore = open || document.activeElement === meter.current;
      closeRef.current();
      if (restore) requestAnimationFrame(() => meter.current?.focus({ preventScroll: true }));
    };
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, [open]);
  const returnPath = typeof window === 'undefined' ? '' : window.location.pathname + window.location.search + window.location.hash;
  const panelHost = shell?.workspaceHeaderHost?.closest('.research-app-shell');
  return <>
    <ResearchResourcesSlot section={scope === 'workspace' ? 'home' : 'projects'}><button ref={meter} type="button" className="research-rail-button workspace-resources-meter" title={t('Resources', 'Resource')} aria-label={t('Workspace resources', 'Resource workspace')} aria-haspopup="dialog" aria-expanded={open} onClick={onOpen}><Gauge size={18} />{visibleJobs.length > 0 && <span className="workspace-resources-active" aria-label={t(`${visibleJobs.length} active jobs`, `${visibleJobs.length} job aktif`)} />}</button></ResearchResourcesSlot>
    {open && panelHost && createPortal(<div className="workspace-resources-layer" data-ui-portal><LabConfigurationDrawer className="workspace-resources-panel" ariaLabel={t('Workspace resources', 'Resource workspace')} title={t('Resources', 'Resource')} subtitle={scope === 'project' ? t('This project · budget, storage and compute', 'Project ini · anggaran, penyimpanan, dan compute') : t('All projects · budget, storage and compute', 'Semua project · anggaran, penyimpanan, dan compute')} mode={mode} modes={[{ id: 'overview', label: t('Overview', 'Ringkasan') }, { id: 'compute', label: 'Compute' }]} onModeChange={setMode} onClose={close}>
      {mode === 'overview' ? <div className="workspace-resource-overview">
        {(resource.error || inventory.error || computeUsage.error || jobError) && <p className="workspace-resource-note" role="status">{t('Refresh unavailable · last data shown', 'Pembaruan gagal · data terakhir')}</p>}
        {job && <section className="workspace-resource-section workspace-active-job">
          <h2><Clock3 size={15} />{t('Active compute', 'Compute aktif')}<small>{visibleJobs.length} {t('active', 'aktif')}</small></h2>
          {visibleJobs.length > 1 ? <UiSelect ariaLabel={t('Active compute job', 'Job compute aktif')} value={job.id} options={visibleJobs.map(item => ({ value: item.id, label: item.name }))} onChange={setChosenJob} /> : <p>{job.name}</p>}
          <p className="workspace-job-timing"><strong>{phaseLabel} · {elapsedLabel}</strong><span>{t('Elapsed since start', 'Waktu sejak mulai')}</span></p>
        </section>}
        <section className="workspace-resource-section">
          <h2><Wallet size={15} />Quanta<Link href={`/billing?returnTo=${encodeURIComponent(returnPath)}#payments`}>{t('Top up', 'Top-up')}<ArrowUpRight size={13} /></Link></h2>
          <dl><div><dt>{t('Account balance available', 'Saldo akun tersedia')}</dt><dd className="workspace-quanta-value">{balance === undefined ? '—' : format(balance, 6)} Q</dd></div><div><dt>{t('Reserved for jobs', 'Direservasi untuk job')}</dt><dd>{account?.quanta.reserved === undefined ? '—' : format(account.quanta.reserved, 6)} Q</dd></div></dl>
          <dl><div><dt>{scope === 'project' ? t('Project charged before refunds', 'Tagihan project sebelum refund') : t('All projects charged before refunds', 'Tagihan semua project sebelum refund')}</dt><dd>{displayQuanta(compute?.chargedQuanta, intlLocale)}</dd></div><div><dt>{t('Refunded', 'Direfund')}</dt><dd>{displayQuanta(compute?.refundedQuanta, intlLocale)}</dd></div><div><dt>{t('Net Quanta used', 'Quanta terpakai neto')}</dt><dd>{displayQuanta(compute?.netQuanta, intlLocale)}</dd></div></dl>
          {compute?.quantaUnmeasuredRuns ? <p className="workspace-resource-note">{t('Some job charges are not recorded; the shown total is partial.', 'Sebagian biaya job belum tercatat; total yang ditampilkan parsial.')}</p> : null}
          {target === 'shared' && cloudMode === 'paid' && <><dl><div><dt>{t('Estimated Cloud capacity', 'Perkiraan kapasitas Cloud')}</dt><dd>{affordable === null ? '—' : `≈ ${format(affordable)} ${t('h', 'jam')}`}</dd></div></dl><p className="workspace-resource-note">{t('For one new job at the selected profile rate, after reservations. This is available compute capacity, not a completion ETA.', 'Untuk satu job baru pada tarif profil terpilih, setelah reservasi. Ini kapasitas compute tersedia, bukan ETA penyelesaian.')}</p></>}
          {target === 'shared' && cloudMode === 'pilot' && <><dl><div><dt>{t('Pilot grant · jobs left', 'Grant pilot · sisa job')}</dt><dd>{account?.pilotCompute?.remainingJobs ?? '—'}</dd></div><div><dt>{t('Maximum per job', 'Maksimum per job')}</dt><dd>{account?.pilotCompute?.limits.timeoutSeconds ? `${format(account.pilotCompute.limits.timeoutSeconds / 3600)} ${t('h', 'jam')}` : '—'}</dd></div></dl><p className="workspace-resource-note">{t('Pilot grants are separate from your paid Quanta balance.', 'Grant pilot terpisah dari saldo Quanta berbayar.')}</p></>}
        </section>
        <section className="workspace-resource-section">
          <h2><Cpu size={15} />Compute<button type="button" onClick={() => setMode('compute')}>{t('Configure', 'Atur')}<ChevronRight size={13} /></button></h2>
          <p className="workspace-resource-compute-name">{target === 'personal' ? t('Your computer · no Quanta charge', 'Komputer Anda · tanpa biaya Quanta') : 'Phynite Cloud'}</p>
          <dl><div><dt>{t('Job allocation', 'Alokasi job')}</dt><dd>{capacity}</dd></div>{target === 'personal' && <div><dt>{t('Worker connection', 'Koneksi worker')}</dt><dd>{connection}</dd></div>}</dl>
          <dl><div><dt>{t('Active jobs', 'Job aktif')}</dt><dd>{compute?.activeRuns ?? '—'}</dd></div><div><dt>{t('Measured wall time', 'Wall time terukur')}</dt><dd>{displayDuration(wallSeconds, intlLocale)}</dd></div><div><dt>{t('Allocated CPU-hours', 'Jam CPU teralokasi')}</dt><dd>{cpuSeconds === null ? '—' : `${compute?.unmeasuredCpuRuns ? '≥ ' : ''}${format(cpuSeconds / 3600, 4)} ${t('h', 'jam')}`}</dd></div><div><dt>{t('Solver / analysis time', 'Waktu solver / analisis')}</dt><dd>{displayDuration(solverSeconds, intlLocale)}</dd></div></dl>
          {compute && <p className="workspace-resource-note">{scope === 'project' ? t('Project totals at the last usage measurement.', 'Total project pada pengukuran pemakaian terakhir.') : t('Account totals across all projects at the last usage measurement.', 'Total akun dari semua project pada pengukuran pemakaian terakhir.')}{(compute.unmeasuredRuns > 0 || (compute.unmeasuredCpuRuns ?? 0) > 0 || (compute.reportedSolverRuns ?? 0) < compute.measuredRuns + compute.unmeasuredRuns) && ` ${t('Some runs have incomplete timing or allocation records; recorded totals are partial.', 'Sebagian run memiliki catatan waktu atau alokasi tidak lengkap; total tercatat bersifat parsial.')}`}</p>}
          <p className="workspace-resource-note">{t('GPU: not supported by this runtime. VRAM: not reported.', 'GPU: belum didukung runtime ini. VRAM: belum dilaporkan.')}</p>
        </section>
        <section className="workspace-resource-section workspace-resource-storage">
          <h2><HardDrive size={15} />{t('Storage', 'Penyimpanan')}<button type="button" disabled={inventory.loading} onClick={() => void inventory.refresh().catch(() => undefined)}><RefreshCw size={13} />{inventory.loading ? t('Measuring…', 'Mengukur…') : t('Refresh', 'Perbarui')}</button></h2>
          <dl><div><dt>{scope === 'project' ? t('Project files measured', 'File project terukur') : t('Measured files', 'File terukur')}</dt><dd>{storageLabel}</dd></div><div><dt>{t('Account storage quota', 'Kuota penyimpanan akun')}</dt><dd>{quotaLabel}</dd></div><div><dt>{scope === 'project' ? t('Project upload reservations', 'Reservasi upload project') : t('Upload reservations', 'Reservasi upload')}</dt><dd>{storage.storage?.uploadReservedBytes === undefined ? '—' : bytes(storage.storage.uploadReservedBytes)}</dd></div>{scope === 'workspace' && storage.free !== null && <div><dt>{t('Available at measurement', 'Tersedia saat diukur')}</dt><dd>{bytes(storage.free)}</dd></div>}</dl>
          {storage.storage && <div className="workspace-storage-meter" role="meter" aria-label={t('Measured storage', 'Penyimpanan terukur')} aria-valuemin={0} aria-valuemax={Math.max(1, storage.quota ?? storage.storage.bytes)} aria-valuenow={Math.min(storage.storage.bytes, Math.max(1, storage.quota ?? storage.storage.bytes))} aria-valuetext={`${storageLabel} / ${quotaLabel}`}><span style={{ width: `${Math.min(100, storage.quota ? storage.storage.bytes / storage.quota * 100 : 0)}%` }} /></div>}
          {inventory.usage && <p className="workspace-resource-note">{t('Measured', 'Diukur')} {new Date(inventory.usage.measuredAt).toLocaleString(intlLocale)}{inventory.stale && ` · ${t('May have changed', 'Mungkin telah berubah')}`}</p>}
          {storage.storage && !storage.storage.complete && <p className="workspace-resource-note">{t('Partial inventory. Usage is a lower bound; free capacity is unavailable.', 'Inventaris parsial. Pemakaian adalah batas bawah; kapasitas kosong belum tersedia.')}</p>}
          {scope === 'project' && <p className="workspace-resource-note">{t('Storage quota is shared across the account. Open Home Resources for overall usage and available capacity.', 'Kuota penyimpanan digunakan bersama seluruh akun. Buka Resource Home untuk total pemakaian dan kapasitas tersedia.')}</p>}
          {inventory.error && <p role="alert" className="workspace-resource-note">{inventory.usage ? t('Refresh failed. The last measurement is shown.', 'Pembaruan gagal. Pengukuran terakhir ditampilkan.') : t('Storage could not be measured. Try Refresh.', 'Penyimpanan belum dapat diukur. Coba Perbarui.')}</p>}
          <Link className="workspace-resource-detail-link" href="/account/storage">{t('Storage details', 'Detail penyimpanan')}<ArrowUpRight size={13} /></Link>
        </section>
        <Link className="workspace-resource-detail-link" href="/account/usage">{t('Usage, compute time and receipts', 'Pemakaian, waktu compute, dan rincian biaya')}<ArrowUpRight size={13} /></Link>
        {(resource.error || computeUsage.error || jobError) && <button type="button" className="lab-button" onClick={() => { void refreshAccount(); void computeUsage.refresh().catch(() => undefined); setJobRetry(value => value + 1); }}><RefreshCw size={14} />{t('Refresh resources', 'Perbarui resource')}</button>}
      </div> : <>
        {scope === 'workspace' ? <p className="workspace-resource-scope">{t('Workspace compute defaults apply to new runs. Open Compute settings to change them.', 'Default compute workspace berlaku untuk run baru. Buka pengaturan Compute untuk mengubahnya.')}</p> : <><p className="workspace-resource-scope">{t('Applies to this run configuration. Use Make default to save preferences for new runs.', 'Berlaku untuk konfigurasi run ini. Gunakan Jadikan default untuk menyimpan preferensi run baru.')}</p>
        <LabComputeDestination scope="run" requiredCapability={workload} sharedAvailable={workload === 'qe'} fixedTarget={workload === 'qe' ? undefined : 'personal'} selection={selection} onChange={onChange} account={account} onAccount={resource.setAccount} /></>}
        <div className="workspace-resource-guidance"><p className="workspace-resource-note">{t('CPU and RAM are job allocations, not measurements of installed hardware. More cores do not always make a calculation faster.', 'CPU dan RAM adalah alokasi job, bukan pengukuran perangkat terpasang. Lebih banyak core tidak selalu mempercepat kalkulasi.')}</p><Link className="workspace-resource-detail-link" href={scope === 'workspace' ? '/account/compute' : '/account/compute#your-computer'}>{t('Compute settings and worker setup', 'Pengaturan compute dan setup worker')}<ArrowUpRight size={13} /></Link></div>
      </>}
    </LabConfigurationDrawer></div>, panelHost)}
  </>;
}

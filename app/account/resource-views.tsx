'use client';

import Link from 'next/link';
import { useLocale } from '../locale-provider';
import { SettingsSection } from '@/components/SettingsPage';
import { formatBytes, formatHours, type AccountComputeUsage, type AccountUsage } from '@/lib/account-api';
import { displayDuration, recordedCpuSeconds, recordedRunSeconds } from '@/lib/usage-display';
import { measuredStorageCapacity } from '@/lib/resource-usage-store';

export function ComputeMetrics({ usage, profile = false }: { usage: AccountComputeUsage; profile?: boolean }) {
  const { t, intlLocale } = useLocale();
  const compute = usage.compute;
  const cpuSeconds = recordedCpuSeconds(compute);
  const wall = compute.measuredRuns > 0 || compute.totalRuns === 0 ? displayDuration(compute.wallSeconds, intlLocale) : '—';
  const metrics = profile ? [
    [t('Saved jobs', 'Job tersimpan'), compute.totalRuns.toLocaleString(intlLocale)],
    [t('Completed', 'Selesai'), compute.completedRuns.toLocaleString(intlLocale)],
    [t('Active at measurement', 'Aktif saat pengukuran'), compute.activeRuns.toLocaleString(intlLocale)],
    [t('Recorded run time', 'Waktu run tercatat'), wall],
  ] : [
    [t('Recorded run time', 'Waktu run tercatat'), wall],
    [t('Allocated CPU-hours', 'Jam CPU teralokasi'), cpuSeconds === null ? '—' : formatHours(cpuSeconds, intlLocale)],
    [t('Solver / analysis time', 'Waktu solver / analisis'), compute.reportedSolverRuns ? displayDuration(compute.reportedSolverSeconds, intlLocale) : '—'],
    [t('Active at measurement', 'Aktif saat pengukuran'), compute.activeRuns.toLocaleString(intlLocale)],
  ];
  return <><dl className="settings-metrics">{metrics.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    {compute.unmeasuredRuns > 0 && <p className="lab-caption">{compute.unmeasuredRuns.toLocaleString(intlLocale)} {t('jobs have incomplete timing and are excluded from recorded run time.', 'job memiliki catatan waktu tidak lengkap dan tidak dihitung dalam waktu run tercatat.')}</p>}
    {!profile && <><p className="lab-caption">{t('Run time includes preparation and uploading results. CPU-hours multiply recorded run time by reported runtime CPUs; they describe allocation, not utilization. Solver time is reported separately; charges follow the Quanta ledger.', 'Waktu run mencakup persiapan dan upload hasil. Jam CPU mengalikan waktu run tercatat dengan CPU runtime yang dilaporkan; angka ini menunjukkan alokasi, bukan utilisasi. Waktu solver dilaporkan terpisah; biaya mengikuti ledger Quanta.')}</p>{(compute.unmeasuredCpuRuns === undefined || compute.unmeasuredCpuRuns > 0) && <p className="lab-caption">{t('CPU-hours are partial: jobs without complete time and runtime allocation are excluded.', 'Jam CPU parsial: job tanpa catatan waktu dan alokasi runtime lengkap tidak dihitung.')}</p>}</>}
  </>;
}

export function ProfileRecentRuns({ usage }: { usage: AccountComputeUsage }) {
  const { t, intlLocale } = useLocale();
  return <SettingsSection title={t('Recent jobs', 'Job terbaru')} description={t('Your five most recent saved jobs.', 'Lima job tersimpan terbaru Anda.')} actions={<Link className="lab-text-link" href="/account/usage">{t('View usage', 'Lihat pemakaian')} →</Link>}>
    {usage.recentRuns.length ? <ul className="settings-recent-runs">{usage.recentRuns.slice(0, 5).map(run => <li key={run.id}><div><strong>{run.name}</strong><span>{run.calculationType} · {run.createdAt ? new Date(run.createdAt).toLocaleDateString(intlLocale) : '—'}</span></div><div><span className="lab-tag">{run.status.toLowerCase().replaceAll('_', ' ')}</span><small>{displayDuration(recordedRunSeconds(run), intlLocale)}</small></div></li>)}</ul> : <p className="settings-empty">{t('No saved jobs yet. Your research runs will appear here.', 'Belum ada job tersimpan. Run riset Anda akan tampil di sini.')}</p>}
  </SettingsSection>;
}

export function StorageUsage({ usage, currentQuota }: { usage: AccountUsage; currentQuota?: number }) {
  const { t, intlLocale } = useLocale();
  const bytes = (value: number) => formatBytes(value, intlLocale);
  const { quota, free } = measuredStorageCapacity(usage, currentQuota);
  const storage = usage.storage, reserved = storage.uploadReservedBytes;
  const categoryNames: Record<string, string> = { calculations: t('Calculation artifacts', 'Artefak kalkulasi'), trajectories: t('MD trajectories', 'Trajectory MD'), structures: t('Structures', 'Struktur'), research: t('Figures & datasets', 'Figur & dataset'), workspace: t('Workspace files', 'File workspace'), other: t('Other files', 'File lainnya') };
  const categories = Object.entries(storage.categories);
  const denominator = Math.max(quota ?? 0, storage.bytes + (reserved ?? 0), categories.reduce((sum, [, value]) => sum + value, 0) + (reserved ?? 0), 1);
  const unknown = !storage.complete || reserved === undefined;
  return <>
    <SettingsSection id="cloud-storage" title={t('Cloud storage', 'Penyimpanan cloud')} description={t('One account allowance for project files, results, trajectories, and figures.', 'Satu kuota akun untuk file project, hasil, trajectory, dan figur.')} actions={<Link className="lab-button" href="/billing#payments">{t('Manage capacity', 'Kelola kapasitas')}</Link>}>
      <div className="settings-storage-summary"><p className="settings-storage-total"><strong>{bytes(storage.bytes)}{!storage.complete && '+'}</strong><span> / {quota === undefined ? '—' : bytes(quota)}</span></p>
        <div className="settings-storage-bar" data-unknown={unknown} role="img" aria-label={`${t('Measured storage', 'Penyimpanan terukur')}: ${bytes(storage.bytes)}${!storage.complete ? '+' : ''}; ${unknown ? t('unmeasured space is unknown', 'ruang belum terukur tidak diketahui') : t('inventory complete', 'inventaris lengkap')}`}>
          {categories.map(([name, value], index) => <span key={name} className={`settings-storage-category settings-storage-color-${index % 6}`} style={{ width: `${value / denominator * 100}%` }} />)}
          {reserved !== undefined && reserved > 0 && <span className="settings-storage-reserved" style={{ width: `${reserved / denominator * 100}%` }} />}
        </div>
        <ul className="settings-storage-legend">{categories.map(([name, value], index) => <li key={name}><i className={`settings-storage-color-${index % 6}`} aria-hidden="true" /><span>{categoryNames[name] ?? name}</span><strong>{bytes(value)}{!storage.complete && '+'}</strong></li>)}{reserved !== undefined && reserved > 0 && <li><i className="settings-storage-reserved" aria-hidden="true" /><span>{t('Upload reservations', 'Reservasi upload')}</span><strong>{bytes(reserved)}</strong></li>}</ul>
        {unknown && <p className="lab-caption">{t('The patterned area is unmeasured, not available capacity. Measured categories are a lower bound when inventory is partial.', 'Area berpola belum terukur, bukan kapasitas tersedia. Kategori terukur adalah batas bawah bila inventaris parsial.')}</p>}
      </div>
      <dl className="settings-ledger"><div><dt>{t('Files measured', 'File terukur')}</dt><dd>{storage.objects.toLocaleString(intlLocale)}</dd></div><div><dt>{t('Total allowance', 'Kuota total')}</dt><dd>{quota === undefined ? '—' : bytes(quota)}</dd></div><div><dt>{t('Reserved uploads', 'Reservasi upload')}</dt><dd>{reserved === undefined ? t('Unavailable', 'Tidak tersedia') : bytes(reserved)}</dd></div><div><dt>{t('Available capacity', 'Kapasitas tersedia')}</dt><dd>{free === null ? t('Unavailable', 'Tidak tersedia') : bytes(free)}</dd></div><div><dt>{t('Inventory', 'Inventaris')}</dt><dd>{storage.complete ? t('Complete', 'Lengkap') : t('Partial', 'Parsial')}</dd></div><div><dt>{t('Measured', 'Diukur')}</dt><dd>{new Date(usage.measuredAt).toLocaleString(intlLocale)}</dd></div></dl>
    </SettingsSection>
    <p className="lab-caption">{t('Inventory is measured separately from compute records. Local files and database metadata are excluded.', 'Inventaris diukur terpisah dari catatan compute. File lokal dan metadata database tidak dihitung.')} {t('Figure Lab retains', 'Figure Lab menyimpan')} {bytes(storage.researchRetainedBytes)} {t('within the measured cloud usage.', 'dalam pemakaian cloud terukur.')}</p>
  </>;
}

'use client';
import Link from 'next/link';
import { useLocale } from '@/app/locale-provider';
import { displayDuration, displayQuanta, measuredComputeSeconds, recordedRunSeconds } from '@/lib/usage-display';
import { computeCapacityLabel } from '@/lib/compute-selection';

export type ComputeJobBilling = {
  cloudMode?: string; computeProfileId?: string; computePhase?: string; status?: string;
  computeSeconds?: number; chargedQuanta?: number; refundedQuanta?: number;
  fundingExpiresAtEpoch?: number; startedAt?: string; completedAt?: string;
  vcpus?: number; memoryMiB?: number; effectiveVcpus?: number; effectiveMemoryMiB?: number; elapsedSeconds?: number;
};

export function ComputeJobReceipt({ job }: { job: ComputeJobBilling }) {
  const { t, intlLocale } = useLocale();
  if (!job.cloudMode) return null;
  const final = ['COMPLETED', 'FAILED', 'CANCELLED'].includes(job.status ?? '');
  const phases: Record<string, string> = {
    QUEUED: t('Queued', 'Dalam antrean'), PREPARING: t('Preparing machine', 'Menyiapkan mesin'),
    COMPUTING: t('Computing', 'Compute berjalan'), FINALIZING: t('Saving results', 'Menyimpan hasil'),
    FINISHED: t('Finished', 'Selesai'),
  };
  const phase = job.status === 'FAILED' ? t('Failed', 'Gagal') : job.status === 'CANCELLED' ? t('Cancelled', 'Dibatalkan') : final ? phases.FINISHED : phases[job.computePhase ?? job.status ?? ''] ?? job.status;
  const elapsed = recordedRunSeconds(job) ?? job.elapsedSeconds;
  return <div className="compute-resource-receipt compute-job-receipt">
    <div className="compute-job-receipt-heading"><strong>{job.cloudMode === 'pilot' ? 'Pilot' : 'Paid'}</strong><span className="compute-phase-badge" data-status={job.status}>{phase}</span></div>
    {computeCapacityLabel(job, intlLocale) && <p className="compute-job-capacity">{t('Requested', 'Diminta')}: {computeCapacityLabel(job, intlLocale)}</p>}
    <dl>
      <div><dt>{t('Worker allocation', 'Alokasi worker')}</dt><dd>{computeCapacityLabel({ vcpus: job.effectiveVcpus, memoryMiB: job.effectiveMemoryMiB }, intlLocale) ?? '—'}</dd></div>
      <div><dt>{t('Solver / analysis time', 'Waktu solver / analisis')}</dt><dd>{displayDuration(measuredComputeSeconds(job), intlLocale)}</dd></div>
      <div><dt>{t('Charge / refund', 'Biaya / refund')}</dt><dd>{displayQuanta(job.chargedQuanta, intlLocale)} / {displayQuanta(job.refundedQuanta, intlLocale)}</dd></div>
      {<div><dt>{t('Total job time', 'Waktu seluruh job')}</dt><dd>{displayDuration(elapsed, intlLocale)}</dd></div>}
    </dl>
    {!final && job.cloudMode === 'paid' && job.fundingExpiresAtEpoch ? <p>{t('Funding deadline', 'Tenggat pendanaan')}: {new Date(job.fundingExpiresAtEpoch * 1000).toLocaleString(intlLocale)}. <Link href="/billing?from=compute" onClick={event => { event.currentTarget.href = '/billing?returnTo=' + encodeURIComponent(window.location.pathname + window.location.search + window.location.hash); }}>{t('Top up Quanta', 'Top-up Quanta')} →</Link></p> : null}
    {job.cloudMode === 'paid' && <p>{t('Only solver/analysis is billed, with a 60-second minimum once per job.', 'Hanya solver/analisis ditagih, minimum 60 detik sekali per job.')}</p>}
  </div>;
}

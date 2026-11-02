'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useLocale } from '@/app/locale-provider';
import { localRequest } from '@/lib/local-api';
import { browserEnvironment, coalescedBrowserRead, startBrowserPoll } from '@/lib/browser-poll';
import { localComputeReadiness, type LocalRuntimeState } from '@/lib/local-compute-readiness';
import type { LocalWorkerCapability } from '@/lib/phynite-api';
import { LocalPseudopotentials } from './LocalPseudopotentials';

/** Only mounted in a local session; hosted pages never contact the desktop API. */
export function LocalComputeReadiness({ capability }: { capability: LocalWorkerCapability }) {
  const { t } = useLocale();
  const [runtime, setRuntime] = useState<LocalRuntimeState | null>(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const lastReadiness = useRef<string | undefined>(undefined);
  useEffect(() => {
    let active = true;
    const stop = startBrowserPoll(async () => {
      try {
        const value = await coalescedBrowserRead('local-runtime', () => localRequest<LocalRuntimeState>('runtime'));
        if (active) { setRuntime(value); setError(''); }
      } catch (failure) {
        if (active) setError((failure as Error).message);
        throw failure;
      }
    }, 3000, { ...browserEnvironment, active: () => !document.hidden });
    return () => { active = false; stop(); };
  }, []);
  const readiness = runtime ? localComputeReadiness(runtime, capability) : null;
  useEffect(() => {
    if (!readiness) return;
    if (lastReadiness.current && lastReadiness.current !== 'ready' && readiness.status === 'ready') {
      window.dispatchEvent(new Event('phynite:compute-target-change'));
    }
    lastReadiness.current = readiness.status;
  }, [readiness]);
  const name = capability === 'qe' ? 'DFT' : t('MD & analysis', 'MD & analisis');
  const install = async () => {
    if (!readiness || submitting) return;
    setSubmitting(true); setError('');
    try {
      await localRequest('runtime/install', 'POST', { component: readiness.component });
      setRuntime(await localRequest<LocalRuntimeState>('runtime'));
      window.dispatchEvent(new Event('phynite:compute-target-change'));
    } catch (failure) { setError((failure as Error).message); }
    finally { setSubmitting(false); }
  };
  return <div className="compute-runtime-readiness" data-readiness={readiness?.status ?? 'checking'}>
    <p role="status">{!readiness ? t('Checking local solver…', 'Memeriksa solver lokal…')
      : readiness.status === 'ready' ? t(`${name} is ready on this computer.`, `${name} siap di komputer ini.`)
      : readiness.status === 'installing' ? t(`Installing ${name}${readiness.percent === undefined ? '' : ` · ${readiness.percent}%`}…`, `Memasang ${name}${readiness.percent === undefined ? '' : ` · ${readiness.percent}%`}…`)
      : readiness.status === 'starting' ? t(`${name} is installed. Waiting for the local worker to validate it. If this persists, open setup and inspect the worker logs.`, `${name} terpasang. Menunggu validasi worker lokal. Jika berlanjut, buka setup dan periksa log worker.`)
      : readiness.status === 'failed' ? readiness.error
      : readiness.status === 'unavailable' ? readiness.error || t(`${name} is unavailable for this platform. Open setup for details.`, `${name} belum tersedia untuk platform ini. Buka setup untuk rinciannya.`)
      : t(`Install ${name} in this workspace before running. No Docker or Cloud login is needed.`, `Pasang ${name} di workspace ini sebelum menjalankan. Tidak perlu Docker atau login Cloud.`)}</p>
    {readiness?.status === 'installing' && <progress aria-label={t('Runtime download', 'Unduhan runtime')} max={100} value={readiness.percent} />}
    {readiness && ['missing', 'failed'].includes(readiness.status) && <button type="button" className="lab-button" disabled={submitting} onClick={() => void install()}>{submitting ? t('Starting installation…', 'Memulai instalasi…') : t(`Install ${name}`, `Pasang ${name}`)}</button>}
    {readiness?.status !== 'ready' && <Link href="/local#runtime">{t('Open compute setup', 'Buka setup compute')} →</Link>}
    {capability === 'qe' && readiness?.status === 'ready' && <details className="compute-pseudopotential-setup"><summary>{t('Set up DFT pseudopotentials', 'Siapkan pseudopotential DFT')}</summary><LocalPseudopotentials compact /></details>}
    {error && <p role="alert">{error}</p>}
  </div>;
}

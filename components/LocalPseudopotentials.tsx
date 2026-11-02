'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale } from '@/app/locale-provider';
import { localRequest } from '@/lib/local-api';
import { browserEnvironment, coalescedBrowserRead, startBrowserPoll } from '@/lib/browser-poll';
import './local-pseudopotentials.css';

type Library = 'precision' | 'efficiency';
export type PseudopotentialState = {
  version: string;
  source: string;
  libraries: Record<Library, { installed: boolean; elements: number; totalElements: number; downloadBytes: number; error?: string }>;
  progress: { state: string; library: Library | null; downloadedBytes: number; totalBytes?: number; error?: string };
};

/** Potential files are explicit setup downloads with independent upstream terms. */
export function LocalPseudopotentials({ compact = false }: { compact?: boolean }) {
  const { t, intlLocale } = useLocale();
  const [state, setState] = useState<PseudopotentialState | null>(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const previous = useRef<string | undefined>(undefined);
  useEffect(() => {
    let live = true;
    const stop = startBrowserPoll(async () => {
      try {
        const runtime = await coalescedBrowserRead('local-runtime', () => localRequest<{ pseudopotentials?: PseudopotentialState }>('runtime'));
        if (!live) return;
        setState(runtime.pseudopotentials ?? null); setError('');
        const next = JSON.stringify(runtime.pseudopotentials?.libraries);
        if (previous.current && next !== previous.current) window.dispatchEvent(new Event('phynite:compute-target-change'));
        previous.current = next;
      } catch (failure) { if (live) setError((failure as Error).message); throw failure; }
    }, 3000, { ...browserEnvironment, active: () => !document.hidden });
    return () => { live = false; stop(); };
  }, []);
  const install = async (library: Library) => {
    setSubmitting(true); setError('');
    try { await localRequest('runtime/pseudopotentials/install', 'POST', { library }); }
    catch (failure) { setError((failure as Error).message); }
    finally { setSubmitting(false); }
  };
  const progress = state?.progress;
  const installing = progress && !['idle', 'complete', 'failed'].includes(progress.state);
  return <section className={`compute-pseudopotentials${compact ? ' compute-pseudopotentials--compact' : ''}`} aria-label={t('DFT pseudopotentials', 'Pseudopotential DFT')}>
    <p>{t('DFT also needs the exact pseudopotentials selected in your calculation. Install an SSSP library, or upload your own verified UPF files in the editor.', 'DFT juga memerlukan pseudopotential yang dipilih di kalkulasi. Pasang pustaka SSSP, atau unggah file UPF terverifikasi sendiri melalui editor.')}</p>
    {state ? (['precision', 'efficiency'] as const).map(library => {
      const item = state.libraries[library];
      return <div className="compute-pseudopotential-library" key={library}><span><strong>SSSP PBE {library === 'precision' ? 'Precision' : 'Efficiency'}</strong><small>{item.installed ? t(`${item.elements} elements verified`, `${item.elements} elemen terverifikasi`) : t(`${(item.downloadBytes / 1e6).toLocaleString(intlLocale, { maximumFractionDigits: 1 })} MB download`, `Unduhan ${(item.downloadBytes / 1e6).toLocaleString(intlLocale, { maximumFractionDigits: 1 })} MB`)}</small>{item.error && <small role="alert">{item.error}</small>}</span><button type="button" className="lab-button" disabled={item.installed || submitting || Boolean(installing)} onClick={() => void install(library)}>{item.installed ? t('Installed', 'Terpasang') : t('Install library', 'Pasang pustaka')}</button></div>;
    }) : <p role="status">{t('Library setup status is unavailable. If this is an older app version, update Phynite Lab first; existing UPF uploads remain usable.', 'Status setup pustaka belum tersedia. Jika ini versi aplikasi lama, perbarui Phynite Lab; UPF yang sudah diunggah tetap dapat digunakan.')}</p>}
    {progress?.library && <p role={progress.state === 'failed' ? 'alert' : 'status'}>{progress.library} · {progress.state}{installing && progress.totalBytes ? ` · ${Math.min(100, Math.floor(progress.downloadedBytes / progress.totalBytes * 100))}%` : ''}{progress.error ? ` · ${progress.error}` : ''}</p>}
    <p><a href="https://archive.materialscloud.org/records/rcyfm-68h65" target="_blank" rel="noreferrer">{t('SSSP source and licenses', 'Sumber dan lisensi SSSP')} ↗</a> · {t('Downloaded separately. Installing a library does not change the selected model, cutoffs, or physical settings.', 'Diunduh terpisah. Pemasangan pustaka tidak mengubah model, cutoff, atau pengaturan fisik yang dipilih.')}</p>
    {error && <p role="alert">{error}</p>}
  </section>;
}

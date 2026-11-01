'use client';

import { useEffect, useState } from 'react';
import { ArrowUpCircle, Check, Copy, X } from 'lucide-react';
import { useLocale } from '@/app/locale-provider';
import type { LocalUpdateStatus } from '@/lib/local-updates';
import './LocalUpdateNotice.css';

const command = 'npm install -g phynite-lab@latest';
const interval = 6 * 60 * 60 * 1000;

export function LocalUpdateNotice({ inert = false }: { inert?: boolean }) {
  const { t } = useLocale();
  const [update, setUpdate] = useState<LocalUpdateStatus | null>(null);
  const [dismissed, setDismissed] = useState('');
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    const abort = new AbortController();
    let nextCheck = 0, checking = false;
    const check = async () => {
      if (checking || Date.now() < nextCheck || document.visibilityState === 'hidden') return;
      checking = true;
      nextCheck = Date.now() + 5 * 60 * 1000;
      try {
        const response = await fetch('/api/local/updates', { cache: 'no-store', signal: abort.signal });
        if (!response.ok) return;
        const result = await response.json() as LocalUpdateStatus;
        if (abort.signal.aborted) return;
        if (result.status === 'current' || result.status === 'available') nextCheck = Date.now() + interval;
        let hidden = '';
        try { hidden = sessionStorage.getItem('phynite:dismissed-update') ?? ''; } catch {}
        setDismissed(hidden);
        setUpdate(result);
      } catch { /* An offline registry never interrupts local work. */ }
      finally { checking = false; }
    };
    void check();
    const timer = window.setInterval(() => void check(), 5 * 60 * 1000);
    window.addEventListener('focus', check);
    window.addEventListener('online', check);
    document.addEventListener('visibilitychange', check);
    return () => { abort.abort(); clearInterval(timer); window.removeEventListener('focus', check); window.removeEventListener('online', check); document.removeEventListener('visibilitychange', check); };
  }, []);
  if (update?.status !== 'available' || !update.latestVersion || dismissed === update.latestVersion) return null;
  return <aside className="local-update-notice" hidden={inert} inert={inert} aria-label={t('Application update', 'Pembaruan aplikasi')}>
    <div className="local-update-heading" role="status"><ArrowUpCircle size={18} /><strong>{t('Phynite Lab update available', 'Pembaruan Phynite Lab tersedia')}</strong></div>
    <button className="local-update-dismiss" type="button" aria-label={t('Remind me next time', 'Ingatkan lain kali')} onClick={() => { setDismissed(update.latestVersion!); try { sessionStorage.setItem('phynite:dismissed-update', update.latestVersion!); } catch {} }}><X size={16} /></button>
    <p>{update.currentVersion} → {update.latestVersion}</p>
    <code>{command}</code>
    <div className="local-update-actions"><a href={`https://github.com/phynite-lab/phynite-lab/releases/tag/v${encodeURIComponent(update.latestVersion)}`} target="_blank" rel="noopener noreferrer">{t('Release notes', 'Catatan rilis')}</a><button className="lab-button" type="button" onClick={async () => { try { await navigator.clipboard.writeText(command); setCopyState('copied'); } catch { setCopyState('failed'); } }}>{copyState === 'copied' ? <Check size={14} /> : <Copy size={14} />}{copyState === 'copied' ? t('Copied', 'Disalin') : t('Copy command', 'Salin perintah')}</button></div>
    <small role="status">{copyState === 'failed' ? t('Select and copy the command above.', 'Pilih dan salin perintah di atas.') : t('Finish or cancel running jobs, then stop the app, update in your terminal and reopen it.', 'Selesaikan atau batalkan job berjalan, lalu tutup aplikasi, update lewat terminal dan buka kembali.')}</small>
  </aside>;
}

'use client';

import { useEffect, useState } from 'react';
import { Check, Copy, ArrowUpRight, Download, Link2 } from 'lucide-react';
import { accountRequest } from '@/lib/account-api';
import { personalComputeCommand, personalComputeLogs } from '@/lib/personal-compute';
import type { PersonalComputePlatform } from '@/lib/personal-compute-installer';
import { useLocale } from '../locale-provider';

function Command({ command, label }: { command: string; label: string }) {
  const { t } = useLocale();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  return <div className="computer-command"><div className="computer-command-heading"><span>{label}</span><button type="button" className="lab-button lab-button-quiet" aria-label={`${t('Copy', 'Salin')} ${label}`} onClick={async () => { try { await navigator.clipboard.writeText(command); setCopied(true); setError(''); } catch { setError(t('Select the command and copy it manually.', 'Pilih perintah lalu salin secara manual.')); } }}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? t('Copied', 'Disalin') : t('Copy', 'Salin')}</button></div><pre className="lab-code"><code>{command}</code></pre>{error && <p role="status">{error}</p>}</div>;
}

export function ComputerSetup({ enabled, available, connected, onApproved }: { enabled: boolean; available: boolean; connected: boolean; onApproved: () => void }) {
  const { t } = useLocale();
  const [apiUrl, setApiUrl] = useState('');
  const [setupError, setSetupError] = useState('');
  const [code, setCode] = useState('');
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [approved, setApproved] = useState(false);
  const [notice, setNotice] = useState('');
  const [platform, setPlatform] = useState<PersonalComputePlatform | 'unsupported' | null>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const agent = navigator.userAgent.toLowerCase();
      const mobile = /android|iphone|ipad|mobile/.test(agent) || (agent.includes('macintosh') && navigator.maxTouchPoints > 1);
      setPlatform(mobile ? 'unsupported' : agent.includes('windows') ? 'windows' : agent.includes('mac') ? 'macos' : 'linux');
      const url = new URL(window.location.href);
      const pairingCode = (url.searchParams.get('pair') || '').replace(/\D/g, '').slice(0, 12);
      if (pairingCode.length === 12) {
        setCode(pairingCode);
        url.searchParams.delete('pair');
        window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    fetch('/api/computer-setup', { signal: abort.signal }).then(async result => {
      if (!result.ok) throw new Error();
      const data = await result.json() as { apiUrl: string };
      setApiUrl(data.apiUrl);
    }).catch(error => { if (error.name !== 'AbortError') setSetupError(t('Setup is unavailable. Reload this page to retry.', 'Setup belum tersedia. Muat ulang halaman untuk mencoba lagi.')); });
    return () => abort.abort();
  }, [t]);
  useEffect(() => {
    if (!approved || connected) return;
    const interval = setInterval(onApproved, 5000);
    const deadline = setTimeout(() => clearInterval(interval), 180_000);
    return () => { clearInterval(interval); clearTimeout(deadline); };
  }, [approved, connected, onApproved]);
  const platformLabels: Record<PersonalComputePlatform, string> = { macos: 'macOS', windows: 'Windows', linux: 'Linux' };
  return <div className="computer-setup">
    <ol className="lab-setup-steps">
      <li className="computer-installer-step"><strong>{t('Install Phynite Compute', 'Instal Phynite Compute')}</strong><p>{t('Download the helper for this computer. It verifies the local engine, prepares the correct scientific runtime, and keeps it running in the background.', 'Unduh aplikasi pendamping untuk komputer ini. Aplikasi akan memeriksa engine lokal, menyiapkan runtime ilmiah yang sesuai, dan menjalankannya di latar belakang.')}</p>
        <div className="computer-installer-actions">
          {platform && platform !== 'unsupported' && available ? <a className="lab-button lab-button-primary computer-installer-download" href={`/api/computer-installer?platform=${platform}`} download><Download size={16} />{t(`Download for ${platformLabels[platform]}`, `Unduh untuk ${platformLabels[platform]}`)}</a> : <span className="lab-button computer-installer-download" aria-disabled="true">{platform === 'unsupported' ? t('Open this page on your computer', 'Buka halaman ini di komputer') : platform ? t('Setup is currently unavailable', 'Setup sedang tidak tersedia') : t('Detecting this computer…', 'Mendeteksi komputer…')}</span>}
          <span>{t('One download · guided setup · automatic pairing', 'Satu unduhan · setup terpandu · pairing otomatis')}</span>
        </div>
        <div className="computer-platform-links"><span>{t('Other systems:', 'Sistem lain:')}</span>{(['macos', 'windows', 'linux'] as PersonalComputePlatform[]).filter(item => item !== platform).map(item => available ? <a key={item} href={`/api/computer-installer?platform=${item}`} download>{platformLabels[item]}</a> : <span key={item}>{platformLabels[item]}</span>)}</div>
        <details className="computer-advanced"><summary>{t('Advanced manual setup', 'Setup manual lanjutan')}</summary><p>{t('Use these commands only for diagnostics or managed installations.', 'Gunakan perintah ini hanya untuk diagnostik atau instalasi terkelola.')}</p>{apiUrl ? <><Command command={personalComputeCommand(apiUrl)} label={t('Start service manually', 'Jalankan layanan secara manual')} /><Command command={personalComputeLogs} label={t('Show service logs', 'Tampilkan log layanan')} /></> : <p role="status">{setupError || t('Loading setup...', 'Memuat setup...')}</p>}</details>
      </li>
      <li><strong>{t('Open and approve this computer', 'Buka dan setujui komputer ini')}</strong><p>{t('Open the downloaded launcher. It returns to this page with a short-lived connection code already filled in. Review it, then approve the computer you control.', 'Buka launcher yang telah diunduh. Launcher akan kembali ke halaman ini dengan kode koneksi sementara yang sudah terisi. Periksa lalu setujui komputer milik Anda.')}</p>
        <form className="computer-pair-form" onSubmit={async event => {
          event.preventDefault(); setBusy(true); setNotice('');
          try {
            await accountRequest('/computer/pairing', 'POST', { code, replace });
            setApproved(true); setCode(''); setReplace(false);
            setNotice(t('Approved. Phynite Compute is preparing the scientific libraries; connection status updates automatically.', 'Disetujui. Phynite Compute sedang menyiapkan pustaka ilmiah; status koneksi diperbarui otomatis.'));
            onApproved();
          } catch (error) { setNotice(error instanceof Error ? error.message : t('Connection failed. Try again.', 'Koneksi gagal. Coba lagi.')); }
          finally { setBusy(false); }
        }}>
          <label className="lab-field" htmlFor="computer-pair-code">{t('Connection code', 'Kode koneksi')}</label>
          <div className="computer-pair-entry"><input id="computer-pair-code" inputMode="numeric" autoComplete="off" placeholder="0000-0000-0000" value={code.match(/.{1,4}/g)?.join('-') || ''} onChange={event => { setCode(event.target.value.replace(/\D/g, '').slice(0, 12)); setApproved(false); setNotice(''); }} required disabled={!available || busy} aria-describedby="computer-pair-notice" /><button className="lab-button lab-button-primary" type="submit" disabled={!available || busy || code.length !== 12 || (enabled && !replace)}><Link2 size={15} />{busy ? t('Connecting...', 'Menghubungkan...') : t('Connect computer', 'Hubungkan komputer')}</button></div>
          {enabled && <label className="computer-replace"><input type="checkbox" checked={replace} onChange={event => setReplace(event.target.checked)} />{t('Replace my existing computer connection. I have finished or canceled its active calculations.', 'Ganti koneksi komputer saya yang lama. Saya sudah menyelesaikan atau membatalkan kalkulasi aktifnya.')}</label>}
          <p id="computer-pair-notice" role="status">{connected && approved ? t('Connected. Your computer is ready for calculations.', 'Terhubung. Komputer Anda siap menjalankan kalkulasi.') : notice}</p>
        </form>
      </li>
      <li><strong>{t('Choose Your computer and calculate', 'Pilih komputer Anda lalu jalankan kalkulasi')}</strong><p>{t('Wait for Connected, open a calculation, and choose Your computer as the destination. Keep Phynite Compute and your internet connection running. Closing the website does not stop a calculation.', 'Tunggu status Terhubung, buka kalkulasi, lalu pilih komputer Anda sebagai tujuan. Pertahankan Phynite Compute dan internet tetap aktif. Menutup website tidak menghentikan kalkulasi.')}</p><a className="lab-text-link" href={t('/guide/local-compute', '/id/guide/local-compute')}>{t('Restart, updates, and troubleshooting', 'Restart, pembaruan, dan pemecahan masalah')}<ArrowUpRight size={14} /></a></li>
    </ol>
  </div>;
}

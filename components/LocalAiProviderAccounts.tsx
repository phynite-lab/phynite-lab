'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, LogIn, RefreshCw, Unplug } from 'lucide-react';
import { useLocale } from '@/app/locale-provider';
import { localRequest } from '@/lib/local-api';
import { SettingsSection } from './SettingsPage';
import { AiProviderLogo } from './AiProviderLogo';

type QuotaWindow = { id?: string; group?: string; label?: string; usedPercent?: number; remainingPercent?: number; windowDurationMins?: number; resetAt?: string | null };
type Quota = { used?: number | null; remaining?: number | null; limit?: number | null; resetAt?: string | null; source?: string; fetchedAt?: string | null; windows?: QuotaWindow[]; credits?: { hasCredits?: boolean; unlimited?: boolean; balance?: string | null } | null };
type ProviderAccount = { id: string; provider: string; label: string; email?: string | null; plan?: string | null; status?: string; active?: boolean; quota?: Quota; homeDir?: string; loginCommand?: string };
type NativeProvider = { id: 'codex' | 'antigravity'; installed: boolean; optedIn: boolean; status: string; checkingModels?: boolean; version?: string | null; toolsVerified?: boolean; activeAccountId?: string; accounts?: ProviderAccount[] };
type UsageReport = { provider: string; accountId?: string; quota?: Quota | null; error?: string };
type NativeStatus = { providers: NativeProvider[]; models: Array<{ id: string; provider: string; name?: string; available?: boolean }>; capabilities?: { models?: Record<string, unknown> }; usage?: UsageReport[] };
function providerName(id: string, t: (en: string, idn: string) => string) { return id === 'codex' ? t('Codex', 'Codex') : t('Antigravity', 'Antigravity'); }
function quotaValue(value: number | null | undefined, unavailable: string): string { return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString() : unavailable; }
function validPercent(value: number | null | undefined): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100; }
function providerLoginUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' || url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return url.href;
  } catch { /* The provider response is untrusted input. */ }
  return null;
}
function resetText(value: string | null | undefined, now: number, t: (en: string, idn: string) => string, intlLocale: string): string {
  if (!value) return t('Reset time unavailable', 'Waktu reset belum tersedia');
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return t('Reset time unavailable', 'Waktu reset belum tersedia');
  const remaining = timestamp - now;
  if (remaining <= 0) return t('Reset reached · awaiting provider update', 'Waktu reset tercapai · menunggu pembaruan provider');
  const minutes = Math.ceil(remaining / 60_000), days = Math.floor(minutes / 1440), hours = Math.floor((minutes % 1440) / 60), rest = minutes % 60;
  const relative = days ? `${days}${t('d', 'h')} ${hours}${t('h', 'j')}` : hours ? `${hours}${t('h', 'j')} ${rest}${t('m', 'm')}` : `${rest}${t('m', 'm')}`;
  return `${t('Resets in', 'Reset dalam')} ${relative} · ${new Date(timestamp).toLocaleString(intlLocale)}`;
}

export function LocalAiProviderAccounts({ view = 'accounts' }: { view?: 'accounts' | 'usage' }) {
  const usageView = view === 'usage';
  const { t, intlLocale } = useLocale();
  const [nativeAi, setNativeAi] = useState<NativeStatus>({ providers: [], models: [] });
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [messageKind, setMessageKind] = useState<'success' | 'info'>('info'), [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [usageReports, setUsageReports] = useState<UsageReport[]>([]), [usageLoading, setUsageLoading] = useState(false);
  const refreshSequence = useRef(0), usageSequence = useRef(0), pendingLogins = useRef(new Set<string>());
  const refresh = useCallback(async ({ usage = false }: { usage?: boolean } = {}) => {
    const sequence = ++refreshSequence.current;
    const statusResult = await Promise.allSettled([localRequest<NativeStatus>('ai/status')]);
    if (sequence !== refreshSequence.current) return;
    if (statusResult[0].status === 'rejected') throw statusResult[0].reason;
    setNativeAi(statusResult[0].value);
    setError('');
    if (!usage) return;
    const usageRequest = ++usageSequence.current;
    setUsageLoading(true);
    try {
      const result = await localRequest<NativeStatus>('ai/usage');
      if (usageRequest !== usageSequence.current) return;
      setUsageReports(result.usage ?? []); setNow(Date.now());
      setNativeAi(current => ({ ...current, providers: current.providers.map(provider => {
        const updated = result.providers.find(item => item.id === provider.id && item.activeAccountId === provider.activeAccountId && item.optedIn === provider.optedIn);
        return updated ? { ...provider, accounts: provider.accounts?.map(account => ({ ...account, ...updated.accounts?.find(item => item.id === account.id), active: account.active })) } : provider;
      }) }));
    } catch (reason) {
      if (usageRequest === usageSequence.current) setError(reason instanceof Error ? reason.message : t('Usage could not be refreshed.', 'Pemakaian belum dapat diperbarui.'));
    } finally { if (usageRequest === usageSequence.current) setUsageLoading(false); }
  }, [t]);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) void refresh({ usage: true }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : t('The local AI bridge is unavailable.', 'Bridge AI lokal tidak tersedia.')); }); });
    return () => { active = false; };
  }, [refresh, t]);
  const polling = nativeAi.providers.some(provider => provider.status === 'login_pending' || provider.checkingModels);
  useEffect(() => {
    if (!polling) return;
    const timer = window.setInterval(() => { void refresh().catch(() => {}); }, 2000);
    return () => window.clearInterval(timer);
  }, [polling, refresh]);
  useEffect(() => {
    for (const provider of nativeAi.providers) {
      if (!pendingLogins.current.has(provider.id)) continue;
      if (provider.optedIn) {
        pendingLogins.current.delete(provider.id);
        queueMicrotask(() => {
          setMessageKind('success');
          setMessage(t(`${providerName(provider.id, t)} login successful. Your account is connected on this computer.`, `Login ${providerName(provider.id, t)} berhasil. Akun Anda sudah terhubung di komputer ini.`));
        });
      } else if (provider.status !== 'login_pending' && provider.status !== 'disconnected') {
        pendingLogins.current.delete(provider.id);
        queueMicrotask(() => {
          setMessageKind('info');
          setMessage(t(`${providerName(provider.id, t)} login needs attention. Follow the official CLI instructions, then try again.`, `Login ${providerName(provider.id, t)} perlu perhatian. Ikuti instruksi CLI resmi, lalu coba lagi.`));
        });
      }
    }
  }, [nativeAi.providers, t]);
  const connectedKey = nativeAi.providers.filter(provider => provider.optedIn).map(provider => `${provider.id}:${provider.activeAccountId ?? ''}`).join('|');
  useEffect(() => {
    if (!connectedKey || polling) return;
    const update = () => { if (document.visibilityState === 'visible') void refresh({ usage: true }).catch(() => {}); };
    queueMicrotask(update);
    const timer = window.setInterval(update, 60_000);
    window.addEventListener('focus', update);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', update); };
  }, [connectedKey, polling, refresh]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!nativeAi.providers.some(provider => provider.optedIn && !provider.checkingModels && nativeAi.models.some(model => {
      const capability = nativeAi.capabilities?.models?.[model.id] as { failureCode?: string } | undefined;
      return model.provider === provider.id && model.available !== true && (!capability?.failureCode || capability.failureCode === 'AUTO_PROBE_PENDING');
    }))) return;
    void localRequest('ai/models', 'POST', {}).then(() => refresh().catch(() => {})).catch(() => {});
  }, [nativeAi, refresh]);
  const action = async (path: string, body: unknown = {}) => {
    // Open the provider window in the click handler's synchronous turn. If we
    // wait for the local bridge response first, Safari and Chromium may treat
    // the later window.open call as an unsolicited popup and silently block
    // the sign-in flow.
    const loginWindow = path === 'login' ? window.open('about:blank', '_blank') : null;
    if (loginWindow) loginWindow.opener = null;
    const provider = typeof body === 'object' && body !== null && 'provider' in body && typeof body.provider === 'string' ? body.provider : '';
    if (path === 'login' && provider) pendingLogins.current.add(provider);
    setBusy(true); setError(''); setMessage(''); setMessageKind('info');
    try {
      const result = await localRequest<Record<string, unknown>>(`ai/${path}`, 'POST', body);
      const loginUrl = providerLoginUrl(typeof result.authUrl === 'string' ? result.authUrl : typeof result.verificationUrl === 'string' ? result.verificationUrl : '');
      if (loginUrl) {
        if (loginWindow && !loginWindow.closed) loginWindow.location.replace(loginUrl);
        else window.open(loginUrl, '_blank', 'noopener,noreferrer');
      } else {
        loginWindow?.close();
        if (path === 'login' && (result.authUrl || result.verificationUrl)) throw new Error(t('The provider returned an unsafe sign-in link.', 'Provider mengembalikan tautan login yang tidak aman.'));
      }
      await refresh({ usage: true });
      if (typeof result.instructions === 'string') setMessage(result.instructions);
      else if (result.status === 'login_pending') setMessage(t('Finish sign-in in the opened official provider flow, then return here. The connected status will appear automatically.', 'Selesaikan login di alur provider resmi yang terbuka, lalu kembali ke sini. Status terhubung akan muncul otomatis.'));
      else if (path === 'login' && result.connected === true) { setMessageKind('success'); setMessage(t(`${providerName(provider, t)} login successful. Your account is connected on this computer.`, `Login ${providerName(provider, t)} berhasil. Akun Anda sudah terhubung di komputer ini.`)); }
      else setMessage(t('Provider connection updated on this computer.', 'Koneksi provider diperbarui di komputer ini.'));
    } catch (reason) { loginWindow?.close(); setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  const refreshUsage = async () => {
    setBusy(true); setError('');
    try { await refresh({ usage: true }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : t('Usage could not be refreshed.', 'Pemakaian belum dapat diperbarui.')); }
    finally { setBusy(false); }
  };
  return <>
    <div className="settings-notice"><span>{t('Use the account already signed in through the official AI CLI. Each provider has one active connection on this computer.', 'Gunakan akun yang sudah login melalui CLI AI resmi. Setiap provider memiliki satu koneksi aktif di komputer ini.')}</span><Link href={usageView ? '/account/ai-providers' : '/account/usage'} className="lab-button">{usageView ? t('Manage connection', 'Kelola koneksi') : t('AI usage', 'Pemakaian AI')}</Link></div>
    {message && <p className="settings-notice local-ai-login-feedback" data-kind={messageKind} role="status"><CheckCircle2 size={16} />{message}</p>}
    {error && <p className="settings-notice" role="alert">{error}</p>}
    <SettingsSection id={usageView ? 'provider-usage' : 'provider-accounts'} title={usageView ? t('AI usage & reset', 'Pemakaian & reset AI') : t('AI provider connections', 'Koneksi provider AI')} description={usageView ? t('Provider-reported limits for the connected account.', 'Batas yang dilaporkan provider untuk akun yang terhubung.') : t('Connect the official CLI account on this computer. Model readiness updates automatically after login.', 'Hubungkan akun CLI resmi di komputer ini. Kesiapan model diperbarui otomatis setelah login.')} actions={<button className="lab-button" type="button" disabled={busy || usageLoading} onClick={() => void refreshUsage()}><RefreshCw size={14} />{usageLoading ? t('Refreshing usage…', 'Memuat pemakaian…') : t('Refresh usage', 'Muat ulang pemakaian')}</button>}>
      {nativeAi.providers.map(provider => {
        const accounts = provider.accounts ?? [], models = nativeAi.models.filter(model => model.provider === provider.id), ready = models.filter(model => model.available === true).length;
        const activeAccount = provider.optedIn ? (accounts.find(item => item.active) ?? accounts[0]) : undefined, quota = activeAccount?.quota, windows = (quota?.windows ?? []).filter(window => validPercent(window.usedPercent));
        const report = usageReports.find(item => item.provider === provider.id && item.accountId === provider.activeAccountId), usageUnavailable = quota?.source !== 'provider';
        const groups = [...new Set(windows.map(window => window.group ?? ''))];
        return <article key={provider.id} className="local-ai-accounts-provider" data-connected={provider.optedIn} data-provider={provider.id}>
          <header className="local-ai-accounts-provider-header"><div className="local-ai-provider-identity"><span className="local-ai-provider-icon" data-provider={provider.id}><AiProviderLogo provider={provider.id} width={21} height={21} /></span><div><h3>{providerName(provider.id, t)}</h3><p>{provider.installed ? `${t('Official CLI', 'CLI resmi')}${provider.version ? ` · ${provider.version}` : ''}` : t('CLI not found on PATH', 'CLI tidak ditemukan di PATH')}</p></div></div><span className="local-ai-provider-status">{provider.status === 'login_pending' ? t('Login pending', 'Login berjalan') : ready > 0 ? <><CheckCircle2 size={14} />{ready} {t('models ready', 'model siap')}</> : provider.checkingModels ? t('Signed in · checking models…', 'Sudah login · memeriksa model…') : provider.optedIn ? t('Signed in · models unavailable', 'Sudah login · model belum tersedia') : t('Not connected', 'Belum terhubung')}</span></header>
          <div className="local-ai-account-list">{activeAccount ? <div className="local-ai-account-row" data-active="true">
            <div><strong>{activeAccount.label}</strong><p>{activeAccount.email || activeAccount.plan || t('Official CLI account', 'Akun CLI resmi')} · {activeAccount.status === 'needs_login' ? t('Needs sign-in', 'Perlu login') : activeAccount.quota?.source === 'provider' ? t('Usage reported by provider', 'Pemakaian dari provider') : t('Usage unavailable from official CLI', 'Pemakaian tidak tersedia dari CLI resmi')}</p></div>
            <span className="lab-tag" data-status={provider.optedIn ? 'connected' : 'pending'}>{provider.optedIn ? t('Connected', 'Terhubung') : t('Needs sign-in', 'Perlu login')}</span>
          </div> : <p className="settings-help">{t('No official CLI account is connected yet.', 'Belum ada akun CLI resmi yang terhubung.')}</p>}</div>
          {!provider.optedIn && <div className="local-ai-provider-login">
            <button className="lab-button lab-button-primary" type="button" disabled={busy} onClick={() => void action('login', { provider: provider.id })}><LogIn size={14} />{provider.installed ? provider.id === 'codex' ? t('Login with Codex', 'Login dengan Codex') : t('Open Antigravity login', 'Buka login Antigravity') : t('Check CLI and sign in', 'Cek CLI dan login')}</button>
            {!provider.installed && <p className="settings-help">{provider.id === 'codex' ? t('Install the official Codex CLI first, then keep `codex` on your PATH.', 'Instal CLI Codex resmi terlebih dahulu, lalu pastikan `codex` ada di PATH.') : t('Install the official Antigravity CLI first, then keep `agy` or `antigravity` on your PATH.', 'Instal CLI Antigravity resmi terlebih dahulu, lalu pastikan `agy` atau `antigravity` ada di PATH.')}</p>}
          </div>}
          {provider.optedIn && <div className="local-ai-account-actions"><button className="lab-button" type="button" disabled={busy || provider.checkingModels} onClick={() => void action('models')}><RefreshCw size={14} />{t('Refresh models', 'Muat ulang model')}</button><button className="lab-button" type="button" disabled={busy} onClick={() => void action('disconnect', { provider: provider.id })}><Unplug size={14} />{t('Disconnect active', 'Putuskan aktif')}</button></div>}
          <section className="local-ai-usage-card" aria-label={t(`${providerName(provider.id, t)} usage`, `Pemakaian ${providerName(provider.id, t)}`)}>
            <header><div><h4>{t('Usage & reset', 'Pemakaian & reset')}</h4><p>{quota?.fetchedAt ? `${t('Reported', 'Dilaporkan')} ${new Date(quota.fetchedAt).toLocaleString(intlLocale)}` : t('Provider-reported limits for the active account.', 'Batas yang dilaporkan provider untuk akun aktif.')}</p></div><span className="local-ai-usage-source">{usageUnavailable ? t('Unavailable', 'Tidak tersedia') : t('Provider report', 'Laporan provider')}</span></header>
            {report?.error && quota?.source === 'provider' && <p role="status">{t('Refresh failed. Showing the last provider report.', 'Pembaruan gagal. Menampilkan laporan provider terakhir.')}</p>}
            {windows.length ? <div className="local-ai-usage-groups">{groups.map(group => <div className="local-ai-usage-group" key={group}>{group && <h5>{group}</h5>}<div className="local-ai-usage-windows">{windows.filter(window => (window.group ?? '') === group).map((window, index) => { const used = window.usedPercent!, label = window.label === 'Session' ? t('Session', 'Sesi') : window.label === 'Weekly' ? t('Weekly', 'Mingguan') : window.label === 'Five Hour' ? t('Five hours', 'Lima jam') : window.label ?? t('Limit window', 'Periode batas'); return <div className="local-ai-usage-window" key={window.id ?? `${window.label ?? 'window'}-${index}`}><div className="local-ai-usage-window-heading"><strong>{label}</strong><span>{used.toLocaleString(intlLocale, { maximumFractionDigits: 1 })}% {t('used', 'terpakai')}</span></div><div className="local-ai-usage-bar" role="progressbar" aria-label={`${group ? `${group} · ` : ''}${label} ${t('used', 'terpakai')}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={used}><span style={{ width: `${used}%` }} /></div><div className="local-ai-usage-window-meta"><span>{validPercent(window.remainingPercent) ? `${window.remainingPercent.toLocaleString(intlLocale, { maximumFractionDigits: 1 })}% ${t('remaining', 'tersisa')}` : t('Remaining unavailable', 'Sisa belum tersedia')}</span><span>{resetText(window.resetAt, now, t, intlLocale)}</span></div></div>; })}</div></div>)}</div> : <div className="local-ai-usage-unavailable"><strong>{usageLoading ? t('Reading provider limits…', 'Membaca batas provider…') : t('No usage report available.', 'Laporan pemakaian belum tersedia.')}</strong><p>{report?.error === 'NOT_REPORTED_BY_CLI' ? t('Update the official CLI to use its read-only usage report.', 'Perbarui CLI resmi untuk memakai laporan pemakaian.') : !provider.optedIn ? t('Connect this provider to request its account limits.', 'Hubungkan provider ini untuk meminta batas akun.') : t('Refresh after signing in again or updating the provider CLI.', 'Muat ulang setelah login kembali atau memperbarui CLI provider.')}</p></div>}
            {quota?.source === 'provider' && !windows.length && <div className="local-ai-quota-grid"><div><span>{t('Remaining', 'Sisa')}</span><strong>{typeof quota.remaining === 'number' ? `${quotaValue(quota.remaining, '')}%` : t('Unavailable', 'Tidak tersedia')}</strong></div><div><span>{t('Limit', 'Batas')}</span><strong>{typeof quota.limit === 'number' ? `${quotaValue(quota.limit, '')}%` : t('Unavailable', 'Tidak tersedia')}</strong></div><div><span>{t('Reset', 'Reset')}</span><strong>{resetText(quota.resetAt, now, t, intlLocale)}</strong></div></div>}
          </section>
        </article>;
      })}
    </SettingsSection>
  </>;
}

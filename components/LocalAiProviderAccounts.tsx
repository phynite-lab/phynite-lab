'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { CheckCircle2, Copy, LogIn, Plus, RefreshCw, Unplug } from 'lucide-react';
import { useLocale } from '@/app/locale-provider';
import { localRequest } from '@/lib/local-api';
import { SettingsRow, SettingsSection } from './SettingsPage';
import { AiProviderLogo } from './AiProviderLogo';

type QuotaWindow = { id?: string; group?: string; label?: string; usedPercent?: number; remainingPercent?: number; windowDurationMins?: number; resetAt?: string | null };
type Quota = { used?: number | null; remaining?: number | null; limit?: number | null; resetAt?: string | null; source?: string; fetchedAt?: string | null; windows?: QuotaWindow[]; credits?: { hasCredits?: boolean; unlimited?: boolean; balance?: string | null } | null };
type ProviderAccount = { id: string; provider: string; label: string; email?: string | null; plan?: string | null; status?: string; active?: boolean; quota?: Quota; homeDir?: string; loginCommand?: string };
type NativeProvider = { id: 'codex' | 'antigravity'; installed: boolean; optedIn: boolean; status: string; checkingModels?: boolean; version?: string | null; toolsVerified?: boolean; activeAccountId?: string; accounts?: ProviderAccount[] };
type UsageReport = { provider: string; accountId?: string; quota?: Quota | null; error?: string };
type NativeStatus = { providers: NativeProvider[]; models: Array<{ id: string; provider: string; name?: string; available?: boolean }>; capabilities?: { models?: Record<string, unknown> }; usage?: UsageReport[] };
type Gateway = { configured?: boolean; hasCredential?: boolean; credentialStorage?: string; connectionStatus?: string; checkedAt?: string | null; baseUrl?: string; models?: Array<{ id: string; available?: boolean }>; connectors?: Array<{ id: string; label?: string; available: boolean; reason?: string }> };

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
  const [gateway, setGateway] = useState<Gateway>({});
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  const [newProvider, setNewProvider] = useState<'codex' | 'antigravity'>('codex'), [newLabel, setNewLabel] = useState('');
  const [gatewayUrl, setGatewayUrl] = useState(''), [gatewayToken, setGatewayToken] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [usageReports, setUsageReports] = useState<UsageReport[]>([]), [usageLoading, setUsageLoading] = useState(false);
  const refreshSequence = useRef(0), usageSequence = useRef(0);
  const refresh = useCallback(async ({ usage = false }: { usage?: boolean } = {}) => {
    const sequence = ++refreshSequence.current;
    const [statusResult, gatewayResult] = await Promise.allSettled([localRequest<NativeStatus>('ai/status'), localRequest<Gateway>('gateway')]);
    if (sequence !== refreshSequence.current) return;
    if (statusResult.status === 'rejected') throw statusResult.reason;
    setNativeAi(statusResult.value);
    if (gatewayResult.status === 'fulfilled') setGateway(gatewayResult.value);
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
    setBusy(true); setError(''); setMessage('');
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
      else if (result.status === 'login_pending') setMessage(t('Finish sign-in in the opened official provider flow, then return here. Models will refresh automatically.', 'Selesaikan login di alur provider resmi yang terbuka, lalu kembali ke sini. Model akan diperbarui otomatis.'));
      else setMessage(t('Provider account updated on this computer.', 'Akun provider diperbarui di komputer ini.'));
    } catch (reason) { loginWindow?.close(); setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  const refreshUsage = async () => {
    setBusy(true); setError('');
    try { await refresh({ usage: true }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : t('Usage could not be refreshed.', 'Pemakaian belum dapat diperbarui.')); }
    finally { setBusy(false); }
  };
  const addAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await action('accounts', { action: 'add', provider: newProvider, label: newLabel });
    setNewLabel('');
  };
  const discoverGateway = async () => {
    const discovered = await localRequest<Gateway>('gateway/discover', 'POST');
    setGateway(discovered);
    const first = discovered.models?.[0];
    if (!first) return;
    setMessage(t('Gateway connected. Checking model compatibility…', 'Gateway terhubung. Memeriksa kompatibilitas model…'));
    const checked = await localRequest<Gateway>('gateway/probe', 'POST', { modelId: first.id });
    setGateway(checked);
    if (!checked.models?.some(model => model.available)) throw new Error(t('The gateway responded, but its model did not pass the text and tool checks. Choose another model below or check the gateway protocol.', 'Gateway merespons, tetapi model belum lolos pemeriksaan teks dan tools. Pilih model lain di bawah atau periksa protokol gateway.'));
  };
  const saveGateway = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      await localRequest('gateway', 'PUT', { baseUrl: gatewayUrl || gateway.baseUrl || '', ...(gatewayToken || !gateway.hasCredential ? { token: gatewayToken } : {}) });
      setGatewayToken('');
      await discoverGateway();
      setMessage(t('Gateway connected. The model is ready.', 'Gateway terhubung. Model siap digunakan.'));
      await refresh();
    } catch (reason) { setMessage(''); await refresh().catch(() => {}); setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  const gatewayAction = async (path: string, method: 'POST' | 'DELETE' = 'POST', payload?: { modelId: string }) => {
    setBusy(true); setError(''); setMessage('');
    try { if (path === 'gateway/discover') await discoverGateway(); else await localRequest(path, method, payload); await refresh(); setMessage(t('Gateway settings updated.', 'Pengaturan gateway diperbarui.')); }
    catch (reason) { setMessage(''); await refresh().catch(() => {}); setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  const copy = async (value: string) => { try { await navigator.clipboard.writeText(value); setMessage(t('Command copied. Run it in a terminal, then refresh this page.', 'Perintah disalin. Jalankan di terminal, lalu muat ulang halaman ini.')); } catch { setError(t('Clipboard unavailable. Allow clipboard access and retry.', 'Clipboard tidak tersedia. Izinkan akses clipboard lalu coba lagi.')); } };
  return <>
    <div className="settings-notice"><span>{t('Use your own AI subscriptions. These accounts are separate from Phynite Cloud.', 'Gunakan langganan AI Anda sendiri. Akun ini terpisah dari Phynite Cloud.')}</span><Link href={usageView ? '/account/ai-providers' : '/account/usage'} className="lab-button">{usageView ? t('Manage accounts', 'Kelola akun') : t('AI usage', 'Pemakaian AI')}</Link></div>
    {message && <p className="settings-notice" role="status">{message}</p>}
    {error && <p className="settings-notice" role="alert">{error}</p>}
    <SettingsSection id={usageView ? 'provider-usage' : 'provider-accounts'} title={usageView ? t('AI usage & reset', 'Pemakaian & reset AI') : t('Provider accounts & limits', 'Akun provider & batas pemakaian')} description={usageView ? t('Provider-reported limits for the active account.', 'Batas yang dilaporkan provider untuk akun aktif.') : t('Switch accounts here. Subscription limits are reported as percentages, not token balances.', 'Ganti akun di sini. Batas langganan dilaporkan dalam persentase, bukan saldo token.')} actions={<button className="lab-button" type="button" disabled={busy || usageLoading} onClick={() => void refreshUsage()}><RefreshCw size={14} />{usageLoading ? t('Refreshing usage…', 'Memuat pemakaian…') : t('Refresh usage', 'Muat ulang pemakaian')}</button>}>
      {nativeAi.providers.map(provider => {
        const accounts = provider.accounts ?? [], models = nativeAi.models.filter(model => model.provider === provider.id), ready = models.filter(model => model.available === true).length;
        const activeAccount = accounts.find(item => item.active), quota = activeAccount?.quota, windows = (quota?.windows ?? []).filter(window => validPercent(window.usedPercent));
        const report = usageReports.find(item => item.provider === provider.id && item.accountId === provider.activeAccountId), usageUnavailable = quota?.source !== 'provider';
        const groups = [...new Set(windows.map(window => window.group ?? ''))];
        return <article key={provider.id} className="local-ai-accounts-provider" data-connected={provider.optedIn} data-provider={provider.id}>
          <header className="local-ai-accounts-provider-header"><div className="local-ai-provider-identity"><span className="local-ai-provider-icon" data-provider={provider.id}><AiProviderLogo provider={provider.id} width={21} height={21} /></span><div><h3>{providerName(provider.id, t)}</h3><p>{provider.installed ? `${t('Official CLI', 'CLI resmi')}${provider.version ? ` · ${provider.version}` : ''}` : t('CLI not found on PATH', 'CLI tidak ditemukan di PATH')}</p></div></div><span className="local-ai-provider-status">{provider.status === 'login_pending' ? t('Login pending', 'Login berjalan') : ready > 0 ? <><CheckCircle2 size={14} />{ready} {t('models ready', 'model siap')}</> : provider.checkingModels ? t('Signed in · checking models…', 'Sudah login · memeriksa model…') : provider.optedIn ? t('Signed in · models unavailable', 'Sudah login · model belum tersedia') : t('Not connected', 'Belum terhubung')}</span></header>
          <div className="local-ai-account-list">{accounts.map(account => <div className="local-ai-account-row" key={account.id} data-active={account.active}>
            <div><strong>{account.label}</strong><p>{account.email || account.plan || t('CLI-managed account', 'Akun dikelola CLI')} · {account.status === 'needs_login' ? t('Needs sign-in', 'Perlu login') : account.quota?.source === 'provider' ? t('Usage reported by provider', 'Pemakaian dari provider') : t('Usage unavailable from official CLI', 'Pemakaian tidak tersedia dari CLI resmi')}</p></div>
            <div className="local-ai-account-actions">{account.active ? <span className="lab-tag" data-status="connected">{t('Active', 'Aktif')}</span> : <button className="lab-button" type="button" disabled={busy} onClick={() => void action('accounts', { action: 'switch', provider: provider.id, accountId: account.id })}>{t('Switch', 'Ganti')}</button>}</div>
          </div>)}</div>
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
    {!usageView && <SettingsSection title={t('Add provider account', 'Tambah akun provider')} description={t('Each slot gets its own CLI-owned profile directory. Sign in there manually, then switch back to this page.', 'Setiap slot memiliki direktori profile milik CLI sendiri. Login secara manual di sana, lalu kembali ke halaman ini.')}>
      <form className="local-ai-add-account" onSubmit={addAccount}><label>{t('Provider', 'Provider')}<select value={newProvider} onChange={event => setNewProvider(event.target.value as 'codex' | 'antigravity')}><option value="codex">Codex</option><option value="antigravity">Antigravity</option></select></label><label>{t('Account label', 'Nama akun')}<input value={newLabel} onChange={event => setNewLabel(event.target.value)} placeholder={t('e.g. Work or Personal', 'mis. Kerja atau Personal')} maxLength={64} /></label><button className="lab-button lab-button-primary" type="submit" disabled={busy}><Plus size={14} />{t('Create account slot', 'Buat slot akun')}</button></form>
      {nativeAi.providers.flatMap(provider => (provider.accounts ?? []).filter(account => account.status === 'needs_login' && account.homeDir).map(account => <SettingsRow key={account.id} title={account.label} description={t('Needs official CLI sign-in before it can be activated.', 'Perlu login CLI resmi sebelum dapat diaktifkan.')}><button className="lab-button" type="button" disabled={!account.loginCommand} onClick={() => void copy(account.loginCommand!)}><Copy size={14} />{t('Copy login command', 'Salin perintah login')}</button></SettingsRow>))}
    </SettingsSection>}
    {!usageView && <SettingsSection title={t('Local gateway', 'Gateway lokal')} description={t('Use 9Router or another loopback gateway when you want a provider outside the official CLIs. Credentials stay in the local vault.', 'Gunakan 9Router atau gateway loopback lain untuk provider di luar CLI resmi. Kredensial tetap berada di vault lokal.')}>
      <form className="local-ai-gateway-form" onSubmit={saveGateway}><label>{t('Gateway URL', 'URL gateway')}<input type="url" required value={gatewayUrl || gateway.baseUrl || ''} onChange={event => setGatewayUrl(event.target.value)} placeholder="http://127.0.0.1:20128" /></label><label>{t('Gateway token (if required)', 'Token gateway (jika diperlukan)')}<input type="password" autoComplete="off" value={gatewayToken} onChange={event => setGatewayToken(event.target.value)} /></label><button className="lab-button lab-button-primary" disabled={busy}>{t('Save gateway', 'Simpan gateway')}</button></form>
      <SettingsRow title={t('Gateway status', 'Status gateway')} description={gateway.baseUrl || t('No gateway connected.', 'Belum ada gateway terhubung.')}><div className="local-ai-account-actions"><span className="lab-tag" data-status={gateway.connectionStatus === 'connected' ? 'connected' : 'pending'}>{gateway.connectionStatus === 'connected' ? t('Connected', 'Terhubung') : gateway.connectionStatus === 'auth_required' ? t('Authentication failed', 'Autentikasi gagal') : gateway.connectionStatus === 'unavailable' ? t('Unavailable', 'Tidak tersedia') : gateway.configured ? t('Saved · not checked', 'Tersimpan · belum dicek') : t('Not configured', 'Belum dikonfigurasi')}</span><button className="lab-button" type="button" disabled={busy || !gateway.configured} onClick={() => void gatewayAction('gateway/discover')}>{t('Discover models', 'Cari model')}</button>{gateway.configured && <button className="lab-button" type="button" disabled={busy} onClick={() => void gatewayAction('gateway', 'DELETE')}>{t('Disconnect', 'Putuskan')}</button>}</div></SettingsRow>
      {gateway.models?.map(model => <SettingsRow key={model.id} title={model.id} description={model.available ? t('Ready', 'Siap') : t('Not connected', 'Belum terhubung')}>{!model.available && <button className="lab-button" type="button" disabled={busy} onClick={() => void gatewayAction('gateway/probe', 'POST', { modelId: model.id })}>{t('Connect model', 'Hubungkan model')}</button>}</SettingsRow>)}
      {gateway.connectors?.filter(connector => connector.id !== '9router').map(connector => <div className="settings-row" key={connector.id}><div><strong>{connector.label || connector.id}</strong><p>{connector.available ? t('Available', 'Tersedia') : connector.reason || t('Not available', 'Belum tersedia')}</p></div></div>)}
    </SettingsSection>}
  </>;
}

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowDownToLine, LogOut, RefreshCw } from 'lucide-react';
import { WorkspaceLoading } from '@/components/WorkspaceLoading';
import { SettingsPage, SettingsRow, SettingsSection } from '@/components/SettingsPage';
import { NotificationPreferencesPanel } from '@/components/NotificationPreferencesPanel';
import { hasUserProfile, signOut } from '../auth-client';
import { useAccountSettings } from '../use-account-settings';
import { confirmUnsavedSettings } from '../use-unsaved-settings';
import { useSession } from '../use-session';
import { useLabAccount } from '../use-lab-account';
import { useAccountUsage } from '../use-account-usage';
import { useAccountComputeUsage } from '../use-account-compute-usage';
import { useSettingsAnchor } from '../use-settings-anchor';
import { useLocale } from '../locale-provider';
import { accountLinks, legacyAccountDestination, type AccountSection } from '../account-navigation';
import { accountRequest, type AccountResponse } from '@/lib/account-api';
import { ANALYTICS_PREFERENCES_EVENT } from '@/lib/analytics-client';
import { ComputerSetup } from './computer-setup';
import { RecentCalculations } from './recent-calculations';
import { AppearanceForm, ProfileForm, SignInForm } from './profile-forms';
import { ComputeDefaults } from './compute-defaults';
import { ComputeMetrics, LocalStorageUsage, StorageUsage } from './resource-views';
import { LocalAiProviderAccounts } from '@/components/LocalAiProviderAccounts';
import { LocalSettings } from '../local/settings';
import { LocalNotificationPreferences } from '@/components/LocalNotificationPreferences';
import { KeyboardPreferencesPanel } from '@/components/KeyboardPreferencesPanel';
import { MaterialsProjectSettings } from '@/components/MaterialsProjectSettings';

export function AccountExperience({ section = 'profile' }: { section?: AccountSection }) {
  const { session, ready } = useSession();
  const { settings } = useAccountSettings(session?.user.email ?? 'researcher', session?.user.id);
  const { account, profile, setAccount, setProfile, loading, error, refresh } = useLabAccount(session?.user.id);
  const { t, intlLocale } = useLocale();
  const inventory = useAccountUsage(session?.user.id, section === 'storage');
  const compute = useAccountComputeUsage(session?.user.id, section === 'usage');
  const measurement = section === 'usage' ? compute : inventory;
  const profileAvailable = hasUserProfile(session);
  const [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [confirmation, setConfirmation] = useState(false);
  const [signOutBusy, setSignOutBusy] = useState(false), [signOutError, setSignOutError] = useState('');
  useSettingsAnchor(Boolean(ready && session && (account || section !== 'profile')));
  useEffect(() => {
    if (section !== 'profile') return;
    const legacy = window.location.hash.slice(1), alias = legacyAccountDestination(legacy);
    const target = alias ? alias.pathname + alias.hash : accountLinks.find(item => item.id === legacy)?.href;
    if (target && target !== '/account') window.location.replace(target);
  }, [section]);
  useEffect(() => {
    if (ready && session && section === 'profile' && !profileAvailable) window.location.replace('/account/appearance');
  }, [profileAvailable, ready, section, session]);
  const revoke = async () => {
    setBusy(true); setConfirmation(false);
    try { setAccount((await accountRequest<AccountResponse>('/computer', 'DELETE')).account); setNotice(t('Computer disconnected. Its old credential no longer works.', 'Komputer diputus. Kredensial lamanya tidak berlaku lagi.')); }
    catch (failure) { setNotice(failure instanceof Error ? failure.message : t('Computer could not be disconnected.', 'Komputer belum dapat diputus.')); }
    finally { setBusy(false); }
  };
  const logout = async () => {
    if (!confirmUnsavedSettings()) return;
    setSignOutBusy(true); setSignOutError('');
    try { await signOut(); window.location.assign('/login'); }
    catch { setSignOutError(t('Could not log out. Try again.', 'Belum dapat keluar. Coba lagi.')); setSignOutBusy(false); }
  };
  const downloadUsage = () => {
    if (!compute.usage) return;
    const document = { reportType: 'usage-record-not-an-invoice', generatedAt: new Date().toISOString(), usage: compute.usage };
    const url = URL.createObjectURL(new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' }));
    const anchor = window.document.createElement('a'); anchor.href = url; anchor.download = `phynite-usage-${compute.usage.measuredAt.slice(0, 10)}.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  if (!ready || !session) return <WorkspaceLoading layout="page" label={t('Opening settings…', 'Membuka pengaturan…')} />;
  const sectionLink = accountLinks.find(item => item.id === section) ?? accountLinks[0];
  const descriptions: Record<AccountSection, [string, string]> = {
    profile: ['Your research identity and sign-in details.', 'Identitas riset dan informasi login Anda.'],
    compute: ['Set defaults for new jobs and connect your research hardware.', 'Atur default untuk job baru dan hubungkan perangkat riset Anda.'],
    'ai-providers': ['Manage local provider accounts, active models, and verified usage information.', 'Kelola akun provider lokal, model aktif, dan informasi pemakaian yang terverifikasi.'],
    usage: ['Review recorded run time, allocated CPU-hours, and job charges.', 'Periksa waktu run tercatat, jam CPU teralokasi, dan biaya job.'],
    storage: ['Track research files, capacity, and pending uploads.', 'Pantau file riset, kapasitas, dan upload tertunda.'],
    appearance: ['Customize this browser. Appearance and language stay on this device.', 'Sesuaikan browser ini. Tampilan dan bahasa hanya disimpan di perangkat ini.'],
    notifications: ['Choose which research updates you receive.', 'Pilih pembaruan riset yang Anda terima.'],
    keyboard: ['Customize shortcuts on this device. Changes stay in this browser.', 'Sesuaikan pintasan di perangkat ini. Perubahan hanya tersimpan di browser ini.'],
    account: ['Manage the optional Phynite Cloud account connected to this workspace.', 'Kelola akun Phynite Cloud opsional yang terhubung ke workspace ini.'],
    privacy: ['Manage browser privacy and your current sign-in session.', 'Kelola privasi browser dan sesi login Anda saat ini.'],
  };
  const isUsage = section === 'usage' || section === 'storage';
  if (section === 'profile' && !profileAvailable) return <WorkspaceLoading layout="page" label={t('Opening local settings…', 'Membuka pengaturan lokal…')} />;
  return <SettingsPage className={section === 'appearance' ? 'settings-page--appearance' : undefined} session={session} title={t(sectionLink.en, sectionLink.idn)} description={t(...descriptions[section])} actions={section === 'profile' ? <Link className="lab-button" href="/profile">{t('View profile', 'Lihat profil')}</Link> : undefined}>
    {notice && <div className="settings-notice" role="status"><span>{notice}</span><button type="button" aria-label={t('Dismiss notification', 'Tutup pemberitahuan')} onClick={() => setNotice('')}>{t('Dismiss', 'Tutup')}</button></div>}
    {error && (section === 'profile' || session.mode !== 'local' && section === 'compute') && <div className="settings-notice" role="alert"><span>{error}</span><button type="button" onClick={() => void refresh().catch(() => undefined)}>{t('Retry account', 'Muat ulang akun')}</button></div>}
    {section === 'profile' && (account ? <><ProfileForm key={session.user.id} settings={profile ?? settings} exists={Boolean(profile)} localMode={session.mode === 'local'} onSaved={setProfile} onNotice={setNotice} />{session.mode === 'local' ? <SettingsSection title="Phynite Cloud" description={t('Your local identity stays on this computer. Manage your optional cloud account separately.', 'Identitas lokal tetap di komputer ini. Kelola akun cloud opsional secara terpisah.')}><SettingsRow title={session.cloud?.account ?? t('Cloud account', 'Akun cloud')}><Link className="lab-button" href="/account/account#cloud">{t('Manage cloud connection', 'Kelola koneksi cloud')}</Link></SettingsRow></SettingsSection> : <SignInForm key={`login:${session.user.id}`} email={session.user.email} username={account.username ?? ''} onSaved={setAccount} />}</> : !error && <WorkspaceLoading label={t('Loading profile…', 'Memuat profil…')} />)}
    {section === 'appearance' && <AppearanceForm />}
    {section === 'ai-providers' && session.mode === 'local' && <LocalAiProviderAccounts />}
    {section === 'notifications' && (session.mode === 'local' ? <LocalNotificationPreferences /> : <div id="notifications" tabIndex={-1} className="settings-panel-adapter settings-notifications"><NotificationPreferencesPanel /></div>)}
    {section === 'keyboard' && <KeyboardPreferencesPanel />}
    {section === 'account' && <>{session.mode === 'local' && <LocalSettings section="account" />}<AccountOverview session={session} cloudAccount={session.cloud?.account} /></>}
    {isUsage && <div className="settings-section-tools"><span>{measurement.usage ? `${t('Measured', 'Diukur')} ${new Date(measurement.usage.measuredAt).toLocaleString(intlLocale)}${measurement.stale ? ` · ${t('May have changed', 'Mungkin telah berubah')}` : ''}` : t('Account-wide records', 'Catatan seluruh akun')}</span><div className="lab-actions">{section === 'usage' && <button type="button" className="lab-button" onClick={downloadUsage} disabled={!compute.usage}><ArrowDownToLine size={14} />{t('Export usage', 'Ekspor pemakaian')}</button>}<button type="button" className="lab-button" disabled={measurement.loading} onClick={() => void measurement.refresh().catch(() => undefined)}><RefreshCw size={14} />{measurement.loading ? t('Measuring…', 'Mengukur…') : t('Refresh', 'Perbarui')}</button></div></div>}
    {isUsage && measurement.error && <p className="settings-notice" role="alert">{measurement.usage ? t('Refresh failed. The last successful measurement remains visible.', 'Pembaruan gagal. Pengukuran terakhir masih ditampilkan.') : measurement.error}</p>}
    {isUsage && !measurement.usage && !measurement.error && <WorkspaceLoading label={t('Measuring usage…', 'Mengukur pemakaian…')} />}
    {section === 'storage' && session.mode === 'local' && <>{inventory.usage && <LocalStorageUsage usage={inventory.usage} />}<LocalSettings section="storage" /></>}
    {section === 'storage' && session.mode !== 'local' && inventory.usage && <StorageUsage usage={inventory.usage} currentQuota={account?.limits.researchBytes} />}
    {section === 'usage' && session.mode === 'local' && <LocalAiProviderAccounts view="usage" />}
    {section === 'usage' && compute.usage && <>
      <SettingsSection id="recorded-compute" title={t('Recorded compute', 'Compute tercatat')} description={t('Measured history across your research account.', 'Riwayat terukur pada seluruh akun riset Anda.')} actions={<Link className="lab-button" href="/account/compute">{t('Compute settings', 'Pengaturan compute')}</Link>}><div className="settings-group-content"><ComputeMetrics usage={compute.usage} /></div></SettingsSection>
      <SettingsSection id="job-receipts" title={t('Jobs & receipts', 'Job & rincian biaya')} description={t('Recorded resources stay with each job, even after defaults change.', 'Resource tercatat tetap melekat pada setiap job, meskipun default berubah.')} actions={session.mode !== 'local' ? <Link className="lab-button" href="/billing">{t('Quanta & payments', 'Quanta & pembayaran')}</Link> : undefined}><RecentCalculations measuredAt={compute.usage.measuredAt} /></SettingsSection>
    </>}
    {section === 'compute' && session.mode === 'local' && <><LocalSettings section="compute" /><MaterialsProjectSettings /></>}
    {section === 'compute' && session.mode !== 'local' && <>
      {account ? <ComputeDefaults key={session.user.id} account={account} onSaved={setAccount} onNotice={setNotice} /> : !error && <WorkspaceLoading label={t('Loading compute…', 'Memuat compute…')} />}
      <SettingsSection id="your-computer" title={t('Your computer', 'Komputer Anda')} description={t('Connect your worker to run simulations on your own hardware.', 'Hubungkan worker untuk menjalankan simulasi pada perangkat Anda.')} actions={<span className="lab-tag" data-status={account?.computer.status}>{!account ? t('Loading', 'Memuat') : account.computer.status === 'connected' ? t('Connected', 'Terhubung') : account.computer.status === 'offline' ? 'Offline' : t('Not connected', 'Belum terhubung')}</span>}><div className="settings-group-content">
            <ComputerSetup enabled={Boolean(account?.computer.enabled)} available={Boolean(account?.localComputeAvailable)} connected={account?.computer.status === 'connected'} onApproved={refresh} />
            <div className="lab-actions"><button type="button" className="lab-button" disabled={loading} onClick={() => void refresh()}><RefreshCw size={14} />{t('Refresh connection', 'Perbarui koneksi')}</button></div>
            {account?.computer.lastSeenAt && <p className="lab-caption">{t('Last seen', 'Terakhir terlihat')} {new Date(account.computer.lastSeenAt).toLocaleString(intlLocale)}.</p>}
            {account?.computer.enabled && <div className="lab-computer-footer"><p>{t('Disconnecting revokes this worker credential. Queued jobs remain in your account.', 'Memutus koneksi mencabut kredensial worker ini. Job dalam antrean tetap ada di akun Anda.')}</p><button type="button" className="lab-button lab-button-danger" disabled={busy} onClick={() => setConfirmation(true)}>{t('Disconnect computer', 'Putuskan komputer')}</button></div>}
            {confirmation && <div className="lab-confirmation" role="alertdialog" aria-modal="false" aria-labelledby="computer-confirm-title"><h3 id="computer-confirm-title">{t('Disconnect this computer?', 'Putuskan komputer ini?')}</h3><p>{t('Finish or cancel active jobs first. Your saved projects and results remain in your account.', 'Selesaikan atau batalkan job aktif terlebih dahulu. Project dan hasil tersimpan tetap ada di akun Anda.')}</p><div className="lab-actions"><button autoFocus type="button" className="lab-button" onClick={() => setConfirmation(false)}>{t('Keep connection', 'Pertahankan koneksi')}</button><button type="button" className="lab-button lab-button-danger" onClick={() => void revoke()}>{t('Disconnect', 'Putuskan')}</button></div></div>}      </div></SettingsSection>
    </>}
    {section === 'privacy' && <>
      {session.mode === 'local' ? <SettingsSection id="privacy" title={t('Local privacy', 'Privasi lokal')} description={t('Analytics are disabled in the local application. Cloud and AI connections are optional and configured separately.', 'Analytics dinonaktifkan pada aplikasi lokal. Koneksi cloud dan AI bersifat opsional dan dikonfigurasi terpisah.')}><SettingsRow title="Analytics"><span>{t('Disabled', 'Dinonaktifkan')}</span></SettingsRow></SettingsSection> : <SettingsSection id="privacy" title={t('Browser privacy', 'Privasi browser')} description={t('These choices apply immediately to this browser, including the workspace.', 'Pilihan ini langsung berlaku pada browser ini, termasuk workspace.')}><SettingsRow title={t('Cookies & analytics', 'Cookie & analytics')} description={t('Review or change your consent.', 'Periksa atau ubah persetujuan Anda.')}><button type="button" className="lab-button" data-cookie-preferences onClick={() => window.dispatchEvent(new Event(ANALYTICS_PREFERENCES_EVENT))}>{t('Manage preferences', 'Kelola preferensi')}</button></SettingsRow></SettingsSection>}
      {session.mode === 'local' ? <SettingsSection id="current-session" title={t('Local workspace', 'Workspace lokal')} description={t('This workspace is available without a Phynite Cloud account. Cloud sign-in and sign-out are managed separately.', 'Workspace ini tersedia tanpa akun Phynite Cloud. Login dan logout cloud dikelola terpisah.')}><SettingsRow title={t('Local runtime & connections', 'Runtime lokal & koneksi')} description={t('Your local projects stay on this computer. Connect or disconnect Phynite Cloud from the local settings page.', 'Project lokal tetap di komputer ini. Hubungkan atau putuskan Phynite Cloud dari halaman pengaturan lokal.')}><Link className="lab-button" href="/account/account">{t('Open local settings', 'Buka pengaturan lokal')}</Link></SettingsRow></SettingsSection> : <SettingsSection id="current-session" title={t('Current session', 'Sesi saat ini')} description={`${t('Signed in as', 'Masuk sebagai')} ${session.user.email}`}><SettingsRow title={t('Sign out of this browser', 'Keluar dari browser ini')} description={t('Saved projects and completed results remain in your account.', 'Project tersimpan dan hasil yang selesai tetap ada di akun Anda.')}><button type="button" className="lab-button" disabled={signOutBusy} onClick={() => void logout()}><LogOut size={14} />{signOutBusy ? t('Signing out…', 'Keluar…') : t('Sign out', 'Keluar')}</button></SettingsRow></SettingsSection>}
      {signOutError && session.mode !== 'local' && <p className="settings-notice" role="alert">{signOutError}</p>}
    </>}
  </SettingsPage>;
}

function AccountOverview({ session, cloudAccount }: { session: NonNullable<ReturnType<typeof useSession>['session']>; cloudAccount?: string }) {
  const { t } = useLocale();
  const local = session.mode === 'local';
  return <>
    <SettingsSection id="account-identity" title={t('Phynite account', 'Akun Phynite')} description={local ? t('The local workspace identity is independent from an optional Phynite Cloud login.', 'Identitas workspace lokal terpisah dari login Phynite Cloud yang bersifat opsional.') : t('Your signed-in Phynite Cloud account and workspace access.', 'Akun Phynite Cloud yang sedang masuk dan akses workspace Anda.')}>
      <SettingsRow title={local ? t('Cloud connection', 'Koneksi cloud') : t('Signed-in account', 'Akun yang sedang masuk')} description={local ? (cloudAccount ? t(`Connected as ${cloudAccount}. Local projects remain local until Cloud Sync is enabled per project.`, `Terhubung sebagai ${cloudAccount}. Project lokal tetap lokal sampai Cloud Sync diaktifkan per project.`) : t('No Phynite Cloud account is connected. You can still use local projects and compute.', 'Belum ada akun Phynite Cloud yang terhubung. Project dan compute lokal tetap dapat digunakan.')) : session.user.email}>
        {local ? <Link className="lab-button" href="/account/account#cloud">{cloudAccount ? t('Manage connection', 'Kelola koneksi') : t('Connect Cloud', 'Hubungkan Cloud')}</Link> : <Link className="lab-button" href="/account/privacy#current-session">{t('Security & session', 'Keamanan & sesi')}</Link>}
      </SettingsRow>
    </SettingsSection>
    <SettingsSection id="account-billing" title={t('Billing', 'Tagihan')} description={t('Payments, plans, and cloud storage purchases are managed on the Phynite web app.', 'Pembayaran, paket, dan pembelian storage cloud dikelola di aplikasi web Phynite.')}>
      <SettingsRow title={t('Open web billing', 'Buka billing web')} description={t('The local app never stores payment credentials or initiates a payment.', 'Aplikasi lokal tidak menyimpan kredensial pembayaran atau memulai pembayaran.')}><a className="lab-button" href={local ? 'https://phynitelab.com/billing' : '/billing'} target="_blank" rel="noreferrer">{t('Open billing', 'Buka billing')}</a></SettingsRow>
    </SettingsSection>
  </>;
}

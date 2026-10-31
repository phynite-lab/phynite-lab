'use client';

import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import { useEffect } from 'react';
import { hasUserProfile } from '../auth-client';
import { useSession } from '../use-session';
import { useLocale } from '../locale-provider';
import { useAccountSettings } from '../use-account-settings';
import { useLabAccount } from '../use-lab-account';
import { useAccountComputeUsage } from '../use-account-compute-usage';
import { SettingsPage, SettingsSection } from '@/components/SettingsPage';
import { ProfileAvatar } from '@/components/AccountMenu';
import { WorkspaceLoading } from '@/components/WorkspaceLoading';
import { ComputeMetrics, ProfileRecentRuns } from '../account/resource-views';

export function ProfileExperience() {
  const { session, ready } = useSession();
  const { t, intlLocale } = useLocale();
  const { settings } = useAccountSettings(session?.user.email ?? 'researcher', session?.user.id);
  const { profile } = useLabAccount(session?.user.id);
  const stats = useAccountComputeUsage(session?.user.id);
  const identity = profile ?? settings;
  const profileAvailable = hasUserProfile(session);
  useEffect(() => {
    if (ready && session && !profileAvailable) window.location.replace('/local');
  }, [profileAvailable, ready, session]);
  if (!ready || !session || !profileAvailable) return <WorkspaceLoading layout="page" label={t('Opening local settings…', 'Membuka pengaturan lokal…')} />;
  return <SettingsPage session={session} eyebrow={t('Your account', 'Akun Anda')} title={t('Research profile', 'Profil riset')} description={t('Your identity and recorded research, visible only to you.', 'Identitas dan riset tercatat Anda, hanya terlihat oleh Anda.')} actions={<Link className="lab-button" href="/account">{t('Edit profile', 'Edit profil')}</Link>}>
    <section className="settings-profile-identity" aria-label={t('Research identity', 'Identitas riset')}><ProfileAvatar large photo={identity.avatarDataUrl} name={identity.displayName} /><div><h2>{identity.displayName}</h2><p>{session.user.email}</p>{identity.institution && <p>{identity.institution}</p>}<span>{identity.role}{identity.researchArea && ` · ${identity.researchArea}`}</span></div></section>
    <SettingsSection title={t('Research records', 'Catatan riset')} description={stats.usage ? `${t('Measured', 'Diukur')} ${new Date(stats.usage.measuredAt).toLocaleString(intlLocale)}${stats.stale ? ` · ${t('May have changed', 'Mungkin telah berubah')}` : ''}` : t('Account-wide compute records. Storage is measured separately.', 'Catatan compute seluruh akun. Storage diukur terpisah.')} actions={<button type="button" className="lab-button" disabled={stats.loading} onClick={() => void stats.refresh().catch(() => undefined)}><RefreshCw size={14} />{t('Refresh', 'Perbarui')}</button>}>
      <div className="settings-group-content">{stats.error && <p className="settings-notice" role="alert">{stats.usage ? t('Refresh failed. The last successful measurement remains visible.', 'Pembaruan gagal. Pengukuran terakhir masih ditampilkan.') : t('Research statistics could not be loaded. Your profile is still available.', 'Statistik riset belum dapat dimuat. Profil Anda tetap tersedia.')}</p>}{stats.usage ? <ComputeMetrics usage={stats.usage} profile /> : !stats.error && <WorkspaceLoading label={t('Loading research records…', 'Memuat catatan riset…')} />}</div>
    </SettingsSection>
    {stats.usage && <ProfileRecentRuns usage={stats.usage} />}
  </SettingsPage>;
}

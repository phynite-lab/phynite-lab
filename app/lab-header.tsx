'use client';

import { BookOpen, CreditCard, LayoutDashboard, Moon, Sun } from 'lucide-react';
import Link from 'next/link';
import type { PhyniteSession } from './auth-client';
import { useSiteTheme } from './use-site-theme';
import { WorkspaceIdentity, type WorkspaceSaveState } from '@/components/WorkspaceIdentity';
import { AccountMenu, ProfileAvatar } from '@/components/AccountMenu';
import { useLocale } from './locale-provider';
import { StudioNavigationToggle } from './studio-navigation';
import { useResearchShell } from '@/components/ResearchShellContext';

export { AccountMenu, ProfileAvatar };

export function StudioMobileHeader({ session, admin = false }: { session: PhyniteSession; admin?: boolean }) {
  const shell = useResearchShell();
  if (shell) return null;
  return <header className="studio-mobile-header"><StudioNavigationToggle />{admin ? <Link className="studio-mobile-admin-brand" href="/developer/overview">Phynite Admin</Link> : <WorkspaceIdentity state="idle" label="Workspace" hideSave />}<AccountMenu session={session} /></header>;
}

export function LabHeader({ section, session, saveState = 'idle', saveLabel = 'Research workspace' }: { section: string; session?: PhyniteSession | null; saveState?: WorkspaceSaveState; saveLabel?: string }) {
  const { theme, toggleTheme } = useSiteTheme();
  const { t } = useLocale();
  const shell = useResearchShell();
  if (shell) return null;
  return <header className="lab-header">
    {['Workspace', 'Storage', 'Billing', 'Account'].includes(section) && <StudioNavigationToggle />}
    <WorkspaceIdentity state={saveState} label={saveLabel} hideSave />
    <span className="lab-header-section">{section === 'Guide' ? t('Documentation', 'Dokumentasi') : section === 'Account' ? t('Account', 'Akun') : section === 'Billing' ? t('Billing', 'Tagihan') : section}</span>
    <nav aria-label="Lab navigation">
      <a href="/workspace" aria-label="Workspace" aria-current={section === 'Workspace' ? 'page' : undefined}><LayoutDashboard size={15} /><span>Workspace</span></a>
      <a href={t('/guide', '/id/guide')} aria-label={t('Documentation', 'Dokumentasi')} aria-current={section === 'Guide' ? 'page' : undefined}><BookOpen size={16} /><span>{t('Documentation', 'Dokumentasi')}</span></a>
      {session && <a href="/billing" aria-label={t('Billing', 'Tagihan')} aria-current={section === 'Billing' ? 'page' : undefined}><CreditCard size={16} /><span>{t('Billing', 'Tagihan')}</span></a>}
      <button type="button" aria-label={theme === 'light' ? t('Use dark theme', 'Gunakan tema gelap') : t('Use light theme', 'Gunakan tema terang')} onClick={toggleTheme}>{theme === 'light' ? <Moon size={15} /> : <Sun size={15} />}</button>
      {session ? <AccountMenu session={session} /> : <a href="/login">{t('Sign in', 'Masuk')}</a>}
    </nav>
  </header>;
}

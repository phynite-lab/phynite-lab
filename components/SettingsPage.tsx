'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import type { PhyniteSession } from '@/app/auth-client';
import { StudioMobileHeader } from '@/app/lab-header';
import { useLocale } from '@/app/locale-provider';
import { useResearchShell } from './ResearchShellContext';
import { SettingsNavigation } from './SettingsNavigation';
import '@/app/account/settings.css';

export function SettingsPage({ session, title, description, children, actions, eyebrow, hideHeading = false }: { hideHeading?: boolean; eyebrow?: string; session: PhyniteSession; title: string; description: string; children: ReactNode; actions?: ReactNode }) {
  const shell = useResearchShell();
  const { t } = useLocale();
  return <main className="lab-page studio-page settings-page"><div className={`settings-frame${shell ? '' : ' settings-frame--standalone'}`}>
    {!shell && <aside className="settings-local-navigation"><SettingsNavigation /></aside>}
    <div className="settings-body"><StudioMobileHeader session={session} /><div className="settings-content settings-main">
      {!hideHeading && <header className="settings-page-heading"><div><p className="settings-eyebrow">{eyebrow ?? t('Settings', 'Pengaturan')}</p><h1>{title}</h1><p>{description}</p></div>{actions}</header>}
      {children}
      {session.mode === 'local' && <p className="settings-source-link"><Link href="/source">{t('Source code and license', 'Kode sumber dan lisensi')} · AGPL v3</Link></p>}
    </div></div>
  </div></main>;
}

export function SettingsSection({ id, title, description, children, actions }: { id?: string; title: string; description?: string; children: ReactNode; actions?: ReactNode }) {
  return <section className="settings-section" id={id} tabIndex={id ? -1 : undefined}><header className="settings-section-heading"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{actions}</header><div className="settings-group">{children}</div></section>;
}

export function SettingsRow({ id, title, description, children }: { id?: string; title: string; description?: ReactNode; children: ReactNode }) {
  return <div className="settings-row" id={id} tabIndex={id ? -1 : undefined}><div className="settings-row-copy"><h3>{title}</h3>{description && <p>{description}</p>}</div><div className="settings-row-control">{children}</div></div>;
}

export function SettingsSaveActions({ dirty, busy, valid = true, onCancel, label }: { dirty: boolean; busy: boolean; valid?: boolean; onCancel: () => void; label?: string }) {
  const { t } = useLocale();
  return <div className="settings-save-actions"><span aria-live="polite">{dirty ? t('You have unsaved changes.', 'Ada perubahan yang belum disimpan.') : t('All changes saved.', 'Semua perubahan tersimpan.')}</span><div><button type="button" className="lab-button" disabled={!dirty || busy} onClick={onCancel}>{t('Cancel', 'Batal')}</button><button type="submit" className="lab-button lab-button-primary" disabled={!dirty || busy || !valid}>{busy ? t('Saving…', 'Menyimpan…') : label ?? t('Save changes', 'Simpan perubahan')}</button></div></div>;
}

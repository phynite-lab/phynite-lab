'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import type { PhyniteSession } from '@/app/auth-client';
import { StudioMobileHeader } from '@/app/lab-header';
import { useLocale } from '@/app/locale-provider';
import { useResearchShell } from './ResearchShellContext';
import { WorkspacePageHeading } from './WorkspacePageHeading';
import { SettingsNavigation } from './SettingsNavigation';
import { useSettingsAnchor } from '@/app/use-settings-anchor';
import '@/app/account/settings.css';

export function SettingsPage({ session, title, description, children, actions, eyebrow, hideHeading = false, className = '' }: { className?: string; hideHeading?: boolean; eyebrow?: string; session: PhyniteSession; title: string; description: string; children: ReactNode; actions?: ReactNode }) {
  const shell = useResearchShell();
  const { t } = useLocale();
  const content = useRef<HTMLDivElement>(null);
  const [sections, setSections] = useState<Array<{ id: string; title: string }>>([]);
  useSettingsAnchor(true);
  useEffect(() => {
    const root = content.current;
    if (!root) return;
    // Read the rendered sections so async provider/runtime panels and translated
    // headings stay in document order without maintaining a second manifest.
    const read = () => {
      const next = Array.from(root.querySelectorAll<HTMLElement>('[data-settings-section][id]'))
        .map(element => ({ id: element.id, title: element.dataset.settingsSection ?? '' }));
      setSections(current => JSON.stringify(current) === JSON.stringify(next) ? current : next);
    };
    read();
    let frame = 0;
    const observer = new MutationObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(read); });
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['id', 'data-settings-section'] });
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [title]);
  return <main className={`lab-page studio-page settings-page ${className}`}><div className={`settings-frame${shell ? '' : ' settings-frame--standalone'}`}>
    {!shell && <aside className="settings-local-navigation"><SettingsNavigation /></aside>}
    <div className="settings-body"><StudioMobileHeader session={session} /><div ref={content} className="settings-content settings-main">
      {!hideHeading && <WorkspacePageHeading className="settings-page-heading" eyebrow={eyebrow ?? t('Settings', 'Pengaturan')} title={title} description={description} actions={actions} />}
      {sections.length > 1 && <nav className="settings-section-index" aria-label={t('On this page', 'Di halaman ini')}><span>{t('On this page', 'Di halaman ini')}</span><div>{sections.map(section => <a key={section.id} href={`#${encodeURIComponent(section.id)}`} onClick={event => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        window.history.pushState(window.history.state, '', `#${encodeURIComponent(section.id)}`);
        window.dispatchEvent(new Event('phynite:settings-anchor'));
      }}>{section.title}</a>)}</div></nav>}
      {children}
      {session.mode === 'local' && <p className="settings-source-link"><Link href="/source">{t('Source code and license', 'Kode sumber dan lisensi')} · AGPL v3</Link></p>}
    </div></div>
  </div></main>;
}

export function SettingsSection({ id, title, description, children, actions, className = '' }: { id?: string; title: string; description?: string; children: ReactNode; actions?: ReactNode; className?: string }) {
  return <section className={`settings-section${className ? ` ${className}` : ''}`} id={id} data-settings-section={id ? title : undefined} tabIndex={id ? -1 : undefined}><header className="settings-section-heading"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{actions}</header><div className="settings-group">{children}</div></section>;
}

export function SettingsRow({ id, title, description, children, includeInIndex = false }: { id?: string; title: string; description?: ReactNode; children: ReactNode; includeInIndex?: boolean }) {
  return <div className="settings-row" id={id} data-settings-section={id && includeInIndex ? title : undefined} tabIndex={id ? -1 : undefined}><div className="settings-row-copy"><h3>{title}</h3>{description && <p>{description}</p>}</div><div className="settings-row-control">{children}</div></div>;
}

export function SettingsSaveActions({ dirty, busy, valid = true, onCancel, label }: { dirty: boolean; busy: boolean; valid?: boolean; onCancel: () => void; label?: string }) {
  const { t } = useLocale();
  return <div className="settings-save-actions"><span aria-live="polite">{dirty ? t('You have unsaved changes.', 'Ada perubahan yang belum disimpan.') : t('All changes saved.', 'Semua perubahan tersimpan.')}</span><div><button type="button" className="lab-button" disabled={!dirty || busy} onClick={onCancel}>{t('Cancel', 'Batal')}</button><button type="submit" className="lab-button lab-button-primary" disabled={!dirty || busy || !valid}>{busy ? t('Saving…', 'Menyimpan…') : label ?? t('Save changes', 'Simpan perubahan')}</button></div></div>;
}

'use client';
import { WorkspaceLoading } from '@/components/WorkspaceLoading';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight, BookOpen, Cpu, Keyboard, Pin, FolderOpen, Plus, Search, Sparkles } from 'lucide-react';
import { useLocale } from '@/app/locale-provider';
import { useSession } from '@/app/use-session';
import { useResearchShell } from './ResearchShellContext';
import './workspace-home.css';

type HomeProject = {
  key: string; name: string; href: string;
  primaryFormula?: string; activityState?: string; activityLabel?: string;
};

export function WorkspaceHome<T extends HomeProject>({ projects, query, renderActions, onCreate, onClearSearch, createDisabled }: {
  projects: T[]; query: string; renderActions: (project: T) => ReactNode;
  onCreate: () => void; onClearSearch: () => void; createDisabled: boolean;
}) {
  const shell = useResearchShell();
  const { t } = useLocale();
  const { session } = useSession();
  if (!shell) return null;
  const pinned = query ? [] : projects.filter(project => shell.preferences.pinnedProjectKeys.includes(project.key));
  const others = query ? projects : projects.filter(project => !shell.preferences.pinnedProjectKeys.includes(project.key));
  const projectRows = (items: T[]) => <div className="research-home-projects">{items.map(project => <article key={project.key} data-pinned={shell.preferences.pinnedProjectKeys.includes(project.key)}>
    <Link href={project.href} onClick={event => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); shell.navigate('projects', project.href); }}><FolderOpen size={18} /><strong>{project.name}</strong>{(project.primaryFormula || project.activityState && project.activityState !== 'idle') && <small>{project.primaryFormula}{project.primaryFormula && project.activityState !== 'idle' && project.activityLabel ? ' · ' : ''}{project.activityState !== 'idle' ? project.activityLabel : ''}</small>}</Link>
    <button type="button" aria-label={shell.preferences.pinnedProjectKeys.includes(project.key) ? t(`Unpin ${project.name}`, `Lepas pin ${project.name}`) : t(`Pin ${project.name}`, `Pin ${project.name}`)} onClick={() => shell.changePreferences({ type: 'project', key: project.key, pinned: !shell.preferences.pinnedProjectKeys.includes(project.key) })}><Pin size={15} fill={shell.preferences.pinnedProjectKeys.includes(project.key) ? 'currentColor' : 'none'} /></button>
    {renderActions(project)}
  </article>)}</div>;
  return <div className="research-home" aria-busy={!shell.projectsReady && !shell.projectsError}>
    {shell.projectsError && <p className="research-home-account-error" role="alert">{shell.projectsError} <button type="button" onClick={shell.refreshProjects}>{t('Retry', 'Coba lagi')}</button></p>}
    {!shell.projectsReady ? !shell.projectsError && <WorkspaceLoading layout="list" label={t('Loading your projects…', 'Memuat project Anda…')} /> : <>
      {!!pinned.length && <section><header className="research-home-section"><h2>{t('Pinned projects', 'Project yang dipin')}</h2></header>{projectRows(pinned)}</section>}
      {(others.length > 0 || !pinned.length) && <section><header className="research-home-section"><h2>{query ? t('Search results', 'Hasil pencarian') : t('Projects', 'Project')}</h2></header>{others.length ? projectRows(others) : <div className="research-home-start" role={query ? 'status' : undefined}>
        {query ? <Search size={24} aria-hidden="true" /> : <FolderOpen size={26} aria-hidden="true" />}
        <h3>{query ? t('No matching projects', 'Tidak ada project yang cocok') : t('Create your first project', 'Buat project pertama Anda')}</h3>
        <p>{query ? t('Try a project name, description or chemical formula.', 'Coba nama project, deskripsi, atau rumus kimia.') : t('Keep structures, calculations, notes and AI conversations together in one project.', 'Simpan struktur, kalkulasi, catatan, dan percakapan AI bersama dalam satu project.')}</p>
        <button type="button" className={`lab-button${query ? '' : ' lab-button-primary'}`} onClick={query ? onClearSearch : onCreate} disabled={!query && createDisabled}>{query ? t('Clear search', 'Kosongkan pencarian') : <><Plus size={16} />{t('Create project', 'Buat project')}</>}</button>
      </div>}</section>}
      {!query && <section className="research-home-setup" aria-label={t('Workspace tools', 'Tool workspace')}><header className="research-home-section"><h2>{t('Workspace tools', 'Tool workspace')}</h2></header><nav className="research-home-tools" aria-label={t('Setup and help', 'Setup dan bantuan')}>
        {[
          { href: '/account/compute', label: t('Compute setup', 'Setup komputasi'), icon: Cpu },
          ...(session?.mode === 'local' ? [{ href: '/account/ai-providers', label: t('AI providers', 'Provider AI'), icon: Sparkles }] : []),
          { href: '/guide', label: t('User guide', 'Panduan pengguna'), icon: BookOpen },
          { href: '/account/keyboard', label: t('Keyboard shortcuts', 'Pintasan keyboard'), icon: Keyboard },
        ].map(item => <Link key={item.href} href={item.href} onClick={event => { if (!item.href.startsWith('/account/') || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); shell.navigate('account', item.href); }}><item.icon size={17} aria-hidden="true" /><span>{item.label}</span><ArrowRight size={14} aria-hidden="true" /></Link>)}
      </nav>{session?.mode === 'local' && <p>{t('Projects stay on this computer. Cloud and AI connections are optional.', 'Project tetap di komputer ini. Koneksi cloud dan AI bersifat opsional.')}</p>}</section>}
    </>}
  </div>;
}

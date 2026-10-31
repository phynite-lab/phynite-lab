'use client';
import { WorkspaceLoading } from '@/components/WorkspaceLoading';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { Pin, FolderOpen } from 'lucide-react';
import { useLocale } from '@/app/locale-provider';
import { useResearchShell } from './ResearchShellContext';

type HomeProject = {
  key: string; name: string; href: string;
  primaryFormula?: string; activityState?: string; activityLabel?: string;
};

export function WorkspaceHome<T extends HomeProject>({ projects, query, renderActions }: {
  projects: T[]; query: string; renderActions: (project: T) => ReactNode;
}) {
  const shell = useResearchShell();
  const { t } = useLocale();
  if (!shell) return null;
  const pinned = projects.filter(project => shell.preferences.pinnedProjectKeys.includes(project.key));
  const others = projects.filter(project => !shell.preferences.pinnedProjectKeys.includes(project.key));
  const projectRows = (items: T[]) => <div className="research-home-projects">{items.map(project => <article key={project.key} data-pinned={shell.preferences.pinnedProjectKeys.includes(project.key)}>
    <Link href={project.href} onClick={event => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); shell.navigate('projects', project.href); }}><FolderOpen size={18} /><strong>{project.name}</strong>{(project.primaryFormula || project.activityState && project.activityState !== 'idle') && <small>{project.primaryFormula}{project.primaryFormula && project.activityState !== 'idle' && project.activityLabel ? ' · ' : ''}{project.activityState !== 'idle' ? project.activityLabel : ''}</small>}</Link>
    <button type="button" aria-label={shell.preferences.pinnedProjectKeys.includes(project.key) ? t(`Unpin ${project.name}`, `Lepas pin ${project.name}`) : t(`Pin ${project.name}`, `Pin ${project.name}`)} onClick={() => shell.changePreferences({ type: 'project', key: project.key, pinned: !shell.preferences.pinnedProjectKeys.includes(project.key) })}><Pin size={15} fill={shell.preferences.pinnedProjectKeys.includes(project.key) ? 'currentColor' : 'none'} /></button>
    {renderActions(project)}
  </article>)}</div>;
  return <div className="research-home" aria-busy={!shell.projectsReady && !shell.projectsError}>
    {shell.projectsError && <p className="research-home-account-error" role="alert">{shell.projectsError} <button type="button" onClick={shell.refreshProjects}>{t('Retry', 'Coba lagi')}</button></p>}
    {!shell.projectsReady ? !shell.projectsError && <WorkspaceLoading layout="list" label={t('Loading your projects…', 'Memuat project Anda…')} /> : <>
      {!!pinned.length && <section><header className="research-home-section"><h2>{t('Pinned projects', 'Project yang dipin')}</h2></header>{projectRows(pinned)}</section>}
      {(others.length > 0 || !pinned.length) && <section><header className="research-home-section"><h2>{query ? t('Search results', 'Hasil pencarian') : t('Projects', 'Project')}</h2></header>{others.length ? projectRows(others) : <p className="research-home-empty">{query ? t('No matching projects.', 'Tidak ada project yang cocok.') : t('No projects yet.', 'Belum ada project.')}</p>}</section>}
    </>}
  </div>;
}

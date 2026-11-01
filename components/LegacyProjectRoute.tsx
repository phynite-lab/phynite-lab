'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { useLocale } from '@/app/locale-provider';
import { useResearchShell } from './ResearchShellContext';
import { getCalculationWorkspaceSnapshot, parseCalculationWorkspaceSnapshot } from '@/lib/workspace-storage';
import { phyniteApi } from '@/lib/phynite-api';
import { useRouter, useSearchParams } from 'next/navigation';
/** Old bookmarks enter the canonical project; preserved manual editors opt in explicitly. */
export function LegacyProjectRoute({ kind, children }: { kind: 'dft' | 'md'; children: ReactNode }) {
  const params = useSearchParams(), router = useRouter(), shell = useResearchShell();
  const { t } = useLocale();
  const [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  const projects = shell?.projects, projectsReady = shell?.projectsReady;
  const preserved = params.get('legacy') === '1', project = params.get('project');
  useEffect(() => {
    if (preserved) return;
    if (!project) {
      if (params.get('view') === 'figures' && projects) {
        if (!projectsReady) return;
        const active = parseCalculationWorkspaceSnapshot(getCalculationWorkspaceSnapshot())?.activeProjectId;
        const target = projects.find(item => item.id === active || item.remoteId === active) ?? projects[0];
        router.replace(target ? `${target.href}?legacy-view=figures` : '/workspace');
      } else router.replace('/workspace');
      return;
    }
    const query = new URLSearchParams();
    for (const key of ['material', 'component', 'trajectory', 'view']) if (params.get(key)) query.set(`legacy-${key}`, params.get(key)!);
    let live = true;
    void (async () => {
      let canonical = project;
      if (kind === 'dft') try { await phyniteApi(`/v1/projects/${encodeURIComponent(project)}`); } catch (failure) { if (failure && typeof failure === 'object' && 'status' in failure && failure.status === 404) canonical = `legacy-${project}`; else { if (live) setError(t('The project could not be loaded. Try again.', 'Project belum dapat dimuat. Coba lagi.')); return; } }
      if (live) router.replace(`/projects/${encodeURIComponent(canonical)}${query.size ? `?${query}` : ''}`);
    })();
    return () => { live = false; };
  }, [kind, params, preserved, project, router, projects, projectsReady, attempt, t]);
  return preserved ? children : error ? <main className="workspace-loading" role="alert"><p>{error}</p><button type="button" className="lab-button" onClick={() => { setError(''); setAttempt(value => value + 1); }}>{t('Retry', 'Coba lagi')}</button><a href="/workspace">Home</a></main> : <main className="workspace-loading">{t('Opening project…', 'Membuka project…')}</main>;
}

import type { PhyniteProject } from '@/lib/phynite-api';
import type { CalculationProjectSummary } from '@/lib/workspace-storage';

export type StudioProjectKind = 'dft' | 'md';

export type StudioProjectItem = {
  key: string;
  id: string;
  remoteId?: string;
  name: string;
  description: string;
  kind: StudioProjectKind;
  tags: Array<'QE' | 'LAMMPS' | 'MD'>;
  href: string;
  updatedAt: string;
  lastOpenedAt: string;
  activityState?: CalculationProjectSummary['activityState'];
  runningCount?: number;
  structureCount?: number;
  primaryFormula?: string;
  structures: CalculationProjectSummary['structures'];
  mdTrajectoryCount?: number;
};

const projectTime = (project: Pick<StudioProjectItem, 'lastOpenedAt' | 'updatedAt'>) => {
  const value = project.lastOpenedAt || project.updatedAt;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const isMdProject = (project: PhyniteProject) => Boolean(
  project.tags?.includes('MD')
  || project.description === 'Molecular dynamics trajectories',
);

export function mergeStudioProjects(
  localProjects: CalculationProjectSummary[],
  remoteProjects: PhyniteProject[],
  trashedProjects: Array<{ id: string; remoteId?: string }> = [],
): StudioProjectItem[] {
  remoteProjects = remoteProjects.filter(remote => !trashedProjects.some(project => project.remoteId === remote.id || project.id === remote.legacyId));
  const localRemoteId = (project: CalculationProjectSummary) => project.remoteId || remoteProjects.find(remote => remote.legacyId === project.id)?.id;
  const remoteById = new Map(remoteProjects.map(project => [project.id, project]));
  const linkedRemoteIds = new Set(localProjects.map(localRemoteId).filter((id): id is string => Boolean(id)));

  const localItems = localProjects.map((project): StudioProjectItem => {
    const remoteId = localRemoteId(project);
    const remote = remoteId ? remoteById.get(remoteId) : undefined;
    return {
      key: remoteId ? `md:${remoteId}` : `dft:${project.id}`,
      id: project.id,
      remoteId,
      name: project.name,
      description: project.description,
      kind: 'dft',
      tags: Array.from(new Set(['QE' as const, ...(remote?.tags ?? [])])),
      href: `/projects/${encodeURIComponent(remoteId || `legacy-${project.id}`)}`,
      updatedAt: project.updatedAt,
      lastOpenedAt: project.lastOpenedAt || project.updatedAt,
      activityState: project.activityState,
      runningCount: project.runningCount,
      structureCount: project.structureCount,
      primaryFormula: project.primaryStructure?.formula,
      structures: project.structures,
    };
  });

  const mdItems = remoteProjects
    .filter(project => !linkedRemoteIds.has(project.id))
    .map((project): StudioProjectItem => ({
      key: `md:${project.id}`,
      id: project.id,
      remoteId: project.id,
      name: project.name,
      description: project.description,
      kind: isMdProject(project) ? 'md' : 'dft',
      tags: project.tags ?? [],
      href: `/projects/${encodeURIComponent(project.id)}`,
      updatedAt: project.updatedAt,
      lastOpenedAt: project.lastOpenedAt || project.updatedAt,
      mdTrajectoryCount: project.mdTrajectoryCount,
      structures: [],
    }));

  return [...localItems, ...mdItems].sort((left, right) => (
    projectTime(right) - projectTime(left)
    || right.updatedAt.localeCompare(left.updatedAt)
    || left.name.localeCompare(right.name)
  ));
}

export function recentStudioProjects(projects: StudioProjectItem[], limit = 4) {
  return projects.slice(0, Math.max(0, limit));
}

export function projectCreateRequest(url: string) {
  const parsed = new URL(url, 'https://phynite.local');
  const requested = parsed.searchParams.get('create') === '1';
  if (requested) parsed.searchParams.delete('create');
  return {
    requested,
    nextHref: `${parsed.pathname}${parsed.search}${parsed.hash}`,
  };
}

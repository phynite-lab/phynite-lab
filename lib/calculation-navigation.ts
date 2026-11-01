export type CalculationView = 'builder' | 'figures' | 'workflow';

export function canHydrateCalculationWorkspace(
  cloudStatus: 'idle' | 'syncing' | 'synced' | 'error',
  snapshotOwner: string | null,
  ownerId: string,
): boolean {
  return (cloudStatus === 'synced' || cloudStatus === 'error') && (!snapshotOwner || snapshotOwner === ownerId);
}

/** Resolve only projects in the currently loaded owner's workspace. */
export function resolveCalculationNavigation(
  search: string,
  projectIds: readonly string[],
): { projectId: string; view: CalculationView } {
  const params = new URLSearchParams(search);
  const requestedProjectId = params.get('project');
  const requestedProjectExists = requestedProjectId !== null && projectIds.includes(requestedProjectId);
  const projectId = requestedProjectExists ? requestedProjectId : '';
  const view: CalculationView = params.get('view') === 'figures' ? 'figures' : params.get('view') === 'workflow' ? 'workflow' : 'builder';
  return { projectId, view };
}

/**
 * A project route selects the project container only unless it contains an
 * explicit, owner-hydrated material in that same project. Never infer the first
 * or previously active material from device state.
 */
export function resolveCalculationProjectSelection(
  search: string,
  projectIds: readonly string[],
  materials: ReadonlyArray<{ id: string; projectId: string }> = [],
): { projectId: string; materialId: string; view: CalculationView } {
  const navigation = resolveCalculationNavigation(search, projectIds);
  const requestedMaterialId = new URLSearchParams(search).get('material');
  const materialId = requestedMaterialId && materials.some((material) => (
    material.id === requestedMaterialId && material.projectId === navigation.projectId
  )) ? requestedMaterialId : '';
  return { ...navigation, materialId };
}

export function calculationNavigationUrl(href: string, projectId: string, view: CalculationView, materialId = ''): string {
  const url = new URL(href);
  if (projectId) url.searchParams.set('project', projectId);
  else url.searchParams.delete('project');
  if (projectId && materialId) url.searchParams.set('material', materialId);
  else url.searchParams.delete('material');
  if (view !== 'builder') url.searchParams.set('view', view);
  else url.searchParams.delete('view');
  return `${url.pathname}${url.search}${url.hash}`;
}

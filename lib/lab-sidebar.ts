export type CountedSidebarProject = {
  id: string;
  count?: number | null;
};

export function labSidebarProjectCount(
  project: CountedSidebarProject,
  assets: ReadonlyArray<{ projectId: string }>,
): number | null {
  if (project.count !== undefined) return project.count;
  return assets.reduce((count, asset) => count + Number(asset.projectId === project.id), 0);
}

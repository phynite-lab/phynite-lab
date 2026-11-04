import type { PhyniteProject } from './phynite-api';
import type { StoredWorkspaceSnapshot } from './workspace-storage';
import type { ProjectWorkflow, WorkflowEnvelope } from './project-workflow';
import { migrateWorkspaceProject } from './project-workflow-migration.ts';
import { isWorkflowServiceUnavailable } from './project-workflow-service.ts';

type OpeningApi = {
  project: (id: string) => Promise<{ project: PhyniteProject }>;
  migrate: (input: { legacyId: string; remoteId?: string; name: string; description?: string }) => Promise<{ project: PhyniteProject }>;
  get: (id: string) => Promise<WorkflowEnvelope>;
  save: (id: string, workflow: ProjectWorkflow, revision: number) => Promise<WorkflowEnvelope>;
};

/** Only expose the preserved editor for a project in an owner-verified snapshot. */
export function preservedProjectEditorHref(requestedId: string, snapshot: StoredWorkspaceSnapshot | null): string | undefined {
  const localId = requestedId.startsWith('legacy-') ? requestedId.slice(7) : requestedId;
  const local = snapshot?.projects?.find(project => project.id === localId || project.remoteId === requestedId);
  return local ? `/calculation?legacy=1&project=${encodeURIComponent(local.id)}` : undefined;
}

/** The caller only supplies a snapshot after its account owner has been verified. */
export async function openProjectWorkflow(requestedId: string, snapshot: StoredWorkspaceSnapshot | null, api: OpeningApi): Promise<{ projectId: string; legacyHref?: string }> {
  const legacyRoute = requestedId.startsWith('legacy-');
  const legacyId = legacyRoute ? requestedId.slice(7) : requestedId;
  let local = snapshot?.projects?.find(project => project.id === legacyId || project.remoteId === requestedId);
  if (!local && !legacyRoute && snapshot?.projects?.length) {
    const { project } = await api.project(requestedId);
    local = snapshot.projects.find(item => item.id === project.legacyId);
  }
  if (!local) {
    if (legacyRoute) throw new Error('The original project could not be found. Open Home and try again.');
    return { projectId: requestedId };
  }
  // Projects created by the original local editor were addressed by their
  // local id. Treat a direct link to one of those ids as a legacy opening,
  // rather than sending that id as the canonical remote id. This keeps old
  // project links migratable after the workflow routes were introduced.
  const openingLegacy = legacyRoute || (local.id === requestedId && !local.remoteId);
  try {
    const { project } = await api.migrate({ legacyId: local.id, remoteId: local.remoteId ?? (openingLegacy ? undefined : requestedId), name: local.name, description: local.description });
    const envelope = await api.get(project.id);
    if (envelope.revision === 0 && snapshot) {
      const migrated = migrateWorkspaceProject(project.id, local.id, snapshot);
      const resources = new Set(migrated.nodes.flatMap(node => node.resources.map(ref => ref.id)));
      const workflow = { ...envelope.workflow, nodes: [...migrated.nodes, ...envelope.workflow.nodes.filter(node => !migrated.nodes.some(item => item.id === node.id) && !node.resources.some(ref => resources.has(ref.id)))] };
      try { await api.save(project.id, workflow, 0); }
      catch (failure) {
        if (!(failure && typeof failure === 'object' && 'status' in failure && failure.status === 409)) throw failure;
        // Another opener can finish the same migration. Never overwrite its revision.
        const fresh = await api.get(project.id);
        if (fresh.revision === 0) throw failure;
      }
    }
    return { projectId: project.id };
  } catch (failure) {
    // A preserved local copy remains usable when its linked project no longer
    // exists or the server predates workflow routes. Do not recreate missing
    // remote research or hide permission, corruption, or save failures.
    const missingProject = failure && typeof failure === 'object' && 'status' in failure && failure.status === 404
      && 'code' in failure && failure.code === 'PROJECT_NOT_FOUND';
    if (!isWorkflowServiceUnavailable(failure) && !missingProject) throw failure;
    return { projectId: '', legacyHref: `/calculation?legacy=1&project=${encodeURIComponent(local.id)}` };
  }
}

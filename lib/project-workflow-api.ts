import { phyniteApi, type PhyniteProject } from './phynite-api';
import type { ProjectWorkflow, WorkflowEnvelope, WorkflowPlan, ProjectRun, WorkflowClipboardV2 } from './project-workflow';
import { isWorkflowServiceUnavailable, WorkflowServiceUnavailableError } from './project-workflow-service';
async function workflowRequest<T>(...args: Parameters<typeof phyniteApi>): Promise<T> {
  try { return await phyniteApi<T>(...args); }
  catch (error) { if (isWorkflowServiceUnavailable(error)) throw new WorkflowServiceUnavailableError(); throw error; }
}
const path = (id: string) => `/v1/projects/${encodeURIComponent(id)}/workflow`;
export const projectWorkflowApi = {
  input: (projectId: string, resourceId: string) => workflowRequest<{ structure: import('./structure-parsers').ParsedStructure | null; text: string | null; filename: string; sha256: string }>(`${path(projectId)}/inputs/${encodeURIComponent(resourceId)}`),
  get: (id: string) => workflowRequest<WorkflowEnvelope>(path(id)),
  save: (id: string, workflow: ProjectWorkflow, baseRevision: number) => workflowRequest<WorkflowEnvelope>(path(id), { method: 'PUT', body: { workflow, baseRevision } }),
  plan: (id: string, revision: number, targets: string[], rerun: string[] = []) => workflowRequest<{ plan: WorkflowPlan }>(`${path(id)}/plan`, { method: 'POST', body: { revision, targets, rerun } }),
  run: (id: string, revision: number, targets: string[], idempotencyKey: string, rerun: string[] = [], compilerSha256?: string) => workflowRequest<{ run: ProjectRun }>(`${path(id)}/runs`, { method: 'POST', body: { revision, targets, rerun, idempotencyKey, compilerSha256 } }),
  runs: (id: string) => workflowRequest<{ runs: ProjectRun[] }>(`${path(id)}/runs`),
  status: (id: string, run: string) => workflowRequest<{ run: ProjectRun }>(`${path(id)}/runs/${encodeURIComponent(run)}`),
  cancel: (id: string, run: string, nodeIds?: string[]) => workflowRequest<{ run: ProjectRun }>(`${path(id)}/runs/${encodeURIComponent(run)}/cancel`, { method: 'POST', body: nodeIds ? { nodeIds } : {} }),
  import: (id: string, input: { sourceProjectId: string; sourceRevision: number; nodeIds: string[]; baseRevision: number; idempotencyKey: string; clipboard?: WorkflowClipboardV2; point?: { x: number; y: number } }) => workflowRequest<WorkflowEnvelope & { imported?: { nodes: Record<string, string>; edges: Record<string, string>; groups: Record<string, string> } }>(`${path(id)}/import`, { method: 'POST', body: input }),
  migrate: (input: { legacyId: string; remoteId?: string; name: string; description?: string }) => workflowRequest<{ project: PhyniteProject; alias: string }>('/v1/project-migrations', { method: 'POST', body: input }),
};

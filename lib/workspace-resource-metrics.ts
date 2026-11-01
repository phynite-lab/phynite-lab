import type { ProjectRun, WorkflowNode } from './project-workflow.ts';
import type { ComputeWorkload } from './account-api.ts';
export type WorkspaceJob = { id: string; nodeId: string; name: string; kind: string; status: string };
export const workloadForNode = (node?: WorkflowNode): ComputeWorkload => node?.kind === 'md' ? 'md-simulation' : node?.kind === 'md-analysis' || node?.kind === 'extract-frame' ? 'md-analysis' : 'qe';
export function activeWorkspaceJobs(runs: ProjectRun[], nodes: WorkflowNode[]): WorkspaceJob[] {
  const jobs = new Map<string, WorkspaceJob>();
  for (const run of runs) for (const attempt of run.attempts) {
    if (!attempt.jobId || !attempt.jobKind || !['pending', 'queued', 'running'].includes(attempt.status)) continue;
    jobs.set(attempt.jobId, { id: attempt.jobId, nodeId: attempt.nodeId, name: nodes.find(node => node.id === attempt.nodeId)?.name ?? attempt.nodeId, kind: attempt.jobKind, status: attempt.status });
  }
  return [...jobs.values()];
}
export function jobElapsedSeconds(startedAt: string | undefined, completedAt: string | undefined, now: number): number | null {
  if (!startedAt) return null;
  const start = Date.parse(startedAt), end = completedAt ? Date.parse(completedAt) : now;
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? Math.floor((end - start) / 1000) : null;
}
export function workspaceJobPath(job: WorkspaceJob): string | null {
  const id = encodeURIComponent(job.id);
  return job.kind === 'CALCULATION' ? `/v1/calculations/${id}` : job.kind === 'MD_SIMULATION' ? `/v1/md/simulations/${id}` : job.kind === 'MD_ANALYSIS' ? `/v1/md/analyses/${id}` : null;
}

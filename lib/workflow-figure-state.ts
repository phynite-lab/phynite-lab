import type { ProjectWorkflow, WorkflowAttempt } from './project-workflow.ts';

export function workflowFigureInputs(graph: ProjectWorkflow, nodeId: string, attempts: WorkflowAttempt[]) {
  return graph.edges.filter(edge => edge.target === nodeId && edge.port === 'dataset').flatMap(edge => {
    const node = graph.nodes.find(item => item.id === edge.source);
    return node ? [{ node, attempt: attempts.find(item => item.nodeId === node.id) }] : [];
  });
}

export type WorkflowFigureBinding = {
  figureRevision: string;
  sources: Array<{ nodeId: string; result: { jobId: string; jobKind: 'CALCULATION' | 'MD_ANALYSIS' } }>;
};

/** Validate the retained binding before assigning a stable local Figure identity. */
export function workflowFigureBinding(raw: unknown): WorkflowFigureBinding {
  const invalid = () => new Error('The prepared Figure has no valid source binding. Prepare it again from its connected results.');
  if (!raw || typeof raw !== 'object') throw invalid();
  const { figureRevision, sources } = raw as Partial<WorkflowFigureBinding>;
  if (typeof figureRevision !== 'string' || !/^[a-f0-9]{64}$/.test(figureRevision) || !Array.isArray(sources) || !sources.length) throw invalid();
  const ids = new Set<string>();
  for (const source of sources) {
    if (!source || typeof source.nodeId !== 'string' || !source.nodeId || ids.has(source.nodeId)
      || !source.result || typeof source.result.jobId !== 'string' || !source.result.jobId.trim()
      || !['CALCULATION', 'MD_ANALYSIS'].includes(source.result.jobKind)) throw invalid();
    ids.add(source.nodeId);
  }
  return { figureRevision, sources };
}

export function workflowFigurePhase(attempt?: WorkflowAttempt) {
  if (!attempt) return 'idle';
  if (['pending', 'queued', 'running'].includes(attempt.status)) return 'running';
  if (['failed', 'blocked', 'cancelled'].includes(attempt.status)) return 'failed';
  if (['ready', 'reused'].includes(attempt.status)) return 'ready';
  return 'idle';
}

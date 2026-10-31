/** Only an explicit missing route indicates an older backend. A missing project is different. */
export function isWorkflowServiceUnavailable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { status?: unknown; code?: unknown; message?: unknown };
  return value.code === 'WORKFLOW_API_UNAVAILABLE' || value.status === 404 && value.code === 'NOT_FOUND' && value.message === 'API route was not found.';
}

export class WorkflowServiceUnavailableError extends Error {
  readonly status = 404;
  readonly code = 'WORKFLOW_API_UNAVAILABLE';
  constructor() {
    super('Workflow sync and runs are not available on this server yet. You can continue editing a local draft.');
    this.name = 'WorkflowServiceUnavailableError';
  }
}

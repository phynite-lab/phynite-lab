import type { CalculationJob } from '@/components/JobComposer';

export type RunFailurePhase = 'preflight' | 'queue' | 'solver' | 'resource' | 'sandbox' | 'artifact' | 'cancelled' | 'unknown';

export type RunFailureSummary = {
  phase: RunFailurePhase;
  label: string;
  detail: string;
  evidence?: string;
};

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function source(job: CalculationJob) {
  return [text(job.resultDetail), text(job.result), text(job.liveLogTail), text(job.outputFiles)].filter(Boolean).join('\n');
}

function matches(value: string, pattern: RegExp) {
  return pattern.test(value);
}

/**
 * Classifies only the evidence retained on a run. It never guesses a solver
 * cause from a status alone; unknown is kept explicit when the worker did not
 * record enough detail.
 */
export function summarizeRunFailure(job: CalculationJob): RunFailureSummary | null {
  if (job.status !== 'Failed' && job.status !== 'Cancelled') return null;
  const evidence = source(job);
  if (job.status === 'Cancelled') return { phase: 'cancelled', label: 'Cancelled', detail: 'The run was cancelled before it reached a completed state.', evidence: evidence || undefined };
  const lower = evidence.toLowerCase();
  if (!job.backendCalculationId && matches(lower, /runtime|setup|install|preflight|pseudopotential|potential|worker|capability|not available|not configured/)) {
    return { phase: 'preflight', label: 'Setup / preflight', detail: 'The solver did not start. Check the selected runtime, solver capability, inputs, and destination.', evidence: evidence || undefined };
  }
  if (matches(lower, /sandbox|bubblewrap|namespace|isolation|network.*block|permission denied|operation not permitted/)) {
    return { phase: 'sandbox', label: 'Sandbox / isolation', detail: 'The execution was blocked by the native isolation policy. Review the isolation probe and job permissions.', evidence: evidence || undefined };
  }
  if (matches(lower, /out of memory|oom|memory|ram|disk full|no space|resource|timeout|timed out|quota/)) {
    return { phase: 'resource', label: 'Resource limit', detail: 'The worker stopped because of a resource or execution budget condition. Check the recorded CPU, RAM, disk, and timeout details.', evidence: evidence || undefined };
  }
  if (matches(lower, /artifact|checksum|provenance|upload|download|persist|storage|archive/)) {
    return { phase: 'artifact', label: 'Result persistence', detail: 'The calculation may have run, but its result or provenance could not be retained or verified.', evidence: evidence || undefined };
  }
  if (job.backendCalculationId || matches(lower, /solver|pw\.x|ph\.x|q2r\.x|matdyn\.x|lammps|ovito|scf|converg|diagonal|ionic/)) {
    return { phase: 'solver', label: 'Solver / analysis', detail: 'The solver or analysis process returned an error after execution started. Inspect the first meaningful solver log line.', evidence: evidence || undefined };
  }
  if (matches(lower, /queued|queue|worker.*offline|worker.*unavailable|dispatch/)) {
    return { phase: 'queue', label: 'Queue / worker', detail: 'The run did not reach a healthy worker. Check the local worker and queue status before retrying.', evidence: evidence || undefined };
  }
  return { phase: 'unknown', label: 'Failure reason unavailable', detail: 'The run is failed, but no classified cause was retained. Open the execution log and record the first error before retrying.', evidence: evidence || undefined };
}

export type RunComparisonRow = { key: string; label: string; left: string; right: string; same: boolean };

function display(value: unknown) {
  if (value === undefined || value === null || value === '') return '—';
  return String(value);
}

export function compareRuns(left: CalculationJob, right: CalculationJob): RunComparisonRow[] {
  const fields: Array<[string, string, unknown, unknown]> = [
    ['status', 'Status', left.status, right.status],
    ['calculation', 'Calculation', left.calculationType, right.calculationType],
    ['settings', 'Settings / input summary', left.settings, right.settings],
    ['structure', 'Structure source', left.structureSourceId ?? left.materialId, right.structureSourceId ?? right.materialId],
    ['started', 'Started', left.startedAt, right.startedAt],
    ['completed', 'Completed', left.completedAt, right.completedAt],
    ['duration', 'Duration', left.duration, right.duration],
    ['result', 'Result summary', left.result, right.result],
    ['resultDetail', 'Result detail', left.resultDetail, right.resultDetail],
    ['accepted', 'Scientific acceptance', left.scientificAccepted === undefined ? undefined : left.scientificAccepted ? 'accepted' : 'not accepted', right.scientificAccepted === undefined ? undefined : right.scientificAccepted ? 'accepted' : 'not accepted'],
  ];
  return fields.map(([key, label, a, b]) => { const leftValue = display(a), rightValue = display(b); return { key, label, left: leftValue, right: rightValue, same: leftValue === rightValue }; });
}

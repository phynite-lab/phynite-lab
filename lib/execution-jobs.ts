export function createExecutionJobId(randomUUID: () => string = () => globalThis.crypto.randomUUID()) {
  return `job-run-${randomUUID()}`;
}

export function ensureUniqueExecutionJobIds<T extends { id: string }>(
  jobs: T[],
  randomUUID: () => string = () => globalThis.crypto.randomUUID(),
) {
  const seen = new Set<string>();
  return jobs.map((job) => {
    if (!seen.has(job.id)) {
      seen.add(job.id);
      return job;
    }
    let id = createExecutionJobId(randomUUID);
    while (seen.has(id)) id = createExecutionJobId(randomUUID);
    seen.add(id);
    return { ...job, id };
  });
}

export function duplicateExecutionJobIds(jobs: Array<{ id: string }>) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const job of jobs) {
    if (seen.has(job.id)) duplicates.add(job.id);
    seen.add(job.id);
  }
  return duplicates;
}

export function canMergeBackendCalculation(
  currentBackendCalculationId: string | undefined,
  incomingBackendCalculationId: string,
) {
  return !currentBackendCalculationId || currentBackendCalculationId === incomingBackendCalculationId;
}

export function resultManifestMatchesCalculation(
  manifestCalculationId: string | undefined,
  calculationId: string,
) {
  return manifestCalculationId === calculationId;
}

const REUSABLE_DEPENDENCY_STATUSES = new Set(['Queued', 'Running', 'Completed']);

export function completedExecutionAccepted(job: { status: string; calculationType?: string; relaxationConverged?: boolean; scientificAccepted?: boolean }, calculationType = job.calculationType) {
  return job.status === 'Completed' && job.scientificAccepted === true && (calculationType !== 'Structural relaxation' || job.relaxationConverged === true);
}

export function reusableDependencyExecution<T extends {
  componentId?: string;
  status: string;
  settings: string;
  backendCalculationId?: string;
  calculationType?: string;
  relaxationConverged?: boolean;
  scientificAccepted?: boolean;
}>(jobs: T[], componentId: string, expectedSettings: string, calculationType?: string) {
  return jobs.find((job) => (
    job.componentId === componentId
    && Boolean(job.backendCalculationId)
    && job.settings === expectedSettings
    && REUSABLE_DEPENDENCY_STATUSES.has(job.status)
    && (job.status !== 'Completed' || completedExecutionAccepted(job, calculationType ?? job.calculationType))
  ));
}

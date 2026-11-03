export type ComputePlanDestination = 'local' | 'cloud';
export type ComputePlanCheck = { id: string; label: string; status: 'ready' | 'blocked' | 'unknown'; detail: string };
export type ComputePlanInput = {
  destination: ComputePlanDestination;
  runtimeInstalled: boolean;
  runtimeLabel?: string;
  isolationAvailable?: boolean;
  solverCapability?: boolean;
  potentialsReady?: boolean;
  resources?: { vcpus?: number; memoryMiB?: number; maxParallelJobs?: number };
  diskFreeBytes?: number | null;
  estimatedBytes?: number | null;
  inputSaved?: boolean;
  cloudTransferReviewed?: boolean;
};
export type ComputePlan = { version: 1; destination: ComputePlanDestination; ready: boolean; checks: ComputePlanCheck[]; estimate?: { bytes: number; fits: boolean } };

function check(id: string, label: string, status: ComputePlanCheck['status'], detail: string): ComputePlanCheck { return { id, label, status, detail }; }

/** Build a preflight receipt. It reports missing prerequisites and never alters scientific settings. */
export function buildComputePlan(input: ComputePlanInput): ComputePlan {
  const checks: ComputePlanCheck[] = [];
  checks.push(input.inputSaved === false ? check('input', 'Saved input', 'blocked', 'Save the exact project input before submitting.') : check('input', 'Saved input', input.inputSaved === undefined ? 'unknown' : 'ready', input.inputSaved === undefined ? 'Input save state was not reported.' : 'Exact input is saved.'));
  checks.push(input.runtimeInstalled ? check('runtime', input.runtimeLabel ?? 'Scientific runtime', 'ready', 'Required runtime is installed and available.') : check('runtime', input.runtimeLabel ?? 'Scientific runtime', 'blocked', 'Install and start the verified runtime before running.'));
  checks.push(input.solverCapability === undefined ? check('solver', 'Solver capability', 'unknown', 'Capability probe has not returned yet.') : input.solverCapability ? check('solver', 'Solver capability', 'ready', 'Solver capability is available.') : check('solver', 'Solver capability', 'blocked', 'The selected solver is unavailable on this runtime.'));
  checks.push(input.isolationAvailable === undefined ? check('isolation', 'Isolation probe', 'unknown', 'Isolation probe has not returned yet.') : input.isolationAvailable ? check('isolation', 'Isolation probe', 'ready', 'Native isolation is available.') : check('isolation', 'Isolation probe', 'blocked', 'Native isolation is unavailable; execution remains blocked.'));
  checks.push(input.potentialsReady === undefined ? check('potentials', 'Pseudopotentials / force field', 'unknown', 'Required potential identity has not been verified.') : input.potentialsReady ? check('potentials', 'Pseudopotentials / force field', 'ready', 'Required potential identity and checksum are available.') : check('potentials', 'Pseudopotentials / force field', 'blocked', 'Install or select the required potential before running.'));
  if (input.destination === 'cloud') checks.push(input.cloudTransferReviewed ? check('transfer', 'Cloud transfer preview', 'ready', 'Only the reviewed job inputs will be transferred.') : check('transfer', 'Cloud transfer preview', 'blocked', 'Review the transfer preview before submitting to Cloud.'));
  if (input.resources) {
    const valid = (input.resources.vcpus ?? 1) > 0 && (input.resources.memoryMiB ?? 1) > 0 && (input.resources.maxParallelJobs ?? 1) > 0;
    checks.push(valid ? check('resources', 'Resource allocation', 'ready', 'CPU, memory, and parallel-job settings are valid.') : check('resources', 'Resource allocation', 'blocked', 'Choose positive CPU, memory, and parallel-job limits.'));
  }
  let estimate: ComputePlan['estimate'];
  if (typeof input.estimatedBytes === 'number' && Number.isFinite(input.estimatedBytes) && input.estimatedBytes >= 0 && typeof input.diskFreeBytes === 'number' && Number.isFinite(input.diskFreeBytes) && input.diskFreeBytes >= 0) estimate = { bytes: input.estimatedBytes, fits: input.estimatedBytes <= input.diskFreeBytes };
  if (estimate && !estimate.fits) checks.push(check('disk', 'Available disk', 'blocked', 'The estimated artifacts exceed the reported free disk space.'));
  else if (estimate) checks.push(check('disk', 'Available disk', 'ready', 'The estimate fits the reported free disk space; intermediate files may grow during the run.'));
  return { version: 1, destination: input.destination, ready: checks.every(item => item.status === 'ready'), checks, ...(estimate ? { estimate } : {}) };
}

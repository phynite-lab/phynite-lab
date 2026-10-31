import type { PhyniteCalculation, PhyniteResultManifest } from './phynite-api.ts';

export type ComputeResources = {
  backend?: string;
  cloudMode?: string;
  profile?: string;
  status?: string;
  startedAt?: string;
  completedAt?: string;
  computeSeconds?: number;
  chargedQuanta?: number;
  refundedQuanta?: number;
  fundingExpiresAtEpoch?: number;
  phase?: string;
  vcpus?: number;
  memoryMiB?: number;
  elapsedSeconds?: number;
  steps?: Array<{ name: string; mpiRanks?: number; memoryEstimateMiB?: number; elapsedSeconds?: number }>;
};

const positive = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
const elapsed = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;

export function readComputeResources(calculation: Partial<PhyniteCalculation>, manifest?: PhyniteResultManifest): ComputeResources {
  const result = manifest?.calculationId === calculation.id ? manifest : undefined;
  return {
    status: calculation.status, startedAt: calculation.startedAt, completedAt: calculation.completedAt,
    backend: calculation.computeBackend, cloudMode: calculation.cloudMode, profile: calculation.computeProfileId, computeSeconds: elapsed(calculation.computeSeconds), chargedQuanta: elapsed(calculation.chargedQuanta), refundedQuanta: elapsed(calculation.refundedQuanta), fundingExpiresAtEpoch: calculation.fundingExpiresAtEpoch, phase: calculation.computePhase,
    vcpus: positive(calculation.vcpus),
    memoryMiB: positive(calculation.memoryMiB),
    elapsedSeconds: elapsed(result?.elapsedSeconds),
    steps: result?.steps?.filter((step) => typeof step.name === 'string').map((step) => ({ name: step.name, mpiRanks: positive(step.mpiRanks), memoryEstimateMiB: positive(step.memoryEstimateMiB), elapsedSeconds: elapsed(step.elapsedSeconds) })),
  };
}

export function computeBackendLabel(backend?: string) {
  return backend === 'LOCAL_MAC' ? 'Local worker' : backend === 'CLOUD_PAID_EC2' ? 'Paid Cloud · Singapore' : backend === 'CLOUD_PILOT_EC2' ? 'Pilot Cloud · Singapore' : backend === 'CLOUD_EC2' ? 'Cloud beta · Singapore' : backend === 'AWS_BATCH' ? 'AWS Batch' : backend === 'DISABLED' ? 'Compute disabled' : backend || 'Compute';
}

export function memoryLabel(memoryMiB?: number) {
  return positive(memoryMiB) ? `${Number((memoryMiB! / 1024).toFixed(2))} GiB` : 'Not reported';
}

export function resourceSummary(resources?: ComputeResources) {
  const values = [positive(resources?.vcpus) ? `${resources!.vcpus} vCPU${resources!.vcpus === 1 ? '' : 's'}` : '', positive(resources?.memoryMiB) ? `${memoryLabel(resources!.memoryMiB)} RAM limit` : ''];
  return values.filter(Boolean).join(' · ');
}

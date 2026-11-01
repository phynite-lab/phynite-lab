/** Resource preferences describe requested allocations, not installed hardware. */
export const computeWorkloads = ['qe', 'md-simulation', 'md-analysis'] as const;
export type ComputeWorkload = typeof computeWorkloads[number];
export type PersonalComputeAllocation = { vcpus: number; memoryMiB: number };
export type PersonalComputeLimit = PersonalComputeAllocation & { minimumMemoryMiB?: number; memoryMiBPerVcpu?: number };
export type PersonalComputePreferences = {
  personalDefaults?: Partial<Record<ComputeWorkload, PersonalComputeAllocation>>;
  personalLimits?: Partial<Record<ComputeWorkload, PersonalComputeLimit>>;
};
export type ComputeDurationUnit = 'minutes' | 'hours';
const durationFactors = { minutes: 60, hours: 3600 } as const;

/** A duration must convert to positive whole seconds, without silently rounding it. */
export function computeDurationSeconds(value: string, unit: ComputeDurationUnit): number | null {
  if (!value.trim()) return null;
  const seconds = Number(value) * durationFactors[unit];
  const rounded = Math.round(seconds);
  return Number.isFinite(seconds) && Number.isSafeInteger(rounded) && rounded > 0 && Math.abs(seconds - rounded) < 1e-7 ? rounded : null;
}
export function computeDurationValue(seconds: number, unit: ComputeDurationUnit): string {
  return Number.isSafeInteger(seconds) && seconds > 0 ? String(seconds / durationFactors[unit]) : '';
}

/** Use spendable credit after reservations; this is not a solver completion ETA. */
export function affordableComputeHours(availableQuanta: number | null | undefined, hourlyQuanta: number | null | undefined, minimumSeconds = 60): number | null {
  if (availableQuanta == null || hourlyQuanta == null || !Number.isFinite(availableQuanta) || availableQuanta < 0 || !Number.isFinite(hourlyQuanta) || hourlyQuanta <= 0 || !Number.isSafeInteger(minimumSeconds) || minimumSeconds < 1) return null;
  const availableMicros = Math.floor(availableQuanta * 1_000_000 + 1e-7);
  const rateMicros = Math.round(hourlyQuanta * 1_000_000);
  if (!rateMicros) return null;
  if (availableMicros < Math.ceil(rateMicros * minimumSeconds / 3600)) return 0;
  return availableMicros / rateMicros;
}

/** Retain explicit values unchanged so the server can reject invalid requests. */
export function personalComputeRequest<T extends { vcpus?: number; memoryMiB?: number }>(input: T, defaults?: PersonalComputeAllocation): T & { vcpus?: number; memoryMiB?: number } {
  return { ...input, ...(input.vcpus === undefined && defaults?.vcpus !== undefined ? { vcpus: defaults.vcpus } : {}), ...(input.memoryMiB === undefined && defaults?.memoryMiB !== undefined ? { memoryMiB: defaults.memoryMiB } : {}) };
}
export function validPersonalAllocation(value: Partial<PersonalComputeAllocation>, limit?: PersonalComputeLimit): value is PersonalComputeAllocation {
  if (!limit || !Number.isSafeInteger(value.vcpus) || !Number.isSafeInteger(value.memoryMiB)) return false;
  const cpu = value.vcpus!, memory = value.memoryMiB!;
  return cpu >= 1 && cpu <= limit.vcpus && memory >= Math.max(limit.minimumMemoryMiB ?? 2048, cpu * (limit.memoryMiBPerVcpu ?? 0)) && memory <= limit.memoryMiB;
}

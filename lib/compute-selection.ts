import { accountRequest, type AccountResponse } from './account-api.ts';
import { personalComputeRequest, type ComputeWorkload, type PersonalComputePreferences } from './compute-preferences.ts';

export type CloudFundingMode = 'paid' | 'pilot';
export type ComputeProfile = {
  id: string; family: string; vcpus: number; memoryMiB: number; machineMemoryMiB: number;
  hourlyMicros: number; hourlyQuanta: number;
};
export type ComputeCatalog = { region: string; updatedAt: string; minimumSeconds: number; profiles: ComputeProfile[] };
export type ComputeSelection = {
  computeTarget?: 'personal' | 'shared'; cloudMode?: CloudFundingMode;
  computeProfileId?: string; quoteId?: string;
  vcpus?: number; memoryMiB?: number; estimatedComputeSeconds?: number;
};
/** Capacity labels keep provider identifiers internal. Collapse equal pilot
 * allocations to the cheapest profile, while retaining an explicit selection. */
export function computeCapacityChoices(profiles: ComputeProfile[], limits: { vcpus?: number; memoryMiB?: number; selectedId?: string } = {}): ComputeProfile[] {
  const choices = new Map<string, ComputeProfile>();
  for (const profile of profiles) {
    if (limits.vcpus !== undefined && profile.vcpus > limits.vcpus) continue;
    const option = { ...profile, memoryMiB: Math.min(profile.memoryMiB, limits.memoryMiB ?? profile.memoryMiB) };
    const key = `${option.vcpus}:${option.memoryMiB}`;
    const existing = choices.get(key);
    if (!existing || option.id === limits.selectedId || (existing.id !== limits.selectedId && option.hourlyMicros < existing.hourlyMicros)) choices.set(key, option);
  }
  return [...choices.values()].sort((a, b) => a.vcpus - b.vcpus || a.memoryMiB - b.memoryMiB || a.hourlyMicros - b.hourlyMicros);
}

export function computeCapacityLabel(resource: { vcpus?: number; memoryMiB?: number } | undefined, locale: string): string | null {
  if (!resource?.vcpus || !resource.memoryMiB) return null;
  return `${resource.vcpus.toLocaleString(locale)} vCPU · ${(resource.memoryMiB / 1024).toLocaleString(locale, { maximumFractionDigits: 2 })} GiB RAM`;
}
export function estimateQuanta(profile: ComputeProfile, seconds: number): number {
  return seconds > 0 ? Math.ceil(profile.hourlyMicros * Math.max(60, seconds) / 3600) / 1_000_000 : 0;
}
type QuoteTransport = (body: { request: Record<string, unknown>; estimatedSeconds: number }) => Promise<{ quote: { id: string } }>;

/** Read the authenticated account preference at submission, then quote the exact
 * scientific payload. No browser storage can leak resource selection to another owner. */
export async function prepareComputeRequest<T extends ComputeSelection & { run?: boolean }>(
  input: T, quote: QuoteTransport, workload: ComputeWorkload = 'qe',
): Promise<T & ComputeSelection> {
  const { estimatedComputeSeconds, ...wireInput } = input;
  if (typeof window === 'undefined' || input.run === false) return wireInput as T;
  const { account } = await accountRequest<AccountResponse>();
  const computeTarget = workload.startsWith('md-') ? 'personal' : input.computeTarget ?? account.computeTarget;
  if (computeTarget !== 'shared') return personalComputeRequest({ ...wireInput, computeTarget }, (account as AccountResponse['account'] & PersonalComputePreferences).personalDefaults?.[workload]) as T;
  const cloudMode = input.cloudMode ?? account.cloudMode ?? 'paid';
  const computeProfileId = input.computeProfileId ?? account.computeProfileId;
  if (!computeProfileId) throw new Error('Choose a cloud CPU/RAM profile before running.');
  const request = { ...wireInput, computeTarget, cloudMode, computeProfileId };
  const result = await quote({ request, estimatedSeconds: estimatedComputeSeconds ?? account.estimatedComputeSeconds ?? 3600 });
  return { ...request, quoteId: result.quote.id } as T;
}

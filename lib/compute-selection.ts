import { accountRequest, type AccountResponse } from './account-api.ts';
import { personalComputeRequest, type ComputeWorkload, type PersonalComputePreferences } from './compute-preferences.ts';
import { localRequest } from './local-api.ts';
import type { HpcClusterProfile } from './hpc-profile.ts';

export type CloudFundingMode = 'paid' | 'pilot';
export type ComputeTarget = 'personal' | 'shared' | 'hpc';

export interface HpcComputeSelection {
  clusterId: string;
  profileSha256?: string;
  partition?: string;
  account?: string;
  nodes: number;
  ranksPerNode: number;
  wallSeconds: number;
  memoryMiBPerNode?: number;
  autoRestartOnWalltime?: boolean;
}

export function isHpcComputeSelection(value: unknown): value is HpcComputeSelection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const nodes = Number(candidate.nodes);
  const ranksPerNode = Number(candidate.ranksPerNode);
  const wallSeconds = Number(candidate.wallSeconds);
  return typeof candidate.clusterId === 'string' && candidate.clusterId.length > 0
    && (candidate.profileSha256 === undefined || typeof candidate.profileSha256 === 'string' && /^[a-f0-9]{64}$/.test(candidate.profileSha256))
    && Number.isSafeInteger(nodes) && nodes >= 1 && nodes <= 4096
    && Number.isSafeInteger(ranksPerNode) && ranksPerNode >= 1 && ranksPerNode <= 1024
    && nodes * ranksPerNode <= 65536
    && Number.isSafeInteger(wallSeconds) && wallSeconds >= 300 && wallSeconds <= 5_184_000
    && (candidate.partition === undefined || typeof candidate.partition === 'string')
    && (candidate.account === undefined || typeof candidate.account === 'string')
    && (candidate.memoryMiBPerNode === undefined || (Number.isSafeInteger(candidate.memoryMiBPerNode) && Number(candidate.memoryMiBPerNode) >= 1024 && Number(candidate.memoryMiBPerNode) <= 16_777_216))
    && (candidate.autoRestartOnWalltime === undefined || typeof candidate.autoRestartOnWalltime === 'boolean');
}

export type ComputeProfile = {
  id: string; family: string; vcpus: number; memoryMiB: number; machineMemoryMiB: number;
  hourlyMicros: number; hourlyQuanta: number;
};
export type ComputeCatalog = { region: string; updatedAt: string; minimumSeconds: number; profiles: ComputeProfile[] };
export type ComputeSelection = {
  computeTarget?: ComputeTarget; cloudMode?: CloudFundingMode;
  computeProfileId?: string; quoteId?: string;
  vcpus?: number; memoryMiB?: number; estimatedComputeSeconds?: number;
  hpc?: HpcComputeSelection;
  executionAffinity?: { scheduler: 'slurm' | 'pbs'; profileSha256: string };
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
  if (computeTarget === 'hpc') {
    if (!isHpcComputeSelection(input.hpc)) throw new Error('Choose a valid HPC cluster allocation before running.');
    let profile: HpcClusterProfile;
    try {
      const result = await localRequest<{ cluster?: HpcClusterProfile }>(`hpc/clusters/${encodeURIComponent(input.hpc.clusterId)}`);
      if (!result.cluster || typeof result.cluster.profileSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(result.cluster.profileSha256)) {
        throw new Error('The selected HPC profile has no verified checksum.');
      }
      profile = result.cluster;
      if (input.hpc.profileSha256 && input.hpc.profileSha256 !== profile.profileSha256) throw new Error('The HPC profile changed. Read the cluster settings and review the allocation again.');
    } catch (error) {
      const detail = error instanceof Error ? error.message : '';
      throw new Error(detail && /profile|cluster|local workspace/i.test(detail)
        ? detail
        : 'HPC execution is available only in the local Phynite workspace. Open the local application and retry.');
    }
    const memoryPerNode = input.hpc.memoryMiBPerNode ?? profile.defaults.memoryMiBPerNode;
    const request = {
      ...wireInput,
      computeTarget: 'personal' as const,
      vcpus: input.hpc.nodes * input.hpc.ranksPerNode,
      memoryMiB: input.hpc.nodes * memoryPerNode,
      executionAffinity: { scheduler: profile.scheduler, profileSha256: profile.profileSha256 },
      settings: { ...((wireInput as Record<string, unknown>).settings as Record<string, unknown> ?? {}), hpcAllocation: { nodes: input.hpc.nodes, ranksPerNode: input.hpc.ranksPerNode, wallSeconds: input.hpc.wallSeconds, memoryMiBPerNode: memoryPerNode, ...(input.hpc.partition ? { queue: input.hpc.partition } : {}), ...(input.hpc.account ? { account: input.hpc.account } : {}) } },
    };
    delete (request as Partial<ComputeSelection>).hpc;
    return request as unknown as T;
  }
  if (computeTarget !== 'shared') return personalComputeRequest({ ...wireInput, computeTarget }, (account as AccountResponse['account'] & PersonalComputePreferences).personalDefaults?.[workload]) as T;
  const cloudMode = input.cloudMode ?? account.cloudMode ?? 'paid';
  const computeProfileId = input.computeProfileId ?? account.computeProfileId;
  if (!computeProfileId) throw new Error('Choose a cloud CPU/RAM profile before running.');
  const request = { ...wireInput, computeTarget, cloudMode, computeProfileId };
  const result = await quote({ request, estimatedSeconds: estimatedComputeSeconds ?? account.estimatedComputeSeconds ?? 3600 });
  return { ...request, quoteId: result.quote.id } as T;
}

import type { AccountSettings } from './account-settings';

export type PlanId = 'free' | 'personal' | 'research' | 'enterprise';
export type QuantaBalance = { balance: number; usedThisMonth: number; usdPerQuanta: number; available?: number; reserved?: number; refundedThisMonth?: number };
export type ComputeWorkload = 'qe' | 'md-simulation' | 'md-analysis';
export type PersonalAllocation = { vcpus: number; memoryMiB: number };
export type PersonalLimits = PersonalAllocation & { minimumMemoryMiB: number; memoryMiBPerVcpu: number };
export type LabAccount = {
  planId: PlanId;
  username?: string;
  billingStatus: string;
  requestedPlan?: PlanId | null;
  requestedAt?: string;
  computeTarget: 'shared' | 'personal';
  cloudMode?: 'paid' | 'pilot';
  computeProfileId?: string;
  estimatedComputeSeconds?: number;
  personalDefaults?: Partial<Record<ComputeWorkload, PersonalAllocation>>;
  personalLimits?: Record<ComputeWorkload, PersonalLimits>;
  paidCompute?: { available: boolean; status: string };
  pilotCompute?: { available: boolean; status: string; limits: { vcpus: number; memoryMiB: number; timeoutSeconds: number }; remainingJobs: number; expiresAtEpoch: number; budgetRemainingMicros: number };
  billingAvailable: boolean;
  quanta: QuantaBalance;
  entitlements?: { localCompute: boolean; cloudCompute: boolean };
  localComputeAvailable: boolean;
  limits: { researchBytes: number; vcpus: number; memoryMiB: number };
  computer: { name?: string; telemetry?: { runtime: 'docker' | 'native'; availableMemoryBytes?: number | null; diskFreeBytes?: number | null; diskTotalBytes?: number | null; cpuPercent?: number | null } | null; enabled: boolean; status: 'connected' | 'offline' | 'not-connected'; createdAt?: string; lastSeenAt?: string; workerId?: string; capabilities?: Array<'qe' | 'md-analysis' | 'md-simulation'> };
};
export type AccountUsage = {
  measuredAt: string;
  storage: { bytes: number; objects: number; categories: Record<string, number>; complete: boolean; scope: string; researchQuotaBytes: number; researchRetainedBytes: number; cloudQuotaBytes?: number; uploadReservedBytes?: number };
  compute: { wallSeconds: number; allocatedCpuSeconds: number; last30DaysSeconds: number; personalSeconds: number; measuredRuns: number; unmeasuredRuns: number; unmeasuredCpuRuns?: number; reportedSolverSeconds?: number; reportedSolverRuns?: number; totalRuns: number; completedRuns: number; activeRuns: number; chargedQuanta?: number; refundedQuanta?: number; netQuanta?: number; quantaMeasuredRuns?: number; quantaUnmeasuredRuns?: number };
  recentRuns: AccountUsageRun[];
  activeRuns?: AccountUsageRun[];
};

export type AccountUsageRun = { id: string; name: string; projectId?: string; calculationType: string; status: string; computePhase?: string; cloudMode?: string; computeProfileId?: string; computeSeconds?: number; chargedQuanta?: number; refundedQuanta?: number; fundedComputeSeconds?: number; computeTarget?: string; vcpus?: number; memoryMiB?: number; effectiveVcpus?: number; effectiveMemoryMiB?: number; createdAt?: string; startedAt?: string; completedAt?: string };

export type AccountComputeUsage = Pick<AccountUsage, 'measuredAt' | 'compute' | 'recentRuns'> & { activeRuns?: AccountUsageRun[] };

type UnknownRecord = Record<string, unknown>;

function record(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} is invalid.`);
  return value as UnknownRecord;
}

function nonnegativeNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`${label} is invalid.`);
  return value;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} is invalid.`);
  return value;
}

function optionalText(value: unknown, label: string): string | undefined {
  return value === undefined || value === null ? undefined : text(value, label);
}

export function parseQuantaBalance(value: unknown): QuantaBalance {
  // Older account deployments do not expose the ledger yet. Treat that as an
  // unprovisioned zero balance while still rejecting malformed values once present.
  if (value === undefined || value === null) return { balance: 0, usedThisMonth: 0, usdPerQuanta: 1 };
  const quanta = record(value, 'Quanta balance');
  const parsed: QuantaBalance = {
    balance: nonnegativeNumber(quanta.balance, 'Quanta balance'),
    usedThisMonth: nonnegativeNumber(quanta.usedThisMonth, 'Monthly Quanta usage'),
    usdPerQuanta: nonnegativeNumber(quanta.usdPerQuanta, 'Quanta exchange rate'),
  };
  if (parsed.usdPerQuanta <= 0) throw new Error('Quanta exchange rate is invalid.');
  for (const key of ['available', 'reserved', 'refundedThisMonth'] as const) {
    if (quanta[key] !== undefined) parsed[key] = nonnegativeNumber(quanta[key], key);
  }
  return parsed;
}

export function parseAccountUsage(value: unknown): AccountUsage {
  const usage = record(value, 'Account usage');
  const parsedCompute = parseAccountComputeUsage(usage);
  const storage = record(usage.storage, 'Storage usage');
  const rawCategories = record(storage.categories, 'Storage categories');
  const categories = Object.fromEntries(Object.entries(rawCategories).map(([name, bytes]) => [name, nonnegativeNumber(bytes, `Storage category ${name}`)]));
  return {
    ...parsedCompute,
    storage: {
      bytes: nonnegativeNumber(storage.bytes, 'Storage bytes'),
      objects: nonnegativeNumber(storage.objects, 'Storage objects'),
      categories,
      complete: typeof storage.complete === 'boolean' ? storage.complete : (() => { throw new Error('Storage completeness is invalid.'); })(),
      scope: text(storage.scope, 'Storage scope'),
      researchQuotaBytes: nonnegativeNumber(storage.researchQuotaBytes, 'Storage quota'),
      researchRetainedBytes: nonnegativeNumber(storage.researchRetainedBytes, 'Retained research storage'),
      ...(storage.cloudQuotaBytes === undefined ? {} : { cloudQuotaBytes: nonnegativeNumber(storage.cloudQuotaBytes, 'Cloud storage quota') }),
      ...(storage.uploadReservedBytes === undefined ? {} : { uploadReservedBytes: nonnegativeNumber(storage.uploadReservedBytes, 'Reserved upload storage') }),
    },
  };
}

export function parseAccountComputeUsage(value: unknown): AccountComputeUsage {
  const usage = record(value, 'Account compute usage');
  const compute = record(usage.compute, 'Compute usage');
  if (!Array.isArray(usage.recentRuns)) throw new Error('Recent runs are invalid.');
  if (usage.activeRuns !== undefined && !Array.isArray(usage.activeRuns)) throw new Error('Active runs are invalid.');
  return {
    measuredAt: text(usage.measuredAt, 'Usage measurement date'),
    compute: {
      wallSeconds: nonnegativeNumber(compute.wallSeconds, 'Compute run time'),
      allocatedCpuSeconds: nonnegativeNumber(compute.allocatedCpuSeconds, 'Allocated CPU time'),
      last30DaysSeconds: nonnegativeNumber(compute.last30DaysSeconds, 'Recent compute time'),
      personalSeconds: nonnegativeNumber(compute.personalSeconds, 'Personal compute time'),
      measuredRuns: nonnegativeNumber(compute.measuredRuns, 'Measured runs'),
      unmeasuredRuns: nonnegativeNumber(compute.unmeasuredRuns, 'Unmeasured runs'),
      totalRuns: nonnegativeNumber(compute.totalRuns, 'Total runs'),
      completedRuns: nonnegativeNumber(compute.completedRuns, 'Completed runs'),
      activeRuns: nonnegativeNumber(compute.activeRuns, 'Active runs'),
      ...Object.fromEntries(['unmeasuredCpuRuns', 'reportedSolverSeconds', 'reportedSolverRuns', 'chargedQuanta', 'refundedQuanta', 'quantaMeasuredRuns', 'quantaUnmeasuredRuns'].filter(key => compute[key] !== undefined).map(key => [key, nonnegativeNumber(compute[key], key)])),
      ...(compute.netQuanta === undefined ? {} : { netQuanta: nonnegativeNumber(compute.netQuanta, 'netQuanta') }),
    },
    recentRuns: usage.recentRuns.map((value, index) => {
      const run = record(value, `Recent run ${index + 1}`);
      return parseUsageRun(run, `Recent run ${index + 1}`);
    }),
    activeRuns: Array.isArray(usage.activeRuns) ? usage.activeRuns.map((value, index) => parseUsageRun(record(value, `Active run ${index + 1}`), `Active run ${index + 1}`)) : [],
  };
}

function parseUsageRun(run: UnknownRecord, label: string): AccountUsageRun {
  return {
        id: text(run.id, 'Run identity'),
        name: text(run.name, 'Run name'),
        projectId: optionalText(run.projectId, 'Project identity'),
        calculationType: text(run.calculationType, 'Calculation type'),
        status: text(run.status, 'Run status'),
        computePhase: optionalText(run.computePhase, `${label} compute phase`),
        computeTarget: optionalText(run.computeTarget, 'Compute target'),
        cloudMode: optionalText(run.cloudMode, 'Funding mode'),
        computeProfileId: optionalText(run.computeProfileId, 'Resource profile'),
        ...Object.fromEntries(['computeSeconds', 'chargedQuanta', 'refundedQuanta', 'fundedComputeSeconds'].filter(key => run[key] !== undefined && run[key] !== null).map(key => [key, nonnegativeNumber(run[key], key)])),
        ...(run.vcpus == null ? {} : { vcpus: nonnegativeNumber(run.vcpus, 'Run vCPUs') }),
        ...(run.memoryMiB == null ? {} : { memoryMiB: nonnegativeNumber(run.memoryMiB, 'Run memory') }),
        ...Object.fromEntries(['effectiveVcpus', 'effectiveMemoryMiB'].filter(key => run[key] != null).map(key => [key, nonnegativeNumber(run[key], key)])),
        createdAt: optionalText(run.createdAt, `${label} creation time`),
        startedAt: optionalText(run.startedAt, `${label} start time`),
        completedAt: optionalText(run.completedAt, `${label} completion time`),
      };
}

export class AccountRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfter: number;

  constructor(message: string, status: number, code: string, retryAfter = 0) {
    super(message);
    this.name = 'AccountRequestError';
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export async function accountRequest<T>(path = '', method = 'GET', body?: unknown): Promise<T> {
  const result = await fetch(`/api/phynite/v1/account${path}`, { method, cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const retryHeader = Number(result.headers.get('Retry-After') || 0);
  const retryAfter = Number.isFinite(retryHeader) && retryHeader > 0 ? Math.ceil(retryHeader) : 0;
  // Proxies can return HTML or a truncated body. Do not expose the browser's
  // JSON parser exception or treat an unreadable checkout as safe to repeat.
  let data: unknown;
  try { data = await result.json(); }
  catch {
    throw new AccountRequestError('The service returned an unreadable response. Refresh and check the current state before retrying.', result.status, 'INVALID_API_RESPONSE', retryAfter);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new AccountRequestError('The service returned an invalid response. Please refresh and try again.', result.status, 'INVALID_API_RESPONSE', retryAfter);
  }
  if (!result.ok) {
    const failure = data as { error?: unknown; code?: unknown };
    throw new AccountRequestError(typeof failure.error === 'string' ? failure.error : 'Account could not be updated. Please try again.', result.status, typeof failure.code === 'string' ? failure.code : 'ACCOUNT_REQUEST_FAILED', retryAfter);
  }
  return data as T;
}
export type AccountUsageRequestOptions = { projectId?: string };
function usageQuery(options: AccountUsageRequestOptions = {}, compute = false) {
  const query = new URLSearchParams();
  if (compute) query.set('scope', 'compute');
  if (options.projectId) query.set('projectId', options.projectId);
  const suffix = query.toString();
  return suffix ? `/usage?${suffix}` : '/usage';
}
export async function accountUsageRequest(options: AccountUsageRequestOptions = {}): Promise<AccountUsage> {
  const result = await accountRequest<{ usage: unknown }>(usageQuery(options));
  return parseAccountUsage(result.usage);
}
export async function accountComputeUsageRequest(options: AccountUsageRequestOptions = {}): Promise<AccountComputeUsage> {
  const result = await accountRequest<{ usage: unknown }>(usageQuery(options, true));
  return parseAccountComputeUsage(result.usage);
}
export type AccountResponse = { account: LabAccount; profile?: AccountSettings | null };
export function formatBytes(bytes: number, locale = 'en'): string {
  if (bytes === 0) return '0 B';
  const unit = Math.min(3, Math.floor(Math.log(Math.max(1, bytes)) / Math.log(1000)));
  return `${(bytes / 1000 ** unit).toLocaleString(locale, { maximumFractionDigits: unit ? 1 : 0 })} ${['B', 'KB', 'MB', 'GB'][unit]}`;
}
export function formatHours(seconds: number, locale = 'en'): string {
  return `${(seconds / 3600).toLocaleString(locale, { maximumFractionDigits: 2 })} h`;
}

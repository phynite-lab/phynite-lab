/**
 * Typed contracts and validation for HPC Cluster Profiles.
 * Follows the boundaries defined in AGENTS.md, docs/hpc-compute.md,
 * and docs/hpc-clusters-prd.md.
 */

export type HpcScheduler = 'slurm' | 'pbs';
export const hpcSchedulers: readonly HpcScheduler[] = ['slurm', 'pbs'];

export type HpcAuthKind = 'key' | 'agent';
export const hpcAuthKinds: readonly HpcAuthKind[] = ['key', 'agent'];

export class HpcProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HpcProfileError';
  }
}

export interface HpcConnectionConfig {
  host: string;
  port: number;
  username: string;
  authKind: HpcAuthKind;
  privateKeyPath?: string;
  bastionHost?: string;
  bastionPort?: number;
  bastionUser?: string;
}

export interface HpcStorageConfig {
  scratchRoot: string;
  pseudoRoot?: string;
  purgeWavefunctions: boolean;
}

export interface HpcRuntimeConfig {
  environmentModules: string[];
  mpiLauncher: string[];
}

export interface HpcAllocationDefaults {
  nodes: number;
  ranksPerNode: number;
  wallSeconds: number;
  memoryMiBPerNode: number;
  queue?: string;
  account?: string;
}

export interface HpcClusterProfile {
  id: string;
  ownerId: string;
  name: string;
  scheduler: HpcScheduler;
  isDefault?: boolean;
  connection: HpcConnectionConfig;
  storage: HpcStorageConfig;
  runtime: HpcRuntimeConfig;
  defaults: HpcAllocationDefaults;
  createdAt: string;
  updatedAt: string;
  /** Server-computed digest of the canonical profile snapshot. */
  profileSha256?: string;
}

const IDENTIFIER_REGEX = /^[A-Za-z0-9][A-Za-z0-9_.@-]{0,95}$/;
const USERNAME_REGEX = /^[A-Za-z0-9][A-Za-z0-9_.@-]{0,63}$/;
const HOST_REGEX = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,253}$/;

function assertNoControlChars(value: string, label: string): void {
  if (/[\x00-\x1f\x7f]/.test(value)) {
    throw new HpcProfileError(`${label} cannot contain control characters or newlines.`);
  }
}

function assertPositiveInteger(value: unknown, label: string, min = 1, max = 1_000_000_000): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new HpcProfileError(`${label} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function assertAbsolutePath(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.includes('..')) {
    throw new HpcProfileError(`${label} must be an absolute path without path traversal (..).`);
  }
  assertNoControlChars(value, label);
  return value;
}

export function isValidMpiLauncher(launcher: unknown): launcher is string[] {
  if (!Array.isArray(launcher) || launcher.length === 0 || launcher.length > 32) return false;
  if (!launcher.every(arg => typeof arg === 'string' && arg.length > 0 && !/[\x00-\x1f\x7f]/.test(arg))) return false;
  const count = launcher.reduce((acc, arg) => acc + (arg.match(/\{ranks\}/g)?.length ?? 0), 0);
  if (count !== 1) return false;
  if (launcher.some(arg => /\{(?!\/?ranks\})|\}(?<!\{ranks)/.test(arg.replace(/\{ranks\}/g, '')))) return false;
  return true;
}

export function validateMpiLauncher(launcher: unknown): string[] {
  if (!isValidMpiLauncher(launcher)) {
    throw new HpcProfileError('MPI launcher must be a non-empty argv array with exactly one {ranks} placeholder and no control characters.');
  }
  return launcher;
}

export function defaultMpiLauncher(scheduler: HpcScheduler): string[] {
  return scheduler === 'slurm'
    ? ['srun', '--mpi=pmix', '--ntasks={ranks}']
    : ['mpiexec', '-n', '{ranks}'];
}

export function validateHpcConnection(raw: unknown): HpcConnectionConfig {
  if (!raw || typeof raw !== 'object') throw new HpcProfileError('Connection configuration is required.');
  const data = raw as Record<string, unknown>;

  const host = typeof data.host === 'string' ? data.host.trim() : '';
  if (!host || !HOST_REGEX.test(host)) throw new HpcProfileError('Valid hostname or IP is required for login host.');
  assertNoControlChars(host, 'Host');

  const port = data.port === undefined ? 22 : assertPositiveInteger(data.port, 'Port', 1, 65535);

  const username = typeof data.username === 'string' ? data.username.trim() : '';
  if (!username || !USERNAME_REGEX.test(username)) throw new HpcProfileError('Valid SSH username is required.');
  assertNoControlChars(username, 'Username');

  const authKind = data.authKind as HpcAuthKind;
  if (!hpcAuthKinds.includes(authKind)) throw new HpcProfileError(`authKind must be one of: ${hpcAuthKinds.join(', ')}.`);

  let privateKeyPath: string | undefined;
  if (authKind === 'key') {
    privateKeyPath = assertAbsolutePath(data.privateKeyPath, 'privateKeyPath');
  }

  let bastionHost: string | undefined;
  let bastionPort: number | undefined;
  let bastionUser: string | undefined;

  if (data.bastionHost) {
    if (typeof data.bastionHost !== 'string' || !HOST_REGEX.test(data.bastionHost.trim())) {
      throw new HpcProfileError('Invalid bastion host.');
    }
    bastionHost = data.bastionHost.trim();
    assertNoControlChars(bastionHost, 'Bastion host');
    bastionPort = data.bastionPort === undefined ? 22 : assertPositiveInteger(data.bastionPort, 'Bastion port', 1, 65535);
    if (data.bastionUser) {
      if (typeof data.bastionUser !== 'string' || !USERNAME_REGEX.test(data.bastionUser.trim())) {
        throw new HpcProfileError('Invalid bastion username.');
      }
      bastionUser = data.bastionUser.trim();
      assertNoControlChars(bastionUser, 'Bastion user');
    }
  }

  return {
    host,
    port,
    username,
    authKind,
    ...(privateKeyPath ? { privateKeyPath } : {}),
    ...(bastionHost ? { bastionHost, bastionPort, ...(bastionUser ? { bastionUser } : {}) } : {}),
  };
}

export function validateHpcStorage(raw: unknown): HpcStorageConfig {
  if (!raw || typeof raw !== 'object') throw new HpcProfileError('Storage configuration is required.');
  const data = raw as Record<string, unknown>;

  const scratchRoot = assertAbsolutePath(data.scratchRoot, 'scratchRoot');
  const pseudoRoot = data.pseudoRoot ? assertAbsolutePath(data.pseudoRoot, 'pseudoRoot') : undefined;
  const purgeWavefunctions = Boolean(data.purgeWavefunctions);

  return {
    scratchRoot,
    ...(pseudoRoot ? { pseudoRoot } : {}),
    purgeWavefunctions,
  };
}

export function validateHpcRuntime(raw: unknown, scheduler: HpcScheduler): HpcRuntimeConfig {
  if (!raw || typeof raw !== 'object') throw new HpcProfileError('Runtime configuration is required.');
  const data = raw as Record<string, unknown>;

  const environmentModules: string[] = [];
  if (data.environmentModules !== undefined && !Array.isArray(data.environmentModules)) {
    throw new HpcProfileError('Environment modules must be a list of safe module names.');
  }
  if (Array.isArray(data.environmentModules)) {
    for (const item of data.environmentModules) {
      if (typeof item !== 'string' || !item.trim()) continue;
      const value = item.trim();
      // Accept old drafts produced by the first UI, but normalize them to
      // names. The local worker renders `module load <name>` itself and never
      // executes a client-provided shell fragment.
      if (value === 'module purge') continue;
      const name = value.startsWith('module load ') ? value.slice('module load '.length).trim() : value;
      if (!/^[A-Za-z0-9][A-Za-z0-9_.+@:/-]{0,127}$/.test(name)) {
        throw new HpcProfileError('Environment modules must be safe module names.');
      }
      environmentModules.push(name);
    }
  }

  const mpiLauncher = data.mpiLauncher ? validateMpiLauncher(data.mpiLauncher) : defaultMpiLauncher(scheduler);
  const expectedLauncher = scheduler === 'slurm' ? 'srun' : 'mpiexec';
  if (mpiLauncher[0] !== expectedLauncher) {
    throw new HpcProfileError(`${scheduler} profiles require an ${expectedLauncher} MPI launcher.`);
  }

  return {
    environmentModules,
    mpiLauncher,
  };
}

/** Fields included in the digest; the digest itself is never self-referential. */
export function canonicalHpcProfile(profile: HpcClusterProfile): Omit<HpcClusterProfile, 'profileSha256'> {
  const canonical = { ...profile } as Omit<HpcClusterProfile, 'profileSha256'> & { profileSha256?: string };
  delete canonical.profileSha256;
  return canonical;
}

export function validateHpcAllocation(raw: unknown): HpcAllocationDefaults {
  if (!raw || typeof raw !== 'object') throw new HpcProfileError('Allocation defaults are required.');
  const data = raw as Record<string, unknown>;

  const nodes = assertPositiveInteger(data.nodes ?? 1, 'nodes', 1, 4096);
  const ranksPerNode = assertPositiveInteger(data.ranksPerNode ?? 32, 'ranksPerNode', 1, 1024);
  const wallSeconds = assertPositiveInteger(data.wallSeconds ?? 14400, 'wallSeconds', 300, 5184000);
  const memoryMiBPerNode = assertPositiveInteger(data.memoryMiBPerNode ?? 65536, 'memoryMiBPerNode', 1024, 16777216);

  const totalRanks = nodes * ranksPerNode;
  if (totalRanks > 65536) {
    throw new HpcProfileError(`Total ranks (${totalRanks}) cannot exceed 65,536.`);
  }

  let queue: string | undefined;
  if (data.queue !== undefined && data.queue !== null && String(data.queue).trim()) {
    const q = String(data.queue).trim();
    if (!IDENTIFIER_REGEX.test(q)) throw new HpcProfileError('Queue/partition contains invalid characters.');
    queue = q;
  }

  let account: string | undefined;
  if (data.account !== undefined && data.account !== null && String(data.account).trim()) {
    const a = String(data.account).trim();
    if (!IDENTIFIER_REGEX.test(a)) throw new HpcProfileError('Account/project contains invalid characters.');
    account = a;
  }

  return {
    nodes,
    ranksPerNode,
    wallSeconds,
    memoryMiBPerNode,
    ...(queue ? { queue } : {}),
    ...(account ? { account } : {}),
  };
}

export function validateHpcProfile(raw: unknown): HpcClusterProfile {
  if (!raw || typeof raw !== 'object') throw new HpcProfileError('HPC profile object is required.');
  const data = raw as Record<string, unknown>;

  const id = typeof data.id === 'string' && data.id.trim() ? data.id.trim() : '';
  if (!id || !IDENTIFIER_REGEX.test(id)) throw new HpcProfileError('Valid profile ID is required.');

  const ownerId = typeof data.ownerId === 'string' && data.ownerId.trim() ? data.ownerId.trim() : '';
  if (!ownerId) throw new HpcProfileError('Owner ID is required.');

  const name = typeof data.name === 'string' ? data.name.trim() : '';
  if (!name || name.length > 100) throw new HpcProfileError('Profile name is required (max 100 characters).');
  assertNoControlChars(name, 'Profile name');

  const scheduler = data.scheduler as HpcScheduler;
  if (!hpcSchedulers.includes(scheduler)) {
    throw new HpcProfileError(`Scheduler must be one of: ${hpcSchedulers.join(', ')}.`);
  }

  const isDefault = Boolean(data.isDefault);
  const connection = validateHpcConnection(data.connection);
  const storage = validateHpcStorage(data.storage);
  const runtime = validateHpcRuntime(data.runtime, scheduler);
  const defaults = validateHpcAllocation(data.defaults);

  const createdAt = typeof data.createdAt === 'string' && data.createdAt ? data.createdAt : new Date().toISOString();
  const updatedAt = typeof data.updatedAt === 'string' && data.updatedAt ? data.updatedAt : new Date().toISOString();

  return {
    id,
    ownerId,
    name,
    scheduler,
    ...(isDefault ? { isDefault: true } : {}),
    connection,
    storage,
    runtime,
    defaults,
    createdAt,
    updatedAt,
  };
}

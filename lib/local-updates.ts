/** Server-side npm check. Never sends workspace data or provider credentials. */
export type LocalUpdateStatus = {
  status: 'available' | 'current' | 'unknown' | 'development';
  currentVersion: string | null;
  latestVersion?: string;
  checkedAt?: string;
};

const registryUrl = 'https://registry.npmjs.org/phynite-lab/latest';
const maximumBytes = 64 * 1024;
const successTtl = 6 * 60 * 60 * 1000;
const failureTtl = 5 * 60 * 1000;

function versionParts(value: unknown): number[] | null {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value) || value.length > 64) return null;
  const parts = value.split('.').map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}

export function newerLocalVersion(latest: string, installed: string): boolean {
  const left = versionParts(latest), right = versionParts(installed);
  if (!left || !right) return false;
  for (let index = 0; index < 3; index++) if (left[index] !== right[index]) return left[index] > right[index];
  return false;
}

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.ok || response.redirected || !response.body) throw new Error('Update check unavailable.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) throw new Error('Update metadata exceeds its limit.');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

export function createLocalUpdateChecker({ fetcher = (...args: Parameters<typeof fetch>) => fetch(...args), now = Date.now, timeoutMs = 3000 } = {}) {
  let cache: { version: string; expires: number; value: LocalUpdateStatus } | undefined;
  let pending: { version: string; promise: Promise<LocalUpdateStatus> } | undefined;
  return async (installed: string | undefined): Promise<LocalUpdateStatus> => {
    // Development checkouts have no launcher-verified release identity.
    if (!versionParts(installed)) return { status: 'development', currentVersion: null };
    const version = installed!;
    if (cache?.version === version && cache.expires > now()) return { ...cache.value };
    if (pending?.version === version) return { ...await pending.promise };
    const promise = (async (): Promise<LocalUpdateStatus> => {
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), timeoutMs);
      let value: LocalUpdateStatus;
      try {
        const response = await fetcher(registryUrl, { method: 'GET', headers: { Accept: 'application/json' }, credentials: 'omit', redirect: 'error', cache: 'no-store', signal: abort.signal });
        const document = await boundedJson(response) as { name?: unknown; version?: unknown } | null;
        if (!document || document.name !== 'phynite-lab' || !versionParts(document.version)) throw new Error('Invalid update metadata.');
        const latestVersion = document.version as string;
        value = { status: newerLocalVersion(latestVersion, version) ? 'available' : 'current', currentVersion: version, latestVersion, checkedAt: new Date(now()).toISOString() };
      } catch { value = { status: 'unknown', currentVersion: version }; }
      finally { clearTimeout(timer); }
      cache = { version, expires: now() + (value.status === 'unknown' ? failureTtl : successTtl), value };
      return value;
    })();
    pending = { version, promise };
    try { return { ...await promise }; }
    finally { if (pending?.promise === promise) pending = undefined; }
  };
}

export const checkLocalUpdate = createLocalUpdateChecker();

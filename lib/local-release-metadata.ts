import packageMetadata from '../packages/phynite-lab/package.json' with { type: 'json' };

export type LocalReleaseMetadata = {
  packageName: string;
  version: string;
  versionSource: 'registry' | 'bundled';
  registryUrl: string;
  nodeRequirement: string;
  targets: readonly { label: string; packageName: string; runtime: string }[];
  sourceUrl: string;
  license: string;
};

const registryUrl = 'https://registry.npmjs.org/phynite-lab/latest';
const maximumBytes = 64 * 1024;
const timeoutMs = 3000;
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

const bundledVersion = typeof packageMetadata.version === 'string' && semver.test(packageMetadata.version)
  ? packageMetadata.version
  : '0.0.0';

const targets = [
  { label: 'macOS Apple Silicon', packageName: 'phynite-lab-runtime-darwin-arm64', runtime: 'darwin-arm64' },
  { label: 'macOS Intel', packageName: 'phynite-lab-runtime-darwin-x64', runtime: 'darwin-x64' },
  { label: 'Linux ARM64', packageName: 'phynite-lab-runtime-linux-arm64', runtime: 'linux-arm64' },
  { label: 'Linux x64 / WSL2', packageName: 'phynite-lab-runtime-linux-x64', runtime: 'linux-x64' },
] as const;

export const bundledLocalRelease: LocalReleaseMetadata = {
  packageName: 'phynite-lab',
  version: bundledVersion,
  versionSource: 'bundled',
  registryUrl,
  nodeRequirement: '>=22.13.0',
  targets,
  sourceUrl: 'https://github.com/phynite-lab/phynite-lab',
  license: 'AGPL-3.0-only',
};

async function readBoundedJson(response: Response): Promise<unknown> {
  if (!response.ok || response.redirected || !response.body) throw new Error('Registry unavailable.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) throw new Error('Registry metadata is too large.');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

export async function getLocalReleaseMetadata(fetcher: typeof fetch = fetch): Promise<LocalReleaseMetadata> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const response = await fetcher(registryUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      signal: abort.signal,
    });
    const document = await readBoundedJson(response) as { name?: unknown; version?: unknown } | null;
    if (!document || document.name !== 'phynite-lab' || typeof document.version !== 'string' || !semver.test(document.version)) {
      throw new Error('Invalid registry metadata.');
    }
    return { ...bundledLocalRelease, version: document.version, versionSource: 'registry' };
  } catch {
    return bundledLocalRelease;
  } finally {
    clearTimeout(timer);
  }
}

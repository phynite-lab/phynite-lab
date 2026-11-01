import type { PhyniteResultArtifact } from './phynite-api.ts';

export type ResultArtifactPage = {
  artifacts: PhyniteResultArtifact[];
  totalArtifacts: number;
  nextCursor: string | null;
  manifestSha256: string;
};

/** Collect one immutable inventory; never build a study from a truncated page. */
export async function collectResultArtifacts(fetchPage: (cursor?: string) => Promise<ResultArtifactPage>, expectedManifestSha256?: string) {
  const artifacts: PhyniteResultArtifact[] = [];
  const paths = new Set<string>(), cursors = new Set<string>();
  let cursor: string | undefined, digest = expectedManifestSha256, total: number | undefined;
  for (let pages = 0; pages < 100; pages++) {
    const page = await fetchPage(cursor);
    if (!/^[a-f0-9]{64}$/.test(page.manifestSha256) || (digest && page.manifestSha256 !== digest) || !Number.isSafeInteger(page.totalArtifacts) || page.totalArtifacts < 0 || page.totalArtifacts > 10000 || (total !== undefined && page.totalArtifacts !== total)) throw new Error('The result inventory changed during download. Reload the run and try again.');
    digest = page.manifestSha256; total = page.totalArtifacts;
    if (!Array.isArray(page.artifacts) || page.artifacts.length > 100) throw new Error('The artifact page is invalid.');
    for (const artifact of page.artifacts) {
      if (!artifact || typeof artifact.path !== 'string' || paths.has(artifact.path)) throw new Error('The result inventory contains duplicated or invalid artifacts.');
      paths.add(artifact.path); artifacts.push(artifact);
    }
    if (page.nextCursor === null) {
      if (artifacts.length !== total) throw new Error('The result inventory is incomplete.');
      return artifacts;
    }
    if (!page.artifacts.length || typeof page.nextCursor !== 'string' || !page.nextCursor || cursors.has(page.nextCursor)) throw new Error('The result inventory has an invalid continuation.');
    cursors.add(page.nextCursor); cursor = page.nextCursor;
  }
  throw new Error('The artifact inventory exceeds the supported page count.');
}

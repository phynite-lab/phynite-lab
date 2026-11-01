const repository = 'https://github.com/phynite-lab/phynite-lab';

/** Only release metadata from the launcher determines the corresponding source. */
export function releaseSource(environment: Record<string, string | undefined> = process.env) {
  const commit = environment.PHYNITE_RELEASE_SOURCE_COMMIT;
  const version = environment.PHYNITE_RELEASE_VERSION;
  if (commit !== undefined && !/^[a-f0-9]{40}$/.test(commit)) throw new Error('Invalid release source commit.');
  if (version !== undefined && !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version)) throw new Error('Invalid release version.');
  if (version && !commit) throw new Error('A packaged release needs its corresponding source commit.');
  return {
    license: 'AGPL-3.0-only',
    version: version ?? 'development',
    commit: commit ?? null,
    repository,
    url: commit ? `${repository}/tree/${commit}` : repository,
    archive: commit ? `${repository}/archive/${commit}.tar.gz` : null,
  };
}

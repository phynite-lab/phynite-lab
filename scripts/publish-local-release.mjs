/** Explicit version release only. Reverify all evidence immediately before npm writes. */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { NPM_RELEASE_TARGETS as DISTRIBUTION_TARGETS, platformPackageName } from '../packages/phynite-lab/lib/distribution.mjs';
import { sha256, verifyLocalRelease } from './verify-local-release.mjs';

function npm(args) {
  return new Promise((accept, reject) => {
    const child = spawn('npm', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', value => { stdout += value; }); child.stderr.on('data', value => { stderr += value; });
    child.once('error', reject);
    child.once('close', code => accept({ code, stdout, stderr }));
  });
}

function npmPublicationArgs(filename, { provenance = false } = {}) {
  return [
    'publish', filename, '--access', 'public', '--ignore-scripts',
    // The default npm notice stream can be several megabytes for a bundled
    // runtime. Keep CI output actionable so the actual publish error remains
    // visible when npm exits non-zero.
    '--loglevel', 'error',
    '--fetch-retries', '5', '--fetch-retry-maxtimeout', '120000', '--fetch-timeout', '900000',
    ...(provenance ? ['--provenance'] : []),
  ];
}

function boundedNpmDiagnostics(result) {
  // npm writes the useful failure (E403/2FA/size limits) after the verbose
  // tarball listing. Keeping only the prefix used to hide the actual reason
  // and made a failed release needlessly difficult to repair. Preserve both
  // streams, de-duplicate the warning noise, then retain a bounded head and
  // tail so the actionable error remains visible in CI output.
  const output = `${result.stderr}\n${result.stdout}`.trim().replace(/\s+/g, ' ');
  if (!output) return 'npm returned no diagnostic output.';
  if (output.length <= 900) return output;
  return `${output.slice(0, 300)} … ${output.slice(-600)}`;
}

async function integrity(path) {
  const hash = createHash('sha512');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return `sha512-${hash.digest('base64')}`;
}

/** npm can accept a new package before its operational version becomes visible. */
export async function waitForRegistryIntegrity(name, version, expected, { query = npm, sleep = milliseconds => delay(milliseconds), attempts = 40, intervalMs = 15000 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const result = await query(['view', `${name}@${version}`, 'dist.integrity', '--json', '--prefer-online']);
    if (result.code === 0) {
      if (JSON.parse(result.stdout) !== expected) throw new Error(`${name}@${version}: registry integrity mismatch. Do not overwrite this version.`);
      return;
    }
    if (!/\bE404\b/.test(result.stderr)) throw new Error(`Cannot verify npm availability for ${name}. Authentication/network failure; no later package was published.`);
    if (attempt + 1 < attempts) await sleep(intervalMs);
  }
  throw new Error(`${name}@${version} has not propagated with verified registry integrity. No later package was published; retry the same qualified inventory later.`);
}

async function registryIntegrity(name, version) {
  const result = await npm(['view', `${name}@${version}`, 'dist.integrity', '--json', '--prefer-online']);
  if (result.code === 0) {
    try { return { status: 'present', integrity: JSON.parse(result.stdout) }; }
    catch { return { status: 'invalid' }; }
  }
  if (/\bE404\b/.test(result.stderr)) return { status: 'missing' };
  return { status: 'error', diagnostic: boundedNpmDiagnostics(result) };
}

/**
 * npm may finish accepting a large tarball and then lose the HTTP response.
 * Reconcile the registry before retrying so a retry never creates a duplicate
 * or mistakes an already-published package for a failure.
 */
async function publishPackage(filename, name, version, expected, { provenance = false, attempts = 3, sleep = milliseconds => delay(milliseconds) } = {}) {
  let last;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const result = await npm(npmPublicationArgs(filename, { provenance }));
    if (result.code === 0) return;
    last = result;
    const registry = await registryIntegrity(name, version);
    if (registry.status === 'present') {
      if (registry.integrity !== expected) throw new Error(`${name}@${version} already exists with different bytes. Choose a new release version.`);
      return;
    }
    if (registry.status === 'error') throw new Error(`Cannot verify npm availability for ${name} after publication failed. ${registry.diagnostic}`);
    if (attempt + 1 < attempts) await sleep(Math.min(30000, 5000 * (attempt + 1)));
  }
  throw new Error(`npm publication failed for ${name}; earlier platform packages may exist. No later package was published. ${boundedNpmDiagnostics(last)}`);
}

/**
 * @param {string} inventory
 * @param {{confirmVersion?: string, publish?: boolean, provenance?: boolean}} [options]
 */
export async function publishLocalRelease(inventory, { confirmVersion, publish = false, provenance = false } = {}) {
  const { release, packages } = await verifyLocalRelease(inventory);
  if (confirmVersion !== release.version) throw new Error('Explicit --confirm-version must match the fully verified release version.');
  const order = [...DISTRIBUTION_TARGETS.map(platformPackageName), 'phynite-lab'];
  if (!publish) return { published: false, version: release.version, order, sourceCommit: release.source.commit };
  // Preflight every name before the first mutation. Existing packages may be
  // resumed only when npm serves the identical tarball's SHA-512 integrity.
  const present = new Set();
  for (const name of order) {
    const item = packages.get(name), result = await npm(['view', `${name}@${release.version}`, 'dist.integrity', '--json', '--prefer-online']);
    if (result.code === 0) {
      if (JSON.parse(result.stdout) !== await integrity(item.filename)) throw new Error(`${name}@${release.version} already exists with different bytes. Choose a new release version.`);
      present.add(name);
    } else if (!/\bE404\b/.test(result.stderr)) throw new Error(`Cannot verify npm availability for ${name}. Authentication/network failure occurred before publication.`);
  }
  for (const name of order) {
    const item = packages.get(name);
    const expectedIntegrity = await integrity(item.filename);
    if (await sha256(item.filename) !== item.sha256) throw new Error('Tarball changed after release qualification. Publication aborted.');
    if (!present.has(name)) {
      await publishPackage(item.filename, name, release.version, expectedIntegrity, { provenance });
    }
    // The launcher is reached only after each native dependency is available
    // with exactly the same bytes that passed its qualification gates.
    await waitForRegistryIntegrity(name, release.version, expectedIntegrity);
  }
  return { published: true, version: release.version, order, sourceCommit: release.source.commit };
}

async function main() {
  const options = {};
  for (let index = 2; index < process.argv.length; index++) {
    const name = process.argv[index];
    if (['--publish', '--provenance'].includes(name)) { if (options[name]) throw new Error('Repeated release option.'); options[name] = true; continue; }
    if (!['--inventory', '--confirm-version'].includes(name) || !process.argv[index + 1] || options[name]) throw new Error('Usage: publish-local-release.mjs --inventory release.json --confirm-version X.Y.Z [--publish] [--provenance]');
    options[name] = process.argv[++index];
  }
  if (!options['--inventory']) throw new Error('A complete release evidence inventory is required.');
  const result = await publishLocalRelease(options['--inventory'], { confirmVersion: options['--confirm-version'], publish: options['--publish'], provenance: options['--provenance'] });
  console.log(`${result.published ? 'PUBLISHED' : 'VERIFIED DRY RUN'} ${result.version}; source ${result.sourceCommit}; package order: ${result.order.join(', ')}.`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

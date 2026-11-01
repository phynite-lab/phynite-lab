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
    '--fetch-retries', '5', '--fetch-retry-maxtimeout', '120000', '--fetch-timeout', '900000',
    ...(provenance ? ['--provenance'] : []),
  ];
}

function boundedNpmDiagnostics(result) {
  const output = `${result.stderr}\n${result.stdout}`.trim().replace(/\s+/g, ' ');
  return output.slice(0, 600) || 'npm returned no diagnostic output.';
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
    if (await sha256(item.filename) !== item.sha256) throw new Error('Tarball changed after release qualification. Publication aborted.');
    if (!present.has(name)) {
      const result = await npm(npmPublicationArgs(item.filename, { provenance }));
      if (result.code !== 0) throw new Error(`npm publication failed for ${name}; earlier platform packages may exist. No later package was published. ${boundedNpmDiagnostics(result)}`);
    }
    // The launcher is reached only after each native dependency is available
    // with exactly the same bytes that passed its qualification gates.
    await waitForRegistryIntegrity(name, release.version, await integrity(item.filename));
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

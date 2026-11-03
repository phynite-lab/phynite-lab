/** Offline release evidence gate. Reading a report is never solver qualification. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { cp, lstat, mkdir, mkdtemp, readFile, realpath, readdir, writeFile } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { NPM_RELEASE_TARGETS as DISTRIBUTION_TARGETS, platformPackageName, RELEASE_REPOSITORY } from '../packages/phynite-lab/lib/distribution.mjs';
import { prohibitedDistributionPath } from '../packages/phynite-lab/lib/check-distribution.mjs';
import { validateNativeInventory } from '../packages/phynite-lab/lib/native-inventory.mjs';
import { validateBundledNoticeIndex, validateBundledNoticeReport } from '../packages/phynite-lab/lib/bundled-notices.mjs';

export const RELEASE_TARGETS = Object.freeze([...DISTRIBUTION_TARGETS]);
export const SMOKE_CHECKS = Object.freeze(['clean-install', 'native-core', 'loopback-security', 'local-workspace', 'ui-desktop-mobile', 'persistence-restart', 'project-import-export', 'local-ai-gateway', 'optional-cloud-no-auto-upload']);
export const SCIENTIFIC_CHECKS = Object.freeze(['runtime-install', 'qe-reference', 'app-qe-queue-reference', 'app-queued-cancel-restart', 'md-guided-reference', 'md-manual-reference', 'analysis-reference', 'sandbox-probe', 'sandbox-denials', 'cancel-resource-recovery', 'installer-failure-recovery']);
const SMOKE_CHECK_ALIASES = Object.freeze({ 'local-ai-gateway': Object.freeze(['local-ai-provider-connections']) });
const HASH = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const nativeTarget = target => target.replace(/^wsl2-/, '');
const fail = message => { throw new Error(message); };

/** Every shipped platform must pass; unshipped targets cannot waive a gate. */
export function requiredReleaseTargets(qualification) {
  if (qualification !== undefined) fail('Qualification deferrals are not supported for released native targets.');
  return RELEASE_TARGETS;
}

export async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function regularFile(root, descriptor, label) {
  if (!descriptor || !HASH.test(descriptor.sha256 ?? '') || typeof descriptor.path !== 'string' || isAbsolute(descriptor.path)
      || descriptor.path.includes('\\') || descriptor.path.split('/').some(part => !part || part === '..' || part === '.')) fail(`${label}: unsafe file or missing SHA-256.`);
  const path = resolve(root, descriptor.path), rootReal = await realpath(root);
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || !info.size || await realpath(path) !== join(rootReal, descriptor.path)) fail(`${label}: expected a nonempty regular file within the evidence directory.`);
  if (await sha256(path) !== descriptor.sha256) fail(`${label}: SHA-256 mismatch.`);
  return path;
}

async function json(path) {
  const info = await lstat(path);
  if (info.size > 16 * 1024 * 1024) fail('Release JSON exceeds the 16 MiB safety limit.');
  return JSON.parse(await readFile(path, 'utf8'));
}

function run(executable, args, input) {
  return new Promise((accept, reject) => {
    const child = spawn(executable, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', value => { stdout += value; if (stdout.length > 32 * 1024 * 1024) child.kill(); });
    child.stderr.on('data', value => { stderr += value; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? accept(stdout) : reject(new Error(`Release archive inspection failed (${executable}, exit ${code}): ${stderr.slice(0, 500)}`)));
    if (input) input(child.stdin).catch(error => {
      // git needs only the leading archive header and closes stdin early on
      // larger source bundles. Its exit status still verifies that header;
      // the complete archive/checksum is validated independently below.
      if (error.code !== 'EPIPE' || executable !== 'git' || args[0] !== 'get-tar-commit-id') reject(error);
    }); else child.stdin.end();
  });
}

// Release archives are validated for safe regular-file entries before this
// cache is populated. Reusing one extraction avoids decompressing the same
// npm/source archive once per bundled asset or notice checksum.
const archiveCaches = new Map();
async function cacheArchive(path) {
  if (archiveCaches.has(path)) return archiveCaches.get(path);
  const root = await mkdtemp(join(tmpdir(), 'phynite-release-archive-'));
  try {
    await run('tar', ['-xzf', path, '-C', root]);
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
  archiveCaches.set(path, root);
  return root;
}

function cachedMember(root, member) {
  if (typeof member !== 'string' || !member || member.startsWith('/') || member.includes('\\') || member.split('/').some(part => !part || part === '.' || part === '..')) fail('Unsafe cached archive member.');
  const path = resolve(root, member);
  if (!path.startsWith(root + '/')) fail('Cached archive member escaped its extraction directory.');
  return path;
}

async function readCachedOrTar(path, member) {
  const root = archiveCaches.get(path);
  if (!root) return run('tar', ['-xOf', path, '--', member]);
  const file = cachedMember(root, member), info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink()) fail('Cached archive member is not a regular file.');
  return readFile(file, 'utf8');
}

async function disposeArchiveCaches() {
  for (const root of archiveCaches.values()) rmSync(root, { recursive: true, force: true });
  archiveCaches.clear();
}

async function tarMember(path, member) { return readCachedOrTar(path, member); }

async function tarMemberDigest(path, member) {
  const root = archiveCaches.get(path);
  if (root) {
    const file = cachedMember(root, member), info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 512 * 1024 * 1024) fail('A required release archive member is missing or exceeds its size limit.');
    return { sha256: await sha256(file), bytes: info.size };
  }
  return new Promise((accept, reject) => {
    const child = spawn('tar', ['-xOf', path, '--', member], { stdio: ['ignore', 'pipe', 'pipe'] }), hash = createHash('sha256');
    let bytes = 0, oversized = false;
    child.stdout.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > 512 * 1024 * 1024) { oversized = true; child.kill(); }
      else hash.update(chunk);
    });
    child.stderr.resume();
    child.on('error', reject);
    child.on('close', code => code === 0 && !oversized ? accept({ sha256: hash.digest('hex'), bytes }) : reject(new Error('A required release archive member is missing or exceeds its size limit.')));
  });
}

async function verifyLinuxBootstrap(item, sourceArchive, sourcePrefix, sourceEntries) {
  const manifest = JSON.parse(await tarMember(item.filename, 'package/distribution.json'));
  if (manifest.bootstrap?.directory !== 'bootstrap' || !HASH.test(manifest.bootstrap.sha256 ?? '')) fail('Linux packages require a checksummed isolation bootstrap.');
  const text = await tarMember(item.filename, 'package/bootstrap/manifest.json');
  if (createHash('sha256').update(text).digest('hex') !== manifest.bootstrap.sha256) fail('Linux bootstrap manifest checksum mismatch.');
  const bootstrap = JSON.parse(text);
  if (bootstrap.schemaVersion !== 1 || bootstrap.target !== item.target || bootstrap.minimumGlibc !== '2.39'
      || Object.keys(bootstrap.tools ?? {}).join(',') !== 'bwrap' || bootstrap.notices !== 'notices' || bootstrap.sourceLock !== 'source-lock.json') fail('Linux bootstrap target, baseline or source metadata is invalid.');
  const tool = bootstrap.tools.bwrap;
  if (!tool || !Array.isArray(tool.libraries) || tool.libraries.length > 100) fail('Linux bootstrap tool inventory is invalid.');
  const seen = new Set();
  for (const record of [{ path: tool.executable, sha256: tool.sha256 }, ...tool.libraries]) {
    if (typeof record?.path !== 'string' || record.path.startsWith('/') || record.path.includes('\\') || record.path.split('/').some(part => !part || part === '.' || part === '..')
        || seen.has(record.path) || !HASH.test(record.sha256 ?? '')) fail('Linux bootstrap contains an unsafe file record.');
    seen.add(record.path);
    const actual = await tarMemberDigest(item.filename, `package/bootstrap/${record.path}`);
    if (!actual.bytes || actual.sha256 !== record.sha256) fail('Linux bootstrap executable/library checksum mismatch.');
  }
  const lock = JSON.parse(await tarMember(sourceArchive, sourcePrefix + 'backend/local_api/native-bootstrap-lock.json'));
  const packagedLock = JSON.parse(await tarMember(item.filename, 'package/bootstrap/source-lock.json'));
  assert.deepEqual(packagedLock, lock.targets?.[item.target], 'Packaged Linux bootstrap lock differs from its corresponding source.');
  const noticePrefix = 'distribution/notices/bootstrap/';
  for (const entry of sourceEntries.filter(name => name.startsWith(sourcePrefix + noticePrefix) && !name.endsWith('/'))) {
    const relative = entry.slice((sourcePrefix + noticePrefix).length);
    const original = await tarMemberDigest(sourceArchive, entry), packaged = await tarMemberDigest(item.filename, 'package/bootstrap/notices/reviewed/' + relative);
    if (original.sha256 !== packaged.sha256) fail('Linux bootstrap notices differ from the corresponding source.');
  }
  const sources = JSON.parse(await tarMember(sourceArchive, sourcePrefix + noticePrefix + 'sources.json'));
  if (sources.schemaVersion !== 1 || !sources.components?.bubblewrap || !sources.components?.libcap) fail('Linux bootstrap corresponding-source inventory is incomplete.');
  for (const component of Object.values(sources.components)) {
    const archive = component.upstreamArchive;
    if (!archive?.localPath?.startsWith('distribution/sources/bootstrap/') || archive.localPath.split('/').includes('..') || !HASH.test(archive.sha256 ?? '')) fail('Linux bootstrap source archive metadata is invalid.');
    const actual = await tarMemberDigest(sourceArchive, sourcePrefix + archive.localPath);
    if (actual.sha256 !== archive.sha256 || actual.bytes !== archive.sizeBytes) fail('Linux bootstrap corresponding-source checksum/size mismatch.');
  }
  for (const path of sources.releaseSourceFiles ?? []) if (!sourceEntries.includes(sourcePrefix + path)) fail('Linux bootstrap is missing corresponding build or source files.');
}

async function verifyPackage(path, item, release, expectedLicense) {
  const metadata = JSON.parse(await tarMember(path, 'package/package.json'));
  const manifest = JSON.parse(await tarMember(path, 'package/distribution.json'));
  const license = await tarMember(path, 'package/LICENSE');
  const notices = await tarMember(path, 'package/THIRD_PARTY_NOTICES.md');
  const entries = (await run('tar', ['-tzf', path])).trim().split('\n');
  if ((await run('tar', ['-tvzf', path])).trim().split('\n').some(entry => !/^[-d]/.test(entry) || /[sS]/.test(entry[3] + entry[6]))) fail(`${item.name}: npm archive links, setuid/setgid or special files are forbidden.`);
  if (entries.some(entry => !entry.startsWith('package/') || entry.includes('\\') || entry.split('/').includes('..') || prohibitedDistributionPath(entry))) fail(`${item.name}: unsafe or prohibited npm archive entry.`);
  await cacheArchive(path);
  if (metadata.name !== item.name || metadata.version !== release.version || metadata.license !== 'AGPL-3.0-only'
      || license !== expectedLicense || !license.includes('GNU AFFERO GENERAL PUBLIC LICENSE') || !license.includes('Version 3, 19 November 2007') || !notices.trim()) fail(`${item.name}: invalid package identity, license or notices.`);
  if (['preinstall', 'install', 'postinstall', 'prepare'].some(name => metadata.scripts?.[name])) fail(`${item.name}: installation lifecycle scripts are forbidden.`);
  if (manifest.schemaVersion !== 2 || manifest.version !== release.version || manifest.source?.commit !== release.source.commit || manifest.source?.repository !== RELEASE_REPOSITORY
      || manifest.source?.url !== `${RELEASE_REPOSITORY}/tree/${release.source.commit}` || manifest.source?.archiveUrl !== `${RELEASE_REPOSITORY}/archive/${release.source.commit}.tar.gz`) fail(`${item.name}: exact public corresponding source differs from the release inventory.`);
  if (item.name === 'phynite-lab') {
    if (item.target !== undefined || manifest.kind !== 'launcher' || [...(metadata.os ?? [])].sort().join(',') !== [...new Set(DISTRIBUTION_TARGETS.map(target => target.split('-')[0]))].sort().join(',') || [...(metadata.cpu ?? [])].sort().join(',') !== [...new Set(DISTRIBUTION_TARGETS.map(target => target.split('-')[1]))].sort().join(',')
        || Object.keys(manifest.targets ?? {}).sort().join(',') !== [...DISTRIBUTION_TARGETS].sort().join(',') || Object.keys(metadata.dependencies ?? {}).length
        || Object.keys(metadata.optionalDependencies ?? {}).sort().join(',') !== DISTRIBUTION_TARGETS.map(platformPackageName).sort().join(',')) fail('Launcher must depend on exactly the released native packages.');
    for (const target of DISTRIBUTION_TARGETS) {
      if (metadata.optionalDependencies[platformPackageName(target)] !== release.version || manifest.targets?.[target]?.package !== platformPackageName(target) || manifest.targets?.[target]?.version !== release.version) fail('Launcher native dependencies must use exact matching versions.');
    }
  } else {
    const dependencies = { ...metadata.dependencies, ...metadata.optionalDependencies };
    const bundled = metadata.bundledDependencies ?? metadata.bundleDependencies ?? [];
    if (!Array.isArray(bundled) || [...bundled].sort().join(',') !== Object.keys(dependencies).sort().join(',')) fail(`${item.name}: every native application dependency must be bundled explicitly.`);
    for (const name of bundled) {
      if (!/^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/.test(name) || !entries.includes(`package/node_modules/${name}/package.json`)) fail(`${item.name}: missing bundled dependency ${name}; pack from the package root.`);
      const dependency = JSON.parse(await tarMember(path, `package/node_modules/${name}/package.json`));
      if (dependency.name !== name || dependency.version !== dependencies[name]) fail(`${item.name}: bundled dependency ${name} differs from its pinned version.`);
    }
    const [os, cpu] = item.target.split('-');
    if (manifest.kind !== 'runtime' || manifest.target !== item.target || metadata.os?.length !== 1 || metadata.os[0] !== os || metadata.cpu?.length !== 1 || metadata.cpu[0] !== cpu) fail(`${item.name}: platform metadata differs from the package target.`);
    const core = manifest.targets?.[item.target], inventory = manifest.nativeInventory, expected = `core/${item.target}/THIRD_PARTY_NATIVE.json`, coreNotices = `core/${item.target}/THIRD_PARTY_NOTICES.md`;
    if (!core || core.executable !== `core/${item.target}/phynite-core` || !HASH.test(core.sha256 ?? '') || Object.keys(manifest.targets).length !== 1
        || inventory?.path !== expected || inventory.notices !== coreNotices || !HASH.test(inventory.sha256 ?? '')) fail(`${item.name}: actual frozen native inventory is required.`);
    const inventoryText = await tarMember(path, `package/${expected}`), nativeNotices = await tarMember(path, `package/${coreNotices}`);
    if (createHash('sha256').update(inventoryText).digest('hex') !== inventory.sha256 || (await tarMemberDigest(path, `package/${core.executable}`)).sha256 !== core.sha256) fail(`${item.name}: core/native inventory checksum mismatch.`);
    const document = validateNativeInventory(JSON.parse(inventoryText), core.sha256, createHash('sha256').update(nativeNotices).digest('hex'));
    const bundleNotices = manifest.bundledNotices;
    if (bundleNotices?.path !== 'bundled-notices.json' || !HASH.test(bundleNotices.sha256 ?? '') || createHash('sha256').update(notices).digest('hex') !== bundleNotices.noticesSha256) fail(`${item.name}: complete bundled JavaScript notices are required.`);
    const indexText = await tarMember(path, 'package/bundled-notices.json');
    if (createHash('sha256').update(indexText).digest('hex') !== bundleNotices.sha256) fail(`${item.name}: bundled notice index checksum mismatch.`);
    const index = validateBundledNoticeIndex(JSON.parse(indexText));
    for (const entry of index.reports) {
      const text = await tarMember(path, `package/${entry.path}`);
      if (createHash('sha256').update(text).digest('hex') !== entry.sha256) fail(`${item.name}: bundled notice report checksum mismatch.`);
      const report = validateBundledNoticeReport(JSON.parse(text));
      if (report.environment !== entry.environment) fail(`${item.name}: bundled notice environment mismatch.`);
      for (const output of [...report.chunks, ...report.assets]) {
        const actual = await tarMemberDigest(path, `package/${join(dirname(entry.path), output.path)}`);
        if (actual.sha256 !== output.sha256 || actual.bytes !== output.bytes) fail(`${item.name}: rendered application bytes differ from the collected licenses.`);
      }
    }
    return document;
  }
}

function verifyEnvironment(document, target) {
  const environment = document.environment, native = nativeTarget(target), [platform, arch] = native.split('-');
  if (!environment || environment.platform !== platform || environment.arch !== arch || typeof environment.nodeVersion !== 'string') fail(`${target}: missing actual runtime environment.`);
  const node = /^v?(\d+)\.(\d+)\.(\d+)/.exec(environment.nodeVersion);
  if (!node || Number(node[1]) < 22 || Number(node[1]) === 22 && Number(node[2]) < 13) fail(`${target}: Node.js >=22.13 is required.`);
  if (platform === 'linux') {
    const glibc = /^(\d+)\.(\d+)(?:\D|$)/.exec(environment.glibcVersion ?? '');
    if (!glibc || Number(glibc[1]) < 2 || Number(glibc[1]) === 2 && Number(glibc[2]) < 39) fail(`${target}: Linux baseline glibc >=2.39 was not verified.`);
    if (typeof environment.kernelRelease !== 'string' || !environment.kernelRelease.trim()) fail(`${target}: missing actual Linux kernel release.`);
  }
  const isWsl = target.startsWith('wsl2-');
  if (environment.wsl2 !== isWsl || isWsl && !/microsoft.*wsl2/i.test(environment.kernelRelease ?? '')) fail(`${target}: WSL2 qualification requires the actual Microsoft WSL2 kernel marker.`);
}

async function verifyEvidence(root, item, kind, release, packages) {
  const path = await regularFile(root, item[kind], `${item.target} ${kind} report`), document = await json(path);
  const expectedFormat = kind === 'smoke' ? 'phynite-local-distribution-smoke' : 'phynite-local-scientific-evidence';
  if (document.format !== expectedFormat || document.schemaVersion !== 1 || document.passed !== true || document.version !== release.version
      || document.sourceCommit !== release.source.commit || document.target !== item.target) fail(`${item.target}: ${kind} evidence does not match this successful release candidate.`);
  if (document.packages?.launcherSha256 !== packages.get('phynite-lab').sha256 || document.packages?.runtimeSha256 !== packages.get(platformPackageName(nativeTarget(item.target))).sha256) fail(`${item.target}: ${kind} evidence was produced against different tarballs.`);
  verifyEnvironment(document, item.target);
  const required = kind === 'smoke' ? SMOKE_CHECKS : SCIENTIFIC_CHECKS;
  const ids = kind === 'smoke' ? document.checkIds : document.checks?.map(check => check.id);
  const includesRequired = id => ids.includes(id) || kind === 'smoke' && (SMOKE_CHECK_ALIASES[id] ?? []).some(alias => ids.includes(alias));
  if (!Array.isArray(ids) || new Set(ids).size !== ids.length || required.some(id => !includesRequired(id))) fail(`${item.target}: incomplete ${kind} acceptance checks.`);
  if (kind === 'smoke') {
    if (!Array.isArray(document.artifacts) || !document.artifacts.length) fail(`${item.target}: smoke evidence must include hashed screenshots/logs.`);
    for (const attachment of document.artifacts) await regularFile(dirname(path), attachment, `${item.target} smoke artifact`);
    return;
  }
  for (const id of required) {
    const check = document.checks.find(check => check.id === id);
    if (check.status !== 'passed' || !Array.isArray(check.attachments) || !check.attachments.length) fail(`${item.target}: ${id} requires successful attached evidence.`);
    const attachments = new Map();
    for (const attachment of check.attachments) {
      const filename = await regularFile(dirname(path), attachment, `${item.target} ${id} attachment`);
      if (attachments.has(attachment.kind)) fail(`${item.target}: repeated evidence attachment kind in ${id}.`);
      attachments.set(attachment.kind, { ...attachment, filename });
    }
    if (id.endsWith('-reference')) {
      if (check.execution?.returnCode !== 0 || !['input', 'output', 'provenance', 'numeric'].every(key => attachments.has(key))) fail(`${item.target}: ${id} requires a real successful execution, output, provenance and numerical reference.`);
      const provenance = await json(attachments.get('provenance').filename);
      if (typeof provenance.engine !== 'string' || !provenance.engine.trim() || provenance.returnCode !== 0 || provenance.inputSha256 !== attachments.get('input').sha256 || provenance.outputSha256 !== attachments.get('output').sha256) fail(`${item.target}: ${id} solver provenance does not verify the actual successful output.`);
      const numeric = await json(attachments.get('numeric').filename);
      if (!Array.isArray(numeric.measurements) || !numeric.measurements.length || numeric.measurements.some(value => !value || typeof value.name !== 'string' || !value.name.trim() || typeof value.unit !== 'string'
          || ![value.value, value.expected, value.tolerance].every(Number.isFinite) || value.tolerance < 0 || Math.abs(value.value - value.expected) > value.tolerance)) fail(`${item.target}: ${id} numerical reference did not pass its stated tolerance.`);
    }
  }
}

/**
 * Every shipped native target requires real smoke and scientific qualification.
 * @param {string} inventoryPath
 * @param {{version?: string, sourceCommit?: string}} [expected]
 */
async function verifyLocalReleaseInternal(inventoryPath, expected = {}) {
  const path = resolve(inventoryPath), root = dirname(path), release = await json(path);
  if (release.schemaVersion !== 1 || release.format !== 'phynite-local-release-candidate' || !VERSION.test(release.version ?? '') || release.source?.repository !== RELEASE_REPOSITORY || !COMMIT.test(release.source?.commit ?? '')) fail('Invalid public release inventory identity.');
  if (expected.version && release.version !== expected.version || expected.sourceCommit && release.source.commit !== expected.sourceCommit) fail('Release evidence does not match the explicitly requested public source commit/version.');
  const archive = await regularFile(root, release.sourceArchive, 'Corresponding source archive');
  const sourceCommit = (await run('git', ['get-tar-commit-id'], destination => pipeline(createReadStream(archive), createGunzip(), destination))).trim();
  if (sourceCommit !== release.source.commit) fail('The source archive is not a git archive of the exact public source commit.');
  const sourceEntries = (await run('tar', ['-tzf', archive])).trim().split('\n');
  if ((await run('tar', ['-tvzf', archive])).trim().split('\n').some(entry => !/^[-d]/.test(entry))) fail('Corresponding source cannot contain links or special files.');
  if (sourceEntries.some(entry => entry.startsWith('/') || entry.includes('\\') || entry.split('/').includes('..') || /^(?:backend\/(?:functions|md_compute|scripts)|workers|app\/developer)(?:\/|$)/.test(entry.split('/').slice(1).join('/')))) fail('Corresponding source contains an unsafe or private hosted path.');
  await cacheArchive(archive);
  const sourceLicensePath = sourceEntries.find(entry => /^[^/]+\/LICENSE$/.test(entry));
  if (!sourceLicensePath) fail('The exact corresponding source archive is missing its root AGPL license.');
  const expectedLicense = await tarMember(archive, sourceLicensePath);
  if (!expectedLicense.includes('GNU AFFERO GENERAL PUBLIC LICENSE') || !expectedLicense.includes('Version 3, 19 November 2007')) fail('The public corresponding source license is not GNU AGPL v3.');
  const packageNames = ['phynite-lab', ...DISTRIBUTION_TARGETS.map(platformPackageName)];
  if (!Array.isArray(release.packages) || release.packages.length !== packageNames.length || new Set(release.packages.map(item => item.name)).size !== packageNames.length || release.packages.some(item => !packageNames.includes(item.name) || item.version !== release.version)) fail('Release inventory must include exactly one launcher and every released native package.');
  const packages = new Map();
  for (const item of release.packages) {
    if (item.name !== 'phynite-lab' && (!DISTRIBUTION_TARGETS.includes(item.target) || item.name !== platformPackageName(item.target))) fail('Native package target/name mismatch.');
    const filename = await regularFile(root, item, item.name);
    const nativeInventory = await verifyPackage(filename, item, release, expectedLicense);
    packages.set(item.name, { ...item, filename, nativeInventory });
  }
  const prefix = sourceLicensePath.slice(0, -'LICENSE'.length), sources = new Map();
  for (const item of packages.values()) if (item.target?.startsWith('linux-')) await verifyLinuxBootstrap(item, archive, prefix, sourceEntries);
  for (const item of packages.values()) for (const component of item.nativeInventory?.components ?? []) {
    const evidence = component.staticSourceEvidence;
    if (!evidence) continue;
    const records = [{ path: evidence.manifest, sha256: evidence.manifestSha256 }, ...evidence.archives];
    if (!sourceEntries.includes(prefix + evidence.rebuildScript)) fail('A native component is missing its corresponding rebuild script.');
    for (const record of records) {
      if (sources.has(record.path) && sources.get(record.path).sha256 !== record.sha256) fail('Native packages disagree about their corresponding source.');
      sources.set(record.path, record);
    }
  }
  for (const record of sources.values()) {
    if (!sourceEntries.includes(prefix + record.path)) fail('A native dependency is absent from the corresponding source archive.');
    const actual = await tarMemberDigest(archive, prefix + record.path);
    if (actual.sha256 !== record.sha256 || record.bytes !== undefined && actual.bytes !== record.bytes) fail('Native corresponding source checksum or size mismatch.');
  }
  const requiredTargets = requiredReleaseTargets(release.qualification);
  if (!Array.isArray(release.evidence) || release.evidence.length !== requiredTargets.length || new Set(release.evidence.map(item => item.target)).size !== requiredTargets.length || release.evidence.some(item => !requiredTargets.includes(item.target))) fail('Every released native target must pass with exactly its own platform evidence.');
  for (const item of release.evidence) {
    await verifyEvidence(root, item, 'smoke', release, packages);
    await verifyEvidence(root, item, 'scientific', release, packages);
  }
  return { release, packages, sourceArchive: archive, inventoryPath: path };
}

export async function verifyLocalRelease(inventoryPath, expected = {}) {
  await disposeArchiveCaches();
  try {
    return await verifyLocalReleaseInternal(inventoryPath, expected);
  } finally {
    await disposeArchiveCaches();
  }
}

/**
 * Prepare an inventory from fixed downloaded-artifact directories, then verify it.
 * @param {string} directory
 * @param {{version: string, sourceCommit: string, sourceArchive: string, deferWsl2Reason?: string}} options
 */
export async function prepareLocalRelease(directory, { version, sourceCommit, sourceArchive, deferWsl2Reason }) {
  const root = resolve(directory);
  if (!VERSION.test(version ?? '') || !COMMIT.test(sourceCommit ?? '')) fail('Prepare requires a release version and full public source commit.');
  const descriptor = async path => ({ path, sha256: await sha256(join(root, path)) });
  const tarballs = (await readdir(join(root, 'tarballs'))).filter(name => name.endsWith('.tgz'));
  const packages = [];
  for (const filename of tarballs) {
    const path = join(root, 'tarballs', filename), metadata = JSON.parse(await tarMember(path, 'package/package.json'));
    const target = DISTRIBUTION_TARGETS.find(target => platformPackageName(target) === metadata.name);
    packages.push({ name: metadata.name, version: metadata.version, ...await descriptor(`tarballs/${filename}`), ...(target ? { target } : {}) });
  }
  const evidence = [];
  const qualification = deferWsl2Reason === undefined ? undefined : { wsl2: 'deferred', reason: deferWsl2Reason };
  for (const target of requiredReleaseTargets(qualification)) evidence.push({ target,
    smoke: await descriptor(`evidence/${target}/smoke/report.json`), scientific: await descriptor(`evidence/${target}/scientific/report.json`) });
  const inventory = { schemaVersion: 1, format: 'phynite-local-release-candidate', version, source: { repository: RELEASE_REPOSITORY, commit: sourceCommit }, sourceArchive: await descriptor(sourceArchive), packages, evidence, ...(qualification ? { qualification } : {}) };
  const path = join(root, 'release.json');
  await writeFile(path, `${JSON.stringify(inventory, null, 2)}\n`, { flag: 'wx' });
  return verifyLocalRelease(path);
}

/** Copy only checksummed report attachments; test databases and local tokens stay private. */
export async function collectReleaseEvidence(reportPath, destination) {
  const source = resolve(reportPath), root = dirname(source), document = await json(source);
  const attachments = document.format === 'phynite-local-distribution-smoke' ? document.artifacts
    : document.format === 'phynite-local-scientific-evidence' ? document.checks?.flatMap(check => check.attachments ?? []) : undefined;
  if (document.schemaVersion !== 1 || document.passed !== true || !Array.isArray(attachments) || !attachments.length) fail('Only successful structured evidence with explicit hashed attachments can be collected.');
  const files = new Map();
  for (const attachment of attachments) {
    const path = await regularFile(root, attachment, 'Public evidence attachment');
    if (files.has(attachment.path) && files.get(attachment.path) !== attachment.sha256) fail('Evidence reuses a filename with a different checksum.');
    if (/\.(?:sqlite|sqlite3|db)$/.test(attachment.path) || /(?:^|\/)(?:identity|core-service|instance|auth|credentials|sessions)(?:[./-]|$)/.test(attachment.path)) fail('Private test database, identity or credential files cannot be published as evidence.');
    files.set(attachment.path, attachment.sha256);
    // Source is checked before creating output so a failed path never leaks.
    if (!path) fail('Missing evidence file.');
  }
  const output = resolve(destination);
  await mkdir(output, { recursive: false });
  for (const [path] of files) {
    await mkdir(dirname(join(output, path)), { recursive: true });
    await cp(join(root, path), join(output, path), { errorOnExist: true, force: false });
  }
  await cp(source, join(output, 'report.json'), { errorOnExist: true, force: false });
}

async function main() {
  const command = process.argv[2], options = {};
  for (let index = 3; index < process.argv.length; index += 2) {
    const key = process.argv[index], value = process.argv[index + 1];
    if (!['--inventory', '--directory', '--version', '--source-commit', '--source-archive', '--defer-wsl2-reason', '--report', '--output'].includes(key) || !value || options[key]) fail('Usage: verify-local-release.mjs verify --inventory release.json | prepare --directory DIR --version X.Y.Z --source-commit COMMIT --source-archive RELATIVE.tar.gz [--defer-wsl2-reason REASON] | collect --report REPORT --output NEW_DIR');
    options[key] = value;
  }
  if (command === 'collect' && options['--report'] && options['--output']) {
    await collectReleaseEvidence(options['--report'], options['--output']);
    console.log('Collected only explicit checksummed public evidence attachments.');
    return;
  }
  const result = command === 'verify' && options['--inventory'] ? await verifyLocalRelease(options['--inventory'], { version: options['--version'], sourceCommit: options['--source-commit'] })
    : command === 'prepare' && options['--directory'] ? await prepareLocalRelease(options['--directory'], { version: options['--version'], sourceCommit: options['--source-commit'], sourceArchive: options['--source-archive'], deferWsl2Reason: options['--defer-wsl2-reason'] }) : fail('Expected prepare or verify with the required release evidence options.');
  assert.equal(result.release.evidence.length, requiredReleaseTargets(result.release.qualification).length);
  console.log(`PASS: ${result.release.version}, source ${result.release.source.commit}; all released native gates verified; exact source/package/evidence SHA-256 verified. No publication performed.`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

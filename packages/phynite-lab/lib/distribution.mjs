/** Public release metadata and native-package verification; no downloads. */
import { createHash, timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import { access, lstat, readFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { validateCloudConfig } from './cloud-config.mjs';
import { validateNativeInventory } from './native-inventory.mjs';
import { validateBundledNoticeIndex, validateBundledNoticeReport } from './bundled-notices.mjs';

export const RELEASE_REPOSITORY = 'https://github.com/phynite-lab/phynite-lab';
export const DISTRIBUTION_TARGETS = Object.freeze(['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64']);
// Every native target has a separately assembled npm package. WSL2 runs the
// Linux x64 package because Node reports its native platform as linux-x64.
export const NPM_RELEASE_TARGETS = Object.freeze([...DISTRIBUTION_TARGETS]);
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const HASH = /^[a-f0-9]{64}$/;

export function platformPackageName(target) {
  if (!DISTRIBUTION_TARGETS.includes(target)) throw new Error('Unsupported native runtime platform.');
  return `phynite-lab-runtime-${target}`;
}

export function releaseSource(commit) {
  if (typeof commit !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit)) throw new Error('A full public source commit is required.');
  return { repository: RELEASE_REPOSITORY, commit, url: `${RELEASE_REPOSITORY}/tree/${commit}`, archiveUrl: `${RELEASE_REPOSITORY}/archive/${commit}.tar.gz` };
}

function validateSource(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'archiveUrl,commit,repository,url') throw new Error('The release source metadata is invalid.');
  const expected = releaseSource(value.commit);
  if (Object.entries(expected).some(([name, text]) => value[name] !== text)) throw new Error('The release must identify its exact public corresponding source.');
  return expected;
}

async function readJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch { throw new Error('The installed release metadata is missing or invalid. Reinstall a verified Phynite Lab release.'); }
}

async function verifiedFile(root, relative, expected) {
  if (!HASH.test(expected ?? '')) throw new Error('The packaged runtime checksum is invalid.');
  const path = join(root, relative), info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || !info.size || await realpath(path) !== join(await realpath(root), relative)) throw new Error('A packaged runtime file is missing or unsafe.');
  const actual = createHash('sha256').update(await readFile(path)).digest();
  if (!timingSafeEqual(actual, Buffer.from(expected, 'hex'))) throw new Error('The packaged runtime checksum does not match the release manifest. Reinstall the package.');
  return path;
}

export async function verifyLauncherManifest(root) {
  const manifest = await readJson(join(root, 'distribution.json'));
  const packageJson = await readJson(join(root, 'package.json'));
  if (manifest.schemaVersion !== 2 || manifest.kind !== 'launcher' || packageJson.name !== 'phynite-lab'
      || !VERSION.test(manifest.version ?? '') || packageJson.version !== manifest.version || packageJson.license !== 'AGPL-3.0-only') throw new Error('The launcher release metadata is invalid.');
  const source = validateSource(manifest.source), cloud = validateCloudConfig(manifest.cloud);
  const targets = Object.keys(manifest.targets ?? {});
  if (!targets.length || targets.some(target => !DISTRIBUTION_TARGETS.includes(target))) throw new Error('The launcher must declare supported platform packages.');
  if (Object.keys(packageJson.optionalDependencies ?? {}).sort().join(',') !== targets.map(platformPackageName).sort().join(',') || Object.keys(packageJson.dependencies ?? {}).length) throw new Error('The launcher can depend only on its declared exact native platform packages.');
  for (const target of targets) {
    const entry = manifest.targets[target], name = platformPackageName(target);
    if (!entry || entry.package !== name || entry.version !== manifest.version || packageJson.optionalDependencies?.[name] !== manifest.version) throw new Error('Native runtime package versions must exactly match the launcher release.');
  }
  return { manifest, packageJson, source, cloud };
}

export async function verifyRuntimePackage(root, target, expected) {
  const manifest = await readJson(join(root, 'distribution.json'));
  const packageJson = await readJson(join(root, 'package.json'));
  const [os, cpu] = target.split('-');
  if (manifest.schemaVersion !== 2 || manifest.kind !== 'runtime' || manifest.target !== target || !VERSION.test(manifest.version ?? '')
      || packageJson.name !== platformPackageName(target) || packageJson.version !== manifest.version || packageJson.license !== 'AGPL-3.0-only'
      || packageJson.os?.length !== 1 || packageJson.os[0] !== os || packageJson.cpu?.length !== 1 || packageJson.cpu[0] !== cpu) throw new Error('The installed native runtime package does not match this platform or release.');
  const source = validateSource(manifest.source);
  if (expected && (manifest.version !== expected.version || source.commit !== expected.source.commit)) throw new Error('The native runtime version or corresponding source differs from the launcher. Reinstall the matching release.');
  const core = manifest.targets?.[target];
  if (!core || Object.keys(manifest.targets).length !== 1 || core.executable !== `core/${target}/phynite-core`) throw new Error('The native runtime manifest is invalid.');
  const executable = await verifiedFile(root, core.executable, core.sha256);
  await access(executable, constants.X_OK);
  if (manifest.nativeInventory) {
    const inventory = manifest.nativeInventory, expected = `core/${target}/THIRD_PARTY_NATIVE.json`, notices = `core/${target}/THIRD_PARTY_NOTICES.md`;
    if (inventory.path !== expected || inventory.notices !== notices) throw new Error('The native inventory path is invalid.');
    await verifiedFile(root, expected, inventory.sha256);
    const document = await readJson(join(root, expected));
    await verifiedFile(root, notices, document.noticesSha256);
    validateNativeInventory(document, core.sha256, document.noticesSha256);
  }
  if (manifest.bundledNotices) {
    const notices = manifest.bundledNotices;
    if (notices.path !== 'bundled-notices.json') throw new Error('The bundled notice index path is invalid.');
    await verifiedFile(root, notices.path, notices.sha256);
    await verifiedFile(root, 'THIRD_PARTY_NOTICES.md', notices.noticesSha256);
    const index = validateBundledNoticeIndex(await readJson(join(root, notices.path)));
    for (const entry of index.reports) {
      await verifiedFile(root, entry.path, entry.sha256);
      const report = validateBundledNoticeReport(await readJson(join(root, entry.path)));
      if (report.environment !== entry.environment) throw new Error('Bundled notice environment identity is invalid.');
      for (const output of [...report.chunks, ...report.assets]) await verifiedFile(root, join(dirname(entry.path), output.path), output.sha256);
    }
  }
  const server = join(root, 'app', 'server.js');
  if (!(await lstat(server)).isFile() || await realpath(server) !== join(await realpath(root), 'app', 'server.js')) throw new Error('The packaged application is missing or unsafe.');
  let bootstrap;
  if (manifest.bootstrap) {
    if (manifest.bootstrap.directory !== 'bootstrap') throw new Error('The native bootstrap directory is invalid.');
    await verifiedFile(root, 'bootstrap/manifest.json', manifest.bootstrap.sha256);
    const document = await readJson(join(root, 'bootstrap', 'manifest.json'));
    if (document.schemaVersion !== 1 || document.target !== target || !document.tools?.bwrap) throw new Error('The native isolation bootstrap manifest is invalid.');
    const tool = document.tools.bwrap;
    const safePath = value => typeof value === 'string' && value.length && !value.includes('\\') && !value.startsWith('/') && value.split('/').every(part => part && part !== '.' && part !== '..');
    if (!safePath(tool.executable) || !Array.isArray(tool.libraries)) throw new Error('The native isolation bootstrap file list is invalid.');
    const binary = await verifiedFile(root, `bootstrap/${tool.executable}`, tool.sha256);
    const mode = (await lstat(binary)).mode;
    if (mode & 0o6000) throw new Error('Native bootstrap executables cannot use setuid or setgid.');
    await access(binary, constants.X_OK);
    for (const library of tool.libraries) {
      if (!safePath(library?.path)) throw new Error('The native bootstrap library path is invalid.');
      await verifiedFile(root, `bootstrap/${library.path}`, library.sha256);
    }
    bootstrap = join(await realpath(root), 'bootstrap');
  }
  if (os === 'linux' && !bootstrap) throw new Error('The Linux release is missing its verified native isolation bootstrap.');
  return { executable, server, bootstrap, manifest, source, packageRoot: root };
}

export async function resolveDistribution(root, target) {
  const manifest = await readJson(join(root, 'distribution.json'));
  // Existing schema-1 local installations remain runnable. New publication is
  // always assembled with schema 2 and validated source/license metadata.
  if (manifest.schemaVersion === 1) {
    const core = manifest.targets?.[target];
    if (!core) throw new Error(`Packaged core for ${target} is missing. This is an incomplete distribution; install a verified Phynite Lab release.`);
    if (core.executable !== `core/${target}/phynite-core`) throw new Error('The packaged runtime manifest is invalid.');
    const executable = await verifiedFile(root, core.executable, core.sha256);
    await access(executable, constants.X_OK);
    const server = join(root, 'app', 'server.js'); await access(server, constants.R_OK);
    return { executable, server, manifest, cloud: validateCloudConfig(manifest.cloud), packageRoot: root, source: undefined, bootstrap: undefined };
  }
  const release = await verifyLauncherManifest(root), name = platformPackageName(target);
  if (!release.manifest.targets[target]) throw new Error(`No runtime for ${target} is included in this release. Supported targets: ${Object.keys(release.manifest.targets).join(', ')}.`);
  let packageRoot;
  try { packageRoot = await realpath(join(createRequire(join(root, 'package.json')).resolve(`${name}/package.json`), '..')); }
  catch { throw new Error(`The native package ${name}@${release.manifest.version} is missing. Reinstall phynite-lab with optional dependencies enabled.`); }
  const runtime = await verifyRuntimePackage(packageRoot, target, release.manifest);
  return { ...runtime, manifest: release.manifest, cloud: release.cloud, source: release.source };
}

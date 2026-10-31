/** Assemble launcher and native npm packages. Never publishes or downloads. */
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, stat, writeFile, chmod, lstat, realpath, rm } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { distributionPlatform } from '../packages/phynite-lab/lib/launcher.mjs';
import { checkDistribution, prohibitedDistributionPath } from '../packages/phynite-lab/lib/check-distribution.mjs';
import { DISTRIBUTION_TARGETS, platformPackageName, releaseSource } from '../packages/phynite-lab/lib/distribution.mjs';
import { localRuntimeClosure } from './local-runtime-closure.mjs';
import { validateCloudConfig } from '../packages/phynite-lab/lib/cloud-config.mjs';
import { validateNativeInventory } from '../packages/phynite-lab/lib/native-inventory.mjs';
import { aggregateBundledJsNotices } from './bundled-js-notices.mjs';
import { validateBundledNoticeIndex } from '../packages/phynite-lab/lib/bundled-notices.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), options = {}, inputs = { core: [], notices: [], standalone: [], bootstrap: [] };
const usage = 'Usage: node scripts/package-local.mjs --core [TARGET=]EXECUTABLE --notices [TARGET=]NOTICES --source-commit FULL_PUBLIC_COMMIT [--target TARGET] [--standalone [TARGET=]DIRECTORY] [--bootstrap TARGET=DIRECTORY] [--output DIRECTORY] [--cloud-config PUBLIC_CONFIG_JSON | --offline-only]';
for (let i = 0; i < args.length; i++) {
  const name = args[i];
  if (name === '--offline-only') { options.offlineOnly = true; continue; }
  const value = args[++i], key = name.slice(2);
  if (!['core', 'notices', 'target', 'output', 'standalone', 'bootstrap', 'cloud-config', 'source-commit'].includes(key) || !value || value.startsWith('--')) throw new Error(usage);
  if (key in inputs) inputs[key].push(value);
  else {
    if (options[key]) throw new Error(`Repeated option: ${name}`);
    options[key] = value;
  }
}
if (!inputs.core.length || !inputs.notices.length) throw new Error('A real frozen core executable and its third-party license notices are required. Build the core before packaging.');
const source = releaseSource(options['source-commit']);
if (options.offlineOnly && options['cloud-config']) throw new Error('Choose either --offline-only or --cloud-config.');
let cloud;
if (!options.offlineOnly) {
  let document;
  try { document = JSON.parse(await readFile(options['cloud-config'] ? resolve(options['cloud-config']) : join(root, 'config', 'phynite-cloud.public.json'), 'utf8')); }
  catch { throw new Error('Cannot read the public cloud configuration JSON. No configuration values were logged.'); }
  cloud = validateCloudConfig(document);
}
const defaultTarget = options.target ?? distributionPlatform();
if (!DISTRIBUTION_TARGETS.includes(defaultTarget)) throw new Error('Unsupported runtime target.');
function targetPaths(values, label, targets) {
  const result = {};
  for (const value of values) {
    const split = value.indexOf('='), target = split < 0 ? defaultTarget : value.slice(0, split);
    if (split < 0 && targets?.length > 1) throw new Error(`${label} must name its target for a multi-platform assembly.`);
    if (!DISTRIBUTION_TARGETS.includes(target) || result[target] || split === value.length - 1) throw new Error(`Unsupported or repeated ${label} target.`);
    result[target] = resolve(split < 0 ? value : value.slice(split + 1));
  }
  return result;
}
const cores = targetPaths(inputs.core, 'core'), targets = Object.keys(cores);
const notices = targetPaths(inputs.notices, 'notices', targets);
const standalones = targetPaths(inputs.standalone, 'standalone', targets);
const bootstraps = targetPaths(inputs.bootstrap, 'bootstrap', targets);
for (const target of targets) {
  if (!notices[target]) throw new Error(`Core notices for ${target} are required.`);
  if (!standalones[target]) {
    if (targets.length > 1) throw new Error(`The standalone application built for ${target} is required.`);
    standalones[target] = join(root, 'dist', 'standalone');
  }
  if (target.startsWith('linux-') && !bootstraps[target]) throw new Error(`The verified isolation bootstrap for ${target} is required.`);
  const info = await lstat(cores[target]);
  if (!info.isFile() || info.isSymbolicLink() || !info.size) throw new Error('Core must be a nonempty regular executable, not a symlink.');
  await stat(join(standalones[target], 'server.js'));
  if (!(await readFile(notices[target], 'utf8')).trim()) throw new Error('Core notices cannot be empty.');
  const nativeInventory = JSON.parse(await readFile(join(dirname(notices[target]), 'THIRD_PARTY_NATIVE.json'), 'utf8'));
  validateNativeInventory(nativeInventory, createHash('sha256').update(await readFile(cores[target])).digest('hex'), createHash('sha256').update(await readFile(notices[target])).digest('hex'));
}
for (const mapping of [notices, standalones, bootstraps]) if (Object.keys(mapping).some(target => !cores[target])) throw new Error('An input targets a platform with no supplied core.');
const output = resolve(options.output ?? join(root, 'build', 'npm', 'release'));
await mkdir(dirname(output), { recursive: true });
await mkdir(output, { recursive: false });
const template = join(root, 'packages', 'phynite-lab');
const packageTemplate = JSON.parse(await readFile(join(template, 'package.json'), 'utf8'));
const version = packageTemplate.version;
const license = await readFile(join(root, 'LICENSE'), 'utf8');
let assetNotices;
try { assetNotices = await readFile(join(root, 'NOTICE.md'), 'utf8'); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  assetNotices = await readFile(join(root, 'distribution/local-source/NOTICE.md'), 'utf8');
}
if (!assetNotices.trim()) throw new Error('Application and asset attribution notices are required.');
if (!license.includes('GNU AFFERO GENERAL PUBLIC LICENSE') || !license.includes('Version 3, 19 November 2007')) throw new Error('The complete GNU AGPL v3 license must be present before packaging.');
const launcher = join(output, 'phynite-lab');
await mkdir(launcher);
for (const item of ['bin', 'lib', 'README.md']) await cp(join(template, item), join(launcher, item), { recursive: true });
await writeFile(join(launcher, 'LICENSE'), license);
await writeFile(join(launcher, 'THIRD_PARTY_NOTICES.md'), '# Third-party notices\n\nPhynite Lab code is licensed under GNU AGPL v3 only. Native application dependencies retain the licenses and notices included in each platform package.\n\n' + assetNotices);
const optionalDependencies = Object.fromEntries(DISTRIBUTION_TARGETS.map(target => [platformPackageName(target), version]));
await writeFile(join(launcher, 'package.json'), `${JSON.stringify({ ...packageTemplate, optionalDependencies }, null, 2)}\n`);
await writeFile(join(launcher, 'distribution.json'), `${JSON.stringify({ schemaVersion: 2, kind: 'launcher', version, source,
  targets: Object.fromEntries(DISTRIBUTION_TARGETS.map(target => [target, { package: platformPackageName(target), version }])), ...(cloud ? { cloud } : {}) }, null, 2)}\n`);
await chmod(join(launcher, 'bin', 'phynite-lab.mjs'), 0o755);
await checkDistribution(launcher);
const runtimes = {};
const filter = base => path => !prohibitedDistributionPath(relative(base, path))
  && !/(?:^|\/)downloads\/phynite-local-compute\.tar\.gz(?:\.sha256)?$/.test(relative(base, path));
for (const target of targets) {
  const name = platformPackageName(target), destination = join(output, name), standalone = await realpath(standalones[target]);
  const [os, cpu] = target.split('-');
  const bundled = await aggregateBundledJsNotices(standalone);
  const bundledIndex = validateBundledNoticeIndex({ ...bundled.manifest, reports: bundled.manifest.reports.map(report => ({ ...report, path: `app/${report.path}` })) });
  await mkdir(join(destination, 'app'), { recursive: true });
  for (const item of ['server.js', 'package.json', 'dist', 'public']) await cp(join(standalone, item), join(destination, 'app', item), { recursive: true, dereference: false, filter: filter(standalone) });
  // Arbitrary nested node_modules are omitted by npm. Declare every copied
  // runtime dependency as bundled at the platform package root.
  const runtimeClosure = await localRuntimeClosure(standalone);
  await mkdir(join(destination, 'node_modules'));
  for (const [name, item] of runtimeClosure.packages) {
    await mkdir(dirname(join(destination, 'node_modules', name)), { recursive: true });
    const include = path => filter(standalone)(path) && (name !== 'vinext' || !path.startsWith(join(item.root, 'dist')) || runtimeClosure.vinextFiles.has(path) || runtimeClosure.vinextDirectories.has(path));
    await cp(item.root, join(destination, 'node_modules', name), { recursive: true, dereference: false, filter: include });
    if (name === 'vinext') {
      const metadata = { ...item.metadata };
      for (const field of ['main', 'module', 'types', 'bin', 'files', 'scripts', 'dependencies', 'optionalDependencies', 'devDependencies', 'peerDependencies', 'peerDependenciesMeta']) delete metadata[field];
      metadata.exports = { './server/prod-server': { import: './dist/server/prod-server.js' } };
      await writeFile(join(destination, 'node_modules', name, 'package.json'), `${JSON.stringify(metadata, null, 2)}\n`);
    }
  }
  await writeFile(join(destination, 'runtime-closure.json'), `${JSON.stringify(runtimeClosure.manifest, null, 2)}\n`);
  const dependencies = {}, optionalRuntimeDependencies = {}, dependencyNotices = [];
  async function removeInstallHooks(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await removeInstallHooks(path);
      // Native distributions contain prebuilt binaries, including sharp's
      // nested src/binding.gyp. No build descriptor belongs in the tarball.
      else if (entry.name === 'binding.gyp' && entry.isFile()) await rm(path);
      else if (entry.name === 'package.json' && entry.isFile()) {
        const metadata = JSON.parse(await readFile(path, 'utf8'));
        let modified = false;
        for (const hook of ['preinstall', 'install', 'postinstall', 'prepare']) {
          if (metadata.scripts?.[hook]) { delete metadata.scripts[hook]; modified = true; }
        }
        if (modified) await writeFile(path, `${JSON.stringify(metadata, null, 2)}\n`);
      }
    }
  }
  await removeInstallHooks(join(destination, 'node_modules'));
  async function readDependency(path) {
    const packageJson = JSON.parse(await readFile(join(path, 'package.json'), 'utf8'));
    const matches = (rules, value) => !Array.isArray(rules) || (!rules.includes(`!${value}`) && (!rules.some(rule => !rule.startsWith('!')) || rules.includes(value) || rules.includes('any')));
    if (!matches(packageJson.os, os) || !matches(packageJson.cpu, cpu) || os === 'linux' && !matches(packageJson.libc, 'glibc')) throw new Error(`Standalone dependency ${packageJson.name} does not support ${target}. Supply its native standalone build.`);
    (packageJson.os || packageJson.cpu || packageJson.libc ? optionalRuntimeDependencies : dependencies)[packageJson.name] = packageJson.version;
    const isNotice = name => /^(license|licence|notice|copying)(?:[.-]|$)|^third[-_ ]party.*(?:license|notice)/i.test(name);
    const texts = [], sources = [path], installed = join(root, 'node_modules', packageJson.name);
    try {
      const original = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
      if (original.name === packageJson.name && original.version === packageJson.version) sources.push(installed);
    } catch { /* A package may exist only in the isolated standalone build. */ }
    const seen = new Set();
    for (const origin of sources) for (const file of (await readdir(origin)).filter(isNotice)) {
      if (!seen.has(file) && (await stat(join(origin, file))).isFile()) { texts.push(`${file}\n${await readFile(join(origin, file), 'utf8')}`); seen.add(file); }
    }
    if (!texts.length) throw new Error(`Actual license/notice text is required for ${packageJson.name}; a license identifier alone is insufficient.`);
    dependencyNotices.push(`## ${packageJson.name} ${packageJson.version}\nLicense: ${packageJson.license ?? 'See notice below'}\n\n${texts.join('\n\n')}`);
  }
  for (const dependency of await readdir(join(destination, 'node_modules'))) {
    if (dependency.startsWith('.')) continue;
    const path = join(destination, 'node_modules', dependency);
    if (dependency.startsWith('@')) for (const child of await readdir(path)) await readDependency(join(path, child));
    else await readDependency(path);
  }
  await mkdir(join(destination, 'lib'));
  for (const file of ['distribution.mjs', 'check-distribution.mjs', 'cloud-config.mjs', 'native-inventory.mjs', 'bundled-notices.mjs']) await cp(join(template, 'lib', file), join(destination, 'lib', file));
  const runtimePackage = { name, version, description: `Phynite Lab native application for ${target}`, type: 'module', license: 'AGPL-3.0-only',
    repository: packageTemplate.repository, homepage: packageTemplate.homepage, bugs: packageTemplate.bugs,
    engines: packageTemplate.engines, os: [os], cpu: [cpu],
    files: ['app/', 'core/', 'bootstrap/', 'lib/', 'runtime-closure.json', 'bundled-notices.json', 'distribution.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'README.md'],
    scripts: { prepack: 'node lib/check-distribution.mjs' }, publishConfig: { access: 'public' },
    dependencies, optionalDependencies: optionalRuntimeDependencies, bundledDependencies: [...Object.keys(dependencies), ...Object.keys(optionalRuntimeDependencies)].sort() };
  await writeFile(join(destination, 'package.json'), `${JSON.stringify(runtimePackage, null, 2)}\n`);
  await writeFile(join(destination, 'LICENSE'), license);
  await writeFile(join(destination, 'README.md'), `# ${name}\n\nNative application for Phynite Lab ${version}. Install the phynite-lab launcher; npm selects this optional package for ${target}.\n\nLicense: GNU AGPL v3 only. Corresponding source, including build scripts: ${source.url}\nSource archive: ${source.archiveUrl}\n\nThird-party components retain their own licenses in THIRD_PARTY_NOTICES.md. Scientific solver downloads are separate.\n`);
  await writeFile(join(destination, 'THIRD_PARTY_NOTICES.md'), `# Third-party notices\n\nPhynite Lab code is licensed under GNU AGPL v3 only. Third-party licenses apply to their respective components. Vinext is reduced to its reviewed production-server module graph, with internal package exports and dependency metadata adapted to that graph; every emitted application route and lazy chunk is retained. Unused optional image/OG development dependencies are omitted. Production dependency installation lifecycle scripts and binding.gyp files are removed from this binary distribution; runtime files and original license notices are retained. Corresponding dependency source remains identified by its exact package name/version below.\n\n${assetNotices}\n\n${await readFile(notices[target], 'utf8')}\n\n${dependencyNotices.sort().join('\n\n')}\n\n${bundled.text}`);
  await writeFile(join(destination, 'bundled-notices.json'), `${JSON.stringify(bundledIndex, null, 2)}\n`);
  const bundledNotices = { path: 'bundled-notices.json', sha256: createHash('sha256').update(await readFile(join(destination, 'bundled-notices.json'))).digest('hex'), noticesSha256: createHash('sha256').update(await readFile(join(destination, 'THIRD_PARTY_NOTICES.md'))).digest('hex') };
  const coreDirectory = join(destination, 'core', target);
  await mkdir(coreDirectory, { recursive: true });
  await cp(cores[target], join(coreDirectory, 'phynite-core')); await chmod(join(coreDirectory, 'phynite-core'), 0o755);
  await cp(notices[target], join(coreDirectory, 'THIRD_PARTY_NOTICES.md'));
  await cp(join(dirname(notices[target]), 'THIRD_PARTY_NATIVE.json'), join(coreDirectory, 'THIRD_PARTY_NATIVE.json'));
  const nativeInventory = { path: `core/${target}/THIRD_PARTY_NATIVE.json`, sha256: createHash('sha256').update(await readFile(join(coreDirectory, 'THIRD_PARTY_NATIVE.json'))).digest('hex'), notices: `core/${target}/THIRD_PARTY_NOTICES.md` };
  const core = { executable: `core/${target}/phynite-core`, sha256: createHash('sha256').update(await readFile(cores[target])).digest('hex') };
  let bootstrap;
  if (bootstraps[target]) {
    await cp(bootstraps[target], join(destination, 'bootstrap'), { recursive: true, dereference: false });
    const document = JSON.parse(await readFile(join(destination, 'bootstrap', 'manifest.json'), 'utf8'));
    if (document.schemaVersion !== 1 || document.target !== target || !document.tools?.bwrap) throw new Error('The native isolation bootstrap manifest does not match its target.');
    bootstrap = { directory: 'bootstrap', sha256: createHash('sha256').update(await readFile(join(destination, 'bootstrap', 'manifest.json'))).digest('hex') };
  }
  await writeFile(join(destination, 'distribution.json'), `${JSON.stringify({ schemaVersion: 2, kind: 'runtime', target, version, source, targets: { [target]: core }, nativeInventory, bundledNotices, ...(bootstrap ? { bootstrap } : {}) }, null, 2)}\n`);
  await checkDistribution(destination);
  runtimes[target] = { name, directory: name };
}
await writeFile(join(output, 'assembly.json'), `${JSON.stringify({ schemaVersion: 2, format: 'phynite-local-release', version, source, launcher: { name: 'phynite-lab', directory: 'phynite-lab' }, runtimes }, null, 2)}\n`);
console.log(`Verified release packages: ${output}\nPack each package directory separately. Publish every platform package before publishing the launcher. No package was published.`);

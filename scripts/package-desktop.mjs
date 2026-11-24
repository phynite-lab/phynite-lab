import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const desktop = join(root, 'desktop');
const target = 'aarch64-apple-darwin';
const runtime = 'phynite-lab-runtime-darwin-arm64';
const nodeVersion = '22.23.5';
const nodeDirectory = `node-v${nodeVersion}-darwin-arm64`;
const nodeArchiveSha256 = 'e7131995759b61a0170b646010d2ad35a5d37b4cb0d471f3e8317eac6f742f3d';
const tauriVersion = '2.12.6';
const noticeName = /^(?:licen[cs]e|copyright|notice|copying)(?:[._-]|$)/i;
const upstreamNoticeFiles = {
  'alloc-stdlib': 'LICENSE',
  'selectors': 'https://www.mozilla.org/media/MPL/2.0/index.815ca599c9df.txt',
};

const { values } = parseArgs({
  options: {
    'node-archive': { type: 'string' },
    'core-dir': { type: 'string' },
    output: { type: 'string' },
  },
});
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Build desktop previews with native Node on macOS Apple Silicon.');
if (!values['node-archive'] || !values['core-dir'] || !values.output) {
  throw new Error('Usage: node scripts/package-desktop.mjs --node-archive PATH --core-dir DIRECTORY --output NEW_DIRECTORY');
}

const cleanEnvironment = { ...process.env };
// Keep the output path and signing behavior bound to this preview build.
delete cleanEnvironment.CARGO_TARGET_DIR;
delete cleanEnvironment.APPLE_SIGNING_IDENTITY;
const run = (command, args, { cwd = root, capture = false } = {}) => {
  const result = spawnSync(command, args, {
    cwd, env: cleanEnvironment, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.signal ?? result.status}).`);
  return result.stdout?.trim();
};
const sha256 = async path => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
};

async function cargoNotices(version) {
  const { packages } = JSON.parse(run('cargo', [
    'metadata', '--locked', '--filter-platform', target, '--format-version', '1',
  ], { cwd: desktop, capture: true }));
  if (packages.find(pkg => pkg.name === 'phynite-lab-desktop')?.version !== version) {
    throw new Error('Desktop Cargo package version must match the local launcher.');
  }
  return Promise.all(packages.filter(pkg => pkg.source).map(async pkg => {
    const path = dirname(pkg.manifest_path);
    const files = (await readdir(path, { withFileTypes: true }))
      .filter(file => file.isFile() && noticeName.test(file.name)).map(file => file.name).sort();
    if (pkg.license_file && !files.includes(pkg.license_file)) files.push(pkg.license_file);
    const notices = await Promise.all(files.map(async file => `${file}\n\n${await readFile(join(path, file), 'utf8')}`));
    if (!notices.length) {
      const fallback = pkg.repository === 'https://github.com/madsmtm/objc2' ? 'LICENSE.md' : upstreamNoticeFiles[pkg.name];
      if (!fallback) throw new Error(`Missing original license notice for ${pkg.name} ${pkg.version}.`);
      const vcs = JSON.parse(await readFile(join(path, '.cargo_vcs_info.json'), 'utf8'));
      const repository = pkg.repository.match(/^https:\/\/github\.com\/([\w-]+\/[\w-]+)$/)?.[1];
      if (!repository || !/^[a-f0-9]{40}$/.test(vcs.git?.sha1 ?? '')) throw new Error(`Missing upstream revision for ${pkg.name}.`);
      const url = fallback.startsWith('https://') ? fallback : `https://raw.githubusercontent.com/${repository}/${vcs.git.sha1}/${fallback}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`Could not retrieve licensed upstream notice ${url} (${response.status}).`);
      notices.push(`${url}\n\n${await response.text()}`);
    }
    return `## ${pkg.name} ${pkg.version}\n\nLicense: ${pkg.license ?? 'See original notice'}\nSource: https://crates.io/api/v1/crates/${pkg.name}/${pkg.version}/download\n\n${notices.join('\n\n')}`;
  }));
}

const output = resolve(values.output);
const core = resolve(values['core-dir']);
const nodeArchive = resolve(values['node-archive']);
const sourceCommit = run('git', ['rev-parse', 'HEAD'], { capture: true });
if (run('git', ['status', '--porcelain'], { capture: true })) {
  throw new Error('Commit the corresponding source and build from a clean checkout before assembling preview artifacts.');
}
if (await sha256(nodeArchive) !== nodeArchiveSha256) throw new Error(`Expected the verified official ${nodeDirectory}.tar.gz distribution.`);
await mkdir(dirname(output), { recursive: true });
await mkdir(output);
const temporary = await mkdtemp(join(tmpdir(), 'phynite-desktop-'));
const payload = join(desktop, 'payload');
try {
  run('/usr/bin/tar', ['-xzf', nodeArchive, '-C', temporary, `${nodeDirectory}/bin/node`, `${nodeDirectory}/LICENSE`]);
  const extracted = join(temporary, nodeDirectory);
  const bundledNode = join(extracted, 'bin', 'node');
  const { version } = JSON.parse(await readFile(join(root, 'packages', 'phynite-lab', 'package.json'), 'utf8'));
  const notices = await cargoNotices(version);
  const wasmTarget = 'wasm32-unknown-unknown';
  const wasmOutput = join(temporary, 'wasm');
  run(process.env.PHYNITE_WASM_CARGO || 'cargo', ['build', '--locked', '--release',
    '--target', wasmTarget, '--manifest-path', join(root, 'native/md-parser/Cargo.toml'), '--target-dir', wasmOutput]);
  const assembly = join(temporary, 'assembly');
  run(bundledNode, [join(root, 'scripts', 'package-local.mjs'), '--target', 'darwin-arm64',
    '--core', join(core, 'phynite-core'), '--notices', join(core, 'THIRD_PARTY_NOTICES.md'),
    '--desktop-core', '--desktop-md-parser', join(wasmOutput, wasmTarget, 'release/phynite_md_parser.wasm'),
    '--source-commit', sourceCommit, '--output', assembly]);
  const staged = join(temporary, 'payload');
  const launcher = join(staged, 'phynite-lab');
  await cp(join(assembly, 'phynite-lab'), launcher, { recursive: true });
  await mkdir(join(launcher, 'node_modules'));
  await cp(join(assembly, runtime), join(launcher, 'node_modules', runtime), { recursive: true });
  await cp(join(desktop, 'launcher.mjs'), join(staged, 'launcher.mjs'));
  await cp(bundledNode, join(staged, 'node'));
  await cp(join(extracted, 'LICENSE'), join(staged, 'NODE-LICENSE.txt'));
  await writeFile(join(staged, 'RUST-THIRD-PARTY-NOTICES.md'), `# Tauri desktop dependency notices\n\n${notices.join('\n\n')}`);
  await writeFile(join(staged, 'desktop-build.json'), JSON.stringify({
    sourceCommit,
    target,
    nodeVersion,
    nodeArchiveSha256,
    nodeSource: `https://nodejs.org/dist/v${nodeVersion}/node-v${nodeVersion}.tar.xz`,
    tauriVersion,
  }, null, 2) + '\n');

  await rm(payload, { recursive: true, force: true });
  await cp(staged, payload, { recursive: true });
  run('npm', ['exec', '--yes', '--package', `@tauri-apps/cli@${tauriVersion}`, '--package',
    `@tauri-apps/cli-darwin-arm64@${tauriVersion}`, '--', 'tauri', 'build', '--ci', '--target',
    target, '--bundles', 'app', '--no-sign', '--no-binary-patching', '--', '--locked'], { cwd: desktop });
  const productName = 'Phynite Lab';
  const appName = `${productName}.app`;
  const app = join(output, appName);
  run('/usr/bin/ditto', [join(desktop, 'target', target, 'release', 'bundle', 'macos', appName), app]);
  run('/usr/bin/codesign', ['--force', '--sign', '-', app]);
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
  const appPayload = join(app, 'Contents', 'Resources', 'payload');
  run(join(appPayload, 'node'), [join(appPayload, 'phynite-lab', 'bin', 'phynite-lab.mjs'), 'doctor',
    '--data-dir', join(temporary, 'doctor-workspace')]);

  const dmgSource = join(temporary, 'dmg');
  await mkdir(dmgSource);
  run('/usr/bin/ditto', [app, join(dmgSource, appName)]);
  await symlink('/Applications', join(dmgSource, 'Applications'));
  const stem = 'Phynite-Lab-macOS-arm64-preview';
  const artifacts = [`${stem}.app.zip`, `${stem}.dmg`, 'corresponding-source.tar.gz'];
  run('/usr/bin/ditto', ['-c', '-k', '--keepParent', app, join(output, artifacts[0])]);
  run('/usr/bin/hdiutil', ['create', '-fs', 'HFS+', '-format', 'UDZO', '-volname', productName,
    '-srcfolder', dmgSource, join(output, artifacts[1])]);
  run('/usr/bin/hdiutil', ['verify', join(output, artifacts[1])]);
  run('git', ['archive', '--format=tar.gz', `--prefix=phynite-lab-${sourceCommit}/`,
    `--output=${join(output, artifacts[2])}`, sourceCommit]);
  await writeFile(join(output, 'SHA256SUMS'), (await Promise.all(artifacts.map(async name =>
    `${await sha256(join(output, name))}  ${name}`))).join('\n') + '\n');
  console.log(`Desktop preview built at ${app}`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}

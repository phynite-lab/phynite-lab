/** Synthetic evidence fixtures exercise rejection rules; they do not qualify a scientific runtime. */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { DISTRIBUTION_TARGETS, platformPackageName, releaseSource } from '../packages/phynite-lab/lib/distribution.mjs';
import { RELEASE_TARGETS, SCIENTIFIC_CHECKS, SMOKE_CHECKS, collectReleaseEvidence, prepareLocalRelease, sha256, verifyLocalRelease } from '../scripts/verify-local-release.mjs';
import { publishLocalRelease } from '../scripts/publish-local-release.mjs';

const exec = promisify(execFile);
const version = '0.1.0';
const license = 'GNU AFFERO GENERAL PUBLIC LICENSE\nVersion 3, 19 November 2007\nSynthetic test placeholder; never a distributable license fixture.';
let base: Promise<string> | undefined;
after(async () => { if (base) await rm(await base, { recursive: true }); });
async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'phynite-release-gate-fixture-'));
  const source = join(root, 'git-source'); await mkdir(source);
  await exec('git', ['init', '-q'], { cwd: source });
  await writeFile(join(source, 'README.md'), 'Synthetic gate fixture only. Not scientific evidence.\n');
  await writeFile(join(source, 'LICENSE'), license);
  await exec('git', ['add', 'README.md', 'LICENSE'], { cwd: source });
  await exec('git', ['-c', 'user.name=Gate Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'fixture'], { cwd: source });
  const commit = (await exec('git', ['rev-parse', 'HEAD'], { cwd: source })).stdout.trim();
  await exec('git', ['archive', '--format=tar.gz', '--prefix=fixture/', '--output', join(root, 'source.tar.gz'), commit], { cwd: source });
  await mkdir(join(root, 'tarballs'));
  const packages = [];
  for (const target of [undefined, ...DISTRIBUTION_TARGETS]) {
    const name = target ? platformPackageName(target) : 'phynite-lab', directory = join(root, 'assembly', name, 'package');
    await mkdir(directory, { recursive: true });
    const metadata = { name, version, license: 'AGPL-3.0-only', ...(target ? { os: [target.split('-')[0]], cpu: [target.split('-')[1]], dependencies: { 'synthetic-bundled-runtime': '0.0.0' }, bundledDependencies: ['synthetic-bundled-runtime'] }
      : { optionalDependencies: Object.fromEntries(DISTRIBUTION_TARGETS.map(value => [platformPackageName(value), version])) }) };
    const manifest: Record<string, any> = { schemaVersion: 2, kind: target ? 'runtime' : 'launcher', version, source: releaseSource(commit), ...(target ? { target } : { targets: Object.fromEntries(DISTRIBUTION_TARGETS.map(value => [value, { package: platformPackageName(value), version }])) }) }; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (target) {
      await mkdir(join(directory, 'node_modules/synthetic-bundled-runtime'), { recursive: true });
      await writeFile(join(directory, 'node_modules/synthetic-bundled-runtime/package.json'), JSON.stringify({ name: 'synthetic-bundled-runtime', version: '0.0.0' }));
      const corePath = `core/${target}/phynite-core`, inventoryPath = `core/${target}/THIRD_PARTY_NATIVE.json`, noticePath = `core/${target}/THIRD_PARTY_NOTICES.md`;
      await mkdir(join(directory, 'core', target), { recursive: true });
      await writeFile(join(directory, corePath), 'Synthetic test core; no native qualification.');
      await writeFile(join(directory, noticePath), 'Synthetic gate native notice.');
      const coreSha = await sha256(join(directory, corePath)), noticeSha = await sha256(join(directory, noticePath));
      const inventory = { schemaVersion: 1, executableSha256: coreSha, noticesSha256: noticeSha, builder: { name: 'PyInstaller', version: 'synthetic' },
        nativeFiles: [{ path: 'synthetic.so', sha256: coreSha, sourceSha256: coreSha, bytes: 1, provider: 'python:synthetic' }],
        components: [{ id: 'python:synthetic', kind: 'python', name: 'Synthetic', version: '0.0.0', provenance: { ownership: 'Synthetic test fixture only' }, notices: [{ name: 'LICENSE.txt', sha256: noticeSha }] }] };
      const inventoryText = JSON.stringify(inventory);
      await writeFile(join(directory, inventoryPath), inventoryText);
      manifest.targets = { [target]: { executable: corePath, sha256: coreSha } };
      manifest.nativeInventory = { path: inventoryPath, sha256: createHash('sha256').update(inventoryText).digest('hex'), notices: noticePath };
      const reports = [];
      for (const environment of ['client', 'rsc', 'ssr']) {
        const path = `app/dist/${environment}/phynite-bundled-notices.json`, code = 'export const syntheticBundledFixture = true;\n';
        await mkdir(dirname(join(directory, path)), { recursive: true });
        await writeFile(join(directory, dirname(path), 'entry.js'), code);
        await writeFile(join(directory, path), JSON.stringify({ schemaVersion: 1, format: 'phynite-bundled-js-notices', environment, complete: true, packages: [],
          chunks: [{ path: 'entry.js', sha256: createHash('sha256').update(code).digest('hex'), bytes: Buffer.byteLength(code) }], assets: [], missing: [] }));
        reports.push({ path, sha256: await sha256(join(directory, path)), environment });
      }
      await writeFile(join(directory, 'bundled-notices.json'), JSON.stringify({ schemaVersion: 1, format: 'phynite-bundled-js-notice-index', reports, packages: [] }));
      manifest.bundledNotices = { path: 'bundled-notices.json', sha256: await sha256(join(directory, 'bundled-notices.json')), noticesSha256: createHash('sha256').update('Synthetic gate fixture.').digest('hex') };
    }
    await writeFile(join(directory, 'package.json'), JSON.stringify(metadata));
    await writeFile(join(directory, 'distribution.json'), JSON.stringify(manifest));
    await writeFile(join(directory, 'LICENSE'), license);
    await writeFile(join(directory, 'THIRD_PARTY_NOTICES.md'), 'Synthetic gate fixture.');
    const path = `tarballs/${name}-${version}.tgz`;
    await exec('tar', ['-czf', join(root, path), '-C', dirname(directory), 'package']);
    packages.push({ name, version, path, sha256: await sha256(join(root, path)), ...(target ? { target } : {}) });
  }
  const evidence = [];
  for (const target of RELEASE_TARGETS) {
    const native = target.replace(/^wsl2-/, ''), [platform, arch] = native.split('-'), wsl2 = target.startsWith('wsl2-');
    const common = { schemaVersion: 1, passed: true, version, sourceCommit: commit, target,
      environment: { platform, arch, nodeVersion: 'v22.13.0', glibcVersion: '2.39', kernelRelease: wsl2 ? '6.6.87.2-microsoft-standard-WSL2' : '6.8.0-test-fixture', wsl2 },
      packages: { launcherSha256: packages[0].sha256, runtimeSha256: packages.find(item => item.name === platformPackageName(native))!.sha256 } };
    const smokeDir = join(root, 'evidence', target, 'smoke'), scienceDir = join(root, 'evidence', target, 'scientific');
    await mkdir(smokeDir, { recursive: true }); await mkdir(scienceDir, { recursive: true });
    await writeFile(join(smokeDir, 'synthetic.log'), 'Synthetic gate fixture only.');
    const smoke = { ...common, format: 'phynite-local-distribution-smoke', checkIds: SMOKE_CHECKS,
      artifacts: [{ path: 'synthetic.log', sha256: await sha256(join(smokeDir, 'synthetic.log')) }] };
    await writeFile(join(smokeDir, 'report.json'), JSON.stringify(smoke));
    await writeFile(join(scienceDir, 'output.txt'), 'Synthetic test output. Not solver output.\n');
    const outputSha256 = await sha256(join(scienceDir, 'output.txt'));
    await writeFile(join(scienceDir, 'input.json'), 'Synthetic test input.');
    const inputSha256 = await sha256(join(scienceDir, 'input.json'));
    await writeFile(join(scienceDir, 'provenance.json'), JSON.stringify({ engine: 'synthetic-test-fixture', returnCode: 0, inputSha256, outputSha256 }));
    await writeFile(join(scienceDir, 'numeric.json'), JSON.stringify({ measurements: [{ name: 'synthetic-value', value: 1, expected: 1, tolerance: 0, unit: 'fixture' }] }));
    const attachments = await Promise.all(['input', 'output', 'provenance', 'numeric'].map(async kind => {
      const path = kind === 'output' ? 'output.txt' : `${kind}.json`; return { kind, path, sha256: await sha256(join(scienceDir, path)) };
    }));
    const scientific = { ...common, format: 'phynite-local-scientific-evidence', checks: SCIENTIFIC_CHECKS.map(id => ({ id, status: 'passed', execution: { returnCode: 0 }, attachments })) };
    await writeFile(join(scienceDir, 'report.json'), JSON.stringify(scientific));
    const descriptor = async (kind: string) => { const path = `evidence/${target}/${kind}/report.json`; return { path, sha256: await sha256(join(root, path)) }; };
    evidence.push({ target, smoke: await descriptor('smoke'), scientific: await descriptor('scientific') });
  }
  await writeFile(join(root, 'release.json'), JSON.stringify({ schemaVersion: 1, format: 'phynite-local-release-candidate', version,
    source: { repository: releaseSource(commit).repository, commit }, sourceArchive: { path: 'source.tar.gz', sha256: await sha256(join(root, 'source.tar.gz')) }, packages, evidence }));
  await rm(source, { recursive: true }); await rm(join(root, 'assembly'), { recursive: true });
  return root;
}
async function fixture() {
  base ??= createFixture();
  const destination = await mkdtemp(join(tmpdir(), 'phynite-release-gate-test-'));
  await cp(await base, destination, { recursive: true }); return destination;
}
async function editJson(path: string, edit: (value: Record<string, any>) => void) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const value = JSON.parse(await readFile(path, 'utf8')); edit(value); await writeFile(path, JSON.stringify(value));
}
async function editReport(root: string, target: string, kind: string, edit: (value: Record<string, any>) => void) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const path = `evidence/${target}/${kind}/report.json`; await editJson(join(root, path), edit);
  const hash = await sha256(join(root, path));
  await editJson(join(root, 'release.json'), value => { value.evidence.find((item: { target: string }) => item.target === target)[kind].sha256 = hash; });
}

test('complete synthetic schema validates offline and publisher defaults to a verified dry run', async () => {
  const root = await fixture();
  try {
    const verified = await verifyLocalRelease(join(root, 'release.json'));
    assert.equal(verified.packages.size, 5); assert.equal(verified.release.evidence.length, 6);
    const result = await publishLocalRelease(join(root, 'release.json'), { confirmVersion: version });
    assert.equal(result.published, false); assert.equal(result.order.at(-1), 'phynite-lab');
    await assert.rejects(publishLocalRelease(join(root, 'release.json'), { confirmVersion: '0.2.0' }), /confirm-version/);
  } finally { await rm(root, { recursive: true }); }
});

test('missing WSL2 target blocks publication even when all four native targets passed', async () => {
  const root = await fixture();
  try {
    await editJson(join(root, 'release.json'), value => { value.evidence = value.evidence.filter((item: { target: string }) => !item.target.startsWith('wsl2-')); });
    await assert.rejects(verifyLocalRelease(join(root, 'release.json')), /WSL2 x64 and ARM64/);
  } finally { await rm(root, { recursive: true }); }
});

test('explicit WSL2 deferral permits four native targets without claiming WSL2 qualification', async () => {
  const root = await fixture();
  try {
    await editJson(join(root, 'release.json'), value => {
      value.qualification = { wsl2: 'deferred', reason: 'Maintainer requested publication before WSL2 access is available.' };
      value.evidence = value.evidence.filter((item: { target: string }) => !item.target.startsWith('wsl2-'));
    });
    const verified = await verifyLocalRelease(join(root, 'release.json'));
    assert.equal(verified.release.evidence.length, 4);
    assert.equal((await publishLocalRelease(join(root, 'release.json'), { confirmVersion: version })).published, false);
    await editJson(join(root, 'release.json'), value => { value.evidence.pop(); });
    await assert.rejects(verifyLocalRelease(join(root, 'release.json')), /All four native/);
  } finally { await rm(root, { recursive: true }); }
});

test('WSL2 deferral requires a reason and cannot waive a native platform', async () => {
  const root = await fixture();
  try {
    await editJson(join(root, 'release.json'), value => { value.qualification = { wsl2: 'deferred', reason: '' }; });
    await assert.rejects(verifyLocalRelease(join(root, 'release.json')), /Invalid WSL2 deferral/);
    await editJson(join(root, 'release.json'), value => { value.qualification = { wsl2: 'deferred', reason: 'WSL2 untested', native: 'deferred' }; });
    await assert.rejects(verifyLocalRelease(join(root, 'release.json')), /native qualification cannot/);
  } finally { await rm(root, { recursive: true }); }
});

test('evidence from a different source commit or package tarball fails closed', async () => {
  for (const field of ['source', 'package']) {
    const root = await fixture();
    try {
      await editReport(root, 'linux-x64', 'scientific', value => { if (field === 'source') value.sourceCommit = 'b'.repeat(40); else value.packages.runtimeSha256 = 'b'.repeat(64); });
      await assert.rejects(verifyLocalRelease(join(root, 'release.json')), field === 'source' ? /release candidate/ : /different tarballs/);
    } finally { await rm(root, { recursive: true }); }
  }
});

test('a user-supplied WSL flag without a Microsoft WSL2 kernel marker cannot qualify', async () => {
  const root = await fixture();
  try {
    await editReport(root, 'wsl2-linux-arm64', 'scientific', value => { value.environment.kernelRelease = '6.8.0-generic'; });
    await assert.rejects(verifyLocalRelease(join(root, 'release.json')), /actual Microsoft WSL2/);
  } finally { await rm(root, { recursive: true }); }
});

test('unsupported glibc or Node baseline is rejected', async () => {
  for (const field of ['nodeVersion', 'glibcVersion']) {
    const root = await fixture();
    try {
      await editReport(root, 'linux-arm64', 'smoke', value => { value.environment[field] = field === 'nodeVersion' ? 'v22.12.0' : '2.38'; });
      await assert.rejects(verifyLocalRelease(join(root, 'release.json')), /baseline|Node.js/);
    } finally { await rm(root, { recursive: true }); }
  }
});

test('handwritten successful check names without attached output are insufficient', async () => {
  const root = await fixture();
  try {
    await editReport(root, 'darwin-arm64', 'scientific', value => { value.checks[1].attachments = []; });
    await assert.rejects(verifyLocalRelease(join(root, 'release.json')), /attached evidence/);
  } finally { await rm(root, { recursive: true }); }
});

test('mutated solver output and unsafe attachment paths are rejected', async () => {
  for (const unsafe of [false, true]) {
    const root = await fixture();
    try {
      if (unsafe) await editReport(root, 'darwin-x64', 'scientific', value => { value.checks[1].attachments[0].path = '../outside.txt'; });
      else await writeFile(join(root, 'evidence/darwin-x64/scientific/output.txt'), 'Tampered output');
      await assert.rejects(verifyLocalRelease(join(root, 'release.json')), unsafe ? /unsafe file/ : /SHA-256 mismatch/);
    } finally { await rm(root, { recursive: true }); }
  }
});

test('failed solver execution and numerical mismatch cannot be called qualification', async () => {
  for (const mode of ['exit', 'numeric']) {
    const root = await fixture();
    try {
      if (mode === 'exit') await editReport(root, 'linux-x64', 'scientific', value => { value.checks[1].execution.returnCode = 1; });
      else {
        const numeric = join(root, 'evidence/linux-x64/scientific/numeric.json');
        await editJson(numeric, value => { value.measurements[0].value = 100; });
        const hash = await sha256(numeric);
        await editReport(root, 'linux-x64', 'scientific', value => { for (const check of value.checks) check.attachments.find((item: { kind: string }) => item.kind === 'numeric').sha256 = hash; });
      }
      await assert.rejects(verifyLocalRelease(join(root, 'release.json')), mode === 'exit' ? /successful execution/ : /numerical reference/);
    } finally { await rm(root, { recursive: true }); }
  }
});

test('prepare builds a complete inventory and cannot overwrite an existing reviewed inventory', async () => {
  const root = await fixture();
  try {
    const original = JSON.parse(await readFile(join(root, 'release.json'), 'utf8')); await rm(join(root, 'release.json'));
    const result = await prepareLocalRelease(root, { version, sourceCommit: original.source.commit, sourceArchive: 'source.tar.gz' });
    assert.equal(result.release.source.commit, original.source.commit);
    await assert.rejects(prepareLocalRelease(root, { version, sourceCommit: original.source.commit, sourceArchive: 'source.tar.gz' }), /EEXIST/);
  } finally { await rm(root, { recursive: true }); }
});


test('public evidence collection excludes all unreferenced test identities and databases', async () => {
  const root = await fixture();
  try {
    const raw = join(root, 'evidence/linux-x64/smoke');
    await writeFile(join(raw, 'core-service.json'), 'private local opaque test token');
    await writeFile(join(raw, 'sessions.sqlite'), 'private test database');
    const output = join(root, 'collected');
    await collectReleaseEvidence(join(raw, 'report.json'), output);
    assert.equal(await readFile(join(output, 'synthetic.log'), 'utf8'), 'Synthetic gate fixture only.');
    await assert.rejects(readFile(join(output, 'core-service.json')), /ENOENT/);
    await assert.rejects(readFile(join(output, 'sessions.sqlite')), /ENOENT/);
    await editJson(join(raw, 'report.json'), value => { value.artifacts[0] = { path: 'sessions.sqlite', sha256: '' }; });
    const hash = await sha256(join(raw, 'sessions.sqlite'));
    await editJson(join(raw, 'report.json'), value => { value.artifacts[0].sha256 = hash; });
    await assert.rejects(collectReleaseEvidence(join(raw, 'report.json'), join(root, 'unsafe')), /Private test database/);
  } finally { await rm(root, { recursive: true }); }
});


test('native tarballs missing declared bundled dependencies are rejected before acceptance reports', async () => {
  const root = await fixture();
  try {
    const name = platformPackageName('darwin-arm64'), archive = join(root, `tarballs/${name}-${version}.tgz`), unpacked = join(root, 'unpacked');
    await mkdir(unpacked);
    await exec('tar', ['-xzf', archive, '-C', unpacked]);
    await rm(join(unpacked, 'package/node_modules'), { recursive: true });
    await exec('tar', ['-czf', archive, '-C', unpacked, 'package']);
    const hash = await sha256(archive);
    await editJson(join(root, 'release.json'), value => { value.packages.find((item: { name: string }) => item.name === name).sha256 = hash; });
    await assert.rejects(verifyLocalRelease(join(root, 'release.json')), /missing bundled dependency.*pack from the package root/);
  } finally { await rm(root, { recursive: true }); }
});

test('native core inventory binds the packaged executable and its exact full license text', async () => {
  for (const altered of ['executable', 'notice', 'missing-inventory']) {
    const root = await fixture();
    try {
      const name = platformPackageName('darwin-arm64'), archive = join(root, `tarballs/${name}-${version}.tgz`), unpacked = join(root, 'unpacked');
      await mkdir(unpacked);
      await exec('tar', ['-xzf', archive, '-C', unpacked]);
      const core = join(unpacked, 'package/core/darwin-arm64');
      if (altered === 'executable') await writeFile(join(core, 'phynite-core'), 'Changed binary payload');
      else if (altered === 'notice') await writeFile(join(core, 'THIRD_PARTY_NOTICES.md'), 'Changed notice text');
      else await editJson(join(unpacked, 'package/distribution.json'), value => { delete value.nativeInventory; });
      await exec('tar', ['-czf', archive, '-C', unpacked, 'package']);
      const hash = await sha256(archive);
      await editJson(join(root, 'release.json'), value => { value.packages.find((item: { name: string }) => item.name === name).sha256 = hash; });
      await assert.rejects(verifyLocalRelease(join(root, 'release.json')), /inventory|checksum/);
    } finally { await rm(root, { recursive: true }); }
  }
});

test('a static copyleft dependency cannot publish without matching corresponding source and rebuild scripts', async () => {
  const root = await fixture();
  try {
    const name = platformPackageName('darwin-arm64'), archive = join(root, `tarballs/${name}-${version}.tgz`), unpacked = join(root, 'unpacked');
    await mkdir(unpacked);
    await exec('tar', ['-xzf', archive, '-C', unpacked]);
    const inventoryPath = join(unpacked, 'package/core/darwin-arm64/THIRD_PARTY_NATIVE.json');
    await editJson(inventoryPath, value => {
      value.components[0] = { ...value.components[0], id: 'wheel:lxml@6.1.3', kind: 'wheel', name: 'lxml', version: '6.1.3', staticSourceEvidence: {
        manifest: 'distribution/notices/native/lxml-static-sources.json', manifestSha256: 'a'.repeat(64), rebuildScript: 'scripts/rebuild-lxml-native.py',
        archives: ['lxml', 'libiconv', 'libxml2', 'libxslt', 'zlib'].map(name => ({ name, version: '0.0.0-synthetic', path: `distribution/sources/native/${name}.tar.gz`, sha256: 'a'.repeat(64), bytes: 1 })),
      } };
      value.nativeFiles[0].provider = value.components[0].id;
    });
    const inventorySha = await sha256(inventoryPath);
    await editJson(join(unpacked, 'package/distribution.json'), value => { value.nativeInventory.sha256 = inventorySha; });
    await exec('tar', ['-czf', archive, '-C', unpacked, 'package']);
    const hash = await sha256(archive);
    await editJson(join(root, 'release.json'), value => { value.packages.find((item: { name: string }) => item.name === name).sha256 = hash; });
    await assert.rejects(verifyLocalRelease(join(root, 'release.json')), /corresponding rebuild script/);
  } finally { await rm(root, { recursive: true }); }
});

test('changed bundled application code and missing complete browser notices block publication', async () => {
  for (const altered of ['chunk', 'missing']) {
    const root = await fixture();
    try {
      const name = platformPackageName('darwin-arm64'), archive = join(root, `tarballs/${name}-${version}.tgz`), unpacked = join(root, 'unpacked');
      await mkdir(unpacked);
      await exec('tar', ['-xzf', archive, '-C', unpacked]);
      if (altered === 'chunk') await writeFile(join(unpacked, 'package/app/dist/client/entry.js'), 'Changed bundled browser code');
      else await editJson(join(unpacked, 'package/distribution.json'), value => { delete value.bundledNotices; });
      await exec('tar', ['-czf', archive, '-C', unpacked, 'package']);
      const hash = await sha256(archive);
      await editJson(join(root, 'release.json'), value => { value.packages.find((item: { name: string }) => item.name === name).sha256 = hash; });
      await assert.rejects(verifyLocalRelease(join(root, 'release.json')), /rendered application bytes|complete bundled JavaScript notices/);
    } finally { await rm(root, { recursive: true }); }
  }
});

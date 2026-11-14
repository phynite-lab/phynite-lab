import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer as createHttpServer } from 'node:http';
import { createHash } from 'node:crypto';
import { chmod, cp, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { distributionPlatform, parseArguments, requestJson, startupFailure, verifyDistribution } from '../packages/phynite-lab/lib/launcher.mjs';
import { checkDistribution, prohibitedDistributionPath } from '../packages/phynite-lab/lib/check-distribution.mjs';
import { validateCloudConfig } from '../packages/phynite-lab/lib/cloud-config.mjs';
import { DISTRIBUTION_TARGETS, platformPackageName, releaseSource, verifyRuntimePackage } from '../packages/phynite-lab/lib/distribution.mjs';
import { localRateLimiter } from '../lib/runtime-bindings.local.ts';

const modulePath = new URL('../packages/phynite-lab/lib/launcher.mjs', import.meta.url).href;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function launch(args: string[], packageRoot: string, env: Record<string, string> = {}) {
  const code = `import { runCli } from ${JSON.stringify(modulePath)}; await runCli(${JSON.stringify(args)}, { packageRoot: ${JSON.stringify(packageRoot)} });`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  const finished = new Promise<{ code: number | null; output: string }>(accept => child.once('exit', code => accept({ code, output })));
  return { child, finished, output: () => output };
}

async function fixture(directory: string, { stealWebPortOnce = false } = {}) {
  const target = distributionPlatform();
  const coreDirectory = join(directory, 'core', target);
  await mkdir(coreDirectory, { recursive: true }); await mkdir(join(directory, 'app'));
  await mkdir(join(directory, 'lib'));
  await writeFile(join(directory, 'lib', 'web-server.mjs'), await readFile(join(root, 'packages', 'phynite-lab', 'lib', 'web-server.mjs')));
  await writeFile(join(directory, 'package.json'), JSON.stringify({ name: 'phynite-cli-test-fixture', type: 'module', version: '0.0.0' }));
  await writeFile(join(directory, 'THIRD_PARTY_NOTICES.md'), 'Test-only process fixture. No scientific results are generated.');
  const executable = join(coreDirectory, 'phynite-core');
  await writeFile(executable, `#!${process.execPath}
import { createServer } from 'node:http';
import { writeFileSync, appendFileSync, existsSync } from 'node:fs';
const args = Object.fromEntries(Array.from({ length: (process.argv.length - 2) / 2 }, (_, i) => [process.argv[2 + i * 2], process.argv[3 + i * 2]]));
const dir = args['--data-dir'], port = Number(args['--port']), uiOrigin = args['--ui-origin'];
let competitor;
if (${stealWebPortOnce} && !existsSync(dir + '/stolen-web-origin')) {
 writeFileSync(dir + '/stolen-web-origin', uiOrigin);
 competitor = createServer((request, response) => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ mode: 'local', user: { id: 'another-workspace' } })); });
 competitor.listen(Number(new URL(uiOrigin).port), '127.0.0.1');
}
const token = 'fixture-service-session-token-with-32-characters';
writeFileSync(dir + '/core-service.json', JSON.stringify({ token, origin: 'http://127.0.0.1:' + port, uiOrigin }), { mode: 0o600 });
appendFileSync(dir + '/core-starts', 'start\\n');
writeFileSync(dir + '/core-cloud-config.json', JSON.stringify({ apiOrigin: process.env.PHYNITE_CLOUD_API_URL ?? null, region: process.env.PHYNITE_CLOUD_AWS_REGION ?? null, clientId: process.env.PHYNITE_CLOUD_COGNITO_CLIENT_ID ?? null }));
writeFileSync(dir + '/core-feature-flags.json', JSON.stringify({ notes: process.env.PHYNITE_PROJECT_NOTES ?? null, files: process.env.PHYNITE_CONNECTED_FILES ?? null }));
const server = createServer((request, response) => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(request.url === '/__local/session' ? { mode: 'local', user: { id: dir } } : { ready: true, environment: 'local' })); });
server.listen(port, '127.0.0.1');
process.on('SIGTERM', () => { server.close(); competitor?.close(); });
`);
  await chmod(executable, 0o755);
  await writeFile(join(directory, 'distribution.json'), JSON.stringify({ schemaVersion: 1, targets: { [target]: { executable: `core/${target}/phynite-core`, sha256: createHash('sha256').update(await readFile(executable)).digest('hex') } } }));
  await writeFile(join(directory, 'app', 'server.js'), `import { createServer } from 'node:http';
const server = createServer((request, response) => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(request.url === '/api/auth/session' ? { mode: 'local', user: { id: process.env.PHYNITE_DATA_DIR } } : { local: process.env.PHYNITE_APP_MODE === 'local', session: process.env.PHYNITE_LOCAL_SERVICE_TOKEN === 'fixture-service-session-token-with-32-characters', inheritedAws: !!process.env.AWS_SECRET_ACCESS_KEY, inheritedProvider: !!process.env.PHYNITE_AI_AUTH_TOKEN })); });
server.listen(Number(process.env.PORT), process.env.HOST);
process.on('SIGTERM', () => server.close());
`);
  return executable;
}

async function readInstance(dataDir: string) {
  try { return JSON.parse(await readFile(join(dataDir, 'runtime', 'instance.json'), 'utf8')); } catch { return null; }
}

async function waitForInstance(dataDir: string, output: () => string) {
  for (let count = 0; count < 150; count++) {
    const instance = await readInstance(dataDir);
    if (instance) return instance;
    await delay(50);
  }
  assert.fail(`CLI did not become ready: ${output()}`);
}

test('CLI accepts documented options and rejects unsupported arguments', () => {
  const options = parseArguments(['status', '--port', '4389', '--data-dir', '/tmp/custom-workspace', '--no-open'], '/home/test');
  assert.equal(options.command, 'status'); assert.equal(options.port, 4389); assert.equal(options.open, false);
  assert.equal(parseArguments([], '/home/test').dataDir, '/home/test/.phynite-lab');
  for (const args of [['--port', '0'], ['--port', '3000x'], ['--data-dir'], ['--host', '0.0.0.0'], ['start', 'stop']]) assert.throws(() => parseArguments(args));
  assert.equal(distributionPlatform('linux', 'x64'), 'linux-x64');
  assert.throws(() => distributionPlatform('win32', 'x64'), /WSL2/);
});

test('startup diagnostics identify the failed service and preserve actionable log context', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'phynite-startup-diagnostics-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const logPath = join(directory, 'core.log');
  await writeFile(logPath, 'first line\nAnother scheduler already owns this local workspace.\nsecret=do-not-print\n');
  const error = await startupFailure('core', { exitCode: 1, signalCode: null }, logPath);
  assert.match(error.message, /core service stopped during startup/);
  assert.match(error.message, /exited with code 1/);
  assert.match(error.message, /Another Phynite Lab process already owns this workspace/);
  assert.match(error.message, /secret=\[redacted\]/);
  assert.doesNotMatch(error.message, /do-not-print/);
  assert.match(error.message, /Local files were retained/);
});

test('launcher loopback control uses the native HTTP client and rejects non-loopback URLs', async t => {
  const server = createHttpServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ method: request.method, path: request.url }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const response = await requestJson(`http://127.0.0.1:${address.port}/status`, { timeout: 500 });
  assert.equal(response.ok, true);
  assert.deepEqual(await response.json(), { method: 'GET', path: '/status' });
  await assert.rejects(requestJson('https://example.invalid/status'), /loopback HTTP origin/);
});

test('CLI adopts a healthy source local workspace without starting a duplicate core', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'phynite-adopt-existing-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const dataDir = join(directory, 'data');
  await mkdir(join(dataDir, 'runtime'), { recursive: true });
  const identity = await realpath(dataDir);
  const token = 'fixture-existing-service-token-with-32-characters';
  const api = createHttpServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/__local/health') response.end(JSON.stringify({ ready: true, environment: 'local' }));
    else if (request.url === '/__local/session') response.end(JSON.stringify({ mode: 'local', user: { id: identity } }));
    else { response.statusCode = 404; response.end('{}'); }
  });
  const ui = createHttpServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(request.url === '/api/auth/session' ? { mode: 'local', user: { id: identity } } : {}));
  });
  await new Promise<void>(accept => api.listen(0, '127.0.0.1', accept));
  await new Promise<void>(accept => ui.listen(0, '127.0.0.1', accept));
  const apiPort = (api.address() as { port: number }).port, uiPort = (ui.address() as { port: number }).port;
  await writeFile(join(dataDir, 'core-service.json'), JSON.stringify({ token, origin: `http://127.0.0.1:${apiPort}`, uiOrigin: `http://127.0.0.1:${uiPort}` }), { mode: 0o600 });
  t.after(async () => {
    await new Promise<void>(accept => api.close(() => accept()));
    await new Promise<void>(accept => ui.close(() => accept()));
  });
  const result = await launch(['--no-open', '--data-dir', dataDir], join(directory, 'does-not-contain-a-package')).finished;
  assert.equal(result.code, 0);
  assert.match(result.output, /already running at/);
  assert.match(result.output, /healthy local service/);
});

test('distribution refuses missing and tampered core binaries and private files', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'phynite-distribution-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await assert.rejects(verifyDistribution(directory), /missing|incomplete distribution/);
  const executable = await fixture(directory);
  await checkDistribution(directory);
  await writeFile(join(directory, 'core-service.json'), '{}');
  await assert.rejects(checkDistribution(directory), /Prohibited distribution file/);
  await rm(join(directory, 'core-service.json'));
  await writeFile(executable, 'tampered');
  await assert.rejects(verifyDistribution(directory), /checksum/);
  for (const path of ['app/.env.local', 'app/server.js.map', 'app/.git/config', 'core/core-service.json', 'state/identity.json', 'app/.npmrc', 'app/.aws/credentials', 'app/.ssh/id_rsa', 'app/private.key', 'app/.venv/lib/python.py']) assert.equal(prohibitedDistributionPath(path), true);
  assert.equal(prohibitedDistributionPath('app/dist/server/index.js'), false);
});

async function splitFixture(directory: string, target = distributionPlatform()) {
  const version = '0.1.0', source = releaseSource('a'.repeat(40));
  const packageRoot = join(directory, 'node_modules', 'phynite-lab');
  const runtimeRoot = join(directory, 'node_modules', platformPackageName(target));
  await mkdir(packageRoot, { recursive: true }); await mkdir(runtimeRoot, { recursive: true });
  const originalExecutable = await fixture(runtimeRoot);
  const original = JSON.parse(await readFile(join(runtimeRoot, 'distribution.json'), 'utf8'));
  if (!original.targets[target]) {
    await mkdir(join(runtimeRoot, 'core', target));
    await cp(originalExecutable, join(runtimeRoot, 'core', target, 'phynite-core'));
    await chmod(join(runtimeRoot, 'core', target, 'phynite-core'), 0o755);
    const core = original.targets[distributionPlatform()];
    original.targets = { [target]: { ...core, executable: `core/${target}/phynite-core` } };
    await rm(join(runtimeRoot, 'core', distributionPlatform()), { recursive: true });
  }
  const [os, cpu] = target.split('-');
  const runtime = { schemaVersion: 2, kind: 'runtime', target, version, source, targets: original.targets, bootstrap: undefined as { directory: string; sha256: string } | undefined };
  if (os === 'linux') {
    const bootstrap = join(runtimeRoot, 'bootstrap'); await mkdir(bootstrap);
    const executable = join(bootstrap, 'bwrap');
    await writeFile(executable, '#!/bin/sh\nexit 1\n'); await chmod(executable, 0o755);
    const file = join(bootstrap, 'manifest.json');
    await writeFile(file, JSON.stringify({ schemaVersion: 1, target, tools: { bwrap: { executable: 'bwrap', sha256: createHash('sha256').update(await readFile(executable)).digest('hex'), libraries: [] } } }));
    runtime.bootstrap = { directory: 'bootstrap', sha256: createHash('sha256').update(await readFile(file)).digest('hex') };
  }
  await writeFile(join(runtimeRoot, 'package.json'), JSON.stringify({ name: platformPackageName(target), version, type: 'module', license: 'AGPL-3.0-only', os: [os], cpu: [cpu] }));
  await writeFile(join(runtimeRoot, 'distribution.json'), JSON.stringify(runtime));
  const packageJson = JSON.parse(await readFile(join(root, 'packages', 'phynite-lab', 'package.json'), 'utf8'));
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ ...packageJson, version, optionalDependencies: Object.fromEntries(DISTRIBUTION_TARGETS.map(platform => [platformPackageName(platform), version])) }));
  await writeFile(join(packageRoot, 'distribution.json'), JSON.stringify({ schemaVersion: 2, kind: 'launcher', version, source,
    targets: Object.fromEntries(DISTRIBUTION_TARGETS.map(platform => [platform, { package: platformPackageName(platform), version }])) }));
  await mkdir(join(packageRoot, 'lib'));
  await cp(join(root, 'packages', 'phynite-lab', 'lib', 'web-server.mjs'), join(packageRoot, 'lib', 'web-server.mjs'));
  for (const output of [packageRoot, runtimeRoot]) {
    await cp(join(root, 'LICENSE'), join(output, 'LICENSE'));
    await writeFile(join(output, 'THIRD_PARTY_NOTICES.md'), 'Process protocol fixture; no scientific output or actual solver.');
  }
  return { packageRoot, runtimeRoot, runtime, target, source, packageJson: { ...packageJson, version, optionalDependencies: Object.fromEntries(DISTRIBUTION_TARGETS.map(platform => [platformPackageName(platform), version])) } };
}

test('native optional package must match platform, exact version, source commit and checksum', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'phynite-native-selection-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { packageRoot, runtimeRoot, runtime, target, source, packageJson } = await splitFixture(directory);
  await checkDistribution(packageRoot); await checkDistribution(runtimeRoot);
  const valid = await verifyDistribution(packageRoot);
  assert.equal(valid.server, join(await realpath(runtimeRoot), 'app', 'server.js')); assert.equal(valid.source?.commit, source.commit);
  const runtimeMetadata = JSON.parse(await readFile(join(runtimeRoot, 'package.json'), 'utf8'));
  await writeFile(join(runtimeRoot, 'package.json'), JSON.stringify({ ...runtimeMetadata, cpu: ['wrong-architecture'] }));
  await assert.rejects(verifyDistribution(packageRoot), /platform or release/);
  await writeFile(join(runtimeRoot, 'package.json'), JSON.stringify({ ...runtimeMetadata, version: '0.2.0' }));
  await writeFile(join(runtimeRoot, 'distribution.json'), JSON.stringify({ ...runtime, version: '0.2.0' }));
  await assert.rejects(verifyDistribution(packageRoot), /version or corresponding source/);
  await writeFile(join(runtimeRoot, 'package.json'), JSON.stringify(runtimeMetadata));
  await writeFile(join(runtimeRoot, 'distribution.json'), JSON.stringify({ ...runtime, source: releaseSource('c'.repeat(40)) }));
  await assert.rejects(verifyDistribution(packageRoot), /version or corresponding source/);
  await writeFile(join(runtimeRoot, 'distribution.json'), JSON.stringify(runtime));
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ ...packageJson, optionalDependencies: { ...packageJson.optionalDependencies, [platformPackageName(target)]: '^0.1.0' } }));
  await assert.rejects(verifyDistribution(packageRoot), /exactly match/);
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify(packageJson));
  await writeFile(valid.executable, 'tampered core');
  await assert.rejects(verifyDistribution(packageRoot), /checksum/);
  await rm(runtimeRoot, { recursive: true });
  await assert.rejects(verifyDistribution(packageRoot), /optional dependencies enabled|metadata is missing/);
});

test('launcher verifies its executor bundle before starting local services', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'phynite-executor-integrity-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { packageRoot } = await splitFixture(directory);
  const manifestPath = join(packageRoot, 'distribution.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const code = 'export const fixture = true;\n';
  manifest.executor = { schemaVersion: 1, path: 'lib/ai-executor.mjs', sha256: createHash('sha256').update(code).digest('hex') };
  await writeFile(manifestPath, JSON.stringify(manifest));
  await assert.rejects(verifyDistribution(packageRoot), /ENOENT|missing/);
  await writeFile(join(packageRoot, manifest.executor.path), code);
  await verifyDistribution(packageRoot);
  await writeFile(join(packageRoot, manifest.executor.path), 'tampered executor');
  await assert.rejects(verifyDistribution(packageRoot), /checksum/);
});

test('Linux native bootstrap requires exact file hashes and rejects elevated executable modes', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'phynite-bootstrap-verification-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { runtimeRoot, runtime, target } = await splitFixture(directory, 'linux-x64');
  await verifyRuntimePackage(runtimeRoot, target);
  const bootstrap = join(runtimeRoot, 'bootstrap'), file = join(bootstrap, 'manifest.json');
  const document = JSON.parse(await readFile(file, 'utf8'));
  await mkdir(join(bootstrap, 'libraries'));
  const library = join(bootstrap, 'libraries', 'fixture.so');
  await writeFile(library, 'bootstrap-library-fixture');
  document.tools.bwrap.libraries = [{ path: 'libraries/fixture.so', sha256: createHash('sha256').update(await readFile(library)).digest('hex') }];
  await writeFile(file, JSON.stringify(document));
  const updated = { ...runtime, bootstrap: { directory: 'bootstrap', sha256: createHash('sha256').update(await readFile(file)).digest('hex') } };
  await writeFile(join(runtimeRoot, 'distribution.json'), JSON.stringify(updated));
  await verifyRuntimePackage(runtimeRoot, target);
  await chmod(join(bootstrap, 'bwrap'), 0o4755);
  await assert.rejects(verifyRuntimePackage(runtimeRoot, target), /setuid or setgid/);
  await chmod(join(bootstrap, 'bwrap'), 0o755);
  await writeFile(library, 'modified-library');
  await assert.rejects(verifyRuntimePackage(runtimeRoot, target), /checksum/);
});

test('schema 2 rejects missing corresponding source, install hooks and changed Linux bootstrap', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'phynite-source-metadata-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { packageRoot, runtimeRoot, runtime, target, packageJson } = await splitFixture(directory);
  const launcher = JSON.parse(await readFile(join(packageRoot, 'distribution.json'), 'utf8'));
  await writeFile(join(packageRoot, 'distribution.json'), JSON.stringify({ ...launcher, source: undefined }));
  await assert.rejects(checkDistribution(packageRoot), /source metadata/);
  await writeFile(join(packageRoot, 'distribution.json'), JSON.stringify(launcher));
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ ...packageJson, scripts: { install: 'node unwanted-installer.js' } }));
  await assert.rejects(checkDistribution(packageRoot), /installation lifecycle/);
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify(packageJson));
  await rm(join(packageRoot, 'LICENSE'));
  await assert.rejects(checkDistribution(packageRoot), /LICENSE/);
  if (target.startsWith('linux-')) {
    await writeFile(join(runtimeRoot, 'bootstrap', 'manifest.json'), 'changed');
    await assert.rejects(verifyRuntimePackage(runtimeRoot, target), /checksum/);
    await writeFile(join(runtimeRoot, 'distribution.json'), JSON.stringify({ ...runtime, bootstrap: undefined }));
    await assert.rejects(verifyRuntimePackage(runtimeRoot, target), /isolation bootstrap/);
  }
});

test('split-package launcher uses the verified helper app and ignores inherited release metadata', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'phynite-native-launch-'));
  const { packageRoot, runtimeRoot, source } = await splitFixture(directory), dataDir = join(directory, 'data');
  await writeFile(join(runtimeRoot, 'app', 'server.js'), `import { createServer } from 'node:http';
const server = createServer((request, response) => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(request.url === '/api/auth/session' ? { mode: 'local', user: { id: process.env.PHYNITE_DATA_DIR } } : { source: process.env.PHYNITE_RELEASE_SOURCE_COMMIT, version: process.env.PHYNITE_RELEASE_VERSION, bootstrap: process.env.PHYNITE_NATIVE_TOOLS_DIR, entry: process.env.PHYNITE_PACKAGED_WEB_ENTRY })); });
server.listen(Number(process.env.PORT), process.env.HOST); process.on('SIGTERM', () => server.close());`);
  const started = launch(['--no-open', '--data-dir', dataDir], packageRoot, { PHYNITE_RELEASE_SOURCE_COMMIT: 'untrusted-source', PHYNITE_RELEASE_VERSION: 'bad-version', PHYNITE_PACKAGED_WEB_ENTRY: '/untrusted/app.js', PHYNITE_NATIVE_TOOLS_DIR: '/untrusted/tools' });
  t.after(async () => {
    await launch(['stop', '--data-dir', dataDir], packageRoot).finished;
    if (started.child.exitCode === null) started.child.kill('SIGTERM');
    await started.finished; await rm(directory, { recursive: true, force: true });
  });
  const instance = await waitForInstance(dataDir, started.output);
  const canonical = await realpath(runtimeRoot);
  assert.deepEqual(await (await fetch(instance.url)).json(), { source: source.commit, version: '0.1.0', entry: join(canonical, 'app', 'server.js'), ...(process.platform === 'linux' ? { bootstrap: join(canonical, 'bootstrap') } : {}) });
});

test('public cloud config rejects secrets and endpoints outside one HTTPS origin', () => {
  const config = { apiOrigin: 'https://cloud.example.invalid/', region: 'ap-southeast-1', clientId: 'publicClientId' };
  assert.deepEqual(validateCloudConfig(config), { ...config, apiOrigin: 'https://cloud.example.invalid' });
  assert.equal(validateCloudConfig(undefined), undefined);
  for (const invalid of [null, [], {}, { ...config, clientSecret: 'must-not-package' }, { ...config, accessToken: 'must-not-package' },
    { ...config, apiOrigin: 'http://cloud.example.invalid' }, { ...config, apiOrigin: 'https://user:password@cloud.example.invalid' },
    { ...config, apiOrigin: 'https://cloud.example.invalid/api' }, { ...config, apiOrigin: 'https://cloud.example.invalid/?token=secret' },
    { ...config, apiOrigin: 'https://cloud.example.invalid/#secret' }, { ...config, apiOrigin: 'https://cloud.example.invalid\\' },
    { ...config, region: 'invalid' }, { ...config, clientId: '' }]) {
    assert.throws(() => validateCloudConfig(invalid), error => error instanceof Error && !error.message.includes('must-not-package') && !error.message.includes('cloud.example.invalid'));
  }
});

test('CLI reuses one workspace, selects a free port, isolates credentials and stops its services', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'phynite-cli-'));
  const packageRoot = join(directory, 'package'), dataDir = join(directory, 'user-data');
  await mkdir(packageRoot); await fixture(packageRoot);
  const busyPort = createServer();
  await new Promise<void>(accept => busyPort.listen(0, '127.0.0.1', accept));
  const address = busyPort.address(); assert.ok(address && typeof address !== 'string');
  const started = launch(['--no-open', '--port', String(address.port), '--data-dir', dataDir], packageRoot, { AWS_SECRET_ACCESS_KEY: 'fixture-not-a-real-key', PHYNITE_AI_AUTH_TOKEN: 'fixture-provider-not-a-real-token',
    PHYNITE_PROJECT_NOTES: '0', PHYNITE_CONNECTED_FILES: 'invalid-value',
    PHYNITE_CLOUD_API_URL: 'https://untrusted.example.invalid', PHYNITE_CLOUD_AWS_REGION: 'us-east-1', PHYNITE_CLOUD_COGNITO_CLIENT_ID: 'inheritedClient' });
  t.after(async () => {
    const stop = launch(['stop', '--data-dir', dataDir], packageRoot); await stop.finished;
    if (started.child.exitCode === null) started.child.kill('SIGTERM');
    await started.finished;
    await new Promise<void>(accept => busyPort.close(() => accept()));
    await rm(directory, { recursive: true, force: true });
  });
  const instance = await waitForInstance(dataDir, started.output);
  assert.notEqual(new URL(instance.url).port, String(address.port));
  const response = await fetch(instance.url); assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { local: true, session: true, inheritedAws: false, inheritedProvider: false });
  assert.deepEqual(JSON.parse(await readFile(join(dataDir, 'core-cloud-config.json'), 'utf8')), { apiOrigin: null, region: null, clientId: null });
  assert.deepEqual(JSON.parse(await readFile(join(dataDir, 'core-feature-flags.json'), 'utf8')), { notes: '0', files: null });
  const reuse = await launch(['--no-open', '--data-dir', dataDir], packageRoot).finished;
  assert.equal(reuse.code, 0); assert.match(reuse.output, /is running at/);
  assert.equal(await readFile(join(dataDir, 'core-starts'), 'utf8'), 'start\n');
  const status = await launch(['status', '--data-dir', dataDir], packageRoot).finished;
  assert.equal(status.code, 0); assert.match(status.output, /is running at/);
  assert.equal(started.output().includes(instance.token), false);
  assert.equal(started.output().includes('fixture-service-session-token'), false);
  const stop = await launch(['stop', '--data-dir', dataDir], packageRoot).finished;
  assert.equal(stop.code, 0); assert.match(stop.output, /stopping/);
  assert.equal((await started.finished).code, 0);
  assert.equal(await readInstance(dataDir), null);
  assert.equal(await readFile(join(dataDir, 'core-starts'), 'utf8'), 'start\n');
});

test('launcher retries a stolen port without accepting another workspace as ready', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'phynite-port-race-'));
  const packageRoot = join(directory, 'package'), dataDir = join(directory, 'data');
  await mkdir(packageRoot); await fixture(packageRoot, { stealWebPortOnce: true });
  const serverPath = join(packageRoot, 'app', 'server.js');
  const server = await readFile(serverPath, 'utf8');
  await writeFile(serverPath, server.replace('server.listen(', 'await new Promise(accept => setTimeout(accept, 400));\nserver.listen('));
  const started = launch(['--no-open', '--data-dir', dataDir], packageRoot);
  t.after(async () => {
    await launch(['stop', '--data-dir', dataDir], packageRoot).finished;
    if (started.child.exitCode === null) started.child.kill('SIGTERM');
    await started.finished; await rm(directory, { recursive: true, force: true });
  });
  const instance = await waitForInstance(dataDir, started.output);
  assert.notEqual(instance.url, await readFile(join(dataDir, 'stolen-web-origin'), 'utf8'));
  const session = await (await fetch(instance.url + '/api/auth/session')).json();
  assert.deepEqual(session, { mode: 'local', user: { id: await realpath(dataDir) } });
  assert.equal(await readFile(join(dataDir, 'core-starts'), 'utf8'), 'start\nstart\n');
  await launch(['stop', '--data-dir', dataDir], packageRoot).finished;
  assert.equal((await started.finished).code, 0);
});

test('launcher passes only public cloud metadata from the verified release manifest', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'phynite-cloud-manifest-'));
  const packageRoot = join(directory, 'package'), dataDir = join(directory, 'user-data');
  await mkdir(packageRoot); await fixture(packageRoot);
  const manifestPath = join(packageRoot, 'distribution.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const cloud = { apiOrigin: 'https://configured.example.invalid', region: 'ap-southeast-1', clientId: 'configuredClient' };
  await writeFile(manifestPath, JSON.stringify({ ...manifest, cloud }));
  const started = launch(['--no-open', '--data-dir', dataDir], packageRoot, {
    PHYNITE_CLOUD_API_URL: 'https://inherited.example.invalid', PHYNITE_CLOUD_AWS_REGION: 'us-east-1', PHYNITE_CLOUD_COGNITO_CLIENT_ID: 'inheritedClient',
  });
  t.after(async () => {
    await launch(['stop', '--data-dir', dataDir], packageRoot).finished;
    if (started.child.exitCode === null) started.child.kill('SIGTERM');
    await started.finished;
    await rm(directory, { recursive: true, force: true });
  });
  await waitForInstance(dataDir, started.output);
  assert.deepEqual(JSON.parse(await readFile(join(dataDir, 'core-cloud-config.json'), 'utf8')), cloud);
  assert.equal(started.output().includes(cloud.apiOrigin), false);
  await writeFile(manifestPath, JSON.stringify({ ...manifest, cloud: { ...cloud, accessToken: 'must-not-package' } }));
  await assert.rejects(verifyDistribution(packageRoot), /Credentials and secrets/);
});

test('stop never signals an unverified PID from an old instance file', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'phynite-stale-cli-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'runtime'));
  await writeFile(join(directory, 'runtime', 'instance.json'), JSON.stringify({ pid: process.pid, controlPort: 0, token: 'a'.repeat(64), instanceId: 'unverified' }));
  const result = await launch(['stop', '--data-dir', directory], root).finished;
  assert.equal(result.code, 0); assert.match(result.output, /stopped/);
  assert.doesNotThrow(() => process.kill(process.pid, 0));
});

test('stop recovers a verified orphan core holding the workspace lock', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'phynite-orphan-core-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const dataDir = join(directory, 'data'); await mkdir(dataDir, { recursive: true });
  const executable = join(directory, 'phynite-core');
  await writeFile(executable, `import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
const args = Object.fromEntries(Array.from({ length: (process.argv.length - 2) / 2 }, (_, i) => [process.argv[2 + i * 2], process.argv[3 + i * 2]]));
const dir = args['--data-dir'];
writeFileSync(dir + '/.scheduler.lock', JSON.stringify({ pid: process.pid, created: Date.now() / 1000 }));
const server = createServer((_request, response) => { response.end('{}'); });
server.listen(Number(args['--port']), '127.0.0.1');
process.on('SIGTERM', () => server.close(() => process.exit(0)));
`);
  await chmod(executable, 0o755);
  const port = await new Promise<number>(accept => {
    const server = createServer(); server.listen(0, '127.0.0.1', () => { const value = (server.address() as { port: number }).port; server.close(() => accept(value)); });
  });
  const orphan = spawn(process.execPath, [executable, '--data-dir', dataDir, '--port', String(port), '--ui-origin', 'http://127.0.0.1:3000'], { detached: true, stdio: 'ignore' });
  orphan.unref();
  for (let count = 0; count < 50; count++) {
    try { JSON.parse(await readFile(join(dataDir, '.scheduler.lock'), 'utf8')); break; } catch { await delay(20); }
  }
  const result = await launch(['stop', '--data-dir', dataDir], root).finished;
  assert.equal(result.code, 0); assert.match(result.output, /stopped an orphaned local core/);
  for (let count = 0; count < 50; count++) { if (!processExistsForTest(orphan.pid)) break; await delay(20); }
  assert.equal(processExistsForTest(orphan.pid), false);
});

function processExistsForTest(pid: number | undefined) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
}

test('local public-request limiter expires windows without cloud bindings', async () => {
  let now = 0;
  const limiter = localRateLimiter(2, 60, () => now);
  assert.deepEqual(await limiter.limit({ key: 'local' }), { success: true });
  assert.deepEqual(await limiter.limit({ key: 'local' }), { success: true });
  assert.deepEqual(await limiter.limit({ key: 'local' }), { success: false });
  now = 60000;
  assert.deepEqual(await limiter.limit({ key: 'local' }), { success: true });
});

test('separate npm tarballs retain bundled production dependencies without install hooks', async t => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execute = promisify(execFile);
  const directory = await mkdtemp(join(tmpdir(), 'phynite-npm-package-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  // This is a synthetic packaging test, independent of the CI host OS.
  // Native execution qualification runs separately on the actual macOS runner.
  const target = 'darwin-arm64', name = platformPackageName(target);
  const standalone = join(directory, 'standalone'), output = join(directory, 'release');
  await mkdir(join(standalone, 'dist'), { recursive: true }); await mkdir(join(standalone, 'public'));
  const dependency = join(standalone, 'node_modules', 'phynite-fixture-runtime'); await mkdir(dependency, { recursive: true });
  await writeFile(join(dependency, 'package.json'), JSON.stringify({ name: 'phynite-fixture-runtime', version: '0.0.0', type: 'module', exports: './index.js', license: 'MIT', scripts: { install: 'node -e "throw new Error(\'installer-must-not-run\')"' } }));
  await writeFile(join(dependency, 'binding.gyp'), '{"targets":[]}');
  await mkdir(join(dependency, 'src'));
  await writeFile(join(dependency, 'src', 'binding.gyp'), '{"targets":[]}');
  await writeFile(join(dependency, 'index.js'), 'export const fixture = "packaged-runtime-present";');
  await writeFile(join(dependency, 'LICENSE'), 'Synthetic process-fixture notice. Not a distributable dependency.');
  await writeFile(join(standalone, 'package.json'), '{"type":"module"}');
  await writeFile(join(standalone, 'server.js'), 'import { fixture } from "phynite-fixture-runtime"; console.log(fixture);');
  for (const environment of ['client', 'rsc', 'ssr']) {
    const output = join(standalone, 'dist', environment), code = 'export const syntheticBundledFixture = true;\n';
    await mkdir(output, { recursive: true });
    await writeFile(join(output, 'entry.js'), code);
    await writeFile(join(output, 'phynite-bundled-notices.json'), JSON.stringify({ schemaVersion: 1, format: 'phynite-bundled-js-notices', environment, complete: true,
      packages: [], chunks: [{ path: 'entry.js', sha256: createHash('sha256').update(code).digest('hex'), bytes: Buffer.byteLength(code) }], assets: [], missing: [] }));
  }
  await writeFile(join(standalone, 'dist', 'index.js.map'), 'private-source-map-must-not-ship');
  const core = join(directory, 'test-core'); await writeFile(core, '#!/bin/sh\nexit 0\n'); await chmod(core, 0o755);
  const notices = join(directory, 'notices'); await writeFile(notices, 'Test fixture notice; no scientific runtime or output.');
  const coreSha = createHash('sha256').update(await readFile(core)).digest('hex');
  await writeFile(join(directory, 'THIRD_PARTY_NATIVE.json'), JSON.stringify({ schemaVersion: 1, executableSha256: coreSha,
    noticesSha256: createHash('sha256').update(await readFile(notices)).digest('hex'), builder: { name: 'PyInstaller', version: 'synthetic' },
    nativeFiles: [{ path: 'synthetic-process.so', sha256: coreSha, sourceSha256: coreSha, bytes: 1, provider: 'python:synthetic' }],
    components: [{ id: 'python:synthetic', kind: 'python', name: 'Synthetic process fixture', version: '0.0.0', provenance: { ownership: 'Synthetic unit fixture; no native qualification' }, notices: [{ name: 'fixture-notice', sha256: coreSha }] }] }));
  const cloud = { apiOrigin: 'https://configured.example.invalid/', region: 'ap-southeast-1', clientId: 'publicClient' };
  const configPath = join(directory, 'release-cloud.json'); await writeFile(configPath, JSON.stringify(cloud));
  const base = [join(root, 'scripts', 'package-local.mjs'), '--target', target, '--core', core, '--notices', notices, '--standalone', standalone, '--source-commit', 'a'.repeat(40)];
  await execute(process.execPath, [...base, '--output', output, '--cloud-config', configPath]);
  const mainRoot = join(output, 'phynite-lab'), nativeRoot = join(output, name);
  const manifest = JSON.parse(await readFile(join(mainRoot, 'distribution.json'), 'utf8'));
  assert.deepEqual(manifest.cloud, { ...cloud, apiOrigin: 'https://configured.example.invalid' });
  assert.equal(manifest.source.commit, 'a'.repeat(40));
  const assembly = JSON.parse(await readFile(join(output, 'assembly.json'), 'utf8'));
  assert.equal(assembly.runtimes[target].name, name);
  const defaultOutput = join(directory, 'default-release');
  await execute(process.execPath, [...base, '--output', defaultOutput]);
  const publicCloud = JSON.parse(await readFile(join(root, 'config', 'phynite-cloud.public.json'), 'utf8'));
  assert.deepEqual(JSON.parse(await readFile(join(defaultOutput, 'phynite-lab', 'distribution.json'), 'utf8')).cloud, validateCloudConfig(publicCloud));
  const offlineOutput = join(directory, 'offline-release');
  await execute(process.execPath, [...base, '--offline-only', '--output', offlineOutput]);
  assert.equal(JSON.parse(await readFile(join(offlineOutput, 'phynite-lab', 'distribution.json'), 'utf8')).cloud, undefined);
  await assert.rejects(execute(process.execPath, [...base, '--offline-only', '--cloud-config', configPath]), /Choose either/);
  await assert.rejects(execute(process.execPath, base.filter((value, index) => value !== '--source-commit' && base[index - 1] !== '--source-commit')), /public source commit/);
  await writeFile(configPath, JSON.stringify({ ...cloud, password: 'must-not-package' }));
  await assert.rejects(execute(process.execPath, [...base, '--output', join(directory, 'rejected-release'), '--cloud-config', configPath]),
    error => error instanceof Error && /Credentials and secrets/.test(error.message) && !error.message.includes('must-not-package'));
  await rm(join(dependency, 'LICENSE'));
  await assert.rejects(execute(process.execPath, [...base, '--offline-only', '--output', join(directory, 'missing-license')]), /Actual license\/notice text is required/);
  const mainPack = JSON.parse((await execute('npm', ['pack', '--json', '--pack-destination', directory], { cwd: mainRoot })).stdout)[0];
  const nativePack = JSON.parse((await execute('npm', ['pack', '--json', '--pack-destination', directory], { cwd: nativeRoot })).stdout)[0];
  assert.ok(mainPack.files.some((file: { path: string }) => file.path === 'LICENSE'));
  assert.ok(!mainPack.files.some((file: { path: string }) => /^(?:app|core|node_modules)\//.test(file.path)));
  assert.ok(nativePack.files.some((file: { path: string }) => file.path === 'node_modules/phynite-fixture-runtime/index.js'));
  assert.ok(nativePack.files.some((file: { path: string }) => file.path === 'LICENSE'));
  assert.ok(!nativePack.files.some((file: { path: string }) => file.path.endsWith('.map') || file.path.endsWith('binding.gyp') || file.path.endsWith('release-cloud.json')));
  const packedDependency = JSON.parse(await readFile(join(nativeRoot, 'node_modules', 'phynite-fixture-runtime', 'package.json'), 'utf8'));
  assert.equal(packedDependency.scripts.install, undefined);
  const install = join(directory, 'install');
  const installArgs = ['install', '--prefix', install, '--offline', '--no-audit', '--no-fund', '--cache', join(directory, 'empty-npm-cache'), join(directory, nativePack.filename), join(directory, mainPack.filename)];
  if (distributionPlatform() !== target) {
    await assert.rejects(execute('npm', installArgs), /EBADPLATFORM/);
    // Only synthetic shell/JS fixtures are installed across architectures here.
    // npm 10 ignores --os/--cpu for root packages. Real native acceptance never
    // forces installation and must run on the declared macOS architecture.
    installArgs.push('--force');
  }
  await execute('npm', installArgs);
  const installed = join(install, 'node_modules', 'phynite-lab');
  const distribution = await verifyDistribution(installed, target);
  assert.deepEqual(distribution.cloud, { ...cloud, apiOrigin: 'https://configured.example.invalid' });
  assert.equal((await execute(process.execPath, [distribution.server])).stdout.trim(), 'packaged-runtime-present');
  assert.match((await execute(process.execPath, [join(installed, 'bin', 'phynite-lab.mjs'), '--help'])).stdout, /Usage: phynite-lab/);
});

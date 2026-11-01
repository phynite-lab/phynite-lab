/** Maintainer acceptance of the real registry package in an isolated user prefix. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { verifyLauncherManifest } from '../packages/phynite-lab/lib/distribution.mjs';

const options = {};
for (let index = 2; index < process.argv.length; index += 2) {
  const name = process.argv[index], value = process.argv[index + 1];
  if (!['--output', '--version', '--source-commit', '--npm-executable'].includes(name) || !value || options[name]) throw new Error('Provide --output NEW_DIRECTORY --version X.Y.Z --source-commit FULL_COMMIT --npm-executable ABSOLUTE_NPM_PATH.');
  options[name] = value;
}
if (!options['--output'] || !/^\d+\.\d+\.\d+$/.test(options['--version'] ?? '') || !/^[a-f0-9]{40}$/.test(options['--source-commit'] ?? '') || !options['--npm-executable']?.startsWith('/')) throw new Error('Registry acceptance requires an explicit release identity and npm executable.');
const output = resolve(options['--output']), version = options['--version'];
await mkdir(output, { mode: 0o700 });
const home = join(output, 'home'), prefix = join(output, 'prefix'), nodeBin = join(output, 'node-bin'), dataDir = join(home, '.phynite-lab');
for (const path of [home, prefix, nodeBin]) await mkdir(path, { mode: 0o700 });
await symlink(await realpath(process.execPath), join(nodeBin, 'node'));
const env = { HOME: home, USERPROFILE: home, PATH: nodeBin, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8', ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}) };
function command(executable, args) {
  const child = spawn(executable, args, { cwd: output, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let text = '';
  child.stdout.on('data', chunk => { text += chunk; }); child.stderr.on('data', chunk => { text += chunk; });
  const finished = new Promise((accept, reject) => { child.once('error', reject); child.once('exit', (code, signal) => accept({ code, signal, text })); });
  return { child, finished };
}
async function checked(executable, args, label) {
  const result = await command(executable, args).finished;
  await writeFile(join(output, label + '.log'), result.text, { mode: 0o600 });
  assert.equal(result.code, 0, `${label} failed; inspect its private log in ${output}`);
  return result.text;
}
await checked(options['--npm-executable'], ['install', '--global', '--prefix', prefix, '--cache', join(output, 'empty-npm-cache'), '--ignore-scripts', '--no-audit', '--no-fund', `phynite-lab@${version}`], 'npm-registry-install');
const cli = join(prefix, 'bin', 'phynite-lab');
const packageRoot = dirname(dirname(await realpath(cli)));
const installed = await verifyLauncherManifest(packageRoot);
assert.equal(installed.manifest.version, version); assert.equal(installed.source.commit, options['--source-commit']);
assert.equal((await checked(cli, ['--version'], 'version')).trim(), version);
assert.match(await checked(cli, ['doctor'], 'doctor-before'), /Packaged application and core: verified/);
let current;
async function stop() {
  if (!current) return;
  await checked(cli, ['stop'], 'stop');
  const result = await Promise.race([current.finished, delay(20000).then(() => undefined)]);
  assert.ok(result, 'Owned foreground launcher did not stop'); assert.equal(result.code, 0);
  current = undefined;
}
async function start() {
  current = command(cli, ['--no-open']);
  for (let count = 0; count < 900; count++) {
    assert.equal(current.child.exitCode, null, 'Foreground launcher exited early');
    try {
      const instance = JSON.parse(await readFile(join(dataDir, 'runtime', 'instance.json'), 'utf8'));
      assert.match(instance.url, /^http:\/\/127\.0\.0\.1:\d+$/);
      const response = await fetch(instance.url + '/api/auth/session', { signal: AbortSignal.timeout(3000) });
      if (response.ok) return { instance, session: await response.json() };
    } catch { /* Wait for the real local service, never a fabricated session. */ }
    await delay(100);
  }
  throw new Error('Registry-installed application did not become ready.');
}
try {
  const first = await start();
  assert.equal(first.session.mode, 'local'); assert.equal(first.session.authenticated, false);
  const owner = first.session.user.id;
  assert.equal((await fetch(first.instance.url + '/workspace')).status, 200);
  const created = await fetch(first.instance.url + '/api/phynite/v1/projects', { method: 'POST', headers: { Origin: first.instance.url, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Registry installation persistence check' }) });
  assert.ok(created.ok); const project = (await created.json()).project; assert.ok(project.id);
  assert.match(await checked(cli, ['--no-open'], 'reuse'), /Phynite Lab is running/);
  const reused = JSON.parse(await readFile(join(dataDir, 'runtime', 'instance.json'), 'utf8'));
  assert.equal(reused.instanceId, first.instance.instanceId);
  assert.match(await checked(cli, ['doctor'], 'doctor-running'), /Local application: running/);
  await stop();
  const second = await start(); assert.equal(second.session.user.id, owner);
  const retained = await fetch(second.instance.url + '/api/phynite/v1/projects/' + project.id); assert.ok(retained.ok);
  assert.equal((await retained.json()).project.name, project.name);
  await stop();
  assert.match(await checked(cli, ['status'], 'status-stopped'), /Phynite Lab is stopped/);
  await writeFile(join(output, 'report.json'), JSON.stringify({ passed: true, version, sourceCommit: installed.source.commit, platform: process.platform, arch: process.arch, node: process.version,
    ...(process.platform === 'linux' ? { glibcVersion: process.report.getReport().header.glibcVersionRuntime } : {}),
    checks: ['real-registry-global-install', 'verified-native-core', 'launch-without-python-docker-or-cloud-credentials', 'default-home-data-directory', 'loopback-browser-workspace', 'local-project-create', 'reuse-running-instance', 'doctor', 'restart-project-persistence', 'stable-local-workspace-identity', 'clean-stop'] }, null, 2) + '\n');
  console.log(`PASS: registry installation ${version} on ${process.platform}-${process.arch}; report ${join(output, 'report.json')}`);
} finally {
  if (current) { try { await stop(); } catch { current?.child.kill('SIGTERM'); } }
}

/** Opt-in acceptance against a real npm tarball; never builds or downloads a browser. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, chmod, mkdir, mkdtemp, open, readFile, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { release as kernelRelease, tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { resolveDistribution } from '../packages/phynite-lab/lib/distribution.mjs';

const usage = 'Usage: node scripts/smoke-local-distribution.mjs --tarball LAUNCHER.tgz [--runtime-tarball NATIVE_PACKAGE.tgz] [--output NEW_DIRECTORY] [--browser-executable CHROMIUM]';
const options = {};
for (let index = 2; index < process.argv.length; index += 2) {
  const name = process.argv[index];
  if (name === '--help') { console.log(usage); process.exit(0); }
  if (!['--tarball', '--runtime-tarball', '--output', '--browser-executable'].includes(name) || !process.argv[index + 1] || options[name]) throw new Error(usage);
  options[name] = process.argv[index + 1];
}
if (!options['--tarball']) throw new Error(usage);
const tarball = resolve(options['--tarball']);
await access(tarball);
const runtimeTarball = options['--runtime-tarball'] ? resolve(options['--runtime-tarball']) : undefined;
if (runtimeTarball) await access(runtimeTarball);
const output = options['--output'] ? resolve(options['--output']) : await mkdtemp(join(tmpdir(), 'phynite-release-smoke-'));
if (options['--output']) await mkdir(output, { mode: 0o700 });
await chmod(output, 0o700);
const install = join(output, 'install'), dataDir = join(output, 'data'), home = join(output, 'home');
await mkdir(home, { mode: 0o700 });
const report = { format: 'phynite-local-distribution-smoke', schemaVersion: 1, passed: false,
  tarballSha256: createHash('sha256').update(await readFile(tarball)).digest('hex'),
  ...(runtimeTarball ? { runtimeTarballSha256: createHash('sha256').update(await readFile(runtimeTarball)).digest('hex') } : {}),
  checks: [], checkIds: [], artifacts: [], limitations: ['Solver reference runs, cloud services and cross-platform validation are separate acceptance gates.'] };
let current, browser, activePage;

function command(executable, args, settings = {}) {
  const child = spawn(executable, args, { cwd: output, stdio: ['ignore', 'pipe', 'pipe'], ...settings });
  let text = '';
  child.stdout.on('data', value => { text += value; }); child.stderr.on('data', value => { text += value; });
  const finished = new Promise((accept, reject) => {
    child.once('error', reject);
    child.once('exit', code => accept({ code, text }));
  });
  return { child, finished, output: () => text };
}

async function npmExecutable() {
  if (process.env.npm_execpath) return [process.execPath, resolve(process.env.npm_execpath)];
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    const candidate = join(directory, process.platform === 'win32' ? 'npm.cmd' : 'npm');
    try { await access(candidate); return [candidate]; } catch { /* Try the next installed npm. */ }
  }
  throw new Error('Install Node.js with npm before running this opt-in release check.');
}

async function checked(executable, args, settings, label) {
  const result = await command(executable, args, settings).finished;
  if (result.code !== 0) {
    await writeFile(join(output, `${label}.log`), result.text, { mode: 0o600 });
    throw new Error(`${label} failed. Its private log is in the evidence directory.`);
  }
  return result;
}

const childEnv = { HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, '.config'),
  XDG_CACHE_HOME: join(home, '.cache'), PATH: '', LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8',
  ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
  ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) };
const cli = join(install, 'node_modules', 'phynite-lab', 'bin', 'phynite-lab.mjs');

async function stop() {
  if (!current) return;
  await checked(process.execPath, [cli, 'stop', '--data-dir', dataDir], { env: childEnv }, 'stop');
  const timeout = new AbortController();
  let ended;
  try { ended = await Promise.race([current.finished, delay(15000, undefined, { signal: timeout.signal }).then(() => null)]); }
  finally { timeout.abort(); }
  if (!ended) { current.child.kill('SIGTERM'); throw new Error('The foreground launcher did not stop its services within 15 seconds.'); }
  await writeFile(join(output, 'launcher.log'), ended.text, { mode: 0o600 });
  assert.equal(ended.code, 0, 'Foreground launcher must stop successfully.');
  current = undefined;
}

async function start() {
  current = command(process.execPath, [cli, '--no-open', '--port', '3000', '--data-dir', dataDir], { env: childEnv });
  for (let count = 0; count < 600; count++) {
    assert.equal(current.child.exitCode, null, 'Packaged launcher stopped before readiness.');
    try {
      const instance = JSON.parse(await readFile(join(dataDir, 'runtime', 'instance.json'), 'utf8'));
      assert.match(instance.url, /^http:\/\/127\.0\.0\.1:[0-9]+$/);
      const response = await fetch(instance.url + '/api/auth/session', { signal: AbortSignal.timeout(3000) });
      if (response.ok) return { origin: instance.url, session: await response.json() };
    } catch { /* The real core and web server are still starting. */ }
    await delay(100);
  }
  throw new Error('Packaged application did not become ready within 60 seconds.');
}

async function api(page, path, method = 'GET', payload) {
  return page.evaluate(async ({ path, method, payload }) => {
    const response = await fetch(path, { method, cache: 'no-store', ...(payload === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }) });
    if (!response.ok) throw new Error(`Same-origin API ${method} ${path} returned ${response.status}.`);
    return response.json();
  }, { path, method, payload });
}

async function contextFor(origin, viewport) {
  const context = await browser.newContext({ viewport, locale: 'en-US', serviceWorkers: 'block' });
  const externalRequests = [];
  await context.addCookies([{ name: 'phynite-language', value: 'en', url: origin }]);
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) && url.origin !== origin) {
      externalRequests.push({ method: route.request().method(), host: url.host });
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });
  return { context, externalRequests };
}

async function visit(page, origin, path) {
  const response = await page.goto(origin + path, { waitUntil: 'domcontentloaded' });
  assert.equal(response?.status(), 200, `${path} must open without login.`);
  await expect(page.locator('body')).toBeVisible();
  await expect.poll(() => new URL(page.url()).pathname).toBe(path);
  if (path === '/account/compute') await expect(page.getByRole('heading', { name: 'Compute', exact: true })).toBeVisible();
  if (path === '/account/account') await expect(page.getByRole('heading', { name: 'Phynite Cloud', exact: true })).toBeVisible();
  if (path === '/workspace') await expect(page.getByRole('button', { name: 'New project', exact: true })).toBeEnabled();
}

try {
  const [npm, ...prefix] = await npmExecutable();
  await checked(npm, [...prefix, 'install', '--prefix', install, '--ignore-scripts', '--offline', '--no-audit', '--no-fund', '--userconfig', join(home, 'npmrc'), '--cache', join(output, 'npm-cache'), tarball, ...(runtimeTarball ? [runtimeTarball] : [])],
    { env: { ...childEnv, PATH: process.env.PATH ?? '' } }, 'offline-install');
  const packageRoot = dirname(dirname(cli));
  const manifest = JSON.parse(await readFile(join(packageRoot, 'distribution.json'), 'utf8'));
  const target = `${process.platform}-${process.arch}`;
  const kernel = process.platform === 'linux' ? (await readFile('/proc/sys/kernel/osrelease', 'utf8')).trim() : kernelRelease();
  const wsl2 = process.platform === 'linux' && /microsoft.*wsl2/i.test(kernel);
  report.version = manifest.version; report.sourceCommit = manifest.source?.commit;
  report.target = `${wsl2 ? 'wsl2-' : ''}${target}`;
  report.environment = { platform: process.platform, arch: process.arch, nodeVersion: process.version, kernelRelease: kernel, wsl2,
    ...(process.platform === 'linux' ? { glibcVersion: process.report.getReport().header.glibcVersionRuntime } : {}) };
  report.packages = { launcherSha256: report.tarballSha256, runtimeSha256: report.runtimeTarballSha256 };
  const distribution = await resolveDistribution(packageRoot, target);
  const descriptor = await open(distribution.executable, 'r');
  const magic = Buffer.alloc(4); try { await descriptor.read(magic, 0, 4, 0); } finally { await descriptor.close(); }
  assert.ok(['7f454c46', 'cffaedfe', 'feedfacf', 'cefaedfe', 'feedface', 'cafebabe', 'bebafeca'].includes(magic.toString('hex')), 'Acceptance requires a real frozen native core, never a shell/Node fixture.');
  report.checkIds.push('clean-install', 'native-core');
  report.checks.push('Offline clean-prefix npm installation; real native core; runtime PATH empty; no cloud, Python or Docker environment.');
  const initial = await start();
  assert.equal(initial.session.mode, 'local'); assert.equal(initial.session.authenticated, false);
  assert.equal(initial.session.cloud.authenticated, false);
  assert.equal(initial.session.cloud.configured, Boolean(manifest.cloud));
  const owner = initial.session.user.id;
  const spoofed = await new Promise((accept, reject) => {
    const request = httpRequest(initial.origin + '/api/auth/session', { headers: { Host: 'untrusted.invalid' }, timeout: 5000 }, response => { response.resume(); accept(response.statusCode); });
    request.once('timeout', () => request.destroy(new Error('The hostile Host probe timed out.')));
    request.once('error', reject); request.end();
  });
  assert.equal(spoofed, 403, 'Loopback web server must reject an untrusted Host.');
  assert.equal((await fetch(initial.origin + '/api/phynite/v1/projects', { method: 'POST', headers: { Origin: 'https://untrusted.invalid', 'Content-Type': 'application/json' }, body: '{"name":"Must reject"}', signal: AbortSignal.timeout(5000) })).status, 403);
  report.checkIds.push('local-workspace', 'loopback-security');
  report.checks.push('Local workspace is available without cloud sign-in; wrong Host and cross-origin mutations rejected.');
  browser = await chromium.launch({ headless: true, ...(options['--browser-executable'] ? { executablePath: resolve(options['--browser-executable']) } : {}) });
  const desktop = await contextFor(initial.origin, { width: 1440, height: 900 });
  const page = await desktop.context.newPage();
  activePage = page;
  await visit(page, initial.origin, '/workspace');
  await expect(page.locator('.lab-account-toggle')).toHaveCount(0);
  const cloudLogin = page.locator('.lab-local-connection-actions:visible').getByRole('link', { name: 'Connect Phynite Cloud', exact: true }).first();
  await expect(cloudLogin).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Log out', exact: true })).toHaveCount(0);
  await cloudLogin.click();
  await expect(page).toHaveURL(initial.origin + '/account/account#cloud');
  await expect(page.getByRole('heading', { name: 'Phynite Cloud', exact: true })).toBeInViewport();
  for (const path of ['/login', '/register']) {
    await page.goto(initial.origin + path, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(initial.origin + '/account/account#cloud');
    await expect(page.getByRole('heading', { name: 'Phynite Cloud', exact: true })).toBeInViewport();
    await expect(page.locator('.local-cloud-login-form').getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled({ enabled: Boolean(manifest.cloud) });
  }
  await page.goto(initial.origin + '/account/ai-providers', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'AI provider connections', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Login with Codex|Open Claude Code login|Open Antigravity login|Check CLI and sign in/, exact: false })).toHaveCount(3);
  await expect(page.getByLabel('Gateway URL', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Save gateway|Switch|Create account slot/, exact: true })).toHaveCount(0);
  await page.goto(initial.origin + '/account/compute', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Compute', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Disconnect computer', exact: true })).toHaveCount(0);
  await page.goto(initial.origin + '/account/privacy', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Local privacy', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Manage preferences', exact: true })).toHaveCount(0);
  report.checkIds.push('local-ai-provider-connections', 'optional-cloud-no-auto-upload');
  report.checks.push('Local workspace has no unauthenticated profile; its Cloud login and login/register pages lead to optional cloud connection; public cloud configuration matches manifest; local AI exposes only official CLI provider connections with no gateway or account-switching controls; native compute settings offer no worker pairing. No provider or cloud login was attempted.');
  let simulatedCloud = true;
  await page.route('**/api/auth/session', async route => {
    const upstream = await route.fetch();
    const value = await upstream.json();
    await route.fulfill({ json: { ...value, cloud: { ...value.cloud, authenticated: simulatedCloud, account: simulatedCloud ? 'ui-fixture@example.test' : undefined } } });
  });
  await page.route('**/api/local/cloud/logout', async route => { simulatedCloud = false; await route.continue(); });
  await visit(page, initial.origin, '/workspace');
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) {
      simulatedCloud = true;
      await page.evaluate(() => window.dispatchEvent(new Event('phynite:session-change')));
    }
    await page.locator('.lab-account-toggle:visible').first().click();
    await page.getByRole('menuitem', { name: 'Sign out of Phynite Cloud', exact: true }).click();
    await expect(page.locator('.lab-account-popover')).toHaveCount(0);
    await expect(page).toHaveURL(initial.origin + '/workspace');
    await expect(page.locator('.lab-account-toggle')).toHaveCount(0);
    await expect(page.locator('.lab-local-connection-actions:visible').getByRole('link', { name: 'Connect Phynite Cloud', exact: true }).first()).toBeVisible();
  }
  await page.unroute('**/api/auth/session');
  await page.unroute('**/api/local/cloud/logout');
  report.checks.push('With explicitly simulated cloud identity only: actual local logout endpoint keeps workspace open, removes the profile menu, restores Cloud login and supports a second disconnect after reconnection.');
  await visit(page, initial.origin, '/workspace');
  await page.screenshot({ path: join(output, 'desktop-workspace.png'), fullPage: true });
  await visit(page, initial.origin, '/account/compute');
  await expect(page.locator('.research-app-shell[data-settings="true"]')).toBeVisible();
  await expect(page.locator('.studio-mobile-header')).toHaveCount(0);
  await page.screenshot({ path: join(output, 'desktop-local.png'), fullPage: true });
  await visit(page, initial.origin, '/account/account');
  await page.locator('section.settings-section').filter({ has: page.getByRole('heading', { name: 'Phynite Cloud', exact: true }) }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(output, 'desktop-connections.png') });
  await visit(page, initial.origin, '/workspace');
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create a project', exact: true });
  await dialog.getByLabel('Project name', { exact: true }).fill('Distribution acceptance silicon');
  await dialog.getByRole('button', { name: 'Create project', exact: true }).click();
  // The workspace preserves the full editor layout in the query string. Assert
  // the project pathname independently so a valid `?layout=full` URL does not
  // look like a failed navigation.
  await expect.poll(() => new URL(page.url()).pathname).toMatch(/^\/projects\/[A-Za-z0-9_-]+$/);
  const projectPath = new URL(page.url()).pathname;
  const project = projectPath.split('/').at(-1);
  await expect(page.locator('.workflow-canvas-area')).toHaveAttribute('data-ready', 'true');
  const structure = { name: 'Exact silicon input', atoms: [{ id: 'si-1', species: 'Si', x: 0, y: 0, z: 0 }], lattice: { a: 5.43, b: 5.43, c: 5.43, alpha: 90, beta: 90, gamma: 90 }, periodic: [true, true, true], units: 'angstrom' };
  const uploaded = await page.evaluate(async ({ project, structure }) => {
    async function json(path, method, body) {
      const response = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error(`Structure API ${method} failed with ${response.status}.`);
      return response.json();
    }
    const ticket = await json(`/api/phynite/v1/projects/${project}/structures/upload-url`, 'POST', { filename: 'silicon.json', contentType: 'application/json' });
    if (!ticket.upload.url.startsWith('/api/local-artifacts?')) throw new Error('Local structure upload escaped the same-origin artifact boundary.');
    const body = new FormData();
    for (const [key, value] of Object.entries(ticket.upload.fields)) body.append(key, String(value));
    body.append('file', new Blob([JSON.stringify(structure)], { type: 'application/json' }), 'silicon.json');
    const transfer = await fetch(ticket.upload.url, { method: 'POST', body });
    if (!transfer.ok) throw new Error(`Actual structure byte upload failed with ${transfer.status}.`);
    await json(`/api/phynite/v1/structures/${ticket.structure.id}`, 'PATCH', { name: structure.name, formula: 'Si', atomCount: 1, status: 'READY' });
    return ticket.structure.id;
  }, { project, structure });
  const graph = { version: 1, projectId: project, nodes: [{ id: 'silicon-input', kind: 'structure', name: structure.name, position: { x: 80, y: 80 }, configuration: { structure }, resources: [{ kind: 'structure', id: uploaded }] }], edges: [], groups: [] };
  const saved = await api(page, `/api/phynite/v1/projects/${project}/workflow`, 'PUT', { baseRevision: 0, workflow: graph });
  assert.deepEqual(saved.workflow.nodes[0].configuration.structure, structure);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('.workflow-canvas-area')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('.workflow-save-state')).toHaveText('Saved');
  await page.screenshot({ path: join(output, 'desktop-project.png'), fullPage: true });
  const archive = await page.evaluate(async project => {
    async function request(path, method = 'GET', body, contentType = 'application/json') {
      const response = await fetch(path, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': contentType }, body: contentType === 'application/json' ? JSON.stringify(body) : body }) });
      if (!response.ok) throw new Error(`Project archive ${method} failed with ${response.status}.`);
      return response;
    }
    const exported = await (await request(`/api/local/projects/${project}/export`, 'POST', {})).json();
    if (!exported.downloadUrl.startsWith('/api/local/')) throw new Error('Archive download must stay on the UI origin.');
    const blob = await (await request(exported.downloadUrl)).blob();
    const transfer = await (await request('/api/local/projects/imports', 'POST', { sizeBytes: blob.size, asCopy: true })).json();
    for (let offset = 0, part = 0; offset < blob.size; offset += transfer.partBytes, part++) {
      await request(`/api/local/projects/imports/${transfer.importId}/parts/${part}`, 'PUT', blob.slice(offset, offset + transfer.partBytes), 'application/octet-stream');
    }
    const imported = await (await request(`/api/local/projects/imports/${transfer.importId}/complete`, 'POST', {})).json();
    return { sizeBytes: blob.size, importedProjectId: imported.projectId };
  }, project);
  assert.ok(archive.sizeBytes > 0); assert.notEqual(archive.importedProjectId, project);
  const copy = await api(page, `/api/phynite/v1/projects/${archive.importedProjectId}/workflow`);
  assert.equal(copy.workflow.projectId, archive.importedProjectId);
  assert.deepEqual(copy.workflow.nodes[0].configuration.structure, structure);
  report.checkIds.push('project-import-export');
  report.checks.push('Desktop no-login UI; project created with UI; actual same-origin structure upload; workflow saved; real archive exported/imported as a copy.');
  const mobile = await contextFor(initial.origin, { width: 390, height: 844 });
  const mobilePage = await mobile.context.newPage();
  activePage = mobilePage;
  for (const path of ['/workspace', '/account/compute']) {
    await visit(mobilePage, initial.origin, path);
    assert.ok(await mobilePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${path} must fit a mobile viewport.`);
    await mobilePage.screenshot({ path: join(output, path === '/workspace' ? 'mobile-workspace.png' : 'mobile-local.png'), fullPage: true });
    if (path === '/workspace') {
      await expect(mobilePage.locator('.lab-account-toggle')).toHaveCount(0);
      const action = mobilePage.locator('.lab-local-connection-actions:visible').getByRole('link', { name: 'Connect Phynite Cloud', exact: true }).first();
      await expect(action).toBeVisible();
      assert.ok(await action.evaluate(element => {
        const rect = element.getBoundingClientRect();
        return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight
          && element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
      }), 'Local Cloud login must fit the mobile viewport and remain unobstructed.');
      await mobilePage.screenshot({ path: join(output, 'mobile-cloud-login.png'), fullPage: true });
    } else {
      await expect(mobilePage.locator('.research-app-shell[data-settings="true"]')).toBeVisible();
      await expect(mobilePage.locator('.research-navigation')).toBeHidden();
      await expect(mobilePage.locator('.settings-local-navigation')).toHaveCount(0);
      await mobilePage.getByRole('button', { name: 'Open navigation', exact: true }).click();
      await expect(mobilePage.getByRole('link', { name: 'Compute', exact: true })).toBeVisible();
      await mobilePage.locator('.research-drawer-close').click();
      await expect(mobilePage.locator('.research-navigation')).toBeHidden();
      await visit(mobilePage, initial.origin, '/account/account');
      await mobilePage.locator('section.settings-section').filter({ has: mobilePage.getByRole('heading', { name: 'Phynite Cloud', exact: true }) }).scrollIntoViewIfNeeded();
      assert.ok(await mobilePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Account settings must fit a mobile viewport.');
      await mobilePage.screenshot({ path: join(output, 'mobile-connections.png') });
    }
  }
  assert.deepEqual(desktop.externalRequests, []); assert.deepEqual(mobile.externalRequests, []);
  report.checkIds.push('ui-desktop-mobile');
  report.checks.push('Mobile workspace/setup fit 390px; browser issued no external network requests before cloud/AI opt-in.');
  await desktop.context.close(); await mobile.context.close();
  await stop();
  const restarted = await start();
  assert.equal(restarted.session.user.id, owner, 'Workspace identity must survive restart.');
  const fresh = await contextFor(restarted.origin, { width: 1440, height: 900 });
  const freshPage = await fresh.context.newPage();
  activePage = freshPage;
  await visit(freshPage, restarted.origin, '/workspace');
  const retained = await api(freshPage, `/api/phynite/v1/projects/${project}/workflow`);
  assert.deepEqual(retained.workflow, saved.workflow);
  assert.equal(retained.revision, saved.revision);
  const downloaded = await freshPage.evaluate(async id => {
    const metadata = await (await fetch(`/api/phynite/v1/structures/${id}`)).json();
    if (!metadata.downloadUrl.startsWith('/api/local-artifacts?')) throw new Error('Structure download escaped the same-origin artifact boundary.');
    const response = await fetch(metadata.downloadUrl); if (!response.ok) throw new Error('Saved structure download failed.');
    return response.json();
  }, uploaded);
  assert.deepEqual(downloaded, structure);
  await fresh.context.close();
  report.checkIds.push('persistence-restart');
  report.checks.push('Fresh browser after real CLI stop/restart: stable workspace identity, workflow revision and exact structure bytes retained in SQLite/filesystem.');
  report.passed = true;
} catch (error) {
  try { await activePage?.screenshot({ path: join(output, 'failure.png'), fullPage: true }); } catch { /* Keep the original acceptance failure. */ }
  report.failure = error instanceof Error ? error.message : 'Unknown smoke failure';
  process.exitCode = 1;
} finally {
  await browser?.close();
  try { await stop(); } catch (error) { report.passed = false; report.shutdownFailure = error instanceof Error ? error.message : 'Shutdown failed'; process.exitCode = 1; }
  for (const name of ['desktop-workspace.png', 'desktop-local.png', 'desktop-connections.png', 'desktop-project.png', 'mobile-workspace.png', 'mobile-local.png', 'mobile-cloud-login.png', 'mobile-connections.png', 'failure.png', 'launcher.log']) {
    try { report.artifacts.push({ path: name, sha256: createHash('sha256').update(await readFile(join(output, name))).digest('hex') }); } catch { /* Failed acceptance may have no screenshot yet. */ }
  }
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  const diagnostic = report.failure ? ` Failure: ${String(report.failure).slice(0, 500)}` : '';
  console.log(`${report.passed ? 'PASS' : 'FAIL'}: actual local npm distribution acceptance.${diagnostic} Evidence: ${output}`);
}

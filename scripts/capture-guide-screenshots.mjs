/** Capture the real app with a disposable, anonymous documentation workspace. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { createSimulationComponentInstance } from '../lib/md-simulation-types.ts';

const usage = 'Usage: node --experimental-strip-types scripts/capture-guide-screenshots.mjs --origin http://127.0.0.1:3000 --confirm-demo [--seed-demo | --project PROJECT_ID] [--output public/docs/guide] [--headed] [--browser-executable PATH]';
const options = { output: 'public/docs/guide', origin: 'http://127.0.0.1:3000' };
for (let index = 2; index < process.argv.length; index++) {
  const argument = process.argv[index];
  if (argument === '--help') { console.log(usage); process.exit(0); }
  if (['--headed', '--confirm-demo', '--seed-demo'].includes(argument)) { options[argument.slice(2)] = true; continue; }
  if (!['--origin', '--output', '--browser-executable', '--project'].includes(argument) || !process.argv[index + 1]) throw new Error(usage);
  options[argument.slice(2)] = process.argv[++index];
}
const origin = new URL(options.origin);
assert.equal(origin.protocol, 'http:', 'Use a disposable loopback HTTP application.');
assert.ok(['127.0.0.1', '[::1]', 'localhost'].includes(origin.hostname), 'Only loopback origins are allowed.');
assert.ok(!origin.username && !origin.password && origin.pathname === '/' && !origin.search && !origin.hash, 'Supply an origin without credentials, path, query, or hash.');
assert.equal(options['confirm-demo'], true, 'Pass --confirm-demo only after starting a new --data-dir for documentation.');
const output = resolve(options.output);
const marker = 'Documentation demo only. Neutral teaching inputs; no private research data.';
const name = 'Guide demo: silicon and argon';
async function api(path, method = 'GET', body) {
  const response = await fetch(new URL(path, origin), { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Demo API ${method} ${path} returned ${response.status}.`);
  return response.json();
}
const session = await api('/api/auth/session');
assert.equal(session.mode, 'local', 'Documentation capture must use the local app.');
assert.equal(session.authenticated, false, 'Use an anonymous demo workspace.');
assert.equal(Boolean(session.cloud?.authenticated || session.cloud?.connected), false, 'Disconnect Cloud in the disposable workspace before capture.');
const existing = await api('/api/phynite/v1/projects');
let project = options.project;
if (options['seed-demo']) {
  assert.equal(existing.projects.length, 0, '--seed-demo refuses a data directory that already contains projects.');
  const result = await api('/api/phynite/v1/projects', 'POST', { name, description: marker });
  project = result.project.id;
} else {
  assert.ok(project, 'Use --seed-demo on an empty workspace or --project for a previously seeded demo.');
  const selected = existing.projects.find(item => item.id === project);
  assert.ok(selected?.name === name && selected?.description === marker, 'The selected project must have the documentation demo name and marker.');
}

async function seedWorkflow() {
  const silicon = { name: 'Silicon conventional cell', atoms: [[0, 0, 0], [0, .5, .5], [.5, 0, .5], [.5, .5, 0], [.25, .25, .25], [.25, .75, .75], [.75, .25, .75], [.75, .75, .25]].map((v, i) => ({ id: `si-${i}`, species: 'Si', x: v[0] * 5.43, y: v[1] * 5.43, z: v[2] * 5.43 })), lattice: { a: 5.43, b: 5.43, c: 5.43, alpha: 90, beta: 90, gamma: 90, periodic: [true, true, true] } };
  const argon = { name: 'Argon teaching cell', atoms: [[0, 0, 0], [0, .5, .5], [.5, 0, .5], [.5, .5, 0]].map((v, i) => ({ id: `ar-${i}`, species: 'Ar', x: v[0] * 5.26, y: v[1] * 5.26, z: v[2] * 5.26 })), lattice: { a: 5.26, b: 5.26, c: 5.26, alpha: 90, beta: 90, gamma: 90, periodic: [true, true, true] } };
  async function upload(structure, filename) {
    const ticket = await api(`/api/phynite/v1/projects/${project}/structures/upload-url`, 'POST', { filename, contentType: 'application/json' });
    assert.ok(ticket.upload.url.startsWith('/api/local-artifacts?'));
    const form = new FormData();
    for (const [key, value] of Object.entries(ticket.upload.fields)) form.append(key, String(value));
    form.append('file', new Blob([JSON.stringify(structure)], { type: 'application/json' }), filename);
    const transfer = await fetch(new URL(ticket.upload.url, origin), { method: 'POST', body: form });
    assert.ok(transfer.ok, `Structure upload returned ${transfer.status}.`);
    await api(`/api/phynite/v1/structures/${ticket.structure.id}`, 'PATCH', { name: structure.name, formula: structure.atoms[0].species, atomCount: structure.atoms.length, status: 'READY' });
    return ticket.structure.id;
  }
  const [si, ar] = [await upload(silicon, 'silicon.json'), await upload(argon, 'argon.json')];
  const md = createSimulationComponentInstance('nvt');
  md.id = 'guide-stage';
  Object.assign(md.config, { velocitySeed: 12345, totalSteps: 100, dumpFrequency: 10, thermoFrequency: 10 });
  const manual = structuredClone(md);
  manual.id = 'guide-manual-stage';
  Object.assign(manual.config, { name: 'Manual NVT example', mode: 'manual', manualBody: 'timestep 0.001\nvelocity all create 300 12345 mom yes rot yes dist gaussian\nfix integrate all nvt temp 300 300 0.1\nrun 100\nunfix integrate' });
  const node = (id, kind, label, x, y, configuration, resources = []) => ({ id, kind, name: label, position: { x, y }, configuration, resources });
  const workflow = { version: 1, projectId: project, nodes: [
    node('silicon', 'structure', silicon.name, 80, 80, { structure: silicon }, [{ kind: 'structure', id: si }]),
    node('scf', 'scf', 'Silicon SCF setup', 420, 80, { compilerVersion: 1, draft: { computeTarget: 'personal' } }),
    node('argon', 'structure', argon.name, 80, 300, { structure: argon }, [{ kind: 'structure', id: ar }]),
    node('md-guided', 'md', 'Argon Guided setup', 420, 300, { components: [md] }),
    node('md-manual', 'md', 'Argon manual setup', 420, 520, { components: [manual] }),
    node('analysis', 'md-analysis', 'Radial distribution function', 760, 300, { execution: { name: 'Radial distribution function', computeTarget: 'personal', pipeline: { version: 1, modifiers: [{ id: 'rdf', type: 'rdf', enabled: true, params: { cutoff: 5, bins: 100 } }], typeMap: { 1: 'Ar' }, periodic: [true, true, true], frameRange: { start: 0, stop: null, stride: 1 } } } }),
  ], edges: [{ id: 'si-scf', source: 'silicon', target: 'scf', port: 'structure' }, { id: 'ar-md', source: 'argon', target: 'md-guided', port: 'structure' }, { id: 'ar-manual', source: 'argon', target: 'md-manual', port: 'structure' }, { id: 'md-analysis', source: 'md-guided', target: 'analysis', port: 'trajectory' }], groups: [] };
  await api(`/api/phynite/v1/projects/${project}/workflow`, 'PUT', { baseRevision: 0, workflow });
}
if (options['seed-demo']) await seedWorkflow();
const workflow = (await api(`/api/phynite/v1/projects/${project}/workflow`)).workflow;
const projectPath = `/projects/${project}?layout=full`;
const tab = id => `${projectPath}&tab=${encodeURIComponent(id)}`;
const captures = [
  { id: 'onboarding-workspace', route: '/workspace', ready: p => p.getByRole('button', { name: 'New project', exact: true }), caption: 'The local workspace works without Cloud or AI login.' },
  { id: 'new-project', route: '/workspace', action: async p => { await p.getByRole('button', { name: 'New project', exact: true }).click(); const dialog = p.getByRole('dialog', { name: 'Create a project', exact: true }); await dialog.getByLabel('Project name', { exact: true }).fill('Silicon convergence study'); }, ready: p => p.getByRole('dialog', { name: 'Create a project', exact: true }), caption: 'Name a project for a material, comparison, or research question. This dialog is not submitted.' },
  { id: 'compute-runtime-setup', route: '/account/compute', ready: p => p.getByText('Scientific runtime', { exact: true }), caption: 'Install verified scientific runtimes, inspect isolation, and set local CPU/RAM budgets.' },
  { id: 'ai-provider-accounts', route: '/account/ai-providers', ready: p => p.getByRole('heading', { name: 'AI provider accounts', exact: true }), caption: 'Anonymous provider connection screen. Provider login is not simulated.' },
  { id: 'cloud-account', route: '/account/account', ready: p => p.getByRole('heading', { name: 'Phynite Cloud', exact: true }), caption: 'Cloud sign-in is optional and separate from local work.' },
  { id: 'storage-archives', route: '/account/storage', ready: p => p.getByRole('heading', { name: 'Storage', exact: true }), caption: 'Local artifact accounting and project archive controls.' },
  { id: 'appearance-settings', route: '/account/appearance', ready: p => p.getByRole('heading', { name: 'Appearance & language', exact: true }), caption: 'Appearance and language preferences on this device.' },
  { id: 'notifications-settings', route: '/account/notifications', ready: p => p.getByRole('heading', { name: 'Notifications', exact: true }), caption: 'Local notification preferences.' },
  { id: 'keyboard-settings', route: '/account/keyboard', ready: p => p.getByRole('heading', { name: 'Keyboard shortcuts', exact: true }), caption: 'Keyboard shortcut configuration.' },
  { id: 'usage-settings', route: '/account/usage', ready: p => p.getByRole('heading', { name: 'Usage', exact: true }), caption: 'Recorded compute usage; no account quota is invented.' },
  { id: 'privacy-settings', route: '/account/privacy', ready: p => p.getByRole('heading', { name: 'Privacy & session', exact: true }), caption: 'Local privacy and session information.' },
  { id: 'workflow-canvas', route: `${projectPath}&tab=canvas`, ready: p => p.locator('.workflow-canvas-area[data-ready="true"]'), caption: 'Connected silicon SCF and argon MD teaching setups; drafts are not scientific results.' },
  { id: 'structure-editor', route: tab('silicon'), ready: p => p.getByText('Structure parameters', { exact: true }), canvas: true, caption: 'Silicon cell geometry and the actual structure editing toolbar.' },
  { id: 'dft-configuration', route: tab('scf'), ready: p => p.getByText('Pseudopotential family', { exact: true }), caption: 'Review the SCF method, numerical basis, and pseudopotential family before running.' },
  { id: 'dft-pseudopotentials', route: tab('scf'), action: async p => { await p.getByRole('button', { name: 'Manual', exact: true }).click(); await p.getByRole('button', { name: 'SYSTEM', exact: true }).click(); }, ready: p => p.getByText('Pseudopotential family', { exact: true }), caption: 'QE method and pseudopotential selection in the detailed parameter editor.' },
  { id: 'md-guided', route: tab('md-guided'), ready: p => p.getByRole('button', { name: 'Run step', exact: true }), caption: 'Guided MD setup with explicit interatomic potential, timestep, steps, and output cadence.' },
  { id: 'md-manual', route: tab('md-manual'), requiresNode: 'md-manual', action: async p => { await p.getByRole('tab', { name: 'Advanced', exact: true }).click(); await p.getByRole('tab', { name: /Expert/ }).click(); }, ready: p => p.getByRole('textbox', { name: 'Expert LAMMPS input', exact: true }), caption: 'Manual LAMMPS stage body. The runtime manages input, potential, output paths, and isolation.' },
  { id: 'md-analysis', route: tab('analysis'), ready: p => p.getByText('Frame stride', { exact: true }), caption: 'RDF analysis setup with explicit frame selection and physical cutoff.' },
  { id: 'run-history', route: `${projectPath}&tab=canvas`, action: async p => { await p.getByRole('button', { name: 'Run history', exact: true }).click(); }, ready: p => p.getByRole('complementary', { name: 'Run history', exact: true }), caption: 'Actual run history for the neutral demo workspace.' },
  { id: 'run-preflight', route: tab('scf'), action: async p => { await p.getByRole('button', { name: 'Run', exact: true }).click(); }, ready: p => p.getByText('Resources for module', { exact: true }), caption: 'Compute plan checks saved input, runtime, solver, isolation, potential identity, and resources before execution.' },
];
const manifest = {
  format: 'phynite-guide-screenshots', schemaVersion: 2,
  capturedAt: new Date().toISOString(),
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  appVersion: JSON.parse(await readFile(new URL('../packages/phynite-lab/package.json', import.meta.url), 'utf8')).version,
  dataPolicy: marker,
  variants: [{ id: 'desktop-dark', viewport: { width: 1440, height: 960 }, colorScheme: 'dark' }, { id: 'desktop-light', viewport: { width: 1440, height: 960 }, colorScheme: 'light' }, { id: 'mobile-dark', viewport: { width: 390, height: 844 }, colorScheme: 'dark' }],
  captures: [],
  unavailable: [
    { id: 'cloud-authenticated-sync', reason: 'Cloud authentication and project upload are not performed in the anonymous demo.' },
    { id: 'cloud-transfer-review', reason: 'Online compute requires a connected Cloud account. The disconnected state is shown in Compute.' },
    { id: 'ai-login-success', reason: 'Provider login, account usage, and reset values are not simulated in documentation captures.' },
    { id: 'profile', reason: 'The anonymous local app has no Cloud profile; its profile route redirects to appearance.' },
    { id: 'npm-terminal', reason: 'Install/update/doctor commands are documented as copyable text, not a fabricated terminal image.' },
  ],
};
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: !options.headed, args: ['--enable-unsafe-swiftshader'], ...(options['browser-executable'] ? { executablePath: resolve(options['browser-executable']) } : {}) });
try {
  for (const variant of manifest.variants) {
    const context = await browser.newContext({ viewport: variant.viewport, deviceScaleFactor: 1, locale: 'en-US', colorScheme: variant.colorScheme, reducedMotion: 'reduce', serviceWorkers: 'block' });
    await context.addInitScript(theme => { localStorage.setItem('phynite-calculation-theme', theme); localStorage.setItem('phynite:language', 'en'); }, variant.colorScheme);
    await context.addCookies([{ name: 'phynite-language', value: 'en', url: origin.origin }]);
    const blocked = new Set();
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) && url.origin !== origin.origin) { blocked.add(url.origin); return route.abort('blockedbyclient'); }
      return route.continue();
    });
    const page = await context.newPage();
    for (const capture of captures) {
      if (capture.requiresNode && !workflow.nodes.some(node => node.id === capture.requiresNode)) { manifest.unavailable.push({ id: capture.id, reason: 'This demo project does not include the required draft node.' }); continue; }
      const response = await page.goto(new URL(capture.route, origin).href, { waitUntil: 'domcontentloaded' });
      assert.equal(response?.status(), 200, `${capture.id} must return 200.`);
      await expect(page.locator('html')).toHaveAttribute('data-workspace-theme', variant.colorScheme);
      if (capture.action) {
        if (capture.route.startsWith('/projects/')) await expect(page.locator('.workflow-save-state')).toHaveText('Saved', { timeout: 30_000 });
        await capture.action(page);
      }
      await expect(capture.ready(page).first()).toBeVisible({ timeout: 30_000 });
      if (capture.canvas) { await expect(page.locator('canvas')).toBeVisible(); await page.waitForTimeout(3000); }
      await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
      const file = `${capture.id}-${variant.id}.png`;
      const bytes = await page.screenshot({ path: join(output, file), fullPage: true, animations: 'disabled' });
      manifest.captures.push({ id: capture.id, route: capture.route.replace(project, '<DEMO_PROJECT>'), file, variant: variant.id, caption: capture.caption, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length });
    }
    manifest.blockedOrigins = [...new Set([...(manifest.blockedOrigins ?? []), ...blocked])];
    await context.close();
  }
} finally {
  await browser.close();
  await writeFile(join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}
console.log(`Captured ${manifest.captures.length} real UI screenshots in ${output}.`);

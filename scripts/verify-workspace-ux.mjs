/** Exercise core UI flows on a disposable local workspace. Never starts a solver or AI turn. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { createSimulationComponentInstance } from '../lib/md-simulation-types.ts';

const [origin, directory, confirmation] = process.argv.slice(2);
assert.match(origin ?? '', /^http:\/\/127\.0\.0\.1:\d+$/);
assert.ok(directory && confirmation === '--confirm-disposable', 'Start a new --data-dir, then pass ORIGIN OUTPUT --confirm-disposable.');
const output = resolve(directory);
await mkdir(output, { recursive: true });
const marker = 'Disposable UI verification only. No solver execution.';
const browser = await chromium.launch({ headless: true });
const results = [];
let forbiddenRequests = 0;
const errors = [];
try {
  const setup = await browser.newContext();
  const session = await (await setup.request.get(`${origin}/api/auth/session`)).json();
  assert.equal(session.mode, 'local');
  assert.equal(session.authenticated, false);
  assert.ok(!session.cloud?.authenticated && !session.cloud?.connected);
  const existing = await (await setup.request.get(`${origin}/api/phynite/v1/projects`)).json();
  assert.ok(existing.projects.every(project => project.description === marker), 'Refusing a workspace that contains user projects.');
  const created = await setup.request.post(`${origin}/api/phynite/v1/projects`, {
    headers: { Origin: origin }, data: { name: 'Workspace UI verification', description: marker },
  });
  assert.ok(created.ok());
  const { project } = await created.json();
  const md = createSimulationComponentInstance('nvt');
  md.id = 'ui-md-step';
  const graph = { version: 1, projectId: project.id, nodes: [
    { id: 'input', kind: 'structure', name: 'Silicon input fixture', position: { x: 0, y: 0 }, resources: [], configuration: {
      structure: { name: 'Silicon input fixture', atoms: [{ id: 'si-1', species: 'Si', x: 0, y: 0, z: 0 }], lattice: { a: 5.43, b: 5.43, c: 5.43, alpha: 90, beta: 90, gamma: 90 } },
    } },
    { id: 'scf', kind: 'scf', name: 'SCF setup fixture', position: { x: 350, y: 0 }, configuration: {}, resources: [] },
    { id: 'md', kind: 'md', name: 'MD setup fixture', position: { x: 350, y: 250 }, configuration: { components: [md] }, resources: [] },
  ], edges: [{ id: 'si-scf', source: 'input', target: 'scf', port: 'structure' }, { id: 'si-md', source: 'input', target: 'md', port: 'structure' }], groups: [] };
  assert.ok((await setup.request.put(`${origin}/api/phynite/v1/projects/${project.id}/workflow`, { headers: { Origin: origin }, data: { baseRevision: 0, workflow: graph } })).ok());
  await setup.close();

  const cases = [
    { width: 1440, height: 960, theme: 'light', language: 'en' },
    { width: 1440, height: 960, theme: 'dark', language: 'en' },
    { width: 390, height: 844, theme: 'light', language: 'en' },
    { width: 390, height: 844, theme: 'dark', language: 'en' },
    { width: 360, height: 800, theme: 'light', language: 'id' },
    { width: 768, height: 1024, theme: 'dark', language: 'en' },
  ];
  for (const scenario of cases) {
    const { width, height, theme, language } = scenario;
    const prefix = `${width}-${theme}-${language}`;
    const en = language === 'en';
    const context = await browser.newContext({ viewport: { width, height }, locale: en ? 'en-US' : 'id-ID', reducedMotion: 'reduce' });
    await context.addCookies([{ name: 'phynite-language', value: language, url: origin }]);
    await context.addInitScript(value => localStorage.setItem('phynite-calculation-theme', value), theme);
    const page = await context.newPage();
    page.on('pageerror', error => errors.push({ scenario: prefix, error: error.message }));
    await page.route('**/api/ai/**', route => {
      if (route.request().method() === 'POST') { forbiddenRequests++; return route.abort(); }
      return route.continue();
    });
    await page.route('**/api/phynite/v1/**/runs', route => {
      if (route.request().method() === 'POST') { forbiddenRequests++; return route.abort(); }
      return route.continue();
    });
    const fits = async selector => {
      const element = page.locator(selector).filter({ visible: true }).first();
      assert.ok(await element.evaluate(el => el.scrollWidth <= el.clientWidth + 1), `${prefix} ${selector} must not overflow horizontally.`);
    };
    const capture = async name => page.screenshot({ path: join(output, `${prefix}-${name}.png`) });
    const projectPath = tab => `${origin}/projects/${project.id}?layout=full&tab=${encodeURIComponent(tab)}`;

    // Both entry paths open the same create dialog; the empty state does not create data by itself.
    const emptyProjects = route => route.request().method() === 'GET' ? route.fulfill({ json: { projects: [] } }) : route.continue();
    await page.route('**/api/phynite/v1/projects', emptyProjects);
    await page.goto(`${origin}/workspace`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: en ? 'Create your first project' : 'Buat project pertama Anda' })).toBeVisible();
    await fits('.research-home');
    await capture('home-empty');
    await page.getByRole('button', { name: en ? 'Create project' : 'Buat project', exact: true }).click();
    await expect(page.getByRole('dialog', { name: en ? 'Create a project' : 'Buat project' })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: en ? 'Close' : 'Tutup', exact: true }).click();
    await page.unroute('**/api/phynite/v1/projects', emptyProjects);
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('button', { name: en ? 'Search projects' : 'Cari project', exact: true }).click();
    const search = page.getByRole('searchbox', { name: en ? 'Search projects' : 'Cari project', exact: true });
    await search.fill('zz-no-matching-project');
    await expect(page.getByRole('heading', { name: en ? 'No matching projects' : 'Tidak ada project yang cocok' })).toBeVisible();
    await page.getByRole('button', { name: en ? 'Clear search' : 'Kosongkan pencarian', exact: true }).click();
    await expect(search).toHaveValue('');
    await expect(search).toBeFocused();
    await expect(page.locator(`.research-home-projects a[href="/projects/${project.id}"]`)).toBeVisible();

    // An index/search jump reveals collapsed settings and focuses the target, not a form field.
    await page.goto(`${origin}/account/appearance`, { waitUntil: 'networkidle' });
    const index = page.getByRole('navigation', { name: en ? 'On this page' : 'Di halaman ini', exact: true });
    await expect(index).toBeVisible();
    await fits('.settings-main');
    await capture('settings');
    await page.locator('#appearance-advanced > summary').click();
    await expect(page.locator('#appearance-advanced')).toHaveJSProperty('open', false);
    await index.getByRole('link', { name: en ? 'Language' : 'Bahasa', exact: true }).click();
    await expect(page.locator('#appearance-advanced')).toHaveJSProperty('open', true);
    await expect(page.locator('#interface-language')).toBeFocused();
    if (width <= 900) await page.getByRole('button', { name: en ? 'Open navigation' : 'Buka navigasi', exact: true }).click();
    const settingSearch = page.getByRole('searchbox', { name: en ? 'Search settings' : 'Cari pengaturan', exact: true });
    await settingSearch.fill('sssp');
    const matching = page.getByRole('region', { name: en ? 'Matching settings' : 'Pengaturan yang cocok', exact: true });
    await expect(matching.getByRole('link')).toContainText(en ? 'Compute' : 'Komputasi');
    await matching.getByRole('link').click();
    await expect(page.locator('#pseudopotentials')).toBeFocused();

    // Mode keys change editing views while retaining an exact numeric field value.
    await page.goto(projectPath('scf'), { waitUntil: 'networkidle' });
    const dft = page.locator('.workflow-dft-editor:visible');
    const modes = dft.getByRole('radiogroup', { name: en ? 'Configuration mode' : 'Mode konfigurasi', exact: true });
    const simple = modes.getByRole('radio', { name: en ? 'Simple' : 'Sederhana', exact: true });
    const manual = modes.getByRole('radio', { name: 'Manual', exact: true });
    const cutoff = dft.locator('label').filter({ has: page.getByText('ecutwfc', { exact: true }) }).locator('input');
    const value = await cutoff.inputValue();
    await cutoff.fill('91.25');
    await manual.click();
    await simple.click();
    await expect(cutoff).toHaveValue('91.25');
    await cutoff.fill(value);
    await simple.focus();
    await page.keyboard.press('ArrowRight');
    await expect(manual).toBeFocused(); await expect(manual).toBeChecked();
    await page.keyboard.press('Home');
    await expect(simple).toBeFocused(); await expect(simple).toBeChecked();
    await expect(cutoff).toHaveValue(value);
    await expect(manual).toHaveAttribute('tabindex', '-1');
    await fits('.workflow-config-toolbar');
    const radioBounds = await simple.boundingBox();
    if (width <= 600) assert.ok(radioBounds?.height >= 44, 'Mobile configuration modes must be 44px tall.');
    await capture('configure');

    await page.goto(projectPath('md'), { waitUntil: 'networkidle' });
    const mdModes = page.locator('.workflow-md-editor:visible').getByRole('radiogroup', { name: en ? 'Configuration mode' : 'Mode konfigurasi', exact: true });
    const guided = mdModes.getByRole('radio', { name: en ? 'Simple' : 'Sederhana', exact: true });
    await guided.focus(); await page.keyboard.press('End');
    await expect(mdModes.getByRole('radio', { name: en ? 'Advanced' : 'Lanjutan', exact: true })).toBeChecked();
    await page.keyboard.press('Home'); await expect(guided).toBeChecked();

    // Model states are explicit UI fixtures. No model or solver is called.
    let catalog = { providers: [{ id: 'local', configured: false, models: [] }] };
    let catalogStatus = 200;
    await page.route('**/api/ai/models', route => route.fulfill({ status: catalogStatus, json: catalogStatus === 200 ? catalog : { error: 'UI fixture catalog unavailable' } }));
    await page.goto(projectPath('tool:ai'), { waitUntil: 'networkidle' });
    const welcome = page.locator('.ai-welcome:visible');
    await expect(welcome.getByText(en ? 'Connect your AI provider' : 'Hubungkan provider AI Anda', { exact: true })).toBeVisible();
    await expect(page.locator('.ai-composer-notices .ai-notice')).toHaveCount(0);
    await fits('.ai-composer');
    await capture('ai-setup');
    const message = page.getByRole('textbox', { name: en ? 'Message Phynite AI' : 'Pesan untuk Phynite AI', exact: true });
    await welcome.getByRole('button', { name: en ? /Review this project/ : /Tinjau project ini/ }).click();
    await expect(message).toHaveValue(en ? 'Review my Canvas and suggest the next step.' : 'Tinjau Kanvas dan sarankan langkah berikutnya.');
    await expect(message).toBeFocused();
    await expect(page.getByRole('button', { name: en ? 'Send message' : 'Kirim pesan', exact: true })).toBeDisabled();
    catalogStatus = 503;
    await page.reload({ waitUntil: 'networkidle' });
    await expect(welcome.getByText(en ? 'Model status unavailable' : 'Status model belum tersedia', { exact: true })).toBeVisible();
    await expect(message).toHaveValue(en ? 'Review my Canvas and suggest the next step.' : 'Tinjau Kanvas dan sarankan langkah berikutnya.');
    await expect(page.getByRole('button', { name: en ? 'Send message' : 'Kirim pesan', exact: true })).toBeDisabled();
    catalogStatus = 200;
    catalog = { refreshing: true, providers: [{ id: 'local', configured: false, models: [] }] };
    await page.reload({ waitUntil: 'networkidle' });
    await expect(welcome.getByText(en ? 'Checking your models' : 'Memeriksa model Anda', { exact: true })).toBeVisible();
    catalog = { providers: [{ id: 'local', configured: true, models: [] }] };
    await page.reload({ waitUntil: 'networkidle' });
    await expect(welcome.getByText(en ? 'Choose an available model' : 'Pilih model yang tersedia', { exact: true })).toBeVisible();
    catalog = { providers: [{ id: 'local', configured: true, models: [{ id: 'codex/ui-fixture', label: 'UI fixture model', capabilities: { available: true, efforts: ['auto'] } }] }] };
    await page.reload({ waitUntil: 'networkidle' });
    await expect(welcome.locator('.ai-welcome-setup')).toHaveCount(0);
    await expect(message).toHaveValue(en ? 'Review my Canvas and suggest the next step.' : 'Tinjau Kanvas dan sarankan langkah berikutnya.');
    await expect(page.getByRole('button', { name: en ? 'Send message' : 'Kirim pesan', exact: true })).toBeEnabled();
    await capture('ai-ready-draft');
    results.push({ ...scenario, status: 'passed' });
    console.log(`PASS ${prefix}: Home, Settings, DFT/MD configure, AI readiness and unsent draft.`);
    await context.close();
  }
  assert.equal(forbiddenRequests, 0, 'No AI turns or solver runs may start during this UI check.');
  assert.deepEqual(errors, [], 'No browser runtime errors are expected.');
  await writeFile(join(output, 'verification.json'), JSON.stringify({ scenarios: results, forbiddenRequests, browserErrors: errors, evidence: 'Disposable input fixtures only; no scientific output or real model invocation.' }, null, 2) + '\n');
} finally { await browser.close(); }

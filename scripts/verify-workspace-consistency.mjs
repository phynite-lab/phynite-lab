/** Cross-page visual contracts. Run only against the disposable workspace UX fixture. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';

const [origin, destination, confirmation] = process.argv.slice(2);
assert.match(origin ?? '', /^http:\/\/127\.0\.0\.1:\d+$/);
assert.ok(destination && confirmation === '--confirm-disposable');
const output = resolve(destination);
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const reports = [];
const errors = [];
let fixtureOpenSaves = 0;
let fixtureInputSaves = 0;
const blockedWrites = [];
try {
  const setup = await browser.newContext();
  const session = await (await setup.request.get(`${origin}/api/auth/session`)).json();
  assert.equal(session.mode, 'local');
  assert.equal(session.authenticated, false);
  assert.ok(!session.cloud?.connected && !session.cloud?.authenticated);
  const { projects } = await (await setup.request.get(`${origin}/api/phynite/v1/projects`)).json();
  assert.ok(projects.length && projects.every(project => project.description === 'Disposable UI verification only. No solver execution.'));
  const project = projects[0];
  const baseline = await (await setup.request.get(`${origin}/api/phynite/v1/projects/${project.id}/workflow`)).json();
  const nodeIdentity = nodes => nodes.map(node => `${node.id}:${node.kind}`).sort().join('|');
  assert.equal(nodeIdentity(baseline.workflow.nodes), 'input:structure|md:md|scf:scf');
  await setup.close();
  for (const scenario of [
    { width: 1440, height: 960, theme: 'light' },
    { width: 1440, height: 960, theme: 'dark' },
    { width: 390, height: 844, theme: 'light' },
    { width: 390, height: 844, theme: 'dark' },
    { width: 768, height: 1024, theme: 'light', touch: true },
  ]) {
    const { width, height, theme, touch = false } = scenario;
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, reducedMotion: 'reduce' });
    await context.addCookies([{ name: 'phynite-language', value: 'en', url: origin }]);
    await context.addInitScript(value => localStorage.setItem('phynite-calculation-theme', value), theme);
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => {
      const request = route.request();
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
        // The app saves recency and editor configuration automatically. Only
        // these input-only writes on the explicitly marked fixture may pass.
        const path = new URL(request.url()).pathname;
        let body;
        try { body = request.postDataJSON(); } catch { /* Reject malformed writes. */ }
        if (request.method() === 'PATCH' && path === `/api/phynite/v1/projects/${project.id}` &&
            body && Object.keys(body).length === 1 && typeof body.lastOpenedAt === 'string' &&
            /^\d{4}-\d{2}-\d{2}T/.test(body.lastOpenedAt) && Number.isFinite(Date.parse(body.lastOpenedAt))) {
          fixtureOpenSaves++;
          return route.continue();
        }
        if (request.method() === 'PUT' && path === `/api/phynite/v1/projects/${project.id}/workflow` &&
            body && Object.keys(body).length === 2 && Number.isSafeInteger(body.baseRevision) && body.baseRevision >= 0 &&
            body.workflow?.version === 1 && body.workflow.projectId === project.id && Array.isArray(body.workflow.nodes) &&
            nodeIdentity(body.workflow.nodes) === nodeIdentity(baseline.workflow.nodes)) {
          fixtureInputSaves++;
          return route.continue();
        }
        blockedWrites.push({ method: request.method(), path });
        return route.abort();
      }
      return route.continue();
    });
    const prefix = `${width}-${theme}${touch ? '-touch' : ''}`;
    const fit = async selector => {
      const element = page.locator(selector).filter({ visible: true }).first();
      assert.ok(await element.evaluate(el => el.scrollWidth <= el.clientWidth + 1), `${prefix} ${selector} overflow`);
    };
    const capture = name => page.screenshot({ path: join(output, `${prefix}-${name}.png`) });
    const heading = async () => {
      const h = page.locator('.workspace-page-heading h1').filter({ visible: true });
      await expect(h).toHaveCount(1);
      const style = await h.evaluate(el => { const s = getComputedStyle(el); return { size: s.fontSize, weight: s.fontWeight, family: s.fontFamily }; });
      assert.equal(style.size, '28px');
      assert.equal(style.weight, '600');
      return style;
    };
    const chapters = [];
    for (const path of ['/workspace', '/account/appearance', '/account/keyboard', '/account/notifications', '/account/compute', '/account/ai-providers', '/account/account', '/account/usage', '/account/storage', '/account/privacy']) {
      await page.goto(`${origin}${path}`, { waitUntil: 'networkidle' });
      const style = await heading();
      await fit(path === '/workspace' ? '.studio-main--home' : '.settings-main');
      chapters.push({ path, heading: style });
      await capture(path.split('/').at(-1));
      if (path === '/account/compute') {
        const addCluster = page.getByRole('button', { name: 'Add Cluster', exact: true });
        await addCluster.click();
        const profile = page.getByRole('dialog', { name: 'Add HPC Cluster Profile', exact: true });
        await expect(profile).toBeVisible();
        assert.equal(await profile.locator('.lab-modal-content').evaluate(el => getComputedStyle(el).borderRadius), '16px');
        await fit('.lab-modal-content');
        await capture('compute-dialog');
        await page.keyboard.press('Escape');
        await expect(profile).not.toBeVisible();
        await expect(addCluster).toBeFocused();
      }
    }
    // All settings use the same page heading and content well as Home.
    await page.goto(`${origin}/workspace`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'New project', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Create a project' });
    await expect(dialog).toBeVisible();
    assert.equal(await dialog.evaluate(el => getComputedStyle(el).borderRadius), '16px');
    await capture('create-dialog');
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'New project', exact: true })).toBeFocused();

    const geometry = [];
    for (const tab of ['scf', 'md']) {
      await page.goto(`${origin}/projects/${project.id}?layout=full&tab=${tab}`, { waitUntil: 'networkidle' });
      const editor = page.locator(tab === 'scf' ? '.workflow-dft-editor:visible' : '.workflow-md-editor:visible');
      const simple = editor.getByRole('radio', { name: 'Simple', exact: true });
      await simple.click();
      await expect(simple).toHaveAttribute('aria-checked', 'true');
      const field = editor.locator('.configuration-field-control').first();
      await expect(field).toBeVisible();
      const measure = await field.evaluate(el => { const s = getComputedStyle(el); const input = el.querySelector('input'); return { height: el.getBoundingClientRect().height, radius: s.borderRadius, valueSize: getComputedStyle(input).fontSize }; });
      assert.equal(measure.radius, '8px');
      assert.ok(measure.height >= (width <= 600 || touch ? 44 : 40));
      assert.equal(measure.valueSize, width <= 960 ? '16px' : '13px');
      assert.equal(await field.locator('input').evaluate(el => getComputedStyle(el).borderWidth), '0px', 'Unit wrappers own the only field border');
      await field.locator('input').focus();
      assert.equal(await field.evaluate(el => getComputedStyle(el).outlineStyle), 'solid');
      assert.equal(await field.locator('input').evaluate(el => getComputedStyle(el).outlineStyle), 'none', 'Focus belongs to the complete value/unit control');
      await fit(tab === 'scf' ? '.workflow-dft-editor' : '.workflow-md-editor');
      await capture(`${tab}-simple`);
      const advanced = editor.getByRole('radio', { name: tab === 'scf' ? 'Manual' : 'Advanced', exact: true });
      await advanced.click();
      await expect(advanced).toHaveAttribute('aria-checked', 'true');
      await capture(`${tab}-advanced`);
      geometry.push({ tab, ...measure });
    }
    assert.equal(geometry[0].height, geometry[1].height, 'DFT/MD number fields share geometry');
    await page.route('**/api/ai/models', route => route.fulfill({ json: { providers: [{ id: 'local', configured: false, models: [] }] } }));
    await page.goto(`${origin}/projects/${project.id}?layout=full&tab=tool%3Aai`, { waitUntil: 'networkidle' });
    await heading();
    await fit('.ai-composer');
    const composer = page.getByRole('textbox', { name: 'Message Phynite AI', exact: true });
    await composer.focus();
    const box = page.locator('.ai-composer-box');
    assert.equal(await box.evaluate(el => getComputedStyle(el).borderRadius), '16px');
    await capture('ai');
    const modelTrigger = page.getByRole('button', { name: 'Choose AI model', exact: true });
    await modelTrigger.click();
    const modelMenu = page.getByRole('dialog', { name: 'Choose AI model', exact: true });
    await expect(modelMenu).toBeVisible();
    await fit('.ai-model-menu');
    await page.keyboard.press('Escape');
    await expect(modelMenu).not.toBeVisible();
    await expect(modelTrigger).toBeFocused();
    const contextTrigger = page.getByRole('button', { name: 'Add context', exact: true });
    for (const manager of [
      { action: 'Manage custom skills', title: 'Custom skills', image: 'ai-skills' },
      { action: 'Local MCP connections', title: 'Local MCP connections', image: 'ai-connections' },
    ]) {
      await contextTrigger.click();
      await expect(page.getByRole('dialog', { name: 'Add context', exact: true })).toBeVisible();
      await fit('.ai-context-picker');
      await page.getByRole('button', { name: manager.action, exact: true }).click();
      const modal = page.getByRole('dialog', { name: manager.title, exact: true });
      await expect(modal).toBeVisible();
      assert.equal(await modal.evaluate(el => getComputedStyle(el).borderRadius), '16px');
      await fit('.ai-skill-modal');
      await capture(manager.image);
      await page.keyboard.press('Escape');
      await expect(modal).not.toBeVisible();
      await expect(contextTrigger).toBeFocused();
    }

    // Change only device preferences in this disposable browser context.
    await page.goto(`${origin}/account/appearance`, { waitUntil: 'networkidle' });
    const advanced = page.locator('#appearance-advanced');
    if (!await advanced.evaluate(el => el.open)) await advanced.locator('summary').click();
    await page.getByRole('button', { name: 'Compact', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-ui-density', 'compact');
    await page.goto(`${origin}/projects/${project.id}?layout=full&tab=scf`, { waitUntil: 'networkidle' });
    const compactField = page.locator('.workflow-dft-editor:visible .configuration-field-control').first();
    const compactHeight = await compactField.evaluate(el => el.getBoundingClientRect().height);
    assert.ok(compactHeight >= (width <= 600 || touch ? 44 : 32));
    assert.ok(compactHeight <= (width <= 600 || touch ? 46 : 34), `Compact field is ${compactHeight}px`);
    await capture('compact');

    await page.goto(`${origin}/account/appearance`, { waitUntil: 'networkidle' });
    await page.getByRole('combobox', { name: 'Accent', exact: true }).click();
    await page.getByRole('option', { name: 'Blue', exact: true }).click();
    const codeSize = page.getByRole('spinbutton', { name: 'Code font size', exact: true });
    await codeSize.fill('17'); await codeSize.press('Enter');
    const uiSize = page.getByRole('spinbutton', { name: 'UI font size', exact: true });
    await uiSize.fill('16'); await uiSize.press('Enter');
    await page.goto(`${origin}/workspace`, { waitUntil: 'networkidle' });
    const scaledTitle = await page.locator('.workspace-page-heading h1').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    assert.ok(Math.abs(scaledTitle - 28 * 16 / 13) < .1);
    await fit('.studio-main--home');
    await page.goto(`${origin}/projects/${project.id}?layout=full&tab=scf`, { waitUntil: 'networkidle' });
    const customized = page.locator('.workflow-dft-editor:visible .configuration-field-control').first();
    await customized.locator('input').focus();
    const preferenceStyle = await customized.evaluate(el => {
      const s = getComputedStyle(el);
      return { focus: s.outlineColor, accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(), codeSize: getComputedStyle(el.querySelector('input')).fontSize };
    });
    assert.equal(preferenceStyle.codeSize, '17px');
    assert.notEqual(preferenceStyle.focus, 'rgb(23, 23, 23)');
    await fit('.workflow-dft-editor');
    await capture('customized');
    reports.push({ ...scenario, chapters, geometry, compactHeight, preferenceStyle, status: 'passed' });
    console.log(`PASS ${prefix}: 10 chapters, dialogs, DFT/MD shared fields, AI and compact/touch contracts.`);
    await context.close();
  }
  assert.deepEqual(blockedWrites, [], 'Only marked fixture recency/input saves; no solver runs or model invocations.');
  assert.deepEqual(errors, []);
  await writeFile(join(output, 'consistency.json'), JSON.stringify({ reports, fixtureOpenSaves, fixtureInputSaves, blockedWrites, errors }, null, 2) + '\n');
} finally { await browser.close(); }

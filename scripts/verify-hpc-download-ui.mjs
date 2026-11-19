/** Browser regression against a disposable local workspace. No solver is run. */
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { unzipSync } from 'fflate';

export async function verifyHpcDownloadUi(page, origin, output, viewport = { width: 1440, height: 900 }) {
  const previousViewport = page.viewportSize(), previousUrl = page.url();
  await page.setViewportSize(viewport);
  const prefix = viewport.width < 600 ? 'mobile' : 'desktop';
  const created = await page.request.post(`${origin}/api/phynite/v1/projects`, {
    headers: { Origin: origin }, data: { name: 'HPC UI fixture — no solver execution' },
  });
  assert.ok(created.ok(), 'Disposable UI project creation failed.');
  const { project } = await created.json();
  const graph = { version: 1, projectId: project.id, nodes: [
    { id: 'input', kind: 'structure', name: 'UI fixture input', position: { x: 0, y: 0 }, resources: [], configuration: {
      structure: { name: 'UI fixture', atoms: [{ id: 'si-1', species: 'Si', x: 0, y: 0, z: 0 }], lattice: { a: 5.43, b: 5.43, c: 5.43, alpha: 90, beta: 90, gamma: 90 } },
    } },
    { id: 'bands', kind: 'bands', name: 'Bands UI fixture', position: { x: 350, y: 0 }, configuration: {}, resources: [] },
  ], edges: [{ id: 'edge', source: 'input', target: 'bands', port: 'structure' }], groups: [] };
  const saved = await page.request.put(`${origin}/api/phynite/v1/projects/${project.id}/workflow`, {
    headers: { Origin: origin }, data: { baseRevision: 0, workflow: graph },
  });
  assert.ok(saved.ok(), 'Disposable UI workflow save failed.');
  const runsUrl = `**/projects/${project.id}/workflow/runs`;
  const resultUrl = '**/calculations/hpc-ui-fixture';
  const artifactsUrl = '**/__hpc-ui-fixture/*';
  let unavailable = false;
  await page.route(runsUrl, route => route.fulfill({ json: { runs: [{
    id: 'hpc-ui-run', projectId: project.id, workflowRevision: 1, status: 'completed', createdAt: new Date().toISOString(), targets: ['bands'],
    attempts: [{ nodeId: 'bands', fingerprint: 'ui-fixture-only', status: 'completed', jobId: 'hpc-ui-fixture', jobKind: 'CALCULATION' }],
  }] } }));
  await page.route(resultUrl, route => route.fulfill(unavailable ? { status: 503, json: { error: 'UI fixture result unavailable' } } : { json: {
    calculation: { id: 'hpc-ui-fixture', status: 'COMPLETED' }, result: { artifacts: [
      { path: 'data/bands.csv', downloadUrl: '/__hpc-ui-fixture/bands.csv' },
      { path: 'first/plot.png', downloadUrl: '/__hpc-ui-fixture/first.png' },
      { path: 'second/plot.png', downloadUrl: '/__hpc-ui-fixture/second.png' },
      { path: 'input/bands.in', downloadUrl: '/__hpc-ui-fixture/bands.in' },
    ] },
  } }));
  await page.route(artifactsUrl, route => route.fulfill({ body: 'UI fixture bytes only. No scientific output.', contentType: 'text/plain' }));
  try {
    await page.goto(`${origin}/projects/${project.id}?layout=full&tab=bands`, { waitUntil: 'networkidle' });
    const editor = page.locator('.workflow-dft-editor:visible');
    const toolbar = editor.locator('.workflow-config-toolbar');
    const download = toolbar.getByRole('button', { name: 'Download', exact: true });
    await expect(download).toBeVisible();
    await page.screenshot({ path: join(output, `${prefix}-hpc-editor.png`) });
    // The feature branch puts the configuration toolbar first. Reintroducing
    // old input selectors, notices or a result card changes that composition.
    await expect(editor.locator('.workflow-result')).toHaveCount(0);
    await expect(editor.locator('.workflow-editor-notice')).toHaveCount(0);
    await expect(toolbar.locator('.workflow-config-input')).toHaveCount(0);
    const mode = toolbar.getByRole('group', { name: 'Configuration mode', exact: true });
    const run = toolbar.getByRole('button', { name: 'Run', exact: true });
    const [downloadBox, modeBox, runBox] = await Promise.all([download.boundingBox(), mode.boundingBox(), run.boundingBox()]);
    assert.ok(downloadBox && modeBox && runBox);
    assert.ok(downloadBox.x + downloadBox.width <= modeBox.x && modeBox.x + modeBox.width <= runBox.x, 'Toolbar must retain Download → Simple/Manual → Run order.');
    await download.click();
    const menu = page.getByRole('menu', { name: 'Download outputs', exact: true });
    await expect(menu.getByRole('menuitem', { name: 'All Results (.zip)', exact: true })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Band Data (CSV)', exact: true })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Inputs & Outputs (.zip)', exact: true })).toBeVisible();
    const box = await menu.boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height, 'Download menu must fit inside the viewport.');
    await page.screenshot({ path: join(output, `${prefix}-hpc-download.png`) });
    const downloaded = page.waitForEvent('download');
    await menu.getByRole('menuitem', { name: 'Figures (.zip)', exact: true }).click();
    const figureZip = await downloaded;
    assert.deepEqual(Object.keys(unzipSync(await readFile(await figureZip.path()))).sort(), ['first/plot.png', 'second/plot.png']);
    unavailable = true;
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByRole('alert').filter({ hasText: 'UI fixture result unavailable' })).toBeVisible();
    await expect(toolbar.getByRole('button', { name: 'Download', exact: true })).toHaveCount(0);
  } finally {
    await page.unroute(runsUrl); await page.unroute(resultUrl); await page.unroute(artifactsUrl);
    if (previousViewport) await page.setViewportSize(previousViewport);
    if (previousUrl.startsWith(origin)) await page.goto(previousUrl, { waitUntil: 'domcontentloaded' });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [origin, directory] = process.argv.slice(2);
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin ?? '') || !directory) throw Error('Use a disposable local server: verify-hpc-download-ui.mjs http://127.0.0.1:PORT NEW_EVIDENCE_DIRECTORY');
  const output = resolve(directory);
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ locale: 'en-US', reducedMotion: 'reduce' });
    await context.addCookies([{ name: 'phynite-language', value: 'en', url: origin }]);
    await context.addInitScript(() => localStorage.setItem('phynite-calculation-theme', 'dark'));
    const page = await context.newPage();
    await page.goto(origin + '/workspace', { waitUntil: 'networkidle' });
    await verifyHpcDownloadUi(page, origin, output);
    await verifyHpcDownloadUi(page, origin, output, { width: 390, height: 844 });
    console.log('PASS: feature-branch configuration layout, grouped downloads, distinct ZIP paths and fetch errors on desktop/mobile. Synthetic UI fixtures only; no solver run.');
  } finally { await browser.close(); }
}

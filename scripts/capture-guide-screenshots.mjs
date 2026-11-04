/**
 * Capture reproducible documentation screenshots from the local app.
 *
 * The capture is intentionally anonymous and blocks requests outside the
 * supplied loopback origin. Use a clean data directory when starting the app
 * so the resulting images contain only the neutral demo workspace.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

const usage = 'Usage: node scripts/capture-guide-screenshots.mjs --origin http://127.0.0.1:3000 [--output public/docs/guide] [--headed] [--browser-executable PATH]';
const options = { output: 'public/docs/guide', origin: 'http://127.0.0.1:3000', headed: false };
for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (argument === '--help') { console.log(usage); process.exit(0); }
  if (argument === '--headed') { options.headed = true; continue; }
  if (!['--origin', '--output', '--browser-executable'].includes(argument) || !process.argv[index + 1]) throw new Error(usage);
  options[argument.slice(2)] = process.argv[++index];
}

const origin = new URL(options.origin);
if (!['http:', 'https:'].includes(origin.protocol)) throw new Error('The origin must use HTTP or HTTPS.');
const output = resolve(options.output);
await mkdir(output, { recursive: true });

const captures = [
  { id: 'onboarding-workspace', route: '/workspace', caption: 'The local workspace starts without a cloud login.' },
  { id: 'compute-runtime-setup', route: '/account/compute', caption: 'Install and verify local scientific runtimes in Settings → Compute.' },
  { id: 'ai-provider-accounts', route: '/account/ai-providers', caption: 'Connect an official local AI provider and inspect its capability state.' },
  { id: 'cloud-account', route: '/account/account', caption: 'Phynite Cloud login is separate from local compute and AI provider sessions.' },
  { id: 'storage-archives', route: '/account/storage', caption: 'Review local or hosted storage guidance before exporting an archive.' },
  { id: 'appearance-settings', route: '/account/appearance', caption: 'Choose device appearance and interface language.' },
  { id: 'notifications-settings', route: '/account/notifications', caption: 'Configure research and device notifications.' },
  { id: 'keyboard-settings', route: '/account/keyboard', caption: 'Customize keyboard shortcuts for the research workspace.' },
  { id: 'usage-settings', route: '/account/usage', caption: 'Inspect recorded run time, CPU-hours, and job receipts.' },
  { id: 'privacy-settings', route: '/account/privacy', caption: 'Review privacy and current-session controls.' },
  { id: 'local-guide', route: '/guide/local-compute', caption: 'Compare local native compute with the optional hosted worker.' },
  { id: 'troubleshooting-guide', route: '/guide/troubleshooting', caption: 'Use the troubleshooting guide to separate setup failures from solver failures.' },
];

const browser = await chromium.launch({
  headless: !options.headed,
  ...(options['browser-executable'] ? { executablePath: resolve(options['browser-executable']) } : {}),
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
  deviceScaleFactor: 1,
  locale: 'en-US',
  colorScheme: 'dark',
  serviceWorkers: 'block',
});
const blockedRequests = [];
await context.route('**/*', route => {
  const requestUrl = new URL(route.request().url());
  if (requestUrl.origin !== origin.origin && ['http:', 'https:', 'ws:', 'wss:'].includes(requestUrl.protocol)) {
    blockedRequests.push({ url: requestUrl.origin, path: requestUrl.pathname });
    return route.abort('blockedbyclient');
  }
  return route.continue();
});
const page = await context.newPage();
const manifest = {
  format: 'phynite-guide-screenshots',
  schemaVersion: 1,
  origin: origin.origin,
  capturedAt: new Date().toISOString(),
  colorScheme: 'dark',
  viewport: { width: 1440, height: 960 },
  captures: [],
};

try {
  for (const capture of captures) {
    const response = await page.goto(new URL(capture.route, origin).href, { waitUntil: 'networkidle', timeout: 30_000 });
    if (!response || response.status() >= 400) throw new Error(`${capture.route} returned ${response?.status() ?? 'no response'}.`);
    await page.locator('body').waitFor({ state: 'visible', timeout: 10_000 });
    await page.screenshot({ path: join(output, `${capture.id}.png`), fullPage: true });
    manifest.captures.push({ ...capture, file: `${capture.id}.png`, status: response.status() });
  }
  await writeFile(join(output, 'manifest.json'), `${JSON.stringify({ ...manifest, blockedRequests }, null, 2)}\n`);
} catch (error) {
  await writeFile(join(output, 'capture-error.log'), `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`, { mode: 0o600 });
  throw error;
} finally {
  await context.close();
  await browser.close();
}

console.log(`Captured ${manifest.captures.length} documentation screenshots in ${output}.`);

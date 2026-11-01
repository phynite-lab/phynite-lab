import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { aggregateBundledJsNotices, collectBundledJsNotices } from '../scripts/bundled-js-notices.mjs';

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'phynite-bundled-notice-'))), packageRoot = join(root, 'node_modules/rendered-fixture');
  await mkdir(packageRoot, { recursive: true });
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ name: 'rendered-fixture', version: '1.0.0', license: 'MIT' }));
  const source = join(packageRoot, 'index.js');
  await writeFile(source, '/*! Copyright synthetic fixture author. Original comment for parser test. */\nexport const fixture = 1;\n');
  await writeFile(join(packageRoot, 'LICENSE'), 'Synthetic unit fixture notice. Not a distributable license grant.');
  const code = 'export const fixture=1;\n';
  const bundle = { entry: { type: 'chunk', fileName: 'entry.js', code, modules: { [source]: { renderedLength: code.length } } } };
  return { root, packageRoot, source, code, bundle };
}

test('only rendered dependency modules contribute notices and original legal comments', async () => {
  const { root, packageRoot, source, bundle } = await fixture();
  try {
    const unused = join(root, 'node_modules/unused-fixture/index.js');
    bundle.entry.modules[unused] = { renderedLength: 0 };
    const report = await collectBundledJsNotices(bundle, root, 'client');
    assert.equal(report.complete, true); assert.equal(report.packages.length, 1);
    const item = report.packages[0];
    assert.equal(item.name, 'rendered-fixture');
    assert.equal(item.modules[0].sha256, hash(await readFile(source)));
    assert.ok(item.notices.some((notice: { name: string; text: string }) => notice.name === 'LICENSE' && notice.text.includes('Synthetic unit fixture')));
    assert.ok(item.notices.some((notice: { name: string; text: string }) => notice.name.includes('original legal comment') && notice.text.includes('synthetic fixture author')));
    await rm(join(packageRoot, 'LICENSE'));
    const missing = await collectBundledJsNotices(bundle, root, 'client');
    assert.equal(missing.complete, false, 'A copyright comment or SPDX identifier alone cannot replace full notice evidence.');
    assert.deepEqual(missing.missing, [{ name: 'rendered-fixture', version: '1.0.0' }]);
  } finally { await rm(root, { recursive: true }); }
});

test('reviewed font supplements append to installed licenses and bind actual asset bytes', async () => {
  const { root, packageRoot, bundle } = await fixture();
  try {
    const directory = join(root, 'distribution/notices/web'); await mkdir(directory, { recursive: true });
    const text = 'Synthetic supplemental font notice. Not a real font license.', path = 'distribution/notices/web/font.txt';
    await writeFile(join(root, path), text);
    const font = Buffer.from('Synthetic font asset for checksum rejection only.'); await mkdir(join(packageRoot, 'fonts')); await writeFile(join(packageRoot, 'fonts/test.woff2'), font);
    const fontManifest = 'distribution/notices/web/fonts.json', fontText = JSON.stringify({ schemaVersion: 1, name: 'rendered-fixture', version: '1.0.0', fontFiles: [{ path: 'fonts/test.woff2', bytes: font.length, sha256: hash(font) }] });
    await writeFile(join(root, fontManifest), fontText);
    await writeFile(join(directory, 'manifest.json'), JSON.stringify({ schemaVersion: 1, components: [{ name: 'rendered-fixture', version: '1.0.0', mode: 'supplemental', sourceUrl: 'https://example.test/synthetic',
      evidence: { fontManifest, fontManifestSha256: hash(fontText), fontCount: 1 }, notices: [{ path, sha256: hash(text) }] }] }));
    const report = await collectBundledJsNotices(bundle, root, 'client');
    assert.ok(report.packages[0].notices.some((notice: { text: string }) => notice.text === text));
    await writeFile(join(packageRoot, 'fonts/test.woff2'), 'Changed font asset');
    await assert.rejects(collectBundledJsNotices(bundle, root, 'client'), /font bytes differ/);
  } finally { await rm(root, { recursive: true }); }
});

test('standalone aggregation rejects incomplete reports and modified emitted code', async () => {
  const { root, bundle, code } = await fixture();
  try {
    const standalone = join(root, 'standalone');
    for (const environment of ['client', 'rsc', 'ssr']) {
      const directory = join(standalone, 'dist', environment); await mkdir(directory, { recursive: true });
      await writeFile(join(directory, 'entry.js'), code);
      await writeFile(join(directory, 'phynite-bundled-notices.json'), JSON.stringify(await collectBundledJsNotices(bundle, root, environment)));
    }
    const result = await aggregateBundledJsNotices(standalone);
    assert.equal(result.manifest.reports.length, 3); assert.equal(result.manifest.packages.length, 1);
    assert.match(result.text, /Original comment for parser test/);
    await writeFile(join(standalone, 'dist/client/entry.js'), 'Changed emitted JavaScript');
    await assert.rejects(aggregateBundledJsNotices(standalone), /chunk changed/);
    await writeFile(join(standalone, 'dist/client/entry.js'), code);
    const report = join(standalone, 'dist/client/phynite-bundled-notices.json'), value = JSON.parse(await readFile(report, 'utf8'));
    value.complete = false; await writeFile(report, JSON.stringify(value));
    await assert.rejects(aggregateBundledJsNotices(standalone), /incomplete/);
  } finally { await rm(root, { recursive: true }); }
});

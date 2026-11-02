import assert from 'node:assert/strict';
import test from 'node:test';
import { bundledLocalRelease, getLocalReleaseMetadata } from '../lib/local-release-metadata.ts';

test('release metadata prefers the validated npm registry version', async () => {
  let requested = '';
  const metadata = await getLocalReleaseMetadata(async (url, init) => {
    requested = String(url);
    assert.equal(init?.credentials, 'omit');
    assert.equal(init?.redirect, 'error');
    return Response.json({ name: 'phynite-lab', version: '1.2.3', scripts: { install: 'ignored' } });
  });
  assert.equal(requested, 'https://registry.npmjs.org/phynite-lab/latest');
  assert.equal(metadata.version, '1.2.3');
  assert.equal(metadata.versionSource, 'registry');
  assert.equal(metadata.targets.length, 4);
});

test('release metadata falls back to the bundled package when npm is unavailable or invalid', async () => {
  const offline = await getLocalReleaseMetadata(async () => { throw new Error('offline'); });
  assert.deepEqual(offline, bundledLocalRelease);
  const invalid = await getLocalReleaseMetadata(async () => Response.json({ name: 'other-package', version: '99.0.0' }));
  assert.deepEqual(invalid, bundledLocalRelease);
});

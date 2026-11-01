import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseSource } from '../lib/release-source.ts';

test('packaged source links identify the exact commit rather than the moving default branch', () => {
  const commit = 'a'.repeat(40);
  const source = releaseSource({ PHYNITE_RELEASE_SOURCE_COMMIT: commit, PHYNITE_RELEASE_VERSION: '0.1.0' });
  assert.equal(source.url, `https://github.com/phynite-lab/phynite-lab/tree/${commit}`);
  assert.equal(source.archive, `https://github.com/phynite-lab/phynite-lab/archive/${commit}.tar.gz`);
  assert.equal(source.license, 'AGPL-3.0-only');
  assert.equal(releaseSource({}).archive, null);
});

test('invalid or incomplete release metadata cannot redirect source downloads', () => {
  for (const commit of ['main', '../private', 'https://example.org', 'A'.repeat(40)]) {
    assert.throws(() => releaseSource({ PHYNITE_RELEASE_SOURCE_COMMIT: commit }));
  }
  assert.throws(() => releaseSource({ PHYNITE_RELEASE_VERSION: '0.1.0' }));
});

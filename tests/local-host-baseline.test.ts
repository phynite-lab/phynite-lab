import assert from 'node:assert/strict';
import test from 'node:test';
import { requireRuntimeHost } from '../packages/phynite-lab/lib/launcher.mjs';

test('unsupported Linux and WSL libc versions fail before a native executable starts', () => {
  for (const version of [null, '', 'musl', '2.38', '2.9', '1.99']) {
    assert.throws(() => requireRuntimeHost('linux', version), /glibc 2\.39/);
  }
  for (const version of ['2.39', '2.40', '2.39.1']) assert.doesNotThrow(() => requireRuntimeHost('linux', version));
  assert.doesNotThrow(() => requireRuntimeHost('darwin', undefined));
});

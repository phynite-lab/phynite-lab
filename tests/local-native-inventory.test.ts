import assert from 'node:assert/strict';
import test from 'node:test';
import { validateNativeInventory } from '../packages/phynite-lab/lib/native-inventory.mjs';

const core = 'a'.repeat(64), notices = 'b'.repeat(64);
function fixture() {
  return { schemaVersion: 1, executableSha256: core, noticesSha256: notices, builder: { name: 'PyInstaller', version: 'synthetic' },
    nativeFiles: [{ path: 'fixture.so', sha256: core, sourceSha256: core, bytes: 100, provider: 'python:fixture' }],
    components: [{ id: 'python:fixture', kind: 'python', name: 'Fixture', version: '0.0.0', provenance: { ownership: 'Synthetic unit fixture' }, notices: [{ name: 'LICENSE.txt', sha256: notices }] }] };
}

test('native inventory binds both actual core and full notice bytes and rejects unowned payloads', () => {
  assert.ok(validateNativeInventory(fixture(), core, notices));
  assert.throws(() => validateNativeInventory(fixture(), 'c'.repeat(64), notices), /inventory/);
  assert.throws(() => validateNativeInventory(fixture(), core, 'c'.repeat(64)), /inventory/);
  const unowned = fixture(); unowned.nativeFiles[0].provider = 'unreviewed';
  assert.throws(() => validateNativeInventory(unowned, core, notices), /inventory/);
  const unsafe = fixture(); unsafe.nativeFiles[0].path = '../outside.so';
  assert.throws(() => validateNativeInventory(unsafe, core, notices), /inventory/);
  const duplicate = fixture(); duplicate.nativeFiles.push(duplicate.nativeFiles[0]);
  assert.throws(() => validateNativeInventory(duplicate, core, notices), /inventory/);
});

test('lxml static LGPL code requires exact corresponding source manifest and archives', () => {
  const document = fixture();
  document.components[0].kind = 'wheel'; document.components[0].name = 'lxml';
  assert.throws(() => validateNativeInventory(document, core, notices), /inventory/);
});

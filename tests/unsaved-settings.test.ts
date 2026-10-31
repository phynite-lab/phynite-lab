import assert from 'node:assert/strict';
import test from 'node:test';
import { confirmUnsavedSettings } from '../lib/settings-navigation.ts';

test('explicit settings actions prompt only with a dirty form, using the current language', t => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window'), previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  let dirty = false, answer = false;
  const prompts: string[] = [];
  const document = { querySelector: (selector: string) => { assert.equal(selector, '[data-settings-dirty="true"]'); return dirty ? {} : null; }, documentElement: { lang: 'en' } };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { confirm: (message: string) => { prompts.push(message); return answer; } } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
  t.after(() => {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else Reflect.deleteProperty(globalThis, 'window');
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument); else Reflect.deleteProperty(globalThis, 'document');
  });
  assert.equal(confirmUnsavedSettings(), true); assert.equal(prompts.length, 0);
  dirty = true; assert.equal(confirmUnsavedSettings(), false);
  assert.equal(prompts.at(-1), 'Discard unsaved settings changes?');
  document.documentElement.lang = 'id'; answer = true;
  assert.equal(confirmUnsavedSettings(), true);
  assert.equal(prompts.at(-1), 'Abaikan perubahan pengaturan yang belum disimpan?');
  confirmUnsavedSettings('Explicit message'); assert.equal(prompts.at(-1), 'Explicit message');
});

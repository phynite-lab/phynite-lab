import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptedLanguages, localePreference, resolveLocale } from '../lib/locale.ts';

test('explicit language overrides device and country', () => {
  assert.equal(resolveLocale('en', ['id-ID'], 'ID'), 'en');
  assert.equal(resolveLocale('id', ['en-US'], 'US'), 'id');
});
test('automatic language follows supported device preferences in order', () => {
  assert.equal(resolveLocale('auto', ['fr-FR', 'id-ID', 'en-US']), 'id');
  assert.equal(resolveLocale('auto', ['en-GB', 'id-ID'], 'ID'), 'en');
  assert.equal(resolveLocale('auto', ['in-ID']), 'id');
});
test('country is only a fallback for unsupported device languages', () => {
  assert.equal(resolveLocale('auto', ['ja-JP'], 'ID'), 'id');
  assert.equal(resolveLocale('auto', [], 'SG'), 'en');
  assert.equal(resolveLocale('auto', []), 'en');
});
test('request language parsing respects quality, stable ordering, and exclusions', () => {
  assert.deepEqual(acceptedLanguages('en-US;q=0.4, id-ID;q=0.9, en;q=0, fr;q=oops, de;q=0.9'), ['id-ID', 'de', 'en-US']);
  assert.deepEqual(acceptedLanguages(''), []);
  assert.equal(localePreference('unknown'), 'auto');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { observeBrowserNavigation, type BrowserNavigationSnapshot } from '../lib/browser-navigation.ts';

function fixture(withNative = false) {
  const target = new EventTarget(), storage = new Map<string, string>();
  const entries: { href: string; state: unknown }[] = [{ href: 'https://workspace.test/projects/test', state: { router: 'preserved' } }];
  let index = 0;
  const location = { href: entries[0].href };
  const native = Object.assign(new EventTarget(), {
    get canGoBack() { return index > 0; }, get canGoForward() { return index < entries.length - 1; },
    entries: () => entries.map((entry, index) => ({ index, url: entry.href })),
  });
  Object.defineProperties(native, { canGoBack: { get: () => index > 0 }, canGoForward: { get: () => index < entries.length - 1 }, currentEntry: { get: () => ({ index }) } });
  const history = {
    get state() { return entries[index].state; }, get length() { return entries.length; },
    pushState(state: unknown, _unused: string, url?: string | URL | null) {
      entries.splice(++index); location.href = new URL(String(url ?? location.href), location.href).href;
      entries.push({ state: structuredClone(state), href: location.href }); native.dispatchEvent(new Event('currententrychange'));
    },
    replaceState(state: unknown, _unused: string, url?: string | URL | null) {
      location.href = new URL(String(url ?? location.href), location.href).href;
      entries[index] = { state: structuredClone(state), href: location.href }; native.dispatchEvent(new Event('currententrychange'));
    },
    go(delta: number) {
      index += delta; location.href = entries[index].href;
      native.dispatchEvent(new Event('currententrychange')); target.dispatchEvent(new Event('popstate'));
    },
  };
  const originalPush = history.pushState;
  const browser = Object.assign(target, { history, location, crypto: globalThis.crypto, sessionStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) }, ...(withNative ? { navigation: native } : {}) }) as unknown as Window;
  let snapshot: BrowserNavigationSnapshot = { back: false, forward: false };
  return { browser, originalPush, observe: () => observeBrowserNavigation(browser, next => { snapshot = next; }), snapshot: () => snapshot };
}

test('fallback traverses real tabs, preserves router metadata, reloads and truncates forward history', () => {
  const f = fixture(), h = f.browser.history;
  let controller = f.observe();
  assert.deepEqual(f.snapshot(), { back: false, forward: false });
  h.pushState(h.state, '', '?tab=scf'); h.pushState(h.state, '', '?tab=canvas');
  assert.equal(h.state.router, 'preserved'); assert.equal(f.snapshot().back, true);
  h.go(-1); assert.deepEqual(f.snapshot(), { back: true, forward: true });
  assert.equal(controller.target(1), 'https://workspace.test/projects/test?tab=canvas');
  controller.dispose(); controller = f.observe();
  assert.deepEqual(f.snapshot(), { back: true, forward: true });
  h.replaceState(h.state, '', '?tab=scf&layout=full');
  h.go(1); h.go(-1);
  assert.equal(new URL(f.browser.location.href).searchParams.get('tab'), 'scf');
  h.pushState(h.state, '', '?tab=md');
  assert.deepEqual(f.snapshot(), { back: true, forward: false });
  assert.equal(controller.target(1), undefined); controller.dispose();
});

test('router native pushes are reconciled even when they bypass the public history wrapper', () => {
  const f = fixture(), controller = f.observe(), h = f.browser.history;
  f.originalPush(h.state, '', '/projects/second'); controller.sync();
  assert.deepEqual(f.snapshot(), { back: true, forward: false });
  h.go(-1); assert.equal(controller.target(1), 'https://workspace.test/projects/second');
  controller.dispose();
});

test('Navigation API changes do not recurse when annotating entries and traversal remains native', async () => {
  const f = fixture(true), controller = f.observe(), h = f.browser.history;
  h.pushState(h.state, '', '?tab=first'); h.pushState(h.state, '', '?tab=second');
  await Promise.resolve();
  assert.deepEqual(f.snapshot(), { back: true, forward: false });
  h.go(-1); await Promise.resolve();
  assert.deepEqual(f.snapshot(), { back: true, forward: true });
  assert.equal(controller.target(-1), 'https://workspace.test/projects/test');
  controller.dispose();
});

test('a bypassed router replace after Back preserves the existing Forward entry', () => {
  const f = fixture(), h = f.browser.history, originalReplace = h.replaceState;
  const controller = f.observe();
  h.pushState(h.state, '', '?tab=first'); h.pushState(h.state, '', '?tab=second'); h.go(-1);
  originalReplace.call(h, h.state, '', '?tab=first&layout=full'); controller.sync();
  assert.deepEqual(f.snapshot(), { back: true, forward: true });
  assert.equal(controller.target(1), 'https://workspace.test/projects/test?tab=second');
  controller.dispose();
});

test('earlier popstate normalization preserves the target entry identity', () => {
  const f = fixture(), h = f.browser.history;
  f.browser.addEventListener('popstate', () => h.replaceState(h.state, '', new URL(f.browser.location.href).pathname + '?tab=normalized'));
  const controller = f.observe();
  h.pushState(h.state, '', '?tab=first'); h.pushState(h.state, '', '?tab=second'); h.go(-1);
  assert.deepEqual(f.snapshot(), { back: true, forward: true });
  assert.equal(controller.target(1), 'https://workspace.test/projects/test?tab=second');
  controller.dispose();
});

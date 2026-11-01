type Entry = { scope: string; index: number; href: string };
type NativeNavigation = EventTarget & { canGoBack: boolean; canGoForward: boolean; currentEntry?: { index: number }; entries: () => { index: number; url?: string }[] };
export type BrowserNavigationSnapshot = { back: boolean; forward: boolean };
const stateKey = 'phyniteNavigation';
const storageKey = 'phynite:navigation-history';
// Vinext native router writes bypass the public History methods. Its existing
// traversal index distinguishes replace from push without altering router fields.
const routerIndex = (state: unknown): number | undefined => {
  const value = state && typeof state === 'object' ? (state as Record<string, unknown>).__vinext_historyIndex : undefined;
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined;
};
const readEntry = (state: unknown): Entry | undefined => {
  const value = state && typeof state === 'object' ? (state as Record<string, unknown>)[stateKey] as Entry | undefined : undefined;
  return value && typeof value.scope === 'string' && Number.isSafeInteger(value.index) && value.index >= 0 && typeof value.href === 'string' ? value : undefined;
};

/** Native traversal, with a session-scoped fallback for browsers without Navigation. */
export function observeBrowserNavigation(browser: Window, changed: (snapshot: BrowserNavigationSnapshot) => void) {
  const history = browser.history, push = history.pushState, replace = history.replaceState;
  const native = (browser as Window & { navigation?: NativeNavigation }).navigation;
  let entry = readEntry(history.state) ?? { scope: browser.crypto.randomUUID(), index: 0, href: browser.location.href };
  let entries: string[] = [];
  try { const saved = JSON.parse(browser.sessionStorage.getItem(storageKey) ?? 'null'); if (saved?.scope === entry.scope && Array.isArray(saved.entries)) entries = saved.entries; } catch {}
  entries[entry.index] = browser.location.href;
  let length = history.length;
  let previousRouterIndex = routerIndex(history.state), disposed = false;
  const save = () => { try { browser.sessionStorage.setItem(storageKey, JSON.stringify({ scope: entry.scope, entries })); } catch {} };
  const stamp = (data: unknown, next: Entry) => ({ ...(data && typeof data === 'object' ? data : {}), [stateKey]: next });
  replace.call(history, stamp(history.state, entry), '');
  const notify = () => {
    changed({ back: native?.canGoBack ?? entry.index > 0, forward: native?.canGoForward ?? entry.index < entries.length - 1 });
    browser.dispatchEvent(new Event('phynite:navigation-change'));
  };
  const sync = (traversal = false) => {
    if (disposed) return;
    const saved = readEntry(history.state), href = browser.location.href, nextRouterIndex = routerIndex(history.state);
    if (saved?.scope === entry.scope && saved.href === href) entry = saved;
    else if (traversal) {
      // An older, untracked entry is a new boundary; never invent a Forward target.
      entry = saved ?? { scope: browser.crypto.randomUUID(), index: 0, href };
      entries = [];
    } else if (href !== entry.href) {
      // Router implementations can retain their own native pushState reference.
      const pushed = nextRouterIndex !== undefined && previousRouterIndex !== undefined ? nextRouterIndex > previousRouterIndex : history.length > length;
      entry = { ...entry, index: entry.index + (pushed ? 1 : 0), href };
      if (pushed) entries = entries.slice(0, entry.index);
    }
    entries[entry.index] = href; length = history.length; previousRouterIndex = nextRouterIndex;
    if (saved?.scope !== entry.scope || saved.index !== entry.index || saved.href !== entry.href) replace.call(history, stamp(history.state, entry), '');
    save(); notify();
  };
  const patchedPush: History['pushState'] = function (data, unused, url) {
    const current = readEntry(history.state); if (current?.scope === entry.scope) entry = current;
    const next = { ...entry, index: entry.index + 1, href: new URL(url == null ? browser.location.href : String(url), browser.location.href).href };
    push.call(history, stamp(data, next), unused, url);
    entry = next; entries = entries.slice(0, entry.index); entries.push(entry.href); length = history.length; previousRouterIndex = routerIndex(history.state); save(); notify();
  };
  const patchedReplace: History['replaceState'] = function (data, unused, url) {
    const current = readEntry(history.state); if (current?.scope === entry.scope) entry = current;
    const next = { ...entry, href: new URL(url == null ? browser.location.href : String(url), browser.location.href).href };
    replace.call(history, stamp(data, next), unused, url);
    entry = next; entries[entry.index] = entry.href; previousRouterIndex = routerIndex(history.state); save(); notify();
  };
  history.pushState = patchedPush; history.replaceState = patchedReplace;
  const pop = () => sync(true), refresh = () => sync(), nativeRefresh = () => queueMicrotask(refresh);
  browser.addEventListener('popstate', pop); browser.addEventListener('pageshow', refresh);
  native?.addEventListener('currententrychange', nativeRefresh);
  save(); notify();
  return {
    sync: refresh,
    target: (direction: -1 | 1) => native?.entries().find(item => item.index === (native.currentEntry?.index ?? -1) + direction)?.url ?? entries[entry.index + direction],
    dispose: () => {
      disposed = true;
      if (history.pushState === patchedPush) history.pushState = push;
      if (history.replaceState === patchedReplace) history.replaceState = replace;
      browser.removeEventListener('popstate', pop); browser.removeEventListener('pageshow', refresh);
      native?.removeEventListener('currententrychange', nativeRefresh);
    },
  };
}

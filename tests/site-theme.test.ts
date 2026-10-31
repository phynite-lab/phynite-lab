import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACCOUNT_SETTINGS_KEY, ACCOUNT_SETTINGS_OWNER_KEY,
  hydrateAccountSettingsFromCloud, parseAccountSettings, type AccountSettings,
} from '../lib/account-settings.ts';
import { applySiteTheme, readSiteTheme, SITE_THEME_STORAGE_KEY, subscribeToSiteTheme } from '../lib/site-theme.ts';

function browser(t: { after: (callback: () => void) => void }) {
  const values = new Map<string, string>();
  const localStorage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
  const classNames = new Set<string>();
  const windowTarget = Object.assign(new EventTarget(), { localStorage });
  const documentValue = { documentElement: { dataset: {} as Record<string, string>, classList: { toggle: (name: string, active: boolean) => active ? classNames.add(name) : classNames.delete(name) }, style: {} as Record<string, string> } };
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window'), previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: windowTarget });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: documentValue });
  t.after(() => {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else Reflect.deleteProperty(globalThis, 'window');
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument); else Reflect.deleteProperty(globalThis, 'document');
  });
  return { values, windowTarget, documentValue, classNames };
}
const cloudProfile: AccountSettings = { version: 1, displayName: 'Researcher', institution: '', role: 'Researcher', researchArea: '', workspaceTheme: 'light' };

test('account settings always have a valid display name when the session email is empty', () => {
  assert.equal(parseAccountSettings('', '').displayName, 'Researcher');
});

test('cloud profile hydration never changes the theme on this device', t => {
  const state = browser(t);
  applySiteTheme('dark');
  hydrateAccountSettingsFromCloud('owner', cloudProfile);
  assert.equal(readSiteTheme(), 'dark');
  assert.equal(state.values.get(SITE_THEME_STORAGE_KEY), 'dark');
  assert.equal(JSON.parse(state.values.get(ACCOUNT_SETTINGS_KEY)!).workspaceTheme, 'light');
  hydrateAccountSettingsFromCloud('owner', { ...cloudProfile, workspaceTheme: 'dark' });
  applySiteTheme('light');
  hydrateAccountSettingsFromCloud('owner', { ...cloudProfile, workspaceTheme: 'dark' });
  assert.equal(readSiteTheme(), 'light');
  assert.equal(state.values.get(SITE_THEME_STORAGE_KEY), 'light');
});

test('a new browser ignores a cloud theme until a device choice is made', t => {
  const state = browser(t);
  hydrateAccountSettingsFromCloud('owner', { ...cloudProfile, workspaceTheme: 'dark' });
  assert.equal(readSiteTheme(), 'light');
  assert.equal(state.values.has(SITE_THEME_STORAGE_KEY), false);
});

test('theme selection persists after reload and account switches without editing profile', t => {
  const state = browser(t);
  hydrateAccountSettingsFromCloud('alpha', cloudProfile);
  const originalProfile = state.values.get(ACCOUNT_SETTINGS_KEY);
  applySiteTheme('dark');
  assert.equal(state.values.get(ACCOUNT_SETTINGS_KEY), originalProfile);
  // A fresh document reads the persisted device preference, not a cached profile.
  state.documentValue.documentElement.dataset = {};
  assert.equal(readSiteTheme(), 'dark');
  hydrateAccountSettingsFromCloud('beta', cloudProfile);
  assert.equal(state.values.get(ACCOUNT_SETTINGS_OWNER_KEY), 'beta');
  assert.equal(readSiteTheme(), 'dark');
  hydrateAccountSettingsFromCloud('alpha', cloudProfile);
  assert.equal(readSiteTheme(), 'dark');
});

test('cross-tab theme changes use device storage and never change the account cache', t => {
  const state = browser(t);
  hydrateAccountSettingsFromCloud('owner', cloudProfile);
  const originalProfile = state.values.get(ACCOUNT_SETTINGS_KEY);
  let changes = 0;
  const stop = subscribeToSiteTheme(() => changes++);
  const storage = (key: string | null) => state.windowTarget.dispatchEvent(Object.assign(new Event('storage'), { key }));
  storage(ACCOUNT_SETTINGS_KEY);
  assert.equal(changes, 0);
  state.values.set(SITE_THEME_STORAGE_KEY, 'dark'); storage(SITE_THEME_STORAGE_KEY);
  assert.equal(changes, 1);
  assert.equal(readSiteTheme(), 'dark');
  assert.equal(state.values.get(ACCOUNT_SETTINGS_KEY), originalProfile);
  state.values.delete(SITE_THEME_STORAGE_KEY); storage(null);
  assert.equal(readSiteTheme(), 'light');
  stop();
  storage(SITE_THEME_STORAGE_KEY);
  assert.equal(changes, 2);
});

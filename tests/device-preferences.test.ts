import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDevicePreferences, colorContrast, defaultDevicePreferences, DEVICE_PREFERENCES_KEY, parseDevicePreferences, readDevicePreferences } from '../lib/device-preferences.ts';
import { defaultKeyboardPreferences, KEYBOARD_PREFERENCES_KEY, matchesShortcut, parseKeyboardPreferences, readKeyboardPreferences, saveKeyboardPreferences, shortcutForEvent, validShortcut } from '../lib/keyboard-preferences.ts';
import { defaultLocalNotifications, finishedRuns, LOCAL_NOTIFICATIONS_KEY, notificationRunPath, parseLocalNotifications, readLocalNotifications, reconcileNotificationRuns, saveLocalNotifications } from '../lib/local-notifications.ts';

test('device preferences recover corrupt and legacy values and reject unreadable colors', () => {
  assert.deepEqual(parseDevicePreferences('invalid'), defaultDevicePreferences);
  assert.equal(parseDevicePreferences('{"fontSize":"large"}').fontSize, 15);
  assert.equal(parseDevicePreferences('{"fontSize":100,"codeFontSize":0,"accent":"unknown"}').fontSize, 13);
  assert.equal(parseDevicePreferences('{"customColors":true,"background":"url(secret)","foreground":"#ffffff"}').customColors, false);
  assert.equal(parseDevicePreferences('{"customColors":true,"background":"#ffffff","foreground":"#eeeeee"}').customColors, false);
  assert.equal(parseDevicePreferences('{"customColors":true,"background":"#000000","foreground":"#ffffff"}').customColors, true);
  assert.equal(colorContrast('#000000', '#ffffff'), 21);
  assert.deepEqual(parseLocalNotifications('[]'), defaultLocalNotifications);
});

test('device choices persist separately from account data and clear to defaults', t => {
  const values = new Map<string, string>([['account-profile', 'unchanged']]);
  const windowValue = Object.assign(new EventTarget(), { localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) } });
  const classes = new Set<string>(), styles = new Map<string, string>();
  const root = { dataset: {} as Record<string, string>, classList: { toggle: (key: string, enabled: boolean) => enabled ? classes.add(key) : classes.delete(key) }, style: { setProperty: (key: string, value: string) => styles.set(key, value) } };
  const before = ['window', 'document'].map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, 'window', { configurable: true, value: windowValue });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { documentElement: root } });
  t.after(() => ['window', 'document'].forEach((key, index) => { if (before[index]) Object.defineProperty(globalThis, key, before[index]!); else Reflect.deleteProperty(globalThis, key); }));
  const preference = { ...defaultDevicePreferences, density: 'compact' as const, fontSize: 16, reduceMotion: true };
  applyDevicePreferences(preference);
  assert.deepEqual(readDevicePreferences(), preference);
  assert.equal(root.dataset.uiDensity, 'compact'); assert.equal(classes.has('reduce-motion'), true);
  assert.equal(styles.get('--ui-text-scale'), String(16 / 13));
  const mutedMix = Number.parseFloat(styles.get('--ui-muted-mix') ?? '0');
  assert.ok(mutedMix >= 55);
  saveKeyboardPreferences({ ...defaultKeyboardPreferences, 'send-message': 'Mod+Enter' });
  saveLocalNotifications({ ...defaultLocalNotifications, jobFinished: false });
  values.delete(DEVICE_PREFERENCES_KEY); values.delete(KEYBOARD_PREFERENCES_KEY); values.delete(LOCAL_NOTIFICATIONS_KEY);
  assert.deepEqual(readDevicePreferences(), defaultDevicePreferences);
  assert.deepEqual(readKeyboardPreferences(), defaultKeyboardPreferences);
  assert.deepEqual(readLocalNotifications(), defaultLocalNotifications);
  assert.equal(values.get('account-profile'), 'unchanged');
  const event = { key: 'Enter', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false };
  assert.equal(matchesShortcut(event, 'send-message'), true);
  assert.equal(matchesShortcut({ ...event, shiftKey: true }, 'send-message'), false);
  assert.equal(matchesShortcut({ ...event, isComposing: true }, 'send-message'), false);
  assert.equal(matchesShortcut({ ...event, repeat: true }, 'send-message'), false);
  saveKeyboardPreferences({ ...defaultKeyboardPreferences, 'send-message': '' });
  assert.equal(matchesShortcut(event, 'send-message'), false);
});

test('custom muted text keeps readable contrast when the primary pair is near the threshold', () => {
  const values = new Map<string, string>();
  const windowValue = Object.assign(new EventTarget(), { localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) } });
  const styles = new Map<string, string>();
  const root = { dataset: { workspaceTheme: 'light' } as Record<string, string>, classList: { toggle() {} }, style: { setProperty: (key: string, value: string) => styles.set(key, value) } };
  const before = ['window', 'document'].map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, 'window', { configurable: true, value: windowValue });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { documentElement: root } });
  try {
    applyDevicePreferences({ ...defaultDevicePreferences, customColors: true, background: '#ffffff', foreground: '#767676' });
    assert.ok(Number.parseFloat(styles.get('--ui-muted-mix') ?? '0') >= 99);
  } finally {
    ['window', 'document'].forEach((key, index) => { if (before[index]) Object.defineProperty(globalThis, key, before[index]!); else Reflect.deleteProperty(globalThis, key); });
  }
});

test('keyboard capture preserves navigation keys and validates real combinations', () => {
  assert.equal(validShortcut('open-settings', 'Tab'), false);
  assert.equal(validShortcut('open-settings', 'Escape'), false);
  assert.equal(validShortcut('focus-chat', 'Shift+Escape'), true);
  assert.equal(validShortcut('focus-chat', 'Mod+Mod+F'), false);
  assert.equal(validShortcut('send-message', 'Shift+Enter'), false);
  assert.equal(validShortcut('send-message', 'Mod+Enter'), true);
  assert.equal(shortcutForEvent({ key: 'Shift', metaKey: false, ctrlKey: false, altKey: false, shiftKey: true }), null);
  assert.deepEqual(parseKeyboardPreferences('null'), defaultKeyboardPreferences);
});

test('notifications observe transitions and retain older active jobs outside recent history', async () => {
  const run = { id: 'old', name: 'Long run', status: 'RUNNING', calculationType: 'LAMMPS simulation' };
  assert.equal(finishedRuns(null, [{ ...run, status: 'COMPLETED' }]).length, 0);
  const previous = new Map([[run.id, run]]);
  const next = await reconcileNotificationRuns(previous, [], async missing => ({ ...missing, status: 'COMPLETED' }));
  assert.equal(finishedRuns(new Map([['old', 'RUNNING']]), [...next.values()])[0].status, 'COMPLETED');
  assert.equal((await reconcileNotificationRuns(previous, [], async () => { throw new Error('offline'); })).get('old')?.status, 'RUNNING');
  assert.equal((await reconcileNotificationRuns(previous, [], async () => null)).has('old'), false);
  assert.equal(notificationRunPath(run), '/api/phynite/v1/md/simulations/old');
  assert.equal(notificationRunPath({ ...run, calculationType: 'OVITO analysis' }), '/api/phynite/v1/md/analyses/old');
  assert.equal(notificationRunPath({ ...run, calculationType: 'scf' }), '/api/phynite/v1/calculations/old');
  assert.equal(finishedRuns(new Map([['old', 'COMPLETED']]), [...next.values()]).length, 0);
});

test('appearance modes retain independent palettes and safely migrate old preferences', async () => {
  const { activeAppearance, separateAppearanceModes, themePreset, updateAppearance } = await import('../lib/device-preferences.ts');
  const legacy = parseDevicePreferences('{"fontSize":16,"accent":"violet","reduceMotion":true}');
  assert.equal(legacy.reduceMotion, true);
  assert.equal(legacy.separateModes, false);
  let split = separateAppearanceModes(legacy, 'light', true);
  split = updateAppearance(split, 'dark', { ...themePreset('slate', 'dark'), fontSize: 18, contrast: 65 });
  assert.equal(activeAppearance(split, 'light').fontSize, 16);
  assert.equal(activeAppearance(split, 'dark').fontSize, 18);
  assert.equal(activeAppearance(split, 'dark').background, '#121821');
  assert.deepEqual(parseDevicePreferences(JSON.stringify(split)), split);
  const shared = separateAppearanceModes(split, 'dark', false);
  assert.equal(activeAppearance(shared, 'light').background, '#121821');
  assert.equal(activeAppearance(shared, 'dark').fontSize, 18);
  assert.equal(activeAppearance(defaultDevicePreferences, 'dark').background, '#000000');
  const corrupted = parseDevicePreferences('{"contrast":400,"reduceMotion":"invalid","diffMarkers":"other","modes":{"dark":{"fontSize":-1,"customColors":true,"background":"#ffffff","foreground":"#eeeeee"}}}');
  assert.equal(corrupted.contrast, 0); assert.equal(corrupted.reduceMotion, 'system'); assert.equal(corrupted.diffMarkers, 'color');
  assert.equal(corrupted.modes.dark.customColors, false);
});

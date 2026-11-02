export const KEYBOARD_PREFERENCES_KEY = 'phynite:keyboard-preferences';
export const KEYBOARD_PREFERENCES_EVENT = 'phynite:keyboard-preferences-change';
export const keyboardPreferenceDefinitions = [
  { id: 'focus-chat', label: 'Focus open AI chat', idn: 'Fokus chat AI terbuka', defaultValue: 'Shift+Escape' },
  { id: 'send-message', label: 'Send AI message', idn: 'Kirim pesan AI', defaultValue: 'Enter' },
  { id: 'toggle-sidebar', label: 'Toggle sidebar', idn: 'Buka/tutup sidebar', defaultValue: 'Mod+Shift+S' },
  { id: 'open-settings', label: 'Open settings', idn: 'Buka pengaturan', defaultValue: 'Mod+,' },
] as const;
export type ShortcutId = (typeof keyboardPreferenceDefinitions)[number]['id'];
export type KeyboardPreferences = Record<ShortcutId, string>;
export const defaultKeyboardPreferences = Object.fromEntries(keyboardPreferenceDefinitions.map(item => [item.id, item.defaultValue])) as KeyboardPreferences;
export type ShortcutEvent = { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; isComposing?: boolean; repeat?: boolean };
export function shortcutForEvent(event: ShortcutEvent): string | null {
  if (event.isComposing || ['Control', 'Meta', 'Alt', 'Shift', 'Dead', 'Unidentified'].includes(event.key)) return null;
  const key = event.key === ' ' ? 'Space' : event.key.length === 1 ? event.key.toUpperCase() : event.key;
  return [...(event.metaKey || event.ctrlKey ? ['Mod'] : []), ...(event.altKey ? ['Alt'] : []), ...(event.shiftKey ? ['Shift'] : []), key].join('+');
}
export function validShortcut(id: ShortcutId, value: string): boolean {
  if (value === '') return true;
  if (value.length > 60 || !/^(?:(?:Mod|Alt|Shift)\+)*[A-Za-z0-9,./;=\[\]`-]+$/.test(value)) return false;
  const parts = value.split('+');
  if (new Set(parts).size !== parts.length || ['Mod', 'Alt', 'Shift', 'Tab', 'Backspace', 'Delete'].includes(parts.at(-1)!)) return false;
  return id === 'send-message' ? ['Enter', 'Mod+Enter', 'Alt+Enter'].includes(value) : value.includes('Mod+') || value === 'Shift+Escape';
}
export function parseKeyboardPreferences(raw: string | null): KeyboardPreferences {
  try {
    const parsed = JSON.parse(raw ?? 'null');
    return Object.fromEntries(keyboardPreferenceDefinitions.map(item => [item.id, typeof parsed?.[item.id] === 'string' && validShortcut(item.id, parsed[item.id]) ? parsed[item.id] : item.defaultValue])) as KeyboardPreferences;
  } catch { return defaultKeyboardPreferences; }
}
let memory = JSON.stringify(defaultKeyboardPreferences);
export function keyboardPreferencesSnapshot() { try { return window.localStorage.getItem(KEYBOARD_PREFERENCES_KEY) ?? JSON.stringify(defaultKeyboardPreferences); } catch { return memory; } }
export function readKeyboardPreferences(): KeyboardPreferences { return typeof window === 'undefined' ? defaultKeyboardPreferences : parseKeyboardPreferences(keyboardPreferencesSnapshot()); }
export function matchesShortcut(event: ShortcutEvent, id: ShortcutId) { const binding = readKeyboardPreferences()[id]; return !event.repeat && Boolean(binding) && shortcutForEvent(event) === binding; }
export function saveKeyboardPreferences(value: KeyboardPreferences) {
  memory = JSON.stringify(value);
  try { window.localStorage.setItem(KEYBOARD_PREFERENCES_KEY, memory); } catch { /* Keep the in-memory preference usable. */ }
  window.dispatchEvent(new Event(KEYBOARD_PREFERENCES_EVENT));
}
export function subscribeKeyboardPreferences(listener: () => void) {
  const storage = (event: StorageEvent) => { if (event.key === KEYBOARD_PREFERENCES_KEY || event.key === null) listener(); };
  window.addEventListener('storage', storage); window.addEventListener(KEYBOARD_PREFERENCES_EVENT, listener);
  return () => { window.removeEventListener('storage', storage); window.removeEventListener(KEYBOARD_PREFERENCES_EVENT, listener); };
}

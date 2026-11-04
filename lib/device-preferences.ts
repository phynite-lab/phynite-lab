export const DEVICE_PREFERENCES_KEY = 'phynite:device-preferences';
export const DEVICE_PREFERENCES_EVENT = 'phynite:device-preferences-change';
export type UiDensity = 'comfortable' | 'compact';
export type AccentColor = 'neutral' | 'blue' | 'violet' | 'green' | 'orange';
export type AppearanceMode = 'light' | 'dark';
export type MotionPreference = 'system' | 'on' | 'off';
export type ThemePreset = 'phynite' | 'paper' | 'slate' | 'custom';
export type AppearanceValues = { fontSize: number; codeFontSize: number; accent: AccentColor; customColors: boolean; background: string; foreground: string; preset: ThemePreset; contrast: number };
export type DevicePreferences = AppearanceValues & { reduceMotion: boolean | 'system'; density: UiDensity; separateModes: boolean; modes: Record<AppearanceMode, AppearanceValues>; diffMarkers: 'color' | 'symbols' };
export function themePreset(preset: Exclude<ThemePreset, 'custom'>, mode: AppearanceMode): Pick<AppearanceValues, 'preset' | 'background' | 'foreground' | 'customColors'> {
  const palette = { phynite: { light: ['#fcfcfc', '#171717'], dark: ['#000000', '#ededed'] }, paper: { light: ['#fffdf7', '#29251f'], dark: ['#201e19', '#f1eadd'] }, slate: { light: ['#f6f8fc', '#202936'], dark: ['#121821', '#e5ecf6'] } }[preset][mode];
  return { preset, background: palette[0], foreground: palette[1], customColors: preset !== 'phynite' };
}
// Keep the unmodified Phynite theme at the neutral contrast baseline. Users can
// opt into a stronger text/line mix from Appearance → Advanced → Contrast.
const defaultAppearance: AppearanceValues = { ...themePreset('phynite', 'light'), fontSize: 13, codeFontSize: 12, accent: 'neutral', contrast: 0 };
export const defaultDevicePreferences: DevicePreferences = { ...defaultAppearance, reduceMotion: 'system', density: 'comfortable', separateModes: false, modes: { light: { ...defaultAppearance }, dark: { ...defaultAppearance, ...themePreset('phynite', 'dark') } }, diffMarkers: 'color' };
export function colorContrast(background: string, foreground: string): number {
  const luminance = (color: string) => {
    const channels = [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  };
  const a = luminance(background), b = luminance(foreground);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}
function mixHex(background: string, foreground: string, foregroundPercent: number): string {
  const weight = Math.max(0, Math.min(100, foregroundPercent)) / 100;
  const channels = [1, 3, 5].map(index => Math.round(parseInt(background.slice(index, index + 2), 16) * (1 - weight) + parseInt(foreground.slice(index, index + 2), 16) * weight));
  return `#${channels.map(channel => channel.toString(16).padStart(2, '0')).join('')}`;
}
function readableMutedMix(background: string, foreground: string, preferred: number): number {
  if (colorContrast(background, foreground) < 4.5) return 100;
  let low = 0, high = 100;
  for (let index = 0; index < 8; index++) {
    const middle = (low + high) / 2;
    if (colorContrast(background, mixHex(background, foreground, middle)) >= 4.5) high = middle;
    else low = middle;
  }
  return Math.max(preferred, Math.ceil(high));
}
function parseAppearance(value: Record<string, unknown>, fallback: AppearanceValues): AppearanceValues {
  const bounded = (input: unknown, defaultValue: number, min: number, max: number) => typeof input === 'number' && Number.isInteger(input) && input >= min && input <= max ? input : defaultValue;
  const color = (input: unknown, defaultValue: string) => typeof input === 'string' && /^#[a-f0-9]{6}$/i.test(input) ? input.toLowerCase() : defaultValue;
  const background = color(value.background, fallback.background), foreground = color(value.foreground, fallback.foreground);
  const preset = ['phynite', 'paper', 'slate', 'custom'].includes(String(value.preset)) ? value.preset as ThemePreset : value.customColors === true ? 'custom' : 'phynite';
  return { fontSize: bounded(value.fontSize === 'large' ? 15 : value.fontSize, fallback.fontSize, 12, 18), codeFontSize: bounded(value.codeFontSize, fallback.codeFontSize, 11, 18), accent: ['neutral', 'blue', 'violet', 'green', 'orange'].includes(String(value.accent)) ? value.accent as AccentColor : fallback.accent, customColors: (value.customColors === true || preset !== 'phynite') && colorContrast(background, foreground) >= 4.5, background, foreground, preset, contrast: bounded(value.contrast, fallback.contrast, 0, 100) };
}
export function parseDevicePreferences(raw: string | null): DevicePreferences {
  try {
    const value = JSON.parse(raw ?? 'null');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return defaultDevicePreferences;
    const modes = value.modes && typeof value.modes === 'object' ? value.modes : {};
    return { ...parseAppearance(value, defaultAppearance), reduceMotion: typeof value.reduceMotion === 'boolean' ? value.reduceMotion : 'system', density: value.density === 'compact' ? 'compact' : 'comfortable', separateModes: value.separateModes === true, modes: { light: parseAppearance(modes.light ?? {}, defaultDevicePreferences.modes.light), dark: parseAppearance(modes.dark ?? {}, defaultDevicePreferences.modes.dark) }, diffMarkers: value.diffMarkers === 'symbols' ? 'symbols' : 'color' };
  } catch { return defaultDevicePreferences; }
}
export function activeAppearance(value: DevicePreferences, mode: AppearanceMode): AppearanceValues {
  const selected = value.separateModes ? value.modes[mode] : value;
  const appearance: AppearanceValues = { fontSize: selected.fontSize, codeFontSize: selected.codeFontSize, accent: selected.accent, customColors: selected.customColors, background: selected.background, foreground: selected.foreground, preset: selected.preset, contrast: selected.contrast };
  return appearance.customColors ? appearance : { ...appearance, ...themePreset('phynite', mode) };
}
export function updateAppearance(value: DevicePreferences, mode: AppearanceMode, patch: Partial<AppearanceValues>): DevicePreferences {
  if (value.separateModes) return { ...value, modes: { ...value.modes, [mode]: { ...value.modes[mode], ...patch } } };
  return { ...value, ...patch };
}
export function separateAppearanceModes(value: DevicePreferences, mode: AppearanceMode, enabled: boolean): DevicePreferences {
  if (enabled === value.separateModes) return value;
  if (!enabled) return { ...value, ...activeAppearance(value, mode), separateModes: false };
  return { ...value, separateModes: true, modes: { light: { ...activeAppearance(value, 'light') }, dark: { ...activeAppearance(value, 'dark') } } };
}
let memory = JSON.stringify(defaultDevicePreferences);
export function devicePreferencesSnapshot() {
  try { return window.localStorage.getItem(DEVICE_PREFERENCES_KEY) ?? JSON.stringify(defaultDevicePreferences); } catch { return memory; }
}
export function readDevicePreferences() { return typeof window === 'undefined' ? defaultDevicePreferences : parseDevicePreferences(devicePreferencesSnapshot()); }
export function applyDevicePreferences(value: DevicePreferences, persist = true) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const appearance = activeAppearance(value, root.dataset.workspaceTheme === 'dark' ? 'dark' : 'light');
  root.dataset.uiDensity = value.density; root.dataset.uiAccent = appearance.accent;
  root.dataset.customColors = String(appearance.customColors); root.dataset.uiContrast = String(appearance.contrast); root.dataset.diffMarkers = value.diffMarkers;
  root.dataset.uiMotion = value.reduceMotion === 'system' ? 'system' : value.reduceMotion ? 'on' : 'off';
  root.style.setProperty('--device-background', appearance.background);
  root.style.setProperty('--device-foreground', appearance.foreground);
  root.style.setProperty('--ui-text-scale', String(appearance.fontSize / 13));
  root.style.setProperty('--ui-code-size', `${appearance.codeFontSize}px`);
  root.style.setProperty('--ui-muted-mix', `${readableMutedMix(appearance.background, appearance.foreground, 55 + appearance.contrast * .3)}%`);
  root.style.setProperty('--ui-line-mix', `${10 + appearance.contrast * .3}%`);
  const reduced = value.reduceMotion === 'system' ? (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) : value.reduceMotion;
  root.classList.toggle('reduce-motion', reduced);
  if (persist) {
    memory = JSON.stringify(value);
    try { window.localStorage.setItem(DEVICE_PREFERENCES_KEY, memory); } catch { /* Keep the active preference for this visit. */ }
  }
  window.dispatchEvent(new Event(DEVICE_PREFERENCES_EVENT));
}
export function subscribeToDevicePreferences(listener: () => void) {
  const storage = (event: StorageEvent) => { if (event.key === DEVICE_PREFERENCES_KEY || event.key === null) listener(); };
  window.addEventListener('storage', storage); window.addEventListener(DEVICE_PREFERENCES_EVENT, listener);
  return () => { window.removeEventListener('storage', storage); window.removeEventListener(DEVICE_PREFERENCES_EVENT, listener); };
}

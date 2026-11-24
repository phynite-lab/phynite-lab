'use client';
import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { readSiteThemePreference, SITE_THEME_EVENT, subscribeToSiteTheme, type SiteThemePreference } from '@/lib/site-theme';
import { MotionConfig } from 'framer-motion';
import { applyDevicePreferences, readDevicePreferences, DEVICE_PREFERENCES_KEY, subscribeToDevicePreferences, devicePreferencesSnapshot, defaultDevicePreferences, parseDevicePreferences } from '@/lib/device-preferences';
export function DevicePreferences({ children }: { children: ReactNode }) {
  const raw = useSyncExternalStore(subscribeToDevicePreferences, devicePreferencesSnapshot, () => JSON.stringify(defaultDevicePreferences));
  const preferences = parseDevicePreferences(raw);
  useEffect(() => {
    const desktop = window as Window & { phyniteNative?: { updateTheme?: (theme: SiteThemePreference) => Promise<void> } };
    const sendTheme = desktop.phyniteNative?.updateTheme;
    if (!sendTheme) return;
    let previous: SiteThemePreference | undefined;
    const sync = () => {
      const theme = readSiteThemePreference();
      if (theme === previous) return;
      previous = theme;
      void sendTheme(theme).catch(() => { if (previous === theme) previous = undefined; });
    };
    sync();
    return subscribeToSiteTheme(sync);
  }, []);
  useEffect(() => {
    applyDevicePreferences(readDevicePreferences(), false);
    const storage = (event: StorageEvent) => { if (event.key === DEVICE_PREFERENCES_KEY || event.key === null) applyDevicePreferences(readDevicePreferences(), false); };
    const apply = () => applyDevicePreferences(readDevicePreferences(), false);
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    motion.addEventListener('change', apply);
    window.addEventListener(SITE_THEME_EVENT, apply);
    window.addEventListener('storage', storage);
    return () => { window.removeEventListener('storage', storage); window.removeEventListener(SITE_THEME_EVENT, apply); motion.removeEventListener('change', apply); };
  }, []);
  return <MotionConfig reducedMotion={preferences.reduceMotion === 'system' ? 'user' : preferences.reduceMotion ? 'always' : 'never'}>{children}</MotionConfig>;
}

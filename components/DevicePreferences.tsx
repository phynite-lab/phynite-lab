'use client';
import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { SITE_THEME_EVENT } from '@/lib/site-theme';
import { MotionConfig } from 'framer-motion';
import { applyDevicePreferences, readDevicePreferences, DEVICE_PREFERENCES_KEY, subscribeToDevicePreferences, devicePreferencesSnapshot, defaultDevicePreferences, parseDevicePreferences } from '@/lib/device-preferences';
export function DevicePreferences({ children }: { children: ReactNode }) {
  const raw = useSyncExternalStore(subscribeToDevicePreferences, devicePreferencesSnapshot, () => JSON.stringify(defaultDevicePreferences));
  const preferences = parseDevicePreferences(raw);
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

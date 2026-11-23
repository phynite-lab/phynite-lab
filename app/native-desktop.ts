'use client';

import { useEffect, useEffectEvent, useRef, type MouseEvent } from 'react';
import {
  applyDevicePreferences, readDevicePreferences, subscribeToDevicePreferences,
  type MotionPreference, type UiDensity,
} from '@/lib/device-preferences';
import type { LocalePreference } from '@/lib/locale';
import { applySiteTheme, readSiteThemePreference, subscribeToSiteTheme, type SiteThemePreference } from '@/lib/site-theme';

type NativeLocale = 'system' | 'en' | 'id';
type NativeAppearance = [SiteThemePreference, NativeLocale, UiDensity, MotionPreference];

type DesktopWindow = Window & {
  phyniteDesktop?: true;
  phyniteNative?: {
    updateAppearance?: (...appearance: NativeAppearance) => Promise<void>;
    openSettings?: () => Promise<void>;
  };
};

function nativeDesktop() {
  const desktop = window as DesktopWindow;
  return desktop.phyniteDesktop === true ? desktop.phyniteNative : undefined;
}

export function useNativeAppearance(preference: LocalePreference | undefined, setPreference: (next: LocalePreference) => void) {
  const lastReported = useRef<NativeAppearance | null>(null);
  const initialized = preference !== undefined;

  const report = useEffectEvent((locale: LocalePreference | undefined = preference) => {
    const bridge = nativeDesktop();
    if (locale === undefined || !bridge?.updateAppearance) return;
    const { density, reduceMotion } = readDevicePreferences();
    const appearance: NativeAppearance = [
      readSiteThemePreference(),
      locale === 'auto' ? 'system' : locale,
      density,
      reduceMotion === 'system' ? 'system' : reduceMotion ? 'on' : 'off',
    ];
    if (appearance.every((value, index) => value === lastReported.current?.[index])) return;
    lastReported.current = appearance;
    void bridge.updateAppearance(...appearance).catch(() => {
      if (lastReported.current === appearance) lastReported.current = null;
    });
  });

  const applyNativeAppearance = useEffectEvent((detail: unknown) => {
    if (!detail || typeof detail !== 'object') return;
    const { theme, density, motion, locale } = detail as Record<string, unknown>;
    if ((theme === 'system' || theme === 'light' || theme === 'dark') && readSiteThemePreference() !== theme) applySiteTheme(theme);
    const current = readDevicePreferences();
    const nextDensity = density === 'comfortable' || density === 'compact' ? density : current.density;
    const nextMotion = motion === 'system' ? 'system' : motion === 'on' ? true : motion === 'off' ? false : current.reduceMotion;
    if (nextDensity !== current.density || nextMotion !== current.reduceMotion) {
      applyDevicePreferences({ ...current, density: nextDensity, reduceMotion: nextMotion });
    }
    const nextLocale = locale === 'system' ? 'auto' : locale === 'en' || locale === 'id' ? locale : undefined;
    if (nextLocale !== undefined && nextLocale !== preference) setPreference(nextLocale);
    return nextLocale;
  });

  useEffect(() => {
    if (!initialized || !nativeDesktop()?.updateAppearance) return;
    let applyingNative = false;
    const sendChanges = () => { if (!applyingNative) report(); };
    const unsubscribeTheme = subscribeToSiteTheme(sendChanges);
    const unsubscribeDevice = subscribeToDevicePreferences(sendChanges);
    const onNativeAppearance = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      applyingNative = true;
      try { report(applyNativeAppearance(event.detail)); }
      finally { applyingNative = false; }
    };
    window.addEventListener('phynite:native-appearance', onNativeAppearance);
    return () => {
      unsubscribeTheme();
      unsubscribeDevice();
      window.removeEventListener('phynite:native-appearance', onNativeAppearance);
    };
  }, [initialized]);

  useEffect(() => { report(preference); }, [preference]);
}

export function openNativeSettings(event: MouseEvent<HTMLAnchorElement>) {
  const bridge = nativeDesktop();
  if (!bridge?.openSettings || event.defaultPrevented || event.button !== 0 ||
    event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const href = event.currentTarget.href;
  event.preventDefault();
  void bridge.openSettings().catch(() => window.location.assign(href));
}

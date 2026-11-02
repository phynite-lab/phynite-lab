"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  readSiteTheme,
  applySiteTheme,
  subscribeToSiteTheme,
  readSiteThemePreference,
  type SiteTheme,
} from "@/lib/site-theme";

export function useSiteTheme() {
  const theme = useSyncExternalStore<SiteTheme>(
    subscribeToSiteTheme,
    readSiteTheme,
    () => "light",
  );
  const preference = useSyncExternalStore(subscribeToSiteTheme, readSiteThemePreference, () => 'light' as const);

  const toggleTheme = useCallback(() => {
    const activeTheme = readSiteTheme();
    const nextTheme: SiteTheme = activeTheme === "dark" ? "light" : "dark";
    applySiteTheme(nextTheme);
  }, []);

  return { theme, preference, toggleTheme };
}

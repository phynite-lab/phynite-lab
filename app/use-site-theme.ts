"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  readSiteTheme,
  applySiteTheme,
  subscribeToSiteTheme,
  type SiteTheme,
} from "@/lib/site-theme";

export function useSiteTheme() {
  const theme = useSyncExternalStore<SiteTheme>(
    subscribeToSiteTheme,
    readSiteTheme,
    () => "light",
  );

  const toggleTheme = useCallback(() => {
    const activeTheme = readSiteTheme();
    const nextTheme: SiteTheme = activeTheme === "dark" ? "light" : "dark";
    applySiteTheme(nextTheme);
  }, []);

  return { theme, toggleTheme };
}

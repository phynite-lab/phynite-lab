export const SITE_THEME_STORAGE_KEY = "phynite-calculation-theme";
export const SITE_THEME_EVENT = "phynite:site-theme-change";

export type SiteTheme = "light" | "dark";

function isSiteTheme(value: string | undefined | null): value is SiteTheme {
  return value === "light" || value === "dark";
}

function setThemeAttributes(theme: SiteTheme) {
  const root = document.documentElement;
  root.dataset.siteTheme = theme;
  root.dataset.workspaceTheme = theme;
  root.classList.toggle("site-dark", theme === "dark");
  root.style.colorScheme = theme;
}

export function readSiteTheme(): SiteTheme {
  if (typeof window === "undefined") return "light";

  const activeTheme = document.documentElement.dataset.siteTheme
    ?? document.documentElement.dataset.workspaceTheme;
  if (isSiteTheme(activeTheme)) return activeTheme;

  try {
    return window.localStorage.getItem(SITE_THEME_STORAGE_KEY) === "dark"
      ? "dark"
      : "light";
  } catch {
    return "light";
  }
}

export function applySiteTheme(theme: SiteTheme, persist = true) {
  if (typeof document === "undefined") return;
  setThemeAttributes(theme);
  if (persist) {
    try {
      window.localStorage.setItem(SITE_THEME_STORAGE_KEY, theme);
    } catch {
      // The selected theme still applies for the current visit.
    }
  }
  window.dispatchEvent(new CustomEvent<SiteTheme>(SITE_THEME_EVENT, { detail: theme }));
}

export function subscribeToSiteTheme(listener: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key !== SITE_THEME_STORAGE_KEY && event.key !== null) return;
    const value = window.localStorage.getItem(SITE_THEME_STORAGE_KEY);
    applySiteTheme(value === 'dark' ? 'dark' : 'light', false);
  };
  window.addEventListener('storage', storage);
  window.addEventListener(SITE_THEME_EVENT, listener);
  return () => {
    window.removeEventListener('storage', storage);
    window.removeEventListener(SITE_THEME_EVENT, listener);
  };
}

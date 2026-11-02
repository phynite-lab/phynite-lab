export const SITE_THEME_STORAGE_KEY = "phynite-calculation-theme";
export const SITE_THEME_EVENT = "phynite:site-theme-change";

export type SiteTheme = "light" | "dark";
export type SiteThemePreference = SiteTheme | 'system';

export function readSiteThemePreference(): SiteThemePreference {
  try { const value = window.localStorage.getItem(SITE_THEME_STORAGE_KEY); return value === 'system' || value === 'dark' ? value : 'light'; }
  catch { return typeof document !== 'undefined' && document.documentElement.dataset.themePreference === 'system' ? 'system' : readSiteTheme(); }
}

function resolveSiteTheme(preference: SiteThemePreference): SiteTheme {
  return preference === 'system' ? (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : preference;
}

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
    const value = window.localStorage.getItem(SITE_THEME_STORAGE_KEY);
    return resolveSiteTheme(value === 'system' || value === 'dark' ? value : 'light');
  } catch {
    return "light";
  }
}

export function applySiteTheme(preference: SiteThemePreference, persist = true) {
  if (typeof document === "undefined") return;
  const theme = resolveSiteTheme(preference);
  setThemeAttributes(theme);
  document.documentElement.dataset.themePreference = preference;
  if (persist) {
    try {
      window.localStorage.setItem(SITE_THEME_STORAGE_KEY, preference);
    } catch {
      // The selected theme still applies for the current visit.
    }
  }
  window.dispatchEvent(new CustomEvent<SiteTheme>(SITE_THEME_EVENT, { detail: theme }));
}

export function subscribeToSiteTheme(listener: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key !== SITE_THEME_STORAGE_KEY && event.key !== null) return;
    applySiteTheme(readSiteThemePreference(), false);
  };
  const media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : undefined;
  const systemChange = () => { if (readSiteThemePreference() === 'system') applySiteTheme('system', false); };
  media?.addEventListener('change', systemChange);
  window.addEventListener('storage', storage);
  window.addEventListener(SITE_THEME_EVENT, listener);
  return () => {
    media?.removeEventListener('change', systemChange);
    window.removeEventListener('storage', storage);
    window.removeEventListener(SITE_THEME_EVENT, listener);
  };
}

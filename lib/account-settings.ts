export const ACCOUNT_SETTINGS_KEY = "phynite:account-settings:v1";
export const ACCOUNT_SETTINGS_EVENT = "phynite:account-settings-change";
export const ACCOUNT_SETTINGS_OWNER_KEY = "phynite:account-settings-owner:v1";

export type AccountSettings = {
  version: 1;
  displayName: string;
  institution: string;
  role: string;
  researchArea: string;
  workspaceTheme: "light" | "dark";
  avatarDataUrl?: string;
};

export function getAccountSettingsSnapshot() {
  if (typeof window === "undefined") return "";

  try {
    return window.localStorage.getItem(ACCOUNT_SETTINGS_KEY) ?? "";
  } catch {
    return "";
  }
}

export function getServerAccountSettingsSnapshot() {
  return "";
}

export function subscribeToAccountSettings(listener: () => void) {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === ACCOUNT_SETTINGS_KEY) listener();
  };

  window.addEventListener("storage", handleStorage);
  window.addEventListener(ACCOUNT_SETTINGS_EVENT, listener);

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(ACCOUNT_SETTINGS_EVENT, listener);
  };
}

export function parseAccountSettings(raw: string, email: string): AccountSettings {
  const fallbackName = email
    .split("@")[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "Researcher";

  if (raw) {
    try {
      const settings = JSON.parse(raw) as Partial<AccountSettings>;
      if (settings.version === 1) {
        return {
          version: 1,
          displayName: settings.displayName?.trim() || fallbackName,
          institution: settings.institution?.trim() || "",
          role: settings.role || "Researcher",
          researchArea: settings.researchArea?.trim() || "",
          workspaceTheme: settings.workspaceTheme === "dark" ? "dark" : "light",
          avatarDataUrl: typeof settings.avatarDataUrl === "string" && /^data:image\/(png|jpeg|webp);base64,/.test(settings.avatarDataUrl) ? settings.avatarDataUrl : "",
        };
      }
    } catch {
      // Fall back to a clean profile if local settings are invalid.
    }
  }

  return {
    version: 1,
    displayName: fallbackName,
    institution: "",
    role: "Researcher",
    researchArea: "",
    workspaceTheme: "light",
  };
}

function currentOwner() {
  try { return window.localStorage.getItem(ACCOUNT_SETTINGS_OWNER_KEY); } catch { return null; }
}

export function saveAccountSettings(settings: AccountSettings) {
  // Keep the profile cache separate from device appearance, including legacy cloud themes.
  window.localStorage.setItem(ACCOUNT_SETTINGS_KEY, JSON.stringify(settings));
  window.dispatchEvent(new Event(ACCOUNT_SETTINGS_EVENT));
}

export function hydrateAccountSettingsFromCloud(userId: string, settings: AccountSettings) {
  bindAccountSettingsToUser(userId);
  saveAccountSettings(settings);
}

export function bindAccountSettingsToUser(userId: string) {
  const owner = currentOwner();
  if (owner && owner !== userId) window.localStorage.removeItem(ACCOUNT_SETTINGS_KEY);
  window.localStorage.setItem(ACCOUNT_SETTINGS_OWNER_KEY, userId);
  if (owner !== userId) {
    window.dispatchEvent(new Event(ACCOUNT_SETTINGS_EVENT));
  }
}

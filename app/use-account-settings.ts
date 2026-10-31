"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  ACCOUNT_SETTINGS_OWNER_KEY,
  getAccountSettingsSnapshot,
  getServerAccountSettingsSnapshot,
  parseAccountSettings,
  subscribeToAccountSettings,
} from "@/lib/account-settings";

export function useAccountSettings(email: string, owner?: string) {
  const snapshot = useCallback(() => {
    if (owner) { try { if (window.localStorage.getItem(ACCOUNT_SETTINGS_OWNER_KEY) !== owner) return ''; } catch { return ''; } }
    return getAccountSettingsSnapshot();
  }, [owner]);
  const rawSettings = useSyncExternalStore(
    subscribeToAccountSettings,
    snapshot,
    getServerAccountSettingsSnapshot,
  );
  const settings = useMemo(
    () => parseAccountSettings(rawSettings, email),
    [email, rawSettings],
  );

  return { settings, rawSettings };
}

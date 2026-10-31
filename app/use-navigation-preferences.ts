'use client';

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { NavigationPreferencesClient, defaultNavigationPreferences, type NavigationSnapshot } from '@/lib/navigation-preferences';
import { projectNavigationTransport } from '@/lib/project-navigation-preferences';

const serverSnapshot: NavigationSnapshot = { preferences: defaultNavigationPreferences(), revision: 0, status: 'loading', error: '' };

export function useNavigationPreferences(owner: string) {
  const client = useMemo(() => {
    let storage: Storage | undefined;
    try { if (typeof window !== 'undefined') storage = window.localStorage; } catch {}
    return new NavigationPreferencesClient(owner, projectNavigationTransport, storage, 'v2');
  }, [owner]);
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot, () => serverSnapshot);
  useEffect(() => {
    client.connect();
    void client.sync();
    const refresh = () => { if (document.visibilityState !== 'hidden') void client.sync(); };
    const storage = (event: StorageEvent) => { if (event.key?.startsWith(client.pendingPrefix)) refresh(); };
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    window.addEventListener('storage', storage);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      client.dispose();
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      window.removeEventListener('storage', storage);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [client]);
  return { ...snapshot, change: client.change.bind(client), retry: () => void client.sync() };
}

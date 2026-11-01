'use client';

import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { ResourceAccountStore, resourceAccountStore } from '@/lib/resource-account-store';

export function useLabAccount(ownerId?: string, { passive = false }: { passive?: boolean } = {}) {
  const store = useMemo(() => ownerId ? resourceAccountStore(ownerId) : new ResourceAccountStore(async () => { throw new Error('Sign in to view resources.'); }), [ownerId]);
  const serverSnapshot = useMemo(() => ({ account: null, profile: null, loading: true, error: '', updatedAt: null }), []);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, () => serverSnapshot);
  const refresh = useCallback(async () => { if (ownerId) await store.refresh().catch(() => undefined); }, [ownerId, store]);
  useEffect(() => {
    if (!ownerId || passive) return;
    void store.refresh().catch(() => undefined);
  }, [ownerId, passive, store]);
  useEffect(() => {
    if (!ownerId || passive) return;
    const listener = () => { void refresh(); };
    window.addEventListener('phynite:balance-change', listener);
    window.addEventListener('phynite:compute-target-change', listener);
    return () => {
      window.removeEventListener('phynite:balance-change', listener);
      window.removeEventListener('phynite:compute-target-change', listener);
    };
  }, [ownerId, passive, refresh]);
  return { ...state, setAccount: store.setAccount, setProfile: store.setProfile, refresh };
}

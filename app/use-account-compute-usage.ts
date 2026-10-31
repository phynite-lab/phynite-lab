'use client';

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { AccountComputeUsageStore, accountComputeUsageStore, watchAccountComputeUsage } from '@/lib/account-compute-usage-store';

const serverSnapshot = { usage: null, loading: false, error: '', stale: false, updatedAt: null };
export function useAccountComputeUsage(owner?: string, enabled = true, projectId?: string) {
  const store = useMemo(() => owner ? accountComputeUsageStore(owner, { projectId }) : new AccountComputeUsageStore(async () => { throw new Error('Sign in to view usage.'); }), [owner, projectId]);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, () => serverSnapshot);
  useEffect(() => {
    if (!owner || !enabled) return;
    return watchAccountComputeUsage(store, window, document);
  }, [owner, enabled, store]);
  return { ...state, refresh: store.refresh };
}

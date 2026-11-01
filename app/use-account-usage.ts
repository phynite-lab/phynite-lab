'use client';

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { ResourceUsageStore, resourceUsageStore, invalidateResourceUsageStores } from '@/lib/resource-usage-store';
import type { AccountUsageRequestOptions } from '@/lib/account-api';

const serverSnapshot = { usage: null, loading: false, error: '', stale: false };
export function useAccountUsage(owner: string | undefined, enabled = false, options: AccountUsageRequestOptions = {}) {
  const projectId = options.projectId;
  const store = useMemo(() => owner ? resourceUsageStore(owner, { projectId }) : new ResourceUsageStore(async () => { throw new Error('Sign in to view usage.'); }), [owner, projectId]);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, () => serverSnapshot);
  useEffect(() => { if (owner && enabled) void store.ensure().catch(() => undefined); }, [owner, enabled, store]);
  useEffect(() => {
    if (!owner) return;
    // Job artifacts can make a measurement stale, but must not trigger inventory.
    const invalidate = () => invalidateResourceUsageStores(owner);
    window.addEventListener('phynite:usage-change', invalidate);
    return () => {
      window.removeEventListener('phynite:usage-change', invalidate);
    };
  }, [owner, store]);
  return { ...state, refresh: store.refresh };
}

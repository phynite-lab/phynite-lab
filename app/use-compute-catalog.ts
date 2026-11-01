'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ComputeCatalog } from '@/lib/compute-selection';

export function useComputeCatalog(enabled = true) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ catalog: ComputeCatalog | null; error: boolean; loading: boolean }>({ catalog: null, error: false, loading: true });
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    fetch('/api/compute/catalog', { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('Compute catalog unavailable');
      const payload = await response.json() as { catalog: ComputeCatalog };
      if (!payload.catalog || !Array.isArray(payload.catalog.profiles) || payload.catalog.profiles.some(profile => !Number.isSafeInteger(profile.hourlyMicros) || profile.hourlyMicros <= 0 || !Number.isFinite(profile.hourlyQuanta) || profile.hourlyQuanta !== profile.hourlyMicros / 1_000_000 || !Number.isSafeInteger(profile.vcpus) || profile.vcpus <= 0 || !Number.isSafeInteger(profile.memoryMiB) || profile.memoryMiB <= 0)) throw new Error('Invalid compute catalog');
      return payload;
    }).then(result => {
      if (!controller.signal.aborted) setState({ catalog: result.catalog, error: false, loading: false });
    }).catch(() => {
      if (!controller.signal.aborted) setState({ catalog: null, error: true, loading: false });
    });
    return () => controller.abort();
  }, [enabled, attempt]);
  const retry = useCallback(() => { setState({ catalog: null, error: false, loading: true }); setAttempt(value => value + 1); }, []);
  return { ...state, loading: enabled && state.loading, retry };
}

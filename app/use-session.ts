"use client";

import { createContext, useContext, useCallback, useEffect, useRef, useState } from "react";
import { subscribeToSession, type PhyniteSession } from "./auth-client";
import { bindAccountSettingsToUser } from '@/lib/account-settings';
import { requestSession } from '@/lib/session-request';

export const ResearchSessionContext = createContext<{ session: PhyniteSession | null; ready: boolean; refresh: () => Promise<void> } | null>(null);

export function useSession() {
  const shared = useContext(ResearchSessionContext);
  const [session, setSession] = useState<PhyniteSession | null>(null);
  const [ready, setReady] = useState(false);
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    const active = ++generation.current;
    try {
      const response = await requestSession();
      if (active !== generation.current) return;
      if (!response.ok) {
        setSession(null);
        return;
      }
      const payload = await response.json() as {
        user: PhyniteSession["user"];
        expiresAt?: string;
        mode?: 'local';
        cloud?: PhyniteSession['cloud'];
      };
      const { ensureResearchReset } = await import('@/lib/research-reset');
      if (payload.mode !== 'local') await ensureResearchReset();
      if (active !== generation.current) return;
      // Bind preferences before authenticated children can read or change them.
      try { bindAccountSettingsToUser(payload.user.id); } catch { /* A disabled cache must not prevent sign-in. */ }
      setSession({ user: payload.user, expiresAt: payload.expiresAt, mode: payload.mode, cloud: payload.cloud });
    } catch {
      if (active === generation.current) setSession(null);
    } finally {
      if (active === generation.current) setReady(true);
    }
  }, []);

  useEffect(() => {
    if (shared) return;
    let mounted = true;
    const cleanupGeneration = generation.current;
    queueMicrotask(() => { if (mounted) void refresh(); });
    const unsubscribe = subscribeToSession(() => void refresh());
    return () => {
      mounted = false;
      generation.current = cleanupGeneration + 1;
      unsubscribe();
    };
  }, [refresh, shared]);

  return shared ?? { session, ready, refresh };
}

'use client';
import { WorkspaceLoading } from '@/components/WorkspaceLoading';

import { useEffect, type ReactNode } from 'react';
import { ResearchSessionContext, useSession } from './use-session';
import { useLocale } from './locale-provider';

export function ResearchAccessGate({ children }: { children: ReactNode }) {
  const state = useSession();
  const { session, ready } = state;
  const { t } = useLocale();
  useEffect(() => {
    if (!ready) return;
    if (session?.user.isDeveloper) {
      window.location.replace('/developer/overview');
    } else if (!session) {
      window.location.replace(`/login?returnTo=${encodeURIComponent(window.location.pathname + window.location.search + window.location.hash)}`);
    }
  }, [ready, session]);
  if (!ready || !session || session.user.isDeveloper) {
    return <WorkspaceLoading layout="page" label={t('Opening your account…', 'Membuka akun…')} />;
  }
  return <ResearchSessionContext.Provider value={state}>{children}</ResearchSessionContext.Provider>;
}

'use client';

import { useEffect } from 'react';
import { MdStudio } from '@/components/MdStudio';
import { useSession } from '../use-session';
import { StudioLabOperations } from '../studio-navigation';

export function MdExperience() {
  const { session, ready } = useSession();
  useEffect(() => {
    if (ready && !session) window.location.replace('/login?returnTo=%2Fmd');
  }, [ready, session]);
  if (!ready || !session) return <main className="workspace-loading"><p>{ready ? 'Opening sign in' : 'Opening MD Lab'}</p></main>;
  return <div className="md-page-shell"><MdStudio key={session.user.id} ownerId={session.user.id} session={session} /><StudioLabOperations session={session} active="md" /></div>;
}

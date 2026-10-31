'use client';

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { ProjectAiHistory } from '@/lib/project-ai-history';

export function useProjectAiHistory(projectId: string, legacyId?: string) {
  const history = useMemo(() => new ProjectAiHistory(projectId, legacyId), [projectId, legacyId]);
  const snapshot = useSyncExternalStore(history.subscribe, history.getSnapshot, history.getSnapshot);
  useEffect(() => () => history.cancel(), [history]);
  return { ...snapshot, refresh: history.refresh, add: history.add, remove: history.remove };
}

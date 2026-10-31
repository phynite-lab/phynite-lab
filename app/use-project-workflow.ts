'use client';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { ProjectWorkflowClient } from '@/lib/project-workflow-cache';
import { projectWorkflowApi } from '@/lib/project-workflow-api';
export function useProjectWorkflow(owner: string, project: string) {
  const client = useMemo(() => new ProjectWorkflowClient(owner, project, { get: () => projectWorkflowApi.get(project), save: (workflow, revision) => projectWorkflowApi.save(project, workflow, revision) }, (() => { try { return typeof window === 'undefined' ? undefined : window.localStorage; } catch { return undefined; } })()), [owner, project]);
  const serverSnapshot = useMemo(() => client.getSnapshot(), [client]);
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, () => serverSnapshot);
  useEffect(() => {
    client.connect(); void client.refresh();
    const refresh = () => { if (document.visibilityState !== 'hidden') void client.refresh(); };
    window.addEventListener('online', refresh); window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
    return () => { client.dispose(); window.removeEventListener('online', refresh); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [client]);
  useEffect(() => { if (state.status !== 'saving') return; const timer = setTimeout(() => void client.flush(), 600); return () => clearTimeout(timer); }, [client, state.workflow, state.status]);
  return { ...state, client };
}

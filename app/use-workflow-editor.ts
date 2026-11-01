'use client';
import { useEffect, useReducer, useRef, useState } from 'react';
import { initialWorkflowEditorState, restoreWorkflowEditor, workflowEditorReducer, workflowEditorSearch, type WorkflowEditorState } from '@/lib/workflow-editor-state';
import type { ProjectWorkflow } from '@/lib/project-workflow';
export function useWorkflowEditor(owner: string, project: string, graph: ProjectWorkflow, ready: boolean) {
  const [state, dispatch] = useReducer(workflowEditorReducer, initialWorkflowEditorState);
  const [hydrated, setHydrated] = useState(false);
  const latest = useRef({ graph, state });
  useEffect(() => { latest.current = { graph, state }; }, [graph, state]);
  const key = `phynite:workflow-editor:v2:${owner}:${project}`;
  useEffect(() => {
    if (!ready || hydrated) return;
    let saved: unknown = null;
    try { saved = JSON.parse(localStorage.getItem(key) ?? localStorage.getItem(`phynite:workflow-editor:v1:${owner}:${project}`) ?? 'null'); } catch {}
    const params = new URLSearchParams(location.search);
    if (!params.has('tab') && !params.has('popup')) {
      const legacy = graph.nodes.find(node => params.get('legacy-view') === 'figures' ? node.legacy?.editor === 'figures' : params.get('legacy-trajectory') ? node.resources.some(ref => ref.id === params.get('legacy-trajectory')) : params.get('legacy-component') ? node.legacy?.componentId === params.get('legacy-component') : params.get('legacy-material') ? node.legacy?.materialId === params.get('legacy-material') : false);
      if (legacy) params.set('tab', legacy.id);
    }
    const restored = restoreWorkflowEditor(saved, graph.nodes.map(node => node.id), params.toString(), graph.edges.map(edge => edge.id));
    queueMicrotask(() => { dispatch({ type: 'restore', state: restored }); setHydrated(true); });
    const search = workflowEditorSearch(location.search, restored);
    history.replaceState(history.state, '', location.pathname + search);
  }, [ready, hydrated, graph.nodes, graph.edges, owner, project, key]);
  useEffect(() => { if (hydrated) dispatch({ type:'reconcile', ids:graph.nodes.map(node => node.id) }); }, [graph.nodes, hydrated]);
  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(key, JSON.stringify(state)); } catch {}
  }, [key, state, hydrated]);
  useEffect(() => {
    if (!hydrated) return;
    const next = workflowEditorSearch(location.search, state);
    if (next !== location.search) history.pushState(history.state, '', location.pathname + next);
  }, [hydrated, state]);
  useEffect(() => {
    const restore = () => {
      const search = new URLSearchParams(location.search); if (!search.has('tab') && !search.has('popup')) search.set('tab','canvas');
      const restored = restoreWorkflowEditor(latest.current.state, latest.current.graph.nodes.map(node => node.id), search.toString());
      const normalized = workflowEditorSearch(location.search, restored);
      if (normalized !== location.search) history.replaceState(history.state, '', location.pathname + normalized);
      dispatch({ type:'restore', state:restored });
    };
    window.addEventListener('popstate', restore); return () => window.removeEventListener('popstate', restore);
  }, []);
  return { state, dispatch, hydrated };
}
export function workflowEditorCamera(state: WorkflowEditorState) { return state.viewport ?? { x:40, y:140, zoom:.8 }; }

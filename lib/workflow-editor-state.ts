import type { WorkflowEdgeAnchors } from './project-workflow-interaction.ts';
/** Launcher tabs are device UI state, never scientific graph nodes. */
export const isWorkflowLauncherTab = (id:string) => /^new:[A-Za-z0-9_-]{1,80}$/.test(id);
/** Reserved UI tool ID cannot collide with scientific node identifiers. */
export const workflowAiTab = 'tool:ai';
export const isWorkflowAiTab = (id: string) => id === workflowAiTab || /^tool:ai:aic_[a-z0-9]+$/.test(id);
export const aiConversationTab = (id: string) => { if (!/^aic_[a-z0-9]+$/.test(id)) throw new Error('Invalid AI conversation.'); return `${workflowAiTab}:${id}`; };
export const aiConversationFromTab = (id: string) => /^tool:ai:(aic_[a-z0-9]+)$/.exec(id)?.[1];
export const workflowStudyTab = 'tool:study';
export const workflowFilesTab = 'tool:files';
export type WorkflowEditorState = { version: 2; paneOrderVersion?: 1; tabs: string[]; activeTab: string; canvasClosed?: boolean; tabsHidden?: boolean; pinnedTabs?: string[]; layout: 'full' | 'split'; splitAxis?: 'horizontal' | 'vertical'; aiPanel?: { id: string; presentation: 'floating' | 'composer' | 'minimized'; x?: number; y?: number; bottom?: number; width?: number; height?: number }; aiPanelBounds?: { x?: number; y?: number; bottom?: number; width?: number; height?: number }; lastChat?: string; lastModule?: string; splitTabs?: [string, string]; tabPanes?: Record<string, 0 | 1>; paneTabsHidden?: [boolean, boolean]; splitRatio: number; tool: 'select' | 'hand'; snapToGrid?: boolean; showGuides?: boolean; viewport?: { x: number; y: number; zoom: number }; edgeAnchors?: Record<string, WorkflowEdgeAnchors> };
export const initialWorkflowEditorState: WorkflowEditorState = { version: 2, paneOrderVersion: 1, tabs: [], activeTab: 'canvas', pinnedTabs: ['canvas'], layout: 'full', splitRatio: .65, tool: 'select' };
export type WorkflowEditorAction = { type: 'toggle-split'; id?: string } | { type: 'maximize'; id: string } | { type: 'pane-tabs-hidden'; pane: 0 | 1; hidden: boolean } | { type: 'tabs-hidden'; hidden: boolean } | { type: 'split'; id: string; beside: string; direction?: 'left' | 'right' | 'top' | 'bottom' } | { type: 'swap' } | { type: 'axis'; axis: 'horizontal' | 'vertical' } | { type: 'ai-presentation'; id: string; presentation: 'tab' | 'floating' | 'composer' | 'minimized' } | { type: 'panel-position'; x: number; y: number; bottom?: number } | { type: 'panel-size'; width: number; height: number } | { type: 'restore'; state: WorkflowEditorState } | { type: 'open' | 'close' | 'pin'; id: string; pane?: 0 | 1 } | { type:'close-all' } | { type: 'reconcile'; ids: string[] } | { type: 'reorder'; id: string; before: string } | {type:'resolve-launcher';tabId:string;nodeId:string} | { type: 'layout'; layout: 'full' | 'split' } | { type: 'ratio'; ratio: number } | { type: 'tool'; tool: 'select' | 'hand' } | { type: 'viewport'; viewport: NonNullable<WorkflowEditorState['viewport']> } | { type: 'snapping'; grid: boolean; guides: boolean } | { type: 'edge-anchors'; id: string; anchors: WorkflowEdgeAnchors };
export function workflowEditorTabs(state: WorkflowEditorState): string[] {
  const tabs = [...new Set(state.tabs.filter(id => id !== 'canvas'))], pinned = new Set(state.pinnedTabs);
  return ['canvas', ...tabs.filter(id => pinned.has(id)), ...tabs.filter(id => !pinned.has(id))];
}
/** Reopen the conversation the user is working in, never an unresolved AI launcher. */
export function workflowPreferredAiTab(state: WorkflowEditorState): string | undefined {
  return [state.activeTab, state.aiPanel?.id, state.lastChat].find(id => Boolean(id && aiConversationFromTab(id) && state.tabs.includes(id)));
}
/** The selected tab is focus; the split pair keeps left/right placement stable. */
export function workflowSplitTabs(state: WorkflowEditorState): [string, string] | undefined {
  if (state.layout !== 'split') return;
  const tabs = workflowEditorTabs(state);
  if (state.splitTabs?.length === 2 && state.splitTabs[0] !== state.splitTabs[1] && state.splitTabs.every(id => tabs.includes(id)) && state.splitTabs.includes(state.activeTab)) return state.splitTabs;
  if (state.activeTab !== 'canvas' && !isWorkflowLauncherTab(state.activeTab) && tabs.includes(state.activeTab)) return isWorkflowAiTab(state.activeTab) ? ['canvas', state.activeTab] : [state.activeTab, 'canvas'];
}
/** Tab ownership is independent of which pane currently has keyboard focus. */
export function workflowPaneTabs(state: WorkflowEditorState): [string[], string[]] {
  const pair = workflowSplitTabs(state), tabs = workflowEditorTabs(state);
  return [0, 1].map(pane => tabs.filter(id => (pair?.includes(id) ? pair.indexOf(id) : (state.tabPanes?.[id] === 1 ? 1 : 0)) === pane)) as [string[], string[]];
}
/** Shared pane descriptions keep headers and content on the same selected pair. */
export function workflowPaneViews(state: WorkflowEditorState, splitVisible = state.layout === 'split') {
  const pair = splitVisible ? workflowSplitTabs(state) : undefined, groups = workflowPaneTabs(state);
  return (pair ?? [state.tabsHidden ? 'canvas' : state.activeTab]).map((id, index) => ({
    id, index: index as 0 | 1, kind: pair && isWorkflowAiTab(id) ? 'chat' as const : 'tabs' as const,
    tabs: pair ? groups[index] : workflowEditorTabs(state),
  }));
}
function rememberedPair(state: WorkflowEditorState): [string, string] | undefined {
  const pair = state.splitTabs, tabs = workflowEditorTabs(state);
  return pair?.length === 2 && pair[0] !== pair[1] && pair.every(id => tabs.includes(id) && !isWorkflowLauncherTab(id)) ? pair : undefined;
}
/** Placement commands retain the selected pane's peer before choosing a new pair. */
export function workflowSplitPeer(state: WorkflowEditorState, id: string): string | undefined {
  const tabs = workflowEditorTabs(state), usable = (candidate?: string): candidate is string => Boolean(candidate && candidate !== id && tabs.includes(candidate) && !isWorkflowLauncherTab(candidate));
  if (!tabs.includes(id) || isWorkflowLauncherTab(id)) return;
  const pair = workflowSplitTabs(state) ?? rememberedPair(state);
  if (pair?.includes(id)) {
    const peer = pair.find(candidate => candidate !== id);
    if (usable(peer)) return peer;
  }
  if (usable(state.activeTab)) return state.activeTab;
  if (isWorkflowAiTab(id)) return usable(state.lastModule) && !isWorkflowAiTab(state.lastModule) ? state.lastModule : tabs.findLast(candidate => usable(candidate) && candidate !== 'canvas' && !isWorkflowAiTab(candidate)) ?? 'canvas';
  const chat = workflowPreferredAiTab(state);
  return usable(chat) ? chat : usable(state.lastModule) ? state.lastModule : tabs.findLast(candidate => usable(candidate) && candidate !== 'canvas' && !isWorkflowAiTab(candidate)) ?? (id !== 'canvas' ? 'canvas' : undefined);
}
function launcherPane(state: WorkflowEditorState, id: string): 0 | 1 {
  const selectedPane = state.splitTabs?.indexOf(id);
  return selectedPane === 0 || selectedPane === 1 ? selectedPane : state.tabPanes?.[id] === 1 ? 1 : 0;
}
/** Older saved states may contain many empty launchers; keep one for each pane. */
function normalizeLauncherTabs(state: WorkflowEditorState): WorkflowEditorState {
  const launchers = state.tabs.filter(isWorkflowLauncherTab), keep: Array<string | undefined> = [undefined, undefined];
  for (const id of launchers) {
    const pane = launcherPane(state, id);
    if (keep[pane] !== state.activeTab) keep[pane] = id;
  }
  const replacements = new Map(launchers.filter(id => keep[launcherPane(state, id)] !== id).map(id => [id, keep[launcherPane(state, id)]!]));
  if (!replacements.size) return state;
  const remap = (id: string) => replacements.get(id) ?? id;
  return { ...state, tabs: state.tabs.filter(id => !replacements.has(id)), activeTab: remap(state.activeTab),
    ...(state.splitTabs ? { splitTabs: state.splitTabs.map(remap) as [string, string] } : {}),
    ...(state.pinnedTabs ? { pinnedTabs: [...new Set(state.pinnedTabs.map(remap))] } : {}),
    tabPanes: { ...Object.fromEntries(Object.entries(state.tabPanes ?? {}).filter(([id]) => !replacements.has(id))), ...Object.fromEntries(keep.flatMap((id, pane) => id ? [[id, pane as 0 | 1]] : [])) } };
}
function paneAssignments(state: WorkflowEditorState): Record<string, 0 | 1> {
  const groups = workflowPaneTabs(state);
  return Object.fromEntries(groups.flatMap((tabs, pane) => tabs.map(id => [id, pane as 0 | 1])));
}
function splitPaneAssignments(state: WorkflowEditorState, pair: [string, string]): Record<string, 0 | 1> {
  const chat = pair.findIndex(isWorkflowAiTab), assignments = paneAssignments(state);
  if (chat >= 0 && pair.filter(isWorkflowAiTab).length === 1) {
    for (const id of workflowEditorTabs(state)) assignments[id] = (isWorkflowAiTab(id) ? chat : 1 - chat) as 0 | 1;
  }
  return { ...assignments, [pair[0]]: 0, [pair[1]]: 1 };
}
function sanitizePanelBounds(raw: unknown): WorkflowEditorState['aiPanelBounds'] {
  if (!raw || typeof raw !== 'object') return;
  const values = raw as Record<string, unknown>, bounds: NonNullable<WorkflowEditorState['aiPanelBounds']> = {};
  for (const key of ['x', 'y', 'bottom', 'width', 'height'] as const) {
    const value = values[key];
    if (typeof value === 'number' && Number.isFinite(value)) bounds[key] = key === 'width' ? Math.max(320, Math.min(1600, value)) : key === 'height' ? Math.max(260, Math.min(1400, value)) : Math.max(0, value);
  }
  return bounds;
}
function availableEditorView(state: WorkflowEditorState): WorkflowEditorState {
  const tabs = workflowEditorTabs(state);
  if (!tabs.includes(state.activeTab)) return { ...state, activeTab: 'canvas', layout: 'full', splitTabs: undefined };
  if (state.splitTabs && !state.splitTabs.every(id => tabs.includes(id))) return { ...state, layout: 'full', splitTabs: undefined };
  if (state.aiPanel && (state.layout === 'full' && isWorkflowAiTab(state.activeTab) || workflowSplitTabs(state)?.includes(state.aiPanel.id))) return { ...state, aiPanel: undefined };
  return state;
}
export function workflowEditorReducer(state: WorkflowEditorState, action: WorkflowEditorAction): WorkflowEditorState {
  const next = normalizeLauncherTabs(reduceWorkflowEditor(state, action));
  if (next === state) return state;
  const mergedPanel = next.aiPanel ? { ...state.aiPanelBounds, ...next.aiPanel } : undefined;
  const panel = mergedPanel ?? state.aiPanel;
  const bounds = panel ? sanitizePanelBounds(panel) : next.aiPanelBounds;
  return { ...next, ...(bounds ? { aiPanelBounds: bounds } : {}), ...(mergedPanel ? { aiPanel: mergedPanel } : {}) };
}
function reduceWorkflowEditor(state: WorkflowEditorState, action: WorkflowEditorAction): WorkflowEditorState {
  switch (action.type) {
    case 'maximize': {
      if (!workflowEditorTabs(state).includes(action.id)) return state;
      const chat = workflowSplitTabs(state)?.find(isWorkflowAiTab) ?? state.aiPanel?.id;
      return { ...state, tabsHidden: false, activeTab: action.id, layout: 'full', lastChat: isWorkflowAiTab(action.id) ? action.id : chat ?? state.lastChat,
        aiPanel: isWorkflowAiTab(action.id) ? undefined : chat ? { ...state.aiPanel, id: chat, presentation: 'composer' } : state.aiPanel };
    }
    case 'toggle-split': {
      const focused = action.id ?? state.activeTab;
      if (!workflowEditorTabs(state).includes(focused) || isWorkflowLauncherTab(focused)) return state;
      if (state.layout === 'split') return workflowEditorReducer(state, { type: 'maximize', id: focused });
      const tabs = workflowEditorTabs(state), remembered = rememberedPair(state);
      let pair: [string, string] | undefined = remembered ? [...remembered] : undefined;
      if (pair && !pair.includes(focused) && !isWorkflowLauncherTab(focused)) {
        const chatIndex = pair.findIndex(isWorkflowAiTab);
        const target = chatIndex >= 0 ? (isWorkflowAiTab(focused) ? chatIndex : 1 - chatIndex) : state.tabPanes?.[focused] ?? (pair.indexOf(state.activeTab) === 0 ? 0 : 1);
        pair[target] = focused;
      }
      if (!pair) {
        const chat = isWorkflowAiTab(focused) ? focused : state.aiPanel?.id ?? (state.lastChat && tabs.includes(state.lastChat) ? state.lastChat : undefined) ?? tabs.findLast(isWorkflowAiTab);
        const workspace = !isWorkflowAiTab(focused) && !isWorkflowLauncherTab(focused) ? focused : (state.lastModule && tabs.includes(state.lastModule) ? state.lastModule : undefined) ?? tabs.findLast(id => id !== 'canvas' && !isWorkflowAiTab(id) && !isWorkflowLauncherTab(id)) ?? 'canvas';
        pair = chat && tabs.includes(chat) ? [workspace, chat] : workspace !== 'canvas' ? [workspace, 'canvas'] : undefined;
      }
      if (!pair || pair[0] === pair[1]) return state;
      return { ...state, tabsHidden: false, layout: 'split', splitTabs: pair, activeTab: pair.includes(focused) ? focused : pair[0], lastChat: pair.find(isWorkflowAiTab) ?? state.lastChat,
        tabPanes: splitPaneAssignments(state, pair), paneTabsHidden: [false, false],
        aiPanel: state.aiPanel && !pair.includes(state.aiPanel.id) ? state.aiPanel : undefined };
    }
    case 'pane-tabs-hidden': { const hidden: [boolean, boolean] = [...(state.paneTabsHidden ?? [false, false])]; hidden[action.pane] = action.hidden; return { ...state, paneTabsHidden: hidden }; }
    case 'tabs-hidden': return { ...state, tabsHidden: action.hidden };
    case 'restore': { const restored = availableEditorView({ ...action.state, canvasClosed: false, pinnedTabs: ['canvas', ...(action.state.pinnedTabs ?? []).filter(id => id !== 'canvas')] }); return !isWorkflowAiTab(restored.activeTab) && restored.lastChat && restored.tabs.includes(restored.lastChat) && !workflowSplitTabs(restored)?.includes(restored.lastChat) && !restored.aiPanel ? { ...restored, aiPanel: { ...restored.aiPanelBounds, id: restored.lastChat, presentation: 'composer' } } : restored; }
    case 'split': {
      if (action.id === action.beside || [action.id, action.beside].some(isWorkflowLauncherTab)) return state;
      const tabs = [...new Set([...state.tabs, ...[action.id, action.beside].filter(id => id !== 'canvas')])];
      const pair: [string, string] = !action.direction && [action.id, action.beside].filter(isWorkflowAiTab).length === 1 ? isWorkflowAiTab(action.id) ? [action.beside, action.id] : [action.id, action.beside] : action.direction === 'right' || action.direction === 'bottom' ? [action.beside, action.id] : [action.id, action.beside];
      return { ...state, tabsHidden: false, paneTabsHidden: [false, false], tabPanes: splitPaneAssignments(state, pair), tabs, activeTab: action.id, layout: 'split', splitTabs: pair, lastChat: isWorkflowAiTab(action.id) ? action.id : isWorkflowAiTab(action.beside) ? action.beside : state.lastChat, ...(action.direction ? { splitAxis: action.direction === 'top' || action.direction === 'bottom' ? 'vertical' : 'horizontal' } : {}), aiPanel: state.aiPanel && [action.id, action.beside].includes(state.aiPanel.id) ? undefined : state.aiPanel };
    }
    case 'swap': return state.splitTabs ? { ...state, splitTabs: [state.splitTabs[1], state.splitTabs[0]], splitRatio: 1 - state.splitRatio, tabPanes: Object.fromEntries(Object.entries(paneAssignments(state)).map(([id, pane]) => [id, pane === 0 ? 1 : 0])), paneTabsHidden: state.paneTabsHidden ? [state.paneTabsHidden[1], state.paneTabsHidden[0]] : undefined } : state;
    case 'axis': return { ...state, splitAxis: action.axis };
    case 'ai-presentation': {
      if (!isWorkflowAiTab(action.id)) return state;
      const pair = workflowSplitTabs(state);
      const tabs = state.tabs.includes(action.id) ? state.tabs : [...state.tabs, action.id];
      if (action.presentation === 'tab') return { ...state, tabsHidden: false, lastChat: action.id, tabs, aiPanel: undefined, activeTab: action.id, layout: 'full' };
      return { ...state, tabsHidden: false, tabs, lastChat: action.id, aiPanel: { ...state.aiPanel, id: action.id, presentation: action.presentation }, activeTab: isWorkflowAiTab(state.activeTab) ? workflowSplitTabs(state)?.find(id => !isWorkflowAiTab(id)) ?? 'canvas' : state.activeTab, layout: pair && !pair.includes(action.id) ? state.layout : 'full' };
    }
    case 'panel-position': {
      if (!Number.isFinite(action.x) || !Number.isFinite(action.y)) return state;
      const position = { x: Math.max(0, action.x), y: Math.max(0, action.y), ...(typeof action.bottom === 'number' && Number.isFinite(action.bottom) ? { bottom: Math.max(0, action.bottom) } : {}) };
      return state.aiPanel ? { ...state, aiPanel: { ...state.aiPanel, ...position } } : { ...state, aiPanelBounds: { ...state.aiPanelBounds, ...position } };
    }
    case 'panel-size': {
      if (!Number.isFinite(action.width) || !Number.isFinite(action.height)) return state;
      const size = { width: Math.max(320, Math.min(1600, action.width)), height: Math.max(260, Math.min(1400, action.height)) };
      return state.aiPanel ? { ...state, aiPanel: { ...state.aiPanel, ...size } } : { ...state, aiPanelBounds: { ...state.aiPanelBounds, ...size } };
    }
    case 'open': {
      const pair = workflowSplitTabs(state);
      const assignments = paneAssignments(state);
      const assigned = assignments[action.id];
      const chatPane = pair?.filter(isWorkflowAiTab).length === 1 ? pair.findIndex(isWorkflowAiTab) : undefined;
      const target = action.pane ?? (pair?.includes(action.id) ? pair.indexOf(action.id) : chatPane !== undefined && !isWorkflowLauncherTab(action.id) ? isWorkflowAiTab(action.id) ? chatPane : 1 - chatPane : assigned === 0 || assigned === 1 ? assigned : pair?.indexOf(state.activeTab) === 1 ? 1 : 0);
      if (isWorkflowLauncherTab(action.id)) {
        const launchers = state.tabs.filter(id => isWorkflowLauncherTab(id) && launcherPane(state, id) === target);
        const existing = launchers.includes(state.activeTab) ? state.activeTab : launchers.at(-1);
        if (existing && existing !== action.id) return reduceWorkflowEditor(state, { ...action, id: existing, pane: target as 0 | 1 });
      }
      const splitTabs = pair ? [...pair] as [string, string] : undefined;
      if (splitTabs && splitTabs[target] !== action.id) {
        const other = target === 0 ? 1 : 0;
        if (splitTabs[other] === action.id) { splitTabs[other] = splitTabs[target]; assignments[splitTabs[other]] = other; }
        splitTabs[target] = action.id;
      }
      if (splitTabs || isWorkflowLauncherTab(action.id)) assignments[action.id] = target as 0 | 1;
      const leavesChat = action.id !== state.activeTab && isWorkflowAiTab(state.activeTab) && (!pair || !splitTabs?.includes(state.activeTab));
      const aiPanel = isWorkflowAiTab(action.id) ? undefined : leavesChat
        ? { ...state.aiPanel, id: state.activeTab, presentation: 'composer' as const }
        : state.aiPanel ? { ...state.aiPanel, presentation: state.aiPanel.presentation === 'minimized' ? 'minimized' as const : 'composer' as const } : undefined;
      return { ...state, ...(isWorkflowAiTab(action.id) ? { lastChat: action.id } : !isWorkflowLauncherTab(action.id) ? { lastModule: action.id } : {}), tabsHidden: false, aiPanel, ...(splitTabs ? { splitTabs, tabPanes: assignments, paneTabsHidden: (state.paneTabsHidden ?? [false, false]).map((hidden, pane) => pane === target ? false : hidden) as [boolean, boolean] } : isWorkflowLauncherTab(action.id) ? { tabPanes: assignments } : {}), ...(action.id === 'canvas' ? { canvasClosed: false } : {}), tabs: action.id === 'canvas' || state.tabs.includes(action.id) ? state.tabs : [...state.tabs, action.id], activeTab: action.id };
    }
    case 'resolve-launcher': {
      if((!isWorkflowLauncherTab(action.tabId)&&action.tabId!==workflowAiTab)||!state.tabs.includes(action.tabId))return workflowEditorReducer(state,{type:'open',id:action.nodeId});
      if (isWorkflowLauncherTab(action.tabId) && state.tabs.includes(action.nodeId)) {
        const pane = workflowPaneTabs(state)[1].includes(action.tabId) ? 1 : 0;
        return workflowEditorReducer(workflowEditorReducer(state, {type:'close',id:action.tabId}), {type:'open',id:action.nodeId,pane});
      }
      const tabs=state.tabs.includes(action.nodeId)?state.tabs.filter(id=>id!==action.tabId):state.tabs.map(id=>id===action.tabId?action.nodeId:id);
      return {...state,tabsHidden:false,tabs,activeTab:action.nodeId,tabPanes: { ...paneAssignments(state), [action.nodeId]: paneAssignments(state)[action.tabId] ?? 0 },...(state.aiPanel?.id === action.tabId ? { aiPanel: { ...state.aiPanel, id: action.nodeId } } : {}),...(state.splitTabs ? { splitTabs: state.splitTabs.map(id => id === action.tabId ? action.nodeId : id) as [string, string] } : {}),...(state.pinnedTabs ? { pinnedTabs: [...new Set(state.pinnedTabs.map(id => id === action.tabId ? action.nodeId : id))] } : {})};
    }
    case 'close': {
      if (action.id === 'canvas' || !state.tabs.includes(action.id)) return state;
      const active = state.activeTab === action.id;
      const pair = workflowSplitTabs(state);
      const survivor = pair?.find(id => id !== action.id);
      const closesPane = pair?.includes(action.id);
      const pane = pair?.indexOf(action.id), replacement = closesPane && state.splitTabs ? workflowPaneTabs(state)[pane!].filter(id => id !== action.id && id !== state.aiPanel?.id).at(-1) : undefined;
      if (pair && replacement) return { ...state, tabs: state.tabs.filter(id => id !== action.id), pinnedTabs: state.pinnedTabs?.filter(id => id !== action.id), aiPanel: state.aiPanel?.id === action.id ? undefined : state.aiPanel, activeTab: active ? replacement : state.activeTab, splitTabs: pair.map(id => id === action.id ? replacement : id) as [string, string] };
      return { ...state, ...(state.layout === 'full' && state.splitTabs?.includes(action.id) ? { splitTabs: undefined } : {}), aiPanel: state.aiPanel?.id === action.id ? undefined : state.aiPanel, tabs: state.tabs.filter(id => id !== action.id), pinnedTabs: ['canvas', ...(state.pinnedTabs ?? []).filter(id => id !== action.id && id !== 'canvas')], ...(closesPane ? { activeTab: survivor ?? 'canvas', layout: 'full', splitTabs: undefined } : active ? { activeTab: 'canvas', layout: 'full', splitTabs: undefined } : {}) };
    }
    case 'close-all': return { ...state, aiPanel: undefined, tabPanes: undefined, paneTabsHidden: undefined, tabs: [], activeTab: 'canvas', layout: 'full', splitTabs: undefined, canvasClosed: false, pinnedTabs: ['canvas'] };
    case 'reconcile': {
      const ids = new Set([...action.ids, workflowAiTab, workflowStudyTab, workflowFilesTab]), tabs = state.tabs.filter(id => id !== 'canvas' && (ids.has(id)||isWorkflowLauncherTab(id)||isWorkflowAiTab(id)));
      if (tabs.length === state.tabs.length && workflowEditorTabs(state).includes(state.activeTab) && !state.canvasClosed && (!state.splitTabs || state.splitTabs.every(id => id === 'canvas' || tabs.includes(id)))) return state;
      return availableEditorView({ ...state, canvasClosed: false, tabs, pinnedTabs: ['canvas', ...(state.pinnedTabs ?? []).filter(id => id !== 'canvas' && tabs.includes(id))] });
    }
    case 'reorder': {
      if (action.id === action.before || !state.tabs.includes(action.id) || !state.tabs.includes(action.before) || Boolean(state.pinnedTabs?.includes(action.id)) !== Boolean(state.pinnedTabs?.includes(action.before))) return state;
      const tabs = state.tabs.filter(id => id !== action.id); tabs.splice(tabs.indexOf(action.before), 0, action.id);
      return { ...state, tabs };
    }
    case 'pin': {
      if (action.id === 'canvas' || !workflowEditorTabs(state).includes(action.id)) return state;
      const pinned = ['canvas', ...(state.pinnedTabs ?? []).filter(id => id !== 'canvas')];
      return { ...state, pinnedTabs: pinned.includes(action.id) ? pinned.filter(id => id !== action.id) : [...pinned, action.id] };
    }
    case 'layout': return action.layout === state.layout ? state : workflowEditorReducer(state, action.layout === 'full' ? { type: 'maximize', id: state.activeTab } : { type: 'toggle-split' });
    case 'ratio': return { ...state, splitRatio: Number.isFinite(action.ratio) ? Math.max(0, Math.min(1, action.ratio)) : state.splitRatio };
    case 'tool': return { ...state, tool: action.tool };
    case 'viewport': return { ...state, viewport: action.viewport };
    case 'snapping': return { ...state, snapToGrid: action.grid, showGuides: action.guides };
    case 'edge-anchors': return { ...state, edgeAnchors: { ...state.edgeAnchors, [action.id]: action.anchors } };
  }
}
export function restoreWorkflowEditor(raw: unknown, ids: string[], search: string, edgeIds?: string[]): WorkflowEditorState {
  const saved = raw && typeof raw === 'object' ? raw as Omit<Partial<WorkflowEditorState>, 'aiPanel'> & { aiPanel?: Omit<NonNullable<WorkflowEditorState['aiPanel']>, 'presentation'> & { presentation: string } } : {}, available = new Set([...ids, workflowAiTab, workflowStudyTab, workflowFilesTab]);
  const tabs = [...new Set(Array.isArray(saved.tabs) ? saved.tabs.filter(id => typeof id === 'string' && id !== 'canvas' && (available.has(id)||isWorkflowLauncherTab(id)||isWorkflowAiTab(id))) : [])];
  const params = new URLSearchParams(search);
  let requested = params.get('tab') ?? params.get('popup');
  if (requested === workflowAiTab && /^aic_[a-z0-9]+$/.test(params.get('chat') ?? '')) requested = aiConversationTab(params.get('chat')!);
  // Old all-closed links return to the permanent Canvas foundation.
  if (requested === '') tabs.splice(0);
  const activeTab = requested === '' ? 'canvas' : requested !== null ? available.has(requested)||isWorkflowLauncherTab(requested)||isWorkflowAiTab(requested) ? requested : 'canvas' : tabs.includes(saved.activeTab ?? '') ? saved.activeTab! : 'canvas';
  if (activeTab && activeTab !== 'canvas' && !tabs.includes(activeTab)) tabs.push(activeTab);
  const requestedPair = params.get('beside');
  const splitTabs = requestedPair ? params.get('side') === 'right' ? [requestedPair, activeTab] : [activeTab, requestedPair] : saved.splitTabs;
  let safePair = Array.isArray(splitTabs) && splitTabs.length === 2 && splitTabs.every(id => typeof id === 'string' && id !== '' && (id === 'canvas' || available.has(id) || isWorkflowAiTab(id) || isWorkflowLauncherTab(id))) && splitTabs[0] !== splitTabs[1] ? splitTabs as [string, string] : undefined;
  // Migrate the previous automatic chat-first layout once; explicit new placements remain restorable.
  const migrateOrder = Boolean(raw && typeof raw === 'object' && saved.paneOrderVersion !== 1 && safePair && isWorkflowAiTab(safePair[0]) && !isWorkflowAiTab(safePair[1]));
  if (migrateOrder && safePair) safePair = [safePair[1], safePair[0]];
  for (const id of safePair ?? []) if (id !== 'canvas' && !tabs.includes(id)) tabs.push(id);
  const viewport = saved.viewport;
  const edges = edgeIds ? new Set(edgeIds) : undefined;
  const edgeAnchors = Object.fromEntries(saved.edgeAnchors && typeof saved.edgeAnchors === 'object' && !Array.isArray(saved.edgeAnchors)
    ? Object.entries(saved.edgeAnchors).slice(0, 10000).filter(([id, value]) => id.length > 0 && id.length <= 200 && (!edges || edges.has(id)) && value && typeof value === 'object' && ['right', 'bottom'].includes(value.source) && ['left', 'top'].includes(value.target)).map(([id, value]) => [id, { source: value.source, target: value.target }]) : []);
  const pinnedTabs = ['canvas', ...new Set(Array.isArray(saved.pinnedTabs) ? saved.pinnedTabs.filter(id => typeof id === 'string' && id !== 'canvas' && tabs.includes(id)) : [])];
  const tabPanes = Object.fromEntries(saved.tabPanes && typeof saved.tabPanes === 'object' && !Array.isArray(saved.tabPanes) ? Object.entries(saved.tabPanes).filter(([id, pane]) => (id === 'canvas' || tabs.includes(id)) && (pane === 0 || pane === 1)) : []) as Record<string, 0 | 1>;
  if (migrateOrder) for (const id of ['canvas', ...tabs]) tabPanes[id] = isWorkflowAiTab(id) ? 1 : 0;
  return availableEditorView(normalizeLauncherTabs({ ...initialWorkflowEditorState, tabPanes, aiPanelBounds: sanitizePanelBounds(saved.aiPanelBounds), lastChat: saved.lastChat && tabs.includes(saved.lastChat) && isWorkflowAiTab(saved.lastChat) ? saved.lastChat : undefined, lastModule: saved.lastModule && (saved.lastModule === 'canvas' || tabs.includes(saved.lastModule)) && !isWorkflowAiTab(saved.lastModule) && !isWorkflowLauncherTab(saved.lastModule) ? saved.lastModule : undefined, paneTabsHidden: migrateOrder ? [saved.paneTabsHidden?.[1] === true, saved.paneTabsHidden?.[0] === true] : [saved.paneTabsHidden?.[0] === true, saved.paneTabsHidden?.[1] === true], tabsHidden: saved.tabsHidden === true, tabs, activeTab, splitAxis: params.get('axis') === 'vertical' || !params.has('axis') && saved.splitAxis === 'vertical' ? 'vertical' : 'horizontal', ...(saved.aiPanel && saved.aiPanel.id !== activeTab && tabs.includes(saved.aiPanel.id) && isWorkflowAiTab(saved.aiPanel.id) && ['floating', 'composer', 'compact', 'minimized'].includes(saved.aiPanel.presentation) ? { aiPanel: { id: saved.aiPanel.id, presentation: saved.aiPanel.presentation === 'floating' ? 'floating' : saved.aiPanel.presentation === 'minimized' ? 'minimized' : 'composer', ...(Number.isFinite(saved.aiPanel.bottom) ? { bottom: Math.max(0, saved.aiPanel.bottom!) } : {}), ...(Number.isFinite(saved.aiPanel.x) && Number.isFinite(saved.aiPanel.y) ? { x: Math.max(0, saved.aiPanel.x!), y: Math.max(0, saved.aiPanel.y!) } : {}), ...(Number.isFinite(saved.aiPanel.width) && Number.isFinite(saved.aiPanel.height) ? { width: Math.max(320, Math.min(1600, saved.aiPanel.width!)), height: Math.max(260, Math.min(1400, saved.aiPanel.height!)) } : {}) } } : {}), canvasClosed: false, pinnedTabs, ...(safePair ? { splitTabs: safePair } : {}), layout: params.has('layout') ? params.get('layout') === 'split' ? 'split' : 'full' : saved.layout === 'split' ? 'split' : 'full', tool: saved.tool === 'hand' ? 'hand' : 'select', snapToGrid: saved.snapToGrid !== false, showGuides: saved.showGuides !== false, splitRatio: typeof saved.splitRatio === 'number' && Number.isFinite(saved.splitRatio) ? Math.max(0, Math.min(1, migrateOrder ? 1 - saved.splitRatio : saved.splitRatio)) : .65, ...(viewport && [viewport.x, viewport.y, viewport.zoom].every(Number.isFinite) && viewport.zoom >= .1 && viewport.zoom <= 2.5 ? { viewport } : {}), ...(Object.keys(edgeAnchors).length ? { edgeAnchors } : {}) }));
}
export function workflowEditorSearch(search: string, state: WorkflowEditorState): string {
  const params = new URLSearchParams(search); params.delete('popup');
  if (state.activeTab === 'canvas') params.delete('tab'); else params.set('tab', state.activeTab);
  const chat = aiConversationFromTab(state.activeTab); if (chat) params.set('chat', chat); else params.delete('chat');
  const pair = workflowSplitTabs(state);
  if (pair) { params.set('axis', state.splitAxis === 'vertical' ? 'vertical' : 'horizontal'); params.set('layout', 'split'); const beside = pair.find(id => id !== state.activeTab)!; params.set('beside', beside); if (pair[1] === state.activeTab) params.set('side', 'right'); else params.delete('side'); } else { params.delete('axis'); params.set('layout', 'full'); params.delete('beside'); params.delete('side'); }
  return params.size ? `?${params}` : '';
}
export function vacantWorkflowPosition(nodes: Array<{ position: { x: number; y: number } }>, point: { x: number; y: number }) {
  let candidate = { ...point };
  for (let attempt = 0; attempt < 1200; attempt++) {
    if (!nodes.some(node => Math.abs(node.position.x - candidate.x) < 260 && Math.abs(node.position.y - candidate.y) < 145)) return candidate;
    candidate = { x: point.x + (attempt % 5) * 280, y: point.y + (1 + Math.floor(attempt / 5)) * 160 };
  }
  return candidate;
}

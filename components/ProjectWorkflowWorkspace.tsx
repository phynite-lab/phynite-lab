'use client';
import { WorkspaceLoading } from '@/components/WorkspaceLoading';
import { WorkflowDraftTransfer } from './WorkflowDraftTransfer';
import { WorkflowModulePicker, type WorkflowPickerPlacement } from './WorkflowModulePicker';

import { memo, useCallback, useLayoutEffect, useEffect, useEffectEvent, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type ClipboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ReactFlow, ReactFlowProvider, Background, Controls, Handle, Position, MarkerType, useReactFlow, useNodesInitialized, useUpdateNodeInternals, useNodeConnections, useConnection, type Node, type NodeProps, type NodeChange, type Connection, type EdgeChange, SelectionMode } from '@xyflow/react';
import { PhyniteAiIcon } from '@/app/tool-icons';
import { Activity, Box, Copy, History, ChevronDown, MoreHorizontal, Play, Plus, Redo2, Trash2, Undo2, X } from 'lucide-react';
import type { PhyniteSession } from '@/app/auth-client';
import { accountRequest, type AccountResponse } from '@/lib/account-api';
import { LabComputeDestination } from './ComputeDestination';
import { UiSelect } from './UiSelect';
import { WorkspaceResources } from './WorkspaceResources';
import { activeWorkspaceJobs, workloadForNode } from '@/lib/workspace-resource-metrics';
import { workflowComputeSelection, resolvedWorkflowCompute, freezeWorkflowCompute, workflowExecutionCompute } from '@/lib/workflow-compute';
import type { ComputeSelection } from '@/lib/compute-selection';
import { useLocale } from '@/app/locale-provider';
import { useSiteTheme } from '@/app/use-site-theme';
import { useWorkflowEditor, workflowEditorCamera } from '@/app/use-workflow-editor';
import { isWorkflowLauncherTab, isWorkflowAiTab, aiConversationTab, aiConversationFromTab, workflowAiTab, workflowStudyTab, workflowSplitTabs, workflowPaneViews, workflowPreferredAiTab, vacantWorkflowPosition, type WorkflowEditorAction } from '@/lib/workflow-editor-state';
import { workflowPaneDrag, workflowPaneGeometry } from '@/lib/workflow-pane-layout';
import { workflowFloatingPanelPosition, workflowPanelMotionDuration } from '@/lib/workflow-floating-panel';
import { AiPanelHeader, AiPanelResize } from './AiPanelHeader';
import type { AiContextItem } from '@/lib/ai-workbench';
import { AiWorkspace, type AiWorkspaceStatus } from './AiWorkspace';
import { WorkflowPanelBoundary } from './WorkflowPanelBoundary';
import { useProjectAiHistory } from '@/app/use-project-ai-history';
import { defaultAiModel, defaultAiProvider, type AiConversation } from '@/lib/ai-contract';
import { createWorkflowModule } from '@/lib/workflow-module-factory';
import { ParameterStudyWorkspace } from './ParameterStudyWorkspace';
import { WorkflowTabBar } from './WorkflowTabBar';
import { WorkflowProjectSidebar } from './WorkflowProjectSidebar';
import { WorkflowChatSidebar } from './WorkflowChatSidebar';
import { WorkflowStartTab, WorkflowModuleIcon } from './WorkflowStartTab';
import { useProjectWorkflow } from '@/app/use-project-workflow';
import { useWorkspaceCloudSync } from '@/app/use-workspace-cloud-sync';
import { projectWorkflowApi } from '@/lib/project-workflow-api';
import { phyniteApi, phyniteProjects, phyniteStructures, type PhyniteProject } from '@/lib/phynite-api';
import { getCalculationWorkspaceSnapshot, parseCalculationWorkspaceSnapshot } from '@/lib/workspace-storage';
import { openProjectWorkflow } from '@/lib/project-workflow-opening';
import { compileWorkflowDft, workflowQeDraft, workflowCalculationTypes } from '@/lib/project-workflow-compiler';
import { createMdSimulationWorkflowV2, type MdSimulationComponentInstance } from '@/lib/md-simulation-types';
import { copyWorkflowNodes, pasteWorkflowSelection, parseWorkflowClipboard, removeWorkflowNodes, stableWorkflowJson, workflowConnectionError, workflowModules, workflowOrder, type ProjectWorkflow, type WorkflowNode, type WorkflowClipboardV2, type ProjectRun, type WorkflowPlan } from '@/lib/project-workflow';
import { nextWorkflowModuleName } from '@/lib/workflow-navigation';
import { workflowCanvasConnection, workflowConnectionAnchors, workflowModuleChoices, workflowNewNodeConnection, type WorkflowConnectionAnchor } from '@/lib/project-workflow-interaction';
import { loadResearch } from '@/lib/research-storage';
import { listMdTrajectories } from '@/lib/md-workspace';
import { workflowDeviceTrajectories } from '@/lib/workflow-md-migration';
import { alignCanvasSelection, canvasSelection, snapCanvasPositions, canvasBounds, type CanvasAlignment, type CanvasGuide } from '@/lib/workflow-canvas';
import { structureFormula } from '@/lib/structure-formula';
import { workflowNodeSummary, workflowPathFocus } from '@/lib/workflow-canvas-presentation';
import type { ParsedStructure } from '@/lib/structure-parsers';
import { ResearchSidebarSlot, ResearchWorkspaceHeaderSlot, useResearchNavigation, useResearchShell, useResearchSidebarSearch } from './ResearchShellContext';
import { WorkflowNodeEditor } from './WorkflowNodeEditor';
import { ResearchContextPanel } from './ResearchContextPanel';
import '@xyflow/react/dist/style.css';
import '@/app/project-workflow.css';

type FlowNode = Node<{ label?: string; model?: WorkflowNode; status?: string; emphasis?: 'related' | 'muted'; summary?: ReturnType<typeof workflowNodeSummary>; onMenu?: (node: WorkflowNode, element: HTMLElement) => void }, 'module' | 'group'>;
const id = () => `node_${crypto.randomUUID()}`;
const editableTarget = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"],[role="dialog"],[data-workflow-editor]'));
function ModuleNode({ id, data, selected }: NodeProps<FlowNode>) {
  const { t } = useLocale(), node = data.model!;
  const connections = useNodeConnections({ id }), connecting = useConnection(connection => connection.inProgress);
  const connected = (type: 'source' | 'target', handle: string) => connections.some(connection => connection[type] === id && connection[type === 'source' ? 'sourceHandle' : 'targetHandle'] === handle);
  if (!node) return null;
  const definition = workflowModules[node.kind];
  const deviceOnly = node.resources.some(ref => ref.deviceOnly), summary = data.summary;
  const customName = ![definition.en, definition.id].some(name => name.toLocaleLowerCase() === node.name.trim().toLocaleLowerCase());
  return <article className="workflow-module-node" data-selected={selected} data-connecting={connecting} data-kind={node.kind} data-status={data.status} data-emphasis={data.emphasis}>
    {definition.input && <><Handle type="target" position={Position.Left} id={definition.input} data-port={definition.input} data-connected={connected('target', definition.input)} aria-label={`${definition.input} input · left`} title={t('Input · left', 'Input · kiri')} /><Handle type="target" position={Position.Top} id={`${definition.input}:top`} data-port={definition.input} data-connected={connected('target', `${definition.input}:top`)} aria-label={`${definition.input} input · top`} title={t('Input · top', 'Input · atas')} /></>}
    <header><WorkflowModuleIcon kind={node.kind} size={16}/><strong title={node.name}>{node.name}</strong><button className="nodrag nopan" aria-label={t(`Actions for ${node.name}`, `Aksi untuk ${node.name}`)} onClick={event => { event.stopPropagation(); data.onMenu?.(node, event.currentTarget); }}><MoreHorizontal size={16} /></button></header>
    {customName && <small className="workflow-node-kind">{t(definition.en, definition.id)}</small>}
    {(summary?.composition || summary?.sources.length || (summary?.outputs ?? 0) > 1) ? <div className="workflow-node-summary">
      {summary?.composition && <span>{summary.composition.formula} · {t(`${summary.composition.atoms} ${summary.composition.atoms === 1 ? 'atom' : 'atoms'}`, `${summary.composition.atoms} atom`)}</span>}
      {!!summary?.sources.length && <span title={summary.sources.join(', ')}>{t('From', 'Dari')} {summary.sources.join(', ')}</span>}
      {(summary?.outputs ?? 0) > 1 && <span>{t(`${summary!.outputs} outputs`, `${summary!.outputs} keluaran`)}</span>}
    </div> : null}
    {(data.status || deviceOnly) && <footer>{data.status && <span className="workflow-node-status"><i aria-hidden="true" />{data.status}</span>}{deviceOnly && <span>Device-only</span>}</footer>}
    {node.kind !== 'figure' && <><Handle type="source" position={Position.Right} id={definition.output} data-port={definition.output} data-connected={connected('source', definition.output)} aria-label={`${definition.output} output · right`} title={t('Output · right', 'Output · kanan')} /><Handle type="source" position={Position.Bottom} id={`${definition.output}:bottom`} data-port={definition.output} data-connected={connected('source', `${definition.output}:bottom`)} aria-label={`${definition.output} output · bottom`} title={t('Output · bottom', 'Output · bawah')} /></>}
  </article>;
}
function WorkflowGroupNode({ data }: NodeProps<FlowNode>) { return <strong className="workflow-group-label">{data.label as string}</strong>; }
const nodeTypes = { module: memo(ModuleNode), group: memo(WorkflowGroupNode) };
const CanvasProjectSidebar = memo(WorkflowProjectSidebar), CanvasTabBar = memo(WorkflowTabBar);

export function ProjectWorkflowWorkspace(props: { owner: string; projectId: string; session: PhyniteSession }) {
  const router = useRouter(), { t } = useLocale();
  const cloud = useWorkspaceCloudSync(props.owner);
  const [resolved, setResolved] = useState('');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (resolved) return;
    if (!cloud.ready && (cloud.status !== 'error' || props.projectId.startsWith('legacy-'))) return;
    let live = true;
    // Canonical graphs load independently when the legacy snapshot is unavailable.
    // Never inspect device data until cloud sync has verified its owner.
    const snapshot = cloud.ready ? parseCalculationWorkspaceSnapshot(getCalculationWorkspaceSnapshot()) : null;
    void openProjectWorkflow(props.projectId, snapshot, { ...projectWorkflowApi, project: id => phyniteApi<{ project: PhyniteProject }>(`/v1/projects/${encodeURIComponent(id)}`) }).then(result => {
      if (!live) return;
      if (result.legacyHref) { router.replace(result.legacyHref); return; }
      setResolved(result.projectId);
      if (result.projectId !== props.projectId) {
        router.replace(`/projects/${encodeURIComponent(result.projectId)}${window.location.search}${window.location.hash}`);
        window.dispatchEvent(new Event('phynite:project-inventory-change'));
      }
    }).catch(failure => { if (live) setError(failure instanceof Error ? failure.message : t('Project could not be opened.', 'Project belum dapat dibuka.')); });
    return () => { live = false; };
  }, [cloud.ready, cloud.status, props.projectId, router, t, attempt, resolved]);
  const snapshotFailed = !cloud.ready && cloud.status === 'error' && props.projectId.startsWith('legacy-');
  if (error || snapshotFailed) return <main className="workspace-loading" role="alert"><p>{error || t('Your saved workspace could not be loaded. Keep your browser data and retry.', 'Workspace tersimpan belum dapat dimuat. Pertahankan data browser dan coba lagi.')}</p><button type="button" className="lab-button" onClick={() => { if (snapshotFailed) window.location.reload(); else { setError(''); setAttempt(value => value + 1); } }}>{t('Retry', 'Coba lagi')}</button><a href="/workspace">Home</a>{cloud.ready && props.projectId.startsWith('legacy-') && <a href={`/calculation?legacy=1&project=${encodeURIComponent(props.projectId.slice(7))}`}>{t('Open original editor', 'Buka editor awal')}</a>}</main>;
  if (!resolved) return <WorkspaceLoading layout="panel" label={t('Opening your project…', 'Membuka project Anda…')} />;
  return <ReactFlowProvider><WorkflowCanvas key={`${props.owner}:${resolved}`} {...props} projectId={resolved} /></ReactFlowProvider>;
}

function WorkflowCanvas({ owner, projectId, session }: { owner: string; projectId: string; session: PhyniteSession }) {
  const { t } = useLocale(), { theme } = useSiteTheme();
  const shell = useResearchShell(), flow = useReactFlow<FlowNode>();
  const nodesInitialized=useNodesInitialized();
  const updateNodeInternals = useUpdateNodeInternals();
  const [canvasMounted,setCanvasMounted]=useState(false),[cameraReady,setCameraReady]=useState(false);
  const state = useProjectWorkflow(owner, projectId), graph = state.workflow, client = state.client;
  const [project, setProject] = useState<PhyniteProject | null>(null);
  const { conversations: aiChats, status: aiHistoryStatus, refresh: refreshAiChats, add: addAiChat, remove: removeAiChat } = useProjectAiHistory(projectId, project?.legacyId);
  const [aiCreating, setAiCreating] = useState(false);
  const [aiStatuses, setAiStatuses] = useState<Record<string, AiWorkspaceStatus>>({});
  const creatingAi = useRef(false);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);
  const [transientPositions, setTransientPositions] = useState<Record<string, { x: number; y: number }>>({});
  const transient = useRef<Record<string, { x: number; y: number }>>({});
  const [measurements, setMeasurements] = useState<Record<string, { width: number; height: number }>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const selectedModules = useMemo(() => canvasSelection(graph, selected), [graph, selected]);
  const [selectedEdges, setSelectedEdges] = useState<string[]>([]);
  const [studyReveal, setStudyReveal] = useState<string[]>([]);
  const editor = useWorkflowEditor(owner, projectId, graph, state.status !== 'loading');
  const dispatchEditor = editor.dispatch;
  const { activeTab } = editor.state;
  const [spaceHand, setSpaceHand] = useState(false), [containerWidth, setContainerWidth] = useState(0), [containerHeight, setContainerHeight] = useState(0), [floatingHeight, setFloatingHeight] = useState(200);
  const [contextRequest, setContextRequest] = useState<{ tabId: string; nonce: number; items: AiContextItem[] }>();
  const root = useRef<HTMLElement>(null), canvasRoot = useRef<HTMLDivElement>(null);
  // Panning is momentary; a saved legacy Hand preference must not latch this mode.
  const hand = spaceHand;
  const splitPair = workflowSplitTabs(editor.state);
  const primaryTab = splitPair?.[0], secondaryTab = splitPair?.[1];
  const vertical = editor.state.splitAxis === 'vertical';
  const geometry = workflowPaneGeometry(containerWidth, containerHeight, vertical ? 'vertical' : 'horizontal', editor.state.splitRatio);
  const { minimum: primaryMinimum, extent: containerExtent, available: splitAvailable, primary: editorWidth } = geometry;
  const secondaryMinimum = primaryMinimum;
  const split = !editor.state.tabsHidden && Boolean(splitPair) && splitAvailable;
  const [focusedTab, setFocusedTab] = useState(''), [focusedPaneTab, setFocusedPaneTab] = useState('');
  useEffect(() => { queueMicrotask(() => { setFocusedTab(activeTab); setFocusedPaneTab(activeTab); }); }, [activeTab]);
  const displayState = !split && splitPair?.includes(focusedPaneTab) ? { ...editor.state, activeTab: focusedPaneTab } : editor.state;
  const paneViews = workflowPaneViews(displayState, split);
  const visibleTabs = paneViews.map(view => view.id);
  const hiddenChat = !split && splitPair?.find(id => isWorkflowAiTab(id) && !visibleTabs.includes(id));
  const effectivePanel = !editor.state.tabsHidden ? editor.state.aiPanel ?? (hiddenChat ? { ...editor.state.aiPanelBounds, id: hiddenChat, presentation: 'composer' as const } : undefined) : undefined;
  const floatingVisible = Boolean(effectivePanel && effectivePanel.presentation !== 'minimized');
  const [revealedPanel, setRevealedPanel] = useState('');
  useEffect(() => { queueMicrotask(() => setRevealedPanel('')); }, [activeTab, effectivePanel?.id]);
  const layoutTarget = visibleTabs.includes(focusedTab) || floatingVisible && effectivePanel?.id === focusedTab ? focusedTab : displayState.activeTab;
  const chatSidebar = isWorkflowAiTab(layoutTarget);
  useResearchSidebarSearch({ label: chatSidebar ? t('Search chats', 'Cari chat') : t('Search modules', 'Cari modul'), controls: chatSidebar ? 'workflow-chat-search' : 'workflow-project-search' });
  const focusTab = (id: string) => { setFocusedTab(id); if (visibleTabs.includes(id) && effectivePanel?.id !== id) setFocusedPaneTab(id); };
  const targetPane = (event: { target: EventTarget | null }) => { if (event.target instanceof Element) { const id = event.target.closest<HTMLElement>('[data-pane-tab]')?.dataset.paneTab; if (id) focusTab(id); } };
  const panelWidth = Math.min(effectivePanel?.width ?? 800, Math.max(0, containerWidth - (containerWidth <= 560 ? 12 : 28)));
  const panelHeight = Math.min(effectivePanel?.height ?? 700, Math.max(0, containerHeight - (containerWidth <= 560 ? 12 : 28)));
  useLayoutEffect(() => {
    const panel = root.current?.querySelector('.workflow-ai-editor[data-presentation]');
    if (!panel || (panel as HTMLElement).hidden) return;
    const measure = () => setFloatingHeight((panel as HTMLElement).offsetHeight);
    measure(); const observer = new ResizeObserver(measure); observer.observe(panel);
    return () => observer.disconnect();
  }, [effectivePanel?.id, effectivePanel?.presentation]);
  const panelTransition = useRef<{ id: string; rect: DOMRect | null } | null>(null);
  const panelAnimation = useRef<Animation | null>(null);
  useEffect(() => () => panelAnimation.current?.cancel(), []);
  const [panelMotionRevision, setPanelMotionRevision] = useState(0);
  const panelFocus = useRef<{ id: string; presentation: string } | null>(null);
  const captureAiMotion = useCallback((id: string, animate = true) => {
    const panel = Array.from(root.current?.querySelectorAll<HTMLElement>('.workflow-ai-editor') ?? []).find(element => element.dataset.paneTab === id);
    panelTransition.current = animate ? { id, rect: panel && !panel.hidden ? panel.getBoundingClientRect() : null } : null;
    panel?.getAnimations().forEach(animation => animation.cancel());
    setPanelMotionRevision(revision => revision + 1);
    return panel;
  }, []);
  const changeAiPresentation = useCallback((id: string, presentation: 'tab' | 'floating' | 'composer' | 'minimized', reveal = true) => {
    const panel = captureAiMotion(id, presentation !== 'minimized');
    if (reveal && panel?.contains(document.activeElement)) panelFocus.current = { id, presentation };
    setRevealedPanel(reveal ? id : '');
    dispatchEditor({ type: 'ai-presentation', id, presentation });
  }, [captureAiMotion, dispatchEditor]);
  const dispatchWorkspace = useCallback((action: WorkflowEditorAction) => {
    if (action.type === 'ai-presentation') { changeAiPresentation(action.id, action.presentation); return; }
    if (['open', 'close', 'close-all', 'resolve-launcher', 'maximize', 'toggle-split', 'split', 'swap', 'axis', 'layout', 'tabs-hidden'].includes(action.type)) {
      const panels = Array.from(root.current?.querySelectorAll<HTMLElement>('.workflow-ai-editor:not([hidden])') ?? []);
      const target = 'id' in action ? action.id : undefined;
      const panel = panels.find(element => element.dataset.paneTab === target) ?? panels.find(element => element.contains(document.activeElement)) ?? panels[0];
      if (panel?.dataset.paneTab) captureAiMotion(panel.dataset.paneTab);
      else panelTransition.current = null;
    }
    dispatchEditor(action);
  }, [captureAiMotion, changeAiPresentation, dispatchEditor]);
  useLayoutEffect(() => {
    const focus = panelFocus.current; panelFocus.current = null;
    let focusObserver: MutationObserver | undefined;
    if (focus) {
      const target = Array.from(root.current?.querySelectorAll<HTMLElement>('.workflow-ai-editor') ?? []).find(element => element.dataset.paneTab === focus.id);
      const controlsOwner = root.current?.closest('.research-app-shell') ?? root.current;
      const control = focus.presentation === 'minimized' ? Array.from(controlsOwner?.querySelectorAll<HTMLElement>('[data-ai-visibility-toggle]') ?? []).find(element => element.getClientRects().length > 0) : target?.querySelector<HTMLElement>('textarea');
      if (control instanceof HTMLTextAreaElement && control.disabled) {
        focusObserver = new MutationObserver(() => { if (!control.disabled) { control.focus({ preventScroll: true }); focusObserver?.disconnect(); } });
        focusObserver.observe(control, { attributes: true, attributeFilter: ['disabled'] });
      } else control?.focus({ preventScroll: true });
    }
    return () => focusObserver?.disconnect();
  }, [effectivePanel?.id, effectivePanel?.presentation, panelMotionRevision]);
  useLayoutEffect(() => {
    const previous = panelTransition.current;
    const panel = Array.from(root.current?.querySelectorAll<HTMLElement>('.workflow-ai-editor') ?? []).find(element => element.dataset.paneTab === previous?.id);
    // The intrinsic composer height is measured by the layout effect above.
    // Let its synchronous render settle the bottom clamp before capturing a target.
    if (panel && !panel.hidden && effectivePanel?.id === previous?.id && Math.abs(panel.offsetHeight - floatingHeight) > .5) return;
    panelTransition.current = null;
    if (!previous || !panel || panel.hidden || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    panel.getAnimations().forEach(animation => animation.cancel());
    const next = panel.getBoundingClientRect();
    const before = previous.rect;
    if (!next.width || !next.height || before && Math.max(Math.abs(before.left - next.left), Math.abs(before.top - next.top), Math.abs(before.width - next.width), Math.abs(before.height - next.height)) < .5) return;
    // Final layout is applied once. Only the visual delta is interpolated, so
    // textarea sizing and the scientific viewport do not reflow every frame.
    const duration = workflowPanelMotionDuration(getComputedStyle(panel).getPropertyValue('--workspace-motion-panel'));
    panelAnimation.current = panel.animate(previous.rect ? [
      { transformOrigin: 'top left', transform: `translate(${previous.rect.left - next.left}px, ${previous.rect.top - next.top}px) scale(${previous.rect.width / Math.max(1, next.width)}, ${previous.rect.height / Math.max(1, next.height)})` },
      { transformOrigin: 'top left', transform: 'none' },
    ] : [{ opacity: 0 }, { opacity: 1 }], { duration, easing: getComputedStyle(panel).getPropertyValue('--workspace-motion-ease').trim() || 'cubic-bezier(.22, 1, .36, 1)' });
  }, [effectivePanel?.id, effectivePanel?.presentation, floatingHeight, panelMotionRevision]);
  useEffect(() => {
    const id = effectivePanel?.id, presentation = effectivePanel?.presentation;
    if (!id || !presentation || presentation === 'minimized') return;
    const outside = (event: PointerEvent | FocusEvent) => {
      if (!(event.target instanceof Element) || event instanceof PointerEvent && event.button !== 0) return;
      const panel = Array.from(root.current?.querySelectorAll<HTMLElement>('.workflow-ai-editor') ?? []).find(element => element.dataset.paneTab === id);
      if (panel?.dataset.presentation !== presentation || panel?.contains(event.target) || event.target.closest('[data-ui-owner]')?.getAttribute('data-ui-owner') === id) return;
      setRevealedPanel('');
      if (presentation === 'floating' && !event.target.closest('[data-ai-visibility-toggle], .workflow-global-controls, .workflow-global-menu, .workflow-chat-history, .workflow-chat-sidebar, [data-research-sidebar-interaction]')) changeAiPresentation(id, 'composer', false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !document.querySelector('dialog[open], .workflow-global-menu') && !Array.from(document.querySelectorAll('[data-ui-owner]')).some(element => element.getAttribute('data-ui-owner') === id)) {
        const panel = root.current?.querySelector('.workflow-ai-editor[data-presentation]');
        if (panel?.querySelector('.ai-panel-header')?.contains(document.activeElement)) panel.querySelector<HTMLTextAreaElement>('textarea')?.focus({ preventScroll: true });
        setRevealedPanel('');
        if (presentation === 'floating') changeAiPresentation(id, 'composer', false);
      }
    };
    document.addEventListener('pointerdown', outside); document.addEventListener('focusin', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); document.removeEventListener('keydown', escape); };
  }, [effectivePanel?.id, effectivePanel?.presentation, changeAiPresentation]);
  const canvasVisible = visibleTabs.includes('canvas');
  const pane = (id: string) => split && splitPair?.includes(id) ? id === splitPair[0] ? 'primary' : 'secondary' : undefined;
  useLayoutEffect(() => { root.current?.closest<HTMLElement>('.research-app-shell')?.style.setProperty('--workflow-editor-width', `${editorWidth}px`); }, [editorWidth]);
  const [picker, setPicker] = useState<{ position: { x: number; y: number }; screen: WorkflowPickerPlacement; trigger: HTMLElement | null; container: HTMLElement; anchor?: WorkflowConnectionAnchor } | null>(null);
  const [pickerError, setPickerError] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number; nodeId?: string } | null>(null);
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const [past, setPast] = useState<ProjectWorkflow[]>([]), [future, setFuture] = useState<ProjectWorkflow[]>([]);
  const [runs, setRuns] = useState<ProjectRun[]>([]), [plan, setPlan] = useState<WorkflowPlan | null>(null);
  const [reviewResourceId, setReviewResourceId] = useState('');
  const [pendingCompute, setPendingCompute] = useState<ComputeSelection>({});
  const pendingComputeKey = `phynite:workflow-compute-draft:${owner}:${projectId}`;
  useEffect(() => {
    let live = true;
    queueMicrotask(() => {
      if (!live) return;
      try {
        const raw = sessionStorage.getItem(pendingComputeKey);
        if (raw) setPendingCompute(workflowComputeSelection({ configuration: JSON.parse(raw) } as WorkflowNode));
      } catch { /* Existing scientific drafts remain usable if device storage is unavailable. */ }
    });
    return () => { live = false; };
  }, [pendingComputeKey]);
  const [guides, setGuides] = useState<CanvasGuide[]>([]), [shortcutHelp, setShortcutHelp] = useState(false);
  const dragPointer = useRef<{ x:number; y:number } | null>(null);
  const dragFrame = useRef<number | null>(null), pendingDrag = useRef<{ point: { x: number; y: number }; alt: boolean } | null>(null);
  useEffect(() => () => { if (dragFrame.current !== null) cancelAnimationFrame(dragFrame.current); }, []);
  const shortcutDialog = useRef<HTMLDialogElement>(null), dragIds = useRef<string[]>([]), bypassSnap = useRef(false), pointer = useRef<{ x: number; y: number } | null>(null);
  const pasting = useRef(false), pendingImport = useRef<{ signature: string; request: Parameters<typeof projectWorkflowApi.import>[1] } | null>(null);
  const [showRuns, setShowRuns] = useState(false), [showResearchContext, setShowResearchContext] = useState(false), [rerun, setRerun] = useState<string[]>([]);
  const [runKey, setRunKey] = useState('');
  const canPrepareRun = state.status === 'synced' || state.status === 'saving';
  const canLoadRuns = canPrepareRun;
  const unavailableMessage = t('Workflow sync and runs are not available on this server yet. You can continue editing a local draft.', 'Sinkronisasi dan eksekusi workflow belum tersedia di server ini. Anda tetap bisa mengedit draft lokal.');
  const editorNodes = graph.nodes.filter(node => visibleTabs.includes(node.id));
  const runDialog = useRef<HTMLDialogElement>(null);
  const lastDrag = useRef(0), dragSnapshot = useRef<ProjectWorkflow | null>(null);
  const splitDrag = useRef<{ frame: number; originalRatio: number; pointerId: number; offset: number; axis: 'horizontal' | 'vertical'; pair: [string, string]; element: HTMLDivElement; panes: HTMLElement; shell: HTMLElement | null; cleanup: () => void } | null>(null);
  const clearSplitDrag = useCallback(() => {
    const drag = splitDrag.current; if (!drag) return null;
    splitDrag.current = null; cancelAnimationFrame(drag.frame); drag.cleanup();
    drag.panes.style.removeProperty('--workflow-editor-preview');
    drag.shell?.style.removeProperty('--workflow-editor-preview');
    delete drag.panes.dataset.resizeSnap;
    delete drag.element.dataset.snap;
    if (drag.element.hasPointerCapture(drag.pointerId)) drag.element.releasePointerCapture(drag.pointerId);
    return drag;
  }, []);
  const splitPosition = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = splitDrag.current, rect = root.current?.querySelector('.workflow-panes')?.getBoundingClientRect();
    if (!drag || !rect || drag.pointerId !== event.pointerId) return;
    const position = (drag.axis === 'vertical' ? event.clientY - rect.top : event.clientX - rect.left) - drag.offset;
    return workflowPaneDrag(workflowPaneGeometry(rect.width, rect.height, drag.axis, drag.originalRatio), position);
  };
  useEffect(() => { clearSplitDrag(); }, [split, vertical, primaryTab, secondaryTab, containerWidth, containerHeight, editor.state.splitRatio, clearSplitDrag]);
  useEffect(() => () => { clearSplitDrag(); }, [clearSplitDrag]);

  const clipboardKey = `phynite:workflow-clipboard:v1:${owner}`;
  const latestGraph = useRef(graph);
  useEffect(() => { latestGraph.current = graph; }, [graph]);
  useEffect(() => { queueMicrotask(() => { setPast([]); setFuture([]); }); }, [state.historyEpoch]);
  const change = useCallback((next: ProjectWorkflow, history = true) => {
    const previous=latestGraph.current;
    try { client.change(next); } catch (error) { setMessage((error as Error).message); return false; }
    if (history) { setPast(items => [...items.slice(-99), previous]); setFuture([]); }
    latestGraph.current = next; return true;
  }, [client, setMessage]);
  const updateNode = (node: WorkflowNode) => {
    const previous=latestGraph.current.nodes.find(item=>item.id===node.id);
    if(Array.isArray(node.configuration.missingInputs)) {
      const replaced=new Set(node.resources.filter(ref=>!ref.deviceOnly&&!previous?.resources.some(old=>old.kind===ref.kind&&old.id===ref.id)).map(ref=>ref.kind));
      const potentials=node.configuration.pseudopotentials as Record<string,unknown>|undefined;
      const missing=node.configuration.missingInputs.filter((value:unknown)=>{
        if(!value||typeof value!=='object'||!('kind' in value)||!('id' in value))return true;
        return !replaced.has(String(value.kind) as WorkflowNode['resources'][number]['kind']) && !(value.kind==='pseudopotential'&&potentials?.[String(value.id)]);
      });
      node={...node,configuration:{...node.configuration,missingInputs:missing}};
    }
    return change({ ...latestGraph.current, nodes: latestGraph.current.nodes.map(item => item.id === node.id ? node : item) });
  };
  const deviceMigrated = useRef(false);
  const deviceMigrationReady = state.status !== 'loading';
  useEffect(() => {
    if (!deviceMigrationReady || deviceMigrated.current) return;
    deviceMigrated.current = true; let live = true;
    const key = `phynite:workflow-md-migration:${owner}:${projectId}`;
    void listMdTrajectories(owner).then(records => {
      if (!live) return;
      let seen: string[] = []; try { seen = JSON.parse(localStorage.getItem(key) ?? '[]'); } catch {}
      const nodes = workflowDeviceTrajectories(latestGraph.current, owner, records, new Set(seen));
      if (nodes.length && !change({ ...latestGraph.current, nodes: [...latestGraph.current.nodes, ...nodes] }, false)) return;
      try { localStorage.setItem(key, JSON.stringify([...new Set([...seen, ...records.filter(record => record.owner === owner && (record.cloud?.projectId ?? record.projectId) === projectId).map(record => record.id)])])); } catch {}
    }).catch(() => { /* Original device files stay available in their existing editor. */ });
    return () => { live = false; deviceMigrated.current = false; };
  }, [owner, projectId, deviceMigrationReady, change]);

  const figuresMigrated = useRef(false);
  useEffect(() => {
    if (!deviceMigrationReady || !project || figuresMigrated.current) return;
    figuresMigrated.current = true; let live = true;
    const key = `phynite:workflow-figure-migration:${owner}:${projectId}`;
    void loadResearch(owner, false).then(({ records }) => {
      if (!live) return;
      let seen: string[] = []; try { seen = JSON.parse(localStorage.getItem(key) ?? '[]'); } catch {}
      const figures = records.filter(record => record.collection === 'figures' && [projectId, project.legacyId].includes(record.document.projectId));
      const nodes: WorkflowNode[] = figures.filter(record => !seen.includes(record.document.id) && !latestGraph.current.nodes.some(node => node.configuration.preservedFigureId === record.document.id)).map((record, index) => ({ id: `legacy_figure_${record.document.id}`, kind: 'legacy', name: record.document.name, position: { x: 680, y: (latestGraph.current.nodes.length + index) * 150 + 60 }, resources: [], configuration: { preservedFigureId: record.document.id }, legacy: { editor: 'figures', localId: record.document.projectId } }));
      if (nodes.length && !change({ ...latestGraph.current, nodes: [...latestGraph.current.nodes, ...nodes] }, false)) return;
      try { localStorage.setItem(key, JSON.stringify([...new Set([...seen, ...figures.map(record => record.document.id)])])); } catch {}
    }).catch(() => {});
    return () => { live = false; figuresMigrated.current = false; };
  }, [owner, projectId, project, deviceMigrationReady, change]);

  const changeInput = (target: WorkflowNode, sourceId: string) => {
    const next = { ...graph, nodes: [...graph.nodes], edges: graph.edges.filter(edge => edge.target !== target.id) };
    if (sourceId === 'new-scf') {
      const source: WorkflowNode = { id: id(), kind: 'scf', name: nextWorkflowModuleName(next.nodes, 'SCF'), position: { x: target.position.x - 300, y: target.position.y }, configuration: {}, resources: [] };
      next.nodes.push(source); sourceId = source.id;
    }
    if (sourceId) {
      const edge = { id: id(), source: sourceId, target: target.id, port: workflowModules[target.kind].input! };
      const error = workflowConnectionError(next, edge);
      if (error) { setMessage(error); return; }
      next.edges.push(edge);
    }
    change(next);
  };
  const undo = () => { const previous = past.at(-1); if (previous) { setPast(past.slice(0, -1)); setFuture([graph, ...future]); change(previous, false); } };
  const redo = () => { const next = future[0]; if (next) { setFuture(future.slice(1)); setPast([...past.slice(-99), graph]); change(next, false); } };
  const refreshRuns = useCallback(async () => {
    const result = await projectWorkflowApi.runs(projectId);
    const active = result.runs.filter(run => ['running', 'pending'].includes(run.status));
    const updates = await Promise.all(active.map(run => projectWorkflowApi.status(projectId, run.id)));
    setRuns(result.runs.map(run => updates.find(item => item.run.id === run.id)?.run ?? run));
  }, [projectId]);
  useEffect(() => {
    let live = true;
    void phyniteApi<{ project: PhyniteProject }>(`/v1/projects/${encodeURIComponent(projectId)}`).then(result => { if (live) setProject(result.project); }).catch(failure => { if (live) setMessage(failure.message); });
    return () => { live = false; };
  }, [projectId]);
  useEffect(() => {
    if (!canLoadRuns) return;
    let live = true;
    const refresh = () => { void refreshRuns().catch(failure => { if (live && !client.reportUnavailable(failure)) setMessage(failure.message); }); };
    queueMicrotask(() => { if (live) refresh(); });
    const timer = setInterval(() => { if (document.visibilityState !== 'hidden') refresh(); }, 5000);
    window.addEventListener('phynite:workflow-result-change', refresh);
    return () => { live = false; clearInterval(timer); window.removeEventListener('phynite:workflow-result-change', refresh); };
  }, [canLoadRuns, client, refreshRuns]);
  useEffect(() => {
    void phyniteProjects.update(projectId, { lastOpenedAt: new Date().toISOString() }).catch(() => {});
  }, [projectId]);
  useEffect(() => { if (plan) runDialog.current?.showModal(); }, [plan]);
  useEffect(() => { if (shortcutHelp) shortcutDialog.current?.showModal(); }, [shortcutHelp]);
  useEffect(() => {
    const element = root.current; if (!element) return;
    let frame = 0;
    const observer = new ResizeObserver(entries => {
      const width = element.clientWidth, height = element.querySelector('.workflow-panes')?.clientHeight ?? entries[0].contentRect.height;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // ResizeObserver can report the same box repeatedly while split panes
        // settle. Avoid a no-op React commit: rendering the workspace from
        // inside observer delivery can itself schedule another delivery and
        // surface the browser's "undelivered notifications" warning.
        setContainerWidth(previous => previous === width ? previous : width);
        setContainerHeight(previous => previous === height ? previous : height);
      });
    });
    observer.observe(element); const panes = element.querySelector('.workflow-panes'); if (panes) observer.observe(panes); return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, []);
  useLayoutEffect(() => {
    const element = root.current; if (!element) return;
    const fitViewport = () => { const viewport = window.visualViewport; const bottom = viewport ? viewport.offsetTop + viewport.height : innerHeight; element.style.setProperty('--workflow-keyboard-inset', `${Math.max(0, element.getBoundingClientRect().bottom - bottom)}px`); };
    fitViewport(); window.addEventListener('resize', fitViewport); window.visualViewport?.addEventListener('resize', fitViewport); window.visualViewport?.addEventListener('scroll', fitViewport);
    return () => { window.removeEventListener('resize', fitViewport); window.visualViewport?.removeEventListener('resize', fitViewport); window.visualViewport?.removeEventListener('scroll', fitViewport); };
  }, []);
  const restoredCamera = useRef(false);
  useEffect(()=>{
    if(canvasMounted||!editor.hydrated||state.status==='loading'||!canvasVisible)return;
    let live=true;queueMicrotask(()=>{if(live)setCanvasMounted(true);});return()=>{live=false;};
  },[canvasMounted,editor.hydrated,state.status,activeTab,split,canvasVisible]);
  useEffect(() => {
    if (!canvasMounted || !flow.viewportInitialized || !canvasVisible || cameraReady) return;
    // A missed initial ResizeObserver notification must not leave camera restore
    // waiting forever. Measure the mounted nodes explicitly before fitting them.
    updateNodeInternals([...graph.groups, ...graph.nodes].map(node => node.id));
  }, [canvasMounted, flow.viewportInitialized, canvasVisible, cameraReady, graph.groups, graph.nodes, updateNodeInternals]);
  useEffect(() => {
    if (!canvasMounted || !flow.viewportInitialized || graph.nodes.length>0&&!nodesInitialized || !editor.hydrated || restoredCamera.current || state.status === 'loading' || !canvasVisible) return;
    let live=true;
    const frame=requestAnimationFrame(() => {
      const restore=editor.state.viewport ? flow.setViewport(editor.state.viewport) : graph.nodes.length ? flow.fitView({padding:.2,maxZoom:1,duration:0}) : Promise.resolve(true);
      void restore.then(()=>{if(live){restoredCamera.current=true;dispatchEditor({type:'viewport',viewport:flow.getViewport()});setCameraReady(true);}});
    });
    return ()=>{live=false;cancelAnimationFrame(frame);};
  }, [canvasMounted,nodesInitialized,activeTab,split,canvasVisible,editor.hydrated, editor.state.viewport, graph.nodes.length, flow, state.status,dispatchEditor]);
  useEffect(() => {
    const release = () => { setSpaceHand(false); bypassSnap.current = false; }, keyup = (event:KeyboardEvent) => { if(event.code === 'Space') setSpaceHand(false); if(event.key === 'Alt') bypassSnap.current = false; }; window.addEventListener('blur', release); window.addEventListener('keyup', keyup);
    return () => { window.removeEventListener('blur', release); window.removeEventListener('keyup', keyup); };
  }, []);
  useEffect(() => {
    if (!menu) return;
    const previous = document.activeElement as HTMLElement | null;
    document.querySelector<HTMLElement>('.workflow-context-menu button:not(:disabled)')?.focus();
    const close = (event: PointerEvent) => { if (!(event.target instanceof Element && event.target.closest('.workflow-context-menu'))) setMenu(null); };
    document.addEventListener('pointerdown', close); return () => { document.removeEventListener('pointerdown', close); previous?.focus(); };
  }, [menu]);
  const flushBeforeNavigation = useCallback(async () => { await client.flush(); return false; }, [client]);
  useResearchNavigation('projects', flushBeforeNavigation);

  const openEditor = useCallback((nodeId: string) => {
    setFocusedTab(nodeId); setFocusedPaneTab(nodeId);
    const pair = workflowSplitTabs(editor.state);
    const navigationTab = pair?.includes(focusedPaneTab) ? focusedPaneTab : editor.state.activeTab;
    const launcher = !editor.state.tabsHidden && isWorkflowLauncherTab(navigationTab);
    // Chat/module pairs keep their roles; module/module navigation follows local focus.
    const pane = pair && !pair.some(isWorkflowAiTab) && !pair.includes(nodeId) ? pair.indexOf(navigationTab) === 1 ? 1 : 0 : undefined;
    dispatchWorkspace(launcher ? { type: 'resolve-launcher', tabId: navigationTab, nodeId } : { type: 'open', id: nodeId, pane });
    setMenu(null);
  }, [dispatchWorkspace, editor.state, focusedPaneTab]);
  useEffect(() => { const timer = setTimeout(() => { if (project) void refreshAiChats().catch(() => undefined); }, 0); return () => clearTimeout(timer); }, [project, activeTab, refreshAiChats]);
  const [historyAction, setHistoryAction] = useState<{ ids: string[]; all: boolean } | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false), [historyError, setHistoryError] = useState('');
  const historyDeleting = useRef(false);
  const historyDialog = useRef<HTMLDialogElement>(null);
  const historyOpen = Boolean(historyAction);
  useEffect(() => { if (historyOpen) historyDialog.current?.showModal(); }, [historyOpen]);
  const closeHistory = () => {
    setHistoryAction(null);
    requestAnimationFrame(() => {
      const shell = root.current?.closest('.research-app-shell');
      const navigation = shell?.querySelector<HTMLElement>('#research-navigation[aria-modal=true]');
      const available = (element: Element | null): element is HTMLElement => element instanceof HTMLElement && element !== document.body && Boolean(element.getClientRects().length) && getComputedStyle(element).visibility !== 'hidden' && !element.closest('[inert]') && (!navigation || navigation.contains(element));
      const active = document.activeElement;
      if (available(active)) return;
      // Selector lists return DOM order. Preserve this priority explicitly so an
      // open mobile drawer keeps focus inside its navigation, ahead of its opener.
      const candidates = ['[data-sidebar-search]', '.workflow-topbar [aria-selected=true]', '[aria-controls=research-navigation]']
        .flatMap(selector => Array.from(shell?.querySelectorAll<HTMLElement>(selector) ?? []));
      candidates.push(...Array.from(navigation?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]') ?? []));
      candidates.find(available)?.focus({ preventScroll: true });
    });
  };
  const manageHistory = (tabId: string, all: boolean) => {
    const ids = all ? aiChats.map(chat => chat.id) : aiChats.filter(chat => aiConversationTab(chat.id) === tabId).map(chat => chat.id);
    if (ids.length) { setHistoryError(''); setHistoryAction({ ids, all }); }
  };
  const deleteHistory = async () => {
    if (!historyAction || historyDeleting.current) return;
    historyDeleting.current = true;
    setHistoryBusy(true); setHistoryError('');
    try {
      for (const id of historyAction.ids) {
        const base = `/api/ai/conversations/${id}`;
        // Stop first; DELETE also fences active runs and actions server-side.
        for (const [url, method] of [[`${base}/stop`, 'POST'], [base, 'DELETE']]) {
          const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, ...(method === 'POST' ? { body: '{}' } : {}) });
          if (!response.ok) {
            const failure = await response.json().catch(() => ({})) as { error?: string; code?: string };
            if (response.status === 404 && failure.code === 'AI_NOT_FOUND') continue;
            throw new Error(failure.error || t('Could not delete chat history. Try again.', 'Riwayat chat belum bisa dihapus. Coba lagi.'));
          }
        }
        dispatchEditor({ type: 'close', id: aiConversationTab(id) });
        removeAiChat(id);
        setHistoryAction(action => action && ({ ...action, ids: action.ids.filter(item => item !== id) }));
        try {
          localStorage.removeItem(`phynite:ai-draft:${owner}:${projectId}:${id}`);
          if (localStorage.getItem(`phynite:ai-current:${owner}:${projectId}`) === id) localStorage.removeItem(`phynite:ai-current:${owner}:${projectId}`);
        } catch { /* Server history is deleted even when local storage is unavailable. */ }
      }
      // Keep the dialog mounted until its native close event restores focus.
      historyDialog.current?.close();
    } catch (failure) { setHistoryError((failure as Error).message); }
    finally { historyDeleting.current = false; setHistoryBusy(false); void refreshAiChats().catch(() => undefined); }
  };
  const newAiChat = useCallback(async (floating = false) => {
    if (!project || creatingAi.current) return;
    creatingAi.current = true; setAiCreating(true);
    try {
      // The hosted default is not a valid selection in a local workspace. Read
      // the native catalogue before creating the conversation so opening AI
      // never sends the local backend a fabricated Phynite model selection.
      let selection: { modelId: string; providerId: string; effort: string } = { modelId: defaultAiModel, providerId: defaultAiProvider, effort: 'auto' };
      if (session.mode === 'local') {
        const catalogResponse = await fetch('/api/ai/models', { cache: 'no-store' });
        const catalog = await catalogResponse.json() as { providers?: Array<{ id: string; models?: Array<{ id: string; capabilities?: { available?: boolean; efforts?: string[] } }> }>; error?: string };
        if (!catalogResponse.ok) throw new Error(catalog.error || t('Local AI is unavailable. Open Local settings and sign in first.', 'AI lokal belum tersedia. Buka pengaturan lokal dan login terlebih dahulu.'));
        const provider = catalog.providers?.find(item => item.id === 'local');
        const model = provider?.models?.find(item => item.capabilities?.available);
        if (!model?.id) throw new Error(t('Sign in to a local AI provider before opening a chat.', 'Login ke provider AI lokal sebelum membuka chat.'));
        const efforts = model.capabilities?.efforts ?? ['auto'];
        selection = { modelId: model.id, providerId: 'local', effort: efforts.includes('auto') ? 'auto' : efforts[0] ?? 'auto' };
      }
      const response = await fetch('/api/ai/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectKey: `project:${projectId}`, ...selection, mode: 'approval' }) });
      const data = await response.json() as { conversation?: AiConversation; error?: string };
      if (!response.ok || !data.conversation) throw new Error(data.error || 'Could not create the research conversation.');
      addAiChat(data.conversation);
      const tabId = aiConversationTab(data.conversation.id);
      if (floating) { setFocusedTab(tabId); changeAiPresentation(tabId, 'floating'); } else openEditor(tabId);
      try { localStorage.setItem(`phynite:ai-current:${owner}:${projectId}`, data.conversation.id); } catch { /* The server conversation remains open if device storage is unavailable. */ }
      return aiConversationTab(data.conversation.id);
    } catch (failure) { setMessage((failure as Error).message); }
    finally { creatingAi.current = false; setAiCreating(false); }
  }, [project, projectId, owner, session, t, openEditor, changeAiPresentation, setMessage, addAiChat]);
  const openProjectAi = useCallback(async () => {
    if (!project) return;
    const existing = workflowPreferredAiTab(editor.state);
    if (existing) { openEditor(existing); return existing; }
    try { const chats = await refreshAiChats(); if (chats[0]) { openEditor(aiConversationTab(chats[0].id)); return aiConversationTab(chats[0].id); } }
    catch { setMessage(t('Chat history could not be loaded. Retry before opening a conversation.', 'Riwayat chat belum dapat dimuat. Coba lagi sebelum membuka percakapan.')); return; }
    return newAiChat();
  }, [project, editor.state, openEditor, refreshAiChats, newAiChat, setMessage, t]);
  const toggleAiVisibility = () => {
    const id = effectivePanel?.id ?? workflowPreferredAiTab(editor.state);
    if (!id) { void openProjectAi(); return; }
    if (floatingVisible) changeAiPresentation(id, 'minimized');
    else {
      panelFocus.current = { id, presentation: 'composer' };
      changeAiPresentation(id, 'composer');
    }
  };
  const aiVisibilityLabel = floatingVisible ? t('Hide Phynite AI', 'Sembunyikan Phynite AI') : effectivePanel ? t('Show Phynite AI', 'Tampilkan Phynite AI') : t('Open Phynite AI', 'Buka Phynite AI');
  const aiVisibilityControl = <button type="button" data-ai-visibility-toggle aria-label={aiVisibilityLabel} title={aiVisibilityLabel} aria-pressed={floatingVisible} aria-expanded={floatingVisible} aria-controls={effectivePanel ? `workflow-ai-panel-${effectivePanel.id}` : undefined} disabled={!editor.hydrated || !project} onClick={toggleAiVisibility}><PhyniteAiIcon size={16} />{effectivePanel && <span className="ai-panel-dot" data-status={aiStatuses[effectivePanel.id] ?? 'idle'} />}</button>;
  const addAiContext = async (ids: string[]) => {
    setMenu(null);
    try {
      await client.flush(); const saved = client.getSnapshot();
      if (saved.status !== 'synced') throw new Error(t('Save or resolve the Canvas conflict before sharing context.', 'Simpan atau selesaikan konflik Kanvas sebelum membagikan konteks.'));
      const items: AiContextItem[] = ids.slice(0, 16).flatMap<AiContextItem>(id => { const node = latestGraph.current.nodes.find(item => item.id === id); const edge = latestGraph.current.edges.find(item => item.id === id); return node ? [{ ref: { kind: 'node' as const, id, revision: saved.revision }, label: node.name, detail: node.kind }] : edge ? [{ ref: { kind: 'edge' as const, id, revision: saved.revision }, label: `${edge.source} → ${edge.target}`, detail: edge.port }] : []; });
      const tabId = await openProjectAi(); if (!tabId) return;
      setContextRequest({ tabId, nonce: Date.now(), items }); changeAiPresentation(tabId, 'floating');
    } catch (failure) { setMessage((failure as Error).message); }
  };
  const openSidebarView = useCallback((id: string) => { if (id === workflowAiTab) void openProjectAi(); else openEditor(id); }, [openEditor, openProjectAi]);
  const openRuns = useCallback(() => setShowRuns(true), [setShowRuns]);
  const focusedNewPane = splitPair?.indexOf(focusedPaneTab);
  const newTab = (pane?: 0 | 1) => { const focused = focusedNewPane; dispatchWorkspace({type:'open',id:`new:${crypto.randomUUID()}`,pane: pane ?? (focused === 0 || focused === 1 ? focused : undefined)}); shell?.closeMobileNavigation(); };
  const visiblePoint = useCallback(() => {
    const viewport=workflowEditorCamera(editor.state);
    return {x:((canvasRoot.current?.clientWidth || containerWidth)/2-viewport.x)/viewport.zoom,y:((canvasRoot.current?.clientHeight || root.current?.clientHeight || 600)/2-viewport.y)/viewport.zoom};
  }, [editor.state, containerWidth]);
  const openPicker = useCallback((position: { x: number; y: number }, screen: WorkflowPickerPlacement, trigger: HTMLElement | null, anchor?: WorkflowConnectionAnchor) => {
    const container = root.current?.closest<HTMLElement>('.research-app-shell') ?? root.current;
    if (!container) return;
    setMenu(null); setPickerError(''); setPicker({ position, screen, trigger, container, anchor }); shell?.closeMobileNavigation();
  }, [shell, setMenu, setPickerError, setPicker]);
  const openPalette = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    const element = event.currentTarget, rect = element.getBoundingClientRect();
    openPicker(visiblePoint(), { x: rect.left, y: rect.bottom + 6, above: rect.top - 6, element }, element);
  }, [openPicker, visiblePoint]);
  const closePicker = (restoreFocus = false) => {
    const trigger = picker?.trigger;
    setPicker(null);
    if (restoreFocus) requestAnimationFrame(() => {
      const visible = (element: HTMLElement | null | undefined) => element && element.getClientRects().length > 0 && getComputedStyle(element).visibility === 'visible' && !element.closest('[inert],[hidden]');
      const target = visible(trigger) ? trigger : trigger?.closest('details')?.querySelector<HTMLElement>('summary');
      (visible(target) ? target : activeTab === 'canvas' ? canvasRoot.current : document.querySelector<HTMLElement>('.workflow-tabs [aria-selected=true]'))?.focus({ preventScroll: true });
    });
  };
  const statuses = useMemo(() => {
    const result: Record<string, string> = {};
    [...runs].reverse().forEach(run => run.attempts.forEach(attempt => { result[attempt.nodeId] = attempt.outdated ? 'Outdated' : attempt.status; }));
    return result;
  }, [runs]);
  const contextMenu = (event: MouseEvent | globalThis.MouseEvent, nodeId?: string) => { event.preventDefault(); setMenu({ x: Math.min(event.clientX, window.innerWidth - 230), y: Math.min(event.clientY, window.innerHeight - 350), nodeId }); };
  const pathFocus = useMemo(() => workflowPathFocus(graph, hoveredNode ? [hoveredNode] : hoveredEdge ? [] : canvasSelection(graph, selected), hoveredEdge ? [hoveredEdge] : selectedEdges), [graph, hoveredNode, hoveredEdge, selected, selectedEdges]);
  const openNodeMenu = useCallback((target: WorkflowNode, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    setMenu({ x: Math.min(rect.left, window.innerWidth - 230), y: Math.min(rect.bottom, window.innerHeight - 350), nodeId: target.id });
  }, []);
  const summaries = useMemo(() => new Map(graph.nodes.map(node => [node.id, workflowNodeSummary(graph, node)])), [graph]);
  // Dragging only changes geometry. Keep node data and untouched node objects
  // stable so their cards, summaries and connection handles can skip rendering.
  const baseFlowNodes = useMemo<FlowNode[]>(() => graph.nodes.map(node => ({ id: node.id, type: 'module', position: node.position, style: { width: 230 }, measured: measurements[node.id], selected: selected.includes(node.id), data: { model: node, status: statuses[node.id], summary: summaries.get(node.id), emphasis: pathFocus.active ? pathFocus.nodes.has(node.id) ? 'related' : 'muted' : undefined, onMenu: openNodeMenu }, ariaLabel: `${node.name}, ${workflowModules[node.kind].en}` })), [graph, selected, statuses, measurements, pathFocus, openNodeMenu, summaries]);
  const flowNodes = useMemo(() => baseFlowNodes.map(node => transientPositions[node.id] ? { ...node, position: transientPositions[node.id] } : node), [baseFlowNodes, transientPositions]);
  const nodesById = useMemo(() => new Map(graph.nodes.map(node => [node.id, node])), [graph.nodes]);
  const flowEdges = useMemo(() => graph.edges.map(edge => {
    const source = nodesById.get(edge.source)!, target = nodesById.get(edge.target)!;
    const anchors = editor.state.edgeAnchors?.[edge.id], selected = selectedEdges.includes(edge.id), output = workflowModules[source.kind].output;
    const emphasis = pathFocus.active ? pathFocus.edges.has(edge.id) ? 'related' : 'muted' : 'idle';
    const color = emphasis === 'related' || selected ? 'var(--workflow-focus)' : emphasis === 'muted' ? 'var(--workflow-wire-muted)' : 'var(--workflow-wire)';
    return { ...edge, selected, className: `workflow-edge workflow-edge--${emphasis}${statuses[edge.target] === 'running' ? ' workflow-edge--running' : ''}`, style: { '--workflow-edge-color': color } as CSSProperties, sourceHandle: anchors?.source === 'bottom' ? `${output}:bottom` : output, targetHandle: anchors?.target === 'top' ? `${edge.port}:top` : edge.port,
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, markerUnits: 'userSpaceOnUse', color }, ariaLabel: `${source.name} → ${target.name}` };
  }), [graph.edges, nodesById, editor.state.edgeAnchors, selectedEdges, pathFocus, statuses]);
  const groupNodes = useMemo<FlowNode[]>(() => graph.groups.map(group => {
    const nodes = group.nodeIds.map(id => nodesById.get(id)!).map(node => ({ ...node, position: transientPositions[node.id] ?? node.position }));
    const left = Math.min(...nodes.map(node => node.position.x)) - 20, top = Math.min(...nodes.map(node => node.position.y)) - 40;
    return { id: group.id, type: 'group', position: { x: left, y: top }, data: { label: group.name }, style: { width: Math.max(...nodes.map(node => node.position.x)) - left + 250, height: Math.max(...nodes.map(node => node.position.y)) - top + 140, zIndex: -1 }, selectable: true, draggable: true, ariaLabel: group.name };
  }), [graph.groups, nodesById, transientPositions]);
  const onNodesChange = (changes: NodeChange<FlowNode>[]) => {
    const dimensions = changes.flatMap(change => change.type === 'dimensions' && change.dimensions ? [[change.id, change.dimensions] as const] : []);
    if (dimensions.length) setMeasurements(current => dimensions.every(([id, size]) => current[id]?.width === size.width && current[id]?.height === size.height) ? current : { ...current, ...Object.fromEntries(dimensions) });
    const selections = changes.filter(item => item.type === 'select');
    if (selections.length) setSelected(current => { const next = new Set(current); selections.forEach(item => { if (item.type === 'select') { if (item.selected) next.add(item.id); else next.delete(item.id); } }); return [...next]; });
    // During a drag, use pointer deltas from its immutable start. Feeding snapped
    // positions back into React Flow's next delta would accumulate rounding drift.
    if (!dragSnapshot.current) {
      const positions = new Map(changes.flatMap(item => item.type === 'position' && item.position ? [[item.id, item.position] as const] : []));
      for (const group of graph.groups) { const moved = positions.get(group.id), before = groupNodes.find(node => node.id === group.id); if (moved && before) for (const memberId of group.nodeIds) { const member = nodesById.get(memberId)!; positions.set(member.id, { x: member.position.x + moved.x - before.position.x, y: member.position.y + moved.y - before.position.y }); } }
      if (positions.size) change({ ...latestGraph.current, nodes: latestGraph.current.nodes.map(node => positions.get(node.id) ? { ...node, position: positions.get(node.id)! } : node) });
    }
    const removed = changes.filter(item => item.type === 'remove').map(item => item.id);
    if (removed.length) { const next = removeWorkflowNodes(latestGraph.current, removed); change({ ...next, nodes: next.nodes.map(node => removed.includes(node.groupId ?? '') ? { ...node, groupId: undefined } : node), groups: next.groups.filter(group => !removed.includes(group.id)) }); }
  };
  const flushDrag = () => {
    dragFrame.current = null;
    const pending = pendingDrag.current;
    pendingDrag.current = null;
    if (!pending || !dragSnapshot.current || !dragPointer.current) return;
    const point = flow.screenToFlowPosition(pending.point);
    const original = dragSnapshot.current, ids = dragIds.current;
    const proposed = Object.fromEntries(original.nodes.filter(node => ids.includes(node.id)).map(node => [node.id, { x: node.position.x + point.x - dragPointer.current!.x, y: node.position.y + point.y - dragPointer.current!.y }]));
    const snapped = snapCanvasPositions(original, ids, proposed, measurements, flow.getZoom(), { grid: editor.state.snapToGrid !== false, guides: editor.state.showGuides !== false }, pending.alt);
    transient.current = snapped.positions; setTransientPositions(snapped.positions); setGuides(snapped.guides);
  };
  const beginNodeDrag = (event: MouseEvent | globalThis.MouseEvent | TouchEvent, nodes: FlowNode[]) => {
    if (dragSnapshot.current) return;
    const point = 'touches' in event ? event.touches[0] ?? event.changedTouches[0] : event;
    if (!point) return;
    if (dragFrame.current !== null) cancelAnimationFrame(dragFrame.current);
    pendingDrag.current = null; transient.current = {};
    client.beginInteraction();
    dragSnapshot.current = latestGraph.current;
    dragIds.current = canvasSelection(latestGraph.current, nodes.map(node => node.id));
    dragPointer.current ??= flow.screenToFlowPosition({ x: point.clientX, y: point.clientY });
    bypassSnap.current = event.altKey;
  };
  const dragNodes = (event: MouseEvent | globalThis.MouseEvent | TouchEvent) => {
    if (!dragSnapshot.current || !dragPointer.current) return;
    const pointer = 'touches' in event ? event.touches[0] ?? event.changedTouches[0] : event;
    if (!pointer) return;
    pendingDrag.current = { point: { x: pointer.clientX, y: pointer.clientY }, alt: event.altKey || bypassSnap.current };
    if (dragFrame.current === null) dragFrame.current = requestAnimationFrame(flushDrag);
  };
  const finishNodeDrag = (event: MouseEvent | globalThis.MouseEvent | TouchEvent) => {
    lastDrag.current = Date.now();
    if (!dragSnapshot.current) return;
    dragNodes(event);
    if (dragFrame.current !== null) cancelAnimationFrame(dragFrame.current);
    // The final pointer position must be saved even when pointerup arrives before
    // the scheduled frame. One complete drag remains one undoable operation.
    flushDrag();
    const snapshot = dragSnapshot.current;
    const next = { ...latestGraph.current, nodes: latestGraph.current.nodes.map(node => transient.current[node.id] ? { ...node, position: transient.current[node.id] } : node) };
    if (change(next, false) && snapshot.nodes.some(node => transient.current[node.id] && (node.position.x !== transient.current[node.id].x || node.position.y !== transient.current[node.id].y))) {
      setPast(items => [...items.slice(-99), snapshot]); setFuture([]);
    }
    transient.current = {}; setTransientPositions({}); setGuides([]);
    dragIds.current = []; dragPointer.current = null; dragSnapshot.current = null;
    client.endInteraction();
  };
  const onEdgesChange = (changes: EdgeChange[]) => {
    const selections=changes.filter(item=>item.type==='select');
    if(selections.length)setSelectedEdges(current=>{const next=new Set(current);selections.forEach(item=>{if(item.selected)next.add(item.id);else next.delete(item.id);});return [...next];});
    const removed = new Set(changes.filter(item => item.type === 'remove').map(item => item.id));
    if (removed.size) change({ ...graph, edges: graph.edges.filter(edge => !removed.has(edge.id)) });
  };
  const connect = (connection: Connection) => {
    const current = latestGraph.current, edge = workflowCanvasConnection(current, connection);
    const edgeId = id();
    if (edge && change({ ...current, edges: [...current.edges, { ...edge, id: edgeId }] })) {
      editor.dispatch({ type: 'edge-anchors', id: edgeId, anchors: workflowConnectionAnchors(connection) });
      setMessage('');
    }
  };
  const addNode = (kind: WorkflowNode['kind']) => {
    const current = latestGraph.current;
    const node = createWorkflowModule(current, kind, { id: id(), name: nextWorkflowModuleName(current.nodes, t(workflowModules[kind].en, workflowModules[kind].id)), position: picker?.position ?? visiblePoint() });
    if (workflowCalculationTypes[kind]) node.configuration = { ...node.configuration, ...pendingCompute };
    let next = { ...current, nodes: [...current.nodes, node] };
    let addedEdgeId: string | undefined;
    if (picker?.anchor) {
      const edge = workflowNewNodeConnection(current, node, picker.anchor);
      if (!edge) { setPickerError(t('This connection changed. Close the picker and connect the module again.', 'Koneksi ini telah berubah. Tutup pemilih dan sambungkan modul kembali.')); return; }
      addedEdgeId = id();
      next = { ...next, edges: [...next.edges, { ...edge, id: addedEdgeId }] };
    }
    if (!change(next)) return;
    if (addedEdgeId) editor.dispatch({ type: 'edge-anchors', id: addedEdgeId, anchors: picker?.anchor?.side === 'bottom' || picker?.anchor?.side === 'top' ? { source: 'bottom', target: 'top' } : { source: 'right', target: 'left' } });
    setMessage(''); setPicker(null); setSelected([node.id]); setSelectedEdges([]); dispatchWorkspace({ type: 'open', id: 'canvas' });
    requestAnimationFrame(() => canvasRoot.current?.focus({ preventScroll: true }));
  };
  const snapshotClipboard = (nodeIds: string[]) => {
    const saved = client.getSnapshot();
    return parseWorkflowClipboard({ ...copyWorkflowNodes(saved.workflow, nodeIds, saved.revision, editor.state.edgeAnchors), synchronized: saved.status === 'synced' });
  };
  const storeClipboard = (clipboard: WorkflowClipboardV2) => {
    try { localStorage.setItem(clipboardKey, JSON.stringify(clipboard)); return true; } catch { return false; }
  };
  const finishCopy = (nodeIds: string[], cut: boolean, fallback: boolean) => {
    if (cut && change(removeWorkflowNodes(latestGraph.current, nodeIds))) { setSelected([]); setSelectedEdges([]); }
    setMenu(null);
    setMessage(fallback ? t('System clipboard unavailable. The selection is saved in Phynite’s clipboard for this account.', 'Clipboard sistem tidak tersedia. Pilihan tersimpan di clipboard Phynite untuk akun ini.') : cut ? t('Selection cut. Undo restores it.', 'Pilihan dipotong. Undo mengembalikannya.') : t('Modules copied. Inputs outside the selection must be reconnected.', 'Modul disalin. Input di luar pilihan perlu dihubungkan kembali.'));
  };
  const copy = async (nodeIds: string[], cut = false) => {
    if (!nodeIds.length) return;
    try {
      const clipboard = snapshotClipboard(nodeIds), stored = storeClipboard(clipboard);
      let native = false;
      try { await navigator.clipboard.writeText(JSON.stringify({ phyniteWorkflow: clipboard })); native = true; } catch {}
      if (!native && !stored) throw new Error(t('Clipboard could not be saved. The selection was kept.', 'Clipboard gagal disimpan. Pilihan tetap dipertahankan.'));
      finishCopy(nodeIds, cut, !native);
    } catch (error) { setMessage((error as Error).message); }
  };
  const nativeCopy = (event: ClipboardEvent<HTMLDivElement>, cut = false) => {
    if (editableTarget(event.target) || !selectedModules.length) return;
    event.preventDefault();
    try {
      const clipboard = snapshotClipboard(selectedModules);
      event.clipboardData.setData('text/plain', JSON.stringify({ phyniteWorkflow: clipboard }));
      storeClipboard(clipboard); finishCopy(selectedModules, cut, false);
    } catch (error) { setMessage((error as Error).message); }
  };
  const paste = async (text?: string) => {
    if (pasting.current) return;
    pasting.current = true;
    try {
      let fallback = false;
      if (text === undefined) try { text = await navigator.clipboard.readText(); } catch { text = localStorage.getItem(clipboardKey) ?? ''; fallback = true; }
      const clipboard = parseWorkflowClipboard(JSON.parse(text || 'null'));
      const before = latestGraph.current;
      const preferred = pointer.current ?? visiblePoint();
      const bounds = canvasBounds({ ...before, nodes: clipboard.nodes }, clipboard.nodes.map(node => node.id), measurements)!;
      const point = vacantWorkflowPosition(before.nodes, { x: preferred.x - bounds.width / 2, y: preferred.y - bounds.height / 2 });
      if (clipboard.projectId === projectId) {
        const pasted = pasteWorkflowSelection(before, clipboard, id, point);
        if (!change(pasted.workflow)) return;
        setSelected(Object.values(pasted.nodeIds)); setSelectedEdges([]);
        for (const [id, anchors] of Object.entries(pasted.edgeAnchors)) editor.dispatch({ type: 'edge-anchors', id, anchors });
      } else {
        await client.flush();
        const current = client.getSnapshot();
        if (current.status !== 'synced' || !navigator.onLine) throw new Error(t('Cross-project paste requires a synchronized destination and a connection. The clipboard is kept.', 'Paste antarproject memerlukan tujuan tersinkron dan koneksi. Clipboard tetap tersimpan.'));
        const signature = stableWorkflowJson({ clipboard, projectId });
        const request = pendingImport.current?.signature === signature ? pendingImport.current.request : { sourceProjectId: clipboard.projectId, sourceRevision: clipboard.revision, nodeIds: clipboard.nodes.map(node => node.id), clipboard, point, baseRevision: current.revision, idempotencyKey: crypto.randomUUID() };
        pendingImport.current = { signature, request };
        const saved = await projectWorkflowApi.import(projectId, request);
        pendingImport.current = null;
        if (!client.applyImported(saved, request.baseRevision)) return;
        latestGraph.current = saved.workflow; setPast(items => [...items.slice(-99), before]); setFuture([]);
        const nodes = saved.imported?.nodes ?? Object.fromEntries(saved.workflow.nodes.filter(node => !before.nodes.some(old => old.id === node.id)).map(node => [node.id, node.id]));
        setSelected(Object.values(nodes)); setSelectedEdges([]);
        for (const [edgeId, anchor] of Object.entries(clipboard.edgeAnchors)) if (saved.imported?.edges[edgeId]) editor.dispatch({ type: 'edge-anchors', id: saved.imported.edges[edgeId], anchors: anchor });
      }
      setMenu(null); setMessage(fallback ? t('Pasted from Phynite’s clipboard; system clipboard access was unavailable.', 'Ditempel dari clipboard Phynite; akses clipboard sistem tidak tersedia.') : '');
    } catch (failure) { if ((failure as { status?: number }).status === 409) pendingImport.current = null; setMessage((failure as Error).message); }
    finally { pasting.current = false; }
  };
  const saveStructure = async (node: WorkflowNode) => {
    if (client.getSnapshot().status === 'unavailable') throw new Error(unavailableMessage);
    const raw = node.configuration.structure as ParsedStructure | undefined;
    if (!raw?.atoms.length) throw new Error(t('Add atoms or import a structure first.', 'Tambahkan atom atau impor struktur terlebih dahulu.'));
    const signature = stableWorkflowJson(raw);
    if (node.configuration.savedStructureSignature === signature && node.resources.some(ref => ref.kind === 'structure' && !ref.deviceOnly)) return node;
    const formula = structureFormula(raw.atoms);
    if (!formula) throw new Error(t('Complete element mappings and occupancies before saving.', 'Lengkapi pemetaan elemen dan okupansi sebelum menyimpan.'));
    const { structure } = await phyniteStructures.create(projectId, { name: node.name, formula, source: 'workflow-crystal-builder', lattice: raw.lattice, atoms: raw.atoms, periodic: (raw as ParsedStructure & { periodic?: [boolean, boolean, boolean] }).periodic ?? raw.lattice.periodic ?? [true, true, true] });
    const next = { ...node, resources: [{ kind: 'structure' as const, id: structure.id, ...('sha256' in structure ? { sha256: String(structure.sha256) } : {}) }], configuration: { ...node.configuration, savedStructureSignature: signature, formula, missingInputs:Array.isArray(node.configuration.missingInputs)?node.configuration.missingInputs.filter((value:unknown)=>!value||typeof value!=='object'||!('kind' in value)||value.kind!=='structure'):[] } };
    if (!updateNode(next)) throw new Error(t('Input could not be added to this workflow. Resolve the save error first.', 'Input belum dapat ditambahkan ke workflow. Selesaikan masalah penyimpanan dahulu.'));
    return next;
  };
  const prepareRun = async (targets: string[], force: string[] = []) => {
    if (busy) return;
    setBusy(true); setMessage('');
    try {
      const requireChange = (next: ProjectWorkflow) => { if (!change(next, false)) throw new Error(t('Workflow changes could not be saved. Resolve the configuration or size error before running.', 'Perubahan workflow belum dapat disimpan. Selesaikan masalah konfigurasi atau ukuran sebelum menjalankan.')); };
      if (client.getSnapshot().status === 'unavailable') throw new Error(unavailableMessage);
      if (client.getSnapshot().status === 'conflict' || client.getSnapshot().status === 'loading') throw new Error(t('Resolve the saved workflow before running.', 'Selesaikan sinkronisasi workflow sebelum menjalankan.'));
      const { account } = await accountRequest<AccountResponse>();
      const needed = new Set(workflowOrder(latestGraph.current, targets));
      requireChange({ ...latestGraph.current, nodes: latestGraph.current.nodes.map(node => needed.has(node.id) && (workflowCalculationTypes[node.kind] || node.kind === 'md' || node.kind === 'md-analysis' || node.kind === 'extract-frame') ? freezeWorkflowCompute(node, account, pendingCompute) : node) });
      for (const node of latestGraph.current.nodes) if (needed.has(node.id) && node.kind === 'structure' && (node.configuration.structure as ParsedStructure | undefined)?.atoms.length) await saveStructure(node);
      for (const node of latestGraph.current.nodes) if (needed.has(node.id) && node.kind === 'md') {
        const components = node.configuration.components as MdSimulationComponentInstance[] | undefined;
        if (!components?.length) continue;
        requireChange({ ...latestGraph.current, nodes: latestGraph.current.nodes.map(item => item.id === node.id ? { ...node, configuration: { ...node.configuration, execution: { name: node.name, workflow: createMdSimulationWorkflowV2(components), ...workflowExecutionCompute(resolvedWorkflowCompute(node, account, pendingCompute)), computeTarget: 'personal' } } } : item) });
      }
      const current = latestGraph.current;
      const prepared = { ...current, nodes: current.nodes.map(node => {
        if (!needed.has(node.id) || !workflowCalculationTypes[node.kind]) return node;
        try { return { ...node, configuration: { ...node.configuration, compilerVersion: 1, draft: workflowQeDraft(current, node), configurationError: undefined, execution: compileWorkflowDft(current, node, project?.name ?? '') } }; }
        catch (failure) { return { ...node, configuration: { ...node.configuration, compilerVersion: 1, draft: workflowQeDraft(current, node), execution: undefined, configurationError: (failure as Error).message } }; }
      }) };
      requireChange(prepared); await client.flush();
      const saved = client.getSnapshot();
      if (saved.status !== 'synced') throw new Error(saved.error || t('Save the workflow before running.', 'Simpan workflow sebelum menjalankan.'));
      const result = await projectWorkflowApi.plan(projectId, saved.revision, targets, force);
      setRerun(force); setRunKey(crypto.randomUUID()); setPlan(result.plan);
    } catch (failure) { setMessage((failure as Error).message); }
    finally { setBusy(false); }
  };
  const refreshComputePlan = useEffectEvent(() => {
    if (!plan) return;
    const targets = plan.targets; runDialog.current?.close(); setPlan(null);
    void prepareRun(targets, rerun);
  });
  useEffect(() => { const refresh = () => refreshComputePlan(); window.addEventListener('phynite:compute-target-change', refresh); return () => window.removeEventListener('phynite:compute-target-change', refresh); }, []);
  const submitRun = async () => {
    if (!plan || busy) return;
    setBusy(true);
    try {
      const { run } = await projectWorkflowApi.run(projectId, plan.revision, plan.targets, runKey, rerun, plan.compilerSha256 ?? undefined);
      setRuns(current => [run, ...current.filter(item => item.id !== run.id)]); runDialog.current?.close(); setPlan(null); setShowRuns(true);
    } catch (failure) { setMessage((failure as Error).message); }
    finally { setBusy(false); }
  };
  const group = (ids = selectedModules) => {
    if (ids.length < 2) return;
    const groupId = id(), chosen = new Set(ids);
    const next = { ...graph, nodes: graph.nodes.map(node => chosen.has(node.id) ? { ...node, groupId } : node), groups: [...graph.groups.map(item => ({ ...item, nodeIds: item.nodeIds.filter(value => !chosen.has(value)) })).filter(item => item.nodeIds.length), { id: groupId, name: t('Group', 'Grup'), nodeIds: ids }] };
    change(next);
  };
  const expandSelection = (values: string[]) => canvasSelection(graph, values);
  const deleteSelection = () => {
    const next=removeWorkflowNodes(latestGraph.current, selectedModules);
    if(change({...next,edges:next.edges.filter(edge=>!selectedEdges.includes(edge.id))})){setSelected([]);setSelectedEdges([]);}
  };
  const ungroup = (ids = selected) => {
    const groups = new Set(graph.groups.filter(group => ids.includes(group.id) || group.nodeIds.some(id => ids.includes(id))).map(group => group.id));
    if (groups.size) change({ ...graph, groups: graph.groups.filter(group => !groups.has(group.id)), nodes: graph.nodes.map(node => groups.has(node.groupId ?? '') ? { ...node, groupId: undefined } : node) });
  };
  const duplicate = (ids = selectedModules) => {
    if (!ids.length) return;
    const current = latestGraph.current, clipboard = copyWorkflowNodes(current, ids, state.revision, editor.state.edgeAnchors);
    const pasted = pasteWorkflowSelection(current, clipboard, id);
    if (change(pasted.workflow)) { setSelected(Object.values(pasted.nodeIds)); setSelectedEdges([]); for (const [id, anchors] of Object.entries(pasted.edgeAnchors)) editor.dispatch({ type: 'edge-anchors', id, anchors }); }
    setMenu(null);
  };
  const align = (alignment: CanvasAlignment, ids = selected) => { const next = alignCanvasSelection(latestGraph.current, ids, measurements, alignment); if (next !== latestGraph.current) change(next); setMenu(null); };
  useEffect(() => {
    if (activeTab !== 'canvas' || !cameraReady || !studyReveal.length || studyReveal.some(id => !flow.getNode(id)?.measured?.width)) return;
    const ids = studyReveal.filter(id => graph.nodes.some(node => node.id === id));
    if (!ids.length) return;
    void flow.fitView({ nodes: ids.map(id => ({ id })), padding: .2, duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180 }).then(() => setStudyReveal([]));
  }, [activeTab, cameraReady, studyReveal, measurements, graph.nodes, flow]);
  const fit = (selection = false) => { void flow.fitView({ ...(selection && selectedModules.length ? { nodes: selectedModules.map(id => ({ id })) } : {}), padding: .2, duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180 }); };
  const freshScf = (scfId: string) => {
    const targets = graph.edges.filter(edge => edge.source === scfId && edge.port === 'electronic').map(edge => edge.target);
    setMenu(null); void prepareRun(targets.length ? targets : [scfId], [scfId]);
  };
  const contextGroup = graph.groups.find(group => group.id === menu?.nodeId);
  const contextIds = expandSelection(menu?.nodeId ? selected.includes(menu.nodeId) ? selected : [menu.nodeId] : selected);
  const contextNode = graph.nodes.find(node => node.id === menu?.nodeId);
  const resourceNode = graph.nodes.find(node => (node.id === layoutTarget || node.id === selectedModules[0]) && (workflowCalculationTypes[node.kind] || node.kind === 'md' || node.kind === 'md-analysis' || node.kind === 'extract-frame'))
    ?? graph.nodes.find(node => workflowCalculationTypes[node.kind] || node.kind === 'md' || node.kind === 'md-analysis' || node.kind === 'extract-frame');
  const runSelection = resourceNode ? { ...(workloadForNode(resourceNode) === 'qe' ? pendingCompute : {}), ...workflowComputeSelection(resourceNode) } : pendingCompute;
  const reviewResourceNodes = plan ? [...new Set([...plan.targets, ...plan.nodes.map(item => item.nodeId)])].flatMap(id => {
    const node = graph.nodes.find(node => node.id === id);
    return node && (workflowCalculationTypes[node.kind] || node.kind === 'md' || node.kind === 'md-analysis' || node.kind === 'extract-frame') ? [node] : [];
  }) : [];
  const reviewResourceNode = reviewResourceNodes.find(node => node.id === reviewResourceId) ?? reviewResourceNodes[0];
  const changeRunCompute = (selection: ComputeSelection, node = resourceNode) => {
    if (!node) {
      setPendingCompute(selection);
      try { sessionStorage.setItem(pendingComputeKey, JSON.stringify(selection)); } catch { /* The current selection remains usable. */ }
      return;
    }
    const configuration = { ...node.configuration };
    for (const key of ['computeTarget', 'cloudMode', 'computeProfileId', 'estimatedComputeSeconds', 'vcpus', 'memoryMiB']) delete configuration[key];
    updateNode({ ...node, configuration: { ...configuration, ...selection } });
    if (plan) { runDialog.current?.close(); setPlan(null); }
  };
  const [resourcesOpen, setResourcesOpen] = useState(false);
  const resourcePanel = <WorkspaceResources open={resourcesOpen} onOpen={() => setResourcesOpen(true)} onClose={() => setResourcesOpen(false)} owner={owner} workload={workloadForNode(resourceNode)} selection={runSelection} onChange={changeRunCompute} jobs={activeWorkspaceJobs(runs, graph.nodes)} scope="project" projectId={projectId} />;

  return <main ref={root} className="project-workflow" data-theme={theme} onKeyDown={event => {
    if (event.key === 'Escape') setMenu(null);
    if (editableTarget(event.target)) return;
    if (!(event.target instanceof globalThis.Node) || !canvasRoot.current?.contains(event.target)) return;
    if (['Delete','Backspace'].includes(event.key) && (selectedModules.length || selectedEdges.length)) { event.preventDefault(); deleteSelection(); return; }
    const modifier = event.metaKey || event.ctrlKey, key = event.key.toLowerCase();
    if (event.key === 'Alt') bypassSnap.current = true;
    // Native clipboard events retain browser/OS keyboard handling, including denied API access.
    if (modifier && ['c', 'x', 'v'].includes(key)) {
      const apple = /Mac|iPhone|iPad/.test(navigator.platform);
      if (apple ? event.ctrlKey && !event.metaKey : event.metaKey && !event.ctrlKey) {
        event.preventDefault(); if (key === 'v') void paste(); else void copy(selectedModules, key === 'x');
      }
      return;
    }
    if (modifier && key === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); }
    else if (event.ctrlKey && !event.metaKey && key === 'y') { event.preventDefault(); redo(); }
    else if (modifier && key === 'a') { event.preventDefault(); setSelected(graph.nodes.map(node => node.id)); setSelectedEdges([]); }
    else if (modifier && key === 'd') { event.preventDefault(); duplicate(); }
    else if (modifier && key === 'g') { event.preventDefault(); if (event.shiftKey) ungroup(); else group(); }
    else if (!modifier && !event.altKey && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key) && selectedModules.length) {
      event.preventDefault(); const amount = event.shiftKey ? 24 : 1, dx = event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0, dy = event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0;
      change({ ...latestGraph.current, nodes: latestGraph.current.nodes.map(node => selectedModules.includes(node.id) ? { ...node, position: { x: node.position.x + dx, y: node.position.y + dy } } : node) }, !event.repeat);
    } else if (!modifier && event.code === 'Digit0') { event.preventDefault(); fit(event.shiftKey); }
    else if (!modifier && event.key === '?') { event.preventDefault(); setShortcutHelp(true); }

  }}>
    <ResearchSidebarSlot section="projects">
      <div className="workflow-sidebar-context" hidden={chatSidebar}><CanvasProjectSidebar key={graph.projectId} graph={graph} disabled={!editor.hydrated} projectName={project?.name??t('Project','Project')} activeTab={layoutTarget} selectedNodeIds={canvasVisible ? selectedModules : undefined} statuses={statuses} onOpen={openSidebarView} onNewTab={() => newTab()} onAdd={openPalette} onRuns={openRuns}/></div>
      <div className="workflow-sidebar-context" hidden={!chatSidebar}><WorkflowChatSidebar projectName={project?.name ?? t('Project', 'Project')} conversations={aiChats} status={aiHistoryStatus} activeTab={layoutTarget} creating={aiCreating} disabled={!editor.hydrated} deleting={historyBusy} onDelete={id => manageHistory(id, false)} onOpen={id => { if (effectivePanel?.id && !visibleTabs.includes(layoutTarget)) { focusTab(id); changeAiPresentation(id, effectivePanel.presentation); } else openEditor(id); }} onNew={() => void newAiChat(Boolean(floatingVisible && !visibleTabs.includes(layoutTarget)))} onRetry={() => void refreshAiChats().catch(() => undefined)} /></div>
    </ResearchSidebarSlot>
    <ResearchWorkspaceHeaderSlot><CanvasTabBar projectName={project?.name ?? t('Project','Project')} disabled={!editor.hydrated} state={displayState} splitVisible={split} splitAvailable={splitAvailable} floatingId={floatingVisible ? effectivePanel?.id : undefined} aiControl={!canvasVisible && !visibleTabs.some(isWorkflowAiTab) ? aiVisibilityControl : undefined} targetId={layoutTarget} onTarget={focusTab} splitWidth={split && !vertical ? editorWidth : undefined} nodes={graph.nodes} chatTitles={Object.fromEntries(aiChats.map(chat => [chat.id, chat.title]))} dispatch={dispatchWorkspace} onAdd={newTab} onOpenSidebar={shell?.openSidebar} status={state.status === 'synced' ? t('Saved','Tersimpan') : state.status === 'saving' ? t('Saving…','Menyimpan…') : state.status === 'conflict' ? t('Conflict','Konflik') : state.localSaved ? t('Draft on this device','Draft di perangkat ini') : t('Not synced','Belum sinkron')} /></ResearchWorkspaceHeaderSlot>
    {resourcePanel}
    {message && <div className="workflow-notice" role="status"><span>{message}</span><button onClick={() => setMessage('')} aria-label={t('Dismiss', 'Tutup')}><X size={16} /></button></div>}
    {state.status === 'conflict' && <div className="workflow-conflict" role="alert"><p>{t('Another device saved changes. Your local draft is safe. Compare both versions before choosing which to keep.', 'Perangkat lain menyimpan perubahan. Draft lokal Anda aman. Bandingkan kedua versi sebelum memilih.')}</p><button onClick={() => { const blob = new Blob([JSON.stringify(graph, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'workflow-local-draft.json'; a.click(); URL.revokeObjectURL(url); }}>{t('Download local draft', 'Unduh draft lokal')}</button><details><summary>{t('Compare versions', 'Bandingkan versi')}</summary><div className="workflow-version-comparison"><pre aria-label="Local draft">{JSON.stringify(graph, null, 2)}</pre><pre aria-label="Server version">{JSON.stringify(state.remote?.workflow, null, 2)}</pre></div></details><button onClick={() => void client.resolve('remote')}>{t('Use remote version', 'Gunakan versi server')}</button><button onClick={() => void client.resolve('local')}>{t('Replace with my draft', 'Ganti dengan draft saya')}</button></div>}
    {state.status === 'unavailable' && <div className="workflow-notice workflow-service-notice" role="status"><span>{state.localSaved ? unavailableMessage : state.error}</span><button onClick={() => void client.refresh()}>{t('Check availability', 'Periksa ketersediaan')}</button></div>}
    {state.status === 'offline' && <div className="workflow-notice" role="alert">{state.error}<button onClick={() => void client.refresh()}>{t('Retry sync', 'Coba sinkronkan')}</button></div>}
    <div className="workflow-panes" data-split={split} data-axis={vertical ? 'vertical' : 'horizontal'} onPointerDownCapture={targetPane} onFocusCapture={targetPane} style={split ? { '--workflow-editor-width': `${editorWidth}px` } as CSSProperties : undefined}><div className="workflow-split-dropzones">{(['left', 'right', 'top', 'bottom'] as const).map(direction => <button key={direction} data-direction={direction} onDragOver={event => { if (event.dataTransfer.types.includes('application/x-phynite-tab')) event.preventDefault(); }} onDrop={event => { event.preventDefault(); event.stopPropagation(); const id = event.dataTransfer.getData('application/x-phynite-tab'); document.body.classList.remove('workflow-dragging-tab'); const beside = visibleTabs.includes(focusedPaneTab) ? focusedPaneTab : displayState.activeTab; if (id && id !== beside && !isWorkflowLauncherTab(beside)) dispatchWorkspace({ type: 'split', id, beside, direction }); }}>{t('Split', 'Split')} {t(direction, ({ left: 'kiri', right: 'kanan', top: 'atas', bottom: 'bawah' })[direction])}</button>)}</div>
    {split && vertical && <CanvasTabBar projectName={project?.name ?? 'Project'} disabled={!editor.hydrated} state={displayState} splitVisible secondaryOnly targetId={layoutTarget} onTarget={focusTab} nodes={graph.nodes} chatTitles={Object.fromEntries(aiChats.map(chat => [chat.id, chat.title]))} dispatch={dispatchWorkspace} onAdd={newTab} status="" />}
    <div ref={canvasRoot} className="workflow-canvas-area" data-pane-tab="canvas" data-pane={pane('canvas')} data-ready={cameraReady} aria-busy={!cameraReady} tabIndex={0} aria-label={t('Canvas tools','Tool kanvas')} data-tool={hand ? 'hand' : 'select'} onPointerDownCapture={event => { if (event.button === 0 && (event.target as Element).closest('.react-flow__node,.react-flow__nodesselection-rect')) dragPointer.current = flow.screenToFlowPosition({ x:event.clientX, y:event.clientY }); }} onCopy={event => nativeCopy(event)} onCut={event => nativeCopy(event, true)} onPaste={event => { if (!editableTarget(event.target)) { event.preventDefault(); void paste(event.clipboardData.getData('text/plain')); } }} onPointerMove={event => { bypassSnap.current = event.altKey; if (!(event.target as Element).closest('.workflow-canvas-toolbar,.workflow-selection-actions')) pointer.current = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }); }} onPointerLeave={() => { pointer.current = null; }} onPointerDown={event=>{if(!(event.target as Element).closest('button,input,textarea,[role=combobox]')) event.currentTarget.focus({preventScroll:true});}} hidden={!canvasVisible} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setSpaceHand(false); }} onKeyDown={event => {
      if (editableTarget(event.target) || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.code === 'Space') { event.preventDefault(); setSpaceHand(true); }
      if (event.key.toLowerCase() === 'v') { event.preventDefault(); setSpaceHand(false); }
      if (event.key === 'Enter' && selectedModules.length === 1) { event.preventDefault(); openEditor(selectedModules[0]); }
    }}>
      {!cameraReady && <WorkspaceLoading className="workflow-canvas-loading" label={t('Loading canvas…', 'Memuat kanvas…')} />}
      <div className="workflow-canvas-toolbar"><button disabled={state.status === 'loading'} aria-haspopup="dialog" aria-expanded={!!picker} onClick={openPalette}><Plus size={18} />{t('Add module', 'Tambah modul')}</button><span /><button title={t('Undo', 'Urungkan')} aria-label={t('Undo', 'Urungkan')} disabled={!past.length} onClick={undo}><Undo2 size={18} /></button><button title={t('Redo', 'Ulangi')} aria-label={t('Redo', 'Ulangi')} disabled={!future.length} onClick={redo}><Redo2 size={18} /></button>{aiVisibilityControl}<button aria-label={t('Research context','Konteks riset')} title={t('Research context','Konteks riset')} aria-expanded={showResearchContext} onClick={() => { setShowResearchContext(value => !value); setShowRuns(false); }}><Activity size={18}/></button><button aria-label={t('Run history','Histori eksekusi')} title={t('Run history','Histori eksekusi')} aria-expanded={showRuns} onClick={() => { setShowRuns(value => !value); setShowResearchContext(false); }}><History size={18}/></button><div className="workflow-run-control"><button className="workflow-primary" disabled={busy || !graph.nodes.length || !canPrepareRun} onClick={() => void prepareRun(selectedModules.length?selectedModules:graph.nodes.map(node => node.id))}><Play size={16} />{selectedModules.length?t(`Run ${selectedModules.length} selected`,`Jalankan ${selectedModules.length} pilihan`):t('Run','Jalankan')}</button><details onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))event.currentTarget.removeAttribute('open');}} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.currentTarget.removeAttribute('open');event.currentTarget.querySelector('summary')?.focus();}}}><summary aria-label={t('Run options','Pilihan eksekusi')}><ChevronDown size={16}/></summary><div><button disabled={busy||!selectedModules.length||!canPrepareRun} onClick={event=>{event.currentTarget.closest('details')?.removeAttribute('open');void prepareRun(selectedModules);}}>{t('Run selected','Jalankan pilihan')}</button><button disabled={busy||!graph.nodes.length||!canPrepareRun} onClick={event=>{event.currentTarget.closest('details')?.removeAttribute('open');void prepareRun(graph.nodes.map(node=>node.id));}}>{t('Run all','Jalankan semua')}</button></div></details></div></div>
      {canvasMounted && state.status !== 'loading' && editor.hydrated && <ReactFlow<FlowNode> inert={!cameraReady} nodes={[...groupNodes, ...flowNodes]} edges={flowEdges} nodeTypes={nodeTypes} colorMode={theme} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} isValidConnection={connection => workflowCanvasConnection(latestGraph.current, connection) !== null} onConnect={connect} onEdgeMouseEnter={(_, edge) => setHoveredEdge(edge.id)} onEdgeMouseLeave={() => setHoveredEdge(null)} onNodeMouseEnter={(_, node) => { setHoveredEdge(null); setHoveredNode(node.id); }} onNodeMouseLeave={() => setHoveredNode(null)} onNodeClick={(_, node) => { if (!hand && node.type === 'group' && !_.shiftKey) setSelected(graph.groups.find(group => group.id === node.id)?.nodeIds ?? []); }} onNodeDoubleClick={(event, node) => { if (!hand && node.type === 'module' && !(event.target as Element).closest('button,.react-flow__handle') && Date.now() - lastDrag.current > 200) openEditor(node.id); }} onNodeDrag={dragNodes} onNodeDragStart={(event, node, nodes) => beginNodeDrag(event, nodes.length ? nodes : [node])} onSelectionDragStart={(event, nodes) => beginNodeDrag(event, nodes)} onSelectionDrag={dragNodes} onSelectionDragStop={finishNodeDrag} onNodeDragStop={finishNodeDrag} onNodeContextMenu={(event, node) => contextMenu(event, node.id)} onPaneContextMenu={event => contextMenu(event)} onDoubleClick={event => { if ((event.target as Element).classList.contains('react-flow__pane')) { const point = { x: event.clientX, y: event.clientY }; openPicker(flow.screenToFlowPosition(point), { ...point, above: point.y }, canvasRoot.current); } }} onConnectEnd={(event, connection) => {
        lastDrag.current = Date.now();
        const point = 'changedTouches' in event ? event.changedTouches[0] : event;
        if (!connection.isValid && connection.fromNode && connection.fromHandle && !connection.toNode && document.elementFromPoint(point.clientX, point.clientY)?.closest('.react-flow__pane')) {
          const anchor: WorkflowConnectionAnchor = { nodeId: connection.fromNode.id, type: connection.fromHandle.type, side: connection.fromHandle.position };
          if (!workflowModuleChoices(latestGraph.current, anchor).length) return;
          const screen = { x: point.clientX, y: point.clientY };
          openPicker(flow.screenToFlowPosition(screen), { ...screen, above: screen.y }, canvasRoot.current, anchor);
        }
      }} onMoveStart={() => setPicker(null)} onMoveEnd={(_, viewport) => { if (restoredCamera.current) editor.dispatch({type:'viewport',viewport}); }} multiSelectionKeyCode={['Meta', 'Control', 'Shift']} selectionKeyCode={null} selectionOnDrag={!hand} selectionMode={SelectionMode.Partial} panActivationKeyCode={null} panOnDrag={hand ? [0,1,2] : [1,2]} panOnScroll zoomOnScroll={false} zoomActivationKeyCode={['Meta','Control']} zoomOnPinch zoomOnDoubleClick={false} minZoom={.1} maxZoom={2.5} deleteKeyCode={null} proOptions={{hideAttribution:true}} nodesDraggable={!hand} nodesConnectable={!hand} elementsSelectable={!hand} defaultViewport={workflowEditorCamera(editor.state)} onlyRenderVisibleElements aria-label={t('Project workflow canvas', 'Kanvas workflow project')}>
        <Background gap={24} size={1} /><Controls showInteractive={false} />
      </ReactFlow>}
      <div className="workflow-snap-guides" aria-hidden="true">{guides.map(guide => { const viewport = flow.getViewport(); return <i key={guide.axis} data-axis={guide.axis} style={guide.axis === 'x' ? { left: guide.position * viewport.zoom + viewport.x } : { top: guide.position * viewport.zoom + viewport.y }} />; })}</div>
      {(selectedModules.length>0 || selectedEdges.length>0)&&<div className="workflow-selection-actions" role="toolbar" aria-label={t('Selection actions','Aksi pilihan')}><span>{t(`${selectedModules.length} modules selected`,`${selectedModules.length} modul dipilih`)}{selectedEdges.length>0&&` · ${selectedEdges.length} ${t('connections','koneksi')}`}</span><button aria-label={t('Copy selected','Salin pilihan')} disabled={!selectedModules.length} onClick={()=>void copy(selectedModules)}><Copy size={18}/></button><button aria-label={t('Delete selected','Hapus pilihan')} title="Delete" onClick={deleteSelection}><Trash2 size={18}/></button></div>}
      {!graph.nodes.length && state.status !== 'loading' && <div className="workflow-empty"><Box size={26} /><h1>{project?.name}</h1><p>{t('Start with a structure. Connect the steps of your study.', 'Mulai dari struktur. Hubungkan langkah-langkah riset Anda.')}</p><button onClick={openPalette}><Plus size={18} />{t('Add your first module', 'Tambah modul pertama')}</button></div>}
    </div>
    {visibleTabs.filter(isWorkflowLauncherTab).map(launcherId => <section className="workflow-editor workflow-launcher-editor" data-pane={pane(launcherId)} data-pane-tab={launcherId} key={launcherId}><WorkflowStartTab nodes={graph.nodes} conversations={aiChats} onNewAiChat={() => void newAiChat()} onOpen={id => dispatchWorkspace({type:'resolve-launcher',tabId:launcherId,nodeId:id})} onAdd={openPalette} onCanvas={()=>dispatchWorkspace({type:'open',id:'canvas'})} onRuns={()=>setShowRuns(true)}><WorkflowDraftTransfer graph={graph} owner={owner} name={project?.name??'Project'} onError={setMessage}/></WorkflowStartTab></section>)}
    {project && editor.state.tabs.filter(isWorkflowAiTab).map(tabId => {
      const panel = effectivePanel?.id === tabId ? effectivePanel : undefined;
      const height = panel?.presentation === 'floating' ? panelHeight : floatingHeight;
      const bounded = panel && panel.x !== undefined ? workflowFloatingPanelPosition({ x: panel.x, y: panel.bottom === undefined ? panel.y ?? 0 : containerHeight - panel.bottom - height }, { width: panelWidth, height }, { width: containerWidth, height: containerHeight }, { inset: containerWidth <= 560 ? 6 : 14 }) : undefined;
      const position = bounded ? { left: `${bounded.x}px`, bottom: `${bounded.bottom}px`, right: 'auto', top: 'auto' } : {};
      const revealComposer = (event: { target: EventTarget | null }) => { if (panel && event.target instanceof Element && event.target.closest('.ai-composer')) setRevealedPanel(tabId); };
      return <section key={tabId} id={`workflow-ai-panel-${tabId}`} className="workflow-editor workflow-ai-editor" data-presentation={panel?.presentation} data-header-revealed={panel ? panel.presentation !== 'composer' || revealedPanel === tabId : undefined} onPointerDownCapture={revealComposer} onFocusCapture={revealComposer} style={panel ? { width: `${panelWidth}px`, ...(panel.presentation === 'floating' ? { height: `${panelHeight}px` } : {}), ...position } : undefined} data-workflow-editor role="tabpanel" aria-label="Phynite AI" data-pane-tab={tabId} data-pane={pane(tabId)} hidden={panel?.presentation === 'minimized' || !visibleTabs.includes(tabId) && !panel}>
        {panel && <AiPanelHeader title={aiChats.find(chat => chat.id === aiConversationFromTab(tabId))?.title || 'Phynite AI'} tabId={tabId} conversations={aiChats.map(chat => ({ id: aiConversationTab(chat.id), title: chat.title || 'Phynite AI' }))} status={aiStatuses[tabId] ?? 'idle'} presentation={panel?.presentation}
          onChange={presentation => changeAiPresentation(tabId, presentation)} onPosition={(x, y) => { const height = root.current?.querySelector('.workflow-ai-editor[data-presentation]')?.getBoundingClientRect().height ?? panelHeight; dispatchEditor({ type: 'panel-position', x, y, bottom: containerHeight - y - height }); }}
          onSelect={id => changeAiPresentation(id, 'floating')} onNew={() => void newAiChat(true)} onManage={action => manageHistory(tabId, action === 'clear')}
           />}
        <WorkflowPanelBoundary label="Phynite AI" onCanvas={() => dispatchWorkspace({ type: 'open', id: 'canvas' })}>
          <AiWorkspace projectId={projectId} legacyProjectId={project.legacyId} conversationId={aiConversationFromTab(tabId)} visible={visibleTabs.includes(tabId) || Boolean(panel && panel.presentation !== 'minimized')} composerOnly={panel?.presentation === 'composer' || panel?.presentation === 'minimized'} savedContext={state.status === 'synced'} contextRequest={contextRequest?.tabId === tabId ? contextRequest : undefined}
            onStatusChange={status => setAiStatuses(current => current[tabId] === status ? current : { ...current, [tabId]: status })}
            onProjectChange={() => void client.refresh()} onConversationChange={() => void refreshAiChats().catch(() => undefined)} onOpenConversation={() => changeAiPresentation(tabId, 'tab')} onConversationReady={id => { if (tabId === workflowAiTab) dispatchEditor({ type: 'resolve-launcher', tabId, nodeId: aiConversationTab(id) }); }}
            onShowCanvas={ids => { setSelected(ids.filter(id => graph.nodes.some(node => node.id === id))); setSelectedEdges(ids.filter(id => graph.edges.some(edge => edge.id === id))); setStudyReveal([...new Set([...ids.filter(id => graph.nodes.some(node => node.id === id)), ...graph.edges.filter(edge => ids.includes(edge.id)).flatMap(edge => [edge.source, edge.target])])]); dispatchWorkspace({type:'open',id:'canvas'}); }} />
        </WorkflowPanelBoundary>
        {panel?.presentation === 'floating' && <AiPanelResize onSize={(width, height) => dispatchEditor({ type: 'panel-size', width, height })} onPosition={(x, y) => { const height = root.current?.querySelector('.workflow-ai-editor[data-presentation]')?.getBoundingClientRect().height ?? panelHeight; dispatchEditor({ type: 'panel-position', x, y, bottom: containerHeight - y - height }); }} />}
      </section>;
    })}
    {historyAction && <dialog ref={historyDialog} className="workflow-chat-history" aria-labelledby="chat-history-title" onCancel={event => { if (historyBusy) event.preventDefault(); }} onClose={closeHistory}>
      <h2 id="chat-history-title">{historyAction.all ? t('Clear project chat history?', 'Bersihkan riwayat chat project?') : t('Delete this chat?', 'Hapus chat ini?')}</h2>
      <p>{historyAction.all ? t('All AI chats in this project will be removed from history. Active responses will stop. Your project and calculations are kept.', 'Semua chat AI di project ini akan dihapus dari riwayat. Respons yang aktif akan dihentikan. Project dan perhitungan Anda tetap tersimpan.') : t('This conversation will be removed from history and its active response will stop. Your project and calculations are kept.', 'Percakapan ini akan dihapus dari riwayat dan respons yang aktif akan dihentikan. Project dan perhitungan Anda tetap tersimpan.')}</p>
      {historyError && <p role="alert">{historyError}</p>}
      <footer><button type="button" disabled={historyBusy} onClick={() => historyDialog.current?.close()}>{t('Cancel', 'Batal')}</button><button type="button" disabled={historyBusy} onClick={() => void deleteHistory()}>{historyBusy ? t('Deleting…', 'Menghapus…') : historyAction.all ? t('Clear history', 'Bersihkan riwayat') : t('Delete chat', 'Hapus chat')}</button></footer>
    </dialog>}
    {editor.state.tabs.includes(workflowStudyTab) && <section className="workflow-editor workflow-study-editor" data-workflow-editor role="tabpanel" aria-label={t('Parameter study','Studi parameter')} data-pane-tab={workflowStudyTab} data-pane={pane(workflowStudyTab)} hidden={!visibleTabs.includes(workflowStudyTab)}><WorkflowPanelBoundary label={t('Parameter study', 'Studi parameter')} onCanvas={() => dispatchWorkspace({ type: 'open', id: 'canvas' })}><ParameterStudyWorkspace onShowCases={ids => { setSelected(ids); setSelectedEdges([]); setStudyReveal(ids); dispatchWorkspace({type:'open',id:'canvas'}); }} graph={graph} attempts={runs.flatMap(run => run.attempts)} disabled={busy || !canPrepareRun} onCanvas={() => dispatchWorkspace({type:'open',id:'canvas'})} onOpen={openEditor} onRun={targets => void prepareRun(targets)} onApply={result => { if (busy || !canPrepareRun || stableWorkflowJson(latestGraph.current) !== result.baseSignature) return false; if (!change(result.workflow)) return false; setSelected(result.nodeIds); setSelectedEdges([]); return true; }} /></WorkflowPanelBoundary></section>}
    {split && <div className="workflow-splitter" role="separator" tabIndex={0} aria-label={t('Resize editor','Ubah lebar editor')} aria-orientation={vertical ? 'horizontal' : 'vertical'} aria-valuenow={Math.round(editorWidth)} aria-valuemin={primaryMinimum} aria-valuemax={Math.round(containerExtent-secondaryMinimum)} onKeyDown={event => {
      if (event.key === 'Escape' && splitDrag.current) { event.preventDefault(); event.stopPropagation(); clearSplitDrag(); return; }
      if ([...(vertical ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft','ArrowRight']), 'Home','End'].includes(event.key)) {
        event.preventDefault(); clearSplitDrag();
        const width = event.key === 'Home' ? primaryMinimum : event.key === 'End' ? containerExtent-secondaryMinimum : editorWidth+(['ArrowRight', 'ArrowDown'].includes(event.key)?20:-20);
        editor.dispatch({ type: 'ratio', ratio: Math.max(primaryMinimum, Math.min(containerExtent-secondaryMinimum, width)) / containerExtent });
      }
    }} onPointerDown={event => {
      if (event.button !== 0 || !event.isPrimary || !splitPair) return;
      event.preventDefault(); clearSplitDrag();
      const panes = root.current?.querySelector<HTMLElement>('.workflow-panes'); if (!panes) return;
      const rect = panes.getBoundingClientRect();
      event.currentTarget.focus({ preventScroll: true }); event.currentTarget.setPointerCapture(event.pointerId);
      const cancel = (key: KeyboardEvent) => { if (key.key === 'Escape') { key.preventDefault(); key.stopPropagation(); clearSplitDrag(); } };
      window.addEventListener('keydown', cancel, true);
      const position = vertical ? event.clientY - rect.top : event.clientX - rect.left;
      splitDrag.current = { frame: 0, originalRatio: editor.state.splitRatio, pointerId: event.pointerId, offset: position - editorWidth, axis: vertical ? 'vertical' : 'horizontal', pair: [...splitPair], element: event.currentTarget, panes, shell: root.current?.closest<HTMLElement>('.research-app-shell') ?? null, cleanup: () => window.removeEventListener('keydown', cancel, true) };
    }} onPointerMove={event => {
      const drag = splitDrag.current, next = splitPosition(event), element = event.currentTarget;
      if (!drag || !next || !element.hasPointerCapture(event.pointerId)) return;
      cancelAnimationFrame(drag.frame);
      // Both the portal header and content preview use the same pixel boundary.
      drag.frame = requestAnimationFrame(() => {
        drag.panes.style.setProperty('--workflow-editor-preview', `${next.primary}px`);
        drag.shell?.style.setProperty('--workflow-editor-preview', `${next.primary}px`);
        if (next.maximizePane !== undefined) { element.dataset.snap = String(next.maximizePane); drag.panes.dataset.resizeSnap = String(next.maximizePane); }
        else { delete element.dataset.snap; delete drag.panes.dataset.resizeSnap; }
      });
    }} onPointerUp={event => {
      const drag = splitDrag.current, next = splitPosition(event); if (!drag || !next) return;
      clearSplitDrag();
      if (next.maximizePane !== undefined) { const id = drag.pair[next.maximizePane]; focusTab(id); dispatchWorkspace({ type: 'maximize', id }); }
      else if (Math.abs(next.primary - editorWidth) > .01) editor.dispatch({ type: 'ratio', ratio: next.ratio });
    }} onPointerCancel={event => { if (splitDrag.current?.pointerId === event.pointerId) clearSplitDrag(); }} onLostPointerCapture={event => { if (splitDrag.current?.pointerId === event.pointerId) clearSplitDrag(); }}>
      <span className="workflow-split-hint" aria-hidden="true">{t('Release for full view · Esc to cancel', 'Lepas untuk tampilan penuh · Esc untuk batal')}</span>
    </div>}
    {editorNodes.map(editorNode => <section key={editorNode.id} className="workflow-editor workflow-editor--tab" role="tabpanel" aria-label={editorNode.name} data-workflow-editor data-pane-tab={editorNode.id} data-pane={pane(editorNode.id)}><WorkflowPanelBoundary label={editorNode.name} onCanvas={() => dispatchWorkspace({ type: 'open', id: 'canvas' })}>{Array.isArray(editorNode.configuration.missingInputs) && editorNode.configuration.missingInputs.length > 0 && <div className="workflow-notice" role="alert"><span>{t('Repair imported inputs before running:','Perbaiki input impor sebelum menjalankan:')} {editorNode.configuration.missingInputs.map((item:unknown)=>typeof item==='object'&&item&&'id' in item?String(item.id):'Input').join(', ')}</span></div>}<WorkflowNodeEditor onCanvas={()=>dispatchWorkspace({type:'open',id:'canvas'})} attempts={runs.flatMap(run => run.attempts)} onOpenSource={openEditor} key={editorNode.id} node={editorNode} attempt={runs.flatMap(run => run.attempts).find(attempt => attempt.nodeId === editorNode.id)} graph={graph} projectName={project?.name ?? ''} owner={owner} onInputChange={sourceId => changeInput(editorNode, sourceId)} onChange={updateNode} onSaveStructure={async node => { await saveStructure(node); await client.flush(); if(client.getSnapshot().status !== 'synced') throw new Error(client.getSnapshot().error || 'Input is saved on this device only.'); }} onSave={async () => { await client.flush(); if (client.getSnapshot().status !== 'synced') throw new Error(client.getSnapshot().error || t('Draft is saved on this device only.','Draft hanya tersimpan di perangkat ini.')); }} saveStatus={state.status} runDisabled={busy || !canPrepareRun} onRun={() => void prepareRun([editorNode.id])} onClose={() => dispatchWorkspace({type:'close',id:editorNode.id})} onError={setMessage} /></WorkflowPanelBoundary></section>)}
    </div>
    {menu && <div className="workflow-context-menu" role="menu" onKeyDown={event => { if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')); const index = items.indexOf(document.activeElement as HTMLButtonElement); items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus(); } }} style={{ left: menu.x, top: menu.y, maxHeight: Math.max(120, window.innerHeight - menu.y - 8) } as CSSProperties}>{contextGroup && <><button role="menuitem" onClick={() => { const name = window.prompt(t('Group name', 'Nama grup'), contextGroup.name); if (name?.trim()) change({ ...graph, groups: graph.groups.map(group => group.id === contextGroup.id ? { ...group, name: name.trim().slice(0, 200) } : group) }); setMenu(null); }}>{t('Rename group', 'Ubah nama grup')}</button><button role="menuitem" onClick={() => { change({ ...graph, groups: graph.groups.filter(group => group.id !== contextGroup.id), nodes: graph.nodes.map(node => node.groupId === contextGroup.id ? { ...node, groupId: undefined } : node) }); setMenu(null); }}>{t('Ungroup', 'Lepas grup')}</button></>}{contextNode && <><button role="menuitem" onClick={() => {dispatchWorkspace({type:'layout',layout:'full'});openEditor(contextNode.id);}}>{t('Open in tab', 'Buka di tab')}</button><button role="menuitem" onClick={() => {dispatchWorkspace({type:'split',id:contextNode.id,beside:'canvas'});setMenu(null);}}>{t('Open beside canvas','Buka di samping kanvas')}</button><button role="menuitem" onClick={() => { const name = window.prompt(t('Module name', 'Nama modul'), contextNode.name); if (name?.trim()) updateNode({ ...contextNode, name: name.trim().slice(0, 200) }); setMenu(null); }}>{t('Rename', 'Ubah nama')}</button></>}{(contextIds.length > 0 || selectedEdges.length > 0) && <button role="menuitem" onClick={() => void addAiContext([...contextIds, ...selectedEdges])}><PhyniteAiIcon size={16} />{t('Add to AI context', 'Tambahkan ke konteks AI')}</button>}{contextNode?.kind === 'scf' && <button role="menuitem" disabled={!canPrepareRun || busy} onClick={() => freshScf(contextNode.id)}>{t('Run fresh SCF', 'Jalankan SCF baru')}</button>}<button role="menuitem" disabled={!contextIds.length} onClick={() => void copy(contextIds, true)}>{t('Cut', 'Potong')}</button><button role="menuitem" disabled={!contextIds.length} onClick={() => void copy(contextIds)}><Copy size={16} />{t('Copy', 'Salin')}</button><button role="menuitem" onClick={() => void paste()}>{t('Paste', 'Tempel')}</button><button role="menuitem" disabled={!contextIds.length} onClick={() => duplicate(contextIds)}>{t('Duplicate', 'Duplikasi')}</button><button role="menuitem" disabled={!contextIds.length} onClick={() => { change(removeWorkflowNodes(graph, contextIds)); setMenu(null); }}>{t('Delete', 'Hapus')}</button><button role="menuitem" disabled={!contextIds.length || !canPrepareRun} onClick={() => { setMenu(null); void prepareRun(contextIds); }}>{t('Run', 'Jalankan')}</button><button role="menuitem" disabled={!contextIds.length || !canPrepareRun} onClick={() => { setMenu(null); void prepareRun(contextIds, contextIds); }}>{t('Rerun', 'Jalankan ulang')}</button><button role="menuitem" disabled={contextIds.length < 2} onClick={() => { group(contextIds); setMenu(null); }}>{t('Group selected', 'Grupkan pilihan')}</button>{!contextGroup && <button role="menuitem" disabled={!graph.groups.some(group => selected.includes(group.id) || group.nodeIds.some(id => contextIds.includes(id)))} onClick={() => { ungroup(contextIds); setMenu(null); }}>{t('Ungroup selected', 'Lepas grup pilihan')}</button>}
      <details><summary>{t('Align / Distribute', 'Sejajarkan / Ratakan')}</summary>{([['left','Align left','Rata kiri'],['center','Align center','Rata tengah horizontal'],['right','Align right','Rata kanan'],['top','Align top','Rata atas'],['middle','Align middle','Rata tengah vertikal'],['bottom','Align bottom','Rata bawah'],['horizontal','Distribute horizontally','Ratakan horizontal'],['vertical','Distribute vertically','Ratakan vertikal']] as const).map(([value,en,ind]) => <button role="menuitem" key={value} disabled={contextIds.length < (['horizontal','vertical'].includes(value) ? 3 : 2)} onClick={() => align(value, contextGroup ? [contextGroup.id, ...selected.filter(id => !contextGroup.nodeIds.includes(id))] : contextIds)}>{t(en,ind)}</button>)}</details>
      <button role="menuitemcheckbox" aria-checked={editor.state.snapToGrid !== false} onClick={() => editor.dispatch({ type:'snapping', grid:editor.state.snapToGrid === false, guides:editor.state.showGuides !== false })}>{t('Snap to grid', 'Snap ke grid')} · {editor.state.snapToGrid !== false ? t('On','Aktif') : t('Off','Nonaktif')}</button>
      <button role="menuitemcheckbox" aria-checked={editor.state.showGuides !== false} onClick={() => editor.dispatch({ type:'snapping', grid:editor.state.snapToGrid !== false, guides:editor.state.showGuides === false })}>{t('Alignment guides', 'Garis pandu')} · {editor.state.showGuides !== false ? t('On','Aktif') : t('Off','Nonaktif')}</button>
      <button role="menuitem" onClick={() => { fit(); setMenu(null); }}>{t('Fit all', 'Tampilkan semua')}</button><button role="menuitem" onClick={() => { setShortcutHelp(true); setMenu(null); }}>{t('Keyboard shortcuts', 'Pintasan keyboard')}</button></div>}
    {picker && <WorkflowModulePicker placement={picker.screen} container={picker.container} kinds={workflowModuleChoices(graph, picker.anchor)} error={pickerError} onAdd={addNode} onStudy={picker.anchor ? undefined : () => { setPicker(null); openEditor(workflowStudyTab); }} onClose={closePicker}><WorkflowDraftTransfer graph={graph} owner={owner} name={project?.name??'Project'} onError={setMessage}/></WorkflowModulePicker>}
    <dialog ref={shortcutDialog} className="workflow-shortcut-help" aria-labelledby="workflow-shortcuts-title" onClose={() => { setShortcutHelp(false); canvasRoot.current?.focus(); }}><header><h2 id="workflow-shortcuts-title">{t('Canvas shortcuts','Pintasan kanvas')}</h2><button onClick={() => shortcutDialog.current?.close()} aria-label={t('Close','Tutup')}><X size={18}/></button></header><dl>{[['Ctrl/Cmd Z / Shift Z · Ctrl Y','Undo / Redo'],['Ctrl/Cmd X / C / V','Cut / Copy / Paste'],['Ctrl/Cmd D / A','Duplicate / Select all'],['Ctrl/Cmd G / Shift G','Group / Ungroup'],['Delete / Backspace','Delete selection'],['Arrow / Shift Arrow','Move 1 / 24 units'],['0 / Shift 0','Fit all / selection'],['Space + drag · Right/middle drag','Pan'],['Alt + drag','Temporarily disable snapping'],['?','Keyboard shortcuts']].map(([keys,action]) => <div key={keys}><dt>{keys}</dt><dd>{action}</dd></div>)}</dl><p>{t('Shortcuts apply to the focused canvas. Text and scientific editors keep their own controls.','Pintasan berlaku pada kanvas yang difokuskan. Teks dan editor ilmiah tetap memakai kontrolnya sendiri.')}</p></dialog>
    <dialog ref={runDialog} className="workflow-run-plan" aria-labelledby="workflow-run-title" onClose={() => setPlan(null)}><header><h2 id="workflow-run-title">{t('Review run', 'Tinjau eksekusi')}</h2><button onClick={() => runDialog.current?.close()} aria-label={t('Close', 'Tutup')}><X size={18} /></button></header>{plan && <>{reviewResourceNode && <><UiSelect label={t('Resources for module', 'Resource untuk modul')} value={reviewResourceNode.id} options={reviewResourceNodes.map(node => ({ value: node.id, label: node.name }))} onChange={setReviewResourceId} /><LabComputeDestination key={reviewResourceNode.id} scope="run" selection={workflowComputeSelection(reviewResourceNode)} onChange={selection => { changeRunCompute(selection, reviewResourceNode); const targets = plan.targets; runDialog.current?.close(); setPlan(null); void prepareRun(targets, rerun); }} requiredCapability={workloadForNode(reviewResourceNode)} sharedAvailable={workloadForNode(reviewResourceNode) === 'qe'} fixedTarget={workloadForNode(reviewResourceNode) === 'qe' ? undefined : 'personal'} /></>}<p>{t('Prerequisites are included once. Valid retained results are reused.', 'Prasyarat disertakan sekali. Hasil tersimpan yang valid digunakan ulang.')}</p><ol>{plan.nodes.map(item => <li key={item.nodeId}><span>{graph.nodes.find(node => node.id === item.nodeId)?.name}</span><small>{item.sourceScfNodeId && <span>{t('SCF source','Sumber SCF')}: {graph.nodes.find(node => node.id === item.sourceScfNodeId)?.name} · </span>}{item.error || (item.validationDeferred ? t('Validate geometry after prerequisite', 'Validasi geometri setelah prasyarat') : item.action)}</small>{graph.nodes.find(node => node.id === item.nodeId)?.kind === 'scf' && <button disabled={busy} aria-pressed={rerun.includes(item.nodeId)} onClick={() => { const targets = plan.targets, next = rerun.includes(item.nodeId) ? rerun.filter(id => id !== item.nodeId) : [...rerun, item.nodeId]; runDialog.current?.close(); void prepareRun(targets, next); }}>{rerun.includes(item.nodeId) ? t('Automatic reuse', 'Gunakan ulang otomatis') : t('Run fresh SCF', 'Jalankan SCF baru')}</button>}</li>)}</ol><p>{plan.compute.estimatedQuanta === 0 && !plan.compute.hasSharedCompute ? t('Your computer · 0 Quanta. Uses your local machine resources.', 'Komputer Anda · 0 Quanta. Memakai sumber daya komputer lokal.') : t(`Estimated ${plan.compute.estimatedQuanta ?? '—'} Quanta. Actual charges follow the selected profile and measured compute time. MD uses Your computer.`, `Perkiraan ${plan.compute.estimatedQuanta ?? '—'} Quanta. Biaya akhir mengikuti profil terpilih dan waktu compute terukur. MD memakai Komputer Anda.`)}</p><footer>{!!plan.errors.length && <button disabled={busy} onClick={() => { const targets = plan.targets; runDialog.current?.close(); setPlan(null); void prepareRun(targets, rerun); }}>{t('Refresh checks', 'Periksa ulang')}</button>}<button onClick={() => runDialog.current?.close()}>{t('Cancel', 'Batal')}</button><button className="workflow-primary" disabled={busy || !!plan.errors.length || client.getSnapshot().revision !== plan.revision} onClick={() => void submitRun()}><Play size={16} />{t('Start run', 'Mulai eksekusi')}</button></footer></>}</dialog>
    {showResearchContext && <ResearchContextPanel projectId={projectId} onClose={() => setShowResearchContext(false)} />}
    {showRuns && <aside className="workflow-run-history" aria-label={t('Run history', 'Histori eksekusi')}><header><strong>{t('Runs', 'Riwayat')}</strong><button onClick={() => setShowRuns(false)} aria-label={t('Close history', 'Tutup histori')}><X size={18} /></button></header>{!runs.length && <p>{t('No runs yet.', 'Belum ada eksekusi.')}</p>}{runs.map(run => <article key={run.id}><strong>{new Date(run.createdAt).toLocaleString()}</strong><small>{run.status}</small>{run.attempts.map(attempt => <div key={attempt.nodeId}><span>{graph.nodes.find(node => node.id === attempt.nodeId)?.name ?? attempt.nodeId}</span><small>{attempt.status}</small>{attempt.error && <p role="status">{attempt.error}</p>}{['running', 'queued', 'pending'].includes(attempt.status) && <button onClick={() => void projectWorkflowApi.cancel(projectId, run.id, [attempt.nodeId]).then(() => refreshRuns()).catch(failure => setMessage(failure.message))}>{t('Cancel branch', 'Batalkan cabang')}</button>}</div>)}{['running', 'pending'].includes(run.status) && <button onClick={() => void projectWorkflowApi.cancel(projectId, run.id).then(() => refreshRuns()).catch(failure => setMessage(failure.message))}>{t('Cancel run', 'Batalkan eksekusi')}</button>}</article>)}</aside>}
  </main>;
}

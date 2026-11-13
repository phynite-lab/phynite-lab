'use client';
import { AiMcpServersModal } from './AiMcpServersModal';
import { AiCustomSkillModal } from './AiCustomSkillModal';

import { matchesShortcut } from '@/lib/keyboard-preferences';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { ArrowDown, ArrowUp, LoaderCircle, BookOpen, FileSearch, FileText, ListChecks, ListEnd, CornerDownRight, Trash2, Paperclip, Pencil, Plus, ShieldCheck, Layers, Square, X } from 'lucide-react';
import { PhyniteAiIcon } from '@/app/tool-icons';
import Link from 'next/link';
import { createPortal } from 'react-dom';
import { useSession } from '@/app/use-session';
import { useLocale } from '@/app/locale-provider';
import { UiSelect } from './UiSelect';
import { AiArtifactViewer } from './AiArtifactViewer';
import { latestAiArtifacts } from '@/lib/ai-artifacts';
import { AiResponseContent } from './AiResponseContent';
import { aiModels, aiCapabilities, type AiProviderId, aiAttachmentLimits, defaultAiModel, defaultAiProvider, readSse, type AiAction, type AiAttachment, type AiEffort, type AiConversation, type AiDetail, type AiEvent, type AiModelId, type AiPermissionMode, type AiFailure } from '@/lib/ai-contract';
import { aiModelChoices, aiModelFamily, aiModelLabel } from '@/lib/ai-model-selection';
import { AiContextPicker, aiOverlayTheme, aiOverlayViewport, type AiContextPickerController } from './AiContextPicker';
import { AiModelSettings } from './AiModelSettings';
import { AiViewportConsent } from './AiViewportConsent';

import type { AiCanvasPreviewHandler } from '@/lib/workflow-auto-layout';
import { useAiComposerOverlayOwner } from './use-ai-overlay';
import { findAiCommandToken, replaceAiCommandToken, type AiCommandToken } from '@/lib/ai-composer-commands';
import { aiContextKey, isAiContextItem, type AiArtifact, type AiArtifactSummary, type AiContextItem, type AiTaskMode } from '@/lib/ai-workbench';
import type { AiSendPayload, AiSkillCatalogEntry, AiSkillRef, AiQueuedMessage } from '@/lib/ai-contract';
import { AiActionCard } from './AiActionCard';
import { AiAgentOperatorPanel } from './AiAgentOperatorPanel';
import { AiTurnStatus, AiOperationNotice } from './AiTurnStatus';
import { aiOperationFailure, aiRetryRunId, aiTurnSummary, aiNeedsTurnStatus, mergeAiHistory } from '@/lib/ai-turn-status';
import { aiLiteratureEvidence } from '@/lib/ai-evidence';
import { aiConversationInProject } from '@/lib/project-ai';
import { aiRunElapsedSeconds } from '@/lib/ai-run-time';
import { observeAiEvent } from '@/lib/ai-event-cursor';
import { acceptAiDetail, saveAiSettings } from '@/lib/ai-settings';
import { stopAiTurn } from '@/lib/ai-turn-control';
import { sha256 } from '@noble/hashes/sha2.js';
import '@/app/ai.css';

async function request<T>(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<T> {
  const result = await fetch(`/api/ai/${path}`, { method, cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await result.json() as T & { error?: string; code?: string; requestId?: string; issues?: AiFailure['issues'] };
  if (!result.ok) throw Object.assign(new Error(typeof data.error === 'string' ? data.error : 'The AI workspace request failed.'), { code: data.code, requestId: data.requestId, issues: data.issues });
  return data as T;
}
function safeUrl(raw: string): string | null {
  try { const url = new URL(raw, 'https://phynite.local'); return url.protocol === 'https:' && !url.username && !url.password ? raw : null; } catch { return null; }
}
function Evidence({ text }: { text: string }) {
  const { t } = useLocale();
  const value = aiLiteratureEvidence(text);
  if (value) return <div className="ai-paper-list"><strong><FileSearch size={14} />{t('Literature sources', 'Sumber literatur')}</strong>{value.papers.map((paper, i) => <a key={i} href={safeUrl(paper.url) ?? undefined} target="_blank" rel="noopener noreferrer"><span>{paper.title}</span><small>{paper.authors.slice(0, 2).join(', ')} · {paper.year || '—'} · {paper.source} · {paper.evidence === 'abstract' ? t('Abstract', 'Abstrak') : t('Metadata only', 'Metadata saja')}</small></a>)}{value.warnings.map(warning => <small key={warning}>{warning}</small>)}</div>;
  return <details className="ai-observation"><summary>{t('Recorded observation', 'Observasi tercatat')}</summary><pre>{text}</pre></details>;
}
function AiEvidenceOverlay({ ownerRef, anchorRef, portalOwner, onClose, children }: { ownerRef: RefObject<HTMLElement | null>; anchorRef: RefObject<HTMLButtonElement | null>; portalOwner: string; onClose: (restoreFocus?: boolean) => void; children: ReactNode }) {
  const { t } = useLocale(), root = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' });
  useLayoutEffect(() => {
    const owner = ownerRef.current, anchor = anchorRef.current;
    if (!owner || !anchor) return;
    const place = () => {
      const viewport = aiOverlayViewport(), bounds = owner.getBoundingClientRect(), button = anchor.getBoundingClientRect();
      const width = Math.max(0, Math.min(400, bounds.width - 24, viewport.right - viewport.left));
      setStyle({ ...aiOverlayTheme(owner), left: Math.max(viewport.left, Math.min(button.right - width, viewport.right - width)), top: viewport.top, width, maxHeight: Math.max(0, viewport.bottom - viewport.top), visibility: 'visible' });
    };
    place();
    const observer = new ResizeObserver(place); observer.observe(owner); observer.observe(anchor);
    const themeObserver = new MutationObserver(place); themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-workspace-theme', 'data-site-theme', 'class'] });
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true); window.visualViewport?.addEventListener('resize', place); window.visualViewport?.addEventListener('scroll', place);
    return () => { observer.disconnect(); themeObserver.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); window.visualViewport?.removeEventListener('resize', place); window.visualViewport?.removeEventListener('scroll', place); };
  }, [ownerRef, anchorRef]);
  useEffect(() => { if (style.visibility === 'visible') root.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true }); }, [style.visibility]);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node) && !anchorRef.current?.contains(event.target as Node)) onClose(false); };
    document.addEventListener('pointerdown', outside); return () => document.removeEventListener('pointerdown', outside);
  }, [anchorRef, onClose]);
  if (typeof document === 'undefined') return null;
  return createPortal(<div ref={root} className="ai-evidence-overlay ai-overlay" data-ui-owner={portalOwner} role="dialog" aria-label={t('Attached context', 'Konteks terlampir')} style={style} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } }} onBlur={event => { if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget) && !anchorRef.current?.contains(event.relatedTarget)) onClose(false); }}><header><strong>{t('Attached context', 'Konteks terlampir')}</strong><button type="button" aria-label={t('Close attached context', 'Tutup konteks terlampir')} onClick={() => onClose()}><X size={16} /></button></header><div className="ai-evidence-overlay-scroll">{children}</div></div>, document.body);
}
export type AiWorkspaceStatus = 'idle' | 'working' | 'approval' | 'error';
type AiWorkspaceProps = { onCanvasPreview?: AiCanvasPreviewHandler; projectId: string; legacyProjectId?: string; conversationId?: string; visible: boolean; onProjectChange: () => void; onConversationReady?: (id: string) => void; onConversationChange?: () => void; onStatusChange?: (status: AiWorkspaceStatus) => void; onShowCanvas?: (ids: string[]) => void; onOpenConversation?: () => void; savedContext?: boolean; contextRequest?: { nonce: number; items: AiContextItem[] }; composerOnly?: boolean };
type ComposerDraft = { text: string; files: LocalAttachment[]; contexts: AiContextItem[]; taskMode: AiTaskMode; sourcePlan?: string; skillRef: AiSkillRef | null };
type LocalAttachment = { key: string; filename: string; size: number; preview?: string; attachment?: AiAttachment; progress: number; error?: string };
type ModelCatalog = { background?: boolean; refreshing?: boolean; providers: Array<{ id: AiProviderId; configured: boolean; models: Array<{ id: AiModelId; label: string; capabilities: { efforts?: AiEffort[]; available?: boolean; images?: boolean; pdf?: boolean } }> }> };
export function AiWorkspace(props: AiWorkspaceProps) {
  const { session } = useSession();
  return session ? <AiWorkspaceOwner key={`${session.user.id}:${props.projectId}:${props.conversationId ?? 'legacy'}`} owner={session.user.id} {...props} /> : null;
}
function AiWorkspaceOwner({ owner, projectId, legacyProjectId, conversationId, visible, onProjectChange, onConversationReady, onConversationChange, onStatusChange, onShowCanvas, onOpenConversation, savedContext = true, contextRequest, composerOnly = false, onCanvasPreview }: AiWorkspaceProps & { owner: string }) {
  const { t, locale } = useLocale(), { session } = useSession(), inputId = useId();
  const localMode = session?.mode === 'local';
  const [detail, setDetail] = useState<AiDetail | null>(null), [text, setText] = useState(''), [streamText, setStreamText] = useState('');
  const [modelId, setModelId] = useState<AiModelId>(defaultAiModel), [mode, setMode] = useState<AiPermissionMode>('approval'), [effort, setEffort] = useState<AiEffort>('auto');
  const draftModel = useRef<{ id?: AiModelId; explicit: boolean }>({ explicit: false });
  const [skillManager, setSkillManager] = useState(false);
  const [mcpManager, setMcpManager] = useState(false);
  const [artifactId, setArtifactId] = useState<string>();
  const [multistage, setMultistage] = useState(false);
  const [taskMode, setTaskMode] = useState<AiTaskMode>('work'), [contexts, setContexts] = useState<AiContextItem[]>([]), [artifacts, setArtifacts] = useState<AiArtifactSummary[]>([]), [sourcePlan, setSourcePlan] = useState<string>();
  const [skills, setSkills] = useState<AiSkillCatalogEntry[]>([]), [skillRef, setSkillRef] = useState<AiSkillRef | null>(null);
  const [pickerView, setPickerView] = useState<'menu' | 'contexts' | 'commands' | 'mode'>('menu'), [commandToken, setCommandToken] = useState<AiCommandToken>();
  const pickerController = useRef<AiContextPickerController | null>(null), dismissedCommand = useRef<string | null>(null), composingInput = useRef(false), editBackup = useRef<ComposerDraft | null>(null);
  const [providerId, setProviderId] = useState<AiProviderId>(defaultAiProvider);
  const [providerReady, setProviderReady] = useState<Record<string, boolean>>({});
  const [providerModels, setProviderModels] = useState<Record<string, Array<{ id: AiModelId; label: string }>>>({ phynite: [...aiModels] });
  const [catalogRefreshing, setCatalogRefreshing] = useState(false);
  const [gatewayModels, setGatewayModels] = useState<Record<string, { efforts?: AiEffort[]; available?: boolean; images?: boolean; pdf?: boolean }>>({});
  const configured = Boolean(providerReady[providerId]) && (!localMode || gatewayModels[modelId]?.available === true);
  const [background, setBackground] = useState(false), [deciding, setDeciding] = useState(false);
  const foreground = useRef<AbortController | null>(null);
  const [loading, setLoading] = useState(true), [submitting, setSubmitting] = useState(false), [settingsBusy, setSettingsBusy] = useState(false);
  const [enqueueBusy, setEnqueueBusy] = useState(false);
  const [blockedQueue, setBlockedQueue] = useState('');
  const enqueueLock = useRef(false), pendingEnqueue = useRef<{ signature: string; id: string } | null>(null);
  const [files, setFiles] = useState<LocalAttachment[]>([]), [error, setOperationError] = useState<AiFailure | null>(null), [errorKind, setErrorKind] = useState<'request' | 'message' | 'settings' | 'queue' | 'action'>('request'), [activity, setActivity] = useState(''), [editing, setEditing] = useState<string | null>(null);
  const [connectionFailure, setConnectionFailure] = useState<AiFailure | null>(null), [recoveryBusy, setRecoveryBusy] = useState(false);
  const connectionEpoch = useRef(0), queueActionLocks = useRef(new Set<string>());
  const [queueActionBusy, setQueueActionBusy] = useState<string[]>([]);
  const [statusLookupFailure, setStatusLookupFailure] = useState<{ runId: string; failure: AiFailure } | null>(null);
  const recoveryLock = useRef(false), reviewRun = useRef<string | null>(null);
  const setError = useCallback((failure: unknown, kind: typeof errorKind = 'request') => { setOperationError(failure === '' || failure == null ? null : aiOperationFailure(failure)); setErrorKind(kind); }, []);
  const current = useRef<AiDetail | null>(null), mounted = useRef(true), cursor = useRef(''), lastErrorCursor = useRef(''), creating = useRef<Promise<AiConversation> | null>(null), stopRequested = useRef(false);
  const workspaceRoot = useRef<HTMLDivElement>(null), composerForm = useRef<HTMLFormElement>(null), toolbar = useRef<HTMLDivElement>(null), attachButton = useRef<HTMLButtonElement>(null), evidenceButton = useRef<HTMLButtonElement>(null);
  const [composerOverlay, setComposerOverlay] = useState<'context' | 'evidence' | 'model' | 'permissions' | 'discovery' | null>(null);
  const overlayInstance = useId(), activeOverlay = visible ? composerOverlay : null, picker = activeOverlay === 'context', evidenceOpen = activeOverlay === 'evidence';
  useEffect(() => { if (!visible) { let active = true; queueMicrotask(() => { if (active) setComposerOverlay(null); }); return () => { active = false; }; } }, [visible]);
  const setPicker = useCallback((open: boolean) => setComposerOverlay(current => open ? 'context' : current === 'context' ? null : current), []);
  const setEvidenceOpen = useCallback((open: boolean | ((current: boolean) => boolean)) => setComposerOverlay(current => (typeof open === 'function' ? open(current === 'evidence') : open) ? 'evidence' : current === 'evidence' ? null : current), []);
  useAiComposerOverlayOwner(overlayInstance, activeOverlay !== null, () => setComposerOverlay(null));
  const [composerSizing, setComposerSizing] = useState({ collapsed: false, evidenceLimit: 112, textareaLimit: 120 });
  const input = useRef<HTMLTextAreaElement>(null), fileInput = useRef<HTMLInputElement>(null), bottom = useRef<HTMLDivElement>(null), follow = useRef(true), previews = useRef<string[]>([]), notified = useRef(new Set<string>());
  const transcript = useRef<HTMLDivElement>(null);
  const transcriptTop = useRef(0);
  const [awayFromLatest, setAwayFromLatest] = useState(false);
  const callbacks = useRef({ onProjectChange, onConversationReady, onConversationChange, onStatusChange });
  useEffect(() => { callbacks.current = { onProjectChange, onConversationReady, onConversationChange, onStatusChange }; }, [onProjectChange, onConversationReady, onConversationChange, onStatusChange]);
  const active = Boolean(detail?.run && ['running', 'awaiting_approval'].includes(detail.run.status));
  const awaitingApproval = detail?.run?.status === 'awaiting_approval';
  const running = !awaitingApproval && (submitting || detail?.run?.status === 'running');
  const runId = active ? detail?.run?.id : undefined;
  const [workingClock, setWorkingClock] = useState({ now: 0, fallback: 0 });
  useEffect(() => {
    if (!running) return;
    let live = true;
    const fallback = Date.now();
    const tick = () => { if (live) setWorkingClock({ now: Date.now(), fallback }); };
    queueMicrotask(tick);
    const timer = setInterval(tick, 1000);
    return () => { live = false; clearInterval(timer); };
  }, [running, runId]);
  const workingSeconds = aiRunElapsedSeconds(runId, detail?.messages ?? [], workingClock.now, workingClock.fallback);
  const workingLabel = awaitingApproval ? t('Waiting for approval', 'Menunggu persetujuan') : t(`Working for ${Math.floor(workingSeconds / 60)}m ${workingSeconds % 60}s`, `Bekerja selama ${Math.floor(workingSeconds / 60)}m ${workingSeconds % 60}dtk`);
  const latestSavedRunId = detail?.run?.id ?? detail?.messages.at(-1)?.runId;
  const panelStatus: AiWorkspaceStatus = error || aiTurnSummary(detail, latestSavedRunId ?? '')?.status === 'failed' ? 'error' : detail?.run?.status === 'awaiting_approval' ? 'approval' : active || submitting ? 'working' : 'idle';
  useEffect(() => { callbacks.current.onStatusChange?.(panelStatus); }, [panelStatus]);
  const waiting = detail?.queue?.filter(message => message.status === 'queued') ?? [];
  const queuedFollowUps = active ? waiting.filter(message => message.id !== detail?.run?.queueId) : [];
  const canSendSaved = !editing && !active && !submitting && !recoveryBusy && waiting.length > 0 && (detail?.conversation.queuePaused || blockedQueue === waiting[0]?.id);
  const queueProgressing = waiting.length > 0 && !detail?.conversation.queuePaused && blockedQueue !== waiting[0]?.id;
  const locked = active || submitting || recoveryBusy || enqueueBusy || queueProgressing || settingsBusy || loading;
  const hasDraft = Boolean(text.trim() || files.length);
  // Keep Stop reserved for an already claimed/streaming turn. While the initial
  // inbox write is in flight there is no cancellable run yet, so exposing Stop
  // would leave a queued message behind after the user thinks they stopped it.
  const stopAction = !hasDraft && !editing && !enqueueBusy && (active || submitting);
  const selectionLocked = loading || submitting || settingsBusy || !background && active;
  const draftKey = `phynite:ai-draft:${owner}:${projectId}:${conversationId ?? 'new'}`;
  const rememberEnqueue = (value: typeof pendingEnqueue.current) => {
    pendingEnqueue.current = value;
    try { localStorage.setItem(draftKey, JSON.stringify({ ...JSON.parse(localStorage.getItem(draftKey) ?? '{}'), pendingEnqueue: value })); } catch { /* The server idempotency key remains available for this mounted draft. */ }
  };
  const applyDetail = useCallback((data: AiDetail) => {
    if (!mounted.current) return;
    if (!aiConversationInProject(data.conversation, projectId, legacyProjectId)) throw new Error(t('This conversation belongs to another project.', 'Percakapan ini milik project lain.'));
    if (!acceptAiDetail(current.current, data)) return;
    const merged = mergeAiHistory(current.current, data);
    current.current = merged; setDetail(merged); connectionEpoch.current++; setConnectionFailure(null);
    setStatusLookupFailure(previous => previous && aiNeedsTurnStatus(merged, previous.runId) ? previous : null); setModelId(data.conversation.modelId); setProviderId(data.conversation.providerId ?? 'phynite'); setMode(data.conversation.mode); setEffort(data.conversation.effort ?? 'auto');
    if (!foreground.current && (data.eventCursor ?? '') >= cursor.current) { cursor.current = data.eventCursor ?? ''; setStreamText(data.streamText ?? ''); }
    for (const action of data.actions) if (action.status === 'succeeded' && !notified.current.has(action.id)) { notified.current.add(action.id); if (!action.kind.startsWith('export')) callbacks.current.onProjectChange(); }
  }, [projectId, legacyProjectId, t]);
  const loadArtifact = useCallback(async (id: string) => { const conversation = current.current?.conversation.id; if (!conversation) throw new Error('Select a conversation first.'); return (await request<{ artifact: AiArtifact }>(`conversations/${conversation}/artifacts/${id}`)).artifact; }, []);
  const artifactEditApi = useMemo<import('./AiArtifactEditing').AiArtifactEditApi>(() => ({
    save: async edit => { const id = current.current?.conversation.id; if (!id) throw new Error('Select a conversation first.'); return (await request<{ artifact: AiArtifact }>(`conversations/${id}/artifact_edit`, edit)).artifact; },
    patches: async artifactId => { const id = current.current?.conversation.id; if (!id) return []; return (await request<{ proposals: import('@/lib/ai-workbench').AiArtifactPatch[] }>(`conversations/${id}/artifact_patches/${artifactId}`)).proposals; },
    decide: async (proposal, hunkId, decision, requestId) => { const id = current.current?.conversation.id; if (!id) throw new Error('Select a conversation first.'); return request(`conversations/${id}/artifact_decision`, { proposalId: proposal.id, baseRevision: proposal.revision, hunkId, decision, requestId }); },
  }), []);
  const artifactSaved = (artifact: AiArtifact) => { setArtifacts(items => [...items.filter(item => item.id !== artifact.id), artifact]); setArtifactId(artifact.id); };

  const load = useCallback(async (id: string) => { const data = await request<AiDetail>(`conversations/${id}`); applyDetail(data); return data; }, [applyDetail]);
  const refreshConnection = useCallback(async (id: string, signal?: AbortSignal) => {
    const epoch = connectionEpoch.current;
    try { return await load(id); }
    catch (failure) { if (mounted.current && !signal?.aborted && epoch === connectionEpoch.current) setConnectionFailure(aiOperationFailure(failure)); }
  }, [load]);
  useEffect(() => {
    mounted.current = true;
    const ownedPreviews = previews.current;
    void request<{ skills: AiSkillCatalogEntry[] }>('skills').then(data => { if (mounted.current) setSkills(data.skills); }).catch(() => { if (mounted.current) setSkills([]); });
    void (async () => {
      try {
        const catalog = await request<ModelCatalog>('models');
        if (!mounted.current) return;
        setCatalogRefreshing(Boolean(catalog.refreshing));
        setProviderReady(Object.fromEntries(catalog.providers.map(provider => [provider.id, provider.configured]))); setBackground(Boolean(catalog.background));
        setProviderModels(Object.fromEntries(catalog.providers.map(provider => [provider.id, provider.models])));
        setGatewayModels(Object.fromEntries(catalog.providers.flatMap(provider => provider.models.map(model => [model.id, model.capabilities]))));
        const localProvider = localMode ? catalog.providers.find(provider => provider.id === 'local') : undefined;
        const firstLocalModel = localProvider?.models.find(model => model.capabilities.available);
        if (localMode) {
          setProviderId('local');
          if (firstLocalModel) { draftModel.current.id = firstLocalModel.id; setModelId(firstLocalModel.id); setEffort(firstLocalModel.capabilities.efforts?.includes('auto') === false ? firstLocalModel.capabilities.efforts?.[0] ?? 'auto' : 'auto'); }
        }
        let id = conversationId;
        if (!id) {
          const query = new URLSearchParams(location.search).get('chat');
          const remembered = localStorage.getItem(`phynite:ai-current:${owner}:${projectId}`);
          const history = await request<{ conversations: AiConversation[] }>('conversations');
          id = history.conversations.find(item => item.id === (query ?? remembered) && aiConversationInProject(item, projectId, legacyProjectId))?.id;
        }
        let data: AiDetail | undefined;
        if (id) {
          data = await load(id);
          // Conversations created before the local provider existed may still
          // carry the hosted Phynite provider. Migrate that metadata to the
          // first discovered local model so a local workspace never attempts a
          // cloud AI request. An active turn is left untouched and will surface
          // its recorded state for the user to review.
          if (localMode && data.conversation.providerId === 'phynite' && firstLocalModel && !data.run) {
            const nextEffort = firstLocalModel.capabilities.efforts?.includes('auto') === false ? firstLocalModel.capabilities.efforts?.[0] ?? 'auto' : 'auto';
            try {
              await request(`conversations/${id}/settings`, { baseRevision: data.conversation.revision, modelId: firstLocalModel.id, providerId: 'local', mode: data.conversation.mode, effort: nextEffort }, 'PATCH');
              data = await load(id);
            } catch { /* The picker remains local and can retry after a concurrent update. */ }
          }
          callbacks.current.onConversationReady?.(id);
        }
        try {
          const draft = JSON.parse(localStorage.getItem(draftKey) ?? '{}') as { text?: string; attachmentIds?: string[]; contexts?: AiContextItem[]; taskMode?: AiTaskMode; sourcePlan?: string; skillRef?: AiSkillRef | null; pendingEnqueue?: { signature: string; id: string } };
          if (typeof draft.pendingEnqueue?.signature === 'string' && /^[A-Za-z0-9_-]{8,100}$/.test(draft.pendingEnqueue.id)) pendingEnqueue.current = draft.pendingEnqueue;
          if (typeof draft.text === 'string') setText(draft.text);
          if (Array.isArray(draft.contexts)) setContexts(draft.contexts.filter(isAiContextItem).slice(0, 16));
          if (['work', 'plan', 'research', 'summary'].includes(draft.taskMode ?? '')) setTaskMode(draft.taskMode!);
          if (draft.skillRef && typeof draft.skillRef.id === 'string' && Number.isSafeInteger(draft.skillRef.version) && draft.skillRef.version > 0) setSkillRef({ scope: draft.skillRef.scope, id: draft.skillRef.id, version: draft.skillRef.version });
          setSourcePlan(typeof draft.sourcePlan === 'string' && /^aid_[a-z0-9]+$/.test(draft.sourcePlan) ? draft.sourcePlan : undefined);
          if (data && Array.isArray(draft.attachmentIds)) setFiles((data.attachments ?? []).filter(a => draft.attachmentIds!.includes(a.id)).map(a => ({ key: a.id, filename: a.filename, size: a.sizeBytes, progress: 100, attachment: a })));
        } catch { /* A corrupt local draft cannot replace server history. */ }
      } catch (failure) { if (mounted.current) setError(failure); }
      finally { if (mounted.current) setLoading(false); }
    })();
    return () => { mounted.current = false; foreground.current?.abort(); for (const url of ownedPreviews) URL.revokeObjectURL(url); };
  }, [conversationId, owner, projectId, legacyProjectId, draftKey, load, localMode, setError]);
  useEffect(() => {
    if (!localMode || loading || !catalogRefreshing && activeOverlay !== 'model') return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const refreshCatalog = async () => {
      try {
        const catalog = await request<ModelCatalog>('models');
        if (cancelled) return;
        setProviderReady(Object.fromEntries(catalog.providers.map(provider => [provider.id, provider.configured])));
        setProviderModels(Object.fromEntries(catalog.providers.map(provider => [provider.id, provider.models])));
        setGatewayModels(Object.fromEntries(catalog.providers.flatMap(provider => provider.models.map(model => [model.id, model.capabilities]))));
        setCatalogRefreshing(Boolean(catalog.refreshing));
        // New chats can open before any check completes. Choose a ready
        // default when it arrives, preserving saved and deliberate choices.
        const models = catalog.providers.find(provider => provider.id === 'local')?.models ?? [];
        const first = models.find(model => model.capabilities.available);
        if (first && !current.current && !creating.current && !draftModel.current.explicit && !models.some(model => model.id === draftModel.current.id && model.capabilities.available)) {
          draftModel.current.id = first.id;
          setProviderId('local'); setModelId(first.id);
          setEffort(first.capabilities.efforts?.includes('auto') === false ? first.capabilities.efforts?.[0] ?? 'auto' : 'auto');
        }
      } catch { /* Retain known model choices during a transient bridge outage. */ }
      if (!cancelled) timer = setTimeout(() => void refreshCatalog(), 2000);
    };
    void refreshCatalog();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [localMode, loading, catalogRefreshing, activeOverlay]);
  useEffect(() => {
    if (!loading) { try { const draft = editing && editBackup.current ? editBackup.current : { text, files, contexts, taskMode, sourcePlan, skillRef }; localStorage.setItem(draftKey, JSON.stringify({ text: draft.text, contexts: draft.contexts, taskMode: draft.taskMode, sourcePlan: draft.sourcePlan, skillRef: draft.skillRef, pendingEnqueue: pendingEnqueue.current, attachmentIds: draft.files.flatMap(file => file.attachment ? [file.attachment.id] : []) })); } catch {} }
  }, [draftKey, loading, text, files, contexts, taskMode, sourcePlan, skillRef, editing]);
  const resizeInput = useCallback(() => {
    const element = input.current; if (!element) return;
    element.style.height = '44px';
    const maximum = parseFloat(getComputedStyle(element).maxHeight) || 120;
    element.style.height = `${Math.min(maximum, Math.max(44, element.scrollHeight))}px`;
  }, []);
  useLayoutEffect(resizeInput, [resizeInput, text, visible, composerOnly, composerSizing.textareaLimit]);
  useLayoutEffect(() => {
    const root = workspaceRoot.current, form = composerForm.current, controls = toolbar.current, owner = root?.closest<HTMLElement>('.workflow-ai-editor');
    if (!root || !form || !controls || !owner) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame); frame = requestAnimationFrame(() => {
        const viewport = aiOverlayViewport(), bounds = owner.getBoundingClientRect(), header = owner.querySelector('.ai-panel-header')?.getBoundingClientRect();
        const compactBounds = composerOnly && owner.hasAttribute('data-presentation') ? owner.closest('.workflow-panes')?.getBoundingClientRect() : undefined;
        // A compact panel has natural height; budget against its containing pane so
        // collapsing the tray cannot shrink its own capacity on the next measure.
        const capacity = compactBounds ?? bounds;
        const available = Math.max(0, Math.min(capacity.bottom, viewport.bottom) - Math.max(capacity.top, viewport.top) - (header?.height ?? 0) - (compactBounds ? 28 : 0));
        const composerStyle = getComputedStyle(form.parentElement!), formStyle = getComputedStyle(form), gap = parseFloat(formStyle.rowGap) || 0;
        const tray = form.querySelector('.ai-evidence-tray'), trayHeight = tray?.getBoundingClientRect().height ?? 0;
        const notices = root.querySelector('.ai-composer-notices')?.getBoundingClientRect().height ?? 0;
        const queue = root.querySelector('.ai-queue'), queueHeight = queue ? queue.getBoundingClientRect().height + (parseFloat(getComputedStyle(queue).marginBottom) || 0) : 0;
        const outside = ['paddingTop', 'paddingBottom', 'marginTop', 'marginBottom'].reduce((sum, key) => sum + (parseFloat(composerStyle[key as keyof CSSStyleDeclaration] as string) || 0), 0);
        const reserved = form.getBoundingClientRect().height - (input.current?.getBoundingClientRect().height ?? 44) - trayHeight - (tray ? gap : 0) + 44 + outside + notices + queueHeight;
        const free = available - reserved, hasEvidence = files.length + contexts.length + (sourcePlan ? 1 : 0) + (skillRef ? 1 : 0) > 0, collapsed = hasEvidence && free < 48 + gap;
        const evidenceLimit = Math.max(0, Math.min(bounds.width < 400 ? 96 : 112, free - gap));
        const textareaLimit = Math.max(44, Math.min(bounds.width < 400 ? 96 : 120, free + 44 - (hasEvidence && !collapsed ? evidenceLimit + gap : 0)));
        setComposerSizing(current => current.collapsed === collapsed && current.evidenceLimit === evidenceLimit && current.textareaLimit === textareaLimit ? current : { collapsed, evidenceLimit, textareaLimit });
        resizeInput();
      });
    };
    const observer = new ResizeObserver(measure); observer.observe(owner); observer.observe(root); observer.observe(controls); observer.observe(form);
    const panes = owner.closest('.workflow-panes'); if (panes) observer.observe(panes);
    const notices = root.querySelector('.ai-composer-notices'); if (notices) observer.observe(notices);
    const queue = root.querySelector('.ai-queue'); if (queue) observer.observe(queue);
    measure(); window.visualViewport?.addEventListener('resize', measure); window.visualViewport?.addEventListener('scroll', measure);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.visualViewport?.removeEventListener('resize', measure); window.visualViewport?.removeEventListener('scroll', measure); };
  }, [composerOnly, visible, active, submitting, files.length, contexts.length, sourcePlan, skillRef, error, queuedFollowUps.length, resizeInput]);
  useLayoutEffect(() => {
    const element = transcript.current;
    if (!visible || composerOnly || !element) return;
    const measure = () => {
      if (!element.clientHeight) return;
      if (follow.current) element.scrollTop = element.scrollHeight;
      else element.scrollTop = transcriptTop.current;
      setAwayFromLatest(element.scrollHeight - element.scrollTop - element.clientHeight >= 100);
    };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, [visible, composerOnly, streamText, detail?.messages.length, detail?.actions.length, detail?.run?.status, waiting.length]);
  useEffect(() => {
    const id = detail?.conversation.id; if (!id || !background) return;
    const abort = new AbortController(); let reconnect: ReturnType<typeof setTimeout> | undefined;
    const observe = async () => {
      const epoch = connectionEpoch.current;
      try {
        const response = await fetch(`/api/ai/conversations/${id}/events?after=${encodeURIComponent(cursor.current)}`, { signal: abort.signal, cache: 'no-store' });
        if (!response.ok) throw new Error(t('Could not reconnect to the saved conversation.', 'Belum dapat menyambung ke percakapan tersimpan.'));
        await readSse(response, raw => {
          const event = raw as AiEvent & { id?: string };
          if (!mounted.current) return;
          const identifiedFailure = event.type === 'error' && Boolean(event.runId && aiNeedsTurnStatus(current.current, event.runId));
          const checkpoint = observeAiEvent({ cursor: cursor.current, lastError: lastErrorCursor.current }, event, current.current?.run?.status === 'failed' || identifiedFailure);
          if (!checkpoint.apply) return;
          cursor.current = checkpoint.cursor; lastErrorCursor.current = checkpoint.lastError;
          if (event.type === 'response_start') { setStreamText(''); setActivity(t('Working on your research…', 'Mengerjakan riset Anda…')); }
          if (event.type === 'text') { setActivity(''); setStreamText(value => value + event.text); }
          if (event.type === 'activity') setActivity(event.text);
        if (event.type === 'artifact') setArtifacts(value => [...value.filter(a => a.id !== event.artifact.id), event.artifact]);
        if (event.type === 'ledger') setDetail(value => value && ({ ...value, conversation: { ...value.conversation, stateLedger: event.ledger } }));
          if (event.type === 'error' && event.code === 'AI_EVENTS_UNAVAILABLE' && epoch === connectionEpoch.current) setConnectionFailure(aiOperationFailure(event));
          if (event.type === 'error' && event.runId) {
            const failedRunId = event.runId, failure = aiOperationFailure(event);
            void refreshConnection(id, abort.signal).then(() => { if (!abort.signal.aborted && mounted.current && aiNeedsTurnStatus(current.current, failedRunId)) setStatusLookupFailure({ runId: failedRunId, failure }); });
          }
          if (['done', 'error', 'action', 'steering'].includes(event.type)) { void load(id).catch(() => undefined); callbacks.current.onConversationChange?.(); }
          if (event.type === 'done' || event.type === 'error') setActivity('');
        }, abort.signal);
      } catch (failure) { if (!abort.signal.aborted && mounted.current && epoch === connectionEpoch.current) setConnectionFailure(aiOperationFailure(failure)); }
      if (!abort.signal.aborted) reconnect = setTimeout(() => void observe(), 1500);
    };
    void observe();
    const poll = setInterval(() => void refreshConnection(id, abort.signal), 3000);
    return () => { abort.abort(); clearInterval(poll); clearTimeout(reconnect); }; // Closing a tab detaches only the observer.
  }, [background, detail?.conversation.id, load, refreshConnection, t]);
  useEffect(() => {
    const id = detail?.conversation.id;
    if (!id || background) return;
    const refresh = () => { void refreshConnection(id); };
    const poll = setInterval(refresh, 3000);
    window.addEventListener('focus', refresh);
    return () => { clearInterval(poll); window.removeEventListener('focus', refresh); };
  }, [background, detail?.conversation.id, refreshConnection]);
  const ensureConversation = useCallback(async () => {
    if (current.current) return current.current.conversation;
    if (!creating.current) creating.current = request<{ conversation: AiConversation }>('conversations', { projectKey: `project:${projectId}`, modelId, providerId, mode, effort }).then(async ({ conversation }) => {
      await load(conversation.id); localStorage.setItem(`phynite:ai-current:${owner}:${projectId}`, conversation.id); callbacks.current.onConversationChange?.(); return conversation;
    }).finally(() => { creating.current = null; });
    return creating.current;
  }, [projectId, owner, modelId, providerId, mode, effort, load]);
  const settings = async (nextModel: AiModelId, nextMode: AiPermissionMode, nextEffort: AiEffort, nextProvider: AiProviderId = providerId) => {
    if (nextModel !== modelId || nextProvider !== providerId || nextEffort !== effort) draftModel.current = { id: nextModel, explicit: true };
    setError('');
    if (!current.current) { setModelId(nextModel); setMode(nextMode); setEffort(nextEffort); setProviderId(nextProvider); return; }
    setSettingsBusy(true);
    try {
      const value = current.current.conversation, selected = { modelId: nextModel, providerId: nextProvider, mode: nextMode, effort: nextEffort };
      const conversation = await saveAiSettings(value, selected, async latest => (await request<{ conversation: AiConversation }>(`conversations/${latest.id}/settings`, { baseRevision: latest.revision, ...selected }, 'PATCH')).conversation, () => load(value.id));
      const snapshot = current.current;
      if (snapshot) applyDetail({ ...snapshot, conversation, run: conversation.activeRunId ? snapshot.run : null });
      await load(value.id);
    }
    catch (failure) { setError(failure, 'settings'); await load(current.current.conversation.id).catch(() => undefined); }
    finally { setSettingsBusy(false); }
  };
  const addFiles = async (incoming: File[]) => {
    if (!incoming.length) return;
    if (files.length + incoming.length > aiAttachmentLimits.count) { setError(t('Attach up to five files per message.', 'Lampirkan maksimal lima file per pesan.')); return; }
    const valid = incoming.filter(file => file.size > 0);
    if (valid.length !== incoming.length) { setError(t('Each file must contain data.', 'Setiap file harus berisi data.')); return; }
    const items = valid.map(file => { const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined; if (preview) previews.current.push(preview); return { key: crypto.randomUUID(), filename: file.name, size: file.size, preview, progress: 0 }; });
    setFiles(value => [...value, ...items]); setError('');
    const update = (key: string, patch: Partial<LocalAttachment>) => {
      if (!mounted.current) return;
      // Uploads belong to the saved draft even while a queued message is edited.
      if (editBackup.current) editBackup.current.files = editBackup.current.files.map(item => item.key === key ? { ...item, ...patch } : item);
      setFiles(value => value.map(item => item.key === key ? { ...item, ...patch } : item));
    };
    await Promise.all(valid.map(async (file, index) => {
      const key = items[index].key;
      try {
        const conversation = await ensureConversation();
        const hash = sha256.create();
        for (let offset = 0; offset < file.size; offset += 4 * 1024 ** 2) {
          hash.update(new Uint8Array(await file.slice(offset, Math.min(file.size, offset + 4 * 1024 ** 2)).arrayBuffer()));
          await new Promise(resolve => setTimeout(resolve, 0));
        }
        const checksum = Array.from(hash.digest(), byte => byte.toString(16).padStart(2, '0')).join('');
        const created = await request<{ attachment: AiAttachment }>(`conversations/${conversation.id}/attachments`, { filename: file.name, sizeBytes: file.size, sha256: checksum });
        const data = await new Promise<{ attachment: AiAttachment }>((resolve, reject) => {
          const upload = new XMLHttpRequest(); upload.open('PUT', `/api/ai/conversations/${conversation.id}/attachments/${created.attachment.id}/content`); upload.setRequestHeader('Content-Type', 'application/octet-stream');
          upload.upload.onprogress = event => { if (event.lengthComputable) update(key, { progress: Math.min(95, Math.round(event.loaded / event.total * 95)) }); };
          upload.onerror = () => reject(new Error(t('File upload failed. Remove it and try again.', 'Upload gagal. Hapus file ini dan coba lagi.')));
          upload.onload = () => { try { const value = JSON.parse(upload.responseText); if (upload.status < 200 || upload.status >= 300) reject(new Error(`${value.error ?? 'File upload failed.'} [${value.code ?? upload.status}]`)); else resolve(value); } catch { reject(new Error('The upload response could not be read.')); } };
          // Send the File directly so the browser and route do not duplicate
          // the entire source in an ArrayBuffer before streaming it upstream.
          upload.send(file);
        });
        update(key, { attachment: data.attachment, progress: 100 });
      } catch (failure) { update(key, { error: (failure as Error).message }); }
    }));
  };
  const streamForeground = useCallback(async (id: string, payload: AiSendPayload) => {
    if (foreground.current) return;
    const abort = new AbortController(); foreground.current = abort;
    let streamRunId = payload.resume ? payload.runId : undefined, streamFailure: AiFailure | undefined;
    setSubmitting(true); setStreamText(''); setActivity(t('Working on your research…', 'Mengerjakan riset Anda…'));
    try {
      const response = await fetch(`/api/ai/conversations/${id}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: abort.signal });
      if (!response.ok) {
        const failure = await response.json() as { error?: string; code?: string; requestId?: string; issues?: AiFailure['issues'] };
        throw Object.assign(new Error(failure.error ?? t('The AI request failed.', 'Permintaan AI gagal.')), { code: failure.code, requestId: failure.requestId, issues: failure.issues });
      }
      await readSse(response, raw => {
        if (!mounted.current) return;
        const event = raw as AiEvent;
        if (event.type === 'state') { streamRunId = event.detail.run?.id; applyDetail(event.detail); }
        if (event.type === 'response_start') setStreamText('');
        if (event.type === 'text') { setActivity(''); setStreamText(value => value + event.text); }
        if (event.type === 'activity') setActivity(event.text);
        if (event.type === 'artifact') setArtifacts(value => [...value.filter(a => a.id !== event.artifact.id), event.artifact]);
        if (event.type === 'ledger') setDetail(value => value && ({ ...value, conversation: { ...value.conversation, stateLedger: event.ledger } }));
        if (event.type === 'action') setDetail(value => value && ({ ...value, actions: [...value.actions.filter(action => action.id !== event.action.id), event.action] }));
        if (event.type === 'error') { streamRunId = event.runId ?? streamRunId; streamFailure = aiOperationFailure(event); }
      }, abort.signal);
    } catch (failure) {
      if (!abort.signal.aborted) {
        const code = (failure as { code?: string }).code;
        if (payload.queueId && !['AI_CONFLICT', 'AI_RUN_ACTIVE', 'AI_QUEUE_PAUSED'].includes(code ?? '')) setBlockedQueue(payload.queueId);
        throw failure;
      }
    } finally {
      if (mounted.current) {
        setActivity(''); setStreamText('');
        await refreshConnection(id, abort.signal);
        if (!abort.signal.aborted && mounted.current && streamFailure && streamRunId && aiNeedsTurnStatus(current.current, streamRunId)) setStatusLookupFailure({ runId: streamRunId, failure: streamFailure });
        callbacks.current.onConversationChange?.();
      }
      foreground.current = null;
      if (mounted.current) setSubmitting(false);
    }
  }, [applyDetail, refreshConnection, t]);
  const send = async () => {
    if (recoveryLock.current || recoveryBusy) return;
    if (!text.trim() && !files.length && canSendSaved && !enqueueLock.current && !loading && !settingsBusy && configured) {
      enqueueLock.current = true; setEnqueueBusy(true);
      try { await continueQueue(); }
      finally { enqueueLock.current = false; if (mounted.current) setEnqueueBusy(false); }
      return;
    }
    if ((!text.trim() && !files.length) || enqueueLock.current || loading || settingsBusy || !configured || files.some(file => !file.attachment || file.error)) return;
    const capability = gatewayModels[modelId];
    // PDFs are not gated here: without verified native PDF input, the turn reads their extracted text and states that limit.
    if (files.some(file => file.attachment?.mediaType.startsWith('image/')) && capability?.images === false) { setError(t('Image reading is not verified for this model. Choose another verified model.', 'Pembacaan gambar belum terverifikasi untuk model ini. Pilih model lain yang sudah terverifikasi.')); return; }
    const message = text.trim(), selected = files;
    const workbench = { executionMode: multistage ? 'multistage' : 'foreground', taskMode, contextRefs: contexts.map(item => item.ref), sourceArtifactId: sourcePlan, skillRef };
    if (skillRef && !skills.some(skill => skill.id === skillRef.id && skill.version === skillRef.version) && !editing) { setError(t('This skill version is unavailable. Choose the skill again or remove it; your draft is kept.', 'Versi skill ini tidak tersedia. Pilih ulang skill atau hapus; draf Anda tetap tersimpan.')); return; }
    if ((contexts.some(item => item.ref.kind !== 'attachment' && !(item.ref.kind === 'resource' && item.ref.resourceKind === 'file_snapshot')) || sourcePlan) && !savedContext) { setError(t('Save Canvas changes before sending selected context.', 'Simpan perubahan Kanvas sebelum mengirim konteks terpilih.')); return; } stopRequested.current = false; enqueueLock.current = true; setEnqueueBusy(true); setError(''); setText(''); setFiles([]); setContexts([]); setSourcePlan(undefined); follow.current = true;
    let accepted = false;
    try {
      const conversation = await ensureConversation();
      if (stopRequested.current) { setText(message); setFiles(selected); setContexts(contexts); setSourcePlan(sourcePlan); return; }
      const payload = { ...workbench, text: message, attachmentIds: selected.flatMap(file => file.attachment ? [file.attachment.id] : []) };
      if (editing) await request(`conversations/${conversation.id}/queue/${editing}`, { ...payload, baseRevision: waiting.find(item => item.id === editing)?.revision }, 'PATCH');
      else {
        const signature = JSON.stringify({ conversationId: conversation.id, ...payload });
        const pending = pendingEnqueue.current?.signature === signature ? pendingEnqueue.current : { signature, id: crypto.randomUUID() };
        rememberEnqueue(pending);
        await request(`conversations/${conversation.id}/queue`, { ...payload, clientMessageId: pending.id });
        rememberEnqueue(null);
      }
      accepted = true;
      if (!editing) setBlockedQueue('');
      if (editing && editBackup.current) { restoreDraft(editBackup.current); editBackup.current = null; }
      setEditing(null);
      const saved = await load(conversation.id);
      // A new send explicitly resumes an idle inbox left paused by Stop/failure.
      // Keep older follow-ups in FIFO order; only Retry repeats the failed turn.
      if (!editing && saved.conversation.queuePaused && !['running', 'awaiting_approval'].includes(saved.run?.status ?? '')) {
        await request(`conversations/${conversation.id}/continue`, {});
        setBlockedQueue(''); await load(conversation.id);
      }
      callbacks.current.onConversationChange?.();
      if (!conversationId) callbacks.current.onConversationReady?.(conversation.id);
    } catch (failure) { setError(failure, accepted ? 'request' : 'message'); if (!accepted) { setText(value => value ? `${message}\n${value}` : message); setFiles(value => [...selected, ...value]); setContexts(value => [...contexts, ...value].slice(0, 16)); setSourcePlan(sourcePlan); } }
    finally { enqueueLock.current = false; if (mounted.current) setEnqueueBusy(false); }
  };
  const stop = async () => { stopRequested.current = true; foreground.current?.abort(); const value = current.current; if (!value) return; try { await stopAiTurn(value.run, payload => request(`conversations/${value.conversation.id}/stop`, payload)); await load(value.conversation.id); } catch (failure) { setError(failure); } };
  const continueQueue = async (retryRunId?: string) => {
    if (!current.current || recoveryLock.current || retryRunId && enqueueLock.current) return;
    if (retryRunId && aiRetryRunId(current.current) !== retryRunId) return;
    recoveryLock.current = true; setRecoveryBusy(true);
    try { stopRequested.current = false; setBlockedQueue(''); const id = current.current.conversation.id; await request(`conversations/${id}/continue`, retryRunId ? { retryRunId } : {}); await load(id); setError(''); }
    catch (failure) { setError(failure, 'queue'); }
    finally { recoveryLock.current = false; if (mounted.current) setRecoveryBusy(false); }
  };
  const decide = async (action: AiAction, decision: 'approve' | 'reject') => {
    if (!detail || deciding) return;
    setDeciding(true);
    try {
      await request(`conversations/${detail.conversation.id}/actions/${action.id}`, { decision, payloadHash: action.payloadHash });
      const saved = await load(detail.conversation.id);
      if (!background && saved.run?.status === 'awaiting_approval' && !saved.actions.some(item => ['pending', 'executing'].includes(item.status))) await streamForeground(saved.conversation.id, { resume: true, runId: saved.run.id });
    } catch (failure) { setError(failure); }
    finally { setDeciding(false); }
  };
  const queueAction = async (id: string, steer = false) => {
    if (!detail || queueActionLocks.current.has(id)) return;
    queueActionLocks.current.add(id); setQueueActionBusy([...queueActionLocks.current]);
    try {
      await request(`conversations/${detail.conversation.id}/${steer ? 'steer' : 'queue'}/${id}`, {}, steer ? 'POST' : 'DELETE');
      const saved = await load(detail.conversation.id);
      if (steer && !background && !foreground.current && saved.run?.status === 'awaiting_approval' && !saved.actions.some(action => ['pending', 'executing'].includes(action.status))) await streamForeground(saved.conversation.id, { resume: true, runId: saved.run.id });
    }
    catch (failure) { setError(failure, 'action'); }
    finally { queueActionLocks.current.delete(id); if (mounted.current) setQueueActionBusy([...queueActionLocks.current]); }
  };
  const nextQueuedId = waiting[0]?.id;
  useEffect(() => {
    const id = detail?.conversation.id;
    if (background || loading || submitting || enqueueBusy || settingsBusy || editing || active || !configured || detail?.conversation.queuePaused || !id || !nextQueuedId || blockedQueue === nextQueuedId) return;
    const start = setTimeout(() => {
      if (!foreground.current && !stopRequested.current) void streamForeground(id, { queueId: nextQueuedId }).catch(failure => {
        // A second observer may win the same atomic claim. Reload its saved turn.
        if (!['AI_CONFLICT', 'AI_RUN_ACTIVE', 'AI_QUEUE_PAUSED'].includes(failure.code)) {
          const saved = current.current;
          if (saved?.run?.status === 'failed' && saved.run.queueId === nextQueuedId) return;
          if (saved?.run && ['running', 'awaiting_approval'].includes(saved.run.status)) setConnectionFailure(aiOperationFailure(failure));
          else { setBlockedQueue(nextQueuedId); setError(failure, 'queue'); }
        }
        void load(id).catch(() => undefined);
      });
    }, 0);
    return () => clearTimeout(start);
  }, [background, loading, submitting, enqueueBusy, settingsBusy, editing, active, configured, detail?.conversation.id, detail?.conversation.queuePaused, nextQueuedId, blockedQueue, streamForeground, load, setError]);
  useEffect(() => {
    const id = detail?.conversation.id; if (!id || active || submitting) return;
    let live = true; void request<{ artifacts: AiArtifactSummary[] }>(`conversations/${id}/artifacts`).then(data => { if (live) setArtifacts(data.artifacts); }).catch(() => undefined); return () => { live = false; };
  }, [detail?.conversation.id, detail?.run?.status, active, submitting]);
  useEffect(() => { let live = true; if (contextRequest) queueMicrotask(() => { if (live) setContexts(current => [...new Map([...current, ...contextRequest.items].map(item => [aiContextKey(item.ref), item])).values()].slice(0, 16)); }); return () => { live = false; }; }, [contextRequest]);
  const loadContexts = useCallback(async (nodeId?: string, query?: string) => { const conversation = await ensureConversation(); const params = new URLSearchParams(); if (nodeId) params.set('nodeId', nodeId); if (query) params.set('q', query); return request<{ items: AiContextItem[]; hasMore: boolean }>(`conversations/${conversation.id}/references?${params}`); }, [ensureConversation]);
  const closePicker = useCallback((restoreFocus = true) => {
    setPicker(false);
    if (pickerView === 'commands' && commandToken) dismissedCommand.current = JSON.stringify(commandToken);
    if (restoreFocus) (pickerView === 'commands' ? input.current : attachButton.current)?.focus({ preventScroll: true });
  }, [pickerView, commandToken, setPicker]);
  const openPicker = (view: typeof pickerView) => { setEvidenceOpen(false); setCommandToken(undefined); setPickerView(view); setPicker(true); };
  const finishPickerSelection = () => {
    if (pickerView === 'commands' && commandToken) {
      const replacement = replaceAiCommandToken(text, commandToken); setText(replacement.text); dismissedCommand.current = null;
      requestAnimationFrame(() => { input.current?.focus({ preventScroll: true }); input.current?.setSelectionRange(replacement.caret, replacement.caret); });
    } else input.current?.focus({ preventScroll: true });
    setPicker(false); setCommandToken(undefined);
  };
  const updateCommand = (value: string, caret: number, composing = false) => {
    const token = findAiCommandToken(value, caret, composing);
    if (token && dismissedCommand.current !== JSON.stringify(token)) { setCommandToken(token); setPickerView('commands'); setPicker(true); setEvidenceOpen(false); }
    else if (!token && pickerView === 'commands') { setPicker(false); setCommandToken(undefined); dismissedCommand.current = null; }
  };
  const restoreDraft = (draft: ComposerDraft) => { setText(draft.text); setFiles(draft.files); setContexts(draft.contexts); setTaskMode(draft.taskMode); setSourcePlan(draft.sourcePlan); setSkillRef(draft.skillRef); };
  const editQueued = (message: AiQueuedMessage) => {
    if (enqueueLock.current || editing) return;
    editBackup.current = { text, files, contexts, taskMode, sourcePlan, skillRef };
    setPicker(false); setEditing(message.id); setText(message.text); setTaskMode(message.taskMode ?? 'work'); setContexts((message.contextManifest ?? []).map(({ ref, label, detail }) => ({ ref, label, detail }))); setSourcePlan(message.sourceArtifactId); setSkillRef(message.skillSnapshot ? { scope: message.skillSnapshot.scope, id: message.skillSnapshot.id, version: message.skillSnapshot.version } : null);
    setFiles((detail?.attachments ?? []).filter(a => message.attachmentIds.includes(a.id)).map(a => ({ key: a.id, filename: a.filename, size: a.sizeBytes, progress: 100, attachment: a }))); input.current?.focus({ preventScroll: true });
  };
  const cancelEdit = () => { if (enqueueLock.current) return; if (editBackup.current) restoreDraft(editBackup.current); editBackup.current = null; setEditing(null); input.current?.focus({ preventScroll: true }); };
  const closeEvidence = useCallback((restoreFocus = true) => { setEvidenceOpen(false); if (restoreFocus) evidenceButton.current?.focus({ preventScroll: true }); }, [setEvidenceOpen]);
  const focusAfterEvidenceRemoval = (key: string, remaining: number) => {
    const surface = document.activeElement?.closest('.ai-evidence-overlay, .ai-evidence-tray'), buttons = Array.from(surface?.querySelectorAll<HTMLButtonElement>('[data-ai-evidence-remove]') ?? []);
    const index = buttons.findIndex(button => button.dataset.aiEvidenceRemove === key), next = buttons[index + 1]?.dataset.aiEvidenceRemove ?? buttons[index - 1]?.dataset.aiEvidenceRemove;
    requestAnimationFrame(() => {
      if (!remaining) { setEvidenceOpen(false); input.current?.focus({ preventScroll: true }); return; }
      const replacement = Array.from(surface?.querySelectorAll<HTMLButtonElement>('[data-ai-evidence-remove]') ?? []).find(button => button.dataset.aiEvidenceRemove === next);
      (replacement ?? surface?.querySelector<HTMLButtonElement>('button') ?? input.current)?.focus({ preventScroll: true });
    });
  };
  const removeFile = (key: string) => {
    const removed = files.find(file => file.key === key);
    focusAfterEvidenceRemoval(key, files.length - 1 + contexts.length + (sourcePlan ? 1 : 0) + (skillRef ? 1 : 0));
    if (removed?.preview) { URL.revokeObjectURL(removed.preview); previews.current = previews.current.filter(url => url !== removed.preview); }
    setFiles(value => value.filter(item => item.key !== key));
  };
  const reviewActions = (id: string) => { reviewRun.current = id; if (composerOnly) onOpenConversation?.(); else revealActions(id); };
  const revealActions = (id: string) => { const target = workspaceRoot.current?.querySelector<HTMLElement>(`[data-turn-actions="${id}"]`); if (target) { target.scrollIntoView({ block: 'nearest' }); target.focus({ preventScroll: true }); reviewRun.current = null; } };
  useLayoutEffect(() => { if (!composerOnly && reviewRun.current) revealActions(reviewRun.current); }, [composerOnly]);
  // Local bridge model IDs are intentionally provider-owned (codex/... and
  // agy/...). Pass the local flag through so the picker does not filter the
  // detected catalog as if it were a hosted/router provider.
  const choices = aiModelChoices(Object.entries(providerModels).map(([id, models]) => ({ id: id as AiProviderId, local: localMode, configured: Boolean(providerReady[id]), models: models.map(model => ({ ...model, capabilities: gatewayModels[model.id] ?? {} })) })));
  const choice = choices.find(item => item.value === `${providerId}:${aiModelFamily(modelId)}`);
  const modelLabel = (id: AiModelId) => aiModelLabel(id, Object.values(providerModels).flat().find(model => model.id === id)?.label ?? id);
  const availableEfforts = choice ? Object.keys(choice.models) as AiEffort[] : gatewayModels[modelId]?.efforts ?? aiCapabilities(modelId).efforts;
  const runs = [...new Set([...(detail?.messages.map(message => message.runId) ?? []), ...(detail?.run ? [detail.run.id] : [])])];
  const retryRunId = aiRetryRunId(detail);
  const latestRunId = detail?.run?.id ?? runs.at(-1);
  const portalOwner = conversationId ? `tool:ai:${conversationId}` : 'tool:ai', evidenceCount = files.length + contexts.length + (sourcePlan ? 1 : 0) + (skillRef ? 1 : 0);
  const selectedSkill = skillRef ? skills.find(skill => skill.id === skillRef.id && skill.version === skillRef.version) : undefined;
  const skillLabel = selectedSkill?.label[locale] ?? (skillRef ? `/${skillRef.id}` : '');
  const evidenceContents = <>{!!files.length && <div className="ai-attachments">{files.map(file => {
    const preview = file.preview ?? (file.attachment?.mediaType.startsWith('image/') && detail ? `/api/ai/conversations/${detail.conversation.id}/attachments/${file.attachment.id}/content` : undefined);
    return <div className="ai-attachment" key={file.key} data-image={!!preview} data-error={!!file.error}>
      {preview ?
        // eslint-disable-next-line @next/next/no-img-element -- Local blob previews cannot use a server image optimizer.
        <img src={preview} alt={file.filename} width={72} height={72} loading="lazy" decoding="async" />
        : <FileText size={22} aria-hidden="true" />}
      <span title={file.filename}>{file.filename}<small>{file.error ?? (file.attachment ? `${Math.ceil(file.size / 1024)} KB` : t(`Uploading ${file.progress}%…`, `Mengunggah ${file.progress}%…`))}</small>{!!file.attachment?.warnings?.length && <details className="ai-file-warning"><summary>{t('Reading limits', 'Batas pembacaan')}</summary>{file.attachment.warnings.map(warning => <p key={warning}>{warning}</p>)}</details>}</span>
      <button type="button" aria-label={t(`Remove ${file.filename}`, `Hapus ${file.filename}`)} data-ai-attachment-remove={file.key} data-ai-evidence-remove={file.key} onClick={() => removeFile(file.key)}><X size={14} /></button>
    </div>;
  })}</div>}
    {(contexts.length > 0 || sourcePlan || skillRef) && <div className="ai-context-chips">{skillRef && <span className="ai-skill-chip" data-unavailable={!selectedSkill || undefined} title={selectedSkill?.description[locale] ?? t('Choose this skill again or remove it to continue.', 'Pilih ulang atau hapus skill ini untuk melanjutkan.')}><PhyniteAiIcon size={13} aria-hidden="true" /><span>{skillLabel}</span><button type="button" aria-label={t('Remove skill', 'Hapus skill')} data-ai-evidence-remove="skill" onClick={() => { focusAfterEvidenceRemoval('skill', evidenceCount - 1); setSkillRef(null); }}><X size={13} /></button></span>}{sourcePlan && <span><ListChecks size={13} />{t('Selected plan', 'Rencana terpilih')}<button type="button" data-ai-evidence-remove="plan" onClick={() => { focusAfterEvidenceRemoval('plan', evidenceCount - 1); setSourcePlan(undefined); }} aria-label={t('Remove plan', 'Hapus rencana')}><X size={13} /></button></span>}{contexts.map(item => <span key={aiContextKey(item.ref)}><button type="button" onClick={() => { if (['node', 'field', 'atom', 'edge'].includes(item.ref.kind)) onShowCanvas?.([item.ref.id]); }} title={JSON.stringify(item.ref)}>{item.label}</button><button type="button" aria-label={t(`Remove context ${item.label}`, `Hapus konteks ${item.label}`)} data-ai-evidence-remove={aiContextKey(item.ref)} onClick={() => { focusAfterEvidenceRemoval(aiContextKey(item.ref), evidenceCount - 1); setContexts(value => value.filter(other => aiContextKey(other.ref) !== aiContextKey(item.ref))); }}><X size={13} /></button></span>)}</div>}
  </>;
  return <div ref={workspaceRoot} className="ai-workspace" data-composer-only={composerOnly} data-evidence-collapsed={composerSizing.collapsed && evidenceCount > 0} style={{ '--ai-evidence-limit': `${composerSizing.evidenceLimit}px`, '--ai-textarea-limit': `${composerSizing.textareaLimit}px` } as CSSProperties} onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }} onDrop={event => { if (event.dataTransfer.files.length) { event.preventDefault(); event.stopPropagation(); void addFiles(Array.from(event.dataTransfer.files)); } }}>
    {mcpManager && <AiMcpServersModal request={request} onClose={() => setMcpManager(false)} />}
    {skillManager && <AiCustomSkillModal request={request} onClose={() => setSkillManager(false)} onChange={() => { void request<{ skills: AiSkillCatalogEntry[] }>("skills").then(data => setSkills(data.skills)).catch(failure => setError(failure)); }} />}
    <div className="ai-transcript-viewport" hidden={composerOnly}><div ref={transcript} className="ai-transcript" role="log" aria-label={t('Research conversation', 'Percakapan riset')} aria-busy={active} onScroll={event => { const element = event.currentTarget; if (!visible || composerOnly || !element.clientHeight) return; transcriptTop.current = element.scrollTop; follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 100; setAwayFromLatest(!follow.current); }}>
      {loading && <p role="status">{t('Loading your research conversation…', 'Memuat percakapan riset…')}</p>}
      {!loading && !detail?.messages.length && <section className="ai-welcome"><span className="ai-welcome-mark"><PhyniteAiIcon size={26} /></span><h1>{t('What are we investigating?', 'Apa yang kita teliti?')}</h1><p>{t('Bring a paper, a dataset, or a question. Work through it with your project.', 'Bawa paper, dataset, atau pertanyaan. Telusuri bersama data project Anda.')}</p><div>{[t('Review my Canvas and suggest the next step.', 'Tinjau Kanvas dan sarankan langkah berikutnya.'), t('Help me set up a strain study.', 'Bantu siapkan studi strain.'), t('Find papers on thermoelectric materials.', 'Cari paper tentang material termoelektrik.')].map(prompt => <button key={prompt} onClick={() => { setText(prompt); input.current?.focus(); }}>{prompt}<ArrowUp size={14} /></button>)}</div></section>}
      {detail?.hasOlderMessages && <button className="ai-text-button" onClick={() => { void request<AiDetail>(`conversations/${detail.conversation.id}?before=${encodeURIComponent(detail.before ?? '')}`).then(older => { const value = current.current; if (!value) return; const merged = mergeAiHistory(older, value); const next = { ...merged, hasOlderMessages: older.hasOlderMessages, before: older.before }; current.current = next; setDetail(next); }).catch(failure => setError(failure)); }}>{t('Load earlier messages', 'Muat pesan sebelumnya')}</button>}
      {runs.map(runId => <section className="ai-turn" key={runId}>{detail?.messages.filter(message => message.runId === runId).map(message => message.role === 'tool' ? <Evidence key={message.id} text={message.text} /> : <article className={`ai-message ai-message-${message.role}`} key={message.id}><header>{message.role === 'user' ? t('You', 'Anda') : 'Phynite AI'}{message.role === 'user' && message.taskMode && message.taskMode !== 'work' && <small>{message.taskMode}</small>}{message.role === 'user' && message.skillSnapshot && <small>{message.skillSnapshot.label}</small>}{message.steering && <small>{t('Direction', 'Arahan')}</small>}</header><AiResponseContent text={message.text} />{!!message.contextManifest?.length && <div className="ai-context-chips">{message.contextManifest.map(item => <button key={item.sourceId} type="button" title={`${item.sha256} · ${JSON.stringify(item.ref)}`} onClick={() => { if (['node', 'field', 'atom', 'edge'].includes(item.ref.kind)) onShowCanvas?.([item.ref.id]); }}>{item.sourceId} · {item.label}</button>)}</div>}{!!message.attachmentIds?.length && <div className="ai-message-files">{message.attachmentIds.map(id => <a key={id} href={`/api/ai/conversations/${detail.conversation.id}/attachments/${id}/content`} target="_blank" rel="noopener noreferrer"><Paperclip size={14} />{detail.attachments?.find(file => file.id === id)?.filename ?? t('Attachment', 'Lampiran')}</a>)}{message.attachmentIds.map(id => { const file = detail.attachments?.find(file => file.id === id); return file?.warnings?.length ? <details className="ai-file-warning" key={`${id}:limits`}><summary>{file.filename} · {t('Reading limits', 'Batas pembacaan')}</summary>{file.warnings.map(warning => <p key={warning}>{warning}</p>)}</details> : null; })}</div>}</article>)}{detail?.actions.some(action => action.runId === runId) && <div data-turn-actions={runId} tabIndex={-1}>{detail.actions.filter(action => action.runId === runId).map(action => <AiActionCard key={action.id} action={action} conversationId={detail.conversation.id} locked={deciding || submitting} onDecision={decide} onCanvas={onShowCanvas} onCanvasPreview={onCanvasPreview} />)}</div>}{latestAiArtifacts(artifacts).filter(artifact => (artifacts.find(item => (item.artifactGroupId ?? item.id) === (artifact.artifactGroupId ?? artifact.id))?.runId ?? artifact.runId) === runId).map(artifact => <button type="button" key={artifact.artifactGroupId ?? artifact.id} className="ai-artifact-card" onClick={() => setArtifactId(artifact.id)}><BookOpen size={19} /><span><strong>{artifact.title ?? (artifact.kind === 'plan' ? t('Research plan', 'Rencana riset') : t('Research artifact', 'Artifact riset'))}</strong><small>{artifact.kind} · v{artifact.version ?? 1} · {artifact.status}</small></span><span aria-hidden="true">↗</span></button>)}{!composerOnly && <AiTurnStatus runId={runId} summary={aiTurnSummary(detail, runId)} compact={false} latest={runId === latestRunId} busy={recoveryBusy || submitting || enqueueBusy} retry={retryRunId === runId ? () => void continueQueue(runId) : undefined} appliedCount={detail?.actions.filter(action => action.runId === runId && action.status === 'succeeded').length} onReview={() => reviewActions(runId)} />}</section>)}
      {streamText && <article className="ai-message ai-message-assistant"><header>Phynite AI</header><AiResponseContent text={streamText} /></article>}
      <div ref={bottom} />
    </div>
    {awayFromLatest && <button type="button" className="ai-jump-latest" aria-label={t('Jump to latest message', 'Ke pesan terbaru')} title={t('Jump to latest message', 'Ke pesan terbaru')} onClick={() => { follow.current = true; if (transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight; setAwayFromLatest(false); }}><ArrowDown size={19} /></button>}
    {artifactId && <AiArtifactViewer editApi={artifactEditApi} onSaved={artifactSaved} locked={locked} summaries={artifacts} selected={artifactId} load={loadArtifact} onSelect={setArtifactId} onClose={() => setArtifactId(undefined)} onContinue={artifact => { setTaskMode('research'); setText(`Read artifact ${artifact.id} using read_artifact and continue the documented gaps. Cite actual new evidence.`); setArtifactId(undefined); input.current?.focus(); }} onImplement={artifact => { setSourcePlan(artifact.id); setTaskMode('work'); setText(t('Implement this plan. Validate the saved inputs and ask about missing scientific choices before changing anything.', 'Terapkan rencana ini. Validasi input tersimpan dan tanyakan pilihan ilmiah yang belum lengkap sebelum mengubah data.')); setArtifactId(undefined); input.current?.focus(); }} />}</div>
    <div className="ai-composer">
      <div className="ai-composer-notices">
    {!loading && !configured && <div className="ai-notice" role="status">{localMode ? <>{providerReady.local ? t('Choose an available model to continue. Your draft stays saved.', 'Pilih model yang tersedia untuk melanjutkan. Draf Anda tetap tersimpan.') : catalogRefreshing ? t('Checking your models. They will appear automatically when ready.', 'Memeriksa model Anda. Model akan muncul otomatis setelah siap.') : t('Sign in with Codex or Antigravity in AI provider settings; models connect automatically.', 'Login dengan Codex atau Antigravity di pengaturan provider AI; model tersambung otomatis.')} <Link href="/account/ai-providers">{t('Open AI provider settings', 'Buka pengaturan provider AI')}</Link></> : t('The selected AI source is not connected yet. Choose another model; your draft stays saved here.', 'Sumber AI terpilih belum terhubung. Pilih model lain; draf Anda tetap tersimpan di sini.')}</div>}
      {!background && detail?.run?.status === 'awaiting_approval' && !detail.actions.some(action => ['pending', 'executing'].includes(action.status)) && <div className="ai-editing"><span>{t('The action is recorded. Continue the response.', 'Aksi sudah tercatat. Lanjutkan respons.')}</span><button disabled={submitting} onClick={() => { void streamForeground(detail.conversation.id, { resume: true, runId: detail.run!.id }).catch(failure => { if (current.current?.run?.status !== 'failed') setError(failure); }); }}>{t('Continue response', 'Lanjutkan respons')}</button></div>}
      </div>
      {!!queuedFollowUps.length && <section className="ai-queue" aria-label={t('Message queue', 'Antrean pesan')}>{queuedFollowUps.map(message => <div key={message.id}><ListEnd className="ai-queue-mark" size={15} aria-hidden="true" /><span>{message.text || t('Attached research files', 'Lampiran riset')}{message.attachmentIds.length > 0 && <small> · {message.attachmentIds.length} <Paperclip size={12} /></small>}</span><button disabled={!!editing || enqueueBusy || queueActionBusy.includes(message.id)} title={t('Edit queued message', 'Edit pesan antrean')} aria-label={t('Edit queued message', 'Edit pesan antrean')} onClick={() => editQueued(message)}><Pencil size={14} /></button><button className="ai-steer" disabled={queueActionBusy.includes(message.id)} aria-label={t('Steer now', 'Arahkan sekarang')} onClick={() => void queueAction(message.id, true)}><CornerDownRight size={14} />{t('Steer', 'Arahkan')}</button><button disabled={queueActionBusy.includes(message.id)} aria-label={t('Cancel queued message', 'Batalkan pesan antrean')} title={t('Cancel queued message', 'Batalkan pesan antrean')} onClick={() => void queueAction(message.id)}><Trash2 size={14} /></button></div>)}</section>}
      <form ref={composerForm} onSubmit={event => { event.preventDefault(); void send(); }} className="ai-composer-box">
        <div className="ai-composer-statuses">{composerOnly && latestRunId && <AiTurnStatus runId={latestRunId} summary={aiTurnSummary(detail, latestRunId)} compact={true} latest busy={recoveryBusy || submitting || enqueueBusy} retry={retryRunId === latestRunId ? () => void continueQueue(latestRunId) : undefined} appliedCount={detail?.actions.filter(action => action.runId === latestRunId && action.status === 'succeeded').length} onReview={onOpenConversation ? () => reviewActions(latestRunId) : undefined} />}
        {error && <AiOperationNotice failure={error} title={errorKind === 'message' ? t('Message not saved', 'Pesan belum tersimpan') : errorKind === 'settings' ? t('Settings not updated', 'Pengaturan belum diperbarui') : errorKind === 'queue' ? t('Message could not start', 'Pesan belum dapat diproses') : t('Request not completed', 'Permintaan belum selesai')} action={errorKind === 'queue' && blockedQueue ? t('Retry message', 'Coba ulang pesan') : errorKind === 'message' ? undefined : t('Refresh conversation', 'Muat ulang percakapan')} busy={recoveryBusy || enqueueBusy || submitting} onAction={errorKind === 'queue' && blockedQueue ? () => void continueQueue() : () => { const id = detail?.conversation.id ?? conversationId; setError(''); if (id) void load(id).catch(failure => setError(failure)); else window.location.reload(); }} />}
        {statusLookupFailure && statusLookupFailure.runId === latestSavedRunId && !error && <AiOperationNotice failure={{ ...statusLookupFailure.failure, message: t('The AI reported a problem, but its final saved status is not available yet. Refresh the conversation before retrying.', 'AI melaporkan kendala, tetapi status akhir tersimpannya belum tersedia. Muat ulang percakapan sebelum mencoba lagi.') }} title={t('Response status unavailable', 'Status respons belum tersedia')} connection action={t('Refresh conversation', 'Muat ulang percakapan')} onAction={() => { if (detail) void refreshConnection(detail.conversation.id); }} />}
        {connectionFailure && !statusLookupFailure && !error && <AiOperationNotice failure={{ ...connectionFailure, message: t('The connection was interrupted. Reconnect to retrieve the saved conversation.', 'Koneksi terputus. Sambungkan ulang untuk memuat percakapan tersimpan.') }} title={t('Connection interrupted', 'Koneksi terputus')} connection action={t('Reconnect', 'Sambungkan ulang')} onAction={() => { if (detail) void refreshConnection(detail.conversation.id); }} />}
        {!active && !submitting && waiting.length > 0 && detail?.conversation.queuePaused && <div className="ai-paused-queue" role="status"><span>{t(`${waiting.length} ${waiting.length === 1 ? 'message' : 'messages'} waiting`, `${waiting.length} pesan menunggu`)}</span><button type="button" disabled={recoveryBusy || enqueueBusy} onClick={() => void continueQueue()}>{t('Continue queue', 'Lanjutkan antrean')}</button></div>}</div>
        {picker && <AiContextPicker anchorRef={attachButton} portalOwner={portalOwner} controllerRef={pickerController} initialView={pickerView} commandToken={commandToken} skills={skills} skillRef={skillRef} onManageMcp={() => { closePicker(false); setMcpManager(true); }} onManageSkills={() => { closePicker(false); setSkillManager(true); }} onSkill={ref => { setSkillRef(ref); finishPickerSelection(); }} taskMode={taskMode} taskLocked={selectionLocked} onTask={task => { setTaskMode(task); if (task === 'summary' && !text) setText(t('Summarize our goal, decisions, completed actions, evidence and next steps.', 'Ringkas tujuan, keputusan, aksi yang selesai, bukti, dan langkah berikutnya.')); finishPickerSelection(); }} load={loadContexts} saved={savedContext} onClose={closePicker} onFiles={() => { closePicker(false); fileInput.current?.click(); }} onSelect={item => { if (contexts.length >= 16) { setError(t('Select at most 16 sources.', 'Pilih maksimal 16 sumber.')); return; } setContexts(current => [...new Map([...current, item].map(value => [aiContextKey(value.ref), value])).values()]); finishPickerSelection(); }} />}
        {evidenceCount > 0 && !composerSizing.collapsed && <div className="ai-evidence-tray" role="region" aria-label={t('Attached context', 'Konteks terlampir')} tabIndex={0}>{evidenceContents}</div>}
        {evidenceCount > 0 && composerSizing.collapsed && <button ref={evidenceButton} type="button" className="ai-evidence-count" aria-label={t(`Review ${evidenceCount} attached sources`, `Tinjau ${evidenceCount} sumber terlampir`)} aria-expanded={evidenceOpen} onClick={() => { setPicker(false); setEvidenceOpen(value => !value); }}><Paperclip size={13} />{evidenceCount}</button>}
        {evidenceCount > 0 && composerSizing.collapsed && evidenceOpen && <AiEvidenceOverlay ownerRef={workspaceRoot} anchorRef={evidenceButton} portalOwner={portalOwner} onClose={closeEvidence}>{evidenceContents}</AiEvidenceOverlay>}
        {editing && <div className="ai-editing">{t('Editing queued message', 'Mengedit pesan antrean')}<button type="button" disabled={enqueueBusy} onClick={cancelEdit}>{t('Cancel edit', 'Batalkan edit')}</button></div>}
        <label className="sr-only" htmlFor={inputId}>{t('Message Phynite AI', 'Pesan untuk Phynite AI')}</label>
        {(active || submitting) && <div className={`ai-working-time`} role="status" aria-label={awaitingApproval ? t('Waiting for approval', 'Menunggu persetujuan') : t('AI is working', 'AI sedang bekerja')} data-elapsed-seconds={workingSeconds}>{running && <LoaderCircle size={14} aria-hidden="true" />}<span aria-live="off">{workingLabel}</span>{running && activity && <small>{activity}</small>}</div>}
        <textarea ref={input} id={inputId} value={text} maxLength={12000} disabled={loading} placeholder={t('Work with Phynite AI…', 'Riset bersama Phynite AI…')} onChange={event => { const value = event.target.value; setText(value); updateCommand(value, event.target.selectionStart, composingInput.current); }} onSelect={event => { if (document.activeElement === event.currentTarget) updateCommand(event.currentTarget.value, event.currentTarget.selectionStart, composingInput.current); }} onCompositionStart={() => { composingInput.current = true; }} onCompositionEnd={event => { composingInput.current = false; updateCommand(event.currentTarget.value, event.currentTarget.selectionStart); }} onPaste={event => { const images = Array.from(event.clipboardData.files).filter(file => file.type.startsWith('image/')); if (images.length) { event.preventDefault(); void addFiles(images); } }} onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (picker && pickerView === 'commands' && pickerController.current?.handleKeyDown(event)) return;
          if (event.key === '@' && /(^|\s)$/.test(event.currentTarget.value.slice(0, event.currentTarget.selectionStart))) { event.preventDefault(); openPicker('contexts'); return; }
          if (matchesShortcut(event, 'send-message')) { event.preventDefault(); void send(); }
        }} />
        <div ref={toolbar} className="ai-composer-toolbar"><div className="ai-toolbar-context"><input ref={fileInput} type="file" multiple hidden accept=".png,.jpg,.jpeg,.webp,.gif,.pdf,.docx,.xlsx,.csv,.tsv,.txt,.md,.markdown,.log,.out,.in,.inp,.cif,.xyz,.poscar,.contcar,.xsf,.json,.yaml,.yml,.dat,.upf,.lmp,.lammps,.py,.ipynb,.tex,.bib,.xml,.html,.htm,.toml,.ini,.cfg,.conf,.sh,.f90,.f,.c,.cpp,.h,.hpp,.r,.jl,.sql,.js,.ts,.rst" onChange={event => { void addFiles(Array.from(event.target.files ?? [])); event.target.value = ''; }} /><button ref={attachButton} type="button" className="ai-attach-button" disabled={loading} onClick={() => { if (picker) closePicker(); else openPicker('menu'); }} aria-expanded={picker} aria-label={t('Add context', 'Tambah konteks')} title={t('Add files, modes, skills or context (/)', 'Tambah file, mode, skill atau konteks (/)')}><Plus size={22} /></button>
          <AiAgentOperatorPanel disabled={selectionLocked} open={activeOverlay === 'discovery'} portalOwner={portalOwner} onOpenChange={open => setComposerOverlay(current => open ? 'discovery' : current === 'discovery' ? null : current)} onPreset={prompt => { setTaskMode('plan'); setText(prompt); input.current?.focus(); }} />
          <AiViewportConsent key={detail?.conversation.id ?? 'new'} owner={owner} conversationId={detail?.conversation.id} visible={visible} ensureConversation={ensureConversation} /><button type="button" className="ai-task-chip ai-toolbar-toggle" aria-label={t('Multistage research', 'Riset multitahap')} aria-pressed={multistage} title={`${multistage ? t('Multistage', 'Multitahap') : t('Short turn', 'Giliran singkat')} · ${t("Up to 40 tools / 30 rounds. Keep this tab open; checkpoints are saved. Jobs are checked on demand.", "Maksimal 40 tool / 30 putaran. Biarkan tab terbuka; checkpoint disimpan. Job dicek saat diminta.")}`} disabled={selectionLocked} onClick={() => setMultistage(value => !value)}><Layers size={17} aria-hidden="true" /></button><div className="ai-composer-permissions"><UiSelect compact portalOwner={portalOwner} open={activeOverlay === 'permissions'} onOpenChange={open => { if (open) { closePicker(false); setComposerOverlay('permissions'); } else setComposerOverlay(current => current === 'permissions' ? null : current); }} ariaLabel={t('AI permissions', 'Izin AI')} value={mode} displayValue={<span className="ai-permission-value"><ShieldCheck size={16} aria-hidden="true" /><span>{({ chat: t('Chat only', 'Chat saja'), approval: t('Ask for approval', 'Minta persetujuan'), full: t('Full access', 'Akses penuh') })[mode]}</span></span>} options={[{ value: 'chat', label: t('Chat only', 'Chat saja'), detail: t('Discuss and read project evidence', 'Diskusi dan baca bukti project') }, { value: 'approval', label: t('Ask for approval', 'Minta persetujuan'), detail: t('Review changes before execution', 'Tinjau perubahan sebelum eksekusi') }, { value: 'full', label: t('Full access', 'Akses penuh'), detail: t('Apply requested project actions', 'Terapkan aksi project yang diminta') }]} disabled={locked} onChange={value => void settings(modelId, value as AiPermissionMode, effort)} /></div>
          {taskMode !== 'work' && <button type="button" className="ai-task-chip" aria-label={t('Work mode', 'Mode kerja')} disabled={selectionLocked} onClick={() => openPicker('mode')}><ListChecks size={15} aria-hidden="true" /><span>{({ plan: t('Plan', 'Rencana'), research: t('Research', 'Riset'), summary: t('Summary', 'Ringkasan') })[taskMode]}</span></button>}
        </div><div className="ai-toolbar-model"><div className="ai-composer-options"><AiModelSettings portalOwner={portalOwner} open={activeOverlay === 'model'} onOpenChange={open => { if (open) { closePicker(false); setComposerOverlay('model'); } else setComposerOverlay(current => current === 'model' ? null : current); }} value={choice?.value ?? `${providerId}:${modelId}`} label={localMode && !configured ? t('Choose model', 'Pilih model') : modelLabel(modelId)} options={choices.filter(item => !localMode || item.available).map(item => ({ value: item.value, label: item.label, disabled: !item.available }))} effort={effort} efforts={availableEfforts} disabled={locked} onModel={value => { const selected = choices.find(item => item.value === value); if (!selected) return; const next = selected.models[effort] ? effort : selected.models.auto ? 'auto' : Object.keys(selected.models)[0] as AiEffort; const id = selected.models[next]; if (id) return settings(id, mode, next, selected.providerId); }} onEffort={next => settings(choice?.models[next] ?? modelId, mode, next)} /></div>
          <div className="ai-composer-actions"><button type={stopAction ? 'button' : 'submit'} className="ai-send" data-action={stopAction ? 'stop' : 'send'} onClick={stopAction ? () => void stop() : undefined} disabled={!stopAction && (recoveryBusy || enqueueBusy || loading || settingsBusy || !configured || !hasDraft && !canSendSaved || files.some(file => !file.attachment || file.error))} aria-label={stopAction ? t('Stop AI', 'Hentikan AI') : editing ? t('Save queued message', 'Simpan pesan antrean') : active || submitting ? t('Queue message', 'Antrekan pesan') : t('Send message', 'Kirim pesan')} title={stopAction ? t('Stop all', 'Hentikan semua') : undefined}>{stopAction ? <Square size={16} /> : <ArrowUp size={18} />}</button></div></div>
        </div>
      </form>
    </div>
  </div>;
}

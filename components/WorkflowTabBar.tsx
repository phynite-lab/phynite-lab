'use client';
import { ArrowLeft, ArrowRight, NotebookPen, PanelLeft, LayoutGrid, Folder, MoreHorizontal, Columns2, PanelTopClose, PanelTopOpen, Maximize2, Pin, PinOff, Plus, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { WorkflowModuleIcon } from './WorkflowStartTab';
import { UiSelect } from './UiSelect';
import { useResearchShell } from './ResearchShellContext';
import { PhyniteAiIcon } from '@/app/tool-icons';
import { useLocale } from '@/app/locale-provider';
import type { WorkflowNode } from '@/lib/project-workflow';
import { isWorkflowLauncherTab, isWorkflowAiTab, aiConversationFromTab, workflowStudyTab, workflowFilesTab, workflowNotesTab, workflowEditorTabs, workflowSplitTabs, workflowPaneViews, workflowSplitPeer, type WorkflowEditorAction, type WorkflowEditorState } from '@/lib/workflow-editor-state';

type Props = { state: WorkflowEditorState; nodes: WorkflowNode[]; chatTitles?: Record<string, string>; projectName: string; dispatch: (action: WorkflowEditorAction) => void; onAdd: (pane?: 0 | 1) => void; onOpenSidebar?: () => void; status: string; disabled?: boolean; splitWidth?: number; splitVisible?: boolean; splitAvailable?: boolean; secondaryOnly?: boolean; targetId?: string; floatingId?: string; onTarget?: (id: string) => void; aiControl?: ReactNode };
export function WorkflowTabBar({ state, nodes, projectName, chatTitles = {}, dispatch, onAdd, onOpenSidebar, status, disabled = false, splitWidth, splitVisible = false, splitAvailable = true, secondaryOnly = false, targetId, floatingId, onTarget, aiControl }: Props) {
  const { t } = useLocale(), header = useRef<HTMLElement>(null), primary = useRef<HTMLDivElement>(null), menuRef = useRef<HTMLDivElement>(null), menuTrigger = useRef<HTMLElement | null>(null);
  const shell = useResearchShell();
  const [menu, setMenu] = useState<{ id: string; pane: 0 | 1; x: number; y: number; host: Element } | null>(null);
  const allTabs = workflowEditorTabs(state), pair = workflowSplitTabs(state), views = workflowPaneViews(state, splitVisible);
  const target = targetId && allTabs.includes(targetId) ? targetId : state.activeTab;
  const targetPane = (pair?.indexOf(target) === 1 ? 1 : 0) as 0 | 1;
  const pinned = new Set(['canvas', ...(state.pinnedTabs ?? [])]);
  const nameFor = (id: string) => id === 'canvas' ? t('Canvas', 'Kanvas') : isWorkflowAiTab(id) ? chatTitles[aiConversationFromTab(id) ?? ''] || 'Phynite AI' : id === workflowFilesTab ? t('Files', 'Berkas') : id === workflowNotesTab ? t('Notes', 'Catatan') : id === workflowStudyTab ? t('Parameter study', 'Studi parameter') : isWorkflowLauncherTab(id) ? t('New tab', 'Tab baru') : nodes.find(node => node.id === id)?.name ?? t('Module', 'Modul');
  const floatingTarget = (floatingId ?? (state.aiPanel?.presentation !== 'minimized' ? state.aiPanel?.id : undefined)) === target && !views.some(view => view.id === target);
  const restoring = !splitVisible && !floatingTarget && Boolean(state.splitTabs);
  const layoutLabel = splitVisible || floatingTarget ? t('Full view', 'Tampilan penuh') : restoring ? t('Restore split', 'Pulihkan split') : t('Split view', 'Tampilan split');
  const finishMenu = () => {
    const closing = menuRef.current, trigger = menuTrigger.current;
    setMenu(null);
    requestAnimationFrame(() => {
      // Commands may focus a newly opened chat before this frame runs. Restore
      // only when focus still belongs to the closing menu or its removed item.
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== document.body && active.isConnected && active.getClientRects().length && !active.closest('[inert]') && !closing?.contains(active)) return;
      (trigger?.isConnected ? trigger : header.current?.querySelector<HTMLElement>('[data-workspace-menu]'))?.focus({ preventScroll: true });
    });
  };
  const openMenu = (id: string, pane: 0 | 1, trigger: HTMLElement, x?: number, y?: number) => {
    if (disabled) return;
    onTarget?.(id); menuTrigger.current = trigger;
    const box = trigger.getBoundingClientRect();
    setMenu({ id, pane, host: header.current?.closest('.research-app-shell') ?? document.body, x: Math.max(12, Math.min(x ?? box.right - 240, innerWidth - 252)), y: Math.max(12, Math.min(y ?? box.bottom + 6, innerHeight - 260)) });
  };
  const layout = (id: string) => {
    if (splitVisible || (floatingId ?? (state.aiPanel?.presentation !== 'minimized' ? state.aiPanel?.id : undefined)) === id && !views.some(view => view.id === id)) dispatch({ type: 'maximize', id });
    else if (splitAvailable) dispatch(state.layout === 'split' ? { type: 'tabs-hidden', hidden: false } : { type: 'toggle-split', id });
  };
  const closeTab = (id: string) => { dispatch({ type: 'close', id }); setMenu(null); requestAnimationFrame(() => header.current?.querySelector<HTMLButtonElement>('[role=tab][aria-selected=true]')?.focus({ preventScroll: true })); };
  useLayoutEffect(() => {
    const strip = primary.current, bar = header.current, panes = bar?.closest('.research-app-shell')?.querySelector('.workflow-panes');
    if (splitWidth === undefined || !strip || !bar || !panes) return;
    let frame = 0;
    const align = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const origin = `${panes.getBoundingClientRect().left - strip.getBoundingClientRect().left}px`;
        if (strip.style.getPropertyValue('--workflow-tab-origin') !== origin) strip.style.setProperty('--workflow-tab-origin', origin);
      });
    };
    align(); const observer = new ResizeObserver(align); observer.observe(panes); observer.observe(bar);
    const navigation = bar.querySelector('.workflow-project-navigation'); if (navigation) observer.observe(navigation);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [splitWidth]);
  useLayoutEffect(() => { if (menu) menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus(); }, [menu]);
  useEffect(() => {
    if (!menu) return;
    const outside = (event: PointerEvent) => { if (!(event.target instanceof Element) || event.target.closest('[role=listbox]')) return; if (!menuRef.current?.contains(event.target) && !menuTrigger.current?.contains(event.target)) setMenu(null); };
    const dismiss = () => setMenu(null);
    document.addEventListener('pointerdown', outside); window.addEventListener('resize', dismiss);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', dismiss); };
  }, [menu]);
  const menuPair = menu && state.splitTabs?.includes(menu.id) ? state.splitTabs : undefined;
  const menuFloating = menu && (floatingId ?? (state.aiPanel?.presentation !== 'minimized' ? state.aiPanel?.id : undefined)) === menu.id && !views.some(view => view.id === menu.id);
  const splitWith = (id: string, direction?: 'left' | 'right' | 'top' | 'bottom') => {
    const beside = workflowSplitPeer(state, id); if (beside) dispatch({ type: 'split', id, beside, direction }); finishMenu();
  };
  return <><header ref={header} className={`workflow-topbar${secondaryOnly ? ' workflow-secondary-topbar' : ''}`} data-split={splitVisible}>
    {!secondaryOnly && <div className="workflow-project-navigation">
      {shell && <nav className="workflow-history-controls" aria-label={t('Workspace navigation', 'Navigasi workspace')}>
        <button type="button" disabled={!shell.canGoBack} aria-label={t('Back', 'Kembali')} title={t('Back', 'Kembali')} onClick={() => shell.traverseHistory(-1)}><ArrowLeft size={17} /></button>
        <button type="button" disabled={!shell.canGoForward} aria-label={t('Forward', 'Maju')} title={t('Forward', 'Maju')} onClick={() => shell.traverseHistory(1)}><ArrowRight size={17} /></button>
        <button type="button" aria-label={shell.sidebarOpen ? t('Hide sidebar', 'Sembunyikan sidebar') : t('Show sidebar', 'Tampilkan sidebar')} title={shell.sidebarOpen ? t('Hide sidebar', 'Sembunyikan sidebar') : t('Show sidebar', 'Tampilkan sidebar')} aria-expanded={shell.sidebarOpen} aria-controls="research-navigation" onClick={event => shell.toggleSidebar(event.currentTarget)}><PanelLeft size={17} /></button>
      </nav>}
      <button disabled={disabled} className="workflow-project-context" title={projectName} onClick={() => { dispatch({ type: 'open', id: 'canvas' }); onTarget?.('canvas'); onOpenSidebar?.(); }}><span>{projectName}</span></button>
    </div>}
    {views.filter(view => secondaryOnly ? view.index === 1 : view.index === 0 || splitWidth !== undefined).map(view => <PaneStrip key={view.index} primaryRef={view.index === 0 ? primary : undefined} view={view} state={state} nodes={nodes} disabled={disabled} splitVisible={splitVisible} splitWidth={splitWidth} targeted={target === view.id} nameFor={nameFor} onAdd={onAdd} dispatch={dispatch} onTarget={onTarget} onMenu={openMenu} onClose={closeTab} />)}
    {!secondaryOnly && <div className="workflow-global-controls">
      {aiControl}
      <button data-workspace-layout type="button" disabled={disabled || isWorkflowLauncherTab(target) || !splitVisible && !floatingTarget && !splitAvailable} aria-label={layoutLabel} title={`${layoutLabel} · ${nameFor(target)}${restoring && !splitAvailable ? t(' · More space needed', ' · Perlu ruang lebih luas') : ''}`} onClick={() => layout(target)}>{splitVisible || floatingTarget ? <Maximize2 size={16} /> : <Columns2 size={16} />}</button>
      <button data-workspace-menu type="button" disabled={disabled} aria-label={t('Workspace options', 'Pilihan workspace')} aria-haspopup="menu" aria-expanded={Boolean(menu)} title={`${t('Workspace options', 'Pilihan workspace')} · ${nameFor(target)}`} onClick={event => menu ? finishMenu() : openMenu(target, targetPane, event.currentTarget)}><MoreHorizontal size={18} /></button>
    </div>}
  </header>
  {!secondaryOnly && <span className="workflow-save-state sr-only" role="status">{status}</span>}
  {menu && createPortal(<div ref={menuRef} className="workflow-tab-menu workflow-global-menu" role="menu" aria-label={`${t('Workspace options', 'Pilihan workspace')} · ${nameFor(menu.id)}`} style={{ left: menu.x, top: menu.y, maxHeight: `calc(100dvh - ${menu.y + 12}px)` }} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finishMenu(); }
    if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key) && (event.target as Element).getAttribute('role') !== 'combobox') { event.preventDefault(); const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role=menuitem]:not(:disabled)')); const index = items.indexOf(document.activeElement as HTMLButtonElement); items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus(); }
  }}>
    <small className="workflow-menu-target">{nameFor(menu.id)}</small>
    <UiSelect compact ariaLabel={t('Open tab', 'Buka tab')} value={menu.id} displayValue={`${allTabs.filter(id => !isWorkflowLauncherTab(id)).length} ${t('tabs', 'tab')}`} options={allTabs.filter(id => !isWorkflowLauncherTab(id)).map(id => ({ value: id, label: nameFor(id) }))} onChange={id => { dispatch({ type: 'open', id, ...(splitVisible ? { pane: menu.pane } : {}) }); onTarget?.(id); finishMenu(); }} />
    <button role="menuitem" disabled={isWorkflowLauncherTab(menu.id) || !splitVisible && !menuFloating && !splitAvailable} onClick={() => { layout(menu.id); finishMenu(); }}>{splitVisible || menuFloating ? <Maximize2 size={16} /> : <Columns2 size={16} />}{splitVisible || menuFloating ? t('Full view', 'Tampilan penuh') : state.splitTabs ? t('Restore split', 'Pulihkan split') : t('Split view', 'Tampilan split')}</button>
    {menuPair && <><button role="menuitem" onClick={() => { dispatch({ type: 'swap' }); finishMenu(); }}><Columns2 size={16} />{t('Swap panes', 'Tukar panel')}</button><button role="menuitem" onClick={() => { dispatch({ type: 'axis', axis: state.splitAxis === 'vertical' ? 'horizontal' : 'vertical' }); finishMenu(); }}><Columns2 size={16} />{state.splitAxis === 'vertical' ? t('Arrange side by side', 'Susun berdampingan') : t('Arrange top and bottom', 'Susun atas dan bawah')}</button></>}
    {!isWorkflowLauncherTab(menu.id) && <div className="workflow-split-directions" role="group" aria-label={t('Split placement', 'Posisi split')}>{(['left', 'right', 'top', 'bottom'] as const).map(direction => <button role="menuitem" key={direction} onClick={() => splitWith(menu.id, direction)}>{({ left: '←', right: '→', top: '↑', bottom: '↓' })[direction]} {t(direction, ({ left: 'Kiri', right: 'Kanan', top: 'Atas', bottom: 'Bawah' })[direction])}</button>)}</div>}
    {!isWorkflowLauncherTab(menu.id) && <div className="workflow-split-choices" role="group" aria-label={t('Split with', 'Split dengan')}><span>{t('Split with', 'Split dengan')}</span>{allTabs.filter(id => id !== menu.id && !isWorkflowLauncherTab(id)).map(id => <button key={id} role="menuitem" onClick={() => { dispatch({ type: 'split', id: menu.id, beside: id }); finishMenu(); }}><Columns2 size={14} /><span>{nameFor(id)}</span></button>)}</div>}
    <button role="menuitem" onClick={() => { dispatch({ type: 'tabs-hidden', hidden: !state.tabsHidden }); finishMenu(); }}>{state.tabsHidden ? <PanelTopOpen size={16} /> : <PanelTopClose size={16} />}{state.tabsHidden ? t('Show tabs', 'Tampilkan tab') : t('Hide tabs · Canvas only', 'Sembunyikan tab · Kanvas saja')}</button>
    {splitVisible && !isWorkflowAiTab(menu.id) && <button role="menuitem" onClick={() => { dispatch({ type: 'pane-tabs-hidden', pane: menu.pane, hidden: !state.paneTabsHidden?.[menu.pane] }); finishMenu(); }}>{state.paneTabsHidden?.[menu.pane] ? <PanelTopOpen size={16} /> : <PanelTopClose size={16} />}{state.paneTabsHidden?.[menu.pane] ? t('Show pane tabs', 'Tampilkan tab panel') : t('Hide pane tabs', 'Sembunyikan tab panel')}</button>}
    {isWorkflowAiTab(menu.id) && <><button role="menuitem" onClick={() => { dispatch({ type: 'ai-presentation', id: menu.id, presentation: 'tab' }); finishMenu(); }}><PhyniteAiIcon size={16} />{t('Open chat', 'Buka chat')}</button><button role="menuitem" onClick={() => { dispatch({ type: 'ai-presentation', id: menu.id, presentation: 'composer' }); finishMenu(); }}><PhyniteAiIcon size={16} />{t('Floating composer', 'Composer mengambang')}</button></>}
    {menu.id !== 'canvas' && !isWorkflowLauncherTab(menu.id) && <button role="menuitem" onClick={() => { dispatch({ type: 'pin', id: menu.id }); finishMenu(); }}>{pinned.has(menu.id) ? <PinOff size={16} /> : <Pin size={16} />}{pinned.has(menu.id) ? t('Unpin tab', 'Lepas sematan tab') : t('Pin tab', 'Sematkan tab')}</button>}
    {menu.id !== 'canvas' && <button role="menuitem" onClick={() => { dispatch({ type: 'close', id: menu.id }); finishMenu(); }}><X size={16} />{t('Close tab', 'Tutup tab')}</button>}
  </div>, menu.host)}
  </>;
}

type View = ReturnType<typeof workflowPaneViews>[number];
function PaneStrip({ primaryRef, view, state, nodes, disabled, splitVisible, splitWidth, targeted, nameFor, onAdd, dispatch, onTarget, onMenu, onClose }: {
  primaryRef?: React.RefObject<HTMLDivElement | null>; view: View; state: WorkflowEditorState; nodes: WorkflowNode[]; disabled: boolean; splitVisible: boolean; splitWidth?: number; targeted: boolean; nameFor: (id: string) => string; onAdd: Props['onAdd']; dispatch: Props['dispatch']; onTarget: Props['onTarget']; onMenu: (id: string, pane: 0 | 1, trigger: HTMLElement, x?: number, y?: number) => void; onClose: (id: string) => void;
}) {
  const { t } = useLocale(), strip = useRef<HTMLDivElement>(null), pinned = new Set(['canvas', ...(state.pinnedTabs ?? [])]);
  const hidden = state.tabsHidden || splitVisible && state.paneTabsHidden?.[view.index];
  const revealFrame = useRef(0);
  const reveal = useCallback(() => {
    cancelAnimationFrame(revealFrame.current);
    revealFrame.current = requestAnimationFrame(() => {
      const container = strip.current; if (!container) return;
      const foundation = container.querySelector<HTMLElement>('[data-foundation=true]');
      const foundationWidth = foundation?.getBoundingClientRect().width ?? 0;
      // Keep Canvas fixed only when another usable tab fits beside it. On a
      // narrow header it remains first and pinned, but scrolls with its peers.
      const sticky = Boolean(foundation && container.clientWidth >= foundationWidth + 72);
      if (container.dataset.foundationSticky !== String(sticky)) container.dataset.foundationSticky = String(sticky);
      const active = container.querySelector<HTMLElement>('[aria-selected=true]')?.closest<HTMLElement>('.workflow-tab');
      if (!active) return;
      const item = active.getBoundingClientRect(), bounds = container.getBoundingClientRect();
      const left = bounds.left + (sticky && active !== foundation ? foundationWidth : 0);
      if (item.left < left) container.scrollLeft -= left - item.left;
      else if (item.right > bounds.right) container.scrollLeft += item.right - bounds.right;
    });
  }, []);
  useLayoutEffect(() => {
    const container = strip.current; if (!container) return;
    // Node measurements can synchronously render the header during observer
    // delivery. Keep its observer alive instead of reobserving this ancestor.
    const observer = new ResizeObserver(reveal); observer.observe(container);
    return () => { observer.disconnect(); cancelAnimationFrame(revealFrame.current); };
  }, [reveal, view.kind]);
  useLayoutEffect(reveal, [reveal, view.id, view.tabs, hidden]);
  const choose = (id: string) => { onTarget?.(id); dispatch({ type: 'open', id, ...(splitVisible ? { pane: view.index } : {}) }); };
  return <div ref={primaryRef} className={`workflow-tab-strip${view.index === 1 ? ' workflow-tab-strip-secondary' : ''}`} data-tab-pane={view.index} data-targeted={targeted} onPointerDownCapture={() => onTarget?.(view.id)} onFocusCapture={() => onTarget?.(view.id)} style={view.index === 0 && splitWidth !== undefined ? { width: `calc(var(--workflow-editor-preview, var(--workflow-editor-width, ${splitWidth}px)) + var(--workflow-tab-origin, 0px))`, flex: `0 0 calc(var(--workflow-editor-preview, var(--workflow-editor-width, ${splitWidth}px)) + var(--workflow-tab-origin, 0px))` } : undefined}>
    {view.kind === 'chat' ? <div className="workflow-chat-heading"><PhyniteAiIcon size={17} aria-hidden="true" /><button className="workflow-chat-title" title={nameFor(view.id)} onClick={() => choose(view.id)}>{nameFor(view.id)}</button></div> : <>
    <div ref={strip} role="tablist" hidden={hidden} aria-label={view.index === 0 ? t('Project tabs', 'Tab project') : t('Secondary pane tabs', 'Tab panel kedua')} className="workflow-tabs" onKeyDown={event => {
      if ((event.target as Element).getAttribute('role') !== 'tab') return;
      const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]')), index = items.indexOf(event.target as HTMLButtonElement);
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      if (event.altKey && event.shiftKey) { const id = items[index]?.dataset.tabId, other = items[index + (event.key === 'ArrowLeft' ? -1 : 1)]?.dataset.tabId; if (id && other) dispatch(event.key === 'ArrowLeft' ? { type: 'reorder', id, before: other } : { type: 'reorder', id: other, before: id }); return; }
      items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length]?.click();
      const container = event.currentTarget; requestAnimationFrame(() => container.querySelector<HTMLButtonElement>('[aria-selected=true]')?.focus());
    }}>{view.tabs.filter(id => !isWorkflowLauncherTab(id)).map(id => <div className="workflow-tab" data-active={view.id === id} data-pinned={pinned.has(id)} data-foundation={id === 'canvas'} key={id} draggable={!disabled} onDragStart={event => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-phynite-tab', id); document.body.classList.add('workflow-dragging-tab'); }} onDragEnd={() => document.body.classList.remove('workflow-dragging-tab')} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); dispatch({ type: 'reorder', id: event.dataTransfer.getData('application/x-phynite-tab'), before: id }); }} onContextMenu={event => { event.preventDefault(); onMenu(id, view.index, event.currentTarget.querySelector('button')!, event.clientX, event.clientY); }}>
      <button disabled={disabled} role="tab" data-tab-id={id} aria-selected={view.id === id} tabIndex={view.id === id ? 0 : -1} title={nameFor(id)} onClick={() => choose(id)} onKeyDown={event => { if (event.key === 'Delete' && id !== 'canvas') { event.preventDefault(); onClose(id); } if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') { event.preventDefault(); onMenu(id, view.index, event.currentTarget); } }}>{id === 'canvas' ? <LayoutGrid size={15} /> : id === workflowFilesTab ? <Folder size={15} /> : id === workflowNotesTab ? <NotebookPen size={15} /> : isWorkflowAiTab(id) ? <PhyniteAiIcon size={15} /> : <WorkflowModuleIcon kind={nodes.find(node => node.id === id)?.kind ?? 'figure'} size={15} />}<span>{nameFor(id)}</span></button>
      {id !== 'canvas' && <button disabled={disabled} className="workflow-tab-close" tabIndex={view.id === id ? 0 : -1} aria-label={t(`Close ${nameFor(id)}`, `Tutup ${nameFor(id)}`)} onClick={() => onClose(id)}><X size={14} /></button>}
    </div>)}</div>
    {!hidden && <button className="workflow-add-tab" disabled={disabled} aria-label={view.index === 1 ? t('Secondary pane · New tab', 'Panel kedua · Tab baru') : t('New tab', 'Tab baru')} aria-pressed={isWorkflowLauncherTab(view.id)} title={t('New tab', 'Tab baru')} onClick={() => onAdd(splitVisible ? view.index : undefined)}><Plus size={18} /></button>}
    </>}
  </div>;
}

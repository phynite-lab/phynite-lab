'use client';
import { PhyniteAiIcon } from '@/app/tool-icons';
import { ArrowLeft, Atom, Box, Check, ChevronRight, FileText, GitBranch, ListChecks, Paperclip, RefreshCw, Search, SlidersHorizontal, TextSearch, WandSparkles, X, type LucideIcon } from 'lucide-react';
import { useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useLocale } from '@/app/locale-provider';
import type { AiContextItem, AiTaskMode } from '@/lib/ai-workbench';
import type { AiSkillCatalogEntry, AiSkillRef } from '@/lib/ai-contract';
import { aiCommandMatches, aiModuleCommands, aiModuleKindForCommand, type AiCommandToken } from '@/lib/ai-composer-commands';
import type { WorkflowKind } from '@/lib/project-workflow';
import './AiContextPicker.css';
import { useAiOverlayPosition } from './use-ai-overlay';
export { aiOverlayTheme, aiOverlayViewport } from './use-ai-overlay';

export type AiContextPickerController = { handleKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean };
export type AiContextPickerView = 'menu' | 'contexts' | 'commands' | 'mode' | 'skills';
type PickerRow = { key: string; label: string; detail?: string; command?: string; icon: LucideIcon | typeof PhyniteAiIcon; checked?: boolean; disabled?: boolean; select: () => void; item?: AiContextItem };
export function AiContextPicker({ anchorRef, portalOwner, load, onSelect, onFiles, onClose, onTask, taskMode, taskLocked, saved = true, initialView = 'menu', commandToken, skills = [], skillRef, onSkill, onManageSkills, onManageMcp, controllerRef }: {
  anchorRef: RefObject<HTMLButtonElement | null>; portalOwner: string;
  load: (nodeId?: string, query?: string) => Promise<{ items: AiContextItem[]; hasMore: boolean }>;
  onManageSkills?: () => void; onManageMcp?: () => void;
  onSelect: (item: AiContextItem) => void; onFiles: () => void; onClose: (restoreFocus?: boolean) => void;
  onTask: (task: AiTaskMode) => void; taskMode: AiTaskMode; taskLocked: boolean; saved?: boolean;
  initialView?: AiContextPickerView; commandToken?: AiCommandToken; skills?: AiSkillCatalogEntry[];
  skillRef?: AiSkillRef | null; onSkill?: (skill: AiSkillRef) => void; controllerRef?: RefObject<AiContextPickerController | null>;
}) {
  const { t } = useLocale();
  const [view, setView] = useState<AiContextPickerView>(initialView), [query, setQuery] = useState(''), [node, setNode] = useState<string>(), [moduleKind, setModuleKind] = useState<WorkflowKind>(), [retry, setRetry] = useState(0);
  const commandMode = initialView === 'commands', commandQuery = commandToken?.query ?? '';
  const navigationKey = JSON.stringify([initialView, commandMode ? [commandToken?.start, commandQuery] : null]);
  const [navigation, setNavigation] = useState(navigationKey);
  if (navigation !== navigationKey) {
    // A newly typed command starts a fresh scope before old results can be chosen.
    setNavigation(navigationKey); setView(initialView); setNode(undefined); setModuleKind(undefined); setQuery('');
  }
  const kind = moduleKind ?? (view === 'commands' ? aiModuleKindForCommand(commandQuery) : undefined);
  const needsContext = view === 'contexts' || view === 'commands';
  const filterQuery = view === 'commands' ? kind ? '' : commandQuery : query;
  const sourceQuery = filterQuery || (kind && !node ? kind : '');
  const requestKey = JSON.stringify([view, node, sourceQuery, kind, retry]);
  const [result, setResult] = useState<{ key: string; items: AiContextItem[]; hasMore: boolean; error?: string }>({ key: '', items: [], hasMore: false });
  const loading = needsContext && result.key !== requestKey, items = loading ? [] : result.items;
  const root = useRef<HTMLDivElement>(null), search = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState({ key: '', index: 0 });
  const selectionKey = JSON.stringify([requestKey, query, commandQuery, skills.map(skill => [skill.id, skill.version])]);
  const activeIndex = active.key === selectionKey ? active.index : 0;
  useEffect(() => {
    if (!needsContext) return;
    let live = true;
    const timer = setTimeout(() => { void load(node, sourceQuery).then(data => { if (live) setResult({ key: requestKey, ...data }); }).catch(failure => { if (live) setResult({ key: requestKey, items: [], hasMore: false, error: failure instanceof Error ? failure.message : String(failure) }); }); }, 150);
    return () => { live = false; clearTimeout(timer); };
  }, [load, node, sourceQuery, requestKey, needsContext]);
  useImperativeHandle(controllerRef, () => ({ handleKeyDown(event) {
    if (!commandMode || event.nativeEvent.isComposing) return false;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(true); return true; }
    const buttons = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('button[data-picker-option]:not(:disabled)') ?? []);
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      if (buttons.length) {
        const index = (activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        setActive({ key: selectionKey, index }); buttons[index]?.scrollIntoView({ block: 'nearest' });
      }
      return true;
    }
    if (event.key === 'Enter' && loading && !buttons[activeIndex]) { event.preventDefault(); return true; }
    if (['Enter', 'Tab'].includes(event.key) && buttons[activeIndex]) { event.preventDefault(); buttons[activeIndex].click(); return true; }
    return false;
  } }));
  const placement = useAiOverlayPosition({ anchorRef, rootRef: root });
  useEffect(() => { if (placement.style.visibility === 'visible' && (!commandMode || view !== 'commands')) (search.current ?? root.current?.querySelector<HTMLButtonElement>('button[data-picker-option]:not(:disabled)'))?.focus({ preventScroll: true }); }, [placement.style.visibility, commandMode, view, node, moduleKind]);
  useEffect(() => { const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node) && !anchorRef.current?.contains(event.target as Node) && !(commandMode && anchorRef.current?.closest('.ai-composer-box')?.contains(event.target as Node))) onClose(false); }; document.addEventListener('pointerdown', outside); return () => document.removeEventListener('pointerdown', outside); }, [anchorRef, onClose, commandMode]);
  const filtered = items.filter(item => (!kind || node || item.ref.kind === 'node' && item.detail === kind) && (view !== 'commands' || item.ref.kind === 'node' || Boolean(node)) && aiCommandMatches(filterQuery, item.label, item.detail));
  const tasks = [
    { id: 'work', label: t('Work', 'Kerja'), detail: t('Work with saved project inputs', 'Kerjakan input project tersimpan'), icon: PhyniteAiIcon },
    { id: 'plan', label: t('Create a plan', 'Buat rencana'), detail: t('Inspect and plan without changing data', 'Periksa dan rencanakan tanpa mengubah data'), icon: ListChecks },
    { id: 'research', label: t('Research literature', 'Riset literatur'), detail: t('Compare literature and project evidence', 'Bandingkan literatur dan bukti project'), icon: TextSearch },
    { id: 'summary', label: t('Summarize conversation', 'Ringkas percakapan'), detail: t('Summarize decisions, evidence and next steps', 'Ringkas keputusan, bukti, dan langkah berikutnya'), icon: FileText },
  ] as const;
  const searchValue = view === 'commands' ? commandQuery : query;
  const taskRows: PickerRow[] = (view === 'mode' || view === 'commands' && !kind ? tasks : []).filter(task => aiCommandMatches(searchValue, task.id, task.label, task.detail)).map(task => ({ key: `task:${task.id}`, label: task.label, detail: task.detail, command: task.id, icon: task.icon, checked: taskMode === task.id, disabled: taskLocked, select: () => onTask(task.id) }));
  const skillRows: PickerRow[] = (view === 'skills' || view === 'commands' && !kind ? skills : []).filter(skill => aiCommandMatches(searchValue, skill.command, skill.label.en, skill.label.id, skill.description.en, skill.description.id)).map(skill => ({ key: `skill:${skill.id}`, label: t(skill.label.en, skill.label.id), detail: t(skill.description.en, skill.description.id), command: skill.command, icon: WandSparkles, checked: skillRef?.id === skill.id && skillRef.version === skill.version, disabled: taskLocked, select: () => onSkill?.({ scope: skill.scope, id: skill.id, version: skill.version }) }));
  const moduleRows: PickerRow[] = view === 'commands' && !kind && !node ? aiModuleCommands.filter(module => aiCommandMatches(commandQuery, module.command, module.label.en, module.label.id)).map(module => ({ key: `module:${module.kind}`, label: t(module.label.en, module.label.id), detail: t('Choose a saved project module', 'Pilih modul project tersimpan'), command: module.command, icon: Box, disabled: !saved, select: () => { setModuleKind(module.kind); setView('contexts'); setQuery(''); } })) : [];
  const contextRows: PickerRow[] = needsContext ? filtered.map(item => ({ key: JSON.stringify(item.ref), label: item.label, detail: item.detail, icon: item.ref.kind === 'node' ? Box : item.ref.kind === 'edge' ? GitBranch : item.ref.kind === 'field' ? SlidersHorizontal : item.ref.kind === 'atom' ? Atom : FileText, disabled: !saved && item.ref.kind !== 'attachment', select: () => { if (!loading) onSelect(item); }, item })) : [];
  const groups = [
    { label: t('Mode', 'Mode'), rows: taskRows },
    { label: t('Skills', 'Skill'), rows: skillRows },
    { label: t('Module commands', 'Perintah modul'), rows: moduleRows },
    { label: node ? t('Fields and atoms', 'Field dan atom') : t('Modules', 'Modul'), rows: contextRows.filter(row => ['node', 'field', 'atom'].includes(row.item!.ref.kind)) },
    { label: t('Connections', 'Koneksi'), rows: contextRows.filter(row => row.item!.ref.kind === 'edge') },
    { label: t('Saved sources', 'Sumber tersimpan'), rows: contextRows.filter(row => ['resource', 'attachment'].includes(row.item!.ref.kind)) },
  ].filter(group => group.rows.length);
  const openView = (next: AiContextPickerView) => { setView(next); setNode(undefined); setModuleKind(undefined); setQuery(''); };
  const title = view === 'menu' ? t('Add to chat', 'Tambahkan ke chat') : view === 'mode' ? t('Mode', 'Mode') : view === 'skills' ? t('Skills', 'Skill') : view === 'commands' ? t('Commands', 'Perintah') : t('Module context', 'Konteks modul');
  const showSearch = view !== 'menu' && view !== 'commands';
  let optionIndex = 0;
  if (typeof document === 'undefined') return null;
  return createPortal(<div ref={root} className="ai-context-picker ai-command-picker ai-overlay" data-ui-owner={portalOwner} data-sheet={placement.sheet} data-command-mode={commandMode} style={placement.style} role="dialog" aria-label={t('Add context', 'Tambah konteks')} onBlur={event => { if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget) && !anchorRef.current?.contains(event.relatedTarget) && !(commandMode && anchorRef.current?.closest('.ai-composer-box')?.contains(event.relatedTarget))) onClose(false); }} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(true); return; }
    if (event.nativeEvent.isComposing) return;
    if (event.target instanceof HTMLInputElement) {
      const first = event.currentTarget.querySelector<HTMLButtonElement>('button[data-picker-option]:not(:disabled)');
      if (event.key === 'Enter' || event.key === 'Tab' && !event.shiftKey && first) { event.preventDefault(); first?.click(); }
      if (event.key === 'ArrowDown') { event.preventDefault(); first?.focus(); }
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')), index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      event.preventDefault(); buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    }
  }}>
    <header><div>{view !== 'menu' && <button type="button" className="ai-command-back" aria-label={t('Back to chat menu', 'Kembali ke menu chat')} onClick={() => openView('menu')}><ArrowLeft size={15} /></button>}<strong>{title}</strong></div><button type="button" onClick={() => onClose(true)} aria-label={t('Close context picker', 'Tutup pilihan konteks')}><X size={16} /></button></header>
    {showSearch && <label className="ai-context-search"><Search size={15} aria-hidden="true" /><input ref={search} maxLength={200} value={query} onChange={event => setQuery(event.target.value)} placeholder={view === 'contexts' ? t('Search project context…', 'Cari konteks project…') : t('Search…', 'Cari…')} aria-label={view === 'contexts' ? t('Search saved context', 'Cari konteks tersimpan') : t('Search commands', 'Cari perintah')} /></label>}
    {view === 'commands' && <p className="ai-command-hint" role="status">{kind ? t('Choose the saved module to include.', 'Pilih modul tersimpan sebagai konteks.') : t('Choose a mode, skill or saved module.', 'Pilih mode, skill, atau modul tersimpan.')}<kbd>↑↓</kbd><kbd>↵</kbd></p>}
    {onManageMcp && view === "menu" && <button type="button" className="ai-text-button" disabled={taskLocked} onClick={onManageMcp}>{t("Local MCP connections", "Koneksi MCP lokal")}</button>}
    {onManageSkills && (view === "menu" || view === "skills") && <button type="button" className="ai-text-button" disabled={taskLocked} onClick={onManageSkills}>{t("Manage custom skills", "Kelola skill kustom")}</button>}
    <div className="ai-context-picker-scroll" data-ai-overlay-scroll>
      {view === 'menu' && <div className="ai-command-menu">
        <button type="button" data-picker-option onClick={onFiles}><Paperclip size={18} /><span>{t('Files and images', 'File dan gambar')}<small>PDF, DOCX, XLSX, CSV, TXT…</small></span></button>
        <button type="button" data-picker-option onClick={() => openView('mode')}><ListChecks size={18} /><span>{t('Mode', 'Mode')}<small>{t('Work, Plan, Research and Summary', 'Kerja, Rencana, Riset, dan Ringkasan')}</small></span><ChevronRight size={15} /></button>
        {!!skills.length && <button type="button" data-picker-option onClick={() => openView('skills')}><WandSparkles size={18} /><span>{t('Skills', 'Skill')}<small>{t('Saved scientific workflows', 'Panduan kerja ilmiah tersimpan')}</small></span><ChevronRight size={15} /></button>}
        <button type="button" data-picker-option onClick={() => openView('contexts')}><Box size={18} /><span>{t('Module context', 'Konteks modul')}<small>{t('Modules, fields and saved sources', 'Modul, field, dan sumber tersimpan')}</small></span><ChevronRight size={15} /></button>
      </div>}
      {(node || moduleKind) && <button type="button" className="ai-context-back" onClick={() => { setNode(undefined); setModuleKind(undefined); setQuery(''); setView(commandMode ? 'commands' : 'contexts'); search.current?.focus(); }}><ArrowLeft size={14} />{t('All project context', 'Semua konteks project')}</button>}
      {needsContext && !saved && <p role="status">{t('Save Canvas changes before selecting project context. Files remain available.', 'Simpan perubahan Kanvas sebelum memilih konteks project. File tetap tersedia.')}</p>}
      {needsContext && !loading && result.error && <p role="alert">{result.error}<button type="button" onClick={() => setRetry(value => value + 1)}><RefreshCw size={14} />{t('Retry', 'Coba lagi')}</button></p>}
      {view !== 'menu' && <div className="ai-context-results" aria-busy={loading}>{groups.map(group => <section key={group.label} aria-label={group.label}><h3>{group.label}<span>{group.rows.length}</span></h3>{group.rows.map(row => {
        const index = row.disabled ? -1 : optionIndex++, Icon = row.icon;
        return <div className="ai-context-row" key={row.key}><button type="button" data-picker-option data-active={commandMode && index === activeIndex && index >= 0} disabled={row.disabled} aria-pressed={row.checked} onMouseDown={event => { if (commandMode && view === 'commands') event.preventDefault(); }} onClick={row.select}><Icon size={16} aria-hidden="true" /><span>{row.label}{row.detail && <small>{row.detail}</small>}{row.command && <small className="ai-command-alias">/{row.command}</small>}</span>{row.checked && <Check size={14} aria-hidden="true" />}</button>{row.item?.ref.kind === 'node' && <button type="button" disabled={!saved} aria-label={t(`Choose fields in ${row.label}`, `Pilih field di ${row.label}`)} title={t('Configuration fields and atoms', 'Field konfigurasi dan atom')} onClick={() => { setNode(row.item!.ref.id); setView('contexts'); setQuery(''); }}><ChevronRight size={16} /></button>}</div>;
      })}</section>)}{loading && <p role="status">{t('Reading saved sources…', 'Membaca sumber tersimpan…')}</p>}{!loading && !result.error && !groups.length && <p>{view === 'contexts' || view === 'commands' ? t('No matching saved context.', 'Tidak ada konteks tersimpan yang cocok.') : t('No matching commands.', 'Tidak ada perintah yang cocok.')}</p>}{needsContext && !loading && result.hasMore && <p>{t('Showing the first 250 sources. Choose a module to narrow the list.', 'Menampilkan 250 sumber pertama. Pilih modul untuk mempersempit daftar.')}</p>}</div>}
    </div>
  </div>, document.body);
}

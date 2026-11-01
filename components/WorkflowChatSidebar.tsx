'use client';

import { MessageSquare, MoreHorizontal, Search, SquarePen, Trash2 } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocale } from '@/app/locale-provider';
import type { AiConversation } from '@/lib/ai-contract';
import type { ProjectAiHistorySnapshot } from '@/lib/project-ai-history';
import { aiConversationTab, isWorkflowAiTab } from '@/lib/workflow-editor-state';
import { useResearchShell } from './ResearchShellContext';

export function WorkflowChatSidebar({ projectName, conversations, status, activeTab, creating, disabled, deleting, onOpen, onNew, onRetry, onDelete }: {
  projectName: string; conversations: AiConversation[]; status: ProjectAiHistorySnapshot['status']; activeTab: string; creating: boolean; disabled: boolean; deleting: boolean;
  onOpen: (tab: string) => void; onNew: () => void; onRetry: () => void; onDelete: (tab: string) => void;
}) {
  const { t } = useLocale(), shell = useResearchShell();
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState<{ id: string; title: string; trigger: HTMLButtonElement; host: Element; x: number; y: number } | null>(null);
  const menuId = useId(), menuRef = useRef<HTMLDivElement>(null);
  const closeMenu = (restore = true) => { const trigger = menu?.trigger; setMenu(null); if (restore && trigger?.isConnected) trigger.focus({ preventScroll: true }); };
  const openMenu = (chat: AiConversation, trigger: HTMLButtonElement) => {
    if (disabled || deleting) return;
    const box = trigger.getBoundingClientRect();
    setMenu({ id: chat.id, title: chat.title, trigger, host: trigger.closest('#research-navigation') ?? document.body, x: Math.max(8, Math.min(box.right - 176, innerWidth - 184)), y: box.bottom + 50 <= innerHeight - 8 ? box.bottom + 4 : Math.max(8, box.top - 48) });
  };
  useLayoutEffect(() => { if (menu) menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus(); }, [menu]);
  useEffect(() => {
    if (!menu) return;
    const outside = (event: Event) => { if (event.target instanceof Node && !menuRef.current?.contains(event.target) && !menu.trigger.contains(event.target)) setMenu(null); };
    const close = () => setMenu(null);
    document.addEventListener('pointerdown', outside); document.addEventListener('focusin', outside);
    window.addEventListener('resize', close); window.addEventListener('scroll', close, true);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); window.removeEventListener('resize', close); window.removeEventListener('scroll', close, true); };
  }, [menu]);
  const chats = conversations.filter(chat => chat.title.toLowerCase().includes(query.trim().toLowerCase()));
  return <div className="workflow-project-sidebar workflow-chat-sidebar" aria-label={t('Project chat history', 'Riwayat chat project')} aria-busy={status === 'loading'}>
    <div className="workflow-sidebar-primary"><button disabled={disabled || creating} onClick={onNew}><SquarePen size={18} /><span>{creating ? t('Creating chat…', 'Membuat chat…') : t('New chat', 'Chat baru')}</span></button></div>
    <div className="workflow-chat-project" title={projectName}>{projectName}</div>
    {shell?.projectSearchOpen && <label id="workflow-chat-search" className="workflow-project-search"><Search size={18} /><input autoFocus type="search" aria-label={t('Search chats', 'Cari chat')} placeholder={t('Search chats', 'Cari chat')} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (query) setQuery(''); else shell.closeSidebarSearch(); } }} /></label>}
    <nav className="workflow-chat-list workflow-project-tree" aria-label={t('Chat history', 'Riwayat chat')}>
      {status === 'loading' && !conversations.length && <p role="status">{t('Loading chat history…', 'Memuat riwayat chat…')}</p>}
      {status === 'error' && <p role="alert">{conversations.length ? t('Chat history could not be refreshed. Saved chats are still shown.', 'Riwayat chat belum dapat diperbarui. Chat tersimpan tetap ditampilkan.') : t('Chat history could not be loaded. Try again.', 'Riwayat chat belum dapat dimuat. Coba lagi.')} <button type="button" onClick={onRetry}>{t('Retry', 'Coba lagi')}</button></p>}
      {status === 'ready' && !conversations.length && <p>{t('No chats in this project yet.', 'Belum ada chat di project ini.')}</p>}
      {!!conversations.length && !chats.length && <p>{t('No matching chats.', 'Tidak ada chat yang cocok.')}</p>}
      {chats.map(chat => <div className="workflow-chat-row" key={chat.id} data-current={activeTab === aiConversationTab(chat.id)}>
        <button type="button" className="workflow-chat-history-item workflow-project-link" disabled={disabled} title={chat.title} aria-current={activeTab === aiConversationTab(chat.id) ? 'page' : undefined} onClick={() => { onOpen(aiConversationTab(chat.id)); shell?.closeMobileNavigation(); }} onKeyDown={event => {
          if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') { const trigger = event.currentTarget.parentElement?.querySelector<HTMLButtonElement>('[data-chat-menu-trigger]'); if (trigger) { event.preventDefault(); event.stopPropagation(); openMenu(chat, trigger); } }
        }}><MessageSquare size={16} /><span>{chat.title}</span></button>
        <button type="button" className="workflow-chat-actions" data-chat-menu-trigger disabled={disabled || deleting} aria-label={t(`Chat actions for ${chat.title}`, `Aksi chat ${chat.title}`)} aria-haspopup="menu" aria-expanded={menu?.id === chat.id} aria-controls={menu?.id === chat.id ? menuId : undefined} title={t('Chat actions', 'Aksi chat')} onClick={event => menu?.id === chat.id ? closeMenu() : openMenu(chat, event.currentTarget)} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); openMenu(chat, event.currentTarget); } }}><MoreHorizontal size={16} /></button>
      </div>)}
    </nav>
    {menu && isWorkflowAiTab(activeTab) && conversations.some(chat => chat.id === menu.id) && !disabled && !deleting && createPortal(<div ref={menuRef} id={menuId} className="workflow-chat-actions-menu" role="menu" aria-label={t(`Chat actions for ${menu.title}`, `Aksi chat ${menu.title}`)} data-research-sidebar-interaction style={{ left: menu.x, top: menu.y }} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMenu(); }
      else if (event.key === 'Tab') closeMenu();
      else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus(); }
    }}><button type="button" role="menuitem" onClick={() => { const tab = aiConversationTab(menu.id); closeMenu(); onDelete(tab); }}><Trash2 size={15} />{t('Delete chat', 'Hapus chat')}</button></div>, menu.host)}
  </div>;
}

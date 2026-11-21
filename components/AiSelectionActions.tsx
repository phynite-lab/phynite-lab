'use client';

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { CornerDownRight, MessageSquarePlus } from 'lucide-react';
import { useLocale } from '@/app/locale-provider';
import { quoteAiMessage } from '@/lib/ai-message-quote';
import type { AiMessage } from '@/lib/ai-contract';
import type { AiContextItem } from '@/lib/ai-workbench';
import { aiOverlayTheme, aiOverlayViewport } from './AiContextPicker';

/** One listener for the transcript; selections cannot cross message boundaries. */
export function AiSelectionActions({ ownerRef, messages, onQuote, onSideChat, portalOwner }: {
  ownerRef: RefObject<HTMLElement | null>; messages: AiMessage[];
  onQuote: (item: AiContextItem) => void; onSideChat?: (item: AiContextItem) => void;
  portalOwner?: string;
}) {
  const { t } = useLocale(), toolbar = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<{ item: AiContextItem; style: CSSProperties; top: number; bottom: number } | null>(null);
  const [notice, setNotice] = useState('');
  useLayoutEffect(() => {
    if (!selection || !toolbar.current) return;
    const viewport = aiOverlayViewport(), height = toolbar.current.getBoundingClientRect().height;
    const above = selection.top - height - 8;
    toolbar.current.style.top = `${Math.max(viewport.top + 8, Math.min(above >= viewport.top + 8 ? above : selection.bottom + 8, viewport.bottom - height - 8))}px`;
  }, [selection]);
  useEffect(() => {
    const update = () => {
      if (toolbar.current?.contains(document.activeElement)) return;
      const value = window.getSelection(), owner = ownerRef.current;
      if (!value?.rangeCount || value.isCollapsed || !owner) { setSelection(null); return; }
      const range = value.getRangeAt(0);
      const element = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer as Element : range.startContainer.parentElement;
      const response = element?.closest<HTMLElement>('[data-ai-message-id] .ai-response-text');
      if (!response || !owner.contains(response) || !response.contains(range.endContainer)) { setSelection(null); return; }
      const message = messages.find(item => item.id === response.closest<HTMLElement>('[data-ai-message-id]')?.dataset.aiMessageId);
      const selected = value.toString();
      if (!message || !selected.trim()) { setSelection(null); return; }
      const prefix = range.cloneRange(); prefix.selectNodeContents(response); prefix.setEnd(range.startContainer, range.startOffset);
      const occurrence = prefix.toString().split(selected).length - 1;
      const item = quoteAiMessage(message, selected, occurrence);
      if (!item) { setSelection(null); setNotice(t('Select a shorter passage of text to quote.', 'Pilih potongan teks yang lebih pendek untuk dikutip.')); return; }
      setNotice(t('Quote actions available. Press Alt+Enter to focus them.', 'Aksi kutipan tersedia. Tekan Alt+Enter untuk memilih.'));
      const bounds = range.getBoundingClientRect(), viewport = aiOverlayViewport(), width = Math.min(onSideChat ? 288 : 156, viewport.right - viewport.left - 16);
      setSelection({ item, top: bounds.top, bottom: bounds.bottom, style: { ...aiOverlayTheme(owner), width,
        left: Math.max(viewport.left + 8, Math.min(bounds.left, viewport.right - width - 8)),
        top: Math.max(viewport.top + 8, Math.min(bounds.top - 44, viewport.bottom - 48)) } });
    };
    const close = () => setSelection(null);
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { close(); window.getSelection()?.removeAllRanges(); }
      if (event.key === 'Enter' && event.altKey && toolbar.current) { event.preventDefault(); toolbar.current.querySelector<HTMLButtonElement>('button')?.focus(); }
    };
    document.addEventListener('selectionchange', update);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', close); window.addEventListener('scroll', close, true);
    return () => { document.removeEventListener('selectionchange', update); document.removeEventListener('keydown', escape); window.removeEventListener('resize', close); window.removeEventListener('scroll', close, true); };
  }, [messages, ownerRef, onSideChat, t]);
  const choose = (side: boolean) => {
    if (!selection) return;
    (side ? onSideChat : onQuote)?.(selection.item);
    setSelection(null); window.getSelection()?.removeAllRanges();
  };
  return <>
    <span className="sr-only" role="status">{notice}</span>
    {selection && createPortal(<div ref={toolbar} className="ai-selection-actions" data-ui-owner={portalOwner} role="group" aria-label={t('Selected response', 'Potongan jawaban')} style={selection.style} onPointerDown={event => event.preventDefault()}>
      <button type="button" onClick={() => choose(false)}><CornerDownRight size={14} />{t('Add to chat', 'Tambahkan ke chat')}</button>
      {onSideChat && <button type="button" onClick={() => choose(true)}><MessageSquarePlus size={14} />{t('Ask in side chat', 'Tanya di chat samping')}</button>}
    </div>, document.body)}
  </>;
}

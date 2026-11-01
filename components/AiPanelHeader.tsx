'use client';

import { ChevronDown, GripVertical, LoaderCircle, Minus, MoveDiagonal2, TriangleAlert } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { PhyniteAiIcon } from '@/app/tool-icons';
import { useLocale } from '@/app/locale-provider';
import { UiSelect } from './UiSelect';
import type { AiWorkspaceStatus } from './AiWorkspace';
import { workflowFloatingPanelPosition, workflowPanelMotionDuration } from '@/lib/workflow-floating-panel';

type Presentation = 'floating' | 'composer' | 'minimized';
export function AiPanelHeader({ title, tabId, conversations, status, presentation, onChange, onPosition, onSelect, onNew, onManage }: {
  title: string; tabId: string; conversations: Array<{ id: string; title: string }>; status: AiWorkspaceStatus;
  presentation?: Presentation; onChange: (value: 'tab' | Presentation) => void;
  onPosition: (x: number, y: number) => void; onSelect: (id: string) => void; onNew: () => void; onManage: (action: 'delete' | 'clear') => void;
}) {
  const { t } = useLocale();
  const dragged = useRef(false);
  const cleanupDrag = useRef<(() => void) | null>(null), docking = useRef<Animation | null>(null);
  useEffect(() => () => { cleanupDrag.current?.(); docking.current?.cancel(); }, []);
  const chats = conversations.some(chat => chat.id === tabId) ? conversations : [{ id: tabId, title }, ...conversations];
  const statusLabel = status === 'working' ? t('AI is working', 'AI sedang bekerja') : status === 'approval' ? t('Waiting for approval', 'Menunggu persetujuan') : status === 'error' ? t('Chat needs attention', 'Chat perlu diperiksa') : t('Ready', 'Siap');
  const toggle = () => onChange(presentation === 'composer' ? 'floating' : 'composer');
  return <header className="ai-panel-header" onClick={event => {
    if (presentation && !dragged.current && !(event.target as Element).closest('button,[role=button]')) toggle();
  }} onPointerDown={event => {
    dragged.current = false;
    if (!presentation || !event.isPrimary || event.button !== 0 || (event.target as Element).closest('button')) return;
    const panel = event.currentTarget.closest<HTMLElement>('.workflow-ai-editor'), parent = panel?.parentElement;
    if (!panel || !parent) return;
    // Keep the current visual position when a new drag interrupts docking.
    const box = panel.getBoundingClientRect(), bounds = parent.getBoundingClientRect(), target = event.currentTarget;
    let dx = event.clientX - box.left, dy = event.clientY - box.top;
    let extent = { width: box.width, height: box.height };
    const inset = bounds.width <= 560 ? 6 : 14;
    cleanupDrag.current?.();
    event.preventDefault(); target.setPointerCapture(event.pointerId);
    const move = (point: PointerEvent) => {
      if (!dragged.current && Math.hypot(point.clientX - event.clientX, point.clientY - event.clientY) > 4) {
        const visual = panel.getBoundingClientRect();
        dx = event.clientX - visual.left; dy = event.clientY - visual.top;
        dragged.current = true; panel.getAnimations().forEach(animation => animation.cancel());
        extent = { width: panel.offsetWidth, height: panel.offsetHeight };
      }
      if (!dragged.current) return;
      const { x, y } = workflowFloatingPanelPosition({ x: point.clientX - bounds.left - dx, y: point.clientY - bounds.top - dy }, extent, bounds, { inset });
      panel.style.left = `${x}px`; panel.style.top = `${y}px`; panel.style.bottom = 'auto'; panel.style.right = 'auto';
    };
    let finished = false;
    const cleanup = () => {
      finished = true;
      target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', finish); target.removeEventListener('pointercancel', finish); target.removeEventListener('lostpointercapture', finish);
      if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
      cleanupDrag.current = null;
    };
    const finish = (point: PointerEvent) => {
      if (finished) return;
      if (point.type === 'pointerup') move(point);
      if (dragged.current) {
        const before = panel.getBoundingClientRect();
        const position = workflowFloatingPanelPosition({ x: before.left - bounds.left, y: before.top - bounds.top }, extent, bounds, { inset, snapDistance: point.type === 'pointerup' ? 32 : 0 });
        panel.style.left = `${position.x}px`; panel.style.top = `${position.y}px`;
        onPosition(position.x, position.y);
        const deltaX = before.left - bounds.left - position.x, deltaY = before.top - bounds.top - position.y;
        if (!matchMedia('(prefers-reduced-motion: reduce)').matches && Math.hypot(deltaX, deltaY) > .5) {
          const style = getComputedStyle(panel);
          docking.current = panel.animate([{ transform: `translate(${deltaX}px, ${deltaY}px)` }, { transform: 'none' }], { duration: workflowPanelMotionDuration(style.getPropertyValue('--workspace-motion-panel')), easing: style.getPropertyValue('--workspace-motion-ease').trim() || 'ease-out' });
        }
      }
      cleanup();
    };
    cleanupDrag.current = cleanup;
    target.addEventListener('pointermove', move); target.addEventListener('pointerup', finish); target.addEventListener('pointercancel', finish); target.addEventListener('lostpointercapture', finish);
  }}>
    {presentation === 'floating' && <button type="button" onClick={() => onChange('composer')} aria-label={t('Show composer', 'Tampilkan composer')} title={t('Show composer', 'Tampilkan composer')}><ChevronDown size={17} /></button>}
    {(status === 'working' || status === 'error') && <span className="ai-panel-activity" data-status={status} role="status" aria-label={statusLabel} title={statusLabel}>{status === 'working' ? <LoaderCircle size={15} /> : status === 'error' ? <TriangleAlert size={15} /> : null}</span>}
    <div className="ai-panel-title"><PhyniteAiIcon className="ai-panel-mark" size={16} />{presentation ? <button type="button" className="ai-panel-toggle" aria-label={presentation === 'composer' ? t('Expand conversation', 'Perluas percakapan') : t('Collapse conversation', 'Ringkas percakapan')} aria-expanded={presentation === 'floating'} onClick={toggle} title={title}>{title}</button> : <span className="ai-panel-toggle" title={title}>{title}</span>}<UiSelect compact portalOwner={tabId} ariaLabel={t('Side chat', 'Chat samping')} value={tabId} displayValue={<span className="sr-only">{title}</span>} options={[
      ...chats.map(chat => ({ value: chat.id, label: chat.title })),
      { value: 'new', label: t('New side chat', 'Chat samping baru') },
      ...(presentation ? [{ value: 'composer', label: t('Composer', 'Composer') }] : []),
      { value: 'delete', label: t('Delete chat from history', 'Hapus chat dari riwayat'), disabled: !conversations.some(chat => chat.id === tabId) },
      { value: 'clear', label: t('Clear project chat history', 'Bersihkan riwayat chat project'), disabled: !conversations.length },
    ]} onChange={value => { if (value === 'new') onNew(); else if (value === 'composer') onChange('composer'); else if (value === 'delete' || value === 'clear') onManage(value); else onSelect(value); }} /></div>
    {presentation && <button type="button" onClick={() => onChange('minimized')} aria-label={t('Hide Phynite AI', 'Sembunyikan Phynite AI')} title={t('Hide Phynite AI', 'Sembunyikan Phynite AI')}><Minus size={15} /></button>}
    {presentation && <button type="button" onClick={() => onChange('tab')} aria-label={t('Open chat as tab', 'Buka chat sebagai tab')} title={t('Open chat as tab', 'Buka chat sebagai tab')}><PhyniteAiIcon size={15} /></button>}
    {presentation && <span className="ai-panel-grip" role="button" tabIndex={0} aria-label={t('Move floating chat', 'Geser chat mengambang')} title={t('Drag to move · arrow keys to reposition', 'Seret untuk menggeser · tombol panah untuk memindahkan')} onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const panel = event.currentTarget.closest<HTMLElement>('.workflow-ai-editor'), bounds = panel?.parentElement?.getBoundingClientRect(), box = panel?.getBoundingClientRect();
      if (bounds && box) {
        panel!.getAnimations().forEach(animation => animation.cancel());
        const position = workflowFloatingPanelPosition({ x: box.left - bounds.left + (event.key === 'ArrowLeft' ? -24 : event.key === 'ArrowRight' ? 24 : 0), y: box.top - bounds.top + (event.key === 'ArrowUp' ? -24 : event.key === 'ArrowDown' ? 24 : 0) }, { width: panel!.offsetWidth, height: panel!.offsetHeight }, bounds, { inset: bounds.width <= 560 ? 6 : 14 });
        onPosition(position.x, position.y);
      }
    }}><GripVertical size={16} /></span>}
  </header>;
}

export function AiPanelResize({ onSize, onPosition }: { onSize: (width: number, height: number) => void; onPosition: (x: number, y: number) => void }) {
  const { t } = useLocale();
  const cleanupResize = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanupResize.current?.(), []);
  return <button type="button" className="ai-panel-resize" aria-label={t('Resize floating chat', 'Ubah ukuran chat mengambang')} title={t('Drag to resize · arrow keys to resize', 'Seret untuk mengubah ukuran · gunakan tombol panah')} onKeyDown={event => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault(); cleanupResize.current?.();
    const panel = event.currentTarget.closest<HTMLElement>('.workflow-ai-editor')!;
    panel.getAnimations().forEach(animation => animation.cancel());
    const box = panel.getBoundingClientRect();
    onSize(box.width + (event.key === 'ArrowLeft' ? -24 : event.key === 'ArrowRight' ? 24 : 0), box.height + (event.key === 'ArrowUp' ? -24 : event.key === 'ArrowDown' ? 24 : 0));
  }} onPointerDown={event => {
    if (!event.isPrimary || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation(); cleanupResize.current?.();
    const target = event.currentTarget, panel = target.closest<HTMLElement>('.workflow-ai-editor')!;
    panel.getAnimations().forEach(animation => animation.cancel());
    const box = panel.getBoundingClientRect(), bounds = panel.parentElement!.getBoundingClientRect();
    const inset = bounds.width <= 560 ? 6 : 14, startX = event.clientX, startY = event.clientY, pointerId = event.pointerId;
    let finished = false;
    const move = (point: PointerEvent) => {
      if (finished || point.pointerId !== pointerId) return;
      const width = Math.max(0, Math.min(bounds.width - inset * 2, Math.max(320, box.width + point.clientX - startX)));
      const height = Math.max(0, Math.min(bounds.height - inset * 2, Math.max(260, box.height + point.clientY - startY)));
      const position = workflowFloatingPanelPosition({ x: box.left - bounds.left, y: box.top - bounds.top }, { width, height }, bounds, { inset });
      // Preview variables never replace the canonical React-owned geometry.
      panel.style.setProperty('--workflow-resize-width', `${width}px`); panel.style.setProperty('--workflow-resize-height', `${height}px`);
      panel.style.setProperty('--workflow-resize-left', `${position.x}px`); panel.style.setProperty('--workflow-resize-top', `${position.y}px`);
      panel.dataset.aiResizing = 'true';
    };
    const cleanup = () => {
      if (finished) return;
      finished = true;
      target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', finish); target.removeEventListener('pointercancel', finish); target.removeEventListener('lostpointercapture', finish);
      window.removeEventListener('blur', cleanup); window.removeEventListener('keydown', escape, true);
      delete panel.dataset.aiResizing;
      for (const key of ['width', 'height', 'left', 'top']) panel.style.removeProperty(`--workflow-resize-${key}`);
      if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
      if (cleanupResize.current === cleanup) cleanupResize.current = null;
    };
    const escape = (key: KeyboardEvent) => { if (key.key === 'Escape') cleanup(); };
    const finish = (point: PointerEvent) => {
      if (finished || point.pointerId !== pointerId) return;
      if (point.type === 'pointerup') {
        move(point);
        const final = panel.getBoundingClientRect();
        // Position reads the preview's actual height before cleanup removes it.
        onPosition(final.left - bounds.left, final.top - bounds.top); onSize(final.width, final.height);
      }
      cleanup();
    };
    cleanupResize.current = cleanup;
    target.addEventListener('pointermove', move); target.addEventListener('pointerup', finish); target.addEventListener('pointercancel', finish); target.addEventListener('lostpointercapture', finish);
    window.addEventListener('blur', cleanup); window.addEventListener('keydown', escape, true);
    target.setPointerCapture(pointerId);
  }}><MoveDiagonal2 size={13} /></button>;
}

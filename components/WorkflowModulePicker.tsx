'use client';

import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { FlaskConical, Plus, Search, X } from 'lucide-react';
import { useLocale } from '@/app/locale-provider';
import { workflowModules, type WorkflowKind } from '@/lib/project-workflow';
import { WorkflowModuleIcon, workflowModuleSections } from './WorkflowStartTab';

export type WorkflowPickerPlacement = { x: number; y: number; above?: number; element?: HTMLElement };

export function WorkflowModulePicker({ placement, container, kinds, error, onAdd, onStudy, onClose, children }: {
  placement: WorkflowPickerPlacement; container: HTMLElement; kinds: WorkflowKind[]; error: string;
  onAdd: (kind: WorkflowKind) => void; onStudy?: () => void; onClose: (restoreFocus: boolean) => void; children: ReactNode;
}) {
  const { t } = useLocale(), [query, setQuery] = useState('');
  const card = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null);
  const close = useEffectEvent(onClose);
  const search = query.trim().toLocaleLowerCase();
  const sections = workflowModuleSections.map(section => ({ ...section, kinds: section.kinds.filter(kind => kinds.includes(kind) && `${workflowModules[kind].en} ${workflowModules[kind].id}`.toLocaleLowerCase().includes(search)) })).filter(section => section.kinds.length);

  const showStudy = Boolean(onStudy && (!search || 'parameter study studi parameter strain sweep volume'.includes(search)));

  useLayoutEffect(() => {
    const element = card.current;
    if (!element) return;
    let frame = 0;
    const viewport = window.visualViewport;
    const position = () => {
      const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? window.innerWidth, height = viewport?.height ?? window.innerHeight;
      const gutter = 12, cardWidth = width <= 600 ? width - gutter * 2 : Math.min(360, width - gutter * 2);
      element.style.width = `${Math.max(0, cardWidth)}px`;
      element.style.maxHeight = `${Math.min(480, Math.max(0, height - gutter * 2))}px`;
      const bounds = placement.element?.isConnected ? placement.element.getBoundingClientRect() : undefined;
      const anchor = bounds?.width ? { x: bounds.left, y: bounds.bottom + 6, above: bounds.top - 6 } : placement;
      const cardHeight = element.getBoundingClientRect().height;
      const below = top + height - gutter - anchor.y, above = (anchor.above ?? anchor.y) - top - gutter;
      const y = below < cardHeight && above > below ? (anchor.above ?? anchor.y) - cardHeight : anchor.y;
      element.style.left = `${Math.max(left + gutter, Math.min(anchor.x, left + width - cardWidth - gutter))}px`;
      element.style.top = `${Math.max(top + gutter, Math.min(y, top + height - cardHeight - gutter))}px`;
      element.style.visibility = 'visible';
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(position); };
    position(); input.current?.focus({ preventScroll: true });
    const observer = new ResizeObserver(schedule); observer.observe(element);
    window.addEventListener('resize', schedule);
    viewport?.addEventListener('resize', schedule); viewport?.addEventListener('scroll', schedule);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('resize', schedule); viewport?.removeEventListener('resize', schedule); viewport?.removeEventListener('scroll', schedule); };
  }, [placement]);

  useEffect(() => {
    // A closing mobile sidebar restores its trigger during passive cleanup.
    input.current?.focus({ preventScroll: true });
    const outside = (event: PointerEvent | FocusEvent) => { if (event.target instanceof Node && !card.current?.contains(event.target)) close(false); };
    document.addEventListener('pointerdown', outside); document.addEventListener('focusin', outside);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); };
  }, []);

  return createPortal(<div ref={card} className="workflow-picker" role="dialog" aria-modal="false" aria-labelledby="workflow-picker-title" onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(true); return; }
    const items = Array.from(card.current?.querySelectorAll<HTMLButtonElement>('[data-picker-kind]') ?? []);
    const index = items.indexOf(event.target as HTMLButtonElement), searching = event.target === input.current;
    if (['ArrowUp', 'ArrowDown'].includes(event.key) && (searching || index >= 0)) {
      event.preventDefault();
      const next = searching ? event.key === 'ArrowDown' ? items[0] : items.at(-1) : items[index + (event.key === 'ArrowDown' ? 1 : -1)];
      (next ?? input.current)?.focus({ preventScroll: true });
      next?.scrollIntoView({ block: 'nearest' });
    } else if (index >= 0 && ['Home', 'End'].includes(event.key)) { event.preventDefault(); (event.key === 'Home' ? items[0] : items.at(-1))?.focus(); }
    else if (searching && event.key === 'Enter') { event.preventDefault(); items[0]?.click(); }
  }}>
    <header><h2 id="workflow-picker-title">{t('Add module', 'Tambah modul')}</h2><button type="button" aria-label={t('Close', 'Tutup')} onClick={() => onClose(true)}><X size={16} /></button></header>
    <label className="workflow-palette-search"><Search size={16} aria-hidden="true" /><input ref={input} type="search" aria-label={t('Find module', 'Cari modul')} placeholder={t('Find a module…', 'Cari modul…')} value={query} onChange={event => setQuery(event.target.value)} /><kbd>Esc</kbd></label>
    {error && <p className="workflow-picker-error" role="alert">{error}</p>}
    <div className="workflow-picker-list">{sections.map(section => <section key={section.en} aria-label={t(section.en, section.id)}><h3>{t(section.en, section.id)}</h3>{section.kinds.map(kind => <button type="button" data-picker-kind={kind} key={kind} onClick={() => onAdd(kind)}><WorkflowModuleIcon kind={kind} size={16} /><span>{t(workflowModules[kind].en, workflowModules[kind].id)}</span><Plus size={14} aria-hidden="true" /></button>)}</section>)}{showStudy && <section aria-label={t('Studies', 'Studi')}><h3>{t('Studies', 'Studi')}</h3><button type="button" data-picker-kind="parameter-study" onClick={onStudy}><FlaskConical size={16} /><span>{t('Parameter study', 'Studi parameter')}</span><Plus size={14} /></button></section>}{!sections.length && !showStudy && <p className="workflow-picker-empty">{t('No matching modules.', 'Tidak ada modul yang cocok.')}</p>}</div>
    <footer>{children}</footer>
  </div>, container);
}

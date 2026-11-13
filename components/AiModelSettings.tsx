'use client';

import { Check, ChevronDown, X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useLocale } from '@/app/locale-provider';
import type { AiEffort } from '@/lib/ai-contract';
import { useAiOverlayModal, useAiOverlayPosition } from './use-ai-overlay';

type ModelOption = { value: string; label: string; disabled?: boolean };
const effortNames: Record<AiEffort, string> = { auto: 'Auto', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Xhigh', max: 'Max' };

/** Model/effort are separate choices in one dialog, anchored to the owning composer. */
export function AiModelSettings({ portalOwner, open, onOpenChange, value, label, options, effort, efforts, disabled, onModel, onEffort, children, summary }: {
  children?: ReactNode; summary?: ReactNode; portalOwner: string; open: boolean; onOpenChange: (open: boolean) => void; value: string; label: string; options: ModelOption[]; effort: AiEffort; efforts: readonly AiEffort[]; disabled: boolean;
  onModel: (value: string) => void | Promise<void>; onEffort: (value: AiEffort) => void | Promise<void>;
}) {
  const { t } = useLocale(), menuId = useId(), trigger = useRef<HTMLButtonElement>(null), root = useRef<HTMLDivElement>(null), layer = useRef<HTMLDivElement>(null);
  const placement = useAiOverlayPosition({ open, anchorRef: trigger, rootRef: root, align: 'end' });
  const modal = open && placement.sheet;
  useAiOverlayModal(modal, root, layer);
  const focusFrame = useRef(0);
  const close = () => {
    onOpenChange(false);
    cancelAnimationFrame(focusFrame.current);
    focusFrame.current = requestAnimationFrame(() => {
      const target = trigger.current;
      if (target?.isConnected) (target.disabled ? target.closest('.ai-composer-box')?.querySelector<HTMLElement>('textarea') : target)?.focus({ preventScroll: true });
    });
  };
  useEffect(() => () => cancelAnimationFrame(focusFrame.current), []);
  useEffect(() => {
    if (!open || modal) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) onOpenChange(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open, modal, onOpenChange]);
  useEffect(() => {
    if (open && placement.style.visibility === 'visible') (root.current?.querySelector<HTMLButtonElement>('[data-model-choice][aria-checked=true]:not(:disabled)') ?? root.current?.querySelector<HTMLButtonElement>('[data-model-choice]:not(:disabled)') ?? root.current?.querySelector<HTMLButtonElement>('button'))?.focus({ preventScroll: true });
  }, [open, placement.style.visibility]);
  const choose = async (button: HTMLButtonElement, dismiss: boolean) => {
    if (button.disabled) return;
    // Saving disables this radio; keep Escape within the dialog while it waits.
    const focusOwner = root.current;
    focusOwner?.focus({ preventScroll: true });
    if (button.dataset.modelChoice !== undefined) await onModel(button.dataset.modelChoice);
    else if (button.dataset.effortChoice) await onEffort(button.dataset.effortChoice as AiEffort);
    if (!root.current?.isConnected) return;
    if (dismiss) close();
    else requestAnimationFrame(() => { if (document.activeElement === focusOwner && button.isConnected && !button.disabled) button.focus({ preventScroll: true }); });
  };
  const radioKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const group = (event.target as Element).closest('[role=radiogroup]');
    if (!group) return;
    const buttons = Array.from(group.querySelectorAll<HTMLButtonElement>('[role=radio]:not(:disabled)'));
    if (!buttons.length) return;
    event.preventDefault();
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement), direction = ['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : -1;
    const next = buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + direction + buttons.length) % buttons.length];
    next.focus({ preventScroll: true }); void choose(next, false);
  };
  const firstModel = options.find(item => !item.disabled)?.value;
  return <><button ref={trigger} type="button" className="ai-model-trigger" aria-label={t('AI model', 'Model AI')} aria-haspopup="dialog" aria-controls={menuId} aria-expanded={open} disabled={disabled} onClick={() => onOpenChange(!open)}><span>{label}</span><small>{summary ?? effortNames[effort]}</small><ChevronDown size={13} aria-hidden="true" /></button>{open && typeof document !== 'undefined' && createPortal(<div ref={layer} className="ai-composer-overlay-layer" data-ui-owner={portalOwner}>
    {modal && <button type="button" className="ai-overlay-backdrop" tabIndex={-1} aria-hidden="true" data-ui-owner={portalOwner} onClick={close} />}
    <div ref={root} id={menuId} className="ai-model-menu ai-overlay" data-ui-owner={portalOwner} data-sheet={placement.sheet} style={placement.style} role="dialog" aria-modal={modal || undefined} aria-label={t('Model and effort', 'Model dan effort')} tabIndex={-1} onBlur={event => { if (!modal && event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget) && !trigger.current?.contains(event.relatedTarget)) onOpenChange(false); }} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
      radioKeys(event);
    }}><header><strong>{t('Model and effort', 'Model dan effort')}</strong><button type="button" aria-label={t('Close model settings', 'Tutup pengaturan model')} onClick={close}><X size={16} /></button></header>
      <div className="ai-model-menu-scroll" data-ai-overlay-scroll>
        {options.length > 0 ? <div role="radiogroup" aria-label={t('AI model', 'Model AI')}>{options.map(option => <button type="button" key={option.value} role="radio" aria-checked={value === option.value} data-model-choice={option.value} tabIndex={value === option.value || !options.some(item => item.value === value && !item.disabled) && option.value === firstModel ? 0 : -1} disabled={disabled || option.disabled} onClick={event => void choose(event.currentTarget, false)}><span>{option.label}{option.disabled && <small>{t('Unavailable', 'Belum tersedia')}</small>}</span>{value === option.value && <Check size={14} aria-hidden="true" />}</button>)}</div> : <div className="ai-model-empty" role="status"><strong>{t('No verified models yet', 'Belum ada model terverifikasi')}</strong><p>{t('Sign in to a local AI provider. Models appear automatically when ready.', 'Login ke provider AI lokal. Model muncul otomatis setelah siap.')}</p><Link href="/account/ai-providers">{t('Open AI provider settings', 'Buka pengaturan provider AI')}</Link></div>}
        <section className="ai-model-efforts"><h3>{t('Effort', 'Effort')}</h3><div role="radiogroup" aria-label={t('AI effort', 'Effort AI')}>{efforts.map(level => <button type="button" key={level} role="radio" aria-checked={effort === level} tabIndex={effort === level ? 0 : -1} data-effort-choice={level} disabled={disabled} onClick={event => void choose(event.currentTarget, true)}>{effortNames[level]}</button>)}</div></section>
        {children}
      </div>
    </div></div>, document.body)}</>;
}

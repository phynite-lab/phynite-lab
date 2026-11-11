'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Check, ChevronDown } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode, type SetStateAction } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

export type UiSelectOption = {
  value: string;
  label: string;
  detail?: string;
  disabled?: boolean;
};

export function UiSelect({ label, ariaLabel, value, displayValue, options, onChange, mono = false, compact = false, disabled = false, portalOwner, open: controlledOpen, onOpenChange }: { label?: string; ariaLabel?: string; value: string; displayValue?: ReactNode; options: UiSelectOption[]; onChange: (value: string) => void; mono?: boolean; compact?: boolean; disabled?: boolean; portalOwner?: string; open?: boolean; onOpenChange?: (open: boolean) => void }) {
  const id = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef({ text: '', time: 0 });
  const reducedMotion = useReducedMotion();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = useCallback((next: SetStateAction<boolean>) => {
    const value = typeof next === 'function' ? next(open) : next;
    setInternalOpen(value); onOpenChange?.(value);
  }, [open, onOpenChange]);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 180, maxHeight: 260, upward: false, bottom: 0 });
  const selected = options.find((option) => option.value === value) ?? options[0];
  const enabledIndexes = useMemo(() => options.flatMap((option, index) => option.disabled ? [] : [index]), [options]);

  const nextEnabledIndex = useCallback((current: number, direction: 1 | -1) => {
    if (!enabledIndexes.length) return current;
    const position = enabledIndexes.indexOf(current);
    if (position === -1) return direction === 1 ? enabledIndexes[0] : enabledIndexes.at(-1)!;
    return enabledIndexes[(position + direction + enabledIndexes.length) % enabledIndexes.length];
  }, [enabledIndexes]);

  const resolveTarget = () =>
    buttonRef.current?.closest<HTMLElement>('[data-ui-portal]') ??
    buttonRef.current?.closest<HTMLDialogElement>('dialog[open]') ??
    document.body;

  const positionMenu = (targetElement?: HTMLElement | null) => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const target = targetElement !== undefined ? targetElement : portalTarget;
    const isTargetCustom = Boolean(target && target !== document.body);

    if (isTargetCustom && target) {
      const targetRect = target.getBoundingClientRect();
      const originLeft = targetRect.left + target.clientLeft - target.scrollLeft;
      const originTop = targetRect.top + target.clientTop - target.scrollTop;
      const targetVisibleTop = targetRect.top + target.clientTop;
      const targetVisibleBottom = targetRect.bottom - target.clientTop;

      const menuHeight = Math.min(options.reduce((height, option) => height + (option.detail ? 42 : compact ? 30 : 38), 10) + Math.max(0, options.length - 1) * (compact ? 2 : 6), 260);
      const spaceBelow = Math.max(0, targetVisibleBottom - rect.bottom - 6);
      const spaceAbove = Math.max(0, rect.top - targetVisibleTop - 6);
      const upward = spaceBelow < menuHeight && spaceAbove > spaceBelow;
      const maxHeight = Math.min(260, upward ? spaceAbove : spaceBelow);

      const maxAvailableWidth = Math.max(0, target.clientWidth - 16);
      const width = Math.max(0, Math.min(Math.max(rect.width, compact ? 200 : 220), maxAvailableWidth));
      const triggerLeftInTarget = rect.left - originLeft;
      const minLeft = 8;
      const maxLeft = Math.max(minLeft, target.clientWidth - width - 8);
      const left = Math.max(minLeft, Math.min(triggerLeftInTarget, maxLeft));

      const top = rect.bottom + 6 - originTop;
      const bottom = (target.clientHeight - (rect.top - originTop)) + 6;

      setPosition({ left, top, bottom, width, maxHeight, upward });
      return;
    }

    const viewportGutter = 12, viewport = window.visualViewport;
    const viewportLeft = (viewport?.offsetLeft ?? 0) + viewportGutter, viewportTop = (viewport?.offsetTop ?? 0) + viewportGutter;
    const viewportRight = (viewport?.offsetLeft ?? 0) + (viewport?.width ?? window.innerWidth) - viewportGutter;
    const viewportBottom = (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight) - viewportGutter;
    const menuHeight = Math.min(options.reduce((height, option) => height + (option.detail ? 42 : compact ? 30 : 38), 10) + Math.max(0, options.length - 1) * (compact ? 2 : 6), 260);
    const spaceBelow = Math.max(0, viewportBottom - rect.bottom - 6);
    const spaceAbove = Math.max(0, rect.top - viewportTop - 6);
    const upward = spaceBelow < menuHeight && spaceAbove > spaceBelow;
    const maxHeight = Math.min(260, upward ? spaceAbove : spaceBelow);
    const width = Math.max(0, Math.min(Math.max(rect.width, compact ? 200 : 220), viewportRight - viewportLeft));
    const left = Math.max(viewportLeft, Math.min(rect.left, viewportRight - width));
    setPosition({ left, top: rect.bottom + 6, bottom: window.innerHeight - rect.top + 6, width, maxHeight, upward });
  };

  const toggle = () => {
    if (disabled) return;
    if (!open) {
      // Native modal dialogs live in the top layer; a body portal sits behind them.
      const target = resolveTarget();
      setPortalTarget(target);
      positionMenu(target);
      const selectedIndex = options.findIndex((option) => option.value === value && !option.disabled);
      setActiveIndex(selectedIndex >= 0 ? selectedIndex : enabledIndexes[0] ?? 0);
    }
    setOpen((current) => !current);
  };

  useEffect(() => {
    if (!open) return;
    const anchor = buttonRef.current?.getBoundingClientRect();
    const closeOnOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!buttonRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const closeOnKey = (event: KeyboardEvent) => {
      if (event.key === 'Tab') { setOpen(false); return; }
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        buttonRef.current?.focus();
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        setActiveIndex((current) => nextEnabledIndex(current, direction));
        return;
      }
      if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        setActiveIndex(event.key === 'Home' ? enabledIndexes[0] ?? 0 : enabledIndexes.at(-1) ?? 0);
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        const option = options[activeIndex];
        if (option && !option.disabled) onChange(option.value);
        setOpen(false);
        buttonRef.current?.focus();
        return;
      }
      if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        const now = Date.now();
        const previous = now - searchRef.current.time < 600 ? searchRef.current.text : '';
        const text = `${previous}${event.key.toLowerCase()}`;
        searchRef.current = { text, time: now };
        const match = enabledIndexes.find((index) => options[index].label.toLowerCase().startsWith(text));
        if (match !== undefined) setActiveIndex(match);
      }
    };
    const closeOnViewportChange = (event: Event) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      if (event.currentTarget === window.visualViewport) { setOpen(false); return; }
      if (event.type === 'scroll') {
        const current = buttonRef.current?.getBoundingClientRect();
        // A queued scroll event from bringing the trigger into view is harmless.
        if (anchor && current && Math.abs(current.top - anchor.top) < 1 && Math.abs(current.left - anchor.left) < 1) return;
      }
      setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutside);
    document.addEventListener('keydown', closeOnKey);
    window.addEventListener('resize', closeOnViewportChange);
    window.addEventListener('scroll', closeOnViewportChange, true);
    window.visualViewport?.addEventListener('resize', closeOnViewportChange);
    window.visualViewport?.addEventListener('scroll', closeOnViewportChange);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
      document.removeEventListener('keydown', closeOnKey);
      window.removeEventListener('resize', closeOnViewportChange);
      window.removeEventListener('scroll', closeOnViewportChange, true);
      window.visualViewport?.removeEventListener('resize', closeOnViewportChange);
      window.visualViewport?.removeEventListener('scroll', closeOnViewportChange);
    };
  }, [activeIndex, enabledIndexes, nextEnabledIndex, onChange, open, options, setOpen]);

  useEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    const option = document.getElementById(`${id}-option-${activeIndex}`);
    if (!menu || !option) return;
    // Scroll only the listbox; scrollIntoView can move the page and close the menu.
    if (option.offsetTop < menu.scrollTop) menu.scrollTop = option.offsetTop;
    else if (option.offsetTop + option.offsetHeight > menu.scrollTop + menu.clientHeight) {
      menu.scrollTop = option.offsetTop + option.offsetHeight - menu.clientHeight;
    }
  }, [activeIndex, id, open]);

  const menu = <AnimatePresence>{open && <motion.div ref={menuRef} data-ui-owner={portalOwner} id={`${id}-menu`} role="listbox" aria-label={label ?? ariaLabel} initial={{ opacity: 0, y: position.upward ? 5 : -5, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: position.upward ? 5 : -5, scale: 0.985 }} transition={{ duration: reducedMotion ? 0 : 0.13, ease: [0.2, 0.8, 0.2, 1] }} style={{ left: position.left, top: position.upward ? undefined : position.top, bottom: position.upward ? position.bottom : undefined, width: position.width, maxHeight: position.maxHeight }} className={cn('ui-select-menu', compact && 'ui-select-menu--compact', position.upward && 'ui-select-menu--upward')}>{options.map((option, index) => { const selectedOption = option.value === value; const highlighted = index === activeIndex; return <button id={`${id}-option-${index}`} key={option.value} type="button" tabIndex={-1} role="option" aria-label={option.label} aria-describedby={option.detail ? `${id}-detail-${index}` : undefined} aria-selected={selectedOption} aria-disabled={option.disabled || undefined} disabled={option.disabled} data-highlighted={highlighted || undefined} onPointerMove={() => { if (!option.disabled) setActiveIndex(index); }} onClick={() => { if (option.disabled) return; onChange(option.value); setOpen(false); buttonRef.current?.focus(); }} className="ui-select-option group"><span className="min-w-0 flex-1"><span className={cn('ui-select-option-label', mono && 'font-mono')}>{option.label}</span>{option.detail && <span id={`${id}-detail-${index}`} className="ui-select-option-detail">{option.detail}</span>}</span>{compact && selectedOption && <Check size={13} aria-hidden="true" />}</button>; })}</motion.div>}</AnimatePresence>;

  return <div className={cn('ui-select block min-w-0', compact && 'ui-select--compact')}>{label && <span id={`${id}-label`} className="ui-select-label">{label}</span>}<button ref={buttonRef} type="button" disabled={disabled} role="combobox" aria-label={!label ? ariaLabel : undefined} aria-labelledby={label ? `${id}-label` : undefined} aria-controls={`${id}-menu`} aria-activedescendant={open ? `${id}-option-${activeIndex}` : undefined} aria-expanded={open} aria-haspopup="listbox" onClick={toggle} onKeyDown={(event) => { if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) { event.preventDefault(); toggle(); } }} className="ui-select-trigger"><span className={cn('ui-select-value', mono && 'font-mono')}>{displayValue ?? selected?.label ?? value}</span><span className="ui-select-chevron" aria-hidden="true"><ChevronDown className={cn('transition-transform', open && 'rotate-180')} /></span></button>{typeof document !== 'undefined' && createPortal(menu, portalTarget ?? document.body)}</div>;
}

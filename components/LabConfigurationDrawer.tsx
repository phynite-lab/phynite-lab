'use client';

import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import '@/app/lab-configuration-drawer.css';

export type LabConfigurationDrawerMode<T extends string = string> = {
  id: T;
  label: string;
};

export function LabConfigurationDrawer<T extends string>({
  ariaLabel,
  icon,
  title,
  subtitle,
  mode,
  modes,
  onModeChange,
  actions,
  children,
  footer,
  onClose,
  className,
  embedded = false,
}: {
  embedded?: boolean;
  ariaLabel: string;
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  mode: T;
  modes: Array<LabConfigurationDrawerMode<T>>;
  onModeChange: (mode: T) => void;
  actions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  className?: string;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const commitFocusedField = () => {
    const focused = document.activeElement;
    if (focused instanceof HTMLInputElement && dialogRef.current?.contains(focused)) focused.blur();
  };
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || embedded) return;
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'))
      .filter((element) => !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true');
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusFrame = window.requestAnimationFrame(() => {
      if (!dialog.contains(document.activeElement)) (focusable()[0] ?? dialog).focus();
    });
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === 'Escape') {
        // The select owns the first Escape; keep the containing drawer open.
        if (dialog.querySelector('[role="combobox"][aria-expanded="true"]')) return;
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = items[0];
      const last = items.at(-1)!;
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', keydown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener('keydown', keydown);
      previousFocus?.focus();
    };
  }, [embedded]);
  return <div className={embedded ? 'workflow-embedded-config' : 'lab-config-drawer-layer'}>
    {!embedded && <button type="button" className="lab-config-drawer-backdrop" aria-label="Close configuration" onPointerDown={commitFocusedField} onClick={onClose} />}
    <section
      ref={dialogRef}
      tabIndex={-1}
      role={embedded ? undefined : 'dialog'}
      aria-modal={embedded ? undefined : 'true'}
      aria-label={ariaLabel}
      className={cn('lab-config-drawer workspace-dark-surface', className)}
    >
      <header className="lab-config-drawer-header">
        <div className="lab-config-drawer-identity">
          {icon && <span className="lab-config-drawer-icon" aria-hidden="true">{icon}</span>}
          <span className="lab-config-drawer-title"><strong>{title}</strong>{subtitle && <small>{subtitle}</small>}</span>
        </div>
        <div className="lab-config-drawer-actions">{actions}</div>
        <div className="lab-config-drawer-modes" role="tablist" aria-label="Configuration mode">
          {modes.map((item) => <button key={item.id} type="button" role="tab" aria-selected={mode === item.id} onClick={() => onModeChange(item.id)}>{item.label}</button>)}
        </div>
        <button type="button" className="lab-icon-button lab-config-drawer-close" onPointerDown={commitFocusedField} onClick={onClose} aria-label="Close configuration"><X size={16} /></button>
      </header>
      <div className="lab-config-drawer-body">{children}</div>
      {footer && <footer className="lab-config-drawer-footer">{footer}</footer>}
    </section>
  </div>;
}

'use client';

import type { KeyboardEvent } from 'react';
import './configuration-mode-control.css';

export type ConfigurationMode<T extends string> = { id: T; label: string; description?: string };

/** Modes select how inputs are edited; they are a single radio group, not navigation tabs. */
export function ConfigurationModeControl<T extends string>({ value, options, onChange, label, descriptionId, className = '' }: {
  value: T;
  options: ConfigurationMode<T>[];
  onChange: (value: T) => void;
  label: string;
  descriptionId?: string;
  className?: string;
}) {
  const selected = options.some(option => option.id === value) ? value : options[0]?.id;
  const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
    const current = buttons.indexOf(event.target as HTMLButtonElement);
    if (current < 0 || !buttons.length) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : (current + (event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].focus();
    if (options[next].id !== value) onChange(options[next].id);
  };
  return <div className={`configuration-mode-control ${className}`} role="radiogroup" aria-label={label} aria-describedby={descriptionId} onKeyDown={navigate} onPointerDownCapture={() => {
    // Flush pending numeric/text edits before the selected mode unmounts them.
    const active = document.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) active.blur();
  }}>
    {options.map(option => <button key={option.id} type="button" role="radio" aria-checked={value === option.id} aria-describedby={value === option.id ? descriptionId : undefined} tabIndex={selected === option.id ? 0 : -1} title={option.description} onClick={() => { if (option.id !== value) onChange(option.id); }}>{option.label}</button>)}
  </div>;
}

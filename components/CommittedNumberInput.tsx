'use client';

import { useState, type InputHTMLAttributes, type KeyboardEvent } from 'react';

type CommittedNumberInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'defaultValue' | 'onChange'> & {
  value: number;
  onCommit: (value: number) => void;
};

function clamp(value: number, min?: number | string, max?: number | string) {
  const minimum = typeof min === 'number' ? min : min === undefined ? undefined : Number(min);
  const maximum = typeof max === 'number' ? max : max === undefined ? undefined : Number(max);
  return Math.min(maximum ?? Number.POSITIVE_INFINITY, Math.max(minimum ?? Number.NEGATIVE_INFINITY, value));
}

export function CommittedNumberInput({ value, onCommit, min, max, onBlur, onFocus, onKeyDown, ...props }: CommittedNumberInputProps) {
  const [draft, setDraft] = useState(String(value));
  const [editing, setEditing] = useState(false);

  const commit = () => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const next = clamp(parsed, min, max);
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      event.currentTarget.blur();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setDraft(String(value));
      event.currentTarget.select();
    }
  };

  return <input {...props} type="number" min={min} max={max} value={editing ? draft : String(value)} onFocus={(event) => { setDraft(String(value)); setEditing(true); onFocus?.(event); }} onChange={(event) => setDraft(event.target.value)} onBlur={(event) => { commit(); setEditing(false); onBlur?.(event); }} onKeyDown={handleKeyDown} />;
}

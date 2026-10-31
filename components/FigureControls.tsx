'use client';

import { Children, isValidElement, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { UiSelect, type UiSelectOption } from './UiSelect';
import { FIGURE_COLORS } from '@/lib/research-figures';

export function FigureSelect({ children, value, onChange, 'aria-label': label, disabled = false }: { children: ReactNode; value: string; onChange: (value: string) => void; 'aria-label': string; disabled?: boolean }) {
  const options = Children.toArray(children).filter(isValidElement).map((child) => {
    const option = child.props as { value: string; children: ReactNode; disabled?: boolean };
    return { value: String(option.value), label: Children.toArray(option.children).join(''), disabled: option.disabled } satisfies UiSelectOption;
  });
  return <UiSelect ariaLabel={label} value={value} onChange={onChange} options={options} compact disabled={disabled} />;
}

export function FigureColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const cancelled = useRef(false);
  const paletteButton = useRef<HTMLButtonElement>(null);
  return <div className="research-color-field" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }} onKeyDown={(event) => {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); paletteButton.current?.focus(); }
  }}>
    <div className="research-color-input">
      <span style={{ background: value }} aria-hidden="true" />
      <input aria-label={label} value={draft ?? value} spellCheck={false} maxLength={7}
        onFocus={() => { cancelled.current = false; setDraft(null); }}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            event.preventDefault(); event.stopPropagation();
            cancelled.current = true; setDraft(null); event.currentTarget.blur();
          }
        }}
        onBlur={() => {
          if (!cancelled.current && draft && /^#[0-9a-f]{6}$/i.test(draft) && draft.toLowerCase() !== value.toLowerCase()) onChange(draft.toLowerCase());
          setDraft(null);
        }} />
      <button ref={paletteButton} type="button" aria-label={`Palette for ${label}`} aria-expanded={open} onClick={() => setOpen((value) => !value)}><ChevronDown size={13} /></button>
    </div>
    {open && <div className="research-color-palette" role="group" aria-label={`${label} palette`}>{[...FIGURE_COLORS, '#ffffff', '#000000'].map((color) => <button key={color} type="button" title={color} aria-label={`${label} ${color}`} aria-pressed={color.toLowerCase() === value.toLowerCase()} style={{ background: color }} onClick={() => { if (color.toLowerCase() !== value.toLowerCase()) onChange(color); setDraft(null); setOpen(false); paletteButton.current?.focus(); }} />)}</div>}
  </div>;
}

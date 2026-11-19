'use client';

import type { ReactNode } from 'react';
import { CommittedNumberInput } from './CommittedNumberInput';
import '@/app/configuration-fields.css';

/** Units stay attached to the readout; the input retains its exact commit rules. */
export function ConfigurationNumberField({ label, value, unit, min, max, step = 1, onChange }: {
  label: string; value: number; unit?: string; min?: number; max?: number; step?: number; onChange: (value: number) => void;
}) {
  return <label className="configuration-field">
    <span className="configuration-field-label">{label}</span>
    <span className="configuration-field-control">
      <CommittedNumberInput value={value} min={min} max={max} step={step} onCommit={onChange} />
      {unit && <span className="configuration-field-unit">{unit}</span>}
    </span>
  </label>;
}

export function ConfigurationTextField({ label, value, mono = false, onChange }: {
  label: string; value: string; mono?: boolean; onChange: (value: string) => void;
}) {
  return <label className="configuration-field">
    <span className="configuration-field-label">{label}</span>
    <input className={`configuration-text-input${mono ? ' is-mono' : ''}`} value={value} onChange={event => onChange(event.target.value)} />
  </label>;
}

export function ConfigurationSectionHeading({ children, detail, code }: { children: ReactNode; detail?: string; code?: string }) {
  return <header className="configuration-section-heading"><div><h3>{children}</h3>{detail && <span>{detail}</span>}</div>{code && <code>{code}</code>}</header>;
}

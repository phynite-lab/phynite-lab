'use client';

import { Check, ChevronDown } from 'lucide-react';
import { useId, useState, type CSSProperties, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

type LabCheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> & {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  children?: ReactNode;
};

export function LabCheckbox({ checked, onCheckedChange, children, className, disabled, ...props }: LabCheckboxProps) {
  return <label className={cn('lab-checkbox', disabled && 'is-disabled', className)}>
    <input {...props} type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onCheckedChange(event.target.checked)} />
    <span className="lab-checkbox-control" aria-hidden="true">{checked && <Check size={11} strokeWidth={3} />}</span>
    {children && <span className="lab-checkbox-label">{children}</span>}
  </label>;
}

type LabSwitchProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> & {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  children?: ReactNode;
};

export function LabSwitch({ checked, onCheckedChange, children, className, disabled, ...props }: LabSwitchProps) {
  return <label className={cn('lab-switch', disabled && 'is-disabled', className)}>
    {children && <span className="lab-switch-label">{children}</span>}
    <input {...props} type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(event) => onCheckedChange(event.target.checked)} />
    <span className="lab-switch-track" aria-hidden="true"><span /></span>
  </label>;
}

type LabSliderProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange' | 'value'> & {
  value: number;
  onValueChange: (value: number) => void;
};

export function LabSlider({ value, onValueChange, min = 0, max = 100, className, style, ...props }: LabSliderProps) {
  const lower = Number(min);
  const upper = Number(max);
  const progress = upper === lower ? 0 : Math.max(0, Math.min(100, ((value - lower) / (upper - lower)) * 100));
  return <input
    {...props}
    type="range"
    min={min}
    max={max}
    value={value}
    onChange={(event) => onValueChange(Number(event.target.value))}
    className={cn('lab-slider', className)}
    style={{ ...style, '--lab-slider-progress': `${progress}%` } as CSSProperties}
  />;
}

export function LabInspectorSection({ title, icon, trailing, children, open: controlledOpen, defaultOpen = true, onOpenChange, className }: {
  title: ReactNode;
  icon?: ReactNode;
  trailing?: ReactNode;
  children: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}) {
  const regionId = useId();
  const [localOpen, setLocalOpen] = useState(defaultOpen);
  const open = controlledOpen ?? localOpen;
  const toggle = () => {
    const next = !open;
    if (controlledOpen === undefined) setLocalOpen(next);
    onOpenChange?.(next);
  };
  return <section className={cn('lab-inspector-section', className)} data-open={open || undefined}>
    <button type="button" className="lab-inspector-section-header" aria-expanded={open} aria-controls={regionId} onClick={toggle}>
      <span className="lab-inspector-section-title">{icon}<strong>{title}</strong></span>
      <span className="lab-inspector-section-actions">{trailing}<ChevronDown size={15} className="lab-inspector-section-chevron" aria-hidden="true" /></span>
    </button>
    {open && <div id={regionId} className="lab-inspector-section-body">{children}</div>}
  </section>;
}

'use client';

import { ArrowDown, ArrowUp, Check, Eye, Layers3, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { CommittedNumberInput } from './CommittedNumberInput';
import { UiSelect } from './UiSelect';
import {
  modifierLabels, newCrystalModifier, type CrystalModifier, type ModifierKind,
  type previewCrystalModifiers,
} from '@/lib/crystal-builder';
import type { CellVector } from '@/lib/crystal-cell';

type Preview = ReturnType<typeof previewCrystalModifiers>;

function VectorFields({ label, value, onChange, integer = false }: { label: string; value: CellVector; onChange: (value: CellVector) => void; integer?: boolean }) {
  return <fieldset className="crystal-tool-vector"><legend>{label}</legend><div>{value.map((n, axis) => <label key={axis}><span>{(integer ? ['a', 'b', 'c'] : ['X', 'Y', 'Z'])[axis]}</span><CommittedNumberInput aria-label={`${label} ${['X', 'Y', 'Z'][axis]}`} value={n} step={integer ? 1 : 0.1} min={integer ? 1 : undefined} max={integer ? 8 : undefined} onCommit={(next) => onChange(value.map((old, i) => i === axis ? next : old) as CellVector)} /></label>)}</div></fieldset>;
}

function ModifierFields({ modifier: m, onChange }: { modifier: CrystalModifier; onChange: (next: CrystalModifier) => void }) {
  switch (m.kind) {
    case 'replicate': return <><VectorFields label="Repeat along lattice vectors" value={m.repeat} integer onChange={(repeat) => onChange({ ...m, repeat })} /><p>Creates atoms in the saved structure and calculation input. Repeating a nonperiodic direction creates separate copies.</p></>;
    case 'vacuum': return <><label className="crystal-tool-field"><span>Added vacuum <small>Å</small></span><CommittedNumberInput aria-label="Added vacuum in angstrom" value={m.thickness} step={1} min={0.01} onCommit={(thickness) => onChange({ ...m, thickness })} /></label><p>Extends the cell normal to a × b and centers the atoms in the added space.</p></>;
    case 'translate': return <><div className="crystal-tool-field"><span>Coordinates</span><UiSelect value={m.space} options={[{ value: 'cartesian', label: 'Cartesian · Å' }, { value: 'fractional', label: 'Fractional · a, b, c' }]} onChange={(value) => onChange({ ...m, space: value as typeof m.space })} /></div><VectorFields label="Translation" value={m.offset} onChange={(offset) => onChange({ ...m, offset })} /><p>Moves every atom. Add Wrap into cell after this step to wrap periodic coordinates.</p></>;
    case 'wrap': return <p>Wraps atoms into [0, 1) along periodic lattice directions. Finite directions retain their coordinates.</p>;
    case 'slice': return <><VectorFields label="Cartesian plane normal" value={m.normal} onChange={(normal) => onChange({ ...m, normal })} /><label className="crystal-tool-field"><span>Distance from origin <small>Å</small></span><CommittedNumberInput aria-label="Slice distance in angstrom" value={m.distance} step={0.1} onCommit={(distance) => onChange({ ...m, distance })} /></label><div className="crystal-tool-field"><span>Keep side</span><UiSelect value={m.reverse ? 'below' : 'above'} options={[{ value: 'above', label: 'n · r ≥ distance' }, { value: 'below', label: 'n · r ≤ distance' }]} onChange={(value) => onChange({ ...m, reverse: value === 'below' })} /></div><p>Uses the normalized Cartesian normal. Removes sites on the other side when applied; the cell and periodicity stay fixed.</p></>;
    case 'filter': return <><label className="crystal-tool-expression"><span>Match atoms</span><textarea aria-label="Atom filter expression" spellCheck={false} rows={3} maxLength={500} value={m.expression} onChange={(event) => onChange({ ...m, expression: event.target.value })} /></label><div className="crystal-tool-field"><span>Matching atoms</span><UiSelect value={m.keep ? 'keep' : 'remove'} options={[{ value: 'keep', label: 'Keep matches' }, { value: 'remove', label: 'Remove matches' }]} onChange={(value) => onChange({ ...m, keep: value === 'keep' })} /></div><p>Position.X/Y/Z in Å · Fractional.X/Y/Z · Species. Combine comparisons with <code>&&</code> or <code>||</code>.</p><button className="crystal-text-button" type="button" onClick={() => onChange({ ...m, expression: 'Species == "Si" && Fractional.Z >= 0.5' })}>Use Si + upper-half example</button></>;
  }
}

export function CrystalBuilderTools({ modifiers, onChange, preview, originalCount, onApply }: {
  modifiers: CrystalModifier[];
  onChange: (modifiers: CrystalModifier[]) => void;
  preview: Preview;
  originalCount: number;
  onApply: () => void;
}) {
  const [addKind, setAddKind] = useState<ModifierKind>('replicate');
  const enabled = modifiers.filter((modifier) => modifier.enabled).length;
  const update = (next: CrystalModifier) => onChange(modifiers.map((modifier) => modifier.id === next.id ? next : modifier));
  const reorder = (index: number, direction: number) => {
    const next = [...modifiers];
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    onChange(next);
  };
  return <div className="crystal-builder-tools">
    <header className="crystal-panel-intro"><Layers3 size={20} /><div><h3>Prepare calculation geometry</h3><p>Preview each transformation before using it in Quantum ESPRESSO.</p></div></header>
    <div className="crystal-modifier-add"><UiSelect ariaLabel="Modifier to add" value={addKind} options={Object.entries(modifierLabels).map(([value, label]) => ({ value, label }))} onChange={(value) => setAddKind(value as ModifierKind)} /><button type="button" disabled={modifiers.length >= 12} onClick={() => onChange([...modifiers, newCrystalModifier(addKind, crypto.randomUUID())])}><Plus size={16} />Add</button></div>
    <div className="crystal-stack-source"><span className="crystal-stack-dot" /><span>Saved geometry</span><strong>{originalCount.toLocaleString()} atoms</strong></div>
    {modifiers.length ? <ol className="crystal-modifier-stack">{modifiers.map((modifier, index) => <li key={modifier.id} className={`${modifier.enabled ? '' : 'is-disabled'} ${preview.errorId === modifier.id ? 'has-error' : ''}`}>
      <div className="crystal-modifier-heading"><span className="crystal-stack-number">{index + 1}</span><strong>{modifierLabels[modifier.kind]}</strong><span className="crystal-step-count">{preview.steps.find((step) => step.id === modifier.id)?.count.toLocaleString() ?? '—'}</span><button type="button" aria-label={`${modifier.enabled ? 'Disable' : 'Enable'} ${modifierLabels[modifier.kind]} step ${index + 1}`} aria-pressed={modifier.enabled} onClick={() => update({ ...modifier, enabled: !modifier.enabled })}><Eye size={15} /></button><button type="button" aria-label={`Remove ${modifierLabels[modifier.kind]} step ${index + 1}`} onClick={() => onChange(modifiers.filter((item) => item.id !== modifier.id))}><Trash2 size={15} /></button></div>
      {modifier.enabled && <div className="crystal-modifier-fields"><ModifierFields modifier={modifier} onChange={update} /></div>}
      <footer><span>{modifier.enabled ? 'Enabled' : 'Disabled'} · step {index + 1}</span><button type="button" aria-label={`Move step ${index + 1} up`} disabled={index === 0} onClick={() => reorder(index, -1)}><ArrowUp size={14} /></button><button type="button" aria-label={`Move step ${index + 1} down`} disabled={index === modifiers.length - 1} onClick={() => reorder(index, 1)}><ArrowDown size={14} /></button></footer>
    </li>)}</ol> : <div className="crystal-builder-empty"><strong>Geometry unchanged</strong><p>Add a preparation step only when the QE model needs a supercell, vacuum, wrapping, slicing, translation, or atom filtering.</p></div>}
    {preview.error && <p className="crystal-builder-error" role="alert">{preview.error}</p>}
    {!preview.error && enabled > 0 && !preview.atoms.length && <p className="crystal-builder-error" role="alert">No atoms remain. Adjust the slice or filter before applying.</p>}
    {modifiers.length > 0 && <div className="crystal-stack-apply"><div><span>{preview.error ? 'Check modifier settings' : 'Preview result'}</span><strong>{preview.error ? '—' : `${preview.atoms.length.toLocaleString()} atoms`}</strong></div><p>Apply saves all enabled steps as one edit. Undo restores the input.</p><div className="crystal-stack-actions"><button type="button" onClick={() => onChange([])}><RotateCcw size={15} />Discard</button><button type="button" className="crystal-primary-button" disabled={!enabled || !!preview.error || !preview.atoms.length} onClick={onApply}><Check size={16} />Apply {enabled} {enabled === 1 ? 'step' : 'steps'}</button></div></div>}
  </div>;
}

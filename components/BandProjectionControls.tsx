'use client';
import { useState } from 'react';
import type { OrbitalChannel } from '@/lib/band-projections';
import { UiSelect } from './UiSelect';
import { LabCheckbox } from './LabControls';

export function BandProjectionControls({ channels, selected = [], onChange }: { channels: OrbitalChannel[]; selected?: string[]; onChange: (ids: string[]) => void }) {
  const [atom, setAtom] = useState('all');
  const atoms = [...new Map(channels.map(channel => [String(channel.atom), `${channel.species} #${channel.atom}`])).entries()];
  const visible = channels.filter(channel => atom === 'all' || String(channel.atom) === atom);
  return <section className="grid gap-2 rounded border border-[var(--surface-border)] p-2 text-xs"><strong>Fatbands · orbital character</strong>
    <UiSelect label="Projected atom" value={atom} options={[{ value: 'all', label: 'All atoms' }, ...atoms.map(([value, label]) => ({ value, label }))]} onChange={setAtom} />
    <div className="flex flex-wrap gap-2"><button type="button" onClick={() => onChange([...new Set([...selected, ...visible.map(channel => channel.id)])])}>Select atom orbitals</button><button type="button" onClick={() => onChange([])}>Plain bands</button></div>
    <div className="grid max-h-48 gap-1 overflow-auto">{visible.map(channel => <LabCheckbox key={channel.id} checked={selected.includes(channel.id)} onCheckedChange={checked => onChange(checked ? [...selected, channel.id] : selected.filter(id => id !== channel.id))}>{channel.label}</LabCheckbox>)}</div>
    <p>Marker area uses absolute summed Löwdin weight on the same scale for every band. Projector basis and axes come from the retained QE run.</p>
  </section>;
}

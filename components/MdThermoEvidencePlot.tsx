'use client';

import { useState } from 'react';
import { UiSelect } from './UiSelect';

const observables = [
  { value: 'tempK', label: 'Temperature', unit: 'K' },
  { value: 'pressureBar', label: 'Pressure', unit: 'bar' },
  { value: 'totalEnergyEv', label: 'Total energy', unit: 'eV' },
  { value: 'potentialEnergyEv', label: 'Potential energy', unit: 'eV' },
  { value: 'volumeA3', label: 'Volume', unit: 'Å³' },
];

export type MdEquilibrationWindow = { id: string; kind: string; status: string; range?: [number, number]; candidate?: { startPs: number; endPs: number }; reason?: string };

export function MdThermoEvidencePlot({ rows, windows = [] }: { rows: Array<Record<string, number>>; windows?: MdEquilibrationWindow[] }) {
  const [selected, setSelected] = useState('tempK');
  const [stageId, setStageId] = useState('all');
  const diagnostic = windows.find(item => item.id === stageId);
  rows = diagnostic?.range ? rows.filter(row => row.timePs >= diagnostic.range![0] && row.timePs <= diagnostic.range![1]) : rows;
  const observable = observables.find(item => item.value === selected)!;
  const values = rows.map(row => row[selected]), times = rows.map(row => row.timePs);
  if (rows.length < 2 || values.some(value => !Number.isFinite(value)) || times.some(time => !Number.isFinite(time))) return <p>Thermo history does not contain finite values for this observable.</p>;
  const loX = Math.min(...times), hiX = Math.max(...times), loY = Math.min(...values), hiY = Math.max(...values);
  if (![hiX - loX, hiY - loY].every(Number.isFinite)) return <p>The measured range exceeds the finite plotting scale. Inspect the verified raw thermo file.</p>;
  const path = rows.map((row, index) => `${index ? 'L' : 'M'}${(52 + 300 * (row.timePs - loX) / (hiX - loX || 1)).toFixed(3)},${(144 - 120 * (row[selected] - loY) / (hiY - loY || 1)).toFixed(3)}`).join(' ');
  return <section className="grid gap-2 rounded border border-[var(--surface-border)] p-2">
    <strong>Thermodynamic history</strong>
    {!!windows.length && <UiSelect label="Equilibration stage" value={stageId} options={[{ value: 'all', label: 'All stages' }, ...windows.map(window => ({ value: window.id, label: `${window.kind} · ${window.id}` }))]} onChange={setStageId} />}
    <UiSelect value={selected} options={observables.map(item => ({ value: item.value, label: `${item.label} (${item.unit})` }))} onChange={setSelected} />
    <svg viewBox="0 0 370 190" role="img" aria-label={`${observable.label} versus physical time for all retained stages`} className="w-full text-[var(--surface-text)]">
      <path d="M52,18 L52,144 L352,144" fill="none" stroke="currentColor" strokeWidth=".7" />
      {diagnostic?.candidate && <rect x="52" y="18" width={Math.max(0, Math.min(300, 300 * (diagnostic.candidate.startPs - loX) / (hiX - loX || 1)))} height="126" fill="var(--status-warning, #d79021)" opacity=".18"><title>Excluded initial transient in the candidate window</title></rect>}
      <path d={path} fill="none" stroke="var(--panel-accent, #3b82f6)" strokeWidth="1.1" />
      <g fill="currentColor" fontSize="8"><text x="48" y="148" textAnchor="end">{loY.toPrecision(4)}</text><text x="48" y="25" textAnchor="end">{hiY.toPrecision(4)}</text><text x="52" y="158">{loX.toPrecision(4)}</text><text x="352" y="158" textAnchor="end">{hiX.toPrecision(4)}</text><text x="195" y="180" textAnchor="middle">Elapsed dynamics time (ps)</text><text x="8" y="12">{observable.unit}</text></g>
    </svg>
    {diagnostic && <p role="status" className="text-[var(--surface-muted)]">{diagnostic.candidate ? `Candidate production window: ${diagnostic.candidate.startPs.toPrecision(5)}–${diagnostic.candidate.endPs.toPrecision(5)} ps. Amber marks the excluded initial transient. This does not establish thermodynamic equilibrium; review the stage diagnostics before explicitly choosing the production window.` : diagnostic.reason ?? `Equilibration diagnostic: ${diagnostic.status}.`}</p>}
    <p className="text-[var(--surface-muted)]">All retained thermo samples and stages. Assess stationarity within the declared production window. Minimization iterations share one physical time; the plot alone does not establish equilibration or independent sampling.</p>
  </section>;
}

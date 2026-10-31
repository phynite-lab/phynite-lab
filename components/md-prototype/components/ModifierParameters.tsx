'use client';
import type { ModifierItem } from '../types/trajectory';
import { LabSwitch } from '@/components/LabControls';
import { UiSelect } from '@/components/UiSelect';

const labels: Record<string, string> = { numX: 'Repeat a', numY: 'Repeat b', numZ: 'Repeat c', rmsdCutoff: 'RMSD cutoff', crystalStructure: 'Crystal lattice', cutoff: 'Cutoff · Å', bins: 'RDF bins', radius: 'Probe radius · Å', neighbors: 'Neighbors', referenceFrame: 'Reference frame · 0 based', normal: 'Plane normal', distance: 'Plane distance · Å', reverse: 'Reverse side', expression: 'Expression', action: 'Selection action', mode: 'CNA mode' };
export function ModifierParameters({ modifier, onChange, total }: { modifier: ModifierItem; onChange: (params: ModifierItem['params']) => void; total: number }) {
  return <div className="md-prototype-params">{Object.entries(modifier.params).map(([key, value]) => {
    if (value === undefined || key === 'sortBySize' || (modifier.type === 'cna' && key === 'cutoff' && modifier.params.mode === 'adaptive')) return null;
    const label = labels[key] ?? key;
    if (Array.isArray(value)) return <fieldset key={key}><legend>{label}</legend><div className="md-vector-fields">{value.map((v, i) => <input key={i} aria-label={label + ' ' + String(i+1)} type="number" step="0.1" value={v} onChange={e => onChange({ ...modifier.params, [key]: value.map((x, j) => i === j ? Number(e.target.value) : x) })} />)}</div></fieldset>;
    if (typeof value === 'boolean') return <LabSwitch className="md-check" key={key} checked={value} onCheckedChange={(checked) => onChange({ ...modifier.params, [key]: checked })}>{label}</LabSwitch>;
    const options = key === 'mode' ? ['adaptive', 'fixed'] : key === 'crystalStructure' ? ['FCC', 'BCC', 'HCP', 'CUBIC_DIAMOND', 'HEX_DIAMOND'] : key === 'action' ? ['select', 'remove'] : null;
    return <label className="md-field" key={key}><span>{label}</span>{options ? <UiSelect ariaLabel={label} value={String(value)} options={options.map(option => ({ value: option, label: option }))} onChange={(next) => onChange({ ...modifier.params, [key]: next })} /> : <input type={typeof value === 'number' ? 'number' : 'text'} min={key.startsWith('num') ? 1 : key === 'referenceFrame' || key === 'rmsdCutoff' ? 0 : ['distance','termination'].includes(key) ? undefined : .01} max={key.startsWith('num') ? 8 : key === 'referenceFrame' ? total - 1 : undefined} step={key.startsWith('num') || ['bins', 'neighbors', 'referenceFrame'].includes(key) ? 1 : .01} value={value} onChange={e => onChange({ ...modifier.params, [key]: typeof value === 'number' ? Number(e.target.value) : e.target.value })} />}</label>;
  })}</div>;
}

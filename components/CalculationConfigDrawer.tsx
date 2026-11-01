'use client';

import { motion, useReducedMotion } from 'framer-motion';
import {
  Check,
  ChevronDown,
  CircleAlert,
  Clipboard,
  Cog,
  Cpu,
  Link2,
  Plus,
  Play,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocale } from '@/app/locale-provider';
import {
  type Accuracy,
  type AtomicPositionUnit,
  type CalculationType,
  type CellParameterUnit,
  type Functional,
  type JobDraft,
  type MaterialContext,
  type StructureAtomInput,
} from '@/components/JobComposer';
import { CommittedNumberInput } from '@/components/CommittedNumberInput';
import { CellRepeatControl, type CellRepeat } from '@/components/CellRepeatControl';
import { UiSelect, type UiSelectOption } from '@/components/UiSelect';
import { LabSwitch } from '@/components/LabControls';
import {
  resolveReciprocalPathMode,
  latticeSystemInfoForMaterial,
} from '@/lib/reciprocal-path';
import {
  cutoffUserOverride,
  occupationUserOverride,
  qeRecommendationDraft,
  recommendedCutoffFields,
  recommendedOccupationFields,
  resolveQeAdaptiveParameters,
  resolveAdaptiveBands,
  recommendedHubbardCorrections,
  type ResolvedCutoff,
  type ResolvedOccupation,
} from '@/lib/qe-adaptive';
import {
  AtomicMassesCard,
  ManualMagneticAndHubbard,
  hasNonStandardAtomicWeight,
  TransportSamplingNotice,
} from '@/components/QeMethodFields';
import { qeMethodIssue, qeIonDynamicsOptions } from '@/lib/qe-input';
import { generateQuantumEspressoInput, generateQuantumEspressoInputFiles } from '@/lib/qe-workflow';
import { BOHR_TO_ANGSTROM, qeCellInAngstrom, convertQePosition } from '@/lib/qe-structure';
import type { CellVectors } from '@/lib/crystal-cell';
import { cn } from '@/lib/utils';

type Mode = 'simple' | 'manual';
type ManualSection = 'control' | 'system' | 'electrons' | 'specific' | 'structure';

const calculationCode: Record<CalculationType, string> = {
  'Nudged elastic band': 'Fixed-cell reaction path with neb.x',
  'Total energy': 'pw.x · scf',
  'Structural relaxation': 'pw.x · relax / vc-relax',
  'Band structure': 'pw.x · bands.x',
  'Density of states': 'pw.x · dos.x · projwfc.x',
  'Phonon dispersion': 'ph.x · q2r.x · matdyn.x',
  'Thermoelectric properties': 'QE · NSCF → GENE · BoltzTraP2',
};

function calculationCodeFor(calculation: CalculationType, draft: JobDraft) {
  if (calculation === 'Structural relaxation') return `pw.x · ${draft.relaxCell ? 'vc-relax' : 'relax'}`;
  return calculationCode[calculation];
}

function formatSpaceGroupBadge(latticeName: string, spaceGroup?: string): string {
  if (!spaceGroup || spaceGroup === 'Not recalculated' || spaceGroup.trim() === '') {
    return latticeName;
  }
  return `${latticeName} · ${spaceGroup}`;
}

function NumberField({ label, value, unit, min, max, step = 1, onChange }: { label: string; value: number; unit?: string; min?: number; max?: number; step?: number; onChange: (value: number) => void }) {
  return <label className="block min-w-0 overflow-hidden text-[11px] font-medium text-[var(--panel-muted)]"><span className="block truncate">{label}</span><span className="mt-1.5 flex h-9 min-w-0 items-center overflow-hidden rounded-[6px] border border-[var(--panel-border)] bg-[var(--panel-raised)] focus-within:border-[var(--field-focus-border)]"><CommittedNumberInput value={value} min={min} max={max} step={step} onCommit={onChange} className="min-w-0 flex-1 bg-transparent px-2.5 font-mono text-[11.5px] text-[var(--panel-text)] outline-none" />{unit && <span className="shrink-0 pr-2.5 font-sans text-[10.5px] font-medium text-[var(--panel-muted)]">{unit}</span>}</span></label>;
}

function OptionalNumberField({ label, value, unit, step = 0.1, onChange }: { label: string; value?: number; unit?: string; step?: number; onChange: (value?: number) => void }) {
  const commit = (input: HTMLInputElement) => {
    const trimmed = input.value.trim();
    if (!trimmed) {
      onChange(undefined);
      return;
    }
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) onChange(parsed);
    else input.value = value === undefined ? '' : String(value);
  };
  return <label className="block min-w-0 overflow-hidden text-[11px] font-medium text-[var(--panel-muted)]"><span className="block truncate">{label}</span><span className="mt-1.5 flex h-9 min-w-0 items-center overflow-hidden rounded-[6px] border border-[var(--panel-border)] bg-[var(--panel-raised)] focus-within:border-[var(--field-focus-border)]"><input key={value ?? 'auto'} inputMode="decimal" type="number" defaultValue={value} step={step} placeholder="Auto" onBlur={(event) => commit(event.currentTarget)} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} className="min-w-0 flex-1 bg-transparent px-2.5 font-mono text-[11.5px] text-[var(--panel-text)] outline-none placeholder:text-[var(--panel-muted)]" />{unit && <span className="shrink-0 pr-2.5 font-sans text-[10.5px] font-medium text-[var(--panel-muted)]">{unit}</span>}</span></label>;
}

function TextField({ label, value, mono = true, onChange }: { label: string; value: string; mono?: boolean; onChange: (value: string) => void }) {
  return <label className="block min-w-0 overflow-hidden text-[11px] font-medium text-[var(--panel-muted)]"><span className="block truncate">{label}</span><input value={value} onChange={(event) => onChange(event.target.value)} className={cn('mt-1.5 h-9 w-full min-w-0 rounded-[6px] border border-[var(--panel-border)] bg-[var(--panel-raised)] px-2.5 text-[11.5px] text-[var(--panel-text)] outline-none focus:border-[var(--field-focus-border)]', mono && 'font-mono')} /></label>;
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: UiSelectOption[]; onChange: (value: string) => void }) {
  return <UiSelect label={label} value={value} options={options} onChange={onChange} mono={label.includes('_') || label === 'K-point shift' || label === 'occupations' || label === 'smearing'} />;
}

function Toggle({ label, detail, checked, compact = false, onChange }: { label: string; detail?: string; checked: boolean; compact?: boolean; onChange: () => void }) {
  return <LabSwitch checked={checked} onCheckedChange={onChange} aria-label={label} className={cn('rounded-[7px] border border-[var(--panel-border)] bg-[var(--config-card)] text-left hover:bg-[var(--panel-hover)]', compact ? 'min-h-11 px-2.5' : 'min-h-12 px-3')}><span className="block min-w-0 overflow-hidden"><span className={cn('block truncate font-semibold text-[var(--panel-text)]', compact ? 'text-[10.5px]' : 'text-[11.5px]')}>{label}</span>{detail && <span className="mt-0.5 block truncate font-mono text-[10px] leading-3 text-[var(--panel-muted)]">{detail}</span>}</span></LabSwitch>;
}

function SectionTitle({ children, detail }: { children: React.ReactNode; detail?: string }) {
  return <div className="mb-2.5 flex min-w-0 items-baseline justify-between gap-2"><h3 className="shrink-0 text-[11.5px] font-semibold tracking-tight text-[var(--panel-text)]">{children}</h3>{detail && <span className="min-w-0 truncate text-[10.5px] font-normal text-[var(--panel-muted)]">{detail}</span>}</div>;
}

function StructureSourceCard({ value, options, hasRelaxationSource, onChange, onAddRelaxation }: {
  value: string;
  options: Array<{ value: string; label: string; detail?: string; disabled?: boolean }>;
  hasRelaxationSource: boolean;
  onChange: (sourceId: string) => void;
  onAddRelaxation: () => void;
}) {
  return <div className="config-source-wrap mb-4">
    <div className="config-source-card rounded-[8px] border border-[var(--panel-border)] bg-[var(--panel-raised)] p-3">
      <div className="config-source-header flex min-w-0 items-center gap-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[6px] border border-[var(--panel-border)] bg-[var(--panel-bg)] text-[var(--panel-muted)]"><Link2 className="h-3.5 w-3.5" /></span>
        <span className="block text-[11px] font-semibold text-[var(--panel-text)]">Structure source</span>
      </div>
      <div className={cn('config-source-controls', !hasRelaxationSource && 'config-source-controls--with-hint')}>
        <UiSelect label="Input geometry" value={value} options={options} onChange={onChange} />
        {!hasRelaxationSource && <div className="config-source-hint flex min-w-0 items-center gap-2 rounded-[6px] border border-[var(--panel-border)] bg-[var(--panel-bg)] px-2.5 py-2">
          <CircleAlert className="h-3.5 w-3.5 shrink-0 text-[var(--status-warning)]" />
          <span className="min-w-0 flex-1 text-[10.5px] font-normal text-[var(--panel-muted)]">No relaxation output</span>
          <button type="button" onClick={onAddRelaxation} className="h-7 shrink-0 rounded-[5px] border border-[var(--panel-border)] bg-[var(--panel-raised)] px-2.5 text-[10.5px] font-semibold text-[var(--panel-text)] hover:bg-[var(--panel-hover)]"><Plus className="mr-1 inline h-3 w-3" />Add relaxation</button>
        </div>}
      </div>
    </div>
  </div>;
}

function occupationLabel(value: ResolvedOccupation['value']) {
  if (value === 'tetrahedra_opt') return 'Optimized tetrahedra';
  if (value === 'tetrahedra') return 'Tetrahedra';
  if (value === 'smearing') return 'Cold smearing';
  return 'Fixed occupations';
}

function SmartDefaultHeader({ customized, onReset, label = 'Reset to recommended' }: { customized: boolean; onReset: () => void; label?: string }) {
  if (!customized) return null;
  return <div className="mb-2 flex min-w-0 items-center justify-end">
    <button
      type="button"
      onClick={onReset}
      className="flex items-center gap-1 text-[10.5px] font-semibold text-[var(--panel-accent)] hover:text-white"
    >
      <RotateCcw className="h-3 w-3" />
      {label}
    </button>
  </div>;
}

function EditableOccupationFields({ draft, resolved, recommended, secondary, onChange }: { draft: JobDraft; resolved: ResolvedOccupation; recommended: ResolvedOccupation; secondary?: ResolvedOccupation; onChange: (patch: Partial<JobDraft>) => void }) {
  const customized = draft.occupationPolicy === 'manual';
  const update = (patch: Partial<JobDraft>) => onChange({ ...occupationUserOverride(draft, resolved, recommended, patch), rawInput: '' });
  const reset = () => onChange({ ...recommendedOccupationFields(draft, recommended), rawInput: '' });

  return <div className="qe-smart-editor rounded-[8px] border border-[var(--panel-border)] bg-[var(--panel-raised)] p-3">
    <SmartDefaultHeader customized={customized} onReset={reset} />
    <div className={cn('qe-smart-occupation-grid', resolved.value === 'smearing' && 'qe-smart-occupation-grid--smearing')}>
      <SelectField label="occupations" value={resolved.value} options={['fixed', 'smearing', 'tetrahedra', 'tetrahedra_opt'].map((value) => ({ value, label: value }))} onChange={(occupations) => update({ occupations: occupations as JobDraft['occupations'] })} />
      {resolved.value === 'smearing' && <>
        <SelectField label="smearing" value={resolved.smearingType ?? 'marzari-vanderbilt'} options={[{ value: 'gaussian', label: 'gaussian' }, { value: 'methfessel-paxton', label: 'methfessel-paxton' }, { value: 'marzari-vanderbilt', label: 'marzari-vanderbilt' }, { value: 'fermi-dirac', label: 'fermi-dirac' }]} onChange={(smearingType) => update({ occupations: 'smearing', smearingType: smearingType as JobDraft['smearingType'] })} />
        <NumberField label="degauss" value={resolved.degauss ?? recommended.degauss ?? draft.smearing} unit="Ry" min={0.0001} step={0.005} onChange={(smearing) => update({ occupations: 'smearing', smearing })} />
      </>}
    </div>
    {secondary && <div className="mt-2 flex items-center justify-between border-t border-[var(--panel-border)] pt-1.5 text-[10.5px]"><span className="text-[var(--panel-muted)]">DOS NSCF is workflow-controlled</span><span className="font-mono font-semibold text-[var(--panel-text)]">{occupationLabel(secondary.value)}</span></div>}
  </div>;
}

function EditableCutoffFields({ draft, resolved, recommended, onChange }: { draft: JobDraft; resolved: ResolvedCutoff; recommended: ResolvedCutoff; onChange: (patch: Partial<JobDraft>) => void }) {
  const customized = draft.cutoffPolicy === 'manual';
  const update = (patch: Partial<JobDraft>) => onChange({ ...cutoffUserOverride(resolved, patch), rawInput: '' });
  const reset = () => onChange({ ...recommendedCutoffFields(recommended), rawInput: '' });

  return <div className="qe-smart-editor rounded-[8px] border border-[var(--panel-border)] bg-[var(--panel-raised)] p-3">
    <SmartDefaultHeader customized={customized} onReset={reset} />
    <div className="qe-smart-cutoff-grid">
      <NumberField label="ecutwfc" value={resolved.ecutwfc} unit="Ry" min={1} onChange={(cutoff) => update({ cutoff })} />
      <NumberField label="ecutrho" value={resolved.ecutrho} unit="Ry" min={1} onChange={(chargeDensityCutoff) => update({ chargeDensityCutoff })} />
    </div>
    {resolved.advisories.map((advisory) => <p key={advisory} className="mt-1 flex gap-1 text-[10.5px] leading-relaxed text-[var(--status-warning)]"><CircleAlert className="mt-0.5 h-3 w-3 shrink-0" />{advisory}</p>)}
  </div>;
}

function RelaxationModeSelector({ draft, onChange }: { draft: JobDraft; onChange: (patch: Partial<JobDraft>) => void }) {
  const options = [
    {
      id: 'relax',
      relaxCell: false,
      title: 'relax',
      detail: 'Optimize atomic positions only. Cell vectors and volume remain fixed.',
    },
    {
      id: 'vc-relax',
      relaxCell: true,
      title: 'vc-relax',
      detail: 'Optimize atomic positions together with cell shape and volume.',
    },
  ] as const;

  return <fieldset className="rounded-[8px] border border-[var(--panel-border)] bg-[var(--panel-raised)] p-2.5">
    <legend className="px-1 text-[11px] font-semibold text-[var(--panel-muted)]">Relaxation mode</legend>
    <div role="radiogroup" aria-label="Structural relaxation mode" className="relaxation-mode-options grid gap-2">
      {options.map((option) => {
        const selected = draft.relaxCell === option.relaxCell;
        return <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={selected}
          onClick={() => {
            if (selected) return;
            onChange({ relaxCell: option.relaxCell, rawInput: '' });
          }}
          className={cn(
            'group flex min-h-[68px] items-start gap-2.5 rounded-[7px] border px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--line-strong)]/20',
            selected
              ? 'border-[var(--line-strong)] bg-[var(--panel-selected)]'
              : 'border-[var(--panel-border)] bg-[var(--panel-bg)] hover:bg-[var(--panel-hover)]',
          )}
        >
          <span className={cn('mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border', selected ? 'border-[var(--panel-text)]' : 'border-[var(--panel-border)]')}>
            {selected && <i className="h-2 w-2 rounded-full bg-[var(--panel-text)]" />}
          </span>
          <span className="min-w-0">
            <span className={cn('block font-mono text-[11.5px] font-semibold', selected ? 'text-[var(--panel-text)]' : 'text-[var(--panel-text)]')}>{option.title}</span>
            <span className="mt-1 block text-[10.5px] leading-normal text-[var(--panel-muted)]">{option.detail}</span>
          </span>
        </button>;
      })}
    </div>
  </fieldset>;
}

type Vector3 = [number, number, number];

const fallbackCell: Vector3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

function vectorLength(vector: Vector3) {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

function scaleVector(vector: Vector3, factor: number): Vector3 {
  return [vector[0] * factor, vector[1] * factor, vector[2] * factor];
}

function cellInAngstrom(draft: JobDraft, material: MaterialContext) {
  return material ? qeCellInAngstrom(draft, material, false) : fallbackCell as CellVectors;
}

function positionsInUnit(draft: JobDraft, material: MaterialContext) {
  const unit = draft.atomicPositionUnit ?? 'crystal';
  if (draft.atomicPositions !== undefined) return draft.atomicPositions.map((atom) => ({ ...atom }));
  const atoms = material?.atoms ?? [];
  if (unit === 'crystal') return atoms.map((atom) => ({ ...atom }));
  const cell = cellInAngstrom(draft, material);
  const alat = (draft.cellParameterAlat ?? vectorLength(cell[0])) || 1;
  return atoms.map((atom) => {
    const cartesian = convertQePosition([atom.x, atom.y, atom.z], 'crystal', 'angstrom', cell as CellVectors, alat);
    const factor = unit === 'bohr' ? 1 / BOHR_TO_ANGSTROM : unit === 'alat' ? 1 / alat : 1;
    return { ...atom, x: cartesian[0] * factor, y: cartesian[1] * factor, z: cartesian[2] * factor };
  });
}

function convertPositions(atoms: StructureAtomInput[], from: AtomicPositionUnit, to: AtomicPositionUnit, cell: Vector3[], alat: number) {
  return atoms.map((atom) => {
    const [x, y, z] = convertQePosition([atom.x, atom.y, atom.z], from, to, cell as CellVectors, alat);
    return { ...atom, x, y, z };
  });
}

export function StructureCards({ draft, material, cellRepeat, maxRepeatAxis, onChange, onCellRepeatChange, onCopy, copied }: { draft: JobDraft; material: MaterialContext; cellRepeat?: CellRepeat; maxRepeatAxis?: number; onChange: (patch: Partial<JobDraft>) => void; onCellRepeatChange?: (value: CellRepeat) => void; onCopy: () => void; copied: boolean }) {
  const [structureError, setStructureError] = useState<string | null>(null);
  const cellUnit = draft.cellParameterUnit ?? 'angstrom';
  const positionUnit = draft.atomicPositionUnit ?? 'crystal';
  const atomicPositions = positionsInUnit(draft, material);
  const alat = draft.cellParameterAlat ?? Math.max(vectorLength(cellInAngstrom(draft, material)[0]), 1e-8);
  const displayFactor = cellUnit === 'bohr' ? 1 / BOHR_TO_ANGSTROM : cellUnit === 'alat' ? 1 / alat : 1;
  const cellParameters = (draft.cellParameters?.length === 3 ? draft.cellParameters : (material?.cellVectors ?? fallbackCell).map(vector => scaleVector(vector, displayFactor))) as Vector3[];
  const resetCards = () => onChange({ cellParameterUnit: undefined, cellParameterAlat: undefined, cellParameters: undefined, atomicPositionUnit: undefined, atomicPositions: undefined, rawInput: '' });
  const changeCellUnit = (nextUnit: CellParameterUnit) => {
    const angstromCell = cellInAngstrom(draft, material);
    const nextAlat = nextUnit === 'alat' ? Math.max(vectorLength(angstromCell[0]), 1e-8) : draft.cellParameterAlat ?? Math.max(vectorLength(angstromCell[0]), 1e-8);
    const factor = nextUnit === 'bohr' ? 1 / BOHR_TO_ANGSTROM : nextUnit === 'alat' ? 1 / nextAlat : 1;
    onChange({ cellParameterUnit: nextUnit, cellParameterAlat: nextAlat, cellParameters: angstromCell.map((vector) => scaleVector(vector, factor)), rawInput: '' });
  };
  const changeCellValue = (row: number, column: number, value: number) => {
    const next = cellParameters.map((vector) => [...vector] as Vector3);
    next[row][column] = Number.isFinite(value) ? value : 0;
    onChange({ cellParameters: next, rawInput: '' });
  };
  const changePositionUnit = (nextUnit: AtomicPositionUnit) => {
    const angstromCell = cellInAngstrom(draft, material);
    const alat = draft.cellParameterAlat ?? Math.max(vectorLength(angstromCell[0]), 1e-8);
    try {
      onChange({ atomicPositionUnit: nextUnit, atomicPositions: convertPositions(atomicPositions, positionUnit, nextUnit, angstromCell, alat), rawInput: '' });
      setStructureError(null);
    } catch (error) { setStructureError(error instanceof Error ? error.message : 'Coordinate conversion failed'); }
  };
  const changeAtom = (index: number, patch: Partial<StructureAtomInput>) => {
    onChange({ atomicPositions: atomicPositions.map((atom, atomIndex) => atomIndex === index ? { ...atom, ...patch } : atom), rawInput: '' });
  };
  const addAtom = () => {
    const species = atomicPositions.at(-1)?.species ?? material?.species[0] ?? 'Si';
    onChange({ atomicPositions: [...atomicPositions, { id: crypto.randomUUID(), species, x: 0, y: 0, z: 0 }], rawInput: '' });
  };
  const removeAtom = (index: number) => onChange({ atomicPositions: atomicPositions.filter((_, atomIndex) => atomIndex !== index), rawInput: '' });

  return <div className="space-y-3">
    {structureError && <p role="alert" className="text-[11px] text-[var(--status-danger)]">{structureError}</p>}
    <div className="flex flex-wrap items-center gap-2 rounded-[7px] border border-[var(--panel-border)] bg-[var(--panel-raised)] px-3 py-2">
      <span className="min-w-0 flex-1"><span className="block text-[11px] font-semibold text-[var(--panel-text)]">QE structure cards</span></span>
      <button type="button" onClick={resetCards} className="flex h-7 items-center gap-1 rounded-[5px] px-2 text-[10.5px] font-medium text-[var(--panel-muted)] hover:bg-[var(--panel-hover)] hover:text-[var(--panel-text)]"><RotateCcw className="h-3 w-3" />Reset cards</button>
      <button type="button" onClick={onCopy} className="flex h-7 items-center gap-1 rounded-[5px] border border-[var(--surface-border,var(--line))] bg-[var(--surface-bg,var(--surface))] px-2 text-[10.5px] font-semibold text-[var(--surface-text,var(--ink))] hover:bg-[var(--surface-hover,var(--surface-subtle))]"><Clipboard className="h-3 w-3" />{copied ? 'Copied' : 'Copy QE input'}</button>
    </div>
    <div className={cn('config-structure-columns', cellRepeat && 'config-structure-columns--repeat')}>
      <div className="space-y-3">
        <section className="overflow-hidden rounded-[7px] border border-[var(--surface-border,var(--line))] bg-[var(--surface-bg,var(--surface))]">
          <header className="flex min-h-10 items-center gap-2 border-b border-[var(--surface-border,var(--line))] bg-[var(--surface-raised,var(--surface-subtle))] px-3 py-1.5"><span className="text-[11px] font-semibold text-[var(--surface-text,var(--ink))]">Cell Parameters</span><span className="ml-auto w-[126px]"><UiSelect compact ariaLabel="Cell parameter unit" value={cellUnit} options={[{ value: 'angstrom', label: 'angstrom' }, { value: 'bohr', label: 'bohr' }, { value: 'alat', label: 'alat' }]} onChange={(value) => changeCellUnit(value as CellParameterUnit)} mono /></span></header>
          <div className="p-2.5 overflow-x-auto" role="region" aria-label="Cell parameters" tabIndex={0}>
            {cellUnit === 'alat' && <div className="mb-2 grid grid-cols-[minmax(0,1fr)_150px] items-center gap-3 rounded-[5px] border border-[var(--surface-border,var(--line))] bg-[var(--surface-raised,var(--surface-subtle))] px-2.5 py-2"><span className="min-w-0"><span className="block text-[10.5px] font-semibold text-[var(--surface-text,var(--ink))]">Lattice constant</span><span className="block truncate text-[9.5px] text-[var(--panel-muted,var(--muted-ink))]">alat in Å</span></span><NumberField label="alat" value={alat} unit="Å" min={0.000001} step={0.000001} onChange={(cellParameterAlat) => onChange({ cellParameterAlat, rawInput: '' })} /></div>}
            <div className="grid min-w-[354px] grid-cols-[30px_repeat(3,minmax(0,1fr))] gap-1.5"><span />{['X', 'Y', 'Z'].map((axis) => <span key={axis} className="text-center font-mono text-[9px] font-semibold text-[var(--panel-muted,var(--muted-ink))]">{axis}</span>)}{cellParameters.flatMap((vector, row) => [<span key={`label-${row}`} className="grid h-8 place-items-center rounded-[4px] bg-[var(--surface-raised,var(--surface-subtle))] font-mono text-[10px] font-semibold text-[var(--surface-text,var(--ink))]">{['a⃗', 'b⃗', 'c⃗'][row]}</span>, ...vector.map((value, column) => <CommittedNumberInput key={`${row}-${column}`} aria-label={`Cell vector ${row + 1} ${['x', 'y', 'z'][column]}`} step="0.000001" value={value} onCommit={(next) => changeCellValue(row, column, next)} className="h-8 min-w-0 rounded-[4px] border border-[var(--surface-border,var(--line))] bg-[var(--surface-raised,var(--surface-subtle))] px-2 text-right font-mono text-[10.5px] text-[var(--surface-text,var(--ink))] outline-none focus:border-[var(--field-focus-border)] focus:bg-[var(--surface-bg,var(--surface))]" />)])}</div>
          </div>
        </section>

        <section className="overflow-hidden rounded-[7px] border border-[var(--surface-border,var(--line))] bg-[var(--surface-bg,var(--surface))]">
          <header className="flex min-h-10 items-center gap-2 border-b border-[var(--surface-border,var(--line))] bg-[var(--surface-raised,var(--surface-subtle))] px-3 py-1.5"><span className="text-[11px] font-semibold text-[var(--surface-text,var(--ink))]">Atomic Positions</span><span className="font-mono text-[9.5px] text-[var(--panel-muted,var(--muted-ink))]">nat {atomicPositions.length}</span><span className="ml-auto w-[126px]"><UiSelect compact ariaLabel="Atomic coordinate unit" value={positionUnit} options={[{ value: 'crystal', label: 'crystal', detail: 'Fractional coordinates' }, { value: 'angstrom', label: 'angstrom' }, { value: 'bohr', label: 'bohr' }, { value: 'alat', label: 'alat' }]} onChange={(value) => changePositionUnit(value as AtomicPositionUnit)} mono /></span></header>
          <div className="p-2.5 overflow-x-auto" role="region" aria-label="Atomic positions" tabIndex={0}>
            {positionUnit === 'alat' && cellUnit !== 'alat' && <div className="mb-2 grid grid-cols-[minmax(0,1fr)_150px] items-center gap-3 rounded-[5px] border border-[var(--surface-border,var(--line))] bg-[var(--surface-raised,var(--surface-subtle))] px-2.5 py-2"><span className="min-w-0"><span className="block text-[10.5px] font-semibold text-[var(--surface-text,var(--ink))]">Lattice constant</span><span className="block truncate text-[9.5px] text-[var(--panel-muted,var(--muted-ink))]">Reference length for alat coordinates</span></span><NumberField label="alat" value={alat} unit="Å" min={0.000001} step={0.000001} onChange={(cellParameterAlat) => onChange({ cellParameterAlat, rawInput: '' })} /></div>}
            <div className="min-w-[460px] space-y-1.5">
              <div className="grid grid-cols-[20px_36px_44px_repeat(3,minmax(0,1fr))_24px] gap-1 px-0.5">{['#', 'Elem.', 'Label', 'X', 'Y', 'Z', ''].map((label, index) => <span key={`${label}-${index}`} className="text-center font-mono text-[9px] font-semibold text-[var(--panel-muted,var(--muted-ink))]">{label}</span>)}</div>
              {atomicPositions.map((atom, index) => <div key={`${atom.species}-${index}`} className="grid grid-cols-[20px_36px_44px_repeat(3,minmax(0,1fr))_24px] gap-1"><span className="grid h-8 place-items-center font-mono text-[9px] text-[var(--panel-muted,var(--muted-ink))]">{index + 1}</span><input aria-label={`Atom ${index + 1} species`} value={atom.species} onChange={(event) => changeAtom(index, { species: event.target.value.replace(/[^A-Za-z]/g, '').slice(0, 2), label: undefined })} className="h-8 min-w-0 rounded-[4px] border border-[var(--surface-border,var(--line))] bg-[var(--surface-raised,var(--surface-subtle))] text-center font-mono text-[10.5px] font-semibold text-[var(--surface-text,var(--ink))] outline-none focus:border-[var(--field-focus-border)] focus:bg-[var(--surface-bg,var(--surface))]" /><input aria-label={`Atom ${index + 1} QE species label`} title="QE species label for magnetic sublattice" value={atom.label ?? atom.species} onChange={(event) => changeAtom(index, { label: event.target.value.replace(/[^A-Za-z0-9_]/g, '').slice(0, 3) })} className="h-8 min-w-0 rounded-[4px] border border-[var(--panel-border)] bg-[var(--panel-raised)] text-center font-mono text-[10.5px] text-[var(--panel-text)]" />{(['x', 'y', 'z'] as const).map((axis) => <CommittedNumberInput key={axis} aria-label={`Atom ${index + 1} ${axis}`} step="0.000001" value={atom[axis]} onCommit={(next) => changeAtom(index, { [axis]: next })} className="h-8 min-w-0 rounded-[4px] border border-[var(--surface-border,var(--line))] bg-[var(--surface-raised,var(--surface-subtle))] px-1.5 text-right font-mono text-[10px] text-[var(--surface-text,var(--ink))] outline-none focus:border-[var(--field-focus-border)] focus:bg-[var(--surface-bg,var(--surface))]" />)}<button type="button" aria-label={`Delete atom row ${index + 1}`} disabled={atomicPositions.length <= 1} onClick={() => removeAtom(index)} className="grid h-8 place-items-center rounded-[4px] text-[var(--panel-muted,var(--muted-ink))] hover:bg-[var(--surface-hover,var(--surface-subtle))] hover:text-[var(--status-danger)] disabled:opacity-30"><Trash2 className="h-3 w-3" /></button></div>)}
              <button type="button" onClick={addAtom} className="ml-6 flex h-8 items-center gap-1 rounded-[4px] px-2 text-[10.5px] font-semibold text-[var(--surface-text,var(--ink))] hover:bg-[var(--surface-hover,var(--surface-subtle))]"><Plus className="h-3 w-3" />Add atomic position</button>
            </div>
          </div>
        </section>
        <AtomicMassesCard draft={draft} material={material} onChange={onChange} />
      </div>
      {cellRepeat && onCellRepeatChange && <CellRepeatControl value={cellRepeat} atomCount={material?.atomCount ?? 0} maxAxis={maxRepeatAxis ?? 8} onChange={onCellRepeatChange} />}
    </div>
  </div>;
}

function DipoleFields({ draft, onChange }: { draft: JobDraft; onChange: (patch: Partial<JobDraft>) => void }) {
  const update = (patch: Partial<JobDraft>) => onChange({ ...patch, rawInput: '' });
  return <section className="config-simple-card space-y-2"><SectionTitle detail="slab · axis 3">Electrostatic boundary</SectionTitle>
    <Toggle compact label="Dipole correction" detail="tefield + dipfield · vacuum required" checked={draft.dipoleCorrection ?? false} onChange={() => update({ dipoleCorrection: !draft.dipoleCorrection })} />
    {draft.dipoleCorrection && <><SelectField label="Correction region" value={draft.dipolePlacement ?? 'automatic'} options={[{ value: 'automatic', label: 'Locate from slab vacuum' }, { value: 'manual', label: 'Manual fractional interval' }]} onChange={value => update({ dipolePlacement: value as JobDraft['dipolePlacement'] })} />
      {draft.dipolePlacement === 'manual' && <div className="config-form-grid config-form-grid--2"><NumberField label="emaxpos" value={draft.dipolePosition ?? .9} min={.0001} max={.9999} step={.01} onChange={dipolePosition => update({ dipolePosition })} /><NumberField label="eopreg" value={draft.dipoleRegion ?? .05} min={.0001} max={.9999} step={.01} onChange={dipoleRegion => update({ dipoleRegion })} /></div>}
      <NumberField label="External field · eamp" value={draft.electricFieldAmplitude ?? 0} unit="Hartree a.u." step={.0001} onChange={electricFieldAmplitude => update({ electricFieldAmplitude })} />
      <p className="text-[10px] text-[var(--panel-muted)]">Both slope changes are placed in the nuclear vacuum gap. Inspect the planar electron density before accepting this placement. Use assume_isolated = none; keep the vacuum axis fixed during relaxation.</p></>}
  </section>;
}

function CommonSimple({ calculation, draft, material, onChange, onApplyAccuracy, inheritedModel = false }: { calculation: CalculationType; draft: JobDraft; material: MaterialContext; onChange: (patch: Partial<JobDraft>) => void; onApplyAccuracy: (accuracy: Accuracy) => void; inheritedModel?: boolean }) {
  const scfResolved = resolveQeAdaptiveParameters(draft, material, calculation, calculation === 'Structural relaxation' ? 'relax' : 'scf');
  const recommended = resolveQeAdaptiveParameters(qeRecommendationDraft(draft), material, calculation, calculation === 'Structural relaxation' ? 'relax' : 'scf');
  const dosResolved = calculation === 'Density of states'
    ? resolveQeAdaptiveParameters(draft, material, calculation, 'nscf-dos').occupation
    : undefined;
  const hubbardRecs = recommendedHubbardCorrections(material?.species ?? []);
  const hasHubbardElements = hubbardRecs.length > 0;

  return <div className="config-simple-grid">
    <fieldset disabled={inheritedModel} className="config-simple-card config-accuracy-card"><SectionTitle detail="preset">Accuracy</SectionTitle><div className="grid min-w-0 grid-cols-3 overflow-hidden rounded-[6px] border border-[var(--panel-border)]">{(['Fast', 'Balanced', 'High accuracy'] as Accuracy[]).map((accuracy) => <button key={accuracy} type="button" title={accuracy} onClick={() => onApplyAccuracy(accuracy)} className={cn('h-9 min-w-0 truncate border-r border-[var(--panel-border)] px-1 text-[11px] font-medium last:border-r-0 sm:text-[11.5px]', draft.accuracy === accuracy ? 'bg-[var(--panel-selected)] text-[var(--panel-text)] font-semibold' : 'bg-[var(--panel-bg)] text-[var(--panel-muted)] hover:bg-[var(--panel-hover)] hover:text-[var(--panel-text)]')}>{accuracy === 'High accuracy' ? 'High' : accuracy}</button>)}</div></fieldset>
    <fieldset disabled={inheritedModel} className="config-simple-card"><SectionTitle>Electronic method</SectionTitle><SelectField label="XC functional" value={draft.functional} options={['PBE', 'LDA', 'HSE'].map((value) => ({ value, label: value }))} onChange={(functional) => onChange({ functional: functional as Functional, rawInput: '' })} /><div className="mt-2"><EditableOccupationFields draft={draft} resolved={scfResolved.occupation} recommended={recommended.occupation} secondary={dosResolved} onChange={onChange} /></div><div className="config-toggle-pair mt-2 grid gap-2"><Toggle compact label="Spin polarization" detail="nspin = 2" checked={draft.spin} onChange={() => onChange({ spin: !draft.spin, rawInput: '' })} /><Toggle compact label="Spin–orbit coupling" detail="SOC · noncolin" checked={draft.soc} onChange={() => onChange({ soc: !draft.soc, noncollinear: !draft.soc || draft.noncollinear, rawInput: '' })} /></div>{hasHubbardElements && <div className="mt-2 border-t border-[var(--panel-border)] pt-2"><Toggle compact label="DFT+U (Hubbard)" detail={hubbardRecs.map((r) => `${r.species} ${r.manifold} · U = ${r.u} eV`).join(', ')} checked={draft.dftU} onChange={() => { if (!draft.dftU) { onChange({ dftU: true, hubbardProjector: draft.hubbardProjector || 'ortho-atomic', hubbardCorrections: hubbardRecs.map((r) => ({ species: r.species, manifold: r.manifold, u: r.u })), rawInput: '' }); } else { onChange({ dftU: false, rawInput: '' }); } }} /></div>}</fieldset>
    <section className="config-simple-card"><SectionTitle detail="pseudopotential-aware">Numerical basis</SectionTitle><div className="config-form-grid config-form-grid--3"><NumberField label="nk1" value={draft.kPoint} min={1} max={64} onChange={(kPoint) => onChange({ kPoint })} /><NumberField label="nk2" value={draft.kPointY} min={1} max={64} onChange={(kPointY) => onChange({ kPointY })} /><NumberField label="nk3" value={draft.kPointZ} min={1} max={64} onChange={(kPointZ) => onChange({ kPointZ })} /></div><fieldset disabled={inheritedModel} className="mt-2"><SelectField label="Pseudopotential family" value={draft.pseudoFamily} options={['SSSP efficiency', 'SSSP precision', 'PseudoDojo'].map((value) => ({ value, label: value }))} onChange={(pseudoFamily) => onChange({ pseudoFamily: pseudoFamily as JobDraft['pseudoFamily'], rawInput: '' })} /></fieldset><fieldset disabled={inheritedModel} className="mt-2"><EditableCutoffFields draft={draft} resolved={scfResolved.cutoff} recommended={recommended.cutoff} onChange={onChange} /></fieldset></section>
    <fieldset disabled={inheritedModel}><DipoleFields draft={draft} onChange={onChange} /></fieldset>
  </div>;
}

function SimpleSpecific({ calculation, draft, material, onChange }: { calculation: CalculationType; draft: JobDraft; material: MaterialContext; onChange: (patch: Partial<JobDraft>) => void }) {
  if (calculation === 'Structural relaxation') return <div className="config-specific-grid config-specific-grid--relax"><SelectField label="ion_dynamics" value={draft.ionDynamics} options={qeIonDynamicsOptions(draft)} onChange={(ionDynamics) => onChange({ ionDynamics: ionDynamics as JobDraft['ionDynamics'] })} /><NumberField label="forc_conv_thr" value={draft.forceThreshold} unit="Ry/Bohr" step={0.0005} onChange={(forceThreshold) => onChange({ forceThreshold })} />{draft.relaxCell && <NumberField label="Target pressure" value={draft.targetPressure} unit="kbar" step={0.5} onChange={(targetPressure) => onChange({ targetPressure })} />}</div>;
  if (calculation === 'Band structure') {
    const latticeInfo = latticeSystemInfoForMaterial(material);
    const bandsInfo = resolveAdaptiveBands(draft, material, calculation);
    const mode = resolveReciprocalPathMode(draft);
    const currentPath = mode === 'automatic' ? latticeInfo.defaultPath : draft.kPath;

    return <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="rounded-[4px] border border-[var(--panel-border)] bg-[var(--surface-subtle)] px-2 py-0.5 font-mono text-[10.5px] font-medium text-[var(--panel-accent)]">
            {formatSpaceGroupBadge(latticeInfo.displayName, material?.spaceGroup)}
          </span>
          <span className="text-[10.5px] text-[var(--panel-muted)]">
            {mode === 'automatic' ? 'Standard SeeK-path default' : 'Custom high-symmetry path'}
          </span>
        </div>
        {mode === 'custom' && (
          <button
            type="button"
            onClick={() => onChange({ kPath: latticeInfo.defaultPath, kPathMode: 'automatic' })}
            className="flex items-center gap-1 text-[10.5px] font-semibold text-[var(--panel-accent)] hover:text-white"
          >
            <RotateCcw className="h-3 w-3" />
            Reset standard path
          </button>
        )}
      </div>

      <div className="config-path-grid config-path-grid--bands">
        <div className="space-y-1">
          <TextField
            label="High-symmetry k-path (crystal_b)"
            value={currentPath}
            onChange={(kPath) => onChange({ kPath, kPathMode: 'custom' })}
          />
          <div className="flex items-center text-[10px] text-[var(--panel-muted)]">
            <span className="font-mono">crystal reciprocal</span>
          </div>
        </div>
        <div className="space-y-1">
          <NumberField
            label="Points / segment"
            value={draft.kPathPoints}
            min={5}
            max={200}
            onChange={(kPathPoints) => onChange({ kPathPoints })}
          />
          <div className="flex items-center text-[10px] text-[var(--panel-muted)]">
            <span className="font-mono">range 5–200</span>
          </div>
        </div>
        <div className="space-y-1">
          <NumberField
            label="Number of bands · nbnd"
            value={draft.numberOfBands}
            min={1}
            max={2000}
            onChange={(numberOfBands) => onChange({ numberOfBands })}
          />
          <div className="flex items-center justify-between gap-1 text-[10px]">
            <span className={cn('font-mono', !bandsInfo.isSufficient ? 'font-medium text-amber-400' : 'text-[var(--panel-muted)]')}>
              {!bandsInfo.isSufficient ? `⚠️ < ${bandsInfo.occupiedBands} occ` : `${bandsInfo.occupiedBands} occ`}
            </span>
            {draft.numberOfBands !== bandsInfo.recommendedNbnd && (
              <button
                type="button"
                onClick={() => onChange({ numberOfBands: bandsInfo.recommendedNbnd })}
                className="font-medium text-[var(--panel-accent)] hover:text-white"
              >
                Use rec ({bandsInfo.recommendedNbnd})
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 rounded-[6px] border border-[var(--panel-border)] bg-[var(--panel-raised)] px-2.5 py-1.5">
        <span className="text-[10.5px] font-medium text-[var(--panel-muted)]">High-symmetry points:</span>
        {latticeInfo.chips.map((point) => (
          <button
            key={point}
            type="button"
            onClick={() => {
              const base = (draft.kPath && mode === 'custom') ? draft.kPath.trim() : currentPath;
              const next = base ? `${base} — ${point}` : point;
              onChange({ kPath: next, kPathMode: 'custom' });
            }}
            className="rounded-[4px] border border-[var(--panel-border)] bg-[var(--panel-bg)] px-2 py-0.5 font-mono text-[10.5px] font-semibold text-[var(--panel-text)] hover:border-[var(--line-strong)] hover:bg-[var(--panel-hover)]"
            title={`Append point ${point} to reciprocal path`}
          >
            +{point}
          </button>
        ))}
      </div>
      <Toggle label="Orbital projected bands" detail="projwfc.x · atom/orbital weights" checked={draft.projectedBands ?? false} onChange={() => onChange({ projectedBands: !draft.projectedBands })} />
    </div>;
  }
  if (calculation === 'Density of states') return <div className="config-specific-grid config-specific-grid--dos"><NumberField label="Emin" value={draft.dosEnergyMin} unit="eV" step={0.5} onChange={(dosEnergyMin) => onChange({ dosEnergyMin })} /><NumberField label="Emax" value={draft.dosEnergyMax} unit="eV" step={0.5} onChange={(dosEnergyMax) => onChange({ dosEnergyMax })} /><NumberField label="DeltaE" value={draft.dosEnergyStep} unit="eV" step={0.005} onChange={(dosEnergyStep) => onChange({ dosEnergyStep })} /><Toggle compact label="Projected DOS" detail="projwfc.x" checked={draft.projectedDos} onChange={() => onChange({ projectedDos: !draft.projectedDos })} /></div>;
  if (calculation === 'Phonon dispersion') {
    const latticeInfo = latticeSystemInfoForMaterial(material);
    const mode = resolveReciprocalPathMode(draft);
    const currentPath = mode === 'automatic' ? latticeInfo.defaultPath : draft.kPath;

    return <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="rounded-[4px] border border-[var(--panel-border)] bg-[var(--surface-subtle)] px-2 py-0.5 font-mono text-[10.5px] font-medium text-[var(--panel-accent)]">
            {formatSpaceGroupBadge(latticeInfo.displayName, material?.spaceGroup)}
          </span>
          <span className="text-[10.5px] text-[var(--panel-muted)]">
            {mode === 'automatic' ? 'Standard SeeK-path default' : 'Custom high-symmetry path'}
          </span>
        </div>
        {mode === 'custom' && (
          <button
            type="button"
            onClick={() => onChange({ kPath: latticeInfo.defaultPath, kPathMode: 'automatic' })}
            className="flex items-center gap-1 text-[10.5px] font-semibold text-[var(--panel-accent)] hover:text-white"
          >
            <RotateCcw className="h-3 w-3" />
            Reset standard path
          </button>
        )}
      </div>

      <div className="config-path-grid">
        <TextField
          label="High-symmetry q-path (crystal_b)"
          value={currentPath}
          onChange={(kPath) => onChange({ kPath, kPathMode: 'custom' })}
        />
        <NumberField
          label="Points / segment"
          value={draft.kPathPoints}
          min={5}
          max={200}
          onChange={(kPathPoints) => onChange({ kPathPoints })}
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5 rounded-[6px] border border-[var(--panel-border)] bg-[var(--panel-raised)] px-2.5 py-1.5">
        <span className="text-[10.5px] font-medium text-[var(--panel-muted)]">High-symmetry points:</span>
        {latticeInfo.chips.map((point) => (
          <button
            key={point}
            type="button"
            onClick={() => {
              const base = (draft.kPath && mode === 'custom') ? draft.kPath.trim() : currentPath;
              const next = base ? `${base} — ${point}` : point;
              onChange({ kPath: next, kPathMode: 'custom' });
            }}
            className="rounded-[4px] border border-[var(--panel-border)] bg-[var(--panel-bg)] px-2 py-0.5 font-mono text-[10.5px] font-semibold text-[var(--panel-text)] hover:border-[var(--line-strong)] hover:bg-[var(--panel-hover)]"
            title={`Append point ${point} to phonon dispersion path`}
          >
            +{point}
          </button>
        ))}
      </div>

      <div className="config-specific-grid config-specific-grid--phonon">
        <NumberField label="nq1" value={draft.qPoint} min={1} max={32} onChange={(qPoint) => onChange({ qPoint })} />
        <NumberField label="nq2" value={draft.qPointY} min={1} max={32} onChange={(qPointY) => onChange({ qPointY })} />
        <NumberField label="nq3" value={draft.qPointZ} min={1} max={32} onChange={(qPointZ) => onChange({ qPointZ })} />
        <NumberField label="tr2_ph" value={draft.phononThreshold} step={1e-12} onChange={(phononThreshold) => onChange({ phononThreshold })} />
        <Toggle compact label="Dielectric tensor" detail="epsil = true" checked={draft.dielectricTensor} onChange={() => onChange({ dielectricTensor: !draft.dielectricTensor })} />
      </div>
    </div>;
  }
  if (calculation === 'Thermoelectric properties') return <div className="config-specific-grid config-specific-grid--thermo"><NumberField label="Temperature min" value={draft.transportTemperatureMin} unit="K" min={1} step={25} onChange={(transportTemperatureMin) => onChange({ transportTemperatureMin })} /><NumberField label="Temperature max" value={draft.transportTemperatureMax} unit="K" min={1} step={25} onChange={(transportTemperatureMax) => onChange({ transportTemperatureMax })} /><NumberField label="Temperature step" value={draft.transportTemperatureStep} unit="K" min={1} step={5} onChange={(transportTemperatureStep) => onChange({ transportTemperatureStep })} /><NumberField label="Interpolation" value={draft.transportInterpolationMultiplier} unit="×" min={1} max={12} onChange={(transportInterpolationMultiplier) => onChange({ transportInterpolationMultiplier })} /><NumberField label="Relaxation time" value={draft.transportRelaxationTime} unit="fs" min={0.01} step={1} onChange={(transportRelaxationTime) => onChange({ transportRelaxationTime })} /></div>;
  return <div className="rounded-[8px] border border-[var(--panel-border)] bg-[var(--panel-raised)] p-3.5 space-y-2">
    <div className="flex items-center justify-between">
      <span className="text-[11.5px] font-semibold text-[var(--panel-text)]">Self-Consistent Field (SCF) Ground State</span>
      <span className="font-mono text-[10.5px] text-[var(--panel-accent)]">{draft.accuracy} preset</span>
    </div>
    <p className="text-[10.5px] leading-relaxed text-[var(--panel-muted)]">
      Calculates the self-consistent Kohn-Sham ground state, total electronic energy, Fermi level, and converged valence charge density. Electronic convergence is governed by the {draft.accuracy} preset.
    </p>
    <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-[var(--panel-border)] text-[10.5px] text-[var(--panel-muted)] font-mono">
      <span>conv_thr = {draft.scfThreshold} Ry</span>
      <span>electron_maxstep = {draft.electronMaxSteps}</span>
      <span>mixing_beta = {draft.mixingBeta}</span>
    </div>
  </div>;
}

function PlotRangeFields({ calculation, draft, onChange }: { calculation: CalculationType; draft: JobDraft; onChange: (patch: Partial<JobDraft>) => void }) {
  if (calculation === 'Total energy' || calculation === 'Structural relaxation') return null;
  const xUnit = calculation === 'Density of states'
    ? 'eV'
    : calculation === 'Thermoelectric properties'
      ? 'eV'
      : 'path';
  const yUnit = calculation === 'Band structure'
    ? 'eV'
    : calculation === 'Density of states'
      ? 'states/eV'
      : calculation === 'Phonon dispersion'
        ? 'cm⁻¹'
        : undefined;
  const supportsSharedYRange = calculation !== 'Thermoelectric properties';
  return <section className="mt-3 rounded-[8px] border border-[var(--panel-border)] bg-[var(--panel-raised)] p-3">
    <div className="mb-2.5 flex min-w-0 items-start gap-3"><span className="min-w-0 flex-1"><span className="block text-[11px] font-semibold text-[var(--panel-text)]">Plot viewport</span><span className="mt-0.5 block text-[10.5px] leading-normal text-[var(--panel-muted)]">{calculation === 'Band structure' ? 'Energy relative to Fermi level (E − E_F = 0 eV). Valence band top or Fermi level aligns to zero.' : 'Optional. Leave blank for an automatic, data-driven paper viewport.'}</span></span><button type="button" onClick={() => onChange({ plotXMin: undefined, plotXMax: undefined, plotYMin: undefined, plotYMax: undefined })} className="h-7 shrink-0 rounded-[5px] px-2 text-[10.5px] font-semibold text-[var(--panel-muted)] hover:bg-[var(--panel-hover)] hover:text-[var(--panel-text)]">Reset to auto</button></div>
    <div className={cn('plot-range-grid grid gap-2', supportsSharedYRange && 'plot-range-grid--with-y')}>
      <OptionalNumberField label="X min" value={draft.plotXMin} unit={xUnit} onChange={(plotXMin) => onChange({ plotXMin })} />
      <OptionalNumberField label="X max" value={draft.plotXMax} unit={xUnit} onChange={(plotXMax) => onChange({ plotXMax })} />
      {supportsSharedYRange && <OptionalNumberField label="Y min" value={draft.plotYMin} unit={yUnit} onChange={(plotYMin) => onChange({ plotYMin })} />}
      {supportsSharedYRange && <OptionalNumberField label="Y max" value={draft.plotYMax} unit={yUnit} onChange={(plotYMax) => onChange({ plotYMax })} />}
    </div>
    {calculation === 'Thermoelectric properties' && <p className="mt-2 text-[10.5px] leading-relaxed text-[var(--panel-muted)]">Y remains automatic because each transport panel uses a different physical unit.</p>}
  </section>;
}

function AnalysisSampling({ draft, onChange, mesh = false }: { draft:JobDraft; onChange:(patch:Partial<JobDraft>)=>void; mesh?:boolean }) {
  return <section className="config-specific-card mt-3" aria-label="Analysis sampling"><SectionTitle detail="NSCF">Analysis sampling</SectionTitle><div className="config-form-grid config-form-grid--3"><NumberField label="nbnd (analysis)" value={draft.numberOfBands} min={1} onChange={numberOfBands=>onChange({numberOfBands})}/>{mesh && <><NumberField label="nk1 (analysis mesh)" value={draft.kPoint} min={1} max={64} onChange={kPoint=>onChange({kPoint})}/><NumberField label="nk2 (analysis mesh)" value={draft.kPointY} min={1} max={64} onChange={kPointY=>onChange({kPointY})}/><NumberField label="nk3 (analysis mesh)" value={draft.kPointZ} min={1} max={64} onChange={kPointZ=>onChange({kPointZ})}/><SelectField label="Analysis k-point shift" value={draft.kPointShift} options={['0 0 0','1 1 1','1 0 0','0 1 0','0 0 1'].map(value=>({value,label:value}))} onChange={kPointShift=>onChange({kPointShift:kPointShift as JobDraft['kPointShift']})}/></>}</div></section>;
}

function ManualControl({ draft, onChange }: { draft: JobDraft; onChange: (patch: Partial<JobDraft>) => void }) {
  return <div className="config-form-grid config-form-grid--3"><TextField label="title" value={draft.title} onChange={(title) => onChange({ title })} /><TextField label="prefix" value={draft.prefix} onChange={(prefix) => onChange({ prefix })} /><TextField label="outdir" value={draft.outdir} onChange={(outdir) => onChange({ outdir })} /><TextField label="pseudo_dir" value={draft.pseudoDir} onChange={(pseudoDir) => onChange({ pseudoDir })} /><SelectField label="restart_mode" value={draft.restartMode} options={[{ value: 'from_scratch', label: 'from_scratch' }, { value: 'restart', label: 'restart' }]} onChange={(restartMode) => onChange({ restartMode: restartMode as JobDraft['restartMode'] })} /><SelectField label="verbosity" value={draft.verbosity} options={[{ value: 'low', label: 'low' }, { value: 'high', label: 'high' }]} onChange={(verbosity) => onChange({ verbosity: verbosity as JobDraft['verbosity'] })} /><SelectField label="disk_io" value={draft.diskIO} options={['none', 'low', 'medium', 'high'].map((value) => ({ value, label: value }))} onChange={(diskIO) => onChange({ diskIO: diskIO as JobDraft['diskIO'] })} /><NumberField label="max_seconds" value={draft.maxSeconds} unit="s" min={60} step={60} onChange={(maxSeconds) => onChange({ maxSeconds })} /><NumberField label="nstep" value={draft.nstep} min={1} max={10000} onChange={(nstep) => onChange({ nstep })} /><Toggle label="tstress" checked={draft.printStress} onChange={() => onChange({ printStress: !draft.printStress })} /><Toggle label="tprnfor" checked={draft.printForces} onChange={() => onChange({ printForces: !draft.printForces })} /></div>;
}

function ManualSystem({ calculation, draft, material, onChange }: { calculation: CalculationType; draft: JobDraft; material: MaterialContext; onChange: (patch: Partial<JobDraft>) => void }) {
  const resolved = resolveQeAdaptiveParameters(draft, material, calculation, calculation === 'Structural relaxation' ? 'relax' : 'scf');
  const recommended = resolveQeAdaptiveParameters(qeRecommendationDraft(draft), material, calculation, calculation === 'Structural relaxation' ? 'relax' : 'scf');
  const dosResolved = calculation === 'Density of states'
    ? resolveQeAdaptiveParameters(draft, material, calculation, 'nscf-dos').occupation
    : undefined;
  const bandsInfo = resolveAdaptiveBands(draft, material, calculation);

  return <div className="space-y-3">
    <div className="config-form-grid config-form-grid--3">
      <SelectField label="input_dft" value={draft.functional} options={['PBE', 'LDA', 'HSE'].map((value) => ({ value, label: value }))} onChange={(functional) => onChange({ functional: functional as Functional, rawInput: '' })} />
      <SelectField label="Pseudopotential family" value={draft.pseudoFamily} options={['SSSP efficiency', 'SSSP precision', 'PseudoDojo'].map((value) => ({ value, label: value }))} onChange={(pseudoFamily) => onChange({ pseudoFamily: pseudoFamily as JobDraft['pseudoFamily'], rawInput: '' })} />
      <div className="space-y-1">
        <NumberField label="nbnd (SCF ground state)" value={draft.numberOfBands} onChange={(numberOfBands) => onChange({ numberOfBands })} />
        <div className="flex items-center justify-between text-[10px] text-[var(--panel-muted)]">
          <span>{bandsInfo.occupiedBands} occ states</span>
          {draft.numberOfBands !== bandsInfo.recommendedNbnd && (
            <button type="button" onClick={() => onChange({ numberOfBands: bandsInfo.recommendedNbnd })} className="font-medium text-[var(--panel-accent)] hover:text-white">
              Rec: {bandsInfo.recommendedNbnd}
            </button>
          )}
        </div>
      </div>
      <NumberField label="tot_charge" value={draft.totalCharge} unit="e" step={0.1} onChange={(totalCharge) => onChange({ totalCharge, rawInput: '' })} />
    </div>

    <section className="rounded-[8px] border border-[var(--panel-border)] bg-[var(--panel-raised)] p-3">
      <SectionTitle detail="Monkhorst-Pack grid for SCF ground state">K_POINTS automatic (SCF)</SectionTitle>
      <div className="config-form-grid config-form-grid--3">
        <NumberField label="nk1 (SCF mesh)" value={draft.kPoint} min={1} max={64} onChange={(kPoint) => onChange({ kPoint })} />
        <NumberField label="nk2 (SCF mesh)" value={draft.kPointY} min={1} max={64} onChange={(kPointY) => onChange({ kPointY })} />
        <NumberField label="nk3 (SCF mesh)" value={draft.kPointZ} min={1} max={64} onChange={(kPointZ) => onChange({ kPointZ })} />
        <SelectField label="K-point shift" value={draft.kPointShift} options={['0 0 0', '1 1 1', '1 0 0', '0 1 0', '0 0 1'].map((value) => ({ value, label: value }))} onChange={(kPointShift) => onChange({ kPointShift: kPointShift as JobDraft['kPointShift'] })} />
      </div>
    </section>

    <div className="config-method-columns">
      <section><SectionTitle detail="SCF / relaxation">Occupations</SectionTitle><EditableOccupationFields draft={draft} resolved={resolved.occupation} recommended={recommended.occupation} secondary={dosResolved} onChange={onChange} /></section>
      <section><SectionTitle detail="shared plane-wave basis">Cutoffs</SectionTitle><EditableCutoffFields draft={draft} resolved={resolved.cutoff} recommended={recommended.cutoff} onChange={onChange} /></section>
    </div>
    <DipoleFields draft={draft} onChange={onChange} />
    <div className="config-form-grid config-form-grid--3"><SelectField label="vdw_corr" value={draft.vdwCorrection} options={['none', 'dft-d3', 'dft-d3-bj', 'ts-vdw'].map((value) => ({ value, label: value }))} onChange={(vdwCorrection) => onChange({ vdwCorrection: vdwCorrection as JobDraft['vdwCorrection'] })} /><SelectField label="assume_isolated" value={draft.assumeIsolated} options={['none', '2D', 'esm', 'makov-payne', 'martyna-tuckerman'].map((value) => ({ value, label: value }))} onChange={(assumeIsolated) => onChange({ assumeIsolated: assumeIsolated as JobDraft['assumeIsolated'], rawInput: '' })} /><Toggle label="Use symmetry" detail="nosym = false" checked={draft.useSymmetry} onChange={() => onChange({ useSymmetry: !draft.useSymmetry })} /><Toggle label="Use inversion" detail="noinv = false" checked={draft.useInversion} onChange={() => onChange({ useInversion: !draft.useInversion })} /><Toggle label="Spin polarization" detail="nspin = 2" checked={draft.spin} onChange={() => onChange({ spin: !draft.spin, rawInput: '' })} /><Toggle label="Spin–orbit coupling" detail="lspinorb = true" checked={draft.soc} onChange={() => onChange({ soc: !draft.soc, noncollinear: !draft.soc || draft.noncollinear, rawInput: '' })} /></div>
    <ManualMagneticAndHubbard draft={draft} material={material} onChange={onChange} />
  </div>;
}

function ManualElectrons({ draft, onChange }: { draft: JobDraft; onChange: (patch: Partial<JobDraft>) => void }) {
  return <div className="config-form-grid config-form-grid--4"><NumberField label="conv_thr" value={draft.scfThreshold} step={1e-8} onChange={(scfThreshold) => onChange({ scfThreshold })} /><NumberField label="electron_maxstep" value={draft.electronMaxSteps} onChange={(electronMaxSteps) => onChange({ electronMaxSteps })} /><SelectField label="mixing_mode" value={draft.mixingMode} options={['plain', 'TF', 'local-TF'].map((value) => ({ value, label: value }))} onChange={(mixingMode) => onChange({ mixingMode: mixingMode as JobDraft['mixingMode'] })} /><NumberField label="mixing_beta" value={draft.mixingBeta} step={0.05} onChange={(mixingBeta) => onChange({ mixingBeta })} /><NumberField label="mixing_ndim" value={draft.mixingNdim} onChange={(mixingNdim) => onChange({ mixingNdim })} /><SelectField label="diagonalization" value={draft.diagonalization} options={['david', 'cg', 'rmm-davidson'].map((value) => ({ value, label: value }))} onChange={(diagonalization) => onChange({ diagonalization: diagonalization as JobDraft['diagonalization'] })} /><NumberField label="diago_thr_init" value={draft.diagonalizationThreshold} step={1e-8} onChange={(diagonalizationThreshold) => onChange({ diagonalizationThreshold })} /><SelectField label="startingpot" value={draft.startingPotential} options={['atomic', 'file'].map((value) => ({ value, label: value }))} onChange={(startingPotential) => onChange({ startingPotential: startingPotential as JobDraft['startingPotential'] })} /><SelectField label="startingwfc" value={draft.startingWavefunctions} options={['atomic+random', 'random', 'file'].map((value) => ({ value, label: value }))} onChange={(startingWavefunctions) => onChange({ startingWavefunctions: startingWavefunctions as JobDraft['startingWavefunctions'] })} /><Toggle label="scf_must_converge" checked={draft.scfMustConverge} onChange={() => onChange({ scfMustConverge: !draft.scfMustConverge })} /><Toggle label="diago_full_acc" checked={draft.diagoFullAccuracy} onChange={() => onChange({ diagoFullAccuracy: !draft.diagoFullAccuracy })} /><Toggle label="real_space" checked={draft.realSpace} onChange={() => onChange({ realSpace: !draft.realSpace })} /></div>;
}

function ManualSpecific({ calculation, draft, material, onChange }: { calculation: CalculationType; draft: JobDraft; material: MaterialContext; onChange: (patch: Partial<JobDraft>) => void }) {
  if (calculation === 'Structural relaxation') return <div className="space-y-3"><div className="config-form-grid config-form-grid--4"><SelectField label="ion_dynamics" value={draft.ionDynamics} options={qeIonDynamicsOptions(draft)} onChange={(ionDynamics) => onChange({ ionDynamics: ionDynamics as JobDraft['ionDynamics'] })} /><NumberField label="etot_conv_thr" value={draft.energyThreshold} unit="Ry" step={0.00001} onChange={(energyThreshold) => onChange({ energyThreshold })} /><NumberField label="forc_conv_thr" value={draft.forceThreshold} unit="Ry/Bohr" step={0.0005} onChange={(forceThreshold) => onChange({ forceThreshold })} /><NumberField label="trust_radius_ini" value={draft.trustRadius} unit="Bohr" step={0.05} onChange={(trustRadius) => onChange({ trustRadius })} /><SelectField label="pot_extrapolation" value={draft.potentialExtrapolation} options={['atomic', 'first_order', 'second_order'].map((value) => ({ value, label: value }))} onChange={(potentialExtrapolation) => onChange({ potentialExtrapolation: potentialExtrapolation as JobDraft['potentialExtrapolation'] })} /><SelectField label="wfc_extrapolation" value={draft.wavefunctionExtrapolation} options={['none', 'first_order', 'second_order'].map((value) => ({ value, label: value }))} onChange={(wavefunctionExtrapolation) => onChange({ wavefunctionExtrapolation: wavefunctionExtrapolation as JobDraft['wavefunctionExtrapolation'] })} /><Toggle label="Refold positions" checked={draft.refoldPositions} onChange={() => onChange({ refoldPositions: !draft.refoldPositions })} /></div>{draft.relaxCell && <section className="rounded-[8px] border border-[var(--panel-border)] bg-[var(--panel-raised)] p-3"><SectionTitle detail="used only by vc-relax">&amp;CELL</SectionTitle><div className="config-form-grid config-form-grid--4"><SelectField label="cell_dynamics" value={draft.cellDynamics} options={['bfgs', 'damp-pr', 'damp-w'].map((value) => ({ value, label: value }))} onChange={(cellDynamics) => onChange({ cellDynamics: cellDynamics as JobDraft['cellDynamics'] })} /><SelectField label="cell_dofree" value={draft.cellDoFree} options={['all', 'ibrav', 'shape', 'volume', '2Dxy'].map((value) => ({ value, label: value }))} onChange={(cellDoFree) => onChange({ cellDoFree: cellDoFree as JobDraft['cellDoFree'] })} /><NumberField label="press" value={draft.targetPressure} unit="kbar" step={0.5} onChange={(targetPressure) => onChange({ targetPressure })} /><NumberField label="press_conv_thr" value={draft.pressureThreshold} unit="kbar" step={0.1} onChange={(pressureThreshold) => onChange({ pressureThreshold })} /></div></section>}</div>;
  if (calculation === 'Band structure') {
    const latticeInfo = latticeSystemInfoForMaterial(material);
    const bandsInfo = resolveAdaptiveBands(draft, material, calculation);
    const mode = resolveReciprocalPathMode(draft);
    const currentPath = mode === 'automatic' ? latticeInfo.defaultPath : draft.kPath;

    return <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="rounded-[4px] border border-[var(--panel-border)] bg-[var(--surface-subtle)] px-2 py-0.5 font-mono text-[10.5px] font-medium text-[var(--panel-accent)]">
          {formatSpaceGroupBadge(latticeInfo.displayName, material?.spaceGroup)}
        </span>
        {mode === 'custom' && (
          <button
            type="button"
            onClick={() => onChange({ kPath: latticeInfo.defaultPath, kPathMode: 'automatic' })}
            className="flex items-center gap-1 text-[10.5px] font-semibold text-[var(--panel-accent)] hover:text-white"
          >
            <RotateCcw className="h-3 w-3" />
            Reset standard path
          </button>
        )}
      </div>

      <div className="config-path-grid config-path-grid--bands">
        <div className="space-y-1">
          <TextField
            label="K_POINTS crystal_b path"
            value={currentPath}
            onChange={(kPath) => onChange({ kPath, kPathMode: 'custom' })}
          />
          <div className="flex items-center text-[10px] text-[var(--panel-muted)]">
            <span className="font-mono">crystal reciprocal</span>
          </div>
        </div>
        <div className="space-y-1">
          <NumberField
            label="Points / segment"
            value={draft.kPathPoints}
            onChange={(kPathPoints) => onChange({ kPathPoints })}
          />
          <div className="flex items-center text-[10px] text-[var(--panel-muted)]">
            <span className="font-mono">range 5–200</span>
          </div>
        </div>
        <div className="space-y-1">
          <NumberField
            label="nbnd (band path)"
            value={draft.numberOfBands}
            onChange={(numberOfBands) => onChange({ numberOfBands })}
          />
          <div className="flex items-center justify-between text-[10px] text-[var(--panel-muted)]">
            <span>{bandsInfo.occupiedBands} occ</span>
            {draft.numberOfBands !== bandsInfo.recommendedNbnd && (
              <button
                type="button"
                onClick={() => onChange({ numberOfBands: bandsInfo.recommendedNbnd })}
                className="font-medium text-[var(--panel-accent)] hover:text-white"
              >
                Rec: {bandsInfo.recommendedNbnd}
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="config-form-grid config-form-grid--2">
        <Toggle compact label="lsym" detail="Classify irreducible reps" checked={draft.bandSymmetry} onChange={() => onChange({ bandSymmetry: !draft.bandSymmetry })} />
        <Toggle compact label="Overlap ordering" detail="Track wavefunction overlap" checked={draft.bandOverlap} onChange={() => onChange({ bandOverlap: !draft.bandOverlap })} />
      </div>

      <div className="flex flex-wrap items-center gap-1.5 rounded-[6px] border border-[var(--panel-border)] bg-[var(--panel-raised)] px-2.5 py-1.5">
        <span className="text-[10.5px] font-medium text-[var(--panel-muted)]">High-symmetry points:</span>
        {latticeInfo.chips.map((point) => (
          <button
            key={point}
            type="button"
            onClick={() => {
              const base = (draft.kPath && mode === 'custom') ? draft.kPath.trim() : currentPath;
              const next = base ? `${base} — ${point}` : point;
              onChange({ kPath: next, kPathMode: 'custom' });
            }}
            className="rounded-[4px] border border-[var(--panel-border)] bg-[var(--panel-bg)] px-2 py-0.5 font-mono text-[10.5px] font-semibold text-[var(--panel-text)] hover:border-[var(--line-strong)] hover:bg-[var(--panel-hover)]"
            title={`Append point ${point} to reciprocal path`}
          >
            +{point}
          </button>
        ))}
      </div>
      <Toggle label="Orbital projected bands" detail="projwfc.x · atom/orbital weights" checked={draft.projectedBands ?? false} onChange={() => onChange({ projectedBands: !draft.projectedBands })} />
    </div>;
  }
  if (calculation === 'Density of states') return <div className="space-y-3"><div className="config-form-grid config-form-grid--4"><NumberField label="Emin" value={draft.dosEnergyMin} unit="eV" step={0.5} onChange={(dosEnergyMin) => onChange({ dosEnergyMin })} /><NumberField label="Emax" value={draft.dosEnergyMax} unit="eV" step={0.5} onChange={(dosEnergyMax) => onChange({ dosEnergyMax })} /><NumberField label="DeltaE" value={draft.dosEnergyStep} unit="eV" step={0.005} onChange={(dosEnergyStep) => onChange({ dosEnergyStep })} /><Toggle label="Projected DOS" detail="projwfc.x" checked={draft.projectedDos} onChange={() => onChange({ projectedDos: !draft.projectedDos })} /><Toggle label="lsym" checked={draft.dosSymmetrize} onChange={() => onChange({ dosSymmetrize: !draft.dosSymmetrize })} /><Toggle label="pawproj" checked={draft.pawProjection} onChange={() => onChange({ pawProjection: !draft.pawProjection })} /></div><div className="rounded-[7px] border border-[var(--panel-border)] bg-[var(--panel-raised)] px-3 py-2"><p className="text-[11px] font-semibold text-[var(--panel-text)]">DOS integration · tetrahedra_opt</p><p className="mt-1 text-[10.5px] leading-relaxed text-[var(--panel-muted)]">The dense NSCF grid and dos.x use optimized tetrahedra. Gaussian broadening parameters are intentionally omitted.</p></div></div>;
  if (calculation === 'Phonon dispersion') {
    const latticeInfo = latticeSystemInfoForMaterial(material);
    const mode = resolveReciprocalPathMode(draft);
    const currentPath = mode === 'automatic' ? latticeInfo.defaultPath : draft.kPath;

    return <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="rounded-[4px] border border-[var(--panel-border)] bg-[var(--surface-subtle)] px-2 py-0.5 font-mono text-[10.5px] font-medium text-[var(--panel-accent)]">
          {formatSpaceGroupBadge(latticeInfo.displayName, material?.spaceGroup)}
        </span>
        {mode === 'custom' && (
          <button
            type="button"
            onClick={() => onChange({ kPath: latticeInfo.defaultPath, kPathMode: 'automatic' })}
            className="flex items-center gap-1 text-[10.5px] font-semibold text-[var(--panel-accent)] hover:text-white"
          >
            <RotateCcw className="h-3 w-3" />
            Reset standard path
          </button>
        )}
      </div>

      <div className="config-path-grid">
        <TextField
          label="matdyn q-path (crystal_b)"
          value={currentPath}
          onChange={(kPath) => onChange({ kPath, kPathMode: 'custom' })}
        />
        <NumberField
          label="Points / segment"
          value={draft.kPathPoints}
          onChange={(kPathPoints) => onChange({ kPathPoints })}
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5 rounded-[6px] border border-[var(--panel-border)] bg-[var(--panel-raised)] px-2.5 py-1.5">
        <span className="text-[10.5px] font-medium text-[var(--panel-muted)]">High-symmetry points:</span>
        {latticeInfo.chips.map((point) => (
          <button
            key={point}
            type="button"
            onClick={() => {
              const base = (draft.kPath && mode === 'custom') ? draft.kPath.trim() : currentPath;
              const next = base ? `${base} — ${point}` : point;
              onChange({ kPath: next, kPathMode: 'custom' });
            }}
            className="rounded-[4px] border border-[var(--panel-border)] bg-[var(--panel-bg)] px-2 py-0.5 font-mono text-[10.5px] font-semibold text-[var(--panel-text)] hover:border-[var(--line-strong)] hover:bg-[var(--panel-hover)]"
            title={`Append point ${point} to phonon dispersion path`}
          >
            +{point}
          </button>
        ))}
      </div>

      <div className="config-form-grid config-form-grid--4">
        <NumberField label="nq1" value={draft.qPoint} onChange={(qPoint) => onChange({ qPoint })} />
        <NumberField label="nq2" value={draft.qPointY} onChange={(qPointY) => onChange({ qPointY })} />
        <NumberField label="nq3" value={draft.qPointZ} onChange={(qPointZ) => onChange({ qPointZ })} />
        <NumberField label="tr2_ph" value={draft.phononThreshold} step={1e-12} onChange={(phononThreshold) => onChange({ phononThreshold })} />
        <NumberField label="niter_ph" value={draft.phononIterations} onChange={(phononIterations) => onChange({ phononIterations })} />
        <NumberField label="alpha_mix(1)" value={draft.phononMixing} step={0.05} onChange={(phononMixing) => onChange({ phononMixing })} />
        <NumberField label="nmix_ph" value={draft.phononMixingNdim} onChange={(phononMixingNdim) => onChange({ phononMixingNdim })} />
        <SelectField label="asr" value={draft.phononAsr} options={['none', 'simple', 'crystal', 'all'].map((value) => ({ value, label: value }))} onChange={(phononAsr) => onChange({ phononAsr: phononAsr as JobDraft['phononAsr'] })} />
        <SelectField label="electron_phonon" value={draft.electronPhonon} options={['none', 'simple', 'lambda_tetra'].map((value) => ({ value, label: value }))} onChange={(electronPhonon) => onChange({ electronPhonon: electronPhonon as JobDraft['electronPhonon'] })} />
        <Toggle label="epsil" checked={draft.dielectricTensor} onChange={() => onChange({ dielectricTensor: !draft.dielectricTensor })} />
        <Toggle label="zeu" checked={draft.effectiveCharges} onChange={() => onChange({ effectiveCharges: !draft.effectiveCharges })} />
      </div>
    </div>;
  }
  return <div className="config-form-grid config-form-grid--4"><NumberField label="conv_thr" value={draft.scfThreshold} step={1e-8} onChange={(scfThreshold) => onChange({ scfThreshold })} /><NumberField label="electron_maxstep" value={draft.electronMaxSteps} onChange={(electronMaxSteps) => onChange({ electronMaxSteps })} /><NumberField label="mixing_beta" value={draft.mixingBeta} step={0.05} onChange={(mixingBeta) => onChange({ mixingBeta })} /><SelectField label="diagonalization" value={draft.diagonalization} options={['david', 'cg', 'rmm-davidson'].map((value) => ({ value, label: value }))} onChange={(diagonalization) => onChange({ diagonalization: diagonalization as JobDraft['diagonalization'] })} /></div>;
}

export function CalculationConfigDrawer({ calculation, draft, material, structureSourceId, structureInputOptions, configurationSources, onChange, onStructureSourceChange, onAddRelaxationSource, onImportCalculationDraft, onApplyAccuracy, onClose, onSave, onRun, embedded = false, saveStatus, workflowInput, runDisabled = false, inheritedModel = false, inheritedDraft, scfSourceLabel }: {
  embedded?: boolean;
  workflowInput?: ReactNode;
  inheritedModel?: boolean;
  inheritedDraft?: JobDraft;
  scfSourceLabel?: string;
  runDisabled?: boolean;
  calculation: CalculationType;
  draft: JobDraft;
  material: MaterialContext;
  structureSourceId: string;
  structureInputOptions: Array<{ value: string; label: string; detail?: string; disabled?: boolean }>;
  configurationSources: Array<{ id: string; name: string; materialName: string; detail: string }>;
  onChange: (patch: Partial<JobDraft>) => void;
  onStructureSourceChange: (sourceId: string) => void;
  onAddRelaxationSource: () => void;
  onImportCalculationDraft: (sourceId: string) => void;
  onApplyAccuracy: (accuracy: Accuracy) => void;
  onClose: () => void;
  onSave: () => void;
  onRun: () => void;
  saveStatus?: string;
}) {
  const { t } = useLocale();
  const reducedMotion = useReducedMotion();
  const [mode, setMode] = useState<Mode>('simple');
  const [copiedInput, setCopiedInput] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);
  const [section, setSection] = useState<ManualSection>('control');
  const [importOpen, setImportOpen] = useState(false);
  const importMenuRef = useRef<HTMLDivElement>(null);
  const hasRelaxationSource = structureInputOptions.some((option) => option.value !== 'original' && !option.disabled);
  const geometryOptions = hasRelaxationSource ? structureInputOptions : [...structureInputOptions, { value: 'relaxation-required', label: 'Relaxation output', detail: 'Add Structural relaxation first', disabled: true }];
  const activeCalculationCode = calculationCodeFor(calculation, draft);
  const showAtomicMassesInSimple = calculation === 'Phonon dispersion' || hasNonStandardAtomicWeight(material);
  const structureSourceCard = !embedded && calculation !== 'Structural relaxation' ? <StructureSourceCard value={structureSourceId} options={geometryOptions} hasRelaxationSource={hasRelaxationSource} onChange={onStructureSourceChange} onAddRelaxation={onAddRelaxationSource} /> : null;
  const manualSections: Array<{ id: ManualSection; label: string; icon: typeof Cpu }> = [
    { id: 'control', label: 'CONTROL', icon: Cpu },
    { id: 'system', label: 'SYSTEM', icon: SlidersHorizontal },
    { id: 'electrons', label: 'ELECTRONS', icon: RotateCcw },
    { id: 'specific', label: 'SPECIFIC', icon: Cog },
    { id: 'structure', label: 'STRUCTURE', icon: SlidersHorizontal },
  ];

  useEffect(() => {
    const closeImportOnOutside = (event: PointerEvent) => {
      if (!importMenuRef.current?.contains(event.target as Node)) setImportOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (importOpen) {
        event.stopPropagation();
        setImportOpen(false);
        return;
      }
      if (!embedded) onClose();
    };
    document.addEventListener('pointerdown', closeImportOnOutside);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeImportOnOutside);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [importOpen, onClose, embedded]);

  const run = () => {
    try { generateQuantumEspressoInputFiles(draft, calculation, material); setInputError(null); onRun(); }
    catch (error) { setInputError(error instanceof Error ? error.message : 'Invalid QE input'); }
  };
  const modes = <div className="config-workbench-mode grid h-9 grid-cols-2 items-center rounded-[7px] border border-[var(--panel-border)] bg-[var(--panel-bg)] p-0.5" role="group" aria-label={t('Configuration mode', 'Mode konfigurasi')}>
    <button type="button" aria-pressed={mode === 'simple'} onClick={() => setMode('simple')} className={cn('h-8 rounded-[5px] px-3 text-[11px] font-semibold transition-colors', mode === 'simple' ? 'bg-[var(--panel-selected)] text-[var(--panel-text)] shadow-xs' : 'text-[var(--panel-muted)] hover:bg-[var(--panel-hover)] hover:text-[var(--panel-text)]')}>Simple</button>
    <button type="button" aria-pressed={mode === 'manual'} onClick={() => setMode('manual')} className={cn('h-8 rounded-[5px] px-3 text-[11px] font-semibold transition-colors', mode === 'manual' ? 'bg-[var(--panel-selected)] text-[var(--panel-text)] shadow-xs' : 'text-[var(--panel-muted)] hover:bg-[var(--panel-hover)] hover:text-[var(--panel-text)]')}>Manual</button>
  </div>;

  return <motion.section role={embedded ? undefined : 'dialog'} aria-label={`${calculation} configuration`} initial={embedded || reducedMotion ? false : { y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={embedded || reducedMotion ? undefined : { y: 8, opacity: 0 }} transition={{ duration: reducedMotion ? 0 : .18, ease: [.22, 1, .36, 1] }} className={`calculation-config-drawer ${embedded ? 'workflow-embedded-config' : 'absolute bottom-2 left-2 right-2 z-40 h-[calc(100%-16px)] min-h-[320px] rounded-[10px] border border-[var(--panel-border)] shadow-[0_-12px_42px_rgba(0,0,0,.34)] sm:bottom-3 sm:left-3 sm:right-3 sm:h-[min(680px,calc(100%-24px))]'} flex flex-col overflow-hidden bg-[var(--panel-bg)]`}>
    {embedded ? <header className="workflow-config-toolbar">
      <div className="workflow-config-input">{workflowInput}</div>
      <div className="workflow-config-tools">{modes}<button type="button" className="workflow-primary" disabled={!material || runDisabled} onClick={run}><Play size={16} />{t('Run', 'Jalankan')}</button></div>
    </header> : <header className="config-workbench-header shrink-0 border-b border-[var(--panel-border)] bg-[var(--panel-raised)]">
      <div className="config-workbench-identity flex min-w-0 items-center gap-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[6px] border border-[var(--panel-border)] bg-[var(--panel-bg)] text-[var(--panel-text)]"><SlidersHorizontal className="h-4 w-4" /></span>
        <span className="truncate text-[13.5px] font-semibold text-[var(--panel-text)] tracking-tight">{calculation}</span>
      </div>
      <div ref={importMenuRef} className="config-workbench-import relative">
        <button type="button" disabled={!configurationSources.length} aria-expanded={importOpen} aria-haspopup="menu" onClick={() => setImportOpen((current) => !current)} className="config-import-trigger"><Clipboard className="h-3.5 w-3.5" /><span className="min-w-0 flex-1 truncate text-left">Import configuration</span><span className="config-import-chevron"><ChevronDown className={cn('h-3 w-3 transition-transform', importOpen && 'rotate-180')} /></span></button>
        {importOpen && <div role="menu" aria-label={`Import ${calculation} configuration`} className="config-import-menu workspace-popover-motion absolute left-0 top-[40px] z-50"><div className="config-import-menu-heading"><span>Saved configurations</span><span>{configurationSources.length}</span></div>{configurationSources.map((source) => <button key={source.id} type="button" role="menuitem" onClick={() => { onImportCalculationDraft(source.id); setImportOpen(false); }} className="config-import-option"><span className="config-import-option-icon"><Clipboard className="h-3.5 w-3.5" /></span><span className="min-w-0 flex-1"><span className="config-import-option-title">{source.name}</span><span className="config-import-option-detail">{source.materialName} · {source.detail}</span></span></button>)}</div>}
      </div>
      {modes}
      <button type="button" onClick={onClose} aria-label="Close configuration" className="config-workbench-close grid h-8 w-8 shrink-0 place-items-center rounded-[6px] text-[var(--panel-muted)] hover:bg-[var(--panel-hover)] hover:text-[var(--panel-text)]"><X className="h-4 w-4" /></button>
    </header>}

    {scfSourceLabel ? <div className="config-drawer-body min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
      <section className="config-simple-card"><SectionTitle>Ground state from {scfSourceLabel}</SectionTitle><p className="mt-2 text-[11px] leading-5 text-[var(--panel-muted)]">Structure, functional, pseudopotentials, cutoffs, charge, spin and SCF convergence are inherited. Open the SCF node to change the ground state.</p><p className="mt-2 font-mono text-[10px] text-[var(--panel-text)]">{draft.functional} · {draft.pseudoFamily} · {draft.cutoff}/{draft.chargeDensityCutoff} Ry</p></section>
      {calculation !== 'Phonon dispersion' && <section className="config-specific-card mt-3"><SectionTitle>Analysis sampling</SectionTitle><div className="mt-2 config-form-grid config-form-grid--4"><NumberField label="nk1" value={draft.kPoint} min={1} max={64} onChange={kPoint => onChange({ kPoint })} /><NumberField label="nk2" value={draft.kPointY} min={1} max={64} onChange={kPointY => onChange({ kPointY })} /><NumberField label="nk3" value={draft.kPointZ} min={1} max={64} onChange={kPointZ => onChange({ kPointZ })} /><NumberField label="Bands" value={draft.numberOfBands} min={1} onChange={numberOfBands => onChange({ numberOfBands })} /></div></section>}
      <section className="config-specific-card mt-3"><SectionTitle detail={activeCalculationCode}>{calculation}</SectionTitle><SimpleSpecific calculation={calculation} draft={draft} material={material} onChange={onChange} /></section>
      {calculation === 'Thermoelectric properties' && <TransportSamplingNotice draft={draft} onChange={onChange} />}
      <PlotRangeFields calculation={calculation} draft={draft} onChange={onChange} />
      {!!draft.rawInput.trim() && <p role="alert" className="mt-3 text-[11px] text-[var(--status-danger)]">This analysis has an expert override. <button onClick={() => onChange({ rawInput: '' })}>Reset override to inherit the SCF</button></p>}
    </div> : mode === 'simple' ? <div className="config-drawer-body min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
      {structureSourceCard}
      {calculation === 'Structural relaxation' && <div className="mb-4"><RelaxationModeSelector draft={draft} onChange={onChange} /></div>}
      <CommonSimple inheritedModel={inheritedModel} calculation={calculation} draft={draft} material={material} onChange={onChange} onApplyAccuracy={onApplyAccuracy} />
      <section className="config-specific-card mt-3">
        <SectionTitle detail={`${activeCalculationCode} parameters`}>{calculation}</SectionTitle>
        <SimpleSpecific calculation={calculation} draft={draft} material={material} onChange={onChange} />
      </section>
      {inheritedModel && ['Density of states','Thermoelectric properties'].includes(calculation) && <AnalysisSampling draft={draft} onChange={onChange}/>}
      {showAtomicMassesInSimple && <div className="mt-3"><AtomicMassesCard draft={draft} material={material} onChange={onChange} /></div>}
      {calculation === 'Thermoelectric properties' && <TransportSamplingNotice draft={draft} onChange={onChange} />}
      <PlotRangeFields calculation={calculation} draft={draft} onChange={onChange} />
    </div> : <div className="config-manual-layout flex min-h-0 flex-1 flex-col">
      <nav aria-label="Quantum ESPRESSO parameter sections" className="config-manual-nav grid shrink-0 grid-cols-5 gap-1 border-b border-[var(--panel-border)] bg-[var(--panel-raised)] p-1.5">
        {manualSections.map((item) => {
          const Icon = item.icon;
          return <button key={item.id} type="button" aria-pressed={section === item.id} onClick={() => setSection(item.id)} className={cn('config-manual-tab flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-[6px] px-2 font-mono text-[9.5px] font-medium text-[var(--panel-muted)] hover:bg-[var(--panel-hover)] hover:text-[var(--panel-text)]', section === item.id && 'config-manual-tab--active bg-[var(--panel-selected)] font-semibold text-[var(--panel-text)]')}><Icon className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{item.label}</span></button>;
        })}
      </nav>
      <div className="config-manual-body min-w-0 flex-1 overflow-y-auto p-3 sm:p-4">
        {structureSourceCard}
        <fieldset disabled={inheritedModel} className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-[8px] border border-[var(--panel-border)] bg-[var(--panel-raised)] px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-[var(--panel-text)]">Presets:</span>
            <div className="inline-flex overflow-hidden rounded-[5px] border border-[var(--panel-border)]">
              {(['Fast', 'Balanced', 'High accuracy'] as Accuracy[]).map((acc) => (
                <button
                  key={acc}
                  type="button"
                  onClick={() => onApplyAccuracy(acc)}
                  className={cn(
                    'h-7 border-r border-[var(--panel-border)] px-2.5 text-[10.5px] font-medium transition-colors last:border-r-0',
                    draft.accuracy === acc
                      ? 'bg-[var(--panel-selected)] font-semibold text-[var(--panel-text)]'
                      : 'bg-[var(--panel-bg)] text-[var(--panel-muted)] hover:bg-[var(--panel-hover)] hover:text-[var(--panel-text)]'
                  )}
                >
                  {acc === 'High accuracy' ? 'High' : acc}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              const latticeInfo = latticeSystemInfoForMaterial(material);
              const bandsInfo = resolveAdaptiveBands(draft, material, calculation);
              const rec = resolveQeAdaptiveParameters(qeRecommendationDraft(draft), material, calculation, calculation === 'Structural relaxation' ? 'relax' : 'scf');
              onApplyAccuracy('Balanced');
              onChange({
                rawInput: '',
                kPathMode: 'automatic',
                kPath: latticeInfo.defaultPath,
                numberOfBands: bandsInfo.recommendedNbnd,
                ...recommendedCutoffFields(rec.cutoff),
                ...recommendedOccupationFields(draft, rec.occupation),
                scfThreshold: 1e-8,
                electronMaxSteps: 100,
                mixingBeta: 0.7,
              });
            }}
            className="flex items-center gap-1.5 rounded-[5px] border border-[var(--panel-border)] bg-[var(--panel-bg)] px-2.5 py-1 text-[10.5px] font-medium text-[var(--panel-muted)] hover:border-[var(--line-strong)] hover:text-[var(--panel-text)]"
            title="Reset parameters to crystal-aware guided defaults"
          >
            <RotateCcw className="h-3 w-3" />
            Reset to guided defaults
          </button>
        </fieldset>
        {calculation === 'Structural relaxation' && <div className="mb-3"><RelaxationModeSelector draft={draft} onChange={onChange} /></div>}
        <SectionTitle detail={section === 'specific' ? activeCalculationCode : 'Quantum ESPRESSO namelist'}>{section === 'specific' ? calculation : `&${section.toUpperCase()}`}</SectionTitle>
        {section === 'control' && <fieldset disabled={inheritedModel}><ManualControl draft={draft} onChange={onChange} /></fieldset>}
        {section === 'system' && <><fieldset disabled={inheritedModel}><ManualSystem calculation={calculation} draft={inheritedModel && inheritedDraft ? inheritedDraft : draft} material={material} onChange={onChange} /></fieldset>{inheritedModel && calculation !== 'Phonon dispersion' && <AnalysisSampling draft={draft} onChange={onChange} mesh={calculation !== 'Band structure'}/>}</>}
        {section === 'structure' && <><fieldset disabled={inheritedModel}><StructureCards draft={draft} material={material} onChange={onChange} copied={copiedInput} onCopy={() => { void navigator.clipboard.writeText(draft.rawInput || generateQuantumEspressoInput(draft, calculation, material)).then(() => { setCopiedInput(true); window.setTimeout(() => setCopiedInput(false), 1200); }); }} /></fieldset><p className="mt-3 text-[11px] leading-relaxed text-[var(--panel-muted)]">Resolved preview uses fractional coordinates and Å. Calculation-local cards require the original structure source. Expert raw input overrides these cards.</p><pre className="mt-2 overflow-x-auto rounded-[7px] bg-[var(--panel-raised)] p-3 font-mono text-[11px] text-[var(--panel-text)]">{draft.rawInput || generateQuantumEspressoInput(draft, calculation, material)}</pre></>}
        {section === 'electrons' && <fieldset disabled={inheritedModel}><ManualElectrons draft={draft} onChange={onChange} /></fieldset>}
        {section === 'specific' && <><ManualSpecific calculation={calculation} draft={draft} material={material} onChange={onChange} />{calculation === 'Thermoelectric properties' && <TransportSamplingNotice draft={draft} onChange={onChange} />}<PlotRangeFields calculation={calculation} draft={draft} onChange={onChange} /></>}
      </div>
    </div>}

    {(inputError || qeMethodIssue(draft, calculation, Boolean(draft.rawInput.trim()))) && <p role="alert" className="shrink-0 border-t border-[var(--panel-border)] px-3 py-2 text-[11px] font-medium text-[var(--status-danger)]">{inputError || qeMethodIssue(draft, calculation, Boolean(draft.rawInput.trim()))}</p>}
    {!embedded && <footer className="config-workbench-footer grid shrink-0 grid-cols-2 items-center gap-2 border-t border-[var(--panel-border)] bg-[var(--panel-raised)] px-2.5 py-2 sm:flex sm:px-3.5"><span className="config-workbench-saved hidden items-center gap-1.5 text-[11px] font-medium text-[var(--panel-muted)] sm:flex"><Check className="h-3.5 w-3.5 text-[var(--status-success)]" />{saveStatus === undefined || saveStatus === 'synced' ? 'Saved' : saveStatus === 'saving' ? 'Saving…' : 'Local draft'}</span><button type="button" onClick={onSave} disabled={!material} className="flex h-10 min-w-0 items-center justify-center gap-1.5 rounded-[6px] border border-[var(--panel-border)] bg-[var(--panel-bg)] px-2 text-[11px] font-semibold text-[var(--panel-text)] hover:bg-[var(--panel-hover)] disabled:opacity-40 sm:ml-auto sm:px-3.5 sm:text-[11.5px]"><Save className="h-3.5 w-3.5 shrink-0" /><span className="truncate">Save configuration</span></button><button type="button" onClick={() => { try { generateQuantumEspressoInputFiles(draft, calculation, material); setInputError(null); onRun(); } catch (error) { setInputError(error instanceof Error ? error.message : 'Invalid QE input'); } }} disabled={!material} className="flex h-10 min-w-0 items-center justify-center gap-1.5 rounded-[6px] bg-[#e4e7ec] px-2 text-[11px] font-semibold text-black hover:bg-[#f0f2f5] disabled:opacity-40 sm:px-4 sm:text-[11.5px]"><Play className="h-3.5 w-3.5 shrink-0 fill-current" /><span className="truncate">Run calculation</span></button></footer>}
  </motion.section>;
}

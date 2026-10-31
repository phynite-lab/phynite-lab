'use client';

import type { JobDraft, MaterialContext } from './JobComposer';
import { CommittedNumberInput } from './CommittedNumberInput';
import { UiSelect } from './UiSelect';
import { atomicMasses } from '@/lib/qe-atomic-masses';
import { LabSwitch } from './LabControls';

function Numeric({ label, value, min, max, onChange }: { label: string; value: number; min?: number; max?: number; onChange: (value: number) => void }) {
  return <label className="block text-[11px] font-medium text-[var(--panel-muted)]">{label}<CommittedNumberInput value={value} min={min} max={max} step={0.05} onCommit={onChange} className="mt-1 h-8 w-full rounded-[4px] border border-[var(--panel-border)] bg-[var(--panel-bg)] px-2 font-mono text-[11px] text-[var(--panel-text)]" /></label>;
}

export function hasNonStandardAtomicWeight(material?: MaterialContext): boolean {
  return (material?.species ?? []).some((sp) => atomicMasses[sp] === undefined);
}

export function AtomicMassesCard({ draft, material, onChange }: { draft: JobDraft; material: MaterialContext; onChange: (patch: Partial<JobDraft>) => void }) {
  const labels = Array.from(new Set((draft.atomicPositions ?? material?.atoms ?? []).map((atom) => atom.label?.trim() || atom.species)));
  const species = new Map((draft.atomicPositions ?? material?.atoms ?? []).map((atom) => [atom.label?.trim() || atom.species, atom.species]));
  const change = (patch: Partial<JobDraft>) => onChange({ ...patch, rawInput: '' });

  return <details className="rounded-[7px] border border-[var(--panel-border)] bg-[var(--panel-raised)] p-3">
    <summary className="cursor-pointer text-[11.5px] font-semibold text-[var(--panel-text)]">Atomic masses and isotope overrides (u)</summary>
    <p className="mt-2 text-[10.5px] leading-relaxed text-[var(--panel-muted)]">Blank uses the CIAAW conventional standard atomic weight. Elements without a standard weight require an explicit isotope mass. Nuclear mass determines phonon frequencies (ω ∝ 1/√M) and MD kinetics; electronic eigenvalues remain unaffected.</p>
    <div className="mt-2 grid grid-cols-2 gap-2">{labels.map((label) => <label key={label} className="text-[11px] font-medium text-[var(--panel-muted)]">{label} · {species.get(label)}<input key={`${label}:${draft.atomicMassOverrides?.[label] ?? ''}`} type="number" min={0.000001} step="any" aria-label={`Isotope mass override for ${label}`} defaultValue={draft.atomicMassOverrides?.[label] ?? ''} placeholder={atomicMasses[species.get(label)!]?.toString() ?? 'Isotope mass required'} onBlur={(event) => {
      const text = event.currentTarget.value.trim();
      const value = Number(text);
      if (text && (!Number.isFinite(value) || value <= 0)) { event.currentTarget.value = String(draft.atomicMassOverrides?.[label] ?? ''); return; }
      const overrides = { ...draft.atomicMassOverrides };
      if (!text) delete overrides[label]; else overrides[label] = value;
      change({ atomicMassOverrides: overrides });
    }} className="mt-1 h-8 w-full rounded-[4px] border border-[var(--panel-border)] bg-[var(--panel-bg)] px-2 font-mono text-[11px] text-[var(--panel-text)]" /></label>)}</div>
  </details>;
}

export function ManualMagneticAndHubbard({ draft, material, onChange }: { draft: JobDraft; material: MaterialContext; onChange: (patch: Partial<JobDraft>) => void }) {
  const labels = Array.from(new Set((draft.atomicPositions ?? material?.atoms ?? []).map((atom) => atom.label?.trim() || atom.species)));
  const magnetic = draft.spin || draft.noncollinear || draft.soc;
  const collinear = draft.spin && !draft.noncollinear && !draft.soc;
  const corrections = draft.hubbardCorrections ?? [];
  const change = (patch: Partial<JobDraft>) => onChange({ ...patch, rawInput: '' });

  return <div className="space-y-3">
    <section className="rounded-[7px] border border-[var(--panel-border)] bg-[var(--panel-raised)] p-3">
      <LabSwitch checked={draft.noncollinear || draft.soc} onCheckedChange={(noncollinear) => change({ noncollinear, magnetizationConstraint: 'unconstrained' })} disabled={draft.soc} aria-label="Noncollinear magnetism">
        <span className="text-[11.5px] font-semibold text-[var(--panel-text)]">Noncollinear magnetism {draft.soc ? '· required by SOC' : ''}</span>
      </LabSwitch>
      {magnetic && <div className="mt-3 space-y-2 border-t border-[var(--panel-border)] pt-3">
        <UiSelect label="Magnetization constraint" value={draft.magnetizationConstraint ?? 'unconstrained'} options={[{ value: 'unconstrained', label: 'Unconstrained · species seeds' }, ...(collinear ? [{ value: 'total', label: 'Fixed total magnetization' }] : [])]} onChange={(value) => change({ magnetizationConstraint: value as JobDraft['magnetizationConstraint'] })} />
        {draft.magnetizationConstraint === 'total' ? <div className="mt-2"><Numeric label="Fixed total magnetization (μB/cell)" value={draft.totalMagnetization} onChange={(totalMagnetization) => change({ totalMagnetization })} /></div> : <>
          <p className="mt-1 text-[10.5px] leading-relaxed text-[var(--panel-muted)]">Seeds are fractions of valence electrons (−1 to 1), along z. Distinct labels such as Fe1 and Fe2 define magnetic sublattices. Compare initial states before identifying a magnetic ground state.</p>
          <div className="mt-2 grid grid-cols-2 gap-2">{labels.map((label) => <Numeric key={label} label={`starting_magnetization · ${label}`} value={draft.startingMagnetizations?.[label] ?? (draft.spin ? draft.startingMagnetization : 0)} min={-1} max={1} onChange={(value) => change({ startingMagnetizations: { ...draft.startingMagnetizations, [label]: value } })} />)}</div>
        </>}
      </div>}
    </section>

    <section className="rounded-[7px] border border-[var(--panel-border)] bg-[var(--panel-raised)] p-3">
      <LabSwitch checked={draft.dftU} onCheckedChange={(dftU) => change({ dftU, hubbardProjector: draft.hubbardProjector ?? 'ortho-atomic' })} aria-label="DFT+U"><span className="text-[11.5px] font-semibold text-[var(--panel-text)]">DFT+U · explicit species and manifold</span></LabSwitch>
      {draft.dftU && <div className="mt-2 space-y-2">
        <UiSelect label="Hubbard projector" value={draft.hubbardProjector ?? ''} options={[{ value: '', label: 'Choose projector' }, ...['atomic', 'ortho-atomic', 'norm-atomic'].map((value) => ({ value, label: value }))]} onChange={(value) => change({ hubbardProjector: value as JobDraft['hubbardProjector'] })} />
        <p className="text-[10.5px] leading-relaxed text-[var(--panel-muted)]">Choose a manifold present in the actual UPF orbitals. U is in eV and applies to the selected species label. U+J, U+V and orbital-resolved corrections require expert input.</p>
        {corrections.map((correction, index) => <div key={index} className="grid grid-cols-2 gap-2 rounded-[5px] border border-[var(--panel-border)] p-2">
          <UiSelect label="QE species label" value={correction.species} options={labels.map((value) => ({ value, label: value }))} onChange={(species) => change({ hubbardCorrections: corrections.map((entry, at) => at === index ? { ...entry, species } : entry) })} />
          <UiSelect label="Manifold" value={correction.manifold} options={[{ value: '', label: 'Choose manifold' }, ...['1s', '2s', '2p', '3s', '3p', '3d', '4s', '4p', '4d', '4f', '5s', '5p', '5d', '5f', '6s', '6p', '6d', '7s', '7p'].map((value) => ({ value, label: value }))]} onChange={(manifold) => change({ hubbardCorrections: corrections.map((entry, at) => at === index ? { ...entry, manifold } : entry) })} />
          <Numeric label="U (eV)" value={correction.u} min={0} onChange={(u) => change({ hubbardCorrections: corrections.map((entry, at) => at === index ? { ...entry, u } : entry) })} />
          <button type="button" onClick={() => change({ hubbardCorrections: corrections.filter((_, at) => at !== index) })} className="self-end rounded-[5px] px-2 py-2 text-[10.5px] font-medium text-[var(--panel-muted)] hover:bg-[var(--panel-hover)]">Remove correction</button>
        </div>)}
        <button type="button" disabled={!labels.length} onClick={() => change({ hubbardCorrections: [...corrections, { species: labels[0], manifold: '', u: draft.hubbardU }] })} className="rounded-[5px] border border-[var(--panel-border)] px-2 py-2 text-[11px] font-semibold text-[var(--panel-text)]">Add Hubbard correction</button>
      </div>}
    </section>
  </div>;
}

export function QeMethodFields({ draft, material, onChange }: { draft: JobDraft; material: MaterialContext; onChange: (patch: Partial<JobDraft>) => void }) {
  return <div className="mt-3 space-y-3">
    <ManualMagneticAndHubbard draft={draft} material={material} onChange={onChange} />
    <AtomicMassesCard draft={draft} material={material} onChange={onChange} />
  </div>;
}

export function TransportSamplingNotice({ draft, onChange }: { draft: JobDraft; onChange: (patch: Partial<JobDraft>) => void }) {
  const obsolete = [draft.transportChemicalPotentialStep, draft.transportDopingMin, draft.transportDopingMax, draft.transportDopingPoints].some((value) => value !== undefined) || draft.transportScatteringModel !== 'constant-relaxation-time';
  return <div className="mt-3 rounded-[7px] border border-[var(--panel-border)] bg-[var(--panel-raised)] p-3 text-[10.5px] leading-relaxed text-[var(--panel-muted)]">
    Transport supports constant relaxation time and the native chemical-potential grid. The μ window filters retained results; energy bins set integration resolution. Doping sweeps, an imposed μ step and constant mean free path are unavailable.
    {obsolete && <><p className="mt-2 text-[11px] text-[var(--status-danger)]">This saved draft contains unsupported transport options and cannot run.</p><button type="button" onClick={() => onChange({ transportChemicalPotentialStep: undefined, transportDopingMin: undefined, transportDopingMax: undefined, transportDopingPoints: undefined, transportScatteringModel: 'constant-relaxation-time', transportSampling: 'chemical-potential', rawInput: '' })} className="mt-2 rounded-[5px] border border-[var(--panel-border)] px-2 py-2 text-[11px] font-semibold text-[var(--panel-text)]">Reset transport sampling</button></>}
  </div>;
}

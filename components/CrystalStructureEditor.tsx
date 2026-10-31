'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { CommittedNumberInput } from '@/components/CommittedNumberInput';
import type { CustomAtom, LatticeParameters } from '@/components/CrystalViewer';
import { UiSelect } from '@/components/UiSelect';
import { cartesianToFractional, cellVectorsFromLattice, fractionalToCartesian } from '@/lib/structure-parsers';

type Vector3 = [number, number, number];
type CellUnit = 'angstrom' | 'bohr' | 'alat';
type PositionUnit = 'crystal' | 'angstrom' | 'bohr' | 'alat';

const BOHR_TO_ANGSTROM = 0.529177210903;

function scaleVector(vector: Vector3, factor: number): Vector3 {
  return [vector[0] * factor, vector[1] * factor, vector[2] * factor];
}

function elementFromLabel(label: string, fallback: string) {
  const match = label.match(/[A-Za-z][a-z]?/);
  if (!match) return fallback;
  return match[0][0].toUpperCase() + match[0].slice(1).toLowerCase();
}

export function CrystalStructureEditor({
  atoms,
  lattice,
  onCellVectorsChange,
  onAtomChange,
  onAddAtom,
  onDeleteAtom,
  selectedAtomId, onSelectAtom, viewKey,
}: {
  atoms: CustomAtom[];
  lattice: LatticeParameters;
  onCellVectorsChange: (vectors: [Vector3, Vector3, Vector3]) => void;
  onAtomChange: (id: string, patch: Partial<CustomAtom>) => void;
  onAddAtom: () => void;
  onDeleteAtom: (id: string) => void;
  selectedAtomId?: string | null; onSelectAtom?: (id:string) => void; viewKey?: string;
}) {
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [cellUnit, setCellUnit] = useState<CellUnit>('angstrom');
  const [positionUnit, setPositionUnit] = useState<PositionUnit>('crystal');
  const [alat, setAlat] = useState(Math.max(lattice.a, 1e-10));
  useEffect(() => {
    if (viewKey) try { const saved=JSON.parse(localStorage.getItem(viewKey) ?? 'null'); if (saved) queueMicrotask(() => { if (['angstrom','bohr','alat'].includes(saved.cellUnit)) setCellUnit(saved.cellUnit); if (['crystal','angstrom','bohr','alat'].includes(saved.positionUnit)) setPositionUnit(saved.positionUnit); if (Number.isFinite(saved.alat) && saved.alat>0) setAlat(saved.alat); }); } catch {}
    queueMicrotask(() => setLoaded(true));
  }, [viewKey]);
  useEffect(() => { if (loaded && viewKey) try { localStorage.setItem(viewKey,JSON.stringify({cellUnit,positionUnit,alat})); } catch {} }, [loaded,viewKey,cellUnit,positionUnit,alat]);
  const commitCell = (vectors: [Vector3,Vector3,Vector3]) => { try { onCellVectorsChange(vectors); setError(''); return true; } catch (failure) { setError((failure as Error).message); return false; } };
  const cellInAngstrom = useMemo(() => cellVectorsFromLattice(lattice), [lattice]);
  const cellFactor = cellUnit === 'bohr' ? 1 / BOHR_TO_ANGSTROM : cellUnit === 'alat' ? 1 / alat : 1;
  const displayedCell = cellInAngstrom.map((vector) => scaleVector(vector, cellFactor)) as [Vector3, Vector3, Vector3];

  const displayedPosition = (atom: CustomAtom): Vector3 => {
    if (positionUnit === 'crystal') return [atom.x, atom.y, atom.z];
    const cartesian = fractionalToCartesian(atom, lattice);
    const factor = positionUnit === 'bohr' ? 1 / BOHR_TO_ANGSTROM : positionUnit === 'alat' ? 1 / alat : 1;
    return scaleVector(cartesian, factor);
  };

  const updateCellValue = (row: number, column: number, value: number) => {
    const nextDisplayed = displayedCell.map((vector) => [...vector] as Vector3) as [Vector3, Vector3, Vector3];
    nextDisplayed[row][column] = value;
    const factor = cellUnit === 'bohr' ? BOHR_TO_ANGSTROM : cellUnit === 'alat' ? alat : 1;
    commitCell(nextDisplayed.map((vector) => scaleVector(vector, factor)) as [Vector3, Vector3, Vector3]);
  };

  const updatePosition = (atom: CustomAtom, axis: number, value: number) => {
    const next = displayedPosition(atom);
    next[axis] = value;
    if (positionUnit === 'crystal') {
      onAtomChange(atom.id, { x: next[0], y: next[1], z: next[2] });
      return;
    }
    const factor = positionUnit === 'bohr' ? BOHR_TO_ANGSTROM : positionUnit === 'alat' ? alat : 1;
    const fractional = cartesianToFractional(scaleVector(next, factor), lattice);
    onAtomChange(atom.id, { x: fractional[0], y: fractional[1], z: fractional[2] });
  };

  const updateAlat = (value: number) => {
    const nextAlat = Math.max(value, 1e-10);
    const factor = nextAlat / alat;
    if (cellUnit === 'alat' && !commitCell(cellInAngstrom.map((vector) => scaleVector(vector, factor)) as [Vector3, Vector3, Vector3])) return;
    setAlat(nextAlat);
  };

  return (
    <div className="space-y-2.5">
      {error && <p className="crystal-builder-error" role="alert">{error}</p>}
      <section className="overflow-hidden rounded-[7px] border border-[var(--panel-border)] bg-[var(--panel-raised)]">
        <header className="flex min-h-9 items-center justify-between gap-2 border-b border-[var(--panel-border)] px-2.5 py-1.5">
          <span className="min-w-0 truncate text-[11px] font-medium text-[var(--panel-text)]">Cell parameters</span>
          <div className="w-[104px]">
            <UiSelect compact ariaLabel="Cell parameter unit" value={cellUnit} options={[{ value: 'angstrom', label: 'angstrom' }, { value: 'bohr', label: 'bohr' }, { value: 'alat', label: 'alat' }]} onChange={(value) => setCellUnit(value as CellUnit)} mono />
          </div>
        </header>

        {cellUnit === 'alat' && (
          <div className="flex items-center justify-between gap-2 border-b border-[var(--panel-border)] bg-[var(--panel-bg)] px-2.5 py-1.5">
            <div className="min-w-0">
              <span className="block text-[10px] font-medium text-[var(--panel-text)]">Lattice constant (alat)</span>
              <span className="block text-[9px] text-[var(--panel-muted)]">Dimensionless cell scaling</span>
            </div>
            <label className="lattice-parameter-cell h-7 w-[108px] rounded-[4px] border border-[var(--panel-border)] bg-[var(--panel-raised)] px-1.5">
              <CommittedNumberInput
                aria-label="Lattice constant alat"
                value={Number(alat.toFixed(9))}
                min={0.000001}
                step="0.000001"
                onCommit={updateAlat}
                className="lattice-parameter-input"
              />
              <span className="font-mono text-[9px] text-[var(--panel-muted)] shrink-0 select-none">Å</span>
            </label>
          </div>
        )}

        <div className="overflow-x-auto" role="region" aria-label="Cell parameters" tabIndex={0}>
          <div className="grid min-w-[340px] grid-cols-[28px_repeat(3,minmax(0,1fr))] divide-x divide-[var(--panel-border)] border-b border-[var(--panel-border)] bg-[var(--panel-bg)] h-6 items-center text-center font-mono text-[9px] font-semibold text-[var(--panel-muted)] select-none">
            <span />
            <span>X</span>
            <span>Y</span>
            <span>Z</span>
          </div>
          {displayedCell.map((vector, row) => (
            <div
              key={`cell-row-${row}`}
              className="grid min-w-[340px] grid-cols-[28px_repeat(3,minmax(0,1fr))] divide-x divide-[var(--panel-border)] border-b border-[var(--panel-border)] last:border-b-0 h-8 items-stretch"
            >
              <span className="grid place-items-center bg-[var(--panel-bg)]/60 font-mono text-[10px] font-semibold text-[var(--panel-muted)] select-none">
                {['a', 'b', 'c'][row]}
              </span>
              {vector.map((value, column) => (
                <label key={`cell-${row}-${column}`} className="lattice-parameter-cell">
                  <CommittedNumberInput
                    aria-invalid={Boolean(error)}
                    aria-label={`Cell vector ${row + 1} ${['x', 'y', 'z'][column]}`}
                    step="0.000001"
                    value={Number(value.toFixed(9))}
                    onCommit={(next) => updateCellValue(row, column, next)}
                    className="lattice-parameter-input"
                  />
                </label>
              ))}
            </div>
          ))}
        </div>
      </section>

      <section className="overflow-hidden rounded-[7px] border border-[var(--panel-border)] bg-[var(--panel-raised)]">
        <header className="flex min-h-9 items-center justify-between gap-2 border-b border-[var(--panel-border)] px-2.5 py-1.5">
          <span className="min-w-0 truncate text-[11px] font-medium text-[var(--panel-text)]">Atomic positions</span>
          <div className="w-[104px]">
            <UiSelect compact ariaLabel="Atomic coordinate unit" value={positionUnit} options={[{ value: 'crystal', label: 'crystal', detail: 'Fractional coordinates' }, { value: 'angstrom', label: 'angstrom', detail: 'Cartesian Å' }, { value: 'bohr', label: 'bohr', detail: 'Cartesian a₀' }, { value: 'alat', label: 'alat', detail: 'Scaled Cartesian' }]} onChange={(value) => setPositionUnit(value as PositionUnit)} mono />
          </div>
        </header>

        {positionUnit === 'alat' && cellUnit !== 'alat' && (
          <div className="flex items-center justify-between gap-2 border-b border-[var(--panel-border)] bg-[var(--panel-bg)] px-2.5 py-1.5">
            <div className="min-w-0">
              <span className="block text-[10px] font-medium text-[var(--panel-text)]">Lattice constant (alat)</span>
              <span className="block text-[9px] text-[var(--panel-muted)]">Reference for position scaling</span>
            </div>
            <label className="lattice-parameter-cell h-7 w-[108px] rounded-[4px] border border-[var(--panel-border)] bg-[var(--panel-raised)] px-1.5">
              <CommittedNumberInput
                aria-label="Atomic position lattice constant alat"
                value={Number(alat.toFixed(9))}
                min={0.000001}
                step="0.000001"
                onCommit={updateAlat}
                className="lattice-parameter-input"
              />
              <span className="font-mono text-[9px] text-[var(--panel-muted)] shrink-0 select-none">Å</span>
            </label>
          </div>
        )}

        <div className="overflow-x-auto" role="region" aria-label="Atomic positions" tabIndex={0}>
          <div className="grid min-w-[400px] grid-cols-[50px_repeat(3,minmax(0,1fr))_26px] divide-x divide-[var(--panel-border)] border-b border-[var(--panel-border)] bg-[var(--panel-bg)] h-6 items-center text-center font-mono text-[9px] font-semibold text-[var(--panel-muted)] select-none">
            <span>Atom</span>
            <span>X</span>
            <span>Y</span>
            <span>Z</span>
            <span />
          </div>
          {atoms.map((atom, index) => {
            const position = displayedPosition(atom);
            return (
              <div
                key={atom.id}
                data-selected={selectedAtomId === atom.id}
                onFocusCapture={() => onSelectAtom?.(atom.id)}
                onClick={() => onSelectAtom?.(atom.id)}
                className="group grid min-w-[400px] grid-cols-[50px_repeat(3,minmax(0,1fr))_26px] divide-x divide-[var(--panel-border)] border-b border-[var(--panel-border)] h-8 items-stretch"
              >
                <label className="lattice-parameter-cell justify-center px-1">
                  <input
                    aria-label={`Atom ${index + 1} label`}
                    value={atom.label ?? atom.species}
                    onChange={(event) => {
                      const label = event.target.value.replace(/[^A-Za-z0-9_+\-]/g, '').slice(0, 8);
                      onAtomChange(atom.id, { label, species: elementFromLabel(label, atom.species) });
                    }}
                    className="lattice-parameter-input lattice-parameter-atom-input font-mono text-[10px] font-semibold"
                  />
                </label>
                {position.map((value, axis) => (
                  <label key={`${atom.id}-${axis}`} className="lattice-parameter-cell">
                    <CommittedNumberInput
                      aria-label={`Atom ${index + 1} ${['x', 'y', 'z'][axis]}`}
                      step="0.000001"
                      value={Number(value.toFixed(9))}
                      onCommit={(next) => updatePosition(atom, axis, next)}
                      className="lattice-parameter-input"
                    />
                  </label>
                ))}
                <button
                  type="button"
                  aria-label={`Delete atom row ${index + 1}`}
                  disabled={atoms.length <= 1}
                  onClick={() => onDeleteAtom(atom.id)}
                  className="grid h-full place-items-center text-[var(--panel-muted)] opacity-35 transition-all hover:bg-[var(--panel-hover)] hover:text-[var(--status-danger)] disabled:opacity-10 group-hover:opacity-100"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            );
          })}
          <button
            type="button"
            onClick={onAddAtom}
            className="flex h-7.5 w-full min-w-[400px] items-center justify-center gap-1.5 bg-[var(--panel-bg)]/40 text-[10px] font-medium text-[var(--panel-muted)] transition-colors hover:bg-[var(--panel-hover)] hover:text-[var(--panel-text)]"
          >
            <Plus className="h-3 w-3" />
            <span>Add atomic position</span>
          </button>
        </div>
      </section>
    </div>
  );
}

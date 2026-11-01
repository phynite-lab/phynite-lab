'use client';

import { Minus, Plus, RotateCcw } from 'lucide-react';
import { CommittedNumberInput } from '@/components/CommittedNumberInput';

export type CellRepeat = [number, number, number];
const presets: CellRepeat[] = [[1, 1, 1], [2, 2, 1], [2, 2, 2], [3, 3, 3]];

export function CellRepeatControl({ value, maxAxis = 8, periodic, onChange }: { value: CellRepeat; atomCount?: number; maxAxis?: number; periodic?: [boolean, boolean, boolean]; onChange: (value: CellRepeat) => void }) {
  const cellCount = value[0] * value[1] * value[2];
  const normalize = (next: CellRepeat) => next.map((count, axis) => periodic?.[axis] === false ? 1 : count) as CellRepeat;
  const available = presets.map(normalize).filter((preset, index, all) => all.findIndex(other => other.join() === preset.join()) === index);
  const changeAxis = (axis: number, count: number) => {
    const next = [...value] as CellRepeat;
    next[axis] = Math.max(1, Math.min(maxAxis, Math.round(Number.isFinite(count) ? count : 1)));
    onChange(normalize(next));
  };
  return <div className="cell-repeat-control">
    <header>
      <strong>Cell repetition</strong>
      <button
        type="button"
        disabled={cellCount === 1}
        onClick={() => onChange([1, 1, 1])}
        aria-label="Reset cell repetition"
        title="Reset cell repetition"
        className="cell-repeat-reset"
      >
        <RotateCcw size={12} />
      </button>
    </header>
    <div className="cell-repeat-axes">
      {value.map((count, axis) => {
        const axisLetter = (['a', 'b', 'c'] as const)[axis];
        const isIsolated = periodic?.[axis] === false;
        return (
          <div key={axis} className="cell-repeat-col">
            <label htmlFor={`cell-repeat-${axis}`}>
              <span className="cell-repeat-axis-name">{axisLetter}</span>
              {isIsolated && <span className="cell-repeat-tag">isolated</span>}
            </label>
            <div className="cell-repeat-stepper">
              <button
                type="button"
                aria-label={`Decrease ${axisLetter} cells`}
                disabled={count <= 1 || isIsolated}
                onClick={() => changeAxis(axis, count - 1)}
              >
                <Minus size={12} />
              </button>
              <CommittedNumberInput
                id={`cell-repeat-${axis}`}
                aria-label={`${axisLetter} cell count`}
                inputMode="numeric"
                min={1}
                max={maxAxis}
                step={1}
                value={count}
                disabled={isIsolated}
                onCommit={count => changeAxis(axis, count)}
              />
              <button
                type="button"
                aria-label={`Increase ${axisLetter} cells`}
                disabled={count >= maxAxis || isIsolated}
                onClick={() => changeAxis(axis, count + 1)}
              >
                <Plus size={12} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
    <div className="cell-repeat-presets" role="group" aria-label="Cell repetition presets">{available.map(preset => <button type="button" key={preset.join()} aria-pressed={value.join() === preset.join()} onClick={() => onChange(preset)}>{preset.join(' × ')}</button>)}</div>
  </div>;
}

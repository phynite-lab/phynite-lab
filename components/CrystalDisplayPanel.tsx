'use client';

import { Box, Camera, Download, Eye } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CommittedNumberInput } from './CommittedNumberInput';
import { type CellRepeat } from './CellRepeatControl';
import type { CrystalDisplayStyle } from '@/lib/crystal-render-model';
import { LabInspectorSection, LabSlider, LabSwitch } from './LabControls';

export type CrystalDisplaySettings = {
  showBonds: boolean;
  showCell: boolean;
  showLabels: boolean;
  showForces: boolean;
  atomScale: number;
  bondScale: number;
  bondCutoff: number;
  forceScale: number;
  supercell: CellRepeat;
  displayStyle: CrystalDisplayStyle;
};

export function CrystalDisplayPanel({
  settings: s,
  onChange,
  hasForces,
  onExport,
  onSceneExport,
  exporting,
  sections, onSectionChange,
}: {
  settings: CrystalDisplaySettings;
  onChange: (patch: Partial<CrystalDisplaySettings>) => void;
  hasForces: boolean;
  onExport: (format: 'cif' | 'xyz' | 'xsf' | 'poscar') => void;
  onSceneExport: (format: 'png' | 'glb') => void;
  exporting: boolean;
  sections?: {display:boolean;export:boolean};
  onSectionChange?: (section:'display'|'export',open:boolean)=>void;
}) {
  return (
    <>
      <LabInspectorSection title="Display" icon={<Eye size={14} />} open={sections?.display} onOpenChange={open=>onSectionChange?.('display',open)} defaultOpen>
        <div className="flex flex-col gap-3">
          {/* Representation Style */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium text-[var(--panel-text)]">
              Representation
            </span>
            <div className="grid grid-cols-3 gap-1.5">
              {([
                ['ball-stick', 'Ball & stick'],
                ['spacefill', 'Space filling'],
                ['wireframe', 'Wireframe'],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={s.displayStyle === value}
                  onClick={() => onChange({ displayStyle: value })}
                  className={cn(
                    'flex flex-col items-center justify-center gap-1.5 rounded-[6px] border border-[var(--panel-border)] bg-[var(--panel-raised)] py-2 text-[11px] font-medium text-[var(--panel-muted)] transition-colors hover:bg-[var(--panel-hover)] hover:text-[var(--panel-text)]',
                    s.displayStyle === value && 'border-[var(--line-strong)] bg-[var(--panel-selected)] text-[var(--panel-text)] font-semibold shadow-sm'
                  )}
                >
                  <span className={`crystal-representation-glyph is-${value}`} aria-hidden="true">
                    <i /><b /><i />
                  </span>
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Scale Sliders */}
          <div className="flex flex-col gap-2 border-t border-[var(--panel-border)] pt-2.5">
            <span className="text-[11px] font-medium text-[var(--panel-text)]">
              Geometry scale
            </span>
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-[var(--panel-muted)]">Atom radius scale</span>
                <span className="font-mono font-semibold text-[var(--panel-text)]">{s.atomScale.toFixed(2)}×</span>
              </div>
              <LabSlider
                aria-label="Atom radius"
                min="0.55"
                max="1.7"
                step="0.05"
                value={s.atomScale}
                onValueChange={(atomScale) => onChange({ atomScale })}
              />
            </div>

            {s.displayStyle === 'ball-stick' && (
              <div className="flex flex-col gap-1 pt-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-[var(--panel-muted)]">Bond radius scale</span>
                  <span className="font-mono font-semibold text-[var(--panel-text)]">{s.bondScale.toFixed(2)}×</span>
                </div>
                <LabSlider
                  aria-label="Bond radius"
                  min="0.45"
                  max="2"
                  step="0.05"
                  value={s.bondScale}
                  onValueChange={(bondScale) => onChange({ bondScale })}
                />
              </div>
            )}

            {hasForces && s.showForces && (
              <div className="flex flex-col gap-1 pt-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-[var(--panel-muted)]">Force scale</span>
                  <span className="font-mono font-semibold text-[var(--panel-text)]">{s.forceScale.toFixed(1)}×</span>
                </div>
                <LabSlider
                  aria-label="Force scale"
                  min="0.2"
                  max="8"
                  step="0.2"
                  value={s.forceScale}
                  onValueChange={(forceScale) => onChange({ forceScale })}
                />
              </div>
            )}
          </div>

          {/* Scene Guides & Overlays */}
          <div className="flex flex-col gap-2.5 border-t border-[var(--panel-border)] pt-2.5">
            <span className="text-[11px] font-medium text-[var(--panel-text)]">
              Scene guides & overlays
            </span>
            <LabSwitch checked={s.showCell} onCheckedChange={(showCell) => onChange({ showCell })}>
              Unit cell box
            </LabSwitch>
            <LabSwitch
              disabled={s.displayStyle === 'spacefill'}
              checked={s.showBonds}
              onCheckedChange={(showBonds) => onChange({ showBonds })}
            >
              Neighbor lines
            </LabSwitch>
            {s.showBonds && s.displayStyle !== 'spacefill' && (
              <div className="flex items-center justify-between rounded-[5px] bg-[var(--panel-hover)] px-2.5 py-1.5 text-[11px]">
                <span className="text-[var(--panel-muted)]">Neighbor cutoff (Å)</span>
                <div className="flex items-center gap-1.5">
                  <CommittedNumberInput
                    aria-label="Neighbor cutoff"
                    min={0}
                    step={0.1}
                    value={s.bondCutoff}
                    onCommit={(bondCutoff) => onChange({ bondCutoff })}
                    className="w-16 rounded border border-[var(--panel-border)] bg-[var(--panel-bg)] px-1.5 py-0.5 text-right font-mono text-[11px] text-[var(--panel-text)] outline-none"
                  />
                  <span className="text-[10px] text-[var(--panel-muted)]">{s.bondCutoff === 0 ? 'auto' : 'Å'}</span>
                </div>
              </div>
            )}
            <LabSwitch checked={s.showLabels} onCheckedChange={(showLabels) => onChange({ showLabels })}>
              Atomic symbols
            </LabSwitch>
            <LabSwitch
              disabled={!hasForces}
              checked={s.showForces && hasForces}
              onCheckedChange={(showForces) => onChange({ showForces })}
            >
              Force vectors{hasForces ? '' : ' · no data'}
            </LabSwitch>
          </div>
        </div>
      </LabInspectorSection>

      <LabInspectorSection title="Export" icon={<Download size={14} />} open={sections?.export} onOpenChange={open=>onSectionChange?.('export',open)}>
        <div className="flex flex-col gap-3">
          {/* Structure Formats */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium text-[var(--panel-text)]">
              Structure formats
            </span>
            <div className="grid grid-cols-2 gap-1.5">
              {(['cif', 'poscar', 'xyz', 'xsf'] as const).map((format) => (
                <button
                  key={format}
                  type="button"
                  onClick={() => onExport(format)}
                  className="flex h-10 items-center justify-between rounded-[5px] border border-[var(--panel-border)] bg-[var(--panel-bg)] px-2.5 text-[11px] font-medium text-[var(--panel-text)] transition-colors hover:bg-[var(--panel-hover)]"
                >
                  <span>{({ cif: 'CIF Crystal', poscar: 'VASP POSCAR', xyz: 'XYZ Coords', xsf: 'XSF Structure' })[format]}</span>
                  <span className="rounded bg-[var(--panel-hover)] px-1 py-0.5 font-mono text-[9px] uppercase text-[var(--panel-muted)]">{format}</span>
                </button>
              ))}
            </div>
            <p className="text-[10px] text-[var(--panel-muted)]">
              Downloads the active atomic coordinates and simulation cell.
            </p>
          </div>

          {/* Visual Scene */}
          <div className="flex flex-col gap-1.5 border-t border-[var(--panel-border)] pt-2.5">
            <span className="text-[11px] font-medium text-[var(--panel-text)]">
              Visual scene
            </span>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                disabled={exporting}
                onClick={() => onSceneExport('png')}
                className="flex h-10 items-center justify-between rounded-[5px] border border-[var(--panel-border)] bg-[var(--panel-bg)] px-2.5 text-[11px] font-medium text-[var(--panel-text)] transition-colors hover:bg-[var(--panel-hover)] disabled:opacity-50"
              >
                <span className="flex items-center gap-1.5">
                  <Camera size={13} className="text-[var(--panel-muted)]" />
                  PNG Image
                </span>
                <span className="rounded bg-[var(--panel-hover)] px-1 py-0.5 font-mono text-[9px] uppercase text-[var(--panel-muted)]">PNG</span>
              </button>
              <button
                type="button"
                disabled={exporting}
                onClick={() => onSceneExport('glb')}
                className="flex h-10 items-center justify-between rounded-[5px] border border-[var(--panel-border)] bg-[var(--panel-bg)] px-2.5 text-[11px] font-medium text-[var(--panel-text)] transition-colors hover:bg-[var(--panel-hover)] disabled:opacity-50"
              >
                <span className="flex items-center gap-1.5">
                  <Box size={13} className="text-[var(--panel-muted)]" />
                  GLB 3D Scene
                </span>
                <span className="rounded bg-[var(--panel-hover)] px-1 py-0.5 font-mono text-[9px] uppercase text-[var(--panel-muted)]">GLB</span>
              </button>
            </div>
            <p className="text-[10px] text-[var(--panel-muted)]">
              {exporting ? 'Preparing download…' : 'PNG captures the viewport. GLB includes atoms, lines, and cell in 3D.'}
            </p>
          </div>
        </div>
      </LabInspectorSection>
    </>
  );
}

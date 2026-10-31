import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Axis3D,
  Camera,
  Crosshair,
  MousePointer2,
  Ruler,
  Scissors,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { LabViewAngleMenu } from '@/components/LabViewAngleMenu';
import type { LabViewPresetId } from '@/lib/lab-camera';
import { cn } from '@/lib/utils';

export type CanvasToolId = 'select' | 'measure' | 'slice';
export type ViewAngleId = LabViewPresetId;

interface CanvasToolbarProps {
  activeTool: CanvasToolId;
  onSelectTool: (tool: CanvasToolId) => void;
  onResetView: () => void;
  onSnapshot?: () => void;
  activeViewAngle: ViewAngleId;
  onSelectViewAngle: (angle: ViewAngleId) => void;
  viewLayout: 'single' | 'quad';
  onToggleViewLayout: () => void;
  isMeasureActive: boolean;
  isSliceActive?: boolean;
  atomScale?: number;
  onAtomScaleChange?: (scale: number) => void;
  showBonds?: boolean;
  onToggleBonds?: () => void;
  showCellBox?: boolean;
  onToggleCellBox?: () => void;
  showLabels?: boolean;
  onToggleLabels?: () => void;
}

type ToolButtonProps = {
  label: string;
  shortcut?: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
};

function ToolButton({ label, shortcut, active = false, onClick, children }: ToolButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'group relative grid h-9 w-9 place-items-center rounded-[6px] text-[#697480] transition-colors hover:bg-[#1a1a1a] hover:text-[#ededed]',
        active && 'bg-[#2e3b59] text-[#9bc2ff]'
      )}
    >
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute left-11 z-50 hidden h-7 items-center whitespace-nowrap rounded-[5px] border border-[#2d2d2d] bg-[#1a1a1a] px-2.5 text-[11px] font-medium text-white shadow-lg group-hover:flex"
      >
        {label}
        {shortcut && (
          <kbd className="ml-1.5 font-mono text-[9px] text-[#929ba5]">{shortcut}</kbd>
        )}
      </span>
    </button>
  );
}

export const CanvasToolbar: React.FC<CanvasToolbarProps> = ({
  activeTool,
  onSelectTool,
  onResetView,
  onSnapshot,
  activeViewAngle,
  onSelectViewAngle,
  viewLayout,
  onToggleViewLayout,
  isMeasureActive,
  isSliceActive = false,
  atomScale = 1.0,
  onAtomScaleChange,
  showBonds = true,
  onToggleBonds,
  showCellBox = true,
  onToggleCellBox,
  showLabels = false,
  onToggleLabels,
}) => {
  const [viewAngleOpen, setViewAngleOpen] = useState(false);
  const [displayMenuOpen, setDisplayMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!viewAngleOpen && !displayMenuOpen) return;
    const closeOnPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setViewAngleOpen(false);
        setDisplayMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setViewAngleOpen(false);
        setDisplayMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', closeOnPointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnPointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [viewAngleOpen, displayMenuOpen]);

  return (
    <div ref={rootRef} className="workspace-canvas-toolbar-wrap absolute left-3 top-1/2 z-20 -translate-y-1/2 select-none">
      <div
        role="toolbar"
        aria-label="MD Lab visualization tools"
        className="workspace-canvas-toolbar flex flex-col rounded-[9px] border border-[#262626] bg-[#0A0A0A] p-1 shadow-[0_12px_32px_rgba(0,0,0,.22)]"
      >
        {/* Cluster 1: Interaction & Analysis Modes */}
        <ToolButton
          label="Select"
          shortcut="V"
          active={activeTool === 'select' && !isMeasureActive}
          onClick={() => {
            onSelectTool('select');
            setViewAngleOpen(false);
            setDisplayMenuOpen(false);
          }}
        >
          <MousePointer2 className="h-4 w-4" aria-hidden="true" />
        </ToolButton>

        <ToolButton
          label="Measure"
          shortcut="M"
          active={isMeasureActive}
          onClick={() => {
            onSelectTool('measure');
            setViewAngleOpen(false);
            setDisplayMenuOpen(false);
          }}
        >
          <Ruler className="h-4 w-4" aria-hidden="true" />
        </ToolButton>

        <ToolButton
          label="Slice cross-section"
          shortcut="S"
          active={isSliceActive}
          onClick={() => {
            onSelectTool('slice');
            setViewAngleOpen(false);
            setDisplayMenuOpen(false);
          }}
        >
          <Scissors className="h-4 w-4" aria-hidden="true" />
        </ToolButton>

        {/* Divider */}
        <div className="my-1 border-t border-[#262626]" />

        {/* Cluster 2: Camera & Orientation */}
        <ToolButton
          label="View angle"
          active={viewAngleOpen}
          onClick={() => {
            setViewAngleOpen((open) => !open);
            setDisplayMenuOpen(false);
          }}
        >
          <Axis3D className="h-4 w-4" aria-hidden="true" />
        </ToolButton>

        <ToolButton
          label="Fit structure"
          shortcut="F"
          onClick={onResetView}
        >
          <Crosshair className="h-4 w-4" aria-hidden="true" />
        </ToolButton>

        {/* Divider */}
        <div className="my-1 border-t border-[#262626]" />

        {/* Cluster 3: Display & Output */}
        <ToolButton
          label="Display overlays"
          active={displayMenuOpen}
          onClick={() => {
            setDisplayMenuOpen((open) => !open);
            setViewAngleOpen(false);
          }}
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
        </ToolButton>

        {onSnapshot && (
          <ToolButton
            label="Capture snapshot"
            onClick={onSnapshot}
          >
            <Camera className="h-4 w-4" aria-hidden="true" />
          </ToolButton>
        )}
      </div>

      {/* View Angle Menu */}
      {viewAngleOpen && (
        <LabViewAngleMenu
          activeView={activeViewAngle}
          onSelect={(view) => {
            onSelectViewAngle(view);
            setViewAngleOpen(false);
          }}
          onClose={() => setViewAngleOpen(false)}
          className="absolute left-14 top-1/2 z-30 -translate-y-1/2"
          quadView={{
            active: viewLayout === 'quad',
            onToggle: () => {
              onToggleViewLayout();
              setViewAngleOpen(false);
            },
            shortcut: '⌥W',
          }}
        />
      )}

      {/* Display Overlays Popover */}
      <AnimatePresence>
        {displayMenuOpen && (
          <motion.div
            role="dialog"
            aria-label="Viewport display settings"
            initial={{ opacity: 0, x: -5, scale: 0.98 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -5, scale: 0.98 }}
            transition={{ duration: 0.12 }}
            className="workspace-toolbar-popover absolute left-14 top-1/2 z-30 w-[240px] -translate-y-1/2 overflow-hidden rounded-[9px] border border-[#262626] bg-[#0A0A0A] p-3 shadow-[0_18px_48px_rgba(0,0,0,.28)] select-none"
          >
            <div className="flex h-7 items-center justify-between border-b border-[#262626] pb-2">
              <div className="flex items-center gap-1.5">
                <SlidersHorizontal className="h-3.5 w-3.5 text-[#ededed]" aria-hidden="true" />
                <span className="text-[11px] font-semibold text-[#ededed]">Display Overlays</span>
              </div>
              <button
                type="button"
                aria-label="Close display settings"
                onClick={() => setDisplayMenuOpen(false)}
                className="grid h-6 w-6 place-items-center rounded-[4px] text-[#8d8d95] hover:bg-[#1a1a1a] hover:text-[#ededed]"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>

            <div className="mt-2.5 space-y-3">
              {/* Atom Radius Scale */}
              {onAtomScaleChange && (
                <div>
                  <div className="mb-1.5 flex items-center justify-between text-[10px]">
                    <span className="text-[#8d8d95]">Atom radius</span>
                    <span className="font-mono font-semibold text-[#ededed]">
                      {atomScale.toFixed(2)}×
                    </span>
                  </div>
                  <div className="mb-2 grid grid-cols-3 gap-1">
                    {[
                      { label: 'Ball & stick', scale: 0.45 },
                      { label: 'Spacefill', scale: 1.0 },
                      { label: 'Compact', scale: 0.25 },
                    ].map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => onAtomScaleChange(preset.scale)}
                        className={cn(
                          'h-6 rounded-[4px] border border-[#262626] bg-[#141414] text-[9px] font-medium text-[#8d8d95] transition-colors hover:bg-[#202020] hover:text-[#ededed]',
                          Math.abs(atomScale - preset.scale) < 0.05 && 'border-[#52525b] bg-[#27272a] font-semibold text-[#ededed]'
                        )}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                  <input
                    aria-label="Atom radius scale slider"
                    type="range"
                    min="0.1"
                    max="2.0"
                    step="0.05"
                    value={atomScale}
                    onChange={(e) => onAtomScaleChange(parseFloat(e.target.value))}
                    className="w-full accent-[var(--accent)] cursor-pointer"
                  />
                </div>
              )}

              {/* Toggles */}
              <div className="space-y-1.5 border-t border-[#262626] pt-2">
                {onToggleBonds && (
                  <label className="flex cursor-pointer items-center justify-between py-0.5 text-[11px] text-[#ededed]">
                    <span className="text-[#c7c7cc]">Chemical bonds</span>
                    <input
                      type="checkbox"
                      checked={showBonds}
                      onChange={onToggleBonds}
                      className="rounded border-[#303030] bg-[#1a1a1a] accent-[var(--accent)]"
                    />
                  </label>
                )}
                {onToggleCellBox && (
                  <label className="flex cursor-pointer items-center justify-between py-0.5 text-[11px] text-[#ededed]">
                    <span className="text-[#c7c7cc]">Simulation box</span>
                    <input
                      type="checkbox"
                      checked={showCellBox}
                      onChange={onToggleCellBox}
                      className="rounded border-[#303030] bg-[#1a1a1a] accent-[var(--accent)]"
                    />
                  </label>
                )}
                {onToggleLabels && (
                  <label className="flex cursor-pointer items-center justify-between py-0.5 text-[11px] text-[#ededed]">
                    <span className="text-[#c7c7cc]">Atom labels</span>
                    <input
                      type="checkbox"
                      checked={showLabels}
                      onChange={onToggleLabels}
                      className="rounded border-[#303030] bg-[#1a1a1a] accent-[var(--accent)]"
                    />
                  </label>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

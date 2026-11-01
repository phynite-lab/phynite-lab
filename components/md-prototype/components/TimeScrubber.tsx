import React from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  ChevronLeft,
  ChevronRight,
  Repeat,
  Clock,
} from 'lucide-react';
import { LabSlider } from '@/components/LabControls';
import { UiSelect } from '@/components/UiSelect';
import { cn } from '@/lib/utils';

interface TimeScrubberProps {
  currentFrame: number;
  totalFrames: number;
  isPlaying: boolean;
  onPlayPause: () => void;
  onSeek: (frame: number) => void;
  fps: number;
  onFpsChange: (fps: number) => void;
  loop: boolean;
  onLoopToggle: () => void;
  timeLabel: string;
}

export const TimeScrubber: React.FC<TimeScrubberProps> = ({
  currentFrame,
  totalFrames,
  isPlaying,
  onPlayPause,
  onSeek,
  fps,
  onFpsChange,
  loop,
  onLoopToggle,
  timeLabel,
}) => {
  const maxFrame = Math.max(0, totalFrames - 1);
  const disabled = totalFrames < 2;

  return (
    <div
      role="region"
      aria-label="Trajectory playback controls"
      className="md-prototype-scrubber border-t border-[var(--panel-border)] bg-[var(--panel-bg)] text-[var(--panel-text)] px-4 py-2.5 flex flex-col gap-2 select-none"
    >
      {/* Top row: Scrubber Slider */}
      <div className="flex items-center gap-3 w-full">
        <span className="font-mono text-[10px] text-[var(--panel-muted)] w-8 text-right tabular-nums">
          {currentFrame}
        </span>
        <div className="relative flex-1 flex items-center">
          <LabSlider
            aria-label="Trajectory frame"
            disabled={disabled}
            min={0}
            max={maxFrame}
            value={currentFrame}
            onValueChange={onSeek}
            className="w-full"
          />
        </div>
        <span className="font-mono text-[10px] text-[var(--panel-muted)] w-8 tabular-nums">
          {maxFrame}
        </span>
      </div>

      {/* Bottom row: Playback Controls */}
      <div className="flex items-center justify-between gap-4">
        {/* Left: Time display badges */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-[5px] border border-[var(--panel-border)] bg-[var(--panel-raised)] px-2 py-1 font-mono text-[11px] text-[var(--panel-text)] shadow-sm">
            <Clock size={12} className="text-[var(--panel-text)]" />
            <span>
              Frame <strong className="font-semibold text-[var(--panel-text)]">{Math.min(currentFrame + 1, totalFrames)}</strong>
              <span className="text-[var(--panel-muted)]"> / </span>
              {totalFrames}
            </span>
          </div>
          <div className="flex items-center gap-1 rounded-[5px] border border-[var(--panel-border)] bg-[var(--panel-raised)] px-2 py-1 font-mono text-[11px] text-[var(--panel-text)] shadow-sm">
            <span className="text-[var(--panel-muted)]">t =</span>
            <strong className="font-semibold text-[var(--panel-text)]">{timeLabel}</strong>
          </div>
        </div>

        {/* Center: Play / Step controls */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            title="Jump to Start (first frame)"
            aria-label="First frame"
            disabled={currentFrame === 0}
            onClick={() => onSeek(0)}
            className="h-7 w-7 rounded-[5px] flex items-center justify-center text-[var(--panel-muted)] hover:text-[var(--panel-text)] hover:bg-[var(--panel-hover)] disabled:opacity-30 disabled:pointer-events-none transition-colors"
          >
            <SkipBack size={14} />
          </button>
          <button
            type="button"
            title="Step Back (previous frame)"
            aria-label="Previous frame"
            disabled={currentFrame === 0}
            onClick={() => onSeek(Math.max(0, currentFrame - 1))}
            className="h-7 w-7 rounded-[5px] flex items-center justify-center text-[var(--panel-muted)] hover:text-[var(--panel-text)] hover:bg-[var(--panel-hover)] disabled:opacity-30 disabled:pointer-events-none transition-colors"
          >
            <ChevronLeft size={16} />
          </button>

          <button
            type="button"
            title={isPlaying ? 'Pause trajectory' : 'Play trajectory'}
            aria-label={isPlaying ? 'Pause trajectory' : 'Play trajectory'}
            disabled={disabled}
            onClick={onPlayPause}
            className={cn(
              'h-8 w-8 rounded-full flex items-center justify-center transition-all',
              disabled
                ? 'bg-[var(--panel-hover)] text-[var(--panel-muted)] opacity-40 cursor-not-allowed'
                : 'bg-[var(--accent)] hover:bg-[var(--accent-strong)] text-[var(--on-accent)] shadow-[0_2px_8px_rgba(0,0,0,0.3)] active:scale-95'
            )}
          >
            {isPlaying ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
          </button>

          <button
            type="button"
            title="Step Forward (next frame)"
            aria-label="Next frame"
            disabled={currentFrame >= maxFrame}
            onClick={() => onSeek(Math.min(maxFrame, currentFrame + 1))}
            className="h-7 w-7 rounded-[5px] flex items-center justify-center text-[var(--panel-muted)] hover:text-[var(--panel-text)] hover:bg-[var(--panel-hover)] disabled:opacity-30 disabled:pointer-events-none transition-colors"
          >
            <ChevronRight size={16} />
          </button>
          <button
            type="button"
            title="Jump to End (last frame)"
            aria-label="Last frame"
            disabled={currentFrame >= maxFrame}
            onClick={() => onSeek(maxFrame)}
            className="h-7 w-7 rounded-[5px] flex items-center justify-center text-[var(--panel-muted)] hover:text-[var(--panel-text)] hover:bg-[var(--panel-hover)] disabled:opacity-30 disabled:pointer-events-none transition-colors"
          >
            <SkipForward size={14} />
          </button>
        </div>

        {/* Right: Loop & Speed controls */}
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            title={loop ? 'Loop playback (active)' : 'Loop playback (inactive)'}
            aria-label="Loop playback"
            aria-pressed={loop}
            onClick={onLoopToggle}
            className={cn(
              'h-7 px-2.5 rounded-[5px] flex items-center gap-1.5 text-[11px] font-medium border transition-colors',
              loop
                ? 'border-[var(--line-strong)] bg-[var(--surface-subtle)] text-[var(--panel-text)] font-semibold'
                : 'border-[var(--panel-border)] bg-[var(--panel-raised)] text-[var(--panel-muted)] hover:text-[var(--panel-text)] hover:bg-[var(--panel-hover)]'
            )}
          >
            <Repeat size={12} className={loop ? 'text-[var(--panel-text)]' : 'text-[var(--panel-muted)]'} />
            <span>Loop</span>
          </button>

          <div className="flex items-center gap-1.5 text-[11px] text-[var(--panel-muted)]">
            <span className="font-medium text-[10px] uppercase tracking-wider text-[var(--panel-muted)]">Speed:</span>
            <div className="w-[96px] min-w-[96px]">
              <UiSelect
                ariaLabel="Playback speed"
                compact
                mono
                value={String(fps)}
                options={[5, 10, 15, 24, 30, 60].map((value) => ({
                  value: String(value),
                  label: `${value} FPS`,
                }))}
                onChange={(value) => onFpsChange(Number(value))}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

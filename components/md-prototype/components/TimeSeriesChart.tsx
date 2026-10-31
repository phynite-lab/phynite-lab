import React, { useState } from 'react';
import { Layers } from 'lucide-react';
import type { TrajectoryMetrics } from '../types/trajectory';

interface TimeSeriesChartProps {
  metrics: TrajectoryMetrics | null;
  currentFrame: number;
  onSeekFrame?: (frame: number) => void;
}

type MetricType = 'pe' | 'phases' | 'dislocation';

export const TimeSeriesChart: React.FC<TimeSeriesChartProps> = ({
  metrics,
  currentFrame,
  onSeekFrame,
}) => {
  const [activeMetric, setActiveMetric] = useState<MetricType>('pe');
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  if (!metrics || !metrics.timeline || metrics.timeline.length <= 1) {
    return (
      <div className="py-6 px-4 text-center rounded-[7px] border border-dashed border-[var(--md-border)] bg-[var(--md-panel)]">
        <Layers className="w-5 h-5 mx-auto text-[var(--md-muted)] mb-2" />
        <p className="text-[11px] font-medium text-[var(--md-text)]">Static Crystal</p>
        <p className="text-[10px] text-[var(--md-muted)] mt-0.5">
          Time-series dynamics require a multi-frame trajectory (e.g. Copper Slip or Al Melting).
        </p>
      </div>
    );
  }

  const timeline = metrics.timeline;
  const nFrames = timeline.length;

  // Extract data series depending on active metric
  let values: number[] = [];
  let label = 'Potential Energy';
  let unit = 'source units';
  let color = '#38bdf8';
  let gradientId = 'peGradient';

  if (activeMetric === 'pe') {
    label = 'Potential Energy (E_pot)';
    unit = 'source units';
    color = '#38bdf8';
    gradientId = 'peGradient';
    values = timeline.map((t) => t.avgPotentialEnergy ?? NaN);
  } else if (activeMetric === 'dislocation') {
    label = 'Dislocation Line Density';
    unit = '1/Å²';
    color = '#f59e0b';
    gradientId = 'dislocGradient';
    values = timeline.map((t) => t.dislocationDensity ?? NaN);
  } else if (activeMetric === 'phases') {
    label = 'FCC Crystal Fraction';
    unit = '%';
    color = '#22c55e';
    gradientId = 'phaseGradient';
    values = timeline.map((t) => t.phases?.FCC ?? NaN);
  }

  const finiteValues = values.filter(Number.isFinite);
  const minVal = finiteValues.length ? Math.min(...finiteValues) : NaN;
  const maxVal = finiteValues.length ? Math.max(...finiteValues) : NaN;
  const range = maxVal - minVal || 1e-4;

  // SVG dimensions
  const svgWidth = 280;
  const svgHeight = 100;
  const padX = 14;
  const padY = 12;
  const plotW = svgWidth - padX * 2;
  const plotH = svgHeight - padY * 2;

  const getX = (idx: number) => padX + (idx / Math.max(nFrames - 1, 1)) * plotW;
  const getY = (val: number) => padY + plotH - ((val - minVal) / range) * plotH;

  const pathD = values.map((value, i) => Number.isFinite(value) ? ((i === 0 || !Number.isFinite(values[i - 1])) ? 'M ' : 'L ') + getX(i).toFixed(1) + ',' + getY(value).toFixed(1) : '').join(' ');
  const areaD = values.every(Number.isFinite) ? pathD + ' L ' + getX(nFrames - 1) + ',' + (padY + plotH) + ' L ' + getX(0) + ',' + (padY + plotH) + ' Z' : '';
  // Active frame needle position
  const activeX = getX(Math.min(currentFrame, nFrames - 1));
  const currentVal = values[Math.min(currentFrame, nFrames - 1)] ?? values[0];

  const handleSvgClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = (e.clientX - rect.left) / rect.width * svgWidth;
    const normX = Math.max(0, Math.min(1, (clickX - padX) / plotW));
    const targetFrame = Math.round(normX * (nFrames - 1));
    if (onSeekFrame) {
      onSeekFrame(targetFrame);
    }
  };

  return (
    <div className="flex flex-col gap-2 select-none">
      {/* Metric Selector Pills */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 bg-[var(--md-panel)] p-0.5 rounded-[5px] border border-[var(--md-border)]">
          <button
            type="button"
            aria-pressed={activeMetric === 'pe'} onClick={() => setActiveMetric('pe')}
            className={`px-2 py-0.5 rounded-[4px] text-[10px] font-medium transition-colors ${
              activeMetric === 'pe'
                ? 'bg-[var(--md-hover)] text-[var(--md-text)] font-semibold shadow-sm'
                : 'text-[var(--md-muted)] hover:text-[var(--md-text)]'
            }`}
          >
            Energy
          </button>
          <button
            type="button"
            onClick={() => setActiveMetric('phases')}
            className={`px-2 py-0.5 rounded-[4px] text-[10px] font-medium transition-colors ${
              activeMetric === 'phases'
                ? 'bg-[var(--md-raised)] text-[#4ade80] shadow-sm'
                : 'text-[var(--md-muted)] hover:text-[var(--md-text)]'
            }`}
          >
            FCC %
          </button>
          <button
            type="button"
            onClick={() => setActiveMetric('dislocation')}
            className={`px-2 py-0.5 rounded-[4px] text-[10px] font-medium transition-colors ${
              activeMetric === 'dislocation'
                ? 'bg-[var(--md-raised)] text-[#fcd34d] shadow-sm'
                : 'text-[var(--md-muted)] hover:text-[var(--md-text)]'
            }`}
          >
            Density
          </button>
        </div>

        <span className="font-mono text-[10px] font-semibold text-[var(--md-text)]">
          {Number.isFinite(currentVal) ? currentVal.toFixed(3) : '—'} {unit}
        </span>
      </div>

      {!finiteValues.length && <p className="md-note">{activeMetric === 'pe' ? 'No c_pe values are present in these frames.' : 'Compute all frames with ' + (activeMetric === 'phases' ? 'PTM or CNA' : 'DXA') + ' enabled to populate this metric.'}</p>}
      {/* SVG Interactive Chart */}
      <div className="relative rounded-[7px] border border-[var(--md-border)] bg-[var(--md-panel)] p-1.5 overflow-hidden">
        <svg role="img" aria-label={label + ' versus frame'}
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="w-full h-24 cursor-pointer overflow-visible"
          onClick={handleSvgClick}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const clickX = (e.clientX - rect.left) / rect.width * svgWidth;
            const normX = Math.max(0, Math.min(1, (clickX - padX) / plotW));
            setHoveredIndex(Math.round(normX * (nFrames - 1)));
          }}
          onMouseLeave={() => setHoveredIndex(null)}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.35" />
              <stop offset="100%" stopColor={color} stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Grid lines */}
          <line
            x1={padX}
            y1={padY}
            x2={padX + plotW}
            y2={padY}
            stroke="#222226"
            strokeDasharray="2 2"
          />
          <line
            x1={padX}
            y1={padY + plotH / 2}
            x2={padX + plotW}
            y2={padY + plotH / 2}
            stroke="#222226"
            strokeDasharray="2 2"
          />
          <line
            x1={padX}
            y1={padY + plotH}
            x2={padX + plotW}
            y2={padY + plotH}
            stroke="#222226"
          />

          {/* Shaded Area Under Curve */}
          <path d={areaD} fill={`url(#${gradientId})`} />

          {/* Main Line Curve */}
          <path
            d={pathD}
            fill="none"
            stroke={color}
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Active Frame Scrubber Needle Line */}
          <line
            x1={activeX}
            y1={padY - 4}
            x2={activeX}
            y2={padY + plotH + 4}
            stroke="#ffffff"
            strokeWidth="1.5"
            strokeDasharray="3 2"
          />
          <circle
            cx={activeX}
            cy={Number.isFinite(currentVal) ? getY(currentVal) : 0} visibility={Number.isFinite(currentVal) ? 'visible' : 'hidden'}
            r="3.5"
            fill="#ffffff"
            stroke={color}
            strokeWidth="2"
          />

          {/* Hover indicator */}
          {hoveredIndex !== null && hoveredIndex !== currentFrame && (
            <line
              x1={getX(hoveredIndex)}
              y1={padY}
              x2={getX(hoveredIndex)}
              y2={padY + plotH}
              stroke="#66666e"
              strokeWidth="1"
            />
          )}
        </svg>

        {/* Labels & Min/Max summary */}
        <div className="flex items-center justify-between text-[9px] font-mono text-[var(--md-muted)] px-1 pt-1 border-t border-[var(--md-border)]">
          <span>Min: {Number.isFinite(minVal) ? minVal.toFixed(3) : '—'}</span>
          <span className="text-[var(--md-muted)]">Frame {currentFrame + 1} / {nFrames}</span>
          <span>Max: {Number.isFinite(maxVal) ? maxVal.toFixed(3) : '—'}</span>
        </div>
      </div>
    </div>
  );
};

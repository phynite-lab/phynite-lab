import React from 'react';
import type { RdfPoint } from '../types/trajectory';

interface RdfChartProps {
  rdfData: RdfPoint[];
}

export const RdfChart: React.FC<RdfChartProps> = ({ rdfData }) => {
  if (!rdfData || rdfData.length === 0) {
    return (
      <div className="h-32 flex items-center justify-center text-xs text-[var(--md-muted)] font-mono">
        Add Coordination Analysis (RDF) modifier to view g(r)
      </div>
    );
  }

  const width = 280;
  const height = 110;
  const padding = { top: 10, right: 10, bottom: 20, left: 35 };

  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  const binWidth = rdfData.length > 1 ? rdfData[1].r - rdfData[0].r : rdfData[0].r * 2;
  const maxR = Math.max(Number.EPSILON, rdfData[rdfData.length - 1].r + binWidth / 2);
  const maxG = Math.max(...rdfData.map((d) => d.g_r), 1.0) * 1.1;

  const toX = (r: number) => padding.left + (r / maxR) * plotW;
  const toY = (g: number) => padding.top + plotH - (g / maxG) * plotH;

  const pathD = rdfData
    .map((pt, idx) => `${idx === 0 ? 'M' : 'L'} ${toX(pt.r).toFixed(1)} ${toY(pt.g_r).toFixed(1)}`)
    .join(' ');

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-xs text-[var(--md-muted)]">
        <span className="font-semibold">Radial Distribution Function g(r)</span>
        <span className="font-mono text-[10px] text-[var(--md-muted)]">Cutoff: {maxR.toFixed(1)} Å</span>
      </div>

      <svg role="img" aria-label="Radial distribution function versus distance" viewBox={`0 0 ${width} ${height}`} width="100%" className="overflow-visible select-none bg-[var(--md-raised)] rounded border border-[var(--md-border)]">
        {/* Gridlines & Zero Line */}
        <line
          x1={padding.left}
          y1={toY(1.0)}
          x2={width - padding.right}
          y2={toY(1.0)}
          stroke="#2c333e"
          strokeDasharray="2,2"
        />
        <text x={padding.left - 4} y={toY(1.0) + 3} fill="#5e6774" fontSize="9" textAnchor="end" fontFamily="var(--font-code, monospace)">
          1.0
        </text>

        {/* RDF Curve */}
        <path d={pathD} fill="none" stroke="var(--accent)" strokeWidth="1.75" />

        {/* Axes */}
        <line
          x1={padding.left}
          y1={padding.top + plotH}
          x2={width - padding.right}
          y2={padding.top + plotH}
          stroke="#3d4653"
        />
        <line
          x1={padding.left}
          y1={padding.top}
          x2={padding.left}
          y2={padding.top + plotH}
          stroke="#3d4653"
        />

        {/* X Axis labels */}
        <text x={padding.left} y={height - 5} fill="#707a88" fontSize="9" fontFamily="var(--font-code, monospace)">
          0 Å
        </text>
        <text x={toX(maxR * 0.5)} y={height - 5} fill="#707a88" fontSize="9" textAnchor="middle" fontFamily="var(--font-code, monospace)">
          {(maxR * 0.5).toFixed(1)} Å
        </text>
        <text x={width - padding.right} y={height - 5} fill="#707a88" fontSize="9" textAnchor="end" fontFamily="var(--font-code, monospace)">
          {maxR.toFixed(1)} Å
        </text>
      </svg>
    </div>
  );
};

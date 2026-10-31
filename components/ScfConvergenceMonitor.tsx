'use client';

import { scfConvergenceWarning, type ScfConvergence } from '@/lib/qe-live-scf';

export function ScfConvergenceMonitor({ evidence, compact = false }: { evidence?: ScfConvergence; compact?: boolean }) {
  if (!evidence?.points.length) return null;
  const last = evidence.points.at(-1)!;
  const points = evidence.points.filter(point => point.cycle === last.cycle);
  const positive = points.filter(point => point.errorRy > 0);
  const logs = positive.map(point => Math.log10(point.errorRy));
  const threshold = evidence.thresholdRy ? Math.log10(evidence.thresholdRy) : null;
  const min = Math.min(...logs, threshold ?? Infinity) - .5;
  const max = Math.max(...logs, threshold ?? -Infinity) + .5;
  const x = (iteration: number) => 32 + (iteration - points[0].iteration) / Math.max(1, last.iteration - points[0].iteration) * 276;
  const y = (error: number) => 12 + (max - error) / (max - min) * 76;
  const warning = scfConvergenceWarning(evidence);
  const path = points.map((point, index) => point.errorRy > 0
    ? `${index && points[index - 1].errorRy > 0 ? 'L' : 'M'}${x(point.iteration).toFixed(2)},${y(Math.log10(point.errorRy)).toFixed(2)}`
    : '').join(' ');
  return <section aria-label="Live SCF convergence" className="nodrag mt-2 rounded border border-[var(--panel-border)] p-2 text-[10px] text-[var(--panel-muted)]">
    <div className="flex justify-between gap-2"><strong>SCF convergence</strong><span>Iteration {last.iteration}{evidence.stage === 'relax' ? ` · cycle ${last.cycle + 1}` : ''}</span></div>
    {positive.length > 0 && <svg viewBox="0 0 320 110" className={`mt-1 w-full ${compact ? 'max-h-16' : ''}`} role="img" aria-label="Estimated SCF residual bound versus iteration, logarithmic Ry scale">
      <path d="M32,10 V90 H308" stroke="currentColor" opacity=".4" fill="none" />
      {threshold !== null && <><path d={`M32,${y(threshold)} H308`} stroke="var(--status-success, #22a06b)" strokeDasharray="4 3" /><text x="307" y={y(threshold) - 3} textAnchor="end" fill="currentColor" fontSize="8">conv_thr {evidence.thresholdRy!.toExponential(1)} Ry</text></>}
      <path d={path} fill="none" stroke="var(--panel-accent, #4385f5)" strokeWidth="1.5" />
      <text x="28" y="15" textAnchor="end" fill="currentColor" fontSize="8">{max.toFixed(0)}</text><text x="28" y="88" textAnchor="end" fill="currentColor" fontSize="8">{min.toFixed(0)}</text><text x="32" y="103" fill="currentColor" fontSize="8">{points[0].iteration}</text><text x="308" y="103" textAnchor="end" fill="currentColor" fontSize="8">{last.iteration}</text><text x="8" y="58" transform="rotate(-90 8 58)" textAnchor="middle" fill="currentColor" fontSize="8">log₁₀(Ry)</text>
    </svg>}
    <p>{last.errorRy === 0 ? 'Residual below printed precision' : `Reported residual bound ${last.errorRy.toExponential(2)} Ry`}{!evidence.thresholdRy && ' · threshold not reported'}</p>
    {evidence.truncated && !compact && <p>Showing the latest 256 reported iterations.</p>}
    {warning && <p role="status" className="mt-1 text-[var(--status-warning)]">{compact ? 'Oscillating residuals · review mixing' : warning}</p>}
  </section>;
}

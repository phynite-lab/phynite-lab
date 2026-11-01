type TimedRun = { startedAt?: string; completedAt?: string; computeSeconds?: number };

export function displayDuration(seconds: number | null | undefined, locale = 'en'): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '—';
  const unit = seconds < 60 ? 'second' : seconds < 3600 ? 'minute' : 'hour';
  const value = seconds / (unit === 'second' ? 1 : unit === 'minute' ? 60 : 3600);
  return new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'short', maximumFractionDigits: 2 }).format(value);
}

/** Elapsed job time includes setup/upload; computeSeconds is metered solver time. */
export function recordedRunSeconds(run: TimedRun): number | null {
  if (!run.startedAt || !run.completedAt) return null;
  const start = Date.parse(run.startedAt), end = Date.parse(run.completedAt);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? (end - start) / 1000 : null;
}

export function measuredComputeSeconds(run: TimedRun): number | null {
  return typeof run.computeSeconds === 'number' && Number.isFinite(run.computeSeconds) && run.computeSeconds >= 0 ? run.computeSeconds : null;
}

export function displayQuanta(value: unknown, locale = 'en'): string {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? `${value.toLocaleString(locale, { maximumFractionDigits: 6 })} Q` : '—';
}

/** Draft and active jobs do not establish a zero measurement for historical CPU time. */
export function recordedCpuSeconds(compute: { allocatedCpuSeconds: number; totalRuns: number; measuredRuns: number; unmeasuredRuns: number; unmeasuredCpuRuns?: number }): number | null {
  if (compute.totalRuns === 0) return 0;
  const finalRuns = compute.measuredRuns + compute.unmeasuredRuns;
  return compute.unmeasuredCpuRuns === undefined || finalRuns === 0 || compute.unmeasuredCpuRuns >= finalRuns ? null : compute.allocatedCpuSeconds;
}

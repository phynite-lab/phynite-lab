export type ScfIteration = { cycle: number; iteration: number; errorRy: number; energyRy?: number };
export type ScfConvergence = { version: 1; stage: 'scf' | 'relax'; thresholdRy?: number; points: ScfIteration[]; truncated: boolean };

export function scfConvergenceWarning(evidence: ScfConvergence): string | null {
  const latest = evidence.points.at(-1);
  if (!latest) return null;
  const cycle = evidence.points.filter(point => point.cycle === latest.cycle);
  const tail = cycle.slice(-8);
  if (latest.iteration < 25 || tail.length < 8 || tail.some(point => point.errorRy <= Math.max(1e-3, evidence.thresholdRy ?? 0))) return null;
  const changes = tail.slice(1).map((point, i) => Math.sign(point.errorRy - tail[i].errorRy));
  const reversals = changes.slice(1).filter((change, i) => change && changes[i] && change !== changes[i]).length;
  if (reversals < 3) return null;
  return 'The last eight residuals oscillate above 10⁻³ Ry after at least 25 iterations. Review charge mixing: a smaller mixing_beta (for example 0.3) or local-TF may help. Change settings in a new run; this diagnostic does not stop the solver.';
}

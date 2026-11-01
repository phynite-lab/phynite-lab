import { latestFigureForCalculation, type FigureDocument, type ResearchDataset } from './research-figures.ts';
import type { FigureJob } from './research-import.ts';

export type FigureEntry =
  | { kind: 'figure'; figure: FigureDocument }
  | { kind: 'datasets'; datasets: ResearchDataset[]; job?: FigureJob }
  | { kind: 'job'; job: FigureJob }
  | { kind: 'missing-job' }
  | { kind: 'empty' };

export function resolveFigureEntry(projectId: string, figures: FigureDocument[], datasets: ResearchDataset[], jobs: FigureJob[], initialJobId?: string): FigureEntry {
  const saved = figures.filter((figure) => figure.projectId === projectId && !figure.archived).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const sources = datasets.filter((dataset) => dataset.projectId === projectId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (initialJobId) {
    const job = jobs.find((job) => job.id === initialJobId);
    if (!job) return { kind: 'missing-job' };
    const previous = latestFigureForCalculation(saved, datasets, job.backendCalculationId);
    if (previous) return { kind: 'figure', figure: previous };
    const existing = job.backendCalculationId ? sources.filter((dataset) => dataset.source.calculationId === job.backendCalculationId) : [];
    return existing.length ? { kind: 'datasets', datasets: existing, job } : { kind: 'job', job };
  }
  if (saved.length) return { kind: 'figure', figure: saved[0] };
  if (sources.length) return { kind: 'datasets', datasets: [sources[0]] };
  // Execution jobs arrive newest first, matching the calculation log.
  const job = jobs.find((job) => job.status === 'Completed' && job.backendCalculationId && ['Band structure', 'Density of states', 'Phonon dispersion', 'Thermoelectric properties'].includes(job.calculationType ?? ''));
  return job ? { kind: 'job', job } : { kind: 'empty' };
}

import { parseScientificPlotCsv } from './result-plot.ts';
import { figureIssues, renderFigure, validateDataset, validateFigure, type FigureDocument, type ResearchDataset } from './research-figures.ts';

const canonical = (value: unknown): string => JSON.stringify(value, (_key, entry) => entry && typeof entry === 'object' && !Array.isArray(entry) ? Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]])) : entry);
/** Runs inside the bounded trusted compiler. Saved curves must reproduce the executed CSV. */
export function manuscriptFigure(figure: FigureDocument, datasets: ResearchDataset[], jobs: Array<{ calculationId: string; calculationType: string; summary: Record<string, unknown>; provenance: Record<string, unknown> }>): string {
  validateFigure(figure);
  for (const dataset of datasets) {
    validateDataset(dataset);
    const job = jobs.find(job => job.calculationId === dataset.source.calculationId);
    if (!job || dataset.source.text === undefined || dataset.source.parserVersion !== 'phynite-research-1' || dataset.metadata.plotType || dataset.metadata.orbitalProjection) throw new Error('Manuscripts require retained executed CSV datasets. Reimport unsupported or projected sources before exporting.');
    const parsed = parseScientificPlotCsv(dataset.source.text, job.calculationType);
    if (parsed.kind === 'dos') for (const quantity of parsed.quantities) for (const series of quantity.series) if (/dos_down|spin_down/i.test(series.id)) for (const point of series.points) if (point[1] !== null) point[1] = Math.abs(point[1]);
    if (canonical(parsed) !== canonical(dataset.data)) throw new Error('Saved curve numbers or units differ from the executed CSV. Reimport the original result.');
    for (const [field, source] of [['fermiEv', 'fermiEnergyEv'], ['vbmEv', 'vbmEnergyEv'], ['vacuumEv', 'vacuumEnergyEv']] as const) if (dataset.metadata.energy[field] !== undefined && dataset.metadata.energy[field] !== job.summary[source]) throw new Error('Figure energy reference differs from the retained result.');
    if (dataset.metadata.path && canonical(dataset.metadata.path) !== canonical(job.provenance.reciprocalPath)) throw new Error('Figure reciprocal path differs from the executed calculation.');
    if (dataset.metadata.energy.kind === 'fermi' && !dataset.source.text.split('\n')[0].includes('relative_to_fermi')) throw new Error('Fermi-relative axes require the source CSV energy convention.');
  }
  if (figure.panels.some(panel => panel.layers.some(layer => layer.normalization !== 'source'))) throw new Error('Manuscript figures currently require source normalization. Keep derived normalization in a separate reviewed figure.');
  const issues = figureIssues(figure, datasets); if (issues.length) throw new Error(issues.join(' '));
  return renderFigure(figure, datasets);
}

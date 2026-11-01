import { phyniteApi, phyniteCalculations } from './phynite-api';
import { importRunDatasets } from './research-import';
import { validateDataset, type ResearchDataset } from './research-figures';
export type MdNumericalDataset = { name: string; xLabel: string; yLabel: string; points: Array<[number | null, number | null]>; sha256: string; filename: string; units: { x: string; y: string }; provenance: Record<string, unknown> };
export function mdNumericalDataset(projectId: string, value: MdNumericalDataset, stableId: string): ResearchDataset {
  if (!value.units.x || !value.units.y || !value.provenance || value.provenance.syntheticData !== false) throw new Error('MD source units and provenance are required.');
  return validateDataset({ schemaVersion: 1, id: stableId, projectId, name: value.name, createdAt: new Date().toISOString(), source: { filename: value.filename, sha256: value.sha256, parserVersion: 'workflow-md-numeric-v1' }, data: { kind: 'generic', title: value.name, xLabel: value.xLabel, quantities: [{ id: 'value', label: value.name, yLabel: value.yLabel, series: [{ id: 'value', label: value.name, points: value.points }] }] }, metadata: { energy: { kind: 'source' }, provenance: { ...value.provenance, units: value.units } } });
}
export async function workflowFigureDatasets(projectId: string, sources: Array<{ result: { jobId?: string; jobKind?: string } }>): Promise<ResearchDataset[]> {
  const datasets: ResearchDataset[] = [];
  for (const source of sources) {
    const result = source.result;
    if (!result.jobId) throw new Error('A Figure input has no retained numerical result.');
    if (result.jobKind === 'CALCULATION') {
      const { calculation } = await phyniteCalculations.get(result.jobId);
      const imported = await importRunDatasets(projectId, { id: calculation.id, name: calculation.name, materialId: calculation.structureId, status: 'Completed', calculationType: calculation.calculationType, backendCalculationId: calculation.id });
      datasets.push(...imported.datasets);
    } else if (result.jobKind === 'MD_ANALYSIS') {
      const imported = await phyniteApi<{ datasets: MdNumericalDataset[] }>(`/v1/projects/${encodeURIComponent(projectId)}/workflow-datasets/${encodeURIComponent(result.jobId)}`);
      datasets.push(...imported.datasets.map((dataset, index) => mdNumericalDataset(projectId, dataset, `md_${result.jobId}_${index}`)));
    } else throw new Error('Connect a completed DFT result or MD analysis to Figure.');
  }
  if (!datasets.length) throw new Error('Run the connected modules before opening this Figure.');
  return datasets;
}

export { workflowFigureStyle, applyWorkflowFigureStyle } from './workflow-figure-style.ts';

import { validateDataset, type ResearchDataset } from './research-figures.ts';

export type DatasetExportFormat = 'csv' | 'json' | 'dat';

/** Export every source sample; figure ranges, selections and shifts never apply. */
export function exportNumericalDataset(dataset: ResearchDataset, format: DatasetExportFormat) {
  const source = validateDataset(JSON.parse(JSON.stringify(dataset)));
  const filename = `${source.name.replace(/[^\p{L}\p{N}._-]+/gu, '-').slice(0, 120) || 'dataset'}.${format}`;
  if (format === 'json') return { filename, mime: 'application/json', text: JSON.stringify(source, null, 2) + '\n' };
  const csv = (value: string | number) => typeof value === 'number' ? String(value) : value === '' ? '' : `"${value.replace(/"/g, '""')}"`;
  if (format === 'csv') {
    const channels = source.metadata.orbitalProjection?.channels ?? [];
    const rows = [['quantity_id','series_id','sample_index','x','y','weight','x_label','y_label',...channels.map(c => `projector_${c.id}: ${c.label}`)].map(csv).join(',')];
    for (const quantity of source.data.quantities) for (const series of quantity.series) series.points.forEach(([x, y], i) => {
      rows.push([quantity.id, series.id, i, Number.isFinite(x) ? x : '', Number.isFinite(y) ? y : '', series.weights?.[i] ?? '', source.data.xLabel, quantity.yLabel,...channels.map(c=>series.projections?.[c.id]?.[i] ?? '')].map(csv).join(','));
    });
    return { filename, mime: 'text/csv;charset=utf-8', text: rows.join('\n') + '\n' };
  }
  const line = (text: string) => text.replace(/[\r\n]/g, ' ');
  const rows = [`# Dataset: ${line(source.name)}`, `# Source SHA-256: ${source.source.sha256}`, '# Source samples and energy reference; figure transformations are not applied.'];
  for (const quantity of source.data.quantities) for (const series of quantity.series) {
    rows.push(`# ${line(quantity.id)} / ${line(series.id)}: ${line(source.data.xLabel)} ; ${line(quantity.yLabel)}${series.weights ? ' ; projection weight' : ''}${series.projections ? ' ; '+Object.keys(series.projections).map(id=>`projector_${id}`).join(' ; ') : ''}`);
    for (let i = 0; i < series.points.length; i++) {
      const [x, y] = series.points[i];
      rows.push(Number.isFinite(x) && Number.isFinite(y) ? `${x} ${y}${series.weights ? ` ${series.weights[i]}` : ''}${series.projections ? ' '+Object.values(series.projections).map(weights=>weights[i]).join(' ') : ''}` : '');
    }
    rows.push('', '');
  }
  return { filename, mime: 'text/plain;charset=utf-8', text: rows.join('\n') + '\n' };
}

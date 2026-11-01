import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { researchHash, validateDataset, validateFigure, type FigureDocument, type ResearchDataset } from './research-figures.ts';

export async function buildSourcePackage(figure: FigureDocument, datasets: ResearchDataset[], svg: string, license: string, revision = 0): Promise<Uint8Array> {
  const used = datasets.filter((dataset) => figure.panels.some((panel) => panel.layers.some((layer) => layer.datasetId === dataset.id)));
  const figureJson = JSON.stringify(figure);
  const entries: Record<string, Uint8Array> = { 'figure.json': strToU8(figureJson), 'figure.svg': strToU8(svg), 'font-license.txt': strToU8(license) };
  const datasetHashes: Record<string, string> = {};
  for (const dataset of used) {
    const json = JSON.stringify(dataset);
    entries[`datasets/${dataset.id}.json`] = strToU8(json);
    datasetHashes[dataset.id] = await researchHash(json);
  }
  entries['manifest.json'] = strToU8(JSON.stringify({ schemaVersion: 1, figureId: figure.id, revision, revisionScope: revision ? 'cloud' : 'local-snapshot', figureSha256: await researchHash(figureJson), datasetHashes, renderer: 'phynite-figures-1', font: figure.fontFamily, sourceHashes: used.map((dataset) => ({ id: dataset.id, sha256: dataset.source.sha256 })), svgSha256: await researchHash(svg), generatedAt: new Date().toISOString(), reproduction: 'Figure and numeric sources. Re-running a simulation requires its full computational environment.' }, null, 2));
  return zipSync(entries);
}

export async function readSourcePackage(bytes: Uint8Array): Promise<{ figure: FigureDocument; datasets: ResearchDataset[] }> {
  if (bytes.length > 200_000_000) throw new Error('Source packages may contain up to 200 MB. Split larger figures.');
  let total = 0;
  const entries = unzipSync(bytes, { filter: (entry) => {
    if (!['figure.json', 'manifest.json'].includes(entry.name) && !/^datasets\/[A-Za-z0-9_-]+\.json$/.test(entry.name)) return false;
    // Older packages used indented JSON; validate the compact document after decoding.
    total += entry.originalSize;
    if (entry.originalSize > 20_000_000 || total > 200_000_000) throw new Error('Expanded source package exceeds the import limit.');
    return true;
  } });
  if (!entries['figure.json']) throw new Error('Source package is missing figure.json.');
  const figureJson = strFromU8(entries['figure.json']);
  const figure = validateFigure(JSON.parse(figureJson));
  const manifest = entries['manifest.json'] ? JSON.parse(strFromU8(entries['manifest.json'])) : undefined;
  if (manifest && (manifest.schemaVersion !== 1 || manifest.figureId !== figure.id || manifest.figureSha256 !== await researchHash(figureJson))) throw new Error('Figure checksum does not match the source package manifest.');
  const datasets: ResearchDataset[] = [];
  for (const [name, entry] of Object.entries(entries)) if (name.startsWith('datasets/')) {
    const json = strFromU8(entry), dataset = validateDataset(JSON.parse(json));
    if (name !== `datasets/${dataset.id}.json`) throw new Error('Source package dataset identity does not match its filename.');
    if (manifest?.datasetHashes && manifest.datasetHashes[dataset.id] !== await researchHash(json)) throw new Error('Dataset checksum does not match the source package manifest.');
    if (dataset.source.text !== undefined && dataset.source.sha256 !== await researchHash(dataset.source.text)) throw new Error('Original source checksum does not match.');
    datasets.push(dataset);
  }
  if (figure.panels.some((panel) => panel.layers.some((layer) => !datasets.some((dataset) => dataset.id === layer.datasetId)))) throw new Error('Source package is incomplete.');
  return { figure, datasets };
}

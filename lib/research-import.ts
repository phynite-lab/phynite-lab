import { attachBandProjections } from './band-projections.ts';
import { phyniteApi, phyniteCalculations, type PhyniteResultManifest } from './phynite-api.ts';
import { datasetFromText, finite, type ResearchDataset } from './research-figures.ts';
import type { ScientificPlotSettings } from './result-plot.ts';

export type FigureJob = {
  structureName?: string;
  startedAt?: string; completedAt?: string; updated?: string;
  computeResources?: import('./compute-resources.ts').ComputeResources;
  id: string; name: string; materialId: string; material?: string; status: string; calculationType?: string; backendCalculationId?: string;
  plotSettings?: ScientificPlotSettings; referenceMaterialUpdatedAt?: string; referenceElectronicFingerprint?: string;
  structureSourceId?: string; structureSourceCalculationId?: string; atomCount?: number;
};
type Source = { path: string; label?: string; role: string; text: string; sha256?: string };
type Bundle = { schemaVersion: number; calculationId: string; calculationType: string; sources: Source[]; summary?: PhyniteResultManifest['summary']; provenance?: PhyniteResultManifest['provenance']; skippedSources?: string[] };

async function readRetained(job: FigureJob): Promise<Bundle> {
  const response = await phyniteApi<{ url: string }>(`/v1/calculations/${encodeURIComponent(job.backendCalculationId!)}/research-data`);
  const source = await fetch(response.url, { credentials: response.url.startsWith('/api/cloud-artifacts/') ? 'same-origin' : 'omit', signal: AbortSignal.timeout(30000) });
  if (!source.ok) throw new Error('Retained research data is unavailable for this run.');
  if (Number(source.headers.get('content-length')) > 30_000_000) throw new Error('Research bundle is too large.');
  const text = await source.text();
  if (text.length > 30_000_000) throw new Error('Research bundle is too large.');
  const bundle = JSON.parse(text) as Bundle;
  if (bundle.schemaVersion !== 1 || bundle.calculationId !== job.backendCalculationId || !Array.isArray(bundle.sources)) throw new Error('Research bundle does not match the selected run.');
  return bundle;
}
export async function importRunDatasets(projectId: string, job: FigureJob): Promise<{ datasets: ResearchDataset[]; warning?: string }> {
  if (!job.backendCalculationId) throw new Error('This legacy run has no backend result identity. Import its CSV instead.');
  let bundle: Bundle;
  try { bundle = await readRetained(job); }
  catch {
    const result = await phyniteCalculations.get(job.backendCalculationId);
    const manifest = result.result;
    if (!manifest || result.artifactsExpired) throw new Error('This run has no retained dataset and its original artifacts are unavailable. Import a saved CSV/source package.');
    const sources: Source[] = [];
    for (const artifact of manifest.artifacts ?? []) {
      if (artifact.role !== 'data' || !(artifact.path.endsWith('.csv') || artifact.path.endsWith('/projected-bands.json'))) continue;
      const query = new URLSearchParams({ calculationId: job.backendCalculationId, path: artifact.path });
      const response = await fetch(`/api/calculation-artifact?${query}`, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error('Could not load the original numerical result.');
      sources.push({ path: artifact.path, role: artifact.role, label: artifact.label, text: await response.text() });
    }
    bundle = { schemaVersion: 1, calculationId: job.backendCalculationId, calculationType: job.calculationType ?? '', sources, summary: manifest.summary, provenance: manifest.provenance };
  }
  const candidates = bundle.sources.filter((source) => source.role === 'data' && source.path.endsWith('.csv'));
  if (!candidates.length) throw new Error('No retained numerical CSV was found for this run.');
  const pairingKey = job.referenceElectronicFingerprint && job.referenceMaterialUpdatedAt && job.structureSourceId
    ? JSON.stringify([job.materialId, job.referenceMaterialUpdatedAt, job.structureSourceId, job.structureSourceCalculationId ?? '', job.referenceElectronicFingerprint]) : undefined;
  const fermiEv = bundle.summary?.fermiEnergyEv;
  const vbmEv = bundle.summary?.vbmEnergyEv;
  const scfInput = bundle.sources.find((source) => source.role === 'input' && /(?:^|\/)scf\.in$/.test(source.path))?.text;
  const nat = scfInput?.match(/\bnat\s*=\s*(\d+)/i);
  const datasets: ResearchDataset[] = [];
  for (const source of candidates) {
    const dataset = await datasetFromText(source.text, {
      projectId, filename: source.path, name: `${job.material ?? job.name} / ${source.label ?? job.calculationType ?? 'Result'}`, calculationType: job.calculationType,
      source: { calculationId: job.backendCalculationId, materialId: job.materialId, pairingKey, runStartedAt: job.startedAt, runCompletedAt: job.completedAt },
      metadata: {
        energy: { kind: finite(fermiEv) && source.text.split('\n')[0].includes('relative_to_fermi') ? 'fermi' : 'unknown', ...(finite(fermiEv) ? { fermiEv } : {}), ...(finite(vbmEv) ? { vbmEv } : {}), note: 'Reference from the retained calculation manifest; source values are not inferred from curve extrema.' },
        path: ['Band structure', 'Phonon dispersion'].includes(job.calculationType ?? '') ? bundle.provenance?.reciprocalPath as ResearchDataset['metadata']['path'] : undefined,
        atomCount: nat ? Number(nat[1]) : undefined, dosBasis: job.calculationType === 'Density of states' ? 'cell' : 'unknown', provenance: { ...bundle.provenance, sourceSummary: bundle.summary, executedInputs: bundle.sources.filter((file) => file.role === 'input').map((file) => ({ path: file.path, text: file.text, sha256: file.sha256 })) },
      },
    });
    if (source.sha256 && dataset.source.sha256 !== source.sha256) throw new Error('Retained dataset checksum does not match.');
    const projection = bundle.sources.find(file => file.path.endsWith('/projected-bands.json'));
    if (dataset.data.kind === 'band' && projection) {
      if (projection.sha256 && await import('./research-figures.ts').then(m => m.researchHash(projection.text)) !== projection.sha256) throw new Error('Orbital projection checksum mismatch.');
      attachBandProjections(dataset, JSON.parse(projection.text));
    }
    datasets.push(dataset);
  }
  return { datasets, warning: bundle.skippedSources?.length ? `${bundle.skippedSources.length} large source files were outside the compact retention limit.` : undefined };
}

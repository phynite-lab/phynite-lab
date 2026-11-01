import type { ResearchDataset } from './research-figures.ts';

export type OrbitalChannel = { id: string; atom: number; species: string; wfc: number; l: number; orbital: string; label: string };
export function validateOrbitalChannels(channels: OrbitalChannel[]) {
  if (!Array.isArray(channels) || !channels.length || channels.length > 4096 || new Set(channels.map(c=>c?.id)).size !== channels.length) throw new Error('Orbital channel identities are invalid.');
  for (const channel of channels) if (!channel || !/^\d+$/.test(channel.id) || !Number.isSafeInteger(channel.atom) || channel.atom < 1 || !Number.isSafeInteger(channel.wfc) || channel.wfc < 1 || !Number.isInteger(channel.l) || channel.l < 0 || channel.l > 6 || !/^[A-Za-z][A-Za-z0-9_]*$/.test(channel.species) || typeof channel.label !== 'string' || channel.label.length > 200 || typeof channel.orbital !== 'string') throw new Error('Every projector needs an explicit atom and orbital identity.');
}
export function attachBandProjections(dataset: ResearchDataset, value: unknown): ResearchDataset {
  const p = value as { version: number; basis: string; sourceSha256: string; kpointCount: number; channels: OrbitalChannel[]; series: Array<Record<string, number[]>> };
  const bands = dataset.data.quantities[0]?.series;
  if (dataset.data.kind !== 'band' || p?.version !== 1 || p.basis !== 'orthogonalized-atomic-global-axes' || !/^[a-f0-9]{64}$/.test(p.sourceSha256) || !Array.isArray(p.channels) || !p.channels.length || p.channels.length > 4096 || new Set(p.channels.map(c => c.id)).size !== p.channels.length || !Array.isArray(p.series) || p.series.length !== bands?.length) throw new Error('Orbital projection metadata does not match the band dataset.');
  validateOrbitalChannels(p.channels);
  p.series.forEach((channels, band) => {
    if (!channels || Object.keys(channels).length !== p.channels.length || bands[band].points.length !== p.kpointCount || p.channels.some(c => !Array.isArray(channels[c.id]) || channels[c.id].length !== p.kpointCount || channels[c.id].some(w => !Number.isFinite(w) || w < 0 || w > 1.00001))) throw new Error('Orbital weights must be complete finite probabilities for every k-point, band and projector.');
    bands[band].projections = channels;
  });
  dataset.metadata.orbitalProjection = { channels: p.channels, sourceSha256: p.sourceSha256, basis: p.basis };
  return dataset;
}

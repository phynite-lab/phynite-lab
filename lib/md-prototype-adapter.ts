import { Color, SRGBColorSpace } from 'three';
import type { FrameData, ModifierItem, TimelineMetric, TrajectoryInfo } from '../components/md-prototype/types/trajectory.ts';
import { sampleColormap } from '../components/md-prototype/utils/colormaps.ts';
import { cellVolume, latticeFromCellVectors } from './crystal-cell.ts';
import { mdAppearanceFor } from './md-element-appearance.ts';
import { propertyRange, speciesCounts } from './md-analysis.ts';
import type { MdAnalysis, MdModifier, MdSettings } from './md-types.ts';

const rgb = (style: string): [number, number, number] => { const color = new Color().setStyle(style); const value = color.getRGB({ r: 0, g: 0, b: 0 }, SRGBColorSpace); return [value.r, value.g, value.b]; };
const usedScientificEngine = (analysis: MdAnalysis) => analysis.engine === 'Phynite MD Engine' || analysis.engine.startsWith('OVITO');
export function mdFormula(counts: Record<string, number>) {
  const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
  const divisor = Object.values(counts).reduce(gcd, 0) || 1;
  return Object.entries(counts).map(([element, count]) => element + (count / divisor === 1 ? '' : count / divisor)).join('') || '—';
}
export function toPrototypeModifier(modifier: MdModifier): ModifierItem {
  const params: ModifierItem['params'] = { ...modifier.params };
  if (modifier.kind === 'ptm') { params.rmsdCutoff = Number(params.rmsd); delete params.rmsd; }
  if (modifier.kind === 'dxa') { params.crystalStructure = String(params.lattice); delete params.lattice; }
  if (modifier.kind === 'replicate') { const repeat = params.repeat as number[]; [params.numX, params.numY, params.numZ] = repeat; delete params.repeat; }
  return { id: modifier.id, type: modifier.kind, enabled: modifier.enabled, params };
}
export function fromPrototypeModifier(modifier: ModifierItem): MdModifier {
  const params = { ...modifier.params };
  if (modifier.type === 'ptm') { params.rmsd = params.rmsdCutoff; delete params.rmsdCutoff; }
  if (modifier.type === 'dxa') { params.lattice = params.crystalStructure; delete params.crystalStructure; }
  if (modifier.type === 'replicate') { params.repeat = [params.numX ?? 1, params.numY ?? 1, params.numZ ?? 1]; delete params.numX; delete params.numY; delete params.numZ; }
  return { id: modifier.id ?? crypto.randomUUID(), kind: modifier.type, enabled: modifier.enabled, params: Object.fromEntries(Object.entries(params).filter((entry): entry is [string, string | number | boolean | number[]] => entry[1] !== undefined)) };
}
export function toPrototypeFrame(analysis: MdAnalysis, settings: MdSettings, totalFrames: number): FrameData {
  const { frame, attributes } = analysis;
  const species = [...new Set(frame.species)];
  const scalarValues = settings.colorBy === 'Species' || settings.colorBy === 'Structure Type' ? undefined : frame.properties[settings.colorBy];
  const range = scalarValues ? propertyRange(scalarValues) : null;
  const colors = frame.ids.flatMap((_, i) => {
    if (frame.properties.Selection?.[i]) return rgb('#ffcb57');
    const phase = settings.colorBy === 'Structure Type' ? analysis.phases.find(p => p.id === frame.properties['Structure Type']?.[i]) : null;
    if (phase) return rgb(phase.color);
    if (range && scalarValues && Number.isFinite(scalarValues[i])) return sampleColormap(range[0] === range[1] ? .5 : (scalarValues[i] - range[0]) / (range[1] - range[0]), settings.palette);
    return rgb(mdAppearanceFor(frame.species[i]).color);
  });
  const histogram = range ? Array.from({ length: 24 }, (_, i) => ({ x0: range[0] + i / 24 * (range[1] - range[0]), x1: range[0] + (i + 1) / 24 * (range[1] - range[0]), count: 0, colorHex: '#' + sampleColormap((i + .5) / 24, settings.palette).map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('') })) : [];
  scalarValues?.forEach(v => { if (range && Number.isFinite(v)) histogram[Math.min(23, Math.floor((v - range[0]) / (range[1] - range[0] || 1) * 24))].count++; });
  const length = analysis.dislocations.reduce((sum, line) => sum + line.length, 0);
  const volume = Math.abs(cellVolume(frame.vectors));
  const dxa = settings.modifiers.some(m => m.kind === 'dxa' && m.enabled) && usedScientificEngine(analysis);
  const shear = frame.properties['Shear Strain']?.filter(Number.isFinite);
  const cutoff = Math.max(3, ...settings.modifiers.filter(m => m.kind === 'bonds' && m.enabled).map(m => Number(m.params.cutoff)));
  return {
    frame: frame.index, totalFrames, numParticles: frame.ids.length, ids: frame.ids, species: frame.species,
    positions: frame.positions, colors, radii: frame.ids.map((_, i) => {
      const explicitRadius = frame.properties.Radius?.[i];
      if (Number.isFinite(explicitRadius) && explicitRadius! > 0) return explicitRadius!;
      const elementRadius = mdAppearanceFor(frame.species[i]).radius;
      return elementRadius > 0 ? elementRadius : 1.2;
    }),
    types: frame.species.map(s => species.indexOf(s) + 1), structureTypes: frame.properties['Structure Type'] ?? [],
    phaseCounts: Object.fromEntries(analysis.phases.map(p => [p.name, p.count])), phaseColors: Object.fromEntries(analysis.phases.map(p => [p.name, p.color])), phaseLabels: Object.fromEntries(analysis.phases.map(p => [p.id, p.name])),
    bulkStructureType: analysis.phases.filter(p => p.id !== 0).sort((a, b) => b.count - a.count)[0]?.id,
    speciesCounts: Object.fromEntries(speciesCounts(frame).map(c => [c.name, c.count])), scalarValues,
    scalarRange: range ? { min: range[0], max: range[1], property: settings.colorBy, colormap: settings.palette, histogram } : null,
    cell: { matrix: [0, 1, 2].map(axis => [...frame.vectors.map(v => v[axis]), frame.origin[axis]]), pbc: frame.periodic },
    dislocations: dxa ? { lines: analysis.dislocations.map(line => ({ points: line.points, burgersVector: line.burgers, length: line.length, color: rgb(line.color ?? '#58c594'), type: 'Phynite' })), totalLineLength: length, dislocationDensity: length / volume } : null,
    surface: analysis.surface ? { ...analysis.surface, surfaceArea: Number(attributes['ConstructSurfaceMesh.surface_area'] ?? NaN), solidVolume: Number(attributes['ConstructSurfaceMesh.filled_volume'] ?? NaN) } : null,
    rdf: analysis.rdf.map(([r, g_r]) => ({ r, g_r })),
    bonds: analysis.bonds.filter(([i, j]) => Math.hypot(...[0, 1, 2].map(a => frame.positions[i * 3 + a] - frame.positions[j * 3 + a])) <= cutoff + .01),
    attributes: { ...attributes, ...((attributes['mean coordination'] ?? attributes.mean_coordination) !== undefined ? { AvgCoordination: attributes['mean coordination'] ?? attributes.mean_coordination } : {}), ...(settings.modifiers.some(m => m.kind === 'bonds' && m.enabled) ? { TotalBondsCount: analysis.bonds.length } : {}), ...(shear?.length ? { MaxShearStrain: shear.reduce((a, b) => Math.max(a, b), -Infinity) } : {}) },
  };
}
export function prototypeInfo(data: FrameData, filename: string, settings: MdSettings): TrajectoryInfo {
  return { filename, path: '', numFrames: data.totalFrames, numParticles: data.numParticles, properties: [], cellMatrix: data.cell.matrix, pbc: data.cell.pbc, currentConfig: { modifiers: settings.modifiers.map(toPrototypeModifier), colorProperty: settings.colorBy, colormap: settings.palette } };
}
export function prototypeCell(data: FrameData) {
  return latticeFromCellVectors([0, 1, 2].map(a => [data.cell.matrix[0][a], data.cell.matrix[1][a], data.cell.matrix[2][a]]) as Parameters<typeof latticeFromCellVectors>[0]);
}
export function toPrototypeMetric(analysis: MdAnalysis, settings: Pick<MdSettings, 'modifiers'>): TimelineMetric {
  const values = analysis.frame.properties.c_pe?.filter(Number.isFinite);
  const hasDxa = usedScientificEngine(analysis) && settings.modifiers.some(m => m.kind === 'dxa' && m.enabled);
  return { frame: analysis.frame.index, timestep: analysis.frame.timestep ?? analysis.frame.index,
    phases: Object.fromEntries(analysis.phases.map(p => [p.name, p.count / Math.max(1, analysis.frame.ids.length) * 100])),
    avgPotentialEnergy: values?.length ? values.reduce((a, b) => a + b, 0) / values.length : null,
    dislocationDensity: hasDxa ? analysis.dislocations.reduce((a, b) => a + b.length, 0) / Math.abs(cellVolume(analysis.frame.vectors)) : undefined };
}

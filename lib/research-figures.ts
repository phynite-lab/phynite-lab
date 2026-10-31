import { validateOrbitalChannels } from './band-projections.ts';
import { autoSizeFigure } from './figure-layout.ts';
import { defaultScientificPlotSettings, mergeScientificPlotSettings, parseScientificPlotCsv, kPointSymbol, plotSeriesColor, renderScientificPlotPanelSvg, scientificPanelHeader, type ScientificPlotData, type ScientificPlotSettings, type PlotLineStyle } from './result-plot.ts';

export type ResearchDataset = {
  schemaVersion: 1; id: string; projectId: string; name: string; createdAt: string;
  data: ScientificPlotData;
  source: { filename: string; sha256: string; parserVersion: string; text?: string; calculationId?: string; materialId?: string; pairingKey?: string; runStartedAt?: string; runCompletedAt?: string };
  metadata: {
    energy: { kind: 'fermi' | 'unknown' | 'source'; fermiEv?: number; vbmEv?: number; vacuumEv?: number; note?: string };
    path?: { labels?: string[]; tickIndices?: number[]; breakIndices?: number[]; segments?: string[][]; pointCoords?: Record<string, number[]>; coordinateSystem?: string; cellAngstrom?: number[][] };
    atomCount?: number; formulaUnits?: number; volumeAngstrom3?: number; dosBasis?: 'cell' | 'unknown';
    condition?: { parameter: string; value: number; unit: string; reference?: string; relaxation?: string };
    provenance?: Record<string, unknown>;
    orbitalProjection?: { channels: import('./band-projections.ts').OrbitalChannel[]; sourceSha256: string; basis: string };
    plotType?: 'pdos' | 'unfolded';
  };
};
export type FigureLayer = {
  id: string; datasetId: string; quantityId: string; label: string; color: string; lineStyle: PlotLineStyle;
  visible: boolean; energy: 'source' | 'fermi' | 'vbm' | 'vacuum' | 'manual'; shiftEv: number;
  normalization: 'source' | 'atom' | 'formula' | 'volume'; mirrorSpin: boolean; normalizedPath: boolean;
  seriesIds: string[] | null; energyVertical: boolean;
  projectionIds?: string[];
  channelStyles?: Record<string, { color?: string; lineStyle?: PlotLineStyle; label?: string }>;
};
export type FigurePanel = {
  id: string; title: string; layers: FigureLayer[]; xMin: number | null; xMax: number | null; yMin: number | null; yMax: number | null;
  energyGroup: string; span: number; showLegend: boolean;
  xLabel?: string; yLabel?: string; xReference?: number | null; yReference?: number | null; referenceLabel?: string;
  showXZero?: boolean; showYZero?: boolean; showFrame?: boolean;
  pairingGroup?: string;
  inset?: { parentId: string; x: number; y: number; width: number; height: number };
};
export type FigureDocument = {
  schemaVersion: 1; id: string; projectId: string; name: string; createdAt: string; updatedAt: string;
  widthMm: number; heightMm: number; columns: number; panels: FigurePanel[];
  sizeMode?: 'auto' | 'manual'; rows?: number; sizeUnit?: import('./figure-layout.ts').FigureUnit; rasterDpi?: number;
  fontPt: number; lineWidthPt: number; fontFamily: 'sans' | 'serif' | 'mono'; showGrid: boolean; panelLabels: boolean;
  caption: string; archived?: boolean; resultStyleVersion?: 1;
};
export type FigureTemplate = FigureDocument & { slots: Array<{ panelId: string; layerId: string; kind: ScientificPlotData['kind']; quantityId: string; sourceIndex?: number; titleSource?: 'name' | 'condition' }> };
export type FigureMode = 'single' | 'overlay' | 'grid' | 'band-dos' | 'parameter';
export const FIGURE_COLORS = ['#0072b2', '#d55e00', '#009e73', '#cc79a7', '#e69f00', '#252a35'];
export function latestFigureForCalculation(figures: FigureDocument[], datasets: ResearchDataset[], calculationId?: string) {
  if (!calculationId) return undefined;
  const sourceIds = new Set(datasets.filter((dataset) => dataset.source.calculationId === calculationId).map((dataset) => dataset.id));
  return figures.filter((figure) => !figure.archived && figure.panels.some((panel) => panel.layers.some((layer) => sourceIds.has(layer.datasetId)))).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}
export function updateFigurePanel(figure: FigureDocument, panelId: string, patch: Partial<FigurePanel>): FigureDocument {
  const selected = figure.panels.find((panel) => panel.id === panelId);
  return { ...figure, panels: figure.panels.map((panel) => {
    if (panel.id === panelId) return { ...panel, ...patch };
    if (!selected?.energyGroup || panel.energyGroup !== selected.energyGroup) return panel;
    return { ...panel, ...('yMin' in patch ? { yMin: patch.yMin } : {}), ...('yMax' in patch ? { yMax: patch.yMax } : {}) };
  }) };
}
export const newResearchId = () => crypto.randomUUID();
export const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const xml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]!));
const identity = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const shortText = (value: unknown, max = 200): value is string => typeof value === 'string' && value.length <= max;
const within = (value: unknown, min: number, max: number) => finite(value) && value >= min && value <= max;

export function validateFigure(value: unknown, template = false): FigureDocument {
  const figure = value as FigureDocument;
  if (!figure || figure.schemaVersion !== 1 || !identity(figure.id) || !identity(figure.projectId) || !shortText(figure.name) || !figure.name.trim() || !shortText(figure.caption, 10000)) throw new Error('Figure identity, name or caption is invalid.');
  if (!within(figure.widthMm, 50, 500) || !within(figure.heightMm, 50, 700) || !Number.isInteger(figure.columns) || !within(figure.columns, 1, 6)) throw new Error('Choose 50-500 mm width, 50-700 mm height and 1-6 columns.');
  if (figure.rows !== undefined && (!Number.isInteger(figure.rows) || !within(figure.rows, 1, 64))) throw new Error('Choose 1–64 rows, or Auto.');
  if (figure.sizeMode !== undefined && !['auto', 'manual'].includes(figure.sizeMode)) throw new Error('Figure size mode is invalid.');
  if (figure.sizeUnit !== undefined && !['mm', 'cm', 'in', 'px', 'pt'].includes(figure.sizeUnit)) throw new Error('Figure size unit is invalid.');
  if (figure.rasterDpi !== undefined && !within(figure.rasterDpi, 72, 1200)) throw new Error('Choose an export resolution between 72 and 1200 DPI.');
  if (!within(figure.fontPt, 5, 24) || !within(figure.lineWidthPt, 0.1, 4) || !['sans', 'serif', 'mono'].includes(figure.fontFamily)) throw new Error('Figure typography is invalid.');
  if (!Array.isArray(figure.panels) || !within(figure.panels.length, 1, 64)) throw new Error('A figure needs 1-64 panels.');
  const ids = new Set<string>();
  for (const panel of figure.panels) {
    if (!panel || !identity(panel.id) || ids.has(panel.id) || !shortText(panel.title) || !shortText(panel.energyGroup, 100) || !Number.isInteger(panel.span) || !within(panel.span, 1, 6) || !Array.isArray(panel.layers) || !within(panel.layers.length, 1, 32)) throw new Error('Panel identity, span or layers are invalid.');
    ids.add(panel.id);
    if (panel.pairingGroup !== undefined && !identity(panel.pairingGroup)) throw new Error('Band + DOS pairing identity is invalid.');
    for (const key of ['xMin', 'xMax', 'yMin', 'yMax'] as const) if (panel[key] !== null && !finite(panel[key])) throw new Error('Axis limits must be finite or automatic.');
    for (const key of ['xReference', 'yReference'] as const) if (panel[key] !== undefined && panel[key] !== null && !finite(panel[key])) throw new Error('Axis references must be finite or hidden.');
    if ((panel.xLabel !== undefined && !shortText(panel.xLabel)) || (panel.yLabel !== undefined && !shortText(panel.yLabel)) || (panel.referenceLabel !== undefined && !shortText(panel.referenceLabel))) throw new Error('Panel labels are invalid.');
    if (['showXZero', 'showYZero', 'showFrame'].some((key) => panel[key as keyof FigurePanel] !== undefined && typeof panel[key as keyof FigurePanel] !== 'boolean')) throw new Error('Panel reference visibility is invalid.');
    if ((panel.xMin !== null && panel.xMax !== null && panel.xMax <= panel.xMin) || (panel.yMin !== null && panel.yMax !== null && panel.yMax <= panel.yMin)) throw new Error('Axis maximum must exceed its minimum.');
    for (const layer of panel.layers) {
      if (!layer || !identity(layer.id) || ids.has(layer.id) || !(template ? layer.datasetId === '' : identity(layer.datasetId)) || !shortText(layer.quantityId) || !shortText(layer.label) || !/^#[0-9a-f]{6}$/i.test(layer.color)) throw new Error('Result identity, label or color is invalid.');
      ids.add(layer.id);
      if (!['solid', 'dash', 'dot', 'dashdot'].includes(layer.lineStyle) || !['source', 'fermi', 'vbm', 'vacuum', 'manual'].includes(layer.energy) || !['source', 'atom', 'formula', 'volume'].includes(layer.normalization) || !finite(layer.shiftEv)) throw new Error('Result style or transformation is invalid.');
      if (['visible', 'mirrorSpin', 'normalizedPath', 'energyVertical'].some((key) => typeof layer[key as keyof FigureLayer] !== 'boolean') || (layer.seriesIds !== null && (!Array.isArray(layer.seriesIds) || layer.seriesIds.some((id) => !shortText(id))))) throw new Error('Result channel selection is invalid.');
      if (layer.projectionIds && (!Array.isArray(layer.projectionIds) || new Set(layer.projectionIds).size !== layer.projectionIds.length || layer.projectionIds.some(id => !/^\d+$/.test(id)))) throw new Error('Invalid orbital selection.');
      if (layer.channelStyles && Object.values(layer.channelStyles).some((style) => !style || (style.color !== undefined && !/^#[0-9a-f]{6}$/i.test(style.color)) || (style.lineStyle !== undefined && !['solid', 'dash', 'dot', 'dashdot'].includes(style.lineStyle)) || (style.label !== undefined && !shortText(style.label)))) throw new Error('Channel style is invalid.');
    }
    if (panel.inset) {
      const inset = panel.inset;
      if (!identity(inset.parentId) || ![inset.x, inset.y, inset.width, inset.height].every(finite) || inset.x < 0 || inset.y < 0 || inset.width < 0.2 || inset.height < 0.2 || inset.x + inset.width > 1 || inset.y + inset.height > 1 || !figure.panels.some((parent) => parent.id === inset.parentId && !parent.inset)) throw new Error('Inset must fit inside an existing top-level panel.');
    }
  }
  if (template) {
    const slots = (figure as FigureTemplate).slots;
    if (!Array.isArray(slots) || slots.length !== figure.panels.reduce((count, panel) => count + panel.layers.length, 0) || new Set(slots.map((slot) => slot.layerId)).size !== slots.length || slots.some((slot) => !figure.panels.some((panel) => panel.id === slot.panelId && panel.layers.some((layer) => layer.id === slot.layerId)) || !['band', 'dos', 'phonon', 'thermoelectric', 'generic'].includes(slot.kind))) throw new Error('Template slots must match every result binding.');
    if (slots.some((slot) => slot.sourceIndex !== undefined && (!Number.isInteger(slot.sourceIndex) || slot.sourceIndex < 0 || slot.sourceIndex >= slots.length))) throw new Error('Template source indices are invalid.');
    if (slots.some((slot) => slot.titleSource !== undefined && !['name', 'condition'].includes(slot.titleSource))) throw new Error('Template title binding is invalid.');
  }
  return figure;
}

export async function researchHash(text: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function validateDataset(value: unknown): ResearchDataset {
  if (!value || typeof value !== 'object') throw new Error('Dataset must be a JSON object.');
  const dataset = structuredClone(value) as ResearchDataset;
  if (dataset.schemaVersion !== 1 || !identity(dataset.id) || !identity(dataset.projectId) || !shortText(dataset.name) || !dataset.name.trim() || !dataset.source || !shortText(dataset.source.filename, 1000) || !/^[a-f0-9]{64}$/i.test(dataset.source.sha256) || !shortText(dataset.source.parserVersion) || !dataset.metadata?.energy || !['fermi', 'source', 'unknown'].includes(dataset.metadata.energy.kind)) throw new Error('Dataset identity, source and energy metadata are required.');
  if (!['band', 'dos', 'phonon', 'thermoelectric', 'generic'].includes(dataset.data?.kind) || !dataset.data.quantities?.length) throw new Error('Dataset has no supported plot quantities.');
  const orbital=dataset.metadata.orbitalProjection;
  if (orbital) { validateOrbitalChannels(orbital.channels); if (dataset.data.kind !== 'band' || orbital.basis !== 'orthogonalized-atomic-global-axes' || !/^[a-f0-9]{64}$/.test(orbital.sourceSha256)) throw new Error('Orbital projection basis or source identity is invalid.'); }
  let count = 0;
  const quantityIds = new Set<string>();
  for (const quantity of dataset.data.quantities) {
    if (!shortText(quantity.id) || quantityIds.has(quantity.id) || !shortText(quantity.label) || !shortText(quantity.yLabel) || !quantity.series?.length) throw new Error('Each quantity needs unique identities and named curves.');
    quantityIds.add(quantity.id);
    const ids = new Set<string>();
    for (const series of quantity.series) {
      if (!shortText(series.id) || !shortText(series.label) || ids.has(series.id) || !series.points?.length) throw new Error('Curve identities must be unique within a quantity.');
      ids.add(series.id);
      series.points = series.points.map((point) => {
        if (!Array.isArray(point) || point.length !== 2 || point.some((entry) => entry !== null && !finite(entry))) throw new Error('Points must contain two finite numbers, or null for a gap.');
        return [point[0] === null ? Number.NaN : point[0], point[1] === null ? Number.NaN : point[1]];
      });
      if (!series.points.some(([x, y]) => finite(x) && finite(y))) throw new Error('Each curve needs at least one finite sample.');
      if (series.weights && (series.weights.length !== series.points.length || series.weights.some((weight) => !finite(weight) || weight < 0))) throw new Error('Spectral weights must be nonnegative and match the points.');
      if (orbital && (!series.projections || Object.keys(series.projections).length !== orbital.channels.length || orbital.channels.some(c=>!series.projections?.[c.id]))) throw new Error('Every band must retain the same complete atomic projection channels.');
      if (series.projections && Object.entries(series.projections).some(([id, weights]) => !/^\d+$/.test(id) || !Array.isArray(weights) || weights.length !== series.points.length || weights.some(w => !finite(w) || w < 0 || w > 1.00001))) throw new Error('Invalid orbital projection weights.');
      count += series.points.length;
    }
  }
  if (count > 250_000 || new TextEncoder().encode(JSON.stringify(dataset)).length > 4_000_000) throw new Error('Split this dataset: maximum 250,000 points or 4 MB per document.');
  for (const value of [dataset.metadata.energy.fermiEv, dataset.metadata.energy.vbmEv, dataset.metadata.energy.vacuumEv]) if (value !== undefined && !finite(value)) throw new Error('Energy references must be finite values in eV.');
  if (!shortText(dataset.data.title) || !shortText(dataset.data.xLabel)) throw new Error('Dataset axis labels are invalid.');
  for (const value of [dataset.metadata.atomCount, dataset.metadata.formulaUnits, dataset.metadata.volumeAngstrom3]) if (value !== undefined && (!finite(value) || value <= 0)) throw new Error('DOS normalization factors must be positive.');
  const condition = dataset.metadata.condition;
  if (condition && (!shortText(condition.parameter) || !finite(condition.value) || !shortText(condition.unit))) throw new Error('Parameter metadata is invalid.');
  const path = dataset.metadata.path;
  if (path) {
    const samples = Math.min(...dataset.data.quantities.flatMap((quantity) => quantity.series.map((series) => series.points.length)));
    for (const indices of [path.tickIndices, path.breakIndices]) if (indices && (!Array.isArray(indices) || indices.length > 1000 || indices.some((index, position) => !Number.isInteger(index) || index < 0 || index >= samples || (position > 0 && index <= indices[position - 1])))) throw new Error('Path indices must increase and refer to actual source samples.');
    if (path.labels && (!Array.isArray(path.labels) || path.labels.length !== path.tickIndices?.length || path.labels.some((label) => !shortText(label, 50)))) throw new Error('Each symmetry label needs a matching tick index.');
    if (path.segments && (!Array.isArray(path.segments) || path.segments.length > 1000 || path.segments.some((segment) => !Array.isArray(segment) || segment.length !== 2 || segment.some((label) => !shortText(label, 50))))) throw new Error('Path segments need pairs of endpoint labels.');
    if (path.cellAngstrom && (!Array.isArray(path.cellAngstrom) || path.cellAngstrom.length !== 3 || path.cellAngstrom.some((row) => !Array.isArray(row) || row.length !== 3 || !row.every(finite)))) throw new Error('Reciprocal basis needs a finite 3 by 3 direct cell.');
    if (path.pointCoords && Object.values(path.pointCoords).some((point) => !Array.isArray(point) || point.length !== 3 || !point.every(finite))) throw new Error('Symmetry point coordinates must contain three finite values.');
  }
  // JSON null represents a real discontinuity, never the number zero.
  return dataset;
}

export async function datasetFromText(text: string, options: { projectId: string; name: string; filename: string; calculationType?: string; format?: 'csv' | 'pdos' | 'unfolded'; source?: Partial<ResearchDataset['source']>; metadata?: Partial<ResearchDataset['metadata']> }): Promise<ResearchDataset> {
  let data: ScientificPlotData;
  const format = options.format ?? 'csv';
  if (format === 'unfolded' || format === 'pdos') {
    const lines = text.split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith('#'));
    if (/^(?:k(?:[_ ,]|$)|energy|e[[(])/i.test(lines[0]?.trim() ?? '')) lines.shift();
    const rows = lines.map((line, index) => {
      const row = line.trim().split(/[\s,]+/).map((value) => Number(value.replace(/[dD]([+-]?\d+)$/, 'e$1')));
      if (row.length < (format === 'unfolded' ? 3 : 2) || !row.every(finite)) throw new Error(`Invalid numerical row ${index + 1}. Correct the source; rows are never silently dropped.`);
      return row;
    });
    if (!rows.length) throw new Error(format === 'unfolded' ? 'Expected k, energy (eV), spectral weight from an unfolding calculation.' : 'Expected energy (eV) followed by projected DOS channels.');
    if (rows.some((row) => row.length !== rows[0].length)) throw new Error('Every data row must have the same columns.');
    if (format === 'unfolded' && rows.some((row) => row[2] < 0)) throw new Error('Spectral weights cannot be negative.');
    data = { kind: format === 'pdos' ? 'dos' : 'band', energyReference: 'unknown', title: options.name, xLabel: format === 'pdos' ? 'Energy (reference unspecified)' : 'k-path coordinate', quantities: [{ id: format, label: format === 'pdos' ? 'Projected DOS' : 'Unfolded bands', yLabel: format === 'pdos' ? 'Projected DOS (source units)' : 'Energy (reference unspecified)', series: format === 'unfolded' ? [{ id: 'spectral', label: 'Spectral weight', points: rows.map((row) => [row[0], row[1]]), weights: rows.map((row) => row[2]) }] : rows[0].slice(1).map((_, index) => ({ id: `projection_${index + 1}`, label: `Projected channel ${index + 1}`, points: rows.map((row) => [row[0], row[index + 1]]) })) }] };
  } else data = parseScientificPlotCsv(text, options.calculationType);
  if (data.kind === 'dos') for (const quantity of data.quantities) for (const series of quantity.series) if (/dos_down|spin_down/i.test(series.id)) series.points = series.points.map(([x, y]) => [x, Math.abs(y)]);
  const metadata = { energy: { kind: data.energyReference === 'fermi' ? 'fermi' : 'unknown' } as ResearchDataset['metadata']['energy'], ...options.metadata, ...(format !== 'csv' ? { plotType: format } : {}) };
  const dataset: ResearchDataset = { schemaVersion: 1, id: newResearchId(), projectId: options.projectId, name: options.name, createdAt: new Date().toISOString(), data, source: { filename: options.filename, sha256: await researchHash(text), parserVersion: 'phynite-research-1', text, ...options.source }, metadata };
  return validateDataset(JSON.parse(JSON.stringify(dataset)));
}

export function newLayer(dataset: ResearchDataset, index = 0): FigureLayer {
  return { id: newResearchId(), datasetId: dataset.id, quantityId: dataset.data.quantities[0].id, label: dataset.name, color: FIGURE_COLORS[index % FIGURE_COLORS.length], lineStyle: 'solid', visible: true, energy: 'source', shiftEv: 0, normalization: 'source', mirrorSpin: true, normalizedPath: false, seriesIds: null, energyVertical: dataset.data.kind === 'band' };
}
export function newPanel(layers: FigureLayer[] = [], title = ''): FigurePanel {
  return { id: newResearchId(), title, layers, xMin: null, xMax: null, yMin: null, yMax: null, energyGroup: '', span: 1, showLegend: true };
}
export function pairingReason(left: ResearchDataset, right: ResearchDataset): string | null {
  if (new Set([left.data.kind, right.data.kind]).size !== 2 || ![left.data.kind, right.data.kind].every((kind) => kind === 'band' || kind === 'dos')) return 'Choose one Band and one DOS result.';
  if (!left.source.pairingKey || left.source.pairingKey !== right.source.pairingKey) return 'Verified geometry and SCF pairing metadata do not match. Use separate comparison panels.';
  if (left.metadata.energy.kind !== 'fermi' || right.metadata.energy.kind !== 'fermi') return 'Both paired results need a recorded Fermi reference.';
  return null;
}

export function createFigure(projectId: string, datasets: ResearchDataset[], mode: FigureMode = 'grid', name = 'Untitled figure'): FigureDocument {
  if (!datasets.length) throw new Error('Choose at least one result.');
  if (mode === 'parameter' && (datasets.some((dataset) => !dataset.metadata.condition) || new Set(datasets.map((dataset) => JSON.stringify([dataset.metadata.condition?.parameter, dataset.metadata.condition?.unit]))).size !== 1)) throw new Error('Parameter series needs the same recorded parameter and unit for every result. Edit dataset metadata first.');
  const ordered = mode === 'parameter' ? [...datasets].sort((a, b) => (a.metadata.condition?.value ?? Infinity) - (b.metadata.condition?.value ?? Infinity)) : datasets;
  let panels: FigurePanel[];
  if (mode === 'band-dos') {
    const bands = ordered.filter((dataset) => dataset.data.kind === 'band');
    const dos = ordered.filter((dataset) => dataset.data.kind === 'dos');
    const used = new Set<string>();
    if (!bands.length || bands.length !== dos.length || bands.length * 2 !== ordered.length) throw new Error('Select an equal number of Band and DOS results.');
    panels = bands.flatMap((band, index) => {
      const companion = dos.find((dataset) => !used.has(dataset.id) && !pairingReason(band, dataset));
      if (!companion) throw new Error(`No verified DOS match for ${band.name}. Use a comparison grid or choose its matching run.`);
      used.add(companion.id);
      const group = newResearchId();
      return [band, companion].map((dataset) => ({ ...newPanel([{ ...newLayer(dataset, index), energyVertical: true }], dataset.name), span: dataset.data.kind === 'band' ? 2 : 1, energyGroup: group, pairingGroup: group }));
    });
  } else if (mode === 'overlay' || mode === 'single') panels = [newPanel((mode === 'single' ? ordered.slice(0, 1) : ordered).map(newLayer))];
  else panels = ordered.map((dataset, index) => newPanel([newLayer(dataset, index)], mode === 'parameter' ? `${dataset.name} / ${dataset.metadata.condition!.value} ${dataset.metadata.condition!.unit}` : dataset.name));
  const columns = mode === 'single' || mode === 'overlay' ? 1 : mode === 'band-dos' ? 3 : 2;
  return autoSizeFigure({ sizeMode: 'auto', schemaVersion: 1, id: newResearchId(), projectId, name, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), widthMm: columns === 1 ? 100 : 180, heightMm: Math.max(80, Math.ceil(panels.reduce((count, panel) => count + panel.span, 0) / columns) * 75), columns, panels, fontPt: 9, lineWidthPt: 0.7, fontFamily: 'sans', showGrid: false, panelLabels: panels.length > 1, caption: '' });
}

function sourcePlotWindow(value: unknown): [number, number] | null {
  return Array.isArray(value) && value.length === 2 && value.every(finite) && value[1] > value[0]
    ? [value[0], value[1]]
    : null;
}

export function sourceScientificPlotSettings(dataset: ResearchDataset, saved?: ScientificPlotSettings): ScientificPlotSettings {
  const defaults = defaultScientificPlotSettings(dataset.data);
  if (saved) return mergeScientificPlotSettings(defaults, saved);
  const summary = dataset.metadata.provenance?.sourceSummary;
  const sourceSummary = summary && typeof summary === 'object' ? summary as Record<string, unknown> : {};
  const xWindow = sourcePlotWindow(sourceSummary.plotXWindow);
  const yWindow = sourcePlotWindow(sourceSummary.plotYWindow)
    ?? (dataset.data.kind === 'band' ? sourcePlotWindow(sourceSummary.plotEnergyWindowEv) : null);
  return mergeScientificPlotSettings(defaults, {
    ...(xWindow ? { xMin: xWindow[0], xMax: xWindow[1] } : {}),
    ...(yWindow ? { yMin: yWindow[0], yMax: yWindow[1] } : {}),
    // The result artifact marks the Fermi level in red. Keep that exact visual
    // convention when the same band result becomes an editable figure.
    ...(dataset.data.kind === 'band' && dataset.data.energyReference === 'fermi'
      ? { showYZero: false, yReference: 0 }
      : {}),
  });
}

function parameterTitle(dataset: ResearchDataset) {
  return dataset.metadata.condition ? `${dataset.name} / ${dataset.metadata.condition.value} ${dataset.metadata.condition.unit}` : dataset.name;
}

export function replacementPanelTitle(panel: FigurePanel, previous: ResearchDataset, next: ResearchDataset): string {
  if (panel.layers.length !== 1) return panel.title;
  if (panel.title === previous.name) return next.name;
  return panel.title === parameterTitle(previous) ? parameterTitle(next) : panel.title;
}

export function figureTemplate(figure: FigureDocument, datasets: ResearchDataset[]): FigureTemplate {
  const copy = structuredClone(figure) as FigureTemplate;
  copy.id = newResearchId(); copy.createdAt = copy.updatedAt = new Date().toISOString();
  const sources = [...new Set(figure.panels.flatMap((panel) => panel.layers.map((layer) => layer.datasetId)))];
  copy.slots = copy.panels.flatMap((panel) => panel.layers.map((layer) => {
    const dataset = datasets.find((item) => item.id === layer.datasetId);
    if (!dataset) throw new Error('A template source is missing.');
    const titleSource = panel.layers.length === 1 ? panel.title === dataset.name ? 'name' : panel.title === parameterTitle(dataset) ? 'condition' : undefined : undefined;
    const slot: FigureTemplate['slots'][number] = { panelId: panel.id, layerId: layer.id, kind: dataset.data.kind, quantityId: layer.quantityId, sourceIndex: sources.indexOf(dataset.id), ...(titleSource ? { titleSource } : {}) };
    if (titleSource) panel.title = '';
    layer.datasetId = '';
    layer.label = '';
    return slot;
  }));
  return copy;
}
export function templateSourceCount(template: FigureTemplate): number {
  return new Set(template.slots.map((slot, index) => slot.sourceIndex ?? index)).size;
}
export function instantiateTemplate(template: FigureTemplate, projectId: string, datasets: ResearchDataset[]): FigureDocument {
  validateFigure(template, true);
  if (datasets.length !== templateSourceCount(template)) throw new Error(`This template needs ${templateSourceCount(template)} datasets in panel order.`);
  const figure = structuredClone(template);
  figure.id = newResearchId(); figure.projectId = projectId; figure.name = `${template.name.slice(0, 195)} copy`; figure.archived = false; figure.createdAt = figure.updatedAt = new Date().toISOString();
  template.slots.forEach((slot, index) => {
    const dataset = datasets[slot.sourceIndex ?? index];
    if (!dataset) throw new Error('Template source slot is invalid.');
    if (dataset.data.kind !== slot.kind) throw new Error(`Slot ${index + 1} requires ${slot.kind}.`);
    const panel = figure.panels.find((item) => item.id === slot.panelId)!;
    if (slot.titleSource) panel.title = slot.titleSource === 'name' ? dataset.name : parameterTitle(dataset);
    panel.layers = panel.layers.map((layer) => layer.id === slot.layerId ? { ...layer, datasetId: dataset.id, label: dataset.name, quantityId: dataset.data.quantities.find((quantity) => quantity.id === slot.quantityId)?.id ?? dataset.data.quantities[0].id } : layer);
  });
  return figure;
}
export function replaceLayerDataset(layer: FigureLayer, previous: ResearchDataset, next: ResearchDataset): FigureLayer {
  if (previous.data.kind !== next.data.kind) throw new Error('Replacement must have the same scientific plot kind.');
  const quantity = next.data.quantities.find((item) => item.id === layer.quantityId);
  if (!quantity) throw new Error('Replacement does not have this quantity. Choose a different quantity first.');
  if (layer.seriesIds && layer.seriesIds.some((id) => !quantity.series.some((series) => series.id === id))) throw new Error('Replacement does not contain every selected channel. Select all channels first.');
  return { ...layer, datasetId: next.id, label: next.name, projectionIds: [] };
}

function energyShift(dataset: ResearchDataset, layer: FigureLayer): number {
  if (layer.energy === 'source') return 0;
  if (layer.energy === 'manual') {
    if (!finite(layer.shiftEv)) throw new Error('Manual energy shift must be finite.');
    return layer.shiftEv;
  }
  const reference = dataset.metadata.energy;
  if (reference.kind === 'unknown') throw new Error(`${dataset.name}: source energy zero is unknown. Record the reference before aligning.`);
  const originalZero = reference.kind === 'fermi' ? reference.fermiEv : 0;
  if (layer.energy === 'fermi' && reference.kind === 'fermi') return 0;
  const target = layer.energy === 'fermi' ? reference.fermiEv : layer.energy === 'vbm' ? reference.vbmEv : reference.vacuumEv;
  if (!finite(originalZero) || !finite(target)) throw new Error(`${dataset.name}: ${layer.energy.toUpperCase()} reference has not been recorded.`);
  return originalZero - target;
}

function pathSpans(dataset: ResearchDataset) {
  const path = dataset.metadata.path;
  if (!path?.tickIndices || !path.labels || !path.segments?.length) throw new Error('Normalized paths require recorded endpoints, labels and segments.');
  const spans = path.tickIndices.slice(0, -1).flatMap((start, index) => path.breakIndices?.includes(path.tickIndices![index + 1]) ? [] : [{ start, end: path.tickIndices![index + 1], labels: [path.labels![index], path.labels![index + 1]] }]);
  if (JSON.stringify(spans.map((span) => span.labels)) !== JSON.stringify(path.segments)) throw new Error('Recorded path segments do not match their source indices.');
  return spans;
}

function pathCoordinate(index: number, points: [number, number][], spans: ReturnType<typeof pathSpans>) {
  const segment = spans.findIndex((span) => index >= span.start && index <= span.end);
  if (segment < 0) throw new Error('A source sample is outside the recorded path segments.');
  const { start, end } = spans[segment];
  const startX = points[start]?.[0], endX = points[end]?.[0];
  if (!finite(startX) || !finite(endX) || endX <= startX) throw new Error('Path segment distances are invalid.');
  return segment + (points[index][0] - startX) / (endX - startX);
}

export function transformedLayer(dataset: ResearchDataset, layer: FigureLayer): ScientificPlotData {
  const data = structuredClone(dataset.data);
  const quantity = data.quantities.find((item) => item.id === layer.quantityId);
  if (!quantity) throw new Error(`${dataset.name}: quantity is unavailable.`);
  data.quantities = [quantity];
  const shift = energyShift(dataset, layer);
  let denominator = 1;
  if (layer.normalization !== 'source') {
    if (data.kind !== 'dos' || dataset.metadata.dosBasis !== 'cell') throw new Error('Normalization needs DOS with a recorded computational-cell basis.');
    const divisor = layer.normalization === 'atom' ? dataset.metadata.atomCount : layer.normalization === 'formula' ? dataset.metadata.formulaUnits : dataset.metadata.volumeAngstrom3;
    if (!finite(divisor) || divisor <= 0) throw new Error('The requested normalization factor is missing.');
    denominator = divisor;
    quantity.yLabel = `DOS (states/eV/${layer.normalization === 'volume' ? 'angstrom^3' : layer.normalization})`;
  }
  const path = dataset.metadata.path;
  const spans = layer.normalizedPath ? pathSpans(dataset) : [];
  const breakIndices = new Set(path?.breakIndices ?? []);
  if (path?.tickIndices && path.labels && ['band', 'phonon'].includes(data.kind)) {
    const points = quantity.series[0].points;
    const ticks = new Map<number, string>();
    path.tickIndices.forEach((index, position) => {
      const x = layer.normalizedPath ? pathCoordinate(index, points, spans) : points[index][0];
      if (finite(x)) ticks.set(x, ticks.has(x) ? `${ticks.get(x)}|${kPointSymbol(path.labels![position])}` : kPointSymbol(path.labels![position]));
    });
    data.xTicks = [...ticks].map(([value, label]) => ({ value, label }));
  }
  if (layer.projectionIds?.length) {
    if (!dataset.metadata.orbitalProjection || layer.projectionIds.some(id => !dataset.metadata.orbitalProjection!.channels.some(channel => channel.id === id))) throw new Error('Selected orbitals are absent from this dataset.');
    for (const series of quantity.series) {
      if (!series.projections || layer.projectionIds.some(id => !series.projections![id])) throw new Error('Matching band projection weights are unavailable.');
      series.weights = series.points.map((_, index) => layer.projectionIds!.reduce((sum, id) => sum + series.projections![id][index], 0));
      series.weightScale = 'absolute';
    }
  }
  quantity.series = quantity.series.filter((series) => !layer.seriesIds || layer.seriesIds.includes(series.id)).map((series) => {
    const points: [number, number][] = [];
    const weights: number[] = [];
    series.points.forEach(([rawX, rawY], index) => {
      let x = rawX, y = rawY;
      if (!finite(x) || !finite(y)) { points.push([NaN, NaN]); weights.push(0); return; }
      if (breakIndices.has(index)) { points.push([NaN, NaN]); weights.push(0); }
      if (data.kind === 'band') y += shift;
      if (data.kind === 'dos') {
        x += shift; y /= denominator;
        if (/dos_down|spin_down/i.test(series.id)) y = layer.mirrorSpin ? -Math.abs(y) : Math.abs(y);
      }
      if (layer.normalizedPath) {
        x = pathCoordinate(index, series.points, spans);
      }
      points.push(data.kind === 'dos' && layer.energyVertical ? [y, x] : [x, y]);
      weights.push(series.weights?.[index] ?? 0);
    });
    return { ...series, id: `${layer.id}:${series.id}`, legendGroup: data.kind === 'band' || data.kind === 'phonon' ? layer.id : undefined, label: quantity.series.length === 1 || ['band', 'phonon'].includes(data.kind) ? layer.label : `${layer.label} / ${series.label}`, points, ...(series.weights ? { weights } : {}) };
  });
  if (!quantity.series.length) throw new Error('Select at least one channel.');
  const energyLabel = layer.energy === 'manual' ? `Energy E(source) ${layer.shiftEv < 0 ? '-' : '+'} ${Math.abs(layer.shiftEv)} eV` : layer.energy === 'source' ? dataset.metadata.energy.kind === 'fermi' ? 'Energy E - EF (eV)' : 'Energy (source reference, eV)' : layer.energy === 'fermi' ? 'Energy E - EF (eV)' : `Energy E - ${layer.energy.toUpperCase()} (eV)`;
  if (data.kind === 'band') { quantity.yLabel = energyLabel; data.xLabel = layer.normalizedPath ? 'Normalized path segment' : data.xLabel; }
  if (data.kind === 'dos') {
    if (layer.energyVertical) { data.xLabel = quantity.yLabel; quantity.yLabel = energyLabel; }
    else data.xLabel = energyLabel;
  }
  // Disable single-result renderer's implicit Fermi decoration after transformations.
  data.energyReference = 'unknown';
  return data;
}

export function figureIssues(figure: FigureDocument, datasets: ResearchDataset[]): string[] {
  const issues: string[] = [];
  for (const panel of figure.panels) {
    const visible = panel.layers.filter((layer) => layer.visible);
    const sources = visible.map((layer) => datasets.find((dataset) => dataset.id === layer.datasetId));
    if (sources.some((source) => !source)) { issues.push(`${panel.title || 'Panel'}: source dataset missing.`); continue; }
    if (sources.some((source) => source!.metadata.energy.kind === 'unknown') && sources.some((source) => ['band', 'dos'].includes(source!.data.kind))) issues.push(`${panel.title || 'Panel'}: energy reference not recorded.`);
    if (visible.length > 1 && sources[0]?.data.kind === 'band') {
      const paths = sources.map((source, index) => visible[index].normalizedPath ? JSON.stringify(source!.metadata.path?.segments) : JSON.stringify(source!.metadata.path));
      if (paths.some((path) => !path)) issues.push(`${panel.title || 'Overlay'}: k-path compatibility is unknown; verify before interpreting.`);
      else if (new Set(paths).size > 1) issues.push(`${panel.title || 'Overlay'}: k-paths differ; use separate panels or a verified normalized path.`);
    }
  }
  return [...new Set(issues)];
}

function panelData(panel: FigurePanel, datasets: ResearchDataset[]) {
  const layers = panel.layers.filter((layer) => layer.visible);
  if (!layers.length) throw new Error('Add or show a dataset in every panel.');
  const transformed = layers.map((layer) => {
    const dataset = datasets.find((item) => item.id === layer.datasetId);
    if (!dataset) throw new Error('A source dataset is missing.');
    const data = transformedLayer(dataset, layer);
    if (layers.length === 1 && !['band', 'phonon'].includes(data.kind)) for (const series of data.quantities[0].series) series.label = series.label.replace(`${layer.label} / `, '');
    return data;
  });
  if (new Set(transformed.map((data) => `${data.kind}:${data.xLabel}:${data.quantities[0].yLabel}`)).size !== 1) throw new Error('Overlay requires matching quantities, axis units and energy conventions. Use a grid for different quantities.');
  const data = { ...transformed[0], quantities: [{ ...transformed[0].quantities[0], series: transformed.flatMap((entry) => entry.quantities[0].series) }] };
  return { data, layers };
}

export function renderFigure(figure: FigureDocument, datasets: ResearchDataset[]): string {
  validateFigure(figure);
  for (const group of new Set(figure.panels.map((panel) => panel.pairingGroup).filter(Boolean))) {
    const paired = figure.panels.filter((panel) => panel.pairingGroup === group).flatMap((panel) => panel.layers.filter((layer) => layer.visible));
    const sources = paired.map((layer) => datasets.find((dataset) => dataset.id === layer.datasetId));
    if (paired.length !== 2 || sources.some((source) => !source) || pairingReason(sources[0]!, sources[1]!)) throw new Error('Band + DOS sources no longer form a verified pair. Select matching runs or change these panels to a comparison.');
  }
  if (!finite(figure.widthMm) || !finite(figure.heightMm) || figure.widthMm < 50 || figure.widthMm > 500 || figure.heightMm < 50 || figure.heightMm > 700) throw new Error('Figure size must be 50-500 mm wide and 50-700 mm high.');
  if (!Number.isInteger(figure.columns) || figure.columns < 1 || figure.columns > 6 || !figure.panels.length || figure.panels.length > 64) throw new Error('Choose 1-6 columns and 1-64 panels.');
  if (!finite(figure.fontPt) || figure.fontPt < 5 || figure.fontPt > 24 || !finite(figure.lineWidthPt) || figure.lineWidthPt < 0.1 || figure.lineWidthPt > 4) throw new Error('Choose font 5-24 pt and line width 0.1-4 pt.');
  const scale = 4, width = figure.widthMm * scale, height = figure.heightMm * scale, gap = 14;
  const panels = figure.panels.filter((panel) => !panel.inset);
  const placed: Array<{ panel: FigurePanel; col: number; row: number; span: number }> = [];
  let col = 0, row = 0;
  for (const panel of panels) {
    const span = Math.max(1, Math.min(figure.columns, Math.round(panel.span)));
    if (col + span > figure.columns) { col = 0; row++; }
    placed.push({ panel, col, row, span });
    col += span; if (col >= figure.columns) { col = 0; row++; }
  }
  if (figure.rows !== undefined && (!Number.isInteger(figure.rows) || figure.rows < 1 || figure.rows > 64)) throw new Error('Choose 1–64 rows, or Auto.');
  const rows = Math.max(1, row + (col ? 1 : 0), figure.rows ?? 1);
  const cellW = (width - gap * (figure.columns + 1)) / figure.columns, cellH = (height - gap * (rows + 1)) / rows;
  if (cellW < 90 || cellH < 110) throw new Error('Panels are too small. Increase the figure size or use fewer rows/columns.');
  const compiled = new Map(figure.panels.map((panel) => [panel.id, panelData(panel, datasets)]));
  const groups = new Map<string, { min: number; max: number; signature: string }>();
  for (const panel of figure.panels) {
    if (!panel.energyGroup) continue;
    const { data, layers } = compiled.get(panel.id)!;
    if (!layers.every((layer) => layer.energyVertical) || !['band', 'dos'].includes(data.kind)) throw new Error('Linked energy axes require vertical band/DOS energy panels.');
    const group = groups.get(panel.energyGroup);
    const signature = data.quantities[0].yLabel;
    if (group && group.signature !== signature) throw new Error('Linked panels must use the same energy convention.');
    const values = data.quantities[0].series.flatMap((series) => series.points.map((point) => point[1])).filter(finite);
    let min = panel.yMin ?? values.reduce((bound, value) => Math.min(bound, value), Infinity), max = panel.yMax ?? values.reduce((bound, value) => Math.max(bound, value), -Infinity);
    if (group) { min = Math.min(min, group.min); max = Math.max(max, group.max); }
    groups.set(panel.energyGroup, { min, max, signature });
  }
  const rects = new Map<string, { x: number; y: number; w: number; h: number }>();
  placed.forEach(({ panel, row, col, span }) => rects.set(panel.id, { x: gap + col * (cellW + gap), y: gap + row * (cellH + gap), w: span * cellW + (span - 1) * gap, h: cellH }));
  for (const panel of figure.panels.filter((item) => item.inset)) {
    const inset = panel.inset!, parent = rects.get(inset.parentId);
    if (!parent || ![inset.x, inset.y, inset.width, inset.height].every(finite) || inset.x < 0 || inset.y < 0 || inset.width < 0.2 || inset.height < 0.2 || inset.x + inset.width > 1 || inset.y + inset.height > 1) throw new Error('Inset must fit within its parent panel.');
    rects.set(panel.id, { x: parent.x + parent.w * inset.x, y: parent.y + parent.h * inset.y, w: parent.w * inset.width, h: parent.h * inset.height });
  }
  const rowHeaders = new Map<number, number>();
  const views = [...panels, ...figure.panels.filter((item) => item.inset)].map((panel) => {
    const rect = rects.get(panel.id)!, { data, layers } = compiled.get(panel.id)!;
    const factor = Math.max(1, 480 / rect.w, 360 / rect.h);
    const settings = defaultScientificPlotSettings(data);
    const typography = panel.inset ? Math.max(5, figure.fontPt * .7) : figure.fontPt;
    const group = groups.get(panel.energyGroup);
    Object.assign(settings, { width: rect.w * factor, height: rect.h * factor, title: panel.title, xLabel: panel.xLabel ?? data.xLabel, yLabel: panel.yLabel ?? data.quantities[0].yLabel, fontFamily: figure.fontFamily, titleFontSize: typography * 1.411 * factor, labelFontSize: typography * 1.411 * factor, tickFontSize: typography * 1.2 * factor, lineWidth: figure.lineWidthPt * 1.411 * factor, showGrid: figure.showGrid, showLegend: panel.showLegend, xReference: panel.xReference ?? null, yReference: panel.yReference ?? null, referenceLabel: panel.referenceLabel ?? '', showXZero: panel.showXZero ?? false, showYZero: panel.showYZero ?? false, showFrame: panel.showFrame ?? true, xMin: panel.xMin, xMax: panel.xMax, yMin: group?.min ?? panel.yMin, yMax: group?.max ?? panel.yMax });
    for (const [seriesIndex, series] of data.quantities[0].series.entries()) {
      const layer = layers.find((item) => series.id.startsWith(`${item.id}:`))!;
      const sourceId = series.id.slice(layer.id.length + 1);
      const channel = layer.channelStyles?.[sourceId];
      const channels = data.kind !== 'band' && data.kind !== 'phonon' && layers.length === 1;
      settings.seriesStyles[series.id] = { ...settings.seriesStyles[series.id], visible: true, label: channel?.label || series.label, color: channel?.color || (channels && seriesIndex ? FIGURE_COLORS[seriesIndex % FIGURE_COLORS.length] : layer.color), lineStyle: channel?.lineStyle || (/dos_down|spin_down/.test(sourceId) ? 'dash' : layer.lineStyle), lineWidth: null, marker: 'none', markerSize: 4 };
    }
    if (panel.inset) { settings.xLabel = ''; settings.yLabel = ''; }
    const header = scientificPanelHeader(data, settings) / factor;
    if (!panel.inset) rowHeaders.set(rect.y, Math.max(rowHeaders.get(rect.y) ?? 0, header));
    return { panel, rect, data, settings, factor, header };
  });
  const rendered = views.map(({ panel, rect, data, settings, factor, header }, index) => {
    const margins = { top: (panel.inset ? header : rowHeaders.get(rect.y)!) * factor, bottom: settings.labelFontSize * (panel.inset ? 1.8 : 3.2), left: settings.labelFontSize * (panel.inset ? 2.5 : 3.8), right: settings.labelFontSize * 1.5 };
    const nested = renderScientificPlotPanelSvg(data, settings, margins).replace(/id="([^"]+)"/g, `id="${panel.id}-$1"`).replace(/url\(#([^)]+)\)/g, `url(#${panel.id}-$1)`);
    const content = nested.replace(/ vector-effect="non-scaling-stroke"/g, '').replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
    return `<svg data-panel-id="${xml(panel.id)}" x="${rect.x}" y="${rect.y}" width="${rect.w}" height="${rect.h}" viewBox="0 0 ${Math.round(settings.width)} ${Math.round(settings.height)}">${content}</svg>${figure.panelLabels && !panel.inset ? `<text x="${rect.x + 3}" y="${rect.y + 12}" font-size="${figure.fontPt * 1.411}" font-family="${{ sans: 'DejaVu Sans', serif: 'DejaVu Serif', mono: 'DejaVu Sans Mono' }[figure.fontFamily]}">(${String.fromCharCode(97 + index)})</text>` : ''}`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${figure.widthMm}mm" height="${figure.heightMm}mm" viewBox="0 0 ${width} ${height}" role="img" aria-label="${xml(figure.name)}"><title>${xml(figure.name)}</title><desc>${xml([figure.caption, ...figureIssues(figure, datasets)].join('\n'))}</desc><rect width="100%" height="100%" fill="white"/>${rendered}</svg>`;
}

export function migratePlotSettings(figure: FigureDocument, settings: ScientificPlotSettings): FigureDocument {
  const copy = structuredClone(figure);
  const panel = copy.panels[0];
  const layer = panel?.layers[0];
  copy.name = settings.title || copy.name;
  if (panel) copy.panels[0] = {
    ...panel,
    title: settings.title,
    xLabel: settings.xLabel,
    yLabel: settings.yLabel,
    xMin: settings.xMin,
    xMax: settings.xMax,
    yMin: settings.yMin,
    yMax: settings.yMax,
    xReference: settings.xReference,
    yReference: settings.yReference,
    referenceLabel: settings.referenceLabel,
    showXZero: settings.showXZero,
    showYZero: settings.showYZero,
    showFrame: settings.showFrame,
    showLegend: settings.showLegend,
    layers: panel.layers.map((candidate, index) => {
      if (index !== 0) return candidate;
      const styles = Object.entries(settings.seriesStyles);
      const visible = styles.filter(([, style]) => style.visible).map(([id]) => id);
      const first = styles.find(([, style]) => style.visible)?.[1] ?? styles[0]?.[1];
      const monochromeChannels = candidate.energyVertical;
      return {
        ...candidate,
        quantityId: settings.quantityId,
        color: plotSeriesColor(settings, 0, first?.color),
        lineStyle: first?.lineStyle ?? candidate.lineStyle,
        seriesIds: visible.length === styles.length ? null : visible,
        channelStyles: Object.fromEntries(styles.map(([id, style], index) => [id, {
          // Band/phonon curves inherit the result-level style unless a channel
          // was explicitly customized. This keeps the global color/line controls
          // useful after importing a result with dozens of bands.
          ...(monochromeChannels
            ? { ...(style.color ? { color: style.color } : {}), ...(style.lineStyle !== first?.lineStyle ? { lineStyle: style.lineStyle } : {}) }
            : { color: plotSeriesColor(settings, index, style.color), lineStyle: style.lineStyle }),
          label: style.label,
        }])),
      };
    }),
  };
  if (layer) copy.lineWidthPt = Math.max(0.1, Math.min(4, settings.lineWidth / 1.411));
  copy.showGrid = settings.showGrid;
  copy.fontFamily = settings.fontFamily;
  copy.resultStyleVersion = 1;
  return copy;
}

export function scientificPlotSettingsFromFigure(figure: FigureDocument, dataset: ResearchDataset, previous?: ScientificPlotSettings): ScientificPlotSettings | null {
  if (figure.panels.length !== 1 || figure.panels[0].layers.length !== 1) return null;
  const panel = figure.panels[0];
  const layer = panel.layers[0];
  const sourceOrientation = dataset.data.kind === 'band' || dataset.data.kind === 'phonon';
  if (layer.datasetId !== dataset.id || layer.energy !== 'source' || layer.normalization !== 'source' || layer.normalizedPath || layer.energyVertical !== sourceOrientation) return null;
  const settings = sourceScientificPlotSettings(dataset, previous);
  const quantity = dataset.data.quantities.find((candidate) => candidate.id === layer.quantityId) ?? dataset.data.quantities[0];
  const visible = layer.seriesIds ? new Set(layer.seriesIds) : null;
  settings.title = panel.title;
  settings.xLabel = panel.xLabel ?? dataset.data.xLabel;
  settings.yLabel = panel.yLabel ?? quantity.yLabel;
  settings.quantityId = quantity.id;
  settings.xMin = panel.xMin;
  settings.xMax = panel.xMax;
  settings.yMin = panel.yMin;
  settings.yMax = panel.yMax;
  settings.xReference = panel.xReference ?? null;
  settings.yReference = panel.yReference ?? null;
  settings.referenceLabel = panel.referenceLabel ?? '';
  settings.showXZero = panel.showXZero ?? false;
  settings.showYZero = panel.showYZero ?? false;
  settings.showFrame = panel.showFrame ?? true;
  settings.showLegend = panel.showLegend;
  settings.showGrid = figure.showGrid;
  settings.fontFamily = figure.fontFamily;
  settings.lineWidth = Math.max(0.1, figure.lineWidthPt * 1.411);
  settings.titleFontSize = Math.max(8, figure.fontPt * 1.411);
  settings.labelFontSize = Math.max(8, figure.fontPt * 1.411);
  settings.tickFontSize = Math.max(7, figure.fontPt * 1.2);
  settings.height = Math.max(360, Math.min(6000, Math.round(settings.width * figure.heightMm / figure.widthMm)));
  settings.seriesStyles = {
    ...settings.seriesStyles,
    ...Object.fromEntries(quantity.series.map((series) => {
      const channel = layer.channelStyles?.[series.id];
      return [series.id, {
        ...settings.seriesStyles[series.id],
        visible: !visible || visible.has(series.id),
        label: channel?.label || series.label,
        color: channel?.color ?? layer.color,
        lineStyle: channel?.lineStyle ?? layer.lineStyle,
      }];
    })),
  };
  return settings;
}

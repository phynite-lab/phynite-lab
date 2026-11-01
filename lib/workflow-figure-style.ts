import { newPanel, validateFigure, type FigureTemplate, type FigureLayer } from './research-figures.ts';

/** Presentation-only slots contain no dataset or scientific values. Never render this template as a result. */
export function workflowFigureStyleTemplate(raw?: unknown): FigureTemplate {
  const styles = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  if (styles.panels !== undefined && (!Array.isArray(styles.panels) || styles.panels.length < 1 || styles.panels.length > 64)) throw new Error('Figure style needs 1–64 panels.');
  const panels = ((styles.panels as Array<Record<string, unknown>> | undefined) ?? [{}]).map(panel => {
    if (!panel || typeof panel !== 'object' || Array.isArray(panel) || panel.layers !== undefined && (!Array.isArray(panel.layers) || !panel.layers.length || panel.layers.length > 32)) throw new Error('Figure panel style is invalid.');
    const layers: FigureLayer[] = ((panel.layers as unknown[] | undefined) ?? [{}]).map(() => ({ id: crypto.randomUUID(), datasetId: '', quantityId: '', label: '', color: '#0072b2', lineStyle: 'solid', visible: true, energy: 'source', shiftEv: 0, normalization: 'source', mirrorSpin: true, normalizedPath: false, seriesIds: null, energyVertical: false }));
    return newPanel(layers);
  });
  const base: FigureTemplate = { schemaVersion: 1, id: crypto.randomUUID(), projectId: 'presentation', name: 'Presentation template', createdAt: '', updatedAt: '', widthMm: 100, heightMm: 80, columns: 1, panels, fontPt: 9, lineWidthPt: 0.7, fontFamily: 'sans', sizeMode: 'auto', showGrid: false, panelLabels: false, caption: '', slots: panels.flatMap(panel => panel.layers.map(layer => ({ panelId: panel.id, layerId: layer.id, kind: 'generic' as const, quantityId: '' }))) };
  const styled = { ...applyWorkflowFigureStyle(base, styles), slots: base.slots };
  validateFigure(styled, true);
  return styled;
}

/** Bindings and run identity never travel with a Figure's presentation. */
export function workflowFigureStyle(figure: import('./research-figures').FigureDocument): Record<string, unknown> {
  const { widthMm, heightMm, sizeMode, columns, fontPt, lineWidthPt, fontFamily, showGrid, panelLabels, caption } = figure;
  return { widthMm, heightMm, sizeMode, columns, fontPt, lineWidthPt, fontFamily, showGrid, panelLabels, caption, panels: figure.panels.map(panel => ({ ...panel, id: undefined, energyGroup: undefined, pairingGroup: undefined, layers: panel.layers.map(layer => ({ ...layer, id: undefined, datasetId: undefined, quantityId: undefined })) })) };
}
export function applyWorkflowFigureStyle(figure: import('./research-figures').FigureDocument, raw: unknown): import('./research-figures').FigureDocument {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return figure;
  const style = raw as Record<string, unknown>;
  const globals = Object.fromEntries(['widthMm', 'heightMm', 'sizeMode', 'columns', 'fontPt', 'lineWidthPt', 'fontFamily', 'showGrid', 'panelLabels', 'caption'].filter(key => style[key] !== undefined).map(key => [key, style[key]]));
  return { ...figure, ...globals, panels: figure.panels.map((panel, index) => {
    const saved = (style.panels as Array<Record<string, unknown>> | undefined)?.[index];
    if (!saved) return panel;
    const settings = Object.fromEntries(Object.entries(saved).filter(([key]) => !['id', 'layers', 'pairingGroup', 'energyGroup'].includes(key)));
    return { ...panel, ...settings, layers: panel.layers.map((layer, layerIndex) => { const savedLayer = (saved.layers as Array<Record<string, unknown>> | undefined)?.[layerIndex]; return { ...layer, ...Object.fromEntries(Object.entries(savedLayer ?? {}).filter(([key]) => !['id', 'datasetId', 'quantityId'].includes(key))) }; }) };
  }) };
}

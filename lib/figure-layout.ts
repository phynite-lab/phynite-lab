export type FigureUnit = 'mm' | 'cm' | 'in' | 'px' | 'pt';
import type { FigureDocument } from './research-figures.ts';

export function removeFigurePanel(figure: FigureDocument, panelId: string): FigureDocument {
  const removed = figure.panels.find((panel) => panel.id === panelId);
  if (!removed) return figure;
  const panels = figure.panels.filter((panel) => panel.id !== panelId && panel.inset?.parentId !== panelId)
    .map((panel) => removed.pairingGroup && panel.pairingGroup === removed.pairingGroup ? { ...panel, pairingGroup: undefined } : panel);
  if (!panels.some((panel) => !panel.inset)) return figure;
  if (removed.inset) return { ...figure, panels };
  const oldRows = Math.max(figure.rows ?? 1, requiredFigureRows(figure.panels, figure.columns));
  const columns = Math.min(figure.columns, panels.filter((panel) => !panel.inset).reduce((count, panel) => count + Math.min(figure.columns, panel.span), 0));
  const rows = requiredFigureRows(panels, columns);
  return autoSizeFigure({ ...figure, panels, columns, rows: undefined,
    widthMm: Math.max(50, Math.min(500, figure.widthMm * (columns + 1) / (figure.columns + 1))),
    heightMm: Math.max(50, Math.min(700, figure.heightMm * rows / oldRows)),
  });
}
export function millimetersPerUnit(unit: FigureUnit, dpi = 600): number {
  return unit === 'cm' ? 10 : unit === 'in' ? 25.4 : unit === 'pt' ? 25.4 / 72 : unit === 'px' ? 25.4 / dpi : 1;
}
export function requiredFigureRows(panels: Array<{ span: number; inset?: unknown }>, columns: number): number {
  let row = 0, col = 0;
  for (const panel of panels.filter((item) => !item.inset)) {
    const span = Math.max(1, Math.min(columns, Math.round(panel.span)));
    if (col + span > columns) { row++; col = 0; }
    col += span;
    if (col >= columns) { row++; col = 0; }
  }
  return Math.max(1, row + (col ? 1 : 0));
}

/** Nature figure guide: 89 / 183 mm columns, maximum 170 mm height.
 * https://research-figure-guide.nature.com/figures/building-and-exporting-figure-panels/
 * Height is a layout heuristic, not a universal journal requirement.
 */
export function autoSizeFigure(figure: FigureDocument): FigureDocument {
  if (figure.sizeMode !== 'auto') return figure;
  const rows = Math.max(figure.rows ?? 1, requiredFigureRows(figure.panels, figure.columns));
  const widthMm = figure.columns === 1 ? 89 : 183;
  const panelWidth = widthMm / figure.columns;
  const heightMm = Math.min(170, Math.max(80, Math.round(rows * (panelWidth * 0.65 + 12))));
  return { ...figure, widthMm, heightMm };
}

import type { ProjectWorkflow } from './project-workflow.ts';

export const WORKFLOW_GRID = 24;
export type CanvasPoint = { x: number; y: number };
export type CanvasMeasurements = Record<string, { width: number; height: number }>;
export type CanvasGuide = { axis: 'x' | 'y'; position: number };
export type CanvasAlignment = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom' | 'horizontal' | 'vertical';

export function canvasSelection(graph: ProjectWorkflow, ids: string[]): string[] {
  const selected = new Set(ids);
  for (const group of graph.groups) if (selected.has(group.id)) for (const id of group.nodeIds) selected.add(id);
  return graph.nodes.filter(node => selected.has(node.id)).map(node => node.id);
}

export function canvasBounds(graph: ProjectWorkflow, ids: string[], sizes: CanvasMeasurements, positions: Record<string, CanvasPoint> = {}) {
  const selected = new Set(ids), nodes = graph.nodes.filter(node => selected.has(node.id));
  if (!nodes.length) return null;
  const rects = nodes.map(node => ({ ...(positions[node.id] ?? node.position), width: sizes[node.id]?.width ?? 230, height: sizes[node.id]?.height ?? 120 }));
  const x = Math.min(...rects.map(rect => rect.x)), y = Math.min(...rects.map(rect => rect.y));
  return { x, y, width: Math.max(...rects.map(rect => rect.x + rect.width)) - x, height: Math.max(...rects.map(rect => rect.y + rect.height)) - y };
}

/** One translation keeps a multi-selection rigid; guides use a screen-pixel tolerance. */
export function snapCanvasPositions(graph: ProjectWorkflow, ids: string[], positions: Record<string, CanvasPoint>, sizes: CanvasMeasurements, zoom: number, settings: { grid: boolean; guides: boolean }, bypass = false) {
  const selected = new Set(ids), bounds = canvasBounds(graph, ids, sizes, positions), guides: CanvasGuide[] = [];
  if (!bounds || bypass) return { positions, guides };
  const correction = { x: 0, y: 0 }, tolerance = 6 / Math.max(.1, zoom);
  for (const axis of ['x', 'y'] as const) {
    const length = axis === 'x' ? 'width' : 'height';
    const own = [bounds[axis], bounds[axis] + bounds[length] / 2, bounds[axis] + bounds[length]];
    let best: { delta: number; position: number } | undefined;
    if (settings.guides) for (const node of graph.nodes) {
      if (selected.has(node.id)) continue;
      const size = sizes[node.id]?.[length] ?? (axis === 'x' ? 230 : 120);
      for (const target of [node.position[axis], node.position[axis] + size / 2, node.position[axis] + size]) for (const point of own) {
        const delta = target - point;
        if (Math.abs(delta) <= tolerance && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, position: target };
      }
    }
    correction[axis] = best ? best.delta : settings.grid ? Math.round(bounds[axis] / WORKFLOW_GRID) * WORKFLOW_GRID - bounds[axis] : 0;
    if (best) guides.push({ axis, position: best.position });
  }
  return { positions: Object.fromEntries(ids.map(id => { const point = positions[id] ?? graph.nodes.find(node => node.id === id)!.position; return [id, { x: point.x + correction.x, y: point.y + correction.y }]; })), guides };
}

/** Selected groups are alignment units; their members keep their relative positions. */
export function alignCanvasSelection(graph: ProjectWorkflow, selected: string[], sizes: CanvasMeasurements, alignment: CanvasAlignment): ProjectWorkflow {
  const grouped = new Set<string>();
  const units: string[][] = graph.groups.filter(group => selected.includes(group.id)).map(group => { group.nodeIds.forEach(id => grouped.add(id)); return group.nodeIds; });
  units.push(...canvasSelection(graph, selected).filter(id => !grouped.has(id)).map(id => [id]));
  const rectangles = units.map(ids => ({ ids, bounds: canvasBounds(graph, ids, sizes)! })).filter(unit => unit.bounds);
  const distribute = alignment === 'horizontal' || alignment === 'vertical';
  if (rectangles.length < (distribute ? 3 : 2)) return graph;
  const vertical = ['top', 'middle', 'bottom', 'vertical'].includes(alignment), axis = vertical ? 'y' : 'x', length = vertical ? 'height' : 'width';
  const start = Math.min(...rectangles.map(unit => unit.bounds[axis])), end = Math.max(...rectangles.map(unit => unit.bounds[axis] + unit.bounds[length]));
  const positions: Record<string, CanvasPoint> = {};
  if (distribute) rectangles.sort((a, b) => a.bounds[axis] - b.bounds[axis] || a.ids[0].localeCompare(b.ids[0]));
  const gap = (end - start - rectangles.reduce((sum, unit) => sum + unit.bounds[length], 0)) / (rectangles.length - 1);
  let cursor = start;
  for (const { ids, bounds } of rectangles) {
    const target = distribute ? cursor : ['left', 'top'].includes(alignment) ? start : ['center', 'middle'].includes(alignment) ? (start + end - bounds[length]) / 2 : end - bounds[length];
    const delta = target - bounds[axis];
    for (const node of graph.nodes.filter(node => ids.includes(node.id))) positions[node.id] = { ...node.position, [axis]: node.position[axis] + delta };
    cursor += bounds[length] + gap;
  }
  return { ...graph, nodes: graph.nodes.map(node => positions[node.id] ? { ...node, position: positions[node.id] } : node) };
}

type PanelExtent = { width: number; height: number };
type PanelPoint = { x: number; y: number };

const nonnegative = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0;

/** Built CSS may normalize 180ms to .18s; Web Animations always uses milliseconds. */
export function workflowPanelMotionDuration(value: string): number {
  const time = /^\s*(\d+(?:\.\d+)?|\.\d+)(ms|s)\s*$/.exec(value);
  return time ? Number(time[1]) * (time[2] === 's' ? 1000 : 1) : 180;
}

/** Resolve parent-local bounds once, with optional near-edge docking on release. */
export function workflowFloatingPanelPosition(position: PanelPoint, panel: PanelExtent, container: PanelExtent, options: { inset?: number; snapDistance?: number } = {}) {
  const inset = nonnegative(options.inset ?? 0), snapDistance = nonnegative(options.snapDistance ?? 0);
  const width = nonnegative(container.width), height = nonnegative(container.height);
  const panelWidth = nonnegative(panel.width), panelHeight = nonnegative(panel.height);
  const axis = (value: number, available: number) => {
    const gutter = Math.min(inset, available / 2), start = gutter, end = available - gutter;
    const clamped = Math.max(start, Math.min(end, Number.isFinite(value) ? value : start));
    const fromStart = clamped - start, fromEnd = end - clamped;
    // A short available range may put both edges in reach. Pick the closer one
    // consistently rather than allowing the second edge to overwrite the first.
    if (Math.min(fromStart, fromEnd) <= snapDistance) return fromStart <= fromEnd ? start : end;
    return clamped;
  };
  const x = axis(position.x, Math.max(0, width - panelWidth));
  const y = axis(position.y, Math.max(0, height - panelHeight));
  return { x, y, bottom: Math.max(0, height - panelHeight - y) };
}

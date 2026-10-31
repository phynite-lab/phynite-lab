/** Split ratios apply to content only, excluding the divider and stacked header. */
export function workflowPaneGeometry(width: number, height: number, axis: 'horizontal' | 'vertical', ratio: number) {
  const minimum = axis === 'vertical' ? 240 : 360;
  const extent = Math.max(0, (axis === 'vertical' ? height - 44 : width) - 1);
  const available = extent >= minimum * 2;
  const primary = available ? Math.max(minimum, Math.min(extent - minimum, extent * ratio)) : extent;
  return { minimum, extent, available, primary };
}

/** Keep a usable pane while dragging; continuing past its limit arms full view. */
export function workflowPaneDrag(geometry: ReturnType<typeof workflowPaneGeometry>, position: number) {
  const { minimum, extent } = geometry;
  const primary = Math.max(minimum, Math.min(extent - minimum, position));
  const maximizePane: 0 | 1 | undefined = position <= minimum - 64 ? 1 : position >= extent - minimum + 64 ? 0 : undefined;
  return { primary, ratio: extent > 0 ? primary / extent : .5, maximizePane };
}

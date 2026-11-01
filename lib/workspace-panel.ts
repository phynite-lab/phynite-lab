export const RIGHT_PANEL_MIN_WIDTH = 320;
export const RIGHT_PANEL_DEFAULT_WIDTH = 420;
export const RIGHT_PANEL_HARD_MAX_WIDTH = 700;
export const MIN_CANVAS_WIDTH = 600;
export const LAPTOP_BREAKPOINT = 1400;

/**
 * Calculates the dynamic maximum width for the right properties/inspector panel.
 * - On laptops / narrow screens (<= 1400px), returns 420px to protect 3D canvas space.
 * - On wider screens (> 1400px, e.g. Full HD, 2K, Ultrawide), dynamically scales up to 700px,
 *   while guaranteeing at least 600px width for the center 3D viewport canvas.
 */
export function getDynamicRightPanelMaxWidth(sidebarWidth = 232, containerWidth?: number): number {
  if (containerWidth !== undefined) return Math.min(RIGHT_PANEL_HARD_MAX_WIDTH, Math.max(RIGHT_PANEL_MIN_WIDTH, containerWidth - sidebarWidth - MIN_CANVAS_WIDTH));
  if (typeof window === 'undefined') return RIGHT_PANEL_DEFAULT_WIDTH;
  if (window.innerWidth <= LAPTOP_BREAKPOINT) return RIGHT_PANEL_DEFAULT_WIDTH;
  const availableForRight = window.innerWidth - sidebarWidth - MIN_CANVAS_WIDTH;
  return Math.min(RIGHT_PANEL_HARD_MAX_WIDTH, Math.max(RIGHT_PANEL_DEFAULT_WIDTH, availableForRight));
}

/**
 * Clamps the right panel width between RIGHT_PANEL_MIN_WIDTH (320px) and the dynamic max width.
 */
export function clampRightPanelWidth(width: number, sidebarWidth = 232, containerWidth?: number): number {
  const maxWidth = getDynamicRightPanelMaxWidth(sidebarWidth, containerWidth);
  return Math.max(RIGHT_PANEL_MIN_WIDTH, Math.min(maxWidth, width));
}

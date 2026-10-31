export type AiOverlayRect = { left: number; right: number; top: number; bottom: number; width: number };
export type AiOverlayViewport = { left: number; right: number; top: number; bottom: number };
export type AiOverlayPlacement = { left: number; top: number; width: number; maxHeight: number; side: 'above' | 'below' | 'sheet' };

export function aiOverlayWidth(viewport: AiOverlayViewport, pane: AiOverlayRect): number {
  return Math.max(0, Math.min(400, pane.width - 24, viewport.right - viewport.left));
}

/** All coordinates are layout-viewport CSS pixels; viewport already includes safe gutters. */
export function placeAiOverlay({ viewport, pane, bounds, anchor, compact = false, headerBottom, align = 'start', rtl = false, contentHeight, minimumHeight }: {
  viewport: AiOverlayViewport; pane: AiOverlayRect; bounds: AiOverlayRect; anchor: AiOverlayRect;
  compact?: boolean; headerBottom?: number; align?: 'start' | 'end'; rtl?: boolean; contentHeight: number; minimumHeight: number;
}): AiOverlayPlacement {
  const width = aiOverlayWidth(viewport, pane), availableHeight = Math.max(0, viewport.bottom - viewport.top);
  const desired = Math.min(560, Math.max(0, contentHeight));
  const top = Math.max(viewport.top, bounds.top + 8, headerBottom === undefined ? -Infinity : headerBottom + 6);
  const bottom = Math.min(viewport.bottom, bounds.bottom - 8);
  const upperEdge = (compact ? Math.min(pane.top, anchor.top) : anchor.top) - 8;
  const lowerEdge = (compact ? Math.max(pane.bottom, anchor.bottom) : anchor.bottom) + 8;
  // An offscreen anchor cannot offer usable anchored space (for example behind
  // a tablet keyboard). Use a sheet instead of placing content past the viewport.
  const above = upperEdge >= top && upperEdge <= bottom ? upperEdge - top : 0;
  const below = lowerEdge >= top && lowerEdge <= bottom ? bottom - lowerEdge : 0;
  const usable = Math.min(desired, Math.max(0, minimumHeight));
  const side = viewport.right - viewport.left < 480 || Math.max(above, below) < usable ? 'sheet'
    : above >= desired ? 'above' : below >= desired ? 'below' : above >= below ? 'above' : 'below';
  if (side === 'sheet') {
    const height = Math.min(desired, availableHeight);
    const sheetWidth = viewport.right - viewport.left < 480 ? Math.max(0, Math.min(400, viewport.right - viewport.left)) : width;
    return { left: viewport.left + (viewport.right - viewport.left - sheetWidth) / 2, top: viewport.bottom - height, width: sheetWidth, maxHeight: height, side };
  }
  const fromRight = (align === 'end') !== rtl;
  const idealLeft = fromRight ? anchor.right - width : anchor.left;
  const paneLeft = Math.max(viewport.left, pane.left + 12), paneRight = Math.min(viewport.right, pane.right - 12);
  const left = Math.max(viewport.left, Math.min(Math.max(paneLeft, idealLeft), paneRight - width, viewport.right - width));
  const maxHeight = Math.min(560, side === 'above' ? above : below);
  return { left, top: side === 'above' ? upperEdge - Math.min(desired, maxHeight) : lowerEdge, width, maxHeight, side };
}

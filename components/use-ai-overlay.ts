'use client';

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { aiOverlayWidth, placeAiOverlay, type AiOverlayViewport } from '@/lib/ai-overlay-placement';

/** Body portals retain the owning workspace theme, including local panel tokens. */
export function aiOverlayTheme(owner: HTMLElement): CSSProperties {
  const computed = getComputedStyle(owner), theme: Record<string, string> = { colorScheme: computed.colorScheme };
  for (const token of ['--canvas', '--surface', '--raised', '--surface-subtle', '--ink', '--muted-ink', '--line', '--line-strong', '--panel-bg', '--panel-raised', '--panel-border', '--panel-text', '--panel-muted', '--font-ui', '--font-code', '--text-label', '--text-caption', '--leading-ui', '--ai-focus']) {
    const value = computed.getPropertyValue(token); if (value) theme[token] = value;
  }
  return theme as CSSProperties;
}
export function aiOverlayViewport(insets = { top: 0, right: 0, bottom: 0, left: 0 }): AiOverlayViewport {
  const viewport = window.visualViewport, left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
  return { left: left + Math.max(12, insets.left), top: top + Math.max(12, insets.top), right: left + (viewport?.width ?? innerWidth) - Math.max(12, insets.right), bottom: top + (viewport?.height ?? innerHeight) - Math.max(12, insets.bottom) };
}

/** Measures width before natural content height. Track passive motion only while mounted/open. */
export function useAiOverlayPosition({ open = true, anchorRef, rootRef, align = 'start', keepComposerVisible = false }: {
  open?: boolean; anchorRef: RefObject<HTMLElement | null>; rootRef: RefObject<HTMLElement | null>; align?: 'start' | 'end'; keepComposerVisible?: boolean;
}) {
  const [placement, setPlacement] = useState<{ style: CSSProperties; sheet: boolean }>({ style: { visibility: 'hidden' }, sheet: false });
  useLayoutEffect(() => {
    const anchor = anchorRef.current, root = rootRef.current;
    const pane = anchor?.closest<HTMLElement>('.workflow-ai-editor') ?? anchor?.closest<HTMLElement>('.ai-workspace');
    if (!open || !anchor || !root || !pane) return;
    const composer = anchor.closest('.ai-composer-box'), panes = pane.closest('.workflow-panes');
    const probe = document.createElement('span');
    probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
    probe.setAttribute('aria-hidden', 'true'); document.body.appendChild(probe);
    let frame = 0, lastGeometry = '', previous = '';
    const place = () => {
      if (!anchor.isConnected || !root.isConnected) return;
      const safe = getComputedStyle(probe), viewport = aiOverlayViewport({ top: parseFloat(safe.paddingTop) || 0, right: parseFloat(safe.paddingRight) || 0, bottom: parseFloat(safe.paddingBottom) || 0, left: parseFloat(safe.paddingLeft) || 0 });
      if (keepComposerVisible && composer) viewport.bottom = Math.max(viewport.top, Math.min(viewport.bottom, composer.getBoundingClientRect().top - 8));
      const box = pane.getBoundingClientRect(), button = anchor.getBoundingClientRect(), compact = pane.dataset.presentation === 'composer';
      const anchorBox = keepComposerVisible && composer ? { left: button.left, right: button.right, width: button.width, top: composer.getBoundingClientRect().top, bottom: composer.getBoundingClientRect().top } : button;
      const bounds = (compact ? panes : pane)?.getBoundingClientRect() ?? box;
      const width = viewport.right - viewport.left < 480 ? Math.min(400, viewport.right - viewport.left) : aiOverlayWidth(viewport, box);
      if (root.style.width !== `${width}px`) root.style.width = `${width}px`;
      const scroll = root.querySelector<HTMLElement>('[data-ai-overlay-scroll]');
      const chrome = scroll ? root.offsetHeight - scroll.offsetHeight : root.offsetHeight;
      const contentHeight = scroll ? chrome + scroll.scrollHeight : root.scrollHeight;
      const row = scroll?.querySelector<HTMLElement>('button:not(:disabled)');
      let result = placeAiOverlay({ viewport, pane: box, bounds, anchor: anchorBox, compact, headerBottom: pane.dataset.presentation === 'floating' ? pane.querySelector('.ai-panel-header')?.getBoundingClientRect().bottom : undefined, align, rtl: getComputedStyle(anchor).direction === 'rtl', contentHeight, minimumHeight: chrome + (row?.offsetHeight ?? 40) });
      if (result.width !== width) {
        root.style.width = `${result.width}px`;
        const adjustedChrome = scroll ? root.offsetHeight - scroll.offsetHeight : root.offsetHeight;
        result = placeAiOverlay({ viewport, pane: box, bounds, anchor: anchorBox, compact, headerBottom: pane.dataset.presentation === 'floating' ? pane.querySelector('.ai-panel-header')?.getBoundingClientRect().bottom : undefined, align, rtl: getComputedStyle(anchor).direction === 'rtl', contentHeight: scroll ? adjustedChrome + scroll.scrollHeight : root.scrollHeight, minimumHeight: adjustedChrome + (row?.offsetHeight ?? 40) });
      }
      const next = { sheet: result.side === 'sheet', style: { ...aiOverlayTheme(anchor), position: 'fixed', margin: 0, left: result.left, top: result.top, bottom: 'auto', width: result.width, maxHeight: result.maxHeight, visibility: 'visible' } as CSSProperties };
      const signature = JSON.stringify(next);
      if (signature !== previous) { previous = signature; setPlacement(next); }
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(place); };
    const observer = new ResizeObserver(schedule);
    for (const element of [pane, anchor, root, composer, panes, root.querySelector('[data-ai-overlay-scroll]')]) if (element) observer.observe(element);
    const content = new MutationObserver(schedule); content.observe(root, { childList: true, characterData: true, subtree: true });
    const theme = new MutationObserver(schedule); theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-workspace-theme', 'data-site-theme', 'class'] });
    // Layout shifts and WAAPI transforms do not necessarily resize any observed element.
    let tracking = 0;
    const track = () => {
      const geometry = JSON.stringify([pane.getBoundingClientRect().toJSON(), anchor.getBoundingClientRect().toJSON(), pane.dataset.presentation]);
      if (geometry !== lastGeometry) { lastGeometry = geometry; place(); }
      tracking = requestAnimationFrame(track);
    };
    place(); tracking = requestAnimationFrame(track);
    window.addEventListener('resize', schedule); window.addEventListener('scroll', schedule, true); window.visualViewport?.addEventListener('resize', schedule); window.visualViewport?.addEventListener('scroll', schedule);
    return () => { cancelAnimationFrame(frame); cancelAnimationFrame(tracking); observer.disconnect(); content.disconnect(); theme.disconnect(); probe.remove(); window.removeEventListener('resize', schedule); window.removeEventListener('scroll', schedule, true); window.visualViewport?.removeEventListener('resize', schedule); window.visualViewport?.removeEventListener('scroll', schedule); };
  }, [open, anchorRef, rootRef, align, keepComposerVisible]);
  return placement;
}

/** Only the Model sheet is modal; command suggestions keep the composer reachable. */
export function useAiOverlayModal(modal: boolean, rootRef: RefObject<HTMLElement | null>, layerRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = rootRef.current, layer = layerRef.current;
    if (!modal || !root || !layer) return;
    const previous = new Map<HTMLElement, boolean>();
    const block = () => { for (const child of document.body.children) if (child instanceof HTMLElement && child !== layer && !previous.has(child)) { previous.set(child, child.inert); child.inert = true; } };
    block(); const observer = new MutationObserver(block); observer.observe(document.body, { childList: true });
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const focusable = () => Array.from(root.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[href],[tabindex="0"]')).filter(item => item.tabIndex >= 0 && item.getClientRects().length > 0);
    const focus = (event: FocusEvent) => { if (!root.contains(event.target as Node)) (focusable()[0] ?? root).focus({ preventScroll: true }); };
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = focusable(), first = items[0], last = items.at(-1);
      if (!first || event.shiftKey && (document.activeElement === first || !root.contains(document.activeElement)) || !event.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) {
        event.preventDefault(); (event.shiftKey ? last ?? root : first ?? root).focus({ preventScroll: true });
      }
    };
    document.addEventListener('focusin', focus); document.addEventListener('keydown', key);
    return () => { observer.disconnect(); document.removeEventListener('focusin', focus); document.removeEventListener('keydown', key); for (const [element, inert] of previous) element.inert = inert; document.body.style.overflow = overflow; };
  }, [modal, rootRef, layerRef]);
}

export function useAiComposerOverlayOwner(instance: string, open: boolean, close: () => void) {
  const closeRef = useRef(close);
  useEffect(() => { closeRef.current = close; }, [close]);
  useEffect(() => {
    if (!open) return;
    const claim = (event: Event) => { if ((event as CustomEvent<string>).detail !== instance) closeRef.current(); };
    window.dispatchEvent(new CustomEvent('phynite:ai-composer-overlay', { detail: instance }));
    window.addEventListener('phynite:ai-composer-overlay', claim);
    return () => window.removeEventListener('phynite:ai-composer-overlay', claim);
  }, [instance, open]);
}

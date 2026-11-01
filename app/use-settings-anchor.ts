'use client';

import { useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

/** Fragment targets may appear only after authentication, a request, or workload selection. */
export function useSettingsAnchor(ready: boolean) {
  const pathname = usePathname(), search = useSearchParams().toString();
  useEffect(() => {
    if (!ready) return;
    let frame = 0, observer: MutationObserver | undefined, timeout = 0, generation = 0;
    const reveal = () => {
      const activeGeneration = ++generation;
      observer?.disconnect(); window.clearTimeout(timeout); cancelAnimationFrame(frame);
      const location = window.location.pathname + window.location.search + window.location.hash;
      let id: string;
      try { id = decodeURIComponent(window.location.hash.slice(1)); } catch { return; }
      if (!id) return;
      const find = () => {
        const element = document.getElementById(id);
        if (!element || !element.getClientRects().length) return false;
        frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => {
          if (activeGeneration !== generation || location !== window.location.pathname + window.location.search + window.location.hash
            || !element.isConnected || !element.getClientRects().length) return;
          element.scrollIntoView({ block: 'start', behavior: 'instant' });
          // Anchor navigation announces the section without selecting a control.
          // Some legacy/Billing sections are not normally focusable.
          if (!element.hasAttribute('tabindex')) element.tabIndex = -1;
          if (element.matches('section:not([role]),div:not([role])')) element.dataset.settingsAnchor = '';
          element.focus({ preventScroll: true });
        }); });
        observer?.disconnect(); return true;
      };
      if (!find()) {
        observer = new MutationObserver(() => { find(); });
        observer.observe(document.querySelector('.settings-content') ?? document.body, { childList: true, subtree: true });
        timeout = window.setTimeout(() => observer?.disconnect(), 5000);
      }
    };
    reveal();
    window.addEventListener('hashchange', reveal); window.addEventListener('popstate', reveal); window.addEventListener('phynite:settings-anchor', reveal);
    return () => { generation++; observer?.disconnect(); cancelAnimationFrame(frame); window.clearTimeout(timeout); window.removeEventListener('hashchange', reveal); window.removeEventListener('popstate', reveal); window.removeEventListener('phynite:settings-anchor', reveal); };
  }, [ready, pathname, search]);
}

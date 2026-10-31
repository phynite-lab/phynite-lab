'use client';

import { useEffect, useRef } from 'react';

// Authenticated pages render after the browser's initial fragment navigation.
export function useInitialAnchor(ready: boolean) {
  const handled = useRef(false);
  useEffect(() => {
    if (!ready || handled.current) return;
    const frame = requestAnimationFrame(() => {
      handled.current = true;
      let anchor = window.location.hash.slice(1);
      try { anchor = decodeURIComponent(anchor); } catch { return; }
      if (anchor) document.getElementById(anchor)?.scrollIntoView({ block: 'start' });
    });
    return () => cancelAnimationFrame(frame);
  }, [ready]);
}

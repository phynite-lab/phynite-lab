'use client';

import { useEffect, useRef } from 'react';

export function useWorkspaceSaveShortcut(onSave: () => void | Promise<void>, enabled = true) {
  const saveRef = useRef(onSave);

  useEffect(() => {
    saveRef.current = onSave;
  }, [onSave]);

  useEffect(() => {
    const handleSave = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return;
      if (!enabled) return;
      event.preventDefault();
      event.stopPropagation();
      const active = document.activeElement;
      if (active instanceof HTMLElement) active.blur();
      window.setTimeout(() => void saveRef.current(), 0);
    };
    window.addEventListener('keydown', handleSave, { capture: true });
    return () => window.removeEventListener('keydown', handleSave, { capture: true });
  }, [enabled]);
}

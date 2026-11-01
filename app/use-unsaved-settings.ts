'use client';

import { useEffect } from 'react';
import { useLocale } from './locale-provider';
import { confirmUnsavedSettings } from '@/lib/settings-navigation';

export { confirmUnsavedSettings } from '@/lib/settings-navigation';
const checkedNavigationEvents = new WeakSet<Event>();

type HistoryNavigationEvent = Event & { navigationType?: string };

export function useUnsavedSettings(dirty: boolean) {
  const { t } = useLocale();
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    const navigate = (event: MouseEvent) => {
      if (event.defaultPrevented || checkedNavigationEvents.has(event)) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!link || link.target === '_blank' || link.download || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const destination = new URL(link.href, window.location.href);
      if (destination.origin === window.location.origin && destination.pathname === window.location.pathname && destination.search === window.location.search) return;
      checkedNavigationEvents.add(event);
      if (!confirmUnsavedSettings(t('Discard unsaved settings changes?', 'Abaikan perubahan pengaturan yang belum disimpan?'))) { event.preventDefault(); event.stopPropagation(); }
    };
    const navigation = (window as Window & { navigation?: EventTarget }).navigation;
    const traverse = (event: HistoryNavigationEvent) => {
      if (event.navigationType !== 'traverse' || !event.cancelable || event.defaultPrevented || checkedNavigationEvents.has(event)) return;
      checkedNavigationEvents.add(event);
      if (!confirmUnsavedSettings(t('Discard unsaved settings changes?', 'Abaikan perubahan pengaturan yang belum disimpan?'))) event.preventDefault();
    };
    window.addEventListener('beforeunload', unload);
    document.addEventListener('click', navigate, true);
    navigation?.addEventListener('navigate', traverse);
    return () => { window.removeEventListener('beforeunload', unload); document.removeEventListener('click', navigate, true); navigation?.removeEventListener('navigate', traverse); };
  }, [dirty, t]);
}

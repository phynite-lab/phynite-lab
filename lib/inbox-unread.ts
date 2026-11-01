type UnreadWatcherOptions = {
  load: () => Promise<{ hasUnread: boolean }>;
  onChange: (hasUnread: boolean) => void;
  events: EventTarget;
  visibility: EventTarget;
  isVisible: () => boolean;
};

/** Observe unread status without letting stale requests or failures clear it. */
export function watchInboxUnread({ load, onChange, events, visibility, isVisible }: UnreadWatcherOptions) {
  let disposed = false;
  let revision = 0;
  const refresh = async () => {
    const requestRevision = ++revision;
    try {
      const result = await load();
      if (!disposed && requestRevision === revision) onChange(result.hasUnread);
    } catch {
      // Keep the last known status until a successful refresh.
    }
  };
  const onUpdate = () => { void refresh(); };
  const onVisibility = () => { if (isVisible()) void refresh(); };
  events.addEventListener('phynite:inbox-updated', onUpdate);
  visibility.addEventListener('visibilitychange', onVisibility);
  void refresh();
  return () => {
    disposed = true;
    events.removeEventListener('phynite:inbox-updated', onUpdate);
    visibility.removeEventListener('visibilitychange', onVisibility);
  };
}

'use client';

import { useEffect, useState } from 'react';
import { phyniteInbox } from '@/lib/phynite-api';
import { watchInboxUnread } from '@/lib/inbox-unread';

export function useInboxUnread(accountId?: string) {
  const [status, setStatus] = useState<{ accountId: string; hasUnread: boolean } | null>(null);
  useEffect(() => {
    if (!accountId) return;
    return watchInboxUnread({
      load: () => phyniteInbox.list('', 1),
      onChange: hasUnread => setStatus({ accountId, hasUnread }),
      events: window,
      visibility: document,
      isVisible: () => document.visibilityState === 'visible',
    });
  }, [accountId]);
  return Boolean(status && status.accountId === accountId && status.hasUnread);
}

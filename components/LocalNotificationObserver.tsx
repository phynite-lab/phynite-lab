'use client';
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useLocale } from '@/app/locale-provider';
import { accountComputeUsageRequest } from '@/lib/account-api';
import { localRequest } from '@/lib/local-api';
import { finishedRuns, notificationRunPath, reconcileNotificationRuns, readLocalNotifications, type NotificationRun, type LocalNotificationPreferences } from '@/lib/local-notifications';
import { notificationForFailure } from '@/lib/research-notifications';

type Notice = { id: string; title: string; body: string };
export function LocalNotificationObserver({ owner }: { owner: string }) {
  const { t } = useLocale();
  const [notices, setNotices] = useState<Notice[]>([]);
  useEffect(() => {
    let active = true, pending = false;
    let previous: Map<string, NotificationRun> | null = null;
    let runtimeState: string | undefined;
    const notify = (category: keyof LocalNotificationPreferences, notice: Notice) => {
      const preferences = readLocalNotifications();
      if (!active || !preferences[category]) return;
      const key = `phynite:notification-seen:${owner}`;
      try {
        const seen: string[] = JSON.parse(localStorage.getItem(key) ?? '[]');
        if (seen.includes(notice.id)) return;
        localStorage.setItem(key, JSON.stringify([...seen, notice.id].slice(-256)));
      } catch { /* Updates still work without persistent browser storage. */ }
      setNotices(current => [...current, notice].slice(-3));
      if (preferences.desktop && document.visibilityState !== 'visible' && 'Notification' in window && Notification.permission === 'granted') {
        try { new Notification(notice.title, { body: notice.body, tag: notice.id }); } catch { /* The in-app notice remains available. */ }
      }
    };
    const poll = async () => {
      if (!active || pending) return;
      pending = true;
      const results = await Promise.allSettled([accountComputeUsageRequest(), localRequest<{ runtime?: { progress?: { state?: string; component?: string; error?: string } } }>('runtime')]);
      if (!active) return;
      if (results[0].status === 'fulfilled') {
        const usage = results[0].value;
        const next = await reconcileNotificationRuns(previous, [...(usage.activeRuns ?? []), ...usage.recentRuns], async run => {
          const response = await fetch(notificationRunPath(run), { cache: 'no-store', signal: AbortSignal.timeout(10000) });
          if (response.status === 404) return null;
          if (!response.ok) throw new Error('Job status is unavailable.');
          const body = await response.json() as { calculation?: { id?: string; status?: unknown; failureReason?: unknown; failureCategory?: unknown }; simulation?: { id?: string; status?: unknown; failureReason?: unknown; failureCategory?: unknown }; analysis?: { id?: string; status?: unknown; failureReason?: unknown; failureCategory?: unknown } }; const item = body.calculation ?? body.simulation ?? body.analysis;
          if (item?.id !== run.id || typeof item.status !== 'string') throw new Error('Invalid job status.');
          return { ...run, status: item.status, failureReason: typeof item.failureReason === 'string' ? item.failureReason : undefined, failureCategory: typeof item.failureCategory === 'string' ? item.failureCategory : undefined };
        });
        const oldStatuses = previous ? new Map([...previous.values()].map(run => [run.id, run.status])) : null;
        for (const run of finishedRuns(oldStatuses, [...next.values()])) {
          if (run.status.toUpperCase() === 'COMPLETED') { notify('jobFinished', { id: `job:${run.id}:${run.status}`, title: t('Calculation update', 'Pembaruan kalkulasi'), body: `${run.name} · ${run.status}` }); continue; }
          const research = notificationForFailure(run.id, run.failureCategory ?? 'unknown', run.failureReason ?? `${run.name} · ${run.status}`);
          notify('jobFailed', { id: research.id, title: t('Research run failed', 'Run riset gagal'), body: research.detail });
        }
        previous = next;
      }
      if (results[1].status === 'fulfilled') {
        const progress = results[1].value.runtime?.progress, next = progress?.state;
        if (runtimeState && runtimeState !== next && ['complete', 'failed'].includes(next ?? '')) notify('runtimeUpdates', { id: `runtime:${JSON.stringify(progress)}`, title: next === 'complete' ? t('Runtime installed', 'Runtime terpasang') : t('Runtime installation failed', 'Pemasangan runtime gagal'), body: progress?.error ?? progress?.component ?? 'Phynite Lab' });
        runtimeState = next;
      }
      pending = false;
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 10000);
    return () => { active = false; window.clearInterval(timer); };
  }, [owner, t]);
  if (!notices.length) return null;
  return <aside className="local-notification-stack" aria-label={t('Research updates', 'Pembaruan riset')} aria-live="polite">{notices.map(notice => <div key={notice.id}><span><strong>{notice.title}</strong><p>{notice.body}</p></span><button type="button" aria-label={t('Dismiss notification', 'Tutup notifikasi')} onClick={() => setNotices(current => current.filter(item => item.id !== notice.id))}><X size={16} /></button></div>)}</aside>;
}

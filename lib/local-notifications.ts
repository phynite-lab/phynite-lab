export const LOCAL_NOTIFICATIONS_KEY = 'phynite:local-notifications';
export const LOCAL_NOTIFICATIONS_EVENT = 'phynite:local-notifications-change';
export type LocalNotificationPreferences = { jobFinished: boolean; jobFailed: boolean; runtimeUpdates: boolean; desktop: boolean };
export const defaultLocalNotifications: LocalNotificationPreferences = { jobFinished: true, jobFailed: true, runtimeUpdates: true, desktop: false };
export function parseLocalNotifications(raw: string | null): LocalNotificationPreferences {
  try { const value = JSON.parse(raw ?? 'null'); return Object.fromEntries(Object.entries(defaultLocalNotifications).map(([key, fallback]) => [key, typeof value?.[key] === 'boolean' ? value[key] : fallback])) as LocalNotificationPreferences; }
  catch { return defaultLocalNotifications; }
}
let memory = JSON.stringify(defaultLocalNotifications);
export function localNotificationsSnapshot() { try { return window.localStorage.getItem(LOCAL_NOTIFICATIONS_KEY) ?? JSON.stringify(defaultLocalNotifications); } catch { return memory; } }
export function readLocalNotifications() { return parseLocalNotifications(localNotificationsSnapshot()); }
export function saveLocalNotifications(value: LocalNotificationPreferences) {
  memory = JSON.stringify(value);
  try { window.localStorage.setItem(LOCAL_NOTIFICATIONS_KEY, memory); } catch { /* Use these preferences for the current visit. */ }
  window.dispatchEvent(new Event(LOCAL_NOTIFICATIONS_EVENT));
}
export function subscribeLocalNotifications(listener: () => void) {
  const storage = (event: StorageEvent) => { if (event.key === LOCAL_NOTIFICATIONS_KEY || event.key === null) listener(); };
  window.addEventListener('storage', storage); window.addEventListener(LOCAL_NOTIFICATIONS_EVENT, listener);
  return () => { window.removeEventListener('storage', storage); window.removeEventListener(LOCAL_NOTIFICATIONS_EVENT, listener); };
}
export type NotificationRun = { id: string; name: string; status: string; calculationType?: string };
export function notificationRunPath(run: NotificationRun) {
  const kind = run.calculationType === 'LAMMPS simulation' ? 'md/simulations' : run.calculationType === 'OVITO analysis' ? 'md/analyses' : 'calculations';
  return `/api/phynite/v1/${kind}/${encodeURIComponent(run.id)}`;
}
/** Keep active jobs tracked even when they leave the limited recent-jobs window. */
export async function reconcileNotificationRuns(previous: Map<string, NotificationRun> | null, runs: NotificationRun[], readMissing: (run: NotificationRun) => Promise<NotificationRun | null>) {
  const next = new Map(runs.map(run => [run.id, run]));
  await Promise.all([...previous?.values() ?? []].filter(run => !next.has(run.id) && ['PREPARING', 'QUEUED', 'RUNNING', 'CANCEL_REQUESTED', 'FINALIZING'].includes(run.status.toUpperCase())).map(async run => {
    try { const resolved = await readMissing(run); if (resolved) next.set(run.id, resolved); }
    catch { next.set(run.id, run); }
  }));
  return next;
}
export function finishedRuns(previous: Map<string, string> | null, runs: NotificationRun[]) {
  if (!previous) return [];
  return runs.filter(run => ['COMPLETED', 'FAILED', 'CANCELLED', 'CANCELED'].includes(run.status.toUpperCase()) && previous.get(run.id) !== run.status && previous.has(run.id));
}

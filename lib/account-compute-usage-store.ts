import { accountComputeUsageRequest, type AccountComputeUsage, type AccountUsageRequestOptions } from './account-api.ts';

export type AccountComputeUsageSnapshot = { usage: AccountComputeUsage | null; loading: boolean; error: string; stale: boolean; updatedAt: number | null };
const empty = (): AccountComputeUsageSnapshot => ({ usage: null, loading: false, error: '', stale: false, updatedAt: null });
export const COMPUTE_USAGE_FOCUS_MAX_AGE_MS = 60_000;

/** Compute receipts have their own cache; refreshing them never measures storage. */
export class AccountComputeUsageStore {
  private snapshot = empty();
  private listeners = new Set<() => void>();
  private pending?: Promise<AccountComputeUsage>;
  private generation = 0;
  private invalidation = 0;
  private request: () => Promise<AccountComputeUsage>;
  private now: () => number;
  constructor(request: () => Promise<AccountComputeUsage>, now = Date.now) { this.request = request; this.now = now; }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(next: AccountComputeUsageSnapshot) { this.snapshot = next; this.listeners.forEach(listener => listener()); }
  setUsage = (usage: AccountComputeUsage) => { this.generation++; this.publish({ usage, loading: false, error: '', stale: false, updatedAt: this.now() }); };
  invalidate = () => { this.invalidation++; if (!this.snapshot.stale) this.publish({ ...this.snapshot, stale: true }); };
  clear = () => { this.generation++; this.pending = undefined; this.publish(empty()); };
  refresh = (): Promise<AccountComputeUsage> => {
    if (this.pending) return this.pending;
    const generation = this.generation;
    const invalidation = this.invalidation;
    this.publish({ ...this.snapshot, loading: true, error: '' });
    const pending = this.request().then(usage => {
      if (generation === this.generation) {
        this.generation++;
        this.publish({ usage, loading: false, error: '', stale: invalidation !== this.invalidation, updatedAt: this.now() });
      }
      return this.snapshot.usage ?? usage;
    }).catch(error => {
      if (generation === this.generation) this.publish({ ...this.snapshot, loading: false, stale: true, error: error instanceof Error ? error.message : 'Compute usage is unavailable.' });
      throw error;
    }).finally(() => { if (this.pending === pending) this.pending = undefined; });
    this.pending = pending;
    return pending;
  };
}

const stores = new Map<string, AccountComputeUsageStore>();
export function accountComputeUsageStore(owner: string, options: AccountUsageRequestOptions = {}) {
  const key = `${owner}\u0000${options.projectId ?? ''}`;
  let store = stores.get(key);
  if (!store) { store = new AccountComputeUsageStore(() => accountComputeUsageRequest(options)); stores.set(key, store); }
  return store;
}
export function clearAccountComputeUsageStores() { stores.forEach(store => store.clear()); }

/** Only enabled views use this subscription. No timer or storage inventory request. */
export function watchAccountComputeUsage(store: AccountComputeUsageStore, browserWindow: EventTarget, browserDocument: EventTarget & { visibilityState: string }, now = Date.now) {
  let active = true;
  const visible = () => browserDocument.visibilityState === 'visible';
  const refresh = () => {
    void store.refresh().then(() => {
      // A job change during a read needs one newer read after the single flight ends.
      if (active && visible() && store.getSnapshot().stale) refresh();
    }).catch(() => undefined);
  };
  const focus = () => {
    const { updatedAt } = store.getSnapshot();
    if (visible() && (updatedAt === null || now() - updatedAt > COMPUTE_USAGE_FOCUS_MAX_AGE_MS)) refresh();
  };
  const usageChanged = () => { store.invalidate(); if (visible()) refresh(); };
  browserWindow.addEventListener('phynite:usage-change', usageChanged);
  browserWindow.addEventListener('phynite:balance-change', usageChanged);
  browserWindow.addEventListener('focus', focus);
  browserDocument.addEventListener('visibilitychange', focus);
  refresh();
  return () => {
    active = false;
    browserWindow.removeEventListener('phynite:usage-change', usageChanged);
    browserWindow.removeEventListener('phynite:balance-change', usageChanged);
    browserWindow.removeEventListener('focus', focus);
    browserDocument.removeEventListener('visibilitychange', focus);
  };
}

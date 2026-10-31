import { accountUsageRequest, type AccountUsage, type AccountUsageRequestOptions } from './account-api.ts';
import { clearAccountComputeUsageStores } from './account-compute-usage-store.ts';

type Snapshot = { usage: AccountUsage | null; loading: boolean; error: string; stale: boolean };
const empty = (): Snapshot => ({ usage: null, loading: false, error: '', stale: false });

/** Inventory is expensive: subscribing and invalidating never start a scan. */
export class ResourceUsageStore {
  private snapshot = empty();
  private listeners = new Set<() => void>();
  private pending?: Promise<AccountUsage>;
  private generation = 0;
  private invalidation = 0;
  private request: () => Promise<AccountUsage>;
  constructor(request: () => Promise<AccountUsage>) { this.request = request; }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(next: Snapshot) { this.snapshot = next; this.listeners.forEach(listener => listener()); }
  setUsage = (usage: AccountUsage) => { this.generation++; this.publish({ usage, loading: false, error: '', stale: false }); };
  invalidate = () => { this.invalidation++; if (!this.snapshot.stale) this.publish({ ...this.snapshot, stale: true }); };
  clear = () => { this.generation++; this.pending = undefined; this.publish(empty()); };
  ensure = () => this.snapshot.usage ? Promise.resolve(this.snapshot.usage) : this.refresh();
  refresh = (): Promise<AccountUsage> => {
    if (this.pending) return this.pending;
    const generation = this.generation;
    const invalidation = this.invalidation;
    this.publish({ ...this.snapshot, loading: true, error: '' });
    const pending = this.request().then(usage => {
      if (generation === this.generation) {
        this.generation++;
        this.publish({ usage, loading: false, error: '', stale: invalidation !== this.invalidation });
      }
      return this.snapshot.usage ?? usage;
    }).catch(error => {
      if (generation === this.generation) this.publish({ ...this.snapshot, loading: false, stale: true, error: error instanceof Error ? error.message : 'Usage is unavailable.' });
      throw error;
    }).finally(() => { if (this.pending === pending) this.pending = undefined; });
    this.pending = pending;
    return pending;
  };
}

const stores = new Map<string, ResourceUsageStore>();
export function resourceUsageStore(owner: string, options: AccountUsageRequestOptions = {}) {
  const key = `${owner}\u0000${options.projectId ?? ''}`;
  let store = stores.get(key);
  if (!store) { store = new ResourceUsageStore(() => accountUsageRequest(options)); stores.set(key, store); }
  return store;
}
/** A storage purchase or job artifact can affect any cached project of this owner. */
export function invalidateResourceUsageStores(owner: string) {
  for (const [key, store] of stores) if (key.startsWith(`${owner}\u0000`)) store.invalidate();
}
export function clearResourceUsageStores() { stores.forEach(store => store.clear()); clearAccountComputeUsageStores(); }

export function measuredStorageCapacity(usage: AccountUsage | null, currentQuota?: number) {
  const storage = usage?.storage;
  const quota = currentQuota ?? storage?.cloudQuotaBytes ?? storage?.researchQuotaBytes;
  const free = storage?.complete && !storage.scope?.startsWith('project') && storage.uploadReservedBytes !== undefined && quota !== undefined
    ? Math.max(0, quota - storage.bytes - storage.uploadReservedBytes) : null;
  return { storage, quota, free };
}

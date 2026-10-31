import { accountRequest, parseQuantaBalance, type AccountResponse, type LabAccount } from './account-api.ts';
import { bindAccountSettingsToUser, hydrateAccountSettingsFromCloud } from './account-settings.ts';

type Snapshot = { account: LabAccount | null; profile: AccountResponse['profile']; loading: boolean; error: string; updatedAt: number | null };
/** One in-flight request per owner; never shares balances between signed-in users. */
export class ResourceAccountStore {
  private snapshot: Snapshot = { account: null, profile: null, loading: true, error: '', updatedAt: null };
  private listeners = new Set<() => void>();
  private pending?: Promise<AccountResponse>;
  private generation = 0;
  private request: () => Promise<AccountResponse>;
  private beforePublish?: (result: AccountResponse) => void;
  constructor(request: () => Promise<AccountResponse>, beforePublish?: (result: AccountResponse) => void) { this.request = request; this.beforePublish = beforePublish; }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(next: Snapshot) { this.snapshot = next; this.listeners.forEach(listener => listener()); }
  setAccount = (account: LabAccount, profile = this.snapshot.profile) => { this.generation++; this.publish({ account, profile, loading: false, error: '', updatedAt: Date.now() }); };
  setProfile = (profile: NonNullable<AccountResponse['profile']>) => {
    if (this.snapshot.account) this.beforePublish?.({ account: this.snapshot.account, profile });
    this.generation++;
    this.publish({ ...this.snapshot, profile });
  };
  clear = () => { this.generation++; this.pending = undefined; this.publish({ account: null, profile: null, loading: false, error: '', updatedAt: null }); };
  refresh = (): Promise<AccountResponse> => {
    if (this.pending) return this.pending;
    const generation = this.generation;
    if (!this.snapshot.account) this.publish({ ...this.snapshot, loading: true });
    const pending = this.request().then(result => {
      const account = { ...result.account, quanta: parseQuantaBalance(result.account.quanta) };
      if (generation === this.generation) {
        this.beforePublish?.(result);
        this.setAccount(account, result.profile);
      }
      return { ...result, account: this.snapshot.account ?? account };
    }).catch(error => {
      if (generation === this.generation) this.publish({ ...this.snapshot, loading: false, error: error instanceof Error ? error.message : 'Account is unavailable.' });
      throw error;
    }).finally(() => { if (this.pending === pending) this.pending = undefined; });
    this.pending = pending;
    return pending;
  };
}
const stores = new Map<string, ResourceAccountStore>();
export function resourceAccountStore(owner: string) {
  let store = stores.get(owner);
  if (!store) {
    store = new ResourceAccountStore(() => accountRequest<AccountResponse>(), result => {
      if (result.profile) hydrateAccountSettingsFromCloud(owner, result.profile);
      else bindAccountSettingsToUser(owner);
    });
    stores.set(owner, store);
  }
  return store;
}

export function clearResourceAccountStores() { stores.forEach(store => store.clear()); }

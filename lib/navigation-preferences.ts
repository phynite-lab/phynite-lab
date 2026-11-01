export const navigationFeatureIds = ['projects', 'dft', 'md', 'figures', 'inbox', 'computer'] as const;
// Read old preferences without losing project pins when a destination retires.
const legacyFeatureIds = [...navigationFeatureIds, 'storage'];
export type NavigationFeature = typeof navigationFeatureIds[number];
export type NavigationSection = 'home' | NavigationFeature | 'account' | 'billing' | 'ai' | 'profile';
export type NavigationPreferences = {
  version: 1;
  pinnedFeatureIds: NavigationFeature[];
  pinnedProjectKeys: string[];
  sidebarDocked: boolean;
};
export type NavigationAction =
  | { type: 'feature'; key: NavigationFeature; pinned: boolean }
  | { type: 'project'; key: string; pinned: boolean }
  | { type: 'dock'; docked: boolean };
export type NavigationEnvelope = { preferences: NavigationPreferences; revision: number };
export type NavigationSnapshot = NavigationEnvelope & { status: 'loading' | 'synced' | 'saving' | 'pending'; error: string };
export const defaultNavigationPreferences = (): NavigationPreferences => ({ version: 1, pinnedFeatureIds: ['dft', 'md', 'figures'], pinnedProjectKeys: [], sidebarDocked: true });
export const navigationProjectKey = (value: unknown): value is string => typeof value === 'string' && /^(dft|md):[A-Za-z0-9_-]{1,200}$/.test(value);

export function parseNavigationPreferences(value: unknown): NavigationPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid navigation preferences.');
  const raw = value as Record<string, unknown>;
  const features = raw.pinnedFeatureIds, projects = raw.pinnedProjectKeys;
  if (Object.keys(raw).sort().join() !== ['version', 'pinnedFeatureIds', 'pinnedProjectKeys', 'sidebarDocked'].sort().join()
    || raw.version !== 1 || typeof raw.sidebarDocked !== 'boolean'
    || !Array.isArray(features) || features.length > legacyFeatureIds.length
    || features.some(item => !legacyFeatureIds.includes(item)) || new Set(features).size !== features.length
    || !Array.isArray(projects) || projects.length > 256 || projects.some(item => !navigationProjectKey(item)) || new Set(projects).size !== projects.length
    || JSON.stringify(raw).length > 65536) throw new Error('Invalid navigation preferences.');
  return { version: 1, pinnedFeatureIds: features.filter(item => navigationFeatureIds.includes(item)), pinnedProjectKeys: [...projects], sidebarDocked: raw.sidebarDocked };
}

export function parseNavigationEnvelope(value: unknown): NavigationEnvelope {
  const raw = value as Partial<NavigationEnvelope> | null;
  if (!raw || !Number.isSafeInteger(raw.revision) || (raw.revision ?? -1) < 0) throw new Error('Invalid navigation revision.');
  return { preferences: parseNavigationPreferences(raw.preferences), revision: raw.revision! };
}

export function applyNavigationAction(preferences: NavigationPreferences, action: NavigationAction): NavigationPreferences {
  if (!action || typeof action !== 'object' || !['dock', 'feature', 'project'].includes(action.type)
    || (action.type === 'dock' ? typeof action.docked !== 'boolean' : typeof action.pinned !== 'boolean'
      || (action.type === 'feature' ? !navigationFeatureIds.includes(action.key) : !navigationProjectKey(action.key)))) throw new Error('Invalid navigation action.');
  return parseNavigationPreferences(replayNavigationAction(preferences, action));
}

/** Validated durable intents can temporarily exceed capacity after a device rebase. */
function replayNavigationAction(preferences: NavigationPreferences, action: NavigationAction): NavigationPreferences {
  if (action.type === 'dock') return { ...preferences, sidebarDocked: action.docked };
  const field = action.type === 'feature' ? 'pinnedFeatureIds' : 'pinnedProjectKeys';
  const keys: string[] = preferences[field];
  const next = action.pinned ? keys.includes(action.key) ? keys : [...keys, action.key] : keys.filter(key => key !== action.key);
  return { ...preferences, [field]: next };
}

export function researchShellRoute(pathname: string): boolean {
  return /^\/(workspace|projects|calculation|md|inbox|billing|account|profile|ai)(\/|$)/.test(pathname) || pathname === '/local';
}

/** These workspaces own contextual panels; direct destinations use their full page. */
export function hasContextualSidebar(section: NavigationSection): boolean {
  return ['projects', 'dft', 'md', 'figures', 'account', 'billing', 'ai'].includes(section);
}

export function navigationSection(pathname: string, search = ''): NavigationSection {
  const query = new URLSearchParams(search);
  if (pathname === '/ai') return 'ai';
  if (pathname === '/profile') return 'profile';
  if (pathname === '/workspace') return 'home';
  if (pathname.startsWith('/projects/')) return 'projects';
  if (pathname === '/calculation') return query.get('view') === 'figures' ? 'figures' : 'dft';
  if (pathname === '/account/computer') return 'computer';
  if (pathname.startsWith('/account') || pathname === '/local') return 'account';
  if (pathname.startsWith('/billing')) return 'billing';
  if (pathname.startsWith('/md')) return 'md';
  if (pathname.startsWith('/inbox')) return 'inbox';
  return 'home';
}

export class NavigationPreferenceError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}
export type NavigationTransport = {
  get: () => Promise<NavigationEnvelope>;
  put: (value: NavigationEnvelope) => Promise<NavigationEnvelope>;
};
export const navigationTransport: NavigationTransport = {
  get: () => navigationRequest('GET'),
  put: value => navigationRequest('PUT', { preferences: value.preferences, baseRevision: value.revision }),
};
async function navigationRequest(method: string, body?: unknown): Promise<NavigationEnvelope> {
  const result = await fetch('/api/phynite/v1/navigation-preferences', { method, cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!result.ok) throw new NavigationPreferenceError('Navigation preferences could not be synchronized.', result.status);
  return parseNavigationEnvelope(await result.json());
}

type PendingAction = { id: string; action: NavigationAction };
type CacheStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

/** One queued storage record per intent prevents another tab from replacing offline edits. */
export class NavigationPreferencesClient {
  readonly cacheKey: string;
  readonly pendingPrefix: string;
  private base: NavigationEnvelope = { preferences: defaultNavigationPreferences(), revision: 0 };
  private pending: PendingAction[] = [];
  private volatile = new Map<string, PendingAction>();
  private snapshot: NavigationSnapshot;
  private listeners = new Set<() => void>();
  private running: Promise<void> | null = null;
  private closed = false;
  private requested = false;
  private transport: NavigationTransport;
  private storage?: CacheStorage;
  constructor(owner: string, transport: NavigationTransport = navigationTransport, storage?: CacheStorage, namespace = 'v1') {
    this.transport = transport;
    this.storage = storage;
    this.cacheKey = `phynite:navigation:${namespace}:${owner}`;
    this.pendingPrefix = `${this.cacheKey}:pending:`;
    try {
      const cached = storage?.getItem(this.cacheKey);
      if (cached) this.base = parseNavigationEnvelope(JSON.parse(cached));
    } catch { /* Invalid device cache never replaces server state. */ }
    this.readPending();
    this.snapshot = { ...this.base, preferences: this.optimistic(), status: 'loading', error: '' };
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  dispose() { this.closed = true; this.listeners.clear(); }
  connect() { this.closed = false; }
  private readPending() {
    if (!this.storage) return;
    const items: PendingAction[] = [];
    try {
      for (let index = 0; index < this.storage.length; index++) {
        const key = this.storage.key(index);
        if (!key?.startsWith(this.pendingPrefix)) continue;
        try {
          const item = JSON.parse(this.storage.getItem(key) ?? '') as PendingAction;
          if (key !== `${this.pendingPrefix}${item.id}`) continue;
          applyNavigationAction(defaultNavigationPreferences(), item.action);
          items.push(item);
        } catch { /* Ignore malformed queued records. */ }
      }
      this.pending = [...items, ...this.volatile.values()].sort((a, b) => a.id.localeCompare(b.id));
    } catch { /* Retain memory intents if browser storage is unavailable. */ }
  }
  private optimistic() { return this.pending.reduce((prefs, item) => replayNavigationAction(prefs, item.action), this.base.preferences); }
  private publish(status: NavigationSnapshot['status'], error = '') {
    if (this.closed) return;
    this.snapshot = { ...this.base, preferences: this.optimistic(), status, error };
    this.listeners.forEach(listener => listener());
  }
  private accept(value: NavigationEnvelope) {
    this.base = parseNavigationEnvelope(value);
    try { this.storage?.setItem(this.cacheKey, JSON.stringify(this.base)); } catch { /* Cloud save remains authoritative. */ }
  }
  change(action: NavigationAction) {
    if (this.closed) return;
    applyNavigationAction(this.optimistic(), action);
    const item = { id: `${String(Date.now()).padStart(16, '0')}-${crypto.randomUUID()}`, action };
    this.pending.push(item);
    try {
      if (this.storage) this.storage.setItem(`${this.pendingPrefix}${item.id}`, JSON.stringify(item));
      else this.volatile.set(item.id, item);
    } catch { this.volatile.set(item.id, item); }
    this.publish('saving');
    void this.sync();
  }
  sync(): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.running) { this.requested = true; return this.running; }
    this.running = this.flush().finally(() => { this.running = null; });
    return this.running;
  }
  private async flush() {
    try {
      do {
        this.requested = false;
        const latest = await this.transport.get();
        if (this.closed) return;
        this.accept(latest);
        this.readPending();
        let conflicts = 0;
        while (this.pending.length) {
          this.publish('saving');
          const batch = [...this.pending];
          try {
            const saved = await this.transport.put({ preferences: parseNavigationPreferences(this.optimistic()), revision: this.base.revision });
            if (this.closed) return;
            this.accept(saved);
            for (const item of batch) {
              this.volatile.delete(item.id);
              try { this.storage?.removeItem(`${this.pendingPrefix}${item.id}`); } catch { /* Idempotent intent can retry on reopening. */ }
            }
            this.pending = this.pending.filter(item => !batch.some(done => done.id === item.id));
            this.readPending();
            conflicts = 0;
          } catch (error) {
            if (!(error instanceof NavigationPreferenceError) || error.status !== 409 || ++conflicts >= 3) throw error;
            const rebased = await this.transport.get();
            if (this.closed) return;
            this.accept(rebased);
            this.readPending();
          }
        }
        this.publish('synced');
      } while (this.requested && !this.closed);
    } catch {
      this.publish('pending', this.optimistic().pinnedProjectKeys.length > 256 ? 'Project pin limit reached. Unpin a project to synchronize.' : 'Preferences are saved on this device; synchronization is pending.');
    }
  }
}

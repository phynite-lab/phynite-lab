import { parseProjectWorkflow, stableWorkflowJson, type ProjectWorkflow, type WorkflowEnvelope } from './project-workflow.ts';
import { isWorkflowServiceUnavailable, WorkflowServiceUnavailableError } from './project-workflow-service.ts';

export type WorkflowCacheState = WorkflowEnvelope & { status: 'loading' | 'synced' | 'saving' | 'offline' | 'conflict' | 'unavailable'; error: string; localSaved?: boolean; remote?: WorkflowEnvelope; historyEpoch?: number };
type Transport = { get: () => Promise<WorkflowEnvelope>; save: (workflow: ProjectWorkflow, revision: number) => Promise<WorkflowEnvelope> };
type Cache = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
/** Scientific conflicts require an explicit choice. Late responses never replace a draft. */
export class ProjectWorkflowClient {
  readonly owner: string;
  readonly project: string;
  readonly key: string;
  private transport: Transport;
  private cache?: Cache;
  private state: WorkflowCacheState;
  private listeners = new Set<() => void>();
  private generation = 0;
  private refreshVersion = 0;
  private active = true;
  private serial: Promise<void> | null = null;
  private dirty = false;
  private remoteKnown = false;
  private editVersion = 0;
  private interacting = false;
  constructor(owner: string, project: string, transport: Transport, cache?: Cache) {
    this.owner = owner; this.project = project; this.transport = transport; this.cache = cache;
    this.key = `phynite:workflow:v1:${owner}:${project}`;
    this.state = { workflow: { version: 1, projectId: project, nodes: [], edges: [], groups: [] }, revision: 0, status: 'loading', error: '' };
    try {
      const raw = cache?.getItem(this.key);
      if (raw) {
        const saved = JSON.parse(raw), envelope = this.validate(saved);
        this.state = { ...this.state, ...envelope, localSaved: true }; this.dirty = saved.dirty === true;
        this.remoteKnown = saved.remoteKnown === true || envelope.revision > 0;
      }
    } catch { /* Invalid cache cannot become a server write. */ }
  }
  private validate(value: WorkflowEnvelope): WorkflowEnvelope {
    if (!value || !Number.isSafeInteger(value.revision) || value.revision < 0) throw new Error('Invalid workflow revision.');
    return { workflow: parseProjectWorkflow(value.workflow, this.project), revision: value.revision, migrated: value.migrated };
  }
  getSnapshot = () => this.state;
  subscribe = (callback: () => void) => { this.listeners.add(callback); return () => { this.listeners.delete(callback); }; };
  connect() { this.active = true; }
  dispose() { this.active = false; this.generation++; this.listeners.clear(); }
  private emit(patch: Partial<WorkflowCacheState>) {
    if (!this.active) return;
    this.state = { ...this.state, ...patch };
    try {
      this.cache?.setItem(this.key, JSON.stringify({ workflow: this.state.workflow, revision: this.state.revision, dirty: this.dirty, remoteKnown: this.remoteKnown }));
      this.state = { ...this.state, localSaved: Boolean(this.cache) };
    } catch { this.state = { ...this.state, localSaved: false, error: 'Device storage is unavailable. Keep this page open until your changes are saved.' }; }
    this.listeners.forEach(listener => listener());
  }
  change(workflow: ProjectWorkflow) {
    const valid = parseProjectWorkflow(workflow, this.project);
    this.dirty = true; this.editVersion++; this.refreshVersion++;
    this.emit({ workflow: valid, status: ['conflict', 'unavailable'].includes(this.state.status) ? this.state.status : 'saving' });
  }
  /** Our own atomic import is one undoable edit; unrelated in-flight edits stay a conflict. */
  applyImported(value: WorkflowEnvelope, baseRevision: number): boolean {
    const remote = this.validate(value);
    this.refreshVersion++;
    if (this.dirty || this.serial || this.state.revision !== baseRevision || remote.revision !== baseRevision + 1) {
      this.emit({ status: 'conflict', remote, error: 'The import was saved, but this draft changed while pasting. Compare both versions.' });
      return false;
    }
    this.remoteKnown = true;
    this.emit({ ...remote, status: 'synced', error: '', remote: undefined });
    return true;
  }
  reportUnavailable(error: unknown): boolean {
    if (!isWorkflowServiceUnavailable(error)) return false;
    this.emit({ status: 'unavailable', error: new WorkflowServiceUnavailableError().message });
    return true;
  }
  beginInteraction() { this.interacting = true; this.refreshVersion++; }
  endInteraction() { this.interacting = false; }
  async refresh() {
    if (this.interacting) return;
    const generation = this.generation, request = ++this.refreshVersion;
    // A GET started during PUT could return its previous revision.
    if (this.serial) await this.serial;
    if (!this.active || generation !== this.generation || request !== this.refreshVersion) return;
    const revision = this.state.revision;
    try {
      const remote = this.validate(await this.transport.get());
      if (!this.active || generation !== this.generation || request !== this.refreshVersion || revision !== this.state.revision) return;
      if (this.dirty) {
        // A backend's first revision may already contain migrated scientific inputs.
        // An unsynced device draft has never observed those inputs, even at revision zero.
        const unseenInputs = !this.remoteKnown && remote.workflow.nodes.length > 0 && stableWorkflowJson(remote.workflow) !== stableWorkflowJson(this.state.workflow);
        if (remote.revision !== revision || unseenInputs) { this.emit({ status: 'conflict', remote, error: 'Workflow changed on another device. Your draft is preserved.' }); return; }
        this.remoteKnown = true;
        this.emit({ status: 'saving', error: '' }); await this.flush();
      } else {
        this.remoteKnown = true;
        this.emit({ ...remote, status: 'synced', error: '', remote: undefined, historyEpoch: (this.state.historyEpoch ?? 0) + (remote.revision !== this.state.revision ? 1 : 0) });
      }
    } catch (error) {
      if (this.active && generation === this.generation && request === this.refreshVersion && !this.reportUnavailable(error)) this.emit({ status: 'offline', error: error instanceof Error ? error.message : 'Workflow is offline.' });
    }
  }
  flush(): Promise<void> {
    if (this.serial) return this.serial;
    if (!this.dirty) return Promise.resolve();
    const generation = this.generation;
    this.refreshVersion++;
    this.serial = (async () => {
      let reservationRetries = 0;
      while (this.active && generation === this.generation && this.dirty && !['conflict', 'unavailable'].includes(this.state.status)) {
        const version = this.editVersion, graph = this.state.workflow, revision = this.state.revision;
        try {
          const saved = this.validate(await this.transport.save(graph, revision));
          if (!this.active || generation !== this.generation) return;
          if (saved.revision !== revision + 1) throw new Error('Server returned an unexpected workflow revision. Retry synchronization.');
          this.remoteKnown = true;
          if (version === this.editVersion) this.dirty = false;
          reservationRetries = 0;
          this.emit({ revision: saved.revision, status: this.dirty ? 'saving' : 'synced', error: '' });
        } catch (error) {
          if (!this.active || generation !== this.generation) return;
          const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
          // Storage reservation contention does not change the workflow revision.
          // Retry only that explicit transient error, keeping the same serial queue.
          if (code === 'STORAGE_RESERVATION_BUSY' && reservationRetries < 3) {
            await new Promise(resolve => setTimeout(resolve, 100 * 2 ** reservationRetries++));
            continue;
          }
          if (error && typeof error === 'object' && 'status' in error && error.status === 409 && (code === undefined || code === 'WORKFLOW_CONFLICT')) {
            try {
              const remote = this.validate(await this.transport.get());
              if (!this.active || generation !== this.generation) return;
              this.emit({ status: 'conflict', remote, error: 'Workflow changed on another device. Compare both versions before saving.' });
            } catch (failure) {
              if (this.active && generation === this.generation && !this.reportUnavailable(failure)) this.emit({ status: 'offline', error: failure instanceof Error ? failure.message : 'Reconnect to compare workflow versions.' });
            }
          } else if (!this.reportUnavailable(error)) this.emit({ status: 'offline', error: error instanceof Error ? error.message : 'Workflow could not be saved.' });
          return;
        }
      }
    })().finally(() => { this.serial = null; });
    return this.serial;
  }
  async resolve(choice: 'local' | 'remote') {
    if (!this.state.remote) return;
    const remote = this.state.remote;
    this.remoteKnown = true;
    this.editVersion++; this.refreshVersion++;
    if (choice === 'remote') { this.dirty = false; this.emit({ ...remote, remote: undefined, status: 'synced', error: '', historyEpoch: (this.state.historyEpoch ?? 0) + 1 }); }
    else { this.dirty = true; this.emit({ revision: remote.revision, remote: undefined, status: 'saving', error: '' }); await this.flush(); }
  }
}

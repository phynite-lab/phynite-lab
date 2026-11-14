import type { NoteDraft } from './project-notes.ts';

export class NoteRecovery {
  private database?: Promise<IDBDatabase>;
  private factory: IDBFactory;
  constructor(factory: IDBFactory) { this.factory = factory; }
  private open() {
    return this.database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.factory.open('phynite-project-notes', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('drafts', { keyPath: 'key' });
      request.onerror = () => { this.database = undefined; reject(request.error ?? new Error('Browser recovery is unavailable.')); };
      request.onblocked = () => { this.database = undefined; reject(new Error('Close another old Phynite tab to open draft recovery.')); };
      request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); this.database = undefined; }; resolve(request.result); };
    });
  }
  async put(draft: NoteDraft): Promise<void> {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('drafts', 'readwrite'), store = tx.objectStore('drafts');
      const read = store.get(draft.key);
      read.onsuccess = () => {
        const previous = read.result as NoteDraft | undefined;
        if (previous && (previous.sequence > draft.sequence || previous.sequence === draft.sequence && (previous.text !== draft.text || previous.name !== draft.name || previous.baseRevision !== draft.baseRevision))) { tx.abort(); return; }
        store.put(draft);
      };
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('Browser recovery failed. Keep this editor open and export your draft.'));
    });
  }
  async get(key: string): Promise<NoteDraft | undefined> {
    const db = await this.open();
    return new Promise((resolve, reject) => { const read = db.transaction('drafts').objectStore('drafts').get(key); read.onsuccess = () => resolve(read.result); read.onerror = () => reject(read.error); });
  }
  async list(owner: string, projectId: string): Promise<NoteDraft[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const read = db.transaction('drafts').objectStore('drafts').getAll();
      read.onsuccess = () => resolve((read.result as NoteDraft[]).filter(d => d.owner === owner && d.projectId === projectId));
      read.onerror = () => reject(read.error);
    });
  }
}

export type NoteDraftStatus = { browserSequence: number; coreSequence: number; browserError?: string; coreError?: string };
/** Independent deadlines; serial core writes never publish an older sequence as the newest. */
export class NoteDraftSaver {
  private latest?: NoteDraft;
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private coreWrite?: Promise<void>;
  private disposed = false;
  private status: NoteDraftStatus = { browserSequence: 0, coreSequence: 0 };
  private recover: (draft: NoteDraft) => Promise<void>;
  private persist: (draft: NoteDraft) => Promise<void>;
  private change: (status: NoteDraftStatus) => void;
  constructor(recover: (draft: NoteDraft) => Promise<void>, persist: (draft: NoteDraft) => Promise<void>, change: (status: NoteDraftStatus) => void) { this.recover = recover; this.persist = persist; this.change = change; }
  update(draft: NoteDraft) {
    this.latest = draft;
    for (const [channel, idle, maximum] of [['browser', 500, 2000], ['core', 1000, 5000]] as const) {
      const flush = () => { for (const suffix of ['idle', 'max']) { clearTimeout(this.timers.get(channel + suffix)); this.timers.delete(channel + suffix); } void this.flush(channel); };
      clearTimeout(this.timers.get(channel + 'idle'));
      this.timers.set(channel + 'idle', setTimeout(flush, idle));
      if (!this.timers.has(channel + 'max')) this.timers.set(channel + 'max', setTimeout(flush, maximum));
    }
  }
  async flush(channel: 'browser' | 'core') {
    if (channel === 'core') {
      if (this.coreWrite) return this.coreWrite;
      const write = this.writeCore();
      this.coreWrite = write;
      try { await write; } finally { if (this.coreWrite === write) this.coreWrite = undefined; }
      return;
    }
    const draft = this.latest;
    if (!draft) return;
    try {
      await this.recover(draft);
      this.status = { ...this.status, browserSequence: Math.max(this.status.browserSequence, draft.sequence), browserError: undefined };
    } catch (error) { this.status = { ...this.status, browserError: error instanceof Error ? error.message : 'Draft save failed.' }; }
    finally { if (!this.disposed) this.change({ ...this.status }); }
  }
  private async writeCore() {
    let draft: NoteDraft | undefined;
    do {
      draft = this.latest;
      if (!draft) return;
      try {
        await this.persist(draft);
        this.status = { ...this.status, coreSequence: draft.sequence, coreError: undefined };
      } catch (error) { this.status = { ...this.status, coreError: error instanceof Error ? error.message : 'Draft save failed.' }; }
      finally { if (!this.disposed) this.change({ ...this.status }); }
    } while (this.latest !== draft && !this.status.coreError);
  }
  dispose() { this.disposed = true; for (const timer of this.timers.values()) clearTimeout(timer); this.timers.clear(); void this.flush('browser'); void this.flush('core'); }
}

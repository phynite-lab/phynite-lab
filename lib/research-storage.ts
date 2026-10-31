import { PhyniteApiError, phyniteApi } from './phynite-api.ts';
import { validateDataset, validateFigure, type FigureDocument, type FigureTemplate, type ResearchDataset } from './research-figures.ts';

export type ResearchCollection = 'datasets' | 'figures' | 'templates';
export type ResearchDocument = ResearchDataset | FigureDocument | FigureTemplate;
export type ResearchRecord<T extends ResearchDocument = ResearchDocument> = {
  key: string; owner: string; collection: ResearchCollection; document: T; localVersion: number; cloudRevision: number;
  status: 'local' | 'synced' | 'conflict'; message?: string;
  history: Array<{ savedAt: string; document: T; autosave?: boolean }>;
};
type StoredRecord = Omit<ResearchRecord, 'document' | 'history'> & { json: string; versions: Array<{ savedAt: string; json: string; autosave?: boolean }> };
let databasePromise: Promise<IDBDatabase> | undefined;

function database(): Promise<IDBDatabase> {
  if (!databasePromise) databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open('phynite-research-v1', 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('documents')) request.result.createObjectStore('documents', { keyPath: 'key' });
      if (!request.result.objectStoreNames.contains('drafts')) request.result.createObjectStore('drafts', { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { databasePromise = undefined; reject(new Error('Research storage is unavailable. Enable browser storage to save figures.')); };
  });
  return databasePromise;
}
function unpack(record: StoredRecord): ResearchRecord {
  const parse = (json: string) => record.collection === 'datasets' ? validateDataset(JSON.parse(json)) : validateFigure(JSON.parse(json), record.collection === 'templates');
  return { ...record, document: parse(record.json), history: record.versions.map((entry) => ({ savedAt: entry.savedAt, document: parse(entry.json), ...(entry.autosave ? { autosave: true } : {}) })) };
}
async function allLocal(owner: string): Promise<StoredRecord[]> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction('documents').objectStore('documents').getAll();
    request.onsuccess = () => resolve((request.result as StoredRecord[]).filter((entry) => entry.owner === owner));
    request.onerror = () => reject(request.error);
  });
}
async function readLocal(key: string): Promise<StoredRecord | undefined> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction('documents').objectStore('documents').get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function writeLocal(record: StoredRecord, expectedVersion?: number): Promise<void> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('documents', 'readwrite'), store = transaction.objectStore('documents');
    const read = store.get(record.key);
    let conflict = false;
    read.onsuccess = () => {
      const previous = read.result as StoredRecord | undefined;
      if (expectedVersion !== undefined && (previous?.localVersion ?? 0) !== expectedVersion) { conflict = true; transaction.abort(); return; }
      store.put(record);
    };
    transaction.oncomplete = () => { window.dispatchEvent(new Event('phynite:research-change')); resolve(); };
    transaction.onabort = () => reject(new Error(conflict ? 'This figure changed in another tab. Reload or save a copy.' : 'Research storage is full or unavailable. Download a source package before leaving.'));
    transaction.onerror = () => reject(transaction.error);
  });
}
export async function saveResearch<T extends ResearchDocument>(owner: string, collection: ResearchCollection, document: T, expectedVersion = 0, cloud = true, { autosave = false }: { autosave?: boolean } = {}): Promise<ResearchRecord<T>> {
  if (!owner) throw new Error('Sign in before saving research.');
  const key = `${owner}/${collection}/${document.id}`;
  const existing = await readLocal(key);
  const json = JSON.stringify(document);
  if (collection === 'datasets' && existing && existing.json !== json) throw new Error('Datasets are immutable. Save edited metadata as a new dataset revision.');
  if (collection === 'datasets') validateDataset(JSON.parse(json));
  else validateFigure(document, collection === 'templates');
  if (new TextEncoder().encode(json).length > 4_000_000) throw new Error('Split documents larger than 4 MB before saving.');
  const same = existing?.json === json;
  const promote = !autosave && existing?.versions.at(-1)?.autosave;
  const checkpoints = existing?.versions.filter((version) => !version.autosave) ?? [];
  if ((!same || promote) && !autosave && checkpoints.length >= 100) throw new Error('This document has 100 saved revisions. Duplicate it to continue while retaining its history.');
  const versions = same && !promote ? existing.versions : [...checkpoints, { savedAt: new Date().toISOString(), json, ...(autosave ? { autosave: true } : {}) }];
  const next: StoredRecord = { key, owner, collection, json, localVersion: same && !promote ? existing.localVersion : (existing?.localVersion ?? 0) + 1, cloudRevision: existing?.cloudRevision ?? 0, status: 'local', versions };
  await writeLocal(next, expectedVersion);
  if (cloud) {
    try {
      const saved = await phyniteApi<{ revision: number }>(`/v1/research/${collection}/${encodeURIComponent(document.id)}`, { method: 'PUT', body: { document, baseRevision: next.cloudRevision, ...(autosave ? { autosave: true } : {}) }, signal: AbortSignal.timeout(30000) });
      next.cloudRevision = saved.revision; next.status = 'synced';
    } catch (error) {
      const status = (error as { status?: number }).status;
      next.status = status === 409 ? 'conflict' : 'local';
      next.message = error instanceof Error ? error.message : 'Cloud save is unavailable.';
    }
    await writeLocal(next, next.localVersion);
  }
  return unpack(next) as ResearchRecord<T>;
}

export async function deleteResearchFigure(owner: string, id: string, cloud = true): Promise<void> {
  if (!owner || !id) throw new Error('Choose a figure to delete.');
  if (cloud) {
    try {
      await phyniteApi(`/v1/research/figures/${encodeURIComponent(id)}`, { method: 'DELETE', signal: AbortSignal.timeout(30000) });
    } catch (error) {
      if (error instanceof PhyniteApiError && error.status === 405) {
        throw new Error('The server needs an update before figures can be deleted. Your figure has not been removed. Please try again after the backend is updated.');
      }
      if (!(error instanceof PhyniteApiError && error.status === 404)) throw error;
    }
  }
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(['documents', 'drafts'], 'readwrite');
    transaction.objectStore('documents').delete(`${owner}/figures/${id}`);
    transaction.objectStore('drafts').delete(`${owner}/${id}`);
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(new Error('The figure could not be removed from this device.'));
    transaction.onerror = () => reject(transaction.error);
  });
  window.dispatchEvent(new Event('phynite:research-change'));
}

type FigureSaveResult = { record: ResearchRecord<FigureDocument>; sources: ResearchRecord<ResearchDataset>[] };
const figureSaves = new Map<string, Promise<FigureSaveResult>>();

export function saveFigureResearch(owner: string, figure: FigureDocument, datasets: ResearchDataset[], expectedVersion: number, cloud: boolean, autosave = true): Promise<FigureSaveResult> {
  const key = `${owner}/figures/${figure.id}`;
  const previous = figureSaves.get(key);
  const task = (async () => {
    // Serialize saves from this editor, including navigation while an upload is in flight.
    const preceding = await previous?.catch(() => undefined);
    const version = Math.max(expectedVersion, preceding?.record.localVersion ?? 0);
    const existing = await readLocal(key);
    if ((existing?.localVersion ?? 0) !== version) throw new Error('This figure changed in another tab. Reload or save a copy.');
    const sources: ResearchRecord<ResearchDataset>[] = [];
    let sync = cloud;
    let sourceError = '';
    for (const id of new Set(figure.panels.flatMap((panel) => panel.layers.map((layer) => layer.datasetId)))) {
      const source = await readLocal(`${owner}/datasets/${id}`);
      const dataset = datasets.find((item) => item.id === id);
      if (!dataset) throw new Error('A figure source is missing. Restore its dataset before saving.');
      if (source && source.json !== JSON.stringify(dataset)) throw new Error('Datasets are immutable. Save edited metadata as a new dataset revision.');
      const saved = source?.status === 'synced' ? unpack(source) as ResearchRecord<ResearchDataset> : await saveResearch(owner, 'datasets', dataset, source?.localVersion ?? 0, cloud);
      sources.push(saved);
      if (cloud && saved.status !== 'synced') { sync = false; sourceError = saved.message ?? 'Source data could not be synced.'; }
    }
    const record = await saveResearch(owner, 'figures', figure, version, sync, { autosave });
    if (sourceError) record.message = sourceError;
    return { record, sources };
  })();
  figureSaves.set(key, task);
  return task;
}
export async function loadResearch(owner: string, cloud = true): Promise<{ records: ResearchRecord[]; warning?: string }> {
  const local = await allLocal(owner);
  if (!cloud) return { records: local.map(unpack) };
  let warning: string | undefined;
  for (const collection of ['datasets', 'figures', 'templates'] as const) {
    let listed = false;
    try {
      const remote = await phyniteApi<{ items: Array<{ id: string; revision: number }> }>(`/v1/research/${collection}`, { signal: AbortSignal.timeout(30000) });
      listed = true;
      for (const metadata of remote.items) {
        const key = `${owner}/${collection}/${metadata.id}`, existing = local.find((record) => record.key === key);
        if (existing && (existing.status !== 'synced' || existing.cloudRevision >= metadata.revision)) continue;
        const loaded = await phyniteApi<{ document: ResearchDocument; revision: number }>(`/v1/research/${collection}/${encodeURIComponent(metadata.id)}`, { signal: AbortSignal.timeout(30000) });
        const json = JSON.stringify(loaded.document);
        const record: StoredRecord = { key, owner, collection, json, localVersion: (existing?.localVersion ?? 0) + 1, cloudRevision: loaded.revision, status: 'synced', versions: [...(existing?.versions.filter((entry) => !entry.autosave) ?? []), { savedAt: new Date().toISOString(), json, autosave: true }] };
        await writeLocal(record, existing?.localVersion ?? 0);
        if (existing) local.splice(local.indexOf(existing), 1, record); else local.push(record);
      }
    } catch (error) {
      if (!listed && error instanceof PhyniteApiError && error.status === 404) {
        warning = 'Cloud figure storage is not available on this server. Your figures remain saved on this device.';
        break;
      }
      warning = error instanceof Error ? error.message : 'Cloud is unavailable; locally saved research remains accessible.';
    }
  }
  return { records: local.map(unpack), warning };
}
export async function cloudFigureRevision(id: string, revision?: number): Promise<{ document: FigureDocument; revision: number; metadata: { history: Array<{ revision: number; savedAt: string; autosave?: boolean }> } }> {
  return phyniteApi(`/v1/research/figures/${encodeURIComponent(id)}${revision ? `?revision=${revision}` : ''}`);
}
export async function markResearchConflict(record: ResearchRecord): Promise<void> {
  const existing = await readLocal(record.key);
  if (!existing) return;
  await writeLocal({ ...existing, status: 'conflict', message: record.message }, record.localVersion);
}
export async function acceptCloudFigure(owner: string, id: string): Promise<ResearchRecord<FigureDocument>> {
  const loaded = await cloudFigureRevision(id);
  const key = `${owner}/figures/${id}`, existing = await readLocal(key);
  const json = JSON.stringify(loaded.document);
  // Preserve the unsynced document in local history before adopting the remote one.
  const record: StoredRecord = { key, owner, collection: 'figures', json, localVersion: (existing?.localVersion ?? 0) + 1, cloudRevision: loaded.revision, status: 'synced', versions: [...(existing?.versions ?? []), { savedAt: new Date().toISOString(), json }].slice(-100) };
  await writeLocal(record, existing?.localVersion ?? 0);
  return unpack(record) as ResearchRecord<FigureDocument>;
}

export async function saveFigureDraft(owner: string, figure: FigureDocument, { replace = false }: { replace?: boolean } = {}): Promise<void> {
  const draft = { key: `${owner}/${figure.id}`, owner, projectId: figure.projectId, json: JSON.stringify(figure) };
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('drafts', 'readwrite'), store = transaction.objectStore('drafts');
    const previous = store.get(draft.key);
    previous.onsuccess = () => {
      // A late autosave or navigation cleanup must not replace a newer draft.
      if (!replace && previous.result && Date.parse(JSON.parse(previous.result.json).updatedAt) > Date.parse(figure.updatedAt)) return;
      store.put(draft);
    };
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(new Error('Could not save the local figure draft.'));
    transaction.onerror = () => reject(new Error('Could not save the local figure draft.'));
  });
}
export async function loadFigureDrafts(owner: string, projectId: string): Promise<FigureDocument[]> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction('drafts').objectStore('drafts').getAll();
    request.onsuccess = () => resolve(request.result.filter((record: { owner: string; projectId: string }) => record.owner === owner && record.projectId === projectId).map((record: { json: string }) => JSON.parse(record.json)));
    request.onerror = () => reject(request.error);
  });
}

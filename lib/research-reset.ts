import { CALCULATION_WORKSPACE_STORAGE_KEY } from './workspace-storage.ts';

const RESET_VERSION = '2026-09-23-live-research-clear';
const RESET_KEY = 'phynite:research-reset-version';
const RESEARCH_KEYS = [
  CALCULATION_WORKSPACE_STORAGE_KEY,
  'phynite:calculation-workspace-owner:v1',
];
const RESEARCH_PREFIXES = [
  'phynite:md-frame-transfer:',
  'phynite:dft-to-md-transfer:',
  'phynite:md-last-active:',
  'phynite:plot-editor:',
];
let pendingReset: Promise<void> | null = null;

function clearDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onerror = () => reject(request.error ?? new Error(`Cannot open ${name} storage.`));
    request.onsuccess = () => {
      const database = request.result;
      const stores = Array.from(database.objectStoreNames);
      if (!stores.length) { database.close(); resolve(); return; }
      const transaction = database.transaction(stores, 'readwrite');
      stores.forEach(store => transaction.objectStore(store).clear());
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onabort = () => { database.close(); reject(transaction.error ?? new Error(`Cannot clear ${name} storage.`)); };
      transaction.onerror = () => { database.close(); reject(transaction.error ?? new Error(`Cannot clear ${name} storage.`)); };
    };
  });
}

export function ensureResearchReset(): Promise<void> {
  if (typeof window === 'undefined' || window.localStorage.getItem(RESET_KEY) === RESET_VERSION) return Promise.resolve();
  pendingReset ??= (async () => {
    const keys = Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index));
    keys.forEach(key => {
      if (key && (RESEARCH_KEYS.includes(key) || RESEARCH_PREFIXES.some(prefix => key.startsWith(prefix)))) window.localStorage.removeItem(key);
    });
    if ('indexedDB' in window) await Promise.all([clearDatabase('phynite-research-v1'), clearDatabase('phynite-md-studio')]);
    window.localStorage.setItem(RESET_KEY, RESET_VERSION);
  })().finally(() => { pendingReset = null; });
  return pendingReset;
}

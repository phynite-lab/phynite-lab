export type PollEnvironment = {
  active: () => boolean;
  subscribe: (refresh: () => void) => () => void;
  schedule: (task: () => void, delay: number) => unknown;
  cancel: (timer: unknown) => void;
};
export const browserEnvironment: PollEnvironment = {
  active: () => !document.hidden && navigator.onLine,
  subscribe: refresh => {
    document.addEventListener('visibilitychange', refresh);
    for (const event of ['online', 'offline', 'phynite:compute-target-change']) window.addEventListener(event, refresh);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      for (const event of ['online', 'offline', 'phynite:compute-target-change']) window.removeEventListener(event, refresh);
    };
  },
  schedule: (task, delay) => window.setTimeout(task, delay),
  cancel: timer => window.clearTimeout(timer as number),
};

/** Sequential GET polling only. Pause offline/hidden; back off errors to 60 s. */
export function startBrowserPoll(read: () => Promise<unknown>, interval: number, environment = browserEnvironment, immediate = true): () => void {
  let stopped = false;
  let running = false;
  let failures = 0;
  let timer: unknown;
  const clear = () => { if (timer !== undefined) environment.cancel(timer); timer = undefined; };
  const schedule = (delay: number) => { clear(); if (!stopped && environment.active()) timer = environment.schedule(run, delay); };
  const run = async () => {
    clear();
    if (stopped || running || !environment.active()) return;
    running = true;
    try { await read(); failures = 0; } catch { failures = Math.min(failures + 1, 5); }
    finally { running = false; schedule(Math.min(interval * 2 ** failures, 60_000)); }
  };
  const unsubscribe = environment.subscribe(() => { clear(); if (!running) schedule(0); });
  schedule(immediate ? 0 : interval);
  return () => { stopped = true; clear(); unsubscribe(); };
}

const pendingReads = new Map<string, Promise<unknown>>();
/** Share simultaneous browser GETs. Never share server requests or mutations. */
export function coalescedBrowserRead<T>(key: string, read: () => Promise<T>): Promise<T> {
  if (typeof window === 'undefined') return read();
  const pending = pendingReads.get(key);
  if (pending) return pending as Promise<T>;
  const result = read().finally(() => { if (pendingReads.get(key) === result) pendingReads.delete(key); });
  pendingReads.set(key, result);
  return result;
}

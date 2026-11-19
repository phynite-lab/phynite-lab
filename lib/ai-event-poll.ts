/** Drain a full retained-event page immediately; back off only after empty reads. */
export function aiEventPollDelay(count: number, emptyReads: number, local: boolean): number {
  if (count >= 100) return 0;
  const active = local ? 100 : 250;
  return count > 0 ? active : Math.min(1000, active * 2 ** Math.min(emptyReads, 4));
}

export function waitForAiEvents(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  if (!ms) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const done = () => { signal.removeEventListener('abort', abort); resolve(); };
    const timer = setTimeout(done, ms);
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
  });
}

/** The lease detects abandoned connections; it is renewed while the stream stays alive. */
export function maintainAiTurnLease({ renew, signal, onFailure, intervalMs = 4 * 60_000 }: {
  renew: () => Promise<unknown>; signal: AbortSignal; onFailure: (error: unknown) => void; intervalMs?: number;
}): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  const stop = () => { stopped = true; clearTimeout(timer); signal.removeEventListener('abort', stop); };
  const tick = async () => {
    if (stopped || signal.aborted) return;
    try { await renew(); }
    catch (error) { if (!stopped && !signal.aborted) { stop(); onFailure(error); } return; }
    if (!stopped && !signal.aborted) timer = setTimeout(() => { void tick(); }, intervalMs);
  };
  signal.addEventListener('abort', stop, { once: true });
  if (signal.aborted) stop(); else timer = setTimeout(() => { void tick(); }, intervalMs);
  return stop;
}

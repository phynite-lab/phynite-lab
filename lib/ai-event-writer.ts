import type { AiEvent } from './ai-contract.ts';

/** Coalesce token deltas, keeping control events ordered and flushes durable. */
export function createAiEventWriter(write: (event: AiEvent) => Promise<void>, intervalMs = 40) {
  let pending = '', timer: ReturnType<typeof setTimeout> | undefined, first = true, disposed = false;
  let tail = Promise.resolve();
  const enqueue = (event: AiEvent) => { tail = tail.then(() => write(event)); void tail.catch(() => {}); };
  const drain = () => {
    clearTimeout(timer); timer = undefined;
    if (!pending) return;
    const text = pending; pending = ''; enqueue({ type: 'text', text });
  };
  return {
    send(event: AiEvent) {
      if (disposed) return;
      if (event.type === 'text') {
        pending += event.text;
        if (first || pending.length >= 4000) { first = false; drain(); }
        else timer ??= setTimeout(drain, intervalMs);
      } else {
        drain(); enqueue(event);
        if (event.type === 'response_start') first = true;
      }
    },
    async flush() { drain(); await tail; },
    dispose() { disposed = true; clearTimeout(timer); pending = ''; },
  };
}

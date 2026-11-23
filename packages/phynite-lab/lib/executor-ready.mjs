import { setTimeout as delay } from 'node:timers/promises';

/** Wait for private core registration; the executor never opens a listener. */
export async function waitExecutor(origin, token, child, timeoutMs = 15000, signal) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    signal?.throwIfAborted();
    if (child.spawnError || child.exitCode !== null && child.exitCode !== undefined || child.signalCode) throw new Error('The AI executor stopped during startup. Check its local log.');
    try {
      const timeout = AbortSignal.timeout(2000);
      const reply = await fetch(origin + '/__local/ai-executor/status', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: '{}', signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
      if (reply.ok && (await reply.json()).ready === true) return;
    } catch { /* Registration is safe to poll; inference is never retried here. */ }
    await delay(100, undefined, { signal });
  }
  throw new Error('The AI executor did not register with the local core. Check its local log.');
}

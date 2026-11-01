import type { AiMessage } from './ai-contract.ts';

/** Use the recorded request, never tool/steering messages or the run's expiry. */
export function aiRunElapsedSeconds(runId: string | undefined, messages: Pick<AiMessage, 'runId' | 'role' | 'createdAt' | 'steering'>[], now: number, fallback: number): number {
  const starts = runId ? messages.filter(message => message.runId === runId && message.role === 'user' && !message.steering).map(message => Date.parse(message.createdAt)).filter(Number.isFinite) : [];
  const start = starts.length ? Math.min(...starts) : fallback;
  return Number.isFinite(now) && Number.isFinite(start) ? Math.max(0, Math.floor((now - start) / 1000)) : 0;
}

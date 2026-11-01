import type { AiRun } from './ai-contract.ts';

/** Preserve a known active turn's fence, but never send an earlier terminal turn. */
export async function stopAiTurn(run: AiRun | null, stop: (payload: { runId?: string }) => Promise<unknown>): Promise<void> {
  const payload = run && ['running', 'awaiting_approval'].includes(run.status) ? { runId: run.id } : {};
  for (let attempt = 0; ; attempt++) {
    try { await stop(payload); return; }
    catch (failure) {
      // A claim or provider checkpoint can win the conversation/run revision.
      // Retrying the same target cannot stop a different known active turn.
      if (attempt >= 2 || !(failure && typeof failure === 'object' && 'code' in failure && failure.code === 'AI_CONFLICT')) throw failure;
    }
  }
}

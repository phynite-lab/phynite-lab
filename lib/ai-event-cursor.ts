import type { AiEvent } from './ai-contract.ts';

export type AiEventCursor = { cursor: string; lastError: string };

/** A poll may cover an event before its observer sees the run's recovery signal. */
export function observeAiEvent(state: AiEventCursor, event: { type: AiEvent['type']; id?: string }, failed: boolean): AiEventCursor & { apply: boolean } {
  const id = event.id;
  const missedFailure = event.type === 'error' && failed && !!id && id > state.lastError;
  if (id && id <= state.cursor && !missedFailure) return { ...state, apply: false };
  return {
    cursor: id && id > state.cursor ? id : state.cursor,
    lastError: event.type === 'error' && id && id > state.lastError ? id : state.lastError,
    apply: true,
  };
}

import type { AiConversation, AiDetail } from './ai-contract.ts';

type Selection = Pick<AiConversation, 'modelId' | 'providerId' | 'mode' | 'effort'>;
const sameSelection = (left: Selection, right: Selection) => left.modelId === right.modelId && (left.providerId ?? 'phynite') === (right.providerId ?? 'phynite') && left.mode === right.mode && (left.effort ?? 'auto') === (right.effort ?? 'auto');

/** Retry a runner's final revision change, while preserving concurrent user choices. */
export async function saveAiSettings(original: AiConversation, requested: Selection, save: (conversation: AiConversation) => Promise<AiConversation>, reload: () => Promise<AiDetail>): Promise<AiConversation> {
  try { return await save(original); }
  catch (failure) {
    if (!(failure && typeof failure === 'object' && 'code' in failure && failure.code === 'AI_CONFLICT')) throw failure;
    const latest = await reload();
    if (latest.conversation.id !== original.id) throw failure;
    if (sameSelection(latest.conversation, requested)) return latest.conversation;
    if (!sameSelection(latest.conversation, original) || latest.run && ['running', 'awaiting_approval'].includes(latest.run.status) || latest.queue?.some(message => ['queued', 'claimed'].includes(message.status))) throw failure;
    return save(latest.conversation);
  }
}

export function acceptAiDetail(previous: AiDetail | null, next: AiDetail): boolean {
  return !previous || previous.conversation.id !== next.conversation.id || next.conversation.revision >= previous.conversation.revision;
}

import type { AiConversation } from './ai-contract.ts';
import { aiConversationTab, workflowAiTab } from './workflow-editor-state.ts';

/** Existing conversations retain their project identity after legacy migration. */
export function aiConversationInProject(conversation: Pick<AiConversation, 'projectKey'>, projectId: string, legacyId?: string): boolean {
  return conversation.projectKey === `project:${projectId}` || conversation.projectKey === `md:${projectId}`
    || Boolean(legacyId && conversation.projectKey === `dft:${legacyId}`);
}

/** Old AI links enter the project's normal tab and migration flow. */
export function projectAiHref(projectKey: string | null, conversationId?: string | null): string | null {
  const match = /^(project|dft|md):([A-Za-z0-9_-]{1,200})$/.exec(projectKey ?? '');
  if (!match) return null;
  const projectId = match[1] === 'dft' ? `legacy-${match[2]}` : match[2];
  const query = new URLSearchParams({ tab: conversationId && /^aic_[a-z0-9]+$/.test(conversationId) ? aiConversationTab(conversationId) : workflowAiTab });
  if (conversationId && /^aic_[a-z0-9]+$/.test(conversationId)) query.set('chat', conversationId);
  return `/projects/${encodeURIComponent(projectId)}?${query}`;
}

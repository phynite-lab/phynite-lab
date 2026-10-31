import type { AiConversation } from './ai-contract.ts';
import { aiConversationInProject } from './project-ai.ts';

export type ProjectAiHistorySnapshot = {
  conversations: AiConversation[];
  status: 'loading' | 'ready' | 'error';
};
type Loader = (signal: AbortSignal) => Promise<AiConversation[]>;
async function loadConversations(signal: AbortSignal): Promise<AiConversation[]> {
  const response = await fetch('/api/ai/conversations', { cache: 'no-store', signal });
  if (!response.ok) throw new Error('Chat history could not be loaded.');
  const data = await response.json() as { conversations?: AiConversation[] };
  if (!Array.isArray(data.conversations)) throw new Error('Chat history could not be loaded.');
  return data.conversations;
}
const newestFirst = (a: AiConversation, b: AiConversation) => b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);

/** One project owns both its last good history and any in-flight refresh. */
export class ProjectAiHistory {
  private snapshot: ProjectAiHistorySnapshot = { conversations: [], status: 'loading' };
  private listeners = new Set<() => void>();
  private request?: { controller: AbortController; promise: Promise<AiConversation[]> };
  private generation = 0;
  private projectId: string;
  private legacyId?: string;
  private load: Loader;
  constructor(projectId: string, legacyId?: string, load: Loader = loadConversations) {
    this.projectId = projectId; this.legacyId = legacyId; this.load = load;
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(conversations: AiConversation[], status: ProjectAiHistorySnapshot['status']) {
    this.snapshot = { conversations, status };
    this.listeners.forEach(listener => listener());
  }
  cancel = () => {
    this.generation++;
    this.request?.controller.abort();
    this.request = undefined;
  };
  refresh = (): Promise<AiConversation[]> => {
    if (this.request) return this.request.promise;
    const generation = ++this.generation, controller = new AbortController();
    this.publish(this.snapshot.conversations, 'loading');
    const promise = this.load(controller.signal).then(rows => {
      if (controller.signal.aborted || generation !== this.generation) throw new DOMException('History refresh was cancelled.', 'AbortError');
      const conversations = rows.filter(chat => aiConversationInProject(chat, this.projectId, this.legacyId)).sort(newestFirst);
      this.publish(conversations, 'ready');
      return conversations;
    }).catch(failure => {
      if (!controller.signal.aborted && generation === this.generation) this.publish(this.snapshot.conversations, 'error');
      throw failure;
    }).finally(() => { if (generation === this.generation) this.request = undefined; });
    this.request = { controller, promise };
    return promise;
  };
  add = (conversation: AiConversation) => {
    if (!aiConversationInProject(conversation, this.projectId, this.legacyId)) return;
    this.cancel();
    this.publish([conversation, ...this.snapshot.conversations.filter(chat => chat.id !== conversation.id)].sort(newestFirst), 'ready');
  };
  remove = (id: string) => {
    this.cancel();
    this.publish(this.snapshot.conversations.filter(chat => chat.id !== id), 'ready');
  };
}

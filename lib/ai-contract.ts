import type { AiTaskMode, AiContextManifest, AiContextRef } from './ai-workbench.ts';
/** Public AI contracts. Credentials and provider request construction stay server-side. */
export const aiModels = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
] as const;
// Historical conversations keep their exact model identity; these are not picker options.
const legacyAiModelIds = ['claude-haiku-4-5-20251001', 'claude-opus-4-6', 'claude-opus-4-7', 'claude-opus-4-8', 'claude-opus-5', 'claude-sonnet-4-6'] as const;
export type PhyniteAiModelId = typeof aiModels[number]['id'] | typeof legacyAiModelIds[number];
// User gateways own their exact model IDs, including IDs without namespaces.
export type AiModelId = string;
export type AiProviderId = 'phynite' | '9router' | 'local';
export const aiProviders = [{ id: 'phynite', label: 'Phynite API' }, { id: '9router', label: '9Router gateway' }, { id: 'local', label: 'Local subscription bridge' }] as const;
export const isRouterModelId = (value: unknown): value is `${string}/${string}` => typeof value === 'string' && /^[a-z0-9_-]+\/[A-Za-z0-9_.:()[\]-]{1,120}$/.test(value);
export const isGatewayModelId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\u0000-\u001f\u007f]/.test(value);
export const aiProviderLabel = (provider?: AiProviderId) => provider === '9router' ? '9Router' : provider === 'local' ? 'Local AI' : 'Phynite API';
export const defaultAiModel: AiModelId = 'claude-sonnet-5';
export const defaultAiProvider: AiProviderId = 'phynite';
export const aiPermissionModes = ['chat', 'approval', 'full'] as const;
export type AiPermissionMode = typeof aiPermissionModes[number];
export const aiEfforts = ['auto', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type AiEffort = typeof aiEfforts[number];
export const aiModelCapabilities = { text: true, streaming: true, tools: true, images: true, pdf: true, maxOutputTokens: 65536 } as const;
export function aiCapabilities(model: AiModelId) {
  const efforts: readonly AiEffort[] = isRouterModelId(model) ? ['auto', ...(/^ag\/gemini-.*-(low|medium|high)$/.exec(model)?.slice(1) as AiEffort[] ?? [])] : model === 'claude-haiku-4-5-20251001' ? ['auto']
    : model === 'claude-opus-4-6' || model === 'claude-sonnet-4-6' ? ['auto', 'low', 'medium', 'high', 'max'] : aiEfforts;
  return { ...aiModelCapabilities, efforts };
}
export function isAiEffort(model: AiModelId, effort: unknown): effort is AiEffort { return aiCapabilities(model).efforts.includes(effort as AiEffort); }
export function aiOutputTokens(effort: AiEffort = 'auto') { return effort === 'xhigh' || effort === 'max' ? 65536 : effort === 'high' ? 32768 : 16384; }
// Attachments are stored as user-owned source files.  Do not impose a small
// browser-side size quota here: the upload is streamed to the configured
// object store and the reader applies format-specific safety limits after the
// original bytes have been retained.  The count limit prevents an accidental
// flood of files in one message without constraining an individual research
// archive or dataset.
export const aiAttachmentLimits = { count: 5, pdfPages: 50 } as const;
export type AiAttachment = { id: string; conversationId: string; filename: string; mediaType: string; sizeBytes: number; sha256: string; status: 'uploading' | 'ready' | 'failed'; error?: string; pages?: number; sheets?: string[]; warnings?: string[]; visual?: boolean };
export type AiSkillRef = { id: string; version: number };
export type AiSkillCatalogEntry = AiSkillRef & { command: string; label: { en: string; id: string }; description: { en: string; id: string } };
/** Resolved by the authenticated backend and frozen for this turn. Never accept a client instruction. */
export type AiSkillSnapshot = AiSkillRef & { label: string; instruction: string; sha256: string };
export type AiQueuedMessage = { id: string; conversationId: string; clientMessageId: string; text: string; attachmentIds: string[]; taskMode?: AiTaskMode; contextManifest?: AiContextManifest[]; skillSnapshot?: AiSkillSnapshot | null; sourceArtifactId?: string; status: 'queued' | 'claimed' | 'steered' | 'cancelled' | 'completed'; revision: number; createdAt: string; runId?: string };
export const isAiModel = (value: unknown): value is AiModelId => aiModels.some(model => model.id === value) || legacyAiModelIds.some(id => id === value);
export type AiProject = { key: string; name: string; kind: 'dft' | 'md' | 'canvas'; href: string };
export type AiConversation = {
  id: string; title: string; projectKey: string | null; modelId: AiModelId; providerId?: AiProviderId; mode: AiPermissionMode;
  revision: number; activeRunId: string | null; createdAt: string; updatedAt: string; effort?: AiEffort; queuePaused?: boolean;
};
export type AiMessage = { id: string; conversationId: string; role: 'user' | 'assistant' | 'tool'; text: string; modelId: AiModelId; providerId?: AiProviderId; createdAt: string; runId: string; effort?: AiEffort; attachmentIds?: string[]; taskMode?: AiTaskMode; contextManifest?: AiContextManifest[]; skillSnapshot?: AiSkillSnapshot | null; steering?: boolean };
export type AiFailure = { code: string; message: string; requestId?: string; issues?: Array<{ nodeId?: string; path?: string; message: string }> };
export type AiAgentBudget = { maxWallSeconds: number; maxQueueWaitSeconds: number; agentLeaseTimeoutSeconds: number; maxCandidates?: number; maxRepairs: number; maxNodeHours?: number; maxSparseHarvestBytes: number };
export type AiAgentState = 'planning' | 'awaiting approval' | 'executing' | 'observing' | 'validating' | 'completed' | 'repair proposed' | 'manual resume required';
export type AiCampaignContract = { maxCandidates: number; parameterRanges: Record<string, { min: number; max: number; unit?: string }>; evaluator: string; allowedClusters: readonly string[]; totalNodeHours: number; maxWallSecondsPerCandidate: number; repairPolicy: readonly string[]; expiresAtEpoch: number };
export type AiVisionEvidence = { attachmentId: string; attachmentSha256: string; page?: number; region?: { x: number; y: number; width: number; height: number }; confidence: number; label: string; approximate: true };
export type AiRun = { id: string; status: 'running' | 'awaiting_approval' | 'completed' | 'failed' | 'stopped'; modelId: AiModelId; providerId?: AiProviderId; mode: AiPermissionMode; taskMode?: AiTaskMode; contextManifest?: AiContextManifest[]; skillSnapshot?: AiSkillSnapshot | null; sourceArtifactId?: string; sourcePlan?: string; steps: number; revision: number; expiresAt: number; effort?: AiEffort; queueId?: string; controlRevision?: number; planControlRevision?: number; failure?: AiFailure; pendingCalls?: Array<{ type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }>; agentState?: AiAgentState; agentBudget?: AiAgentBudget; campaignContract?: AiCampaignContract; receiptId?: string };
export type AiAction = {
  id: string; conversationId: string; runId: string; kind: string; title: string;
  status: 'pending' | 'executing' | 'succeeded' | 'failed' | 'rejected' | 'expired' | 'superseded';
  before: unknown; after: unknown; payloadHash: string; expiresAt: number;
  result?: Record<string, unknown>; error?: string;
};
export type AiSendPayload = { text?: string; attachmentIds?: string[]; taskMode?: AiTaskMode; contextRefs?: AiContextRef[]; skillRef?: AiSkillRef | null; sourceArtifactId?: string; resume?: boolean; runId?: string; queueId?: string; clientMessageId?: string };
export type AiDetail = { turns?: Record<string, { status: AiRun['status']; failure?: AiFailure }>; conversation: AiConversation; messages: AiMessage[]; actions: AiAction[]; run: AiRun | null; hasOlderMessages?: boolean; before?: string; queue?: AiQueuedMessage[]; attachments?: AiAttachment[]; streamText?: string; eventCursor?: string };
export type AiEvent =
  | { type: 'state'; detail: AiDetail }
  | { type: 'text'; text: string }
  | { type: 'response_start' }
  | { type: 'activity'; text: string }
  | { type: 'action'; action: AiAction }
  | { type: 'queue'; queue: AiQueuedMessage[]; paused: boolean }
  | { type: 'steering'; messages: AiMessage[] }
  | { type: 'done' }
  | { type: 'error'; runId?: string; code: string; message: string; requestId?: string; issues?: Array<{ nodeId?: string; path?: string; message: string }> };

/** Network chunks can split UTF-8 characters, JSON and SSE frame delimiters. */
export class AiStreamError extends Error {
  readonly code: 'AI_STREAM_INVALID' | 'AI_STREAM_INCOMPLETE';
  constructor(code: AiStreamError['code'], message: string) { super(message); this.code = code; }
}
export async function readSse(response: Response, consume: (data: unknown) => void, signal?: AbortSignal): Promise<void> {
  if (!response.body) throw new AiStreamError('AI_STREAM_INCOMPLETE', 'The response stream is unavailable.');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '';
  const drain = () => {
    buffer = buffer.replace(/\r\n/g, '\n');
    let end: number;
    while ((end = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
      const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
      if (data && data !== '[DONE]') {
        let parsed: unknown;
        try { parsed = JSON.parse(data); }
        catch { throw new AiStreamError('AI_STREAM_INVALID', 'The response stream contained an invalid event.'); }
        consume(parsed);
      }
    }
    if (buffer.length > 2_000_000) throw new AiStreamError('AI_STREAM_INVALID', 'A stream frame exceeded the supported size.');
  };
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) { buffer += decoder.decode(); drain(); if (buffer.trim() && !buffer.trim().startsWith(':')) throw new AiStreamError('AI_STREAM_INCOMPLETE', 'The response stream ended inside a frame.'); break; }
      buffer += decoder.decode(value, { stream: true }); drain();
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

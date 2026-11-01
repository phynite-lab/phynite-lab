import { aiOutputTokens, aiCapabilities, AiStreamError, isAiEffort, isAiModel, isRouterModelId, isGatewayModelId, readSse, type AiProviderId, type AiEffort, type AiModelId } from './ai-contract.ts';

export class AiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: { issues?: Array<{ nodeId?: string; path?: string; message: string }>; requestId?: string };
  constructor(status: number, code: string, message: string, details?: AiError['details']) { super(message); this.status = status; this.code = code; this.details = details; }
}
export function aiTurnFailure(error: unknown, signal?: AbortSignal): AiError {
  if (error instanceof AiError) return error;
  if (signal?.aborted && signal.reason instanceof AiError) return signal.reason;
  if (signal?.reason?.name === 'TimeoutError' || error instanceof Error && error.name === 'TimeoutError') return new AiError(504, 'AI_TURN_TIMEOUT', 'This AI turn reached its time limit. Recorded actions were kept. Review them and send a follow-up.');
  if (signal?.aborted) return new AiError(499, 'AI_CONNECTION_CLOSED', 'The AI connection closed. Reopen the chat and review recorded actions before continuing.');
  if (error instanceof Error && /too many subrequests/i.test(error.message)) return new AiError(503, 'AI_REQUEST_LIMIT', 'This turn reached the workspace request limit. Stop the turn, review recorded actions, then send a follow-up.');
  return new AiError(500, 'AI_TURN_FAILED', 'The AI turn could not finish. Recorded actions were kept. Use the tracking ID to report this failure.');
}
export type AiToolDefinition = { name: string; description: string; input_schema: Record<string, unknown> };
export type ClaudeBlock = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };
type PrivateThinkingBlock = { type: 'thinking'; thinking: string; signature: string } | { type: 'redacted_thinking'; data: string };
export type ClaudeInputBlock = { type: 'image' | 'document'; source: { type: 'base64'; media_type: string; data: string }; title?: string };
export type ClaudeMessage = { role: 'user' | 'assistant'; content: string | Array<ClaudeBlock | PrivateThinkingBlock | ClaudeInputBlock> };
export type AiProviderConfig = { baseUrl: string; token: string; providerId?: AiProviderId; modelIds?: AiModelId[]; modelCapabilities?: Record<string, { efforts?: AiEffort[] }>; local?: boolean };
export function routerModelIds(env: Record<string, string | undefined>, native = false): AiModelId[] {
  if (native) {
    try {
      const models = JSON.parse(env.PHYNITE_LOCAL_AI_MODELS ?? '[]');
      if (!Array.isArray(models) || models.length > 1000 || models.some(model => !isGatewayModelId(model))) throw new Error();
      return models;
    } catch { throw new AiError(503, 'AI_CAPABILITIES_INVALID', 'The local AI model catalogue needs attention.'); }
  }
  if (!env.PHYNITE_AI_9ROUTER_CAPABILITIES) return [];
  try { const report = JSON.parse(env.PHYNITE_AI_9ROUTER_CAPABILITIES); if (!report.checkedAt || !Number.isFinite(Date.parse(report.checkedAt)) || !report.models || Array.isArray(report.models)) throw new Error(); const validator = env.PHYNITE_APP_MODE === 'local' ? isGatewayModelId : isRouterModelId; return Object.keys(report.models).filter(validator).slice(0, env.PHYNITE_APP_MODE === 'local' ? 1000 : 100); }
  catch { throw new AiError(503, 'AI_CAPABILITIES_INVALID', 'The 9Router compatibility report needs attention.'); }
}

export function aiProviderConfig(env: Record<string, string | undefined>, providerId: AiProviderId = 'phynite'): AiProviderConfig | null {
  const local = providerId === 'local';
  const router = providerId === '9router' || local;
  const token = (local ? env.PHYNITE_LOCAL_AI_TOKEN : router ? env.PHYNITE_AI_9ROUTER_AUTH_TOKEN : env.PHYNITE_AI_AUTH_TOKEN)?.trim();
  if ((!token && !(env.PHYNITE_APP_MODE === 'local' && router)) || router && !(local ? env.PHYNITE_LOCAL_AI_URL : env.PHYNITE_AI_9ROUTER_BASE_URL)) return null;
  const base = new URL((local ? env.PHYNITE_LOCAL_AI_URL : router ? env.PHYNITE_AI_9ROUTER_BASE_URL : env.PHYNITE_AI_BASE_URL) || (router ? 'https://unconfigured.invalid' : 'https://api.mwapi.dev'));
  const loopback = (local || env.PHYNITE_AI_ALLOW_LOOPBACK_PROVIDER === 'true') && base.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname);
  if (base.protocol !== 'https:' && !loopback || base.username || base.password || base.search || base.hash || !['', '/', '/v1', '/v1/'].includes(base.pathname)) throw new AiError(503, 'AI_CONFIGURATION_INVALID', 'The AI provider configuration needs attention.');
  let modelCapabilities: Record<string, { efforts?: AiEffort[] }> | undefined;
  if (local && env.PHYNITE_LOCAL_AI_CAPABILITIES) {
    try { const report = JSON.parse(env.PHYNITE_LOCAL_AI_CAPABILITIES); if (report?.models && typeof report.models === 'object') modelCapabilities = report.models; } catch { throw new AiError(503, 'AI_CAPABILITIES_INVALID', 'The local AI compatibility report needs attention.'); }
  }
  return { baseUrl: base.origin, token: token ?? '', providerId, local: env.PHYNITE_APP_MODE === 'local', ...(router ? { modelIds: routerModelIds(env, providerId === 'local') } : {}), ...(modelCapabilities ? { modelCapabilities } : {}) };
}

/** No model fallback or arbitrary URLs. Thinking is private to the current model call. */
async function streamClaudeResponse(options: {
  config: AiProviderConfig; modelId: AiModelId; system: string; messages: ClaudeMessage[];
  tools: AiToolDefinition[]; signal: AbortSignal; onText: (text: string) => void; fetcher?: typeof fetch; effort?: AiEffort;
}): Promise<{ content: ClaudeBlock[]; continuation: Array<ClaudeBlock | PrivateThinkingBlock>; usage: { inputTokens: number; outputTokens: number }; stopReason: string }> {
  if (options.config.providerId === '9router' || options.config.providerId === 'local' ? !(options.config.local ? isGatewayModelId(options.modelId) : isRouterModelId(options.modelId)) || !options.config.modelIds?.includes(options.modelId) : !isAiModel(options.modelId)) throw new AiError(400, 'AI_MODEL_INVALID', 'Choose a model from the selected provider catalogue.');
  const effort = options.effort ?? 'auto';
  const supportedEfforts = options.config.providerId === 'local' ? options.config.modelCapabilities?.[options.modelId]?.efforts ?? ['auto'] : aiCapabilities(options.modelId).efforts;
  if (!supportedEfforts.includes(effort) || options.config.providerId !== 'local' && !isAiEffort(options.modelId, effort)) throw new AiError(400, 'AI_EFFORT_UNSUPPORTED', 'This model does not support the selected effort. Choose Auto or another supported level.');
  const response = await (options.fetcher ?? fetch)(`${options.config.baseUrl}/v1/messages`, {
    method: 'POST', signal: options.signal, redirect: 'manual',
    headers: { Authorization: `Bearer ${options.config.token}`, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ model: options.modelId, max_tokens: aiOutputTokens(effort), stream: true, system: options.system, messages: options.messages, tools: options.tools,
      ...(options.config.providerId !== '9router' && options.config.providerId !== 'local' && effort !== 'auto' ? { output_config: { effort }, thinking: { type: 'adaptive' } } : {}) }),
  });
  if (!response.ok) {
    await response.body?.cancel();
    if (options.config.providerId === '9router' && response.status === 530) throw new AiError(503, 'AI_ROUTER_UNREACHABLE', `9Router could not be reached through its configured tunnel (status ${response.status}). Keep the router and tunnel online; the operator may need to update the server endpoint. Your conversation is saved. Retry after the connection is restored.`);
    if ([401, 403].includes(response.status)) throw new AiError(503, 'AI_PROVIDER_AUTH_FAILED', 'The AI provider rejected its server credential. Ask the operator to check the configured API key, then retry.');
    throw new AiError(response.status === 429 ? 429 : 503, 'AI_PROVIDER_UNAVAILABLE', `The selected model is unavailable (provider status ${response.status}). Retry or choose another model.`);
  }
  const blocks = new Map<number, { block: ClaudeBlock | PrivateThinkingBlock; json: string; closed: boolean }>();
  let inputTokens = 0, outputTokens = 0, stopReason = '', stopped = false;
  await readSse(response, raw => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !('type' in raw) || typeof raw.type !== 'string') throw new AiError(502, 'AI_PROVIDER_STREAM_INVALID', 'The model returned an invalid stream event. No incomplete tool arguments were executed.');
    const e = raw as { type: string; index: number; message?: { usage?: { input_tokens?: number; output_tokens?: number } }; usage?: { output_tokens?: number }; content_block?: ClaudeBlock | PrivateThinkingBlock; delta?: { type?: string; text?: string; thinking?: string; signature?: string; partial_json?: string; stop_reason?: string } };
    if (e.type === 'error') throw new AiError(503, 'AI_PROVIDER_STREAM_ERROR', 'The model interrupted its response. Review completed actions before retrying.');
    if (e.type === 'message_start') { inputTokens = e.message?.usage?.input_tokens ?? 0; outputTokens = e.message?.usage?.output_tokens ?? 0; }
    if (e.type === 'content_block_start' && e.content_block && ['text', 'tool_use', 'thinking', 'redacted_thinking'].includes(e.content_block.type)) {
      blocks.set(e.index, { block: e.content_block, json: '', closed: false });
      if (e.content_block.type === 'text' && e.content_block.text) options.onText(e.content_block.text);
    }
    if (e.type === 'content_block_delta') {
      const current = blocks.get(e.index);
      if (current?.block.type === 'text' && e.delta?.type === 'text_delta' && e.delta.text) { current.block.text += e.delta.text; options.onText(e.delta.text); }
      if (current?.block.type === 'tool_use' && e.delta?.type === 'input_json_delta') current.json += e.delta.partial_json ?? '';
      if (current?.block.type === 'thinking' && e.delta?.type === 'thinking_delta') current.block.thinking += e.delta.thinking ?? '';
      if (current?.block.type === 'thinking' && e.delta?.type === 'signature_delta') current.block.signature += e.delta.signature ?? '';
    }
    if (e.type === 'content_block_stop') {
      const current = blocks.get(e.index);
      if (current) current.closed = true;
      if (current?.block.type === 'tool_use') {
        let input: unknown;
        try { input = current.json ? JSON.parse(current.json) : current.block.input; }
        catch { throw new AiError(502, 'AI_TOOL_INPUT_INVALID', 'The model returned incomplete or invalid tool arguments. No incomplete action was executed.'); }
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AiError(502, 'AI_TOOL_INPUT_INVALID', 'The model returned invalid tool arguments.');
        current.block.input = input as Record<string, unknown>;
      }
    }
    if (e.type === 'message_delta') { stopReason = e.delta?.stop_reason ?? ''; outputTokens = e.usage?.output_tokens ?? outputTokens; }
    if (e.type === 'message_stop') stopped = true;
  }, options.signal);
  if (!stopped || !['end_turn', 'tool_use', 'stop_sequence', 'max_tokens'].includes(stopReason)) throw new AiError(502, 'AI_RESPONSE_INCOMPLETE', 'The model response was incomplete. No incomplete tool arguments were executed.');
  if ([...blocks.values()].some(value => !value.closed)) throw new AiError(502, 'AI_RESPONSE_INCOMPLETE', 'The model ended inside a content block. No incomplete tool arguments were executed.');
  const continuation = [...blocks.values()].map(value => value.block);
  const content = continuation.filter((block): block is ClaudeBlock => block.type !== 'thinking' && block.type !== 'redacted_thinking');
  if (stopReason === 'max_tokens' && content.some(block => block.type === 'tool_use')) throw new AiError(502, 'AI_TOOL_INPUT_INVALID', 'The model reached its output limit while preparing tool arguments. No action from this response was executed. Ask it to prepare a smaller change.');
  if (stopReason === 'max_tokens' && !content.length) throw new AiError(422, 'AI_OUTPUT_LIMIT', 'The model used its output budget before producing an answer. Choose a lower effort or ask a narrower question.');
  if (!content.length) throw new AiError(502, 'AI_RESPONSE_EMPTY', 'The model returned no usable response.');
  // Signed thinking is used only in memory within this same model turn, never persisted or shown.
  return { content, continuation, usage: { inputTokens, outputTokens }, stopReason };
}

export async function streamClaude(options: Parameters<typeof streamClaudeResponse>[0]): ReturnType<typeof streamClaudeResponse> {
  try { return await streamClaudeResponse(options); }
  catch (error) {
    if (error instanceof AiError) throw error;
    if (options.signal.aborted || error instanceof Error && /too many subrequests/i.test(error.message)) throw aiTurnFailure(error, options.signal);
    if (error instanceof AiStreamError) throw new AiError(502, error.code === 'AI_STREAM_INVALID' ? 'AI_PROVIDER_STREAM_INVALID' : 'AI_RESPONSE_INCOMPLETE', 'The model stream was malformed or incomplete. Recorded actions were kept; no incomplete tool arguments were executed.');
    throw new AiError(502, 'AI_PROVIDER_CONNECTION_FAILED', 'The connection to the selected AI provider failed. Check that its service and tunnel are online, then retry. Recorded actions were kept.');
  }
}

/** A discovered local capability is data; it never widens task/skill permissions. */
import type { AiAction, AiPermissionMode } from './ai-contract.ts';
import { AiError, type AiToolDefinition } from './ai-provider.ts';
import type { AiBackend } from './ai-tools.ts';
export type AiMcpTool = AiToolDefinition & { readOnly: boolean; serverId: string; toolHash: string };
export function aiMcpTools(tools: readonly AiMcpTool[], mode: AiPermissionMode, hasProject: boolean): AiToolDefinition[] {
  return tools.filter(tool => /^mcp__[A-Za-z0-9_-]{1,59}$/.test(tool.name) && /^[a-f0-9]{64}$/.test(tool.toolHash) && (tool.readOnly === true || mode !== 'chat' && hasProject))
    .map(({ name, description, input_schema }) => ({ name, description, input_schema }));
}
export async function executeAiMcpTool(tool: AiMcpTool, input: Record<string, unknown>, mode: AiPermissionMode, backend: AiBackend, signal: AbortSignal, toolCallId?: string): Promise<{ result: unknown; action?: AiAction; awaitingApproval?: boolean }> {
  signal.throwIfAborted();
  const payload = { name: tool.name, arguments: input, readOnly: tool.readOnly, toolHash: tool.toolHash };
  if (tool.readOnly === true) return { result: await backend('mcp_call', payload) };
  if (mode === 'chat') throw new AiError(403, 'AI_PERMISSION_DENIED', 'This local MCP tool requires a reviewed action.');
  const { stamp } = await backend<{ stamp: string }>('context');
  const { action } = await backend<{ action: AiAction }>('prepare', { kind: 'mcp_call', payload, stamp, toolCallId, title: `Local MCP · ${tool.name}` });
  if (action.status !== 'pending') return { result: action, action };
  if (mode === 'approval') return { result: { status: 'awaiting_approval', actionId: action.id, payloadHash: action.payloadHash }, action, awaitingApproval: true };
  signal.throwIfAborted();
  const executed = await backend<{ action: AiAction }>('execute', { actionId: action.id, payloadHash: action.payloadHash });
  return { result: executed.action, action: executed.action };
}

/** Covers discovery, repeated capability validation and one bounded tool call. No retries. */
export function aiMcpControlPlaneTimeout(path: string, local: boolean): number {
  return local && /^conversations\/aic_[a-z0-9]+\/(?:mcp_tools|mcp_call|prepare|execute|actions\/aia_[a-z0-9]+)(?:\?.*)?$/.test(path) ? 150_000 : 20_000;
}

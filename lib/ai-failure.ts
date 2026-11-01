import type { AiFailure } from './ai-contract.ts';
import { AiError, aiTurnFailure } from './ai-provider.ts';

const redact = (value: string, limit: number) => value.replace(/https?:\/\/\S*(?:X-Amz-|X-Goog-)\S*/gi, '[private artifact]').replace(/(?:bearer\s+[\w.\-]+|sk-[a-z0-9_\-]{16,}|(?:token|password|api[_-]?key|secret)\s*[:=]\s*[^\s,;]+)/gi, '[redacted]').slice(0, limit);

/** Only normalized public errors are persisted; arbitrary exceptions stay private. */
export function normalizeAiFailure(error: unknown, requestId?: string): AiFailure {
  const value = error instanceof AiError ? error : aiTurnFailure(error);
  const trackingId = value.details?.requestId ?? requestId;
  const issues = value.details?.issues?.slice(0, 20).map(issue => ({
    ...(issue.nodeId ? { nodeId: redact(issue.nodeId, 200) } : {}),
    ...(issue.path ? { path: redact(issue.path, 400) } : {}),
    message: redact(issue.message, 1000),
  }));
  return {
    code: /^[A-Z][A-Z0-9_]{0,79}$/.test(value.code) ? value.code : 'AI_TURN_FAILED',
    message: redact(value.message, 2000) || 'The AI turn could not finish. Review recorded actions before continuing.',
    ...(trackingId ? { requestId: redact(trackingId, 200) } : {}),
    ...(issues?.length ? { issues } : {}),
  };
}

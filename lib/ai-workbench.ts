import type { AiPermissionMode } from './ai-contract.ts';

export const aiTaskModes = ['work', 'plan', 'research'] as const;
export type AiTaskMode = typeof aiTaskModes[number] | 'summary';
export type AiContextRef =
  | { kind: 'node' | 'edge'; id: string; revision?: number }
  | { kind: 'field'; id: string; path: string[]; revision?: number }
  | { kind: 'atom'; id: string; atomId: string; image?: [number, number, number]; revision?: number }
  | { kind: 'resource'; id: string; resourceKind: string; revision?: number }
  | { kind: 'attachment'; id: string };
export type AiContextItem = { ref: AiContextRef; label: string; detail?: string };
export type AiContextManifest = AiContextItem & { sourceId: string; sha256: string; value?: unknown };
export type AiArtifact = { id: string; conversationId: string; runId: string; kind: 'plan' | 'research' | 'summary'; status: 'complete' | 'partial'; text: string; createdAt: string; sourceStamp: string; contextManifest: AiContextManifest[]; evidence: Array<Record<string, unknown>>; modelId: string };
export function aiEffectivePermission(mode: AiPermissionMode, task: AiTaskMode = 'work'): AiPermissionMode { return task === 'work' ? mode : 'chat'; }
export function aiContextKey(ref: AiContextRef): string { return JSON.stringify([ref.kind, ref.id, ref.kind === 'field' ? ref.path : ref.kind === 'atom' ? [ref.atomId, ref.image ?? [0, 0, 0]] : ref.kind === 'resource' ? ref.resourceKind : null]); }
export function aiTaskInstruction(task: AiTaskMode): string {
  if (task === 'plan') return 'In Plan mode, inspect saved context and develop an actionable research plan around the user’s objective. Connect the supporting evidence to the proposed steps and exact parameter changes, explaining missing scientific choices, validation and risks where relevant. This mode is read-only: do not modify project data or submit jobs. The user can choose Implement plan in a later Work turn.';
  if (task === 'research') return 'In Research mode, investigate the question using public keyword queries and relevant project or attachment evidence. Compare Crossref/arXiv records, deduplicate DOI/arXiv IDs and follow useful gaps iteratively. Support claims with returned URLs, source IDs and actually read sections, distinguishing metadata from abstracts and document evidence. Explain conflicts and gaps that affect the synthesis without implying broad web or full-text coverage. This mode is read-only: do not change project data or run jobs. Near the tool limit, save a useful partial synthesis with focused continuation questions.';
  if (task === 'summary') return 'For this Summary, explain the user’s goal and the decisions and outcomes supported by the recorded conversation and selected context. Include action/resource IDs when useful, distinguish completed actions from proposals or pending work, and connect open questions to the next steps. Keep observed results distinct from interpretation. This mode is read-only: do not change the project or run jobs.';
  return 'In Work mode, use exact saved evidence and the allowed validated operations to carry out the user’s request, then explain the recorded outcomes. Explicit references identify the requested focus; preserve unrequested modules and parameters.';
}
/** Local drafts are untrusted UI cache; authoritative reference validation stays on the server. */
export function isAiContextItem(value: unknown): value is AiContextItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<AiContextItem>, ref = item.ref;
  return typeof item.label === 'string' && item.label.length <= 500 && Boolean(ref && typeof ref === 'object' && typeof ref.id === 'string' && ['node', 'edge', 'field', 'atom', 'resource', 'attachment'].includes(ref.kind));
}

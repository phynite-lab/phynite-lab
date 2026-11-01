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
  if (task === 'plan') return 'PLAN ONLY. Inspect saved context, clarify assumptions and produce a concrete research plan: objective, evidence IDs, ordered steps, exact intended parameter changes, missing scientific choices, validation and risks. Do not modify project data or submit jobs. The user can choose Implement plan in a later Work turn.';
  if (task === 'research') return 'RESEARCH ONLY. Break the research question into public keyword queries, compare Crossref/arXiv records and user-provided project/attachment evidence. Search iteratively when a useful gap appears. Deduplicate DOI/arXiv IDs. Cite returned URLs and context source IDs for claims, label metadata-only versus abstracts versus actually read document sections. Report conflicts, missing evidence and coverage limits. End with a concise synthesis and next questions. Do not claim broad web/full-text coverage. Do not change project data or run jobs. If the tool budget is near its limit, provide a useful partial report and continuation questions.';
  if (task === 'summary') return 'SUMMARY ONLY. Read the recorded conversation and selected saved context. Summarize the user goal, decisions, actions actually completed with action/resource IDs, unresolved questions, evidence and next steps. Distinguish observed results from AI interpretation. Do not infer success from a proposed or pending action. Do not change the project or run jobs.';
  return 'WORK. Inspect exact saved evidence, use the allowed validated operations and report actual outcomes. Explicit references identify the requested focus; preserve unrequested modules and parameters.';
}
/** Local drafts are untrusted UI cache; authoritative reference validation stays on the server. */
export function isAiContextItem(value: unknown): value is AiContextItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<AiContextItem>, ref = item.ref;
  return typeof item.label === 'string' && item.label.length <= 500 && Boolean(ref && typeof ref === 'object' && typeof ref.id === 'string' && ['node', 'edge', 'field', 'atom', 'resource', 'attachment'].includes(ref.kind));
}

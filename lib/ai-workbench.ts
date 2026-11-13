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
export type AiArtifactKind = 'report' | 'plan' | 'figure_preview' | 'input_file' | 'table' | 'diff';
export type AiArtifactTable = { columns: Array<{ key: string; label: string; unit?: string; numeric?: boolean }>; rows: Array<Record<string, string | number | null>>; sourceIds: string[] };
export type AiArtifactInput = { format: 'qe' | 'lammps' | 'cif' | 'poscar' | 'json' | 'text' | 'markdown' | 'python' | 'latex'; filename: string; text: string; validation?: { valid: boolean; issues: string[]; note?: string } };
export type AiArtifactDiff = { format: string; filename: string; before: string; after: string };
export type AiArtifactFigure = { figure: import('./research-figures.ts').FigureDocument; datasets: import('./research-figures.ts').ResearchDataset[] };
export type AiArtifactAuthor = { kind: 'ai' | 'researcher'; id: string; modelId?: string };
export type AiArtifactSummary = { id: string; conversationId: string; runId: string; artifactGroupId?: string; version?: number; parentArtifactId?: string; kind: AiArtifactKind | 'research' | 'summary'; title?: string; status: 'draft' | 'complete' | 'partial'; createdAt: string; hasOverflow?: boolean; sha256?: string; author?: AiArtifactAuthor };
export type AiArtifact = AiArtifactSummary & { schemaVersion?: 1 | 2; content?: string; structuredData?: AiArtifactTable | AiArtifactInput | AiArtifactDiff | AiArtifactFigure | null; text: string; sourceStamp: string; contextManifest: AiContextManifest[]; evidence: Array<Record<string, unknown>>; modelId: string; change?: Record<string, unknown> };
export type AiArtifactEdit = { artifactId: string; baseSha256: string; text: string; requestId: string };
export type AiArtifactHunk = { id: string; before: string; after: string; reason: string; decision: 'pending' | 'accepted' | 'rejected' };
export type AiArtifactPatch = { id: string; revision: number; baseArtifactId: string; baseSha256: string; artifactGroupId: string; expectedArtifactId: string; hunks: AiArtifactHunk[]; author: AiArtifactAuthor; status: 'open' | 'stale' | 'expired' | 'complete'; createdAt: string; expiresAt: number };

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

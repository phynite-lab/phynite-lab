export type ProjectNote = { id: string; projectId: string; name: string; head: string; revision: number; sha256: string; updatedAt: string };
export type NoteRevision = { id: string; noteId: string; projectId: string; name: string; revision: number; parentRevision: string | null; text: string; sha256: string; createdAt: string; author: { kind: string; id: string }; provenance?: Record<string, unknown> };
export type NoteDetail = { note: ProjectNote; revision: NoteRevision };
export type NoteDraft = { key: string; owner: string; projectId: string; noteId: string; editorId: string; baseRevision: string; sequence: number; text: string; name: string; updatedAt: number; checkpoint?: NoteDetail };
export type NoteProposal = { id: string; noteId: string; expectedHead: string; status: string; provenance: Record<string, unknown>; hunks: { id: string; before: string; after: string; reason: string; decision: 'pending' | 'accepted' | 'rejected' }[] };
export const noteByteLength = (text: string) => new TextEncoder().encode(text).byteLength;
export function noteContentIssue(text: string): string | null {
  if (noteByteLength(text) > 1024 ** 2) return 'A note can contain at most 1 MiB of UTF-8 text.';
  if (/data\s*:\s*image\/[^\s)]*base64/i.test(text)) return 'Attach images as project artifacts; inline base64 images are not supported.';
  return null;
}
export async function notesRequest<T>(project: string, path = '', payload?: unknown, method = payload === undefined ? 'GET' : 'POST'): Promise<T> {
  const reply = await fetch(`/api/notes/${encodeURIComponent(project)}${path ? '/' + path : ''}`, { method, cache: 'no-store', headers: payload ? { 'Content-Type': 'application/json' } : undefined, body: payload === undefined ? undefined : JSON.stringify(payload) });
  const result = await reply.json() as T & { error?: string; code?: string };
  if (!reply.ok) throw Object.assign(new Error(result.error ?? 'The note could not be saved. Keep your draft and try again.'), { code: result.code, status: reply.status });
  return result as T;
}
/** Ranges crossing the API use Unicode code points, while browser editors use UTF-16. */
export function noteSelection(text: string, start: number, end: number) { return { start: Array.from(text.slice(0, start)).length, end: Array.from(text.slice(0, end)).length }; }

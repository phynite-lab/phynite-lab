export type ConnectedRoot = { id: string; name: string; path: string; source: 'local' | 'hpc'; write: boolean; active: boolean; capabilityRevision: number; replaceQualified: boolean; clusterId?: string };
export type FileEntry = { name: string; kind: 'file' | 'directory' | 'symlink' | 'special'; sizeBytes: number; identity: string };
export type FileListing = { entries: FileEntry[]; cursor: string | null; sourceRevision: string };
export type FileTransfer = { id: string; rootId: string; status: string; sizeBytes: number; progressBytes: number; requiredDiskBytes: number; error?: string; imports: string[] };
export type ProjectFile = { id: string; name: string; sizeBytes: number; sha256: string; path: string; sourceRevision: string };
export type FileInventory = { roots: ConnectedRoot[]; transfers: FileTransfer[]; files: ProjectFile[] };
export type FileText = { text: string; sha256?: string; windowSha256: string; identity: string; truncated: boolean; sizeBytes: number };
export type FileEdit = { id: string; diff: string; diffTruncated: boolean; target: string; sha256: string; status: string };
export function selectedImportIssue(entries: FileEntry[]): string | null {
  if (!entries.length || entries.length > 20) return 'Select 1–20 regular files per import.';
  if (entries.some(e => e.kind !== 'file')) return 'Only regular files can be transferred.';
  if (entries.reduce((sum, e) => sum + e.sizeBytes, 0) > 1024 ** 3) return 'A selected import is limited to 1 GiB.';
  return null;
}
export async function filesRequest<T>(project: string, path = '', payload?: unknown, method = payload === undefined ? 'GET' : 'POST'): Promise<T> {
  const response = await fetch(`/api/files/${encodeURIComponent(project)}${path ? '/' + path : ''}`, { method, cache: 'no-store', headers: payload === undefined ? undefined : { 'Content-Type': 'application/json' }, body: payload === undefined ? undefined : JSON.stringify(payload) });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? 'File operation failed. Keep your text and refresh the source.');
  return data as T;
}
export const fileBytes = (size: number) => size < 1024 ? `${size} B` : size < 1024 ** 2 ? `${(size / 1024).toFixed(1)} KiB` : `${(size / 1024 ** 2).toFixed(1)} MiB`;

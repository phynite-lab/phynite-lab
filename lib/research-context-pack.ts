import type { AiContextItem, AiContextManifest } from './ai-workbench';

/** A source that may be supplied to a local AI provider as read-only context. */
export type ResearchContextSource = {
  sourceId: string;
  label: string;
  kind: AiContextItem['ref']['kind'];
  id: string;
  detail?: string;
  sha256?: string;
  value?: unknown;
};

export type ResearchContextPack = {
  version: 1;
  projectId: string;
  generatedAt: string;
  readOnly: true;
  sources: AiContextManifest[];
};

const secretKey = /(token|secret|password|passwd|authorization|cookie|credential|private.?key|api.?key|access.?key|refresh.?token|session)/i;

/**
 * Strip values that could contain credentials before a context pack is sent to
 * a local provider. Scientific values are preserved verbatim; only keys that
 * explicitly look credential-like are omitted.
 */
export function redactResearchContext(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[depth limit]';
  if (Array.isArray(value)) return value.slice(0, 2000).map(item => redactResearchContext(item, depth + 1));
  if (!value || typeof value !== 'object') return value;
  const entries = Object.entries(value as Record<string, unknown>).filter(([key]) => !secretKey.test(key));
  return Object.fromEntries(entries.slice(0, 1000).map(([key, item]) => [key, redactResearchContext(item, depth + 1)]));
}

export function buildResearchContextPack(projectId: string, sources: ResearchContextSource[], generatedAt = new Date().toISOString()): ResearchContextPack {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(projectId)) throw new Error('Invalid project identity.');
  const seen = new Set<string>();
  const manifests: AiContextManifest[] = [];
  for (const source of sources.slice(0, 250)) {
    if (!source || typeof source !== 'object' || !source.sourceId || !source.id || !source.label || seen.has(source.sourceId)) continue;
    if (!['node', 'edge', 'field', 'atom', 'resource', 'attachment'].includes(source.kind)) continue;
    if (source.sha256 !== undefined && !/^[a-f0-9]{64}$/.test(source.sha256)) continue;
    seen.add(source.sourceId);
    const ref = source.kind === 'field'
      ? { kind: 'field' as const, id: source.id, path: [] }
      : source.kind === 'atom'
        ? { kind: 'atom' as const, id: source.id, atomId: source.id }
        : source.kind === 'resource'
          ? { kind: 'resource' as const, id: source.id, resourceKind: 'research' }
          : { kind: source.kind, id: source.id } as AiContextManifest['ref'];
    manifests.push({ sourceId: source.sourceId.slice(0, 200), label: source.label.slice(0, 500), detail: source.detail?.slice(0, 1000), ref, sha256: source.sha256 ?? '', value: source.value === undefined ? undefined : redactResearchContext(source.value) });
  }
  return { version: 1, projectId, generatedAt, readOnly: true, sources: manifests };
}

/** Convert a pack to the existing picker representation without granting write access. */
export function contextPackItems(pack: ResearchContextPack): AiContextItem[] {
  return pack.sources.map(({ sourceId, label, detail, ref }) => ({ sourceId, label, detail, ref } as AiContextItem));
}

export function parseResearchContextPack(value: unknown): ResearchContextPack {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid research context pack.');
  const raw = value as Partial<ResearchContextPack>;
  if (raw.version !== 1 || raw.readOnly !== true || typeof raw.projectId !== 'string' || !Array.isArray(raw.sources)) throw new Error('Invalid research context pack.');
  return buildResearchContextPack(raw.projectId, raw.sources.map(item => {
    const source = item as AiContextManifest;
    return { sourceId: source.sourceId, label: source.label, detail: source.detail, kind: source.ref.kind, id: source.ref.id, sha256: source.sha256, value: source.value };
  }), raw.generatedAt);
}

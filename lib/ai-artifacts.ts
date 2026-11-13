import type { AiArtifact, AiArtifactSummary, AiArtifactTable } from './ai-workbench.ts';

export const aiArtifactGroup = (artifact: AiArtifactSummary) => artifact.artifactGroupId ?? artifact.id;
export function latestAiArtifacts(items: AiArtifactSummary[]): AiArtifactSummary[] {
  const groups = new Map<string, AiArtifactSummary>();
  for (const artifact of items) {
    const key = aiArtifactGroup(artifact), previous = groups.get(key);
    if (!previous || (artifact.version ?? 1) > (previous.version ?? 1)) groups.set(key, artifact);
  }
  return [...groups.values()];
}
export function aiArtifactCsv(table: AiArtifactTable): string {
  const cell = (value: unknown) => {
    let text = value == null ? '' : String(value);
    if (typeof value === 'string' && /^[\s]*[=+\-@\t\r]/.test(value)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return [table.columns.map(column => `${column.label}${column.unit ? ` (${column.unit})` : ''}`), ...table.rows.map(row => table.columns.map(column => row[column.key]))].map(row => row.map(cell).join(',')).join('\r\n');
}
/** Linear work, bounded output. A changed middle is explicit removed/added text, never a guessed alignment. */
export function aiArtifactDiff(before: string, after: string, maximum = 10000) {
  const left = before.split('\n'), right = after.split('\n');
  let prefix = 0, suffix = 0;
  while (prefix < Math.min(left.length, right.length) && left[prefix] === right[prefix]) prefix++;
  while (suffix < Math.min(left.length, right.length) - prefix && left[left.length - suffix - 1] === right[right.length - suffix - 1]) suffix++;
  const lines = [...left.slice(Math.max(0, prefix - 3), prefix).map(text => ` ${text}`), ...left.slice(prefix, left.length - suffix).map(text => `-${text}`), ...right.slice(prefix, right.length - suffix).map(text => `+${text}`), ...right.slice(right.length - suffix, right.length - suffix + 3).map(text => ` ${text}`)];
  return { text: `@@ -${prefix + 1},${left.length - prefix - suffix} +${prefix + 1},${right.length - prefix - suffix} @@\n${lines.slice(0, maximum).join('\n')}`, truncated: lines.length > maximum };
}
export function aiArtifactMarkdown(artifact: AiArtifact) {
  return `${artifact.content ?? artifact.text}\n\nSources and provenance\n\n${JSON.stringify({ sha256: artifact.sha256, modelId: artifact.modelId, sourceStamp: artifact.sourceStamp, contextManifest: artifact.contextManifest, evidence: artifact.evidence }, null, 2)}\n`;
}
export function aiArtifactComparable(artifact: AiArtifact): string {
  if (artifact.kind === 'input_file') return (artifact.structuredData as import('./ai-workbench.ts').AiArtifactInput).text;
  if (artifact.kind === 'diff') return (artifact.structuredData as import('./ai-workbench.ts').AiArtifactDiff).after;
  return artifact.structuredData ? JSON.stringify(artifact.structuredData, null, 2) : artifact.content ?? artifact.text;
}

/** Only typed text artifacts can be edited; scientific data tables remain structured. */
export function aiArtifactEditableText(artifact: AiArtifact): string | null {
  if (artifact.schemaVersion !== 2) return null;
  if (artifact.kind === 'input_file') return (artifact.structuredData as import('./ai-workbench.ts').AiArtifactInput).text;
  if (artifact.kind === 'diff') return (artifact.structuredData as import('./ai-workbench.ts').AiArtifactDiff).after;
  return artifact.kind === 'report' || artifact.kind === 'plan' ? artifact.content ?? artifact.text : null;
}

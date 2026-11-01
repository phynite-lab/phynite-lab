/** A compact review aid; the exact approved payload remains available separately. */
export type AiFieldChange = { path: string; before: unknown; after: unknown };
export function aiFieldChanges(before: unknown, after: unknown, path = ''): AiFieldChange[] {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
  if (record(after) || record(before)) {
    const left = record(before) ? before : {}, right = record(after) ? after : {};
    return [...new Set([...Object.keys(left), ...Object.keys(right)])].filter(key => !['id', 'compilerVersion', 'execution', 'configurationError'].includes(key)).flatMap(key => aiFieldChanges(left[key], right[key], path ? `${path}.${key}` : key));
  }
  return [{ path, before, after }];
}
export function aiFieldLabel(path: string): string {
  const key = path.split('.').at(-1)!;
  const labels: Record<string, string> = { saved: 'Saved', revision: 'Project revision', nodeIds: 'Updated modules', compilerVersion: 'Compiler version', configuration: 'Configuration', cutoff: 'Wavefunction cutoff (Ry)', chargeDensityCutoff: 'Charge density cutoff (Ry)', kPoint: 'K-grid X', kPointY: 'K-grid Y', kPointZ: 'K-grid Z', cutoffPolicy: 'Cutoff policy', fontPt: 'Font size (pt)', widthMm: 'Width (mm)', heightMm: 'Height (mm)', numberOfBands: 'Number of bands', components: 'MD stages', modifiers: 'Analysis modifiers' };
  return labels[key] ?? key.replace(/([a-z])([A-Z])/g, '$1 $2');
}

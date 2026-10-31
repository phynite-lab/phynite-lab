export type AiPaperEvidence = { title: string; url: string; authors: string[]; year: number; evidence: string; source: string };
/** Tool observations are arbitrary JSON. Only a complete literature schema is a paper list. */
export function aiLiteratureEvidence(text: string): { papers: AiPaperEvidence[]; warnings: string[] } | null {
  try {
    const value = JSON.parse(text);
    if (!value || !Array.isArray(value.papers) || !value.papers.every((paper: unknown) => {
      if (!paper || typeof paper !== 'object') return false;
      const item = paper as Record<string, unknown>;
      return ['title', 'url', 'evidence', 'source'].every(key => typeof item[key] === 'string') && typeof item.year === 'number' && Number.isFinite(item.year) && Array.isArray(item.authors) && item.authors.every(author => typeof author === 'string');
    }) || value.warnings !== undefined && (!Array.isArray(value.warnings) || !value.warnings.every((warning: unknown) => typeof warning === 'string'))) return null;
    return { papers: value.papers, warnings: value.warnings ?? [] };
  } catch { return null; }
}

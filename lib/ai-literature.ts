import { AiError } from './ai-provider.ts';

export type AiPaper = { title: string; authors: string[]; year: number | null; url: string; doi?: string; abstract?: string; citationCount?: number; evidence: 'metadata' | 'abstract'; source: 'Crossref' | 'arXiv' | 'OpenAlex'; retrievedAt: string };
const cache = new Map<string, { at: number; result: { papers: AiPaper[]; warnings: string[] } }>();
const cooldown = new Map<string, number>();
const plain = (value: string) => value.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
async function retrieve(url: URL, options: RequestInit, fetcher: typeof fetch): Promise<Response> {
  if (url.protocol !== 'https:' || !['api.crossref.org', 'export.arxiv.org', 'api.openalex.org', 'arxiv.org'].includes(url.hostname) || url.port || url.username || url.password) throw new Error('Unapproved literature endpoint.');
  if ((cooldown.get(url.hostname) ?? 0) > Date.now()) throw new Error('The literature source is cooling down after a rate limit.');
  const response = await fetcher(url, options);
  if (response.status === 429) {
    const retry = response.headers.get('retry-after');
    const milliseconds = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : retry ? Date.parse(retry) - Date.now() : 60000;
    cooldown.set(url.hostname, Date.now() + (Number.isFinite(milliseconds) ? Math.max(1000, milliseconds) : 60000));
    await response.body?.cancel();
    throw new Error('The literature source is rate limited.');
  }
  return response;
}
async function boundedText(response: Response): Promise<string> {
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error(`Literature provider status ${response.status}.`);
  }
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 1_000_000) throw new Error('The literature response is too large.'); chunks.push(value); }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  const data = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(data);
}
export function parseArxiv(text: string, retrievedAt: string, limit = 5): AiPaper[] {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('Unsupported literature XML.');
  const field = (entry: string, name: string) => plain(entry.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`))?.[1] ?? '');
  return [...text.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/g)].slice(0, limit).flatMap(([, entry]) => {
    const id = field(entry, 'id').replace(/^http:/, 'https:');
    if (!/^https:\/\/arxiv\.org\/abs\/[\w./-]+$/.test(id)) return [];
    const title = field(entry, 'title'), abstract = field(entry, 'summary').slice(0, 12000);
    const year = Number(field(entry, 'published').slice(0, 4)) || null;
    const doi = field(entry, 'arxiv:doi');
    return [{ title, ...(doi && /^10\.\d{4,9}\/[^\s<>]+$/.test(doi) ? { doi } : {}), authors: [...entry.matchAll(/<author>([\s\S]*?)<\/author>/g)].map(([, value]) => field(value, 'name')), year, url: id, abstract, evidence: abstract ? 'abstract' as const : 'metadata' as const, source: 'arXiv' as const, retrievedAt }];
  });
}
export async function searchAiPapers(query: string, signal: AbortSignal, fetcher: typeof fetch = fetch, selection: AiPaperSearchOptions = {}): Promise<{ papers: AiPaper[]; warnings: string[] }> {
  if (!publicQuery(query)) throw new AiError(400, 'AI_SEARCH_INVALID', 'Use research keywords, without credentials or private links.');
  const limit = selection.limit ?? 10, yearFrom = selection.yearFrom ?? 1800, yearTo = selection.yearTo ?? new Date().getUTCFullYear() + 1, sort = selection.sort ?? 'relevance';
  if (!Number.isInteger(limit) || limit < 1 || limit > 15 || !Number.isInteger(yearFrom) || !Number.isInteger(yearTo) || yearFrom < 1800 || yearTo > 2100 || yearFrom > yearTo || !['relevance', 'recent', 'citations'].includes(sort)) throw new AiError(400, 'AI_SEARCH_INVALID', 'Choose 1–15 papers, an ordered year range and a supported sort.');
  const key = query.trim().toLowerCase() + JSON.stringify({ limit, yearFrom, yearTo, sort }), cached = cache.get(key);
  if (cached && Date.now() - cached.at < 300000) return cached.result;
  const retrievedAt = new Date().toISOString();
  const headers = { Accept: 'application/json, application/atom+xml', 'User-Agent': 'PhyniteLab/1.0 (research literature lookup)' };
  // Workers supports manual/follow only. boundedText rejects 3xx responses without
  // following them, so research keywords stay within the fixed source endpoints.
  const options = { headers, redirect: 'manual' as const, signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]) };
  const results = await Promise.allSettled([
    (async () => {
      const url = new URL('https://api.crossref.org/works'); url.search = new URLSearchParams({ 'query.bibliographic': query.trim(), rows: String(limit), ...(selection.yearFrom || selection.yearTo ? { filter: `from-pub-date:${yearFrom}-01-01,until-pub-date:${yearTo}-12-31` } : {}), ...(sort !== 'relevance' ? { sort: sort === 'recent' ? 'published' : 'is-referenced-by-count', order: 'desc' } : {}) }).toString();
      const data = JSON.parse(await boundedText(await retrieve(url, options, fetcher))) as { message?: { items?: Array<Record<string, unknown>> } };
      return (data.message?.items ?? []).slice(0, limit).flatMap(item => {
        const doi = String(item.DOI ?? '');
        if (!/^10\.\d{4,9}\/[^\s]+$/.test(doi)) return [];
        const title = Array.isArray(item.title) ? plain(String(item.title[0])) : '';
        if (!title) return [];
        const abstract = typeof item.abstract === 'string' ? plain(item.abstract).slice(0, 12000) : undefined;
        const published = item.published as { 'date-parts'?: number[][] } | undefined;
        const authors = Array.isArray(item.author) ? item.author.slice(0, 30).map(person => { const p = person as { given?: string; family?: string }; return [p.given, p.family].filter(Boolean).join(' '); }) : [];
        return [{ title, authors, year: published?.['date-parts']?.[0]?.[0] ?? null, doi, citationCount: typeof item['is-referenced-by-count'] === 'number' ? item['is-referenced-by-count'] : undefined, url: `https://doi.org/${encodeURIComponent(doi)}`, abstract, evidence: abstract ? 'abstract' as const : 'metadata' as const, source: 'Crossref' as const, retrievedAt }];
      });
    })(),
    (async () => { const url = new URL('https://export.arxiv.org/api/query'); url.search = new URLSearchParams({ search_query: `all:"${query.replace(/["\\]/g, ' ')}"`, max_results: String(limit), sortBy: sort === 'recent' ? 'submittedDate' : 'relevance', sortOrder: 'descending' }).toString(); return parseArxiv(await boundedText(await retrieve(url, options, fetcher)), retrievedAt, limit); })(),
  ]);
  signal.throwIfAborted();
  const papers = results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
  const warnings = results.flatMap((result, i) => result.status === 'rejected' ? [`${i === 0 ? 'Crossref' : 'arXiv'} is temporarily unavailable; those results were not verified.`] : []);
  if (!papers.length && warnings.length === 2) throw new AiError(503, 'AI_LITERATURE_UNAVAILABLE', 'Literature search is temporarily unavailable. No references were verified.');
  const unique = papers.filter((paper, i) => papers.findIndex(p => p.doi && p.doi === paper.doi || p.title.toLowerCase() === paper.title.toLowerCase()) === i);
  const filtered = unique.filter(paper => paper.year === null ? !selection.yearFrom && !selection.yearTo : paper.year >= yearFrom && paper.year <= yearTo);
  if (sort === 'recent') filtered.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
  if (sort === 'citations') { filtered.sort((a, b) => (b.citationCount ?? -1) - (a.citationCount ?? -1)); warnings.push('Citation sorting uses returned citation counts; missing counts are unknown and arXiv supplies none.'); }
  const result = { papers: filtered.slice(0, limit), warnings };
  if (cache.size >= 64) cache.delete(cache.keys().next().value!);
  cache.set(key, { at: Date.now(), result });
  return result;
}


export type AiPaperSearchOptions = { limit?: number; yearFrom?: number; yearTo?: number; sort?: 'relevance' | 'citations' | 'recent' };
const publicQuery = (query: unknown): query is string => typeof query === 'string' && Boolean(query.trim()) && query.length <= 300 && !/https?:|sk-[\w-]{12,}|bearer\s|password|api[_-]?key|(?:aic|air|aia|aif|usr)_[a-z0-9]+|(?:project|dft|md):|[a-f0-9]{8}-[a-f0-9-]{27,}|\b(?:token|secret|credential)\s*[:=]/i.test(query);
const doiPattern = /^10\.\d{4,9}\/[^\s<>?#]{1,240}$/;
const arxivPattern = /^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d{1,3})?$/;
const baseArxiv = (id: string) => id.replace(/v\d+$/, '');
function crossrefPaper(item: Record<string, unknown>, retrievedAt: string): AiPaper | null {
  const doi = String(item.DOI ?? '');
  if (!doiPattern.test(doi) || !Array.isArray(item.title) || !item.title[0]) return null;
  const published = item.published as { 'date-parts'?: number[][] } | undefined;
  const abstract = typeof item.abstract === 'string' ? plain(item.abstract).slice(0, 12000) : undefined;
  return { doi, title: plain(String(item.title[0])), authors: Array.isArray(item.author) ? item.author.slice(0, 30).map(person => { const p = person as { given?: string; family?: string }; return [p.given, p.family].filter(Boolean).join(' '); }) : [], year: published?.['date-parts']?.[0]?.[0] ?? null, abstract, evidence: abstract ? 'abstract' : 'metadata', source: 'Crossref', url: `https://doi.org/${encodeURIComponent(doi)}`, retrievedAt };
}
function openalexPaper(item: Record<string, unknown>, retrievedAt: string): AiPaper | null {
  if (typeof item.title !== 'string' || !item.title.trim()) return null;
  const doi = typeof item.doi === 'string' ? item.doi.replace(/^https:\/\/doi\.org\//, '') : undefined;
  const id = String(item.id ?? '');
  if (!(doi && doiPattern.test(doi)) && !/^https:\/\/openalex\.org\/W\d+$/.test(id)) return null;
  return { title: plain(item.title), doi: doi && doiPattern.test(doi) ? doi : undefined, authors: Array.isArray(item.authorships) ? item.authorships.slice(0, 30).map(row => String((row as { author?: { display_name?: string } }).author?.display_name ?? '')).filter(Boolean) : [], year: typeof item.publication_year === 'number' ? item.publication_year : null, citationCount: typeof item.cited_by_count === 'number' ? item.cited_by_count : undefined, url: doi && doiPattern.test(doi) ? `https://doi.org/${encodeURIComponent(doi)}` : id, source: 'OpenAlex', evidence: 'metadata', retrievedAt };
}
/** Text parsing only: no DOM, script execution, resource loads or arbitrary OA destinations. */
export function parseOaSections(html: string) {
  const safe = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|svg|math|iframe|object|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  const sections: Array<{ title: string; text: string }> = [];
  let title = 'Full-text excerpt', text = '';
  const flush = () => { if (text.trim() && sections.length < 40) sections.push({ title, text: text.trim().slice(0, 8000) }); text = ''; };
  for (const match of safe.matchAll(/<(h[1-6]|p)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)) {
    if (/^h/i.test(match[1])) { flush(); title = plain(match[2]).slice(0, 200); }
    else if (text.length < 8000) text += plain(match[2]) + '\n\n';
    if (sections.reduce((sum, row) => sum + row.text.length, 0) + text.length > 40000) break;
  }
  flush(); return sections;
}
export async function lookupAiPaper(input: { doi?: string; arxivId?: string; includeCitations?: boolean; includeReferences?: boolean; includeOaSections?: boolean }, signal: AbortSignal, fetcher: typeof fetch = fetch) {
  const { doi, arxivId } = input;
  if (Boolean(doi) === Boolean(arxivId) || doi !== undefined && (typeof doi !== 'string' || !doiPattern.test(doi) || !publicQuery(doi)) || arxivId !== undefined && (typeof arxivId !== 'string' || !arxivPattern.test(arxivId)) || ['includeCitations', 'includeReferences', 'includeOaSections'].some(key => input[key as keyof typeof input] !== undefined && typeof input[key as keyof typeof input] !== 'boolean')) throw new AiError(400, 'AI_PAPER_ID_INVALID', 'Provide exactly one public DOI or arXiv ID and boolean lookup options.');
  const retrievedAt = new Date().toISOString(), warnings: string[] = [];
  const options = { redirect: 'manual' as const, headers: { Accept: 'application/json, application/atom+xml, text/html', 'User-Agent': 'PhyniteLab/1.0 (research literature lookup)' }, signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]) };
  const get = async (url: string) => boundedText(await retrieve(new URL(url), options, fetcher));
  let paper: AiPaper | null = null, graph: Record<string, unknown> | null = null;
  const results = await Promise.allSettled([
    (async () => {
      if (doi) { const data = JSON.parse(await get(`https://api.crossref.org/works/${encodeURIComponent(doi)}`)); const row = crossrefPaper(data.message ?? {}, retrievedAt); return row?.doi?.toLowerCase() === doi.toLowerCase() ? row : null; }
      const rows = parseArxiv(await get(`https://export.arxiv.org/api/query?${new URLSearchParams({ id_list: arxivId! })}`), retrievedAt);
      return rows.find(row => baseArxiv(row.url.replace('https://arxiv.org/abs/', '')) === baseArxiv(arxivId!)) ?? null;
    })(),
    (async () => doi && (input.includeCitations || input.includeReferences || input.includeOaSections) ? JSON.parse(await get(`https://api.openalex.org/works/https://doi.org/${encodeURIComponent(doi)}`)) as Record<string, unknown> : null)(),
  ]);
  if (results[0].status === 'fulfilled') paper = results[0].value; else warnings.push('The primary identifier lookup is unavailable.');
  if (results[1].status === 'fulfilled') graph = results[1].value; else warnings.push('OpenAlex lookup is unavailable; graph data were not verified.');
  if (graph && doi && String(graph.doi ?? '').toLowerCase() !== `https://doi.org/${doi}`.toLowerCase()) { graph = null; warnings.push('OpenAlex returned a different identifier; graph data were discarded.'); }
  if (!paper && graph) paper = openalexPaper(graph, retrievedAt);
  signal.throwIfAborted();
  if (!paper) throw new AiError(503, 'AI_PAPER_UNAVAILABLE', 'No matching paper was verified for this identifier.');
  if (!graph && arxivId && paper.doi && doiPattern.test(paper.doi) && (input.includeCitations || input.includeReferences)) {
    try { const row = JSON.parse(await get(`https://api.openalex.org/works/https://doi.org/${encodeURIComponent(paper.doi)}`)); if (String(row.doi).toLowerCase() === `https://doi.org/${paper.doi}`.toLowerCase()) graph = row; } catch { warnings.push('The arXiv paper’s verified DOI graph is unavailable.'); }
  }
  const references: AiPaper[] = [], citations: AiPaper[] = [];
  const graphId = /^https:\/\/openalex\.org\/(W\d+)$/.exec(String(graph?.id ?? ''))?.[1];
  if (input.includeReferences || input.includeCitations) {
    if (!graphId) warnings.push('No verified OpenAlex identity is available for the requested graph.');
    else {
      const jobs: Array<Promise<void>> = [];
      const loadGraph = async (filter: string, target: AiPaper[]) => { const data = JSON.parse(await get(`https://api.openalex.org/works?${new URLSearchParams({ filter, per_page: '15', sort: 'cited_by_count:desc' })}`)); for (const item of (Array.isArray(data.results) ? data.results : []).slice(0, 15)) { const row = openalexPaper(item, retrievedAt); if (row) target.push(row); } };
      if (input.includeCitations) jobs.push(loadGraph(`cites:${graphId}`, citations));
      const ids = (Array.isArray(graph?.referenced_works) ? graph.referenced_works : []).map(id => /^https:\/\/openalex\.org\/(W\d+)$/.exec(String(id))?.[1]).filter(Boolean).slice(0, 15);
      if (input.includeReferences && ids.length) jobs.push(loadGraph(`openalex_id:${ids.join('|')}`, references));
      for (const result of await Promise.allSettled(jobs)) if (result.status === 'rejected') warnings.push('Part of the requested citation/reference graph is unavailable.');
    }
  }
  let oaSections: ReturnType<typeof parseOaSections> = [];
  if (input.includeOaSections) {
    let verifiedArxiv = paper.source === 'arXiv' ? paper.url.replace('https://arxiv.org/abs/', '') : undefined;
    if (!verifiedArxiv && paper.doi && graph) {
      const locations = [graph.primary_location, ...(Array.isArray(graph.locations) ? graph.locations.slice(0, 30) : [])];
      const candidate = locations.flatMap(location => { const url = String((location as { landing_page_url?: string } | null)?.landing_page_url ?? ''); const id = /^https:\/\/arxiv\.org\/abs\/([\w./-]+)$/.exec(url)?.[1]; return id && arxivPattern.test(id) ? [id] : []; })[0];
      if (candidate) {
        try { const rows = parseArxiv(await get(`https://export.arxiv.org/api/query?${new URLSearchParams({ id_list: candidate })}`), retrievedAt); const associated = rows.find(row => row.doi?.toLowerCase() === paper!.doi!.toLowerCase() && baseArxiv(row.url.replace('https://arxiv.org/abs/', '')) === baseArxiv(candidate)); if (associated) verifiedArxiv = associated.url.replace('https://arxiv.org/abs/', ''); } catch { warnings.push('The DOI/arXiv association could not be verified; full text was not read.'); }
      }
    }
    if (verifiedArxiv && arxivPattern.test(verifiedArxiv)) { try { oaSections = parseOaSections(await get(`https://arxiv.org/html/${verifiedArxiv}`)); } catch { warnings.push('arXiv HTML is unavailable; no full text was read.'); } }
    else warnings.push('Full text is restricted to verified arXiv HTML; no arbitrary OA host was fetched.');
  }
  signal.throwIfAborted();
  return { paper, references, citations, oaSections, evidence: oaSections.length ? 'oa_full_text' : paper.evidence, retrievedAt, warnings, readingLimit: 'Graphs contain at most 15 records per direction. OA sections are bounded text excerpts, not figures, embedded mathematics, page layout or a claim of complete coverage.' };
}

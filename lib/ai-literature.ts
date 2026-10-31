import { AiError } from './ai-provider.ts';

export type AiPaper = { title: string; authors: string[]; year: number | null; url: string; doi?: string; abstract?: string; evidence: 'metadata' | 'abstract'; source: 'Crossref' | 'arXiv'; retrievedAt: string };
const cache = new Map<string, { at: number; result: { papers: AiPaper[]; warnings: string[] } }>();
const cooldown = new Map<string, number>();
const plain = (value: string) => value.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
async function retrieve(url: URL, options: RequestInit, fetcher: typeof fetch): Promise<Response> {
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
export function parseArxiv(text: string, retrievedAt: string): AiPaper[] {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('Unsupported literature XML.');
  const field = (entry: string, name: string) => plain(entry.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`))?.[1] ?? '');
  return [...text.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/g)].slice(0, 5).flatMap(([, entry]) => {
    const id = field(entry, 'id').replace(/^http:/, 'https:');
    if (!/^https:\/\/arxiv\.org\/abs\/[\w./-]+$/.test(id)) return [];
    const title = field(entry, 'title'), abstract = field(entry, 'summary').slice(0, 12000);
    const year = Number(field(entry, 'published').slice(0, 4)) || null;
    return [{ title, authors: [...entry.matchAll(/<author>([\s\S]*?)<\/author>/g)].map(([, value]) => field(value, 'name')), year, url: id, abstract, evidence: abstract ? 'abstract' as const : 'metadata' as const, source: 'arXiv' as const, retrievedAt }];
  });
}
export async function searchAiPapers(query: string, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<{ papers: AiPaper[]; warnings: string[] }> {
  if (typeof query !== 'string' || !query.trim() || query.length > 300 || /https?:|sk-[\w-]{12,}|bearer\s|password|api[_-]?key/i.test(query)) throw new AiError(400, 'AI_SEARCH_INVALID', 'Use research keywords, without credentials or private links.');
  const key = query.trim().toLowerCase(), cached = cache.get(key);
  if (cached && Date.now() - cached.at < 300000) return cached.result;
  const retrievedAt = new Date().toISOString();
  const headers = { Accept: 'application/json, application/atom+xml', 'User-Agent': 'PhyniteLab/1.0 (research literature lookup)' };
  // Workers supports manual/follow only. boundedText rejects 3xx responses without
  // following them, so research keywords stay within the fixed source endpoints.
  const options = { headers, redirect: 'manual' as const, signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]) };
  const results = await Promise.allSettled([
    (async () => {
      const url = new URL('https://api.crossref.org/works'); url.search = new URLSearchParams({ 'query.bibliographic': query.trim(), rows: '5' }).toString();
      const data = JSON.parse(await boundedText(await retrieve(url, options, fetcher))) as { message?: { items?: Array<Record<string, unknown>> } };
      return (data.message?.items ?? []).slice(0, 5).flatMap(item => {
        const doi = String(item.DOI ?? '');
        if (!/^10\.\d{4,9}\/[^\s]+$/.test(doi)) return [];
        const title = Array.isArray(item.title) ? plain(String(item.title[0])) : '';
        if (!title) return [];
        const abstract = typeof item.abstract === 'string' ? plain(item.abstract).slice(0, 12000) : undefined;
        const published = item.published as { 'date-parts'?: number[][] } | undefined;
        const authors = Array.isArray(item.author) ? item.author.slice(0, 30).map(person => { const p = person as { given?: string; family?: string }; return [p.given, p.family].filter(Boolean).join(' '); }) : [];
        return [{ title, authors, year: published?.['date-parts']?.[0]?.[0] ?? null, doi, url: `https://doi.org/${encodeURIComponent(doi)}`, abstract, evidence: abstract ? 'abstract' as const : 'metadata' as const, source: 'Crossref' as const, retrievedAt }];
      });
    })(),
    (async () => { const url = new URL('https://export.arxiv.org/api/query'); url.search = new URLSearchParams({ search_query: `all:"${query.replace(/["\\]/g, ' ')}"`, max_results: '5' }).toString(); return parseArxiv(await boundedText(await retrieve(url, options, fetcher)), retrievedAt); })(),
  ]);
  signal.throwIfAborted();
  const papers = results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
  const warnings = results.flatMap((result, i) => result.status === 'rejected' ? [`${i === 0 ? 'Crossref' : 'arXiv'} is temporarily unavailable; those results were not verified.`] : []);
  if (!papers.length && warnings.length === 2) throw new AiError(503, 'AI_LITERATURE_UNAVAILABLE', 'Literature search is temporarily unavailable. No references were verified.');
  const unique = papers.filter((paper, i) => papers.findIndex(p => p.doi && p.doi === paper.doi || p.title.toLowerCase() === paper.title.toLowerCase()) === i);
  const result = { papers: unique, warnings };
  if (cache.size >= 64) cache.delete(cache.keys().next().value!);
  cache.set(key, { at: Date.now(), result });
  return result;
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { searchAiPapers } from '../lib/ai-literature.ts';
import { AiError } from '../lib/ai-provider.ts';

const arxiv = '<feed><entry><id>https://arxiv.org/abs/2601.12345</id><title>Literature regression fixture</title><published>2026-01-01</published><author><name>Fixture author</name></author><summary>Fixture abstract, not a scientific result.</summary></entry></feed>';

test('literature requests use the Workers-compatible redirect mode on both sources', async () => {
  const requests: Request[] = [];
  const result = await searchAiPapers('workers literature fixture', AbortSignal.timeout(5000), async (url, options) => {
    const request = new Request(url, options);
    requests.push(request);
    assert.equal(request.redirect, 'manual');
    return request.url.startsWith('https://api.crossref.org/')
      ? Response.json({ message: { items: [{ DOI: '10.1234/workers-fixture', title: ['Crossref fixture'], published: { 'date-parts': [[2025]] } }] } })
      : new Response(arxiv);
  });
  assert.deepEqual(requests.map(request => new URL(request.url).hostname).sort(), ['api.crossref.org', 'export.arxiv.org']);
  assert.equal(result.papers.length, 2);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.papers[0].evidence, 'metadata');
  assert.equal(result.papers[1].evidence, 'abstract');
});

test('a source redirect is rejected without sending the query to its destination', async () => {
  const urls: string[] = [];
  let cancelled = false;
  const result = await searchAiPapers('redirect isolation fixture', AbortSignal.timeout(5000), async (url, options) => {
    urls.push(String(url));
    assert.equal(options?.redirect, 'manual');
    return new URL(String(url)).hostname === 'api.crossref.org'
      ? new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 302, headers: { Location: 'https://example.invalid/collect' } })
      : new Response(arxiv);
  });
  assert.equal(urls.length, 2);
  assert.ok(urls.every(url => !url.includes('example.invalid')));
  assert.equal(cancelled, true);
  assert.equal(result.papers.length, 1);
  assert.equal(result.papers[0].source, 'arXiv');
  assert.match(result.warnings[0], /Crossref is temporarily unavailable/);
});

test('redirects from both sources produce an explicit failure, never invented citations', async () => {
  await assert.rejects(searchAiPapers('both sources redirect fixture', AbortSignal.timeout(5000), async () =>
    new Response(null, { status: 301, headers: { Location: 'https://example.invalid/collect' } })),
  (error: unknown) => error instanceof AiError && error.code === 'AI_LITERATURE_UNAVAILABLE');
});

test('DOI lookup returns verified bounded citation/reference records through fixed hosts', async () => {
  const { lookupAiPaper } = await import('../lib/ai-literature.ts');
  const urls: string[] = [];
  const result = await lookupAiPaper({ doi: '10.1234/paper-fixture', includeReferences: true, includeCitations: true, includeOaSections: true }, AbortSignal.timeout(5000), async (url, init) => {
    const value = new URL(String(url)); urls.push(value.href); assert.equal(init?.redirect, 'manual');
    if (value.hostname === 'api.crossref.org') return Response.json({ message: { DOI: '10.1234/paper-fixture', title: ['Exact DOI fixture'], published: { 'date-parts': [[2025]] } } });
    assert.equal(value.hostname, 'api.openalex.org');
    if (!value.search) return Response.json({ id: 'https://openalex.org/W1234', doi: 'https://doi.org/10.1234/paper-fixture', referenced_works: ['https://openalex.org/W5678', 'https://private.invalid/leak'], title: 'Exact DOI fixture' });
    return Response.json({ results: [{ id: 'https://openalex.org/W5678', doi: 'https://doi.org/10.1234/reference', title: 'Verified graph fixture', publication_year: 2024, cited_by_count: 23 }] });
  });
  assert.equal(result.paper.doi, '10.1234/paper-fixture'); assert.equal(result.citations.length, 1); assert.equal(result.references[0].citationCount, 23);
  assert.ok(urls.every(url => !url.includes('private.invalid'))); assert.equal(result.evidence, 'metadata');
  assert.ok(result.warnings.some(w => w.includes('no arbitrary OA host')));
});

test('verified arXiv HTML supplies bounded text without executing or loading embedded resources', async () => {
  const { lookupAiPaper, parseOaSections } = await import('../lib/ai-literature.ts');
  const html = '<h1>Methods</h1><p>Exact method text with 80 Ry.</p><script><p>evil script text</p></script><iframe src="http://private.invalid"></iframe><img src="http://private.invalid">';
  assert.deepEqual(parseOaSections(html), [{ title: 'Methods', text: 'Exact method text with 80 Ry.' }]);
  const urls: string[] = [];
  const result = await lookupAiPaper({ arxivId: '2601.12345', includeOaSections: true }, AbortSignal.timeout(5000), async (url, init) => {
    urls.push(String(url)); assert.equal(init?.redirect, 'manual'); return new Response(new URL(String(url)).hostname === 'export.arxiv.org' ? arxiv : html);
  });
  assert.equal(result.evidence, 'oa_full_text'); assert.match(result.oaSections[0].text, /80 Ry/); assert.equal(urls.length, 2);
  assert.ok(urls.every(url => !url.includes('private.invalid')));
});

test('identifier mismatch, redirects, oversized sources and private queries never invent citations', async () => {
  const { lookupAiPaper } = await import('../lib/ai-literature.ts');
  const signal = AbortSignal.timeout(5000);
  for (const input of [{ doi: 'https://private.invalid' }, { doi: '10.1234/aic_private' }, { doi: '10.1234/a', arxivId: '2601.12345' }, { arxivId: '../../private' }]) await assert.rejects(lookupAiPaper(input, signal, async () => { throw Error('should not fetch'); }), /public DOI or arXiv/);
  await assert.rejects(lookupAiPaper({ doi: '10.1234/requested' }, signal, async () => Response.json({ message: { DOI: '10.1234/different', title: ['Wrong identity'] } })), /No matching paper/);
  await assert.rejects(lookupAiPaper({ arxivId: '2601.12345' }, signal, async () => new Response(null, { status: 302, headers: { Location: 'http://private.invalid' } })), /No matching paper/);
  await assert.rejects(lookupAiPaper({ arxivId: '2601.12345' }, signal, async () => new Response('x'.repeat(1_000_001))), /No matching paper/);
  await assert.rejects(searchAiPapers('project:private-owner', signal), /research keywords/);
});

test('search controls bound and filter results with provider-supported sorting', async () => {
  const urls: URL[] = [];
  const result = await searchAiPapers('search controls fixture', AbortSignal.timeout(5000), async url => {
    const value = new URL(String(url)); urls.push(value);
    return value.hostname === 'api.crossref.org' ? Response.json({ message: { items: [{ DOI: '10.1234/new', title: ['New fixture'], published: { 'date-parts': [[2025]] }, 'is-referenced-by-count': 10 }, { DOI: '10.1234/old', title: ['Old fixture'], published: { 'date-parts': [[2010]] } }] } }) : new Response(arxiv);
  }, { limit: 1, yearFrom: 2020, yearTo: 2026, sort: 'citations' });
  assert.equal(result.papers.length, 1); assert.equal(result.papers[0].year, 2025);
  assert.equal(urls[0].searchParams.get('rows'), '1'); assert.equal(urls[0].searchParams.get('sort'), 'is-referenced-by-count');
});

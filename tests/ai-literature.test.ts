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

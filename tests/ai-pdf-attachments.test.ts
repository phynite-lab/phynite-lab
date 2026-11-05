import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { aiPdfReadingLimit, runAiAgent } from '../lib/ai-agent.ts';
import type { AiAttachment, AiDetail } from '../lib/ai-contract.ts';
import { AiError, type AiProviderConfig } from '../lib/ai-provider.ts';
import type { AiBackend } from '../lib/ai-tools.ts';

const modelId = 'codex/pdf-transport-fixture';
const config: AiProviderConfig = { baseUrl: 'http://127.0.0.1:49127', token: 'fixture-service', providerId: 'local', local: true, modelIds: [modelId] };
const sourceUrl = 'http://127.0.0.1:49128/attachment-private-source';
function attachment(sizeBytes = 1024): AiAttachment {
  return { id: 'aif_pdf_fixture', conversationId: 'aic_pdf_fixture', filename: 'research-reference.pdf', mediaType: 'application/pdf', sizeBytes, sha256: '0'.repeat(64), status: 'ready', visual: true };
}
function detail(initialAttachment = true): AiDetail {
  return {
    conversation: { id: 'aic_pdf_fixture', title: 'PDF transport regression', projectKey: null, modelId, providerId: 'local', mode: 'chat', revision: 1, activeRunId: 'air_pdf_fixture', createdAt: '', updatedAt: '' },
    run: { id: 'air_pdf_fixture', status: 'running', modelId, providerId: 'local', mode: 'chat', steps: 0, revision: 0, expiresAt: Date.now() / 1000 + 600 },
    actions: [], messages: [{ id: 'aim_pdf_fixture', conversationId: 'aic_pdf_fixture', role: 'user', text: 'Read the attached source and state any reading limits.', runId: 'air_pdf_fixture', modelId, createdAt: '', ...(initialAttachment ? { attachmentIds: ['aif_pdf_fixture'] } : {}) }],
  };
}
function completion(tool?: { name: string; input: Record<string, unknown> }): Response {
  const block = tool ? { type: 'tool_use', id: 'tool_pdf_fixture', name: tool.name, input: tool.input } : { type: 'text', text: 'The available source and reading limits were inspected.' };
  const events = [
    { type: 'message_start', message: { usage: { input_tokens: 12 } } },
    { type: 'content_block_start', index: 0, content_block: block },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: tool ? 'tool_use' : 'end_turn' }, usage: { output_tokens: 10 } },
    { type: 'message_stop' },
  ];
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } });
}
const extracted = { attachment: attachment(), sections: [{ reference: 'page 2', text: 'Transport fixture text from the source.' }], totalSections: 8, nextOffset: 1, warnings: ['Figures and page layout have not been read.'], untrusted: true };
function backendFixture(file: AiAttachment, extraction: Omit<typeof extracted, 'nextOffset'> & { nextOffset: number | null } = extracted) {
  const calls: Array<{ operation: string; payload?: Record<string, unknown> }> = [];
  const backend: AiBackend = async <T,>(operation: string, payload?: Record<string, unknown>) => {
    calls.push({ operation, payload });
    return (operation === 'attachment_provider' ? { attachment: file, url: sourceUrl } : operation === 'attachment_read' ? { ...extraction, attachment: file } : { saved: true }) as T;
  };
  return { backend, calls };
}
function textOnlyPdfGuard(mediaType: string) {
  if (mediaType === 'application/pdf') throw new AiError(422, 'AI_PDF_UNSUPPORTED', 'Native PDF input is unverified.');
}
function assertTextFallback(request: Record<string, unknown>) {
  assert.equal(request.model, modelId);
  const messages = request.messages as Array<{ content: unknown }>;
  for (const message of messages) if (Array.isArray(message.content)) {
    assert.ok(message.content.every(block => !['document', 'image'].includes(block.type)), 'An unsupported native PDF block was sent to the model.');
  }
  const text = JSON.stringify(messages);
  assert.match(text, /Transport fixture text/);
  assert.match(text, /page 2/);
  assert.match(text, /untrusted/i);
  assert.match(text, /Figures and page layout/);
  assert.match(text, /nextOffset/);
  assert.doesNotMatch(text, /attachment-private-source/);
}

test('text-only providers read extracted PDF sections without fetching binary or changing model', async t => {
  const mock = backendFixture(attachment());
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Text-only provider fetched private PDF bytes'); });
  let requests = 0;
  await runAiAgent({ detail: detail(), backend: mock.backend, config, send() {}, signal: new AbortController().signal, assertAttachment: textOnlyPdfGuard,
    providerFetch: async (_url, init) => { requests++; assertTextFallback(JSON.parse(String(init?.body))); return completion(); } });
  assert.equal(requests, 1);
  assert.ok(mock.calls.some(call => call.operation === 'attachment_read' && call.payload?.id === 'aif_pdf_fixture'));
  assert.ok(mock.calls.some(call => call.operation === 'finish' && call.payload?.status === 'completed'));
});

test('13 MB and 23 MB PDFs use extracted evidence even when the model supports native PDF input', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Oversized PDF was buffered for model input'); });
  for (const sizeMiB of [13, 23]) {
    const mock = backendFixture(attachment(sizeMiB * 1024 ** 2));
    let requests = 0;
    await runAiAgent({ detail: detail(), backend: mock.backend, config, send() {}, signal: new AbortController().signal, assertAttachment() {},
      providerFetch: async (_url, init) => { requests++; assertTextFallback(JSON.parse(String(init?.body))); return completion(); } });
    assert.equal(requests, 1);
    assert.ok(mock.calls.some(call => call.operation === 'attachment_read'));
  }
});

test('scanned PDFs report unreadable visual content and an actionable recovery instead of inventing text', async t => {
  const mock = backendFixture(attachment(), { attachment: attachment(), sections: [], totalSections: 0, nextOffset: null, warnings: ['Scanned source: no extractable text.'], untrusted: true });
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unsupported PDF source fetched'); });
  await runAiAgent({ detail: detail(), backend: mock.backend, config, send() {}, signal: new AbortController().signal, assertAttachment: textOnlyPdfGuard,
    providerFetch: async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      assert.equal(request.model, modelId);
      const text = JSON.stringify(request.messages);
      assert.match(text, /no (?:extractable|readable) text|no text/i);
      assert.match(text, /OCR|page image|image.*page/i);
      assert.doesNotMatch(text, /"type":"document"|"type":"image"|Transport fixture text/);
      return completion();
    } });
});

test('PDF fallback cannot bypass an unverified model, effort or unsupported image guard', async () => {
  for (const code of ['AI_MODEL_UNVERIFIED', 'AI_EFFORT_UNSUPPORTED', 'AI_IMAGE_UNSUPPORTED']) {
    const mock = backendFixture(attachment());
    let requests = 0;
    await assert.rejects(runAiAgent({ detail: detail(), backend: mock.backend, config, send() {}, signal: new AbortController().signal,
      assertAttachment() { throw new AiError(422, code, 'Verified provider checks are required.'); },
      providerFetch: async () => { requests++; return completion(); } }), { code });
    assert.equal(requests, 0);
    assert.equal(mock.calls.some(call => call.operation === 'attachment_read'), false);
    assert.ok(mock.calls.some(call => call.operation === 'finish' && call.payload?.status === 'failed'));
  }
});

test('verified small native PDFs retain checksum validation and the exact PDF media block', async t => {
  const bytes = new TextEncoder().encode('%PDF-1.4\ntransport fixture only');
  const checksum = createHash('sha256').update(bytes).digest('hex');
  const mock = backendFixture({ ...attachment(bytes.length), sha256: checksum });
  let sourceRequests = 0;
  t.mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => { sourceRequests++; assert.equal(url, sourceUrl); assert.equal(init?.redirect, 'manual'); return new Response(bytes); });
  await runAiAgent({ detail: detail(), backend: mock.backend, config, send() {}, signal: new AbortController().signal, assertAttachment() {},
    providerFetch: async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      const documents = request.messages.flatMap((message: { content: unknown }) => Array.isArray(message.content) ? message.content : []).filter((block: { type: string }) => block.type === 'document');
      assert.equal(documents.length, 1);
      assert.equal(documents[0].source.media_type, 'application/pdf');
      assert.deepEqual(Buffer.from(documents[0].source.data, 'base64'), Buffer.from(bytes));
      return completion();
    } });
  assert.equal(sourceRequests, 1);
  assert.equal(mock.calls.some(call => call.operation === 'attachment_read'), false);
});

test('a later read_attachment request uses the same PDF text fallback', async t => {
  const mock = backendFixture(attachment());
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Tool-triggered fallback fetched unsupported PDF bytes'); });
  let requests = 0;
  await runAiAgent({ detail: detail(false), backend: mock.backend, config, send() {}, signal: new AbortController().signal, assertAttachment: textOnlyPdfGuard,
    providerFetch: async (_url, init) => {
      requests++;
      if (requests === 1) return completion({ name: 'read_attachment', input: { id: 'aif_pdf_fixture' } });
      assertTextFallback(JSON.parse(String(init?.body)));
      return completion();
    } });
  assert.equal(requests, 2);
  assert.ok(mock.calls.some(call => call.operation === 'finish' && call.payload?.status === 'completed'));
});

test('a PDF whose extraction was deferred is not described as having no text layer', () => {
  const deferred = { attachment: attachment(300 * 1024 ** 2), sections: [], totalSections: 0, nextOffset: null, warnings: ['Local extraction is deferred above the reader budget.'], untrusted: true };
  const note = aiPdfReadingLimit('size', deferred);
  assert.doesNotMatch(note, /has no extractable text/);
  assert.match(note, /No readable text was extracted/);
  assert.match(note, /warnings state why/);
  assert.match(note, /split it into PDFs under 10 MiB/);
});

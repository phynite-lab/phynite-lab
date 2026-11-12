/** Private loopback transport. Subscription authentication belongs to each local CLI. */
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { NativeAiRegistry } from './native-ai.mjs';
import { LocalMcpRegistry } from './local-mcp.mjs';

const equal = (a, b) => typeof a === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export async function createLocalAiServer({ dataDir, registry = new NativeAiRegistry({ dataDir }), mcp = new LocalMcpRegistry({ dataDir }) }) {
  const token = randomBytes(32).toString('hex');
  const active = new Set();
  let origin;
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const json = (status, value) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)); };
    if (request.headers.origin || request.headers.host !== new URL(origin).host) { json(403, { error: 'Private local AI transport.', code: 'LOCAL_AI_FORBIDDEN' }); return; }
    if (request.url === '/health' && request.method === 'GET') { json(200, { ready: true }); return; }
    if (!equal(request.headers.authorization, `Bearer ${token}`)) { json(403, { error: 'Private local AI transport.', code: 'LOCAL_AI_FORBIDDEN' }); return; }
    const abort = new AbortController();
    const interrupted = () => { if (!response.writableEnded) abort.abort(); };
    request.once('aborted', interrupted); response.once('close', interrupted);
    active.add(abort);
    try {
      if (request.method === 'GET' && request.url === '/status') { json(200, await registry.status()); return; }
      if (request.method === 'GET' && request.url === '/usage') { json(200, await registry.usage()); return; }
      if (request.method === 'GET' && request.url === '/mcp/servers') { json(200, await mcp.list({ signal: abort.signal })); return; }
      if (request.method !== 'POST' || !['/connect', '/login', '/disconnect', '/models', '/probe', '/v1/messages', '/mcp/servers', '/mcp/tools', '/mcp/validate', '/mcp/call'].includes(request.url)) { json(404, { error: 'Local AI operation not found.', code: 'NOT_FOUND' }); return; }
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) { json(415, { error: 'Send JSON to the local AI service.', code: 'INVALID_CONTENT_TYPE' }); return; }
      const chunks = []; let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 4 * 1024 ** 2) { json(413, { error: 'The AI context is too large.', code: 'AI_CONTEXT_LIMIT' }); return; }
        chunks.push(chunk);
      }
      let payload;
      try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { json(400, { error: 'Send a valid JSON object.', code: 'INVALID_JSON' }); return; }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) { json(400, { error: 'Send a JSON object.', code: 'INVALID_JSON' }); return; }
      if (request.url.startsWith('/mcp/')) {
        const value = request.url === '/mcp/servers' ? await mcp.setEnabled(payload, { signal: abort.signal }) : request.url === '/mcp/tools' ? await mcp.list({ signal: abort.signal }) : await mcp.invoke(payload, { signal: abort.signal, execute: request.url === '/mcp/call' });
        json(200, value); return;
      }
      if (request.url === '/v1/messages') {
        response.writeHead(200, { 'Content-Type': 'text/event-stream', 'X-Accel-Buffering': 'no' });
        const heartbeat = setInterval(() => { if (!abort.signal.aborted) response.write(': heartbeat\n\n'); }, 10000);
        try {
          for await (const event of registry.stream(payload, { signal: abort.signal })) {
            if (abort.signal.aborted) break;
            response.write(`data: ${JSON.stringify(event)}\n\n`);
          }
        } finally { clearInterval(heartbeat); }
        response.end(); return;
      }
      const methods = { '/connect': () => registry.connect(payload.provider, { signal: abort.signal }), '/login': () => registry.login(payload.provider, { signal: abort.signal }), '/disconnect': () => registry.disconnect(payload.provider), '/models': async () => {
        // Catalog checks can involve several models. Return cached state now;
        // clients follow checkingModels without blocking the usable choices.
        void registry.models().catch(() => {});
        return registry.status();
      }, '/probe': () => registry.probe(payload.modelId ?? payload.model, { signal: abort.signal }) };
      json(200, await methods[request.url]());
    } catch (error) {
      if (abort.signal.aborted) { response.end(); return; }
      const code = typeof error.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(error.code) ? error.code : 'LOCAL_AI_FAILED';
      const safeCodes = new Set(['AUTH_REQUIRED', 'CLI_MISSING', 'UNVERIFIED_VERSION', 'NOT_CONNECTED', 'INVALID_MODEL', 'INVALID_ACCOUNT', 'UNSAFE_TOOLS', 'UNSAFE_CONFIGURATION', 'PROBE_FAILED', 'UNSUPPORTED_EFFORT', 'CLI_START_FAILED', 'INFERENCE_FAILED', 'INCOMPLETE_RESPONSE', 'INVALID_PROTOCOL', 'UNVERIFIED_MODEL', 'LOGIN_FAILED', 'INVALID_REQUEST', 'AI_CONTEXT_LIMIT']);
      const message = error.safeMessage || (safeCodes.has(code) && typeof error.message === 'string' ? error.message.replace(/(?:bearer\s+|sk-[A-Za-z0-9_-]{16,})\S*/ig, '[redacted]').slice(0, 500) : 'The local AI connection could not finish. Check its connection settings and retry.');
      if (response.headersSent) { response.end(`data: ${JSON.stringify({ type: 'error', error: { type: code, message } })}\n\n`); }
      else json(Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : 503, { error: message, code });
    } finally {
      active.delete(abort); request.removeListener('aborted', interrupted); response.removeListener('close', interrupted);
    }
  });
  server.requestTimeout = 5 * 60_000; server.headersTimeout = 15000;
  await new Promise((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept); });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, token, async close() { for (const abort of active) abort.abort(); server.closeAllConnections(); await mcp.close(); await registry.close?.(); await new Promise(accept => server.close(accept)); } };
}

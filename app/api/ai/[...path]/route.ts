import { NextRequest, NextResponse } from 'next/server';
import { env } from '@/lib/runtime-bindings';
import { accessTokenFrom, authErrorResponse, AuthServiceError, backendFetch, refreshAuth, setAuthCookies } from '@/lib/auth-server';
import { mutationFailure, readJsonBody } from '@/lib/request-security';
import { isAiPickerModel } from '@/lib/ai-model-selection';
import { aiModels, aiProviders, aiCapabilities, type AiAttachment, type AiDetail, type AiEvent, type AiSendPayload } from '@/lib/ai-contract';
import { gatewayCapabilities, requireGatewayCapability } from '@/lib/ai-gateway-capabilities';
import { aiProviderConfig, aiTurnFailure, AiError } from '@/lib/ai-provider';
import { maintainAiTurnLease } from '@/lib/ai-turn-lease';
import { normalizeAiFailure } from '@/lib/ai-failure';
import { runAiAgent } from '@/lib/ai-agent';
import type { AiBackend } from '@/lib/ai-tools';
import { ControlPlaneTimeoutError } from '@/lib/control-plane-fetch';
import { localAppMode } from '@/lib/local-runtime';
import { localAiFetch } from '@/lib/local-ai';

type Context = { params: Promise<{ path: string[] }> | { path: string[] } };
async function handle(request: NextRequest, context: Context): Promise<Response> {
  let refreshed: Awaited<ReturnType<typeof refreshAuth>> | null = null;
  const requestId = crypto.randomUUID();
  const cookies = <T extends NextResponse>(response: T): T => { if (refreshed) setAuthCookies(response, refreshed.result, refreshed.refreshToken); return response; };
  try {
    const failure = mutationFailure(request); if (failure) throw failure;
    const segments = (await context.params).path;
    if (segments.some(segment => !/^[A-Za-z0-9_-]+$/.test(segment))) throw new AiError(404, 'AI_NOT_FOUND', 'The AI route was not found.');
    const path = segments.join('/'), method = request.method;
    let token = accessTokenFrom(request);
    const local = localAppMode();
    let catalogRefreshing = false;
    let providerEnvironment: Record<string, string | undefined> = process.env;
    if (local) {
      providerEnvironment = {
        PHYNITE_APP_MODE: 'local',
        PHYNITE_LOCAL_AI_URL: process.env.PHYNITE_LOCAL_AI_URL,
        PHYNITE_LOCAL_AI_TOKEN: process.env.PHYNITE_LOCAL_AI_TOKEN,
        // A bridge restart must not make saved conversations or attachments
        // unreadable. Empty capability evidence keeps reads available while
        // actual sends fail closed until the bridge is healthy again.
        PHYNITE_LOCAL_AI_MODELS: '[]',
        PHYNITE_LOCAL_AI_CAPABILITIES: JSON.stringify({ checkedAt: new Date().toISOString(), models: {} }),
      };
      try {
        let statusResponse = await localAiFetch('/status', { signal: request.signal });
        if (statusResponse.ok) {
          let status = await statusResponse.json() as { providers?: Array<{ checkingModels?: boolean }>; models?: Array<{ id?: string }>; capabilities?: { models?: Record<string, unknown> } };
          // A provider connected before the automatic activation update may
          // still have a cached, unverified catalog. Ask the bridge to refresh
          // and probe its pending models before exposing them in the picker. This is
          // the same restricted synthetic check used by the explicit bridge
          // API, but it no longer requires a user-facing button.
          const cachedCapabilities = status.capabilities?.models ?? {};
          catalogRefreshing = status.providers?.some(provider => provider.checkingModels) === true;
          const pending = status.models?.some(model => {
            const capability = cachedCapabilities[model.id ?? ''] as { available?: boolean; failureCode?: string } | undefined;
            return capability?.available !== true && (!capability?.failureCode || capability.failureCode === 'AUTO_PROBE_PENDING');
          });
          if (path === 'models' && method === 'GET' && pending && !catalogRefreshing) {
            const refreshed = await localAiFetch('/models', { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' }, signal: request.signal });
            if (refreshed.ok) {
              await refreshed.body?.cancel();
              statusResponse = await localAiFetch('/status', { signal: request.signal });
              if (statusResponse.ok) status = await statusResponse.json() as typeof status;
            } else await refreshed.body?.cancel();
          }
          catalogRefreshing = status.providers?.some(provider => provider.checkingModels) === true;
          const models = Array.isArray(status.models) ? status.models.map(model => model.id).filter((model): model is string => typeof model === 'string') : [];
          const capabilities = status.capabilities?.models && typeof status.capabilities.models === 'object' ? status.capabilities.models : {};
          providerEnvironment.PHYNITE_LOCAL_AI_MODELS = JSON.stringify(models);
          providerEnvironment.PHYNITE_LOCAL_AI_CAPABILITIES = JSON.stringify({ checkedAt: new Date().toISOString(), models: capabilities });
        }
      } catch {
        // The conversation API remains usable while the launcher bridge starts
        // or is repaired. The model catalogue will simply be empty for now.
      }
    }
    const call = async <T,>(backendPath: string, payload?: Record<string, unknown>, verb = 'POST'): Promise<T> => {
      if (!token) { refreshed = await refreshAuth(request); token = refreshed.result.AccessToken ?? ''; }
      let response = await backendFetch(`/v1/ai/${backendPath}`, token, { method: verb, ...(payload ? { body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' } } : {}) });
      if (response.status === 401 && !refreshed) { refreshed = await refreshAuth(request); token = refreshed.result.AccessToken ?? ''; response = await backendFetch(`/v1/ai/${backendPath}`, token, { method: verb, ...(payload ? { body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' } } : {}) }); }
      const data = await response.json() as T & { error?: string; message?: string; code?: string; requestId?: string; issues?: NonNullable<AiError['details']>['issues'] };
      if (!response.ok) throw new AiError(response.status, data.code ?? 'AI_BACKEND_ERROR', data.message ?? data.error ?? 'The AI workspace request failed.', { requestId: data.requestId ?? requestId, issues: data.issues });
      return data;
    };
    if (path === 'models' && method === 'GET') {
      await call('conversations', undefined, 'GET');
      // The native bridge is the only local provider. Hosted Phynite AI and
      // user-managed gateways are intentionally outside the local app.
      const providerList = local
        ? aiProviders.filter(provider => provider.id === 'local')
        : aiProviders;
      const providers = providerList.map(provider => {
        const capabilities = gatewayCapabilities(providerEnvironment, provider.id);
        const catalog = provider.id === 'phynite' ? aiModels : Object.keys(capabilities).map(id => ({ id: id as keyof typeof capabilities, label: id }));
        const entries = catalog.filter(model => isAiPickerModel(provider.id, model.id, local));
        return { ...provider, local, configured: Boolean(aiProviderConfig(providerEnvironment, provider.id)) && entries.some(model => capabilities[model.id]?.available), models: entries.map(model => ({ ...model, capabilities: { ...aiCapabilities(model.id), ...capabilities[model.id] } })) };
      });
      return cookies(NextResponse.json({ providers, models: providers[0].models, configured: providers[0].configured, refreshing: catalogRefreshing, background: !local && process.env.PHYNITE_AI_BACKGROUND_ENABLED === 'true' }, { headers: { 'Cache-Control': 'no-store' } }));
    }
    const runner = (env as unknown as { PHYNITE_AI_RUNNER?: Fetcher }).PHYNITE_AI_RUNNER;
    const dispatchConversation = async (base: string) => {
      if (!runner) return;
      const saved = await call<{ conversation: { ownerId: string; id: string } }>(base, undefined, 'GET');
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const started = await runner.fetch('https://ai-runtime/dispatch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ owner: saved.conversation.ownerId, conversationId: saved.conversation.id }) });
          await started.body?.cancel();
          if (started.ok) return;
        } catch { /* The transactional outbox survives a trigger failure. */ }
        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
      }
      console.warn('AI dispatch deferred', { requestId });
    };
    const attachment = /^(conversations\/aic_[a-z0-9]+\/attachments\/aif_[a-z0-9]+)\/content$/.exec(path);
    if (attachment && ['GET', 'PUT'].includes(method)) {
      const source = await call<{ attachment: AiAttachment; url: string }>(`${attachment[1]}/${method === 'PUT' ? 'upload' : 'content'}`, undefined, 'GET');
      if (method === 'PUT') {
        const reader = request.body?.getReader();
        if (!reader) throw new AiError(400, 'AI_ATTACHMENT_INVALID', 'Choose a file to upload.');
        const chunks: Uint8Array[] = []; let size = 0;
        try { while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length; if (size > source.attachment.sizeBytes || size > 10 * 1024 ** 2) throw new AiError(413, 'AI_ATTACHMENT_LIMIT', 'The file exceeds its declared size.'); chunks.push(chunk.value); } }
        finally { await reader.cancel(); }
        if (size !== source.attachment.sizeBytes) throw new AiError(422, 'AI_ATTACHMENT_CHECKSUM', 'The uploaded size differs from the selected file.');
        const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        const uploaded = await fetch(source.url, { method: 'PUT', body: bytes, headers: { 'Content-Type': source.attachment.mediaType, 'x-amz-server-side-encryption': 'AES256' }, redirect: 'manual' });
        await uploaded.body?.cancel();
        if (!uploaded.ok) throw new AiError(502, 'AI_ATTACHMENT_UPLOAD_FAILED', 'The file upload failed. Retry the upload.');
        return cookies(NextResponse.json(await call(`${attachment[1]}/complete`, {})));
      }
      const content = await fetch(source.url, { redirect: 'manual', signal: request.signal });
      if (!content.ok) throw new AiError(502, 'AI_ATTACHMENT_READ_FAILED', 'The file could not be downloaded.');
      const disposition = source.attachment.mediaType.startsWith('image/') || source.attachment.mediaType === 'application/pdf' ? 'inline' : 'attachment';
      return cookies(new NextResponse(content.body, { headers: { 'Content-Type': source.attachment.mediaType, 'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(source.attachment.filename)}`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'" } }));
    }
    const events = /^conversations\/(aic_[a-z0-9]+)\/events$/.exec(path);
    if (events && method === 'GET') {
      const base = `conversations/${events[1]}`;
      await call(base, undefined, 'GET');
      const encoder = new TextEncoder(); let cursor = request.nextUrl.searchParams.get('after')?.slice(0, 30) ?? '';
      let detached = false;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          void (async () => {
            const end = Date.now() + 180000;
            try {
              while (!detached && !request.signal.aborted && Date.now() < end) {
                const batch = await call<{ events: Array<AiEvent & { id: string }>; cursor: string }>(`${base}/events?after=${encodeURIComponent(cursor)}`, undefined, 'GET');
                for (const event of batch.events) {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
                  if (request.nextUrl.searchParams.get('follow') === 'turn' && (event.type === 'done' || event.type === 'error')) return;
                }
                cursor = batch.cursor;
                controller.enqueue(encoder.encode(': heartbeat\n\n'));
                await new Promise(resolve => setTimeout(resolve, 1000));
              }
            } catch (error) { if (!detached && !request.signal.aborted) { try { controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', code: error instanceof AiError ? error.code : 'AI_EVENTS_UNAVAILABLE', message: 'Reconnect to retrieve the saved conversation.', requestId })}\n\n`)); } catch {} } }
            finally { try { controller.close(); } catch {} }
          })();
        },
        cancel() { detached = true; },
      });
      return cookies(new NextResponse(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store, no-transform' } }));
    }
    const queued = /^conversations\/aic_[a-z0-9]+\/(?:queue(?:\/aiq_[a-z0-9]+)?|steer\/aiq_[a-z0-9]+|continue)$/.test(path);
    if (queued && ['GET', 'POST', 'PATCH', 'DELETE'].includes(method)) {
      const payload = method === 'GET' ? undefined : await readJsonBody<Record<string, unknown>>(request, 20000);
      const result = await call(path, payload, method);
      if (runner && method === 'POST') await dispatchConversation(`conversations/${segments[1]}`).catch(() => console.warn('AI dispatch deferred', { requestId }));
      return cookies(NextResponse.json(result, { status: method === 'POST' && path.endsWith('/queue') ? 202 : 200, headers: { 'Cache-Control': 'no-store' } }));
    }
    const messageMatch = /^conversations\/(aic_[a-z0-9]+)\/messages$/.exec(path);
    if (messageMatch && method === 'POST') {
      const payload = await readJsonBody<AiSendPayload>(request, 16000);
      const base = `conversations/${messageMatch[1]}`;
      if (runner) {
        // Compatibility transport: the old streaming endpoint now observes durable
        // work, so disconnecting an older client cannot cancel an accepted turn.
        const saved = await call<AiDetail>(base, undefined, 'GET');
        if (saved.run && ['running', 'awaiting_approval'].includes(saved.run.status) && !payload.resume) throw new AiError(409, 'AI_RUN_ACTIVE', 'Queue a follow-up using the conversation inbox.');
        if (payload.resume) await call(`${base}/continue`, {});
        else await call(`${base}/queue`, { ...payload, clientMessageId: payload.clientMessageId ?? crypto.randomUUID() });
        await dispatchConversation(base).catch(() => console.warn('AI dispatch deferred', { requestId }));
        const url = new URL(request.url); url.pathname = `/api/ai/${base}/events`; url.search = new URLSearchParams({ after: saved.eventCursor ?? '', follow: 'turn' }).toString();
        return cookies(await handle(new NextRequest(url, { headers: request.headers, signal: request.signal }), { params: { path: [...segments.slice(0, -1), 'events'] } }) as NextResponse);
      }
      const saved = await call<AiDetail>(base, undefined, 'GET');
      const queuedMessage = payload.queueId ? saved.queue?.find(message => message.id === payload.queueId) : undefined;
      if (payload.queueId && !queuedMessage) throw new AiError(404, 'AI_NOT_FOUND', 'The waiting message was not found. Refresh the conversation.');
      const selection = payload.resume && saved.run ? saved.run : saved.conversation;
      const providerId = selection.providerId ?? 'phynite';
      const config = aiProviderConfig(providerEnvironment, providerId);
      if (!config) throw new AiError(503, 'AI_NOT_CONFIGURED', 'The selected AI source is not connected. Choose another source.');
      const mediaTypes = (saved.attachments ?? []).filter(file => (queuedMessage?.attachmentIds ?? payload.attachmentIds)?.includes(file.id)).map(file => file.mediaType);
      requireGatewayCapability(providerEnvironment, selection.modelId, selection.effort ?? 'auto', mediaTypes, providerId);
      const detail = await call<AiDetail & { lease: string }>(`${base}/${payload.resume ? 'resume' : 'start'}`, payload.resume ? { runId: payload.runId } : payload.queueId ? { queueId: payload.queueId, settingsRevision: saved.conversation.revision } : { text: payload.text, attachmentIds: payload.attachmentIds ?? [], taskMode: payload.taskMode ?? 'work', contextRefs: payload.contextRefs ?? [], skillRef: payload.skillRef, sourceArtifactId: payload.sourceArtifactId, settingsRevision: saved.conversation.revision });
      const abort = new AbortController();
      const signal = AbortSignal.any([abort.signal, request.signal]);
      const normalizeFailure = (error: unknown) => normalizeAiFailure(error instanceof AuthServiceError || error instanceof ControlPlaneTimeoutError ? new AiError(error.status, error.code, error.message) : aiTurnFailure(error, signal), requestId);
      // Serialize lease renewal with run writes so their revision fences cannot race.
      let pending: Promise<unknown> = Promise.resolve();
      const backend: AiBackend = <T,>(operation: string, data?: Record<string, unknown>, verb = 'POST') => {
        const result = pending.then(() => call<T>(`${base}/${operation}`, verb === 'GET' ? undefined : { ...data, runId: detail.run!.id, lease: detail.lease, controlRevision: detail.run!.controlRevision ?? 0 }, verb));
        pending = result.catch(() => undefined); return result;
      };
      const encoder = new TextEncoder();
      let disconnected = false;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const send = (event: AiEvent) => { if (event.type === 'action' && event.action.status === 'pending') stopRenewal(); if (!disconnected && !request.signal.aborted) { try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); } catch { disconnected = true; abort.abort(); } } };
          const heartbeat = setInterval(() => { try { controller.enqueue(encoder.encode(': heartbeat\n\n')); } catch { abort.abort(); } }, 15000);
          const stopRenewal = maintainAiTurnLease({ renew: () => backend('renew'), signal, onFailure: error => abort.abort(error) });
          // Return from start immediately so cancellation can abort an in-flight provider fetch.
          void (async () => {
            try { const { lease: _lease, ...publicDetail } = detail; void _lease; send({ type: 'state', detail: publicDetail }); await runAiAgent({ detail, backend, config, send, signal, normalizeFailure, toolBudget: 6, assertAttachment: mediaType => { requireGatewayCapability(providerEnvironment, detail.run!.modelId, detail.run!.effort ?? 'auto', [mediaType], providerId); } }); }
            catch (error) {
              const failure = normalizeFailure(error);
              const trackingId = failure.requestId ?? requestId;
              console.warn('AI turn failed', { requestId: trackingId, code: failure.code, providerId, modelId: detail.run!.modelId });
              send({ type: 'error', runId: detail.run!.id, ...failure });
            }
            finally { stopRenewal(); clearInterval(heartbeat); try { controller.close(); } catch {} }
          })();
        },
        cancel() { disconnected = true; abort.abort(); },
      });
      return cookies(new NextResponse(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store, no-transform', 'X-Accel-Buffering': 'no' } }));
    }
    const allowed = ['projects', 'skills'].includes(path) && method === 'GET'
      || path === 'conversations' && ['GET', 'POST'].includes(method)
      || /^conversations\/aic_[a-z0-9]+$/.test(path) && ['GET', 'DELETE'].includes(method)
      || /^conversations\/aic_[a-z0-9]+\/references$/.test(path) && ['GET', 'POST'].includes(method)
      || /^conversations\/aic_[a-z0-9]+\/artifacts$/.test(path) && method === 'GET'
      || /^conversations\/aic_[a-z0-9]+\/settings$/.test(path) && method === 'PATCH'
      || /^conversations\/aic_[a-z0-9]+\/stop$/.test(path) && method === 'POST'
      || /^conversations\/aic_[a-z0-9]+\/actions\/aia_[a-z0-9]+$/.test(path) && ['GET', 'POST'].includes(method);
    const attachmentMetadata = /^conversations\/aic_[a-z0-9]+\/attachments$/.test(path) && method === 'POST';
    if (!allowed && !attachmentMetadata) throw new AiError(404, 'AI_NOT_FOUND', 'The AI route was not found.');
    const payload = ['POST', 'PATCH'].includes(method) ? await readJsonBody<Record<string, unknown>>(request, 16000) : undefined;
    const query = new URLSearchParams();
    for (const key of ['before', 'export', 'q', 'nodeId']) if (request.nextUrl.searchParams.has(key)) query.set(key, request.nextUrl.searchParams.get(key)!);
    const result = await call(`${path}${query.size ? `?${query}` : ''}`, payload, method);
    return cookies(NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } }));
  } catch (error) {
    if (error instanceof AiError) return cookies(NextResponse.json({ error: error.message, code: error.code, requestId, ...error.details }, { status: error.status, headers: { 'Cache-Control': 'no-store' } }));
    if (error instanceof AuthServiceError) return cookies(authErrorResponse(error));
    return cookies(authErrorResponse(error));
  }
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;

import { NextRequest, NextResponse } from 'next/server';
import { accessTokenFrom, backendFetch, authErrorResponse, refreshAuth, setAuthCookies } from '@/lib/auth-server';

export async function GET(request: NextRequest, context: { params: Promise<{ kind: string; id: string }> }) {
  try {
    let token = accessTokenFrom(request);
    let refreshed: Awaited<ReturnType<typeof refreshAuth>> | null = null;
    if (!token) {
      refreshed = await refreshAuth(request);
      token = refreshed.result.AccessToken || '';
    }
    const { kind, id } = await context.params;
    if (!['CALCULATION','MD_SIMULATION','MD_ANALYSIS','MD_TRAJECTORY'].includes(kind) || !/^[A-Za-z0-9_-]{1,96}$/.test(id)) return NextResponse.json({ error: 'Artifact was not found.' }, { status: 404 });
    const path = request.nextUrl.searchParams.get('path') || '';
    const read = (offset: number) => backendFetch(`/v1/compute/cloud-artifacts/${kind}/${id}?${new URLSearchParams({ path, offset: String(offset) })}`, token, { method: 'GET' });
    let first = await read(0);
    if (first.status === 401 && !refreshed) {
      refreshed = await refreshAuth(request);
      token = refreshed.result.AccessToken || '';
      first = await read(0);
    }
    if (!first.ok) return new NextResponse(first.body, { status: first.status, headers: { 'Content-Type':'application/json', 'Cache-Control':'no-store', ...(first.headers.has('retry-after') ? { 'Retry-After':first.headers.get('retry-after')! } : {}) } });
    let chunk = first;
    let offset = 0;
    const size = Number(first.headers.get('x-cloud-artifact-size'));
    let nextOffset = Number(first.headers.get('x-cloud-artifact-next'));
    let reader = chunk.body?.getReader();
    if (!reader || !Number.isSafeInteger(size) || size < 0) throw new Error('Cloud artifact metadata is incomplete.');
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          while (!cancelled) {
            if (!reader) throw new Error('Cloud artifact stream ended early.');
            const bytes = await reader.read();
            if (!bytes.done) { offset += bytes.value.byteLength; controller.enqueue(bytes.value); return; }
            if (offset !== nextOffset || offset > size) throw new Error('Incomplete Cloud artifact chunk.');
            if (offset === size) { controller.close(); return; }
            chunk = await read(offset);
            if (!chunk.ok || Number(chunk.headers.get('x-cloud-artifact-offset')) !== offset || Number(chunk.headers.get('x-cloud-artifact-size')) !== size) throw new Error('Cloud artifact transfer limit or authorization ended.');
            nextOffset = Number(chunk.headers.get('x-cloud-artifact-next'));
            if (!Number.isSafeInteger(nextOffset) || nextOffset <= offset || nextOffset > size) throw new Error('Cloud artifact byte order changed.');
            reader = chunk.body?.getReader();
          }
        } catch (error) { controller.error(error); }
      },
      async cancel() { cancelled = true; await reader?.cancel(); },
    });
    const filename = path.split('/').at(-1)?.replace(/[^A-Za-z0-9._-]/g,'_') || 'artifact';
    const headers = new Headers({ 'Content-Type':first.headers.get('x-cloud-artifact-type') || 'application/octet-stream', 'Content-Length':String(size), 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'Content-Disposition':`inline; filename="${filename}"` });
    if (first.headers.get('x-cloud-artifact-encoding')) headers.set('Content-Encoding', first.headers.get('x-cloud-artifact-encoding')!);
    const response = new NextResponse(stream, { headers });
    if (refreshed) setAuthCookies(response, refreshed.result, refreshed.refreshToken);
    return response;
  } catch (error) { return authErrorResponse(error); }
}

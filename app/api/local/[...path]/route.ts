import { NextRequest, NextResponse } from 'next/server';
import { accessTokenFrom, authErrorResponse, backendFetch } from '@/lib/auth-server';
import { localAppMode } from '@/lib/local-runtime';
import { mutationFailure, readBodyBytes, requestBodyLimit } from '@/lib/request-security';
import { localAiFetch } from '@/lib/local-ai';

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  if (!localAppMode()) return NextResponse.json({ error: 'Not found.', code: 'NOT_FOUND' }, { status: 404 });
  try {
    const failure = mutationFailure(request); if (failure) throw failure;
    const { path } = await context.params;
    if (path[0] === 'ai' && path.length === 2 && (['status', 'accounts', 'usage'].includes(path[1]) && request.method === 'GET' || ['connect', 'login', 'disconnect', 'models', 'probe', 'accounts'].includes(path[1]) && request.method === 'POST')) {
      const body = request.method === 'GET' ? undefined : await readBodyBytes(request, 16000);
      const upstream = await localAiFetch(`/${path[1]}`, { method: request.method, body, headers: body ? { 'Content-Type': 'application/json' } : undefined, signal: request.signal });
      return new NextResponse(upstream.body, { status: upstream.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    }
    if (!path.length || path.some(part => !/^[A-Za-z0-9_-]+$/.test(part)) || !['session', 'runtime', 'resources', 'cloud', 'sync', 'gateway', 'projects'].includes(path[0])) {
      return NextResponse.json({ error: 'Invalid local route.' }, { status: 404 });
    }
    if (path[0] === 'gateway' && path[1] === 'environment') return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await readBodyBytes(request, requestBodyLimit(request.nextUrl.pathname));
    const upstream = await backendFetch(`/__local/${path.join('/')}${request.nextUrl.search}`, accessTokenFrom(request), {
      method: request.method, body, headers: body ? { 'Content-Type': request.headers.get('Content-Type') ?? 'application/json' } : undefined,
    });
    const headers = new Headers({ 'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json', 'Cache-Control': 'no-store' });
    const disposition = upstream.headers.get('Content-Disposition');
    if (disposition) headers.set('Content-Disposition', disposition);
    return new NextResponse(upstream.body, { status: upstream.status, headers });
  } catch (error) { return authErrorResponse(error); }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const DELETE = proxy;

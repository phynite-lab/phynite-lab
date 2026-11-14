import { NextRequest, NextResponse } from 'next/server';
import { accessTokenFrom, authErrorResponse, backendFetch } from '@/lib/auth-server';
import { localAppMode } from '@/lib/local-runtime';
import { mutationFailure, readBodyBytes } from '@/lib/request-security';

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  try {
    if (!localAppMode()) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    const failure = mutationFailure(request); if (failure) throw failure;
    const { path } = await context.params;
    const id = /^[A-Za-z0-9_-]{1,100}$/;
    const allowed = path.length === 1 && ['GET', 'POST'].includes(request.method)
      || path.length === 2 && request.method === 'GET'
      || path.length === 3 && (['drafts', 'history', 'proposals'].includes(path[2]) && request.method === 'GET' || path[2] === 'drafts' && request.method === 'PUT' || ['save', 'decision', 'attach'].includes(path[2]) && request.method === 'POST')
      || path.length === 4 && path[2] === 'history' && request.method === 'GET';
    if (!allowed || !path.every(part => id.test(part))) return NextResponse.json({ error: 'Invalid Notes operation.' }, { status: 404 });
    const body = request.method === 'GET' ? undefined : await readBodyBytes(request, 7 * 1024 ** 2);
    const upstream = await backendFetch(`/__local/notes/${path.join('/')}`, accessTokenFrom(request), { method: request.method, body, headers: body ? { 'Content-Type': 'application/json' } : undefined });
    return new NextResponse(upstream.body, { status: upstream.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  } catch (error) { return authErrorResponse(error); }
}
export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;

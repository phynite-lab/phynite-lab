import { NextRequest, NextResponse } from 'next/server';
import { accessTokenFrom, authErrorResponse, backendFetch } from '@/lib/auth-server';
import { localAppMode } from '@/lib/local-runtime';
import { mutationFailure, readBodyBytes } from '@/lib/request-security';

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  try {
    if (!localAppMode()) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    const failure = mutationFailure(request); if (failure) throw failure;
    const { path } = await context.params, method = request.method;
    const allowed = path.length === 1 && ['GET', 'POST'].includes(method)
      || path.length === 3 && (path[1] === 'roots' && ['PUT', 'DELETE'].includes(method) || path[1] === 'edits' && method === 'POST' || path[1] === 'transfers' && method === 'DELETE' || path[1] === 'downloads' && method === 'GET')
      || path.length === 4 && path[1] === 'roots' && ['list', 'read', 'edit', 'snapshot', 'prepare', 'import', 'qualify'].includes(path[3]) && method === 'POST';
    if (!allowed || !path.every(p => /^[A-Za-z0-9_-]{1,100}$/.test(p))) return NextResponse.json({ error: 'Invalid file operation.' }, { status: 404 });
    const body = ['GET', 'HEAD'].includes(method) ? undefined : await readBodyBytes(request, 8 * 1024 ** 2);
    const upstream = await backendFetch(`/__local/files/${path.join('/')}`, accessTokenFrom(request), { method, body, headers: body ? { 'Content-Type': 'application/json' } : undefined }, 150_000);
    return new NextResponse(upstream.body, { status: upstream.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  } catch (error) { return authErrorResponse(error); }
}
export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const DELETE = proxy;

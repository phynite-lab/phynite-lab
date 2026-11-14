import { NextRequest, NextResponse } from 'next/server';
import { accessTokenFrom, authErrorResponse, backendFetch } from '@/lib/auth-server';
import { localAppMode } from '@/lib/local-runtime';
import { mutationFailure, readBodyBytes, requestBodyLimit } from '@/lib/request-security';
import { localAiFetch } from '@/lib/local-ai';
import { checkLocalUpdate } from '@/lib/local-updates';

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  if (!localAppMode()) return NextResponse.json({ error: 'Not found.', code: 'NOT_FOUND' }, { status: 404 });
  try {
    const failure = mutationFailure(request); if (failure) throw failure;
    const { path } = await context.params;
    if (path.length === 1 && path[0] === 'updates' && request.method === 'GET') {
      return NextResponse.json(await checkLocalUpdate(process.env.PHYNITE_RELEASE_VERSION), { headers: { 'Cache-Control': 'no-store' } });
    }
    if (path[0] === 'ai' && path.length === 2 && (['status', 'usage'].includes(path[1]) && request.method === 'GET' || ['connect', 'login', 'disconnect', 'models', 'probe'].includes(path[1]) && request.method === 'POST')) {
      const body = request.method === 'GET' ? undefined : await readBodyBytes(request, 16000);
      const upstream = await localAiFetch(`/${path[1]}`, { method: request.method, body, headers: body ? { 'Content-Type': 'application/json' } : undefined, signal: request.signal });
      return new NextResponse(upstream.body, { status: upstream.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    }
    if (!path.length || path.some(part => !/^[A-Za-z0-9_-]+$/.test(part)) || !['session', 'runtime', 'resources', 'cloud', 'sync', 'projects', 'jobs', 'materials-project', 'crystals', 'hpc', 'mlip', 'orchestration'].includes(path[0])) {
      return NextResponse.json({ error: 'Invalid local route.' }, { status: 404 });
    }
    if (path[0] === 'orchestration' && !(path.length === 3 && /^aic_[a-z0-9]+$/.test(path[1]) && (path[2] === 'status' && request.method === 'GET' || ['stop', 'retry', 'continue'].includes(path[2]) && request.method === 'POST'))) return NextResponse.json({ error: 'Invalid task operation.' }, { status: 404 });
    if (path[0] === 'mlip' && !(path.length === 1 && request.method === 'GET' || path.length === 2 && path[1] === 'install' && request.method === 'POST')) return NextResponse.json({ error: 'Invalid MLIP operation.' }, { status: 404 });
    if (path[0] === 'crystals' && !(path.length === 2 && path[1] === 'standardize' && request.method === 'POST')) return NextResponse.json({ error: 'Invalid crystal operation.' }, { status: 404 });
    if (path[0] === 'materials-project' && !(
      path.length === 1 && ['GET', 'PUT', 'DELETE'].includes(request.method)
      || path.length === 2 && path[1] === 'test' && request.method === 'POST'
      || path.length === 2 && path[1] === 'search' && request.method === 'GET'
    )) return NextResponse.json({ error: 'Invalid Materials Project operation.' }, { status: 404 });
    if (path[0] === 'jobs' && (path.length !== 3 || !(path[2] === 'recovery' && request.method === 'GET' || path[2] === 'recover' && request.method === 'POST'))) {
      return NextResponse.json({ error: 'Invalid local job operation.' }, { status: 404 });
    }
    const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await readBodyBytes(request, requestBodyLimit(request.nextUrl.pathname));
    const setupVenv = path.length === 4 && path[0] === 'hpc' && path[1] === 'clusters' && path[3] === 'setup-venv' && request.method === 'POST';
    const upstream = await backendFetch(`/__local/${path.join('/')}${request.nextUrl.search}`, accessTokenFrom(request), {
      method: request.method, body, headers: body ? { 'Content-Type': request.headers.get('Content-Type') ?? 'application/json' } : undefined,
    }, setupVenv ? 400_000 : undefined);
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

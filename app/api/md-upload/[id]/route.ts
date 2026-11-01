import { localDevelopmentApi } from '@/lib/auth-server';
import { NextRequest, NextResponse } from 'next/server';
import { accessTokenFrom, authErrorResponse, backendFetch, refreshAuth, setAuthCookies } from '@/lib/auth-server';
import { mutationFailure } from '@/lib/request-security';
import { artifactDownloadUrl } from '@/lib/artifact-download-url';
import { readMdUploadPart } from '@/lib/md-upload-part';
import { localAppMode, localArtifactUrl } from '@/lib/local-runtime';

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const rejection = mutationFailure(request);
    if (rejection) throw rejection;
    const { id } = await context.params;
    if (!/^[A-Za-z0-9_-]{1,96}$/.test(id)) return NextResponse.json({ error: 'Invalid upload identity.' }, { status: 400 });
    let token = accessTokenFrom(request);
    let refreshed: Awaited<ReturnType<typeof refreshAuth>> | null = null;
    if (!token) { refreshed = await refreshAuth(request); token = refreshed.result.AccessToken ?? ''; }
    const complete = request.nextUrl.searchParams.get('complete') === '1';
    const number = Number(request.nextUrl.searchParams.get('partNumber'));
    const size = Number(request.nextUrl.searchParams.get('sizeBytes'));
    const digest = request.nextUrl.searchParams.get('sha256');
    if (!complete && (!Number.isInteger(number) || number < 1 || !Number.isInteger(size) || size < 1 || size > 16 * 1024 ** 2 || !digest || !/^[a-f0-9]{64}$/.test(digest))) {
      return NextResponse.json({ error: 'Invalid upload part.' }, { status: 400 });
    }
    const part = complete ? null : await readMdUploadPart(request, size, digest!);
    const metadata = () => backendFetch('/v1/md/trajectories/' + id + (complete ? '/multipart-complete' : '/upload-part'), token, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(complete ? {} : { partNumber: number, sizeBytes: size, sha256: digest }),
    });
    let upstream = await metadata();
    if (upstream.status === 401 && !refreshed) {
      refreshed = await refreshAuth(request); token = refreshed.result.AccessToken ?? ''; upstream = await metadata();
    }
    if (!upstream.ok || complete) {
      const response = new NextResponse(upstream.body, { status: upstream.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
      if (refreshed) setAuthCookies(response, refreshed.result, refreshed.refreshToken);
      return response;
    }
    const ticket = await upstream.json() as { url: string; headers: Record<string, string> };
    const destination = localAppMode() ? localArtifactUrl(ticket.url, process.env.PHYNITE_LOCAL_API_URL!) : artifactDownloadUrl(ticket.url, localDevelopmentApi());
    if (!destination || ticket.headers['Content-Length'] !== String(size)) throw new Error('Invalid private upload destination');
    // Both this bounded proxy and S3 verify the exact signed part identity.
    const upload = await fetch(destination, { method: 'PUT', headers: ticket.headers, body: part, redirect: 'manual' });
    const response = NextResponse.json(upload.ok ? { uploaded: true } : { error: 'Part upload failed. Retry the same source.' }, { status: upload.ok ? 200 : 502, headers: { 'Cache-Control': 'no-store' } });
    if (refreshed) setAuthCookies(response, refreshed.result, refreshed.refreshToken);
    return response;
  } catch (error) { return authErrorResponse(error); }
}

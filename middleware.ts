import { NextRequest, NextResponse } from 'next/server';
import { declaredBodyFailure, mutationFailure, securityHeaders } from './lib/request-security';
import { localAppMode } from './lib/local-runtime';

export function middleware(request: NextRequest) {
  if (!localAppMode()) return NextResponse.json({ error: 'Start the local application through phynite-lab.', code: 'LOCAL_ONLY' }, { status: 503 });
  const origin = process.env.PHYNITE_LOCAL_UI_ORIGIN;
  if (!origin || request.headers.get('host') !== new URL(origin).host || request.nextUrl.origin !== origin) {
    return NextResponse.json({ error: 'Use the local workspace address printed by phynite-lab.', code: 'INVALID_LOCAL_HOST' }, { status: 403 });
  }
  const path = request.nextUrl.pathname;
  let response: NextResponse | undefined;
  if (path.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    const failure = mutationFailure(request) ?? declaredBodyFailure(request);
    if (failure) response = NextResponse.json({ error: failure.message, code: failure.code }, { status: failure.status });
  }
  if (path === '/' && ['GET', 'HEAD'].includes(request.method)) response = NextResponse.redirect(new URL('/workspace', origin));
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-phynite-document-path', path);
  response ??= NextResponse.next({ request: { headers: requestHeaders } });
  for (const [name, value] of Object.entries(securityHeaders(process.env.NODE_ENV === 'production', path))) {
    if (name !== 'Strict-Transport-Security') response.headers.set(name, value);
  }
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return response;
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon|fonts/|brand/).*)'] };

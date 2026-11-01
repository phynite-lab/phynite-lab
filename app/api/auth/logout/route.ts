import { NextRequest, NextResponse } from "next/server";
import {
  accessTokenFrom,
  authErrorResponse,
  backendFetch,
  clearAuthCookies,
  cognitoRequest,
} from "@/lib/auth-server";
import { localAppMode } from '@/lib/local-runtime';

export async function POST(request: NextRequest) {
  try {
    if (localAppMode()) {
      const upstream = await backendFetch('/__local/cloud/logout', accessTokenFrom(request), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!upstream.ok) return new NextResponse(upstream.body, { status: upstream.status, headers: { 'Content-Type': 'application/json' } });
      return NextResponse.json({ signedOut: true, mode: 'local' });
    }
    const accessToken = accessTokenFrom(request);
    if (accessToken) {
      await backendFetch('/v1/activity/session', accessToken, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'logout' }),
      }).catch(() => undefined);
      await cognitoRequest("GlobalSignOut", { AccessToken: accessToken }).catch(() => undefined);
    }
    const response = NextResponse.json({ signedOut: true });
    clearAuthCookies(response);
    return response;
  } catch (error) {
    return authErrorResponse(error);
  }
}

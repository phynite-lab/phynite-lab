import { readJsonBody } from '@/lib/request-security';
import { controlPlaneJson } from '@/lib/control-plane-fetch';
import { NextRequest, NextResponse } from "next/server";
import {
  accessTokenFrom,
  authErrorResponse,
  backendFetch,
  cognitoClientId,
  cognitoRequest,
  setAuthCookies,
  publicBackendFetch,
  type CognitoAuthenticationResult,
} from "@/lib/auth-server";
import { localAppMode } from '@/lib/local-runtime';

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonBody<{ identifier?: unknown; email?: unknown; password?: unknown }>(request);
    const raw = body.identifier ?? body.email;
    const identifier = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!identifier || identifier.length > 254 || !password || password.length > 256) {
      return NextResponse.json(
        { error: "Username or email and password are required.", code: "INVALID_INPUT" },
        { status: 400 },
      );
    }
    if (localAppMode()) {
      const upstream = await backendFetch('/__local/cloud/login', accessTokenFrom(request), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
      });
      const data = await controlPlaneJson<{ connected?: boolean; account?: string; accountId?: string; authenticated?: boolean; error?: string; code?: string }>(upstream);
      if (!upstream.ok) return NextResponse.json({ error: data.error || 'Cloud sign-in could not be completed.', code: data.code || 'AUTH_UNAVAILABLE' }, { status: upstream.status, headers: { 'Cache-Control': 'no-store' } });
      if (data.connected !== true || data.authenticated !== true) return NextResponse.json({ error: 'Cloud sign-in could not be verified.', code: 'INCOMPLETE_SESSION' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
      return NextResponse.json({ authenticated: false, mode: 'local', cloud: data }, { headers: { 'Cache-Control': 'no-store' } });
    }
    let result: { AuthenticationResult?: CognitoAuthenticationResult };
    if (identifier.includes('@')) result = await cognitoRequest("InitiateAuth", {
      AuthFlow: "USER_PASSWORD_AUTH",
      ClientId: cognitoClientId(),
      AuthParameters: { USERNAME: identifier, PASSWORD: password },
    });
    else {
      const upstream = await publicBackendFetch('/public/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: identifier, password }) });
      const data = await controlPlaneJson<{ AuthenticationResult?: CognitoAuthenticationResult; error?: string; code?: string }>(upstream);
      if (!upstream.ok) return NextResponse.json({ error: data.error || 'Sign-in could not be completed.', code: data.code || 'AUTH_UNAVAILABLE' }, { status: upstream.status, headers: { 'Cache-Control': 'no-store', ...(upstream.headers.get('Retry-After') ? { 'Retry-After': upstream.headers.get('Retry-After')! } : {}) } });
      result = data;
    }
    if (!result.AuthenticationResult) {
      return NextResponse.json(
        { error: "Additional authentication challenges are not supported yet.", code: "AUTH_CHALLENGE" },
        { status: 409 },
      );
    }
    const response = NextResponse.json({ authenticated: true }, { headers: { 'Cache-Control': 'no-store' } });
    setAuthCookies(response, result.AuthenticationResult);
    if (result.AuthenticationResult.AccessToken) {
      await backendFetch('/v1/activity/session', result.AuthenticationResult.AccessToken, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'login' }),
      }).catch(() => undefined);
    }
    return response;
  } catch (error) {
    return authErrorResponse(error);
  }
}

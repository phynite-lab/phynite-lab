import { NextRequest, NextResponse } from "next/server";
import { controlPlaneJson } from '@/lib/control-plane-fetch';
import {
  authErrorResponse,
  AuthServiceError,
  accessTokenFrom,
  backendFetch,
  clearAuthCookies,
  identityTokenFrom,
  parseJwtPayload,
  refreshAuth,
  setAuthCookies,
} from "@/lib/auth-server";
import { devSandboxMode, devSandboxRole } from "@/lib/dev-sandbox";
import { localAppMode } from '@/lib/local-runtime';

export async function GET(request: NextRequest) {
  if (localAppMode()) {
    try {
      const upstream = await backendFetch('/__local/session', accessTokenFrom(request));
      return new NextResponse(upstream.body, { status: upstream.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    } catch (error) { return authErrorResponse(error); }
  }
  if (devSandboxMode()) {
    const admin = devSandboxRole() === 'admin';
    return NextResponse.json({
      authenticated: true,
      sandbox: true,
      user: {
        id: admin ? "dev-sandbox-admin" : "dev-sandbox-user",
        email: admin ? "admin@phynite.local" : "sandbox@phynite.local",
        name: admin ? "Sandbox Admin" : "Sandbox Researcher",
        groups: admin ? ["developers"] : [],
        isDeveloper: admin,
      },
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    }, { headers: { "Cache-Control": "no-store", "X-Phynite-Dev-Sandbox": "true" } });
  }

  let accessToken = accessTokenFrom(request);
  let identityToken = identityTokenFrom(request);
  let refreshed: Awaited<ReturnType<typeof refreshAuth>> | null = null;

  try {
    let upstream = accessToken
      ? await backendFetch("/v1/me", accessToken)
      : new Response(null, { status: 401 });
    if (upstream.status === 401) {
      refreshed = await refreshAuth(request);
      accessToken = refreshed.result.AccessToken || "";
      identityToken = refreshed.result.IdToken || identityToken;
      upstream = await backendFetch("/v1/me", accessToken);
    }
    if (!upstream.ok) {
      if (upstream.status !== 401) return NextResponse.json({ authenticated: false, error: 'Session service is temporarily unavailable.', code: 'SESSION_UNAVAILABLE' }, { status: upstream.status, headers: { 'Cache-Control': 'no-store' } });
      throw new AuthServiceError(401, 'Sign in to continue.', 'UNAUTHORIZED');
    }
    const payload = await controlPlaneJson<{
      user: { id: string; email?: string; name?: string };
    }>(upstream);
    const identity = parseJwtPayload(identityToken);
    const rawGroups = identity["cognito:groups"];
    const groups = Array.isArray(rawGroups)
      ? rawGroups.map(String)
      : typeof rawGroups === "string"
        ? rawGroups.split(",").map((group) => group.trim()).filter(Boolean)
        : [];
    const response = NextResponse.json({
      authenticated: true,
      user: {
        id: payload.user.id,
        email: String(identity.email || payload.user.email || ""),
        name: String(identity.name || payload.user.name || identity["cognito:username"] || ""),
        groups,
        isDeveloper: groups.includes("developers"),
      },
      expiresAt: typeof identity.exp === "number"
        ? new Date(identity.exp * 1000).toISOString()
        : undefined,
    }, { headers: { 'Cache-Control': 'no-store' } });
    if (refreshed) {
      setAuthCookies(response, refreshed.result, refreshed.refreshToken);
    }
    return response;
  } catch (error) {
    if (!(error instanceof AuthServiceError) || error.status !== 401) return authErrorResponse(error);
    const response = NextResponse.json(
      { authenticated: false, user: null },
      { status: 401 },
    );
    clearAuthCookies(response);
    return response;
  }
}

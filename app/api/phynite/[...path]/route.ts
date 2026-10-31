import { adminPasswordMutation, passwordRejectionKeepsSession } from "@/lib/admin-cloud-security";
import { mutationFailure, readBodyBytes, requestBodyLimit } from '@/lib/request-security';
import { NextRequest, NextResponse } from "next/server";
import {
  AuthServiceError,
  localDevelopmentApi,
  authErrorResponse,
  accessTokenFrom,
  backendFetch,
  clearAuthCookies,
  refreshAuth,
  setAuthCookies,
} from "@/lib/auth-server";
import { devSandboxMode, handleDevSandboxApi } from "@/lib/dev-sandbox";
import { localAppMode, localArtifactUrl } from '@/lib/local-runtime';

type RouteContext = { params: Promise<{ path: string[] }> | { path: string[] } };

async function forward(request: NextRequest, context: RouteContext) {
  const failure = mutationFailure(request);
  if (failure) throw failure;
  const params = await Promise.resolve(context.params);
  const segments = params.path || [];
  // AI leases and internal orchestration endpoints are never proxied to browser clients.
  if (segments[1] === 'ai') return NextResponse.json({ error: 'Use the AI workspace API.', code: 'INVALID_ROUTE' }, { status: 404 });
  if (segments[0] !== "v1" || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    return NextResponse.json({ error: "API route is invalid.", code: "INVALID_ROUTE" }, { status: 400 });
  }
  if (segments[1] === 'local-workflow-import' && !localDevelopmentApi()) return NextResponse.json({error:'API route was not found.',code:'NOT_FOUND'},{status:404});
  if (devSandboxMode()) {
    return handleDevSandboxApi(request, segments);
  }
  const path = `/${segments.map(encodeURIComponent).join("/")}${request.nextUrl.search}`;
  const body = request.method === "GET" || request.method === "HEAD"
    ? undefined
    : await readBodyBytes(request, requestBodyLimit(request.nextUrl.pathname));
  const headers: Record<string, string> = {};
  const contentType = request.headers.get("content-type");
  if (contentType) headers["Content-Type"] = contentType;

  let accessToken = accessTokenFrom(request);
  let refreshed: Awaited<ReturnType<typeof refreshAuth>> | null = null;
  if (!accessToken) {
    try {
      refreshed = await refreshAuth(request);
      accessToken = refreshed.result.AccessToken || "";
    } catch (error) {
      if (!(error instanceof AuthServiceError) || error.status !== 401) throw error;
      const response = NextResponse.json({ error: "Sign in to continue.", code: "UNAUTHORIZED" }, { status: 401 });
      clearAuthCookies(response);
      return response;
    }
  }

  let upstream = await backendFetch(path, accessToken, {
    method: request.method,
    headers,
    body,
  });
  const passwordConfirmation = adminPasswordMutation(path, request.method);
  if (upstream.status === 401 && !refreshed && !passwordConfirmation) {
    try {
      refreshed = await refreshAuth(request);
      accessToken = refreshed.result.AccessToken || "";
      upstream = await backendFetch(path, accessToken, {
        method: request.method,
        headers,
        body,
      });
    } catch (error) {
      if (!(error instanceof AuthServiceError) || error.status !== 401) throw error;
      // The authenticated response below clears the stale cookies.
    }
  }

  const failureBody: unknown = passwordConfirmation && upstream.status === 401
    ? await upstream.clone().json().catch(() => null) : null;
  const passwordFailure = typeof failureBody === 'object' && failureBody !== null
    && 'code' in failureBody && passwordRejectionKeepsSession(failureBody.code);
  let responseBody: BodyInit | null = upstream.body;
  if((localAppMode() || localDevelopmentApi()) && upstream.headers.get('content-type')?.includes('application/json')) {
    const rewrite=(value:unknown):unknown=>{
      if(typeof value==='string' && localArtifactUrl(value, localAppMode() ? process.env.PHYNITE_LOCAL_API_URL! : 'http://127.0.0.1:8792'))return '/api/local-artifacts?'+new URL(value).searchParams.toString();
      if(Array.isArray(value))return value.map(rewrite);
      if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,rewrite(item)]));
      return value;
    };
    responseBody=JSON.stringify(rewrite(await upstream.json()));
  }
  const response = new NextResponse(responseBody, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
  if (upstream.headers.has('retry-after')) response.headers.set('Retry-After', upstream.headers.get('retry-after')!);
  if (upstream.status === 401 && !passwordFailure) {
    clearAuthCookies(response);
  } else if (refreshed) {
    setAuthCookies(response, refreshed.result, refreshed.refreshToken);
  }
  return response;
}

async function proxy(request: NextRequest, context: RouteContext) {
  try { return await forward(request, context); }
  catch (error) { return authErrorResponse(error); }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;

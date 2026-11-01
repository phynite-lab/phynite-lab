import { NextRequest, NextResponse } from "next/server";
import { controlPlaneFetch, controlPlaneJson, ControlPlaneTimeoutError } from './control-plane-fetch';
import { RequestSecurityError } from './request-security';
import { sessionHome } from './auth-routing';
import { localAppMode } from './local-runtime';

const ACCESS_COOKIE = "phynite_access";
const REFRESH_COOKIE = "phynite_refresh";
const ID_COOKIE = "phynite_identity";
const REFRESH_MAX_AGE = 60 * 60 * 24 * 30;

export type CognitoAuthenticationResult = {
  AccessToken?: string;
  ExpiresIn?: number;
  IdToken?: string;
  RefreshToken?: string;
  TokenType?: string;
};

type CognitoResponse = {
  AuthenticationResult?: CognitoAuthenticationResult;
  ChallengeName?: string;
  CodeDeliveryDetails?: { Destination?: string; DeliveryMedium?: string };
  UserConfirmed?: boolean;
  UserSub?: string;
};

export class AuthServiceError extends Error {
  status: number;
  code: string;

  constructor(status: number, message: string, code = "AUTH_ERROR") {
    super(message);
    this.name = "AuthServiceError";
    this.status = status;
    this.code = code;
  }
}

export function localDevelopmentApi(): boolean {
  if (process.env.PHYNITE_LOCAL_API !== 'true') return false;
  if (process.env.NODE_ENV !== 'development') throw new Error('Local API mode is development-only.');
  const url = new URL(process.env.PHYNITE_API_URL ?? '');
  if (url.protocol !== 'http:' || !['127.0.0.1','localhost','[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash) throw new Error('Local API must use a loopback origin.');
  return true;
}

export function backendApiUrl() {
  if (localAppMode()) return process.env.PHYNITE_LOCAL_API_URL!.replace(/\/$/, '');
  const apiUrl = (process.env.PHYNITE_API_URL?.trim()
    || process.env.NEXT_PUBLIC_PHYNITE_API_URL?.trim()
    || "").replace(/\/$/, "");
  if (!apiUrl) {
    throw new AuthServiceError(
      503,
      "Phynite backend is not configured for this deployment.",
      "BACKEND_NOT_CONFIGURED",
    );
  }
  return apiUrl;
}

function serverConfig() {
  if (localAppMode()) return { region: '', clientId: '', apiUrl: backendApiUrl() };
  const region = process.env.PHYNITE_AWS_REGION?.trim()
    || process.env.NEXT_PUBLIC_PHYNITE_AWS_REGION?.trim()
    || "";
  const clientId = process.env.PHYNITE_COGNITO_CLIENT_ID?.trim()
    || process.env.NEXT_PUBLIC_PHYNITE_COGNITO_CLIENT_ID?.trim()
    || "";
  const apiUrl = backendApiUrl();

  if (!region || !clientId) {
    throw new AuthServiceError(
      503,
      "Phynite authentication is not configured for this deployment.",
      "AUTH_NOT_CONFIGURED",
    );
  }
  return { region, clientId, apiUrl };
}

function cognitoMessage(code: string, fallback: string) {
  const messages: Record<string, string> = {
    CodeMismatchException: "The confirmation code is incorrect.",
    ExpiredCodeException: "The confirmation code has expired. Request a new code.",
    InvalidParameterException: "The submitted account details are invalid.",
    InvalidPasswordException: "Use at least 12 characters with uppercase, lowercase, a number, and a symbol.",
    LimitExceededException: "Too many attempts. Please wait before trying again.",
    NotAuthorizedException: "Username, email, or password is incorrect.",
    PasswordResetRequiredException: "Reset your password before signing in.",
    TooManyRequestsException: "Too many requests. Please wait before trying again.",
    UserNotConfirmedException: "Confirm your email before signing in.",
    UsernameExistsException: "An account with this email already exists.",
    UserNotFoundException: "No account was found for that email.",
  };
  return messages[code] ?? fallback;
}

export async function cognitoRequest(
  target: string,
  payload: Record<string, unknown>,
): Promise<CognitoResponse> {
  const { region } = serverConfig();
  const response = await controlPlaneFetch(localDevelopmentApi() ? `${backendApiUrl()}/__local/auth/cognito` : `https://cognito-idp.${region}.amazonaws.com/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": `AWSCognitoIdentityProviderService.${target}`,
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  const body = await controlPlaneJson<{
    __type?: string;
    message?: string;
  } & CognitoResponse>(response);
  if (!response.ok) {
    const code = body.__type?.split("#").pop() || "COGNITO_ERROR";
    throw new AuthServiceError(
      ["TooManyRequestsException", "LimitExceededException"].includes(code) ? 429 : response.status,
      cognitoMessage(code, body.message || "Authentication could not be completed."),
      code,
    );
  }
  return body;
}

export function cognitoClientId() {
  return serverConfig().clientId;
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

export function setAuthCookies(
  response: NextResponse,
  result: CognitoAuthenticationResult,
  previousRefreshToken = "",
) {
  const accessToken = result.AccessToken;
  const identityToken = result.IdToken;
  const refreshToken = result.RefreshToken || previousRefreshToken;
  if (!accessToken || !identityToken) {
    throw new AuthServiceError(502, "Cognito returned an incomplete session.", "INCOMPLETE_SESSION");
  }
  const accessMaxAge = Math.max(60, Number(result.ExpiresIn) || 3600);
  response.cookies.set(ACCESS_COOKIE, accessToken, cookieOptions(accessMaxAge));
  response.cookies.set(ID_COOKIE, identityToken, cookieOptions(accessMaxAge));
  if (refreshToken) {
    response.cookies.set(REFRESH_COOKIE, refreshToken, cookieOptions(REFRESH_MAX_AGE));
  }
}

export function clearAuthCookies(response: NextResponse) {
  for (const name of [ACCESS_COOKIE, REFRESH_COOKIE, ID_COOKIE]) {
    response.cookies.set(name, "", cookieOptions(0));
  }
}

export async function refreshAuth(request: NextRequest) {
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value || "";
  if (!refreshToken) {
    throw new AuthServiceError(401, "Your session has expired.", "SESSION_EXPIRED");
  }
  const result = await cognitoRequest("InitiateAuth", {
    AuthFlow: "REFRESH_TOKEN_AUTH",
    ClientId: cognitoClientId(),
    AuthParameters: { REFRESH_TOKEN: refreshToken },
  }).catch(error => {
    if (error instanceof AuthServiceError && error.code === 'NotAuthorizedException') throw new AuthServiceError(401, 'Your session has expired.', 'SESSION_EXPIRED');
    throw error;
  });
  if (!result.AuthenticationResult) {
    throw new AuthServiceError(401, "Your session could not be refreshed.", "SESSION_EXPIRED");
  }
  return { result: result.AuthenticationResult, refreshToken };
}

export function accessTokenFrom(request: NextRequest) {
  if (localAppMode()) return process.env.PHYNITE_LOCAL_SERVICE_TOKEN!;
  return request.cookies.get(ACCESS_COOKIE)?.value || "";
}

export function identityTokenFrom(request: NextRequest) {
  return request.cookies.get(ID_COOKIE)?.value || "";
}

/** Navigation hint only; the destination still validates the session and role. */
export function homeSessionDestination(request: NextRequest): string | null {
  if (localAppMode()) return '/workspace';
  if (!accessTokenFrom(request) && !request.cookies.get(REFRESH_COOKIE)?.value) return null;
  const rawGroups = parseJwtPayload(identityTokenFrom(request))["cognito:groups"];
  const groups = Array.isArray(rawGroups) ? rawGroups.filter(group => typeof group === "string")
    : typeof rawGroups === "string" ? rawGroups.split(",").map(group => group.trim()) : [];
  return sessionHome(groups.includes("developers"));
}

export function parseJwtPayload(token: string): Record<string, unknown> {
  try {
    const encoded = token.split(".")[1];
    if (!encoded) return {};
    const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = Buffer.from(normalized, "base64").toString("utf8");
    const payload = JSON.parse(decoded);
    return payload && typeof payload === "object" ? payload : {};
  } catch {
    return {};
  }
}

export async function backendFetch(path: string, accessToken: string, init?: RequestInit) {
  const { apiUrl } = serverConfig();
  return controlPlaneFetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...init?.headers,
    },
    cache: "no-store",
  });
}

export async function publicBackendFetch(path: string, init?: RequestInit) {
  const apiUrl = backendApiUrl();
  return controlPlaneFetch(`${apiUrl}${path}`, { ...init, cache: "no-store" });
}

export function authErrorResponse(error: unknown) {
  if (error instanceof AuthServiceError || error instanceof RequestSecurityError || error instanceof ControlPlaneTimeoutError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status, headers: { 'Cache-Control': 'no-store', ...(error.status === 429 ? { 'Retry-After': '60' } : {}) } },
    );
  }
  if (error instanceof Error && error.name === 'TimeoutError') return NextResponse.json({ error: 'The service took too long to respond. Check the current state before retrying.', code: 'UPSTREAM_TIMEOUT' }, { status: 504, headers: { 'Cache-Control': 'no-store' } });
  console.error("Authentication request failed", error instanceof Error ? error.name : 'unknown');
  return NextResponse.json(
    { error: "Authentication is temporarily unavailable.", code: "AUTH_UNAVAILABLE" },
    { status: 502 },
  );
}

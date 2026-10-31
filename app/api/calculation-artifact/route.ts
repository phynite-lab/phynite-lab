import { NextRequest, NextResponse } from "next/server";
import {
  accessTokenFrom,
  backendFetch,
  clearAuthCookies,
  refreshAuth,
  setAuthCookies,
} from "@/lib/auth-server";

type ResultArtifact = {
  path?: string;
  role?: string;
  contentType?: string;
  viewUrl?: string;
  downloadUrl?: string;
};

type CalculationResultResponse = {
  error?: string;
  code?: string;
  artifactsExpired?: boolean;
  result?: { artifacts?: ResultArtifact[] };
};

function jsonError(status: number, error: string, code: string) {
  return NextResponse.json({ error, code }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: NextRequest) {
  const calculationId = request.nextUrl.searchParams.get("calculationId")?.trim() || "";
  const artifactPath = request.nextUrl.searchParams.get("path")?.trim() || "";
  const pathSegments = artifactPath.split("/");
  if (!calculationId || calculationId.includes("/") || !artifactPath || artifactPath.startsWith("/") || pathSegments.some((segment) => !segment || segment === "." || segment === "..")) {
    return jsonError(400, "The calculation artifact request is invalid.", "INVALID_ARTIFACT_REQUEST");
  }

  let accessToken = accessTokenFrom(request);
  let refreshed: Awaited<ReturnType<typeof refreshAuth>> | null = null;
  if (!accessToken) {
    try {
      refreshed = await refreshAuth(request);
      accessToken = refreshed.result.AccessToken || "";
    } catch {
      const response = jsonError(401, "Sign in to open calculation data.", "UNAUTHORIZED");
      clearAuthCookies(response);
      return response;
    }
  }

  let calculationResponse = await backendFetch(`/v1/calculations/${encodeURIComponent(calculationId)}`, accessToken);
  if (calculationResponse.status === 401 && !refreshed) {
    try {
      refreshed = await refreshAuth(request);
      accessToken = refreshed.result.AccessToken || "";
      calculationResponse = await backendFetch(`/v1/calculations/${encodeURIComponent(calculationId)}`, accessToken);
    } catch {
      // The authenticated error response below clears stale session cookies.
    }
  }

  const payload = await calculationResponse.json().catch(() => ({})) as CalculationResultResponse;
  if (!calculationResponse.ok) {
    const response = jsonError(
      calculationResponse.status,
      payload.error || "The calculation result could not be loaded.",
      payload.code || "CALCULATION_RESULT_UNAVAILABLE",
    );
    if (calculationResponse.status === 401) clearAuthCookies(response);
    else if (refreshed) setAuthCookies(response, refreshed.result, refreshed.refreshToken);
    return response;
  }
  if (payload.artifactsExpired) {
    const response = jsonError(410, "The calculation files expired after the 3-day retention window.", "ARTIFACTS_EXPIRED");
    if (refreshed) setAuthCookies(response, refreshed.result, refreshed.refreshToken);
    return response;
  }

  const artifact = payload.result?.artifacts?.find((candidate) => candidate.path === artifactPath);
  const csvArtifact = artifact
    && artifact.role === "data"
    && (artifact.contentType?.includes("csv") || artifact.path?.toLowerCase().endsWith(".csv"));
  const signedUrl = artifact?.viewUrl || artifact?.downloadUrl;
  if (!csvArtifact || !signedUrl) {
    const response = jsonError(404, "The plot data file is not available for this calculation.", "PLOT_DATA_NOT_FOUND");
    if (refreshed) setAuthCookies(response, refreshed.result, refreshed.refreshToken);
    return response;
  }
  if (signedUrl.startsWith(`/api/cloud-artifacts/CALCULATION/${encodeURIComponent(calculationId)}?`)) {
    const response = NextResponse.redirect(new URL(signedUrl, request.url), 307);
    response.headers.set('Cache-Control', 'no-store');
    if (refreshed) setAuthCookies(response, refreshed.result, refreshed.refreshToken);
    return response;
  }

  try {
    const objectResponse = await fetch(signedUrl, { cache: "no-store" });
    if (!objectResponse.ok || !objectResponse.body) {
      const response = jsonError(
        objectResponse.status === 404 ? 404 : 502,
        `The plot data file could not be read (${objectResponse.status}).`,
        "PLOT_DATA_FETCH_FAILED",
      );
      if (refreshed) setAuthCookies(response, refreshed.result, refreshed.refreshToken);
      return response;
    }
    const response = new NextResponse(objectResponse.body, {
      status: 200,
      headers: {
        "Content-Type": artifact.contentType || "text/csv; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
    if (refreshed) setAuthCookies(response, refreshed.result, refreshed.refreshToken);
    return response;
  } catch {
    const response = jsonError(502, "The plot data storage service could not be reached.", "PLOT_DATA_STORAGE_UNREACHABLE");
    if (refreshed) setAuthCookies(response, refreshed.result, refreshed.refreshToken);
    return response;
  }
}

import { localDevelopmentApi } from '@/lib/auth-server';
import { NextRequest, NextResponse } from "next/server";
import { artifactDownloadUrl } from '@/lib/artifact-download-url';
import {
  accessTokenFrom,
  refreshAuth,
  setAuthCookies,
} from "@/lib/auth-server";

function jsonError(status: number, error: string, code: string) {
  return NextResponse.json({ error, code }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: NextRequest) {
  const targetUrl = request.nextUrl.searchParams.get("url")?.trim() || "";
  if (!targetUrl) {
    return jsonError(400, "Missing download URL.", "INVALID_URL");
  }

  const parsed = artifactDownloadUrl(targetUrl, localDevelopmentApi());
  if (!parsed) {
    return jsonError(403, "Forbidden target domain or unsigned URL.", "FORBIDDEN_TARGET");
  }

  // If user has a session, ensure cookies stay refreshed
  let refreshed: Awaited<ReturnType<typeof refreshAuth>> | null = null;
  const accessToken = accessTokenFrom(request);
  if (!accessToken) {
    try {
      refreshed = await refreshAuth(request);
    } catch {
      // Allow proceeding if the URL is an authentic signed S3 URL
    }
  }

  try {
    // A permitted origin must never redirect this server to another destination.
    const upstream = await fetch(parsed, { cache: "no-store", redirect: "manual" });
    if (!upstream.ok || !upstream.body) {
      const response = jsonError(
        upstream.status === 404 ? 404 : 502,
        `Cloud storage returned error (${upstream.status}).`,
        "DOWNLOAD_FAILED",
      );
      if (refreshed) setAuthCookies(response, refreshed.result, refreshed.refreshToken);
      return response;
    }

    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    const response = new NextResponse(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": "attachment",
      },
    });
    if (refreshed) setAuthCookies(response, refreshed.result, refreshed.refreshToken);
    return response;
  } catch {
    const response = jsonError(502, "Cloud storage could not be reached.", "STORAGE_UNREACHABLE");
    if (refreshed) setAuthCookies(response, refreshed.result, refreshed.refreshToken);
    return response;
  }
}

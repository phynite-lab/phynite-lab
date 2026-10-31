import { NextResponse } from "next/server";
import { authErrorResponse, publicBackendFetch } from "@/lib/auth-server";
import { controlPlaneJson } from '@/lib/control-plane-fetch';
import { devSandboxMode } from "@/lib/dev-sandbox";

type PublicHealth = {
  status?: string;
  time?: string;
  capabilities?: {
    dftCompute?: boolean;
    computeBackend?: string;
  };
  compute?: {
    backend?: string;
    status?: string;
    workerId?: string | null;
    lastSeenAt?: string | null;
    staleAfterSeconds?: number;
  };
};

export async function GET() {
  if (devSandboxMode()) {
    return NextResponse.json({
      service: "online",
      checkedAt: new Date().toISOString(),
      compute: { backend: "LOCAL_MAC", status: "offline", workerId: null, lastSeenAt: null, staleAfterSeconds: 90 },
      sandbox: true,
    }, { headers: { "Cache-Control": "no-store", "X-Phynite-Dev-Sandbox": "true" } });
  }
  try {
    const upstream = await publicBackendFetch("/health", {
      headers: { Accept: "application/json" },
    });
    const health = await controlPlaneJson<PublicHealth & {
      error?: string;
      code?: string;
    }>(upstream);
    if (!upstream.ok) {
      return NextResponse.json(
        {
          error: health.error || "The Phynite API health check failed.",
          code: health.code || "API_HEALTH_CHECK_FAILED",
        },
        { status: upstream.status },
      );
    }
    const legacyBackend = health.capabilities?.computeBackend?.toLowerCase();
    const compute = health.compute?.backend && health.compute.status
      ? health.compute
      : health.capabilities?.dftCompute && legacyBackend === "local-mac"
        ? { backend: "LOCAL_MAC", status: "configured" }
        : health.capabilities?.dftCompute && legacyBackend === "aws-batch"
          ? { backend: "AWS_BATCH", status: "available" }
          : legacyBackend === "disabled"
            ? { backend: "DISABLED", status: "disabled" }
            : null;
    if (!compute) return NextResponse.json(
      {
        error: "The Phynite API did not return compute capability status.",
        code: "COMPUTE_STATUS_MISSING",
      },
      { status: 502 },
    );
    return NextResponse.json(
      {
        service: health.status === "ok" ? "online" : health.status || "online",
        checkedAt: health.time || new Date().toISOString(),
        compute,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return authErrorResponse(error);
  }
}

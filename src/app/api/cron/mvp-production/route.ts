import { NextResponse } from "next/server";

import {
  getSecureIngestCronEnvironment,
  hasValidCronAuthorization,
  SecureIngestCronEnvironmentError,
} from "@/config/secure-ingest-cron-env";
import {
  advanceNextMvpProductionJob,
  MvpProductionError,
} from "@/server/mvp-production";
import {
  advanceNextMvpEditPackage,
  MvpEditPackageError,
} from "@/server/mvp-edit-package";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const runtime = "nodejs";

function response(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
    status,
  });
}

export async function GET(request: Request) {
  try {
    const cron = getSecureIngestCronEnvironment();
    if (!hasValidCronAuthorization(request.headers, cron.cronSecret)) {
      return response({ code: "CRON_AUTHORIZATION_REJECTED", ok: false }, 401);
    }
    const production = await advanceNextMvpProductionJob();
    const editPackage = production.advanced
      ? { advanced: false }
      : await advanceNextMvpEditPackage();
    return response({ editPackage, ok: true, production }, 200);
  } catch (error) {
    console.error("MVP production advance failed safely", {
      errorName: error instanceof Error ? error.name : "UnknownError",
      safeCode:
        error instanceof MvpProductionError || error instanceof MvpEditPackageError
          ? error.safeCode
          : error instanceof SecureIngestCronEnvironmentError
            ? "CRON_CONFIGURATION_UNAVAILABLE"
            : "PRODUCTION_UNAVAILABLE",
    });
    return response(
      {
        code:
          error instanceof MvpProductionError || error instanceof MvpEditPackageError
            ? error.safeCode
            : error instanceof SecureIngestCronEnvironmentError
              ? "CRON_CONFIGURATION_UNAVAILABLE"
              : "PRODUCTION_UNAVAILABLE",
        ok: false,
      },
      503,
    );
  }
}

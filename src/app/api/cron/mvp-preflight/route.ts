import { NextResponse } from "next/server";

import {
  getSecureIngestCronEnvironment,
  hasValidCronAuthorization,
} from "@/config/secure-ingest-cron-env";
import {
  advanceNextMvpPreflight,
  MvpPreflightError,
} from "@/server/mvp-preflight-runner";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const cron = getSecureIngestCronEnvironment();
    if (!hasValidCronAuthorization(request.headers, cron.cronSecret)) {
      return NextResponse.json(
        { code: "CRON_AUTHORIZATION_REJECTED", ok: false },
        { status: 401 },
      );
    }
    return NextResponse.json({ ok: true, ...(await advanceNextMvpPreflight()) });
  } catch (error) {
    console.error("MVP preflight advance paused", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json(
      {
        code:
          error instanceof MvpPreflightError
            ? "MVP_PREFLIGHT_PAUSED"
            : "MVP_PREFLIGHT_UNAVAILABLE",
        ok: false,
      },
      { status: 503 },
    );
  }
}

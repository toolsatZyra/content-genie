import { NextResponse } from "next/server";

import { EnvironmentContractError } from "@/config/env-core";
import { getServerEnvironment } from "@/config/server-env";
import { createCorrelationId } from "@/observability/correlation";

export function GET(): NextResponse {
  const requestId = createCorrelationId("request");
  try {
    const environment = getServerEnvironment();
    return NextResponse.json(
      {
        environment: environment.environment,
        ok: true,
        requestId,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const configurationError = error instanceof EnvironmentContractError;
    return NextResponse.json(
      {
        code: configurationError
          ? "RUNTIME_CONFIGURATION_INVALID"
          : "RUNTIME_HEALTH_UNAVAILABLE",
        ok: false,
        requestId,
      },
      {
        headers: { "cache-control": "no-store" },
        status: 503,
      },
    );
  }
}

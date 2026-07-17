import { NextResponse, type NextRequest } from "next/server";

import { parseServerEnvironment } from "@/config/env-core";
import { createCorrelationId, readCorrelationId } from "@/observability/correlation";

export function proxy(request: NextRequest): NextResponse {
  const requestId =
    readCorrelationId(request.headers) ?? createCorrelationId("request");
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);

  try {
    parseServerEnvironment(process.env);
  } catch {
    const denied = NextResponse.json(
      { code: "RUNTIME_CONFIGURATION_INVALID", ok: false, requestId },
      { status: 503 },
    );
    denied.headers.set("cache-control", "no-store");
    denied.headers.set("x-request-id", requestId);
    return denied;
  }

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set("x-request-id", requestId);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"],
};

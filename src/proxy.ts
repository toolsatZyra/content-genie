import { NextResponse, type NextRequest } from "next/server";

import { parseServerEnvironment } from "@/config/env-core";
import { createCorrelationId, readCorrelationId } from "@/observability/correlation";

import { refreshSupabaseSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const requestId =
    readCorrelationId(request.headers) ?? createCorrelationId("request");
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);

  let environment;
  try {
    environment = parseServerEnvironment(process.env);
  } catch {
    const denied = NextResponse.json(
      { code: "RUNTIME_CONFIGURATION_INVALID", ok: false, requestId },
      { status: 503 },
    );
    denied.headers.set("cache-control", "no-store");
    denied.headers.set("x-request-id", requestId);
    return denied;
  }

  const response =
    environment.environment === "test" ||
    new URL(
      environment.public.supabaseUrl ?? "https://unconfigured.invalid",
    ).hostname.endsWith(".invalid")
      ? NextResponse.next({ request: { headers: requestHeaders } })
      : await refreshSupabaseSession(request, requestHeaders, environment.public);
  response.headers.set("x-request-id", requestId);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"],
};

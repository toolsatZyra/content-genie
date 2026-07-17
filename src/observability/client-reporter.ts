"use client";

import { createCorrelationId, type CorrelationIds } from "@/observability/correlation";
import { redactText } from "@/observability/redaction";

export function reportClientError(
  error: Error & { digest?: string },
  correlations: CorrelationIds = {},
): string {
  const requestId = correlations.requestId ?? createCorrelationId("request");
  const payload = JSON.stringify({
    ...correlations,
    event: "app.client_error",
    message: redactText(error.message || "Unexpected client error"),
    metadata: {
      digest: error.digest ?? null,
      route: window.location.pathname,
    },
    occurredAt: new Date().toISOString(),
    requestId,
    severity: "error",
  });

  if (!navigator.sendBeacon?.("/api/diagnostics/client", payload)) {
    void fetch("/api/diagnostics/client", {
      body: payload,
      headers: { "content-type": "application/json" },
      keepalive: true,
      method: "POST",
    }).catch(() => undefined);
  }

  return requestId;
}

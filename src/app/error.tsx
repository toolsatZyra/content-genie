"use client";

import { useEffect, useState } from "react";

import { reportClientError } from "@/observability/client-reporter";
import { createCorrelationId } from "@/observability/correlation";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [reference] = useState(() => createCorrelationId("request"));

  useEffect(() => {
    reportClientError(error, { requestId: reference });
  }, [error, reference]);

  return (
    <main className="error-stage" id="main-content">
      <span className="error-stage__kicker">The projection paused safely</span>
      <h1>Genie protected your work.</h1>
      <p>
        Try this chamber again. If it repeats, share only the reference below; the
        underlying error remains private.
      </p>
      <code>{reference}</code>
      <button className="primary-button" onClick={reset} type="button">
        Reopen chamber
      </button>
    </main>
  );
}

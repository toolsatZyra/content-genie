"use client";

import { useEffect, useState } from "react";

import { reportClientError } from "@/observability/client-reporter";
import { createCorrelationId } from "@/observability/correlation";

export default function GlobalError({
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
    <html lang="en">
      <body>
        <main className="error-stage" id="main-content">
          <span className="error-stage__kicker">Studio safeguard</span>
          <h1>Genie closed the curtain for a moment.</h1>
          <p>Your project data was not changed. Reopen the studio to continue.</p>
          <code>{reference}</code>
          <button className="primary-button" onClick={reset} type="button">
            Reopen Genie
          </button>
        </main>
      </body>
    </html>
  );
}

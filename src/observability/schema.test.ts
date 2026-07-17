import { describe, expect, it } from "vitest";

import {
  DiagnosticValidationError,
  parseDiagnosticEvent,
} from "@/observability/schema";

describe("diagnostic schema", () => {
  it("accepts allowlisted, correlated events and redacts metadata", () => {
    const event = parseDiagnosticEvent({
      event: "app.stage",
      message: "Stage entered",
      metadata: { api_key: "private", state: "running" },
      requestId: "request_12345678",
      severity: "info",
    });

    expect(event.requestId).toBe("request_12345678");
    expect(event.metadata).toEqual({ api_key: "[REDACTED]", state: "running" });
  });

  it("rejects unknown event names", () => {
    expect(() =>
      parseDiagnosticEvent({
        event: "arbitrary.event",
        message: "No",
        severity: "info",
      }),
    ).toThrow(DiagnosticValidationError);
  });

  it("rejects malformed correlation IDs", () => {
    expect(() =>
      parseDiagnosticEvent({
        event: "app.request",
        message: "No",
        requestId: "bad",
        severity: "warning",
      }),
    ).toThrow("requestId is malformed");
  });

  it("rejects non-objects, invalid severities, and empty messages", () => {
    expect(() => parseDiagnosticEvent(null)).toThrow("must be an object");
    expect(() =>
      parseDiagnosticEvent({
        event: "app.error",
        message: "message",
        severity: "fatal",
      }),
    ).toThrow("severity is invalid");
    expect(() =>
      parseDiagnosticEvent({
        event: "app.error",
        message: "  ",
        severity: "error",
      }),
    ).toThrow("message is required");
  });

  it("preserves a valid timestamp and all supported correlation IDs", () => {
    expect(
      parseDiagnosticEvent({
        commandId: "command_12345678",
        event: "app.command",
        message: "accepted",
        occurredAt: "2026-07-17T00:00:00.000Z",
        providerId: "provider_12345678",
        runId: "run_12345678",
        severity: "debug",
        stageId: "stage_12345678",
      }),
    ).toMatchObject({
      commandId: "command_12345678",
      occurredAt: "2026-07-17T00:00:00.000Z",
      providerId: "provider_12345678",
      runId: "run_12345678",
      stageId: "stage_12345678",
    });
  });
});

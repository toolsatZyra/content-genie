import { isCorrelationId, type CorrelationIds } from "@/observability/correlation";
import { redactValue, type RedactedValue } from "@/observability/redaction";

export const diagnosticSeverities = ["debug", "info", "warning", "error"] as const;
export type DiagnosticSeverity = (typeof diagnosticSeverities)[number];

export const diagnosticEventNames = [
  "app.client_error",
  "app.command",
  "app.error",
  "app.provider",
  "app.request",
  "app.run",
  "app.stage",
] as const;
export type DiagnosticEventName = (typeof diagnosticEventNames)[number];

export interface DiagnosticEvent extends CorrelationIds {
  readonly event: DiagnosticEventName;
  readonly message: string;
  readonly metadata: RedactedValue;
  readonly occurredAt: string;
  readonly severity: DiagnosticSeverity;
}

export class DiagnosticValidationError extends Error {
  override readonly name = "DiagnosticValidationError";
}

function isEventName(value: unknown): value is DiagnosticEventName {
  return diagnosticEventNames.includes(value as DiagnosticEventName);
}

function isSeverity(value: unknown): value is DiagnosticSeverity {
  return diagnosticSeverities.includes(value as DiagnosticSeverity);
}

export function parseDiagnosticEvent(value: unknown): DiagnosticEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DiagnosticValidationError("Diagnostic event must be an object.");
  }

  const candidate = value as Record<string, unknown>;
  if (!isEventName(candidate.event)) {
    throw new DiagnosticValidationError("Diagnostic event name is not allowlisted.");
  }
  if (!isSeverity(candidate.severity)) {
    throw new DiagnosticValidationError("Diagnostic severity is invalid.");
  }
  if (typeof candidate.message !== "string" || candidate.message.trim().length === 0) {
    throw new DiagnosticValidationError("Diagnostic message is required.");
  }

  const occurredAt =
    typeof candidate.occurredAt === "string" &&
    !Number.isNaN(Date.parse(candidate.occurredAt))
      ? candidate.occurredAt
      : new Date().toISOString();

  const correlations: CorrelationIds = {};
  for (const key of [
    "commandId",
    "providerId",
    "requestId",
    "runId",
    "stageId",
  ] as const) {
    const id = candidate[key];
    if (id !== undefined) {
      if (!isCorrelationId(id)) {
        throw new DiagnosticValidationError(`${key} is malformed.`);
      }
      correlations[key] = id;
    }
  }

  return Object.freeze({
    ...correlations,
    event: candidate.event,
    message: String(redactValue(candidate.message)),
    metadata: redactValue(candidate.metadata ?? {}),
    occurredAt,
    severity: candidate.severity,
  });
}

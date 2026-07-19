import { createHash, createHmac, randomUUID } from "node:crypto";

export const MAX_COMMAND_BYTES = 16_384;

export type CommandType =
  | "episode.create"
  | "episode.look.select"
  | "episode.voice.select"
  | "invitation.accept"
  | "invitation.create"
  | "membership.offboard"
  | "series.archive"
  | "series.create"
  | "work.claim";

export interface ParsedCommand {
  readonly commandType: CommandType;
  readonly payload: Record<string, unknown>;
}

export class CommandValidationError extends Error {
  override readonly name = "CommandValidationError";
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

export function hashCommand(command: ParsedCommand): string {
  return createHash("sha256").update(canonicalJson(command)).digest("hex");
}

export function newCommandIdentity(): {
  readonly commandId: string;
  readonly correlationId: string;
} {
  return { commandId: randomUUID(), correlationId: randomUUID() };
}

export function deriveInvitationToken(
  secret: string,
  input: Readonly<{
    actorUserId: string;
    idempotencyKey: string;
    invitedEmail: string;
    maximumRole: "member" | "reviewer";
    workspaceId: string;
  }>,
): {
  readonly hash: string;
  readonly token: string;
} {
  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw new CommandValidationError("Invitation service secret is invalid.");
  }
  const token = createHmac("sha256", secret)
    .update(
      canonicalJson({
        actorUserId: input.actorUserId,
        idempotencyKey: input.idempotencyKey,
        invitedEmail: input.invitedEmail.toLowerCase(),
        maximumRole: input.maximumRole,
        purpose: "genie.invitation.v1",
        workspaceId: input.workspaceId,
      }),
    )
    .digest("base64url");
  return {
    hash: createHash("sha256").update(token).digest("hex"),
    token,
  };
}

export function parseIdempotencyKey(value: string | null): string {
  if (
    !value ||
    value.length < 8 ||
    value.length > 128 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]+$/.test(value)
  ) {
    throw new CommandValidationError("A valid idempotency key is required.");
  }
  return value;
}

export function parseCommand(value: unknown): ParsedCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CommandValidationError("Command body must be an object.");
  }
  const body = value as Record<string, unknown>;
  const supported: readonly CommandType[] = [
    "episode.create",
    "episode.look.select",
    "episode.voice.select",
    "invitation.accept",
    "invitation.create",
    "membership.offboard",
    "series.archive",
    "series.create",
    "work.claim",
  ];
  if (!supported.includes(body.commandType as CommandType)) {
    throw new CommandValidationError("Unsupported command type.");
  }
  if (
    !body.payload ||
    typeof body.payload !== "object" ||
    Array.isArray(body.payload)
  ) {
    throw new CommandValidationError("Command payload must be an object.");
  }
  return {
    commandType: body.commandType as CommandType,
    payload: body.payload as Record<string, unknown>,
  };
}

export function assertExactPayloadKeys(
  payload: Record<string, unknown>,
  expectedKeys: readonly string[],
): void {
  const actual = Object.keys(payload).sort();
  const expected = [...expectedKeys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new CommandValidationError(
      `Command payload keys must be exactly: ${expected.join(", ")}.`,
    );
  }
}

export function boundedText(
  payload: Record<string, unknown>,
  key: string,
  maximum: number,
  required = true,
): string {
  const value = typeof payload[key] === "string" ? payload[key].trim() : "";
  if ((required && value.length === 0) || value.length > maximum) {
    throw new CommandValidationError(`${key} is invalid.`);
  }
  return value;
}

export function uuidValue(
  payload: Record<string, unknown>,
  key: string,
  fallback?: string,
): string {
  const value = typeof payload[key] === "string" ? payload[key] : fallback;
  if (
    !value ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new CommandValidationError(`${key} must be a UUID.`);
  }
  return value;
}

export function integerValue(
  payload: Record<string, unknown>,
  key: string,
  minimum: number,
  maximum: number,
): number {
  const value = payload[key];
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new CommandValidationError(`${key} is invalid.`);
  }
  return value;
}

"use client";

export interface CommandResponse {
  readonly inviteToken?: string;
  readonly message?: string;
  readonly ok: boolean;
  readonly requestId?: string;
  readonly result?: unknown;
}

export class CommandMutationError extends Error {
  override readonly name = "CommandMutationError";

  constructor(
    message: string,
    readonly definitive: boolean,
    readonly status: number,
  ) {
    super(message);
  }
}

export function isDefinitiveMutationStatus(status: number): boolean {
  return status >= 400 && status < 500 && ![408, 425, 429].includes(status);
}

export async function readCommandResponse(
  response: Response,
  fallbackMessage: string,
): Promise<CommandResponse> {
  let body: Partial<CommandResponse> = {};
  try {
    const value: unknown = await response.json();
    if (value && typeof value === "object" && !Array.isArray(value)) {
      body = value as Partial<CommandResponse>;
    }
  } catch {
    // Empty or non-JSON proxy/CDN failures are represented by the domain
    // fallback below; parser implementation text must never reach the user.
  }
  if (!response.ok || body.ok !== true) {
    throw new CommandMutationError(
      typeof body.message === "string" ? body.message : fallbackMessage,
      isDefinitiveMutationStatus(response.status),
      response.status,
    );
  }
  return body as CommandResponse;
}

export async function sendCommand(
  commandType: string,
  payload: Record<string, unknown>,
  idempotencyKey = crypto.randomUUID(),
): Promise<CommandResponse> {
  const response = await fetch("/api/commands", {
    body: JSON.stringify({ commandType, payload }),
    cache: "no-store",
    headers: {
      "content-type": "application/json",
      "x-idempotency-key": idempotencyKey,
    },
    method: "POST",
  });
  return readCommandResponse(response, "The change could not be saved.");
}

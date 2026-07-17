"use client";

export interface CommandResponse {
  readonly inviteToken?: string;
  readonly message?: string;
  readonly ok: boolean;
  readonly requestId?: string;
  readonly result?: unknown;
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
  const body = (await response.json()) as CommandResponse;
  if (!response.ok || !body.ok) {
    throw new Error(body.message ?? "The change could not be saved.");
  }
  return body;
}

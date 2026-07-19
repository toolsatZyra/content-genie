import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import {
  authenticateLiveBrokerRequest,
  LIVE_BROKER_MAX_BODY_BYTES,
  LiveBrokerRequestError,
  parseLiveBrokerRequest,
  type LiveBrokerRequest,
  type LiveBrokerStopRequest,
} from "@/server/live-broker-contract";
import { signLiveBrokerEvidence } from "@/server/live-broker-evidence";
import {
  claimLiveBrokerRequest,
  LiveBrokerLedgerError,
  reconcileLiveBrokerCancellation,
  recordLiveBrokerCreated,
  recordLiveBrokerState,
} from "@/server/live-broker-ledger";
import {
  startLiveSandbox,
  statusLiveSandbox,
  stopLiveSandbox,
} from "@/server/live-sandbox-control";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const runtime = "nodejs";

function response(body: object, status = 200) {
  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
    status,
  });
}

function declaredRequestBodyBytes(headers: Headers): number | null {
  const value = headers.get("content-length");
  if (value === null) return null;
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new LiveBrokerRequestError("Invalid request content length.", 400);
  }
  const length = Number(value);
  if (!Number.isSafeInteger(length)) {
    throw new LiveBrokerRequestError("Invalid request content length.", 400);
  }
  if (length > LIVE_BROKER_MAX_BODY_BYTES) {
    throw new LiveBrokerRequestError("Live-broker request is too large.", 400);
  }
  return length;
}

async function cancelReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    // The bounded-reader failure remains authoritative if transport cancellation fails.
  }
}

async function readLiveBrokerBody(request: Request): Promise<string> {
  const declaredBytes = declaredRequestBodyBytes(request.headers);
  if (!request.body) {
    if (declaredBytes !== null && declaredBytes !== 0) {
      throw new LiveBrokerRequestError(
        "Request content length did not match body.",
        400,
      );
    }
    return "";
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      let part: ReadableStreamReadResult<Uint8Array>;
      try {
        part = await reader.read();
      } catch {
        await cancelReader(reader);
        throw new LiveBrokerRequestError("Request body could not be read safely.", 400);
      }
      if (part.done) break;
      const nextTotal = totalBytes + part.value.byteLength;
      if (
        !Number.isSafeInteger(nextTotal) ||
        nextTotal > LIVE_BROKER_MAX_BODY_BYTES ||
        (declaredBytes !== null && nextTotal > declaredBytes)
      ) {
        await cancelReader(reader);
        throw new LiveBrokerRequestError(
          nextTotal > LIVE_BROKER_MAX_BODY_BYTES
            ? "Live-broker request is too large."
            : "Request content length did not match body.",
          400,
        );
      }
      chunks.push(part.value);
      totalBytes = nextTotal;
    }
  } finally {
    reader.releaseLock();
  }

  if (declaredBytes !== null && totalBytes !== declaredBytes) {
    throw new LiveBrokerRequestError("Request content length did not match body.", 400);
  }
  const bytes = Buffer.concat(chunks, totalBytes);
  try {
    const rawBody = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(bytes);
    if (!Buffer.from(rawBody, "utf8").equals(bytes)) {
      throw new TypeError("UTF-8 round trip mismatch");
    }
    return rawBody;
  } catch {
    throw new LiveBrokerRequestError("Request body is not valid UTF-8.", 400);
  }
}

function stopCommand(command: LiveBrokerRequest): LiveBrokerStopRequest {
  return {
    action: "stop",
    candidate: command.candidate,
    sandboxName: command.sandboxName,
    schemaVersion: command.schemaVersion,
  };
}

async function deleteAndRecord(
  command: LiveBrokerRequest,
  brokerDeploymentCommit: string,
): Promise<Awaited<ReturnType<typeof stopLiveSandbox>>> {
  const deletion = await stopLiveSandbox(stopCommand(command));
  await recordLiveBrokerState(command, "deleted", brokerDeploymentCommit);
  return deletion;
}

export async function POST(request: Request) {
  if (
    process.env.VERCEL_ENV !== "production" ||
    !/^[a-f0-9]{40}$/u.test(process.env.VERCEL_GIT_COMMIT_SHA ?? "")
  ) {
    return response({ code: "BROKER_UNAVAILABLE", ok: false }, 503);
  }
  try {
    const rawBody = await readLiveBrokerBody(request);
    const authentication = authenticateLiveBrokerRequest(request.headers, rawBody);
    const command = parseLiveBrokerRequest(rawBody);
    const brokerDeploymentCommit = process.env.VERCEL_GIT_COMMIT_SHA!;
    if (command.candidate.commit !== brokerDeploymentCommit) {
      throw new LiveBrokerRequestError(
        "The live broker accepts only its independently reviewed deployment tree.",
        409,
      );
    }
    const lifecycle = await claimLiveBrokerRequest({
      bodySha256: createHash("sha256").update(rawBody).digest("hex"),
      brokerDeploymentCommit,
      command,
      ...authentication,
    });
    let result: object;
    if (command.action === "start") {
      if (lifecycle.cancelRequested) {
        throw new LiveBrokerRequestError(
          "The signed sandbox name has a durable cancellation tombstone.",
          409,
        );
      }
      try {
        const started = await startLiveSandbox(command);
        const recorded = await recordLiveBrokerCreated(
          command,
          started.sandboxSessionId,
          brokerDeploymentCommit,
        );
        if (recorded.cancelRequested) {
          throw new LiveBrokerRequestError(
            "Sandbox creation was cancelled concurrently.",
            409,
          );
        }
        result = started;
      } catch (error) {
        try {
          await deleteAndRecord(command, brokerDeploymentCommit);
        } catch {
          await recordLiveBrokerState(command, "failed", brokerDeploymentCommit).catch(
            () => undefined,
          );
        }
        throw error;
      }
    } else if (command.action === "status") {
      if (["cancel_requested", "deleted", "failed"].includes(lifecycle.state)) {
        throw new LiveBrokerRequestError(
          "The live sandbox lifecycle is terminal or cancelled.",
          409,
        );
      }
      result = await statusLiveSandbox(command);
      if ((result as { state?: string }).state === "finished") {
        await recordLiveBrokerState(command, "finished", brokerDeploymentCommit);
      }
    } else {
      const initialDeletion = await stopLiveSandbox(command);
      const current = await reconcileLiveBrokerCancellation(
        command,
        brokerDeploymentCommit,
      );
      if (current.createInFlight) {
        const leaseDeadline = Date.parse(current.createLeaseExpiresAt ?? "");
        const retryAfterMs = Number.isFinite(leaseDeadline)
          ? Math.max(1_000, Math.min(60_000, leaseDeadline - Date.now() + 1_000))
          : 30_000;
        result = {
          ...initialDeletion,
          deleted: false,
          retryAfterMs,
        };
      } else {
        const finalDeletion = await stopLiveSandbox(command);
        await recordLiveBrokerState(command, "deleted", brokerDeploymentCommit);
        result = finalDeletion;
      }
    }
    const brokerEvidence = signLiveBrokerEvidence({
      action: command.action,
      brokerDeploymentCommit,
      rawBody,
      result,
    });
    return response({
      brokerDeploymentCommit,
      brokerEvidence,
      ok: true,
      result,
    });
  } catch (error) {
    if (error instanceof LiveBrokerRequestError) {
      return response(
        {
          code:
            error.status === 401
              ? "BROKER_AUTHENTICATION_FAILED"
              : error.status === 409
                ? "BROKER_REPLAY_OR_CONFLICT"
                : "BROKER_REQUEST_INVALID",
          ok: false,
        },
        error.status,
      );
    }
    if (error instanceof LiveBrokerLedgerError && error.conflict) {
      return response({ code: "BROKER_REPLAY_OR_CONFLICT", ok: false }, 409);
    }
    console.error("Live broker failed safely", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return response({ code: "BROKER_OPERATION_FAILED", ok: false }, 502);
  }
}

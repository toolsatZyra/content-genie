import { NextResponse } from "next/server";

import { getServerEnvironment } from "@/config/server-env";
import {
  PreflightControlAssertionError,
  verifyPreflightControlAssertion,
} from "@/domain/preflight/control-broker-assertion";
import {
  parsePreflightControlRequest,
  PREFLIGHT_CONTROL_MAX_BODY_BYTES,
  PreflightControlContractError,
} from "@/domain/preflight/control-broker-contract";
import { parsePreflightTaskEnvelope } from "../../../../../../trigger/preflight-contract";
import {
  BoundedRequestBodyError,
  declaredRequestBodyBytes,
  readBoundedUtf8RequestBody,
} from "@/server/bounded-request-body";
import { getDatabaseBrokerVerificationContext } from "@/server/provider-broker-ledger";
import {
  consumePreflightControlAssertion,
  dispatchPreflightControl,
  failPreflightControl,
  finalizePreflightControl,
  markWorldAnchorWaitingExternal,
  PreflightControlLedgerError,
} from "@/server/preflight-control-ledger";
import {
  classifyPreflightControlFailure,
  executePreflightControl,
} from "@/server/preflight-control-executor";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const runtime = "nodejs";

function response(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
    status,
  });
}

function boundedHeader(headers: Headers, name: string, maximum: number): string {
  const value = headers.get(name)?.trim() ?? "";
  if (value.length < 1 || value.length > maximum) {
    throw new PreflightControlAssertionError(`${name} is invalid.`);
  }
  return value;
}

function bearer(headers: Headers): string {
  const value = boundedHeader(headers, "authorization", 8_192);
  if (!value.startsWith("Bearer ") || value.slice(7).includes(" ")) {
    throw new PreflightControlAssertionError("Control authorization is invalid.");
  }
  return value.slice(7);
}

export async function POST(request: Request) {
  if (request.headers.get("content-type")?.split(";", 1)[0] !== "application/json") {
    return response({ code: "JSON_REQUIRED", ok: false }, 415);
  }
  try {
    const environment = getServerEnvironment();
    const declaredLength = declaredRequestBodyBytes(
      request.headers,
      PREFLIGHT_CONTROL_MAX_BODY_BYTES,
    );
    const rawBody = await readBoundedUtf8RequestBody(
      request,
      PREFLIGHT_CONTROL_MAX_BODY_BYTES,
      declaredLength,
    );
    const controlRequest = parsePreflightControlRequest(rawBody);
    const clientId = boundedHeader(request.headers, "x-genie-broker-client-id", 100);
    const kid = boundedHeader(request.headers, "x-genie-broker-kid", 80);
    const triggerProject = boundedHeader(
      request.headers,
      "x-genie-trigger-project",
      100,
    );
    const databaseContext = await getDatabaseBrokerVerificationContext({
      clientId,
      environment: environment.environment,
      kid,
      triggerProject,
    });
    const verified = verifyPreflightControlAssertion(
      bearer(request.headers),
      controlRequest,
      {
        audience: databaseContext.audience,
        brokerClientId: databaseContext.clientId,
        brokerClientPublicKeySpkiBase64: databaseContext.publicKeySpkiBase64,
        environment: environment.environment,
        keyId: databaseContext.kid,
        triggerProject: databaseContext.triggerProject,
      },
    );
    await consumePreflightControlAssertion({
      clientId,
      environment: environment.environment,
      expiresAtSeconds: verified.expiresAt,
      issuedAtSeconds: verified.issuedAt,
      jti: verified.jti,
      kid,
      request: controlRequest,
      subject: verified.subject,
      triggerProject,
    });

    if (controlRequest.operation === "dispatch") {
      const result = await dispatchPreflightControl({
        preflightRunId: controlRequest.preflightRunId,
        triggerRunId: verified.triggerRunId,
      });
      return response({ ...result, ok: true }, 200);
    }
    if (controlRequest.operation === "execute") {
      const envelope = parsePreflightTaskEnvelope(
        JSON.parse(boundedHeader(request.headers, "x-genie-preflight-envelope", 4_096)),
      );
      if (
        envelope.preflightRunId !== controlRequest.preflightRunId ||
        envelope.stageAttemptId !== controlRequest.stageAttemptId ||
        envelope.stageRunId !== controlRequest.stageRunId
      ) {
        throw new PreflightControlAssertionError(
          "Control envelope binding is invalid.",
        );
      }
      try {
        const result = await executePreflightControl({
          envelope,
          taskId: verified.taskId,
          triggerRunId: verified.triggerRunId,
        });
        return response(result, 200);
      } catch (error) {
        const classified = classifyPreflightControlFailure(error);
        if (!classified || classified.retryable) throw error;
        const failure = await failPreflightControl({
          envelope,
          retryable: false,
          safeErrorClass: classified.safeErrorClass,
          taskId: verified.taskId,
          triggerRunId: verified.triggerRunId,
        });
        return response(
          {
            failure,
            pendingExternal: false,
            providerDispatches: [],
            terminal: true,
          },
          200,
        );
      }
    }
    if (controlRequest.operation === "finalize") {
      return response(
        await finalizePreflightControl({
          preflightRunId: controlRequest.preflightRunId,
          triggerRunId: verified.triggerRunId,
        }),
        200,
      );
    }
    if (controlRequest.operation === "externalize") {
      const envelope = parsePreflightTaskEnvelope(
        JSON.parse(boundedHeader(request.headers, "x-genie-preflight-envelope", 4_096)),
      );
      if (
        envelope.preflightRunId !== controlRequest.preflightRunId ||
        envelope.stageAttemptId !== controlRequest.stageAttemptId ||
        envelope.stageRunId !== controlRequest.stageRunId
      ) {
        throw new PreflightControlAssertionError(
          "Control externalization binding is invalid.",
        );
      }
      return response(
        await markWorldAnchorWaitingExternal({
          envelope,
          taskId: verified.taskId,
          triggerRunId: verified.triggerRunId,
        }),
        200,
      );
    }
    if (controlRequest.operation === "fail") {
      const envelope = parsePreflightTaskEnvelope(
        JSON.parse(boundedHeader(request.headers, "x-genie-preflight-envelope", 4_096)),
      );
      if (
        envelope.preflightRunId !== controlRequest.preflightRunId ||
        envelope.stageAttemptId !== controlRequest.stageAttemptId ||
        envelope.stageRunId !== controlRequest.stageRunId
      ) {
        throw new PreflightControlAssertionError("Control failure binding is invalid.");
      }
      return response(
        await failPreflightControl({
          envelope,
          retryable: true,
          safeErrorClass: "trigger_task_failed",
          taskId: verified.taskId,
          triggerRunId: verified.triggerRunId,
        }),
        200,
      );
    }
    return response({ code: "CONTROL_OPERATION_REJECTED", ok: false }, 400);
  } catch (error) {
    if (
      error instanceof PreflightControlAssertionError ||
      error instanceof PreflightControlContractError
    ) {
      return response({ code: "CONTROL_AUTHORITY_REJECTED", ok: false }, 401);
    }
    if (error instanceof BoundedRequestBodyError) {
      return response({ code: "CONTROL_BODY_REJECTED", ok: false }, 413);
    }
    if (error instanceof PreflightControlLedgerError) {
      return response(
        {
          code: error.conflict ? "CONTROL_CONFLICT" : "CONTROL_LEDGER_REJECTED",
          ok: false,
        },
        error.conflict ? 409 : 503,
      );
    }
    return response({ code: "CONTROL_UNAVAILABLE", ok: false }, 503);
  }
}

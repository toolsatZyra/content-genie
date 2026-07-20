import { NextResponse } from "next/server";

import { getProviderBrokerEnvironment } from "@/config/provider-broker-env";
import {
  BrokerAssertionError,
  verifyBrokerAuthorization,
} from "@/domain/provider/broker-assertion";
import {
  parseProviderBrokerRequest,
  PROVIDER_BROKER_MAX_BODY_BYTES,
  ProviderBrokerContractError,
} from "@/domain/provider/broker-contract";
import {
  BoundedRequestBodyError,
  declaredRequestBodyBytes,
  readBoundedUtf8RequestBody,
} from "@/server/bounded-request-body";
import {
  ProviderAdapterError,
  submitProviderAdapter,
} from "@/server/provider-adapters";
import {
  consumeProviderBrokerAuthority,
  getDatabaseBrokerVerificationContext,
  getProviderDispatchManifest,
  ProviderBrokerLedgerError,
  quarantineImmediateProviderBytes,
  recordProviderBrokerSecurityRejection,
  transitionProviderRequest,
} from "@/server/provider-broker-ledger";

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
    throw new BrokerAssertionError(`${name} is invalid.`);
  }
  return value;
}

function bearer(headers: Headers): string {
  const value = boundedHeader(headers, "authorization", 8_192);
  if (!value.startsWith("Bearer ") || value.slice(7).includes(" ")) {
    throw new BrokerAssertionError("Broker authorization is invalid.");
  }
  return value.slice(7);
}

function jwtTimes(token: string): { exp: number; iat: number } {
  const encodedPayload = token.split(".")[1];
  if (!encodedPayload) throw new BrokerAssertionError("Broker assertion is malformed.");
  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as {
      exp?: unknown;
      iat?: unknown;
    };
    if (!Number.isSafeInteger(payload.exp) || !Number.isSafeInteger(payload.iat)) {
      throw new TypeError("invalid time");
    }
    return { exp: payload.exp as number, iat: payload.iat as number };
  } catch {
    throw new BrokerAssertionError("Broker assertion time is invalid.");
  }
}

type BrokerRejectionContext = Readonly<{
  clientId: string;
  environment: string;
  kid: string;
  triggerProject: string;
}>;

async function recordSecurityRejection(
  context: BrokerRejectionContext | null,
  reasonCode: "assertion_invalid" | "contract_invalid" | "replay_or_stale",
) {
  if (!context) return;
  try {
    await recordProviderBrokerSecurityRejection({ ...context, reasonCode });
  } catch (error) {
    console.error("Provider broker security rejection evidence failed safely", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
  }
}

export async function POST(request: Request) {
  if (request.headers.get("content-type")?.split(";", 1)[0] !== "application/json") {
    return response({ code: "JSON_REQUIRED", ok: false }, 415);
  }
  let rejectionContext: BrokerRejectionContext | null = null;
  try {
    const environment = getProviderBrokerEnvironment();
    const declaredLength = declaredRequestBodyBytes(
      request.headers,
      PROVIDER_BROKER_MAX_BODY_BYTES,
    );
    const rawBody = await readBoundedUtf8RequestBody(
      request,
      PROVIDER_BROKER_MAX_BODY_BYTES,
      declaredLength,
    );
    const brokerRequest = parseProviderBrokerRequest(rawBody);
    const serviceAssertion = bearer(request.headers);
    const capabilityToken = boundedHeader(request.headers, "x-genie-capability", 8_192);
    const clientId = boundedHeader(request.headers, "x-genie-broker-client-id", 100);
    const kid = boundedHeader(request.headers, "x-genie-broker-kid", 80);
    const triggerProject = boundedHeader(
      request.headers,
      "x-genie-trigger-project",
      100,
    );
    rejectionContext = {
      clientId,
      environment: environment.environment,
      kid,
      triggerProject,
    };
    const databaseContext = await getDatabaseBrokerVerificationContext({
      clientId,
      environment: environment.environment,
      kid,
      triggerProject,
    });
    if (databaseContext.audience !== environment.audience) {
      throw new BrokerAssertionError("Broker audience configuration is inconsistent.");
    }
    const verified = verifyBrokerAuthorization(
      serviceAssertion,
      capabilityToken,
      brokerRequest,
      {
        audience: environment.audience,
        brokerClientId: databaseContext.clientId,
        brokerClientPublicKeySpkiBase64: databaseContext.publicKeySpkiBase64,
        capabilityIssuer: environment.capabilityIssuer,
        capabilityPublicKeySpkiBase64: environment.capabilityVerifyPublicKeySpkiBase64,
        environment: environment.environment,
        keyId: databaseContext.kid,
        triggerProject: databaseContext.triggerProject,
      },
    );
    const times = jwtTimes(serviceAssertion);
    const consumed = await consumeProviderBrokerAuthority({
      assertionExpiresAtSeconds: times.exp,
      assertionIssuedAtSeconds: times.iat,
      assertionJti: verified.assertionJti,
      assertionSubject: verified.assertionSubject,
      capabilityJti: verified.capabilityJti,
      clientId,
      environment: environment.environment,
      kid,
      request: brokerRequest,
      triggerProject,
    });
    const manifest = await getProviderDispatchManifest(brokerRequest.providerRequestId);
    if (
      manifest.providerRequestId !== brokerRequest.providerRequestId ||
      manifest.workspaceId !== brokerRequest.workspaceId ||
      manifest.operation !== brokerRequest.operation ||
      manifest.inputManifestHash !== brokerRequest.inputManifestSha256 ||
      manifest.aggregateVersion !== consumed.aggregateVersion
    ) {
      throw new ProviderBrokerLedgerError("Provider manifest binding is stale.", true);
    }
    const submitted = await transitionProviderRequest({
      event: "submit",
      expectedVersion: consumed.aggregateVersion,
      providerRequestId: brokerRequest.providerRequestId,
    });
    let adapterResult;
    try {
      adapterResult = await submitProviderAdapter(manifest, {
        elevenLabsApiKey: environment.elevenLabsApiKey,
        falKey: environment.falKey,
        falWebhookBaseUrl: environment.falWebhookBaseUrl,
        referenceImageHosts: environment.referenceImageHosts,
      });
    } catch (error) {
      if (error instanceof ProviderAdapterError) {
        if (error.disposition !== "unknown") {
          await transitionProviderRequest({
            event:
              error.disposition === "retryable" ? "fail_retryable" : "fail_terminal",
            expectedVersion: submitted.aggregateVersion,
            providerRequestId: brokerRequest.providerRequestId,
          });
        }
      }
      throw error;
    }
    const accepted = await transitionProviderRequest({
      event: "accept",
      expectedVersion: submitted.aggregateVersion,
      externalJobId: adapterResult.externalJobId,
      providerRequestId: brokerRequest.providerRequestId,
      safeResponseHash: adapterResult.responseHash,
    });
    const quarantine =
      adapterResult.kind === "quarantine_bytes"
        ? await quarantineImmediateProviderBytes({
            alignment: adapterResult.alignment,
            audioSha256: adapterResult.audioSha256,
            bytes: adapterResult.bytes,
            contentType: adapterResult.contentType,
            providerRequestId: brokerRequest.providerRequestId,
            responseHash: adapterResult.responseHash,
            targetAssetId: adapterResult.targetAssetId,
            workspaceId: brokerRequest.workspaceId,
          })
        : null;
    return response(
      {
        aggregateVersion: accepted.aggregateVersion,
        ok: true,
        providerRequestId: brokerRequest.providerRequestId,
        quarantineAssetVersionId: quarantine?.quarantineAssetVersionId ?? null,
        state: accepted.state,
      },
      202,
    );
  } catch (error) {
    if (
      error instanceof BrokerAssertionError ||
      error instanceof ProviderBrokerContractError
    ) {
      await recordSecurityRejection(
        rejectionContext,
        error instanceof ProviderBrokerContractError
          ? "contract_invalid"
          : "assertion_invalid",
      );
      return response({ code: "BROKER_AUTHORITY_REJECTED", ok: false }, 401);
    }
    if (error instanceof BoundedRequestBodyError) {
      return response(
        {
          code:
            error.failure === "too-large"
              ? "BROKER_REQUEST_TOO_LARGE"
              : "BROKER_REQUEST_INVALID",
          ok: false,
        },
        error.failure === "too-large" ? 413 : 400,
      );
    }
    if (error instanceof ProviderBrokerLedgerError && error.conflict) {
      await recordSecurityRejection(rejectionContext, "replay_or_stale");
      return response({ code: "BROKER_REPLAY_OR_STALE_AUTHORITY", ok: false }, 409);
    }
    if (error instanceof ProviderAdapterError) {
      return response(
        {
          code:
            error.disposition === "retryable"
              ? "PROVIDER_RETRYABLE_REJECTION"
              : error.disposition === "terminal"
                ? "PROVIDER_TERMINAL_REJECTION"
                : "PROVIDER_OUTCOME_UNKNOWN",
          ok: false,
        },
        502,
      );
    }
    console.error("Provider broker failed safely", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return response({ code: "PROVIDER_OUTCOME_UNKNOWN", ok: false }, 502);
  }
}

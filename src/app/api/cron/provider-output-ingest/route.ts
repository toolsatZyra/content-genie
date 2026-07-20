import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import {
  getSecureIngestCronEnvironment,
  hasValidCronAuthorization,
  SecureIngestCronEnvironmentError,
} from "@/config/secure-ingest-cron-env";
import { sniffMediaMagic } from "@/security/media-ingest";
import {
  fetchRemoteToQuarantineBuffer,
  RemoteFetchPolicyError,
} from "@/security/remote-fetch";
import {
  claimNextProviderOutputCandidate,
  completeProviderOutputCandidate,
  failProviderOutputCandidate,
  getActiveRemoteFetchPolicy,
  ProviderBrokerLedgerError,
  quarantineProviderOutputBytes,
  recordProviderRemoteFetch,
  promoteProviderWorldAnchor,
  type ProviderOutputIngestClaim,
} from "@/server/provider-broker-ledger";
import {
  SandboxMediaScannerError,
  scanAndReencodeWorldImage,
} from "@/server/sandbox-media-scanner";
import { processNextNarrationIngest } from "@/server/narration-ingest";
import { ensurePlanEvaluationRun } from "@/server/preflight-auto-reconciler";
import {
  FalResultRecoveryError,
  recoverNextCompletedFalResult,
} from "@/server/fal-result-recovery";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const runtime = "nodejs";

const MAX_CANDIDATES_PER_INVOCATION = 1;
const LEASE_SECONDS = 300;
const imageContentTypes = ["image/jpeg", "image/png", "image/webp"] as const;

function response(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
    status,
  });
}

function failureDisposition(error: unknown): {
  retryable: boolean;
  safeClass: string;
} {
  if (error instanceof RemoteFetchPolicyError) {
    return { retryable: error.retryable, safeClass: error.safeClass };
  }
  if (error instanceof ProviderBrokerLedgerError) {
    return {
      retryable: !error.conflict,
      safeClass: error.conflict ? "provider_ingest_conflict" : "provider_ledger_failed",
    };
  }
  if (error instanceof SandboxMediaScannerError) {
    return {
      retryable: error.safeClass.startsWith("scanner."),
      safeClass: error.safeClass,
    };
  }
  return { retryable: true, safeClass: "provider_ingest_unknown" };
}

async function ingestClaim(
  claim: ProviderOutputIngestClaim,
  environment: "development" | "preview" | "production" | "test",
) {
  const remotePolicy = await getActiveRemoteFetchPolicy({
    environment,
    fetchClass: "provider_output",
  });
  const fetched = await fetchRemoteToQuarantineBuffer(claim.remoteUrl, {
    allowedContentTypes: imageContentTypes,
    allowedHosts: remotePolicy.allowedHosts,
    fetchClass: "provider_output",
    maximumBytes: 25 * 1024 * 1024,
    maximumRedirects: 2,
    timeoutMs: 60_000,
  });
  const magicMime = sniffMediaMagic(fetched.bytes);
  if (fetched.contentType !== claim.declaredMime || magicMime !== claim.declaredMime) {
    throw new RemoteFetchPolicyError(
      "Provider output media type did not match signed metadata.",
      "provider_output_media_mismatch",
      false,
    );
  }
  const remoteFetchRequestId = await recordProviderRemoteFetch({
    claim,
    environment,
    policy: remotePolicy,
    result: fetched,
  });
  const quarantine = await quarantineProviderOutputBytes({
    bytes: fetched.bytes,
    claim,
    contentType: claim.declaredMime,
    remoteFetchRequestId,
    sha256: fetched.sha256,
  });
  await completeProviderOutputCandidate({
    candidateId: claim.candidateId,
    leaseToken: claim.leaseToken,
    quarantineAssetVersionId: quarantine.quarantineAssetVersionId,
  });
  const scanned = await scanAndReencodeWorldImage({
    bytes: fetched.bytes,
    declaredMime: claim.declaredMime,
  });
  await promoteProviderWorldAnchor({
    claim,
    quarantineAssetVersionId: quarantine.quarantineAssetVersionId,
    scanned,
  });
}

export async function GET(request: Request) {
  try {
    const cron = getSecureIngestCronEnvironment();
    if (!hasValidCronAuthorization(request.headers, cron.cronSecret)) {
      return response({ code: "CRON_AUTHORIZATION_REJECTED", ok: false }, 401);
    }

    let completed = 0;
    let failed = 0;
    let claimed = 0;
    for (let index = 0; index < MAX_CANDIDATES_PER_INVOCATION; index += 1) {
      const claim = await claimNextProviderOutputCandidate({
        environment: cron.environment,
        leaseSeconds: LEASE_SECONDS,
        leaseToken: randomUUID(),
      });
      if (!claim) break;
      claimed += 1;
      try {
        await ingestClaim(claim, cron.environment);
        completed += 1;
      } catch (error) {
        const disposition = failureDisposition(error);
        console.error("Provider output candidate ingest failed safely", {
          errorMessage:
            error instanceof ProviderBrokerLedgerError ||
            error instanceof RemoteFetchPolicyError ||
            error instanceof SandboxMediaScannerError
              ? error.message
              : "Unexpected secure-ingest failure.",
          errorName: error instanceof Error ? error.name : "UnknownError",
          safeClass: disposition.safeClass,
        });
        await failProviderOutputCandidate({
          candidateId: claim.candidateId,
          leaseToken: claim.leaseToken,
          providerRequestId: claim.providerRequestId,
          retryable: disposition.retryable,
          safeErrorClass: disposition.safeClass,
        });
        failed += 1;
      }
    }

    let falRecovery = {
      checked: false,
      providerRequestId: null as string | null,
      recovered: false,
    };
    if (claimed === 0) {
      try {
        falRecovery = await recoverNextCompletedFalResult({
          environment: cron.environment,
        });
      } catch (error) {
        console.error("FAL authenticated result recovery failed safely", {
          errorMessage:
            error instanceof FalResultRecoveryError
              ? error.message
              : "Unexpected FAL recovery failure.",
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
      }
    }
    const narration =
      claimed === 0 && !falRecovery.recovered
        ? await processNextNarrationIngest()
        : null;
    let planQueued = false;
    let planRunId: string | null = null;
    if (narration?.completed) {
      const plan = await ensurePlanEvaluationRun({
        narrationPreflightRunId: narration.narrationPreflightRunId,
        workspaceId: narration.workspaceId,
      });
      planRunId = plan.preflightRunId;
      if (plan.shouldTrigger) {
        planQueued = true;
      }
    }

    return response(
      {
        claimed,
        completed,
        failed,
        falRecoveryChecked: falRecovery.checked,
        falRecoveryProviderRequestId: falRecovery.providerRequestId,
        falRecovered: falRecovery.recovered,
        narrationCompleted: narration?.completed ?? null,
        narrationJobId: narration?.jobId ?? null,
        ok: true,
        planQueued,
        planRunId,
      },
      200,
    );
  } catch (error) {
    console.error("Provider output secure ingest failed safely", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return response(
      {
        code:
          error instanceof SecureIngestCronEnvironmentError
            ? "CRON_CONFIGURATION_UNAVAILABLE"
            : "SECURE_INGEST_UNAVAILABLE",
        ok: false,
      },
      503,
    );
  }
}

import "server-only";

import { randomUUID } from "node:crypto";

import type { ProviderBrokerRequest } from "@/domain/provider/broker-contract";
import { getServerEnvironment } from "@/config/server-env";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  executePreflightControl,
  classifyPreflightControlFailure,
} from "@/server/preflight-control-executor";
import {
  dispatchPreflightControl,
  failPreflightControl,
  finalizePreflightControl,
  markWorldAnchorWaitingExternal,
} from "@/server/preflight-control-ledger";
import {
  ProviderAdapterError,
  submitProviderAdapter,
} from "@/server/provider-adapters";
import {
  getProviderDispatchManifest,
  quarantineImmediateProviderBytes,
  transitionProviderRequest,
} from "@/server/provider-broker-ledger";
import { failWorldBuildProgress } from "@/server/world-build-progress";

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export class MvpPreflightError extends Error {
  override readonly name = "MvpPreflightError";
}

function capabilityJti(token: string): string {
  try {
    const encoded = token.split(".")[1];
    if (!encoded) throw new TypeError("missing payload");
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as {
      jti?: unknown;
    };
    if (typeof payload.jti !== "string" || !uuid.test(payload.jti)) {
      throw new TypeError("invalid jti");
    }
    return payload.jti;
  } catch {
    throw new MvpPreflightError("A provider capability is malformed.");
  }
}

async function submitProviderDirectly(
  input: Readonly<{
    capabilityToken: string;
    request: ProviderBrokerRequest;
  }>,
): Promise<void> {
  const client = createAdminSupabaseClient();
  const { data: consumed, error: consumeError } = await client.rpc(
    "command_consume_mvp_provider_authority",
    {
      p_capability_grant_id: input.request.capabilityGrantId,
      p_capability_jti: capabilityJti(input.capabilityToken),
      p_provider_request_id: input.request.providerRequestId,
    },
  );
  if (
    consumeError ||
    !consumed ||
    typeof consumed !== "object" ||
    !Number.isSafeInteger((consumed as Record<string, unknown>).aggregateVersion)
  ) {
    throw new MvpPreflightError("Provider authority could not be activated.");
  }
  const manifest = await getProviderDispatchManifest(input.request.providerRequestId);
  const submitted = await transitionProviderRequest({
    event: "submit",
    expectedVersion: Number((consumed as Record<string, unknown>).aggregateVersion),
    providerRequestId: input.request.providerRequestId,
  });
  let adapter;
  try {
    const environment = getServerEnvironment();
    if (!environment.public.appUrl || !environment.public.supabaseUrl) {
      throw new MvpPreflightError("Provider runtime configuration is unavailable.");
    }
    adapter = await submitProviderAdapter(manifest, {
      elevenLabsApiKey: process.env.ELEVENLABS_API_KEY?.trim() ?? "",
      falKey: process.env.FAL_KEY?.trim() ?? "",
      falWebhookBaseUrl: `${environment.public.appUrl}/api/internal/provider-webhooks/fal`,
      referenceImageHosts: [new URL(environment.public.supabaseUrl).hostname],
    });
  } catch (error) {
    if (error instanceof ProviderAdapterError && error.disposition !== "unknown") {
      await transitionProviderRequest({
        event: error.disposition === "retryable" ? "fail_retryable" : "fail_terminal",
        expectedVersion: submitted.aggregateVersion,
        providerRequestId: input.request.providerRequestId,
      });
    }
    throw error;
  }
  const accepted = await transitionProviderRequest({
    event: "accept",
    expectedVersion: submitted.aggregateVersion,
    externalJobId: adapter.externalJobId,
    providerRequestId: input.request.providerRequestId,
    safeResponseHash: adapter.responseHash,
  });
  void accepted;
  if (adapter.kind === "quarantine_bytes") {
    await quarantineImmediateProviderBytes({
      alignment: adapter.alignment,
      audioSha256: adapter.audioSha256,
      bytes: adapter.bytes,
      contentType: adapter.contentType,
      providerRequestId: input.request.providerRequestId,
      responseHash: adapter.responseHash,
      targetAssetId: adapter.targetAssetId,
      workspaceId: input.request.workspaceId,
    });
  }
}

export async function advanceNextMvpPreflight(): Promise<
  Readonly<{
    advanced: boolean;
    pendingExternal?: boolean;
    preflightRunId?: string;
  }>
> {
  const environment = getServerEnvironment();
  if (!environment.enableProviderSpend || !environment.enableMvpInlinePreflight) {
    throw new MvpPreflightError("Provider generation is disabled.");
  }
  const client = createAdminSupabaseClient();
  const { data: run, error } = await client
    .from("preflight_runs")
    .select("id")
    .eq("state", "queued")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (error) throw new MvpPreflightError("Queued preflight work is unavailable.");
  if (!run) return Object.freeze({ advanced: false });

  const triggerRunId = randomUUID();
  const taskId = "genie-mvp-preflight-v1";
  const dispatched = await dispatchPreflightControl({
    preflightRunId: run.id,
    triggerRunId,
  });
  try {
    const executed = await executePreflightControl({
      envelope: dispatched.envelope,
      taskId,
      triggerRunId,
    });
    if (executed.pendingExternal) {
      for (const provider of executed.providerDispatches) {
        await submitProviderDirectly(provider);
      }
      await markWorldAnchorWaitingExternal({
        envelope: dispatched.envelope,
        taskId,
        triggerRunId,
      });
    } else {
      await finalizePreflightControl({ preflightRunId: run.id, triggerRunId });
    }
    return Object.freeze({
      advanced: true,
      pendingExternal: executed.pendingExternal,
      preflightRunId: run.id,
    });
  } catch (caught) {
    const classified = classifyPreflightControlFailure(caught);
    await failPreflightControl({
      envelope: dispatched.envelope,
      retryable: classified?.retryable ?? true,
      safeErrorClass: classified?.safeErrorClass ?? "mvp-preflight-failed",
      taskId,
      triggerRunId,
    }).catch(() => undefined);
    await failWorldBuildProgress({
      detail: classified?.retryable
        ? "The worker paused safely and will retry"
        : "World generation stopped safely and needs attention",
      preflightRunId: run.id,
    }).catch(() => undefined);
    throw caught;
  }
}

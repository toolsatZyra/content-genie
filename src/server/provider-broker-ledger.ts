import "server-only";

import { createHash, randomUUID } from "node:crypto";

import type { ProviderBrokerRequest } from "@/domain/provider/broker-contract";
import type { ParsedFalWebhook } from "@/domain/provider/fal-webhook";
import type { RemoteFetchClass, RemoteFetchResult } from "@/security/remote-fetch";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  parseProviderDispatchManifest,
  type ProviderDispatchManifest,
} from "@/server/provider-adapters";
import type { SandboxImageScanResult } from "@/server/sandbox-media-scanner";
import type { SpeechAlignment } from "@/server/provider-adapters";

export type DatabaseBrokerVerificationContext = Readonly<{
  audience: string;
  brokerClientDatabaseId: string;
  brokerKeyDatabaseId: string;
  clientId: string;
  environment: "development" | "preview" | "production" | "test";
  kid: string;
  publicKeySpkiBase64: string;
  triggerProject: string;
}>;

export class ProviderBrokerLedgerError extends Error {
  override readonly name = "ProviderBrokerLedgerError";

  constructor(
    message: string,
    readonly conflict = false,
  ) {
    super(message);
  }
}

function exactObject(value: unknown, keys: readonly string[]): value is object {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",")
  );
}

async function markWorldProgressByProviderRequest(
  providerRequestId: string,
  state: "failed" | "review_ready" | "secure_ingest",
  safeDetail: string,
): Promise<void> {
  const { error } = await createAdminSupabaseClient()
    .from("world_build_progress_items")
    .update({ safe_detail: safeDetail, state, updated_at: new Date().toISOString() })
    .eq("provider_request_id", providerRequestId);
  if (error) {
    throw new ProviderBrokerLedgerError("World progress could not be reconciled.");
  }
}

async function rpc(name: string, parameters: Record<string, unknown>) {
  const { data, error } = await createAdminSupabaseClient().rpc(name, parameters);
  if (error) {
    throw new ProviderBrokerLedgerError(
      "Provider broker ledger rejected the operation.",
      ["23505", "40001", "54000"].includes(error.code ?? ""),
    );
  }
  return data;
}

export async function getDatabaseBrokerVerificationContext(input: {
  clientId: string;
  environment: string;
  kid: string;
  triggerProject: string;
}): Promise<DatabaseBrokerVerificationContext> {
  const value = await rpc("get_broker_verification_context", {
    p_client_id: input.clientId,
    p_environment: input.environment,
    p_kid: input.kid,
    p_trigger_project: input.triggerProject,
  });
  const keys = [
    "audience",
    "brokerClientDatabaseId",
    "brokerKeyDatabaseId",
    "clientId",
    "environment",
    "kid",
    "publicKeySpkiBase64",
    "triggerProject",
  ] as const;
  if (!exactObject(value, keys)) {
    throw new ProviderBrokerLedgerError("Broker verification context is malformed.");
  }
  return value as DatabaseBrokerVerificationContext;
}

export async function recordProviderBrokerSecurityRejection(input: {
  clientId: string;
  environment: string;
  kid: string;
  reasonCode: "assertion_invalid" | "contract_invalid" | "replay_or_stale";
  triggerProject: string;
}): Promise<string> {
  const value = await rpc("command_record_broker_security_rejection", {
    p_client_id: input.clientId,
    p_environment: input.environment,
    p_kid: input.kid,
    p_reason_code: input.reasonCode,
    p_trigger_project: input.triggerProject,
  });
  if (typeof value !== "string") {
    throw new ProviderBrokerLedgerError("Broker rejection evidence is malformed.");
  }
  return value;
}

export async function consumeProviderBrokerAuthority(input: {
  assertionExpiresAtSeconds: number;
  assertionIssuedAtSeconds: number;
  assertionJti: string;
  assertionSubject: string;
  capabilityJti: string;
  clientId: string;
  environment: string;
  kid: string;
  request: ProviderBrokerRequest;
  triggerProject: string;
}): Promise<{ aggregateVersion: number; providerRequestId: string; state: "queued" }> {
  const value = await rpc("command_consume_provider_broker_authority", {
    p_assertion_expires_at: new Date(
      input.assertionExpiresAtSeconds * 1_000,
    ).toISOString(),
    p_assertion_issued_at: new Date(
      input.assertionIssuedAtSeconds * 1_000,
    ).toISOString(),
    p_assertion_jti: input.assertionJti,
    p_assertion_subject: input.assertionSubject,
    p_capability_grant_id: input.request.capabilityGrantId,
    p_capability_jti: input.capabilityJti,
    p_client_id: input.clientId,
    p_environment: input.environment,
    p_kid: input.kid,
    p_provider_request_id: input.request.providerRequestId,
    p_trigger_project: input.triggerProject,
  });
  if (
    !exactObject(value, ["aggregateVersion", "ok", "providerRequestId", "state"]) ||
    (value as Record<string, unknown>).ok !== true ||
    (value as Record<string, unknown>).state !== "queued" ||
    !Number.isSafeInteger((value as Record<string, unknown>).aggregateVersion)
  ) {
    throw new ProviderBrokerLedgerError("Broker consume result is malformed.");
  }
  return value as {
    aggregateVersion: number;
    providerRequestId: string;
    state: "queued";
  };
}

export async function getProviderDispatchManifest(
  providerRequestId: string,
): Promise<ProviderDispatchManifest> {
  return parseProviderDispatchManifest(
    await rpc("get_provider_dispatch_manifest", {
      p_provider_request_id: providerRequestId,
    }),
  );
}

export async function getFalWebhookBinding(providerRequestId: string): Promise<{
  providerRequestId: string;
  targetAssetId: string;
  workspaceId: string;
}> {
  const value = await rpc("get_fal_webhook_binding", {
    p_provider_request_id: providerRequestId,
  });
  if (
    !exactObject(value, ["providerRequestId", "targetAssetId", "workspaceId"]) ||
    !["providerRequestId", "targetAssetId", "workspaceId"].every(
      (key) => typeof (value as Record<string, unknown>)[key] === "string",
    )
  ) {
    throw new ProviderBrokerLedgerError("FAL webhook binding is malformed.");
  }
  return value as {
    providerRequestId: string;
    targetAssetId: string;
    workspaceId: string;
  };
}

export type FalWebhookRecordResult = Readonly<{
  aggregateVersion: number;
  candidateIds: readonly string[];
  disposition: "accepted" | "failed_retryable" | "job_mismatch" | "recorded" | "stale";
  duplicate: boolean;
  ok: boolean;
  providerRequestId: string;
  state: string;
}>;

export async function recordFalSignedWebhook(input: {
  providerEventId: string;
  providerRequestId: string;
  webhook: ParsedFalWebhook;
}): Promise<FalWebhookRecordResult> {
  const value = await rpc("command_record_fal_signed_webhook", {
    p_canonical_payload_hash: input.webhook.canonicalPayloadHash,
    p_external_job_id: input.webhook.externalJobId,
    p_gateway_request_id: input.webhook.gatewayRequestId,
    p_outputs: input.webhook.outputs,
    p_provider_event_id: input.providerEventId,
    p_provider_request_id: input.providerRequestId,
    p_raw_body_sha256: input.webhook.rawBodySha256,
    p_safe_summary: input.webhook.safeSummary,
    p_status: input.webhook.status,
  });
  const keys = [
    "aggregateVersion",
    "candidateIds",
    "disposition",
    "duplicate",
    "ok",
    "providerRequestId",
    "state",
  ] as const;
  const record = value as Record<string, unknown>;
  if (
    !exactObject(value, keys) ||
    typeof record.ok !== "boolean" ||
    typeof record.duplicate !== "boolean" ||
    !Number.isSafeInteger(record.aggregateVersion) ||
    typeof record.providerRequestId !== "string" ||
    typeof record.state !== "string" ||
    !["accepted", "failed_retryable", "job_mismatch", "recorded", "stale"].includes(
      String(record.disposition),
    ) ||
    !Array.isArray(record.candidateIds) ||
    record.candidateIds.some((id) => typeof id !== "string")
  ) {
    throw new ProviderBrokerLedgerError("FAL webhook result is malformed.");
  }
  return value as FalWebhookRecordResult;
}

export async function transitionProviderRequest(input: {
  event:
    | "submit"
    | "accept"
    | "poll"
    | "fail_retryable"
    | "fail_terminal"
    | "request_cancel"
    | "confirm_canceled";
  expectedVersion: number;
  externalJobId?: string;
  providerRequestId: string;
  safeResponseHash?: string;
}): Promise<{ aggregateVersion: number; providerRequestId: string; state: string }> {
  const value = await rpc("command_transition_provider_request", {
    p_billable_state: null,
    p_event: input.event,
    p_expected_version: input.expectedVersion,
    p_external_job_id: input.externalJobId ?? null,
    p_provider_request_id: input.providerRequestId,
    p_safe_response_hash: input.safeResponseHash ?? null,
  });
  if (
    !exactObject(value, ["aggregateVersion", "ok", "providerRequestId", "state"]) ||
    (value as Record<string, unknown>).ok !== true ||
    !Number.isSafeInteger((value as Record<string, unknown>).aggregateVersion) ||
    typeof (value as Record<string, unknown>).state !== "string"
  ) {
    throw new ProviderBrokerLedgerError("Provider transition result is malformed.");
  }
  return value as {
    aggregateVersion: number;
    providerRequestId: string;
    state: string;
  };
}

export type ActiveRemoteFetchPolicy = Readonly<{
  allowedHosts: readonly string[];
  allowlistVersionId: string;
  environment: "development" | "preview" | "production" | "test";
  fetchClass: RemoteFetchClass;
  manifestHash: string;
}>;

export async function getActiveRemoteFetchPolicy(input: {
  environment: string;
  fetchClass: RemoteFetchClass;
}): Promise<ActiveRemoteFetchPolicy> {
  const value = await rpc("get_active_remote_fetch_policy", {
    p_environment: input.environment,
    p_fetch_class: input.fetchClass,
  });
  const keys = [
    "allowedHosts",
    "allowlistVersionId",
    "environment",
    "fetchClass",
    "manifestHash",
  ] as const;
  const record = value as Record<string, unknown>;
  if (
    !exactObject(value, keys) ||
    !Array.isArray(record.allowedHosts) ||
    record.allowedHosts.length < 1 ||
    record.allowedHosts.some((host) => typeof host !== "string") ||
    !["development", "preview", "production", "test"].includes(
      String(record.environment),
    ) ||
    record.fetchClass !== input.fetchClass ||
    typeof record.allowlistVersionId !== "string" ||
    typeof record.manifestHash !== "string"
  ) {
    throw new ProviderBrokerLedgerError("Remote fetch policy is malformed.");
  }
  return value as ActiveRemoteFetchPolicy;
}

export type ProviderOutputIngestClaim = Readonly<{
  authorityEpoch: number;
  candidateId: string;
  declaredMime: "image/jpeg" | "image/png" | "image/webp";
  empty: false;
  expectedHeight: number | null;
  expectedWidth: number | null;
  fencingToken: number;
  leaseExpiresAt: string;
  leaseToken: string;
  ok: true;
  preflightRunId: string;
  providerRequestId: string;
  remoteUrl: string;
  remoteUrlSha256: string;
  stageAttemptId: string;
  targetAssetId: string;
  workspaceId: string;
}>;

export async function claimNextProviderOutputCandidate(input: {
  environment: string;
  leaseSeconds: number;
  leaseToken: string;
}): Promise<ProviderOutputIngestClaim | null> {
  const value = await rpc("command_claim_next_provider_output_candidate", {
    p_environment: input.environment,
    p_lease_seconds: input.leaseSeconds,
    p_lease_token: input.leaseToken,
  });
  if (exactObject(value, ["empty", "ok"])) {
    const record = value as Record<string, unknown>;
    if (record.empty === true && record.ok === true) return null;
  }
  const keys = [
    "authorityEpoch",
    "candidateId",
    "declaredMime",
    "empty",
    "expectedHeight",
    "expectedWidth",
    "fencingToken",
    "leaseExpiresAt",
    "leaseToken",
    "ok",
    "preflightRunId",
    "providerRequestId",
    "remoteUrl",
    "remoteUrlSha256",
    "stageAttemptId",
    "targetAssetId",
    "workspaceId",
  ] as const;
  const record = value as Record<string, unknown>;
  if (
    !exactObject(value, keys) ||
    record.ok !== true ||
    record.empty !== false ||
    !["image/jpeg", "image/png", "image/webp"].includes(String(record.declaredMime)) ||
    !["authorityEpoch", "fencingToken"].every(
      (key) => Number.isSafeInteger(record[key]) && (record[key] as number) > 0,
    ) ||
    !["expectedHeight", "expectedWidth"].every(
      (key) =>
        record[key] === null ||
        (Number.isSafeInteger(record[key]) && (record[key] as number) > 0),
    ) ||
    [
      "candidateId",
      "leaseExpiresAt",
      "leaseToken",
      "preflightRunId",
      "providerRequestId",
      "remoteUrl",
      "remoteUrlSha256",
      "stageAttemptId",
      "targetAssetId",
      "workspaceId",
    ].some((key) => typeof record[key] !== "string")
  ) {
    throw new ProviderBrokerLedgerError("Provider output claim is malformed.");
  }
  return value as ProviderOutputIngestClaim;
}

export async function recordProviderRemoteFetch(input: {
  claim: ProviderOutputIngestClaim;
  environment: string;
  policy: ActiveRemoteFetchPolicy;
  result: RemoteFetchResult;
}): Promise<string> {
  const canonicalUrlHash = createHash("sha256")
    .update(input.result.canonicalUrl)
    .digest("hex");
  const value = await rpc("command_record_provider_output_remote_fetch", {
    p_allowlist_version_hash: input.policy.manifestHash,
    p_allowlist_version_id: input.policy.allowlistVersionId,
    p_candidate_id: input.claim.candidateId,
    p_canonical_url_hash: canonicalUrlHash,
    p_environment: input.environment,
    p_exact_hostname: new URL(input.result.canonicalUrl).hostname.toLowerCase(),
    p_lease_token: input.claim.leaseToken,
    p_maximum_bytes: 25 * 1024 * 1024,
    p_requested_url_hash: input.claim.remoteUrlSha256,
    p_redirect_count: input.result.redirectCount,
    p_resolved_address_hashes: input.result.resolvedAddressHashes,
    p_response_sha256: input.result.sha256,
    p_timeout_ms: 60_000,
  });
  if (typeof value !== "string") {
    throw new ProviderBrokerLedgerError("Remote fetch evidence is malformed.");
  }
  return value;
}

export async function quarantineProviderOutputBytes(input: {
  bytes: Buffer;
  claim: ProviderOutputIngestClaim;
  contentType: "image/jpeg" | "image/png" | "image/webp";
  remoteFetchRequestId: string;
  sha256: string;
}): Promise<{ quarantineAssetVersionId: string; state: string }> {
  await markWorldProgressByProviderRequest(
    input.claim.providerRequestId,
    "secure_ingest",
    "Image returned; malware scan, metadata removal and safe re-encoding are running",
  );
  const client = createAdminSupabaseClient();
  const quarantineAssetVersionId = randomUUID();
  const objectName = `${input.claim.workspaceId}/quarantine/${input.claim.targetAssetId}/${quarantineAssetVersionId}/source`;
  const upload = await client.storage
    .from("quarantine")
    .upload(objectName, input.bytes, {
      cacheControl: "0",
      contentType: input.contentType,
      upsert: false,
    });
  if (upload.error) {
    throw new ProviderBrokerLedgerError("Provider output could not enter quarantine.");
  }
  const provenanceHash = createHash("sha256")
    .update(
      JSON.stringify({
        candidateId: input.claim.candidateId,
        providerRequestId: input.claim.providerRequestId,
        remoteFetchRequestId: input.remoteFetchRequestId,
        targetAssetId: input.claim.targetAssetId,
        workspaceId: input.claim.workspaceId,
      }),
    )
    .digest("hex");
  const { data, error } = await client.rpc("command_register_quarantine_asset", {
    p_byte_length: input.bytes.length,
    p_declared_mime: input.contentType,
    p_display_filename: `provider-output.${input.contentType.split("/")[1]}`,
    p_object_name: objectName,
    p_provenance_hash: provenanceHash,
    p_provider_request_id: input.claim.providerRequestId,
    p_quarantine_version_id: quarantineAssetVersionId,
    p_remote_fetch_request_id: input.remoteFetchRequestId,
    p_source_kind: "provider_output",
    p_source_sha256: input.sha256,
    p_stable_asset_id: input.claim.targetAssetId,
    p_workspace_id: input.claim.workspaceId,
  });
  if (error) {
    await client.storage
      .from("quarantine")
      .remove([objectName])
      .catch(() => undefined);
    throw new ProviderBrokerLedgerError("Provider quarantine ledger rejected output.");
  }
  if (
    !exactObject(data, ["ok", "quarantineAssetVersionId", "state"]) ||
    (data as Record<string, unknown>).ok !== true ||
    (data as Record<string, unknown>).state !== "quarantined"
  ) {
    throw new ProviderBrokerLedgerError("Provider quarantine result is malformed.");
  }
  return data as { quarantineAssetVersionId: string; state: string };
}

export async function completeProviderOutputCandidate(input: {
  candidateId: string;
  leaseToken: string;
  quarantineAssetVersionId: string;
}): Promise<void> {
  const value = await rpc("command_complete_provider_output_candidate", {
    p_candidate_id: input.candidateId,
    p_lease_token: input.leaseToken,
    p_quarantine_asset_version_id: input.quarantineAssetVersionId,
  });
  if (
    !exactObject(value, ["candidateId", "ok", "quarantineAssetVersionId", "state"]) ||
    (value as Record<string, unknown>).ok !== true ||
    (value as Record<string, unknown>).state !== "quarantined"
  ) {
    throw new ProviderBrokerLedgerError("Provider output completion is malformed.");
  }
}

export async function promoteProviderWorldAnchor(input: {
  claim: ProviderOutputIngestClaim;
  quarantineAssetVersionId: string;
  scanned: SandboxImageScanResult;
}): Promise<Readonly<{ assetVersionId: string; worldVersionId: string }>> {
  const client = createAdminSupabaseClient();
  const contextValue = await rpc("get_world_anchor_ingest_context", {
    p_provider_request_id: input.claim.providerRequestId,
  });
  if (
    !exactObject(contextValue, [
      "assetKind",
      "entityKind",
      "jobId",
      "providerRequestId",
      "targetAssetId",
      "workspaceId",
    ]) ||
    !["character_anchor", "location_anchor"].includes(
      String((contextValue as Record<string, unknown>).assetKind),
    ) ||
    (contextValue as Record<string, unknown>).targetAssetId !==
      input.claim.targetAssetId ||
    (contextValue as Record<string, unknown>).workspaceId !== input.claim.workspaceId
  ) {
    throw new ProviderBrokerLedgerError("World anchor ingest binding is malformed.");
  }
  const context = contextValue as {
    assetKind: "character_anchor" | "location_anchor";
  };
  const policyValue = await rpc("get_active_media_ingest_policy", {});
  if (
    !exactObject(policyValue, ["id", "policy", "policyHash"]) ||
    typeof (policyValue as Record<string, unknown>).id !== "string"
  ) {
    throw new ProviderBrokerLedgerError("Media ingest policy is malformed.");
  }
  const attestationValue = await rpc("command_record_ingest_attestation", {
    p_decompressed_bytes: input.scanned.decompressedBytes,
    p_duration_ms: null,
    // The ingest-attestation schema reserves frame counts for video; a still
    // image is represented by dimensions with a null duration/frame count.
    p_frame_count: null,
    p_height: input.scanned.height,
    p_magic_mime: input.scanned.magicMime,
    p_malware_status: "clean",
    p_metadata_stripped: true,
    p_output_byte_length: input.scanned.outputBytes.length,
    p_output_sha256: input.scanned.outputSha256,
    p_parser_sandboxed: true,
    p_policy_version_id: (policyValue as Record<string, string>).id,
    p_probe_sha256: input.scanned.probeSha256,
    p_quarantine_asset_version_id: input.quarantineAssetVersionId,
    p_reencoded_mime: input.scanned.magicMime,
    p_scan_engine: input.scanned.scanEngine,
    p_scan_version: input.scanned.scanVersion,
    p_scanner_task_id: `provider-output:${input.claim.candidateId}`,
    p_scanner_task_version: input.scanned.scannerTaskVersion,
    p_width: input.scanned.width,
    p_workspace_id: input.claim.workspaceId,
  });
  if (typeof attestationValue !== "string") {
    throw new ProviderBrokerLedgerError("Media ingest attestation is malformed.");
  }
  const assetVersionId = randomUUID();
  const worldVersionId = randomUUID();
  const finalObjectName = `${input.claim.workspaceId}/${context.assetKind}/${input.claim.targetAssetId}/${assetVersionId}/source`;
  const workspaceMedia = client.storage.from("workspace-media");
  const upload = await workspaceMedia.upload(
    finalObjectName,
    input.scanned.outputBytes,
    {
      cacheControl: "0",
      contentType: input.scanned.magicMime,
      metadata: { sha256: input.scanned.outputSha256 },
      upsert: false,
    },
  );
  if (upload.error) {
    throw new ProviderBrokerLedgerError(
      "Sanitized provider media could not be stored.",
    );
  }
  const receipt = await workspaceMedia.info(finalObjectName);
  if (
    receipt.error ||
    receipt.data.id !== upload.data.id ||
    typeof receipt.data.version !== "string" ||
    receipt.data.version.length < 1
  ) {
    await workspaceMedia.remove([finalObjectName]).catch(() => undefined);
    throw new ProviderBrokerLedgerError(
      "Sanitized provider storage receipt is invalid.",
    );
  }
  const storageVersion = receipt.data.version;
  try {
    const promotion = await rpc("command_promote_world_anchor_quarantine", {
      p_asset_kind: context.assetKind,
      p_asset_version_id: assetVersionId,
      p_final_object_name: finalObjectName,
      p_ingest_attestation_id: attestationValue,
      p_provider_request_id: input.claim.providerRequestId,
      p_quarantine_asset_version_id: input.quarantineAssetVersionId,
      p_storage_version: storageVersion,
      p_world_version_id: worldVersionId,
      p_workspace_id: input.claim.workspaceId,
    });
    if (
      !promotion ||
      typeof promotion !== "object" ||
      (promotion as Record<string, unknown>).assetVersionId !== assetVersionId
    ) {
      throw new ProviderBrokerLedgerError("Provider asset promotion is malformed.");
    }
    await markWorldProgressByProviderRequest(
      input.claim.providerRequestId,
      "review_ready",
      "Secure image is ready for your review",
    );
    return Object.freeze({ assetVersionId, worldVersionId });
  } catch (error) {
    await workspaceMedia.remove([finalObjectName]).catch(() => undefined);
    throw error;
  }
}

export async function failProviderOutputCandidate(input: {
  candidateId: string;
  leaseToken: string;
  providerRequestId: string;
  retryable: boolean;
  safeErrorClass: string;
}): Promise<void> {
  const value = await rpc("command_fail_provider_output_candidate", {
    p_candidate_id: input.candidateId,
    p_lease_token: input.leaseToken,
    p_retryable: input.retryable,
    p_safe_error_class: input.safeErrorClass,
  });
  if (
    !exactObject(value, ["candidateId", "ok", "retryable", "state"]) ||
    (value as Record<string, unknown>).ok !== true
  ) {
    throw new ProviderBrokerLedgerError("Provider output failure result is malformed.");
  }
  const state = (value as Record<string, unknown>).state;
  if (!input.retryable || state === "failed") {
    await markWorldProgressByProviderRequest(
      input.providerRequestId,
      "failed",
      "Secure ingest stopped safely. Retry this World image when you are ready.",
    );
  }
}

export async function quarantineImmediateProviderBytes(input: {
  alignment: SpeechAlignment;
  audioSha256: string;
  bytes: Buffer;
  contentType: "audio/mpeg";
  providerRequestId: string;
  responseHash: string;
  targetAssetId: string;
  workspaceId: string;
}): Promise<{ quarantineAssetVersionId: string; state: string }> {
  const client = createAdminSupabaseClient();
  const quarantineAssetVersionId = randomUUID();
  const objectName = `${input.workspaceId}/quarantine/${input.targetAssetId}/${quarantineAssetVersionId}/source`;
  const upload = await client.storage
    .from("quarantine")
    .upload(objectName, input.bytes, {
      cacheControl: "0",
      contentType: input.contentType,
      upsert: false,
    });
  if (upload.error) {
    throw new ProviderBrokerLedgerError("Provider output could not enter quarantine.");
  }
  const provenanceHash = createHash("sha256")
    .update(
      JSON.stringify({
        providerRequestId: input.providerRequestId,
        responseHash: input.responseHash,
        targetAssetId: input.targetAssetId,
        workspaceId: input.workspaceId,
      }),
    )
    .digest("hex");
  const { data, error } = await client.rpc("command_register_quarantine_asset", {
    p_byte_length: input.bytes.length,
    p_declared_mime: input.contentType,
    p_display_filename: "provider-output.mp3",
    p_object_name: objectName,
    p_provenance_hash: provenanceHash,
    p_provider_request_id: input.providerRequestId,
    p_quarantine_version_id: quarantineAssetVersionId,
    p_remote_fetch_request_id: null,
    p_source_kind: "provider_output",
    p_source_sha256: input.audioSha256,
    p_stable_asset_id: input.targetAssetId,
    p_workspace_id: input.workspaceId,
  });
  if (error) {
    await client.storage
      .from("quarantine")
      .remove([objectName])
      .catch(() => undefined);
    throw new ProviderBrokerLedgerError("Provider quarantine ledger rejected output.");
  }
  if (
    !exactObject(data, ["ok", "quarantineAssetVersionId", "state"]) ||
    (data as Record<string, unknown>).ok !== true
  ) {
    throw new ProviderBrokerLedgerError("Provider quarantine result is malformed.");
  }
  const recorded = await rpc("command_record_narration_provider_output", {
    p_alignment: input.alignment,
    p_provider_request_id: input.providerRequestId,
    p_provider_response_hash: input.responseHash,
    p_quarantine_asset_version_id: quarantineAssetVersionId,
    p_source_audio_sha256: input.audioSha256,
  });
  if (
    !exactObject(recorded, ["jobId", "ok", "replayed", "state"]) ||
    (recorded as Record<string, unknown>).ok !== true ||
    (recorded as Record<string, unknown>).state !== "quarantined"
  ) {
    throw new ProviderBrokerLedgerError("Narration quarantine binding is malformed.");
  }
  return data as { quarantineAssetVersionId: string; state: string };
}

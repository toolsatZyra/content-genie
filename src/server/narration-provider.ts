import "server-only";

import { createHash } from "node:crypto";

import { getProviderCapabilitySigningEnvironment } from "@/config/provider-capability-signing-env";
import { getServerEnvironment } from "@/config/server-env";
import {
  PROVIDER_BROKER_SCHEMA_VERSION,
  type ProviderBrokerRequest,
} from "@/domain/provider/broker-contract";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { issueProviderCapabilityToken } from "@/server/provider-capability-issuer";
import { createNarrationDelivery } from "@/server/narration-delivery";
import type { PreflightTaskEnvelope } from "../../trigger/preflight-contract";

const elevenLabsSchemaRawSha256 =
  "3676bce19be475e90fe409a3692549ffedeeda33ca734ad87f01fe8890d4a040";
const elevenLabsSchemaCanonicalSha256 =
  "8eff1ed4ff29251e1b2dabd994a0d1e3412f8838e0af1dba1ea9b147d1760f08";
const openAiQcEvidenceRawSha256 =
  "73ca51480f8ed21b17c2667493cf94105fd94a414e4bea84bc59d2167a4d8369";
const openAiQcEvidenceCanonicalSha256 =
  "8e59436de11b88e76e89f7699fb9800ec581b5529f2837ff5701a6b26f2bdb9d";

export class NarrationProviderError extends Error {
  override readonly name = "NarrationProviderError";
}

export type NarrationProviderDispatch = Readonly<{
  capabilityToken: string;
  request: ProviderBrokerRequest;
}>;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function deterministicUuid(seed: string): string {
  const bytes = Buffer.from(sha256(seed).slice(0, 32), "hex");
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function exactObject(value: unknown, keys: readonly string[]): value is object {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",")
  );
}

async function rpc(name: string, parameters: Record<string, unknown>) {
  const { data, error } = await createAdminSupabaseClient().rpc(name, parameters);
  if (error) {
    throw new NarrationProviderError("Narration provider ledger rejected work.");
  }
  return data;
}

const claimKeys = [
  "authorityEpoch",
  "capabilityGrantId",
  "capabilityJti",
  "fencingToken",
  "inputManifestHash",
  "inputManifestId",
  "jobId",
  "ok",
  "preflightRunId",
  "providerRequestId",
  "providerRequestState",
  "providerRequestVersion",
  "quoteLineId",
  "replayed",
  "stageAttemptId",
  "stageRunId",
  "targetAssetId",
  "workspaceId",
] as const;

async function claimNarrationProviderJob(jobId: string) {
  const value = await rpc("command_claim_narration_provider_job", {
    p_correlation_id: deterministicUuid(`job:${jobId}:correlation`),
    p_idempotency_key: `narration-job:${jobId}`,
    p_job_id: jobId,
  });
  if (!exactObject(value, claimKeys)) {
    throw new NarrationProviderError("Narration provider claim is malformed.");
  }
  const record = value as Record<string, unknown>;
  if (
    record.ok !== true ||
    record.jobId !== jobId ||
    typeof record.providerRequestId !== "string" ||
    typeof record.capabilityGrantId !== "string" ||
    !Number.isSafeInteger(record.providerRequestVersion)
  ) {
    throw new NarrationProviderError("Narration provider claim is invalid.");
  }
  return record;
}

async function ensureNarrationCapabilities(input: {
  voiceVersionId: string;
  workspaceId: string;
}): Promise<
  Readonly<{
    asrCapabilityId: string;
    audioJudgeCapabilityId: string;
    capabilityId: string;
    externalVoiceId: string;
  }>
> {
  const environment = getServerEnvironment();
  const elevenLabsRetrievedAt = new Date("2026-07-19T08:35:00.000Z");
  const openAiRetrievedAt = new Date("2026-07-19T10:30:00.000Z");
  const expiryMs = 90 * 24 * 60 * 60 * 1_000;
  const [speechValue, qcValue] = await Promise.all([
    rpc("command_ensure_elevenlabs_narration_bundle_capability", {
      p_environment: environment.environment,
      p_expires_at: new Date(elevenLabsRetrievedAt.getTime() + expiryMs).toISOString(),
      p_retrieved_at: elevenLabsRetrievedAt.toISOString(),
      p_schema_canonical_hash: elevenLabsSchemaCanonicalSha256,
      p_schema_raw_sha256: elevenLabsSchemaRawSha256,
      p_voice_version_id: input.voiceVersionId,
      p_workspace_id: input.workspaceId,
    }),
    rpc("command_ensure_openai_narration_qc_capabilities", {
      p_environment: environment.environment,
      p_evidence_canonical_hash: openAiQcEvidenceCanonicalSha256,
      p_evidence_raw_sha256: openAiQcEvidenceRawSha256,
      p_expires_at: new Date(openAiRetrievedAt.getTime() + expiryMs).toISOString(),
      p_retrieved_at: openAiRetrievedAt.toISOString(),
      p_workspace_id: input.workspaceId,
    }),
  ]);
  if (
    !speechValue ||
    typeof speechValue !== "object" ||
    typeof (speechValue as Record<string, unknown>).capabilityId !== "string" ||
    typeof (speechValue as Record<string, unknown>).externalVoiceId !== "string" ||
    (speechValue as Record<string, unknown>).unitPriceMinor !== 88 ||
    !qcValue ||
    typeof qcValue !== "object" ||
    typeof (qcValue as Record<string, unknown>).asrCapabilityId !== "string" ||
    typeof (qcValue as Record<string, unknown>).audioJudgeCapabilityId !== "string" ||
    (qcValue as Record<string, unknown>).totalMinor !== 28
  ) {
    throw new NarrationProviderError("Narration provider capabilities are malformed.");
  }
  const speech = speechValue as Record<string, unknown>;
  const qc = qcValue as Record<string, unknown>;
  return Object.freeze({
    asrCapabilityId: qc.asrCapabilityId as string,
    audioJudgeCapabilityId: qc.audioJudgeCapabilityId as string,
    capabilityId: speech.capabilityId as string,
    externalVoiceId: speech.externalVoiceId as string,
  });
}

function providerPayload(input: {
  deliveryMap: readonly (number | null)[];
  deliveryText: string;
  deliveryTextSha256: string;
  externalVoiceId: string;
  sourceText: string;
  sourceTextSha256: string;
  targetAssetId: string;
}) {
  return Object.freeze({
    deliveryMap: input.deliveryMap,
    deliveryTextSha256: input.deliveryTextSha256,
    modelId: "eleven_v3",
    outputFormat: "mp3_44100_128",
    sourceText: input.sourceText,
    sourceTextSha256: input.sourceTextSha256,
    targetAssetId: input.targetAssetId,
    text: input.deliveryText,
    voiceId: input.externalVoiceId,
    voiceSettings: pinnedElevenLabsV3VoiceSettings,
  });
}

const pinnedElevenLabsV3VoiceSettings = Object.freeze({
  similarityBoost: 0.82,
  stability: 0.5,
  style: 0,
  useSpeakerBoost: true,
});

const voiceSettingsKeys = [
  "similarityBoost",
  "stability",
  "style",
  "useSpeakerBoost",
] as const;

const providerPayloadKeys = [
  "deliveryMap",
  "deliveryTextSha256",
  "modelId",
  "outputFormat",
  "sourceText",
  "sourceTextSha256",
  "targetAssetId",
  "text",
  "voiceId",
  "voiceSettings",
] as const;

export function validateExistingNarrationProviderPayload(
  value: unknown,
  expected: Readonly<{
    externalVoiceId: string;
    sourceText: string;
    targetAssetId: string;
  }>,
): Readonly<Record<string, unknown>> {
  if (!exactObject(value, providerPayloadKeys)) {
    throw new NarrationProviderError("Existing narration delivery is malformed.");
  }
  const payload = value as Record<string, unknown>;
  const deliveryText = payload.text;
  const deliveryMap = payload.deliveryMap;
  const voiceSettings = payload.voiceSettings;
  if (
    payload.modelId !== "eleven_v3" ||
    payload.outputFormat !== "mp3_44100_128" ||
    payload.sourceText !== expected.sourceText ||
    payload.sourceTextSha256 !== sha256(expected.sourceText) ||
    payload.targetAssetId !== expected.targetAssetId ||
    payload.voiceId !== expected.externalVoiceId ||
    typeof deliveryText !== "string" ||
    payload.deliveryTextSha256 !== sha256(deliveryText) ||
    !Array.isArray(deliveryMap) ||
    !exactObject(voiceSettings, voiceSettingsKeys) ||
    (voiceSettings as Record<string, unknown>).similarityBoost !==
      pinnedElevenLabsV3VoiceSettings.similarityBoost ||
    (voiceSettings as Record<string, unknown>).stability !==
      pinnedElevenLabsV3VoiceSettings.stability ||
    (voiceSettings as Record<string, unknown>).style !==
      pinnedElevenLabsV3VoiceSettings.style ||
    (voiceSettings as Record<string, unknown>).useSpeakerBoost !==
      pinnedElevenLabsV3VoiceSettings.useSpeakerBoost
  ) {
    throw new NarrationProviderError("Existing narration delivery conflicts.");
  }
  const sourceScalars = Array.from(expected.sourceText);
  const deliveryScalars = Array.from(deliveryText);
  const mapped = deliveryMap.filter((item): item is number => typeof item === "number");
  if (
    deliveryScalars.length < 1 ||
    deliveryScalars.length > 5_000 ||
    deliveryMap.length !== deliveryScalars.length ||
    deliveryMap.some(
      (item) =>
        item !== null &&
        (!Number.isSafeInteger(item) || item < 0 || item >= sourceScalars.length),
    ) ||
    mapped.length !== sourceScalars.length ||
    mapped.some((item, index) => item !== index)
  ) {
    throw new NarrationProviderError(
      "Existing narration delivery changed the locked script.",
    );
  }
  return Object.freeze(payload);
}

export async function prepareNarrationProviderDispatches(
  input: Readonly<{
    audioIdentitySelectionId: string;
    configurationCandidateId: string;
    envelope: PreflightTaskEnvelope;
    episodeId: string;
    exactText: string;
    policyVersionId: string;
    scriptRevisionId: string;
    voiceVersionId: string;
  }>,
): Promise<readonly NarrationProviderDispatch[]> {
  const capability = await ensureNarrationCapabilities({
    voiceVersionId: input.voiceVersionId,
    workspaceId: input.envelope.workspaceId,
  });
  const jobId = deterministicUuid(
    `run:${input.envelope.preflightRunId}:narration:primary`,
  );
  const targetAssetId = deterministicUuid(`job:${jobId}:narration-asset`);
  const capabilityJti = deterministicUuid(`job:${jobId}:capability-jti`);
  const existingPayload = await rpc("get_existing_narration_delivery", {
    p_preflight_run_id: input.envelope.preflightRunId,
  });
  const payload =
    existingPayload === null
      ? providerPayload({
          ...(await createNarrationDelivery({
            configurationCandidateId: input.configurationCandidateId,
            envelope: input.envelope,
            episodeId: input.episodeId,
            policyVersionId: input.policyVersionId,
            scriptRevisionId: input.scriptRevisionId,
            sourceText: input.exactText,
          })),
          externalVoiceId: capability.externalVoiceId,
          sourceText: input.exactText,
          targetAssetId,
        })
      : validateExistingNarrationProviderPayload(existingPayload, {
          externalVoiceId: capability.externalVoiceId,
          sourceText: input.exactText,
          targetAssetId,
        });
  await rpc("command_prepare_narration_job", {
    p_asr_provider_capability_id: capability.asrCapabilityId,
    p_audio_identity_selection_id: input.audioIdentitySelectionId,
    p_audio_judge_provider_capability_id: capability.audioJudgeCapabilityId,
    p_capability_jti: capabilityJti,
    p_job_id: jobId,
    p_preflight_run_id: input.envelope.preflightRunId,
    p_provider_capability_id: capability.capabilityId,
    p_provider_payload: payload,
    p_stage_attempt_id: input.envelope.stageAttemptId,
    p_target_asset_id: targetAssetId,
  });

  const context = await claimNarrationProviderJob(jobId);
  if (
    ["submitted", "accepted", "polling", "succeeded"].includes(
      String(context.providerRequestState),
    )
  ) {
    return Object.freeze([]);
  }
  if (context.providerRequestState !== "reserved") {
    throw new NarrationProviderError("Narration provider request is not dispatchable.");
  }
  const request: ProviderBrokerRequest = Object.freeze({
    authorityEpoch: context.authorityEpoch as number,
    capabilityGrantId: context.capabilityGrantId as string,
    fencingToken: context.fencingToken as number,
    inputManifestId: context.inputManifestId as string,
    inputManifestSha256: context.inputManifestHash as string,
    operation: "gen_speech",
    preflightRunId: context.preflightRunId as string,
    providerRequestId: context.providerRequestId as string,
    quoteLineId: context.quoteLineId as string,
    schemaVersion: PROVIDER_BROKER_SCHEMA_VERSION,
    stageAttemptId: context.stageAttemptId as string,
    stageRunId: context.stageRunId as string,
    workspaceId: context.workspaceId as string,
  });
  const signing = getProviderCapabilitySigningEnvironment();
  return Object.freeze([
    Object.freeze({
      capabilityToken: issueProviderCapabilityToken({
        audience: signing.audience,
        capabilityJti: context.capabilityJti as string,
        issuer: signing.issuer,
        kid: signing.kid,
        privateKeyPkcs8Base64: signing.privateKeyPkcs8Base64,
        request,
        ttlSeconds: 300,
      }),
      request,
    }),
  ]);
}

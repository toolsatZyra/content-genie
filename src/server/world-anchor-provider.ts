import "server-only";

import { createHash } from "node:crypto";

import { getProviderCapabilitySigningEnvironment } from "@/config/provider-capability-signing-env";
import { getServerEnvironment } from "@/config/server-env";
import {
  compileCharacterAnchorPrompt,
  compileLocationAnchorPrompt,
  compilePropAnchorPrompt,
  type ExtractedCharacter,
  type ExtractedCharacterForm,
  type WorldExtraction,
} from "@/domain/agent/world-extraction";
import type { LookDefinition } from "@/domain/look/look-registry";
import {
  PROVIDER_BROKER_SCHEMA_VERSION,
  type ProviderBrokerRequest,
} from "@/domain/provider/broker-contract";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { issueProviderCapabilityToken } from "@/server/provider-capability-issuer";
import {
  researchRealWorldSubject,
  type TempleResearchEvidence,
} from "@/server/temple-research";
import { worldProgressItemKey } from "@/server/world-build-progress";
import type { PreflightTaskEnvelope } from "../../trigger/preflight-contract";

const canarySummary = Object.freeze({
  byteLength: 5_542_144,
  contentSha256: "89e686f077af9967ace0a6403a12aaf33429292f4a4df74a95a06ddb7ad963a5",
  height: 2_752,
  profile: "nano-banana-2.9x16.2k.high.png.v1",
  requestIdSha256: "4b8b2c4cb0d8d8de1a44526d744b2b439301e8adb3fa3e2324d248bf6aa252df",
  width: 1_536,
});

const editCanarySummary = Object.freeze({
  byteLength: 7_759_270,
  contentSha256: "f11af2f635c6309d0c4dfe27383a77d0eaf89175fcc066ff68ea997ffd90ca01",
  height: 2_752,
  profile: "nano-banana-2-edit.1ref.9x16.2k.high.png.v1",
  requestIdSha256: "30f96eeed04bccd136db062bd71d5d1043247b566d3b3aee8862aa96c504ab9a",
  width: 1_536,
});

export class WorldAnchorProviderError extends Error {
  override readonly name = "WorldAnchorProviderError";
}

export type WorldAnchorProviderDispatch = Readonly<{
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

// PostgreSQL jsonb::text sorts object keys and inserts one space after each
// comma/colon. World-manifest hashes use that exact stable representation.
export function postgresJsonbText(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(postgresJsonbText).join(", ")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => {
        const leftBytes = Buffer.from(left, "utf8");
        const rightBytes = Buffer.from(right, "utf8");
        return (
          leftBytes.length - rightBytes.length || Buffer.compare(leftBytes, rightBytes)
        );
      })
      .map(([key, nested]) => `${JSON.stringify(key)}: ${postgresJsonbText(nested)}`)
      .join(", ")}}`;
  }
  throw new WorldAnchorProviderError("World manifest is not JSON-compatible.");
}

export function buildCharacterIdentityManifest(
  character: ExtractedCharacter,
  form: ExtractedCharacterForm,
): ExtractedCharacterForm["identityManifest"] {
  const identity = form.identityManifest.identity;
  if (
    identity.characterKey !== character.canonicalKey ||
    identity.canonicalName !== character.displayName ||
    identity.formKey !== form.formKey ||
    identity.formName !== form.displayName
  ) {
    throw new WorldAnchorProviderError(
      "Character identity manifest is not bound to the extracted form.",
    );
  }
  return form.identityManifest;
}

async function rpc(name: string, parameters: Record<string, unknown>) {
  const { data, error } = await createAdminSupabaseClient().rpc(name, parameters);
  if (error) {
    console.error("World anchor ledger RPC rejected work.", {
      code: error.code,
      command: name,
    });
    throw new WorldAnchorProviderError("World anchor ledger rejected work.");
  }
  return data;
}

function exactObject(value: unknown, keys: readonly string[]): value is object {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",")
  );
}

async function seriesIdForRun(preflightRunId: string): Promise<string> {
  const { data, error } = await createAdminSupabaseClient()
    .from("preflight_runs")
    .select("episode:episodes!inner(series_id)")
    .eq("id", preflightRunId)
    .single();
  const episode = data?.episode as unknown;
  const row = Array.isArray(episode) ? episode[0] : episode;
  if (
    error ||
    !row ||
    typeof row !== "object" ||
    typeof (row as Record<string, unknown>).series_id !== "string"
  ) {
    throw new WorldAnchorProviderError("World anchor Series binding is unavailable.");
  }
  return (row as { series_id: string }).series_id;
}

export async function ensureFalCapability(workspaceId: string): Promise<string> {
  const environment = getServerEnvironment();
  const schemaSummary = {
    endpoint: "fal-ai/nano-banana-2",
    operation: "gen_image",
    payloadSchemaVersion: "genie.fal-nano-banana-2.v1",
    profile: {
      aspectRatio: "9:16",
      enableWebSearch: false,
      limitGenerations: true,
      numImages: 1,
      outputFormat: "png",
      resolution: "2K",
      safetyTolerance: "2",
      thinkingLevel: "high",
    },
  };
  const schemaEvidence = JSON.stringify(schemaSummary);
  const canaryEvidence = JSON.stringify(canarySummary);
  const retrievedAt = new Date("2026-07-19T00:00:00.000Z");
  const expiresAt = new Date(retrievedAt.getTime() + 90 * 24 * 60 * 60 * 1_000);
  const value = await rpc("command_ensure_fal_world_capability", {
    p_canary_canonical_hash: sha256(canaryEvidence),
    p_canary_raw_sha256: sha256(canaryEvidence),
    p_environment: environment.environment,
    p_expires_at: expiresAt.toISOString(),
    p_retrieved_at: retrievedAt.toISOString(),
    p_schema_canonical_hash: sha256(schemaEvidence),
    p_schema_raw_sha256: sha256(schemaEvidence),
    p_workspace_id: workspaceId,
  });
  if (
    !value ||
    typeof value !== "object" ||
    typeof (value as Record<string, unknown>).capabilityId !== "string" ||
    (value as Record<string, unknown>).unitPriceMinor !== 12
  ) {
    throw new WorldAnchorProviderError("World image capability is malformed.");
  }
  return (value as { capabilityId: string }).capabilityId;
}

type WorldRegenerationContext = Readonly<{
  characterFormId: string | null;
  characterId: string | null;
  characterKey: string | null;
  characterName: string | null;
  entityKind: "character" | "location";
  extractionResultId: string;
  formKey: string | null;
  formName: string | null;
  locationId: string | null;
  locationKey: string | null;
  locationName: string | null;
  namedTemple: boolean;
  negativePromptText: string;
  operation: "edit_image" | "gen_image";
  promptText: string;
  providerCapabilityId: string | null;
  providerPayload: Record<string, unknown> | null;
  realPlaceName: string | null;
  regenerationRequestId: string;
  templeEvidenceSetHash: string | null;
  worldManifest: Record<string, unknown>;
  worldManifestHash: string;
}>;

function parseWorldRegenerationContext(value: unknown): WorldRegenerationContext {
  const keys = [
    "characterFormId",
    "characterId",
    "characterKey",
    "characterName",
    "entityKind",
    "extractionResultId",
    "formKey",
    "formName",
    "locationId",
    "locationKey",
    "locationName",
    "namedTemple",
    "negativePromptText",
    "operation",
    "promptText",
    "providerCapabilityId",
    "providerPayload",
    "realPlaceName",
    "regenerationRequestId",
    "templeEvidenceSetHash",
    "worldManifest",
    "worldManifestHash",
  ] as const;
  if (!exactObject(value, keys)) {
    throw new WorldAnchorProviderError("World regeneration context is malformed.");
  }
  const row = value as Record<string, unknown>;
  if (
    !["character", "location"].includes(String(row.entityKind)) ||
    !["edit_image", "gen_image"].includes(String(row.operation)) ||
    typeof row.extractionResultId !== "string" ||
    typeof row.regenerationRequestId !== "string" ||
    typeof row.promptText !== "string" ||
    typeof row.negativePromptText !== "string" ||
    typeof row.namedTemple !== "boolean" ||
    !row.worldManifest ||
    typeof row.worldManifest !== "object" ||
    Array.isArray(row.worldManifest) ||
    typeof row.worldManifestHash !== "string" ||
    !/^[a-f0-9]{64}$/u.test(row.worldManifestHash)
  ) {
    throw new WorldAnchorProviderError("World regeneration context is malformed.");
  }
  return value as WorldRegenerationContext;
}

async function ensureFalEditCapability(workspaceId: string): Promise<string> {
  const environment = getServerEnvironment();
  const schemaSummary = {
    endpoint: "fal-ai/nano-banana-2/edit",
    operation: "edit_image",
    payloadSchemaVersion: "genie.fal-nano-banana-2-edit.v1",
    profile: {
      aspectRatio: "9:16",
      enableWebSearch: false,
      imageUrls: "1-4 exact signed promoted references",
      limitGenerations: true,
      numImages: 1,
      outputFormat: "png",
      resolution: "2K",
      safetyTolerance: "2",
      thinkingLevel: "high",
    },
  };
  const schemaEvidence = JSON.stringify(schemaSummary);
  const canaryEvidence = JSON.stringify(editCanarySummary);
  const retrievedAt = new Date("2026-07-19T00:00:00.000Z");
  const expiresAt = new Date(retrievedAt.getTime() + 90 * 24 * 60 * 60 * 1_000);
  const value = await rpc("command_ensure_fal_world_edit_capability", {
    p_canary_canonical_hash: sha256(canaryEvidence),
    p_canary_raw_sha256: sha256(canaryEvidence),
    p_environment: environment.environment,
    p_expires_at: expiresAt.toISOString(),
    p_retrieved_at: retrievedAt.toISOString(),
    p_schema_canonical_hash: sha256(schemaEvidence),
    p_schema_raw_sha256: sha256(schemaEvidence),
    p_workspace_id: workspaceId,
  });
  if (
    !value ||
    typeof value !== "object" ||
    typeof (value as Record<string, unknown>).capabilityId !== "string" ||
    (value as Record<string, unknown>).unitPriceMinor !== 12
  ) {
    throw new WorldAnchorProviderError("World reference-edit capability is malformed.");
  }
  return (value as { capabilityId: string }).capabilityId;
}

function providerPayload(prompt: string, targetAssetId: string) {
  return {
    aspectRatio: "9:16",
    enableWebSearch: false,
    limitGenerations: true,
    numImages: 1,
    outputFormat: "png",
    prompt,
    resolution: "2K",
    safetyTolerance: "2",
    targetAssetId,
    thinkingLevel: "high",
  } as const;
}

function providerEditPayload(
  prompt: string,
  targetAssetId: string,
  imageUrls: readonly string[],
) {
  return {
    ...providerPayload(prompt, targetAssetId),
    imageUrls,
  } as const;
}

function jobsForExtraction(input: {
  envelope: PreflightTaskEnvelope;
  extraction: WorldExtraction;
  generationCapabilityId: string;
  look: LookDefinition;
  seriesId: string;
  templeEvidenceByLocationKey: ReadonlyMap<string, TempleResearchEvidence>;
  editCapabilityId: string | null;
}) {
  const jobs: Record<string, unknown>[] = [];
  for (const character of input.extraction.characters) {
    const characterId = deterministicUuid(
      `series:${input.seriesId}:character:${character.canonicalKey}`,
    );
    for (const form of character.forms) {
      const formId = deterministicUuid(
        `series:${input.seriesId}:character:${character.canonicalKey}:form:${form.formKey}`,
      );
      const slot = worldProgressItemKey(
        "character",
        `${character.canonicalKey}.${form.formKey}`,
      );
      const jobId = deterministicUuid(
        `run:${input.envelope.preflightRunId}:job:${slot}`,
      );
      const targetAssetId = deterministicUuid(`job:${jobId}:asset`);
      const compiled = compileCharacterAnchorPrompt(character, form, input.look);
      const worldManifest = buildCharacterIdentityManifest(character, form);
      jobs.push({
        capabilityJti: deterministicUuid(`job:${jobId}:capability-jti`),
        characterFormId: formId,
        characterId,
        characterKey: character.canonicalKey,
        characterName: character.displayName,
        entityKind: "character",
        formKey: form.formKey,
        formName: form.displayName,
        jobId,
        locationId: null,
        locationKey: null,
        locationName: null,
        namedTemple: false,
        negativePromptText: compiled.negativePrompt,
        operation: "gen_image",
        promptText: compiled.prompt,
        providerCapabilityId: input.generationCapabilityId,
        providerPayload: providerPayload(compiled.prompt, targetAssetId),
        realPlaceName: null,
        slotKey: slot,
        targetAssetId,
        templeEvidenceSetHash: null,
        worldManifest,
        worldManifestHash: sha256(postgresJsonbText(worldManifest)),
      });
    }
  }
  for (const location of input.extraction.locations) {
    const locationId = deterministicUuid(
      `series:${input.seriesId}:location:${location.canonicalKey}`,
    );
    const slot = worldProgressItemKey("location", location.canonicalKey);
    const jobId = deterministicUuid(`run:${input.envelope.preflightRunId}:job:${slot}`);
    const targetAssetId = deterministicUuid(`job:${jobId}:asset`);
    const templeEvidence = input.templeEvidenceByLocationKey.get(location.canonicalKey);
    if (location.researchRequired && (!templeEvidence || !input.editCapabilityId)) {
      throw new WorldAnchorProviderError(
        "Real-world generation is missing verified reference evidence.",
      );
    }
    const compiled = compileLocationAnchorPrompt(
      location,
      input.look,
      Boolean(templeEvidence),
    );
    const worldManifest = {
      location,
      schemaVersion: "genie.location-manifest.v1",
    };
    jobs.push({
      capabilityJti: deterministicUuid(`job:${jobId}:capability-jti`),
      characterFormId: null,
      characterId: null,
      characterKey: null,
      characterName: null,
      entityKind: "location",
      formKey: null,
      formName: null,
      jobId,
      locationId,
      locationKey: location.canonicalKey,
      locationName: location.displayName,
      namedTemple: location.namedTemple,
      negativePromptText: compiled.negativePrompt,
      operation: templeEvidence ? "edit_image" : "gen_image",
      promptText: compiled.prompt,
      providerCapabilityId: templeEvidence
        ? input.editCapabilityId
        : input.generationCapabilityId,
      providerPayload: templeEvidence
        ? providerEditPayload(compiled.prompt, targetAssetId, templeEvidence.imageUrls)
        : providerPayload(compiled.prompt, targetAssetId),
      realPlaceName: location.realPlaceName,
      slotKey: slot,
      targetAssetId,
      templeEvidenceSetHash: templeEvidence?.evidenceSetHash ?? null,
      worldManifest,
      worldManifestHash: sha256(postgresJsonbText(worldManifest)),
    });
  }
  for (const prop of input.extraction.props) {
    const locationKey = `prop.${prop.canonicalKey}`;
    const locationId = deterministicUuid(
      `series:${input.seriesId}:prop:${prop.canonicalKey}`,
    );
    const slot = worldProgressItemKey("prop", prop.canonicalKey);
    const jobId = deterministicUuid(`run:${input.envelope.preflightRunId}:job:${slot}`);
    const targetAssetId = deterministicUuid(`job:${jobId}:asset`);
    const compiled = compilePropAnchorPrompt(prop, input.look);
    const worldManifest = {
      prop,
      schemaVersion: "genie.prop-manifest.v1",
      worldObjectKind: "prop",
    };
    jobs.push({
      capabilityJti: deterministicUuid(`job:${jobId}:capability-jti`),
      characterFormId: null,
      characterId: null,
      characterKey: null,
      characterName: null,
      entityKind: "location",
      formKey: null,
      formName: null,
      jobId,
      locationId,
      locationKey,
      locationName: prop.displayName,
      namedTemple: false,
      negativePromptText: compiled.negativePrompt,
      operation: "gen_image",
      promptText: compiled.prompt,
      providerCapabilityId: input.generationCapabilityId,
      providerPayload: providerPayload(compiled.prompt, targetAssetId),
      realPlaceName: null,
      slotKey: slot,
      targetAssetId,
      templeEvidenceSetHash: null,
      worldManifest,
      worldManifestHash: sha256(postgresJsonbText(worldManifest)),
    });
  }
  return Object.freeze(jobs);
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
  "operation",
  "preflightRunId",
  "providerRequestId",
  "providerRequestState",
  "quoteLineId",
  "replayed",
  "stageAttemptId",
  "stageRunId",
  "workspaceId",
] as const;

export async function prepareWorldAnchorProviderDispatches(
  input: Readonly<{
    envelope: PreflightTaskEnvelope;
    extraction: WorldExtraction;
    extractionResultId: string;
    look: LookDefinition;
  }>,
): Promise<readonly WorldAnchorProviderDispatch[]> {
  const anchorCount =
    input.extraction.characters.reduce(
      (sum, character) => sum + character.forms.length,
      0,
    ) +
    input.extraction.locations.length +
    input.extraction.props.length;
  if (anchorCount < 1 || anchorCount > 32) {
    throw new WorldAnchorProviderError(
      "World extraction exceeds the 32-anchor launch ceiling.",
    );
  }
  const researchedSubjects = input.extraction.locations.filter(
    (location) => location.researchRequired,
  );
  const [seriesId, capabilityId, editCapabilityId] = await Promise.all([
    seriesIdForRun(input.envelope.preflightRunId),
    ensureFalCapability(input.envelope.workspaceId),
    researchedSubjects.length > 0
      ? ensureFalEditCapability(input.envelope.workspaceId)
      : Promise.resolve(null),
  ]);
  const templeEvidence = await Promise.all(
    researchedSubjects.map(
      async (location) =>
        [
          location.canonicalKey,
          await researchRealWorldSubject({
            envelope: input.envelope,
            extractionResultId: input.extractionResultId,
            location,
          }),
        ] as const,
    ),
  );
  const jobs = jobsForExtraction({
    envelope: input.envelope,
    extraction: input.extraction,
    generationCapabilityId: capabilityId,
    look: input.look,
    seriesId,
    templeEvidenceByLocationKey: new Map(templeEvidence),
    editCapabilityId,
  });
  await rpc("command_prepare_world_anchor_jobs", {
    p_jobs: jobs,
    p_preflight_run_id: input.envelope.preflightRunId,
    p_provider_capability_id: capabilityId,
    p_stage_attempt_id: input.envelope.stageAttemptId,
    p_world_extraction_result_id: input.extractionResultId,
  });
  const retryPool = await rpc("command_ensure_world_anchor_retry_pool", {
    p_preflight_run_id: input.envelope.preflightRunId,
    p_stage_attempt_id: input.envelope.stageAttemptId,
  });
  if (
    !exactObject(retryPool, [
      "hardCeilingMinor",
      "ok",
      "pooledQuoteHash",
      "preparationId",
      "primarySlotCount",
      "replayed",
      "retrySlotCount",
    ]) ||
    (retryPool as Record<string, unknown>).ok !== true ||
    (retryPool as Record<string, unknown>).hardCeilingMinor !== 384 ||
    (retryPool as Record<string, unknown>).primarySlotCount !== anchorCount ||
    (retryPool as Record<string, unknown>).retrySlotCount !== 32 - anchorCount ||
    typeof (retryPool as Record<string, unknown>).replayed !== "boolean" ||
    typeof (retryPool as Record<string, unknown>).preparationId !== "string" ||
    typeof (retryPool as Record<string, unknown>).pooledQuoteHash !== "string" ||
    !/^[a-f0-9]{64}$/u.test(
      (retryPool as Record<string, unknown>).pooledQuoteHash as string,
    )
  ) {
    throw new WorldAnchorProviderError("World anchor retry pool is malformed.");
  }
  const signing = getProviderCapabilitySigningEnvironment();
  const dispatches: WorldAnchorProviderDispatch[] = [];
  for (const job of jobs) {
    const jobId = job.jobId as string;
    const claim = await rpc("command_claim_world_anchor_provider_job", {
      p_correlation_id: deterministicUuid(`job:${jobId}:correlation`),
      p_idempotency_key: `world-job:${jobId}`,
      p_job_id: jobId,
    });
    if (!exactObject(claim, claimKeys)) {
      throw new WorldAnchorProviderError("World anchor provider claim is malformed.");
    }
    const record = claim as Record<string, unknown>;
    if (record.ok !== true || typeof record.providerRequestState !== "string") {
      throw new WorldAnchorProviderError("World anchor provider claim was rejected.");
    }
    if (!["gen_image", "edit_image"].includes(String(record.operation))) {
      throw new WorldAnchorProviderError(
        "World anchor provider operation is malformed.",
      );
    }
    if (
      ["submitted", "accepted", "polling", "succeeded"].includes(
        record.providerRequestState,
      )
    ) {
      continue;
    }
    if (record.providerRequestState !== "reserved") {
      throw new WorldAnchorProviderError(
        "World anchor provider request is not dispatchable.",
      );
    }
    const request: ProviderBrokerRequest = Object.freeze({
      authorityEpoch: record.authorityEpoch as number,
      capabilityGrantId: record.capabilityGrantId as string,
      fencingToken: record.fencingToken as number,
      inputManifestId: record.inputManifestId as string,
      inputManifestSha256: record.inputManifestHash as string,
      operation: record.operation as "edit_image" | "gen_image",
      preflightRunId: record.preflightRunId as string,
      providerRequestId: record.providerRequestId as string,
      quoteLineId: record.quoteLineId as string,
      schemaVersion: PROVIDER_BROKER_SCHEMA_VERSION,
      stageAttemptId: record.stageAttemptId as string,
      stageRunId: record.stageRunId as string,
      workspaceId: record.workspaceId as string,
    });
    dispatches.push(
      Object.freeze({
        capabilityToken: issueProviderCapabilityToken({
          audience: signing.audience,
          capabilityJti: record.capabilityJti as string,
          issuer: signing.issuer,
          kid: signing.kid,
          privateKeyPkcs8Base64: signing.privateKeyPkcs8Base64,
          request,
          ttlSeconds: 300,
        }),
        request,
      }),
    );
  }
  return Object.freeze(dispatches);
}

export async function prepareWorldRegenerationProviderDispatch(
  input: Readonly<{
    envelope: PreflightTaskEnvelope;
    regenerationRequestId: string;
  }>,
): Promise<WorldAnchorProviderDispatch | null> {
  const context = parseWorldRegenerationContext(
    await rpc("command_prepare_world_regeneration_context", {
      p_preflight_run_id: input.envelope.preflightRunId,
      p_regeneration_request_id: input.regenerationRequestId,
      p_stage_attempt_id: input.envelope.stageAttemptId,
    }),
  );
  if (context.regenerationRequestId !== input.regenerationRequestId) {
    throw new WorldAnchorProviderError("World regeneration scope is stale.");
  }
  if (context.namedTemple) {
    throw new WorldAnchorProviderError(
      "A real-world recast needs refreshed verified reference evidence.",
    );
  }

  const capabilityId = await ensureFalCapability(input.envelope.workspaceId);
  const jobId = deterministicUuid(`regeneration:${input.regenerationRequestId}:job`);
  const targetAssetId = deterministicUuid(
    `regeneration:${input.regenerationRequestId}:asset`,
  );
  const providerInput = {
    ...(context.providerPayload ?? {}),
    ...providerPayload(context.promptText, targetAssetId),
  };
  delete (providerInput as Record<string, unknown>).imageUrls;
  const job = {
    capabilityJti: deterministicUuid(`job:${jobId}:capability-jti`),
    characterFormId: context.characterFormId,
    characterId: context.characterId,
    characterKey: context.characterKey,
    characterName: context.characterName,
    entityKind: context.entityKind,
    formKey: context.formKey,
    formName: context.formName,
    jobId,
    locationId: context.locationId,
    locationKey: context.locationKey,
    locationName: context.locationName,
    namedTemple: false,
    negativePromptText: context.negativePromptText,
    operation: "gen_image",
    promptText: context.promptText,
    providerCapabilityId: capabilityId,
    providerPayload: providerInput,
    realPlaceName: context.realPlaceName,
    slotKey: `regeneration.${input.regenerationRequestId}`,
    targetAssetId,
    templeEvidenceSetHash: null,
    worldManifest: context.worldManifest,
    worldManifestHash: context.worldManifestHash,
  };
  await rpc("command_prepare_world_anchor_jobs", {
    p_jobs: [job],
    p_preflight_run_id: input.envelope.preflightRunId,
    p_provider_capability_id: capabilityId,
    p_stage_attempt_id: input.envelope.stageAttemptId,
    p_world_extraction_result_id: context.extractionResultId,
  });
  const retryPool = await rpc("command_ensure_world_anchor_retry_pool", {
    p_preflight_run_id: input.envelope.preflightRunId,
    p_stage_attempt_id: input.envelope.stageAttemptId,
  });
  if (
    !exactObject(retryPool, [
      "hardCeilingMinor",
      "ok",
      "pooledQuoteHash",
      "preparationId",
      "primarySlotCount",
      "replayed",
      "retrySlotCount",
    ]) ||
    (retryPool as Record<string, unknown>).ok !== true ||
    (retryPool as Record<string, unknown>).primarySlotCount !== 1 ||
    (retryPool as Record<string, unknown>).retrySlotCount !== 31
  ) {
    throw new WorldAnchorProviderError("World regeneration retry pool is malformed.");
  }
  await rpc("command_bind_world_regeneration_job", {
    p_regeneration_request_id: input.regenerationRequestId,
    p_world_anchor_job_id: jobId,
  });
  const claim = await rpc("command_claim_world_anchor_provider_job", {
    p_correlation_id: deterministicUuid(`job:${jobId}:correlation`),
    p_idempotency_key: `world-job:${jobId}`,
    p_job_id: jobId,
  });
  if (!exactObject(claim, claimKeys)) {
    throw new WorldAnchorProviderError(
      "World regeneration provider claim is malformed.",
    );
  }
  const record = claim as Record<string, unknown>;
  if (record.ok !== true || typeof record.providerRequestState !== "string") {
    throw new WorldAnchorProviderError(
      "World regeneration provider claim was rejected.",
    );
  }
  if (
    ["submitted", "accepted", "polling", "succeeded"].includes(
      record.providerRequestState,
    )
  ) {
    return null;
  }
  if (record.providerRequestState !== "reserved" || record.operation !== "gen_image") {
    throw new WorldAnchorProviderError(
      "World regeneration provider request is not dispatchable.",
    );
  }
  const request: ProviderBrokerRequest = Object.freeze({
    authorityEpoch: record.authorityEpoch as number,
    capabilityGrantId: record.capabilityGrantId as string,
    fencingToken: record.fencingToken as number,
    inputManifestId: record.inputManifestId as string,
    inputManifestSha256: record.inputManifestHash as string,
    operation: "gen_image",
    preflightRunId: record.preflightRunId as string,
    providerRequestId: record.providerRequestId as string,
    quoteLineId: record.quoteLineId as string,
    schemaVersion: PROVIDER_BROKER_SCHEMA_VERSION,
    stageAttemptId: record.stageAttemptId as string,
    stageRunId: record.stageRunId as string,
    workspaceId: record.workspaceId as string,
  });
  const signing = getProviderCapabilitySigningEnvironment();
  return Object.freeze({
    capabilityToken: issueProviderCapabilityToken({
      audience: signing.audience,
      capabilityJti: record.capabilityJti as string,
      issuer: signing.issuer,
      kid: signing.kid,
      privateKeyPkcs8Base64: signing.privateKeyPkcs8Base64,
      request,
      ttlSeconds: 300,
    }),
    request,
  });
}

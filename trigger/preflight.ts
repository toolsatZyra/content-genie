import { task, type TaskOptions } from "@trigger.dev/sdk/v3";

import {
  parsePreflightTaskEnvelope,
  PREFLIGHT_TASK_JSON_SCHEMA,
  type PreflightTaskEnvelope,
} from "./preflight-contract";
import { callPreflightControlBroker } from "./control-broker-client";
import { callProviderBroker } from "./provider-broker-client";
import type { ProviderBrokerRequest } from "../src/domain/provider/broker-contract";

const providerSecretNames = [
  "ANTHROPIC_API_KEY",
  "ELEVENLABS_API_KEY",
  "FAL_KEY",
  "GOOGLE_GENAI_API_KEY",
  "GROQ_API_KEY",
  "KLING_ACCESS_KEY",
  "KLING_SECRET_KEY",
  "OPENAI_API_KEY",
  "SARVAM_API_KEY",
  "SEEDANCE_CALLBACK_SECRET",
] as const;

function assertCredentialFreeRuntime(): void {
  const leaked = providerSecretNames.filter((name) => Boolean(process.env[name]));
  if (leaked.length > 0) {
    throw new Error(
      "The preflight control runtime contains a forbidden provider secret.",
    );
  }
}

async function execute(
  payload: PreflightTaskEnvelope,
  queue: string,
  taskId: string,
  triggerRunId: string,
) {
  assertCredentialFreeRuntime();
  const envelope = parsePreflightTaskEnvelope(payload);
  const result = await callPreflightControlBroker<{
    pendingExternal: boolean;
    providerDispatches: readonly Readonly<{
      capabilityToken: string;
      request: ProviderBrokerRequest;
    }>[];
    terminal?: boolean;
  }>({
    envelope,
    operation: "execute",
    preflightRunId: envelope.preflightRunId,
    stageAttemptId: envelope.stageAttemptId,
    stageRunId: envelope.stageRunId,
    taskId,
    triggerRunId,
  });
  if (result.terminal === true) {
    return {
      authorityEpoch: envelope.authorityEpoch,
      fencingToken: envelope.fencingToken,
      inputManifestSha256: envelope.inputManifestSha256,
      preflightRunId: envelope.preflightRunId,
      stageAttemptId: envelope.stageAttemptId,
      queue,
      pendingExternal: false,
      terminal: true,
    } as const;
  }
  if (result.pendingExternal) {
    for (const providerDispatch of result.providerDispatches) {
      await callProviderBroker({
        capabilityToken: providerDispatch.capabilityToken,
        request: providerDispatch.request,
        taskId,
        triggerRunId,
      });
    }
    await callPreflightControlBroker({
      envelope,
      operation: "externalize",
      preflightRunId: envelope.preflightRunId,
      stageAttemptId: envelope.stageAttemptId,
      stageRunId: envelope.stageRunId,
      taskId,
      triggerRunId,
    });
  }
  return {
    authorityEpoch: envelope.authorityEpoch,
    fencingToken: envelope.fencingToken,
    inputManifestSha256: envelope.inputManifestSha256,
    preflightRunId: envelope.preflightRunId,
    stageAttemptId: envelope.stageAttemptId,
    queue,
    pendingExternal: result.pendingExternal,
  } as const;
}

const childRetry = {
  maxAttempts: 3,
  factor: 2,
  minTimeoutInMs: 2_000,
  maxTimeoutInMs: 15_000,
  randomize: true,
} as const;

const dispatcherRetry = {
  maxAttempts: 3,
  factor: 2,
  minTimeoutInMs: 6_000,
  maxTimeoutInMs: 30_000,
  randomize: true,
} as const;

async function failExhaustedAttempt(
  payload: PreflightTaskEnvelope,
  taskId: string,
  triggerRunId: string,
) {
  const envelope = parsePreflightTaskEnvelope(payload);
  await callPreflightControlBroker({
    envelope,
    operation: "fail",
    preflightRunId: envelope.preflightRunId,
    stageAttemptId: envelope.stageAttemptId,
    stageRunId: envelope.stageRunId,
    taskId,
    triggerRunId,
  });
}

export const preflightWorldImages = task({
  id: "genie-preflight-world-images-v1",
  description: "Credential-free control task for world-anchor image attempts.",
  jsonSchema: PREFLIGHT_TASK_JSON_SCHEMA,
  maxDuration: 600,
  queue: { name: "genie-preflight-world-images", concurrencyLimit: 5 },
  retry: childRetry,
  onFailure: async ({ payload, ctx }) =>
    failExhaustedAttempt(payload, "genie-preflight-world-images-v1", ctx.run.id),
  run: async (payload: PreflightTaskEnvelope, { ctx }) =>
    execute(
      payload,
      "genie-preflight-world-images",
      "genie-preflight-world-images-v1",
      ctx.run.id,
    ),
});

export const preflightNarrationClock = task({
  id: "genie-preflight-narration-clock-v1",
  description: "Credential-free control task for speech and master-clock attempts.",
  jsonSchema: PREFLIGHT_TASK_JSON_SCHEMA,
  maxDuration: 600,
  queue: { name: "genie-preflight-narration-clock", concurrencyLimit: 3 },
  retry: childRetry,
  onFailure: async ({ payload, ctx }) =>
    failExhaustedAttempt(payload, "genie-preflight-narration-clock-v1", ctx.run.id),
  run: async (payload: PreflightTaskEnvelope, { ctx }) =>
    execute(
      payload,
      "genie-preflight-narration-clock",
      "genie-preflight-narration-clock-v1",
      ctx.run.id,
    ),
});

export const preflightSecureIngest = task({
  id: "genie-preflight-secure-ingest-v1",
  description: "Credential-free control task for secure fetch and quarantine ingest.",
  jsonSchema: PREFLIGHT_TASK_JSON_SCHEMA,
  maxDuration: 600,
  queue: { name: "genie-preflight-secure-ingest", concurrencyLimit: 4 },
  retry: childRetry,
  onFailure: async ({ payload, ctx }) =>
    failExhaustedAttempt(payload, "genie-preflight-secure-ingest-v1", ctx.run.id),
  run: async (payload: PreflightTaskEnvelope, { ctx }) =>
    execute(
      payload,
      "genie-preflight-secure-ingest",
      "genie-preflight-secure-ingest-v1",
      ctx.run.id,
    ),
});

export const preflightPlanEvaluation = task({
  id: "genie-preflight-plan-evaluation-v1",
  description: "Credential-free control task for deterministic plan evaluation.",
  jsonSchema: PREFLIGHT_TASK_JSON_SCHEMA,
  maxDuration: 300,
  queue: { name: "genie-preflight-plan-evaluation", concurrencyLimit: 6 },
  retry: childRetry,
  onFailure: async ({ payload, ctx }) =>
    failExhaustedAttempt(payload, "genie-preflight-plan-evaluation-v1", ctx.run.id),
  run: async (payload: PreflightTaskEnvelope, { ctx }) =>
    execute(
      payload,
      "genie-preflight-plan-evaluation",
      "genie-preflight-plan-evaluation-v1",
      ctx.run.id,
    ),
});

type DispatchPayload = Readonly<{ preflightRunId: string }>;

const dispatchSchema: NonNullable<
  TaskOptions<"genie-preflight-dispatch-v1">["jsonSchema"]
> = {
  type: "object",
  additionalProperties: false,
  required: ["preflightRunId"],
  properties: { preflightRunId: { type: "string", format: "uuid" } },
};

export const preflightDispatcher = task({
  id: "genie-preflight-dispatch-v1",
  description: "Credential-free dispatcher for fenced preflight stage attempts.",
  jsonSchema: dispatchSchema,
  maxDuration: 900,
  queue: { name: "genie-preflight-dispatch", concurrencyLimit: 10 },
  retry: dispatcherRetry,
  run: async (payload: DispatchPayload, { ctx }) => {
    assertCredentialFreeRuntime();
    const dispatched = await callPreflightControlBroker<{
      envelope: PreflightTaskEnvelope;
      kind: "narration_clock" | "plan_evaluation" | "secure_ingest" | "world_anchor";
    }>({
      operation: "dispatch",
      preflightRunId: payload.preflightRunId,
      stageAttemptId: null,
      stageRunId: null,
      taskId: "genie-preflight-dispatch-v1",
      triggerRunId: ctx.run.id,
    });
    const child =
      dispatched.kind === "world_anchor"
        ? await preflightWorldImages.triggerAndWait(dispatched.envelope)
        : dispatched.kind === "narration_clock"
          ? await preflightNarrationClock.triggerAndWait(dispatched.envelope)
          : dispatched.kind === "secure_ingest"
            ? await preflightSecureIngest.triggerAndWait(dispatched.envelope)
            : await preflightPlanEvaluation.triggerAndWait(dispatched.envelope);
    if (!child.ok) {
      throw new Error("Preflight child task failed.");
    }
    const childOutput = child.output as
      { pendingExternal?: boolean; terminal?: boolean } | undefined;
    if (childOutput?.terminal) {
      return {
        ok: true,
        preflightRunId: payload.preflightRunId,
        terminal: true,
      } as const;
    }
    if (!childOutput?.pendingExternal) {
      await callPreflightControlBroker({
        operation: "finalize",
        preflightRunId: payload.preflightRunId,
        stageAttemptId: null,
        stageRunId: null,
        taskId: "genie-preflight-dispatch-v1",
        triggerRunId: ctx.run.id,
      });
    }
    return { ok: true, preflightRunId: payload.preflightRunId } as const;
  },
});

import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  MvpMediaProviderBrokerError,
  fetchMvpFalQueueResult,
  submitMvpFalProvider,
  type MvpFalBilledResult,
  type MvpFalControl,
} from "@/server/mvp-media-provider-broker";

type DispatchState =
  "reserved" | "dispatching" | "submitted" | "succeeded" | "failed" | "outcome_unknown";

type DispatchRow = Readonly<{
  callback_token_sha256: string | null;
  claim_token: string | null;
  external_request_id: string | null;
  fencing_token: number;
  id: string;
  response_url: string | null;
  state: DispatchState;
  status_url: string | null;
  version: number;
}>;

export class MvpMediaDispatchError extends Error {
  override readonly name = "MvpMediaDispatchError";

  constructor(
    message: string,
    readonly safeCode: string,
    readonly retryable = true,
  ) {
    super(message);
  }
}

function row(value: unknown, label: string): DispatchRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MvpMediaDispatchError(label, "PRODUCTION_LEDGER_FAILED", false);
  }
  const result = value as Record<string, unknown>;
  if (
    typeof result.id !== "string" ||
    typeof result.state !== "string" ||
    ![
      "reserved",
      "dispatching",
      "submitted",
      "succeeded",
      "failed",
      "outcome_unknown",
    ].includes(result.state) ||
    !Number.isSafeInteger(result.version) ||
    !Number.isSafeInteger(result.fencing_token)
  ) {
    throw new MvpMediaDispatchError(label, "PRODUCTION_LEDGER_FAILED", false);
  }
  return result as unknown as DispatchRow;
}

async function rpc(name: string, parameters: Record<string, unknown>) {
  const { data, error } = await createAdminSupabaseClient().rpc(name, parameters);
  if (error) {
    throw new MvpMediaDispatchError(
      "The provider dispatch ledger rejected the operation.",
      "PRODUCTION_LEDGER_FAILED",
      false,
    );
  }
  return data;
}

function existingControl(dispatch: DispatchRow): MvpFalControl | null {
  if (
    !["submitted", "succeeded"].includes(dispatch.state) ||
    !dispatch.external_request_id ||
    !dispatch.status_url ||
    !dispatch.response_url
  ) {
    return null;
  }
  return Object.freeze({
    externalRequestId: dispatch.external_request_id,
    responseUrl: dispatch.response_url,
    statusUrl: dispatch.status_url,
  });
}

const RECEIPT_RECONCILIATION_ATTEMPTS = 3;
const RECEIPT_RECONCILIATION_BACKOFF_MS = [50, 150] as const;

async function bindMediaCallback(
  dispatch: DispatchRow & Readonly<{ claim_token: string }>,
): Promise<Readonly<{ dispatch: DispatchRow; token: string }>> {
  const token = randomBytes(32).toString("base64url");
  const tokenSha256 = createHash("sha256").update(token).digest("hex");
  let lastError: unknown;
  for (let attempt = 1; attempt <= RECEIPT_RECONCILIATION_ATTEMPTS; attempt += 1) {
    try {
      const bound = row(
        await rpc("command_bind_mvp_media_dispatch_callback", {
          p_callback_token_sha256: tokenSha256,
          p_claim_token: dispatch.claim_token,
          p_dispatch_id: dispatch.id,
          p_expected_version: dispatch.version,
          p_fencing_token: dispatch.fencing_token,
        }),
        "The provider callback binding is malformed.",
      );
      if (bound.callback_token_sha256 !== tokenSha256) {
        throw new MvpMediaDispatchError(
          "The provider callback binding was not committed.",
          "PRODUCTION_LEDGER_FAILED",
          false,
        );
      }
      return Object.freeze({ dispatch: bound, token });
    } catch (caught) {
      lastError = caught;
      if (attempt < RECEIPT_RECONCILIATION_ATTEMPTS) {
        await delay(RECEIPT_RECONCILIATION_BACKOFF_MS[attempt - 1]);
      }
    }
  }
  throw new MvpMediaDispatchError(
    lastError instanceof Error
      ? `The provider callback binding is pending: ${lastError.message}`
      : "The provider callback binding is pending.",
    "PRODUCTION_LEDGER_FAILED",
    true,
  );
}

async function reconcileKnownSubmission(
  dispatch: DispatchRow & Readonly<{ claim_token: string }>,
  input: Readonly<{
    attemptNumber: number;
    dispatchKey: string;
    endpoint: string;
    inputManifestSha256: string;
    productionRunId: string;
  }>,
  submitted: MvpFalControl,
): Promise<DispatchRow> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= RECEIPT_RECONCILIATION_ATTEMPTS; attempt += 1) {
    try {
      return row(
        await rpc("command_reconcile_mvp_media_dispatch_submission", {
          p_attempt_number: input.attemptNumber,
          p_claim_token: dispatch.claim_token,
          p_dispatch_id: dispatch.id,
          p_dispatch_key: input.dispatchKey,
          p_endpoint: input.endpoint,
          p_expected_version: dispatch.version,
          p_external_request_id: submitted.externalRequestId,
          p_fencing_token: dispatch.fencing_token,
          p_input_manifest_sha256: input.inputManifestSha256,
          p_production_run_id: input.productionRunId,
          p_response_url: submitted.responseUrl,
          p_status_url: submitted.statusUrl,
        }),
        "The provider dispatch receipt reconciliation is malformed.",
      );
    } catch (caught) {
      lastError = caught;
      if (attempt < RECEIPT_RECONCILIATION_ATTEMPTS) {
        await delay(RECEIPT_RECONCILIATION_BACKOFF_MS[attempt - 1]);
      }
    }
  }
  throw new MvpMediaDispatchError(
    lastError instanceof Error
      ? `The known provider receipt is awaiting ledger reconciliation: ${lastError.message}`
      : "The known provider receipt is awaiting ledger reconciliation.",
    "PROVIDER_RECEIPT_RECONCILIATION_PENDING",
    true,
  );
}

export async function dispatchMvpFalMedia(
  input: Readonly<{
    attemptNumber: number;
    dispatchKey: string;
    endpoint: string;
    episodeId: string;
    expectedCostMicrousd: number;
    inputManifestSha256: string;
    maximumCostMicrousd: number;
    mediaKind: "clip" | "storyboard";
    payload: Readonly<Record<string, unknown>>;
    productionRunId: string;
    shotNumber: number;
    workspaceId: string;
  }>,
): Promise<MvpFalControl & Readonly<{ providerDispatchId: string }>> {
  let dispatch = row(
    await rpc("command_reserve_mvp_media_dispatch", {
      p_attempt_number: input.attemptNumber,
      p_dispatch_key: input.dispatchKey,
      p_endpoint: input.endpoint,
      p_episode_id: input.episodeId,
      p_expected_cost_microusd: input.expectedCostMicrousd,
      p_input_manifest_sha256: input.inputManifestSha256,
      p_maximum_cost_microusd: input.maximumCostMicrousd,
      p_media_kind: input.mediaKind,
      p_production_run_id: input.productionRunId,
      p_shot_number: input.shotNumber,
      p_workspace_id: input.workspaceId,
    }),
    "The provider dispatch reservation is malformed.",
  );
  const replay = existingControl(dispatch);
  if (replay) return Object.freeze({ ...replay, providerDispatchId: dispatch.id });
  if (dispatch.state !== "reserved") {
    throw new MvpMediaDispatchError(
      dispatch.state === "dispatching"
        ? "The exact provider dispatch is already owned by another worker."
        : "The exact provider dispatch cannot be issued again automatically.",
      dispatch.state === "dispatching"
        ? "PROVIDER_DISPATCH_BUSY"
        : "PROVIDER_OUTCOME_UNKNOWN",
      dispatch.state === "dispatching",
    );
  }
  dispatch = row(
    await rpc("command_claim_mvp_media_dispatch", {
      p_dispatch_id: dispatch.id,
      p_expected_version: dispatch.version,
      p_lease_seconds: 120,
    }),
    "The provider dispatch claim is malformed.",
  );
  if (!dispatch.claim_token || dispatch.state !== "dispatching") {
    throw new MvpMediaDispatchError(
      "The provider dispatch claim is invalid.",
      "PRODUCTION_LEDGER_FAILED",
      false,
    );
  }
  const callback = await bindMediaCallback(
    dispatch as DispatchRow & Readonly<{ claim_token: string }>,
  );
  dispatch = callback.dispatch;
  let submitted: MvpFalControl;
  try {
    submitted = await submitMvpFalProvider(
      input.endpoint,
      input.payload,
      dispatch.id,
      callback.token,
    );
  } catch (caught) {
    const broker = caught instanceof MvpMediaProviderBrokerError ? caught : undefined;
    await rpc("command_fail_mvp_media_dispatch", {
      p_claim_token: dispatch.claim_token,
      p_dispatch_id: dispatch.id,
      p_error_code: broker?.safeCode ?? "PROVIDER_OUTCOME_UNKNOWN",
      p_error_summary:
        caught instanceof Error
          ? caught.message.slice(0, 500)
          : "The provider dispatch outcome is unknown.",
      p_expected_version: dispatch.version,
      p_fencing_token: dispatch.fencing_token,
      p_outcome_unknown: !broker || broker.disposition === "unknown",
    }).catch(() => undefined);
    throw new MvpMediaDispatchError(
      caught instanceof Error ? caught.message : "The provider dispatch failed.",
      broker?.safeCode ?? "PROVIDER_OUTCOME_UNKNOWN",
      false,
    );
  }

  let recorded: DispatchRow;
  try {
    recorded = row(
      await rpc("command_record_mvp_media_dispatch_submission", {
        p_claim_token: dispatch.claim_token,
        p_dispatch_id: dispatch.id,
        p_expected_version: dispatch.version,
        p_external_request_id: submitted.externalRequestId,
        p_fencing_token: dispatch.fencing_token,
        p_response_url: submitted.responseUrl,
        p_status_url: submitted.statusUrl,
      }),
      "The provider dispatch receipt is malformed.",
    );
  } catch {
    recorded = await reconcileKnownSubmission(
      dispatch as DispatchRow & Readonly<{ claim_token: string }>,
      input,
      submitted,
    );
  }
  const recordedControl = existingControl(recorded);
  if (!recordedControl) {
    throw new MvpMediaDispatchError(
      "The known provider receipt was not committed.",
      "PROVIDER_RECEIPT_RECONCILIATION_PENDING",
      true,
    );
  }
  return Object.freeze({ ...recordedControl, providerDispatchId: recorded.id });
}

export async function completeMvpMediaDispatchOutput(input: {
  billingEvidenceSha256: string;
  billableUnits: number;
  externalRequestId: string;
  outputContentSha256: string;
  providerDispatchId: string;
}): Promise<void> {
  await rpc("command_complete_mvp_media_dispatch_output", {
    p_actual_billable_units: input.billableUnits,
    p_billing_evidence_sha256: input.billingEvidenceSha256,
    p_dispatch_id: input.providerDispatchId,
    p_external_request_id: input.externalRequestId,
    p_output_content_sha256: input.outputContentSha256,
  });
}

export async function fetchMvpFalBilledResultForDispatch(input: {
  externalRequestId: string;
  providerDispatchId: string;
  responseUrl: string;
  timeoutMs: number;
}): Promise<MvpFalBilledResult> {
  try {
    return await fetchMvpFalQueueResult(input.responseUrl, input.timeoutMs);
  } catch (caught) {
    if (
      caught instanceof MvpMediaProviderBrokerError &&
      caught.safeCode === "PROVIDER_BILLING_UNRECONCILED"
    ) {
      await rpc("command_record_mvp_media_billing_unreconciled", {
        p_dispatch_id: input.providerDispatchId,
        p_error_summary: caught.message.slice(0, 500),
        p_external_request_id: input.externalRequestId,
      });
      throw new MvpMediaDispatchError(
        caught.message,
        "PROVIDER_BILLING_UNRECONCILED",
        true,
      );
    }
    throw caught;
  }
}

export async function reconcileMvpMediaDispatchWebhook(input: {
  callbackToken: string;
  externalRequestId: string;
  providerDispatchId: string;
}): Promise<void> {
  await rpc("command_reconcile_mvp_media_dispatch_webhook", {
    p_callback_token: input.callbackToken,
    p_dispatch_id: input.providerDispatchId,
    p_external_request_id: input.externalRequestId,
  });
}

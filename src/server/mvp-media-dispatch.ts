import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  MvpMediaProviderBrokerError,
  fetchMvpFalBillingEvent,
  fetchMvpFalQueueResult,
  submitMvpFalProvider,
  type MvpFalBillingEvent,
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

type DispatchBillingIdentity = Readonly<{
  dispatched_at: string;
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

async function dispatchBillingIdentity(input: {
  externalRequestId: string;
  providerDispatchId: string;
}): Promise<DispatchBillingIdentity> {
  const { data, error } = await createAdminSupabaseClient()
    .from("mvp_media_dispatch_worker")
    .select("dispatched_at")
    .eq("id", input.providerDispatchId)
    .eq("external_request_id", input.externalRequestId)
    .maybeSingle();
  if (
    error ||
    !data ||
    typeof data.dispatched_at !== "string" ||
    data.dispatched_at.length > 64 ||
    !Number.isFinite(Date.parse(data.dispatched_at))
  ) {
    throw new MvpMediaDispatchError(
      "The provider dispatch billing identity is unavailable.",
      "PRODUCTION_LEDGER_FAILED",
      false,
    );
  }
  return Object.freeze({ dispatched_at: new Date(data.dispatched_at).toISOString() });
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
const BILLING_EVENT_ATTEMPTS = 4;
const BILLING_EVENT_BACKOFF_MS = [250, 750, 2_000] as const;

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
  billingEvent: MvpFalBillingEvent;
  externalRequestId: string;
  outputContentSha256: string;
  providerDispatchId: string;
  providerReportedBillableUnits: number;
  providerUsageEvidenceSha256: string;
}): Promise<void> {
  await rpc("command_complete_mvp_media_dispatch_output", {
    p_dispatch_id: input.providerDispatchId,
    p_billing_event_cost_nano_usd: input.billingEvent.costEstimateNanoUsd,
    p_billing_event_endpoint_id: input.billingEvent.endpointId,
    p_billing_event_evidence_sha256: input.billingEvent.evidenceSha256,
    p_billing_event_output_units: input.billingEvent.outputUnits,
    p_billing_event_percent_discount: input.billingEvent.percentDiscount,
    p_billing_event_timestamp: input.billingEvent.timestamp,
    p_billing_event_unit_price_usd: input.billingEvent.unitPriceUsd,
    p_external_request_id: input.externalRequestId,
    p_output_content_sha256: input.outputContentSha256,
    p_provider_reported_billable_units: input.providerReportedBillableUnits,
    p_provider_usage_evidence_sha256: input.providerUsageEvidenceSha256,
  });
}

export async function fetchMvpFalBilledResultForDispatch(input: {
  externalRequestId: string;
  providerDispatchId: string;
  responseUrl: string;
  timeoutMs: number;
}): Promise<MvpFalBilledResult & Readonly<{ billingEvent: MvpFalBillingEvent }>> {
  try {
    const billingIdentity = await dispatchBillingIdentity(input);
    const result = await fetchMvpFalQueueResult(input.responseUrl, input.timeoutMs);
    let billingEvent: MvpFalBillingEvent | null = null;
    let pendingError: MvpMediaProviderBrokerError | null = null;
    for (let attempt = 1; attempt <= BILLING_EVENT_ATTEMPTS; attempt += 1) {
      try {
        billingEvent = await fetchMvpFalBillingEvent(
          input.externalRequestId,
          billingIdentity.dispatched_at,
          input.timeoutMs,
        );
        break;
      } catch (caught) {
        if (
          !(caught instanceof MvpMediaProviderBrokerError) ||
          caught.safeCode !== "PROVIDER_BILLING_EVENT_PENDING"
        ) {
          throw caught;
        }
        pendingError = caught;
        if (attempt < BILLING_EVENT_ATTEMPTS) {
          await delay(BILLING_EVENT_BACKOFF_MS[attempt - 1]);
        }
      }
    }
    if (!billingEvent) {
      throw (
        pendingError ??
        new MvpMediaProviderBrokerError(
          "The provider billing event is not available yet.",
          "unknown",
          "PROVIDER_BILLING_EVENT_PENDING",
        )
      );
    }
    if (
      result.providerReportedBillableUnits !== null &&
      Math.abs(billingEvent.outputUnits - result.providerReportedBillableUnits) >
        0.000_001
    ) {
      throw new MvpMediaProviderBrokerError(
        "The provider billing event conflicts with its result receipt.",
        "terminal",
        "PROVIDER_BILLING_UNRECONCILED",
      );
    }
    const providerReportedBillableUnits = billingEvent.outputUnits;
    const providerUsageEvidenceSha256 =
      result.providerUsageEvidenceSha256 ??
      createHash("sha256")
        .update(
          JSON.stringify({
            billingEventEvidenceSha256: billingEvent.evidenceSha256,
            outputUnits: providerReportedBillableUnits,
            responseUrl: input.responseUrl,
            source: "fal-request-billing-event",
          }),
          "utf8",
        )
        .digest("hex");
    return Object.freeze({
      billingEvent,
      data: result.data,
      providerReportedBillableUnits,
      providerUsageEvidenceSha256,
    });
  } catch (caught) {
    if (
      caught instanceof MvpMediaProviderBrokerError &&
      ["PROVIDER_BILLING_UNRECONCILED", "PROVIDER_BILLING_EVENT_PENDING"].includes(
        caught.safeCode,
      )
    ) {
      await rpc("command_record_mvp_media_billing_unreconciled", {
        p_dispatch_id: input.providerDispatchId,
        p_error_summary: caught.message.slice(0, 500),
        p_external_request_id: input.externalRequestId,
      });
      throw new MvpMediaDispatchError(caught.message, caught.safeCode, true);
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

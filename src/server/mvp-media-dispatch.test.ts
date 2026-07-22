import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  admin: vi.fn(),
  billingEvent: vi.fn(),
  eq: vi.fn(),
  from: vi.fn(),
  maybeSingle: vi.fn(),
  rpc: vi.fn(),
  result: vi.fn(),
  select: vi.fn(),
  submit: vi.fn(),
}));

const billingQuery = {
  eq: mocks.eq,
  maybeSingle: mocks.maybeSingle,
  select: mocks.select,
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: mocks.admin,
}));
vi.mock("@/server/mvp-media-provider-broker", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/server/mvp-media-provider-broker")>();
  return {
    ...original,
    fetchMvpFalBillingEvent: mocks.billingEvent,
    fetchMvpFalQueueResult: mocks.result,
    submitMvpFalProvider: mocks.submit,
  };
});

import {
  completeMvpMediaDispatchOutput,
  dispatchMvpFalMedia,
  fetchMvpFalBilledResultForDispatch,
  MvpMediaDispatchError,
  reconcileMvpMediaDispatchWebhook,
} from "./mvp-media-dispatch";
import { MvpMediaProviderBrokerError } from "./mvp-media-provider-broker";

const ids = {
  dispatch: "10000000-0000-4000-8000-000000000001",
  episode: "10000000-0000-4000-8000-000000000002",
  run: "10000000-0000-4000-8000-000000000003",
  workspace: "10000000-0000-4000-8000-000000000004",
} as const;

const input = {
  attemptNumber: 1,
  dispatchKey: "storyboard:1:single",
  endpoint: "fal-ai/nano-banana-2/edit",
  episodeId: ids.episode,
  expectedCostMicrousd: 25_000,
  inputManifestSha256: "a".repeat(64),
  maximumCostMicrousd: 50_000,
  mediaKind: "storyboard" as const,
  payload: { prompt: "A respectful devotional frame." },
  productionRunId: ids.run,
  shotNumber: 1,
  workspaceId: ids.workspace,
};

const control = {
  externalRequestId: "request_123456",
  responseUrl:
    "https://queue.fal.run/fal-ai/nano-banana-2/requests/request_123456/response",
  statusUrl:
    "https://queue.fal.run/fal-ai/nano-banana-2/requests/request_123456/status",
} as const;
const callbackToken = "A".repeat(43);
const billingEvent = {
  costEstimateNanoUsd: 122_000_000,
  endpointId: input.endpoint,
  evidenceSha256: "d".repeat(64),
  outputUnits: 1.525,
  percentDiscount: null,
  timestamp: "2026-07-22T12:00:00.000Z",
  unitPriceUsd: 0.08,
} as const;

function dispatchRow(
  state:
    | "reserved"
    | "dispatching"
    | "submitted"
    | "succeeded"
    | "outcome_unknown"
    | "failed",
  overrides: Record<string, unknown> = {},
) {
  return {
    callback_token_sha256: null,
    claim_token: state === "dispatching" ? "claim-token" : null,
    external_request_id: state === "submitted" ? control.externalRequestId : null,
    fencing_token: 11,
    id: ids.dispatch,
    response_url: state === "submitted" ? control.responseUrl : null,
    state,
    status_url: state === "submitted" ? control.statusUrl : null,
    version: state === "reserved" ? 3 : 4,
    ...overrides,
  };
}

describe("durable MVP media dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.admin.mockReturnValue({ from: mocks.from, rpc: mocks.rpc });
    mocks.from.mockReturnValue(billingQuery);
    mocks.select.mockReturnValue(billingQuery);
    mocks.eq.mockReturnValue(billingQuery);
    mocks.maybeSingle.mockResolvedValue({
      data: { dispatched_at: "2026-07-20T12:05:00.000Z" },
      error: null,
    });
    mocks.billingEvent.mockResolvedValue(billingEvent);
  });

  it("durably reserves and claims the dispatch before the provider network call", async () => {
    const events: string[] = [];
    mocks.rpc.mockImplementation(
      async (name: string, parameters: Record<string, unknown>) => {
        events.push(`rpc:${name}`);
        if (name === "command_reserve_mvp_media_dispatch") {
          return { data: dispatchRow("reserved"), error: null };
        }
        if (name === "command_claim_mvp_media_dispatch") {
          return { data: dispatchRow("dispatching"), error: null };
        }
        if (name === "command_bind_mvp_media_dispatch_callback") {
          return {
            data: dispatchRow("dispatching", {
              callback_token_sha256: parameters.p_callback_token_sha256,
            }),
            error: null,
          };
        }
        if (name === "command_record_mvp_media_dispatch_submission") {
          return { data: dispatchRow("submitted"), error: null };
        }
        throw new Error(`Unexpected test RPC ${name}`);
      },
    );
    mocks.submit.mockImplementation(async () => {
      events.push("network:submit");
      return control;
    });

    await expect(dispatchMvpFalMedia(input)).resolves.toEqual({
      ...control,
      providerDispatchId: ids.dispatch,
    });
    expect(events).toEqual([
      "rpc:command_reserve_mvp_media_dispatch",
      "rpc:command_claim_mvp_media_dispatch",
      "rpc:command_bind_mvp_media_dispatch_callback",
      "network:submit",
      "rpc:command_record_mvp_media_dispatch_submission",
    ]);
    expect(mocks.submit).toHaveBeenCalledWith(
      input.endpoint,
      input.payload,
      ids.dispatch,
      expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u),
    );
  });

  it("replays a submitted dispatch without claiming or calling the provider", async () => {
    mocks.rpc.mockResolvedValue({ data: dispatchRow("submitted"), error: null });

    await expect(dispatchMvpFalMedia(input)).resolves.toEqual({
      ...control,
      providerDispatchId: ids.dispatch,
    });
    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith(
      "command_reserve_mvp_media_dispatch",
      expect.any(Object),
    );
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("records a verified provider callback against the reserved dispatch id", async () => {
    mocks.rpc.mockResolvedValue({ data: dispatchRow("submitted"), error: null });

    await expect(
      reconcileMvpMediaDispatchWebhook({
        callbackToken,
        externalRequestId: control.externalRequestId,
        providerDispatchId: ids.dispatch,
      }),
    ).resolves.toBeUndefined();
    expect(mocks.rpc).toHaveBeenCalledWith(
      "command_reconcile_mvp_media_dispatch_webhook",
      {
        p_callback_token: callbackToken,
        p_dispatch_id: ids.dispatch,
        p_external_request_id: control.externalRequestId,
      },
    );
  });

  it("returns exact billed output evidence without an extra ledger transition", async () => {
    const result = {
      data: { images: [] },
      providerReportedBillableUnits: 1.525,
      providerUsageEvidenceSha256: "b".repeat(64),
    };
    mocks.result.mockResolvedValue(result);

    await expect(
      fetchMvpFalBilledResultForDispatch({
        externalRequestId: control.externalRequestId,
        providerDispatchId: ids.dispatch,
        responseUrl: control.responseUrl,
        timeoutMs: 5_000,
      }),
    ).resolves.toEqual({ ...result, billingEvent });
    expect(mocks.from).toHaveBeenCalledWith("mvp_media_dispatch_worker");
    expect(mocks.billingEvent).toHaveBeenCalledWith(
      control.externalRequestId,
      "2026-07-20T12:05:00.000Z",
      5_000,
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("fails closed when the persisted dispatch timestamp is unavailable", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });

    await expect(
      fetchMvpFalBilledResultForDispatch({
        externalRequestId: control.externalRequestId,
        providerDispatchId: ids.dispatch,
        responseUrl: control.responseUrl,
        timeoutMs: 5_000,
      }),
    ).rejects.toMatchObject({
      retryable: false,
      safeCode: "PRODUCTION_LEDGER_FAILED",
    });
    expect(mocks.result).not.toHaveBeenCalled();
    expect(mocks.billingEvent).not.toHaveBeenCalled();
  });

  it("records provider-reported usage and names the locked-rate result as evidence", async () => {
    mocks.rpc.mockResolvedValue({ data: dispatchRow("succeeded"), error: null });

    await completeMvpMediaDispatchOutput({
      billingEvent,
      externalRequestId: control.externalRequestId,
      outputContentSha256: "c".repeat(64),
      providerDispatchId: ids.dispatch,
      providerReportedBillableUnits: 1.525,
      providerUsageEvidenceSha256: "b".repeat(64),
    });

    expect(mocks.rpc).toHaveBeenCalledWith(
      "command_complete_mvp_media_dispatch_output",
      {
        p_billing_event_cost_nano_usd: billingEvent.costEstimateNanoUsd,
        p_billing_event_endpoint_id: billingEvent.endpointId,
        p_billing_event_evidence_sha256: billingEvent.evidenceSha256,
        p_billing_event_output_units: billingEvent.outputUnits,
        p_billing_event_percent_discount: billingEvent.percentDiscount,
        p_billing_event_timestamp: billingEvent.timestamp,
        p_billing_event_unit_price_usd: billingEvent.unitPriceUsd,
        p_dispatch_id: ids.dispatch,
        p_external_request_id: control.externalRequestId,
        p_output_content_sha256: "c".repeat(64),
        p_provider_reported_billable_units: 1.525,
        p_provider_usage_evidence_sha256: "b".repeat(64),
      },
    );
  });

  it("records missing provider billing evidence as unreconciled, never zero", async () => {
    mocks.result.mockRejectedValue(
      new MvpMediaProviderBrokerError(
        "The provider result is missing exact billing evidence.",
        "terminal",
        "PROVIDER_BILLING_UNRECONCILED",
      ),
    );
    mocks.rpc.mockResolvedValue({ data: dispatchRow("submitted"), error: null });

    await expect(
      fetchMvpFalBilledResultForDispatch({
        externalRequestId: control.externalRequestId,
        providerDispatchId: ids.dispatch,
        responseUrl: control.responseUrl,
        timeoutMs: 5_000,
      }),
    ).rejects.toMatchObject({
      retryable: true,
      safeCode: "PROVIDER_BILLING_UNRECONCILED",
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "command_record_mvp_media_billing_unreconciled",
      expect.objectContaining({
        p_dispatch_id: ids.dispatch,
        p_external_request_id: control.externalRequestId,
      }),
    );
  });

  it("reconciles a known provider receipt after its initial ledger write fails", async () => {
    let reconcileAttempts = 0;
    mocks.rpc.mockImplementation(
      async (name: string, parameters: Record<string, unknown>) => {
        if (name === "command_reserve_mvp_media_dispatch") {
          return { data: dispatchRow("reserved"), error: null };
        }
        if (name === "command_claim_mvp_media_dispatch") {
          return { data: dispatchRow("dispatching"), error: null };
        }
        if (name === "command_bind_mvp_media_dispatch_callback") {
          return {
            data: dispatchRow("dispatching", {
              callback_token_sha256: parameters.p_callback_token_sha256,
            }),
            error: null,
          };
        }
        if (name === "command_record_mvp_media_dispatch_submission") {
          return { data: null, error: { message: "commit acknowledgement lost" } };
        }
        if (name === "command_reconcile_mvp_media_dispatch_submission") {
          reconcileAttempts += 1;
          return reconcileAttempts === 1
            ? { data: null, error: { message: "temporary ledger outage" } }
            : { data: dispatchRow("submitted"), error: null };
        }
        throw new Error(`Unexpected test RPC ${name}`);
      },
    );
    mocks.submit.mockResolvedValue(control);

    await expect(dispatchMvpFalMedia(input)).resolves.toEqual({
      ...control,
      providerDispatchId: ids.dispatch,
    });
    expect(mocks.submit).toHaveBeenCalledOnce();
    expect(reconcileAttempts).toBe(2);
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      "command_fail_mvp_media_dispatch",
      expect.anything(),
    );
  });

  it("returns a committed receipt through reconciliation when its acknowledgement was lost", async () => {
    mocks.rpc.mockImplementation(
      async (name: string, parameters: Record<string, unknown>) => {
        if (name === "command_reserve_mvp_media_dispatch") {
          return { data: dispatchRow("reserved"), error: null };
        }
        if (name === "command_claim_mvp_media_dispatch") {
          return { data: dispatchRow("dispatching"), error: null };
        }
        if (name === "command_bind_mvp_media_dispatch_callback") {
          return {
            data: dispatchRow("dispatching", {
              callback_token_sha256: parameters.p_callback_token_sha256,
            }),
            error: null,
          };
        }
        if (name === "command_record_mvp_media_dispatch_submission") {
          return { data: null, error: { message: "commit acknowledgement lost" } };
        }
        if (name === "command_reconcile_mvp_media_dispatch_submission") {
          return { data: dispatchRow("submitted"), error: null };
        }
        throw new Error(`Unexpected test RPC ${name}`);
      },
    );
    mocks.submit.mockResolvedValue(control);

    await expect(dispatchMvpFalMedia(input)).resolves.toEqual({
      ...control,
      providerDispatchId: ids.dispatch,
    });
    expect(mocks.submit).toHaveBeenCalledOnce();
  });

  it("keeps a known receipt pending after bounded reconciliation without failing the slot", async () => {
    let reserveCalls = 0;
    mocks.rpc.mockImplementation(
      async (name: string, parameters: Record<string, unknown>) => {
        if (name === "command_reserve_mvp_media_dispatch") {
          reserveCalls += 1;
          return {
            data: dispatchRow(reserveCalls === 1 ? "reserved" : "outcome_unknown"),
            error: null,
          };
        }
        if (name === "command_claim_mvp_media_dispatch") {
          return { data: dispatchRow("dispatching"), error: null };
        }
        if (name === "command_bind_mvp_media_dispatch_callback") {
          return {
            data: dispatchRow("dispatching", {
              callback_token_sha256: parameters.p_callback_token_sha256,
            }),
            error: null,
          };
        }
        if (
          name === "command_record_mvp_media_dispatch_submission" ||
          name === "command_reconcile_mvp_media_dispatch_submission"
        ) {
          return { data: null, error: { message: "ledger unavailable" } };
        }
        throw new Error(`Unexpected test RPC ${name}`);
      },
    );
    mocks.submit.mockResolvedValue(control);

    await expect(dispatchMvpFalMedia(input)).rejects.toMatchObject({
      retryable: true,
      safeCode: "PROVIDER_RECEIPT_RECONCILIATION_PENDING",
    } satisfies Partial<MvpMediaDispatchError>);
    await expect(dispatchMvpFalMedia(input)).rejects.toMatchObject({
      retryable: false,
      safeCode: "PROVIDER_OUTCOME_UNKNOWN",
    } satisfies Partial<MvpMediaDispatchError>);
    expect(mocks.submit).toHaveBeenCalledOnce();
    expect(
      mocks.rpc.mock.calls.filter(
        ([name]) => name === "command_reconcile_mvp_media_dispatch_submission",
      ),
    ).toHaveLength(3);
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      "command_fail_mvp_media_dispatch",
      expect.anything(),
    );
  });

  it.each([
    {
      broker: new MvpMediaProviderBrokerError(
        "The provider rejected the media request.",
        "terminal",
        "PROVIDER_SUBMISSION_REJECTED",
      ),
      outcomeUnknown: false,
      safeCode: "PROVIDER_SUBMISSION_REJECTED",
    },
    {
      broker: new MvpMediaProviderBrokerError(
        "The provider submission outcome is unknown.",
        "unknown",
        "PROVIDER_OUTCOME_UNKNOWN",
      ),
      outcomeUnknown: true,
      safeCode: "PROVIDER_OUTCOME_UNKNOWN",
    },
  ])(
    "records the provider $safeCode transition without retrying in-process",
    async ({ broker, outcomeUnknown, safeCode }) => {
      mocks.rpc.mockImplementation(
        async (name: string, parameters: Record<string, unknown>) => {
          if (name === "command_reserve_mvp_media_dispatch") {
            return { data: dispatchRow("reserved"), error: null };
          }
          if (name === "command_claim_mvp_media_dispatch") {
            return { data: dispatchRow("dispatching"), error: null };
          }
          if (name === "command_bind_mvp_media_dispatch_callback") {
            return {
              data: dispatchRow("dispatching", {
                callback_token_sha256: parameters.p_callback_token_sha256,
              }),
              error: null,
            };
          }
          if (name === "command_fail_mvp_media_dispatch") {
            return {
              data: dispatchRow(outcomeUnknown ? "outcome_unknown" : "failed"),
              error: null,
            };
          }
          throw new Error(`Unexpected test RPC ${name}`);
        },
      );
      mocks.submit.mockRejectedValue(broker);

      await expect(dispatchMvpFalMedia(input)).rejects.toMatchObject({
        retryable: false,
        safeCode,
      } satisfies Partial<MvpMediaDispatchError>);
      expect(mocks.submit).toHaveBeenCalledOnce();
      expect(mocks.rpc).toHaveBeenCalledWith(
        "command_fail_mvp_media_dispatch",
        expect.objectContaining({
          p_error_code: safeCode,
          p_outcome_unknown: outcomeUnknown,
        }),
      );
    },
  );
});

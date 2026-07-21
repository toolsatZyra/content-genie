import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  admin: vi.fn(),
  rpc: vi.fn(),
  submit: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: mocks.admin,
}));
vi.mock("@/server/mvp-media-provider-broker", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/server/mvp-media-provider-broker")>();
  return { ...original, submitMvpFalProvider: mocks.submit };
});

import { dispatchMvpFalMedia, MvpMediaDispatchError } from "./mvp-media-dispatch";
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

function dispatchRow(
  state: "reserved" | "dispatching" | "submitted" | "outcome_unknown" | "failed",
  overrides: Record<string, unknown> = {},
) {
  return {
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
    mocks.admin.mockReturnValue({ rpc: mocks.rpc });
  });

  it("durably reserves and claims the dispatch before the provider network call", async () => {
    const events: string[] = [];
    mocks.rpc.mockImplementation(async (name: string) => {
      events.push(`rpc:${name}`);
      if (name === "command_reserve_mvp_media_dispatch") {
        return { data: dispatchRow("reserved"), error: null };
      }
      if (name === "command_claim_mvp_media_dispatch") {
        return { data: dispatchRow("dispatching"), error: null };
      }
      if (name === "command_record_mvp_media_dispatch_submission") {
        return { data: dispatchRow("submitted"), error: null };
      }
      throw new Error(`Unexpected test RPC ${name}`);
    });
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
      "network:submit",
      "rpc:command_record_mvp_media_dispatch_submission",
    ]);
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

  it("does not duplicate a provider submit after receipt-persistence ambiguity", async () => {
    let reserveState: "reserved" | "outcome_unknown" = "reserved";
    mocks.rpc.mockImplementation(async (name: string, parameters: unknown) => {
      void parameters;
      if (name === "command_reserve_mvp_media_dispatch") {
        return { data: dispatchRow(reserveState), error: null };
      }
      if (name === "command_claim_mvp_media_dispatch") {
        return { data: dispatchRow("dispatching"), error: null };
      }
      if (name === "command_record_mvp_media_dispatch_submission") {
        return { data: null, error: { message: "commit acknowledgement lost" } };
      }
      if (name === "command_fail_mvp_media_dispatch") {
        reserveState = "outcome_unknown";
        return { data: dispatchRow("outcome_unknown"), error: null };
      }
      throw new Error(`Unexpected test RPC ${name}`);
    });
    mocks.submit.mockResolvedValue(control);

    await expect(dispatchMvpFalMedia(input)).rejects.toMatchObject({
      safeCode: "PRODUCTION_LEDGER_FAILED",
    });
    await expect(dispatchMvpFalMedia(input)).rejects.toMatchObject({
      safeCode: "PROVIDER_OUTCOME_UNKNOWN",
    });
    expect(mocks.submit).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith(
      "command_fail_mvp_media_dispatch",
      expect.objectContaining({ p_outcome_unknown: true }),
    );
  });

  it("replays a committed receipt when only its persistence acknowledgement was lost", async () => {
    let reserveState: "reserved" | "submitted" = "reserved";
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "command_reserve_mvp_media_dispatch") {
        return { data: dispatchRow(reserveState), error: null };
      }
      if (name === "command_claim_mvp_media_dispatch") {
        return { data: dispatchRow("dispatching"), error: null };
      }
      if (name === "command_record_mvp_media_dispatch_submission") {
        reserveState = "submitted";
        return { data: null, error: { message: "commit acknowledgement lost" } };
      }
      if (name === "command_fail_mvp_media_dispatch") {
        return { data: null, error: { message: "stale fencing token" } };
      }
      throw new Error(`Unexpected test RPC ${name}`);
    });
    mocks.submit.mockResolvedValue(control);

    await expect(dispatchMvpFalMedia(input)).rejects.toMatchObject({
      safeCode: "PRODUCTION_LEDGER_FAILED",
    });
    await expect(dispatchMvpFalMedia(input)).resolves.toEqual({
      ...control,
      providerDispatchId: ids.dispatch,
    });
    expect(mocks.submit).toHaveBeenCalledOnce();
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
      mocks.rpc.mockImplementation(async (name: string) => {
        if (name === "command_reserve_mvp_media_dispatch") {
          return { data: dispatchRow("reserved"), error: null };
        }
        if (name === "command_claim_mvp_media_dispatch") {
          return { data: dispatchRow("dispatching"), error: null };
        }
        if (name === "command_fail_mvp_media_dispatch") {
          return {
            data: dispatchRow(outcomeUnknown ? "outcome_unknown" : "failed"),
            error: null,
          };
        }
        throw new Error(`Unexpected test RPC ${name}`);
      });
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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ rpc: mocks.rpc })),
}));

import {
  claimLiveBrokerRequest,
  LiveBrokerLedgerError,
  reconcileLiveBrokerCancellation,
  recordLiveBrokerState,
} from "@/server/live-broker-ledger";

const sandboxName = `genie-live-${"a".repeat(24)}`;
const candidate = { commit: "b".repeat(40), tree: "c".repeat(40) };
const validLifecycle = {
  aggregateVersion: 1,
  cancelRequested: false,
  createInFlight: true,
  createLeaseExpiresAt: "2026-07-18T12:00:00.000Z",
  sandboxName,
  sandboxSessionId: null,
  state: "creating",
};

describe("the live broker durable ledger adapter", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://production.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "server-only-authority";
    mocks.rpc.mockResolvedValue({ data: validLifecycle, error: null });
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it("passes the consumed nonce, body digest, candidate, and deployment pin", async () => {
    const command = {
      action: "status" as const,
      candidate,
      sandboxName,
      schemaVersion: "genie-live-broker-request.v1" as const,
    };
    await expect(
      claimLiveBrokerRequest({
        bodySha256: "d".repeat(64),
        brokerDeploymentCommit: "e".repeat(40),
        command,
        issuedAt: "1784361600000",
        nonce: "12345678-1234-4123-8123-123456789abc",
        signerId: "genie-ci-ed25519-v1",
      }),
    ).resolves.toEqual(validLifecycle);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "command_claim_live_broker_request",
      expect.objectContaining({
        p_body_sha256: "d".repeat(64),
        p_broker_deployment_commit: "e".repeat(40),
        p_candidate_commit: candidate.commit,
        p_nonce: "12345678-1234-4123-8123-123456789abc",
      }),
    );
  });

  it("maps durable replay and rate-limit failures to a conflict", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: "23505" },
    });
    await expect(
      recordLiveBrokerState(
        {
          action: "stop",
          candidate,
          sandboxName,
          schemaVersion: "genie-live-broker-request.v1",
        },
        "deleted",
        "e".repeat(40),
      ),
    ).rejects.toMatchObject({
      conflict: true,
    } satisfies Partial<LiveBrokerLedgerError>);
  });

  it("reconciles an expired cancellation lease through the service-only RPC", async () => {
    const command = {
      action: "stop" as const,
      candidate,
      sandboxName,
      schemaVersion: "genie-live-broker-request.v1" as const,
    };
    await expect(
      reconcileLiveBrokerCancellation(command, "e".repeat(40)),
    ).resolves.toEqual(validLifecycle);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "command_reconcile_live_broker_cancellation",
      {
        p_broker_deployment_commit: "e".repeat(40),
        p_candidate_commit: candidate.commit,
        p_candidate_tree: candidate.tree,
        p_sandbox_name: sandboxName,
      },
    );
  });

  it("rejects malformed lifecycle state even when the RPC reports success", async () => {
    mocks.rpc.mockResolvedValue({
      data: { ...validLifecycle, extra: true },
      error: null,
    });
    await expect(
      recordLiveBrokerState(
        {
          action: "stop",
          candidate,
          sandboxName,
          schemaVersion: "genie-live-broker-request.v1",
        },
        "deleted",
        "e".repeat(40),
      ),
    ).rejects.toThrow(/invalid state/);
  });
});

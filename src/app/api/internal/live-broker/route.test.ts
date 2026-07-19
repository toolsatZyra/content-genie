import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  claim: vi.fn(),
  parse: vi.fn(),
  reconcile: vi.fn(),
  recordCreated: vi.fn(),
  recordState: vi.fn(),
  signEvidence: vi.fn(),
  start: vi.fn(),
  status: vi.fn(),
  stop: vi.fn(),
}));

vi.mock("@/server/live-broker-contract", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/server/live-broker-contract")>();
  return {
    ...original,
    authenticateLiveBrokerRequest: mocks.authenticate,
    parseLiveBrokerRequest: mocks.parse,
  };
});

vi.mock("@/server/live-sandbox-control", () => ({
  startLiveSandbox: mocks.start,
  statusLiveSandbox: mocks.status,
  stopLiveSandbox: mocks.stop,
}));

vi.mock("@/server/live-broker-ledger", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/live-broker-ledger")>();
  return {
    ...original,
    claimLiveBrokerRequest: mocks.claim,
    reconcileLiveBrokerCancellation: mocks.reconcile,
    recordLiveBrokerCreated: mocks.recordCreated,
    recordLiveBrokerState: mocks.recordState,
  };
});

vi.mock("@/server/live-broker-evidence", () => ({
  signLiveBrokerEvidence: mocks.signEvidence,
}));

import { POST } from "@/app/api/internal/live-broker/route";
import {
  LIVE_BROKER_MAX_BODY_BYTES,
  LiveBrokerRequestError,
} from "@/server/live-broker-contract";
import { LiveBrokerLedgerError } from "@/server/live-broker-ledger";

const deploymentCommit = "a".repeat(40);
const sandboxName = `genie-live-${"b".repeat(24)}`;
const candidate = { commit: deploymentCommit, tree: "d".repeat(40) };
const startCommand = {
  action: "start" as const,
  branch: {},
  candidate,
  productionRef: "e".repeat(20),
  sandboxName,
  schemaVersion: "genie-live-broker-request.v1" as const,
};
const lifecycle = {
  aggregateVersion: 1,
  cancelRequested: false,
  createInFlight: true,
  createLeaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  sandboxName,
  sandboxSessionId: null,
  state: "creating",
};
const brokerEvidence = {
  algorithm: "Ed25519",
  keyId: "genie-live-evidence-ed25519-v1",
  payload: {},
  schemaVersion: "genie-live-broker-evidence-envelope.v1",
  signatureBase64: "signed",
};
const request = () =>
  new Request("https://content-genie-three.vercel.app/api/internal/live-broker", {
    body: "signed-body",
    method: "POST",
  });

function streamedRequest(chunks: Uint8Array[], contentLength?: string) {
  const read = vi.fn();
  for (const chunk of chunks) {
    read.mockResolvedValueOnce({ done: false, value: chunk });
  }
  read.mockResolvedValue({ done: true, value: undefined });
  const cancel = vi.fn().mockResolvedValue(undefined);
  const releaseLock = vi.fn();
  const getReader = vi.fn(() => ({ cancel, read, releaseLock }));
  const headers = new Headers();
  if (contentLength !== undefined) headers.set("content-length", contentLength);
  return {
    cancel,
    getReader,
    read,
    releaseLock,
    request: { body: { getReader }, headers } as unknown as Request,
  };
}

describe("internal live broker route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.VERCEL_ENV = "production";
    process.env.VERCEL_GIT_COMMIT_SHA = deploymentCommit;
    mocks.authenticate.mockReturnValue({
      issuedAt: "1784361600000",
      nonce: "12345678-1234-4123-8123-123456789abc",
      signerId: "genie-ci-ed25519-v1",
    });
    mocks.claim.mockResolvedValue(lifecycle);
    mocks.recordCreated.mockResolvedValue({
      ...lifecycle,
      createInFlight: false,
      sandboxSessionId: "session_12345678",
      state: "running",
    });
    mocks.reconcile.mockResolvedValue({
      ...lifecycle,
      cancelRequested: true,
      createInFlight: false,
      state: "cancel_requested",
    });
    mocks.recordState.mockResolvedValue({
      ...lifecycle,
      cancelRequested: true,
      createInFlight: false,
      state: "deleted",
    });
    mocks.stop.mockResolvedValue({
      absenceSnapshots: 3,
      deleted: true,
      sandboxName,
    });
    mocks.signEvidence.mockReturnValue(brokerEvidence);
  });

  afterEach(() => {
    delete process.env.VERCEL_ENV;
    delete process.env.VERCEL_GIT_COMMIT_SHA;
  });

  it("authenticates the exact raw body before dispatching start", async () => {
    mocks.parse.mockReturnValue(startCommand);
    mocks.start.mockResolvedValue({
      sandboxName,
      sandboxSessionId: "session_12345678",
    });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    await expect(response.json()).resolves.toEqual({
      brokerDeploymentCommit: deploymentCommit,
      brokerEvidence,
      ok: true,
      result: { sandboxName, sandboxSessionId: "session_12345678" },
    });
    expect(mocks.authenticate).toHaveBeenCalledWith(expect.any(Headers), "signed-body");
    expect(mocks.parse).toHaveBeenCalledWith("signed-body");
    expect(mocks.authenticate.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.parse.mock.invocationCallOrder[0]!,
    );
    expect(mocks.claim).toHaveBeenCalledWith(
      expect.objectContaining({
        brokerDeploymentCommit: deploymentCommit,
        command: startCommand,
        signerId: "genie-ci-ed25519-v1",
      }),
    );
    expect(mocks.start).toHaveBeenCalledWith(startCommand);
    expect(mocks.recordCreated).toHaveBeenCalledWith(
      startCommand,
      "session_12345678",
      deploymentCommit,
    );
    expect(mocks.signEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "start",
        brokerDeploymentCommit: deploymentCommit,
        rawBody: "signed-body",
      }),
    );
  });

  it("rejects an oversized declared length before accessing the body stream", async () => {
    const getReader = vi.fn();
    const oversized = {
      body: { getReader },
      headers: new Headers({
        "content-length": String(LIVE_BROKER_MAX_BODY_BYTES + 1),
      }),
    } as unknown as Request;

    const response = await POST(oversized);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "BROKER_REQUEST_INVALID",
      ok: false,
    });
    expect(getReader).not.toHaveBeenCalled();
    expect(mocks.authenticate).not.toHaveBeenCalled();
    expect(mocks.parse).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("cancels a chunked request as soon as its streamed bytes exceed the cap", async () => {
    const streamed = streamedRequest([
      new Uint8Array(LIVE_BROKER_MAX_BODY_BYTES),
      new Uint8Array(1),
      new Uint8Array(1),
    ]);

    const response = await POST(streamed.request);

    expect(response.status).toBe(400);
    expect(streamed.read).toHaveBeenCalledTimes(2);
    expect(streamed.cancel).toHaveBeenCalledTimes(1);
    expect(streamed.releaseLock).toHaveBeenCalledTimes(1);
    expect(mocks.authenticate).not.toHaveBeenCalled();
    expect(mocks.parse).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("cancels a body that exceeds its smaller declared length", async () => {
    const streamed = streamedRequest([new Uint8Array([0x61, 0x62])], "1");

    const response = await POST(streamed.request);

    expect(response.status).toBe(400);
    expect(streamed.read).toHaveBeenCalledTimes(1);
    expect(streamed.cancel).toHaveBeenCalledTimes(1);
    expect(mocks.authenticate).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it("rejects truncated declared bodies and invalid UTF-8 before authentication", async () => {
    const truncated = streamedRequest([new Uint8Array([0x61])], "2");
    const truncatedResponse = await POST(truncated.request);
    expect(truncatedResponse.status).toBe(400);
    expect(truncated.read).toHaveBeenCalledTimes(2);
    expect(mocks.authenticate).not.toHaveBeenCalled();

    const invalidUtf8 = streamedRequest([new Uint8Array([0xc3, 0x28])]);
    const invalidResponse = await POST(invalidUtf8.request);
    expect(invalidResponse.status).toBe(400);
    expect(invalidUtf8.read).toHaveBeenCalledTimes(2);
    expect(mocks.authenticate).not.toHaveBeenCalled();
    expect(mocks.parse).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it("preserves the exact valid UTF-8 body across chunk boundaries", async () => {
    const rawBody = "signed-🚀-body";
    const bytes = new TextEncoder().encode(rawBody);
    const streamed = streamedRequest(
      [bytes.slice(0, 8), bytes.slice(8, 10), bytes.slice(10)],
      String(bytes.byteLength),
    );
    mocks.authenticate.mockImplementation((_headers, receivedBody) => {
      expect(receivedBody).toBe(rawBody);
      throw new LiveBrokerRequestError("stop after authentication", 401);
    });

    const response = await POST(streamed.request);

    expect(response.status).toBe(401);
    expect(mocks.authenticate).toHaveBeenCalledWith(expect.any(Headers), rawBody);
    expect(mocks.parse).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it("rejects authentication before any sandbox operation", async () => {
    mocks.authenticate.mockImplementation(() => {
      throw new LiveBrokerRequestError("no", 401);
    });
    const response = await POST(request());
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      code: "BROKER_AUTHENTICATION_FAILED",
      ok: false,
    });
    expect(mocks.parse).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("fails closed outside the production deployment", async () => {
    process.env.VERCEL_ENV = "preview";
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(mocks.authenticate).not.toHaveBeenCalled();
  });

  it("does not return internal sandbox failure text", async () => {
    mocks.parse.mockReturnValue({
      action: "status",
      candidate,
      sandboxName,
      schemaVersion: "genie-live-broker-request.v1",
    });
    mocks.status.mockRejectedValue(new Error("credential-shaped internal detail"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await POST(request());
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("credential-shaped internal detail");
    expect(consoleError).toHaveBeenCalledWith("Live broker failed safely", {
      errorName: "Error",
    });
    consoleError.mockRestore();
  });

  it("returns a conflict before sandbox work when the durable nonce is replayed", async () => {
    mocks.parse.mockReturnValue(startCommand);
    mocks.claim.mockRejectedValue(new LiveBrokerLedgerError("replayed", true));
    const response = await POST(request());
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      code: "BROKER_REPLAY_OR_CONFLICT",
      ok: false,
    });
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("rejects a candidate that is not the reviewed deployment before ledger or sandbox work", async () => {
    mocks.parse.mockReturnValue({
      ...startCommand,
      candidate: { ...candidate, commit: "c".repeat(40) },
    });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("honors a durable stop-before-start tombstone", async () => {
    mocks.parse.mockReturnValue(startCommand);
    mocks.claim.mockResolvedValue({
      ...lifecycle,
      cancelRequested: true,
      createInFlight: false,
      state: "cancel_requested",
    });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("deletes a sandbox when cancellation races with creation", async () => {
    mocks.parse.mockReturnValue(startCommand);
    mocks.start.mockResolvedValue({
      sandboxName,
      sandboxSessionId: "session_12345678",
    });
    mocks.recordCreated.mockResolvedValue({
      ...lifecycle,
      cancelRequested: true,
      createInFlight: true,
      sandboxSessionId: "session_12345678",
      state: "cancel_requested",
    });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(mocks.stop).toHaveBeenCalledTimes(1);
    expect(mocks.recordState).toHaveBeenCalledWith(
      startCommand,
      "deleted",
      deploymentCommit,
    );
  });

  it("records finished status under the exact deployment pin", async () => {
    const statusCommand = {
      action: "status" as const,
      candidate,
      sandboxName,
      schemaVersion: "genie-live-broker-request.v1" as const,
    };
    mocks.parse.mockReturnValue(statusCommand);
    mocks.claim.mockResolvedValue({
      ...lifecycle,
      createInFlight: false,
      state: "running",
    });
    mocks.status.mockResolvedValue({ state: "finished" });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.recordState).toHaveBeenCalledWith(
      statusCommand,
      "finished",
      deploymentCommit,
    );
  });

  it("does not query a sandbox after the durable lifecycle becomes terminal", async () => {
    mocks.parse.mockReturnValue({
      action: "status",
      candidate,
      sandboxName,
      schemaVersion: "genie-live-broker-request.v1",
    });
    mocks.claim.mockResolvedValue({
      ...lifecycle,
      createInFlight: false,
      state: "failed",
    });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(mocks.status).not.toHaveBeenCalled();
  });

  it("records deletion only after a reconciled lifecycle and final absence proof", async () => {
    const stopCommand = {
      action: "stop" as const,
      candidate,
      sandboxName,
      schemaVersion: "genie-live-broker-request.v1" as const,
    };
    mocks.parse.mockReturnValue(stopCommand);
    mocks.claim.mockResolvedValue({
      ...lifecycle,
      cancelRequested: true,
      createInFlight: false,
      state: "cancel_requested",
    });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.stop).toHaveBeenCalledTimes(2);
    expect(mocks.reconcile).toHaveBeenCalledWith(stopCommand, deploymentCommit);
    expect(mocks.recordState).toHaveBeenCalledWith(
      stopCommand,
      "deleted",
      deploymentCommit,
    );
  });

  it("returns signed pending cleanup evidence while an abandoned creator lease is live", async () => {
    const stopCommand = {
      action: "stop" as const,
      candidate,
      sandboxName,
      schemaVersion: "genie-live-broker-request.v1" as const,
    };
    mocks.parse.mockReturnValue(stopCommand);
    mocks.reconcile.mockResolvedValue({
      ...lifecycle,
      cancelRequested: true,
      createInFlight: true,
      createLeaseExpiresAt: new Date(Date.now() + 30_000).toISOString(),
      state: "creating",
    });
    const response = await POST(request());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result).toEqual({
      absenceSnapshots: 3,
      deleted: false,
      retryAfterMs: expect.any(Number),
      sandboxName,
    });
    expect(body.result.retryAfterMs).toBeGreaterThanOrEqual(1_000);
    expect(body.result.retryAfterMs).toBeLessThanOrEqual(60_000);
    expect(mocks.recordState).not.toHaveBeenCalled();
  });
});

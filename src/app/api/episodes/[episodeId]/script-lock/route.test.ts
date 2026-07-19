import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  adminRpc: vi.fn(),
  authenticatedRpc: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ rpc: mocks.adminRpc }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser: mocks.getUser },
    rpc: mocks.authenticatedRpc,
  }),
}));

import { POST } from "./route";

const episodeId = "10000000-0000-4000-8000-000000000110";
const workspaceId = "10000000-0000-4000-8000-000000000101";
const userId = "10000000-0000-4000-8000-000000000102";
const attestationId = "10000000-0000-4000-8000-000000000103";
const maxScriptLockRequestBytes = 400 * 1024;

function request(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(
    `https://genie.example/api/episodes/${episodeId}/script-lock`,
    {
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
        origin: "https://genie.example",
        "x-idempotency-key": "script-lock-test-0001",
        ...headers,
      },
      method: "POST",
    },
  );
}

function rawRequest(body: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(
    `https://genie.example/api/episodes/${episodeId}/script-lock`,
    {
      body,
      headers: {
        "content-type": "application/json",
        origin: "https://genie.example",
        "x-idempotency-key": "script-lock-test-0001",
        ...headers,
      },
      method: "POST",
    },
  );
}

function streamedRequest(chunks: Uint8Array[], headers: Record<string, string> = {}) {
  const read = vi.fn();
  for (const chunk of chunks) {
    read.mockResolvedValueOnce({ done: false, value: chunk });
  }
  read.mockResolvedValue({ done: true, value: undefined });
  const cancel = vi.fn().mockResolvedValue(undefined);
  const releaseLock = vi.fn();
  const getReader = vi.fn(() => ({ cancel, read, releaseLock }));
  return {
    cancel,
    getReader,
    read,
    releaseLock,
    request: {
      body: { getReader },
      headers: new Headers({
        "content-type": "application/json",
        origin: "https://genie.example",
        "x-idempotency-key": "script-lock-test-0001",
        ...headers,
      }),
      nextUrl: new URL(`https://genie.example/api/episodes/${episodeId}/script-lock`),
    } as unknown as NextRequest,
  };
}

const validBody = {
  durationAcknowledged: true,
  episodeId,
  expectedEpisodeVersion: 1,
  rawText: "शिव\r\ne\u0301",
  workspaceId,
};

describe("trusted script-lock route", () => {
  beforeEach(() => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(attestationId);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
  });

  it("rejects non-JSON input before creating any authority", async () => {
    const response = await POST(request(validBody, { "content-type": "text/plain" }), {
      params: Promise.resolve({ episodeId }),
    });

    expect(response.status).toBe(415);
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it("requires an authenticated actor before attestation", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const streamed = streamedRequest([
      new TextEncoder().encode(JSON.stringify(validBody)),
    ]);

    const response = await POST(streamed.request, {
      params: Promise.resolve({ episodeId }),
    });

    expect(response.status).toBe(401);
    expect(streamed.getReader).not.toHaveBeenCalled();
    expect(streamed.read).not.toHaveBeenCalled();
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it("fails closed when service authority cannot attest the exact envelope", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: userId } },
      error: null,
    });
    mocks.adminRpc
      .mockResolvedValueOnce({
        data: null,
        error: { code: "SERVICE_UNAVAILABLE" },
      })
      .mockResolvedValueOnce({ data: true, error: null });

    const response = await POST(request(validBody), {
      params: Promise.resolve({ episodeId }),
    });

    expect(response.status).toBe(503);
    expect(mocks.authenticatedRpc).not.toHaveBeenCalled();
    expect(mocks.adminRpc).toHaveBeenLastCalledWith(
      "revoke_script_coordinate_attestation",
      expect.objectContaining({ p_attestation_id: attestationId }),
    );
  });

  it("binds the trusted one-time attestation to the authenticated command", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: userId } },
      error: null,
    });
    mocks.adminRpc
      .mockResolvedValueOnce({ data: attestationId, error: null })
      .mockResolvedValueOnce({ data: true, error: null });
    mocks.authenticatedRpc.mockResolvedValue({
      data: { aggregateVersion: 2, ok: true },
      error: null,
    });

    const response = await POST(request(validBody), {
      params: Promise.resolve({ episodeId }),
    });

    expect(response.status).toBe(200);
    expect(mocks.adminRpc).toHaveBeenCalledWith(
      "attest_script_coordinate_map",
      expect.objectContaining({
        p_actor_user_id: userId,
        p_attestation_id: attestationId,
        p_episode_id: episodeId,
        p_processing_utf8_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        p_raw_utf8_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        p_runtime_evidence: expect.objectContaining({
          graphemeProbeSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          graphemeSegmenterProfile:
            "unicode-segmenter@0.17.0:Unicode-17.0.0:UAX29-revision-47",
          unicodeVersion: "17.0.0",
        }),
        p_workspace_id: workspaceId,
      }),
    );
    expect(mocks.authenticatedRpc).toHaveBeenCalledWith(
      "command_lock_episode_script",
      expect.objectContaining({
        p_coordinate_attestation_id: attestationId,
        p_episode_id: episodeId,
        p_workspace_id: workspaceId,
      }),
    );
    expect(mocks.adminRpc).toHaveBeenLastCalledWith(
      "revoke_script_coordinate_attestation",
      expect.objectContaining({
        p_actor_user_id: userId,
        p_attestation_id: attestationId,
        p_request_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
  });

  it("maps a compare-and-swap loss to a refreshable conflict", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: userId } },
      error: null,
    });
    mocks.adminRpc
      .mockResolvedValueOnce({ data: attestationId, error: null })
      .mockResolvedValueOnce({ data: true, error: null });
    mocks.authenticatedRpc.mockResolvedValue({
      data: null,
      error: { code: "40001" },
    });

    const response = await POST(request(validBody), {
      params: Promise.resolve({ episodeId }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "SCRIPT_LOCK_REJECTED",
      message: expect.stringContaining("another tab"),
      ok: false,
    });
  });
  it("rejects an untrusted origin before parsing input", async () => {
    const response = await POST(
      request(validBody, { origin: "https://attacker.example" }),
      { params: Promise.resolve({ episodeId }) },
    );
    expect(response.status).toBe(403);
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("rejects declared and actual oversized bodies", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: userId } },
      error: null,
    });
    const declared = await POST(
      request(validBody, { "content-length": String(400 * 1024 + 1) }),
      { params: Promise.resolve({ episodeId }) },
    );
    expect(declared.status).toBe(413);

    const actual = await POST(
      request({ ...validBody, rawText: "a".repeat(400 * 1024) }),
      { params: Promise.resolve({ episodeId }) },
    );
    expect(actual.status).toBe(413);
  });

  it("rejects malformed body headers without reading or authenticating", async () => {
    const streamed = streamedRequest([new Uint8Array()], {
      "content-length": "not-a-number",
    });

    const response = await POST(streamed.request, {
      params: Promise.resolve({ episodeId }),
    });

    expect(response.status).toBe(400);
    expect(streamed.getReader).not.toHaveBeenCalled();
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it("cancels a chunked body when actual bytes exceed the limit", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: userId } },
      error: null,
    });
    const streamed = streamedRequest([
      new Uint8Array(maxScriptLockRequestBytes),
      new Uint8Array(1),
      new Uint8Array(1),
    ]);

    const response = await POST(streamed.request, {
      params: Promise.resolve({ episodeId }),
    });

    expect(response.status).toBe(413);
    expect(streamed.read).toHaveBeenCalledTimes(2);
    expect(streamed.cancel).toHaveBeenCalledTimes(1);
    expect(streamed.releaseLock).toHaveBeenCalledTimes(1);
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it("rejects false lengths and malformed UTF-8 before creating authority", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: userId } },
      error: null,
    });
    const mismatched = streamedRequest([new TextEncoder().encode("{}")], {
      "content-length": "1",
    });
    const mismatchResponse = await POST(mismatched.request, {
      params: Promise.resolve({ episodeId }),
    });
    expect(mismatchResponse.status).toBe(400);

    const malformedUtf8 = streamedRequest([new Uint8Array([0xc3, 0x28])]);
    const utf8Response = await POST(malformedUtf8.request, {
      params: Promise.resolve({ episodeId }),
    });
    expect(utf8Response.status).toBe(400);
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON, route mismatches, and malformed idempotency", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: userId } },
      error: null,
    });
    const invalidJson = await POST(rawRequest("{"), {
      params: Promise.resolve({ episodeId }),
    });
    expect(invalidJson.status).toBe(400);

    const mismatch = await POST(
      request({
        ...validBody,
        episodeId: "20000000-0000-4000-8000-000000000110",
      }),
      { params: Promise.resolve({ episodeId }) },
    );
    expect(mismatch.status).toBe(400);

    const invalidKey = await POST(
      request(validBody, { "x-idempotency-key": "short" }),
      { params: Promise.resolve({ episodeId }) },
    );
    expect(invalidKey.status).toBe(400);
  });

  it("treats an authentication error as unauthenticated", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: userId } },
      error: { code: "AUTH_DOWN" },
    });
    const response = await POST(request(validBody), {
      params: Promise.resolve({ episodeId }),
    });
    expect(response.status).toBe(401);
  });

  it("rejects a malformed attestation identity", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: userId } },
      error: null,
    });
    mocks.adminRpc
      .mockResolvedValueOnce({ data: "not-a-uuid", error: null })
      .mockResolvedValueOnce({ data: true, error: null });
    const response = await POST(request(validBody), {
      params: Promise.resolve({ episodeId }),
    });
    expect(response.status).toBe(503);
    expect(mocks.authenticatedRpc).not.toHaveBeenCalled();
    expect(mocks.adminRpc).toHaveBeenLastCalledWith(
      "revoke_script_coordinate_attestation",
      expect.objectContaining({ p_attestation_id: attestationId }),
    );
  });

  it("revokes the known identity when attestation issuance loses its response", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: userId } },
      error: null,
    });
    mocks.adminRpc
      .mockRejectedValueOnce(new TypeError("fetch failed after commit"))
      .mockResolvedValueOnce({ data: true, error: null });

    const response = await POST(request(validBody), {
      params: Promise.resolve({ episodeId }),
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "SCRIPT_ATTESTATION_UNAVAILABLE",
      ok: false,
    });
    expect(mocks.authenticatedRpc).not.toHaveBeenCalled();
    expect(mocks.adminRpc).toHaveBeenLastCalledWith(
      "revoke_script_coordinate_attestation",
      expect.objectContaining({
        p_actor_user_id: userId,
        p_attestation_id: attestationId,
        p_request_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
  });

  it("fails closed when one-time attestation cleanup fails", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: userId } },
      error: null,
    });
    mocks.adminRpc
      .mockResolvedValueOnce({ data: attestationId, error: null })
      .mockResolvedValueOnce({ data: null, error: { code: "CLEANUP_FAILED" } });
    mocks.authenticatedRpc.mockResolvedValue({ data: { ok: true }, error: null });

    const response = await POST(request(validBody), {
      params: Promise.resolve({ episodeId }),
    });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "SCRIPT_ATTESTATION_CLEANUP_FAILED",
    });
  });

  it("maps an ordinary database rejection without claiming a conflict", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: userId } },
      error: null,
    });
    mocks.adminRpc
      .mockResolvedValueOnce({ data: attestationId, error: null })
      .mockResolvedValueOnce({ data: true, error: null });
    mocks.authenticatedRpc.mockResolvedValue({
      data: null,
      error: { code: "23514" },
    });

    const response = await POST(request(validBody), {
      params: Promise.resolve({ episodeId }),
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        code: "SCRIPT_LOCK_REJECTED",
        message: "The exact script could not be locked.",
        ok: false,
      }),
    );
    expect(mocks.adminRpc).toHaveBeenLastCalledWith(
      "revoke_script_coordinate_attestation",
      expect.objectContaining({ p_attestation_id: attestationId }),
    );
  });

  it("keeps an ambiguous RPC outcome retryable after revoking authority", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: userId } },
      error: null,
    });
    mocks.adminRpc
      .mockResolvedValueOnce({ data: attestationId, error: null })
      .mockResolvedValueOnce({ data: true, error: null });
    mocks.authenticatedRpc.mockResolvedValue({
      data: null,
      error: { code: "", message: "TypeError: fetch failed" },
      status: 0,
    });

    const response = await POST(request(validBody), {
      params: Promise.resolve({ episodeId }),
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "SCRIPT_LOCK_OUTCOME_UNKNOWN",
      ok: false,
    });
    expect(mocks.adminRpc).toHaveBeenLastCalledWith(
      "revoke_script_coordinate_attestation",
      expect.objectContaining({ p_attestation_id: attestationId }),
    );
  });

  it("revokes authority when the command RPC throws unexpectedly", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: userId } },
      error: null,
    });
    mocks.adminRpc
      .mockResolvedValueOnce({ data: attestationId, error: null })
      .mockResolvedValueOnce({ data: true, error: null });
    mocks.authenticatedRpc.mockRejectedValue(new TypeError("fetch failed"));

    const response = await POST(request(validBody), {
      params: Promise.resolve({ episodeId }),
    });

    expect(response.status).toBe(503);
    expect(mocks.adminRpc).toHaveBeenLastCalledWith(
      "revoke_script_coordinate_attestation",
      expect.objectContaining({ p_attestation_id: attestationId }),
    );
  });

  it("keeps the idempotency key retryable when cleanup fails after rejection", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: userId } },
      error: null,
    });
    mocks.adminRpc
      .mockResolvedValueOnce({ data: attestationId, error: null })
      .mockRejectedValueOnce(new Error("cleanup transport failed"));
    mocks.authenticatedRpc.mockResolvedValue({
      data: null,
      error: { code: "23514" },
    });

    const response = await POST(request(validBody), {
      params: Promise.resolve({ episodeId }),
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "SCRIPT_ATTESTATION_CLEANUP_FAILED",
      ok: false,
    });
  });

  it("maps an unexpected authority failure to a retryable unknown outcome", async () => {
    mocks.getUser.mockRejectedValue(new Error("transport unavailable"));
    const response = await POST(
      request(validBody, { "x-request-id": "request_fixed" }),
      { params: Promise.resolve({ episodeId }) },
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("x-request-id")).toBe("request_fixed");
  });
});

import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeCommand: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser: mocks.getUser },
  }),
}));
vi.mock("@/server/execute-command", () => ({
  executeCommand: mocks.executeCommand,
}));

import { POST } from "./route";
import { MAX_COMMAND_BYTES } from "@/security/command-envelope";

const userId = "10000000-0000-4000-8000-000000000102";

function request(): NextRequest {
  return new NextRequest("https://genie.example/api/commands", {
    body: JSON.stringify({
      commandType: "series.archive",
      payload: {
        expectedVersion: 1,
        seriesId: "10000000-0000-4000-8000-000000000103",
        workspaceId: "10000000-0000-4000-8000-000000000104",
      },
    }),
    headers: {
      "content-type": "application/json",
      origin: "https://genie.example",
      "x-idempotency-key": "command-route-test-0001",
    },
    method: "POST",
  });
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
        "x-idempotency-key": "command-route-test-0001",
        ...headers,
      }),
      nextUrl: new URL("https://genie.example/api/commands"),
    } as unknown as NextRequest,
  };
}

describe("command mutation outcome classification", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it.each([
    [{ code: "40001" }, 409, "COMMAND_REJECTED"],
    [{ code: "23514" }, 400, "COMMAND_REJECTED"],
    [{ code: "P0001" }, 400, "COMMAND_REJECTED"],
    [{ code: "", message: "TypeError: fetch failed" }, 503, "COMMAND_OUTCOME_UNKNOWN"],
    [new TypeError("fetch failed"), 503, "COMMAND_OUTCOME_UNKNOWN"],
  ])("maps %j to status %i", async (failure, status, code) => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: userId } },
      error: null,
    });
    mocks.executeCommand.mockRejectedValue(failure);

    const response = await POST(request());

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({ code, ok: false });
  });

  it("authenticates before reading any request-body bytes", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const streamed = streamedRequest([
      new TextEncoder().encode(JSON.stringify({ commandType: "series.archive" })),
    ]);

    const response = await POST(streamed.request);

    expect(response.status).toBe(401);
    expect(streamed.getReader).not.toHaveBeenCalled();
    expect(streamed.read).not.toHaveBeenCalled();
    expect(mocks.executeCommand).not.toHaveBeenCalled();
  });

  it("rejects malformed body headers without reading or authenticating", async () => {
    const streamed = streamedRequest([new Uint8Array()], {
      "content-length": "not-a-number",
    });

    const response = await POST(streamed.request);

    expect(response.status).toBe(400);
    expect(streamed.getReader).not.toHaveBeenCalled();
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.executeCommand).not.toHaveBeenCalled();
  });

  it("cancels a chunked body when actual bytes exceed the limit", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: userId } },
      error: null,
    });
    const streamed = streamedRequest([
      new Uint8Array(MAX_COMMAND_BYTES),
      new Uint8Array(1),
      new Uint8Array(1),
    ]);

    const response = await POST(streamed.request);

    expect(response.status).toBe(413);
    expect(streamed.read).toHaveBeenCalledTimes(2);
    expect(streamed.cancel).toHaveBeenCalledTimes(1);
    expect(streamed.releaseLock).toHaveBeenCalledTimes(1);
    expect(mocks.executeCommand).not.toHaveBeenCalled();
  });

  it("rejects false lengths and malformed UTF-8 before command parsing", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: userId } },
      error: null,
    });
    const mismatched = streamedRequest([new TextEncoder().encode("{}")], {
      "content-length": "1",
    });
    const mismatchResponse = await POST(mismatched.request);
    expect(mismatchResponse.status).toBe(400);

    const malformedUtf8 = streamedRequest([new Uint8Array([0xc3, 0x28])]);
    const utf8Response = await POST(malformedUtf8.request);
    expect(utf8Response.status).toBe(400);
    expect(mocks.executeCommand).not.toHaveBeenCalled();
  });
});

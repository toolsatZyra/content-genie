import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSignedUrl: vi.fn(),
  getUser: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/config/server-env", () => ({
  getServerEnvironment: () => ({
    public: { appUrl: "https://genie.example.test" },
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser: mocks.getUser },
    rpc: mocks.rpc,
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({
    storage: {
      from: () => ({ createSignedUrl: mocks.createSignedUrl }),
    },
  }),
}));

import { POST } from "./route";

const workspaceId = "10000000-0000-4000-8000-000000000101";
const validBody = JSON.stringify({
  bucket: "workspace-private",
  expiresIn: 60,
  path: `${workspaceId}/source/frame.webp`,
});

function streamedRequest(
  chunks: readonly Uint8Array[],
  extraHeaders: Readonly<Record<string, string>> = {},
) {
  let index = 0;
  const cancel = vi.fn(async () => undefined);
  const read = vi.fn(async () =>
    index < chunks.length ? { done: false, value: chunks[index++] } : { done: true },
  );
  const releaseLock = vi.fn();
  const getReader = vi.fn(() => ({ cancel, read, releaseLock }));
  const request = {
    body: { getReader },
    headers: new Headers({
      "content-type": "application/json",
      origin: "https://genie.example.test",
      ...extraHeaders,
    }),
    nextUrl: new URL("https://genie.example.test/api/storage/sign"),
  };
  return { cancel, getReader, read, request: request as never };
}

describe("storage signing request boundary", () => {
  beforeEach(() => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "10000000-0000-4000-8000-000000000102" } },
      error: null,
    });
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    mocks.createSignedUrl.mockResolvedValue({
      data: { signedUrl: "https://storage.example.test/signed" },
      error: null,
    });
  });

  it("rejects malformed or oversized declared lengths before authentication", async () => {
    for (const contentLength of ["-1", "NaN", "2049"]) {
      const streamed = streamedRequest([], { "content-length": contentLength });
      const response = await POST(streamed.request);
      expect(response.status).toBe(contentLength === "2049" ? 413 : 400);
      expect(streamed.getReader).not.toHaveBeenCalled();
    }
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("authenticates before reading a chunked or lengthless body", async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    const streamed = streamedRequest([new Uint8Array(8_192)]);
    const response = await POST(streamed.request);
    expect(response.status).toBe(401);
    expect(streamed.getReader).not.toHaveBeenCalled();
  });

  it("cancels an authenticated stream as soon as its actual bytes exceed the cap", async () => {
    const streamed = streamedRequest([
      new Uint8Array(1_500),
      new Uint8Array(600),
      new Uint8Array(4_000),
    ]);
    const response = await POST(streamed.request);
    expect(response.status).toBe(413);
    expect(streamed.read).toHaveBeenCalledTimes(2);
    expect(streamed.cancel).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects false lengths and malformed UTF-8", async () => {
    const mismatch = streamedRequest([new TextEncoder().encode("{}")], {
      "content-length": "1",
    });
    expect((await POST(mismatch.request)).status).toBe(400);

    const malformed = streamedRequest([new Uint8Array([0xc3, 0x28])]);
    expect((await POST(malformed.request)).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("signs only a bounded, authenticated and authorized exact request", async () => {
    const bytes = new TextEncoder().encode(validBody);
    const streamed = streamedRequest([bytes], {
      "content-length": String(bytes.byteLength),
    });
    const response = await POST(streamed.request);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      expiresIn: 60,
      ok: true,
      signedUrl: "https://storage.example.test/signed",
    });
    expect(mocks.rpc).toHaveBeenCalledWith("authorize_storage_sign", {
      p_bucket: "workspace-private",
      p_path: `${workspaceId}/source/frame.webp`,
    });
    expect(mocks.createSignedUrl).toHaveBeenCalledWith(
      `${workspaceId}/source/frame.webp`,
      60,
    );
  });
});

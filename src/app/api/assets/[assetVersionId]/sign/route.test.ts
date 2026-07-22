import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSignedUrl: vi.fn(),
  getUser: vi.fn(),
  maybeSingle: vi.fn(),
}));

const query = {
  eq: vi.fn(() => query),
  maybeSingle: mocks.maybeSingle,
  select: vi.fn(() => query),
};

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser: mocks.getUser },
    from: vi.fn(() => query),
    storage: {
      from: vi.fn(() => ({ createSignedUrl: mocks.createSignedUrl })),
    },
  }),
}));

import { POST } from "./route";

const assetVersionId = "10000000-0000-4000-8000-000000000101";

describe("asset preview signing", () => {
  beforeEach(() => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "10000000-0000-4000-8000-000000000102" } },
      error: null,
    });
    mocks.createSignedUrl.mockResolvedValue({
      data: { signedUrl: "https://signed.example/narration" },
      error: null,
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
    query.eq.mockClear();
    query.select.mockClear();
  });

  it("signs a promoted narration audio asset selected through RLS", async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: {
        bucket_id: "workspace-media",
        media_mime: "audio/mpeg",
        object_name: "workspace/narration/asset/version/source",
      },
      error: null,
    });
    const response = await POST(new Request("https://genie.example"), {
      params: Promise.resolve({ assetVersionId }),
    });
    expect(response.status).toBe(200);
    expect(mocks.createSignedUrl).toHaveBeenCalledWith(
      "workspace/narration/asset/version/source",
      90,
    );
  });

  it("continues to reject unsupported media previews", async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: {
        bucket_id: "workspace-media",
        media_mime: "video/mp4",
        object_name: "workspace/video/source",
      },
      error: null,
    });
    const response = await POST(new Request("https://genie.example"), {
      params: Promise.resolve({ assetVersionId }),
    });
    expect(response.status).toBe(415);
    expect(mocks.createSignedUrl).not.toHaveBeenCalled();
  });
});

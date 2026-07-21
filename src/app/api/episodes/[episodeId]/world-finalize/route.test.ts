import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  pack: vi.fn(),
  source: vi.fn(),
}));

vi.mock("@/config/server-env", () => ({
  getServerEnvironment: () => ({ public: { appUrl: "https://genie.example" } }),
}));

function scopedQuery() {
  const builder: Record<string, unknown> = {};
  for (const method of ["eq", "select"]) builder[method] = vi.fn(() => builder);
  builder.maybeSingle = vi.fn(async () => ({
    data: { id: configurationId },
    error: null,
  }));
  return builder;
}

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser: mocks.getUser },
    from: () => scopedQuery(),
  }),
}));
vi.mock("@/server/world-reference-pack", () => ({
  ensureWorldReferencePack: mocks.pack,
}));
vi.mock("@/server/source-cultural-preflight", () => ({
  ensureSourceCulturalPacket: mocks.source,
}));

import { POST } from "./route";

const episodeId = "42000000-0000-4000-8000-000000000001";
const configurationId = "42000000-0000-4000-8000-000000000002";
const workspaceId = "42000000-0000-4000-8000-000000000003";
const packId = "42000000-0000-4000-8000-000000000004";

function request() {
  return new NextRequest(
    `https://genie.example/api/episodes/${episodeId}/world-finalize`,
    {
      body: JSON.stringify({
        configurationCandidateId: configurationId,
        episodeId,
        workspaceId,
      }),
      headers: {
        "content-type": "application/json",
        origin: "https://genie.example",
        "x-idempotency-key": "world-finalize-test-0001",
      },
      method: "POST",
    },
  );
}

describe("World reference-pack finalization route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: "owner" } }, error: null });
    mocks.pack.mockResolvedValue({ packId, ready: true, replayed: false });
    mocks.source.mockResolvedValue({
      packetId: "42000000-0000-4000-8000-000000000005",
      replayed: false,
      scriptSourceVersionId: "42000000-0000-4000-8000-000000000006",
    });
  });

  it("assembles the accepted World and binds its source packet idempotently", async () => {
    const response = await POST(request(), { params: Promise.resolve({ episodeId }) });
    expect(response.status).toBe(200);
    expect(mocks.pack).toHaveBeenCalledWith({
      configurationCandidateId: configurationId,
      workspaceId,
    });
    expect(mocks.source).toHaveBeenCalledWith({
      configurationCandidateId: configurationId,
      workspaceId,
      worldReferencePackVersionId: packId,
    });
  });

  it("keeps Preflight closed until every anchor is accepted", async () => {
    mocks.pack.mockResolvedValue({ packId: null, ready: false, replayed: false });
    const response = await POST(request(), { params: Promise.resolve({ episodeId }) });
    expect(response.status).toBe(409);
    expect(mocks.source).not.toHaveBeenCalled();
  });
});

import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  hasActiveWorkspaceMembership: vi.fn(),
  searchAuthorizedStudio: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser: mocks.getUser } }),
}));
vi.mock("@/server/studio-search", () => ({
  hasActiveWorkspaceMembership: mocks.hasActiveWorkspaceMembership,
  searchAuthorizedStudio: mocks.searchAuthorizedStudio,
}));

import { GET } from "@/app/api/studio/search/route";

const workspaceId = "10000000-0000-4000-8000-000000000001";
const userId = "10000000-0000-4000-8000-000000000002";

describe("authorized studio search route", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("requires a current authenticated user", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await GET(
      new NextRequest(
        `https://genie.example/api/studio/search?workspace=${workspaceId}&q=Shiva`,
      ),
    );

    expect(response.status).toBe(401);
    expect(mocks.searchAuthorizedStudio).not.toHaveBeenCalled();
  });

  it("denies a workspace without active membership", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: userId } }, error: null });
    mocks.hasActiveWorkspaceMembership.mockResolvedValue(false);

    const response = await GET(
      new NextRequest(
        `https://genie.example/api/studio/search?workspace=${workspaceId}&q=Shiva`,
      ),
    );

    expect(response.status).toBe(403);
    expect(mocks.hasActiveWorkspaceMembership).toHaveBeenCalledWith(
      expect.anything(),
      workspaceId,
      userId,
    );
  });

  it("delegates paginated search to the server-side authorized query", async () => {
    const page = {
      matches: [],
      nextCursor: { episodeOffset: 24, seriesOffset: 16 },
      total: 80,
    };
    mocks.getUser.mockResolvedValue({ data: { user: { id: userId } }, error: null });
    mocks.hasActiveWorkspaceMembership.mockResolvedValue(true);
    mocks.searchAuthorizedStudio.mockResolvedValue(page);

    const response = await GET(
      new NextRequest(
        `https://genie.example/api/studio/search?workspace=${workspaceId}&q=River&episodeOffset=12&seriesOffset=4`,
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(page);
    expect(mocks.searchAuthorizedStudio).toHaveBeenCalledWith(
      expect.anything(),
      workspaceId,
      "River",
      { episodeOffset: 12, seriesOffset: 4 },
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});

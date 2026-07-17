import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { loadAssignedWorkProjectionRows } from "@/server/studio-query";

describe("studio work projection", () => {
  it("loads only work assigned to the authenticated user", async () => {
    const query = {
      eq: vi.fn(),
      in: vi.fn(),
      limit: vi.fn(),
      order: vi.fn(),
      select: vi.fn(),
    };
    for (const method of ["eq", "in", "order", "select"] as const) {
      query[method].mockReturnValue(query);
    }
    query.limit.mockResolvedValue({ count: null, data: [], error: null, status: 200 });
    const from = vi.fn(() => query);
    const client = { from } as unknown as SupabaseClient;

    await loadAssignedWorkProjectionRows(
      client,
      "10000000-0000-4000-8000-000000000001",
      "10000000-0000-4000-8000-000000000002",
    );

    expect(from).toHaveBeenCalledWith("work_items");
    expect(query.eq).toHaveBeenCalledWith(
      "workspace_id",
      "10000000-0000-4000-8000-000000000001",
    );
    expect(query.eq).toHaveBeenCalledWith(
      "assigned_user_id",
      "10000000-0000-4000-8000-000000000002",
    );
    expect(query.in).toHaveBeenCalledWith("state", ["open", "claimed"]);
  });
});

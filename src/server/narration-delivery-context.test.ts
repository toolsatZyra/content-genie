import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  client: vi.fn(),
  eq: vi.fn(),
  from: vi.fn(),
  limit: vi.fn(),
  order: vi.fn(),
  query: {} as Record<string, ReturnType<typeof vi.fn>>,
  select: vi.fn(),
  single: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: mocks.client,
}));

import {
  getApprovedNarrationSourceSetHash,
  NarrationDeliveryError,
} from "./narration-delivery";

const input = {
  configurationCandidateId: "10000000-0000-4000-8000-000000000002",
  policyVersionId: "10000000-0000-4000-8000-000000000004",
  scriptRevisionId: "10000000-0000-4000-8000-000000000003",
  workspaceId: "10000000-0000-4000-8000-000000000001",
} as const;

beforeEach(() => {
  for (const mock of [
    mocks.client,
    mocks.eq,
    mocks.from,
    mocks.limit,
    mocks.order,
    mocks.select,
    mocks.single,
  ]) {
    mock.mockReset();
  }
  mocks.query = {
    eq: mocks.eq,
    limit: mocks.limit,
    order: mocks.order,
    select: mocks.select,
    single: mocks.single,
  };
  mocks.client.mockReturnValue({ from: mocks.from });
  mocks.from.mockReturnValue(mocks.query);
  mocks.select.mockReturnValue(mocks.query);
  mocks.eq.mockReturnValue(mocks.query);
  mocks.order.mockReturnValue(mocks.query);
  mocks.limit.mockReturnValue(mocks.query);
});

describe("approved narration context", () => {
  it("uses the exact review-status foreign key when loading approval", async () => {
    mocks.single.mockResolvedValue({
      data: { source_set_hash: "a".repeat(64) },
      error: null,
    });

    await expect(getApprovedNarrationSourceSetHash(input)).resolves.toBe(
      "a".repeat(64),
    );
    expect(mocks.select).toHaveBeenCalledWith(
      "source_set_hash,source_review_statuses!source_review_statuses_source_review_packet_id_fkey!inner(status)",
    );
    expect(mocks.eq).toHaveBeenCalledWith("source_review_statuses.status", "approved");
  });

  it("fails closed when no exact approved review is available", async () => {
    mocks.single.mockResolvedValue({
      data: null,
      error: { code: "PGRST116" },
    });

    await expect(getApprovedNarrationSourceSetHash(input)).rejects.toBeInstanceOf(
      NarrationDeliveryError,
    );
  });
});

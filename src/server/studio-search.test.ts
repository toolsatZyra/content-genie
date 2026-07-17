import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { searchAuthorizedStudio } from "@/server/studio-search";

interface QueryDouble {
  readonly eq: ReturnType<typeof vi.fn>;
  readonly in: ReturnType<typeof vi.fn>;
  readonly is: ReturnType<typeof vi.fn>;
  readonly order: ReturnType<typeof vi.fn>;
  readonly range: ReturnType<typeof vi.fn>;
  readonly select: ReturnType<typeof vi.fn>;
  readonly textSearch: ReturnType<typeof vi.fn>;
  readonly then: PromiseLike<unknown>["then"];
}

function queryDouble(result: unknown): QueryDouble {
  const query = {} as QueryDouble;
  for (const method of [
    "eq",
    "in",
    "is",
    "order",
    "range",
    "select",
    "textSearch",
  ] as const) {
    Object.assign(query, { [method]: vi.fn(() => query) });
  }
  Object.assign(query, {
    then: <TResult1 = unknown, TResult2 = never>(
      onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) => Promise.resolve(result).then(onfulfilled, onrejected),
  });
  return query;
}

describe("server-backed studio search", () => {
  it("queries the authorized database projection with independent pagination", async () => {
    const seriesQuery = queryDouble({
      count: 20,
      data: [
        {
          aggregate_version: 2,
          description: "A world beyond the initial projection",
          id: "10000000-0000-4000-8000-0000000000b0",
          state: "active",
          title: "Hidden Rivers",
          updated_at: "2026-07-17T00:00:00.000Z",
        },
      ],
      error: null,
    });
    const episodeQuery = queryDouble({
      count: 30,
      data: [
        {
          aggregate_version: 3,
          cost_estimate_minor: null,
          created_at: "2026-07-17T00:00:00.000Z",
          currency: null,
          episode_number: 21,
          id: "10000000-0000-4000-8000-0000000000b1",
          owner_user_id: "10000000-0000-4000-8000-000000000002",
          progress_percent: 10,
          series_id: "10000000-0000-4000-8000-0000000000b0",
          summary: "Found through the complete database search",
          title: "The River Beyond the Index",
          updated_at: "2026-07-17T01:00:00.000Z",
          workflow_state: "paused",
        },
      ],
      error: null,
    });
    const relatedSeriesQuery = queryDouble({
      count: null,
      data: [
        {
          aggregate_version: 2,
          description: "A world beyond the initial projection",
          id: "10000000-0000-4000-8000-0000000000b0",
          state: "active",
          title: "Hidden Rivers",
          updated_at: "2026-07-17T00:00:00.000Z",
        },
      ],
      error: null,
    });
    let seriesCalls = 0;
    const from = vi.fn((table: string) => {
      if (table === "episodes") return episodeQuery;
      seriesCalls += 1;
      return seriesCalls === 1 ? seriesQuery : relatedSeriesQuery;
    });
    const client = { from } as unknown as SupabaseClient;

    const page = await searchAuthorizedStudio(client, "workspace-1", "River", {
      episodeOffset: 12,
      seriesOffset: 4,
    });

    expect(seriesQuery.textSearch).toHaveBeenCalledWith("search_document", "River", {
      config: "simple",
      type: "websearch",
    });
    expect(episodeQuery.textSearch).toHaveBeenCalledWith("search_document", "River", {
      config: "simple",
      type: "websearch",
    });
    expect(seriesQuery.range).toHaveBeenCalledWith(4, 15);
    expect(episodeQuery.range).toHaveBeenCalledWith(12, 23);
    expect(page.matches.map(({ label }) => label)).toEqual([
      "Hidden Rivers",
      "The River Beyond the Index",
    ]);
    expect(page.matches[1]).toMatchObject({
      episode: { workflowState: "paused" },
      kind: "Episode",
      series: { title: "Hidden Rivers" },
    });
    expect(page.nextCursor).toEqual({ episodeOffset: 13, seriesOffset: 5 });
    expect(page.total).toBe(50);
  });
});

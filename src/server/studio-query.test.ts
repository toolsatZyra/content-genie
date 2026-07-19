import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  loadAssignedWorkProjectionRows,
  projectSeriesSummaries,
} from "@/server/studio-query";

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

describe("studio Series release projection", () => {
  const seriesRows = [
    {
      active_release_id: "10000000-0000-4000-8000-00000000000b",
      aggregate_version: 7,
      description: "Released world",
      id: "10000000-0000-4000-8000-000000000003",
      state: "active",
      title: "Released Series",
      updated_at: "2026-07-19T00:00:00.000Z",
    },
    {
      active_release_id: null,
      aggregate_version: 1,
      description: "Draft world",
      id: "10000000-0000-4000-8000-000000000004",
      state: "active",
      title: "Unreleased Series",
      updated_at: "2026-07-19T00:00:00.000Z",
    },
  ];
  const relatedRows = {
    continuities: [
      {
        id: "10000000-0000-4000-8000-00000000000c",
        series_id: "10000000-0000-4000-8000-000000000003",
        version_no: 3,
      },
    ],
    lookAvailabilities: [
      {
        look_version_id: "10000000-0000-4000-8000-00000000000d",
        status: "active",
      },
    ],
    looks: [
      {
        id: "10000000-0000-4000-8000-00000000000d",
        look_key: "divine-realism",
        name: "Divine Realism",
      },
    ],
    voiceAvailabilities: [
      {
        status: "verified",
        voice_version_id: "ec4e61a6-dc45-53d9-ba4b-fd5c7f267b2f",
      },
    ],
    voices: [
      {
        gender: "male",
        id: "ec4e61a6-dc45-53d9-ba4b-fd5c7f267b2f",
        voice_key: "elevenlabs-male-hindi-devotional-v1",
      },
    ],
    releases: [
      {
        continuity_state_version_id: "10000000-0000-4000-8000-00000000000c",
        creative_identity_schema_version: 1,
        id: "10000000-0000-4000-8000-00000000000b",
        look_version_id: "10000000-0000-4000-8000-00000000000d",
        narrator_gender: "male",
        release_number: 2,
        series_id: "10000000-0000-4000-8000-000000000003",
        voice_version_id: "ec4e61a6-dc45-53d9-ba4b-fd5c7f267b2f",
      },
    ],
    statuses: [
      {
        release_id: "10000000-0000-4000-8000-00000000000b",
        status: "active",
      },
    ],
  };

  it("projects released and unreleased Series without inventing inherited assets", () => {
    const result = projectSeriesSummaries(seriesRows, relatedRows);
    expect(result[0]).toMatchObject({
      activeRelease: {
        continuity: {
          id: "10000000-0000-4000-8000-00000000000c",
          versionNumber: 3,
        },
        id: "10000000-0000-4000-8000-00000000000b",
        kind: "released",
        look: {
          availabilityStatus: "active",
          id: "10000000-0000-4000-8000-00000000000d",
          key: "divine-realism",
          name: "Divine Realism",
        },
        releaseNumber: 2,
        status: "active",
        voice: {
          availabilityStatus: "verified",
          gender: "male",
          id: "ec4e61a6-dc45-53d9-ba4b-fd5c7f267b2f",
          key: "elevenlabs-male-hindi-devotional-v1",
        },
      },
      aggregateVersion: 7,
      state: "active",
    });
    expect(result[1]?.activeRelease).toEqual({ kind: "unreleased" });
  });

  it("fails future Series lifecycle and malformed release rows closed", () => {
    const result = projectSeriesSummaries(
      [
        { ...seriesRows[0], state: "future_restoring" },
        {
          ...seriesRows[1],
          active_release_id: "10000000-0000-4000-8000-0000000000ff",
          state: null,
        },
      ],
      relatedRows,
    );
    expect(result[0]).toMatchObject({ state: "unavailable" });
    expect(result[1]?.activeRelease).toEqual({
      kind: "unavailable",
      reason: "release",
      releaseId: "10000000-0000-4000-8000-0000000000ff",
    });
    expect(result[1]?.state).toBe("unavailable");
  });

  it("fails future release and look availability values closed", () => {
    expect(
      projectSeriesSummaries(seriesRows.slice(0, 1), {
        ...relatedRows,
        statuses: [
          {
            release_id: "10000000-0000-4000-8000-00000000000b",
            status: "future_reactivating",
          },
        ],
      })[0]?.activeRelease,
    ).toEqual({
      kind: "unavailable",
      reason: "release",
      releaseId: "10000000-0000-4000-8000-00000000000b",
    });
    expect(
      projectSeriesSummaries(seriesRows.slice(0, 1), {
        ...relatedRows,
        lookAvailabilities: [
          {
            look_version_id: "10000000-0000-4000-8000-00000000000d",
            status: "future_restoring",
          },
        ],
      })[0]?.activeRelease,
    ).toEqual({
      kind: "unavailable",
      reason: "look",
      releaseId: "10000000-0000-4000-8000-00000000000b",
    });
    expect(
      projectSeriesSummaries(seriesRows.slice(0, 1), {
        ...relatedRows,
        voiceAvailabilities: [
          {
            status: "future_restoring",
            voice_version_id: "ec4e61a6-dc45-53d9-ba4b-fd5c7f267b2f",
          },
        ],
      })[0]?.activeRelease,
    ).toEqual({
      kind: "unavailable",
      reason: "voice",
      releaseId: "10000000-0000-4000-8000-00000000000b",
    });
    expect(
      projectSeriesSummaries(seriesRows.slice(0, 1), {
        ...relatedRows,
        voices: [{ ...relatedRows.voices[0], gender: "female" }],
      })[0]?.activeRelease,
    ).toEqual({
      kind: "unavailable",
      reason: "voice",
      releaseId: "10000000-0000-4000-8000-00000000000b",
    });
  });

  it("recognizes exact voice lifecycle statuses and fails unknown values closed", () => {
    for (const status of ["verified", "pending_authenticated_canary"] as const) {
      expect(
        projectSeriesSummaries(seriesRows.slice(0, 1), {
          ...relatedRows,
          voiceAvailabilities: [
            {
              status,
              voice_version_id: "ec4e61a6-dc45-53d9-ba4b-fd5c7f267b2f",
            },
          ],
        })[0]?.activeRelease,
      ).toMatchObject({ kind: "released", voice: { availabilityStatus: status } });
    }
    expect(
      projectSeriesSummaries(seriesRows.slice(0, 1), {
        ...relatedRows,
        voiceAvailabilities: [
          {
            status: "withdrawn",
            voice_version_id: "ec4e61a6-dc45-53d9-ba4b-fd5c7f267b2f",
          },
        ],
      })[0]?.activeRelease,
    ).toMatchObject({
      kind: "released",
      voice: { availabilityStatus: "withdrawn" },
    });
    for (const status of ["active", "unknown", "withdrawn_pending"] as const) {
      expect(
        projectSeriesSummaries(seriesRows.slice(0, 1), {
          ...relatedRows,
          voiceAvailabilities: [
            {
              status,
              voice_version_id: "ec4e61a6-dc45-53d9-ba4b-fd5c7f267b2f",
            },
          ],
        })[0]?.activeRelease,
      ).toEqual({
        kind: "unavailable",
        reason: "voice",
        releaseId: "10000000-0000-4000-8000-00000000000b",
      });
    }
  });

  it("fails legacy creative identity and a null look pin closed", () => {
    for (const release of [
      { ...relatedRows.releases[0], creative_identity_schema_version: 0 },
      { ...relatedRows.releases[0], look_version_id: null },
    ]) {
      expect(
        projectSeriesSummaries(seriesRows.slice(0, 1), {
          ...relatedRows,
          releases: [release],
        })[0]?.activeRelease,
      ).toMatchObject({ kind: "unavailable" });
    }
  });

  it("fails a cross-Series continuity projection closed", () => {
    expect(
      projectSeriesSummaries(seriesRows.slice(0, 1), {
        ...relatedRows,
        continuities: [
          {
            ...relatedRows.continuities[0],
            series_id: "10000000-0000-4000-8000-000000000004",
          },
        ],
      })[0]?.activeRelease,
    ).toEqual({
      kind: "unavailable",
      reason: "continuity",
      releaseId: "10000000-0000-4000-8000-00000000000b",
    });
  });
});

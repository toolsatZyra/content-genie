import type { SupabaseClient, User } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { LOOKS } from "@/domain/look/look-registry";

import { loadCreationProjection } from "./creation-query";

interface FakeResult {
  readonly data: unknown;
  readonly error: unknown;
}

function fakeClient(results: Readonly<Record<string, FakeResult>>) {
  const from = vi.fn((table: string) => {
    const result = results[table];
    if (!result) throw new Error(`Missing fake result for ${table}`);
    const builder: Record<string, unknown> = {};
    for (const method of ["eq", "in", "limit", "order", "select"]) {
      builder[method] = vi.fn(() => builder);
    }
    builder.maybeSingle = vi.fn(async () => result);
    builder.then = (
      onFulfilled: (value: FakeResult) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(onFulfilled, onRejected);
    return builder;
  });
  return {
    client: { from } as unknown as SupabaseClient,
    from,
  };
}

const user = { id: "10000000-0000-4000-8000-000000000001" } as User;
const episodeId = "10000000-0000-4000-8000-000000000002";
const workspaceId = "10000000-0000-4000-8000-000000000003";
const seriesId = "10000000-0000-4000-8000-000000000006";
const voiceVersionId = "ec4e61a6-dc45-53d9-ba4b-fd5c7f267b2f";
const lookVersionId = "d2020261-8b9e-586a-aed6-f206a0d753c5";
const actorId = "10000000-0000-4000-8000-000000000001";
const performanceProfileId = "genie-launch-hindi-delhi-sanskrit-performance.v1";

const allLookAvailability = LOOKS.map((look) => ({
  look_version_id: look.versionId,
  status: look.versionId === lookVersionId ? "active" : "withdrawn",
}));
const allLookAvailabilityByVersionId = Object.fromEntries(
  allLookAvailability.map((row) => [row.look_version_id, row.status]),
);

function successfulResults(
  series: unknown = [{ title: "Mahadev" }],
): Record<string, FakeResult> {
  return {
    episodes: {
      data: {
        aggregate_version: "4",
        episode_number: 7,
        id: episodeId,
        series_id: seriesId,
        series,
        title: "The Third Eye",
        workflow_state: "world_setup",
        workspace_id: workspaceId,
      },
      error: null,
    },
    script_revisions: {
      data: {
        estimated_duration_seconds: "91.5",
        id: "10000000-0000-4000-8000-000000000004",
        raw_text: "शिव कथा\r\nसमाप्त",
        raw_utf8_sha256: "a".repeat(64),
        revision_number: 2,
      },
      error: null,
    },
    episode_configuration_candidates: {
      data: {
        aggregate_version: "3",
        id: "10000000-0000-4000-8000-000000000005",
        look_confirmed_at: "2026-07-19T10:01:00.000Z",
        look_confirmed_by: actorId,
        look_version_id: lookVersionId,
        narrator_gender: "male",
        performance_profile_id: performanceProfileId,
        voice_confirmed_at: "2026-07-19T10:00:00.000Z",
        voice_confirmed_by: actorId,
        voice_version_id: voiceVersionId,
      },
      error: null,
    },
    voice_version_availability: {
      data: [
        {
          status: "pending_authenticated_canary",
          voice_version_id: voiceVersionId,
        },
      ],
      error: null,
    },
    look_version_availability: {
      data: allLookAvailability,
      error: null,
    },
    creation_readiness_projections: {
      data: {
        preflight: {
          audioIdentity: null,
          failure: null,
          masterClock: null,
          plan: null,
          productionRun: null,
          qc: null,
          quote: null,
        },
        world: { characters: [], locations: [], referencePack: null },
      },
      error: null,
    },
    source_review_readiness_projections: {
      data: null,
      error: null,
    },
    world_build_progress_items: {
      data: [],
      error: null,
    },
  };
}

describe("the creation projection query", () => {
  it("projects exact script, configuration, availability, and numeric versions", async () => {
    const { client } = fakeClient(successfulResults());
    const projection = await loadCreationProjection(client, user, episodeId);

    expect(projection).toEqual({
      configuration: {
        aggregateVersion: 3,
        id: "10000000-0000-4000-8000-000000000005",
        lookAvailabilityByVersionId: allLookAvailabilityByVersionId,
        lookAvailabilityStatus: "active",
        lookConfirmation: {
          confirmedAt: "2026-07-19T10:01:00.000Z",
          confirmedBy: actorId,
          origin: "human_confirmed",
        },
        lookVersionId,
        narratorGender: "male",
        performanceProfileId,
        voiceAvailabilityByVersionId: {
          [voiceVersionId]: "pending_authenticated_canary",
        },
        voiceConfirmation: {
          confirmedAt: "2026-07-19T10:00:00.000Z",
          confirmedBy: actorId,
          origin: "human_confirmed",
        },
        voiceVersionId,
      },
      episode: {
        aggregateVersion: 4,
        episodeNumber: 7,
        id: episodeId,
        seriesId,
        seriesTitle: "Mahadev",
        title: "The Third Eye",
        workflowState: "world_setup",
        workspaceId,
      },
      script: {
        estimatedDurationSeconds: 91.5,
        id: "10000000-0000-4000-8000-000000000004",
        rawText: "शिव कथा\r\nसमाप्त",
        rawUtf8Sha256: "a".repeat(64),
        revisionNumber: 2,
      },
      preflight: {
        audioIdentity: null,
        failure: null,
        masterClock: null,
        plan: null,
        productionRun: null,
        qc: null,
        quote: null,
        sourceReview: null,
      },
      world: { characters: [], locations: [], progress: [], referencePack: null },
    });
  });

  it.each([
    [{ title: "Devi" }, "Devi"],
    [[], "Series"],
    [null, "Series"],
  ])("handles the supported series relation shape %#", async (series, expected) => {
    const { client } = fakeClient(successfulResults(series));
    const projection = await loadCreationProjection(client, user, episodeId);
    expect(projection?.episode.seriesTitle).toBe(expected);
  });

  it("returns null when the authorized episode is absent", async () => {
    const { client, from } = fakeClient({
      episodes: { data: null, error: null },
    });
    await expect(loadCreationProjection(client, user, episodeId)).resolves.toBeNull();
    expect(from).toHaveBeenCalledTimes(1);
  });

  it("keeps script and configuration optional without querying availability", async () => {
    const results = successfulResults([]);
    results.script_revisions = { data: null, error: null };
    results.episode_configuration_candidates = { data: null, error: null };
    const { client, from } = fakeClient(results);

    const projection = await loadCreationProjection(client, user, episodeId);

    expect(projection).toMatchObject({ configuration: null, script: null });
    expect(from).not.toHaveBeenCalledWith("voice_version_availability");
    expect(from).not.toHaveBeenCalledWith("look_version_availability");
  });

  it("fails closed when look availability is absent", async () => {
    const results = successfulResults();
    results.look_version_availability = { data: null, error: null };
    const { client } = fakeClient(results);
    const projection = await loadCreationProjection(client, user, episodeId);
    expect(projection?.configuration?.lookAvailabilityStatus).toBe("unavailable");
    expect(
      Object.keys(projection?.configuration?.lookAvailabilityByVersionId ?? {}),
    ).toHaveLength(117);
    expect(
      Object.values(projection?.configuration?.lookAvailabilityByVersionId ?? {}),
    ).toEqual(Array.from({ length: 117 }, () => "unavailable"));
  });

  it("distinguishes an explicitly withdrawn look from a missing unavailable row", async () => {
    const results = successfulResults();
    results.look_version_availability = {
      data: allLookAvailability.filter((row) => row.look_version_id !== lookVersionId),
      error: null,
    };
    const { client } = fakeClient(results);
    const projection = await loadCreationProjection(client, user, episodeId);

    expect(projection?.configuration?.lookAvailabilityByVersionId[lookVersionId]).toBe(
      "unavailable",
    );
    expect(
      Object.values(projection?.configuration?.lookAvailabilityByVersionId ?? {}),
    ).toContain("withdrawn");
  });

  it("projects availability for all 117 exact look versions", async () => {
    const { client } = fakeClient(successfulResults());
    const projection = await loadCreationProjection(client, user, episodeId);
    const availability = projection?.configuration?.lookAvailabilityByVersionId;

    expect(Object.keys(availability ?? {})).toHaveLength(117);
    expect(Object.keys(availability ?? {}).sort()).toEqual(
      LOOKS.map((look) => look.versionId).sort(),
    );
    expect(availability?.[lookVersionId]).toBe("active");
  });

  it("projects untouched defaults as awaiting human confirmation", async () => {
    const results = successfulResults();
    results.episode_configuration_candidates = {
      data: {
        ...(results.episode_configuration_candidates!.data as Record<string, unknown>),
        look_confirmed_at: null,
        look_confirmed_by: null,
        voice_confirmed_at: null,
        voice_confirmed_by: null,
      },
      error: null,
    };
    const { client } = fakeClient(results);
    const projection = await loadCreationProjection(client, user, episodeId);

    expect(projection?.configuration).toMatchObject({
      lookConfirmation: {
        confirmedAt: null,
        confirmedBy: null,
        origin: "system_default",
      },
      voiceConfirmation: {
        confirmedAt: null,
        confirmedBy: null,
        origin: "system_default",
      },
    });
  });

  it.each([
    "episodes",
    "script_revisions",
    "episode_configuration_candidates",
    "voice_version_availability",
    "look_version_availability",
    "creation_readiness_projections",
  ])("propagates a %s query failure", async (table) => {
    const expected = new Error(`${table} unavailable`);
    const results = successfulResults();
    results[table] = { data: null, error: expected };
    const { client } = fakeClient(results);
    await expect(loadCreationProjection(client, user, episodeId)).rejects.toBe(
      expected,
    );
  });
});

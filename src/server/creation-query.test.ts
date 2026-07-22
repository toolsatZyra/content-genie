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
        narration_source_confirmed_at: null,
        narration_source_confirmed_by: null,
        narration_source_kind: "elevenlabs_v3",
        performance_profile_id: performanceProfileId,
        selected_narration_upload_version_id: null,
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
    preflight_runs: {
      data: [
        {
          created_at: "2026-07-19T10:05:00.000Z",
          id: "10000000-0000-4000-8000-000000000099",
          kind: "world_anchor",
          run_number: 1,
          state: "succeeded",
        },
      ],
      error: null,
    },
    world_build_progress_items: {
      data: [],
      error: null,
    },
    mvp_production_jobs: {
      data: null,
      error: null,
    },
    production_runs: {
      data: null,
      error: null,
    },
    mvp_episode_masters: {
      data: null,
      error: null,
    },
    mvp_edit_packages: {
      data: null,
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
        narrationSourceConfirmation: {
          confirmedAt: null,
          confirmedBy: null,
          origin: "system_default",
        },
        narrationSourceKind: "elevenlabs_v3",
        narrationUpload: null,
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
      production: {
        job: null,
        master: null,
        package: null,
        repair: null,
        productionRunId: null,
        signedMasterUrl: null,
        transcript: [],
      },
      world: { characters: [], locations: [], progress: [], referencePack: null },
    });
  });

  it("projects the confirmed authoritative uploaded narration", async () => {
    const results = successfulResults();
    const configuration = results.episode_configuration_candidates!.data as Record<
      string,
      unknown
    >;
    configuration.narration_source_kind = "uploaded_audio";
    configuration.selected_narration_upload_version_id =
      "10000000-0000-4000-8000-000000000040";
    configuration.narration_source_confirmed_at = "2026-07-22T10:00:00.000Z";
    configuration.narration_source_confirmed_by = actorId;
    results.episode_narration_upload_versions = {
      data: {
        script_comparison_json: { matchesLockedScript: false },
        duration_ms: "81250",
        id: "10000000-0000-4000-8000-000000000040",
        promoted_asset_version_id: "10000000-0000-4000-8000-000000000041",
        display_filename: "final-narration.wav",
        state: "confirmed",
        transcription_text: "Exact words spoken in the uploaded narration.",
      },
      error: null,
    };
    const { client } = fakeClient(results);

    const projection = await loadCreationProjection(client, user, episodeId);

    expect(projection?.configuration).toMatchObject({
      narrationSourceConfirmation: {
        confirmedAt: "2026-07-22T10:00:00.000Z",
        confirmedBy: actorId,
        origin: "human_confirmed",
      },
      narrationSourceKind: "uploaded_audio",
      narrationUpload: {
        assetVersionId: "10000000-0000-4000-8000-000000000041",
        comparisonEvidence: { matchesLockedScript: false },
        durationMs: 81250,
        id: "10000000-0000-4000-8000-000000000040",
        originalFilename: "final-narration.wav",
        state: "confirmed",
        transcriptionText: "Exact words spoken in the uploaded narration.",
      },
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

  it("projects the exact shot-timed narration transcript for Edit", async () => {
    const results = successfulResults();
    results.mvp_production_jobs = {
      data: {
        attempt_number: 1,
        completed_clips: 2,
        completed_sfx: 2,
        completed_storyboards: 2,
        last_error_code: null,
        last_error_summary: null,
        plan_bundle_id: "10000000-0000-4000-8000-000000000020",
        production_run_id: "10000000-0000-4000-8000-000000000021",
        state: "review_ready",
        total_clips: 2,
        total_sfx: 2,
        total_storyboards: 2,
        version: 4,
      },
      error: null,
    };
    results.mvp_episode_masters = {
      data: {
        attempt_number: 1,
        duration_ms: 6_000,
        height: 1920,
        id: "10000000-0000-4000-8000-000000000022",
        object_name: `${workspaceId}/mvp-masters/master.mp4`,
        state: "pending_review",
        version: 1,
        width: 1080,
      },
      error: null,
    };
    results.preflight_plan_bundles = {
      data: { edd_version_id: "10000000-0000-4000-8000-000000000023" },
      error: null,
    };
    results.preflight_plan_component_versions = {
      data: {
        payload: {
          shots: [
            {
              endMs: 2_750,
              exactNarration:
                "\u0936\u093f\u0935 \u0928\u0947\u0924\u094d\u0930 \u0916\u0941\u0932\u0947\u0964",
              shotNumber: 1,
              startMs: 0,
            },
            {
              endMs: 6_000,
              exactNarration:
                "\u092a\u094d\u0930\u0915\u093e\u0936 \u092b\u0948\u0932 \u0917\u092f\u093e\u0964",
              shotNumber: 2,
              startMs: 2_750,
            },
          ],
        },
      },
      error: null,
    };
    const { client } = fakeClient(results);

    const projection = await loadCreationProjection(client, user, episodeId);

    expect(projection?.production.transcript).toEqual([
      {
        endMs: 2_750,
        exactNarration:
          "\u0936\u093f\u0935 \u0928\u0947\u0924\u094d\u0930 \u0916\u0941\u0932\u0947\u0964",
        shotNumber: 1,
        startMs: 0,
      },
      {
        endMs: 6_000,
        exactNarration:
          "\u092a\u094d\u0930\u0915\u093e\u0936 \u092b\u0948\u0932 \u0917\u092f\u093e\u0964",
        shotNumber: 2,
        startMs: 2_750,
      },
    ]);
    expect(projection?.production.job).not.toHaveProperty("plan_bundle_id");
  });

  it("suppresses a terminal failure superseded by a newer run of the same kind", async () => {
    const results = successfulResults();
    results.creation_readiness_projections = {
      data: {
        preflight: {
          audioIdentity: null,
          failure: {
            attemptNo: 2,
            code: "immutable-preparation-restart",
            failedAt: "2026-07-19T10:04:00.000Z",
            stageKey: "world_anchor.root",
          },
          masterClock: null,
          plan: null,
          productionRun: null,
          qc: null,
          quote: null,
        },
        world: { characters: [], locations: [], referencePack: null },
      },
      error: null,
    };

    const { client } = fakeClient(results);
    const projection = await loadCreationProjection(client, user, episodeId);

    expect(projection?.preflight.failure).toBeNull();
  });

  it("retains the current run's terminal failure", async () => {
    const results = successfulResults();
    results.creation_readiness_projections = {
      data: {
        preflight: {
          audioIdentity: null,
          failure: {
            attemptNo: 2,
            code: "plan-quality-blocked",
            failedAt: "2026-07-19T10:06:00.000Z",
            stageKey: "plan_evaluation.root",
          },
          masterClock: null,
          plan: null,
          productionRun: null,
          qc: null,
          quote: null,
        },
        world: { characters: [], locations: [], referencePack: null },
      },
      error: null,
    };

    const { client } = fakeClient(results);
    const projection = await loadCreationProjection(client, user, episodeId);

    expect(projection?.preflight.failure?.code).toBe("plan-quality-blocked");
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
    "mvp_production_jobs",
    "production_runs",
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

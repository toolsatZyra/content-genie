import { notFound, redirect } from "next/navigation";

import { CreationStudio } from "@/components/creation/creation-studio";
import { getServerEnvironment } from "@/config/server-env";
import type { CreationChamber, CreationProjection } from "@/domain/creation";
import { findLook, findLookByVersionId } from "@/domain/look/look-registry";
import { findVoiceByVersionId } from "@/domain/voice/voice-registry";
import {
  createServerSupabaseClient,
  hasConfiguredSupabase,
} from "@/lib/supabase/server";
import { loadCreationProjection } from "@/server/creation-query";
import {
  deterministicCreationProjection,
  deterministicReadyCreationProjection,
  deterministicReadOnlyNoScriptCreationProjection,
} from "@/test/fakes/creation";

interface CreationPageProps {
  readonly params: Promise<{ readonly episodeId: string }>;
  readonly searchParams: Promise<{
    readonly fixture?: string;
    readonly episodeId?: string;
    readonly resumeCreation?: string;
    readonly seriesId?: string;
  }>;
}

function creationProjectionKey(projection: CreationProjection): string {
  const configuration = projection.configuration;
  return JSON.stringify({
    configuration: configuration
      ? {
          aggregateVersion: configuration.aggregateVersion,
          id: configuration.id,
          lookAvailabilityByVersionId: Object.entries(
            configuration.lookAvailabilityByVersionId,
          ).sort(([left], [right]) => left.localeCompare(right)),
          lookAvailabilityStatus: configuration.lookAvailabilityStatus,
          lookVersionId: configuration.lookVersionId,
          narratorGender: configuration.narratorGender,
          voiceAvailabilityByVersionId: Object.entries(
            configuration.voiceAvailabilityByVersionId,
          ).sort(([left], [right]) => left.localeCompare(right)),
          voiceVersionId: configuration.voiceVersionId,
        }
      : null,
    episodeVersion: projection.episode.aggregateVersion,
    production: {
      jobState: projection.production.job?.state ?? null,
      jobVersion: projection.production.job?.version ?? null,
      masterId: projection.production.master?.id ?? null,
      masterVersion: projection.production.master?.version ?? null,
      packageState: projection.production.package?.state ?? null,
      packageVersion: projection.production.package?.version ?? null,
    },
    workflowState: projection.episode.workflowState,
    scriptId: projection.script?.id ?? "draft",
  });
}

function canResumeCreationInLook(projection: CreationProjection): boolean {
  const configuration = projection.configuration;
  if (!projection.script || !configuration) return false;

  const pinnedVoice = findVoiceByVersionId(configuration.voiceVersionId);
  const availability =
    configuration.voiceAvailabilityByVersionId[configuration.voiceVersionId];
  return Boolean(
    pinnedVoice &&
    pinnedVoice.gender === configuration.narratorGender &&
    (availability === "pending_authenticated_canary" || availability === "verified"),
  );
}

const creationChambers = [
  "script",
  "voice",
  "look",
  "world",
  "preflight",
  "create",
] as const satisfies readonly CreationChamber[];

function preferredInitialChamber(
  projection: CreationProjection,
  requested: string | undefined,
): CreationChamber {
  const configuration = projection.configuration;
  const look = configuration
    ? findLookByVersionId(configuration.lookVersionId)
    : undefined;
  const lookReady = Boolean(
    canResumeCreationInLook(projection) &&
    configuration &&
    look &&
    configuration.lookAvailabilityByVersionId[look.versionId] === "active" &&
    configuration.lookConfirmation.origin === "human_confirmed" &&
    configuration.voiceConfirmation.origin === "human_confirmed",
  );
  const worldReady =
    projection.world.characters.length + projection.world.locations.length > 0 &&
    [...projection.world.characters, ...projection.world.locations].every(
      ({ state }) => state === "accepted",
    ) &&
    projection.world.referencePack?.state === "verified";
  const preflightReady =
    projection.preflight.failure === null &&
    projection.preflight.sourceReview?.status === "approved" &&
    projection.preflight.audioIdentity?.state === "verified" &&
    projection.preflight.masterClock?.state === "verified" &&
    projection.preflight.plan?.state === "qc_passed" &&
    projection.preflight.qc?.verdict === "pass" &&
    projection.preflight.quote?.confirmed === true &&
    projection.preflight.quote.expired === false;
  const allowed: Readonly<Record<CreationChamber, boolean>> = {
    create: Boolean(projection.preflight.productionRun) || preflightReady,
    look: canResumeCreationInLook(projection),
    preflight: worldReady,
    script: true,
    voice: Boolean(projection.script),
    world: lookReady,
  };

  if (requested && creationChambers.includes(requested as CreationChamber)) {
    const requestedIndex = creationChambers.indexOf(requested as CreationChamber);
    for (let index = requestedIndex; index >= 0; index -= 1) {
      const chamber = creationChambers[index];
      if (chamber && allowed[chamber]) return chamber;
    }
  }

  const createWorkflowStates = new Set([
    "approved",
    "awaiting_final_review",
    "blocked",
    "delayed",
    "delivered",
    "paused",
    "pending_qualified_review",
    "producing",
    "ready_to_produce",
    "release_blocked",
    "retrying",
  ]);
  if (allowed.create || createWorkflowStates.has(projection.episode.workflowState)) {
    return "create";
  }
  if (allowed.preflight) return "preflight";
  if (lookReady) return "world";
  if (
    allowed.look &&
    projection.configuration?.voiceConfirmation.origin === "human_confirmed"
  ) {
    return "look";
  }
  if (allowed.voice) return "voice";
  return "script";
}

export default async function CreationPage({
  params,
  searchParams,
}: CreationPageProps) {
  const [{ episodeId }, query] = await Promise.all([params, searchParams]);
  if (
    getServerEnvironment().environment === "test" &&
    [
      "phase2-empty",
      "phase2-ambiguous-script",
      "phase2-stale-script",
      "phase2-script",
      "phase2-divine-look",
      "phase2-advertising-look",
      "phase2-withdrawn-look",
      "phase2-unavailable-look",
      "phase2-invalid-look",
      "phase2-invalid-voice",
      "phase2-missing-voice-status",
      "phase2-refresh-withdrawn-pins",
      "phase2-stale-look",
      "phase2-withdrawn-voice",
      "phase2-canceled",
      "phase2-delivered",
      "phase2-read-only-no-script",
      "phase2-world",
      "phase2-world-ready",
      "phase2-preflight",
      "phase2-preflight-blocked",
      "phase2-world-lock",
      "phase2-running",
      "mvp-review",
      "mvp-repair",
      "mvp-clarification",
      "mvp-approved",
    ].includes(query.fixture ?? "")
  ) {
    const scriptAppearsAfterReconciliation =
      (query.fixture === "phase2-stale-script" ||
        query.fixture === "phase2-ambiguous-script") &&
      query.resumeCreation === "script";
    const fixtureStartsEmpty =
      query.fixture === "phase2-empty" ||
      query.fixture === "phase2-read-only-no-script" ||
      query.fixture === "phase2-stale-script" ||
      query.fixture === "phase2-ambiguous-script";
    const projection = deterministicCreationProjection(
      !fixtureStartsEmpty || scriptAppearsAfterReconciliation,
    );
    let fixtureProjection =
      query.fixture === "phase2-read-only-no-script"
        ? deterministicReadOnlyNoScriptCreationProjection()
        : projection;
    if (query.fixture === "phase2-world") {
      fixtureProjection = deterministicReadyCreationProjection("review");
    } else if (query.fixture === "phase2-world-ready") {
      fixtureProjection = deterministicReadyCreationProjection("ready");
    } else if (query.fixture === "phase2-preflight") {
      fixtureProjection = deterministicReadyCreationProjection("preflight");
    } else if (query.fixture === "phase2-preflight-blocked") {
      fixtureProjection = deterministicReadyCreationProjection("blocked");
    } else if (query.fixture === "phase2-world-lock") {
      fixtureProjection = deterministicReadyCreationProjection("confirmed");
    } else if (query.fixture === "phase2-running") {
      fixtureProjection = deterministicReadyCreationProjection("running");
    } else if (
      query.fixture === "mvp-review" ||
      query.fixture === "mvp-repair" ||
      query.fixture === "mvp-clarification" ||
      query.fixture === "mvp-approved"
    ) {
      const approved = query.fixture === "mvp-approved";
      const clarifying = query.fixture === "mvp-clarification";
      const repairing = query.fixture === "mvp-repair" || clarifying;
      const reviewProjection = deterministicReadyCreationProjection("running");
      fixtureProjection = {
        ...reviewProjection,
        episode: {
          ...reviewProjection.episode,
          workflowState: approved
            ? "approved"
            : repairing
              ? "producing"
              : "awaiting_final_review",
        },
        production: {
          job: {
            attempt_number: repairing ? 2 : 1,
            completed_clips: repairing ? 19 : 21,
            completed_sfx: repairing ? 0 : 21,
            completed_storyboards: repairing ? 20 : 21,
            last_error_code: null,
            last_error_summary: null,
            production_run_id: "53000000-0000-4000-8000-000000000001",
            state: approved
              ? "export_ready"
              : clarifying
                ? "repair_planning"
                : repairing
                  ? "generating"
                  : "review_ready",
            total_clips: 21,
            total_sfx: 21,
            total_storyboards: 21,
            version: approved ? 5 : repairing ? 8 : 4,
          },
          master: {
            attempt_number: 1,
            duration_ms: 91_000,
            height: 1920,
            id: "53000000-0000-4000-8000-000000000002",
            object_name:
              "10000000-0000-4000-8000-000000000101/mvp-masters/53000000-0000-4000-8000-000000000001/1/master.mp4",
            state: approved ? "approved" : "pending_review",
            version: approved ? 2 : 1,
            width: 1080,
          },
          package: approved
            ? {
                byte_length: 48_000_000,
                id: "53000000-0000-4000-8000-000000000003",
                last_error_code: null,
                last_error_summary: null,
                master_id: "53000000-0000-4000-8000-000000000002",
                object_name:
                  "10000000-0000-4000-8000-000000000101/mvp-edit-packages/53000000-0000-4000-8000-000000000002/2/approved-assets.zip",
                state: "ready",
                version: 2,
              }
            : null,
          repair: repairing
            ? {
                affected_shots: clarifying ? 0 : 3,
                clarification_id: clarifying
                  ? "53000000-0000-4000-8000-000000000005"
                  : null,
                clarification_question: clarifying
                  ? "At 00:14, do you want Rama's bow image changed, or should the existing image remain while only its motion becomes faster?"
                  : null,
                clarification_round: clarifying ? 1 : null,
                clips_regenerated: clarifying ? 0 : 1,
                clips_reused: clarifying ? 0 : 18,
                clips_to_regenerate: clarifying ? 0 : 3,
                feedback_points: clarifying
                  ? [
                      {
                        actions: [],
                        evidenceWindows: [],
                        feedbackPointIndex: 1,
                        mappedShots: [],
                        resolution: "clarification" as const,
                      },
                    ]
                  : [
                      {
                        actions: [
                          {
                            assetStatus: "selected_complete_assets" as const,
                            selectedAction: "storyboard_and_clip" as const,
                            shotNumber: 5,
                          },
                        ],
                        evidenceWindows: [
                          { endMs: 15_000, shotNumber: 5, startMs: 12_000 },
                        ],
                        feedbackPointIndex: 1,
                        mappedShots: [5],
                        resolution: "model" as const,
                      },
                      {
                        actions: [
                          {
                            assetStatus: "selected_complete_assets" as const,
                            selectedAction: "re_edit" as const,
                            shotNumber: 9,
                          },
                        ],
                        evidenceWindows: [
                          { endMs: 27_000, shotNumber: 9, startMs: 24_000 },
                        ],
                        feedbackPointIndex: 2,
                        mappedShots: [9],
                        resolution: "deterministic" as const,
                      },
                    ],
                id: "53000000-0000-4000-8000-000000000004",
                last_error_code: null,
                last_error_summary: null,
                shots_selected: clarifying ? 0 : 19,
                state: clarifying ? "awaiting_clarification" : "executing",
                storyboards_regenerated: clarifying ? 0 : 1,
                storyboards_reused: clarifying ? 0 : 19,
                storyboards_to_regenerate: clarifying ? 0 : 2,
                target_attempt_number: 2,
                total_shots: clarifying ? 0 : 21,
                version: clarifying ? 7 : 6,
              }
            : null,
          productionRunId: "53000000-0000-4000-8000-000000000001",
          signedMasterUrl: "data:video/mp4;base64,AAAA",
        },
      };
    } else if (query.fixture === "phase2-canceled") {
      fixtureProjection = {
        ...fixtureProjection,
        episode: { ...fixtureProjection.episode, workflowState: "canceled" },
      };
    } else if (query.fixture === "phase2-delivered") {
      fixtureProjection = {
        ...fixtureProjection,
        episode: { ...fixtureProjection.episode, workflowState: "delivered" },
      };
    }
    if (projection.configuration) {
      if (query.fixture === "phase2-divine-look") {
        fixtureProjection = {
          ...projection,
          configuration: {
            ...projection.configuration,
            lookVersionId:
              findLook("divine-fury")?.versionId ??
              "00000000-0000-0000-0000-000000000000",
          },
        };
      } else if (query.fixture === "phase2-advertising-look") {
        fixtureProjection = {
          ...projection,
          configuration: {
            ...projection.configuration,
            lookVersionId:
              findLook("apple-clean-high-key")?.versionId ??
              "00000000-0000-0000-0000-000000000000",
          },
        };
      } else if (query.fixture === "phase2-withdrawn-look") {
        fixtureProjection = {
          ...projection,
          configuration: {
            ...projection.configuration,
            lookAvailabilityStatus: "withdrawn" as const,
          },
        };
      } else if (query.fixture === "phase2-unavailable-look") {
        fixtureProjection = {
          ...projection,
          configuration: {
            ...projection.configuration,
            lookAvailabilityByVersionId: {
              ...projection.configuration.lookAvailabilityByVersionId,
              [projection.configuration.lookVersionId]: "unavailable" as const,
            },
            lookAvailabilityStatus: "unavailable" as const,
          },
        };
      } else if (query.fixture === "phase2-invalid-look") {
        fixtureProjection = {
          ...projection,
          configuration: {
            ...projection.configuration,
            lookVersionId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
          },
        };
      } else if (query.fixture === "phase2-invalid-voice") {
        fixtureProjection = {
          ...projection,
          configuration: {
            ...projection.configuration,
            voiceVersionId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
          },
        };
      } else if (query.fixture === "phase2-missing-voice-status") {
        const {
          [projection.configuration.voiceVersionId]: _missing,
          ...remainingAvailability
        } = projection.configuration.voiceAvailabilityByVersionId;
        void _missing;
        fixtureProjection = {
          ...projection,
          configuration: {
            ...projection.configuration,
            voiceAvailabilityByVersionId: remainingAvailability,
          },
        };
      } else if (query.fixture === "phase2-withdrawn-voice") {
        fixtureProjection = {
          ...projection,
          configuration: {
            ...projection.configuration,
            voiceAvailabilityByVersionId: {
              ...projection.configuration.voiceAvailabilityByVersionId,
              [projection.configuration.voiceVersionId]: "withdrawn" as const,
            },
          },
        };
      } else if (
        query.fixture === "phase2-stale-look" &&
        query.resumeCreation === "look"
      ) {
        fixtureProjection = {
          ...projection,
          configuration: {
            ...projection.configuration,
            aggregateVersion: projection.configuration.aggregateVersion + 1,
            lookVersionId:
              findLook("hard-shadow-grey-editorial")?.versionId ??
              "00000000-0000-0000-0000-000000000000",
          },
          episode: {
            ...projection.episode,
            aggregateVersion: projection.episode.aggregateVersion + 1,
          },
        };
      } else if (
        query.fixture === "phase2-refresh-withdrawn-pins" &&
        query.resumeCreation === "look"
      ) {
        fixtureProjection = {
          ...projection,
          configuration: {
            ...projection.configuration,
            lookAvailabilityStatus: "withdrawn" as const,
            voiceAvailabilityByVersionId: {
              ...projection.configuration.voiceAvailabilityByVersionId,
              [projection.configuration.voiceVersionId]: "withdrawn" as const,
            },
          },
        };
      }
    }
    const initialChamber = preferredInitialChamber(
      fixtureProjection,
      query.resumeCreation,
    );
    return (
      <CreationStudio
        initialChamber={initialChamber}
        key={creationProjectionKey(fixtureProjection)}
        projection={fixtureProjection}
        restoreAuthoritativeLook={initialChamber === "look"}
      />
    );
  }
  if (!hasConfiguredSupabase()) redirect("/");
  const client = await createServerSupabaseClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) redirect("/");
  const projection = await loadCreationProjection(client, user, episodeId);
  if (!projection) notFound();
  const initialChamber = preferredInitialChamber(projection, query.resumeCreation);
  return (
    <CreationStudio
      initialChamber={initialChamber}
      key={creationProjectionKey(projection)}
      projection={projection}
      restoreAuthoritativeLook={initialChamber === "look"}
    />
  );
}

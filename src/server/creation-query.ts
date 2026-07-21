import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";

import {
  projectCreativeChoiceConfirmation,
  type CreationConfiguration,
  type CreationProjection,
  type LookAvailabilityStatus,
} from "@/domain/creation";
import {
  emptyCreationReadinessProjection,
  parseCreationReadinessProjection,
  type CreationWorldProgressItem,
  type WorldBuildProgressState,
} from "@/domain/creation-readiness";
import { LOOKS } from "@/domain/look/look-registry";
import type {
  MvpEditPackageView,
  MvpMasterView,
  MvpProductionJobView,
  MvpRepairProgressView,
} from "@/domain/mvp-production";
import { parseEpisodeWorkflowState, type EpisodeWorkflowState } from "@/domain/studio";

interface EpisodeRow {
  aggregate_version: number | string;
  episode_number: number;
  id: string;
  series_id: string;
  series: { title: string } | readonly { title: string }[] | null;
  title: string;
  workflow_state: EpisodeWorkflowState | string;
  workspace_id: string;
}

interface ScriptRow {
  estimated_duration_seconds: number | string;
  id: string;
  raw_text: string;
  raw_utf8_sha256: string;
  revision_number: number;
}

interface ConfigurationRow {
  aggregate_version: number | string;
  id: string;
  look_confirmed_at: string | null;
  look_confirmed_by: string | null;
  look_version_id: string;
  narrator_gender: "female" | "male";
  performance_profile_id: string;
  voice_confirmed_at: string | null;
  voice_confirmed_by: string | null;
  voice_version_id: string;
}

interface WorldProgressRow {
  created_at: string;
  display_name: string;
  id: string;
  item_key: string;
  item_kind: "character" | "location" | "prop" | "system";
  prompt_text: string | null;
  provider_model: string | null;
  provider_request_id: string | null;
  safe_detail: string;
  sort_order: number | string;
  source_count: number | string;
  state: WorldBuildProgressState;
  updated_at: string;
  world_entity_id: string | null;
}

interface PreflightRunRow {
  created_at: string;
  id: string;
  kind: string;
  run_number: number | string;
  state: string;
}

interface ProductionRunRow {
  id: string;
}

function projectWorldProgress(
  rows: readonly WorldProgressRow[],
): readonly CreationWorldProgressItem[] {
  return rows.map((row) => ({
    createdAt: row.created_at,
    displayName: row.display_name,
    id: row.id,
    itemKey: row.item_key,
    itemKind: row.item_kind,
    promptText: row.prompt_text,
    providerModel: row.provider_model,
    providerRequestId: row.provider_request_id,
    safeDetail: row.safe_detail,
    sortOrder: Number(row.sort_order),
    sourceCount: Number(row.source_count),
    state: row.state,
    updatedAt: row.updated_at,
    worldEntityId: row.world_entity_id,
  }));
}

type VoiceAvailabilityStatus =
  CreationConfiguration["voiceAvailabilityByVersionId"][string];

function seriesTitle(value: EpisodeRow["series"]): string {
  if (Array.isArray(value)) return value[0]?.title ?? "Series";
  return (value as { title: string } | null)?.title ?? "Series";
}

export async function loadCreationProjection(
  client: SupabaseClient,
  _user: User,
  episodeId: string,
): Promise<CreationProjection | null> {
  const { data: episodeData, error: episodeError } = await client
    .from("episodes")
    .select(
      "id,workspace_id,series_id,episode_number,title,workflow_state,aggregate_version,series(title)",
    )
    .eq("id", episodeId)
    .maybeSingle();
  if (episodeError) throw episodeError;
  if (!episodeData) return null;
  const episode = episodeData as unknown as EpisodeRow;

  const [scriptResult, configurationResult, productionJobResult, productionRunResult] =
    await Promise.all([
      client
        .from("script_revisions")
        .select(
          "id,revision_number,raw_text,raw_utf8_sha256,estimated_duration_seconds",
        )
        .eq("workspace_id", episode.workspace_id)
        .eq("episode_id", episode.id)
        .order("revision_number", { ascending: false })
        .limit(1)
        .maybeSingle(),
      client
        .from("episode_configuration_candidates")
        .select(
          "id,aggregate_version,narrator_gender,voice_version_id,look_version_id,performance_profile_id,voice_confirmed_at,voice_confirmed_by,look_confirmed_at,look_confirmed_by",
        )
        .eq("workspace_id", episode.workspace_id)
        .eq("episode_id", episode.id)
        .in("state", ["world_design", "preflight", "ready_to_lock", "locked"])
        .maybeSingle(),
      client
        .from("mvp_production_jobs")
        .select(
          "production_run_id,state,version,attempt_number,total_storyboards,completed_storyboards,total_clips,completed_clips,total_sfx,completed_sfx,last_error_code,last_error_summary",
        )
        .eq("workspace_id", episode.workspace_id)
        .eq("episode_id", episode.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      client
        .from("production_runs")
        .select("id")
        .eq("workspace_id", episode.workspace_id)
        .eq("episode_id", episode.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
  if (scriptResult.error) throw scriptResult.error;
  if (configurationResult.error) throw configurationResult.error;
  if (productionJobResult.error) throw productionJobResult.error;
  if (productionRunResult.error) throw productionRunResult.error;

  const script = scriptResult.data as ScriptRow | null;
  const configuration = configurationResult.data as ConfigurationRow | null;
  const productionJob = productionJobResult.data as MvpProductionJobView | null;
  const productionRun = productionRunResult.data as ProductionRunRow | null;
  const productionMasterResult = productionJob
    ? await client
        .from("mvp_episode_masters")
        .select("id,state,version,duration_ms,width,height,attempt_number,object_name")
        .eq("workspace_id", episode.workspace_id)
        .eq("production_run_id", productionJob.production_run_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null, error: null };
  if (productionMasterResult.error) throw productionMasterResult.error;
  const productionMaster = productionMasterResult.data as MvpMasterView | null;
  const productionPackageResult = productionMaster
    ? await client
        .from("mvp_edit_packages")
        .select(
          "id,master_id,state,version,object_name,byte_length,last_error_code,last_error_summary",
        )
        .eq("workspace_id", episode.workspace_id)
        .eq("master_id", productionMaster.id)
        .maybeSingle()
    : { data: null, error: null };
  if (productionPackageResult.error) throw productionPackageResult.error;
  const productionPackage = productionPackageResult.data as MvpEditPackageView | null;
  const productionRepairResult =
    productionJob && productionJob.attempt_number > 1
      ? await client
          .from("mvp_repair_progress")
          .select(
            "repair_request_id,state,version,target_attempt_number,total_shots,affected_shots,storyboards_reused,storyboards_to_regenerate,storyboards_regenerated,clips_reused,clips_to_regenerate,clips_regenerated,shots_selected,last_error_code,last_error_summary,clarification_id,clarification_question,clarification_round,feedback_points",
          )
          .eq("workspace_id", episode.workspace_id)
          .eq("production_run_id", productionJob.production_run_id)
          .eq("target_attempt_number", productionJob.attempt_number)
          .maybeSingle()
      : { data: null, error: null };
  if (productionRepairResult.error) throw productionRepairResult.error;
  const productionRepair = productionRepairResult.data
    ? ({
        ...productionRepairResult.data,
        id: productionRepairResult.data.repair_request_id,
      } as MvpRepairProgressView)
    : null;
  const [voiceAvailabilityResult, lookAvailabilityResult] = configuration
    ? await Promise.all([
        client.from("voice_version_availability").select("voice_version_id,status"),
        client.from("look_version_availability").select("look_version_id,status"),
      ])
    : [
        { data: null, error: null },
        { data: null, error: null },
      ];
  if (voiceAvailabilityResult.error) throw voiceAvailabilityResult.error;
  if (lookAvailabilityResult.error) throw lookAvailabilityResult.error;
  const voiceAvailability = (voiceAvailabilityResult.data ?? []) as readonly {
    status: VoiceAvailabilityStatus;
    voice_version_id: string;
  }[];
  const lookAvailability = (lookAvailabilityResult.data ?? []) as readonly {
    look_version_id: string;
    status: LookAvailabilityStatus;
  }[];
  const reportedLookAvailabilityByVersionId = Object.fromEntries(
    lookAvailability.map((row) => [row.look_version_id, row.status]),
  );
  // The client receives one fail-closed status for every reviewed registry entry,
  // even if a damaged/partial availability projection omits a database row.
  const lookAvailabilityByVersionId = Object.fromEntries(
    LOOKS.map(({ versionId }) => [
      versionId,
      reportedLookAvailabilityByVersionId[versionId] ?? "unavailable",
    ]),
  );
  const projectedConfiguration: CreationConfiguration | null = configuration
    ? {
        aggregateVersion: Number(configuration.aggregate_version),
        id: configuration.id,
        lookAvailabilityByVersionId,
        lookAvailabilityStatus:
          lookAvailabilityByVersionId[configuration.look_version_id] ?? "unavailable",
        lookConfirmation: projectCreativeChoiceConfirmation(
          configuration.look_confirmed_at,
          configuration.look_confirmed_by,
        ),
        lookVersionId: configuration.look_version_id,
        narratorGender: configuration.narrator_gender,
        performanceProfileId: configuration.performance_profile_id,
        voiceAvailabilityByVersionId: Object.fromEntries(
          voiceAvailability.map((row) => [row.voice_version_id, row.status]),
        ),
        voiceConfirmation: projectCreativeChoiceConfirmation(
          configuration.voice_confirmed_at,
          configuration.voice_confirmed_by,
        ),
        voiceVersionId: configuration.voice_version_id,
      }
    : null;
  const configurationCandidateId = configuration?.id;
  const [readinessResult, sourceReviewResult, preflightRunsResult] =
    configurationCandidateId
      ? await Promise.all([
          client
            .from("creation_readiness_projections")
            .select("world,preflight")
            .eq("workspace_id", episode.workspace_id)
            .eq("configuration_candidate_id", configurationCandidateId)
            .maybeSingle(),
          client
            .from("source_review_readiness_projections")
            .select("source_review")
            .eq("workspace_id", episode.workspace_id)
            .eq("configuration_candidate_id", configurationCandidateId)
            .maybeSingle(),
          client
            .from("preflight_runs")
            .select("id,kind,run_number,state,created_at")
            .eq("workspace_id", episode.workspace_id)
            .eq("configuration_candidate_id", configurationCandidateId)
            .order("run_number", { ascending: false })
            .limit(20),
        ])
      : [
          { data: null, error: null },
          { data: null, error: null },
          { data: null, error: null },
        ];
  if (readinessResult.error) throw readinessResult.error;
  if (sourceReviewResult.error) throw sourceReviewResult.error;
  if (preflightRunsResult.error) throw preflightRunsResult.error;
  const preflightRuns = (preflightRunsResult.data ?? []) as readonly PreflightRunRow[];
  const latestWorldRun = preflightRuns.find((run) => run.kind === "world_anchor");
  const worldProgressResult = latestWorldRun
    ? await client
        .from("world_build_progress_items")
        .select(
          "id,item_key,item_kind,world_entity_id,display_name,state,prompt_text,provider_model,provider_request_id,source_count,sort_order,safe_detail,created_at,updated_at",
        )
        .eq("workspace_id", episode.workspace_id)
        .eq("configuration_candidate_id", configurationCandidateId)
        .eq("preflight_run_id", latestWorldRun.id)
        .order("sort_order", { ascending: true })
    : { data: null, error: null };
  if (worldProgressResult.error) throw worldProgressResult.error;
  const readinessBase = readinessResult.data
    ? parseCreationReadinessProjection({
        ...readinessResult.data,
        preflight: {
          ...(readinessResult.data.preflight as Record<string, unknown>),
          sourceReview: sourceReviewResult.data?.source_review ?? null,
        },
      })
    : emptyCreationReadinessProjection;
  const failureKind = readinessBase.preflight.failure?.stageKey.split(".", 1)[0];
  const latestFailureKindRun = failureKind
    ? preflightRuns.find((run) => run.kind === failureKind)
    : undefined;
  const staleFailure = Boolean(
    readinessBase.preflight.failure &&
    latestFailureKindRun &&
    Date.parse(latestFailureKindRun.created_at) >
      Date.parse(readinessBase.preflight.failure.failedAt),
  );
  const progress = projectWorldProgress(
    (worldProgressResult.data ?? []) as readonly WorldProgressRow[],
  );
  const objectKindByWorldEntityId = new Map(
    progress
      .filter(
        (item) =>
          item.worldEntityId !== null &&
          (item.itemKind === "location" || item.itemKind === "prop"),
      )
      .map((item) => [item.worldEntityId as string, item.itemKind] as const),
  );
  const readiness = {
    ...readinessBase,
    world: {
      ...readinessBase.world,
      locations: readinessBase.world.locations.map((location) => ({
        ...location,
        worldObjectKind:
          objectKindByWorldEntityId.get(location.entityId) === "prop"
            ? ("prop" as const)
            : ("location" as const),
      })),
      progress,
    },
  };

  return {
    configuration: projectedConfiguration,
    episode: {
      aggregateVersion: Number(episode.aggregate_version),
      episodeNumber: episode.episode_number,
      id: episode.id,
      seriesId: episode.series_id,
      seriesTitle: seriesTitle(episode.series),
      title: episode.title,
      workflowState: parseEpisodeWorkflowState(episode.workflow_state),
      workspaceId: episode.workspace_id,
    },
    script: script
      ? {
          estimatedDurationSeconds: Number(script.estimated_duration_seconds),
          id: script.id,
          rawText: script.raw_text,
          rawUtf8Sha256: script.raw_utf8_sha256,
          revisionNumber: script.revision_number,
        }
      : null,
    preflight: staleFailure
      ? { ...readiness.preflight, failure: null }
      : readiness.preflight,
    production: {
      job: productionJob,
      master: productionMaster,
      package: productionPackage,
      repair: productionRepair,
      productionRunId: productionJob?.production_run_id ?? productionRun?.id ?? null,
      signedMasterUrl: null,
    },
    world: readiness.world,
  };
}

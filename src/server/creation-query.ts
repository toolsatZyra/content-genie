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
} from "@/domain/creation-readiness";
import { LOOKS } from "@/domain/look/look-registry";
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

  const [scriptResult, configurationResult] = await Promise.all([
    client
      .from("script_revisions")
      .select("id,revision_number,raw_text,raw_utf8_sha256,estimated_duration_seconds")
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
  ]);
  if (scriptResult.error) throw scriptResult.error;
  if (configurationResult.error) throw configurationResult.error;

  const script = scriptResult.data as ScriptRow | null;
  const configuration = configurationResult.data as ConfigurationRow | null;
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
  const [readinessResult, sourceReviewResult] = configuration
    ? await Promise.all([
        client
          .from("creation_readiness_projections")
          .select("world,preflight")
          .eq("workspace_id", episode.workspace_id)
          .eq("configuration_candidate_id", configuration.id)
          .maybeSingle(),
        client
          .from("source_review_readiness_projections")
          .select("source_review")
          .eq("workspace_id", episode.workspace_id)
          .eq("configuration_candidate_id", configuration.id)
          .maybeSingle(),
      ])
    : [
        { data: null, error: null },
        { data: null, error: null },
      ];
  if (readinessResult.error) throw readinessResult.error;
  if (sourceReviewResult.error) throw sourceReviewResult.error;
  const readiness = readinessResult.data
    ? parseCreationReadinessProjection({
        ...readinessResult.data,
        preflight: {
          ...(readinessResult.data.preflight as Record<string, unknown>),
          sourceReview: sourceReviewResult.data?.source_review ?? null,
        },
      })
    : emptyCreationReadinessProjection;

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
    preflight: readiness.preflight,
    world: readiness.world,
  };
}

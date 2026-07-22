import type { EpisodeWorkflowState } from "@/domain/studio";
import type { CreationProductionProjection } from "@/domain/mvp-production";
import type {
  CreationPreflightProjection,
  CreationWorldProjection,
} from "@/domain/creation-readiness";

export type CreationChamber =
  "script" | "voice" | "look" | "world" | "preflight" | "create";

export type LookAvailabilityStatus = "active" | "unavailable" | "withdrawn";
export type VoiceAvailabilityStatus =
  "pending_authenticated_canary" | "verified" | "withdrawn";

export type CreativeChoiceConfirmation =
  | Readonly<{
      confirmedAt: null;
      confirmedBy: null;
      origin: "system_default";
    }>
  | Readonly<{
      confirmedAt: string;
      confirmedBy: string;
      origin: "human_confirmed";
    }>;

export type ConfigurationConfirmationBlocker =
  | "look_human_confirmation_required"
  | "narration_source_confirmation_required"
  | "voice_human_confirmation_required";

export interface CreationNarrationUpload {
  readonly assetVersionId: string | null;
  readonly comparisonEvidence: Readonly<Record<string, unknown>>;
  readonly durationMs: number | null;
  readonly id: string;
  readonly originalFilename: string;
  readonly state: string;
  readonly transcriptionText: string | null;
}

export interface CreationConfiguration {
  readonly aggregateVersion: number;
  readonly id: string;
  readonly lookAvailabilityByVersionId: Readonly<
    Record<string, LookAvailabilityStatus>
  >;
  /** @deprecated Prefer lookAvailabilityByVersionId for gallery decisions. */
  readonly lookAvailabilityStatus: LookAvailabilityStatus;
  readonly lookConfirmation: CreativeChoiceConfirmation;
  readonly lookVersionId: string;
  readonly narratorGender: "female" | "male";
  readonly narrationSourceConfirmation: CreativeChoiceConfirmation;
  readonly narrationSourceKind: "elevenlabs_v3" | "uploaded_audio";
  readonly narrationUpload: CreationNarrationUpload | null;
  readonly performanceProfileId: string;
  readonly voiceAvailabilityByVersionId: Readonly<
    Record<string, VoiceAvailabilityStatus>
  >;
  readonly voiceConfirmation: CreativeChoiceConfirmation;
  readonly voiceVersionId: string;
}

export interface CreationProjection {
  readonly configuration: CreationConfiguration | null;
  readonly episode: {
    readonly aggregateVersion: number;
    readonly episodeNumber: number;
    readonly id: string;
    readonly seriesId: string;
    readonly seriesTitle: string;
    readonly title: string;
    readonly workflowState: EpisodeWorkflowState;
    readonly workspaceId: string;
  };
  readonly script: {
    readonly estimatedDurationSeconds: number;
    readonly id: string;
    readonly rawText: string;
    readonly rawUtf8Sha256: string;
    readonly revisionNumber: number;
  } | null;
  readonly preflight: CreationPreflightProjection;
  readonly production: CreationProductionProjection;
  readonly world: CreationWorldProjection;
}

export type CreationAccess = "editable" | "read-only" | "closed";

export function projectCreativeChoiceConfirmation(
  confirmedAt: string | null,
  confirmedBy: string | null,
): CreativeChoiceConfirmation {
  if (confirmedAt !== null && confirmedBy !== null) {
    return { confirmedAt, confirmedBy, origin: "human_confirmed" };
  }
  return { confirmedAt: null, confirmedBy: null, origin: "system_default" };
}

export function lookAvailabilityCanBeSelected(
  status: LookAvailabilityStatus | undefined,
): status is "active" {
  return status === "active";
}

export function configurationConfirmationGate(
  configuration: Pick<
    CreationConfiguration,
    | "lookConfirmation"
    | "narrationSourceConfirmation"
    | "narrationSourceKind"
    | "voiceConfirmation"
  >,
): Readonly<{
  blockers: readonly ConfigurationConfirmationBlocker[];
  canProgress: boolean;
}> {
  const blockers: ConfigurationConfirmationBlocker[] = [];
  if (
    configuration.narrationSourceKind === "elevenlabs_v3" &&
    configuration.voiceConfirmation.origin !== "human_confirmed"
  ) {
    blockers.push("voice_human_confirmation_required");
  }
  if (
    configuration.narrationSourceKind === "uploaded_audio" &&
    configuration.narrationSourceConfirmation.origin !== "human_confirmed"
  ) {
    blockers.push("narration_source_confirmation_required");
  }
  if (configuration.lookConfirmation.origin !== "human_confirmed") {
    blockers.push("look_human_confirmation_required");
  }
  return { blockers, canProgress: blockers.length === 0 };
}

export function authoritativeNarrationSourceIsConfirmed(configuration: {
  readonly narrationSourceConfirmedAt: string | null;
  readonly narrationSourceConfirmedBy: string | null;
  readonly narrationSourceKind: "elevenlabs_v3" | "uploaded_audio";
  readonly selectedNarrationUploadVersionId: string | null;
  readonly voiceConfirmedAt: string | null;
  readonly voiceConfirmedBy: string | null;
}): boolean {
  if (configuration.narrationSourceKind === "uploaded_audio") {
    return Boolean(
      configuration.selectedNarrationUploadVersionId &&
      configuration.narrationSourceConfirmedAt &&
      configuration.narrationSourceConfirmedBy,
    );
  }
  return Boolean(configuration.voiceConfirmedAt && configuration.voiceConfirmedBy);
}

export function creationAccessForEpisode(
  workflowState: EpisodeWorkflowState,
): CreationAccess {
  if (workflowState === "draft" || workflowState === "world_setup") {
    return "editable";
  }
  if (workflowState === "canceled" || workflowState === "abandoned") {
    return "closed";
  }
  return "read-only";
}

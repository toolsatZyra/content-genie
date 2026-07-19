export type MembershipRole = "admin" | "reviewer" | "member";

export const episodeWorkflowStates = [
  "draft",
  "world_setup",
  "ready_to_produce",
  "producing",
  "paused",
  "retrying",
  "delayed",
  "blocked",
  "pending_qualified_review",
  "awaiting_final_review",
  "approved",
  "delivered",
  "canceled",
  "abandoned",
  "release_blocked",
] as const;

export type AuthoritativeEpisodeWorkflowState = (typeof episodeWorkflowStates)[number];
export type EpisodeWorkflowState = AuthoritativeEpisodeWorkflowState | "unavailable";
export type EpisodeStateTone = "attention" | "complete" | "draft" | "working";
export type EpisodeSummaryBucket = "attention" | "creating" | "ready";

export interface EpisodeStatePresentation {
  readonly label: string;
  readonly summaryBucket: EpisodeSummaryBucket | null;
  readonly tone: EpisodeStateTone;
}

const episodeStatePresentations = {
  abandoned: { label: "Abandoned", summaryBucket: null, tone: "draft" },
  approved: { label: "Approved", summaryBucket: "ready", tone: "complete" },
  awaiting_final_review: {
    label: "Final review",
    summaryBucket: "attention",
    tone: "attention",
  },
  blocked: { label: "Blocked", summaryBucket: "attention", tone: "attention" },
  canceled: { label: "Canceled", summaryBucket: null, tone: "draft" },
  delayed: { label: "Delayed", summaryBucket: null, tone: "attention" },
  delivered: { label: "Delivered", summaryBucket: "ready", tone: "complete" },
  draft: { label: "Draft", summaryBucket: null, tone: "draft" },
  paused: { label: "Paused", summaryBucket: null, tone: "attention" },
  pending_qualified_review: {
    label: "Qualified review",
    summaryBucket: "attention",
    tone: "attention",
  },
  producing: { label: "Creating", summaryBucket: "creating", tone: "working" },
  ready_to_produce: { label: "Ready to produce", summaryBucket: null, tone: "draft" },
  release_blocked: {
    label: "Release blocked",
    summaryBucket: "attention",
    tone: "attention",
  },
  retrying: { label: "Retrying", summaryBucket: "creating", tone: "working" },
  unavailable: {
    label: "Unavailable",
    summaryBucket: null,
    tone: "attention",
  },
  world_setup: { label: "World design", summaryBucket: null, tone: "draft" },
} as const satisfies Record<EpisodeWorkflowState, EpisodeStatePresentation>;

export interface WorkspaceSummary {
  readonly authorityEpoch: number;
  readonly id: string;
  readonly name: string;
  readonly role: MembershipRole;
  readonly slug: string;
}

export type SeriesLifecycleState = "active" | "archived" | "unavailable";
export type SeriesReleaseStatus = "active" | "superseded" | "withdrawn";

export type ActiveSeriesReleaseProjection =
  | Readonly<{
      kind: "released";
      id: string;
      releaseNumber: number;
      status: SeriesReleaseStatus;
      look: Readonly<{
        availabilityStatus: "active" | "withdrawn";
        id: string;
        key: string;
        name: string;
      }>;
      voice: Readonly<{
        availabilityStatus: "pending_authenticated_canary" | "verified" | "withdrawn";
        gender: "female" | "male";
        id: string;
        key: string;
      }>;
      continuity: Readonly<{
        id: string;
        versionNumber: number;
      }> | null;
    }>
  | Readonly<{
      kind: "unavailable";
      reason: "continuity" | "look" | "release" | "voice";
      releaseId: string | null;
    }>
  | Readonly<{
      kind: "unreleased";
    }>;

export interface SeriesSummary {
  /**
   * Absent only on legacy/partial projections. Consumers must treat absence as
   * unavailable, never as an unreleased Series.
   */
  readonly activeRelease?: ActiveSeriesReleaseProjection;
  readonly aggregateVersion: number;
  readonly description: string;
  readonly id: string;
  readonly state: SeriesLifecycleState;
  readonly title: string;
  readonly updatedAt: string;
}

export interface EpisodeSummary {
  readonly aggregateVersion: number;
  readonly costEstimateMinor: number | null;
  readonly createdAt: string;
  readonly currency: string | null;
  readonly episodeNumber: number;
  readonly id: string;
  readonly ownerUserId: string;
  readonly progressPercent: number;
  readonly seriesId: string;
  readonly summary: string;
  readonly title: string;
  readonly updatedAt: string;
  readonly workflowState: EpisodeWorkflowState;
}

export interface WorkSummary {
  readonly deepLink: string;
  readonly id: string;
  readonly kind: string;
  readonly safeSummary: string;
  readonly state: string;
}

export interface NotificationSummary {
  readonly createdAt: string;
  readonly deepLink: string;
  readonly id: string;
  readonly readAt: string | null;
  readonly safeSummary: string;
  readonly title: string;
}

export interface ActivitySummary {
  readonly aggregateType: string;
  readonly createdAt: string;
  readonly eventType: string;
  readonly id: string;
}

export interface StudioProjection {
  readonly activities: readonly ActivitySummary[];
  readonly displayName: string;
  readonly episodes: readonly EpisodeSummary[];
  readonly notifications: readonly NotificationSummary[];
  readonly series: readonly SeriesSummary[];
  readonly userEmail: string;
  readonly userId: string;
  readonly work: readonly WorkSummary[];
  readonly workspace: WorkspaceSummary;
  readonly workspaces: readonly WorkspaceSummary[];
}

export function roleRank(role: MembershipRole): number {
  return role === "admin" ? 30 : role === "reviewer" ? 20 : 10;
}

export function episodeStatePresentation(
  state: EpisodeWorkflowState,
): EpisodeStatePresentation {
  return episodeStatePresentations[state];
}

export function parseEpisodeWorkflowState(value: unknown): EpisodeWorkflowState {
  return typeof value === "string" &&
    episodeWorkflowStates.includes(value as AuthoritativeEpisodeWorkflowState)
    ? (value as AuthoritativeEpisodeWorkflowState)
    : "unavailable";
}

export function parseSeriesLifecycleState(value: unknown): SeriesLifecycleState {
  return value === "active" || value === "archived" ? value : "unavailable";
}

export function canCreateEpisodeInSeries(series: SeriesSummary): boolean {
  return episodeCreationBlocker(series) === null;
}

export function episodeCreationBlocker(series: SeriesSummary): string | null {
  if (series.state === "archived") return "Archived Series";
  if (series.state !== "active") return "Series lifecycle unavailable";

  const release = series.activeRelease;
  if (!release) return "Series Release unavailable";
  if (release.kind === "unreleased") return null;
  if (release.kind === "unavailable") {
    if (release.reason === "look") return "Pinned look unavailable";
    if (release.reason === "voice") return "Pinned voice unavailable";
    if (release.reason === "continuity") return "Pinned continuity unavailable";
    return "Series Release unavailable";
  }
  if (release.status === "superseded") return "Series Release superseded";
  if (release.status === "withdrawn") return "Series Release withdrawn";
  if (release.look.availabilityStatus === "withdrawn") {
    return "Pinned look withdrawn";
  }
  if (release.voice.availabilityStatus === "withdrawn") {
    return "Pinned voice withdrawn";
  }
  return null;
}

export function canArchiveSeries(series: SeriesSummary): boolean {
  return (
    series.state === "active" &&
    series.activeRelease !== undefined &&
    series.activeRelease.kind !== "unavailable"
  );
}

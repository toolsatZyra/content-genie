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

export type EpisodeWorkflowState = (typeof episodeWorkflowStates)[number];
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
  world_setup: { label: "World design", summaryBucket: null, tone: "draft" },
} as const satisfies Record<EpisodeWorkflowState, EpisodeStatePresentation>;

export interface WorkspaceSummary {
  readonly authorityEpoch: number;
  readonly id: string;
  readonly name: string;
  readonly role: MembershipRole;
  readonly slug: string;
}

export interface SeriesSummary {
  readonly aggregateVersion: number;
  readonly description: string;
  readonly id: string;
  readonly state: "active" | "archived";
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
    episodeWorkflowStates.includes(value as EpisodeWorkflowState)
    ? (value as EpisodeWorkflowState)
    : "draft";
}

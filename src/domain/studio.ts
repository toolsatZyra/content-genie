export type MembershipRole = "admin" | "reviewer" | "member";

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
  readonly workflowState: string;
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

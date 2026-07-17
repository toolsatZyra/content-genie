import type { StudioProjection } from "@/domain/studio";

const workspaceId = "10000000-0000-4000-8000-000000000001";
const userId = "10000000-0000-4000-8000-000000000002";
const seriesId = "10000000-0000-4000-8000-000000000003";

export function deterministicStudioProjection(): StudioProjection {
  return {
    activities: [
      {
        aggregateType: "episode",
        createdAt: "2026-07-17T00:00:00.000Z",
        eventType: "episode.created.v1",
        id: "10000000-0000-4000-8000-000000000009",
      },
    ],
    displayName: "Studio Reviewer",
    episodes: [
      {
        aggregateVersion: 1,
        costEstimateMinor: null,
        createdAt: "2026-07-17T00:00:00.000Z",
        currency: null,
        episodeNumber: 1,
        id: "10000000-0000-4000-8000-000000000004",
        ownerUserId: userId,
        progressPercent: 0,
        seriesId,
        summary: "How Ganga descended through Shiva's matted locks.",
        title: "When Ganga Met the Mountain",
        updatedAt: "2026-07-17T00:00:00.000Z",
        workflowState: "world_setup",
      },
      {
        aggregateVersion: 3,
        costEstimateMinor: 4200,
        createdAt: "2026-07-17T00:00:00.000Z",
        currency: "USD",
        episodeNumber: 2,
        id: "10000000-0000-4000-8000-000000000005",
        ownerUserId: userId,
        progressPercent: 72,
        seriesId,
        summary: "The moment Shiva opened the inner eye.",
        title: "The Fire Beyond Sight",
        updatedAt: "2026-07-17T01:00:00.000Z",
        workflowState: "pending_qualified_review",
      },
    ],
    notifications: [
      {
        createdAt: "2026-07-17T01:00:00.000Z",
        deepLink: "/episodes/10000000-0000-4000-8000-000000000005",
        id: "10000000-0000-4000-8000-000000000008",
        readAt: null,
        safeSummary: "A cultural review is waiting.",
        title: "Episode needs you",
      },
    ],
    series: [
      {
        aggregateVersion: 2,
        description: "Stories of stillness, force and cosmic compassion.",
        id: seriesId,
        state: "active",
        title: "Shiva: The Infinite",
        updatedAt: "2026-07-17T00:00:00.000Z",
      },
    ],
    userEmail: "reviewer@example.test",
    userId,
    work: [
      {
        deepLink: "/episodes/10000000-0000-4000-8000-000000000005",
        id: "10000000-0000-4000-8000-000000000007",
        kind: "qualified.cultural.review",
        safeSummary: "Review the theological framing and visual treatment.",
        state: "open",
      },
    ],
    workspace: {
      authorityEpoch: 1,
      id: workspaceId,
      name: "Zyra Internal",
      role: "admin",
      slug: "zyra-internal",
    },
    workspaces: [
      {
        authorityEpoch: 1,
        id: workspaceId,
        name: "Zyra Internal",
        role: "admin",
        slug: "zyra-internal",
      },
    ],
  };
}

import {
  episodeWorkflowStates,
  type EpisodeWorkflowState,
  type StudioProjection,
} from "@/domain/studio";

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
        activeRelease: {
          continuity: {
            id: "10000000-0000-4000-8000-00000000000c",
            versionNumber: 3,
          },
          id: "10000000-0000-4000-8000-00000000000b",
          kind: "released",
          look: {
            availabilityStatus: "active",
            id: "10000000-0000-4000-8000-00000000000d",
            key: "divine-realism",
            name: "Divine Realism",
          },
          releaseNumber: 2,
          status: "active",
          voice: {
            availabilityStatus: "verified",
            gender: "male",
            id: "ec4e61a6-dc45-53d9-ba4b-fd5c7f267b2f",
            key: "elevenlabs-male-hindi-devotional-v1",
          },
        },
        aggregateVersion: 2,
        description: "Stories of stillness, force and cosmic compassion.",
        id: seriesId,
        state: "active",
        title: "Shiva: The Infinite",
        updatedAt: "2026-07-17T00:00:00.000Z",
      },
      {
        activeRelease: { kind: "unreleased" },
        aggregateVersion: 1,
        description: "\"'><svg/onload=globalThis.__genieXss=1>",
        id: "10000000-0000-4000-8000-00000000000a",
        state: "active",
        title: "</script><img src=x onerror=globalThis.__genieXss=1>",
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

const scenarioTitles: Partial<Record<EpisodeWorkflowState, string>> = {
  approved: "Happy path approved",
  producing: "Resumed production",
};

export function deterministicStateMatrixProjection(): StudioProjection {
  const projection = deterministicStudioProjection();
  const template = projection.episodes[0]!;
  return {
    ...projection,
    episodes: episodeWorkflowStates.map((workflowState, index) => ({
      ...template,
      aggregateVersion: index + 1,
      costEstimateMinor: index % 3 === 0 ? null : 2500 + index * 100,
      episodeNumber: index + 1,
      id: `10000000-0000-4000-8000-0000000000${(32 + index)
        .toString(16)
        .padStart(2, "0")}`,
      progressPercent: Math.round((index / (episodeWorkflowStates.length - 1)) * 100),
      summary: `Deterministic ${workflowState} acceptance fixture.`,
      title:
        scenarioTitles[workflowState] ?? `State: ${workflowState.replaceAll("_", " ")}`,
      updatedAt: new Date(Date.UTC(2026, 6, 17, index)).toISOString(),
      workflowState,
    })),
    notifications: [],
    work: [],
  };
}

export function deterministicEmptyStudioProjection(): StudioProjection {
  const projection = deterministicStudioProjection();
  return {
    ...projection,
    activities: [],
    episodes: [],
    notifications: [],
    series: [],
    work: [],
  };
}

export function deterministicUnavailableStudioProjection(): StudioProjection {
  const projection = deterministicStudioProjection();
  return {
    ...projection,
    episodes: projection.episodes.map((episode, index) =>
      index === 0 ? { ...episode, workflowState: "unavailable" } : episode,
    ),
    series: projection.series.map((series, index) =>
      index === 0
        ? { ...series, state: "unavailable" }
        : {
            ...series,
            activeRelease: {
              kind: "unavailable",
              reason: "release",
              releaseId: "10000000-0000-4000-8000-0000000000ff",
            },
          },
    ),
  };
}

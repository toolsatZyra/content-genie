import "server-only";

import type { PostgrestResponse, SupabaseClient, User } from "@supabase/supabase-js";

import type {
  ActiveSeriesReleaseProjection,
  ActivitySummary,
  EpisodeSummary,
  MembershipRole,
  NotificationSummary,
  SeriesSummary,
  StudioProjection,
  WorkspaceSummary,
  WorkSummary,
} from "@/domain/studio";
import { parseEpisodeWorkflowState, parseSeriesLifecycleState } from "@/domain/studio";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type UnknownRow = Record<string, unknown>;

function text(row: UnknownRow, key: string, fallback = ""): string {
  return typeof row[key] === "string" ? row[key] : fallback;
}

function numberValue(row: UnknownRow, key: string, fallback = 0): number {
  const value = row[key];
  return typeof value === "number" ? value : Number(value ?? fallback);
}

function nullableNumber(row: UnknownRow, key: string): number | null {
  return row[key] === null || row[key] === undefined ? null : numberValue(row, key);
}

function positiveInteger(row: UnknownRow, key: string): number | null {
  const value = numberValue(row, key, Number.NaN);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function nestedRow(value: unknown): UnknownRow {
  if (Array.isArray(value)) return (value[0] as UnknownRow | undefined) ?? {};
  return value && typeof value === "object" ? (value as UnknownRow) : {};
}

function asRole(value: unknown): MembershipRole {
  return value === "admin" || value === "reviewer" ? value : "member";
}

interface ActiveReleaseRows {
  readonly continuities: readonly UnknownRow[];
  readonly lookAvailabilities: readonly UnknownRow[];
  readonly looks: readonly UnknownRow[];
  readonly releases: readonly UnknownRow[];
  readonly statuses: readonly UnknownRow[];
  readonly voiceAvailabilities: readonly UnknownRow[];
  readonly voices: readonly UnknownRow[];
}

function rowsByTextKey(
  rows: readonly UnknownRow[],
  key: string,
): ReadonlyMap<string, UnknownRow> {
  return new Map(
    rows.flatMap((row) => {
      const value = text(row, key);
      return value ? [[value, row] as const] : [];
    }),
  );
}

function projectActiveRelease(
  seriesRow: UnknownRow,
  rows: ActiveReleaseRows,
): ActiveSeriesReleaseProjection {
  if (seriesRow.active_release_id === null) return { kind: "unreleased" };
  const releaseId = text(seriesRow, "active_release_id");
  if (!releaseId) {
    return { kind: "unavailable", reason: "release", releaseId: null };
  }

  const releasesById = rowsByTextKey(rows.releases, "id");
  const statusesByReleaseId = rowsByTextKey(rows.statuses, "release_id");
  const looksById = rowsByTextKey(rows.looks, "id");
  const lookAvailabilityById = rowsByTextKey(
    rows.lookAvailabilities,
    "look_version_id",
  );
  const continuitiesById = rowsByTextKey(rows.continuities, "id");
  const voicesById = rowsByTextKey(rows.voices, "id");
  const voiceAvailabilityById = rowsByTextKey(
    rows.voiceAvailabilities,
    "voice_version_id",
  );
  const release = releasesById.get(releaseId);
  const releaseNumber = release ? positiveInteger(release, "release_number") : null;
  const statusValue = text(statusesByReleaseId.get(releaseId) ?? {}, "status");
  if (
    !release ||
    text(release, "series_id") !== text(seriesRow, "id") ||
    releaseNumber === null ||
    !["active", "superseded", "withdrawn"].includes(statusValue)
  ) {
    return { kind: "unavailable", reason: "release", releaseId };
  }

  if (numberValue(release, "creative_identity_schema_version", 0) !== 1) {
    return { kind: "unavailable", reason: "release", releaseId };
  }

  const lookId = text(release, "look_version_id");
  const lookRow = looksById.get(lookId);
  const availabilityStatus = text(lookAvailabilityById.get(lookId) ?? {}, "status");
  if (
    !lookId ||
    !lookRow ||
    !text(lookRow, "look_key") ||
    !text(lookRow, "name") ||
    (availabilityStatus !== "active" && availabilityStatus !== "withdrawn")
  ) {
    return { kind: "unavailable", reason: "look", releaseId };
  }
  const look = {
    availabilityStatus,
    id: lookId,
    key: text(lookRow, "look_key"),
    name: text(lookRow, "name"),
  } as const;

  const voiceId = text(release, "voice_version_id");
  const narratorGender = text(release, "narrator_gender");
  const voiceRow = voicesById.get(voiceId);
  const voiceAvailabilityStatus = text(
    voiceAvailabilityById.get(voiceId) ?? {},
    "status",
  );
  if (
    !voiceId ||
    !voiceRow ||
    !text(voiceRow, "voice_key") ||
    (narratorGender !== "female" && narratorGender !== "male") ||
    text(voiceRow, "gender") !== narratorGender ||
    !["verified", "pending_authenticated_canary", "withdrawn"].includes(
      voiceAvailabilityStatus,
    )
  ) {
    return { kind: "unavailable", reason: "voice", releaseId };
  }
  const voice = {
    availabilityStatus: voiceAvailabilityStatus as
      "verified" | "pending_authenticated_canary" | "withdrawn",
    gender: narratorGender,
    id: voiceId,
    key: text(voiceRow, "voice_key"),
  } as const;

  let continuity: Extract<
    ActiveSeriesReleaseProjection,
    { kind: "released" }
  >["continuity"] = null;
  if (release.continuity_state_version_id !== null) {
    const continuityId = text(release, "continuity_state_version_id");
    const continuityRow = continuitiesById.get(continuityId);
    const versionNumber = continuityRow
      ? positiveInteger(continuityRow, "version_no")
      : null;
    if (
      !continuityId ||
      !continuityRow ||
      text(continuityRow, "series_id") !== text(seriesRow, "id") ||
      versionNumber === null
    ) {
      return { kind: "unavailable", reason: "continuity", releaseId };
    }
    continuity = { id: continuityId, versionNumber };
  }

  return {
    continuity,
    id: releaseId,
    kind: "released",
    look,
    releaseNumber,
    status: statusValue as "active" | "superseded" | "withdrawn",
    voice,
  };
}

export function projectSeriesSummaries(
  seriesRows: readonly UnknownRow[],
  activeReleaseRows: ActiveReleaseRows,
): readonly SeriesSummary[] {
  return seriesRows.map((row): SeriesSummary => ({
    activeRelease: projectActiveRelease(row, activeReleaseRows),
    aggregateVersion: numberValue(row, "aggregate_version", 1),
    description: text(row, "description"),
    id: text(row, "id"),
    state: parseSeriesLifecycleState(row.state),
    title: text(row, "title"),
    updatedAt: text(row, "updated_at"),
  }));
}

async function loadActiveReleaseRows(
  client: SupabaseClient,
  workspaceId: string,
  seriesRows: readonly UnknownRow[],
): Promise<ActiveReleaseRows> {
  const releaseIds = seriesRows.flatMap((row) => {
    const id = text(row, "active_release_id");
    return id ? [id] : [];
  });
  if (releaseIds.length === 0) {
    return {
      continuities: [],
      lookAvailabilities: [],
      looks: [],
      releases: [],
      statuses: [],
      voiceAvailabilities: [],
      voices: [],
    };
  }

  const releasesResult = await client
    .from("series_releases")
    .select(
      "id,series_id,release_number,creative_identity_schema_version,look_version_id,continuity_state_version_id,narrator_gender,voice_version_id",
    )
    .eq("workspace_id", workspaceId)
    .in("id", releaseIds);
  if (releasesResult.error) throw releasesResult.error;
  const releases = (releasesResult.data ?? []) as UnknownRow[];
  const lookIds = releases.flatMap((row) => {
    const id = text(row, "look_version_id");
    return id ? [id] : [];
  });
  const continuityIds = releases.flatMap((row) => {
    const id = text(row, "continuity_state_version_id");
    return id ? [id] : [];
  });
  const voiceIds = releases.flatMap((row) => {
    const id = text(row, "voice_version_id");
    return id ? [id] : [];
  });

  const [
    statusesResult,
    looksResult,
    lookAvailabilitiesResult,
    continuitiesResult,
    voicesResult,
    voiceAvailabilitiesResult,
  ] = await Promise.all([
    client
      .from("series_release_statuses")
      .select("release_id,status")
      .eq("workspace_id", workspaceId)
      .in("release_id", releaseIds),
    lookIds.length > 0
      ? client.from("look_versions").select("id,look_key,name").in("id", lookIds)
      : Promise.resolve({ data: [], error: null }),
    lookIds.length > 0
      ? client
          .from("look_version_availability")
          .select("look_version_id,status")
          .in("look_version_id", lookIds)
      : Promise.resolve({ data: [], error: null }),
    continuityIds.length > 0
      ? client
          .from("continuity_state_versions")
          .select("id,series_id,version_no")
          .eq("workspace_id", workspaceId)
          .in("id", continuityIds)
      : Promise.resolve({ data: [], error: null }),
    voiceIds.length > 0
      ? client.from("voice_versions").select("id,voice_key,gender").in("id", voiceIds)
      : Promise.resolve({ data: [], error: null }),
    voiceIds.length > 0
      ? client
          .from("voice_version_availability")
          .select("voice_version_id,status")
          .in("voice_version_id", voiceIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const failure = [
    statusesResult,
    looksResult,
    lookAvailabilitiesResult,
    continuitiesResult,
    voicesResult,
    voiceAvailabilitiesResult,
  ].find((result) => result.error)?.error;
  if (failure) throw failure;
  return {
    continuities: (continuitiesResult.data ?? []) as UnknownRow[],
    lookAvailabilities: (lookAvailabilitiesResult.data ?? []) as UnknownRow[],
    looks: (looksResult.data ?? []) as UnknownRow[],
    releases,
    statuses: (statusesResult.data ?? []) as UnknownRow[],
    voiceAvailabilities: (voiceAvailabilitiesResult.data ?? []) as UnknownRow[],
    voices: (voicesResult.data ?? []) as UnknownRow[],
  };
}

export async function loadAssignedWorkProjectionRows(
  client: SupabaseClient,
  workspaceId: string,
  userId: string,
): Promise<PostgrestResponse<UnknownRow>> {
  return await client
    .from("work_items")
    .select("id,kind,state,safe_summary,deep_link")
    .eq("workspace_id", workspaceId)
    .eq("assigned_user_id", userId)
    .in("state", ["open", "claimed"])
    .order("created_at", { ascending: false })
    .limit(50);
}

export async function loadStudioProjection(
  user: User,
  requestedWorkspaceId?: string,
): Promise<StudioProjection | null> {
  const client = await createServerSupabaseClient();
  const membershipsResult = await client
    .from("memberships")
    .select("workspace_id, role, authority_epoch, workspaces(id,name,slug,state)")
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("created_at", { ascending: true });

  if (membershipsResult.error) throw membershipsResult.error;

  const workspaces = ((membershipsResult.data ?? []) as UnknownRow[])
    .map((membership): WorkspaceSummary | null => {
      const workspace = nestedRow(membership.workspaces);
      const id = text(workspace, "id");
      if (!id || text(workspace, "state") !== "active") return null;
      return {
        authorityEpoch: numberValue(membership, "authority_epoch", 1),
        id,
        name: text(workspace, "name", "Workspace"),
        role: asRole(membership.role),
        slug: text(workspace, "slug"),
      };
    })
    .filter((workspace): workspace is WorkspaceSummary => workspace !== null);

  if (workspaces.length === 0) return null;
  const workspace =
    workspaces.find(({ id }) => id === requestedWorkspaceId) ?? workspaces[0]!;

  const [profile, series, episodes, work, notifications, activities] =
    await Promise.all([
      client
        .from("profiles")
        .select("display_name")
        .eq("user_id", user.id)
        .maybeSingle(),
      client
        .from("series")
        .select(
          "id,title,description,state,active_release_id,aggregate_version,updated_at",
        )
        .eq("workspace_id", workspace.id)
        .order("updated_at", { ascending: false })
        .limit(100),
      client
        .from("episodes")
        .select(
          "id,series_id,episode_number,title,summary,workflow_state,owner_user_id,aggregate_version,progress_percent,cost_estimate_minor,currency,created_at,updated_at",
        )
        .eq("workspace_id", workspace.id)
        .is("archived_at", null)
        .order("updated_at", { ascending: false })
        .limit(200),
      loadAssignedWorkProjectionRows(client, workspace.id, user.id),
      client
        .from("notifications")
        .select("id,title,safe_summary,deep_link,read_at,created_at")
        .eq("workspace_id", workspace.id)
        .order("created_at", { ascending: false })
        .limit(50),
      client
        .from("domain_events")
        .select("id,event_type,aggregate_type,occurred_at")
        .eq("workspace_id", workspace.id)
        .order("occurred_at", { ascending: false })
        .limit(50),
    ]);

  const failures = [profile, series, episodes, work, notifications, activities]
    .map((result) => result.error)
    .filter(Boolean);
  if (failures.length > 0) throw failures[0];
  const seriesRows = (series.data ?? []) as UnknownRow[];
  const activeReleaseRows = await loadActiveReleaseRows(
    client,
    workspace.id,
    seriesRows,
  );

  return {
    activities: ((activities.data ?? []) as UnknownRow[]).map(
      (row): ActivitySummary => ({
        aggregateType: text(row, "aggregate_type"),
        createdAt: text(row, "occurred_at"),
        eventType: text(row, "event_type"),
        id: text(row, "id"),
      }),
    ),
    displayName:
      text((profile.data as UnknownRow | null) ?? {}, "display_name") ||
      user.email?.split("@")[0] ||
      "Studio member",
    episodes: ((episodes.data ?? []) as UnknownRow[]).map((row): EpisodeSummary => ({
      aggregateVersion: numberValue(row, "aggregate_version", 1),
      costEstimateMinor: nullableNumber(row, "cost_estimate_minor"),
      createdAt: text(row, "created_at"),
      currency: row.currency === null ? null : text(row, "currency"),
      episodeNumber: numberValue(row, "episode_number"),
      id: text(row, "id"),
      ownerUserId: text(row, "owner_user_id"),
      progressPercent: numberValue(row, "progress_percent"),
      seriesId: text(row, "series_id"),
      summary: text(row, "summary"),
      title: text(row, "title"),
      updatedAt: text(row, "updated_at"),
      workflowState: parseEpisodeWorkflowState(row.workflow_state),
    })),
    notifications: ((notifications.data ?? []) as UnknownRow[]).map(
      (row): NotificationSummary => ({
        createdAt: text(row, "created_at"),
        deepLink: text(row, "deep_link"),
        id: text(row, "id"),
        readAt: row.read_at === null ? null : text(row, "read_at"),
        safeSummary: text(row, "safe_summary"),
        title: text(row, "title"),
      }),
    ),
    series: projectSeriesSummaries(seriesRows, activeReleaseRows),
    userEmail: user.email ?? "",
    userId: user.id,
    work: ((work.data ?? []) as UnknownRow[]).map((row): WorkSummary => ({
      deepLink: text(row, "deep_link"),
      id: text(row, "id"),
      kind: text(row, "kind"),
      safeSummary: text(row, "safe_summary"),
      state: text(row, "state"),
    })),
    workspace,
    workspaces,
  };
}

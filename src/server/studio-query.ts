import "server-only";

import type { PostgrestResponse, SupabaseClient, User } from "@supabase/supabase-js";

import type {
  ActivitySummary,
  EpisodeSummary,
  MembershipRole,
  NotificationSummary,
  SeriesSummary,
  StudioProjection,
  WorkspaceSummary,
  WorkSummary,
} from "@/domain/studio";
import { parseEpisodeWorkflowState } from "@/domain/studio";
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

function nestedRow(value: unknown): UnknownRow {
  if (Array.isArray(value)) return (value[0] as UnknownRow | undefined) ?? {};
  return value && typeof value === "object" ? (value as UnknownRow) : {};
}

function asRole(value: unknown): MembershipRole {
  return value === "admin" || value === "reviewer" ? value : "member";
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
        .select("id,title,description,state,aggregate_version,updated_at")
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
    series: ((series.data ?? []) as UnknownRow[]).map((row): SeriesSummary => ({
      aggregateVersion: numberValue(row, "aggregate_version", 1),
      description: text(row, "description"),
      id: text(row, "id"),
      state: text(row, "state") === "archived" ? "archived" : "active",
      title: text(row, "title"),
      updatedAt: text(row, "updated_at"),
    })),
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

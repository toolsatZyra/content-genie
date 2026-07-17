import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  parseEpisodeWorkflowState,
  type EpisodeSummary,
  type SeriesSummary,
} from "@/domain/studio";
import type { StudioSearchCursor, StudioSearchPage } from "@/domain/studio-search";

const searchPageSize = 12;
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

function seriesFromRow(row: UnknownRow): SeriesSummary {
  return {
    aggregateVersion: numberValue(row, "aggregate_version", 1),
    description: text(row, "description"),
    id: text(row, "id"),
    state: text(row, "state") === "archived" ? "archived" : "active",
    title: text(row, "title"),
    updatedAt: text(row, "updated_at"),
  };
}

function episodeFromRow(row: UnknownRow): EpisodeSummary {
  return {
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
  };
}

export async function hasActiveWorkspaceMembership(
  client: SupabaseClient,
  workspaceId: string,
  userId: string,
): Promise<boolean> {
  const result = await client
    .from("memberships")
    .select("workspace_id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (result.error) throw result.error;
  return Boolean(result.data);
}

export async function searchAuthorizedStudio(
  client: SupabaseClient,
  workspaceId: string,
  query: string,
  cursor: StudioSearchCursor = { episodeOffset: 0, seriesOffset: 0 },
): Promise<StudioSearchPage> {
  const [seriesResult, episodesResult] = await Promise.all([
    client
      .from("series")
      .select("id,title,description,state,aggregate_version,updated_at", {
        count: "exact",
      })
      .eq("workspace_id", workspaceId)
      .textSearch("search_document", query, { config: "simple", type: "websearch" })
      .order("updated_at", { ascending: false })
      .order("id", { ascending: true })
      .range(cursor.seriesOffset, cursor.seriesOffset + searchPageSize - 1),
    client
      .from("episodes")
      .select(
        "id,series_id,episode_number,title,summary,workflow_state,owner_user_id,aggregate_version,progress_percent,cost_estimate_minor,currency,created_at,updated_at",
        { count: "exact" },
      )
      .eq("workspace_id", workspaceId)
      .is("archived_at", null)
      .textSearch("search_document", query, { config: "simple", type: "websearch" })
      .order("updated_at", { ascending: false })
      .order("id", { ascending: true })
      .range(cursor.episodeOffset, cursor.episodeOffset + searchPageSize - 1),
  ]);
  if (seriesResult.error) throw seriesResult.error;
  if (episodesResult.error) throw episodesResult.error;

  const series = ((seriesResult.data ?? []) as UnknownRow[]).map(seriesFromRow);
  const episodes = ((episodesResult.data ?? []) as UnknownRow[]).map(episodeFromRow);
  const seriesIds = [...new Set(episodes.map(({ seriesId }) => seriesId))];
  let relatedSeries: SeriesSummary[] = [];
  if (seriesIds.length > 0) {
    const relatedResult = await client
      .from("series")
      .select("id,title,description,state,aggregate_version,updated_at")
      .eq("workspace_id", workspaceId)
      .in("id", seriesIds);
    if (relatedResult.error) throw relatedResult.error;
    relatedSeries = ((relatedResult.data ?? []) as UnknownRow[]).map(seriesFromRow);
  }
  const seriesById = new Map(
    [...series, ...relatedSeries].map((item) => [item.id, item] as const),
  );
  const episodeMatches = episodes.flatMap((episode) => {
    const parentSeries = seriesById.get(episode.seriesId);
    return parentSeries
      ? [
          {
            episode,
            id: episode.id,
            kind: "Episode" as const,
            label: episode.title,
            series: parentSeries,
          },
        ]
      : [];
  });
  const nextCursor = {
    episodeOffset: cursor.episodeOffset + episodes.length,
    seriesOffset: cursor.seriesOffset + series.length,
  };
  const seriesCount = seriesResult.count ?? series.length;
  const episodeCount = episodesResult.count ?? episodes.length;
  const hasMore =
    nextCursor.seriesOffset < seriesCount || nextCursor.episodeOffset < episodeCount;

  return {
    matches: [
      ...series.map((item) => ({
        id: item.id,
        kind: "Series" as const,
        label: item.title,
        series: item,
      })),
      ...episodeMatches,
    ],
    nextCursor: hasMore ? nextCursor : null,
    total: seriesCount + episodeCount,
  };
}

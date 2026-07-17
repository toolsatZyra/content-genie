import type { EpisodeSummary, SeriesSummary } from "@/domain/studio";

export interface StudioSearchCursor {
  readonly episodeOffset: number;
  readonly seriesOffset: number;
}

export interface EpisodeSearchMatch {
  readonly episode: EpisodeSummary;
  readonly id: string;
  readonly kind: "Episode";
  readonly label: string;
  readonly series: SeriesSummary;
}

export interface SeriesSearchMatch {
  readonly id: string;
  readonly kind: "Series";
  readonly label: string;
  readonly series: SeriesSummary;
}

export type StudioSearchMatch = EpisodeSearchMatch | SeriesSearchMatch;

export interface StudioSearchPage {
  readonly matches: readonly StudioSearchMatch[];
  readonly nextCursor: StudioSearchCursor | null;
  readonly total: number;
}

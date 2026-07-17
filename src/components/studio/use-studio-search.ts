"use client";

import { useEffect, useRef, useState } from "react";

import type {
  StudioSearchCursor,
  StudioSearchMatch,
  StudioSearchPage,
} from "@/domain/studio-search";

interface SearchState {
  readonly error: string;
  readonly loading: boolean;
  readonly matches: readonly StudioSearchMatch[];
  readonly nextCursor: StudioSearchCursor | null;
  readonly searchKey: string;
  readonly total: number;
}

const idleState: SearchState = {
  error: "",
  loading: false,
  matches: [],
  nextCursor: null,
  searchKey: "",
  total: 0,
};

async function requestSearchPage(
  workspaceId: string,
  query: string,
  cursor: StudioSearchCursor | null,
  signal?: AbortSignal,
): Promise<StudioSearchPage> {
  const parameters = new URLSearchParams({ q: query, workspace: workspaceId });
  if (cursor) {
    parameters.set("episodeOffset", String(cursor.episodeOffset));
    parameters.set("seriesOffset", String(cursor.seriesOffset));
  }
  const request: RequestInit = {
    cache: "no-store",
    credentials: "same-origin",
  };
  if (signal) request.signal = signal;
  const response = await fetch(`/api/studio/search?${parameters}`, request);
  if (!response.ok) throw new Error("Search is temporarily unavailable.");
  return (await response.json()) as StudioSearchPage;
}

export function useStudioSearch(query: string, workspaceId: string) {
  const normalizedQuery = query.trim();
  const searchKey = `${workspaceId}:${normalizedQuery}`;
  const [state, setState] = useState<SearchState>(idleState);
  const paginationController = useRef<AbortController | null>(null);

  useEffect(() => {
    paginationController.current?.abort();
    paginationController.current = null;
    if (normalizedQuery.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setState({ ...idleState, loading: true, searchKey });
      void requestSearchPage(workspaceId, normalizedQuery, null, controller.signal)
        .then((page) => {
          if (!controller.signal.aborted) {
            setState({
              error: "",
              loading: false,
              matches: page.matches,
              nextCursor: page.nextCursor,
              searchKey,
              total: page.total,
            });
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setState({
              ...idleState,
              error: "Search is temporarily unavailable.",
              searchKey,
            });
          }
        });
    }, 200);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
      paginationController.current?.abort();
      paginationController.current = null;
    };
  }, [normalizedQuery, searchKey, workspaceId]);

  const queryReady = normalizedQuery.length >= 2;
  const visibleState =
    state.searchKey === searchKey
      ? state
      : { ...idleState, loading: queryReady, searchKey };

  async function loadMore(): Promise<void> {
    if (!visibleState.nextCursor || visibleState.loading) return;
    const initiatingSearchKey = searchKey;
    const controller = new AbortController();
    paginationController.current?.abort();
    paginationController.current = controller;
    setState((current) =>
      current.searchKey === initiatingSearchKey
        ? { ...current, loading: true }
        : current,
    );
    try {
      const page = await requestSearchPage(
        workspaceId,
        normalizedQuery,
        visibleState.nextCursor,
        controller.signal,
      );
      setState((current) =>
        current.searchKey === initiatingSearchKey
          ? {
              error: "",
              loading: false,
              matches: [...current.matches, ...page.matches],
              nextCursor: page.nextCursor,
              searchKey: initiatingSearchKey,
              total: page.total,
            }
          : current,
      );
    } catch {
      if (!controller.signal.aborted) {
        setState((current) =>
          current.searchKey === initiatingSearchKey
            ? {
                ...current,
                error: "More results could not be loaded.",
                loading: false,
              }
            : current,
        );
      }
    } finally {
      if (paginationController.current === controller) {
        paginationController.current = null;
      }
    }
  }

  return { ...visibleState, loadMore, queryReady };
}

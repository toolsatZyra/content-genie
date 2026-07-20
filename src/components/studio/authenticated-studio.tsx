"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type RefObject,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { creationAccessForEpisode } from "@/domain/creation";
import {
  canArchiveSeries,
  canCreateEpisodeInSeries,
  episodeCreationBlocker,
  episodeStatePresentation,
  type EpisodeWorkflowState,
  type EpisodeSummary,
  type SeriesSummary,
  type StudioProjection,
} from "@/domain/studio";
import type { StudioSearchMatch } from "@/domain/studio-search";
import { sendCommand } from "@/lib/commands/client";
import { shouldReconcileRealtimeStatus } from "@/lib/realtime/reconciliation";
import { getBrowserSupabaseClient } from "@/lib/supabase/browser";
import { AccountPanel } from "@/components/studio/account-panel";
import { useStudioSearch } from "@/components/studio/use-studio-search";

type StudioView = "atrium" | "series" | "library" | "monica";
type ComposerMode = "episode" | "series";
type EpisodeProgressState = "complete" | "current" | "stopped" | "upcoming";
const subscribeToHydration = (): (() => void) => () => {};

const episodeProgressLabels = [
  "Episode organized",
  "World setup",
  "Production engine",
  "Monica & release",
] as const;

const episodeProgressIndex = {
  approved: 3,
  awaiting_final_review: 3,
  blocked: 2,
  delayed: 2,
  delivered: 4,
  draft: 0,
  paused: 2,
  pending_qualified_review: 3,
  producing: 2,
  ready_to_produce: 2,
  release_blocked: 3,
  retrying: 2,
  world_setup: 1,
} as const satisfies Partial<Record<EpisodeWorkflowState, number>>;

function episodeProgressThread(state: EpisodeWorkflowState): readonly {
  label: (typeof episodeProgressLabels)[number];
  state: EpisodeProgressState;
}[] {
  if (state === "unavailable") {
    return episodeProgressLabels.map((label) => ({
      label,
      state: "stopped",
    }));
  }
  if (state === "abandoned" || state === "canceled") {
    return episodeProgressLabels.map((label, index) => ({
      label,
      state: index === 0 ? "complete" : "stopped",
    }));
  }
  const currentIndex = episodeProgressIndex[state];
  return episodeProgressLabels.map((label, index) => ({
    label,
    state:
      index < currentIndex
        ? "complete"
        : index === currentIndex
          ? "current"
          : "upcoming",
  }));
}

function mergeById<T extends Readonly<{ id: string }>>(
  primary: readonly T[],
  additions: readonly T[],
): readonly T[] {
  const merged = new Map(primary.map((item) => [item.id, item] as const));
  for (const item of additions) merged.set(item.id, item);
  return [...merged.values()];
}

function humanize(value: string): string {
  return value
    .replace(/\.(v\d+)$/, "")
    .replaceAll(/[._]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function relativeTime(value: string): string {
  const milliseconds = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.floor(milliseconds / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function RelativeTime({ value }: Readonly<{ value: string }>) {
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
  return (
    <time dateTime={value} suppressHydrationWarning>
      {hydrated ? relativeTime(value) : "recently"}
    </time>
  );
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);
}

function useRealtimeReconciliation(workspaceId: string, enabled: boolean): void {
  const router = useRouter();
  useEffect(() => {
    if (!enabled) return;
    const client = getBrowserSupabaseClient();
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const reconcile = (): void => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => router.refresh(), 180);
    };
    const channel = client.channel(`workspace-projection:${workspaceId}`);
    for (const table of [
      "series",
      "episodes",
      "work_items",
      "notifications",
      "domain_events",
    ]) {
      channel.on(
        "postgres_changes",
        {
          event: "*",
          filter: `workspace_id=eq.${workspaceId}`,
          schema: "public",
          table,
        },
        reconcile,
      );
    }
    channel.subscribe((status) => {
      if (shouldReconcileRealtimeStatus(status)) reconcile();
    });
    const onVisible = (): void => {
      if (document.visibilityState === "visible") reconcile();
    };
    window.addEventListener("online", reconcile);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(refreshTimer);
      window.removeEventListener("online", reconcile);
      document.removeEventListener("visibilitychange", onVisible);
      void client.removeChannel(channel);
    };
  }, [enabled, router, workspaceId]);
}

export function AuthenticatedStudio({
  initialEpisodeId,
  initialSeriesId,
  projection,
  realtimeEnabled = true,
}: Readonly<{
  initialEpisodeId?: string | undefined;
  initialSeriesId?: string | undefined;
  projection: StudioProjection;
  realtimeEnabled?: boolean;
}>) {
  const router = useRouter();
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
  const [view, setView] = useState<StudioView>(initialSeriesId ? "series" : "atrium");
  const initialEpisode = projection.episodes.find(({ id }) => id === initialEpisodeId);
  const [selectedEpisodeId, setSelectedEpisodeId] = useState(
    initialEpisode?.id ?? projection.episodes[0]?.id ?? "",
  );
  const [selectedSeriesId, setSelectedSeriesId] = useState(
    projection.series.some(({ id }) => id === initialSeriesId)
      ? (initialSeriesId ?? "")
      : (initialEpisode?.seriesId ?? projection.series[0]?.id ?? ""),
  );
  const [query, setQuery] = useState("");
  const [composerMode, setComposerMode] = useState<ComposerMode>("episode");
  const [composerSeriesId, setComposerSeriesId] = useState(selectedSeriesId);
  const [composerDraftKey, setComposerDraftKey] = useState(
    `episode:${selectedSeriesId}`,
  );
  const [commandStatus, setCommandStatus] = useState("");
  const [working, setWorking] = useState(false);
  const [discoveredEpisodes, setDiscoveredEpisodes] = useState<
    readonly EpisodeSummary[]
  >([]);
  const [discoveredSeries, setDiscoveredSeries] = useState<readonly SeriesSummary[]>(
    [],
  );
  const searchRef = useRef<HTMLDialogElement>(null);
  const activityRef = useRef<HTMLDialogElement>(null);
  const composerRef = useRef<HTMLDialogElement>(null);
  const accountRef = useRef<HTMLDialogElement>(null);
  const episodeFocusRef = useRef<HTMLElement>(null);

  const anyDialogOpen = useCallback(
    () =>
      [searchRef, activityRef, composerRef, accountRef].some(
        ({ current }) => current?.open,
      ),
    [],
  );
  const openDialog = useCallback(
    (dialog: RefObject<HTMLDialogElement | null>): void => {
      if (!anyDialogOpen() && !dialog.current?.open) dialog.current?.showModal();
    },
    [anyDialogOpen],
  );

  useRealtimeReconciliation(projection.workspace.id, realtimeEnabled);

  const allSeries = useMemo(
    () => mergeById(projection.series, discoveredSeries),
    [discoveredSeries, projection.series],
  );
  const allEpisodes = useMemo(
    () => mergeById(projection.episodes, discoveredEpisodes),
    [discoveredEpisodes, projection.episodes],
  );
  const creatableSeries = useMemo(
    () => allSeries.filter(canCreateEpisodeInSeries),
    [allSeries],
  );
  const seriesById = useMemo(
    () => new Map(allSeries.map((series) => [series.id, series])),
    [allSeries],
  );
  const selectedEpisode =
    allEpisodes.find(({ id }) => id === selectedEpisodeId) ?? allEpisodes[0];
  const selectedSeries =
    allSeries.find(({ id }) => id === selectedSeriesId) ?? allSeries[0];
  const composerSeries = allSeries.find(({ id }) => id === composerSeriesId);
  const inProgressEpisodes = allEpisodes.filter(
    ({ workflowState }) =>
      !["abandoned", "approved", "canceled", "delivered"].includes(workflowState),
  );
  const search = useStudioSearch(query, projection.workspace.id);
  const searchLiveStatus = !query
    ? "Type at least two characters to search."
    : !search.queryReady
      ? "Type at least two characters to search."
      : search.loading
        ? search.matches.length > 0
          ? `Searching authorized studio. ${search.matches.length} of ${search.total} results shown.`
          : "Searching authorized studio."
        : search.matches.length === 0
          ? "No authorized match found."
          : `${search.matches.length} of ${search.total} authorized results shown.`;

  const counts = useMemo(() => {
    return allEpisodes.reduce(
      (result, episode) => {
        const bucket = episodeStatePresentation(episode.workflowState).summaryBucket;
        if (bucket) result[bucket] += 1;
        return result;
      },
      { attention: 0, creating: 0, ready: 0 },
    );
  }, [allEpisodes]);

  const openComposer = useCallback(
    (mode: ComposerMode, seriesId?: string): void => {
      if (anyDialogOpen()) return;
      const candidateIds = [seriesId, selectedEpisode?.seriesId, selectedSeries?.id];
      const candidate = candidateIds
        .map((id) => creatableSeries.find((series) => series.id === id))
        .find((series) => series !== undefined);
      const effectiveMode =
        mode === "episode" && !candidate && creatableSeries.length === 0
          ? "series"
          : mode;
      const targetSeriesId = candidate?.id ?? creatableSeries[0]?.id ?? "";
      setComposerMode(effectiveMode);
      setComposerSeriesId(targetSeriesId);
      setComposerDraftKey(
        effectiveMode === "series" ? "series:new" : `episode:${targetSeriesId}`,
      );
      setCommandStatus("");
      openDialog(composerRef);
    },
    [
      anyDialogOpen,
      creatableSeries,
      openDialog,
      selectedEpisode?.seriesId,
      selectedSeries?.id,
    ],
  );

  useEffect(() => {
    const shortcut = (event: KeyboardEvent): void => {
      const commandChord = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (!commandChord || (key !== "k" && key !== "n")) return;
      event.preventDefault();
      if (event.repeat || anyDialogOpen()) return;
      if (key === "k") openDialog(searchRef);
      else openComposer(creatableSeries.length > 0 ? "episode" : "series");
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [anyDialogOpen, creatableSeries.length, openComposer, openDialog]);

  function chooseSearchResult(match: StudioSearchMatch): void {
    searchRef.current?.close();
    setQuery("");
    setDiscoveredSeries((current) => mergeById(current, [match.series]));
    if (match.kind === "Episode") {
      setDiscoveredEpisodes((current) => mergeById(current, [match.episode]));
      setView("atrium");
      selectEpisode(match.id, true);
    } else {
      setView("series");
      setSelectedSeriesId(match.id);
    }
  }

  function selectEpisode(id: string, revealOnNarrowScreen = true): void {
    setSelectedEpisodeId(id);
    if (
      !revealOnNarrowScreen ||
      typeof window === "undefined" ||
      !window.matchMedia("(max-width: 1050px)").matches
    ) {
      return;
    }
    window.requestAnimationFrame(() => {
      const focus = episodeFocusRef.current;
      focus?.focus({ preventScroll: true });
      focus?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  async function createItem(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setWorking(true);
    setCommandStatus("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      if (composerMode === "series") {
        const title = String(form.get("title") ?? "");
        const response = await sendCommand("series.create", {
          description: String(form.get("description") ?? ""),
          slug: String(form.get("slug") ?? "") || slugify(title),
          title,
          workspaceId: projection.workspace.id,
        });
        const seriesId =
          response.result &&
          typeof response.result === "object" &&
          !Array.isArray(response.result) &&
          typeof (response.result as Record<string, unknown>).seriesId === "string"
            ? ((response.result as Record<string, unknown>).seriesId as string)
            : null;
        if (!seriesId) throw new Error("The new Series could not be opened.");
        formElement.reset();
        composerRef.current?.close();
        setSelectedSeriesId(seriesId);
        setView("series");
        router.push(`/?seriesId=${encodeURIComponent(seriesId)}`);
        return;
      } else {
        const seriesId = String(form.get("seriesId") ?? "");
        const series = allSeries.find(({ id }) => id === seriesId);
        if (!series || !creatableSeries.some(({ id }) => id === seriesId)) {
          setCommandStatus(
            series
              ? `Episode creation blocked: ${episodeCreationBlocker(series) ?? "Series eligibility unavailable"}.`
              : "Episode creation blocked: Series unavailable.",
          );
          return;
        }
        const response = await sendCommand("episode.create", {
          seriesId,
          summary: "",
          title: String(form.get("title") ?? ""),
          workspaceId: projection.workspace.id,
        });
        const episodeId =
          response.result &&
          typeof response.result === "object" &&
          !Array.isArray(response.result) &&
          typeof (response.result as Record<string, unknown>).episodeId === "string"
            ? ((response.result as Record<string, unknown>).episodeId as string)
            : null;
        if (!episodeId) throw new Error("The new Episode could not be opened.");
        formElement.reset();
        composerRef.current?.close();
        router.push(
          `/episodes/${encodeURIComponent(episodeId)}/create?seriesId=${encodeURIComponent(seriesId)}&episodeId=${encodeURIComponent(episodeId)}`,
        );
        return;
      }
    } catch (error) {
      setCommandStatus(
        error instanceof Error ? error.message : "The command was not committed.",
      );
    } finally {
      setWorking(false);
    }
  }

  async function archiveSeries(series: SeriesSummary): Promise<void> {
    if (!canArchiveSeries(series)) {
      setCommandStatus(
        "Series archival is unavailable because its lifecycle projection is not authoritative.",
      );
      return;
    }
    if (!window.confirm(`Archive “${series.title}”? Its Episodes will be preserved.`)) {
      return;
    }
    setCommandStatus("");
    try {
      await sendCommand("series.archive", {
        expectedVersion: series.aggregateVersion,
        seriesId: series.id,
        workspaceId: projection.workspace.id,
      });
      router.refresh();
    } catch (error) {
      setCommandStatus(error instanceof Error ? error.message : "Archive failed.");
    }
  }

  function switchWorkspace(workspaceId: string): void {
    router.push(`/?workspace=${encodeURIComponent(workspaceId)}`);
  }

  return (
    <main
      className="live-studio-shell"
      data-hydrated={hydrated ? "true" : "false"}
      id="main-content"
    >
      <header className="live-header">
        <button
          aria-label="Go to Genie Atrium"
          className="live-brand"
          onClick={() => setView("atrium")}
          type="button"
        >
          <span className="brand-orbit" aria-hidden="true">
            <span />
          </span>
          <span>
            <strong>Genie</strong>
            <small>by Zyra</small>
          </span>
        </button>
        <label className="workspace-switcher">
          <span>Workspace</span>
          <select
            aria-label="Current workspace"
            onChange={(event) => switchWorkspace(event.target.value)}
            value={projection.workspace.id}
          >
            {projection.workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}
              </option>
            ))}
          </select>
        </label>
        <div className="live-header-actions">
          <button
            aria-label="Open global search"
            className="search-trigger"
            onClick={() => openDialog(searchRef)}
            type="button"
          >
            <span aria-hidden="true">⌕</span>
            <span>Find anything</span>
            <kbd>Ctrl / ⌘ K</kbd>
          </button>
          <button
            aria-label="Open activity and notifications"
            className="icon-button notification-button"
            onClick={() => openDialog(activityRef)}
            type="button"
          >
            <span aria-hidden="true">◌</span>
            {projection.notifications.some(({ readAt }) => !readAt) ? (
              <span className="notification-dot" />
            ) : null}
          </button>
          <button
            aria-label="Open account settings"
            className="avatar-button"
            onClick={() => openDialog(accountRef)}
            type="button"
          >
            <span>{projection.displayName.slice(0, 2).toUpperCase()}</span>
            <span className="avatar-copy">
              <strong>{projection.displayName}</strong>
              <small>{projection.workspace.role}</small>
            </span>
          </button>
        </div>
      </header>

      <nav className="live-dock" aria-label="Studio navigation">
        {(
          [
            ["atrium", "✦", "Atrium"],
            ["series", "◫", "Series"],
            ["library", "◇", "Library"],
            ["monica", "◉", "Monica"],
          ] as const
        ).map(([id, symbol, label]) => (
          <button
            aria-current={view === id ? "page" : undefined}
            className={view === id ? "is-active" : ""}
            key={id}
            onClick={() => setView(id)}
            type="button"
          >
            <span aria-hidden="true">{symbol}</span>
            <span>{label}</span>
            {id === "monica" && projection.work.length > 0 ? (
              <em>{projection.work.length}</em>
            ) : null}
          </button>
        ))}
      </nav>

      <section className="live-canvas">
        <div className="live-heading">
          <div>
            <span className="eyebrow">
              {view === "atrium"
                ? "The studio in motion"
                : view === "series"
                  ? "Creative worlds"
                  : view === "monica"
                    ? "Quality command"
                    : "Finished artefacts"}
            </span>
            <h1>
              {view === "atrium"
                ? "Your films are in motion."
                : view === "series"
                  ? "Every story has a world."
                  : view === "monica"
                    ? "Monica is watching."
                    : "The film vault."}
            </h1>
            <p>
              {view === "atrium"
                ? "Move between Episodes while Genie’s crew works in parallel."
                : view === "series"
                  ? "Inspect the exact active release and pins before creating the next Episode."
                  : view === "monica"
                    ? "Assigned reviews and machine-quality signals converge here."
                    : "Approved masters and exports will appear here once production is enabled."}
            </p>
          </div>
          {view === "atrium" || view === "series" ? (
            <button
              className="create-button"
              onClick={() =>
                openComposer(
                  view === "series" || creatableSeries.length === 0
                    ? "series"
                    : "episode",
                )
              }
              type="button"
            >
              <span aria-hidden="true">＋</span>
              {view === "series" || creatableSeries.length === 0
                ? "Create Series"
                : "Create Episode"}
            </button>
          ) : null}
        </div>

        {commandStatus ? (
          <p className="command-status" role="status">
            {commandStatus}
          </p>
        ) : null}

        {view === "atrium" ? (
          <>
            <section className="live-pulse" aria-label="Studio summary">
              <div>
                <span className="pulse-glyph working" />
                <strong>{counts.creating} creating</strong>
                <small>Autonomous work</small>
              </div>
              <div>
                <span className="pulse-glyph attention" />
                <strong>{counts.attention} need you</strong>
                <small>Review queue</small>
              </div>
              <div>
                <span className="pulse-glyph complete" />
                <strong>{counts.ready} ready</strong>
                <small>Approved films</small>
              </div>
              <button onClick={() => activityRef.current?.showModal()} type="button">
                Open activity <span>→</span>
              </button>
            </section>
            <SeriesShelf
              episodes={allEpisodes}
              onCreate={() => openComposer("series")}
              onOpen={(seriesId) => {
                setSelectedSeriesId(seriesId);
                setView("series");
              }}
              series={allSeries}
            />
            <div className="live-episode-layout">
              <EpisodeGallery
                createKind={creatableSeries.length ? "episode" : "series"}
                episodes={inProgressEpisodes}
                hasEpisodes={allEpisodes.length > 0}
                selectedId={selectedEpisode?.id ?? ""}
                seriesById={seriesById}
                onCreate={() =>
                  openComposer(creatableSeries.length ? "episode" : "series")
                }
                onSelect={(id) => selectEpisode(id)}
              />
              <EpisodeFocus
                episode={selectedEpisode}
                focusRef={episodeFocusRef}
                series={
                  selectedEpisode ? seriesById.get(selectedEpisode.seriesId) : undefined
                }
              />
            </div>
          </>
        ) : null}

        {view === "series" ? (
          <SeriesWorlds
            episodes={allEpisodes}
            onArchive={archiveSeries}
            onCreateEpisode={(seriesId) => openComposer("episode", seriesId)}
            onCreateSeries={() => openComposer("series")}
            onSelect={setSelectedSeriesId}
            selectedId={selectedSeries?.id ?? ""}
            series={allSeries}
          />
        ) : null}

        {view === "monica" ? (
          <MonicaInbox
            work={projection.work}
            onOpenActivity={() => activityRef.current?.showModal()}
          />
        ) : null}

        {view === "library" ? (
          <section className="future-surface">
            <span aria-hidden="true">◇</span>
            <h2>No approved masters yet</h2>
            <p>
              Export and download remain intentionally disabled until production, Monica
              and release gates are implemented and verified.
            </p>
            <button
              className="quiet-button"
              onClick={() => setView("atrium")}
              type="button"
            >
              Return to active Episodes
            </button>
          </section>
        ) : null}
      </section>

      <dialog aria-label="Global search" className="live-search-dialog" ref={searchRef}>
        <label htmlFor="live-global-search">
          Search every authorized Series and Episode
        </label>
        <div>
          <span aria-hidden="true">⌕</span>
          <input
            autoFocus
            id="live-global-search"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Shiva, an Episode title, a story note…"
            type="search"
            value={query}
          />
          <button
            aria-label="Close global search"
            onClick={() => searchRef.current?.close()}
            type="button"
          >
            Close
          </button>
        </div>
        <ul>
          {search.matches.map((match) => (
            <li key={`${match.kind}:${match.id}`}>
              <button onClick={() => chooseSearchResult(match)} type="button">
                <span>{match.kind}</span>
                <strong>{match.label}</strong>
                <em>→</em>
              </button>
            </li>
          ))}
        </ul>
        {search.nextCursor ? (
          <button
            className="quiet-button search-more"
            disabled={search.loading}
            onClick={() => void search.loadMore()}
            type="button"
          >
            {search.loading ? "Searching…" : `Show more of ${search.total}`}
          </button>
        ) : null}
        {search.error ? <p role="alert">{search.error}</p> : null}
        <p aria-atomic="true" className="search-live-status" role="status">
          {searchLiveStatus}
        </p>
      </dialog>

      <dialog
        aria-label="Activity and notifications"
        className="live-side-dialog"
        ref={activityRef}
      >
        <ActivityPanel
          activities={projection.activities}
          notifications={projection.notifications}
          onClose={() => activityRef.current?.close()}
        />
      </dialog>

      <dialog
        aria-label="Create in Genie"
        className="composer-dialog"
        ref={composerRef}
      >
        <form key={composerDraftKey} onSubmit={createItem}>
          <header>
            <div>
              <span className="eyebrow">A new thread begins</span>
              <h2>
                {composerMode === "series" ? "Create a Series" : "Create an Episode"}
              </h2>
            </div>
            <button
              aria-label="Close composer"
              onClick={() => composerRef.current?.close()}
              type="button"
            >
              ×
            </button>
          </header>
          {composerMode === "episode" && composerSeries ? (
            <p className="composer-context">
              New Episode in <strong>{composerSeries.title}</strong>
            </p>
          ) : null}
          {composerMode === "episode" ? (
            <label>
              Series
              <select
                name="seriesId"
                onChange={(event) => {
                  const nextSeriesId = event.target.value;
                  setComposerSeriesId(nextSeriesId);
                  setComposerDraftKey(`episode:${nextSeriesId}`);
                  setCommandStatus("");
                }}
                required
                value={composerSeriesId}
              >
                {creatableSeries.map((series) => (
                  <option key={series.id} value={series.id}>
                    {series.title}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label>
            {composerMode === "series" ? "Series title" : "Episode title"}
            <input
              autoFocus
              maxLength={composerMode === "series" ? 200 : 240}
              name="title"
              required
            />
          </label>
          {composerMode === "series" ? (
            <label>
              URL slug{" "}
              <input
                maxLength={120}
                name="slug"
                pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                placeholder="generated-from-title"
              />
            </label>
          ) : null}
          {composerMode === "series" ? (
            <label>
              World note <span className="optional-label">Optional</span>
              <textarea maxLength={4000} name="description" rows={4} />
              <small>
                A short creative premise for this Series. Episode scripts are added
                separately and remain the production source of truth.
              </small>
            </label>
          ) : null}
          <p>
            {composerMode === "episode"
              ? "Next, add the exact narration script for this Episode."
              : "Future Episodes inherit this Series’ approved look and continuity."}
          </p>
          {commandStatus ? <p role="alert">{commandStatus}</p> : null}
          <button className="primary-button" disabled={working}>
            {working
              ? "Committing…"
              : composerMode === "series"
                ? "Create creative world"
                : "Create Episode"}
          </button>
        </form>
      </dialog>

      <dialog
        aria-label="Account and trust"
        className="live-side-dialog"
        ref={accountRef}
      >
        <AccountPanel
          email={projection.userEmail}
          onClose={() => accountRef.current?.close()}
          role={projection.workspace.role}
          workspaceId={projection.workspace.id}
        />
      </dialog>
    </main>
  );
}

function SeriesShelf({
  episodes,
  onCreate,
  onOpen,
  series,
}: Readonly<{
  episodes: readonly EpisodeSummary[];
  onCreate: () => void;
  onOpen: (seriesId: string) => void;
  series: readonly SeriesSummary[];
}>) {
  return (
    <section className="atrium-series" aria-labelledby="atrium-series-heading">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Your studio hierarchy</span>
          <h2 id="atrium-series-heading">Series</h2>
        </div>
        <button className="quiet-button" onClick={onCreate} type="button">
          Create Series
        </button>
      </div>
      {series.length > 0 ? (
        <div className="atrium-series-grid">
          {series.map((item) => {
            const seriesEpisodes = episodes.filter(
              ({ seriesId }) => seriesId === item.id,
            );
            const activeCount = seriesEpisodes.filter(
              ({ workflowState }) =>
                !["abandoned", "approved", "canceled", "delivered"].includes(
                  workflowState,
                ),
            ).length;
            return (
              <button key={item.id} onClick={() => onOpen(item.id)} type="button">
                <span aria-hidden="true">S</span>
                <span>
                  <small>Series</small>
                  <strong>{item.title}</strong>
                  <em>
                    {seriesEpisodes.length}{" "}
                    {seriesEpisodes.length === 1 ? "Episode" : "Episodes"}
                    {activeCount > 0 ? ` · ${activeCount} in progress` : ""}
                  </em>
                </span>
                <b aria-hidden="true">→</b>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="atrium-series-empty">
          Create a Series to organize its Episodes, reusable world and continuity.
        </p>
      )}
    </section>
  );
}

function EpisodeGallery({
  createKind,
  episodes,
  hasEpisodes,
  onCreate,
  onSelect,
  selectedId,
  seriesById,
}: Readonly<{
  createKind: "episode" | "series";
  episodes: readonly EpisodeSummary[];
  hasEpisodes: boolean;
  onCreate: () => void;
  onSelect: (id: string) => void;
  selectedId: string;
  seriesById: ReadonlyMap<string, SeriesSummary>;
}>) {
  if (episodes.length === 0) {
    return (
      <section className="empty-film-strip">
        <span aria-hidden="true">✦</span>
        <h2>
          {hasEpisodes ? "No Episodes are in progress." : "The first frame is yours."}
        </h2>
        <p>
          {hasEpisodes
            ? "Open a Series to revisit its completed Episodes, or begin a new Episode here."
            : createKind === "episode"
              ? "Create an Episode and Genie will preserve its exact script as the production source of truth."
              : "Create the first Series to establish the story world that its Episodes will inherit."}
        </p>
        <button className="primary-button" onClick={onCreate} type="button">
          {hasEpisodes
            ? "Create Episode"
            : `Create the first ${createKind === "episode" ? "Episode" : "Series"}`}
        </button>
      </section>
    );
  }
  return (
    <section className="live-gallery" aria-labelledby="live-episodes-heading">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Across every Series</span>
          <h2 id="live-episodes-heading">Episodes in progress</h2>
        </div>
        <small>
          {episodes.length} {episodes.length === 1 ? "Episode" : "Episodes"} shown
        </small>
      </div>
      <div className="live-episode-grid">
        {episodes.map((episode, index) => {
          const state = episodeStatePresentation(episode.workflowState);
          return (
            <button
              aria-pressed={selectedId === episode.id}
              className={`live-episode-card accent-${["amber", "rose", "violet", "cyan"][index % 4]} ${selectedId === episode.id ? "is-selected" : ""}`}
              key={episode.id}
              onClick={() => onSelect(episode.id)}
              type="button"
            >
              <span className="live-poster" aria-hidden="true">
                <span />
                <i />
              </span>
              <span className="live-card-copy">
                <small>{seriesById.get(episode.seriesId)?.title ?? "Series"}</small>
                <strong>{episode.title}</strong>
                <em className={`state-chip ${state.tone}`}>
                  <span />
                  {state.label}
                </em>
                <span>
                  Episode {String(episode.episodeNumber).padStart(2, "0")} ·{" "}
                  <RelativeTime value={episode.updatedAt} />
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function EpisodeFocus({
  episode,
  focusRef,
  series,
}: Readonly<{
  episode?: EpisodeSummary | undefined;
  focusRef: RefObject<HTMLElement | null>;
  series?: SeriesSummary | undefined;
}>) {
  if (!episode) return null;
  const state = episodeStatePresentation(episode.workflowState);
  const creationAccess = creationAccessForEpisode(episode.workflowState);
  const progress = episodeProgressThread(episode.workflowState);
  const progressLabel =
    episode.workflowState === "unavailable"
      ? "Episode progress unavailable. No workflow stage completion is inferred."
      : episode.workflowState === "canceled" || episode.workflowState === "abandoned"
        ? `Episode progress. Workflow ${state.label.toLowerCase()}; later stage completion is not inferred.`
        : `Episode progress. Current workflow state: ${state.label}.`;
  return (
    <aside
      aria-label={`${episode.title} Episode details`}
      className="live-focus"
      ref={focusRef}
      tabIndex={-1}
    >
      <span aria-live="polite" className="sr-only">
        Selected {episode.title}. Episode details follow.
      </span>
      <div
        aria-label={`${episode.title} Episode production details`}
        className="episode-focus-scroll"
        tabIndex={0}
      >
        <div className="focus-heading">
          <span className={`state-chip ${state.tone}`}>
            <span />
            {state.label}
          </span>
          <button aria-label="Episode actions" disabled type="button">
            ···
          </button>
        </div>
        <span className="eyebrow">{series?.title ?? "Series"}</span>
        <h2>{episode.title}</h2>
        <p>Episode {String(episode.episodeNumber).padStart(2, "0")}</p>
        <div className="live-stage-window">
          <div aria-hidden="true">
            <span />
            <i />
            <b />
          </div>
          <footer>
            <span>Now</span>
            <strong>{humanize(episode.workflowState)}</strong>
          </footer>
        </div>
        <div className="episode-metrics">
          <div>
            <small>Progress</small>
            <strong>{Math.round(episode.progressPercent)}%</strong>
          </div>
          <div>
            <small>Cost signal</small>
            <strong>
              {episode.costEstimateMinor === null
                ? "Not quoted"
                : `${episode.currency ?? "USD"} ${(episode.costEstimateMinor / 100).toFixed(2)}`}
            </strong>
          </div>
        </div>
        <ol aria-label={progressLabel} className="live-thread">
          {progress.map((step, index) => (
            <li
              aria-label={`${step.label}, ${
                step.state === "complete"
                  ? "completed"
                  : step.state === "current"
                    ? "current stage"
                    : step.state === "stopped"
                      ? "not inferred after workflow stopped"
                      : "upcoming"
              }`}
              aria-current={step.state === "current" ? "step" : undefined}
              className={`is-${step.state}`}
              key={step.label}
            >
              <span aria-hidden="true">{index + 1}</span>
              <strong aria-hidden="true">{step.label}</strong>
            </li>
          ))}
        </ol>
      </div>
      {episode.workflowState === "unavailable" ? (
        <span aria-disabled="true" className="primary-button full-width is-disabled">
          Episode unavailable
        </span>
      ) : creationAccess === "closed" ? (
        <span aria-disabled="true" className="primary-button full-width is-disabled">
          Episode closed
        </span>
      ) : (
        <Link
          className="primary-button full-width"
          href={`/episodes/${episode.id}/create?seriesId=${encodeURIComponent(episode.seriesId)}&episodeId=${encodeURIComponent(episode.id)}`}
        >
          {creationAccess === "read-only"
            ? "View locked setup"
            : episode.workflowState === "draft"
              ? "Start world setup"
              : "Continue world setup"}
        </Link>
      )}
    </aside>
  );
}

function SeriesWorlds({
  episodes,
  onArchive,
  onCreateEpisode,
  onCreateSeries,
  onSelect,
  selectedId,
  series,
}: Readonly<{
  episodes: readonly EpisodeSummary[];
  onArchive: (series: SeriesSummary) => void;
  onCreateEpisode: (seriesId: string) => void;
  onCreateSeries: () => void;
  onSelect: (id: string) => void;
  selectedId: string;
  series: readonly SeriesSummary[];
}>) {
  if (series.length === 0) {
    return (
      <section className="future-surface">
        <span>◫</span>
        <h2>No Series yet</h2>
        <p>A Series organizes Episodes and can later point to an approved release.</p>
        <button className="primary-button" onClick={onCreateSeries}>
          Create the first Series
        </button>
      </section>
    );
  }
  const selectedSeries = series.find(({ id }) => id === selectedId) ?? series[0]!;
  const selectedEpisodes = episodes.filter(
    ({ seriesId }) => seriesId === selectedSeries.id,
  );
  return (
    <section aria-labelledby="series-worlds-heading" className="series-catalog">
      <h2 className="sr-only" id="series-worlds-heading">
        Series worlds
      </h2>
      <div aria-label="Choose a Series" className="series-worlds" role="group">
        {series.map((item, index) => {
          const itemEpisodes = episodes.filter(({ seriesId }) => seriesId === item.id);
          const selected = selectedSeries.id === item.id;
          return (
            <article
              className={selected ? "series-world is-selected" : "series-world"}
              key={item.id}
            >
              <button
                aria-controls="selected-series-details"
                aria-pressed={selected}
                className="series-world-main"
                id={`series-option-${item.id}`}
                onClick={() => onSelect(item.id)}
                type="button"
              >
                <span
                  className={`series-world-art art-${index % 4}`}
                  aria-hidden="true"
                >
                  <i />
                  <b />
                </span>
                <span>
                  <small>Series · {item.state}</small>
                  <strong>{item.title}</strong>
                  <p>
                    {item.description ||
                      "A new creative world, ready for its first story."}
                  </p>
                </span>
              </button>
              <footer>
                <span>
                  <strong>{itemEpisodes.length}</strong> Episodes
                </span>
                <span>
                  <strong>{item.aggregateVersion}</strong> Record / CAS version
                </span>
                {canArchiveSeries(item) ? (
                  <button onClick={() => onArchive(item)} type="button">
                    Archive
                  </button>
                ) : null}
              </footer>
            </article>
          );
        })}
      </div>
      <aside
        aria-labelledby="selected-series-heading"
        className="selected-series-details"
        id="selected-series-details"
      >
        <span aria-live="polite" className="sr-only">
          Selected {selectedSeries.title}. Series details follow.
        </span>
        <header>
          <div>
            <span className="eyebrow">Selected Series</span>
            <h2 id="selected-series-heading">{selectedSeries.title}</h2>
          </div>
          <span
            className={`state-chip ${
              selectedSeries.state === "unavailable" ? "attention" : "draft"
            }`}
          >
            {humanize(selectedSeries.state)}
          </span>
        </header>
        <p>
          {selectedSeries.description ||
            "A new creative world, ready for its first story."}
        </p>
        <div className="series-inheritance">
          <section aria-labelledby="series-assets-heading">
            {selectedSeries.activeRelease?.kind === "released" ? (
              <>
                <h3 id="series-assets-heading">
                  Series Release {selectedSeries.activeRelease.releaseNumber}
                </h3>
                <p>Only the exact release pins below are presented for new Episodes.</p>
                <ul>
                  <li>
                    <strong>Status</strong>
                    <span className="series-pin-value">
                      {humanize(selectedSeries.activeRelease.status)}
                    </span>
                  </li>
                  <li>
                    <strong>Release ID</strong>
                    <span className="series-pin-value">
                      <code>{selectedSeries.activeRelease.id}</code>
                    </span>
                  </li>
                  <li>
                    <strong>Look pin</strong>
                    <span className="series-pin-value">
                      {selectedSeries.activeRelease.look ? (
                        <>
                          {selectedSeries.activeRelease.look.name} (
                          {selectedSeries.activeRelease.look.key}), ID{" "}
                          <code>{selectedSeries.activeRelease.look.id}</code>,{" "}
                          {humanize(
                            selectedSeries.activeRelease.look.availabilityStatus,
                          )}
                        </>
                      ) : (
                        "Not pinned"
                      )}
                    </span>
                  </li>
                  <li>
                    <strong>Voice pin</strong>
                    <span className="series-pin-value">
                      {humanize(selectedSeries.activeRelease.voice.gender)} narrator (
                      {selectedSeries.activeRelease.voice.key}), ID{" "}
                      <code>{selectedSeries.activeRelease.voice.id}</code>,{" "}
                      {humanize(selectedSeries.activeRelease.voice.availabilityStatus)}
                    </span>
                  </li>
                  <li>
                    <strong>Continuity pin</strong>
                    <span className="series-pin-value">
                      {selectedSeries.activeRelease.continuity ? (
                        <>
                          Version{" "}
                          {selectedSeries.activeRelease.continuity.versionNumber}, ID{" "}
                          <code>{selectedSeries.activeRelease.continuity.id}</code>
                        </>
                      ) : (
                        "Not pinned"
                      )}
                    </span>
                  </li>
                </ul>
              </>
            ) : selectedSeries.activeRelease?.kind === "unreleased" ? (
              <>
                <h3 id="series-assets-heading">No approved Series Release</h3>
                <p>
                  This Series has no active release. No look, continuity, characters,
                  locations, or visual language are claimed as inherited.
                </p>
              </>
            ) : (
              <>
                <h3 id="series-assets-heading">Series Release unavailable</h3>
                <p>
                  Release metadata is incomplete or unsupported. Inheritance is not
                  inferred and Episode creation is read-only.
                </p>
              </>
            )}
          </section>
          <section aria-labelledby="series-episodes-heading">
            <h3 id="series-episodes-heading">
              Episodes <span>{selectedEpisodes.length}</span>
            </h3>
            {selectedEpisodes.length > 0 ? (
              <ul>
                {selectedEpisodes.map((episode) => (
                  <li key={episode.id}>
                    <span>
                      Episode {String(episode.episodeNumber).padStart(2, "0")}
                    </span>
                    <Link
                      href={`/episodes/${episode.id}/create?seriesId=${encodeURIComponent(selectedSeries.id)}&episodeId=${encodeURIComponent(episode.id)}`}
                    >
                      <strong>{episode.title}</strong>
                      <span>Open Episode →</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No Episodes in this Series yet.</p>
            )}
          </section>
        </div>
        {canCreateEpisodeInSeries(selectedSeries) ? (
          <button
            className="primary-button"
            onClick={() => onCreateEpisode(selectedSeries.id)}
            type="button"
          >
            Create Episode in {selectedSeries.title}
          </button>
        ) : selectedSeries.state === "archived" ? (
          <span aria-disabled="true" className="primary-button is-disabled">
            Archived Series
          </span>
        ) : (
          <span aria-disabled="true" className="primary-button is-disabled">
            {episodeCreationBlocker(selectedSeries) ?? "Series unavailable"}
          </span>
        )}
      </aside>
    </section>
  );
}

function MonicaInbox({
  onOpenActivity,
  work,
}: Readonly<{ onOpenActivity: () => void; work: StudioProjection["work"] }>) {
  return (
    <section className="monica-room">
      <div className="monica-presence">
        <span className="monica-eye large" />
        <span>
          <small>Quality orchestrator</small>
          <strong>Monica</strong>
          <p>Observing the production ledger. No production checks run in Phase 1.</p>
        </span>
      </div>
      <div className="monica-work-list">
        <header>
          <h2>Your review queue</h2>
          <span>{work.length}</span>
        </header>
        {work.length === 0 ? (
          <p>Nothing is waiting for you.</p>
        ) : (
          work.map((item) => (
            <article key={item.id}>
              <span className="activity-marker attention" />
              <div>
                <small>{humanize(item.kind)}</small>
                <strong>{item.safeSummary}</strong>
                <p>{humanize(item.state)}</p>
              </div>
              <button onClick={onOpenActivity} type="button">
                Inspect →
              </button>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

function ActivityPanel({
  activities,
  notifications,
  onClose,
}: Readonly<{
  activities: StudioProjection["activities"];
  notifications: StudioProjection["notifications"];
  onClose: () => void;
}>) {
  return (
    <section className="activity-panel">
      <header>
        <div>
          <span className="eyebrow">Authoritative workspace feed</span>
          <h2>Activity</h2>
        </div>
        <button aria-label="Close activity" onClick={onClose} type="button">
          ×
        </button>
      </header>
      <div className="monica-card">
        <span className="monica-eye large" />
        <div>
          <span>Monica</span>
          <strong>Quality work will surface here.</strong>
          <p>
            Realtime only hints; Genie refetches the authoritative database projection.
          </p>
        </div>
      </div>
      <ul>
        {notifications.map((item) => (
          <li key={item.id}>
            <span
              className={`activity-marker ${item.readAt ? "complete" : "attention"}`}
            />
            <div>
              <strong>{item.title}</strong>
              <p>
                {item.safeSummary} · <RelativeTime value={item.createdAt} />
              </p>
            </div>
          </li>
        ))}
        {activities.map((item) => (
          <li key={item.id}>
            <span className="activity-marker working" />
            <div>
              <strong>{humanize(item.eventType)}</strong>
              <p>
                {humanize(item.aggregateType)} · <RelativeTime value={item.createdAt} />
              </p>
            </div>
          </li>
        ))}
      </ul>
      {notifications.length + activities.length === 0 ? (
        <p className="activity-empty">The ledger is quiet.</p>
      ) : null}
    </section>
  );
}

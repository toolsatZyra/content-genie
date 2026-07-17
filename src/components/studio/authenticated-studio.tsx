"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";

import {
  episodeStatePresentation,
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
const subscribeToHydration = (): (() => void) => () => {};

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
  projection,
  realtimeEnabled = true,
}: Readonly<{ projection: StudioProjection; realtimeEnabled?: boolean }>) {
  const router = useRouter();
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
  const [view, setView] = useState<StudioView>("atrium");
  const [selectedEpisodeId, setSelectedEpisodeId] = useState(
    projection.episodes[0]?.id ?? "",
  );
  const [selectedSeriesId, setSelectedSeriesId] = useState(
    projection.series[0]?.id ?? "",
  );
  const [query, setQuery] = useState("");
  const [composerMode, setComposerMode] = useState<ComposerMode>("episode");
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

  useRealtimeReconciliation(projection.workspace.id, realtimeEnabled);

  const allSeries = useMemo(
    () => mergeById(projection.series, discoveredSeries),
    [discoveredSeries, projection.series],
  );
  const allEpisodes = useMemo(
    () => mergeById(projection.episodes, discoveredEpisodes),
    [discoveredEpisodes, projection.episodes],
  );
  const seriesById = useMemo(
    () => new Map(allSeries.map((series) => [series.id, series])),
    [allSeries],
  );
  const selectedEpisode =
    allEpisodes.find(({ id }) => id === selectedEpisodeId) ?? allEpisodes[0];
  const selectedSeries =
    allSeries.find(({ id }) => id === selectedSeriesId) ?? allSeries[0];
  const visibleEpisodes =
    view === "series" && selectedSeries
      ? allEpisodes.filter(({ seriesId }) => seriesId === selectedSeries.id)
      : allEpisodes;
  const search = useStudioSearch(query, projection.workspace.id);

  const counts = useMemo(() => {
    return projection.episodes.reduce(
      (result, episode) => {
        const bucket = episodeStatePresentation(episode.workflowState).summaryBucket;
        if (bucket) result[bucket] += 1;
        return result;
      },
      { attention: 0, creating: 0, ready: 0 },
    );
  }, [projection.episodes]);

  useEffect(() => {
    const shortcut = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        searchRef.current?.showModal();
      }
      if (event.key.toLowerCase() === "n" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        openComposer(allSeries.length > 0 ? "episode" : "series");
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [allSeries.length]);

  function openComposer(mode: ComposerMode): void {
    setComposerMode(mode);
    setCommandStatus("");
    if (!composerRef.current?.open) composerRef.current?.showModal();
  }

  function chooseSearchResult(match: StudioSearchMatch): void {
    searchRef.current?.close();
    setQuery("");
    setDiscoveredSeries((current) => mergeById(current, [match.series]));
    if (match.kind === "Episode") {
      setDiscoveredEpisodes((current) => mergeById(current, [match.episode]));
      setView("atrium");
      setSelectedEpisodeId(match.id);
    } else {
      setView("series");
      setSelectedSeriesId(match.id);
    }
  }

  async function createItem(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setWorking(true);
    setCommandStatus("");
    const form = new FormData(event.currentTarget);
    try {
      if (composerMode === "series") {
        const title = String(form.get("title") ?? "");
        await sendCommand("series.create", {
          description: String(form.get("description") ?? ""),
          slug: String(form.get("slug") ?? "") || slugify(title),
          title,
          workspaceId: projection.workspace.id,
        });
      } else {
        await sendCommand("episode.create", {
          seriesId: String(form.get("seriesId") ?? ""),
          summary: String(form.get("summary") ?? ""),
          title: String(form.get("title") ?? ""),
          workspaceId: projection.workspace.id,
        });
      }
      composerRef.current?.close();
      router.refresh();
    } catch (error) {
      setCommandStatus(
        error instanceof Error ? error.message : "The command was not committed.",
      );
    } finally {
      setWorking(false);
    }
  }

  async function archiveSeries(series: SeriesSummary): Promise<void> {
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
            onClick={() => searchRef.current?.showModal()}
            type="button"
          >
            <span aria-hidden="true">⌕</span>
            <span>Find anything</span>
            <kbd>⌘ K</kbd>
          </button>
          <button
            aria-label="Open activity and notifications"
            className="icon-button notification-button"
            onClick={() => activityRef.current?.showModal()}
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
            onClick={() => accountRef.current?.showModal()}
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
                  ? "Characters, locations and the visual language travel safely between Episodes."
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
                  view === "series" || allSeries.length === 0 ? "series" : "episode",
                )
              }
              type="button"
            >
              <span aria-hidden="true">＋</span>
              {view === "series" || allSeries.length === 0
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
            <div className="live-episode-layout">
              <EpisodeGallery
                episodes={visibleEpisodes}
                selectedId={selectedEpisode?.id ?? ""}
                seriesById={seriesById}
                onCreate={() => openComposer(allSeries.length ? "episode" : "series")}
                onSelect={setSelectedEpisodeId}
              />
              <EpisodeFocus
                episode={selectedEpisode}
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
            onCreate={() => openComposer("series")}
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
          <button onClick={() => searchRef.current?.close()} type="button">
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
        {search.loading && search.matches.length === 0 ? (
          <p role="status">Searching authorized studio…</p>
        ) : null}
        {query && !search.queryReady ? <p>Type at least two characters.</p> : null}
        {search.queryReady && !search.loading && search.matches.length === 0 ? (
          <p>No authorized match found.</p>
        ) : null}
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
        <form onSubmit={createItem}>
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
          {composerMode === "episode" ? (
            <label>
              Series
              <select name="seriesId" required>
                {allSeries
                  .filter(({ state }) => state === "active")
                  .map((series) => (
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
          <label>
            {composerMode === "series" ? "World note" : "Story note"}
            <textarea
              maxLength={4000}
              name={composerMode === "series" ? "description" : "summary"}
              rows={5}
            />
          </label>
          <p>
            {composerMode === "episode"
              ? "The script remains untouched. The next screen will begin immutable world setup."
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

function EpisodeGallery({
  episodes,
  onCreate,
  onSelect,
  selectedId,
  seriesById,
}: Readonly<{
  episodes: readonly EpisodeSummary[];
  onCreate: () => void;
  onSelect: (id: string) => void;
  selectedId: string;
  seriesById: ReadonlyMap<string, SeriesSummary>;
}>) {
  if (episodes.length === 0) {
    return (
      <section className="empty-film-strip">
        <span aria-hidden="true">✦</span>
        <h2>The first frame is yours.</h2>
        <p>
          Create an Episode and Genie will preserve its exact script as the production
          source of truth.
        </p>
        <button className="primary-button" onClick={onCreate} type="button">
          Create the first Episode
        </button>
      </section>
    );
  }
  return (
    <section className="live-gallery" aria-labelledby="live-episodes-heading">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Concurrent productions</span>
          <h2 id="live-episodes-heading">Episodes</h2>
        </div>
        <small>{episodes.length} active</small>
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
  series,
}: Readonly<{
  episode?: EpisodeSummary | undefined;
  series?: SeriesSummary | undefined;
}>) {
  if (!episode) return null;
  const state = episodeStatePresentation(episode.workflowState);
  return (
    <aside className="live-focus" aria-label={`${episode.title} Episode details`}>
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
      <ol className="live-thread">
        <li className="is-complete">
          <span>1</span>
          <strong>Episode organized</strong>
        </li>
        <li className={episode.workflowState !== "draft" ? "is-complete" : ""}>
          <span>2</span>
          <strong>World setup</strong>
        </li>
        <li>
          <span>3</span>
          <strong>Production engine</strong>
        </li>
        <li>
          <span>4</span>
          <strong>Monica &amp; release</strong>
        </li>
      </ol>
      <button className="primary-button full-width" disabled type="button">
        World setup arrives in Phase 2
      </button>
    </aside>
  );
}

function SeriesWorlds({
  episodes,
  onArchive,
  onCreate,
  onSelect,
  selectedId,
  series,
}: Readonly<{
  episodes: readonly EpisodeSummary[];
  onArchive: (series: SeriesSummary) => void;
  onCreate: () => void;
  onSelect: (id: string) => void;
  selectedId: string;
  series: readonly SeriesSummary[];
}>) {
  if (series.length === 0) {
    return (
      <section className="future-surface">
        <span>◫</span>
        <h2>No Series yet</h2>
        <p>
          A Series is the master world that carries approved characters, locations and
          look between Episodes.
        </p>
        <button className="primary-button" onClick={onCreate}>
          Create the first Series
        </button>
      </section>
    );
  }
  return (
    <section className="series-worlds">
      {series.map((item, index) => {
        const itemEpisodes = episodes.filter(({ seriesId }) => seriesId === item.id);
        return (
          <article
            className={
              selectedId === item.id ? "series-world is-selected" : "series-world"
            }
            key={item.id}
          >
            <button
              className="series-world-main"
              onClick={() => onSelect(item.id)}
              type="button"
            >
              <span className={`series-world-art art-${index % 4}`} aria-hidden="true">
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
                <strong>{item.aggregateVersion}</strong> World version
              </span>
              {item.state === "active" ? (
                <button onClick={() => onArchive(item)} type="button">
                  Archive
                </button>
              ) : null}
            </footer>
          </article>
        );
      })}
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

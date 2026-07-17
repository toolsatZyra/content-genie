"use client";

import {
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

type NavigationId = "atrium" | "series" | "library" | "monica";
type EpisodeState = "Creating" | "Needs you" | "Ready" | "World design";

interface EpisodeCard {
  readonly accent: string;
  readonly currentStage: string;
  readonly episode: string;
  readonly id: string;
  readonly progress: readonly string[];
  readonly series: string;
  readonly state: EpisodeState;
  readonly time: string;
  readonly title: string;
}

const navigation: ReadonlyArray<{
  id: NavigationId;
  label: string;
  symbol: string;
}> = [
  { id: "atrium", label: "Atrium", symbol: "✦" },
  { id: "series", label: "Series", symbol: "◫" },
  { id: "library", label: "Library", symbol: "◇" },
  { id: "monica", label: "Monica", symbol: "◉" },
];

const episodes: readonly EpisodeCard[] = [
  {
    accent: "amber",
    currentStage: "Visual continuity review",
    episode: "Episode 04",
    id: "shiva-ganga",
    progress: ["World locked", "Narrated", "38 clips", "Monica reviewing"],
    series: "Shiva: The Infinite",
    state: "Creating",
    time: "Illustrative state",
    title: "When Ganga Met the Mountain",
  },
  {
    accent: "rose",
    currentStage: "Qualified cultural review",
    episode: "Episode 02",
    id: "devi-raktabija",
    progress: ["Film complete", "Monica passed", "Sources attached"],
    series: "Devi Mahatmya",
    state: "Needs you",
    time: "Illustrative state",
    title: "The Secret of Raktabija",
  },
  {
    accent: "violet",
    currentStage: "Final film ready",
    episode: "Episode 07",
    id: "krishna-govardhan",
    progress: ["Approved", "Master rendered", "Export ready"],
    series: "Krishna Leela",
    state: "Ready",
    time: "Illustrative state",
    title: "The Mountain That Became an Umbrella",
  },
  {
    accent: "cyan",
    currentStage: "Choose the world",
    episode: "Episode 01",
    id: "kali-awakening",
    progress: ["Script locked", "Male narrator", "Look selected"],
    series: "Forms of Shakti",
    state: "World design",
    time: "Illustrative state",
    title: "The Awakening of Kali",
  },
];
const defaultEpisode = episodes[0]!;
const subscribeToHydration = (): (() => void) => () => {};

const activity = [
  {
    id: "a1",
    label: "Monica found a continuity drift",
    meta: "Example · shots 21–23 · an automatic repair would run",
    tone: "working",
  },
  {
    id: "a2",
    label: "Cultural review is waiting",
    meta: "Example · a source packet and film would be attached",
    tone: "attention",
  },
  {
    id: "a3",
    label: "Master package completed",
    meta: "Example · a 1080 × 1920 export would be available",
    tone: "complete",
  },
] as const;

function stateTone(state: EpisodeState): string {
  switch (state) {
    case "Creating":
      return "working";
    case "Needs you":
      return "attention";
    case "Ready":
      return "complete";
    case "World design":
      return "draft";
  }
}

function useModalDialog(onClose: () => void): RefObject<HTMLDialogElement | null> {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.addEventListener("close", onClose);
    return () => dialog.removeEventListener("close", onClose);
  }, [onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const containFocus = (event: KeyboardEvent): void => {
      if (event.key !== "Tab" || !dialog.open) return;
      const focusable = [
        ...dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((element) => element.getClientRects().length > 0);
      const first = focusable.at(0);
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !dialog.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener("keydown", containFocus);
    return () => dialog.removeEventListener("keydown", containFocus);
  }, []);

  return dialogRef;
}

export function StudioAtrium() {
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
  const [selectedId, setSelectedId] = useState(defaultEpisode.id);
  const [trayOpen, setTrayOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [previewNotice, setPreviewNotice] = useState("");
  const episodeFocusRef = useRef<HTMLElement>(null);
  const searchDialogRef = useModalDialog(() => setSearchOpen(false));
  const trayDialogRef = useModalDialog(() => setTrayOpen(false));

  const selected = useMemo(
    () => episodes.find((episode) => episode.id === selectedId) ?? defaultEpisode,
    [selectedId],
  );

  useEffect(() => {
    const openSearch = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        if (!searchDialogRef.current?.open) {
          searchDialogRef.current?.showModal();
        }
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", openSearch);
    return () => window.removeEventListener("keydown", openSearch);
  }, [searchDialogRef]);

  function openSearch(): void {
    if (!searchDialogRef.current?.open) searchDialogRef.current?.showModal();
    setSearchOpen(true);
  }

  function closeSearch(): void {
    if (searchDialogRef.current?.open) searchDialogRef.current.close();
  }

  function openTray(): void {
    if (!trayDialogRef.current?.open) trayDialogRef.current?.showModal();
    setTrayOpen(true);
  }

  function closeTray(): void {
    if (trayDialogRef.current?.open) trayDialogRef.current.close();
  }

  function toggleTray(): void {
    if (trayDialogRef.current?.open) closeTray();
    else openTray();
  }

  function showPreviewNotice(label: string): void {
    setPreviewNotice(`${label} becomes interactive in the next build phase.`);
  }

  function selectEpisode(id: string): void {
    setSelectedId(id);
    if (window.matchMedia("(max-width: 760px)").matches) {
      window.setTimeout(() => {
        episodeFocusRef.current?.scrollIntoView({
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "auto"
            : "smooth",
          block: "start",
        });
        episodeFocusRef.current?.focus({ preventScroll: true });
      }, 0);
    }
  }

  return (
    <main
      className="studio-shell"
      data-hydrated={hydrated ? "true" : "false"}
      id="main-content"
    >
      <header className="studio-header">
        <div className="brand-lockup" aria-label="Genie by Zyra">
          <span className="brand-orbit" aria-hidden="true">
            <span />
          </span>
          <span>
            <strong>Genie</strong>
            <small>by Zyra</small>
          </span>
        </div>

        <div className="header-actions">
          <button
            aria-expanded={searchOpen}
            aria-label="Open global search"
            className="search-trigger"
            onClick={openSearch}
            type="button"
          >
            <span aria-hidden="true">⌕</span>
            <span>Find anything</span>
            <kbd>⌘ K</kbd>
          </button>
          <button
            aria-expanded={trayOpen}
            aria-label="Open activity and notifications"
            className="icon-button notification-button"
            onClick={toggleTray}
            type="button"
          >
            <span aria-hidden="true">◌</span>
            <span className="notification-dot" />
          </button>
          <button
            aria-label="Open account menu preview"
            className="avatar-button"
            onClick={() => showPreviewNotice("Account settings")}
            type="button"
          >
            <span>SR</span>
            <span className="avatar-copy">
              <strong>Studio owner</strong>
              <small>Reviewer</small>
            </span>
          </button>
        </div>
      </header>

      <dialog
        aria-label="Global search"
        className="command-palette"
        ref={searchDialogRef}
      >
        <section>
          <label htmlFor="global-search">Search Series, Episodes and activity</label>
          <div>
            <span aria-hidden="true">⌕</span>
            <input
              id="global-search"
              placeholder="Try “Shiva”, “needs review”, or an episode title…"
              type="search"
            />
            <button onClick={closeSearch} type="button">
              Close
            </button>
          </div>
          <p>Search will use authorized workspace projections in Phase 1.</p>
        </section>
      </dialog>

      <nav className="studio-navigation" aria-label="Studio navigation">
        <div className="navigation-items">
          {navigation.map((item) => (
            <button
              aria-current={item.id === "atrium" ? "page" : undefined}
              className={item.id === "atrium" ? "is-active" : undefined}
              key={item.id}
              onClick={() =>
                item.id === "atrium"
                  ? setPreviewNotice("You are already in the Atrium.")
                  : showPreviewNotice(item.label)
              }
              type="button"
            >
              <span aria-hidden="true">{item.symbol}</span>
              <span>{item.label}</span>
              {item.id === "monica" ? <em>1</em> : null}
            </button>
          ))}
        </div>
        <div className="navigation-footer">
          <button onClick={() => showPreviewNotice("The studio guide")} type="button">
            <span aria-hidden="true">?</span>
            <span>Guide</span>
          </button>
          <div className="monica-pulse">
            <span className="monica-eye" aria-hidden="true" />
            <span>
              <strong>Monica preview</strong>
              <small>Illustrative only</small>
            </span>
          </div>
        </div>
      </nav>

      <section className="atrium">
        <div className="preview-disclosure" role="note">
          <span aria-hidden="true">Preview</span>
          <p>
            Living Cinema foundation · illustrative data · no providers, jobs or exports
            are connected.
          </p>
        </div>
        {previewNotice ? (
          <div className="preview-status" role="status">
            {previewNotice}
          </div>
        ) : null}
        <div className="atrium-heading">
          <div>
            <span className="eyebrow">Studio interface preview</span>
            <h1>Your films are in motion.</h1>
            <p>
              Explore how concurrent Episodes will feel when the production engine comes
              online.
            </p>
          </div>
          <button
            className="create-button"
            onClick={() => showPreviewNotice("Episode creation")}
            type="button"
          >
            <span aria-hidden="true">＋</span>
            Create Episode
          </button>
        </div>

        <div className="pulse-strip" aria-label="Studio summary">
          <div>
            <span className="pulse-glyph working" aria-hidden="true" />
            <strong>2 creating</strong>
            <small>Illustrative state</small>
          </div>
          <div>
            <span className="pulse-glyph attention" aria-hidden="true" />
            <strong>1 needs you</strong>
            <small>Illustrative state</small>
          </div>
          <div>
            <span className="pulse-glyph complete" aria-hidden="true" />
            <strong>1 ready</strong>
            <small>Illustrative state</small>
          </div>
          <button onClick={openTray} type="button">
            View activity <span aria-hidden="true">→</span>
          </button>
        </div>

        <div className="episode-layout">
          <section className="episode-gallery" aria-labelledby="episode-heading">
            <div className="section-heading">
              <div>
                <span className="eyebrow">Illustrative Episode constellation</span>
                <h2 id="episode-heading">Episodes</h2>
              </div>
              <button
                onClick={() => showPreviewNotice("The complete Episode index")}
                type="button"
              >
                See all 12
              </button>
            </div>

            <div className="episode-grid">
              {episodes.map((episode) => {
                const selectedEpisode = selected.id === episode.id;
                return (
                  <button
                    aria-pressed={selectedEpisode}
                    className={`episode-card accent-${episode.accent} ${
                      selectedEpisode ? "is-selected" : ""
                    }`}
                    key={episode.id}
                    onClick={() => selectEpisode(episode.id)}
                    type="button"
                  >
                    <div className="episode-poster" aria-hidden="true">
                      <div className="poster-aura" />
                      <div className="poster-mountain" />
                      <div className="poster-figure">
                        <span />
                      </div>
                      <div className="poster-particles" />
                      <span className="poster-index">{episode.episode}</span>
                    </div>
                    <div className="episode-card__body">
                      <span className="series-name">{episode.series}</span>
                      <h3>{episode.title}</h3>
                      <div className={`state-chip ${stateTone(episode.state)}`}>
                        <span aria-hidden="true" />
                        {episode.state}
                      </div>
                      <small>{episode.time}</small>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          <aside
            aria-label={`${selected.title} episode details`}
            className="episode-focus"
            ref={episodeFocusRef}
            tabIndex={-1}
          >
            <div className="focus-heading">
              <span className={`state-chip ${stateTone(selected.state)}`}>
                <span aria-hidden="true" />
                {selected.state}
              </span>
              <button
                aria-label="Episode actions preview"
                onClick={() => showPreviewNotice("Episode actions")}
                type="button"
              >
                ···
              </button>
            </div>
            <span className="eyebrow">{selected.series}</span>
            <h2>{selected.title}</h2>
            <p>{selected.episode}</p>

            <div className="stage-window">
              <div className="stage-window__film" aria-hidden="true">
                <div className="film-aura" />
                <div className="film-horizon" />
                <div className="film-subject">
                  <span />
                </div>
                <div className="film-grain" />
              </div>
              <div className="stage-window__caption">
                <span>Now</span>
                <strong>{selected.currentStage}</strong>
              </div>
            </div>

            <ol className="progress-thread">
              {selected.progress.map((step, index) => (
                <li key={step}>
                  <span aria-hidden="true">{index + 1}</span>
                  <strong>{step}</strong>
                </li>
              ))}
            </ol>

            <button
              className="primary-button full-width"
              onClick={() => showPreviewNotice("The full Episode workspace")}
              type="button"
            >
              Open Episode <span aria-hidden="true">→</span>
            </button>
          </aside>
        </div>
      </section>

      <dialog
        aria-label="Activity and notifications"
        className="activity-tray"
        ref={trayDialogRef}
      >
        <div className="activity-tray__header">
          <div>
            <span className="eyebrow">Illustrative studio activity</span>
            <h2>Activity</h2>
          </div>
          <button aria-label="Close activity" onClick={closeTray} type="button">
            ×
          </button>
        </div>
        <div className="monica-card">
          <span className="monica-eye large" aria-hidden="true" />
          <div>
            <span>Monica preview</span>
            <strong>This is how a review request will surface.</strong>
            <p>No real film, repair, review or package exists in this preview.</p>
          </div>
        </div>
        <ul className="activity-list">
          {activity.map((item) => (
            <li key={item.id}>
              <span className={`activity-marker ${item.tone}`} aria-hidden="true" />
              <div>
                <strong>{item.label}</strong>
                <p>{item.meta}</p>
              </div>
              <button
                aria-label={`Preview ${item.label}`}
                onClick={() => showPreviewNotice(item.label)}
                type="button"
              >
                →
              </button>
            </li>
          ))}
        </ul>
        <button
          className="quiet-button"
          onClick={() => showPreviewNotice("Monica’s inbox")}
          type="button"
        >
          Open Monica’s inbox
        </button>
      </dialog>
    </main>
  );
}

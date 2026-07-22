import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

import {
  episodeCreationBlocker,
  episodeStatePresentation,
  episodeWorkflowStates,
} from "../../src/domain/studio";
import type { StudioSearchMatch } from "../../src/domain/studio-search";
import {
  deterministicStateMatrixProjection,
  deterministicStudioProjection,
  deterministicUnavailableStudioProjection,
} from "../../src/test/fakes/studio";

const runtimeFailures = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const failures: string[] = [];
  runtimeFailures.set(page, failures);
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      (url.protocol === "http:" || url.protocol === "https:") &&
      !["127.0.0.1", "localhost"].includes(url.hostname)
    ) {
      failures.push(`unexpected network egress: ${url.origin}`);
    }
  });
});

test.afterEach(async ({ page }) => {
  expect(runtimeFailures.get(page) ?? []).toEqual([]);
});

async function openStudio(page: Page): Promise<void> {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#main-content")).toHaveAttribute("data-hydrated", "true");
}

async function mockPhase1Search(
  page: Page,
  additionalMatches: readonly StudioSearchMatch[] = [],
): Promise<void> {
  const projection = deterministicStudioProjection();
  await page.route("**/api/studio/search?**", async (route) => {
    const query =
      new URL(route.request().url()).searchParams.get("q")?.toLowerCase() ?? "";
    const matches: StudioSearchMatch[] = [
      ...projection.series.map((series) => ({
        id: series.id,
        kind: "Series" as const,
        label: series.title,
        series,
      })),
      ...projection.episodes.flatMap((episode) => {
        const series = projection.series.find(({ id }) => id === episode.seriesId);
        return series
          ? [
              {
                episode,
                id: episode.id,
                kind: "Episode" as const,
                label: episode.title,
                series,
              },
            ]
          : [];
      }),
      ...additionalMatches,
    ].filter((match) => match.label.toLowerCase().includes(query));
    await route.fulfill({
      body: JSON.stringify({ matches, nextCursor: null, total: matches.length }),
      contentType: "application/json",
      status: 200,
    });
  });
}

test("opens the truthful Living Cinema preview and switches Episodes", async ({
  page,
}) => {
  await openStudio(page);

  await expect(
    page.getByRole("heading", { level: 1, name: "Your films are in motion." }),
  ).toBeVisible();
  await expect(page.getByText(/illustrative data/i)).toBeVisible();

  const kali = page.getByRole("button", {
    name: /Forms of Shakti The Awakening of Kali/,
  });
  await kali.click();
  await expect(kali).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("complementary").getByRole("heading", {
      name: "The Awakening of Kali",
    }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Open activity and notifications" }).click();
  await expect(
    page.getByRole("dialog", { name: "Activity and notifications" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close activity" }).click();

  await page.getByRole("button", { name: "Series", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Series becomes interactive");
  await expect(page.getByRole("button", { name: "Atrium" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("@a11y has no serious or critical violations in responsive overlays", async ({
  page,
}) => {
  await openStudio(page);

  async function expectNoBlockingViolations(): Promise<void> {
    const results = await new AxeBuilder({ page }).analyze();
    const blocking = results.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious",
    );
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  }

  await expectNoBlockingViolations();
  await page.getByRole("button", { name: "Open global search" }).click();
  await expectNoBlockingViolations();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Open activity and notifications" }).click();
  await expectNoBlockingViolations();
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoBlockingViolations();
  await expect(page.getByRole("button", { name: "Open global search" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open account menu preview" }),
  ).toBeVisible();
});

test("modal focus is contained, Escape closes, and focus returns", async ({ page }) => {
  await openStudio(page);

  const searchTrigger = page.getByRole("button", { name: "Open global search" });
  await searchTrigger.focus();
  await searchTrigger.click();
  const searchDialog = page.getByRole("dialog", { name: "Global search" });
  await expect(searchDialog).toBeVisible();
  await expect(page.getByRole("searchbox")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(searchDialog).toBeHidden();
  await expect(searchTrigger).toBeFocused();
  for (let cycle = 0; cycle < 5; cycle += 1) {
    await page.keyboard.press("Control+k");
    await expect(searchDialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(searchDialog).toBeHidden();
    await expect(searchTrigger).toBeFocused();
  }

  const activityTrigger = page.getByRole("button", {
    name: "Open activity and notifications",
  });
  await activityTrigger.click();
  const activityDialog = page.getByRole("dialog", {
    name: "Activity and notifications",
  });
  await expect(activityDialog).toBeVisible();
  for (let index = 0; index < 8; index += 1) {
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(() =>
        document.querySelector("dialog[open]")?.contains(document.activeElement),
      ),
    ).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(activityDialog).toBeHidden();
  await expect(activityTrigger).toBeFocused();
});

test("@visual preserves cinematic geometry, targets and mobile continuity", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openStudio(page);

  const desktopOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(desktopOverflow).toBeLessThanOrEqual(1);
  const desktopGeometry = await page.evaluate(() => {
    const cards = [...document.querySelectorAll<HTMLElement>(".episode-card")];
    const first = cards[0]?.getBoundingClientRect();
    const second = cards[1]?.getBoundingClientRect();
    const dock = document
      .querySelector<HTMLElement>(".studio-navigation")
      ?.getBoundingClientRect();
    const film = document
      .querySelector<HTMLElement>(".stage-window__film")
      ?.getBoundingClientRect();
    return {
      cardRatio: first && second ? first.width / second.width : 0,
      dockBottom: dock?.bottom ?? Number.POSITIVE_INFINITY,
      dockWidth: dock?.width ?? 0,
      firstCardTop: first?.top ?? 0,
      filmRatio: film ? film.height / film.width : 0,
      navigationPosition: getComputedStyle(
        document.querySelector<HTMLElement>(".studio-navigation")!,
      ).position,
    };
  });
  expect(desktopGeometry.cardRatio).toBeGreaterThan(1.4);
  expect(desktopGeometry.dockWidth).toBeLessThan(600);
  expect(desktopGeometry.filmRatio).toBeGreaterThan(1.25);
  expect(desktopGeometry.navigationPosition).toBe("relative");
  expect(desktopGeometry.dockBottom).toBeLessThan(desktopGeometry.firstCardTop);
  await page.screenshot({
    animations: "disabled",
    fullPage: false,
    path: ".tmp/artifacts/atrium-desktop.png",
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("navigation", { name: "Studio navigation" }),
  ).toBeVisible();
  const mobileOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  const overflowSources = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("body *")]
      .map((element) => {
        const box = element.getBoundingClientRect();
        return {
          className: element.className,
          right: Math.round(box.right),
          tag: element.tagName,
          width: Math.round(box.width),
        };
      })
      .filter(({ right, width }) => right > window.innerWidth + 1 && width > 0)
      .slice(0, 12),
  );
  expect(
    mobileOverflow,
    `Overflow sources: ${JSON.stringify(overflowSources)}`,
  ).toBeLessThanOrEqual(1);

  const undersizedTargets = await page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        "main button:not([disabled]), dialog[open] button:not([disabled])",
      ),
    ]
      .filter((element) => element.getClientRects().length > 0)
      .map((element) => {
        const box = element.getBoundingClientRect();
        return {
          height: Math.round(box.height),
          name: element.getAttribute("aria-label") || element.textContent?.trim(),
          width: Math.round(box.width),
        };
      })
      .filter(({ height, width }) => height < 44 || width < 44),
  );
  expect(undersizedTargets).toEqual([]);

  const undersizedText = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("main *")]
      .filter(
        (element) =>
          element.getClientRects().length > 0 &&
          [...element.childNodes].some(
            (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
          ),
      )
      .map((element) => ({
        fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
        text: element.textContent?.trim().slice(0, 60),
      }))
      .filter(({ fontSize }) => fontSize < 12),
  );
  expect(undersizedText).toEqual([]);

  const undersizedControlText = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("main button")]
      .filter((element) => element.getClientRects().length > 0)
      .map((element) => ({
        fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
        text: element.getAttribute("aria-label") || element.textContent?.trim(),
      }))
      .filter(({ fontSize }) => fontSize < 14),
  );
  expect(undersizedControlText).toEqual([]);

  const mobileDockOverlap = await page.evaluate(() => {
    const dock = document
      .querySelector<HTMLElement>(".studio-navigation")
      ?.getBoundingClientRect();
    const firstCard = document
      .querySelector<HTMLElement>(".episode-card")
      ?.getBoundingClientRect();
    return Boolean(dock && firstCard && dock.bottom > firstCard.top);
  });
  expect(mobileDockOverlap).toBe(false);

  await page.screenshot({
    animations: "disabled",
    fullPage: false,
    path: ".tmp/artifacts/atrium-mobile.png",
  });

  await page
    .getByRole("button", {
      name: /Shiva: The Infinite When Ganga Met the Mountain/,
    })
    .click();
  await expect(page.locator(".episode-focus")).toBeFocused();
  await expect(page.locator(".episode-focus")).not.toHaveCSS("outline-style", "none");
});

test("Phase 1 fixture organizes concurrent Episodes, Series and review work", async ({
  page,
}) => {
  await page.goto("/?fixture=phase1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#main-content")).toHaveAttribute("data-hydrated", "true");
  await expect(
    page.getByRole("heading", { level: 1, name: "Your films are in motion." }),
  ).toBeVisible();
  await expect(page.getByText("1 need you")).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "Series", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".atrium-series-grid > button")).toHaveCount(2);
  await expect(
    page.getByRole("heading", { level: 2, name: "Episodes in progress" }),
  ).toBeVisible();
  await expect(page.locator(".live-episode-card")).toHaveCount(2);
  await expect(page.locator(".live-focus")).toHaveCount(0);
  for (const episode of deterministicStudioProjection().episodes) {
    await expect(
      page.getByRole("link", { name: new RegExp(`Open ${episode.title}`) }),
    ).toHaveAttribute("href", new RegExp(`/episodes/${episode.id}/create`));
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);

  await page.screenshot({
    animations: "disabled",
    fullPage: false,
    path: ".tmp/artifacts/phase1-studio-desktop.png",
  });

  await page.getByRole("button", { name: "Series", exact: true }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Every story has a world." }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Series Shiva: The/ })).toBeVisible();

  await expect(page.getByRole("button", { name: "Monica" })).toHaveCount(0);
  await page.getByRole("button", { name: "Open activity and notifications" }).click();
  const activity = page.getByRole("dialog", { name: "Activity and notifications" });
  await expect(activity.getByRole("heading", { name: "Needs you" })).toBeVisible();
  await expect(activity.getByText(/theological framing/i)).toBeVisible();
  await activity.getByRole("button", { name: "Close activity" }).click();

  await expect(page.getByRole("button", { name: "Library" })).toHaveCount(0);
});

test("Phase 1 Series selection shows only compact Episodes and preselects Episode creation", async ({
  page,
}) => {
  const projection = deterministicStudioProjection();
  const selectedSeries = projection.series[0]!;
  await page.goto("/?fixture=phase1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#main-content")).toHaveAttribute("data-hydrated", "true");
  await page.getByRole("button", { name: "Series", exact: true }).click();

  const seriesGroup = page.getByRole("group", { name: "Choose a Series" });
  const selectedOption = seriesGroup.getByRole("button", {
    name: new RegExp(selectedSeries.title),
  });
  await expect(selectedOption).toHaveAttribute("aria-pressed", "true");
  await expect(selectedOption).toHaveAttribute(
    "aria-controls",
    "selected-series-details",
  );
  const details = page.getByRole("complementary", {
    name: `Episodes in ${selectedSeries.title}`,
  });
  await expect(details.locator(".live-episode-card")).toHaveCount(2);
  await expect(details.getByRole("heading")).toHaveCount(0);
  await expect(details.locator(".series-inheritance")).toHaveCount(0);
  for (const episode of projection.episodes) {
    await expect(
      details.getByRole("link", { name: new RegExp(`Open ${episode.title}`) }),
    ).toHaveAttribute("href", new RegExp(`/episodes/${episode.id}/create`));
  }

  await details.getByRole("button", { name: "Create Episode" }).click();
  const composer = page.getByRole("dialog", { name: "Create in Genie" });
  await expect(composer).toBeVisible();
  await expect(composer.getByLabel("Series")).toHaveValue(selectedSeries.id);
  await expect(
    composer.getByRole("heading", { name: "Create an Episode" }),
  ).toBeVisible();
  await composer.getByRole("button", { name: "Close composer" }).click();

  const unreleasedSeries = projection.series[1]!;
  await seriesGroup
    .getByRole("button", { name: new RegExp(unreleasedSeries.title) })
    .click();
  const unreleasedDetails = page.getByRole("complementary", {
    name: `Episodes in ${unreleasedSeries.title}`,
  });
  await expect(unreleasedDetails.locator(".live-episode-card")).toHaveCount(0);
  await expect(
    unreleasedDetails.getByRole("button", { name: "Create Episode" }),
  ).toBeEnabled();
});

test("Phase 1 keeps compact cards consistent and uncluttered across responsive layouts", async ({
  page,
}) => {
  await page.setViewportSize({ height: 650, width: 1280 });
  await page.goto("/?fixture=phase1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#main-content")).toHaveAttribute("data-hydrated", "true");
  await page.getByRole("button", { name: "Open activity and notifications" }).click();
  const activityDialog = page.getByRole("dialog", {
    name: "Activity and notifications",
  });
  await expect(activityDialog).toBeVisible();
  await page.keyboard.press("Control+k");
  await page.keyboard.press("Control+n");
  await expect(activityDialog).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Global search" })).toBeHidden();
  await expect(page.getByRole("dialog", { name: "Create in Genie" })).toBeHidden();
  await expect(page.locator("dialog[open]")).toHaveCount(1);
  await activityDialog.getByRole("button", { name: "Close activity" }).click();
  await expect(page.locator(".live-focus")).toHaveCount(0);
  const atriumCards = await page.locator(".live-episode-card").evaluateAll((cards) =>
    cards.map((card) => ({
      height: Math.round(card.getBoundingClientRect().height),
      width: Math.round(card.getBoundingClientRect().width),
    })),
  );
  expect(new Set(atriumCards.map(({ height }) => height)).size).toBe(1);
  expect(new Set(atriumCards.map(({ width }) => width)).size).toBe(1);

  await page.setViewportSize({ height: 844, width: 390 });
  await page.getByRole("button", { name: "Series", exact: true }).click();
  const details = page.locator(".selected-series-episodes");
  await expect(details).toBeVisible();
  expect(
    await details.evaluate((element) => element.scrollWidth - element.clientWidth),
  ).toBeLessThanOrEqual(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
});

test("composer isolates drafts by mode and Series and clears a committed draft", async ({
  page,
}) => {
  const projection = deterministicStudioProjection();
  const createdEpisodeId = "10000000-0000-4000-8000-000000000099";
  await page.route("**/api/commands", async (route) => {
    await route.fulfill({
      json: { ok: true, result: { episodeId: createdEpisodeId } },
      status: 200,
    });
  });
  await page.goto("/?fixture=phase1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#main-content")).toHaveAttribute("data-hydrated", "true");

  await page.getByRole("button", { name: "Create Episode" }).click();
  let composer = page.getByRole("dialog", { name: "Create in Genie" });
  await composer.getByLabel("Episode title").fill("Draft for the first Series");
  await composer.getByLabel("Series").selectOption(projection.series[1]!.id);
  await expect(composer.getByLabel("Episode title")).toHaveValue("");
  await composer.getByLabel("Episode title").fill("Committed Episode");
  await expect(composer.getByLabel("Story note")).toHaveCount(0);
  await composer.getByRole("button", { name: "Close composer" }).click();

  await page.getByRole("button", { name: "Series", exact: true }).click();
  await page.getByRole("button", { name: "Create Series" }).click();
  composer = page.getByRole("dialog", { name: "Create in Genie" });
  await expect(composer.getByLabel("Series title")).toHaveValue("");
  await expect(composer.getByLabel("World note")).toHaveValue("");
  await composer.getByRole("button", { name: "Close composer" }).click();

  await page.getByRole("button", { name: "Atrium", exact: true }).click();
  await page.getByRole("button", { name: "Create Episode" }).click();
  composer = page.getByRole("dialog", { name: "Create in Genie" });
  await composer.getByLabel("Episode title").fill("Committed Episode");
  const creationNavigation = page.waitForRequest((request) =>
    request.url().includes(`/episodes/${createdEpisodeId}/create`),
  );
  await composer.getByRole("button", { name: "Create Episode" }).click();
  await expect(creationNavigation).resolves.toBeDefined();
});

test("Phase 1 future and malformed lifecycle projections remain read-only", async ({
  page,
}) => {
  const projection = deterministicUnavailableStudioProjection();
  const commandRequests: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/commands")) {
      commandRequests.push(request.postData() ?? "");
    }
  });

  await page.goto("/?fixture=phase1-unavailable", {
    waitUntil: "domcontentloaded",
  });
  await expect(page.locator("#main-content")).toHaveAttribute("data-hydrated", "true");
  const episodeCard = page.getByRole("link", {
    name: new RegExp(`Open ${projection.episodes[0]!.title}`),
  });
  await expect(episodeCard.locator(".state-chip")).toHaveText("Unavailable");
  await expect(episodeCard).toHaveAttribute(
    "href",
    new RegExp(`/episodes/${projection.episodes[0]!.id}/create`),
  );

  await page.getByRole("button", { name: "Series", exact: true }).click();
  const unavailableSeries = projection.series[0]!;
  const unavailableCard = page
    .locator(".series-world")
    .filter({ hasText: unavailableSeries.title });
  await expect(unavailableCard.getByRole("button", { name: "Archive" })).toHaveCount(0);
  const seriesDetails = page.getByRole("complementary", {
    name: `Episodes in ${unavailableSeries.title}`,
  });
  await expect(
    seriesDetails.getByRole("button", { name: "Create Episode" }),
  ).toBeDisabled();
  await expect(
    seriesDetails.getByRole("button", { name: "Create Episode" }),
  ).toHaveAttribute("title", episodeCreationBlocker(unavailableSeries)!);

  const malformedSeries = projection.series[1]!;
  await page
    .getByRole("group", { name: "Choose a Series" })
    .getByRole("button", { name: new RegExp(malformedSeries.title) })
    .click();
  const malformedDetails = page.getByRole("complementary", {
    name: `Episodes in ${malformedSeries.title}`,
  });
  const malformedCard = page
    .locator(".series-world")
    .filter({ hasText: malformedSeries.title });
  await expect(malformedCard.getByRole("button", { name: "Archive" })).toHaveCount(0);
  await expect(
    malformedDetails.getByRole("button", { name: "Create Episode" }),
  ).toBeDisabled();
  await expect(
    malformedDetails.getByRole("button", { name: "Create Episode" }),
  ).toHaveAttribute("title", episodeCreationBlocker(malformedSeries)!);
  expect(commandRequests).toEqual([]);
});

test("Phase 1 exposes every in-progress workflow state as a direct Episode link", async ({
  page,
}) => {
  const projection = deterministicStateMatrixProjection();
  const terminalStates = new Set(["abandoned", "approved", "canceled", "delivered"]);
  const inProgress = projection.episodes.filter(
    ({ workflowState }) => !terminalStates.has(workflowState),
  );
  await page.goto("/?fixture=phase1-states", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#main-content")).toHaveAttribute("data-hydrated", "true");

  await expect(page.locator(".live-episode-card")).toHaveCount(inProgress.length);
  for (const episode of inProgress) {
    const card = page.getByRole("link", {
      name: new RegExp(`Open ${episode.title}`),
    });
    await expect(card.locator(".state-chip")).toHaveText(
      episodeStatePresentation(episode.workflowState).label,
    );
    await expect(card).toHaveAttribute(
      "href",
      new RegExp(`/episodes/${episode.id}/create`),
    );
  }
});

test("Phase 1 search announces results and provides a 44px close target", async ({
  page,
}) => {
  await mockPhase1Search(page);
  await page.goto("/?fixture=phase1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#main-content")).toHaveAttribute("data-hydrated", "true");
  await page.getByRole("button", { name: "Open global search" }).click();
  const dialog = page.getByRole("dialog", { name: "Global search" });
  const status = dialog.getByRole("status");
  await expect(status).toHaveText("Type at least two characters to search.");
  await dialog.getByRole("searchbox").fill("Shiva");
  await expect(status).toHaveText("1 of 1 authorized results shown.");
  const close = dialog.getByRole("button", { name: "Close global search" });
  const closeBox = await close.boundingBox();
  expect(closeBox).not.toBeNull();
  expect(closeBox?.width ?? 0).toBeGreaterThanOrEqual(44);
  expect(closeBox?.height ?? 0).toBeGreaterThanOrEqual(44);
});

test("Phase 1 removes the duplicate Episode detail column at 1280x720", async ({
  page,
}) => {
  await page.setViewportSize({ height: 720, width: 1280 });
  await page.goto("/?fixture=phase1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#main-content")).toHaveAttribute("data-hydrated", "true");
  await expect(page.locator(".live-focus")).toHaveCount(0);
  await expect(page.locator(".live-episode-layout")).toHaveCount(0);
  await expect(page.locator(".live-episode-card")).toHaveCount(2);
  const galleryWidth = await page
    .locator(".live-gallery")
    .evaluate((element) => Math.round(element.getBoundingClientRect().width));
  expect(galleryWidth).toBeGreaterThan(1000);
});

test("Phase 1 fixture remains accessible and continuous at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?fixture=phase1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#main-content")).toHaveAttribute("data-hydrated", "true");
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      ({ impact }) => impact === "critical" || impact === "serious",
    ),
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
  const undersizedTargets = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("main button:not([disabled])")]
      .filter((element) => element.getClientRects().length > 0)
      .map((element) => {
        const box = element.getBoundingClientRect();
        return {
          height: Math.round(box.height),
          label: element.getAttribute("aria-label") ?? element.textContent,
          width: Math.round(box.width),
        };
      })
      .filter(({ height, width }) => height < 44 || width < 44),
  );
  expect(undersizedTargets).toEqual([]);

  await page.getByRole("button", { name: "Create Episode" }).click();
  await expect(page.getByRole("dialog", { name: "Create in Genie" })).toBeVisible();
  await expect(page.getByText(/add the exact narration script/i)).toBeVisible();
  const composerGeometry = await page.evaluate(() => {
    const dialog = document.querySelector<HTMLDialogElement>(".composer-dialog")!;
    const close = dialog.querySelector<HTMLElement>("[aria-label='Close composer']")!;
    const closeBox = close.getBoundingClientRect();
    return {
      closeLeft: closeBox.left,
      closeRight: closeBox.right,
      dialogClientWidth: dialog.clientWidth,
      dialogScrollWidth: dialog.scrollWidth,
      viewportWidth: window.innerWidth,
    };
  });
  expect(composerGeometry.dialogScrollWidth).toBeLessThanOrEqual(
    composerGeometry.dialogClientWidth + 1,
  );
  expect(composerGeometry.closeLeft).toBeGreaterThanOrEqual(0);
  expect(composerGeometry.closeRight).toBeLessThanOrEqual(
    composerGeometry.viewportWidth,
  );
  await page.screenshot({
    animations: "disabled",
    fullPage: false,
    path: ".tmp/artifacts/phase1-studio-mobile.png",
  });
  await page.getByRole("button", { name: "Close composer" }).click();

  const secondEpisode = page.locator(".live-episode-card").nth(1);
  await secondEpisode.focus();
  await expect(secondEpisode).toBeFocused();
  await expect(secondEpisode).toHaveAttribute(
    "href",
    /\/episodes\/.+\/create\?seriesId=.+&episodeId=.+/,
  );
});

test("Phase 1 empty and complete state fixtures remain accessible at every target width", async ({
  page,
}) => {
  const viewports = [
    { height: 900, name: "desktop", width: 1440 },
    { height: 1024, name: "tablet", width: 820 },
    { height: 844, name: "mobile", width: 390 },
  ] as const;
  const terminalStates = new Set(["abandoned", "approved", "canceled", "delivered"]);
  const visibleStates = episodeWorkflowStates.filter(
    (state) => !terminalStates.has(state),
  );
  const expectedLabels = visibleStates.map(
    (state) => episodeStatePresentation(state).label,
  );

  for (const viewport of viewports) {
    await test.step(`${viewport.name} empty state`, async () => {
      await page.setViewportSize(viewport);
      await page.goto("/?fixture=phase1-empty", { waitUntil: "domcontentloaded" });
      await expect(page.locator("#main-content")).toHaveAttribute(
        "data-hydrated",
        "true",
      );
      await expect(
        page.getByRole("heading", { name: "The first frame is yours." }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Create the first Series" }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(1);
    });

    await test.step(`${viewport.name} mixed workflow states`, async () => {
      await page.goto("/?fixture=phase1-states", { waitUntil: "domcontentloaded" });
      await expect(page.locator("#main-content")).toHaveAttribute(
        "data-hydrated",
        "true",
      );
      const cards = page.locator(".live-episode-card");
      await expect(cards).toHaveCount(visibleStates.length);
      await expect(cards.locator(".state-chip")).toHaveText(expectedLabels);
      await expect(page.getByText("Resumed production", { exact: true })).toBeVisible();
      await expect(page.getByText("Happy path approved", { exact: true })).toHaveCount(
        0,
      );
      await page.getByRole("button", { name: "Series", exact: true }).click();
      await expect(
        page.getByText("Happy path approved", { exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(1);
      const results = await new AxeBuilder({ page }).analyze();
      expect(
        results.violations.filter(
          ({ impact }) => impact === "critical" || impact === "serious",
        ),
      ).toEqual([]);
    });
  }
});

test("Phase 1 restores the selected Series and Episode from creation context", async ({
  page,
}) => {
  const projection = deterministicStateMatrixProjection();
  const delivered = projection.episodes.find(
    ({ workflowState }) => workflowState === "delivered",
  )!;
  await page.goto(
    `/?fixture=phase1-states&seriesId=${encodeURIComponent(delivered.seriesId)}&episodeId=${encodeURIComponent(delivered.id)}`,
    { waitUntil: "domcontentloaded" },
  );
  const selectedSeries = projection.series.find(({ id }) => id === delivered.seriesId)!;
  await expect(
    page.getByRole("group", { name: "Choose a Series" }).getByRole("button", {
      name: new RegExp(selectedSeries.title),
    }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page
      .getByRole("complementary", {
        name: `Episodes in ${selectedSeries.title}`,
      })
      .getByRole("link", { name: new RegExp(`Open ${delivered.title}`) }),
  ).toBeVisible();
});

test("Phase 1 global search opens an authorized Episode beyond the initial projection", async ({
  page,
}) => {
  const projection = deterministicStudioProjection();
  const series = {
    ...projection.series[0]!,
    id: "10000000-0000-4000-8000-0000000000b0",
    title: "Hidden Rivers",
  };
  const episode = {
    ...projection.episodes[0]!,
    id: "10000000-0000-4000-8000-0000000000b1",
    seriesId: series.id,
    title: "The River Beyond the Index",
    workflowState: "producing" as const,
  };
  await mockPhase1Search(page, [
    { episode, id: episode.id, kind: "Episode", label: episode.title, series },
  ]);
  await page.goto("/?fixture=phase1", { waitUntil: "domcontentloaded" });
  await expect(page.locator('main[data-hydrated="true"]')).toBeVisible();
  await page.getByRole("button", { name: "Open global search" }).click();
  await page.getByRole("searchbox").fill("Beyond the Index");
  const destinationRequest = page.waitForRequest((request) => {
    const destination = new URL(request.url());
    return (
      request.method() === "GET" &&
      destination.pathname === `/episodes/${episode.id}/create` &&
      destination.searchParams.get("seriesId") === series.id &&
      destination.searchParams.get("episodeId") === episode.id
    );
  });
  await page
    .getByRole("button", { name: /Episode The River Beyond the Index/ })
    .click();
  await destinationRequest;
  await expect(page.getByRole("dialog", { name: "Global search" })).not.toBeVisible();
});

test("Phase 1 global search ignores stale pagination after the query changes", async ({
  page,
}) => {
  const projection = deterministicStudioProjection();
  const alphaFirst = {
    id: projection.series[0]!.id,
    kind: "Series" as const,
    label: "Alpha First",
    series: { ...projection.series[0]!, title: "Alpha First" },
  };
  const alphaLater = {
    id: projection.series[1]!.id,
    kind: "Series" as const,
    label: "Alpha Later",
    series: { ...projection.series[1]!, title: "Alpha Later" },
  };
  const betaCurrent = {
    id: projection.episodes[0]!.id,
    kind: "Episode" as const,
    label: "Beta Current",
    episode: { ...projection.episodes[0]!, title: "Beta Current" },
    series: projection.series[0]!,
  };
  let markAlphaLaterSettled: (() => void) | undefined;
  let markAlphaLaterStarted: (() => void) | undefined;
  let releaseAlphaLater: (() => void) | undefined;
  const alphaLaterStarted = new Promise<void>((resolve) => {
    markAlphaLaterStarted = resolve;
  });
  const alphaLaterGate = new Promise<void>((resolve) => {
    releaseAlphaLater = resolve;
  });
  const alphaLaterSettled = new Promise<void>((resolve) => {
    markAlphaLaterSettled = resolve;
  });

  await page.route("**/api/studio/search?**", async (route) => {
    const parameters = new URL(route.request().url()).searchParams;
    const query = parameters.get("q");
    const seriesOffset = Number(parameters.get("seriesOffset") ?? 0);
    if (query === "Alpha" && seriesOffset === 0) {
      await route.fulfill({
        body: JSON.stringify({
          matches: [alphaFirst],
          nextCursor: { episodeOffset: 0, seriesOffset: 1 },
          total: 2,
        }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    if (query === "Alpha" && seriesOffset === 1) {
      markAlphaLaterStarted?.();
      await alphaLaterGate;
      try {
        await route.fulfill({
          body: JSON.stringify({
            matches: [alphaLater],
            nextCursor: null,
            total: 2,
          }),
          contentType: "application/json",
          status: 200,
        });
      } catch {
        // Query changes intentionally abort an in-flight stale page.
      } finally {
        markAlphaLaterSettled?.();
      }
      return;
    }
    await route.fulfill({
      body: JSON.stringify({
        matches: query === "Beta" ? [betaCurrent] : [],
        nextCursor: null,
        total: query === "Beta" ? 1 : 0,
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/?fixture=phase1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#main-content")).toHaveAttribute("data-hydrated", "true");
  await page.getByRole("button", { name: "Open global search" }).click();
  const search = page.getByRole("searchbox");
  await search.fill("Alpha");
  await expect(page.getByText("Alpha First", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Show more of 2" }).click();
  await alphaLaterStarted;
  await search.fill("Beta");
  await expect(page.getByText("Beta Current", { exact: true })).toBeVisible();

  releaseAlphaLater?.();
  await alphaLaterSettled;
  await expect(page.getByText("Beta Current", { exact: true })).toBeVisible();
  await expect(page.getByText("Searching authorized studio…")).toBeHidden();
  await expect(page.getByText("Alpha Later", { exact: true })).toBeHidden();
});

test("Phase 1 shell renders persisted markup payloads only as inert text", async ({
  page,
}) => {
  await page.goto("/?fixture=phase1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#main-content")).toHaveAttribute("data-hydrated", "true");
  await page.getByRole("button", { name: "Series", exact: true }).click();
  await expect(
    page.locator("strong").filter({ hasText: "<img src=x onerror=" }),
  ).toBeVisible();
  expect(await page.locator("img[src=x]").count()).toBe(0);
  expect(
    await page.evaluate(
      () => (globalThis as typeof globalThis & { __genieXss?: number }).__genieXss,
    ),
  ).toBeUndefined();
});

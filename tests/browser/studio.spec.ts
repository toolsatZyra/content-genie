import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

import {
  episodeStatePresentation,
  episodeWorkflowStates,
} from "../../src/domain/studio";
import type { StudioSearchMatch } from "../../src/domain/studio-search";
import { deterministicStudioProjection } from "../../src/test/fakes/studio";

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

  await page.getByRole("button", { name: "Series" }).click();
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

test("Phase 1 fixture organizes concurrent Episodes, Series and Monica work", async ({
  page,
}) => {
  await mockPhase1Search(page);
  await page.goto("/?fixture=phase1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#main-content")).toHaveAttribute("data-hydrated", "true");
  await expect(
    page.getByRole("heading", { level: 1, name: "Your films are in motion." }),
  ).toBeVisible();
  await expect(page.getByText("1 need you")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);

  await page.getByRole("button", { name: "Open global search" }).click();
  const search = page.getByRole("searchbox");
  await expect(search).toBeFocused();
  await search.fill("Fire Beyond");
  await page.getByRole("button", { name: /Episode The Fire Beyond Sight/ }).click();
  await expect(
    page.getByRole("complementary").getByRole("heading", {
      name: "The Fire Beyond Sight",
    }),
  ).toBeVisible();
  await page.screenshot({
    animations: "disabled",
    fullPage: false,
    path: ".tmp/artifacts/phase1-studio-desktop.png",
  });

  await page.getByRole("button", { name: "Series", exact: true }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Every story has a world." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Series · active Shiva: The/ }),
  ).toBeVisible();

  await page.getByRole("button", { name: /Monica/ }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Monica is watching." }),
  ).toBeVisible();
  await expect(page.getByText(/theological framing/i)).toBeVisible();

  await page.getByRole("button", { name: "Library" }).click();
  await expect(page.getByText(/intentionally disabled/i)).toBeVisible();
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
  await expect(page.getByText(/script remains untouched/i)).toBeVisible();
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
});

test("Phase 1 empty and complete state fixtures remain accessible at every target width", async ({
  page,
}) => {
  const viewports = [
    { height: 900, name: "desktop", width: 1440 },
    { height: 1024, name: "tablet", width: 820 },
    { height: 844, name: "mobile", width: 390 },
  ] as const;
  const expectedLabels = episodeWorkflowStates.map(
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
      await expect(cards).toHaveCount(episodeWorkflowStates.length);
      await expect(cards.locator(".state-chip")).toHaveText(expectedLabels);
      await expect(page.getByText("Resumed production", { exact: true })).toBeVisible();
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
  };
  await mockPhase1Search(page, [
    { episode, id: episode.id, kind: "Episode", label: episode.title, series },
  ]);
  await page.goto("/?fixture=phase1", { waitUntil: "domcontentloaded" });
  await expect(page.locator('main[data-hydrated="true"]')).toBeVisible();
  await page.getByRole("button", { name: "Open global search" }).click();
  await page.getByRole("searchbox").fill("Beyond the Index");
  await page
    .getByRole("button", { name: /Episode The River Beyond the Index/ })
    .click();
  await expect(
    page.getByRole("complementary").getByRole("heading", {
      name: "The River Beyond the Index",
    }),
  ).toBeVisible();
  await expect(page.getByText("3 Episodes shown")).toBeVisible();
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

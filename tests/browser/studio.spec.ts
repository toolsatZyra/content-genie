import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

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

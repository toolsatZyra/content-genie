import { expect, test } from "@playwright/test";

const episodeId = "10000000-0000-4000-8000-000000000110";

test("owner watches, confirms and approves the final MVP master", async ({ page }) => {
  let reviewBody: Record<string, unknown> | undefined;
  await page.route(`**/api/episodes/${episodeId}/mvp-production`, async (route) => {
    reviewBody = JSON.parse(route.request().postData() ?? "{}") as Record<
      string,
      unknown
    >;
    await route.fulfill({
      body: JSON.stringify({ ok: true }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto(`/episodes/${episodeId}/production?fixture=mvp-review`);

  await expect(
    page.getByRole("heading", { name: "Your Episode is ready to watch." }),
  ).toBeVisible();
  await expect(page.locator("video")).toBeVisible();
  const approve = page.getByRole("button", { name: "Approve final film" });
  await expect(approve).toBeDisabled();
  await page.getByLabel(/Cultural integrity confirmed/).check();
  await page.getByLabel(/Final film confirmed/).check();
  await expect(approve).toBeEnabled();
  await approve.click();

  await expect
    .poll(() => reviewBody)
    .toMatchObject({
      action: "review",
      culturalReviewConfirmed: true,
      decision: "approve",
      expectedVersion: 1,
      feedback: "",
      finalReviewConfirmed: true,
      masterId: "53000000-0000-4000-8000-000000000002",
      workspaceId: "53000000-0000-4000-8000-000000000003",
    });
});

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

  await page.goto(`/episodes/${episodeId}/create?fixture=mvp-review`);

  await expect(page.getByRole("button", { name: /6 Edit/ })).toHaveAttribute(
    "aria-current",
    "step",
  );

  await expect(
    page.getByRole("heading", { name: "Your Episode is ready to watch." }),
  ).toBeVisible();
  await expect(page.locator("video")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Download current video" }),
  ).toBeVisible();
  const approve = page.getByRole("button", { name: "Approve video" });
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
      workspaceId: "10000000-0000-4000-8000-000000000101",
    });
});

test("approved Edit stage exposes the master and every used storyboard asset", async ({
  page,
}) => {
  await page.route("**/api/storage/sign", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as {
      path?: string;
    };
    expect(body.path).toContain("/mvp-edit-packages/");
    await route.fulfill({
      body: JSON.stringify({
        ok: true,
        signedUrl: "https://downloads.example.invalid/genie-approved-assets.zip",
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto(`/episodes/${episodeId}/create?fixture=mvp-approved`);

  await expect(page.getByRole("button", { name: /6 Edit/ })).toHaveAttribute(
    "aria-current",
    "step",
  );
  await expect(
    page.getByRole("heading", { name: "The final film is yours." }),
  ).toBeVisible();
  await expect(page.locator("video")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Download current video" }),
  ).toBeVisible();
  const packageDownload = page.getByRole("link", {
    name: "Download all images + clips",
  });
  await expect(packageDownload).toBeVisible();
  await expect(packageDownload).toHaveAttribute(
    "href",
    "https://downloads.example.invalid/genie-approved-assets.zip",
  );
});

test("Edit exposes Monica's real selective-repair work without leaving the stage", async ({
  page,
}) => {
  await page.goto(`/episodes/${episodeId}/create?fixture=mvp-repair`);

  await expect(page.getByRole("button", { name: /6 Edit/ })).toHaveAttribute(
    "aria-current",
    "step",
  );
  await expect(
    page.getByRole("heading", { name: "The film is taking shape." }),
  ).toBeVisible();
  await expect(
    page.getByText("Animating locked storyboard shots · 19 of 21 complete"),
  ).toBeVisible();
  const repair = page.locator(".repair-intelligence-panel");
  await expect(repair).toContainText("Repairing only what the feedback requires.");
  await expect(repair).toContainText("Attempt 2 · executing");
  await expect(repair).toContainText("3 / 21");
  await expect(repair).toContainText("Boards preserved19");
  await expect(repair).toContainText("Boards rebuilt1 / 2");
  await expect(repair).toContainText("Clips preserved18");
  await expect(repair).toContainText("Clips rebuilt1 / 3");
  await expect(repair).toContainText("Edit selections locked19 / 21");
});

test("Monica pauses ambiguous feedback for one no-spend clarification in Edit", async ({
  page,
}) => {
  let clarificationBody: Record<string, unknown> | undefined;
  await page.route(`**/api/episodes/${episodeId}/mvp-production`, async (route) => {
    clarificationBody = JSON.parse(route.request().postData() ?? "{}") as Record<
      string,
      unknown
    >;
    await route.fulfill({
      body: JSON.stringify({ ok: true }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto(`/episodes/${episodeId}/create?fixture=mvp-clarification`);
  await expect(page.getByRole("button", { name: /6 Edit/ })).toHaveAttribute(
    "aria-current",
    "step",
  );
  await expect(
    page.getByRole("heading", { name: "Monica needs one precise detail." }),
  ).toBeVisible();
  await expect(
    page.getByText(/At 00:14, do you want Rama's bow image changed/),
  ).toBeVisible();
  const answer = page.getByLabel("Your answer");
  const continueRepair = page.getByRole("button", { name: "Continue repair" });
  await expect(continueRepair).toBeDisabled();
  await answer.fill(
    "Keep the existing image at 00:14 and regenerate only the clip with faster bow movement.",
  );
  await continueRepair.click();
  await expect
    .poll(() => clarificationBody)
    .toMatchObject({
      action: "clarify",
      answer:
        "Keep the existing image at 00:14 and regenerate only the clip with faster bow movement.",
      clarificationId: "53000000-0000-4000-8000-000000000005",
      expectedVersion: 7,
      repairRequestId: "53000000-0000-4000-8000-000000000004",
      workspaceId: "10000000-0000-4000-8000-000000000101",
    });
});

test("legacy production URL returns to the canonical Edit stage", async ({ page }) => {
  await page.goto(`/episodes/${episodeId}/production?fixture=mvp-review`);
  await expect(page).toHaveURL(
    new RegExp(`/episodes/${episodeId}/create\\?resumeCreation=edit`),
  );
  await expect(page.getByRole("button", { name: /6 Edit/ })).toHaveAttribute(
    "aria-current",
    "step",
  );
});

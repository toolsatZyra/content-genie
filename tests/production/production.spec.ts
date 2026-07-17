import { expect, test } from "@playwright/test";

test("production runtime registers proxy and validates environment", async ({
  page,
  request,
}) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (outgoing) => {
    const url = new URL(outgoing.url());
    if (
      (url.protocol === "http:" || url.protocol === "https:") &&
      !["127.0.0.1", "localhost"].includes(url.hostname)
    ) {
      pageErrors.push(`unexpected network egress: ${url.origin}`);
    }
  });

  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  expect(response?.headers()["x-request-id"]).toMatch(/^request_/);
  await expect(
    page.getByRole("heading", { name: "Your films are in motion." }),
  ).toBeVisible();

  const health = await request.get("/api/health/runtime");
  expect(health.status()).toBe(200);
  await expect(health.json()).resolves.toMatchObject({
    environment: "production",
    ok: true,
  });

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

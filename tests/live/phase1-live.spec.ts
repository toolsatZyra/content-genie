import { createHmac } from "node:crypto";

import { expect, test } from "@playwright/test";

function decodeBase32(value: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...value.replaceAll(" ", "").toUpperCase()]
    .map((character) => alphabet.indexOf(character).toString(2).padStart(5, "0"))
    .join("");
  return Buffer.from(
    bits
      .match(/.{8}/g)
      ?.map((byte) => String.fromCharCode(Number.parseInt(byte, 2)))
      .join("") ?? "",
    "binary",
  );
}

function totp(secret: string): string {
  const counter = Math.floor(Date.now() / 30_000);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decodeBase32(secret)).update(message).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const code =
    (((digest[offset]! & 0x7f) << 24) |
      (digest[offset + 1]! << 16) |
      (digest[offset + 2]! << 8) |
      digest[offset + 3]!) %
    1_000_000;
  return String(code).padStart(6, "0");
}

test("authenticated owner can organize work, enroll MFA and issue an invitation", async ({
  browser,
  page,
}) => {
  const runtimeFailures: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") runtimeFailures.push(`console: ${message.text()}`);
  });
  page.on("requestfailed", (request) => {
    const url = new URL(request.url());
    if (
      request.failure()?.errorText === "net::ERR_ABORTED" &&
      ["/api/diagnostics/client", "/api/storage/sign"].includes(url.pathname)
    ) {
      return;
    }
    const failure = `request: ${url.hostname}${url.pathname} ${request.failure()?.errorText ?? "failed"}`;
    runtimeFailures.push(failure);
    console.log(failure);
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname.includes("/auth/v1/") && response.status() >= 400) {
      console.log(`auth response: ${url.hostname}${url.pathname} ${response.status()}`);
    }
  });
  await page.goto("/");
  await page.getByLabel("Studio email").fill(process.env.GENIE_LIVE_TEST_EMAIL!);
  await page.getByLabel("Password").fill(process.env.GENIE_LIVE_TEST_PASSWORD!);
  await page.getByRole("button", { name: "Enter Genie" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Your films are in motion." }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Live Episode 1")).toBeVisible();
  const diagnosticStatus = await page.evaluate(async () => {
    const response = await fetch("/api/diagnostics/client", {
      body: JSON.stringify({
        event: "app.client_error",
        message: "Live persistence probe",
        metadata: { source: "phase1-live-test" },
        occurredAt: new Date().toISOString(),
        requestId: `request_${crypto.randomUUID()}`,
        severity: "error",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    return response.status;
  });
  expect(diagnosticStatus).toBe(202);
  const storageSigning = await page.evaluate(async (objectPath) => {
    const response = await fetch("/api/storage/sign", {
      body: JSON.stringify({
        bucket: "workspace-private",
        expiresIn: 60,
        path: objectPath,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    return {
      body: (await response.json()) as { signedUrl?: string },
      status: response.status,
    };
  }, process.env.GENIE_LIVE_TEST_OBJECT_PATH!);
  expect(storageSigning.status).toBe(200);
  expect(storageSigning.body.signedUrl).toMatch(/^https?:\/\//);

  const seriesTitle = `Browser World ${Date.now().toString(36)}`;
  await page.getByRole("button", { name: "Series", exact: true }).click();
  await page.getByRole("button", { name: "Create Series" }).click();
  await page.getByLabel("Series title").fill(seriesTitle);
  await page
    .getByLabel("World note")
    .fill("Created through the authenticated command API.");
  await page.getByRole("button", { name: "Create creative world" }).click();
  await expect(page.getByText(seriesTitle, { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Open account settings" }).click();
  const account = page.getByRole("dialog", { name: "Account and trust" });
  await account.getByRole("button", { name: "Set up" }).click();
  const manualKey = await account.getByText(/Manual key:/).textContent();
  const secret = manualKey?.replace("Manual key:", "").trim();
  expect(secret).toBeTruthy();
  await account.getByLabel("Six-digit code").fill(totp(secret!));
  await account.getByRole("button", { name: "Verify authenticator" }).click();
  await expect(account.getByText(/Sensitive actions are now unlocked/)).toBeVisible();

  await account
    .getByLabel("Exact email")
    .fill(`invited-${Date.now().toString(36)}@example.test`);
  await account.getByRole("button", { name: "Create 24-hour invitation" }).click();
  await expect(account.getByLabel("One-time invitation link")).toHaveValue(
    /[?&]invite=[A-Za-z0-9_-]+/,
  );

  const outsiderContext = await browser.newContext();
  const outsiderPage = await outsiderContext.newPage();
  await outsiderPage.goto("/");
  await outsiderPage
    .getByLabel("Studio email")
    .fill(process.env.GENIE_LIVE_TEST_OUTSIDER_EMAIL!);
  await outsiderPage.getByLabel("Password").fill(process.env.GENIE_LIVE_TEST_PASSWORD!);
  await outsiderPage.getByRole("button", { name: "Enter Genie" }).click();
  await expect(
    outsiderPage.getByRole("heading", { level: 1, name: "Your films are in motion." }),
  ).toBeVisible({ timeout: 30_000 });
  const outsiderSigningStatus = await outsiderPage.evaluate(async (objectPath) => {
    const response = await fetch("/api/storage/sign", {
      body: JSON.stringify({
        bucket: "workspace-private",
        expiresIn: 60,
        path: objectPath,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    return response.status;
  }, process.env.GENIE_LIVE_TEST_OBJECT_PATH!);
  expect(outsiderSigningStatus).toBe(403);
  await outsiderContext.close();
  expect(runtimeFailures).toEqual([]);
});

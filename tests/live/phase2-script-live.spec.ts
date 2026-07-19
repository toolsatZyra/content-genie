import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const rawScript =
  "\u092a\u094d\u0930\u092d\u093e\u0924 \u0915\u0940 \u092a\u0939\u0932\u0940 \u0936\u094d\u0935\u093e\u0938\r\n\u0926\u0947\u0935\u0940 \u0928\u0947 e\u0301 \u0915\u0940 \u0927\u094d\u0935\u0928\u093f \u0938\u0941\u0928\u0940 \u0914\u0930 \u092e\u0941\u0938\u094d\u0915\u0941\u0930\u093e\u0908\u0902\u0964 \ud83d\udc69\ud83c\udffd\u200d\ud83d\ude80\r\n\u0950 \u0928\u092e\u0903 \u0936\u093f\u0935\u093e\u092f\u0964";
const coordinateBoundaryScript = `a${"\r".repeat(8_191)}`;
test.setTimeout(240_000);
test("authenticated browser preserves exact script and PostgreSQL accepts the exact byte boundary", async ({
  page,
}) => {
  const runtimeFailures: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") runtimeFailures.push(`console: ${message.text()}`);
  });
  page.on("response", (response) => {
    if (response.request().resourceType() === "image" && response.status() >= 400) {
      runtimeFailures.push(
        `response: image ${new URL(response.url()).pathname} HTTP ${response.status()}`,
      );
    }
  });
  page.on("requestfailed", (request) => {
    const errorText = request.failure()?.errorText ?? "failed";
    const pathname = new URL(request.url()).pathname;
    const expectedNavigationCancellation =
      errorText === "net::ERR_ABORTED" &&
      (request.isNavigationRequest() ||
        request.resourceType() === "stylesheet" ||
        request.headers().rsc === "1" ||
        (request.resourceType() === "image" && pathname.startsWith("/looks/")));
    if (!expectedNavigationCancellation) {
      runtimeFailures.push(
        `request: ${request.resourceType()} ${pathname} ${errorText}`,
      );
    }
  });

  const episodeId = process.env.GENIE_LIVE_TEST_EPISODE_ID!;
  if (!/^[0-9a-f-]{36}$/i.test(episodeId)) {
    throw new Error("The live Episode ID is not a UUID.");
  }

  await page.goto("/");
  await page.getByLabel("Studio email").fill(process.env.GENIE_LIVE_TEST_EMAIL!);
  await page.getByLabel("Password").fill(process.env.GENIE_LIVE_TEST_PASSWORD!);
  await page.getByRole("button", { name: "Enter Genie" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Your films are in motion." }),
  ).toBeVisible({ timeout: 30_000 });

  await page.goto(`/episodes/${episodeId}/create`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Give Genie the story." }),
  ).toBeVisible();
  const scriptInput = page.getByRole("textbox", {
    name: "Hindi background narration",
  });
  await scriptInput.evaluate((element, text) => {
    const transfer = new DataTransfer();
    transfer.setData("text/plain", text);
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: transfer,
      }),
    );
  }, rawScript);
  await expect(
    page.getByText(`${Buffer.byteLength(rawScript, "utf8")} / 8,192`),
  ).toBeVisible();
  await page
    .getByRole("checkbox", {
      name: /I understand the estimated narration is outside/,
    })
    .check({ timeout: 10_000 });

  const lockResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/episodes/${episodeId}/script-lock`) &&
      response.request().method() === "POST",
  );
  const projectionRefresh = page.waitForResponse(
    (response) =>
      response.url().includes(`/episodes/${episodeId}/create`) &&
      response.request().headers().rsc === "1",
  );
  await page.getByRole("button", { name: /Seal exact script/ }).click();
  const completedLockResponse = await lockResponse;
  expect(completedLockResponse.status()).toBe(200);
  const lockIdempotencyKey = completedLockResponse.request().headers()[
    "x-idempotency-key"
  ];
  if (!lockIdempotencyKey) {
    throw new Error("Script-lock request omitted its idempotency key.");
  }
  expect(lockIdempotencyKey).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/);
  const originalLockBody = completedLockResponse.request().postDataJSON() as {
    workspaceId: string;
  };
  const replayResponse = await page.request.post(
    `/api/episodes/${episodeId}/script-lock`,
    {
      data: {
        durationAcknowledged: true,
        episodeId,
        expectedEpisodeVersion: 1,
        rawText: rawScript,
        workspaceId: originalLockBody.workspaceId,
      },
      headers: {
        origin: new URL(page.url()).origin,
        "x-idempotency-key": lockIdempotencyKey,
      },
    },
  );
  expect(replayResponse.status()).toBe(200);
  await expect(replayResponse.json()).resolves.toMatchObject({ ok: true });
  // The parent-owned persistence check requires zero residual attestations,
  // proving that the replay's fresh server-selected authority was revoked even
  // though the idempotent command returned its already-committed response.
  await projectionRefresh;
  await expect(
    page.getByRole("heading", { name: "Who carries the story?" }),
  ).toBeVisible();

  const voiceResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/commands") &&
      response.request().method() === "POST" &&
      response.request().postDataJSON().commandType === "episode.voice.select",
  );
  const femaleVoice = page.getByRole("button", {
    name: /Female Target: expressive Hindi/,
  });
  await femaleVoice.click();
  expect((await voiceResponse).status()).toBe(200);
  await expect(femaleVoice).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: /Enter the look vault/ }).click();
  await page.getByRole("searchbox", { name: "Search all looks" }).fill("Divine Fury");
  const divineFury = page.getByRole("radio", { name: /Divine Fury:/ });
  await divineFury.click();
  await expect
    .poll(() =>
      divineFury
        .locator("img")
        .evaluate((image) =>
          image instanceof HTMLImageElement ? image.naturalWidth : 0,
        ),
    )
    .toBeGreaterThan(0);
  const lookResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/commands") &&
      response.request().method() === "POST" &&
      response.request().postDataJSON().commandType === "episode.look.select",
  );
  await page.getByRole("button", { name: "Use this look" }).click();
  expect((await lookResponse).status()).toBe(200);
  await expect(divineFury).toHaveAttribute("aria-checked", "true");

  await page.getByRole("button", { name: /Script/ }).click();
  await expect(
    page.getByRole("heading", { name: "Your script is sealed." }),
  ).toBeVisible();
  const sealedScript = page.getByLabel("Sealed Hindi background narration");
  await expect
    .poll(() => sealedScript.evaluate((element) => element.textContent))
    .toBe(rawScript);

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Who carries the story?" }),
  ).toBeVisible();
  const persistedFemale = page.getByRole("button", {
    name: /Female Target: expressive Hindi/,
  });
  await expect(persistedFemale).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: /Enter the look vault/ }).click();
  await page.getByRole("searchbox", { name: "Search all looks" }).fill("Divine Fury");
  await expect(page.getByRole("radio", { name: /Divine Fury:/ })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page.getByRole("button", { name: /Script/ }).click();
  await expect
    .poll(() =>
      page
        .getByLabel("Sealed Hindi background narration")
        .evaluate((element) => element.textContent),
    )
    .toBe(rawScript);

  expect(Buffer.byteLength(coordinateBoundaryScript, "utf8")).toBe(8_192);
  await page.goto("/");
  const seriesId = await page
    .locator('select[name="seriesId"] option')
    .first()
    .getAttribute("value");
  if (!seriesId || !/^[0-9a-f-]{36}$/i.test(seriesId)) {
    throw new Error("The live boundary probe could not resolve an active Series ID.");
  }
  const createBoundaryEpisode = await page.request.post("/api/commands", {
    data: {
      commandType: "episode.create",
      payload: {
        seriesId,
        summary: "Exact 8,192-byte PostgreSQL JSONB boundary proof",
        title: "Coordinate boundary proof",
        workspaceId: originalLockBody.workspaceId,
      },
    },
    headers: {
      origin: new URL(page.url()).origin,
      "x-idempotency-key": "phase2-coordinate-boundary-episode-0001",
    },
  });
  expect(createBoundaryEpisode.status()).toBe(200);
  const createBoundaryBody = (await createBoundaryEpisode.json()) as {
    ok?: boolean;
    result?: { episodeId?: unknown };
  };
  expect(createBoundaryBody.ok).toBe(true);
  const boundaryEpisodeId = createBoundaryBody.result?.episodeId;
  if (
    typeof boundaryEpisodeId !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(boundaryEpisodeId)
  ) {
    throw new Error("The boundary Episode command returned no Episode UUID.");
  }

  const boundaryPayload = {
    durationAcknowledged: true,
    episodeId: boundaryEpisodeId,
    expectedEpisodeVersion: 1,
    rawText: coordinateBoundaryScript,
    workspaceId: originalLockBody.workspaceId,
  };
  const aboveBoundaryResponse = await page.request.post(
    `/api/episodes/${boundaryEpisodeId}/script-lock`,
    {
      data: {
        ...boundaryPayload,
        rawText: `${coordinateBoundaryScript}a`,
      },
      headers: {
        origin: new URL(page.url()).origin,
        "x-idempotency-key": "phase2-coordinate-boundary-reject-0001",
      },
    },
  );
  expect(aboveBoundaryResponse.status()).toBe(400);
  const aboveBoundaryBody = (await aboveBoundaryResponse.json()) as {
    code?: unknown;
    ok?: boolean;
  };
  expect(aboveBoundaryBody).toMatchObject({
    code: "SCRIPT_TOO_LARGE",
    ok: false,
  });

  const boundaryResponse = await page.request.post(
    `/api/episodes/${boundaryEpisodeId}/script-lock`,
    {
      data: boundaryPayload,
      headers: {
        origin: new URL(page.url()).origin,
        "x-idempotency-key": "phase2-coordinate-boundary-accept-0001",
      },
    },
  );
  const boundaryBody = (await boundaryResponse.json()) as {
    code?: unknown;
    message?: unknown;
    ok?: boolean;
    result?: { scriptRevisionId?: unknown };
  };
  expect(
    boundaryResponse.status(),
    `Boundary lock response: ${JSON.stringify(boundaryBody)}`,
  ).toBe(200);
  expect(boundaryBody.ok).toBe(true);
  const boundaryScriptRevisionId = boundaryBody.result?.scriptRevisionId;
  expect(boundaryScriptRevisionId).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/i));
  if (typeof boundaryScriptRevisionId !== "string") {
    throw new Error("The boundary lock returned no Script Revision UUID.");
  }

  // A successful command proves that the coordinate map produced by the real
  // server path was inserted under script_revisions' pg_column_size(jsonb)
  // check. The pgTAP suite separately fails if that exact check is removed.
  await page.goto(`/episodes/${boundaryEpisodeId}/create`);
  await page
    .getByRole("navigation", { name: "Episode creation chambers" })
    .getByRole("button", { name: /Script/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your script is sealed." }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page
        .getByLabel("Sealed Hindi background narration")
        .evaluate((element) => element.textContent),
    )
    .toBe(coordinateBoundaryScript);

  expect(runtimeFailures).toEqual([]);
  await mkdir(".tmp", { recursive: true });
  await writeFile(
    ".tmp/phase2-live-boundary-evidence.json",
    `${JSON.stringify(
      {
        accepted: {
          bytes: Buffer.byteLength(coordinateBoundaryScript, "utf8"),
          episodeId: boundaryEpisodeId,
          rawUtf8Sha256: createHash("sha256")
            .update(coordinateBoundaryScript, "utf8")
            .digest("hex"),
          scriptRevisionId: boundaryScriptRevisionId,
          status: boundaryResponse.status(),
        },
        browserRoundTrip: true,
        rejected: {
          bytes: Buffer.byteLength(`${coordinateBoundaryScript}a`, "utf8"),
          code: aboveBoundaryBody.code,
          status: aboveBoundaryResponse.status(),
        },
        schemaVersion: "genie-script-boundary-evidence.v1",
      },
      null,
      2,
    )}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
});

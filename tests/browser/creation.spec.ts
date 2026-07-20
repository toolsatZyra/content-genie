import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const episodeId = "10000000-0000-4000-8000-000000000110";

function relativeLuminance([red, green, blue]: readonly number[]): number {
  const linear = (channel: number) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * linear(red ?? 0) + 0.7152 * linear(green ?? 0) + 0.0722 * linear(blue ?? 0)
  );
}

function contrastRatio(
  foreground: readonly number[],
  background: readonly number[],
): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
}

function rgbChannels(value: string): readonly number[] {
  return (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
}

async function expectActionTargetsAtLeast44(page: Page) {
  const violations = await page
    .locator(".creation-shell")
    .locator(
      'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [role="button"]',
    )
    .evaluateAll((elements) =>
      elements.flatMap((element) => {
        const style = getComputedStyle(element);
        const elementBox = element.getBoundingClientRect();
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          elementBox.width === 0 ||
          elementBox.height === 0
        ) {
          return [];
        }

        const pointerTarget =
          element instanceof HTMLInputElement &&
          (element.type === "checkbox" || element.type === "radio")
            ? (element.closest("label") ?? element)
            : element;
        const targetBox = pointerTarget.getBoundingClientRect();
        if (targetBox.width >= 44 && targetBox.height >= 44) return [];

        return [
          {
            height: targetBox.height,
            name:
              element.getAttribute("aria-label") ??
              element.getAttribute("placeholder") ??
              element.textContent?.trim().replace(/\s+/gu, " ").slice(0, 80) ??
              element.tagName,
            tag: element.tagName,
            width: targetBox.width,
          },
        ];
      }),
    );

  expect(violations).toEqual([]);
}

async function acknowledgePermanentSeal(page: Page): Promise<void> {
  await page
    .getByRole("checkbox", {
      name: /I understand that sealing is permanent/,
    })
    .check();
}

test.describe("Living Cinema creation flow", () => {
  test("preserves the sealed script and exposes the six honest chambers @a11y", async ({
    page,
  }) => {
    await page.goto(`/episodes/${episodeId}/create?fixture=phase2-script`);

    const rail = page.getByRole("navigation", {
      name: "Episode creation chambers",
    });
    await expect(rail.getByRole("button")).toHaveCount(6);
    for (const label of ["Script", "Voice", "Look", "World", "Preflight", "Create"]) {
      await expect(rail.getByRole("button", { name: new RegExp(label) })).toBeVisible();
    }

    await rail.getByRole("button", { name: /Script/ }).click();
    const exactScript =
      "कैलाश की निस्तब्धता में, जब महादेव ने अपने नेत्र खोले, तब सृष्टि ने पहली बार प्रकाश को पहचाना।";
    await expect(
      page.getByText("Genie can annotate your script, never rewrite it."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Seal exact script/ }),
    ).toBeDisabled();
    await expect(page.getByLabel("Sealed Hindi background narration")).toHaveText(
      exactScript,
    );
    await expect(page.getByLabel("Sealed Hindi background narration")).toHaveAttribute(
      "tabindex",
      "0",
    );
    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(
      accessibility.violations.filter(
        ({ impact }) => impact === "critical" || impact === "serious",
      ),
    ).toEqual([]);
  });

  test("opens each Episode at its authoritative current chamber", async ({ page }) => {
    await page.goto(`/episodes/${episodeId}/create?fixture=phase2-world`);
    const worldRail = page.getByRole("navigation", {
      name: "Episode creation chambers",
    });
    await expect(worldRail.getByRole("button", { name: /World/ })).toHaveAttribute(
      "aria-current",
      "step",
    );

    await page.goto(`/episodes/${episodeId}/create?fixture=phase2-delivered`);
    const deliveredRail = page.getByRole("navigation", {
      name: "Episode creation chambers",
    });
    await expect(deliveredRail.getByRole("button", { name: /Create/ })).toHaveAttribute(
      "aria-current",
      "step",
    );
  });

  test("preserves Atrium context and makes later or closed lifecycle setup read-only", async ({
    page,
  }) => {
    for (const [fixture, message] of [
      ["phase2-delivered", "Its sealed setup is read-only here."],
      ["phase2-canceled", "This Episode is closed."],
    ] as const) {
      await page.goto(`/episodes/${episodeId}/create?fixture=${fixture}`);
      await expect(page.getByRole("status").filter({ hasText: message })).toBeVisible();
      const back = page.getByRole("link", { name: /Atrium/ });
      await expect(back).toHaveAttribute(
        "href",
        /seriesId=10000000-0000-4000-8000-000000000105&episodeId=10000000-0000-4000-8000-000000000110/,
      );
      await page
        .getByRole("navigation", { name: "Episode creation chambers" })
        .getByRole("button", { name: /Script/ })
        .click();
      await expect(page.locator(".script-canvas textarea")).toHaveAttribute(
        "readonly",
        "",
      );
      await page
        .getByRole("navigation", { name: "Episode creation chambers" })
        .getByRole("button", { name: /Voice/ })
        .click();
      await expect(page.getByRole("button", { name: /Male/ })).toBeDisabled();
      await expect(page.getByRole("button", { name: /Female/ })).toBeDisabled();
    }
  });

  test("keeps a read-only Episode with no script visibly immutable", async ({
    page,
  }) => {
    await page.goto(`/episodes/${episodeId}/create?fixture=phase2-read-only-no-script`);
    const scriptInput = page.getByRole("textbox", {
      name: "Hindi background narration",
    });
    await expect(scriptInput).toHaveAttribute("readonly", "");
    await expect(scriptInput).toHaveValue("");

    const canceledMutations = await scriptInput.evaluate((element) => {
      const textarea = element as HTMLTextAreaElement;
      const clipboard = new DataTransfer();
      clipboard.setData("text/plain", "पेस्ट");
      const drop = new DataTransfer();
      drop.setData("text/plain", "ड्रॉप");
      const events = [
        new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          data: "शिव",
          inputType: "insertText",
        }),
        new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          inputType: "historyUndo",
        }),
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: clipboard,
        }),
        new ClipboardEvent("cut", {
          bubbles: true,
          cancelable: true,
          clipboardData: clipboard,
        }),
        new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer: drop,
        }),
      ];
      const canceled = events.map((event) => !textarea.dispatchEvent(event));

      const nativeValueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      nativeValueSetter?.call(textarea, "local bypass");
      textarea.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          data: "local bypass",
          inputType: "insertText",
        }),
      );
      return canceled;
    });

    expect(canceledMutations).toEqual([true, true, true, true, true]);
    await expect(scriptInput).toHaveValue("");
    await expect(page.getByText("0 / 8,192 exact UTF-8 bytes")).toBeVisible();
  });

  test("persists an exact local draft and gives an explicit Atrium exit choice", async ({
    page,
  }) => {
    await page.goto(`/episodes/${episodeId}/create?fixture=phase2-empty`);
    const draft = "कैलाश पर सुरक्षित अधूरा प्रारूप।";
    await page.getByRole("textbox", { name: "Hindi background narration" }).fill(draft);
    await expect(
      page.getByRole("status").filter({ hasText: "Exact draft saved on this device" }),
    ).toBeVisible();

    const restoredPage = await page.context().newPage();
    await restoredPage.goto(`/episodes/${episodeId}/create?fixture=phase2-empty`);
    await expect(
      restoredPage.getByRole("textbox", { name: "Hindi background narration" }),
    ).toHaveValue(draft);
    await expect(
      restoredPage
        .getByRole("status")
        .filter({ hasText: "Exact draft restored and saved on this device" }),
    ).toBeVisible();
    await restoredPage.close();

    page.once("dialog", async (dialog) => {
      expect(dialog.type()).toBe("confirm");
      expect(dialog.message()).toContain("exact script draft is saved");
      await dialog.dismiss();
    });
    await page.getByRole("link", { name: /Atrium/ }).click();
    await expect(page).toHaveURL(/fixture=phase2-empty/);
  });

  test("fails local draft protection visibly and warns before a lossy exit", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      for (const method of ["getItem", "setItem", "removeItem"] as const) {
        Object.defineProperty(Storage.prototype, method, {
          configurable: true,
          value(): never {
            throw new DOMException("storage denied", "SecurityError");
          },
        });
      }
    });
    await page.goto(`/episodes/${episodeId}/create?fixture=phase2-empty`);
    await page
      .getByRole("textbox", { name: "Hindi background narration" })
      .fill("This exact draft is not persisted");
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "Local draft protection is unavailable" }),
    ).toBeVisible();

    page.once("dialog", async (dialog) => {
      expect(dialog.type()).toBe("confirm");
      expect(dialog.message()).toContain("not confirmed saved on this device");
      expect(dialog.message()).toContain("permanently lose it");
      await dialog.dismiss();
    });
    await page.getByRole("link", { name: /Atrium/ }).click();
    await expect(page).toHaveURL(/fixture=phase2-empty/);
  });

  test("locks navigation while an irreversible script seal is in flight", async ({
    page,
  }) => {
    let releaseResponse: (() => void) | undefined;
    const responseGate = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    await page.route(`**/api/episodes/${episodeId}/script-lock`, async (route) => {
      await responseGate;
      await route.fulfill({
        json: { ok: true, result: { aggregateVersion: 2 } },
        status: 200,
      });
    });
    await page.goto(`/episodes/${episodeId}/create?fixture=phase2-empty`);
    await page
      .getByRole("textbox", { name: "Hindi background narration" })
      .fill("A protected exact draft");
    await page
      .getByRole("checkbox", {
        name: /I understand the estimated narration is outside/,
      })
      .check();
    await acknowledgePermanentSeal(page);
    await page.getByRole("button", { name: /Seal exact script/ }).click();

    const rail = page.getByRole("navigation", {
      name: "Episode creation chambers",
    });
    expect(
      await rail
        .getByRole("button")
        .evaluateAll((buttons) =>
          buttons.every((button) => button.hasAttribute("disabled")),
        ),
    ).toBe(true);
    await page.getByRole("link", { name: /Atrium/ }).click();
    await expect(page).toHaveURL(/fixture=phase2-empty/);
    await expect(
      page.getByRole("status").filter({ hasText: "authoritative save to finish" }),
    ).toBeVisible();

    releaseResponse?.();
    await expect(
      page.getByRole("heading", { name: "Who carries the story?" }),
    ).toBeVisible();
  });

  test("lets a read-only reviewer inspect looks without sending a mutation", async ({
    page,
  }) => {
    const mutations: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST") mutations.push(request.url());
    });
    await page.goto(
      `/episodes/${episodeId}/create?fixture=phase2-delivered&resumeCreation=look`,
    );

    const search = page.getByRole("searchbox", { name: "Search all looks" });
    await expect(search).toBeEnabled();
    await search.fill("Divine Fury");
    const preview = page.getByRole("button", { name: /Divine Fury.*Available/ });
    await expect(preview).toBeEnabled();
    await preview.click();
    await expect(preview).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("Inspecting", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Use this look" })).toBeDisabled();
    expect(mutations).toEqual([]);
  });

  test("does not misreport a missing configuration as an invalid narrator pin", async ({
    page,
  }) => {
    await page.route(`**/api/episodes/${episodeId}/script-lock`, async (route) => {
      await route.fulfill({
        json: { ok: true, result: { aggregateVersion: 2 } },
        status: 200,
      });
    });
    await page.goto(`/episodes/${episodeId}/create?fixture=phase2-empty`);
    await page
      .getByRole("textbox", { name: "Hindi background narration" })
      .fill("A short exact script");
    await page
      .getByRole("checkbox", {
        name: /I understand the estimated narration is outside/,
      })
      .check();
    await acknowledgePermanentSeal(page);
    await page.getByRole("button", { name: /Seal exact script/ }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Finishing the script seal" }),
    ).toBeVisible();
    await expect(
      page.getByRole("alert").filter({ hasText: "has not substituted another voice" }),
    ).toHaveCount(0);
  });

  test("splices exact CRLF paste into the selected draft range", async ({ page }) => {
    let lockedRawText = "";
    await page.route(`**/api/episodes/${episodeId}/script-lock`, async (route) => {
      lockedRawText = (route.request().postDataJSON() as { rawText: string }).rawText;
      await route.fulfill({
        json: { ok: true, result: { aggregateVersion: 2 } },
        status: 200,
      });
    });
    await page.goto(`/episodes/${episodeId}/create?fixture=phase2-empty`);

    const original = "\u092a\u0942\u0930\u094d\u0935X\u0905\u0902\u0924";
    const pasted = "\r\n\u092e\u0927\u094d\u092f\r\n";
    const expected = original.replace("X", pasted);
    const scriptInput = page.getByRole("textbox", {
      name: "Hindi background narration",
    });
    await scriptInput.fill(original);
    await scriptInput.evaluate((element, text) => {
      const textarea = element as HTMLTextAreaElement;
      const insertion = textarea.value.indexOf("X");
      textarea.setSelectionRange(insertion, insertion + 1);
      const transfer = new DataTransfer();
      transfer.setData("text/plain", text);
      textarea.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: transfer,
        }),
      );
    }, pasted);
    await expect(
      page.getByText(`${Buffer.byteLength(expected, "utf8")} / 8,192`),
    ).toBeVisible();
    await page
      .getByRole("checkbox", {
        name: /I understand the estimated narration is outside/,
      })
      .check();
    await acknowledgePermanentSeal(page);
    await page.getByRole("button", { name: /Seal exact script/ }).click();
    await expect.poll(() => lockedRawText).toBe(expected);
  });

  test("binds duration acknowledgement to the exact draft text", async ({ page }) => {
    await page.goto(`/episodes/${episodeId}/create?fixture=phase2-empty`);
    const scriptInput = page.getByRole("textbox", {
      name: "Hindi background narration",
    });
    const acknowledgement = page.getByRole("checkbox", {
      name: /I understand the estimated narration is outside/,
    });
    const permanentAcknowledgement = page.getByRole("checkbox", {
      name: /I understand that sealing is permanent/,
    });
    const seal = page.getByRole("button", { name: /Seal exact script/ });

    await scriptInput.fill("First exact draft");
    await acknowledgement.check();
    await permanentAcknowledgement.check();
    await expect(seal).toBeEnabled();

    await scriptInput.fill("First exact draft changed");
    await expect(acknowledgement).not.toBeChecked();
    await expect(permanentAcknowledgement).not.toBeChecked();
    await expect(seal).toBeDisabled();

    await scriptInput.press("Control+z");
    await expect(scriptInput).toHaveValue("First exact draft");
    await expect(acknowledgement).toBeChecked();
    await expect(permanentAcknowledgement).toBeChecked();
    await expect(seal).toBeEnabled();
  });

  test("reconciles a two-tab script conflict to the authoritative sealed revision", async ({
    page,
  }) => {
    await page.route(`**/api/episodes/${episodeId}/script-lock`, async (route) => {
      await route.fulfill({
        json: { message: "This Episode changed in another tab.", ok: false },
        status: 409,
      });
    });
    await page.goto(`/episodes/${episodeId}/create?fixture=phase2-stale-script`);
    await page
      .getByRole("textbox", { name: "Hindi background narration" })
      .fill("The stale tab draft");
    await page
      .getByRole("checkbox", {
        name: /I understand the estimated narration is outside/,
      })
      .check();
    await acknowledgePermanentSeal(page);
    await page.getByRole("button", { name: /Seal exact script/ }).click();

    await expect(page).toHaveURL(/resumeCreation=script/);
    await page
      .getByRole("navigation", { name: "Episode creation chambers" })
      .getByRole("button", { name: /Script/ })
      .click();
    await expect(
      page.getByRole("heading", { name: "Your script is sealed." }),
    ).toBeVisible();
    await expect(page.locator(".script-canvas textarea")).toHaveAttribute(
      "readonly",
      "",
    );
  });

  test("distinguishes an unknown script outcome and safely reconciles either result", async ({
    page,
  }) => {
    await page.route(`**/api/episodes/${episodeId}/script-lock`, async (route) => {
      await route.fulfill({
        json: { message: "Gateway response lost.", ok: false },
        status: 503,
      });
    });

    await page.goto(`/episodes/${episodeId}/create?fixture=phase2-empty`);
    const draft = "Outcome still unknown";
    await page.getByRole("textbox", { name: "Hindi background narration" }).fill(draft);
    await page
      .getByRole("checkbox", {
        name: /I understand the estimated narration is outside/,
      })
      .check();
    await acknowledgePermanentSeal(page);
    await page.getByRole("button", { name: /Seal exact script/ }).click();
    await expect(page.getByText("Outcome unconfirmed - reconciling")).toBeVisible();
    await expect(
      page.getByRole("status").filter({ hasText: "outcome is unconfirmed" }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Hindi background narration" }),
    ).toHaveValue(draft);

    await page.goto(`/episodes/${episodeId}/create?fixture=phase2-ambiguous-script`);
    await page
      .getByRole("textbox", { name: "Hindi background narration" })
      .fill("The response was lost after commit");
    await page
      .getByRole("checkbox", {
        name: /I understand the estimated narration is outside/,
      })
      .check();
    await acknowledgePermanentSeal(page);
    await page.getByRole("button", { name: /Seal exact script/ }).click();
    await expect(page).toHaveURL(/resumeCreation=script/);
    await page
      .getByRole("navigation", { name: "Episode creation chambers" })
      .getByRole("button", { name: /Script/ })
      .click();
    await expect(
      page.getByRole("heading", { name: "Your script is sealed." }),
    ).toBeVisible();
  });

  test("preserves exact CRLF bytes through delete, browser undo, and sealing", async ({
    page,
  }) => {
    let lockedRawText = "";
    await page.route(`**/api/episodes/${episodeId}/script-lock`, async (route) => {
      lockedRawText = (route.request().postDataJSON() as { rawText: string }).rawText;
      await route.fulfill({
        json: { ok: true, result: { aggregateVersion: 2 } },
        status: 200,
      });
    });
    await page.goto(`/episodes/${episodeId}/create?fixture=phase2-empty`);

    const exact = "A\r\nB";
    const scriptInput = page.getByRole("textbox", {
      name: "Hindi background narration",
    });
    await scriptInput.evaluate((element, text) => {
      const textarea = element as HTMLTextAreaElement;
      const transfer = new DataTransfer();
      transfer.setData("text/plain", text);
      textarea.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: transfer,
        }),
      );
    }, exact);
    await expect(page.getByText("4 / 8,192 exact UTF-8 bytes")).toBeVisible();

    await scriptInput.evaluate((element) => {
      (element as HTMLTextAreaElement).setSelectionRange(1, 2);
    });
    await scriptInput.press("Backspace");
    await expect(scriptInput).toHaveValue("AB");
    await scriptInput.press("Control+z");

    await expect(scriptInput).toHaveValue("A\nB");
    await expect(page.getByText("4 / 8,192 exact UTF-8 bytes")).toBeVisible();
    await page
      .getByRole("checkbox", {
        name: /I understand the estimated narration is outside/,
      })
      .check();
    await acknowledgePermanentSeal(page);
    await page.getByRole("button", { name: /Seal exact script/ }).click();
    await expect.poll(() => lockedRawText).toBe(exact);
  });

  test("preserves uploaded source bytes and clears the binding after an edit", async ({
    page,
  }) => {
    let postedPayload: Record<string, unknown> | undefined;
    await page.route(`**/api/episodes/${episodeId}/script-lock`, async (route) => {
      postedPayload = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        json: { ok: true, result: { aggregateVersion: 2 } },
        status: 200,
      });
    });
    await page.goto(`/episodes/${episodeId}/create?fixture=phase2-empty`);

    const upload = page.getByLabel("Upload .txt");
    const utf16Source = Buffer.from([0xff, 0xfe, 0x61, 0x00, 0x62, 0x00, 0x63, 0x00]);
    const file = {
      buffer: utf16Source,
      mimeType: "text/plain",
      name: "utf16-script.txt",
    };
    await upload.setInputFiles(file);

    const scriptInput = page.getByRole("textbox", {
      name: "Hindi background narration",
    });
    await expect(scriptInput).toHaveValue("abc");
    await expect(page.getByText(/utf16-script\.txt loaded/)).toBeVisible();
    await expect(
      page.getByText("8 original source bytes; 3 decoded UTF-8 bytes"),
    ).toBeVisible();

    await scriptInput.fill("abcd");
    await expect(page.getByText(/utf16-script\.txt loaded/)).toHaveCount(0);
    await expect(page.getByText("4 / 8,192 exact UTF-8 bytes")).toBeVisible();

    await upload.setInputFiles(file);
    await expect(scriptInput).toHaveValue("abc");
    await page
      .getByRole("checkbox", {
        name: /I understand the estimated narration is outside/,
      })
      .check();
    await acknowledgePermanentSeal(page);
    await page.getByRole("button", { name: /Seal exact script/ }).click();

    await expect.poll(() => postedPayload?.sourceKind).toBe("uploaded_text");
    expect(postedPayload).toMatchObject({
      durationAcknowledged: true,
      originalBytesBase64: "//5hAGIAYwA=",
      sourceKind: "uploaded_text",
    });
    expect(postedPayload).not.toHaveProperty("rawText");
  });

  test("keeps exact dropped and cut CRLF bytes in application-owned history", async ({
    page,
  }) => {
    let lockedRawText = "";
    await page.route(`**/api/episodes/${episodeId}/script-lock`, async (route) => {
      lockedRawText = (route.request().postDataJSON() as { rawText: string }).rawText;
      await route.fulfill({
        json: { ok: true, result: { aggregateVersion: 2 } },
        status: 200,
      });
    });
    await page.goto(`/episodes/${episodeId}/create?fixture=phase2-empty`);
    const scriptInput = page.getByRole("textbox", {
      name: "Hindi background narration",
    });
    await scriptInput.fill("X");

    const dropped = "A\r\nB";
    await scriptInput.evaluate((element, text) => {
      const textarea = element as HTMLTextAreaElement;
      textarea.setSelectionRange(0, 0);
      const transfer = new DataTransfer();
      transfer.setData("text/plain", text);
      textarea.dispatchEvent(
        new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
        }),
      );
    }, dropped);
    await expect(scriptInput).toHaveValue("A\nBX");
    await expect(page.getByText("5 / 8,192 exact UTF-8 bytes")).toBeVisible();

    const cutBytes = await scriptInput.evaluate((element) => {
      const textarea = element as HTMLTextAreaElement;
      textarea.setSelectionRange(1, 2);
      const transfer = new DataTransfer();
      textarea.dispatchEvent(
        new ClipboardEvent("cut", {
          bubbles: true,
          cancelable: true,
          clipboardData: transfer,
        }),
      );
      return transfer.getData("text/plain");
    });
    expect(cutBytes).toBe("\r\n");
    await expect(scriptInput).toHaveValue("ABX");
    await scriptInput.press("Control+z");
    await expect(scriptInput).toHaveValue("A\nBX");
    await expect(page.getByText("5 / 8,192 exact UTF-8 bytes")).toBeVisible();

    await page
      .getByRole("checkbox", {
        name: /I understand the estimated narration is outside/,
      })
      .check();
    await acknowledgePermanentSeal(page);
    await page.getByRole("button", { name: /Seal exact script/ }).click();
    await expect.poll(() => lockedRawText).toBe(`${dropped}X`);
  });

  test("keeps the empty-script placeholder above AA text contrast", async ({
    page,
  }) => {
    await page.goto(`/episodes/${episodeId}/create?fixture=phase2-empty`);
    const scriptInput = page.getByRole("textbox", {
      name: "Hindi background narration",
    });
    const placeholderColor = await scriptInput.evaluate(
      (element) => getComputedStyle(element, "::placeholder").color,
    );

    expect(
      contrastRatio(rgbChannels(placeholderColor), [17, 13, 25]),
    ).toBeGreaterThanOrEqual(4.5);

    await scriptInput.fill("अ");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(scriptInput).toBeFocused();
    const keyboardFocus = await scriptInput.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        focusVisible: element.matches(":focus-visible"),
        outlineStyle: style.outlineStyle,
        outlineWidth: Number.parseFloat(style.outlineWidth),
      };
    });
    expect(keyboardFocus.focusVisible).toBe(true);
    expect(keyboardFocus.outlineStyle).not.toBe("none");
    expect(keyboardFocus.outlineWidth).toBeGreaterThanOrEqual(2);
    await expectActionTargetsAtLeast44(page);
  });

  test("freezes the submitted script and seals only the posted bytes", async ({
    page,
  }) => {
    let releaseResponse: (() => void) | undefined;
    const responseGate = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    let postedRawText = "";
    await page.route(`**/api/episodes/${episodeId}/script-lock`, async (route) => {
      postedRawText = (route.request().postDataJSON() as { rawText: string }).rawText;
      await responseGate;
      await route.fulfill({
        json: { ok: true, result: { aggregateVersion: 2 } },
        status: 200,
      });
    });
    await page.goto(`/episodes/${episodeId}/create?fixture=phase2-empty`);
    const submitted = "प्रभात की पहली श्वास";
    const scriptInput = page.getByRole("textbox", {
      name: "Hindi background narration",
    });
    await scriptInput.fill(submitted);
    await page
      .getByRole("checkbox", {
        name: /I understand the estimated narration is outside/,
      })
      .check();
    await acknowledgePermanentSeal(page);
    await page.getByRole("button", { name: /Seal exact script/ }).click();
    await expect(scriptInput).toHaveAttribute("readonly", "");
    await scriptInput.evaluate((element) => {
      const textarea = element as HTMLTextAreaElement;
      textarea.value = "tampered while pending";
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    releaseResponse?.();

    await page.getByRole("button", { name: /Script/ }).click();
    await expect(page.getByLabel("Sealed Hindi background narration")).toHaveText(
      submitted,
    );
    expect(postedRawText).toBe(submitted);
  });

  test("binds retained idempotency keys to the exact mutation payload", async ({
    page,
  }) => {
    const keys: string[] = [];
    const rawTexts: string[] = [];
    await page.route(`**/api/episodes/${episodeId}/script-lock`, async (route) => {
      keys.push(route.request().headers()["x-idempotency-key"] ?? "");
      rawTexts.push((route.request().postDataJSON() as { rawText: string }).rawText);
      const call = keys.length;
      if (call < 4) {
        await route.fulfill({
          json: {
            message:
              call === 3 ? "Definitive stale request." : "Temporary gateway failure.",
            ok: false,
          },
          status: call === 3 ? 409 : 503,
        });
        return;
      }
      await route.fulfill({
        json: { ok: true, result: { aggregateVersion: 2 } },
        status: 200,
      });
    });
    await page.goto(`/episodes/${episodeId}/create?fixture=phase2-empty`);
    const input = page.getByRole("textbox", { name: "Hindi background narration" });
    await input.fill("पहला पाठ");
    await page
      .getByRole("checkbox", {
        name: /I understand the estimated narration is outside/,
      })
      .check();
    await acknowledgePermanentSeal(page);

    const seal = page.getByRole("button", { name: /Seal exact script/ });
    await seal.click();
    await expect(
      page.getByRole("status").filter({ hasText: "outcome is unconfirmed" }),
    ).toBeVisible();
    await seal.click();
    await expect.poll(() => keys.length).toBe(2);
    expect(keys[1]).toBe(keys[0]);

    await input.fill("दूसरा पाठ");
    await page
      .getByRole("checkbox", {
        name: /I understand the estimated narration is outside/,
      })
      .check();
    await acknowledgePermanentSeal(page);
    await seal.click();
    await expect(page.getByText(/Definitive stale request\./)).toBeVisible();
    expect(keys[2]).not.toBe(keys[1]);
    await seal.click();
    await page.getByRole("button", { name: /Script/ }).click();
    await expect(page.getByLabel("Sealed Hindi background narration")).toHaveText(
      "दूसरा पाठ",
    );
    expect(keys[3]).not.toBe(keys[2]);
    expect(rawTexts).toEqual(["पहला पाठ", "पहला पाठ", "दूसरा पाठ", "दूसरा पाठ"]);
  });

  test("keeps a just-sealed script locally authoritative across router refresh", async ({
    page,
  }) => {
    await page.route(`**/api/episodes/${episodeId}/script-lock`, async (route) => {
      await route.fulfill({
        json: {
          ok: true,
          result: {
            aggregateVersion: 2,
          },
        },
        status: 200,
      });
    });
    await page.goto(`/episodes/${episodeId}/create?fixture=phase2-empty`);

    const exactScript =
      "\u0950 \u0928\u092e\u0903 \u0936\u093f\u0935\u093e\u092f\u0964";
    await page
      .getByRole("textbox", { name: "Hindi background narration" })
      .fill(exactScript);
    await page
      .getByRole("checkbox", {
        name: /I understand the estimated narration is outside/,
      })
      .check();
    await acknowledgePermanentSeal(page);

    const refresh = page.waitForResponse(
      (response) =>
        response.url().includes(`/episodes/${episodeId}/create`) &&
        response.request().headers().rsc === "1",
    );
    await page.getByRole("button", { name: /Seal exact script/ }).click();
    await refresh;
    const voiceHeading = page.getByRole("heading", {
      name: "Who carries the story?",
    });
    await expect(voiceHeading).toBeVisible();
    await expect(voiceHeading).toBeFocused();
    await expect(page.getByRole("button", { name: "Retry saved state" })).toBeVisible({
      timeout: 12_000,
    });
    await expectActionTargetsAtLeast44(page);

    await page
      .getByRole("navigation", { name: "Episode creation chambers" })
      .getByRole("button", { name: /Script/ })
      .click();
    await expect(
      page.getByRole("heading", { name: "Your script is sealed." }),
    ).toBeVisible();
    await expect(page.getByLabel("Sealed Hindi background narration")).toHaveText(
      exactScript,
    );
  });

  test("chooses the exact voice and searches the 117-look vault", async ({ page }) => {
    await page.route("**/api/commands", async (route) => {
      const request = route.request();
      const body = request.postDataJSON() as { commandType: string };
      await route.fulfill({
        json: {
          ok: true,
          result:
            body.commandType === "episode.voice.select"
              ? {
                  configurationVersion: 2,
                  episodeVersion: 3,
                }
              : {
                  configurationVersion: 3,
                  episodeVersion: 4,
                },
        },
        status: 200,
      });
    });
    await page.goto(`/episodes/${episodeId}/create?fixture=phase2-script`);

    const female = page.getByRole("button", {
      name: /Female Target: expressive Hindi/,
    });
    await female.click();
    await expect(female).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("Female narrator pinned exactly.")).toBeVisible();
    const visualSaveState = page.locator(".creation-save-state");
    await expect(visualSaveState).toHaveAttribute("aria-hidden", "true");
    expect(await visualSaveState.getAttribute("role")).toBeNull();
    expect(await visualSaveState.getAttribute("aria-live")).toBeNull();
    await expect(
      page.getByRole("status").filter({ hasText: "Female narrator pinned exactly." }),
    ).toHaveCount(1);

    await page.getByRole("button", { name: /Enter the look vault/ }).click();
    await expect(
      page.getByRole("heading", { name: /Choose the film’s visual soul/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Glowing Divine Realism/ }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Use this look" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Recommended" })).toHaveCount(0);

    const search = page.getByRole("searchbox", { name: "Search all looks" });
    await search.fill("Divine Fury");
    await expect(page.locator(".look-card")).toHaveCount(1);
    await page.getByRole("button", { name: /Divine Fury/ }).click();
    const lookMutation = page.waitForResponse((response) => {
      if (!response.url().endsWith("/api/commands")) return false;
      const body = response.request().postDataJSON() as { commandType?: string };
      return body.commandType === "episode.look.select";
    });
    await page.getByRole("button", { name: "Use this look" }).click();
    expect((await lookMutation).ok()).toBe(true);
    await expect(page.getByText("Divine Fury pinned to this Episode.")).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Divine Fury pinned to this Episode." }),
    ).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: /Build world \+ preflight/ }),
    ).toBeFocused();

    await search.fill("");
    const familyNames = await page.locator(".look-families button").allTextContents();
    for (const familyName of familyNames) {
      await page
        .locator(".look-families button")
        .filter({ hasText: familyName.trim() })
        .click();
      await expect
        .poll(async () =>
          page
            .locator(".look-card img")
            .evaluateAll((images) =>
              images.every(
                (image) =>
                  image instanceof HTMLImageElement &&
                  image.complete &&
                  image.naturalWidth > 0 &&
                  image.naturalHeight > 0,
              ),
            ),
        )
        .toBe(true);
    }
  });

  test("requires explicit human confirmation for system-default voice and look", async ({
    page,
  }) => {
    const commands: string[] = [];
    await page.route("**/api/commands", async (route) => {
      const body = route.request().postDataJSON() as { commandType: string };
      commands.push(body.commandType);
      await route.fulfill({
        json: {
          ok: true,
          result: {
            configurationVersion: commands.length + 1,
            episodeVersion: commands.length + 2,
          },
        },
        status: 200,
      });
    });
    await page.goto(`/episodes/${episodeId}/create?fixture=phase2-script`);

    await expect(
      page.getByRole("status").filter({ hasText: "system default" }),
    ).toContainText("Confirm it explicitly");
    await expect(
      page.getByText(/genie-launch-hindi-delhi-sanskrit-performance\.v1/),
    ).toBeVisible();
    const defaultVoice = page.getByRole("button", {
      name: /Male Target: expressive Hindi/,
    });
    await expect(defaultVoice).toHaveAttribute("aria-pressed", "true");
    await expect(defaultVoice).toContainText("Confirm selection");
    await defaultVoice.click();
    await expect(defaultVoice).toContainText("Selection confirmed");
    expect(commands).toEqual(["episode.voice.select"]);

    await page.getByRole("button", { name: /Enter the look vault/ }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "This look is a system default" }),
    ).toBeVisible();
    const defaultLook = page.getByRole("button", {
      name: /Glowing Divine Realism.*Available/,
    });
    await expect(defaultLook).toHaveAttribute("aria-pressed", "true");
    const useDefault = page.getByRole("button", { name: "Use this look" });
    await expect(useDefault).toBeEnabled();
    await useDefault.click();
    expect(commands).toEqual(["episode.voice.select", "episode.look.select"]);
    await expect(page.getByRole("button", { name: "Look confirmed" })).toBeDisabled();
    await expect(
      page.getByRole("button", { name: /Build world \+ preflight/ }),
    ).toBeEnabled();
  });

  test("never commits a pending look hidden by search or family filters", async ({
    page,
  }) => {
    let lookMutations = 0;
    await page.route("**/api/commands", async (route) => {
      const body = route.request().postDataJSON() as { commandType: string };
      if (body.commandType === "episode.look.select") lookMutations += 1;
      await route.fulfill({
        json: {
          ok: true,
          result: { configurationVersion: 2, episodeVersion: 3 },
        },
        status: 200,
      });
    });
    await page.goto(`/episodes/${episodeId}/create?fixture=phase2-script`);
    await page.getByRole("button", { name: /Enter the look vault/ }).click();

    await page.getByRole("button", { name: /Divine Fury/ }).click();
    await expect(page.getByRole("button", { name: "Use this look" })).toBeEnabled();
    await page
      .getByRole("button", { name: "Advertising & Commercial", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "previous preview is hidden" }),
    ).toBeVisible();
    await expect(page.locator('.look-card[aria-pressed="true"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Use this look" })).toBeDisabled();

    await page.getByRole("button", { name: /Apple Clean High-Key/ }).click();
    await expect(page.getByRole("button", { name: "Use this look" })).toBeEnabled();
    await page.getByRole("searchbox", { name: "Search all looks" }).fill("Divine Fury");
    await expect(page.locator('.look-card[aria-pressed="true"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Use this look" })).toBeDisabled();
    expect(lookMutations).toBe(0);
  });

  test("discloses all 117 mobile looks in safe 24-item batches", async ({ page }) => {
    await page.setViewportSize({ height: 844, width: 390 });
    await page.goto(`/episodes/${episodeId}/create?fixture=phase2-script`);
    await page.getByRole("button", { name: /Enter the look vault/ }).click();
    await page.getByRole("button", { name: "All looks" }).click();

    const cards = page.locator(".look-card");
    await expect(cards).toHaveCount(24);
    const more = page.getByRole("button", { name: /Show \d+ more looks/ });
    await expect(more).toHaveText("Show 24 more looks");
    while ((await cards.count()) < 117) await more.click();
    await expect(cards).toHaveCount(117);
    await expect(more).toHaveCount(0);

    const tray = page.locator(".look-commit-bar");
    await tray.scrollIntoViewIfNeeded();
    await expect(tray).toHaveCSS("position", "sticky");
    const geometry = await page.evaluate(() => {
      const trayBox = document
        .querySelector<HTMLElement>(".look-commit-bar")!
        .getBoundingClientRect();
      const vaultBox = document
        .querySelector<HTMLElement>(".look-vault")!
        .getBoundingClientRect();
      const visibleCards = [
        ...document.querySelectorAll<HTMLElement>(".look-card"),
      ].filter((card) => {
        const box = card.getBoundingClientRect();
        return box.bottom > 0 && box.top < window.innerHeight;
      });
      const overlapAreas = visibleCards.map((card) => {
        const box = card.getBoundingClientRect();
        return (
          Math.max(
            0,
            Math.min(box.right, trayBox.right) - Math.max(box.left, trayBox.left),
          ) *
          Math.max(
            0,
            Math.min(box.bottom, vaultBox.bottom, trayBox.bottom) -
              Math.max(box.top, vaultBox.top, trayBox.top),
          )
        );
      });
      return {
        maxCardOverlap: Math.max(0, ...overlapAreas),
        trayBottom: trayBox.bottom,
        trayTop: trayBox.top,
        vaultBottom: vaultBox.bottom,
        viewportHeight: window.innerHeight,
      };
    });
    expect(geometry.trayTop).toBeGreaterThanOrEqual(138);
    expect(geometry.trayBottom).toBeLessThanOrEqual(geometry.viewportHeight);
    expect(geometry.vaultBottom).toBeLessThanOrEqual(geometry.trayTop);
    expect(geometry.maxCardOverlap).toBe(0);
    await expect(page.getByRole("button", { name: "Use this look" })).toBeVisible();
  });

  test("moves focus with the chamber and a roving 117-look keyboard grid", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    for (const { columns, width } of [
      { columns: 4, width: 1280 },
      { columns: 2, width: 900 },
      { columns: 2, width: 600 },
      { columns: 1, width: 390 },
    ]) {
      await page.setViewportSize({ height: 844, width });
      await page.goto(`/episodes/${episodeId}/create?fixture=phase2-script`);
      await page.getByRole("button", { name: /Enter the look vault/ }).click();

      await expect(page.locator("#look-vault-instructions")).toHaveText(
        /Activate a visual look to preview it.*Previewing does not change the Episode pin/,
      );

      const heading = page.getByRole("heading", {
        name: /Choose the film’s visual soul/,
      });
      await expect(heading).toBeFocused();
      const headingFocus = await heading.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          backgroundColor: getComputedStyle(
            element.closest(".creation-stage") ?? element,
          ).backgroundColor,
          outlineColor: style.outlineColor,
          outlineStyle: style.outlineStyle,
          outlineWidth: Number.parseFloat(style.outlineWidth),
        };
      });
      expect(headingFocus.outlineStyle).not.toBe("none");
      expect(headingFocus.outlineWidth).toBeGreaterThanOrEqual(2);
      expect(
        contrastRatio(
          rgbChannels(headingFocus.outlineColor),
          rgbChannels(headingFocus.backgroundColor || "rgb(9, 7, 16)"),
        ),
      ).toBeGreaterThanOrEqual(3);
      const headingBox = await heading.boundingBox();
      expect(headingBox).not.toBeNull();
      expect(headingBox?.y ?? 0).toBeGreaterThanOrEqual(138);
      await expect
        .poll(() =>
          page
            .locator(".look-vault")
            .evaluate(
              (vault) => getComputedStyle(vault).gridTemplateColumns.split(" ").length,
            ),
        )
        .toBe(columns);

      const cards = page.locator(".look-card");
      const first = cards.nth(0);
      const second = cards.nth(1);
      const below = cards.nth(columns);
      await first.focus();
      await first.press("ArrowDown");
      await expect(below).toBeFocused();
      await expect(below).toHaveAttribute("aria-pressed", "true");
      await below.press("ArrowUp");
      await expect(first).toBeFocused();
      await first.press("End");
      await expect(cards.last()).toBeFocused();
      await cards.last().press("Home");
      await expect(first).toBeFocused();
      await first.press("ArrowRight");
      await expect(second).toBeFocused();
      await second.press("ArrowLeft");
      await expect(first).toBeFocused();
      await first.press("ArrowRight");
      await second.press("Tab");
      await expect(page.getByRole("button", { name: "Use this look" })).toBeFocused();
    }
  });

  test("loads the persisted family and reconciles invalid or withdrawn looks", async ({
    page,
  }) => {
    await page.route("**/api/commands", async (route) => {
      await route.fulfill({
        json: {
          ok: true,
          result: { configurationVersion: 2, episodeVersion: 3 },
        },
        status: 200,
      });
    });

    await page.goto(`/episodes/${episodeId}/create?fixture=phase2-advertising-look`);
    await page.getByRole("button", { name: /Enter the look vault/ }).click();
    await expect(
      page.getByRole("button", { name: /Apple Clean High-Key/ }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByRole("button", { name: "Advertising & Commercial" }),
    ).toHaveAttribute("aria-pressed", "true");

    await page.goto(`/episodes/${episodeId}/create?fixture=phase2-invalid-look`);
    await page.getByRole("button", { name: /Enter the look vault/ }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "has not substituted another look" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Glowing Divine Realism/ }),
    ).toHaveAttribute("aria-pressed", "false");
    await expect(
      page.getByRole("button", { name: /Build world \+ preflight/ }),
    ).toBeDisabled();

    await page.goto(`/episodes/${episodeId}/create?fixture=phase2-withdrawn-look`);
    await page.getByRole("button", { name: /Enter the look vault/ }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "missing, withdrawn, or unavailable" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Glowing Divine Realism/ }),
    ).toHaveAttribute("aria-pressed", "false");
    await expect(
      page.getByRole("button", { name: /Glowing Divine Realism.*Withdrawn/ }),
    ).toBeDisabled();
    await expect(page.getByRole("button", { name: "Use this look" })).toBeDisabled();
    await page.getByRole("button", { name: /Divine Fury/ }).click();
    await page.getByRole("button", { name: "Use this look" }).click();
    await expect(page.getByText("Divine Fury pinned to this Episode.")).toBeVisible();

    await page.goto(`/episodes/${episodeId}/create?fixture=phase2-unavailable-look`);
    await page.getByRole("button", { name: /Enter the look vault/ }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "missing, withdrawn, or unavailable" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: /Glowing Divine Realism.*Availability missing, unavailable/i,
      }),
    ).toBeDisabled();
  });

  test("keeps rejection state honest and reports an empty look search", async ({
    page,
  }) => {
    await page.route("**/api/commands", async (route) => {
      await route.fulfill({
        body: JSON.stringify({
          message: "Authoritative mutation rejected.",
          ok: false,
        }),
        contentType: "application/json",
        status: 409,
      });
    });
    await page.goto(`/episodes/${episodeId}/create?fixture=phase2-script`);
    await page.getByRole("button", { name: /Female/ }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Authoritative mutation rejected." }),
    ).toHaveCount(1);
    const visualSaveState = page.locator(".creation-save-state");
    await expect(visualSaveState).toHaveAttribute("aria-hidden", "true");
    expect(await visualSaveState.getAttribute("role")).toBeNull();
    expect(await visualSaveState.getAttribute("aria-live")).toBeNull();
    await expect(
      page.getByText("Change rejected - authoritative state refreshed"),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /Male/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await page.getByRole("button", { name: /Enter the look vault/ }).click();
    await page.getByRole("button", { name: /Divine Fury/ }).click();
    await page.getByRole("button", { name: "Use this look" }).click();
    const authoritativeLook = page.getByRole("button", {
      name: /Glowing Divine Realism/,
    });
    await expect(authoritativeLook).toHaveAttribute("aria-pressed", "true");
    await expect(authoritativeLook).toBeInViewport({ ratio: 0.5 });
    await expect(authoritativeLook).toBeFocused();
    await expect(page.getByRole("button", { name: /Divine Fury/ })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await page
      .getByRole("searchbox", { name: "Search all looks" })
      .fill("no-such-visual-world-zyra");
    await expect(page.locator(".look-empty")).toContainText("No visual worlds match");
    await expect(
      page.getByRole("button", { name: /Build world \+ preflight/ }),
    ).toBeDisabled();
    // Conflict reconciliation performs an RSC navigation. Wait for the
    // streamed document head to settle before auditing the complete document.
    await expect(page).toHaveTitle("Genie by Zyra");
    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(
      accessibility.violations.filter(
        ({ impact }) => impact === "critical" || impact === "serious",
      ),
    ).toEqual([]);
  });

  test("refreshes a stale conflict into the keyed authoritative Look chamber", async ({
    page,
  }) => {
    await page.route("**/api/commands", async (route) => {
      await route.fulfill({
        json: { message: "This Episode changed in another tab.", ok: false },
        status: 409,
      });
    });
    await page.goto(`/episodes/${episodeId}/create?fixture=phase2-stale-look`);
    await page.getByRole("button", { name: /Enter the look vault/ }).click();
    await page.getByRole("button", { name: /Divine Fury/ }).click();
    await page.getByRole("button", { name: "Use this look" }).click();

    await expect(page).toHaveURL(/resumeCreation=look/);
    const heading = page.getByRole("heading", {
      name: /Choose the film’s visual soul/,
    });
    const authoritativeLook = page.getByRole("button", {
      name: /Hard-Shadow Grey Editorial/,
    });
    await expect(heading).toBeVisible();
    await expect(authoritativeLook).toHaveAttribute("aria-pressed", "true");
    await expect(authoritativeLook).toBeFocused();
    await expect(page.locator('.look-card[aria-pressed="true"]')).toHaveCount(1);
    await expect
      .poll(async () =>
        authoritativeLook.evaluate((card) => {
          const vault = card.closest<HTMLElement>(".look-vault");
          if (!vault) return Number.POSITIVE_INFINITY;
          const cardBox = card.getBoundingClientRect();
          const vaultBox = vault.getBoundingClientRect();
          return Math.abs(
            cardBox.top + cardBox.height / 2 - (vaultBox.top + vaultBox.height / 2),
          );
        }),
      )
      .toBeLessThanOrEqual(2);
  });

  test("reconciles availability-only refreshes without retaining valid pins", async ({
    page,
  }) => {
    await page.route("**/api/commands", async (route) => {
      await route.fulfill({
        json: { message: "Availability changed.", ok: false },
        status: 409,
      });
    });
    await page.goto(
      `/episodes/${episodeId}/create?fixture=phase2-refresh-withdrawn-pins`,
    );
    await page.getByRole("button", { name: /Enter the look vault/ }).click();
    await expect(
      page.getByRole("heading", { name: /Choose the film’s visual soul/ }),
    ).toBeVisible();
    await page.getByRole("button", { name: /Divine Fury/ }).click();
    await page.getByRole("button", { name: "Use this look" }).click();

    await expect(page).toHaveURL(/resumeCreation=look/);
    await expect(
      page.getByRole("heading", { name: "Who carries the story?" }),
    ).toBeVisible();
    await expect(
      page.getByRole("alert").filter({ hasText: "has not substituted another voice" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /Male/ })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expect(
      page
        .getByRole("navigation", { name: "Episode creation chambers" })
        .getByRole("button", { name: /Look/ }),
    ).toBeDisabled();
    await expect(
      page.getByRole("heading", { name: /Choose the film’s visual soul/ }),
    ).toHaveCount(0);
  });

  test("keeps the mobile look tray in flow and honors reduced motion", async ({
    page,
  }) => {
    await page.setViewportSize({ height: 844, width: 390 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/episodes/${episodeId}/create?fixture=phase2-script`);
    await page.getByRole("button", { name: /Enter the look vault/ }).click();

    await expect(page.locator(".look-commit-bar")).toHaveCSS("position", "sticky");
    await expect(page.locator(".look-vault")).toHaveCSS("max-height", "none");
    await expect(page.locator(".look-vault")).toHaveCSS("overflow-y", "auto");
    const vaultBox = await page.locator(".look-vault").boundingBox();
    const trayBox = await page.locator(".look-commit-bar").boundingBox();
    expect(vaultBox).not.toBeNull();
    expect(trayBox).not.toBeNull();
    expect(vaultBox?.y ?? 0).toBeLessThan(trayBox?.y ?? 0);
    expect((vaultBox?.y ?? 0) + (vaultBox?.height ?? 0)).toBeLessThanOrEqual(
      trayBox?.y ?? 0,
    );
    await expectActionTargetsAtLeast44(page);
    const visibleLookImage = page.locator(".look-card").first().locator("img");
    await visibleLookImage.hover();
    await expect(visibleLookImage).toHaveCSS("transform", "none");
    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(
      accessibility.violations.filter(
        ({ impact }) => impact === "critical" || impact === "serious",
      ),
    ).toEqual([]);
  });

  test("fails closed on unknown and withdrawn narrator pins", async ({ page }) => {
    test.setTimeout(120_000);
    for (const fixture of [
      "phase2-invalid-voice",
      "phase2-missing-voice-status",
      "phase2-withdrawn-voice",
    ]) {
      await page.goto(`/episodes/${episodeId}/create?fixture=${fixture}`);
      await expect(
        page
          .getByRole("alert")
          .filter({ hasText: "has not substituted another voice" }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: /Male/ })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
      await expect(
        page.getByRole("button", { name: /Enter the look vault/ }),
      ).toBeDisabled();
      await expect(
        page
          .getByRole("navigation", { name: "Episode creation chambers" })
          .getByRole("button", { name: /Look/ }),
      ).toBeDisabled();

      await page.goto(
        `/episodes/${episodeId}/create?fixture=${fixture}&resumeCreation=look`,
      );
      await expect(
        page.getByRole("heading", { name: "Who carries the story?" }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: /Choose the film’s visual soul/ }),
      ).toHaveCount(0);
      await expect(
        page
          .getByRole("navigation", { name: "Episode creation chambers" })
          .getByRole("button", { name: /Look/ }),
      ).toBeDisabled();
    }
  });

  test("keeps mobile controls visible without toast overlap @visual", async ({
    page,
  }) => {
    await page.setViewportSize({ height: 844, width: 390 });
    await page.route("**/api/commands", async (route) => {
      await route.fulfill({
        body: JSON.stringify({
          message: "Authoritative mutation rejected.",
          ok: false,
        }),
        contentType: "application/json",
        status: 409,
      });
    });
    await page.goto(`/episodes/${episodeId}/create?fixture=phase2-script`);
    await page.getByRole("button", { name: /Enter the look vault/ }).click();
    await page.getByRole("button", { name: /Divine Fury/ }).click();
    await page.getByRole("button", { name: "Use this look" }).click();
    await page.waitForLoadState("networkidle");
    const authoritativeLook = page.getByRole("button", {
      name: /Glowing Divine Realism:/,
    });
    await expect
      .poll(async () => (await authoritativeLook.boundingBox())?.y ?? -1)
      .toBeGreaterThan(138);
    await expect(authoritativeLook).toBeFocused();
    const focusedCardOverlap = await page.evaluate(() => {
      const card = document.querySelector<HTMLElement>(
        '.look-card[aria-pressed="true"]',
      );
      const toast = document.querySelector<HTMLElement>(".creation-toast");
      if (!card || !toast) return Number.POSITIVE_INFINITY;
      const cardBox = card.getBoundingClientRect();
      const toastBox = toast.getBoundingClientRect();
      return (
        Math.max(
          0,
          Math.min(cardBox.right, toastBox.right) -
            Math.max(cardBox.left, toastBox.left),
        ) *
        Math.max(
          0,
          Math.min(cardBox.bottom, toastBox.bottom) -
            Math.max(cardBox.top, toastBox.top),
        )
      );
    });
    expect(focusedCardOverlap).toBe(0);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect
      .poll(
        async () => (await page.locator(".look-commit-bar").boundingBox())?.y ?? 999,
      )
      .toBeLessThan(760);

    const header = await page.locator(".creation-header").boundingBox();
    const tray = await page.locator(".look-commit-bar").boundingBox();
    const toast = await page.locator(".creation-toast").boundingBox();
    const dismiss = await page
      .getByRole("button", { name: "Dismiss status message" })
      .boundingBox();
    expect(header).not.toBeNull();
    expect(tray).not.toBeNull();
    expect(toast).not.toBeNull();
    expect(dismiss).not.toBeNull();
    expect(Math.abs(header?.y ?? 999)).toBeLessThanOrEqual(1);
    expect((tray?.y ?? 999) + (tray?.height ?? 0)).toBeLessThanOrEqual(844);
    expect((toast?.y ?? 0) + (toast?.height ?? 0)).toBeLessThanOrEqual(tray?.y ?? 0);
    expect(dismiss?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(dismiss?.height ?? 0).toBeGreaterThanOrEqual(44);
    // Geometry is authoritative here because the sticky tray and progressive
    // disclosure intentionally replace the previous full-vault pixel baseline.
    const dismissButton = page.getByRole("button", {
      name: "Dismiss status message",
    });
    await dismissButton.focus();
    await dismissButton.press("Enter");
    await expect(page.locator(".creation-toast")).toHaveCount(0);
    const lookHeading = page.getByRole("heading", {
      name: /Choose the film.*s visual soul/,
    });
    await expect(lookHeading).toBeFocused();
    await expect(lookHeading).toHaveCSS("outline-width", "2px");
  });

  test("keeps desktop and tablet rejection toasts clear of the sticky tray", async ({
    page,
  }) => {
    await page.route("**/api/commands", async (route) => {
      await route.fulfill({
        json: { message: "Authoritative mutation rejected.", ok: false },
        status: 409,
      });
    });

    for (const width of [761, 1280]) {
      await page.setViewportSize({ height: 720, width });
      await page.goto(`/episodes/${episodeId}/create?fixture=phase2-script`);
      await page.getByRole("button", { name: /Enter the look vault/ }).click();
      await page.getByRole("button", { name: /Divine Fury/ }).click();
      await page.getByRole("button", { name: "Use this look" }).click();
      await expect(page.getByText("Authoritative mutation rejected.")).toBeVisible();

      const tray = await page.locator(".look-commit-bar").boundingBox();
      const toast = await page.locator(".creation-toast").boundingBox();
      expect(tray).not.toBeNull();
      expect(toast).not.toBeNull();
      const overlapWidth = Math.max(
        0,
        Math.min(
          (tray?.x ?? 0) + (tray?.width ?? 0),
          (toast?.x ?? 0) + (toast?.width ?? 0),
        ) - Math.max(tray?.x ?? 0, toast?.x ?? 0),
      );
      const overlapHeight = Math.max(
        0,
        Math.min(
          (tray?.y ?? 0) + (tray?.height ?? 0),
          (toast?.y ?? 0) + (toast?.height ?? 0),
        ) - Math.max(tray?.y ?? 0, toast?.y ?? 0),
      );
      expect({ overlapArea: overlapWidth * overlapHeight, width }).toEqual({
        overlapArea: 0,
        width,
      });
    }
  });

  test("reviews, accepts, and composition-recasts real World anchors", async ({
    page,
  }) => {
    await page.route("**/api/assets/**/sign", async (route) => {
      await route.fulfill({
        json: {
          ok: true,
          signedUrl:
            "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
        },
        status: 200,
      });
    });
    const decisions: Record<string, unknown>[] = [];
    await page.route(`**/api/episodes/${episodeId}/world-decision`, async (route) => {
      decisions.push(route.request().postDataJSON() as Record<string, unknown>);
      await route.fulfill({ json: { ok: true, result: {} }, status: 200 });
    });

    await page.goto(`/episodes/${episodeId}/create?fixture=phase2-world`);
    await expect(
      page.getByRole("heading", { name: "Cast once. Keep forever." }),
    ).toBeFocused();
    await expect(page.locator(".world-card")).toHaveCount(2);
    await expect(page.getByText("Shiva's Pinaka bow", { exact: true })).toBeVisible();
    await expect(page.getByText("Nano Banana · Image Generation AI")).toBeVisible();
    await expect(
      page.getByRole("list", { name: /Progress for Shiva's Pinaka bow/ }),
    ).toContainText("DetectedPromptGenerateSecureReview");
    await expect(page.getByText("Look tail cryptographically pinned")).toHaveCount(2);
    await page.getByRole("button", { name: "Accept anchor" }).click();
    await expect.poll(() => decisions.length).toBe(1);
    expect(decisions[0]).toMatchObject({
      decision: "accept",
      entityKind: "character",
      revisedPromptText: null,
    });

    await page.getByRole("button", { name: "Edit prompt · recast" }).first().click();
    const editor = page.getByRole("dialog", { name: /Direct the composition/ });
    await expect(editor).toBeVisible();
    const revisedComposition =
      "Mahadev opens his eyes in a silent close portrait as a soft dawn catches the sacred ash.";
    await editor
      .getByRole("textbox", { name: /Scene composition/ })
      .fill(revisedComposition);
    await editor.getByRole("button", { name: "Regenerate this anchor" }).click();
    await expect.poll(() => decisions.length).toBe(2);
    expect(decisions[1]).toMatchObject({
      decision: "regenerate",
      entityKind: "character",
    });
    expect(String(decisions[1]?.revisedPromptText)).toBe(
      `${revisedComposition}\n\nGlowing divine realism, devotional Indian epic scale, sculpted light, sacred atmosphere, cinematic vertical composition.`,
    );
  });

  test("shows Monica's evidence and confirms only the exact quote ceiling", async ({
    page,
  }) => {
    let confirmation: Record<string, unknown> | null = null;
    await page.route(`**/api/episodes/${episodeId}/quote-confirm`, async (route) => {
      confirmation = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({ json: { ok: true, result: {} }, status: 200 });
    });

    await page.goto(`/episodes/${episodeId}/create?fixture=phase2-preflight`);
    await expect(
      page.getByRole("heading", {
        name: "The film exists here before a frame is spent.",
      }),
    ).toBeFocused();
    await expect(page.getByLabel("Exact production quote")).toContainText("$32.60");
    await expect(page.getByText("No unresolved deterministic gates.")).toBeVisible();
    await page.getByRole("button", { name: "Confirm exact ceiling" }).click();
    await expect.poll(() => confirmation).not.toBeNull();
    expect(confirmation).toEqual({
      episodeId,
      hardCeilingMicrousd: 45_000_000,
      quoteHash: "8888888888888888888888888888888888888888888888888888888888888888",
      quoteId: "30000000-0000-4000-8000-000000000105",
      workspaceId: "10000000-0000-4000-8000-000000000101",
    });
  });

  test("surfaces sealed plan-repair exhaustion instead of waiting or authorizing spend", async ({
    page,
  }) => {
    await page.goto(`/episodes/${episodeId}/create?fixture=phase2-preflight-blocked`);
    await expect(
      page.getByRole("heading", {
        name: "The cinematic plan did not clear Monica’s quality floor",
      }),
    ).toBeVisible();
    await expect(page.getByText("No spend", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Confirm exact ceiling" }),
    ).toBeDisabled();
    await expect(page.getByRole("button", { name: /Confirm World Lock/ })).toHaveCount(
      0,
    );
  });

  test("posts one exact atomic World Lock envelope", async ({ page }) => {
    let worldLock: Record<string, unknown> | null = null;
    await page.route(`**/api/episodes/${episodeId}/world-lock`, async (route) => {
      worldLock = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({ json: { ok: true, result: {} }, status: 200 });
    });

    await page.goto(`/episodes/${episodeId}/create?fixture=phase2-world-lock`);
    await expect(
      page.getByRole("heading", {
        name: "Lock the world. Release the agentic AI crew.",
      }),
    ).toBeFocused();
    await page.getByRole("button", { name: /Confirm World Lock/ }).click();
    await expect.poll(() => worldLock).not.toBeNull();
    expect(worldLock).toEqual({
      configurationCandidateId: "10000000-0000-4000-8000-000000000120",
      episodeId,
      expectedConfigurationVersion: 6,
      expectedEpisodeVersion: 8,
      quoteId: "30000000-0000-4000-8000-000000000105",
      workspaceId: "10000000-0000-4000-8000-000000000101",
    });
  });

  test("surfaces an immutable asynchronous run without another start gate", async ({
    page,
  }) => {
    await page.goto(`/episodes/${episodeId}/create?fixture=phase2-running`);
    await expect(
      page.getByRole("heading", { name: "Monica has the baton." }),
    ).toBeFocused();
    await expect(page.getByText("queued", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Confirm World Lock/ })).toHaveCount(
      0,
    );
    await expectActionTargetsAtLeast44(page);
  });
});

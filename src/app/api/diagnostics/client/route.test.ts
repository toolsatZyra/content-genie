import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/diagnostics/client/route";

describe("client diagnostics route", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects cross-origin production intake", async () => {
    vi.stubEnv("GENIE_ENVIRONMENT", "production");
    const response = await POST(
      new Request("https://genie.example/api/diagnostics/client", {
        body: JSON.stringify({ event: "app.client_error" }),
        headers: {
          "content-type": "application/json",
          origin: "https://attacker.example",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      accepted: false,
      code: "INVALID_DIAGNOSTIC",
    });
  });
});

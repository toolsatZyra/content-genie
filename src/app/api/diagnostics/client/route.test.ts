import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/diagnostics/client/route";

describe("client diagnostics route", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is not exposed before authenticated production intake exists", async () => {
    vi.stubEnv("GENIE_ENVIRONMENT", "production");
    const response = await POST(
      new Request("https://genie.example/api/diagnostics/client", {
        body: JSON.stringify({ event: "app.client_error" }),
        method: "POST",
      }),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      accepted: false,
      code: "NOT_FOUND",
    });
  });
});

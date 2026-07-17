import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  persistDiagnosticEvent: vi.fn(),
  writeDiagnostic: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser: mocks.getUser },
  }),
  hasConfiguredSupabase: () => true,
}));
vi.mock("@/observability/supabase-sink", () => ({
  persistDiagnosticEvent: mocks.persistDiagnosticEvent,
}));
vi.mock("@/observability/logger", () => ({
  writeDiagnostic: mocks.writeDiagnostic,
}));

import { POST } from "@/app/api/diagnostics/client/route";

describe("client diagnostics route", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
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

  it("requires an authenticated studio user before accepting telemetry", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const response = await POST(
      new Request("https://genie.example/api/diagnostics/client", {
        body: JSON.stringify({ event: "app.client_error" }),
        headers: {
          "content-type": "application/json",
          origin: "https://genie.example",
          "sec-fetch-site": "same-origin",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(401);
    expect(mocks.persistDiagnosticEvent).not.toHaveBeenCalled();
  });

  it("binds an accepted diagnostic to the authenticated actor", async () => {
    const event = {
      event: "app.client_error",
      message: "Bounded test",
      occurredAt: new Date().toISOString(),
      severity: "error",
    };
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "10000000-0000-4000-8000-000000000002" } },
      error: null,
    });
    mocks.writeDiagnostic.mockResolvedValue(event);
    mocks.persistDiagnosticEvent.mockResolvedValue(true);
    const response = await POST(
      new Request("https://genie.example/api/diagnostics/client", {
        body: JSON.stringify(event),
        headers: {
          "content-type": "application/json",
          origin: "https://genie.example",
          "sec-fetch-site": "same-origin",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(202);
    expect(mocks.persistDiagnosticEvent).toHaveBeenCalledWith(
      event,
      "10000000-0000-4000-8000-000000000002",
    );
  });
});

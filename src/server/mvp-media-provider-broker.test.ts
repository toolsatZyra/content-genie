import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  fetchMvpFalBillingEvent,
  fetchMvpFalQueueJson,
  fetchMvpFalQueueResult,
  MvpMediaProviderBrokerError,
  submitMvpFalProvider,
} from "./mvp-media-provider-broker";

const endpoint = "fal-ai/nano-banana-2/edit";
const providerDispatchId = "10000000-0000-4000-8000-000000000001";
const callbackToken = "A".repeat(43);
const requestId = "request_123456";
const statusUrl = `https://queue.fal.run/fal-ai/nano-banana-2/requests/${requestId}/status`;
const responseUrl = `https://queue.fal.run/fal-ai/nano-banana-2/requests/${requestId}/response`;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function billedJsonResponse(body: unknown, billableUnits?: string): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json",
      ...(billableUnits === undefined ? {} : { "x-fal-billable-units": billableUnits }),
    },
  });
}

describe("MVP FAL provider broker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-22T13:00:00.000Z"));
    process.env.FAL_ADMIN_KEY = "test-fal-admin-key-at-least-16-characters";
    process.env.FAL_KEY = "test-fal-key-at-least-16-characters";
    process.env.NEXT_PUBLIC_APP_URL = "https://genie.example";
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    delete process.env.FAL_ADMIN_KEY;
    delete process.env.FAL_KEY;
    delete process.env.NEXT_PUBLIC_APP_URL;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("accepts only a complete receipt bound to the exact request path segment", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        request_id: requestId,
        response_url: responseUrl,
        status_url: statusUrl,
      }),
    );

    await expect(
      submitMvpFalProvider(
        endpoint,
        { prompt: "frame" },
        providerDispatchId,
        callbackToken,
      ),
    ).resolves.toEqual({ externalRequestId: requestId, responseUrl, statusUrl });
    const submitUrl = new URL(`https://queue.fal.run/${endpoint}`);
    submitUrl.searchParams.set(
      "fal_webhook",
      `https://genie.example/api/internal/provider-webhooks/fal-mvp/${providerDispatchId}?token=${callbackToken}`,
    );
    expect(fetch).toHaveBeenCalledWith(
      submitUrl,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: expect.stringMatching(/^Key /u),
        }),
        method: "POST",
        redirect: "error",
      }),
    );
  });

  it.each([
    {
      body: null,
      label: "a null receipt",
    },
    {
      body: [],
      label: "an array receipt",
    },
    {
      body: {
        request_id: requestId,
        response_url: responseUrl,
        status_url: `https://queue.fal.run/fal-ai/nano-banana-2/requests/${requestId}-substitute/status`,
      },
      label: "a substituted request path",
    },
    {
      body: {
        request_id: requestId,
        response_url: "not a URL",
        status_url: statusUrl,
      },
      label: "an invalid control URL",
    },
  ])("treats $label after provider acceptance as outcome unknown", async ({ body }) => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(body));

    await expect(
      submitMvpFalProvider(
        endpoint,
        { prompt: "frame" },
        providerDispatchId,
        callbackToken,
      ),
    ).rejects.toEqual(
      expect.objectContaining({
        disposition: "unknown",
        safeCode: "PROVIDER_OUTCOME_UNKNOWN",
      }) as MvpMediaProviderBrokerError,
    );
  });

  it.each([
    { disposition: "terminal", status: 400 },
    { disposition: "unknown", status: 408 },
    { disposition: "unknown", status: 429 },
    { disposition: "unknown", status: 503 },
  ])(
    "maps submit HTTP $status to a $disposition outcome",
    async ({ disposition, status }) => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ error: "rejected" }, status));

      await expect(
        submitMvpFalProvider(endpoint, {}, providerDispatchId, callbackToken),
      ).rejects.toMatchObject({ disposition });
    },
  );

  it("returns queue JSON with authenticated bounded polling", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ status: "COMPLETED", video: { url: "https://cdn.test/v.mp4" } }),
    );

    await expect(fetchMvpFalQueueJson(statusUrl, 12_345)).resolves.toEqual({
      status: "COMPLETED",
      video: { url: "https://cdn.test/v.mp4" },
    });
    expect(fetch).toHaveBeenCalledWith(
      new URL(statusUrl),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: expect.stringMatching(/^Key /u),
        }),
        redirect: "error",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("returns exact provider billing units and receipt evidence with results", async () => {
    vi.mocked(fetch).mockResolvedValue(
      billedJsonResponse(
        { images: [{ url: "https://x.fal.media/frame.png" }] },
        "1.525",
      ),
    );

    await expect(fetchMvpFalQueueResult(responseUrl, 12_345)).resolves.toEqual({
      data: { images: [{ url: "https://x.fal.media/frame.png" }] },
      providerReportedBillableUnits: 1.525,
      providerUsageEvidenceSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
  });

  it("accepts the provider's bounded floating-point unit representation", async () => {
    vi.mocked(fetch).mockResolvedValue(
      billedJsonResponse(
        { video: { url: "https://x.fal.media/clip.mp4" } },
        "2.4000000000000004",
      ),
    );

    await expect(fetchMvpFalQueueResult(responseUrl, 12_345)).resolves.toEqual({
      data: { video: { url: "https://x.fal.media/clip.mp4" } },
      providerReportedBillableUnits: 2.4000000000000004,
      providerUsageEvidenceSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
  });

  it("binds a request-level provider billing event with discounts", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        billing_events: [
          {
            cost_estimate_nano_usd: 109_800_000,
            endpoint_id: endpoint,
            output_units: 1.525,
            percent_discount: 10,
            request_id: requestId,
            timestamp: "2026-07-22T12:00:00Z",
            unit_price: 0.08,
          },
        ],
        has_more: false,
        next_cursor: null,
      }),
    );

    await expect(
      fetchMvpFalBillingEvent(requestId, "2026-07-20T12:05:00.000Z", 12_345),
    ).resolves.toEqual({
      costEstimateNanoUsd: 109_800_000,
      endpointId: endpoint,
      evidenceSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      outputUnits: 1.525,
      percentDiscount: 10,
      timestamp: "2026-07-22T12:00:00.000Z",
      unitPriceUsd: 0.08,
    });
    const billingUrl = new URL("https://api.fal.ai/v1/models/billing-events");
    billingUrl.searchParams.set("end", "2026-07-22T13:00:00.000Z");
    billingUrl.searchParams.set("limit", "2");
    billingUrl.searchParams.set("request_id", requestId);
    billingUrl.searchParams.set("start", "2026-07-20T12:00:00.000Z");
    expect(fetch).toHaveBeenCalledWith(
      billingUrl,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Key test-fal-admin-key-at-least-16-characters",
        }),
        redirect: "error",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("keeps a missing request-level billing event retryable", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ billing_events: [], has_more: false, next_cursor: null }),
    );

    await expect(
      fetchMvpFalBillingEvent(requestId, "2026-07-20T12:05:00.000Z", 12_345),
    ).rejects.toMatchObject({
      disposition: "unknown",
      safeCode: "PROVIDER_BILLING_EVENT_PENDING",
    });
  });

  it("fails closed without the dedicated billing-admin credential", async () => {
    delete process.env.FAL_ADMIN_KEY;

    await expect(
      fetchMvpFalBillingEvent(requestId, "2026-07-20T12:05:00.000Z", 12_345),
    ).rejects.toMatchObject({
      disposition: "terminal",
      safeCode: "PROVIDER_BILLING_UNRECONCILED",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses an explicit historical window capped at ninety days", async () => {
    vi.setSystemTime(new Date("2026-07-22T13:00:00.000Z"));
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ billing_events: [], has_more: false, next_cursor: null }),
    );

    await expect(
      fetchMvpFalBillingEvent(requestId, "2026-01-01T00:05:00.000Z", 12_345),
    ).rejects.toMatchObject({ safeCode: "PROVIDER_BILLING_EVENT_PENDING" });
    const requested = vi.mocked(fetch).mock.calls[0]?.[0];
    expect(requested).toBeInstanceOf(URL);
    const url = requested as URL;
    expect(url.searchParams.get("start")).toBe("2026-01-01T00:00:00.000Z");
    expect(url.searchParams.get("end")).toBe("2026-04-01T00:00:00.000Z");
  });

  it("bounds an accepted submission receipt before parsing JSON", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("x".repeat(131_073)));

    await expect(
      submitMvpFalProvider(
        endpoint,
        { prompt: "frame" },
        providerDispatchId,
        callbackToken,
      ),
    ).rejects.toMatchObject({
      disposition: "unknown",
      safeCode: "PROVIDER_OUTCOME_UNKNOWN",
    });
  });

  it("bounds queue and result JSON before parsing an undeclared body", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("x".repeat(131_073)));

    await expect(fetchMvpFalQueueJson(statusUrl, 5_000)).rejects.toMatchObject({
      disposition: "terminal",
      safeCode: "PROVIDER_RESPONSE_INVALID",
    });
  });

  it.each([undefined, ""])(
    "allows the authoritative request billing event to supply omitted result units: %s",
    async (units) => {
      vi.mocked(fetch).mockResolvedValue(billedJsonResponse({ images: [] }, units));
      await expect(fetchMvpFalQueueResult(responseUrl, 5_000)).resolves.toEqual({
        data: { images: [] },
        providerReportedBillableUnits: null,
        providerUsageEvidenceSha256: null,
      });
    },
  );

  it.each(["-1", "NaN", "1e2", "1.0000000000000000001", "10001"])(
    "rejects invalid provider billing evidence: %s",
    async (units) => {
      vi.mocked(fetch).mockResolvedValue(billedJsonResponse({ images: [] }, units));
      await expect(fetchMvpFalQueueResult(responseUrl, 5_000)).rejects.toMatchObject({
        disposition: "terminal",
        safeCode: "PROVIDER_BILLING_UNRECONCILED",
      });
    },
  );

  it.each([
    {
      disposition: "unknown",
      response: () => Promise.reject(new TypeError("network lost")),
      safeCode: "PROVIDER_STATUS_FAILED",
    },
    {
      disposition: "unknown",
      response: () => Promise.resolve(jsonResponse({ error: "busy" }, 503)),
      safeCode: "PROVIDER_STATUS_FAILED",
    },
    {
      disposition: "terminal",
      response: () => Promise.resolve(jsonResponse({ error: "gone" }, 404)),
      safeCode: "PROVIDER_STATUS_FAILED",
    },
    {
      disposition: "terminal",
      response: () => Promise.resolve(jsonResponse([])),
      safeCode: "PROVIDER_RESPONSE_INVALID",
    },
  ])(
    "fails queue polling closed as $safeCode/$disposition",
    async ({ disposition, response, safeCode }) => {
      vi.mocked(fetch).mockImplementation(response);

      await expect(fetchMvpFalQueueJson(statusUrl, 5_000)).rejects.toMatchObject({
        disposition,
        safeCode,
      });
    },
  );

  it.each(["not a URL", "https://example.com/requests/request_123456/status"])(
    "rejects an untrusted queue URL before polling: %s",
    async (url) => {
      await expect(fetchMvpFalQueueJson(url, 5_000)).rejects.toMatchObject({
        disposition: "terminal",
        safeCode: "PROVIDER_RESPONSE_INVALID",
      });
      expect(fetch).not.toHaveBeenCalled();
    },
  );
});

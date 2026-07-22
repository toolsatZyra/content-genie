import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
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
    process.env.FAL_KEY = "test-fal-key-at-least-16-characters";
    process.env.NEXT_PUBLIC_APP_URL = "https://genie.example";
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    delete process.env.FAL_KEY;
    delete process.env.NEXT_PUBLIC_APP_URL;
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

  it.each([undefined, "", "-1", "NaN", "1.00001", "10001"])(
    "rejects missing or invalid provider billing evidence: %s",
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

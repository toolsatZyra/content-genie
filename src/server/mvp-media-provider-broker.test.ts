import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  fetchMvpFalQueueJson,
  MvpMediaProviderBrokerError,
  submitMvpFalProvider,
} from "./mvp-media-provider-broker";

const endpoint = "fal-ai/nano-banana-2/edit";
const requestId = "request_123456";
const statusUrl = `https://queue.fal.run/fal-ai/nano-banana-2/requests/${requestId}/status`;
const responseUrl = `https://queue.fal.run/fal-ai/nano-banana-2/requests/${requestId}/response`;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

describe("MVP FAL provider broker", () => {
  beforeEach(() => {
    process.env.FAL_KEY = "test-fal-key-at-least-16-characters";
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    delete process.env.FAL_KEY;
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

    await expect(submitMvpFalProvider(endpoint, { prompt: "frame" })).resolves.toEqual({
      externalRequestId: requestId,
      responseUrl,
      statusUrl,
    });
    expect(fetch).toHaveBeenCalledWith(
      `https://queue.fal.run/${endpoint}`,
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

    await expect(submitMvpFalProvider(endpoint, { prompt: "frame" })).rejects.toEqual(
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

      await expect(submitMvpFalProvider(endpoint, {})).rejects.toMatchObject({
        disposition,
      });
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

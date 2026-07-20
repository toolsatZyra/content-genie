import { describe, expect, it } from "vitest";

import { parseFalWebhookBody, parseFalWebhookSignatureEnvelope } from "./fal-webhook";

const requestId = "123e4567-e89b-12d3-a456-426614174000";
const targetAssetId = "20000000-0000-4000-8000-000000000001";

function headers(timestamp = "2000000000") {
  return new Headers({
    "x-fal-webhook-request-id": requestId,
    "x-fal-webhook-signature": "ab".repeat(64),
    "x-fal-webhook-timestamp": timestamp,
    "x-fal-webhook-user-id": "fal-user-123",
  });
}

describe("FAL signed webhook contract", () => {
  it("constructs the exact signed message and enforces the replay window", () => {
    const body = '{"status":"OK"}';
    const envelope = parseFalWebhookSignatureEnvelope(headers(), body, 2_000_000_100);
    expect(envelope.requestId).toBe(requestId);
    expect(envelope.message.toString("utf8")).toMatch(
      new RegExp(`^${requestId}\\nfal-user-123\\n2000000000\\n[a-f0-9]{64}$`),
    );
    expect(() =>
      parseFalWebhookSignatureEnvelope(headers(), body, 2_000_000_301),
    ).toThrow("timestamp is stale");
  });

  it("extracts one image as untrusted secure-ingest input", () => {
    const parsed = parseFalWebhookBody(
      JSON.stringify({
        gateway_request_id: requestId,
        payload: {
          images: [
            {
              content_type: "image/png",
              file_name: "result.png",
              height: 1792,
              url: "https://v3.fal.media/files/result.png",
              width: 1024,
            },
          ],
          seed: 42,
        },
        request_id: requestId,
        status: "OK",
      }),
      requestId,
      targetAssetId,
    );
    expect(parsed.status).toBe("OK");
    expect(parsed.outputs).toEqual([
      expect.objectContaining({
        contentType: "image/png",
        height: 1792,
        ordinal: 1,
        targetAssetId,
        width: 1024,
      }),
    ]);
    expect(parsed.safeSummary).not.toHaveProperty("url");
    expect(parsed.canonicalPayloadHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("accepts a bounded provider error without retaining provider text", () => {
    const parsed = parseFalWebhookBody(
      JSON.stringify({
        error: "credential-shaped untrusted provider detail",
        gateway_request_id: requestId,
        payload: { detail: [{ msg: "unsafe detail" }] },
        request_id: requestId,
        status: "ERROR",
      }),
      requestId,
      targetAssetId,
    );
    expect(parsed.outputs).toEqual([]);
    expect(JSON.stringify(parsed.safeSummary)).not.toContain("unsafe");
    expect(JSON.stringify(parsed.safeSummary)).not.toContain("credential");
  });

  it("treats omitted provider dimensions as untrusted hints for sandbox probing", () => {
    const parsed = parseFalWebhookBody(
      JSON.stringify({
        gateway_request_id: requestId,
        payload: {
          images: [
            {
              content_type: "image/png",
              height: null,
              url: "https://v3b.fal.media/files/result.png",
              width: null,
            },
          ],
        },
        request_id: requestId,
        status: "OK",
      }),
      requestId,
      targetAssetId,
    );
    expect(parsed.outputs[0]).toMatchObject({ height: null, width: null });
  });

  it("rejects identity drift, extra top-level fields, and non-HTTPS media", () => {
    const base = {
      gateway_request_id: requestId,
      payload: {
        images: [
          {
            content_type: "image/png",
            height: 100,
            url: "https://v3.fal.media/result.png",
            width: 100,
          },
        ],
      },
      request_id: requestId,
      status: "OK",
    };
    expect(() =>
      parseFalWebhookBody(
        JSON.stringify({ ...base, request_id: "different-request" }),
        requestId,
        targetAssetId,
      ),
    ).toThrow("identity is invalid");
    expect(() =>
      parseFalWebhookBody(
        JSON.stringify({ ...base, injected: "instruction" }),
        requestId,
        targetAssetId,
      ),
    ).toThrow("unexpected fields");
    expect(() =>
      parseFalWebhookBody(
        JSON.stringify({
          ...base,
          payload: {
            images: [{ ...base.payload.images[0], url: "http://127.0.0.1/x" }],
          },
        }),
        requestId,
        targetAssetId,
      ),
    ).toThrow("media output is invalid");
  });
});

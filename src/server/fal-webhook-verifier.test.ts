import { generateKeyPairSync, sign } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { parseFalWebhookSignatureEnvelope } from "@/domain/provider/fal-webhook";
import { verifyFalWebhook } from "./fal-webhook-verifier";

describe("FAL webhook signature verifier", () => {
  it("verifies Ed25519 against bounded official JWKS and rejects a bad signature", async () => {
    const now = 2_000_000_000;
    const rawBody = '{"request_id":"signed-job","status":"OK"}';
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const jwk = publicKey.export({ format: "jwk" });
    const unsignedHeaders = new Headers({
      "x-fal-webhook-request-id": "signed-job",
      "x-fal-webhook-signature": "00".repeat(64),
      "x-fal-webhook-timestamp": String(now),
      "x-fal-webhook-user-id": "fal-user-123",
    });
    const envelope = parseFalWebhookSignatureEnvelope(unsignedHeaders, rawBody, now);
    const signature = sign(null, envelope.message, privateKey).toString("hex");
    const signedHeaders = new Headers(unsignedHeaders);
    signedHeaders.set("x-fal-webhook-signature", signature);
    const jwksBytes = JSON.stringify({
      // The live FAL JWKS currently pads its 32-byte Ed25519 x coordinate.
      keys: [{ crv: "Ed25519", kty: "OKP", x: `${jwk.x}=` }],
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(jwksBytes, {
        headers: {
          "content-encoding": "gzip",
          "content-length": "13",
          "content-type": "application/json",
        },
        status: 200,
      }),
    );
    await expect(
      verifyFalWebhook(signedHeaders, rawBody, {
        fetchImplementation: fetchMock,
        nowSeconds: now,
      }),
    ).resolves.toEqual({ requestId: "signed-job", userId: "fal-user-123" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://rest.fal.ai/.well-known/jwks.json",
      expect.objectContaining({ method: "GET", redirect: "error" }),
    );

    const badHeaders = new Headers(signedHeaders);
    badHeaders.set("x-fal-webhook-signature", "ff".repeat(64));
    await expect(
      verifyFalWebhook(badHeaders, rawBody, {
        fetchImplementation: fetchMock,
        nowSeconds: now,
      }),
    ).rejects.toThrow("signature is invalid");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

import { generateKeyPairSync, verify } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  canonicalLiveBrokerEvidenceJson,
  signLiveBrokerEvidence,
} from "@/server/live-broker-evidence";

describe("live broker evidence signing", () => {
  it("signs the exact request, result, action, deployment, and timestamp", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const envelope = signLiveBrokerEvidence(
      {
        action: "status",
        brokerDeploymentCommit: "a".repeat(40),
        rawBody: '{"action":"status"}',
        result: { nested: { b: 2, a: 1 }, ok: true },
      },
      {
        privateKeyPkcs8Base64: privateKey
          .export({ format: "der", type: "pkcs8" })
          .toString("base64"),
        signedAt: "2026-07-19T00:00:00.000Z",
      },
    );
    expect(envelope).toMatchObject({
      algorithm: "Ed25519",
      keyId: "genie-live-evidence-ed25519-v1",
      payload: {
        action: "status",
        brokerDeploymentCommit: "a".repeat(40),
        schemaVersion: "genie-live-broker-evidence-payload.v1",
        signedAt: "2026-07-19T00:00:00.000Z",
      },
      schemaVersion: "genie-live-broker-evidence-envelope.v1",
    });
    expect(
      verify(
        null,
        Buffer.from(canonicalLiveBrokerEvidenceJson(envelope.payload), "utf8"),
        publicKey,
        Buffer.from(envelope.signatureBase64, "base64"),
      ),
    ).toBe(true);
    expect(
      verify(
        null,
        Buffer.from(
          canonicalLiveBrokerEvidenceJson({
            ...envelope.payload,
            resultSha256: "0".repeat(64),
          }),
          "utf8",
        ),
        publicKey,
        Buffer.from(envelope.signatureBase64, "base64"),
      ),
    ).toBe(false);
  });
});

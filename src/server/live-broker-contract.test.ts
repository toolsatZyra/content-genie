import { generateKeyPairSync, sign } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  authenticateLiveBrokerRequest,
  LIVE_BROKER_SCHEMA_VERSION,
  liveBrokerRuntimeAllowlist,
  liveBrokerSignaturePayload,
  parseLiveBrokerRequest,
} from "@/server/live-broker-contract";

const candidate = {
  commit: "a".repeat(40),
  tree: "b".repeat(40),
};
const branchRef = "c".repeat(20);
const validStart = {
  action: "start",
  branch: {
    branchId: "12345678-1234-4123-8123-123456789abc",
    branchName: "genie-live-12345678-abc",
    branchRef,
    challengeNonce: "22345678-1234-4123-8123-123456789abc",
    challengeTable: "phase2_connection_challenge_0123456789abcdef0123456789abcdef",
    credentials: {
      anonKey: `anon.${"a".repeat(50)}`,
      databaseUrl: `postgresql://postgres:secret@db.${branchRef}.supabase.co:5432/postgres`,
      serviceRoleKey: `service.${"b".repeat(50)}`,
      supabaseUrl: `https://${branchRef}.supabase.co`,
    },
  },
  candidate,
  productionRef: "d".repeat(20),
  sandboxName: `genie-live-${"e".repeat(24)}`,
  schemaVersion: LIVE_BROKER_SCHEMA_VERSION,
};

describe("live broker contract", () => {
  it("accepts only the exact disposable-branch start schema", () => {
    expect(parseLiveBrokerRequest(JSON.stringify(validStart))).toEqual(validStart);
    for (const mutation of [
      { ...validStart, extra: true },
      { ...validStart, productionRef: branchRef },
      {
        ...validStart,
        branch: {
          ...validStart.branch,
          credentials: {
            ...validStart.branch.credentials,
            supabaseUrl: `https://${"f".repeat(20)}.supabase.co`,
          },
        },
      },
      {
        ...validStart,
        branch: {
          ...validStart.branch,
          credentials: {
            ...validStart.branch.credentials,
            databaseUrl:
              "postgresql://postgres:secret@db.production.supabase.co:5432/postgres",
          },
        },
      },
    ]) {
      expect(() => parseLiveBrokerRequest(JSON.stringify(mutation))).toThrow();
    }
  });

  it("accepts exact status and stop controls without credentials", () => {
    for (const action of ["status", "stop"] as const) {
      const request = {
        action,
        candidate,
        sandboxName: validStart.sandboxName,
        schemaVersion: LIVE_BROKER_SCHEMA_VERSION,
      };
      expect(parseLiveBrokerRequest(JSON.stringify(request))).toEqual(request);
    }
  });

  it("verifies a fresh Ed25519 signature over the exact body", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const rawBody = JSON.stringify(validStart);
    const issuedAt = "1784361600000";
    const nonce = "32345678-1234-4123-8123-123456789abc";
    const signature = sign(
      null,
      liveBrokerSignaturePayload(rawBody, issuedAt, nonce),
      privateKey,
    ).toString("base64");
    const headers = new Headers({
      "x-genie-live-issued-at": issuedAt,
      "x-genie-live-nonce": nonce,
      "x-genie-live-signature": signature,
    });
    const publicKeySpkiBase64 = publicKey
      .export({ format: "der", type: "spki" })
      .toString("base64");
    expect(
      authenticateLiveBrokerRequest(headers, rawBody, {
        now: Number(issuedAt),
        publicKeySpkiBase64,
      }),
    ).toEqual({ issuedAt, nonce, signerId: "genie-ci-ed25519-v1" });
    expect(() =>
      authenticateLiveBrokerRequest(headers, `${rawBody} `, {
        now: Number(issuedAt),
        publicKeySpkiBase64,
      }),
    ).toThrow(/authentication failed/);
    expect(() =>
      authenticateLiveBrokerRequest(headers, rawBody, {
        now: Number(issuedAt) + 120_001,
        publicKeySpkiBase64,
      }),
    ).toThrow(/authentication failed/);
  });

  it("exposes only the exact disposable API and database hosts", () => {
    expect(liveBrokerRuntimeAllowlist(branchRef)).toEqual({
      allow: [`${branchRef}.supabase.co`, `db.${branchRef}.supabase.co`],
    });
  });
});

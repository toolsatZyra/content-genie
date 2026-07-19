import "server-only";

import { createHash, createPrivateKey, sign } from "node:crypto";

import type { LiveBrokerRequest } from "@/server/live-broker-contract";

export const LIVE_BROKER_EVIDENCE_KEY_ID = "genie-live-evidence-ed25519-v1";
export const LIVE_BROKER_EVIDENCE_PUBLIC_KEY_SPKI_BASE64 =
  "MCowBQYDK2VwAyEA7ZqqCX0l0WFGdiMIN5qzdEgjAT/Nn2t4/hI4B4mQ2tA=";

export function canonicalLiveBrokerEvidenceJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalLiveBrokerEvidenceJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalLiveBrokerEvidenceJson(
            (value as Record<string, unknown>)[key],
          )}`,
      )
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) {
    throw new Error("Live broker evidence is not canonically serializable.");
  }
  return encoded;
}

export type LiveBrokerEvidenceEnvelope = Readonly<{
  algorithm: "Ed25519";
  keyId: typeof LIVE_BROKER_EVIDENCE_KEY_ID;
  payload: Readonly<{
    action: LiveBrokerRequest["action"];
    brokerDeploymentCommit: string;
    requestBodySha256: string;
    resultSha256: string;
    schemaVersion: "genie-live-broker-evidence-payload.v1";
    signedAt: string;
  }>;
  schemaVersion: "genie-live-broker-evidence-envelope.v1";
  signatureBase64: string;
}>;

export function signLiveBrokerEvidence(
  input: {
    action: LiveBrokerRequest["action"];
    brokerDeploymentCommit: string;
    rawBody: string;
    result: object;
  },
  options: { privateKeyPkcs8Base64?: string; signedAt?: string } = {},
): LiveBrokerEvidenceEnvelope {
  const privateKeyPkcs8Base64 =
    options.privateKeyPkcs8Base64 ??
    process.env.GENIE_LIVE_EVIDENCE_PRIVATE_KEY_PKCS8_BASE64?.trim();
  if (
    !privateKeyPkcs8Base64 ||
    !/^[A-Za-z0-9+/]{60,120}={0,2}$/u.test(privateKeyPkcs8Base64) ||
    !/^[a-f0-9]{40}$/u.test(input.brokerDeploymentCommit)
  ) {
    throw new Error("Live broker evidence signing authority is unavailable.");
  }
  const signedAt = options.signedAt ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(signedAt))) {
    throw new Error("Live broker evidence timestamp is invalid.");
  }
  const payload = {
    action: input.action,
    brokerDeploymentCommit: input.brokerDeploymentCommit,
    requestBodySha256: createHash("sha256").update(input.rawBody).digest("hex"),
    resultSha256: createHash("sha256")
      .update(canonicalLiveBrokerEvidenceJson(input.result))
      .digest("hex"),
    schemaVersion: "genie-live-broker-evidence-payload.v1" as const,
    signedAt,
  };
  let signatureBase64: string;
  try {
    signatureBase64 = sign(
      null,
      Buffer.from(canonicalLiveBrokerEvidenceJson(payload), "utf8"),
      createPrivateKey({
        format: "der",
        key: Buffer.from(privateKeyPkcs8Base64, "base64"),
        type: "pkcs8",
      }),
    ).toString("base64");
  } catch {
    throw new Error("Live broker evidence signing authority is invalid.");
  }
  return {
    algorithm: "Ed25519",
    keyId: LIVE_BROKER_EVIDENCE_KEY_ID,
    payload,
    schemaVersion: "genie-live-broker-evidence-envelope.v1",
    signatureBase64,
  };
}

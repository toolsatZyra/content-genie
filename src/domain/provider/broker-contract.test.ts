import { describe, expect, it } from "vitest";

import {
  parseProviderBrokerRequest,
  PROVIDER_BROKER_SCHEMA_VERSION,
  ProviderBrokerContractError,
} from "./broker-contract";

const id = (suffix: string) => `10000000-0000-4000-8000-${suffix.padStart(12, "0")}`;

function validRequest() {
  return {
    authorityEpoch: 1,
    capabilityGrantId: id("1"),
    fencingToken: 2,
    inputManifestId: id("2"),
    inputManifestSha256: "a".repeat(64),
    operation: "gen_image",
    preflightRunId: id("3"),
    providerRequestId: id("4"),
    quoteLineId: id("5"),
    schemaVersion: PROVIDER_BROKER_SCHEMA_VERSION,
    stageAttemptId: id("6"),
    stageRunId: id("7"),
    workspaceId: id("8"),
  };
}

describe("provider broker request contract", () => {
  it("accepts only IDs, hashes, bounded integers, and a micro operation", () => {
    expect(parseProviderBrokerRequest(JSON.stringify(validRequest())).operation).toBe(
      "gen_image",
    );
  });

  it.each(["gen_video", "render", "export", "approve", "publish"])(
    "structurally rejects %s",
    (operation) => {
      expect(() =>
        parseProviderBrokerRequest(JSON.stringify({ ...validRequest(), operation })),
      ).toThrow(ProviderBrokerContractError);
    },
  );

  it("rejects prompts, URLs, provider choice, and other model-proposed authority", () => {
    for (const extra of ["prompt", "url", "provider", "model", "headers"]) {
      expect(() =>
        parseProviderBrokerRequest(
          JSON.stringify({ ...validRequest(), [extra]: "untrusted" }),
        ),
      ).toThrow("not exact");
    }
  });
});

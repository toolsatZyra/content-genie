import { describe, expect, it } from "vitest";

import {
  buildResearchSearchTerms,
  buildResearchRemoteFetchCommand,
  RESEARCH_QUARANTINE_SOURCE_KIND,
} from "./temple-research";

describe("temple research quarantine contract", () => {
  it("uses the durable research-fetch source kind for licensed references", () => {
    expect(RESEARCH_QUARANTINE_SOURCE_KIND).toBe("research_fetch");
  });

  it("falls back from a ritual label to its distinctive public subject name", () => {
    expect(buildResearchSearchTerms("Ekadashi Vrata", "ritual")).toEqual([
      "Ekadashi Vrata",
      "ekadashi",
    ]);
    expect(buildResearchSearchTerms("Kashi Vishwanath Temple", "temple")).toEqual([
      "Kashi Vishwanath Temple",
    ]);
  });

  it("binds the exact environment and accepted fetched state to the ledger RPC", () => {
    const command = buildResearchRemoteFetchCommand({
      allowlistVersionHash: "a".repeat(64),
      allowlistVersionId: "10000000-0000-4000-8000-000000000001",
      environment: "production",
      envelope: {
        preflightRunId: "20000000-0000-4000-8000-000000000001",
        stageAttemptId: "30000000-0000-4000-8000-000000000001",
        workspaceId: "40000000-0000-4000-8000-000000000001",
      },
      result: {
        canonicalUrl: "https://upload.wikimedia.org/reference.jpg",
        redirectCount: 0,
        resolvedAddressHashes: ["b".repeat(64)],
        sha256: "c".repeat(64),
      },
    });

    expect(command).toMatchObject({
      p_environment: "production",
      p_exact_hostname: "upload.wikimedia.org",
      p_fetch_class: "research_reference",
      p_status: "fetched",
    });
    expect(Object.keys(command)).toHaveLength(16);
  });
});

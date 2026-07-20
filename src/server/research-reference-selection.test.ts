import { describe, expect, it } from "vitest";

import { retainDistinctResearchReference } from "./research-reference-selection";

describe("real-world research reference selection", () => {
  it("skips duplicate bytes and continues to later distinct assets", () => {
    const selected: {
      assetVersionId: string;
      contentSha256: string;
      title: string;
    }[] = [];
    for (const candidate of [
      { assetVersionId: "asset-a", contentSha256: "hash-a", title: "page one" },
      {
        assetVersionId: "asset-b",
        contentSha256: "hash-a",
        title: "duplicate pixels on page two",
      },
      { assetVersionId: "asset-c", contentSha256: "hash-b", title: "page three" },
      { assetVersionId: "asset-d", contentSha256: "hash-c", title: "page four" },
    ]) {
      retainDistinctResearchReference(selected, candidate);
    }
    expect(selected.map(({ assetVersionId }) => assetVersionId)).toEqual([
      "asset-a",
      "asset-c",
      "asset-d",
    ]);
  });
});

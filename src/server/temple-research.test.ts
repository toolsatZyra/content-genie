import { describe, expect, it } from "vitest";

import { RESEARCH_QUARANTINE_SOURCE_KIND } from "./temple-research";

describe("temple research quarantine contract", () => {
  it("uses the durable research-fetch source kind for licensed references", () => {
    expect(RESEARCH_QUARANTINE_SOURCE_KIND).toBe("research_fetch");
  });
});

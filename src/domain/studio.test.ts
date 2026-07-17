import { describe, expect, it } from "vitest";

import { roleRank } from "@/domain/studio";

describe("studio roles", () => {
  it("orders member, reviewer and admin authority", () => {
    expect(roleRank("member")).toBeLessThan(roleRank("reviewer"));
    expect(roleRank("reviewer")).toBeLessThan(roleRank("admin"));
  });
});

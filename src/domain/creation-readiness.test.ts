import { describe, expect, it } from "vitest";

import {
  CreationReadinessContractError,
  emptyCreationReadinessProjection,
  parseCreationReadinessProjection,
} from "./creation-readiness";

describe("creation readiness contract", () => {
  it("accepts the exact empty projection", () => {
    expect(parseCreationReadinessProjection(emptyCreationReadinessProjection)).toEqual(
      emptyCreationReadinessProjection,
    );
  });

  it.each([
    null,
    {},
    { ...emptyCreationReadinessProjection, extra: true },
    {
      preflight: emptyCreationReadinessProjection.preflight,
      world: { characters: {}, locations: [], referencePack: null },
    },
    {
      preflight: {
        ...emptyCreationReadinessProjection.preflight,
        quote: { confirmed: "yes" },
      },
      world: emptyCreationReadinessProjection.world,
    },
  ])("rejects malformed or widened projections %#", (value) => {
    expect(() => parseCreationReadinessProjection(value)).toThrow(
      CreationReadinessContractError,
    );
  });
});

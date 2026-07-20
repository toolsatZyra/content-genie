import { describe, expect, it } from "vitest";

import { postgresJsonbText } from "@/server/world-anchor-provider";

describe("world anchor provider serialization", () => {
  it("matches PostgreSQL jsonb::text key ordering and spacing", () => {
    expect(
      postgresJsonbText({
        characterKey: "y",
        continuityRole: "p",
        culturalNotes: [],
        form: { displayName: "f", formKey: "k" },
        schemaVersion: "x",
      }),
    ).toBe(
      '{"form": {"formKey": "k", "displayName": "f"}, "characterKey": "y", "culturalNotes": [], "schemaVersion": "x", "continuityRole": "p"}',
    );
  });

  it("keeps Unicode content byte-exact while sorting keys by UTF-8 length", () => {
    expect(postgresJsonbText({ aa: "कृष्ण", b: true })).toBe(
      '{"b": true, "aa": "कृष्ण"}',
    );
  });
});

import { describe, expect, it } from "vitest";

import {
  buildQualifiedReviewFindings,
  chooseCulturalCatalogSource,
} from "./source-cultural-preflight";

describe("qualified source and cultural preflight", () => {
  it.each([
    ["rama", "श्री राम", "वनवास की कथा", "ramayana.pg24869"],
    ["krishna", "कृष्ण", "अर्जुन के सामने", "mahabharata.pg15474"],
    ["mahadeva", "महादेव", "शिव ने नेत्र खोला", "shiva-purana.reference"],
    ["mahakali", "महाकाली", "देवी का रूप", "devi-mahatmyam.wikisource"],
    ["narayana", "नारायण", "विष्णु का अवतार", "vishnu-purana.reference"],
  ])(
    "selects the bounded source family for %s",
    (canonicalKey, displayName, script, expectedKey) => {
      expect(chooseCulturalCatalogSource(canonicalKey, displayName, script).key).toBe(
        expectedKey,
      );
    },
  );

  it("prioritizes the character identity over other names elsewhere in a mixed-form script", () => {
    expect(
      chooseCulturalCatalogSource(
        "mahadeva",
        "महादेव",
        "राम ने शिव के सामने प्रणाम किया।",
      ).key,
    ).toBe("shiva-purana.reference");
  });

  it("never lets machine findings self-approve a non-overridable rule", () => {
    const rules = [
      {
        code: "GCP-ATTR-001",
        contentClass: "deity_form",
        defaultVerdict: "production_blocked",
        id: "10000000-0000-4000-8000-000000000001",
        nonOverridable: true,
        ruleText: "Identity-defining deity attributes require exact evidence.",
      },
    ] as const;
    const first = buildQualifiedReviewFindings(rules, "a".repeat(64));
    const replay = buildQualifiedReviewFindings(rules, "a".repeat(64));

    expect(first).toEqual(replay);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      policyRuleId: rules[0].id,
      subjectKind: "general",
      verdict: "qualified_review_required",
    });
    expect(first[0]?.evidenceHash).toMatch(/^[a-f0-9]{64}$/u);
  });
});

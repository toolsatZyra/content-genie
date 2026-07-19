import { describe, expect, it } from "vitest";

import {
  DEFAULT_LOOK_ID,
  LOOKS,
  LOOK_FAMILIES,
  compileImagePrompt,
  findLook,
  findLookByVersionId,
  searchLooks,
} from "./look-registry";

describe("the pinned Genie look registry", () => {
  it("contains exactly 117 unique looks and the mythology default", () => {
    expect(LOOKS).toHaveLength(117);
    expect(new Set(LOOKS.map(({ id }) => id))).toHaveLength(117);
    expect(findLook(DEFAULT_LOOK_ID)).toMatchObject({
      family: "Indian Mythology & Devotion",
      id: "glowing-divine-realism",
    });
  });

  it("has no Recommended pseudo-family or runtime recommendation property", () => {
    expect(LOOK_FAMILIES).not.toContain("Recommended");
    expect(LOOKS.every((look) => !("recommended" in look))).toBe(true);
  });

  it("pins complete preview and provenance evidence", () => {
    for (const look of LOOKS) {
      expect(look.preview.path).toBe(`/looks/${look.id}.webp`);
      expect(look.preview.width).toBe(1280);
      expect(look.preview.height).toBe(720);
      expect(look.preview.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(look.versionId).toMatch(
        /^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
      );
      expect(look.provenance.sourceRecordSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(look.provenance.sourcePromptSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(look.lockedLookBlockSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(look.lockedLookBlock).not.toContain("\n");
      expect(look.negativePolicy).toMatchObject({
        schemaVersion: "genie-look-negative-policy.v1",
      });
      expect(look.negativePolicy.rules).toHaveLength(5);
      expect(
        look.negativePolicy.rules.every(({ severity }) => severity === "block"),
      ).toBe(true);
      expect(look.negativePolicy.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(look.visualQcBaseline).toMatchObject({
        negativePolicySha256: look.negativePolicy.sha256,
        schemaVersion: "genie-look-visual-qc-baseline.v1",
        sourceLookBlockSha256: look.lockedLookBlockSha256,
      });
      expect(Object.keys(look.visualQcBaseline.semantics).sort()).toEqual([
        "color",
        "contrast",
        "lens",
        "lighting",
        "texture",
      ]);
      expect(
        Object.values(look.visualQcBaseline.semantics).every(
          (semantic) => semantic.trim().length > 0,
        ),
      ).toBe(true);
      expect(look.visualQcBaseline.checks).toHaveLength(3);
      expect(look.visualQcBaseline.sha256).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it("removes known scene and framing leakage from deterministic tails", () => {
    const joined = LOOKS.map(({ lockedLookBlock }) => lockedLookBlock).join("\n");
    expect(joined).not.toMatch(
      /2\.39:1|1\.43:1|85mm|white timecode overlay|the devotee shown|the child|on can and splash|turquoise \(pool\)|the streetlight|wide-angle distortion|blown-to-white background|crushed pure-black background/i,
    );
    expect(findLook("glowing-divine-realism")?.lockedLookBlock).toContain(
      "Use only the deity attributes",
    );
    expect(joined).toContain("Negative constraints:");
    expect(joined).toContain("Do not depict nudity");
  });

  it("searches globally or within an exact family", () => {
    expect(searchLooks("divine").map(({ id }) => id)).toContain(
      "glowing-divine-realism",
    );
    expect(
      searchLooks("divine", "Documentary & Real").map(({ id }) => id),
    ).not.toContain("glowing-divine-realism");
  });

  it("assembles exactly two prompt blocks in code", () => {
    const look = findLook(DEFAULT_LOOK_ID);
    expect(look).toBeDefined();
    const frame = "Lord Shiva opens his eyes as dawn reaches Mount Kailash.";
    const prompt = compileImagePrompt(frame, look!);

    expect(prompt).toBe(`${frame}\n\n${look!.lockedLookBlock}`);
    expect(prompt.split("\n\n")).toHaveLength(2);
  });

  it.each(["", "one\n\nsecond"])(
    "rejects an invalid generated frame block %j",
    (frame) => {
      const look = findLook(DEFAULT_LOOK_ID);
      expect(() => compileImagePrompt(frame, look!)).toThrow(
        "frameBlock must be one non-empty prompt block.",
      );
    },
  );
  it("resolves exact version pins and supports the unfiltered vault", () => {
    const expected = findLook(DEFAULT_LOOK_ID);
    expect(findLookByVersionId(expected!.versionId)).toBe(expected);
    expect(findLookByVersionId("ffffffff-ffff-4fff-8fff-ffffffffffff")).toBeUndefined();
    expect(searchLooks("")).toHaveLength(117);
  });

  it("rejects an invalid locked look prompt block", () => {
    expect(() =>
      compileImagePrompt("A valid frame.", {
        lockedLookBlock: "first\n\nsecond",
      }),
    ).toThrow("lockedLookBlock must be one non-empty prompt block.");
  });
});

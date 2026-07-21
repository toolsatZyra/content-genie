import { describe, expect, it } from "vitest";

import {
  assertNanoBananaReferenceContract,
  compileNanoBananaReferenceContract,
  NANO_BANANA_MAX_REFERENCE_IMAGES,
  NanoBananaReferenceContractError,
  type NanoBananaReferenceContract,
  type NanoBananaReferenceInput,
} from "./nano-banana-reference-contract";

const references = Object.freeze([
  {
    assetVersionId: "10000000-0000-4000-8000-000000000001",
    imageUrl: "https://media.example.test/rama.png?token=one",
    purpose:
      "Approved Rama identity; preserve only face, skin tone, costume and ornaments.",
    role: "character_identity",
  },
  {
    assetVersionId: "10000000-0000-4000-8000-000000000002",
    imageUrl: "https://media.example.test/bow.png?token=two",
    purpose: "Approved sacred bow; preserve only silhouette, material and ornament.",
    role: "prop_identity",
  },
] satisfies readonly NanoBananaReferenceInput[]);

describe("Nano Banana ordered reference contract", () => {
  it("routes zero references to text-to-image without reference instructions", () => {
    const contract = compileNanoBananaReferenceContract({
      compositionPrompt: "Vertical 9:16 empty palace hall at dawn.",
      references: [],
    });

    expect(contract).toEqual({
      bindings: [],
      endpoint: "fal-ai/nano-banana-2",
      imageUrls: [],
      operation: "gen_image",
      prompt: "Vertical 9:16 empty palace hall at dawn.",
      systemPrompt: null,
    });
  });

  it("routes references to edit and maps every ordered URL in both prompts", () => {
    const contract = compileNanoBananaReferenceContract({
      compositionPrompt:
        "Vertical 9:16 medium shot of Rama holding the sacred bow in the palace.",
      references,
    });

    expect(contract.operation).toBe("edit_image");
    expect(contract.endpoint).toBe("fal-ai/nano-banana-2/edit");
    expect(contract.imageUrls).toEqual(references.map(({ imageUrl }) => imageUrl));
    expect(contract.bindings).toMatchObject([
      { atToken: "@Image1", imageToken: "Image 1", ordinal: 1 },
      { atToken: "@Image2", imageToken: "Image 2", ordinal: 2 },
    ]);
    for (const text of [contract.prompt, contract.systemPrompt]) {
      expect(text).toContain(
        "Image 1 / @Image1 [character_identity]: Approved Rama identity",
      );
      expect(text).toContain("Image 2 / @Image2 [prop_identity]: Approved sacred bow");
    }
    expect(() => assertNanoBananaReferenceContract(contract)).not.toThrow();
  });

  it("keeps the locked look as the second prompt paragraph", () => {
    const contract = compileNanoBananaReferenceContract({
      compositionPrompt:
        "Standalone vertical composition.\n\nLOCKED LOOK TAIL THAT MUST REMAIN SECOND.",
      references,
    });

    expect(contract.prompt.split("\n\n")).toHaveLength(2);
    expect(contract.prompt.split("\n\n")[1]).toBe(
      "LOCKED LOOK TAIL THAT MUST REMAIN SECOND.",
    );
  });

  it("permits an intentional two-state split screen only when requested", () => {
    const contract = compileNanoBananaReferenceContract({
      allowIntentionalSplitScreen: true,
      compositionPrompt: "A deliberate two-state split-screen composition.",
      references,
    });

    expect(contract.systemPrompt).toContain(
      "two-state split-screen composition is allowed",
    );
  });

  it("rejects manual or unbound reference tokens", () => {
    expect(() =>
      compileNanoBananaReferenceContract({
        compositionPrompt: "Use @Image1 for the subject.",
        references,
      }),
    ).toThrow(/manually numbered/u);

    const valid = compileNanoBananaReferenceContract({
      compositionPrompt: "Vertical 9:16 devotional portrait.",
      references,
    });
    const tampered = {
      ...valid,
      prompt: `${valid.prompt}\nUse @Image3 as another person.`,
    } as NanoBananaReferenceContract;
    expect(() => assertNanoBananaReferenceContract(tampered)).toThrow(
      /unbound Image 3/u,
    );
  });

  it("rejects an attachment whose explicit user-prompt binding was removed", () => {
    const valid = compileNanoBananaReferenceContract({
      compositionPrompt: "Vertical 9:16 devotional portrait.",
      references,
    });
    const binding =
      "Image 2 / @Image2 [prop_identity]: Approved sacred bow; preserve only silhouette, material and ornament.";
    const tampered = {
      ...valid,
      prompt: valid.prompt.replace(binding, "The approved sacred bow reference."),
    } as NanoBananaReferenceContract;

    expect(() => assertNanoBananaReferenceContract(tampered)).toThrow(
      /must explicitly bind Image 2 exactly once/u,
    );
  });

  it("rejects duplicate attachments and more than the documented maximum", () => {
    expect(() =>
      compileNanoBananaReferenceContract({
        compositionPrompt: "Vertical 9:16 devotional portrait.",
        references: [references[0]!, references[0]!],
      }),
    ).toThrow(/must be unique/u);

    const tooMany = Array.from(
      { length: NANO_BANANA_MAX_REFERENCE_IMAGES + 1 },
      (_, index) => ({
        assetVersionId: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        imageUrl: `https://media.example.test/${index + 1}.png`,
        purpose: `Reference purpose ${index + 1}.`,
        role: "style_reference" as const,
      }),
    );
    expect(() =>
      compileNanoBananaReferenceContract({
        compositionPrompt: "Vertical 9:16 devotional portrait.",
        references: tooMany,
      }),
    ).toThrow(
      new NanoBananaReferenceContractError(
        "Nano Banana accepts at most 14 reference images.",
      ),
    );
  });
});

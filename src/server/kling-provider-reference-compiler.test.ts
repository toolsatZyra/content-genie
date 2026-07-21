import { describe, expect, it } from "vitest";

import {
  compileKling25ImageToVideoPayload,
  compileKling3ImageToVideoPayload,
  selectKlingProviderDuration,
} from "./kling-provider-reference-compiler";

const boardA = "https://media.example/shot-001-a.png?token=signed";
const boardB = "https://media.example/shot-001-b.png?token=signed";

describe("Kling provider reference compiler", () => {
  it("compiles Kling 2.5 start and tail frames without invented prompt tokens", () => {
    expect(
      compileKling25ImageToVideoPayload({
        duration: "5",
        imageUrl: boardA,
        prompt: "The bow bends through one controlled arc in one continuous shot.",
        tailImageUrl: boardB,
      }),
    ).toEqual({
      cfg_scale: 0.5,
      duration: "5",
      image_url: boardA,
      negative_prompt: "blur, distort, and low quality",
      prompt: "The bow bends through one controlled arc in one continuous shot.",
      tail_image_url: boardB,
    });

    expect(() =>
      compileKling25ImageToVideoPayload({
        duration: "5",
        imageUrl: boardA,
        prompt: "Move from @Image1 to @Image2.",
      }),
    ).toThrow(/cannot use reference tokens/u);
  });

  it("compiles Kling 3 start/end frames and exact ordered element bindings", () => {
    expect(
      compileKling3ImageToVideoPayload({
        duration: "4",
        elements: [
          {
            frontalImageUrl: "https://media.example/rama-front.png",
            referenceImageUrls: ["https://media.example/rama-side.png"],
          },
          { frontalImageUrl: "https://media.example/bow.png" },
        ],
        endImageUrl: boardB,
        prompt:
          "@Element1 preserves the identity already visible in the starting frame while raising @Element2 in one continuous motion.",
        startImageUrl: boardA,
      }),
    ).toEqual({
      cfg_scale: 0.5,
      duration: "4",
      elements: [
        {
          frontal_image_url: "https://media.example/rama-front.png",
          reference_image_urls: ["https://media.example/rama-side.png"],
        },
        { frontal_image_url: "https://media.example/bow.png" },
      ],
      end_image_url: boardB,
      generate_audio: false,
      negative_prompt: "blur, distort, and low quality",
      prompt:
        "@Element1 preserves the identity already visible in the starting frame while raising @Element2 in one continuous motion.",
      start_image_url: boardA,
    });
  });

  it("rejects missing, surplus, and wrong-family Kling 3 reference tokens", () => {
    const base = {
      duration: "5" as const,
      elements: [{ frontalImageUrl: "https://media.example/rama-front.png" }],
      startImageUrl: boardA,
    };
    expect(() =>
      compileKling3ImageToVideoPayload({ ...base, prompt: "Rama raises the bow." }),
    ).toThrow(/do not match exactly/u);
    expect(() =>
      compileKling3ImageToVideoPayload({
        ...base,
        prompt: "@Element1 raises @Element2.",
      }),
    ).toThrow(/do not match exactly/u);
    expect(() =>
      compileKling3ImageToVideoPayload({
        ...base,
        prompt: "@Image1 raises the bow while @Element1 remains steady.",
      }),
    ).toThrow(/does not bind custom elements with @Image/u);
  });

  it("enforces fal prompt, URL, and per-element reference bounds", () => {
    expect(() =>
      compileKling3ImageToVideoPayload({
        duration: "5",
        prompt: "x".repeat(2_501),
        startImageUrl: boardA,
      }),
    ).toThrow(/prompt is invalid/u);
    expect(() =>
      compileKling25ImageToVideoPayload({
        duration: "5",
        imageUrl: "http://media.example/board.png",
        prompt: "One continuous motion.",
      }),
    ).toThrow(/imageUrl is invalid/u);
    expect(() =>
      compileKling3ImageToVideoPayload({
        duration: "5",
        elements: [
          {
            frontalImageUrl: "https://media.example/rama-front.png",
            referenceImageUrls: [
              "https://media.example/rama-1.png",
              "https://media.example/rama-2.png",
              "https://media.example/rama-3.png",
              "https://media.example/rama-4.png",
            ],
          },
        ],
        prompt: "@Element1 remains identical.",
        startImageUrl: boardA,
      }),
    ).toThrow(/references exceed policy/u);
  });

  it("quantizes exact retained timing to each Kling endpoint contract", () => {
    expect(
      selectKlingProviderDuration({
        model: "kling-2.5-pro",
        retainedDurationMs: 4_300,
        totalHandleDurationMs: 500,
      }),
    ).toEqual({
      duration: "5",
      requestedDurationMs: 5_000,
      retainedDurationMs: 4_300,
      totalHandleDurationMs: 500,
    });
    expect(
      selectKlingProviderDuration({
        model: "kling-2.5-pro",
        retainedDurationMs: 5_001,
      }).duration,
    ).toBe("10");
    expect(
      selectKlingProviderDuration({
        model: "kling-3-pro",
        retainedDurationMs: 3_201,
      }).duration,
    ).toBe("4");
    expect(
      selectKlingProviderDuration({
        model: "kling-3-pro",
        retainedDurationMs: 1_500,
      }).duration,
    ).toBe("3");
    expect(() =>
      selectKlingProviderDuration({
        model: "kling-3-pro",
        retainedDurationMs: 14_800,
        totalHandleDurationMs: 500,
      }),
    ).toThrow(/cannot cover/u);
  });
});

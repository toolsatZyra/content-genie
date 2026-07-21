import { describe, expect, it } from "vitest";

import {
  compileSeedanceDuration,
  compileSeedanceImageToVideo,
  compileSeedanceReferenceToVideo,
} from "./seedance-reference-compiler";

const reference = (name: string, role: string) => ({
  assetVersionId: `${name}-version`,
  role,
  url: `https://media.example.test/${name}.png`,
});

describe("Seedance provider-reference compiler", () => {
  it("ceil-quantizes and clamps provider duration while retaining edit timing", () => {
    expect(
      compileSeedanceDuration({
        editorialDurationMs: 2_650,
        headHandleMs: 150,
        tailHandleMs: 350,
      }),
    ).toEqual({
      editorialDurationMs: 2_650,
      generationDurationMs: 3_150,
      headHandleMs: 150,
      providerDuration: "4",
      providerDurationMs: 4_000,
      requiresSegmentation: false,
      tailHandleMs: 350,
    });
    expect(
      compileSeedanceDuration({ editorialDurationMs: 4_001 }).providerDuration,
    ).toBe("5");
    expect(compileSeedanceDuration({ editorialDurationMs: 15_001 })).toMatchObject({
      editorialDurationMs: 15_001,
      providerDuration: "15",
      requiresSegmentation: true,
    });
  });

  it("compiles semantic start and end frames without fake reference tokens", () => {
    const compiled = compileSeedanceImageToVideo({
      editorialDurationMs: 4_250,
      endFrame: reference("state-b", "resolved destination state"),
      prompt:
        "Rama bends the bow through one controlled arc and settles into the supplied ending frame.",
      startFrame: reference("state-a", "accepted opening storyboard"),
    });

    expect(compiled.endpoint).toBe("bytedance/seedance-2.0/image-to-video");
    expect(compiled.payload).toMatchObject({
      duration: "5",
      end_image_url: "https://media.example.test/state-b.png",
      generate_audio: false,
      image_url: "https://media.example.test/state-a.png",
    });
    expect(compiled.bindings.map(({ field, role }) => [field, role])).toEqual([
      ["image_url", "start_frame"],
      ["end_image_url", "end_frame"],
    ]);
    expect(compiled.payload.prompt).not.toContain("@Image");
  });

  it("rejects reference-to-video tokens on the start/end-frame endpoint", () => {
    expect(() =>
      compileSeedanceImageToVideo({
        editorialDurationMs: 4_000,
        prompt: "Animate @Image1 with restrained motion.",
        startFrame: reference("board", "opening storyboard"),
      }),
    ).toThrow("must not contain reference-to-video tokens");
  });

  it("preserves fal positional order for every R2V modality", () => {
    const compiled = compileSeedanceReferenceToVideo({
      audioReferences: [reference("ambience", "rhythmic motion reference")],
      editorialDurationMs: 7_125,
      imageReferences: [
        reference("composition", "opening composition"),
        reference("costume", "costume identity"),
      ],
      prompt:
        "Use @Image1 for composition and @Image2 for costume identity. Follow @Video1 for camera motion and @Audio1 for rhythm.",
      videoReferences: [reference("motion", "camera motion reference")],
    });

    expect(
      compiled.bindings.map(({ field, index, token }) => ({
        field,
        index,
        token,
      })),
    ).toEqual([
      { field: "image_urls", index: 0, token: "@Image1" },
      { field: "image_urls", index: 1, token: "@Image2" },
      { field: "video_urls", index: 0, token: "@Video1" },
      { field: "audio_urls", index: 0, token: "@Audio1" },
    ]);
    expect(compiled.payload).toMatchObject({
      audio_urls: ["https://media.example.test/ambience.png"],
      duration: "8",
      image_urls: [
        "https://media.example.test/composition.png",
        "https://media.example.test/costume.png",
      ],
      video_urls: ["https://media.example.test/motion.png"],
    });
  });

  it("rejects unreferenced attachments and unattached prompt tokens", () => {
    expect(() =>
      compileSeedanceReferenceToVideo({
        editorialDurationMs: 4_000,
        imageReferences: [
          reference("composition", "opening composition"),
          reference("costume", "costume identity"),
        ],
        prompt: "Animate @Image1.",
      }),
    ).toThrow("Missing: @Image2");

    expect(() =>
      compileSeedanceReferenceToVideo({
        editorialDurationMs: 4_000,
        imageReferences: [reference("composition", "opening composition")],
        prompt: "Animate @Image1 toward @Image2.",
      }),
    ).toThrow("Unattached: @Image2");
  });

  it("rejects generic bracket syntax and overlong single-shot requests", () => {
    expect(() =>
      compileSeedanceReferenceToVideo({
        editorialDurationMs: 4_000,
        imageReferences: [reference("composition", "opening composition")],
        prompt: "Animate [Image1].",
      }),
    ).toThrow("must use @ImageN");

    expect(() =>
      compileSeedanceImageToVideo({
        editorialDurationMs: 15_001,
        prompt: "One continuous movement.",
        startFrame: reference("board", "opening storyboard"),
      }),
    ).toThrow("cannot cover the editorial duration");
  });
});

import { describe, expect, it, vi } from "vitest";

import {
  compareUploadedNarrationToOriginalScript,
  compileUploadedNarrationAlignment,
  parseWhisperVerboseJson,
  transcribeSanitizedUploadedNarrationMp3,
} from "@/server/uploaded-narration-alignment";

function response(overrides: Record<string, unknown> = {}) {
  return {
    duration: 60.5,
    language: "hindi",
    text: "  राम,  वन गए।  ",
    words: [
      { end: 0.6, start: 0.1, word: " राम" },
      { end: 1.1, start: 0.7, word: "वन" },
      { end: 1.7, start: 1.2, word: "गए" },
    ],
    ...overrides,
  };
}

describe("uploaded narration timestamp alignment", () => {
  it("preserves authoritative NFC transcription including punctuation and whitespace", () => {
    const result = compileUploadedNarrationAlignment(response());
    expect(result.authoritativeText).toBe("राम,  वन गए।");
    expect(result.speechAlignment.characters.join("")).toBe(result.authoritativeText);
    expect(result.durationSeconds).toBe(60.5);
    expect(result.language).toBe("hi");
    expect(result.transcriptSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.evidenceSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("aligns split and merged timestamp words to the same exact transcript", () => {
    const split = compileUploadedNarrationAlignment({
      duration: 61,
      language: "hi",
      text: "शिवशंकर आए",
      words: [
        { end: 0.4, start: 0.1, word: "शिव" },
        { end: 0.9, start: 0.4, word: "शंकर" },
        { end: 1.4, start: 1, word: "आए" },
      ],
    });
    const merged = compileUploadedNarrationAlignment({
      duration: 61,
      language: "hi",
      text: "शिव शंकर आए",
      words: [
        { end: 0.9, start: 0.1, word: "शिवशंकर" },
        { end: 1.4, start: 1, word: "आए" },
      ],
    });
    expect(split.speechAlignment.characters.join("")).toBe("शिवशंकर आए");
    expect(merged.speechAlignment.characters.join("")).toBe("शिव शंकर आए");
  });

  it("gives every spoken letter, mark and number a positive monotonic window", () => {
    const result = compileUploadedNarrationAlignment(response());
    const {
      characters,
      characterEndTimesSeconds: ends,
      characterStartTimesSeconds: starts,
    } = result.speechAlignment;
    let previousStart = -1;
    characters.forEach((character, index) => {
      expect(starts[index]).toBeGreaterThanOrEqual(previousStart);
      if (/[\p{L}\p{M}\p{N}]/u.test(character)) {
        expect(ends[index]).toBeGreaterThan(starts[index]!);
      }
      previousStart = starts[index]!;
    });
  });

  it("returns low similarity as advisory evidence rather than rejecting it", () => {
    const advisory = compareUploadedNarrationToOriginalScript(
      "राम वन गए और सीता से मिले।",
      "शिव ने कैलाश पर ध्यान किया।",
    );
    expect(advisory.exactMatch).toBe(false);
    expect(advisory.requiresConfirmation).toBe(true);
    expect(advisory.similarity).toBeLessThan(0.5);
    expect(advisory.editDistance).toBeGreaterThan(0);
  });

  it("rejects malformed, nonmonotonic and out-of-duration timestamps", () => {
    expect(() => parseWhisperVerboseJson({ ...response(), extra: true })).toThrow(
      "malformed",
    );
    expect(() =>
      parseWhisperVerboseJson(
        response({
          words: [
            { end: 1, start: 0.5, word: "राम" },
            { end: 1.2, start: 0.9, word: "वन" },
          ],
        }),
      ),
    ).toThrow("monotonic");
    expect(() =>
      parseWhisperVerboseJson(
        response({ words: [{ end: 61, start: 60, word: "राम" }] }),
      ),
    ).toThrow("invalid");
    expect(() => parseWhisperVerboseJson(response({ duration: 59.99 }))).toThrow(
      "invalid",
    );
  });

  it("rejects timestamp words that cannot reproduce the transcript", () => {
    expect(() =>
      compileUploadedNarrationAlignment(
        response({ words: [{ end: 0.6, start: 0.1, word: "श्याम" }] }),
      ),
    ).toThrow("do not reproduce");
  });

  it("sends only the narrow Whisper word-timestamp request", async () => {
    const fetchImplementation = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        const form = init?.body as FormData;
        expect(form.get("model")).toBe("whisper-1");
        expect(form.get("response_format")).toBe("verbose_json");
        expect(form.getAll("timestamp_granularities[]")).toEqual(["word"]);
        expect(form.get("language")).toBe("hi");
        expect(form.get("file")).toBeInstanceOf(Blob);
        return new Response(JSON.stringify(response()), {
          headers: { "content-type": "application/json" },
          status: 200,
        });
      },
    );
    const bytes = Buffer.alloc(128, 0);
    bytes.write("ID3", 0, "ascii");
    const result = await transcribeSanitizedUploadedNarrationMp3(bytes, {
      apiKey: "test-key-that-is-long-enough",
      fetchImplementation: fetchImplementation as typeof fetch,
    });
    expect(result.authoritativeText).toBe("राम,  वन गए।");
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });
});

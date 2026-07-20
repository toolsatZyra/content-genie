import { describe, expect, it } from "vitest";

import {
  buildCinematicTimeline,
  type PlanAlignmentSegment,
} from "./preflight-plan-timeline";

function fixture(durationMs = 60_000) {
  const words = Array.from({ length: 120 }, (_, index) => `शब्द${index + 1}`);
  const processingText = words.join(" ");
  const tokens = [...processingText.matchAll(/\s+|\S+/gu)];
  let scalar = 0;
  const segments: PlanAlignmentSegment[] = tokens.map((match, index) => {
    const exactText = match[0];
    const startScalar = scalar;
    scalar += Array.from(exactText).length;
    const startMs = Math.round((index * durationMs) / tokens.length);
    const endMs =
      index === tokens.length - 1
        ? durationMs
        : Math.round(((index + 1) * durationMs) / tokens.length);
    return {
      endMs,
      endScalar: scalar,
      exactText,
      kind: /^\s+$/u.test(exactText) ? "authored_pause" : "spoken",
      segmentNumber: index + 1,
      startMs,
      startScalar,
    };
  });
  return { durationMs, processingText, segments };
}

describe("deterministic cinematic timeline", () => {
  it("covers every Unicode scalar and millisecond without overlap", () => {
    const input = fixture();
    const timeline = buildCinematicTimeline(input);
    expect(timeline.shots.length).toBe(20);
    expect(timeline.shots[0]?.startMs).toBe(0);
    expect(timeline.shots.at(-1)?.endMs).toBe(input.durationMs);
    expect(timeline.shots.map(({ exactText }) => exactText).join("")).toBe(
      input.processingText,
    );
    for (const [index, shot] of timeline.shots.entries()) {
      expect(shot.shotNumber).toBe(index + 1);
      expect(shot.endMs - shot.startMs).toBeGreaterThanOrEqual(1_000);
      expect(shot.endMs - shot.startMs).toBeLessThanOrEqual(5_000);
      if (index > 0) expect(shot.startMs).toBe(timeline.shots[index - 1]?.endMs);
    }
    expect(timeline.beats.flatMap(({ shotNumbers }) => shotNumbers)).toEqual(
      timeline.shots.map(({ shotNumber }) => shotNumber),
    );
  });

  it("keeps a short first-frame hook and a dedicated final image", () => {
    const timeline = buildCinematicTimeline(fixture(90_000));
    expect(timeline.shots).toHaveLength(30);
    expect(timeline.beats[0]?.shotNumbers).toEqual([1]);
    expect(timeline.beats.at(-1)?.shotNumbers).toEqual([
      timeline.shots.at(-1)?.shotNumber,
    ]);
    expect(timeline.shots[0]!.endMs - timeline.shots[0]!.startMs).toBeLessThan(5_000);
  });

  it("plans forty word-bound visual slots for the 120-second ceiling", () => {
    const timeline = buildCinematicTimeline(fixture(120_000));
    expect(timeline.shots).toHaveLength(40);
    expect(timeline.shots.map(({ exactText }) => exactText).join("")).toBe(
      fixture(120_000).processingText,
    );
  });

  it("rejects a scalar substitution even when timestamps look contiguous", () => {
    const input = fixture();
    const segments = input.segments.map((segment, index) =>
      index === 3 ? { ...segment, exactText: "बदला" } : segment,
    );
    expect(() => buildCinematicTimeline({ ...input, segments })).toThrow("not exact");
  });
});

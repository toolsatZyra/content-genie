import { describe, expect, it } from "vitest";

import {
  compileMvpEditRenderPlan,
  MvpEditRenderPlanError,
  normalizeMvpCut,
} from "@/server/mvp-edit-render-plan";

const shots = [
  {
    availableDurationMs: 5_000,
    cutType: "Fade in from black",
    endMs: 3_000,
    shotNumber: 1,
    startMs: 0,
  },
  {
    availableDurationMs: 5_000,
    cutType: "Match on action",
    endMs: 6_100,
    shotNumber: 2,
    startMs: 3_000,
  },
] as const;

describe("MVP edit render plan", () => {
  it("compiles exact clips, a first-frame fade and a narration trim", () => {
    const plan = compileMvpEditRenderPlan(shots, 6_100);
    expect(plan.cutExecutions.map(({ kind }) => kind)).toEqual([
      "fade_from_black",
      "cut_on_action",
    ]);
    expect(plan.filterComplex).toContain("trim=start=0:end=3.000");
    expect(plan.filterComplex).toContain("fade=t=in:st=0:d=0.250");
    expect(plan.filterComplex).toContain("atrim=start=0:end=6.100");
    expect(plan.filterComplex).not.toMatch(
      /stream_loop|\bloop\b|tpad|minterpolate|atempo|setpts\s*=\s*PTS\s*[*\/]/iu,
    );
  });

  it.each([
    ["Hard cut", "hard_cut"],
    ["Match cut on the eye-line", "match_cut"],
    ["Smash cut", "smash_cut"],
    ["Jump cut", "jump_cut"],
    ["Cross dissolve", "hard_cut"],
    ["Whip-pan transition", "hard_cut"],
    ["Director prose that is not executable", "hard_cut"],
  ])("normalizes %s safely", (cue, kind) => {
    expect(normalizeMvpCut(cue, 2)).toMatchObject({ kind, renderedAs: "hard_cut" });
  });

  it("allows fade from black only on the opening shot", () => {
    expect(normalizeMvpCut("Fade in", 1).renderedAs).toBe("fade_from_black");
    expect(normalizeMvpCut("Fade in", 2).renderedAs).toBe("hard_cut");
  });

  it.each([
    [[{ ...shots[0], startMs: 1 }], 3_000],
    [[shots[0], { ...shots[1], startMs: 3_001 }], 6_100],
    [[{ ...shots[0], availableDurationMs: 2_999 }], 3_000],
    [[shots[0]], 3_001],
  ])("rejects an unsafe timeline", (input, duration) => {
    expect(() => compileMvpEditRenderPlan(input, duration)).toThrow(
      MvpEditRenderPlanError,
    );
  });

  it("never interpolates an untrusted cut cue into FFmpeg", () => {
    const payload = "Hard cut;movie=/etc/passwd[bad]";
    const plan = compileMvpEditRenderPlan([{ ...shots[0], cutType: payload }], 3_000);
    expect(plan.filterComplex).not.toContain(payload);
  });

  it("places one verified SFX asset inside its exact shot without moving narration", () => {
    const plan = compileMvpEditRenderPlan(shots, 6_100, [
      {
        fadeInMs: 25,
        fadeOutMs: 100,
        gainDb: -20,
        inputIndex: 3,
        shotNumber: 2,
        startOffsetMs: 250,
        trimDurationMs: 1_000,
      },
    ]);
    expect(plan.audioLabel).toBe("mix");
    expect(plan.filterComplex).toContain("adelay=delays=3250:all=1");
    expect(plan.filterComplex).toContain("volume=-20.00dB");
    expect(plan.filterComplex).toContain("amix=inputs=2:duration=first");
    expect(plan.filterComplex).toContain("alimiter=limit=0.891251");
  });

  it("rejects duplicate, out-of-window, and colliding SFX inputs", () => {
    const effect = {
      fadeInMs: 0,
      fadeOutMs: 100,
      gainDb: -18,
      inputIndex: 3,
      shotNumber: 2,
      startOffsetMs: 0,
      trimDurationMs: 1_000,
    } as const;
    expect(() => compileMvpEditRenderPlan(shots, 6_100, [effect, effect])).toThrow(
      "SFX cue",
    );
    expect(() =>
      compileMvpEditRenderPlan(shots, 6_100, [{ ...effect, startOffsetMs: 3_000 }]),
    ).toThrow("SFX cue");
    expect(() =>
      compileMvpEditRenderPlan(shots, 6_100, [{ ...effect, inputIndex: 2 }]),
    ).toThrow("SFX cue");
  });
});

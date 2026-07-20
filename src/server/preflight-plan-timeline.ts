import "server-only";

export type PlanAlignmentSegment = Readonly<{
  endMs: number;
  endScalar: number;
  exactText: string;
  kind: "authored_pause" | "spoken";
  segmentNumber: number;
  startMs: number;
  startScalar: number;
}>;

export type PlanShotWindow = Readonly<{
  beatNumber: number;
  endMs: number;
  endScalar: number;
  exactText: string;
  shotNumber: number;
  startMs: number;
  startScalar: number;
}>;

export type PlanBeatWindow = Readonly<{
  beatNumber: number;
  endMs: number;
  endScalar: number;
  exactText: string;
  shotNumbers: readonly number[];
  startMs: number;
  startScalar: number;
}>;

export type CinematicTimeline = Readonly<{
  beats: readonly PlanBeatWindow[];
  shots: readonly PlanShotWindow[];
}>;

export class PreflightPlanTimelineError extends Error {
  override readonly name = "PreflightPlanTimelineError";
}

const TARGET_SHOT_MS = 3_000;
const MINIMUM_SHOT_MS = 1_000;
const MAXIMUM_SHOT_MS = 5_000;

function exactSlice(text: string, startScalar: number, endScalar: number): string {
  return Array.from(text).slice(startScalar, endScalar).join("");
}

function validateAlignment(input: {
  durationMs: number;
  processingText: string;
  segments: readonly PlanAlignmentSegment[];
}) {
  const scalarCount = Array.from(input.processingText).length;
  if (
    !Number.isSafeInteger(input.durationMs) ||
    input.durationMs < 60_000 ||
    input.durationMs > 120_000 ||
    input.segments.length < 1 ||
    input.segments.length > 2_000
  ) {
    throw new PreflightPlanTimelineError("Narration alignment envelope is invalid.");
  }
  let priorScalar = 0;
  let priorEndMs = 0;
  for (const [index, segment] of input.segments.entries()) {
    if (
      segment.segmentNumber !== index + 1 ||
      segment.startScalar !== priorScalar ||
      segment.startMs < priorEndMs ||
      segment.endScalar <= segment.startScalar ||
      segment.endScalar > scalarCount ||
      segment.endMs < segment.startMs ||
      segment.endMs > input.durationMs ||
      (segment.kind === "spoken" && segment.endMs <= segment.startMs) ||
      segment.exactText !==
        exactSlice(input.processingText, segment.startScalar, segment.endScalar)
    ) {
      throw new PreflightPlanTimelineError("Narration alignment is not exact.");
    }
    priorScalar = segment.endScalar;
    priorEndMs = segment.endMs;
  }
  if (priorScalar !== scalarCount || priorEndMs !== input.durationMs) {
    throw new PreflightPlanTimelineError(
      "Narration alignment does not cover the locked master clock.",
    );
  }
}

function rawShotRanges(
  durationMs: number,
  segments: readonly PlanAlignmentSegment[],
): Array<Readonly<{ endIndex: number; startIndex: number }>> {
  const shotCount = Math.ceil(durationMs / TARGET_SHOT_MS);
  if (segments.length < shotCount) {
    throw new PreflightPlanTimelineError(
      "Narration alignment is too coarse for three-second visual coverage.",
    );
  }
  const ranges: Array<Readonly<{ endIndex: number; startIndex: number }>> = [];
  let startIndex = 0;
  let priorEndMs = 0;
  for (let shotIndex = 1; shotIndex < shotCount; shotIndex += 1) {
    const targetEndMs = Math.round((durationMs * shotIndex) / shotCount);
    const remainingShots = shotCount - shotIndex;
    const maximumEndIndex = segments.length - remainingShots - 1;
    let selectedEndIndex = -1;
    let selectedDistance = Number.POSITIVE_INFINITY;
    for (let index = startIndex; index <= maximumEndIndex; index += 1) {
      const endMs = segments[index]!.endMs;
      const duration = endMs - priorEndMs;
      if (duration < MINIMUM_SHOT_MS || duration > MAXIMUM_SHOT_MS) continue;
      const distance = Math.abs(endMs - targetEndMs);
      if (distance < selectedDistance) {
        selectedDistance = distance;
        selectedEndIndex = index;
      }
    }
    if (selectedEndIndex < startIndex) {
      throw new PreflightPlanTimelineError(
        `Shot window ${shotIndex} cannot align to the locked narration words.`,
      );
    }
    ranges.push(Object.freeze({ endIndex: selectedEndIndex, startIndex }));
    priorEndMs = segments[selectedEndIndex]!.endMs;
    startIndex = selectedEndIndex + 1;
  }
  const finalDuration = durationMs - priorEndMs;
  if (
    startIndex >= segments.length ||
    finalDuration < MINIMUM_SHOT_MS ||
    finalDuration > MAXIMUM_SHOT_MS
  ) {
    throw new PreflightPlanTimelineError(
      "The final shot cannot align to the locked narration words.",
    );
  }
  ranges.push(Object.freeze({ endIndex: segments.length - 1, startIndex }));
  return ranges;
}

function groupShots(shotCount: number): readonly (readonly number[])[] {
  const groups: number[][] = [];
  let cursor = 1;
  if (shotCount >= 4) {
    groups.push([cursor]);
    cursor += 1;
  }
  const reserveFinal = shotCount - cursor + 1 >= 3;
  const lastMiddleShot = reserveFinal ? shotCount - 1 : shotCount;
  while (cursor <= lastMiddleShot) {
    const remaining = lastMiddleShot - cursor + 1;
    const size = remaining === 3 ? 3 : Math.min(2, remaining);
    groups.push(Array.from({ length: size }, (_, index) => cursor + index));
    cursor += size;
  }
  if (reserveFinal) groups.push([shotCount]);
  return Object.freeze(groups.map((group) => Object.freeze(group)));
}

export function buildCinematicTimeline(input: {
  durationMs: number;
  processingText: string;
  segments: readonly PlanAlignmentSegment[];
}): CinematicTimeline {
  validateAlignment(input);
  const ranges = rawShotRanges(input.durationMs, input.segments);
  const ungroupedShots = ranges.map((range, index) => {
    const first = input.segments[range.startIndex]!;
    const last = input.segments[range.endIndex]!;
    const duration = last.endMs - first.startMs;
    if (duration < MINIMUM_SHOT_MS || duration > MAXIMUM_SHOT_MS) {
      throw new PreflightPlanTimelineError(
        `Shot window ${index + 1} falls outside the provider planning band.`,
      );
    }
    return {
      endMs: last.endMs,
      endScalar: last.endScalar,
      exactText: exactSlice(input.processingText, first.startScalar, last.endScalar),
      shotNumber: index + 1,
      startMs: first.startMs,
      startScalar: first.startScalar,
    };
  });
  const groups = groupShots(ungroupedShots.length);
  const beatByShot = new Map<number, number>();
  const beats = groups.map((shotNumbers, index) => {
    const first = ungroupedShots[shotNumbers[0]! - 1]!;
    const last = ungroupedShots[shotNumbers.at(-1)! - 1]!;
    const beatNumber = index + 1;
    for (const shotNumber of shotNumbers) beatByShot.set(shotNumber, beatNumber);
    return Object.freeze({
      beatNumber,
      endMs: last.endMs,
      endScalar: last.endScalar,
      exactText: exactSlice(input.processingText, first.startScalar, last.endScalar),
      shotNumbers,
      startMs: first.startMs,
      startScalar: first.startScalar,
    });
  });
  const shots = ungroupedShots.map((shot) =>
    Object.freeze({
      ...shot,
      beatNumber: beatByShot.get(shot.shotNumber)!,
    }),
  );
  if (
    beats.length < 3 ||
    shots.length !== Math.ceil(input.durationMs / TARGET_SHOT_MS) ||
    shots.length < 20 ||
    shots.length > 40 ||
    shots.some((shot) => !Number.isSafeInteger(shot.beatNumber))
  ) {
    throw new PreflightPlanTimelineError(
      "The narration cannot form a bounded cinematic timeline.",
    );
  }
  return Object.freeze({
    beats: Object.freeze(beats),
    shots: Object.freeze(shots),
  });
}

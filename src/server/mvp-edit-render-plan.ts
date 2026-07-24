export type MvpCutKind =
  | "cut_on_action"
  | "fade_from_black"
  | "hard_cut"
  | "jump_cut"
  | "match_cut"
  | "smash_cut";

export type MvpEditShotInput = Readonly<{
  availableDurationMs: number;
  cutType: string;
  endMs: number;
  shotNumber: number;
  startMs: number;
}>;

export type MvpSfxMixInput = Readonly<{
  fadeInMs: number;
  fadeOutMs: number;
  gainDb: number;
  inputIndex: number;
  shotNumber: number;
  startOffsetMs: number;
  trimDurationMs: number;
}>;

export type MvpCutExecution = Readonly<{
  kind: MvpCutKind;
  renderedAs: "fade_from_black" | "hard_cut";
  requested: string;
  shotNumber: number;
}>;

export type MvpEditRenderPlan = Readonly<{
  audioLabel: "mix" | "narr";
  cutExecutions: readonly MvpCutExecution[];
  filterComplex: string;
  videoLabel: "video";
}>;

export class MvpEditRenderPlanError extends Error {
  override readonly name = "MvpEditRenderPlanError";
}

const MAXIMUM_SHOTS = 80;

function seconds(milliseconds: number): string {
  return (milliseconds / 1_000).toFixed(3);
}

export function normalizeMvpCut(
  requested: string,
  shotNumber: number,
): MvpCutExecution {
  if (
    typeof requested !== "string" ||
    requested.trim().length < 1 ||
    requested.length > 1_200 ||
    requested.includes("\0") ||
    !Number.isSafeInteger(shotNumber) ||
    shotNumber < 1
  ) {
    throw new MvpEditRenderPlanError("An editorial cut cue is invalid.");
  }
  const cue = requested
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[_.-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  let kind: MvpCutKind = "hard_cut";
  if (/\b(match on action|action match|cut on action)\b/u.test(cue)) {
    kind = "cut_on_action";
  } else if (/\bmatch cut\b/u.test(cue)) {
    kind = "match_cut";
  } else if (/\bsmash cut\b/u.test(cue)) {
    kind = "smash_cut";
  } else if (/\bjump cut\b/u.test(cue)) {
    kind = "jump_cut";
  } else if (
    shotNumber === 1 &&
    /\b(fade in|fade from black|open from black)\b/u.test(cue)
  ) {
    kind = "fade_from_black";
  }
  return Object.freeze({
    kind,
    renderedAs: kind === "fade_from_black" ? "fade_from_black" : "hard_cut",
    requested: requested.trim(),
    shotNumber,
  });
}

export function compileMvpEditRenderPlan(
  shots: readonly MvpEditShotInput[],
  narrationDurationMs: number,
  soundEffects: readonly MvpSfxMixInput[] = [],
): MvpEditRenderPlan {
  if (
    shots.length < 1 ||
    shots.length > MAXIMUM_SHOTS ||
    !Number.isSafeInteger(narrationDurationMs) ||
    narrationDurationMs < 1_000 ||
    narrationDurationMs > 120_000
  ) {
    throw new MvpEditRenderPlanError("The editorial timeline is invalid.");
  }
  const cuts: MvpCutExecution[] = [];
  const videoFilters: string[] = [];
  for (const [index, shot] of shots.entries()) {
    const retainedDurationMs = shot.endMs - shot.startMs;
    if (
      shot.shotNumber !== index + 1 ||
      !Number.isSafeInteger(shot.startMs) ||
      !Number.isSafeInteger(shot.endMs) ||
      !Number.isFinite(shot.availableDurationMs) ||
      retainedDurationMs < 1_000 ||
      retainedDurationMs > 15_000 ||
      shot.availableDurationMs < retainedDurationMs ||
      (index === 0 ? shot.startMs !== 0 : shot.startMs !== shots[index - 1]!.endMs)
    ) {
      throw new MvpEditRenderPlanError("The editorial shot timeline is invalid.");
    }
    const cut = normalizeMvpCut(shot.cutType, shot.shotNumber);
    cuts.push(cut);
    const fade = cut.renderedAs === "fade_from_black" ? ",fade=t=in:st=0:d=0.250" : "";
    videoFilters.push(
      `[${index}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30,format=yuv420p,trim=start=0:end=${seconds(retainedDurationMs)},setpts=PTS-STARTPTS${fade}[v${index}]`,
    );
  }
  if (shots.at(-1)!.endMs !== narrationDurationMs) {
    throw new MvpEditRenderPlanError(
      "The editorial timeline does not end on the narration clock.",
    );
  }
  const concatInputs = shots.map((_, index) => `[v${index}]`).join("");
  const audioInput = shots.length;
  const audioFilters = [
    `[${audioInput}:a]atrim=start=0:end=${seconds(narrationDurationMs)},asetpts=PTS-STARTPTS[narr]`,
  ];
  const seenSfxShots = new Set<number>();
  const seenInputIndexes = new Set<number>();
  for (const [index, effect] of soundEffects.entries()) {
    const shot = shots[effect.shotNumber - 1];
    if (
      !shot ||
      seenSfxShots.has(effect.shotNumber) ||
      !Number.isSafeInteger(effect.inputIndex) ||
      effect.inputIndex <= audioInput ||
      seenInputIndexes.has(effect.inputIndex) ||
      !Number.isSafeInteger(effect.startOffsetMs) ||
      effect.startOffsetMs < 0 ||
      !Number.isSafeInteger(effect.trimDurationMs) ||
      effect.trimDurationMs < 1 ||
      effect.startOffsetMs + effect.trimDurationMs > shot.endMs - shot.startMs ||
      !Number.isFinite(effect.gainDb) ||
      effect.gainDb < -30 ||
      effect.gainDb > -9 ||
      !Number.isSafeInteger(effect.fadeInMs) ||
      !Number.isSafeInteger(effect.fadeOutMs) ||
      effect.fadeInMs < 0 ||
      effect.fadeOutMs < 0 ||
      effect.fadeInMs + effect.fadeOutMs > effect.trimDurationMs
    ) {
      throw new MvpEditRenderPlanError("A materialized SFX cue is invalid.");
    }
    seenSfxShots.add(effect.shotNumber);
    seenInputIndexes.add(effect.inputIndex);
    const absoluteStartMs = shot.startMs + effect.startOffsetMs;
    const fadeIn =
      effect.fadeInMs > 0 ? `,afade=t=in:st=0:d=${seconds(effect.fadeInMs)}` : "";
    const fadeOut =
      effect.fadeOutMs > 0
        ? `,afade=t=out:st=${seconds(
            effect.trimDurationMs - effect.fadeOutMs,
          )}:d=${seconds(effect.fadeOutMs)}`
        : "";
    audioFilters.push(
      `[${effect.inputIndex}:a]atrim=start=0:end=${seconds(effect.trimDurationMs)},asetpts=PTS-STARTPTS,volume=${effect.gainDb.toFixed(2)}dB${fadeIn}${fadeOut},adelay=delays=${absoluteStartMs}:all=1[sfx${index}]`,
    );
  }
  const sfxLabels = soundEffects.map((_, index) => `[sfx${index}]`).join("");
  const mix =
    soundEffects.length > 0
      ? `;[narr]${sfxLabels}amix=inputs=${soundEffects.length + 1}:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.891251[mix]`
      : "";
  const filterComplex = `${videoFilters.join(";")};${concatInputs}concat=n=${shots.length}:v=1:a=0[joined];[joined]trim=start=0:end=${seconds(narrationDurationMs)},setpts=PTS-STARTPTS[video];${audioFilters.join(";")}${mix}`;
  if (
    /stream_loop|\bloop\b|tpad|minterpolate|atempo|setpts\s*=\s*PTS\s*[*\/]/iu.test(
      filterComplex,
    )
  ) {
    throw new MvpEditRenderPlanError(
      "The edit plan contains a forbidden timing operation.",
    );
  }
  return Object.freeze({
    audioLabel: soundEffects.length > 0 ? "mix" : "narr",
    cutExecutions: Object.freeze(cuts),
    filterComplex,
    videoLabel: "video",
  });
}

export const GENIE_LAUNCH_PERFORMANCE_PROFILE = {
  accent: "Delhi",
  configurationPolicy: "system_locked",
  hindiDelivery: "conversational_expressive",
  id: "genie-launch-hindi-delhi-sanskrit-performance.v1",
  language: "hi-IN",
  sanskritFluency: "required",
  userSelectable: false,
  version: 1,
} as const;

export const GENIE_LAUNCH_PROFILE = {
  aspectRatio: "9:16",
  dialogueEnabled: false,
  language: "hi-IN",
  lipSyncApplicability: "not_applicable",
  narrationMode: "background_narration",
  performanceProfileId: GENIE_LAUNCH_PERFORMANCE_PROFILE.id,
  targetDurationSeconds: {
    maximum: 120,
    minimum: 60,
  },
} as const;

export type GenieLaunchProfile = typeof GENIE_LAUNCH_PROFILE;
export type GenieLaunchPerformanceProfile = typeof GENIE_LAUNCH_PERFORMANCE_PROFILE;

export const NARRATION_DURATION_PROFILE = {
  clausePauseSeconds: 0.18,
  id: "genie-hindi-conversational-expressive-duration.v2",
  lineBreakPauseSeconds: 0.25,
  performanceBreathEveryWords: 18,
  performanceBreathSeconds: 0.32,
  sentencePauseSeconds: 0.42,
  wordsPerMinute: 125,
} as const;

export interface NarrationDurationEstimate {
  readonly clauseMarks: number;
  readonly estimatedSeconds: number;
  readonly lineBreaks: number;
  readonly performanceBreaths: number;
  readonly profileId: typeof NARRATION_DURATION_PROFILE.id;
  readonly sentenceMarks: number;
  readonly words: number;
}

export function durationNeedsAcknowledgement(estimatedSeconds: number): boolean {
  return (
    !Number.isFinite(estimatedSeconds) ||
    estimatedSeconds < GENIE_LAUNCH_PROFILE.targetDurationSeconds.minimum ||
    estimatedSeconds > GENIE_LAUNCH_PROFILE.targetDurationSeconds.maximum
  );
}

export function estimateNarrationDurationSeconds(text: string): number {
  return estimateNarrationDuration(text).estimatedSeconds;
}

export function estimateNarrationDuration(text: string): NarrationDurationEstimate {
  const processingText = text
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .normalize("NFC");
  const trimmed = processingText.trim();
  const words = trimmed ? trimmed.split(/\s+/u).length : 0;
  let clauseMarks = 0;
  let lineBreaks = 0;
  let sentenceMarks = 0;
  for (const scalar of processingText) {
    if (".!?।॥".includes(scalar)) sentenceMarks += 1;
    if (",;:—–".includes(scalar)) clauseMarks += 1;
    if (scalar === "\n") lineBreaks += 1;
  }
  const performanceBreaths = Math.max(
    Math.ceil(words / NARRATION_DURATION_PROFILE.performanceBreathEveryWords) - 1,
    0,
  );
  const estimatedSeconds = Number(
    (
      (Math.max(words, 1) * 60) / NARRATION_DURATION_PROFILE.wordsPerMinute +
      sentenceMarks * NARRATION_DURATION_PROFILE.sentencePauseSeconds +
      clauseMarks * NARRATION_DURATION_PROFILE.clausePauseSeconds +
      lineBreaks * NARRATION_DURATION_PROFILE.lineBreakPauseSeconds +
      performanceBreaths * NARRATION_DURATION_PROFILE.performanceBreathSeconds
    ).toFixed(3),
  );
  return {
    clauseMarks,
    estimatedSeconds,
    lineBreaks,
    performanceBreaths,
    profileId: NARRATION_DURATION_PROFILE.id,
    sentenceMarks,
    words,
  };
}

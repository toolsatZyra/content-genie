import { describe, expect, it } from "vitest";

import {
  compileMvpRepairDirectorOutput,
  prepareMvpRepairDirector,
} from "./mvp-repair-director";
import {
  compileMvpRepairGroundingEvidence,
  mvpRepairEvidenceBundleSha256,
} from "./mvp-repair-grounding-evidence";

const shot = (shotNumber: number) => ({
  action: `Bounded action ${shotNumber}.`,
  cameraAngleAndDistance: "Medium devotional portrait.",
  cameraMotion: `Bounded motion ${shotNumber}.`,
  cutType: "hard_cut",
  durationMs: 3_000,
  endMs: shotNumber * 3_000,
  exactNarration: `Immutable narration ${shotNumber}.`,
  lighting: "Warm side light.",
  mood: "Devotional resolve.",
  motionPromptBlueprint: `Animate shot ${shotNumber}.`,
  narrativeFunction: "Advance the devotional story.",
  promptBlueprint: `Frame ${shotNumber}.`,
  sceneComposition: `Composition ${shotNumber}.`,
  sfxCue: "deliberate silence",
  sfxDurationMs: 0,
  sfxGainDb: -20,
  sfxStartOffsetMs: 0,
  shotNumber,
  startMs: (shotNumber - 1) * 3_000,
  sourceStoryboardAvailable: true,
  storyboardCompositionMode: "single_frame" as const,
  storyboardEndPromptBlueprint: null,
  storyboardPromptBlueprint: `Storyboard ${shotNumber}.`,
  storyboardStartPromptBlueprint: `Storyboard ${shotNumber}.`,
  visualIntent: `Legible visual ${shotNumber}.`,
});

const revised = (shotNumber: number) => {
  const {
    durationMs: _durationMs,
    endMs: _endMs,
    exactNarration: _exactNarration,
    shotNumber: _shotNumber,
    startMs: _startMs,
    sourceStoryboardAvailable: _sourceStoryboardAvailable,
    ...fields
  } = shot(shotNumber);
  void [
    _durationMs,
    _endMs,
    _exactNarration,
    _shotNumber,
    _startMs,
    _sourceStoryboardAvailable,
  ];
  return fields;
};

const action = (
  shotNumber: number,
  selected:
    "regenerate_clip" | "regenerate_storyboard_and_clip" | "reedit_only" | "reuse_all",
  feedbackPointIndexes: readonly number[] = selected === "reuse_all" ? [] : [1],
  resolvedShotNumbers: readonly number[] = [shotNumber],
) => ({
  action: selected,
  dependencyReason: null,
  evidenceWindows: resolvedShotNumbers.map((resolvedShotNumber) => ({
    endMs: resolvedShotNumber * 3_000,
    shotNumber: resolvedShotNumber,
    startMs: (resolvedShotNumber - 1) * 3_000,
  })),
  feedbackPointIndexes,
  reason: `Grounded action for shot ${shotNumber}.`,
  resolvedShotNumbers,
  revisedFields: selected === "reuse_all" ? null : revised(shotNumber),
  shotNumber,
});

describe("MVP repair grounding evidence", () => {
  it("persists safe deterministic/model points and every non-reuse action lineage", () => {
    const preparation = prepareMvpRepairDirector({
      clarificationTranscript: [],
      continuityEdges: [{ dependentShotNumber: 3, sourceShotNumber: 1 }],
      immutableOwnerFeedback:
        "At 00:03.500, make the motion faster.\nRama's bow image is incorrect.",
      shots: [shot(1), shot(2), shot(3)],
      sourceEddHash: "c".repeat(64),
      totalShots: 3,
    });
    const compiled = compileMvpRepairDirectorOutput(preparation, {
      actions: [
        action(1, "regenerate_storyboard_and_clip", [2]),
        action(2, "regenerate_clip", [1]),
        action(3, "reuse_all"),
      ],
      clarification: null,
      decision: "repair",
      overallInterpretation: "Two independent points require bounded repair.",
    });
    const evidence = compileMvpRepairGroundingEvidence(preparation, compiled);

    expect(evidence.feedbackPoints.map(({ resolution }) => resolution)).toEqual([
      "deterministic",
      "model",
    ]);
    expect(
      evidence.feedbackPoints.map(({ resolvedShotNumbers }) => resolvedShotNumbers),
    ).toEqual([[2], [1]]);
    expect(evidence.actionGrounding).toMatchObject([
      {
        feedbackPointIndexes: [2],
        selectedAction: "storyboard_and_clip",
        shotNumber: 1,
      },
      { feedbackPointIndexes: [1], selectedAction: "clip_only", shotNumber: 2 },
      {
        feedbackPointIndexes: [2],
        selectedAction: "storyboard_and_clip",
        shotNumber: 3,
      },
    ]);
    expect(JSON.stringify(evidence)).not.toContain("Rama's bow");
    expect(evidence.feedbackPointsSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(evidence.actionGroundingSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("records clarification points with no spend or action evidence", () => {
    const preparation = prepareMvpRepairDirector({
      clarificationTranscript: [],
      continuityEdges: [],
      immutableOwnerFeedback:
        "At 00:03.500, make the motion faster.\nMake that other bit better.",
      shots: [shot(1), shot(2), shot(3)],
      sourceEddHash: "d".repeat(64),
      totalShots: 3,
    });
    const compiled = compileMvpRepairDirectorOutput(preparation, {
      actions: [],
      clarification: {
        ambiguousFeedbackPoints: ["The affected shot and asset type are unclear."],
        question: "Which timestamp and asset type should Monica change?",
      },
      decision: "clarification_required",
      overallInterpretation: "The request cannot be mapped without guessing.",
    });
    const evidence = compileMvpRepairGroundingEvidence(preparation, compiled);

    expect(evidence.feedbackPoints).toMatchObject([
      { resolution: "deterministic", resolvedShotNumbers: [2] },
      {
        evidenceWindows: [],
        resolution: "clarification",
        resolvedShotNumbers: [],
      },
    ]);
    expect(evidence.actionGrounding).toEqual([]);
    expect(evidence.actionGroundingSha256).toBe(
      "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    );
  });

  it("keeps independent points in a many-to-one provider action", () => {
    const preparation = prepareMvpRepairDirector({
      clarificationTranscript: [],
      continuityEdges: [],
      immutableOwnerFeedback:
        "At 00:03.500, the motion is too slow.\nAt 00:04.500, the bow movement is incorrect.",
      shots: [shot(1), shot(2), shot(3)],
      sourceEddHash: "e".repeat(64),
      totalShots: 3,
    });
    const compiled = compileMvpRepairDirectorOutput(preparation, {
      actions: [
        action(1, "reuse_all"),
        action(2, "regenerate_clip", [1, 2]),
        action(3, "reuse_all"),
      ],
      clarification: null,
      decision: "repair",
      overallInterpretation: "Both points map independently to one clip regeneration.",
    });
    const evidence = compileMvpRepairGroundingEvidence(preparation, compiled);

    expect(evidence.feedbackPoints).toHaveLength(2);
    expect(
      evidence.feedbackPoints.map(({ feedbackPointIndex }) => feedbackPointIndex),
    ).toEqual([1, 2]);
    expect(evidence.actionGrounding).toMatchObject([
      { feedbackPointIndexes: [1, 2], selectedAction: "clip_only", shotNumber: 2 },
    ]);
  });

  it("records an explicit audit-only legacy storyboard migration without false feedback lineage", () => {
    const legacyShot = {
      ...shot(1),
      storyboardCompositionMode: "split_screen_two_state" as const,
    };
    const preparation = prepareMvpRepairDirector({
      clarificationTranscript: [],
      continuityEdges: [],
      immutableOwnerFeedback: "At 00:04.000, make the motion in shot 2 faster.",
      shots: [legacyShot, shot(2), shot(3)],
      sourceEddHash: "f".repeat(64),
      totalShots: 3,
    });
    const legacyMigration = {
      ...action(1, "regenerate_storyboard_and_clip", [], [1]),
      revisedFields: {
        ...revised(1),
        storyboardCompositionMode: "single_frame" as const,
        storyboardEndPromptBlueprint: null,
      },
    };
    const compiled = compileMvpRepairDirectorOutput(preparation, {
      actions: [
        legacyMigration,
        action(2, "regenerate_clip", [1], [2]),
        action(3, "reuse_all"),
      ],
      clarification: null,
      decision: "repair",
      overallInterpretation:
        "Migrate the audit-only legacy board and repair the requested motion.",
    });
    const evidence = compileMvpRepairGroundingEvidence(preparation, compiled);

    expect(evidence.actionGrounding).toMatchObject([
      {
        feedbackPointIndexes: [],
        selectedAction: "legacy_storyboard_migration",
        shotNumber: 1,
      },
      { feedbackPointIndexes: [1], selectedAction: "clip_only", shotNumber: 2 },
    ]);
  });

  it("hashes the exact safe bundle independently of object insertion order", () => {
    const bundle = {
      actionGroundingSha256: "1".repeat(64),
      clarificationMessageId: null,
      clarificationTranscriptSha256: "2".repeat(64),
      feedbackPointsSha256: "3".repeat(64),
      feedbackSha256: "4".repeat(64),
      inputManifestSha256: "5".repeat(64),
      modelResultSha256: "6".repeat(64),
      modelVersion: "gpt-5.4-2026-03-05",
      outcome: "repair" as const,
      promptSha256: "7".repeat(64),
      repairPlanVersionId: "51000000-0000-4000-8000-000000000001",
      repairRequestId: "51000000-0000-4000-8000-000000000002",
      sourceEddContentSha256: "8".repeat(64),
      sourceSummarySha256: "9".repeat(64),
    };
    expect(mvpRepairEvidenceBundleSha256(bundle)).toBe(
      mvpRepairEvidenceBundleSha256({ ...bundle }),
    );
  });
});

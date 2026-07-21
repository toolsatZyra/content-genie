import "server-only";

import { createHash } from "node:crypto";

import type {
  CompiledMvpRepairDirectorOutput,
  MvpRepairEvidenceWindow,
  PreparedMvpRepairDirector,
} from "@/server/mvp-repair-director";
import type { MvpRepairAction } from "@/server/mvp-repair-plan";
import { postgresJsonbText } from "@/server/world-anchor-provider";

export type MvpRepairFeedbackResolution = "clarification" | "deterministic" | "model";

export type MvpRepairSelectedAction = "clip_only" | "re_edit" | "storyboard_and_clip";

export type MvpRepairFeedbackPointEvidence = Readonly<{
  evidenceWindows: readonly MvpRepairEvidenceWindow[];
  feedbackPointIndex: number;
  feedbackPointSha256: string;
  pointEvidenceSha256: string;
  resolution: MvpRepairFeedbackResolution;
  resolvedShotNumbers: readonly number[];
}>;

export type MvpRepairActionGroundingEvidence = Readonly<{
  actionEvidenceSha256: string;
  feedbackPointIndexes: readonly number[];
  selectedAction: MvpRepairSelectedAction;
  shotNumber: number;
}>;

export type MvpRepairGroundingEvidence = Readonly<{
  actionGrounding: readonly MvpRepairActionGroundingEvidence[];
  actionGroundingSha256: string;
  feedbackPoints: readonly MvpRepairFeedbackPointEvidence[];
  feedbackPointsSha256: string;
}>;

export type MvpRepairEvidenceBundleInput = Readonly<{
  actionGroundingSha256: string;
  clarificationMessageId: string | null;
  clarificationTranscriptSha256: string;
  feedbackPointsSha256: string;
  feedbackSha256: string;
  inputManifestSha256: string;
  modelResultSha256: string;
  modelVersion: string;
  outcome: "clarification" | "repair";
  promptSha256: string;
  repairPlanVersionId: string | null;
  repairRequestId: string;
  sourceEddContentSha256: string;
  sourceSummarySha256: string;
}>;

export class MvpRepairGroundingEvidenceError extends Error {
  override readonly name = "MvpRepairGroundingEvidenceError";
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function withHash<T extends Readonly<Record<string, unknown>>>(
  value: T,
  hashKey: "actionEvidenceSha256" | "pointEvidenceSha256",
): T & Readonly<Record<typeof hashKey, string>> {
  return Object.freeze({
    ...value,
    [hashKey]: sha256(postgresJsonbText(value)),
  }) as T & Readonly<Record<typeof hashKey, string>>;
}

function selectedAction(action: Exclude<MvpRepairAction, "reuse_all">) {
  if (action === "regenerate_storyboard_and_clip") return "storyboard_and_clip";
  if (action === "regenerate_clip") return "clip_only";
  return "re_edit";
}

function sortedUnique(values: readonly number[]): readonly number[] {
  return Object.freeze([...new Set(values)].sort((left, right) => left - right));
}

export function compileMvpRepairGroundingEvidence(
  preparation: PreparedMvpRepairDirector,
  compiled: CompiledMvpRepairDirectorOutput,
): MvpRepairGroundingEvidence {
  const feedbackPoints = Object.freeze(
    preparation.feedbackPoints.map((point) => {
      let resolution: MvpRepairFeedbackResolution;
      let resolvedShotNumbers: readonly number[];
      let evidenceWindows: readonly MvpRepairEvidenceWindow[];
      if (point.resolution === "deterministic") {
        resolution = "deterministic";
        resolvedShotNumbers = point.resolvedShotNumbers;
        evidenceWindows = point.evidenceWindows;
      } else if (compiled.decision === "clarification_required") {
        resolution = "clarification";
        resolvedShotNumbers = Object.freeze([]);
        evidenceWindows = Object.freeze([]);
      } else {
        const grounded = compiled.groundedActions.find(({ feedbackPointIndexes }) =>
          feedbackPointIndexes.includes(point.feedbackPointIndex),
        );
        if (!grounded) {
          throw new MvpRepairGroundingEvidenceError(
            `Feedback point ${point.feedbackPointIndex} has no model grounding.`,
          );
        }
        resolution = "model";
        resolvedShotNumbers = grounded.resolvedShotNumbers;
        evidenceWindows = grounded.evidenceWindows;
      }
      const evidence = Object.freeze({
        evidenceWindows,
        feedbackPointIndex: point.feedbackPointIndex,
        feedbackPointSha256: sha256(point.exactText),
        resolution,
        resolvedShotNumbers,
      });
      return withHash(evidence, "pointEvidenceSha256");
    }),
  );

  const actionGrounding =
    compiled.decision === "clarification_required"
      ? Object.freeze([])
      : Object.freeze(
          compiled.plan.actions
            .filter(
              (
                action,
              ): action is typeof action & {
                action: Exclude<MvpRepairAction, "reuse_all">;
              } => action.action !== "reuse_all",
            )
            .map((action) => {
              const direct = compiled.groundedActions.find(
                ({ shotNumber }) => shotNumber === action.shotNumber,
              );
              const dependencyIndexes = action.dependencySourceShotNumbers.flatMap(
                (sourceShotNumber) =>
                  compiled.groundedActions.find(
                    ({ shotNumber }) => shotNumber === sourceShotNumber,
                  )?.feedbackPointIndexes ?? [],
              );
              const feedbackPointIndexes = sortedUnique([
                ...(direct?.feedbackPointIndexes ?? []),
                ...dependencyIndexes,
              ]);
              if (feedbackPointIndexes.length < 1) {
                throw new MvpRepairGroundingEvidenceError(
                  `Repair action ${action.shotNumber} has no feedback-point lineage.`,
                );
              }
              return withHash(
                Object.freeze({
                  feedbackPointIndexes,
                  selectedAction: selectedAction(action.action),
                  shotNumber: action.shotNumber,
                }),
                "actionEvidenceSha256",
              );
            }),
        );

  return Object.freeze({
    actionGrounding,
    actionGroundingSha256: sha256(postgresJsonbText(actionGrounding)),
    feedbackPoints,
    feedbackPointsSha256: sha256(postgresJsonbText(feedbackPoints)),
  });
}

export function mvpRepairEvidenceBundleSha256(
  input: MvpRepairEvidenceBundleInput,
): string {
  return sha256(postgresJsonbText(input));
}

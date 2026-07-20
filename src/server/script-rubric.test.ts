import { describe, expect, it } from "vitest";

import {
  evaluateScriptRubric,
  SCRIPT_PARAMETER_IDS,
  SCRIPT_RUBRIC_SOURCE_SHA256,
  ScriptRubricError,
  type ScriptParameterId,
  type ScriptRubricContext,
  type ScriptRubricEvaluation,
  type ScriptRubricInput,
} from "./script-rubric";

const scriptSha256 = "a".repeat(64);
const fullContext: ScriptRubricContext = {
  continuationExpected: true,
  episodePosition: "other",
  hasRevealOrDecisiveTurn: true,
  market: "hi-IN",
  mode: "script_only",
  platformModel: "other",
  priorEpisodesAvailable: true,
  seriesContext: "pinned",
};

function expectedApplicability(id: ScriptParameterId, context: ScriptRubricContext) {
  if (id === "twist_reveal" && !context.hasRevealOrDecisiveTurn) {
    return "no_reveal_or_decisive_turn";
  }
  if (id === "cliffhanger_pull" && !context.continuationExpected) {
    return "continuation_not_expected";
  }
  if (id === "series_continuity" && context.seriesContext === "standalone") {
    return "standalone_no_series_context";
  }
  return null;
}

function evaluation(
  ordinal: number,
  scores: Partial<Record<ScriptParameterId, number>> = {},
  context: ScriptRubricContext = fullContext,
): ScriptRubricEvaluation {
  return {
    evaluatorConfigurationId: `script-rubric-config-${ordinal}`,
    evaluatorRunId: `10000000-0000-4000-8000-00000000000${ordinal}`,
    modelFamily: `independent-family-${ordinal}`,
    parameterResults: SCRIPT_PARAMETER_IDS.map((parameterId) => {
      const reason = expectedApplicability(parameterId, context);
      if (reason) {
        return {
          applicability: "not_applicable" as const,
          evidence: [],
          notApplicableReason: reason,
          parameterId,
        };
      }
      const score = scores[parameterId] ?? 8;
      return {
        applicability: "applicable" as const,
        evidence: Array.from({ length: score <= 4 ? 2 : 1 }, (_, index) => ({
          rationale: `Observable script evidence ${index + 1}.`,
          scriptEndUtf16: index + 1,
          scriptStartUtf16: index,
        })),
        parameterId,
        score,
      };
    }),
    promptSha256: String(ordinal).repeat(64),
    promptVersion: `script-rubric-prompt-v${ordinal}`,
    rejectedParameterCallCount: 0,
    scriptSha256,
  };
}

function input(
  evaluations: readonly ScriptRubricEvaluation[],
  context: ScriptRubricContext = fullContext,
): ScriptRubricInput {
  return {
    context,
    evaluations,
    scriptSha256,
    scriptSha256AfterEvaluation: scriptSha256,
    scriptUtf16Length: 100,
    severeSafetyCompliance: false,
  };
}

describe("script rubric", () => {
  it("binds the pinned source and passes the exact golden all-eight math", () => {
    const result = evaluateScriptRubric(input([evaluation(1)]));

    expect(SCRIPT_RUBRIC_SOURCE_SHA256).toBe(
      "714fef20f2151ee63bce3307267f531485f3f3c29215bb8a5fa552ee9dd165b4",
    );
    expect(result.composites).toMatchObject({
      commercialPull: "80",
      craftQuality: "80",
      overall: "70",
      risk: "20",
    });
    expect(result.advisoryOnly).toBe(true);
    expect(result.effect).toBe("advisory");
  });

  it("passes the exact golden all-ten math", () => {
    const scores = Object.fromEntries(
      SCRIPT_PARAMETER_IDS.map((id) => [id, 10]),
    ) as Record<ScriptParameterId, number>;
    const result = evaluateScriptRubric(input([evaluation(1, scores)]));

    expect(result.composites).toMatchObject({
      commercialPull: "100",
      craftQuality: "100",
      overall: "90",
      risk: "0",
    });
    expect(result.verdict.internalLabel).toBe("greenlight");
  });

  it("keeps a rewrite suggestion advisory and leaves the source hash unchanged", () => {
    const context = { ...fullContext, episodePosition: "first" as const };
    const scores = { opening_hook: 3 };
    const result = evaluateScriptRubric(
      input([evaluation(1, scores, context), evaluation(2, scores, context)], context),
    );

    expect(result.gates).toContainEqual({
      effect: "advisory",
      gateId: "first_episode_hook",
      sourceEffect: "cap-verdict",
    });
    expect(result.verdict.internalLabel).toBe("rewrite_heavily");
    expect(result.requiresCompensatingPlan).toBe(true);
    expect(result.scriptSha256).toBe(scriptSha256);
    expect(result.effect).toBe("advisory");
  });

  it("projects deterministic not-applicable parameters for a standalone story", () => {
    const context: ScriptRubricContext = {
      ...fullContext,
      continuationExpected: false,
      hasRevealOrDecisiveTurn: false,
      seriesContext: "standalone",
    };
    const result = evaluateScriptRubric(input([evaluation(1, {}, context)], context));

    expect(
      result.parameterResults
        .filter(({ applicability }) => applicability === "not_applicable")
        .map(({ parameterId }) => parameterId),
    ).toEqual(["twist_reveal", "cliffhanger_pull", "series_continuity"]);
    expect(result.composites.commercialPull).toBe("80");
    expect(result.composites.craftQuality).toBe("80");
    expect(result.composites.commercialPullProjectedDenominator).toBe("0.8");
  });

  it("requires independent challenge and rejects mutation or evaluator applicability", () => {
    const context = { ...fullContext, episodePosition: "first" as const };
    expect(() =>
      evaluateScriptRubric(
        input([evaluation(1, { opening_hook: 3 }, context)], context),
      ),
    ).toThrow("independent script-rubric challenge");

    expect(() =>
      evaluateScriptRubric({
        ...input([evaluation(1)]),
        scriptSha256AfterEvaluation: "b".repeat(64),
      }),
    ).toThrow("GQC-SCRIPT-005");

    const standalone = { ...fullContext, seriesContext: "standalone" as const };
    const spoofed = evaluation(1, {}, standalone);
    const parameterResults = spoofed.parameterResults.map((result) =>
      result.parameterId === "series_continuity"
        ? {
            applicability: "applicable" as const,
            evidence: [
              {
                rationale: "Invented continuity context.",
                scriptEndUtf16: 1,
                scriptStartUtf16: 0,
              },
            ],
            parameterId: result.parameterId,
            score: 8,
          }
        : result,
    );
    expect(() =>
      evaluateScriptRubric(input([{ ...spoofed, parameterResults }], standalone)),
    ).toThrow(ScriptRubricError);
  });
});

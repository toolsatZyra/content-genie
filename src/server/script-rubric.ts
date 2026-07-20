import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const expectedSourceSha256 =
  "714fef20f2151ee63bce3307267f531485f3f3c29215bb8a5fa552ee9dd165b4";
const sha256Pattern = /^[a-f0-9]{64}$/u;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export const SCRIPT_RUBRIC_PROFILE = "genie.narration-hi.launch.v1";
export const SCRIPT_RUBRIC_SCHEMA_VERSION = "genie.script-rubric-run.v1";
export const SCRIPT_RUBRIC_SOURCE_SHA256 = expectedSourceSha256;

export const SCRIPT_PARAMETER_IDS = [
  "opening_hook",
  "protagonist_clarity",
  "conflict_stakes",
  "structure_pacing",
  "twist_reveal",
  "cliffhanger_pull",
  "dialogue_economy",
  "relationship_legibility",
  "series_continuity",
  "genre_freshness",
  "localization_fit",
  "monetization_compliance",
] as const;

export type ScriptParameterId = (typeof SCRIPT_PARAMETER_IDS)[number];

export type ScriptRubricContext = Readonly<{
  continuationExpected: boolean;
  episodePosition: "first" | "pre-paywall" | "midpoint" | "finale" | "other" | null;
  hasRevealOrDecisiveTurn: boolean;
  market: string | null;
  mode: "script_only";
  platformModel: "ad-supported" | "premium-unlock" | "other" | null;
  priorEpisodesAvailable: boolean | null;
  seriesContext: "pinned" | "standalone";
}>;

export type ScriptRubricEvidence = Readonly<{
  rationale: string;
  scriptEndUtf16: number;
  scriptStartUtf16: number;
}>;

export type ScriptParameterEvaluation = Readonly<{
  applicability: "applicable" | "not_applicable";
  evidence: readonly ScriptRubricEvidence[];
  notApplicableReason?: string;
  parameterId: ScriptParameterId;
  score?: number;
}>;

export type ScriptRubricEvaluation = Readonly<{
  evaluatorConfigurationId: string;
  evaluatorRunId: string;
  modelFamily: string;
  parameterResults: readonly ScriptParameterEvaluation[];
  promptSha256: string;
  promptVersion: string;
  rejectedParameterCallCount: number;
  scriptSha256: string;
}>;

export type ScriptRubricInput = Readonly<{
  context: ScriptRubricContext;
  evaluations: readonly ScriptRubricEvaluation[];
  scriptSha256: string;
  scriptSha256AfterEvaluation: string;
  scriptUtf16Length: number;
  severeSafetyCompliance: boolean;
}>;

type Rational = Readonly<{ denominator: bigint; numerator: bigint }>;

type SourceConfig = Readonly<{
  composites: readonly Readonly<Record<string, unknown>>[];
  confidence: Readonly<Record<string, unknown>>;
  contextAdjustments: readonly Readonly<Record<string, unknown>>[];
  gates: readonly Readonly<Record<string, unknown>>[];
  parameters: readonly Readonly<Record<string, unknown>>[];
  priority: Readonly<Record<string, unknown>>;
  rubricId: string;
  verdict: Readonly<Record<string, unknown>>;
  version: string;
  weightShift: Readonly<Record<string, unknown>>;
}>;

export class ScriptRubricError extends Error {
  override readonly name = "ScriptRubricError";
}

function gcd(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) [a, b] = [b, a % b];
  return a || 1n;
}

function rational(
  numerator: bigint | number,
  denominator: bigint | number = 1,
): Rational {
  let n = BigInt(numerator);
  let d = BigInt(denominator);
  if (d === 0n) throw new ScriptRubricError("Rubric arithmetic divided by zero.");
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const divisor = gcd(n, d);
  return { denominator: d / divisor, numerator: n / divisor };
}

function add(left: Rational, right: Rational): Rational {
  return rational(
    left.numerator * right.denominator + right.numerator * left.denominator,
    left.denominator * right.denominator,
  );
}

function multiply(left: Rational, right: Rational): Rational {
  return rational(
    left.numerator * right.numerator,
    left.denominator * right.denominator,
  );
}

function divide(left: Rational, right: Rational): Rational {
  return rational(
    left.numerator * right.denominator,
    left.denominator * right.numerator,
  );
}

function clamp(value: Rational, minimum: number, maximum: number): Rational {
  if (value.numerator < BigInt(minimum) * value.denominator) return rational(minimum);
  if (value.numerator > BigInt(maximum) * value.denominator) return rational(maximum);
  return value;
}

function decimal(value: Rational, places = 6): string {
  const negative = value.numerator < 0n;
  const absolute = negative ? -value.numerator : value.numerator;
  const scale = 10n ** BigInt(places);
  let scaled = (absolute * scale) / value.denominator;
  const remainder = (absolute * scale) % value.denominator;
  if (remainder * 2n >= value.denominator) scaled += 1n;
  const integer = scaled / scale;
  const fraction = (scaled % scale)
    .toString()
    .padStart(places, "0")
    .replace(/0+$/u, "");
  return `${negative ? "-" : ""}${integer}${fraction ? `.${fraction}` : ""}`;
}

function display(value: Rational): string {
  return Number(decimal(value, 6)).toFixed(1);
}

function number(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ScriptRubricError(`${label} is invalid.`);
  }
  return value;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ScriptRubricError(`${label} is invalid.`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new ScriptRubricError(`${label} is invalid.`);
  return value;
}

function fractionFromDecimal(value: unknown, label: string): Rational {
  const numeric = number(value, label);
  const text = numeric.toString();
  if (!text.includes(".")) return rational(numeric);
  const [whole, fraction = ""] = text.split(".");
  return rational(BigInt(`${whole}${fraction}`), 10n ** BigInt(fraction.length));
}

function loadPinnedConfig(): SourceConfig {
  const path = join(process.cwd(), "reference", "rubric-config", "script.v1.json");
  const source = readFileSync(path);
  const digest = createHash("sha256").update(source).digest("hex");
  if (digest !== expectedSourceSha256) {
    throw new ScriptRubricError("GQC-CONFIG-001: script rubric source hash mismatch.");
  }
  const parsed = object(JSON.parse(source.toString("utf8")), "Script rubric config");
  if (parsed.rubricId !== "script" || parsed.version !== "1.0.0") {
    throw new ScriptRubricError("GQC-CONFIG-001: script rubric identity mismatch.");
  }
  const parameterIds = array(parsed.parameters, "Script rubric parameters").map(
    (entry) => object(entry, "Script rubric parameter").id,
  );
  if (parameterIds.join(",") !== SCRIPT_PARAMETER_IDS.join(",")) {
    throw new ScriptRubricError(
      "GQC-CONFIG-001: script rubric parameter set mismatch.",
    );
  }
  return parsed as SourceConfig;
}

const config = loadPinnedConfig();

function conditionMatches(
  conditionValue: unknown,
  context: ScriptRubricContext,
  severeSafetyCompliance: boolean,
): boolean {
  const condition = object(conditionValue, "Rubric condition");
  if (typeof condition.flag === "string") {
    return condition.flag === "severe_safety_compliance" && severeSafetyCompliance;
  }
  if (typeof condition.field !== "string") return Object.keys(condition).length === 0;
  const value = context[condition.field as keyof ScriptRubricContext];
  if (condition.present === true) return value !== null && value !== undefined;
  if (condition.absent === true) return value === null || value === undefined;
  if ("equals" in condition) return value === condition.equals;
  if (Array.isArray(condition.in)) return condition.in.includes(value);
  return false;
}

function expectedApplicability(
  parameterId: ScriptParameterId,
  context: ScriptRubricContext,
): { applicability: "applicable" | "not_applicable"; reason?: string } {
  if (parameterId === "twist_reveal" && !context.hasRevealOrDecisiveTurn) {
    return { applicability: "not_applicable", reason: "no_reveal_or_decisive_turn" };
  }
  if (parameterId === "cliffhanger_pull" && !context.continuationExpected) {
    return { applicability: "not_applicable", reason: "continuation_not_expected" };
  }
  if (parameterId === "series_continuity" && context.seriesContext === "standalone") {
    return { applicability: "not_applicable", reason: "standalone_no_series_context" };
  }
  return { applicability: "applicable" };
}

function validateEvaluation(
  evaluation: ScriptRubricEvaluation,
  input: ScriptRubricInput,
): ReadonlyMap<ScriptParameterId, ScriptParameterEvaluation> {
  if (
    !uuidPattern.test(evaluation.evaluatorRunId) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/u.test(evaluation.evaluatorConfigurationId) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/u.test(evaluation.modelFamily) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/u.test(evaluation.promptVersion) ||
    !sha256Pattern.test(evaluation.promptSha256) ||
    evaluation.scriptSha256 !== input.scriptSha256 ||
    !Number.isSafeInteger(evaluation.rejectedParameterCallCount) ||
    evaluation.rejectedParameterCallCount < 0 ||
    evaluation.rejectedParameterCallCount > 64
  ) {
    throw new ScriptRubricError("Script evaluator envelope is invalid or stale.");
  }
  if (evaluation.parameterResults.length !== SCRIPT_PARAMETER_IDS.length) {
    throw new ScriptRubricError("Every script parameter requires an explicit result.");
  }
  const results = new Map<ScriptParameterId, ScriptParameterEvaluation>();
  for (const result of evaluation.parameterResults) {
    if (
      !SCRIPT_PARAMETER_IDS.includes(result.parameterId) ||
      results.has(result.parameterId)
    ) {
      throw new ScriptRubricError(
        "Script parameter results are unknown or duplicated.",
      );
    }
    const expected = expectedApplicability(result.parameterId, input.context);
    if (result.applicability !== expected.applicability) {
      throw new ScriptRubricError(
        "Evaluator-proposed applicability is not authoritative.",
      );
    }
    if (result.applicability === "not_applicable") {
      if (
        result.score !== undefined ||
        result.evidence.length !== 0 ||
        result.notApplicableReason !== expected.reason
      ) {
        throw new ScriptRubricError("Not-applicable script result is not exact.");
      }
    } else {
      if (
        result.notApplicableReason !== undefined ||
        !Number.isSafeInteger(result.score) ||
        (result.score ?? 0) < 1 ||
        (result.score ?? 0) > 10 ||
        result.evidence.length < ((result.score ?? 0) <= 4 ? 2 : 1) ||
        result.evidence.length > 8
      ) {
        throw new ScriptRubricError(
          "Applicable script result lacks a valid score or evidence.",
        );
      }
      for (const evidence of result.evidence) {
        if (
          !Number.isSafeInteger(evidence.scriptStartUtf16) ||
          !Number.isSafeInteger(evidence.scriptEndUtf16) ||
          evidence.scriptStartUtf16 < 0 ||
          evidence.scriptEndUtf16 <= evidence.scriptStartUtf16 ||
          evidence.scriptEndUtf16 > input.scriptUtf16Length ||
          evidence.rationale.trim().length < 4 ||
          evidence.rationale.length > 1_000
        ) {
          throw new ScriptRubricError("Script rubric evidence is invalid.");
        }
      }
    }
    results.set(result.parameterId, result);
  }
  return results;
}

function consensusScore(scores: readonly number[]): { score: number; spread: number } {
  const spread = Math.max(...scores) - Math.min(...scores);
  if (scores.length === 1) return { score: scores[0] ?? 0, spread };
  if (scores.length === 2) {
    if (spread >= 2) {
      throw new ScriptRubricError(
        "A third independent evaluator is required for score spread.",
      );
    }
    return { score: Math.min(...scores), spread };
  }
  const ordered = [...scores].sort((left, right) => left - right);
  return { score: ordered[1] ?? 0, spread };
}

function effectiveWeights(
  context: ScriptRubricContext,
): Map<ScriptParameterId, Rational> {
  const weights = new Map<ScriptParameterId, Rational>();
  for (const value of config.parameters) {
    weights.set(
      value.id as ScriptParameterId,
      rational(number(value.weight, "Parameter weight")),
    );
  }
  const shift = config.weightShift;
  const up = fractionFromDecimal(shift.relativeFactorUp, "Up weight shift");
  const down = fractionFromDecimal(shift.relativeFactorDown, "Down weight shift");
  for (const value of config.contextAdjustments) {
    if (!conditionMatches(value.when, context, false)) continue;
    for (const parameterId of array(value.up, "Up parameters")) {
      const id = parameterId as ScriptParameterId;
      weights.set(id, multiply(weights.get(id) ?? rational(0), up));
    }
    for (const parameterId of array(value.down, "Down parameters")) {
      const id = parameterId as ScriptParameterId;
      weights.set(id, multiply(weights.get(id) ?? rational(0), down));
    }
  }
  return weights;
}

function weightedComposite(
  ids: readonly ScriptParameterId[],
  scores: ReadonlyMap<ScriptParameterId, number | null>,
  weights: ReadonlyMap<ScriptParameterId, Rational>,
): { denominator: Rational; value: Rational } {
  let weighted = rational(0);
  let denominator = rational(0);
  for (const id of ids) {
    const score = scores.get(id);
    if (score === null || score === undefined) continue;
    const weight = weights.get(id) ?? rational(0);
    denominator = add(denominator, weight);
    weighted = add(weighted, multiply(weight, rational(score)));
  }
  return { denominator, value: multiply(divide(weighted, denominator), rational(10)) };
}

function linearComposite(
  termsValue: unknown,
  scores: ReadonlyMap<ScriptParameterId, number | null>,
  scaleFactor: unknown,
  intercept: unknown,
  allowProjection: boolean,
): { denominator: Rational; value: Rational } {
  let weighted = rational(0);
  let denominator = rational(0);
  for (const termValue of array(termsValue, "Composite terms")) {
    const term = object(termValue, "Composite term");
    const ref = object(term.ref, "Composite reference");
    const id = ref.id as ScriptParameterId;
    const score = scores.get(id);
    if (score === null || score === undefined) {
      if (!allowProjection)
        throw new ScriptRubricError("Required risk input is not applicable.");
      continue;
    }
    const coefficient = fractionFromDecimal(term.coefficient, "Composite coefficient");
    denominator = add(denominator, coefficient);
    weighted = add(weighted, multiply(coefficient, rational(score)));
  }
  const projected = allowProjection ? divide(weighted, denominator) : weighted;
  return {
    denominator,
    value: add(
      rational(number(intercept, "Composite intercept")),
      multiply(fractionFromDecimal(scaleFactor, "Composite scale"), projected),
    ),
  };
}

export function evaluateScriptRubric(input: ScriptRubricInput) {
  if (
    !sha256Pattern.test(input.scriptSha256) ||
    input.scriptSha256AfterEvaluation !== input.scriptSha256 ||
    !Number.isSafeInteger(input.scriptUtf16Length) ||
    input.scriptUtf16Length < 1 ||
    input.evaluations.length < 1 ||
    input.evaluations.length > 3
  ) {
    throw new ScriptRubricError("GQC-SCRIPT-005: immutable script binding is invalid.");
  }
  const identities = new Set(
    input.evaluations.map(
      ({ evaluatorConfigurationId, modelFamily }) =>
        `${modelFamily}:${evaluatorConfigurationId}`,
    ),
  );
  if (identities.size !== input.evaluations.length) {
    throw new ScriptRubricError("Independent evaluator identities are required.");
  }
  const validated = input.evaluations.map((evaluation) =>
    validateEvaluation(evaluation, input),
  );
  const scores = new Map<ScriptParameterId, number | null>();
  const spreads = new Map<ScriptParameterId, number>();
  for (const id of SCRIPT_PARAMETER_IDS) {
    if (expectedApplicability(id, input.context).applicability === "not_applicable") {
      scores.set(id, null);
      spreads.set(id, 0);
      continue;
    }
    const consensus = consensusScore(
      validated.map((results) => results.get(id)?.score ?? 0),
    );
    scores.set(id, consensus.score);
    spreads.set(id, consensus.spread);
  }

  let confidence = 100;
  if (input.context.episodePosition === null) confidence -= 15;
  if (input.context.market === null) confidence -= 15;
  if (input.context.platformModel === null) confidence -= 10;
  if (input.context.priorEpisodesAvailable === null) confidence -= 10;
  const rejected = input.evaluations.reduce(
    (total, evaluation) => total + evaluation.rejectedParameterCallCount,
    0,
  );
  confidence -= Math.min(20, rejected * 5);
  confidence -= Math.min(
    10,
    [...spreads.values()].filter((spread) => spread >= 3).length * 2,
  );
  confidence = Math.max(0, confidence);

  const gates = config.gates.flatMap((value) => {
    const applies = conditionMatches(value.appliesWhen, input.context, false);
    const condition = object(value.condition, "Gate condition");
    let triggered = false;
    if (typeof condition.flag === "string") {
      triggered = conditionMatches(
        condition,
        input.context,
        input.severeSafetyCompliance,
      );
    } else if (applies) {
      const score = scores.get(condition.paramId as ScriptParameterId);
      triggered =
        score !== null &&
        score !== undefined &&
        condition.op === "<" &&
        score < number(condition.value, "Gate threshold");
    }
    return triggered
      ? [
          Object.freeze({
            effect: "advisory" as const,
            gateId: String(value.id),
            sourceEffect: String(value.effect),
          }),
        ]
      : [];
  });
  if ((gates.length > 0 || confidence < 70) && input.evaluations.length < 2) {
    throw new ScriptRubricError(
      "An independent script-rubric challenge is required for this advisory result.",
    );
  }

  const weights = effectiveWeights(input.context);
  const byId = new Map(config.composites.map((value) => [String(value.id), value]));
  const cqConfig = byId.get("cq") ?? {};
  const cq = weightedComposite(
    array(cqConfig.paramIds, "CQ parameters") as readonly ScriptParameterId[],
    scores,
    weights,
  );
  const cpConfig = byId.get("cp") ?? {};
  const cp = linearComposite(cpConfig.terms, scores, cpConfig.scaleFactor, 0, true);
  const riskConfig = byId.get("risk") ?? {};
  let risk = linearComposite(
    riskConfig.terms,
    scores,
    riskConfig.scaleFactor,
    riskConfig.intercept,
    false,
  );
  if (input.severeSafetyCompliance)
    risk = { ...risk, value: add(risk.value, rational(15)) };
  risk = { ...risk, value: clamp(risk.value, 0, 100) };
  const overall = clamp(
    add(
      add(multiply(cq.value, rational(6, 10)), multiply(cp.value, rational(3, 10))),
      multiply(risk.value, rational(-1, 10)),
    ),
    0,
    100,
  );

  const verdictConfig = config.verdict;
  const ladder = array(verdictConfig.ladder, "Verdict ladder").map((value) =>
    object(value, "Verdict band"),
  );
  let verdictIndex = ladder.findIndex((value) => {
    const rule = object(value.rule, "Verdict rule");
    if (
      overall.numerator <
      BigInt(number(rule.overallGte, "Overall threshold")) * overall.denominator
    )
      return false;
    if (rule.requiresNoGates === true && gates.length > 0) return false;
    const compositeGte =
      rule.compositeGte === undefined
        ? {}
        : object(rule.compositeGte, "Composite thresholds");
    return Object.entries(compositeGte).every(([id, threshold]) => {
      const value = id === "cq" ? cq.value : cp.value;
      return (
        value.numerator >=
        BigInt(number(threshold, "Composite threshold")) * value.denominator
      );
    });
  });
  if (verdictIndex < 0) verdictIndex = ladder.length - 1;
  if (input.severeSafetyCompliance) {
    verdictIndex = ladder.findIndex((value) => value.internalLabel === "reject");
  } else if (gates.length > 0) {
    const cap = object(verdictConfig.gateCap, "Gate cap").capLabel;
    const capIndex = ladder.findIndex((value) => value.internalLabel === cap);
    verdictIndex = Math.max(verdictIndex, capIndex);
  }
  const verdict = ladder[verdictIndex] ?? ladder[ladder.length - 1] ?? {};

  const priority = config.priority;
  const priorityItems = SCRIPT_PARAMETER_IDS.flatMap((id) => {
    const score = scores.get(id);
    if (score === null || score === undefined) return [];
    let multiplier = fractionFromDecimal(
      priority.defaultMultiplier,
      "Priority multiplier",
    );
    for (const value of array(priority.contextMultipliers, "Priority context")) {
      const item = object(value, "Priority context item");
      if (item.paramId === id && conditionMatches(item.when, input.context, false)) {
        multiplier = multiply(
          multiplier,
          fractionFromDecimal(item.multiplier, "Priority context multiplier"),
        );
      }
    }
    const value = multiply(
      multiply(weights.get(id) ?? rational(0), rational(10 - score)),
      multiplier,
    );
    return [{ parameterId: id, priority: decimal(value) }];
  }).sort((left, right) => Number(right.priority) - Number(left.priority));

  const parameterResults = SCRIPT_PARAMETER_IDS.map((id) => {
    const expected = expectedApplicability(id, input.context);
    const score = scores.get(id) ?? null;
    return Object.freeze({
      applicability: expected.applicability,
      consensusScore: score,
      evidence: Object.freeze(
        validated.flatMap((results) => results.get(id)?.evidence ?? []),
      ),
      notApplicableReason: expected.reason ?? null,
      parameterId: id,
      spread: spreads.get(id) ?? 0,
    });
  });

  return Object.freeze({
    advisoryOnly: true as const,
    composites: Object.freeze({
      commercialPull: decimal(cp.value),
      commercialPullDisplay: display(cp.value),
      commercialPullProjectedDenominator: decimal(cp.denominator),
      craftQuality: decimal(cq.value),
      craftQualityDisplay: display(cq.value),
      craftQualityProjectedDenominator: decimal(cq.denominator),
      overall: decimal(overall),
      overallDisplay: display(overall),
      risk: decimal(risk.value),
      riskDisplay: display(risk.value),
    }),
    confidence,
    effect: "advisory" as const,
    evaluatorRuns: Object.freeze(
      input.evaluations.map((evaluation) =>
        Object.freeze({
          evaluatorConfigurationId: evaluation.evaluatorConfigurationId,
          evaluatorRunId: evaluation.evaluatorRunId,
          modelFamily: evaluation.modelFamily,
          promptSha256: evaluation.promptSha256,
          promptVersion: evaluation.promptVersion,
        }),
      ),
    ),
    gates: Object.freeze(gates),
    parameterResults: Object.freeze(parameterResults),
    priority: Object.freeze(priorityItems),
    profile: SCRIPT_RUBRIC_PROFILE,
    requiresCompensatingPlan: gates.length > 0 || verdictIndex >= 2,
    schemaVersion: SCRIPT_RUBRIC_SCHEMA_VERSION,
    scriptSha256: input.scriptSha256,
    sourceConfigSha256: SCRIPT_RUBRIC_SOURCE_SHA256,
    sourceConfigVersion: config.version,
    verdict: Object.freeze({
      displayLabel: String(verdict.displayLabel),
      internalLabel: String(verdict.internalLabel),
    }),
  });
}

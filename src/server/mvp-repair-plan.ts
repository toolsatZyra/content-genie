import "server-only";

import { createHash } from "node:crypto";

import { postgresJsonbText } from "@/server/world-anchor-provider";

const MAXIMUM_SHOTS = 80;
const MAXIMUM_REASON_LENGTH = 1_000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export const MVP_REPAIR_ACTIONS = Object.freeze([
  "reuse_all",
  "regenerate_storyboard_and_clip",
  "regenerate_clip",
  "reedit_only",
] as const);

export type MvpRepairAction = (typeof MVP_REPAIR_ACTIONS)[number];

export type ProposedMvpRepairAction = Readonly<{
  action: MvpRepairAction;
  dependencyReason: string | null;
  reason: string;
  shotNumber: number;
}>;

export type MvpRepairContinuityEdge = Readonly<{
  dependentShotNumber: number;
  sourceShotNumber: number;
}>;

export type MvpRepairPlanInput = Readonly<{
  actions: readonly ProposedMvpRepairAction[];
  continuityEdges: readonly MvpRepairContinuityEdge[];
  immutableFeedbackHash: string;
  sourceEddHash: string;
  totalShots: number;
}>;

export type NormalizedMvpRepairAction = Readonly<{
  action: MvpRepairAction;
  dependencyReason: string | null;
  dependencySourceShotNumbers: readonly number[];
  reason: string;
  shotNumber: number;
}>;

export type CompiledMvpRepairPlan = Readonly<{
  actions: readonly NormalizedMvpRepairAction[];
  continuityEdges: readonly MvpRepairContinuityEdge[];
  counts: Readonly<{
    affected: number;
    reeditedOnly: number;
    regeneratedClips: number;
    regeneratedStoryboards: number;
    regeneratedTotal: number;
    reused: number;
  }>;
  immutableFeedbackHash: string;
  planHash: string;
  schemaVersion: "genie.mvp-selective-repair-plan.v1";
  sourceEddHash: string;
  totalShots: number;
}>;

export class MvpRepairPlanError extends Error {
  override readonly name = "MvpRepairPlanError";
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeInteger(value: unknown, label: string, minimum: number, maximum: number) {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < minimum ||
    (value as number) > maximum
  ) {
    throw new MvpRepairPlanError(`${label} is invalid.`);
  }
  return value as number;
}

function exactHash(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new MvpRepairPlanError(`${label} is invalid.`);
  }
  return value;
}

function boundedReason(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.trim().length < 1 ||
    value.length > MAXIMUM_REASON_LENGTH ||
    value.includes("\0")
  ) {
    throw new MvpRepairPlanError(`${label} is invalid.`);
  }
  return value;
}

function optionalDependencyReason(value: unknown, label: string): string | null {
  if (value === null) return null;
  return boundedReason(value, label);
}

function exactAction(value: unknown): MvpRepairAction {
  if (
    typeof value !== "string" ||
    !(MVP_REPAIR_ACTIONS as readonly string[]).includes(value)
  ) {
    throw new MvpRepairPlanError("A proposed repair action is unknown.");
  }
  return value as MvpRepairAction;
}

function sortedEdges(
  edges: readonly MvpRepairContinuityEdge[],
  totalShots: number,
): readonly MvpRepairContinuityEdge[] {
  if (edges.length > totalShots * totalShots) {
    throw new MvpRepairPlanError("The continuity graph is outside policy.");
  }
  const unique = new Set<string>();
  const normalized = edges.map((edge) => {
    if (!edge || typeof edge !== "object" || Array.isArray(edge)) {
      throw new MvpRepairPlanError("A continuity edge is malformed.");
    }
    const sourceShotNumber = safeInteger(
      edge.sourceShotNumber,
      "The continuity source shot",
      1,
      totalShots,
    );
    const dependentShotNumber = safeInteger(
      edge.dependentShotNumber,
      "The continuity dependent shot",
      1,
      totalShots,
    );
    if (dependentShotNumber <= sourceShotNumber) {
      throw new MvpRepairPlanError(
        "Continuity dependencies must point to a later shot.",
      );
    }
    const key = `${sourceShotNumber}:${dependentShotNumber}`;
    if (unique.has(key)) {
      throw new MvpRepairPlanError("The continuity graph contains a duplicate edge.");
    }
    unique.add(key);
    return Object.freeze({ dependentShotNumber, sourceShotNumber });
  });
  normalized.sort(
    (left, right) =>
      left.sourceShotNumber - right.sourceShotNumber ||
      left.dependentShotNumber - right.dependentShotNumber,
  );
  return Object.freeze(normalized);
}

function continuityClosure(
  roots: readonly number[],
  edges: readonly MvpRepairContinuityEdge[],
): ReadonlyMap<number, readonly number[]> {
  const dependents = new Map<number, number[]>();
  for (const edge of edges) {
    const values = dependents.get(edge.sourceShotNumber) ?? [];
    values.push(edge.dependentShotNumber);
    dependents.set(edge.sourceShotNumber, values);
  }
  const closure = new Map<number, Set<number>>();
  const queue = [...roots].sort((left, right) => left - right);
  for (const root of queue) closure.set(root, new Set());
  for (let index = 0; index < queue.length; index += 1) {
    const source = queue[index]!;
    for (const dependent of dependents.get(source) ?? []) {
      const sources = closure.get(dependent) ?? new Set<number>();
      sources.add(source);
      closure.set(dependent, sources);
      if (!queue.includes(dependent)) queue.push(dependent);
    }
  }
  return new Map(
    [...closure.entries()].map(([shotNumber, sources]) => [
      shotNumber,
      Object.freeze([...sources].sort((left, right) => left - right)),
    ]),
  );
}

export function compileMvpRepairPlan(input: MvpRepairPlanInput): CompiledMvpRepairPlan {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new MvpRepairPlanError("The repair plan input is malformed.");
  }
  const totalShots = safeInteger(
    input.totalShots,
    "The total shot count",
    1,
    MAXIMUM_SHOTS,
  );
  const immutableFeedbackHash = exactHash(
    input.immutableFeedbackHash,
    "The immutable feedback hash",
  );
  const sourceEddHash = exactHash(input.sourceEddHash, "The source EDD hash");
  if (!Array.isArray(input.actions) || input.actions.length !== totalShots) {
    throw new MvpRepairPlanError("The repair plan must cover every shot exactly once.");
  }
  if (!Array.isArray(input.continuityEdges)) {
    throw new MvpRepairPlanError("The continuity graph is malformed.");
  }

  const byShot = new Map<number, ProposedMvpRepairAction>();
  for (const proposed of input.actions) {
    if (!proposed || typeof proposed !== "object" || Array.isArray(proposed)) {
      throw new MvpRepairPlanError("A proposed repair action is malformed.");
    }
    const shotNumber = safeInteger(
      proposed.shotNumber,
      "The proposed repair shot number",
      1,
      totalShots,
    );
    if (byShot.has(shotNumber)) {
      throw new MvpRepairPlanError("The repair plan contains a duplicate shot.");
    }
    byShot.set(
      shotNumber,
      Object.freeze({
        action: exactAction(proposed.action),
        dependencyReason: optionalDependencyReason(
          proposed.dependencyReason,
          `Shot ${shotNumber} dependency reason`,
        ),
        reason: boundedReason(proposed.reason, `Shot ${shotNumber} reason`),
        shotNumber,
      }),
    );
  }
  for (let shotNumber = 1; shotNumber <= totalShots; shotNumber += 1) {
    if (!byShot.has(shotNumber)) {
      throw new MvpRepairPlanError("The repair plan is missing a shot.");
    }
  }
  if ([...byShot.values()].every(({ action }) => action === "reuse_all")) {
    throw new MvpRepairPlanError("A repair plan must change at least one shot.");
  }

  const continuityEdges = sortedEdges(input.continuityEdges, totalShots);
  const directAffectedShots = new Set(
    [...byShot.values()]
      .filter(
        ({ action, dependencyReason }) =>
          action !== "reuse_all" && dependencyReason === null,
      )
      .map(({ shotNumber }) => shotNumber),
  );
  const directStoryboardRoots = [...byShot.values()]
    .filter(
      ({ action, dependencyReason }) =>
        action === "regenerate_storyboard_and_clip" && dependencyReason === null,
    )
    .map(({ shotNumber }) => shotNumber);
  const closure = continuityClosure(directStoryboardRoots, continuityEdges);

  for (const proposed of byShot.values()) {
    if (proposed.dependencyReason === null) continue;
    if (proposed.action === "reuse_all") {
      throw new MvpRepairPlanError(
        `Shot ${proposed.shotNumber} is dependency-marked but has no repair action.`,
      );
    }
    if (closure.has(proposed.shotNumber)) continue;
    const isExplicitEditNeighbor =
      proposed.action === "reedit_only" &&
      [...directAffectedShots].some(
        (shotNumber) => Math.abs(shotNumber - proposed.shotNumber) === 1,
      );
    if (!isExplicitEditNeighbor) {
      throw new MvpRepairPlanError(
        `Shot ${proposed.shotNumber} has an unjustified dependency marker.`,
      );
    }
  }

  const actions = Object.freeze(
    Array.from({ length: totalShots }, (_, index) => {
      const shotNumber = index + 1;
      const proposed = byShot.get(shotNumber)!;
      const dependencySourceShotNumbers = closure.get(shotNumber) ?? Object.freeze([]);
      const cascaded =
        dependencySourceShotNumbers.length > 0 ||
        (closure.has(shotNumber) && !directStoryboardRoots.includes(shotNumber));
      const action = cascaded ? "regenerate_storyboard_and_clip" : proposed.action;
      const dependencyReason = cascaded
        ? (proposed.dependencyReason ??
          `Continuity dependency on regenerated shot${dependencySourceShotNumbers.length === 1 ? "" : "s"} ${dependencySourceShotNumbers.join(", ")}.`)
        : proposed.dependencyReason;
      return Object.freeze({
        action,
        dependencyReason,
        dependencySourceShotNumbers,
        reason: proposed.reason,
        shotNumber,
      });
    }),
  );

  const regeneratedStoryboards = actions.filter(
    ({ action }) => action === "regenerate_storyboard_and_clip",
  ).length;
  const regeneratedClipOnly = actions.filter(
    ({ action }) => action === "regenerate_clip",
  ).length;
  const reeditedOnly = actions.filter(({ action }) => action === "reedit_only").length;
  const regeneratedClips = regeneratedStoryboards + regeneratedClipOnly;
  const affected = regeneratedClips + reeditedOnly;
  const counts = Object.freeze({
    affected,
    reeditedOnly,
    regeneratedClips,
    regeneratedStoryboards,
    regeneratedTotal: regeneratedClips,
    reused: totalShots - affected,
  });
  const manifest = Object.freeze({
    actions,
    continuityEdges,
    counts,
    immutableFeedbackHash,
    schemaVersion: "genie.mvp-selective-repair-plan.v1" as const,
    sourceEddHash,
    totalShots,
  });
  return Object.freeze({
    ...manifest,
    planHash: sha256(postgresJsonbText(manifest)),
  });
}

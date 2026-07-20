export type WorldSelectionState =
  "accepted" | "blocked" | "generating" | "review_required";

export interface CreationWorldCharacter {
  readonly aggregateVersion: number;
  readonly assetVersionId: string;
  readonly bucketId: string;
  readonly candidateVersionId: string;
  readonly entityId: string;
  readonly formId: string;
  readonly formKey: string;
  readonly name: string;
  readonly objectName: string;
  readonly promptSha256: string;
  readonly promptText: string;
  readonly selectedVersionId: string | null;
  readonly selectionId: string;
  readonly sheetState: "rejected" | "verified" | null;
  readonly state: WorldSelectionState;
}

export interface CreationWorldLocation {
  readonly aggregateVersion: number;
  readonly assetVersionId: string;
  readonly bucketId: string;
  readonly candidateVersionId: string;
  readonly entityId: string;
  readonly name: string;
  readonly namedTemple: boolean;
  readonly objectName: string;
  readonly promptSha256: string;
  readonly promptText: string;
  readonly selectedVersionId: string | null;
  readonly selectionId: string;
  readonly state: WorldSelectionState;
  readonly templeEvidenceSetHash: string | null;
  readonly worldObjectKind: "location" | "prop";
}

export type WorldBuildProgressState =
  | "extracting"
  | "identified"
  | "researching"
  | "prompted"
  | "dispatched"
  | "generating"
  | "secure_ingest"
  | "review_ready"
  | "failed";

export interface CreationWorldProgressItem {
  readonly createdAt: string;
  readonly displayName: string;
  readonly id: string;
  readonly itemKey: string;
  readonly itemKind: "character" | "location" | "prop" | "system";
  readonly promptText: string | null;
  readonly providerModel: string | null;
  readonly providerRequestId: string | null;
  readonly safeDetail: string;
  readonly sortOrder: number;
  readonly sourceCount: number;
  readonly state: WorldBuildProgressState;
  readonly updatedAt: string;
  readonly worldEntityId: string | null;
}

export interface CreationWorldProjection {
  readonly characters: readonly CreationWorldCharacter[];
  readonly locations: readonly CreationWorldLocation[];
  readonly progress: readonly CreationWorldProgressItem[];
  readonly referencePack: {
    readonly id: string;
    readonly manifestHash: string;
    readonly state: "rejected" | "stale" | "verified";
    readonly versionNumber: number;
  } | null;
}

export interface CreationSourceReviewProjection {
  readonly competencies: readonly {
    readonly competencyVersionId: string;
    readonly expiresAt: string;
    readonly scopeHash: string;
    readonly status: "active";
  }[];
  readonly contentClasses: readonly string[];
  readonly findings: readonly {
    readonly confidence: number;
    readonly nonOverridable: boolean;
    readonly ruleCode: string;
    readonly safeSummary: string;
    readonly verdict:
      | "advisory"
      | "pass"
      | "production_blocked"
      | "qualified_review_required"
      | "release_blocked"
      | "repair_required";
  }[];
  readonly interpretationLabels: readonly string[];
  readonly language: string;
  readonly machineVerdict: "blocked" | "eligible" | "qualified_review_required";
  readonly packetId: string;
  readonly packetVersion: number;
  readonly region: string;
  readonly sources: readonly {
    readonly boundedProposition: string;
    readonly claimClass: string;
    readonly contradictionState:
      "disclosed_nonmaterial" | "material_unresolved" | "none" | "resolved";
    readonly rightsStatus:
      | "factual_reference_only"
      | "internal_authorized"
      | "licensed"
      | "prohibited"
      | "public_domain"
      | "uncertain";
    readonly sourceClass: string;
    readonly sourceVersionId: string;
    readonly stableUrl: string | null;
    readonly title: string;
    readonly verificationState: "lead_only" | "verified" | "withdrawn";
  }[];
  readonly status:
    "approved" | "blocked" | "pending_qualified_review" | "stale" | "withdrawn";
  readonly statusVersion: number;
  readonly subjectHash: string;
  readonly tradition: string;
  readonly worldReferencePackVersionId: string;
}
export interface CreationPreflightProjection {
  readonly sourceReview: CreationSourceReviewProjection | null;
  readonly audioIdentity: {
    readonly id: string;
    readonly selectionHash: string;
    readonly state: "stale" | "verified";
    readonly voiceVersionId: string;
  } | null;
  readonly failure: {
    readonly attemptNo: number;
    readonly code: string;
    readonly failedAt: string;
    readonly stageKey: string;
  } | null;
  readonly masterClock: {
    readonly alignmentHash: string;
    readonly durationMs: number;
    readonly id: string;
    readonly state: "rejected" | "stale" | "verified";
  } | null;
  readonly plan: {
    readonly id: string;
    readonly planHash: string;
    readonly projectedConfidence: number;
    readonly projectedCvp: number;
    readonly projectedOvs: number;
    readonly projectedPfs: number;
    readonly state: "blocked" | "candidate" | "qc_passed" | "stale";
  } | null;
  readonly productionRun: {
    readonly authorizedHighMicrousd: number;
    readonly hardCeilingMicrousd: number;
    readonly id: string;
    readonly manifestHash: string;
    readonly runNumber: number;
    readonly state: string;
  } | null;
  readonly qc: {
    readonly confidence: number;
    readonly consensusHash: string;
    readonly cvp: number;
    readonly evidenceDensity: number;
    readonly gateCodes: readonly string[];
    readonly id: string;
    readonly lcr: number;
    readonly ovs: number;
    readonly pfs: number;
    readonly verdict: "block" | "indeterminate" | "pass";
  } | null;
  readonly quote: {
    readonly confirmed: boolean;
    readonly expectedTotalMicrousd: number;
    readonly expired: boolean;
    readonly expiresAt: string;
    readonly hardCeilingMicrousd: number;
    readonly highTotalMicrousd: number;
    readonly id: string;
    readonly lines: readonly {
      readonly expectedAmountMicrousd: number;
      readonly expectedQuantity: number;
      readonly highAmountMicrousd: number;
      readonly highQuantity: number;
      readonly lineKey: string;
      readonly lineKind: string;
      readonly lowAmountMicrousd: number;
      readonly lowQuantity: number;
    }[];
    readonly lowTotalMicrousd: number;
    readonly quoteHash: string;
    readonly target40UsdBreached: boolean;
  } | null;
}

export class CreationReadinessContractError extends Error {
  override readonly name = "CreationReadinessContractError";
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CreationReadinessContractError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exact(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, i) => key !== expected[i])
  ) {
    throw new CreationReadinessContractError(`${label} is not exact.`);
  }
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new CreationReadinessContractError(`${label} must be a non-empty string.`);
  }
  return value;
}

function nullableString(value: unknown, label: string): string | null {
  return value === null ? null : string(value, label);
}

function number(value: unknown, label: string): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed) || parsed < 0) {
    throw new CreationReadinessContractError(`${label} must be a finite number.`);
  }
  return parsed;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new CreationReadinessContractError(`${label} must be boolean.`);
  }
  return value;
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new CreationReadinessContractError(`${label} is unsupported.`);
  }
  return value as T;
}

const characterKeys = [
  "aggregateVersion",
  "assetVersionId",
  "bucketId",
  "candidateVersionId",
  "entityId",
  "formId",
  "formKey",
  "name",
  "objectName",
  "promptSha256",
  "promptText",
  "selectedVersionId",
  "selectionId",
  "sheetState",
  "state",
] as const;

function parseCharacter(value: unknown): CreationWorldCharacter {
  const row = object(value, "World character");
  exact(row, characterKeys, "World character");
  return {
    aggregateVersion: number(row.aggregateVersion, "character aggregateVersion"),
    assetVersionId: string(row.assetVersionId, "character assetVersionId"),
    bucketId: string(row.bucketId, "character bucketId"),
    candidateVersionId: string(row.candidateVersionId, "character candidateVersionId"),
    entityId: string(row.entityId, "character entityId"),
    formId: string(row.formId, "character formId"),
    formKey: string(row.formKey, "character formKey"),
    name: string(row.name, "character name"),
    objectName: string(row.objectName, "character objectName"),
    promptSha256: string(row.promptSha256, "character promptSha256"),
    promptText: string(row.promptText, "character promptText"),
    selectedVersionId: nullableString(
      row.selectedVersionId,
      "character selectedVersionId",
    ),
    selectionId: string(row.selectionId, "character selectionId"),
    sheetState:
      row.sheetState === null
        ? null
        : oneOf(
            row.sheetState,
            ["rejected", "verified"] as const,
            "character sheetState",
          ),
    state: oneOf(
      row.state,
      ["accepted", "blocked", "generating", "review_required"] as const,
      "character state",
    ),
  };
}

const locationKeys = [
  "aggregateVersion",
  "assetVersionId",
  "bucketId",
  "candidateVersionId",
  "entityId",
  "name",
  "namedTemple",
  "objectName",
  "promptSha256",
  "promptText",
  "selectedVersionId",
  "selectionId",
  "state",
  "templeEvidenceSetHash",
] as const;

function parseLocation(value: unknown): CreationWorldLocation {
  const row = object(value, "World location");
  exact(row, locationKeys, "World location");
  return {
    aggregateVersion: number(row.aggregateVersion, "location aggregateVersion"),
    assetVersionId: string(row.assetVersionId, "location assetVersionId"),
    bucketId: string(row.bucketId, "location bucketId"),
    candidateVersionId: string(row.candidateVersionId, "location candidateVersionId"),
    entityId: string(row.entityId, "location entityId"),
    name: string(row.name, "location name"),
    namedTemple: boolean(row.namedTemple, "location namedTemple"),
    objectName: string(row.objectName, "location objectName"),
    promptSha256: string(row.promptSha256, "location promptSha256"),
    promptText: string(row.promptText, "location promptText"),
    selectedVersionId: nullableString(
      row.selectedVersionId,
      "location selectedVersionId",
    ),
    selectionId: string(row.selectionId, "location selectionId"),
    state: oneOf(
      row.state,
      ["accepted", "blocked", "generating", "review_required"] as const,
      "location state",
    ),
    templeEvidenceSetHash: nullableString(
      row.templeEvidenceSetHash,
      "location templeEvidenceSetHash",
    ),
    worldObjectKind: "location",
  };
}

function nullableObject<T>(
  value: unknown,
  parser: (row: Record<string, unknown>) => T,
  label: string,
): T | null {
  return value === null ? null : parser(object(value, label));
}

function stringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new CreationReadinessContractError(`${label} must be an array of strings.`);
  }
  return value;
}

function parseSourceReview(
  row: Record<string, unknown>,
): CreationSourceReviewProjection {
  exact(
    row,
    [
      "competencies",
      "contentClasses",
      "findings",
      "interpretationLabels",
      "language",
      "machineVerdict",
      "packetId",
      "packetVersion",
      "region",
      "sources",
      "status",
      "statusVersion",
      "subjectHash",
      "tradition",
      "worldReferencePackVersionId",
    ],
    "source review",
  );
  if (
    !Array.isArray(row.competencies) ||
    !Array.isArray(row.findings) ||
    !Array.isArray(row.sources)
  ) {
    throw new CreationReadinessContractError(
      "Source review collections must be arrays.",
    );
  }
  return {
    competencies: row.competencies.map((value, index) => {
      const competency = object(value, `source competency ${index + 1}`);
      exact(
        competency,
        ["competencyVersionId", "expiresAt", "scopeHash", "status"],
        `source competency ${index + 1}`,
      );
      return {
        competencyVersionId: string(
          competency.competencyVersionId,
          "competency version",
        ),
        expiresAt: string(competency.expiresAt, "competency expiry"),
        scopeHash: string(competency.scopeHash, "competency scope hash"),
        status: oneOf(competency.status, ["active"] as const, "competency status"),
      };
    }),
    contentClasses: stringArray(row.contentClasses, "source content classes"),
    findings: row.findings.map((value, index) => {
      const finding = object(value, `source finding ${index + 1}`);
      exact(
        finding,
        ["confidence", "nonOverridable", "ruleCode", "safeSummary", "verdict"],
        `source finding ${index + 1}`,
      );
      return {
        confidence: number(finding.confidence, "source finding confidence"),
        nonOverridable: boolean(
          finding.nonOverridable,
          "source finding nonOverridable",
        ),
        ruleCode: string(finding.ruleCode, "source finding rule code"),
        safeSummary: string(finding.safeSummary, "source finding summary"),
        verdict: oneOf(
          finding.verdict,
          [
            "advisory",
            "pass",
            "production_blocked",
            "qualified_review_required",
            "release_blocked",
            "repair_required",
          ] as const,
          "source finding verdict",
        ),
      };
    }),
    interpretationLabels: stringArray(
      row.interpretationLabels,
      "source interpretation labels",
    ),
    language: string(row.language, "source language"),
    machineVerdict: oneOf(
      row.machineVerdict,
      ["blocked", "eligible", "qualified_review_required"] as const,
      "source machine verdict",
    ),
    packetId: string(row.packetId, "source packet id"),
    packetVersion: number(row.packetVersion, "source packet version"),
    region: string(row.region, "source region"),
    sources: row.sources.map((value, index) => {
      const source = object(value, `source evidence ${index + 1}`);
      exact(
        source,
        [
          "boundedProposition",
          "claimClass",
          "contradictionState",
          "rightsStatus",
          "sourceClass",
          "sourceVersionId",
          "stableUrl",
          "title",
          "verificationState",
        ],
        `source evidence ${index + 1}`,
      );
      return {
        boundedProposition: string(source.boundedProposition, "source proposition"),
        claimClass: string(source.claimClass, "source claim class"),
        contradictionState: oneOf(
          source.contradictionState,
          ["disclosed_nonmaterial", "material_unresolved", "none", "resolved"] as const,
          "source contradiction state",
        ),
        rightsStatus: oneOf(
          source.rightsStatus,
          [
            "factual_reference_only",
            "internal_authorized",
            "licensed",
            "prohibited",
            "public_domain",
            "uncertain",
          ] as const,
          "source rights status",
        ),
        sourceClass: string(source.sourceClass, "source class"),
        sourceVersionId: string(source.sourceVersionId, "source version"),
        stableUrl: nullableString(source.stableUrl, "source stable URL"),
        title: string(source.title, "source title"),
        verificationState: oneOf(
          source.verificationState,
          ["lead_only", "verified", "withdrawn"] as const,
          "source verification state",
        ),
      };
    }),
    status: oneOf(
      row.status,
      [
        "approved",
        "blocked",
        "pending_qualified_review",
        "stale",
        "withdrawn",
      ] as const,
      "source review status",
    ),
    statusVersion: number(row.statusVersion, "source status version"),
    subjectHash: string(row.subjectHash, "source subject hash"),
    tradition: string(row.tradition, "source tradition"),
    worldReferencePackVersionId: string(
      row.worldReferencePackVersionId,
      "source World reference pack",
    ),
  };
}

export function parseCreationReadinessProjection(value: unknown): Readonly<{
  preflight: CreationPreflightProjection;
  world: CreationWorldProjection;
}> {
  const root = object(value, "Creation readiness projection");
  exact(root, ["preflight", "world"], "Creation readiness projection");
  const world = object(root.world, "World projection");
  exact(world, ["characters", "locations", "referencePack"], "World projection");
  if (!Array.isArray(world.characters) || !Array.isArray(world.locations)) {
    throw new CreationReadinessContractError("World collections must be arrays.");
  }
  const referencePack = nullableObject(
    world.referencePack,
    (row) => {
      exact(row, ["id", "manifestHash", "state", "versionNumber"], "reference pack");
      return {
        id: string(row.id, "reference pack id"),
        manifestHash: string(row.manifestHash, "reference pack manifestHash"),
        state: oneOf(
          row.state,
          ["rejected", "stale", "verified"] as const,
          "reference pack state",
        ),
        versionNumber: number(row.versionNumber, "reference pack versionNumber"),
      };
    },
    "reference pack",
  );

  const preflight = object(root.preflight, "Preflight projection");
  exact(
    preflight,
    [
      "audioIdentity",
      "failure",
      "masterClock",
      "plan",
      "productionRun",
      "qc",
      "quote",
      "sourceReview",
    ],
    "Preflight projection",
  );
  return {
    world: {
      characters: world.characters.map(parseCharacter),
      locations: world.locations.map(parseLocation),
      progress: [],
      referencePack,
    },
    preflight: {
      sourceReview: nullableObject(
        preflight.sourceReview,
        parseSourceReview,
        "source review",
      ),
      audioIdentity: nullableObject(
        preflight.audioIdentity,
        (row) => {
          exact(
            row,
            ["id", "selectionHash", "state", "voiceVersionId"],
            "audio identity",
          );
          return {
            id: string(row.id, "audio identity id"),
            selectionHash: string(row.selectionHash, "audio identity selectionHash"),
            state: oneOf(
              row.state,
              ["stale", "verified"] as const,
              "audio identity state",
            ),
            voiceVersionId: string(row.voiceVersionId, "audio identity voiceVersionId"),
          };
        },
        "audio identity",
      ),
      failure: nullableObject(
        preflight.failure,
        (row) => {
          exact(
            row,
            ["attemptNo", "code", "failedAt", "stageKey"],
            "preflight failure",
          );
          return {
            attemptNo: number(row.attemptNo, "preflight failure attempt"),
            code: string(row.code, "preflight failure code"),
            failedAt: string(row.failedAt, "preflight failure timestamp"),
            stageKey: string(row.stageKey, "preflight failure stage"),
          };
        },
        "preflight failure",
      ),
      masterClock: nullableObject(
        preflight.masterClock,
        (row) => {
          exact(row, ["alignmentHash", "durationMs", "id", "state"], "master clock");
          return {
            alignmentHash: string(row.alignmentHash, "master clock alignmentHash"),
            durationMs: number(row.durationMs, "master clock durationMs"),
            id: string(row.id, "master clock id"),
            state: oneOf(
              row.state,
              ["rejected", "stale", "verified"] as const,
              "master clock state",
            ),
          };
        },
        "master clock",
      ),
      plan: nullableObject(
        preflight.plan,
        (row) => {
          exact(
            row,
            [
              "id",
              "planHash",
              "projectedConfidence",
              "projectedCvp",
              "projectedOvs",
              "projectedPfs",
              "state",
            ],
            "plan",
          );
          return {
            id: string(row.id, "plan id"),
            planHash: string(row.planHash, "plan hash"),
            projectedConfidence: number(row.projectedConfidence, "plan confidence"),
            projectedCvp: number(row.projectedCvp, "plan CVP"),
            projectedOvs: number(row.projectedOvs, "plan OVS"),
            projectedPfs: number(row.projectedPfs, "plan PFS"),
            state: oneOf(
              row.state,
              ["blocked", "candidate", "qc_passed", "stale"] as const,
              "plan state",
            ),
          };
        },
        "plan",
      ),
      qc: nullableObject(
        preflight.qc,
        (row) => {
          exact(
            row,
            [
              "confidence",
              "consensusHash",
              "cvp",
              "evidenceDensity",
              "gateCodes",
              "id",
              "lcr",
              "ovs",
              "pfs",
              "verdict",
            ],
            "QC summary",
          );
          if (
            !Array.isArray(row.gateCodes) ||
            row.gateCodes.some((code) => typeof code !== "string")
          ) {
            throw new CreationReadinessContractError("QC gateCodes must be strings.");
          }
          return {
            confidence: number(row.confidence, "QC confidence"),
            consensusHash: string(row.consensusHash, "QC consensusHash"),
            cvp: number(row.cvp, "QC CVP"),
            evidenceDensity: number(row.evidenceDensity, "QC evidenceDensity"),
            gateCodes: row.gateCodes as string[],
            id: string(row.id, "QC id"),
            lcr: number(row.lcr, "QC LCR"),
            ovs: number(row.ovs, "QC OVS"),
            pfs: number(row.pfs, "QC PFS"),
            verdict: oneOf(
              row.verdict,
              ["block", "indeterminate", "pass"] as const,
              "QC verdict",
            ),
          };
        },
        "QC summary",
      ),
      quote: nullableObject(
        preflight.quote,
        (row) => {
          exact(
            row,
            [
              "confirmed",
              "expectedTotalMicrousd",
              "expired",
              "expiresAt",
              "hardCeilingMicrousd",
              "highTotalMicrousd",
              "id",
              "lines",
              "lowTotalMicrousd",
              "quoteHash",
              "target40UsdBreached",
            ],
            "quote",
          );
          if (!Array.isArray(row.lines)) {
            throw new CreationReadinessContractError("quote lines must be an array.");
          }
          return {
            confirmed: boolean(row.confirmed, "quote confirmed"),
            expectedTotalMicrousd: number(row.expectedTotalMicrousd, "quote expected"),
            expired: boolean(row.expired, "quote expired"),
            expiresAt: string(row.expiresAt, "quote expiresAt"),
            hardCeilingMicrousd: number(row.hardCeilingMicrousd, "quote ceiling"),
            highTotalMicrousd: number(row.highTotalMicrousd, "quote high"),
            id: string(row.id, "quote id"),
            lines: row.lines.map((value, index) => {
              const line = object(value, `quote line ${index + 1}`);
              exact(
                line,
                [
                  "expectedAmountMicrousd",
                  "expectedQuantity",
                  "highAmountMicrousd",
                  "highQuantity",
                  "lineKey",
                  "lineKind",
                  "lowAmountMicrousd",
                  "lowQuantity",
                ],
                `quote line ${index + 1}`,
              );
              return {
                expectedAmountMicrousd: number(
                  line.expectedAmountMicrousd,
                  "quote line expected amount",
                ),
                expectedQuantity: number(
                  line.expectedQuantity,
                  "quote line expected quantity",
                ),
                highAmountMicrousd: number(
                  line.highAmountMicrousd,
                  "quote line high amount",
                ),
                highQuantity: number(line.highQuantity, "quote line high quantity"),
                lineKey: string(line.lineKey, "quote line key"),
                lineKind: string(line.lineKind, "quote line kind"),
                lowAmountMicrousd: number(
                  line.lowAmountMicrousd,
                  "quote line low amount",
                ),
                lowQuantity: number(line.lowQuantity, "quote line low quantity"),
              };
            }),
            lowTotalMicrousd: number(row.lowTotalMicrousd, "quote low"),
            quoteHash: string(row.quoteHash, "quote hash"),
            target40UsdBreached: boolean(
              row.target40UsdBreached,
              "quote target breach",
            ),
          };
        },
        "quote",
      ),
      productionRun: nullableObject(
        preflight.productionRun,
        (row) => {
          exact(
            row,
            [
              "authorizedHighMicrousd",
              "hardCeilingMicrousd",
              "id",
              "manifestHash",
              "runNumber",
              "state",
            ],
            "production run",
          );
          return {
            authorizedHighMicrousd: number(row.authorizedHighMicrousd, "run high"),
            hardCeilingMicrousd: number(row.hardCeilingMicrousd, "run ceiling"),
            id: string(row.id, "run id"),
            manifestHash: string(row.manifestHash, "run manifestHash"),
            runNumber: number(row.runNumber, "run number"),
            state: string(row.state, "run state"),
          };
        },
        "production run",
      ),
    },
  };
}

export const emptyCreationReadinessProjection: Readonly<{
  preflight: CreationPreflightProjection;
  world: CreationWorldProjection;
}> = {
  world: { characters: [], locations: [], progress: [], referencePack: null },
  preflight: {
    sourceReview: null,
    audioIdentity: null,
    failure: null,
    masterClock: null,
    plan: null,
    productionRun: null,
    qc: null,
    quote: null,
  },
};

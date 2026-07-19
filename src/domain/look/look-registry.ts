import lookPackSource from "./look-pack.v1.json";

export const LOOK_PACK_SCHEMA_VERSION = "genie-look-pack.v1";
export const DEFAULT_LOOK_ID = "glowing-divine-realism";
export const LOOK_NEGATIVE_POLICY_SCHEMA_VERSION = "genie-look-negative-policy.v1";
export const LOOK_VISUAL_QC_SCHEMA_VERSION = "genie-look-visual-qc-baseline.v1";

export interface LookPreview {
  readonly height: number;
  readonly path: string;
  readonly sha256: string;
  readonly width: number;
}

export interface LookProvenance {
  readonly creativeReview: string;
  readonly internalRightsBasis: string;
  readonly reviewedAt: string;
  readonly sourceCatalogSha256: string;
  readonly sourceCommit: string;
  readonly sourcePromptSha256: string;
  readonly sourceRecordSha256: string;
}

export interface LookNegativeRule {
  readonly category: string;
  readonly id: string;
  readonly instruction: string;
  readonly severity: "block";
}

export interface LookNegativePolicy {
  readonly promptTail: string;
  readonly rules: readonly LookNegativeRule[];
  readonly schemaVersion: typeof LOOK_NEGATIVE_POLICY_SCHEMA_VERSION;
  readonly sha256: string;
}

export interface LookVisualQcBaseline {
  readonly checks: readonly {
    readonly id: string;
    readonly passCondition: string;
    readonly severity: "block";
  }[];
  readonly negativePolicySha256: string;
  readonly schemaVersion: typeof LOOK_VISUAL_QC_SCHEMA_VERSION;
  readonly semantics: Readonly<{
    color: string;
    contrast: string;
    lens: string;
    lighting: string;
    texture: string;
  }>;
  readonly sha256: string;
  readonly sourceLookBlockSha256: string;
}

export interface LookDefinition {
  readonly family: string;
  readonly feel: string;
  readonly id: string;
  readonly lockedLookBlock: string;
  readonly lockedLookBlockSha256: string;
  readonly modes: readonly string[];
  readonly name: string;
  readonly negativePolicy: LookNegativePolicy;
  readonly preview: LookPreview;
  readonly provenance: LookProvenance;
  readonly versionId: string;
  readonly visualQcBaseline: LookVisualQcBaseline;
}

interface LookPack {
  readonly defaultLookId: string;
  readonly familyOrder: readonly string[];
  readonly looks: readonly LookDefinition[];
  readonly packId: string;
  readonly packVersion: number;
  readonly schemaVersion: string;
}

const lookPack = lookPackSource as LookPack;

function assertLookPack(value: LookPack): void {
  if (
    value.schemaVersion !== LOOK_PACK_SCHEMA_VERSION ||
    value.packVersion !== 1 ||
    value.looks.length !== 117 ||
    value.defaultLookId !== DEFAULT_LOOK_ID
  ) {
    throw new Error("The pinned Genie look pack is invalid.");
  }
  const ids = new Set(value.looks.map(({ id }) => id));
  if (ids.size !== value.looks.length || !ids.has(value.defaultLookId)) {
    throw new Error("The pinned Genie look pack contains invalid IDs.");
  }
  const sha256 = /^[a-f0-9]{64}$/;
  if (
    value.looks.some(
      (look) =>
        look.negativePolicy.schemaVersion !== LOOK_NEGATIVE_POLICY_SCHEMA_VERSION ||
        look.visualQcBaseline.schemaVersion !== LOOK_VISUAL_QC_SCHEMA_VERSION ||
        look.negativePolicy.rules.length !== 5 ||
        look.visualQcBaseline.checks.length !== 3 ||
        look.visualQcBaseline.sourceLookBlockSha256 !== look.lockedLookBlockSha256 ||
        look.visualQcBaseline.negativePolicySha256 !== look.negativePolicy.sha256 ||
        !sha256.test(look.negativePolicy.sha256) ||
        !sha256.test(look.visualQcBaseline.sha256),
    )
  ) {
    throw new Error("The pinned Genie look policy bindings are invalid.");
  }
}

assertLookPack(lookPack);

export const LOOK_FAMILIES = lookPack.familyOrder;
export const LOOKS = lookPack.looks;

const looksById = new Map(LOOKS.map((look) => [look.id, look] as const));
const looksByVersionId = new Map(LOOKS.map((look) => [look.versionId, look] as const));

export function findLook(lookId: string): LookDefinition | undefined {
  return looksById.get(lookId);
}

export function findLookByVersionId(lookVersionId: string): LookDefinition | undefined {
  return looksByVersionId.get(lookVersionId);
}

export function searchLooks(query: string, family?: string): readonly LookDefinition[] {
  const normalized = query.trim().toLocaleLowerCase("en-US");
  return LOOKS.filter((look) => {
    if (family && look.family !== family) return false;
    if (!normalized) return true;
    return [look.name, look.feel, look.family].some((value) =>
      value.toLocaleLowerCase("en-US").includes(normalized),
    );
  });
}

function oneParagraph(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes("\n\n")) {
    throw new Error(`${label} must be one non-empty prompt block.`);
  }
  return trimmed;
}

export function compileImagePrompt(
  frameBlock: string,
  look: Pick<LookDefinition, "lockedLookBlock">,
): string {
  return `${oneParagraph(frameBlock, "frameBlock")}\n\n${oneParagraph(
    look.lockedLookBlock,
    "lockedLookBlock",
  )}`;
}

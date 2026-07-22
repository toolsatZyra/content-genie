import "server-only";

import { createHash } from "node:crypto";

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { ensureProductionVideoCapabilities } from "@/server/production-video-capabilities";

// This is a parser/JavaScript-integer safety bound, not a product spend cap.
// The developer MVP records and authorizes the exact high quote without pausing
// at USD 50; a data-derived policy can be introduced after real usage.
const MAXIMUM_LEDGER_MICROUSD = Number.MAX_SAFE_INTEGER;
const allowanceRateKeys = [
  "narration_master_reuse",
  "qc_judges",
  "render_export",
  "repair_allowance",
  "score_music",
  "sfx_ambience",
  "storyboard_generation",
  "upscale",
] as const;
type AllowanceRateKey = (typeof allowanceRateKeys)[number];
type SlotKind = "alternate" | "candidate" | "primary" | "retry";

type Rate = Readonly<{
  expiresAt: string;
  lineKind: string;
  maximumLineMicrousd: number;
  minimumQuantity: number;
  rateCardId: string;
  rateHash: string;
  rateKey: string;
  unitName: string;
  unitPriceMicrousd: number;
}>;

type QuoteSlot = Readonly<{
  billingQuantumCount: number;
  capabilityVersionId: string;
  expiresAt: string;
  outputHeight: number;
  rateCardId: string;
  rateHash: string;
  retainedDurationMs: number;
  slotId: string;
  slotKey: string;
  slotKind: SlotKind;
  unitPriceMicrousd: number;
}>;

type QuoteInput = Readonly<{
  allowanceRates: readonly Rate[];
  configurationCandidateId: string;
  existingQuote: null | Readonly<{
    expiresAt: string;
    hardCeilingMicrousd: number;
    quoteHash: string;
    quoteId: string;
  }>;
  masterDurationMs: number;
  planBundleId: string;
  planHash: string;
  planQcConsensusId: string;
  rateExpiresAt: string;
  slots: readonly QuoteSlot[];
  storyboardBillingQuantumCount: number;
  workspaceId: string;
}>;

type QuoteLine = Readonly<{
  evidenceHash: string;
  expectedAmountMicrousd: number;
  expectedQuantity: string;
  highAmountMicrousd: number;
  highQuantity: string;
  lineId: string;
  lineKey: string;
  lineKind: string;
  lowAmountMicrousd: number;
  lowQuantity: string;
  rateCardId: string;
  slotId: string;
}>;

export class ProductionQuoteError extends Error {
  override readonly name = "ProductionQuoteError";

  constructor(
    message: string,
    readonly retryable = false,
    readonly code = "PRODUCTION_QUOTE_INVALID",
  ) {
    super(message);
  }
}

const hashPattern = /^[a-f0-9]{64}$/u;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const sha256 = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");

function deterministicUuid(seed: string): string {
  const bytes = Buffer.from(sha256(seed).slice(0, 32), "hex");
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProductionQuoteError(`${label} is malformed.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
) {
  if (Object.keys(value).sort().join("|") !== [...keys].sort().join("|")) {
    throw new ProductionQuoteError(`${label} is not exact.`);
  }
}

function uuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw new ProductionQuoteError(`${label} is malformed.`);
  }
  return value;
}

function hash(value: unknown, label: string): string {
  if (typeof value !== "string" || !hashPattern.test(value)) {
    throw new ProductionQuoteError(`${label} is malformed.`);
  }
  return value;
}

function integer(value: unknown, label: string, minimum: number, maximum: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new ProductionQuoteError(`${label} is malformed.`);
  }
  return parsed;
}

function number(value: unknown, label: string, minimum: number, maximum: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new ProductionQuoteError(`${label} is malformed.`);
  }
  return parsed;
}

function timestamp(value: unknown, label: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new ProductionQuoteError(`${label} is malformed.`);
  }
  return value;
}

function text(value: unknown, label: string, maximum: number): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    value.includes("\0")
  ) {
    throw new ProductionQuoteError(`${label} is malformed.`);
  }
  return value;
}

function parseRate(value: unknown, label: string): Rate {
  const row = record(value, label);
  exactKeys(
    row,
    [
      "expiresAt",
      "lineKind",
      "maximumLineMicrousd",
      "minimumQuantity",
      "rateCardId",
      "rateHash",
      "rateKey",
      "unitName",
      "unitPriceMicrousd",
    ],
    label,
  );
  return Object.freeze({
    expiresAt: timestamp(row.expiresAt, `${label} expiry`),
    lineKind: text(row.lineKind, `${label} kind`, 100),
    maximumLineMicrousd: integer(
      row.maximumLineMicrousd,
      `${label} maximum`,
      0,
      MAXIMUM_LEDGER_MICROUSD,
    ),
    minimumQuantity: number(row.minimumQuantity, `${label} minimum`, 0, 10_000),
    rateCardId: uuid(row.rateCardId, `${label} ID`),
    rateHash: hash(row.rateHash, `${label} hash`),
    rateKey: text(row.rateKey, `${label} key`, 140),
    unitName: text(row.unitName, `${label} unit`, 100),
    unitPriceMicrousd: integer(
      row.unitPriceMicrousd,
      `${label} price`,
      0,
      MAXIMUM_LEDGER_MICROUSD,
    ),
  });
}

function parseQuoteInput(value: unknown): QuoteInput {
  const root = record(value, "Production quote input");
  exactKeys(
    root,
    [
      "allowanceRates",
      "configurationCandidateId",
      "existingQuote",
      "masterDurationMs",
      "planBundleId",
      "planHash",
      "planQcConsensusId",
      "rateExpiresAt",
      "slots",
      "storyboardBillingQuantumCount",
      "workspaceId",
    ],
    "Production quote input",
  );
  if (
    !Array.isArray(root.allowanceRates) ||
    root.allowanceRates.length !== allowanceRateKeys.length ||
    !Array.isArray(root.slots) ||
    root.slots.length < 1 ||
    root.slots.length > 2_993
  ) {
    throw new ProductionQuoteError("Production quote coverage is incomplete.");
  }
  const allowanceRates = root.allowanceRates.map((rate, index) =>
    parseRate(rate, `Allowance rate ${index + 1}`),
  );
  if (
    new Set(allowanceRates.map(({ rateKey }) => rateKey)).size !==
      allowanceRateKeys.length ||
    allowanceRateKeys.some(
      (rateKey) => !allowanceRates.some((rate) => rate.rateKey === rateKey),
    ) ||
    allowanceRates.some((rate) => rate.lineKind !== rate.rateKey)
  ) {
    throw new ProductionQuoteError("Production allowance rates are ambiguous.");
  }
  const slots = root.slots.map((value, index) => {
    const slot = record(value, `Quote slot ${index + 1}`);
    exactKeys(
      slot,
      [
        "billingQuantumCount",
        "capabilityVersionId",
        "expiresAt",
        "outputHeight",
        "rateCardId",
        "rateHash",
        "retainedDurationMs",
        "slotId",
        "slotKey",
        "slotKind",
        "unitPriceMicrousd",
      ],
      `Quote slot ${index + 1}`,
    );
    if (
      !["alternate", "candidate", "primary", "retry"].includes(String(slot.slotKind))
    ) {
      throw new ProductionQuoteError("Production quote slot kind is malformed.");
    }
    return Object.freeze({
      billingQuantumCount: integer(
        slot.billingQuantumCount,
        "Billing quantum count",
        1,
        10_000,
      ),
      capabilityVersionId: uuid(slot.capabilityVersionId, "Slot capability"),
      expiresAt: timestamp(slot.expiresAt, "Slot rate expiry"),
      outputHeight: integer(slot.outputHeight, "Slot output height", 720, 4_096),
      rateCardId: uuid(slot.rateCardId, "Slot rate card"),
      rateHash: hash(slot.rateHash, "Slot rate hash"),
      retainedDurationMs: integer(
        slot.retainedDurationMs,
        "Retained slot duration",
        1,
        30_000,
      ),
      slotId: uuid(slot.slotId, "Provider request slot"),
      slotKey: text(slot.slotKey, "Provider request slot key", 140),
      slotKind: slot.slotKind as SlotKind,
      unitPriceMicrousd: integer(
        slot.unitPriceMicrousd,
        "Slot unit price",
        0,
        MAXIMUM_LEDGER_MICROUSD,
      ),
    });
  });
  if (
    new Set(slots.map(({ slotId }) => slotId)).size !== slots.length ||
    new Set(slots.map(({ slotKey }) => slotKey)).size !== slots.length
  ) {
    throw new ProductionQuoteError("Production quote slots are duplicated.");
  }
  let existingQuote: QuoteInput["existingQuote"] = null;
  if (root.existingQuote !== null) {
    const existing = record(root.existingQuote, "Existing production quote");
    exactKeys(
      existing,
      ["expiresAt", "hardCeilingMicrousd", "quoteHash", "quoteId"],
      "Existing production quote",
    );
    existingQuote = Object.freeze({
      expiresAt: timestamp(existing.expiresAt, "Existing quote expiry"),
      hardCeilingMicrousd: integer(
        existing.hardCeilingMicrousd,
        "Existing quote ceiling",
        0,
        MAXIMUM_LEDGER_MICROUSD,
      ),
      quoteHash: hash(existing.quoteHash, "Existing quote hash"),
      quoteId: uuid(existing.quoteId, "Existing quote"),
    });
  }
  return Object.freeze({
    allowanceRates: Object.freeze(allowanceRates),
    configurationCandidateId: uuid(
      root.configurationCandidateId,
      "Configuration candidate",
    ),
    existingQuote,
    masterDurationMs: integer(
      root.masterDurationMs,
      "Master duration",
      60_000,
      120_000,
    ),
    planBundleId: uuid(root.planBundleId, "Plan bundle"),
    planHash: hash(root.planHash, "Plan hash"),
    planQcConsensusId: uuid(root.planQcConsensusId, "Plan consensus"),
    rateExpiresAt: timestamp(root.rateExpiresAt, "Quote rate expiry"),
    slots: Object.freeze(slots),
    storyboardBillingQuantumCount: number(
      root.storyboardBillingQuantumCount,
      "Storyboard billing quantum count",
      1.525,
      610,
    ),
    workspaceId: uuid(root.workspaceId, "Workspace"),
  });
}

async function rpc(name: string, parameters: Record<string, unknown>) {
  const { data, error } = await createAdminSupabaseClient().rpc(name, parameters);
  if (error) {
    throw new ProductionQuoteError(
      `Production quote ledger rejected ${name}.`,
      true,
      "PRODUCTION_QUOTE_LEDGER_REJECTED",
    );
  }
  return data as unknown;
}

function quantity(value: number): string {
  if (!Number.isFinite(value) || value < 0 || value > 10_000) {
    throw new ProductionQuoteError("Quote quantity is outside its contract.");
  }
  return value
    .toFixed(4)
    .replace(/\.0+$/u, "")
    .replace(/(\.\d*?)0+$/u, "$1");
}

function quoteLine(
  planBundleId: string,
  input: Readonly<{
    expectedQuantity: number;
    highQuantity: number;
    lineKey: string;
    lineKind: string;
    lowQuantity: number;
    maximumLineMicrousd: number;
    rateCardId: string;
    rateHash: string;
    slotId: string;
    unitPriceMicrousd: number;
  }>,
): QuoteLine {
  const lowQuantity = quantity(input.lowQuantity);
  const expectedQuantity = quantity(input.expectedQuantity);
  const highQuantity = quantity(input.highQuantity);
  const lowAmountMicrousd = Math.ceil(Number(lowQuantity) * input.unitPriceMicrousd);
  const expectedAmountMicrousd = Math.ceil(
    Number(expectedQuantity) * input.unitPriceMicrousd,
  );
  const highAmountMicrousd = Math.ceil(Number(highQuantity) * input.unitPriceMicrousd);
  if (
    lowAmountMicrousd > expectedAmountMicrousd ||
    expectedAmountMicrousd > highAmountMicrousd ||
    highAmountMicrousd > input.maximumLineMicrousd
  ) {
    throw new ProductionQuoteError(`Quote line ${input.lineKey} exceeds its rate.`);
  }
  return Object.freeze({
    evidenceHash: sha256(
      `${input.rateHash}:${lowQuantity}:${expectedQuantity}:${highQuantity}`,
    ),
    expectedAmountMicrousd,
    expectedQuantity,
    highAmountMicrousd,
    highQuantity,
    lineId: deterministicUuid(
      `production-quote-line:${planBundleId}:${input.lineKey}:${input.rateCardId}`,
    ),
    lineKey: input.lineKey,
    lineKind: input.lineKind,
    lowAmountMicrousd,
    lowQuantity,
    rateCardId: input.rateCardId,
    slotId: input.slotId,
  });
}

export function compileProductionQuoteLines(input: QuoteInput): readonly QuoteLine[] {
  const lines: QuoteLine[] = input.slots.map((slot) => {
    let low = 0;
    let expected = 0;
    if (slot.slotKind === "primary") {
      low = slot.billingQuantumCount;
      expected = slot.billingQuantumCount;
    } else if (slot.slotKind === "candidate") {
      expected = slot.billingQuantumCount;
    } else if (slot.slotKind === "retry") {
      expected = slot.billingQuantumCount * 0.35;
    } else {
      expected = slot.billingQuantumCount * 0.15;
    }
    return quoteLine(input.planBundleId, {
      expectedQuantity: expected,
      highQuantity: slot.billingQuantumCount,
      lineKey: `provider.${slot.slotKey}`,
      lineKind: "provider_clip",
      lowQuantity: low,
      maximumLineMicrousd: MAXIMUM_LEDGER_MICROUSD,
      rateCardId: slot.rateCardId,
      rateHash: slot.rateHash,
      slotId: slot.slotId,
      unitPriceMicrousd: slot.unitPriceMicrousd,
    });
  });
  const allowance = new Map(
    input.allowanceRates.map((rate) => [rate.rateKey as AllowanceRateKey, rate]),
  );
  const retainedUpscaleMinutes =
    input.slots
      .filter((slot) => slot.slotKind === "primary" && slot.outputHeight < 1_920)
      .reduce((sum, slot) => sum + slot.retainedDurationMs, 0) / 60_000;
  const durationMinutes = input.masterDurationMs / 60_000;
  const quantities: Readonly<
    Record<AllowanceRateKey, readonly [number, number, number]>
  > = Object.freeze({
    narration_master_reuse: [1, 1, 1],
    qc_judges: [4, 6, 12],
    render_export: [
      Math.max(1, durationMinutes),
      Math.max(1, durationMinutes),
      Math.max(1, durationMinutes),
    ],
    repair_allowance: [0, 1, 1],
    score_music: [1, 1, 2],
    sfx_ambience: [0, 5_000, 10_000],
    storyboard_generation: [
      input.storyboardBillingQuantumCount,
      input.storyboardBillingQuantumCount,
      input.storyboardBillingQuantumCount,
    ],
    upscale: [retainedUpscaleMinutes, retainedUpscaleMinutes, retainedUpscaleMinutes],
  });
  for (const rateKey of allowanceRateKeys) {
    const rate = allowance.get(rateKey)!;
    const [low, expected, high] = quantities[rateKey];
    if (high < rate.minimumQuantity) {
      throw new ProductionQuoteError(`Allowance ${rateKey} is below its minimum.`);
    }
    lines.push(
      quoteLine(input.planBundleId, {
        expectedQuantity: expected,
        highQuantity: high,
        lineKey: rateKey,
        lineKind: rate.lineKind,
        lowQuantity: low,
        maximumLineMicrousd: rate.maximumLineMicrousd,
        rateCardId: rate.rateCardId,
        rateHash: rate.rateHash,
        slotId: "",
        unitPriceMicrousd: rate.unitPriceMicrousd,
      }),
    );
  }
  return Object.freeze(lines);
}

function total(
  lines: readonly QuoteLine[],
  key: "expectedAmountMicrousd" | "highAmountMicrousd",
) {
  return lines.reduce((sum, line) => sum + line[key], 0);
}

export async function ensureProductionQuote(
  input: Readonly<{
    configurationCandidateId: string;
    workspaceId: string;
  }>,
): Promise<
  Readonly<{
    hardCeilingMicrousd: number;
    quoteHash: string;
    quoteId: string;
    replayed: boolean;
  }>
> {
  await ensureProductionVideoCapabilities(input.workspaceId);
  const allowanceValue = await rpc("command_ensure_production_allowance_rates", {
    p_workspace_id: input.workspaceId,
  });
  if (
    !Array.isArray(allowanceValue) ||
    allowanceValue.length !== allowanceRateKeys.length
  ) {
    throw new ProductionQuoteError("Production allowance registration is malformed.");
  }
  const allowanceRates = allowanceValue.map((rate, index) =>
    parseRate(rate, `Registered allowance ${index + 1}`),
  );
  const quoteInput = parseQuoteInput(
    await rpc("get_production_quote_input", {
      p_allowance_rate_card_ids: allowanceRates.map(({ rateCardId }) => rateCardId),
      p_configuration_candidate_id: input.configurationCandidateId,
      p_workspace_id: input.workspaceId,
    }),
  );
  if (
    quoteInput.workspaceId !== input.workspaceId ||
    quoteInput.configurationCandidateId !== input.configurationCandidateId
  ) {
    throw new ProductionQuoteError("Production quote authority changed.");
  }
  if (quoteInput.existingQuote) {
    return Object.freeze({
      hardCeilingMicrousd: quoteInput.existingQuote.hardCeilingMicrousd,
      quoteHash: quoteInput.existingQuote.quoteHash,
      quoteId: quoteInput.existingQuote.quoteId,
      replayed: true,
    });
  }
  const lines = compileProductionQuoteLines(quoteInput);
  const expectedTotalMicrousd = total(lines, "expectedAmountMicrousd");
  const highTotalMicrousd = total(lines, "highAmountMicrousd");
  if (expectedTotalMicrousd > highTotalMicrousd) {
    throw new ProductionQuoteError("Production quote totals are inconsistent.");
  }
  const bucketStart = Math.floor(Date.now() / 300_000) * 300_000;
  const expiresAt = new Date(
    Math.min(Date.parse(quoteInput.rateExpiresAt), bucketStart + 6 * 60 * 60 * 1_000),
  ).toISOString();
  if (Date.parse(expiresAt) <= Date.now()) {
    throw new ProductionQuoteError(
      "Production rates expired before quote compilation.",
      true,
      "PRODUCTION_QUOTE_RATES_STALE",
    );
  }
  const prepared = record(
    await rpc("prepare_production_quote", {
      p_configuration_candidate_id: input.configurationCandidateId,
      p_expires_at: expiresAt,
      p_hard_ceiling_microusd: highTotalMicrousd,
      p_lines: lines,
      p_plan_bundle_id: quoteInput.planBundleId,
      p_workspace_id: input.workspaceId,
    }),
    "Prepared production quote",
  );
  exactKeys(
    prepared,
    ["quoteHash", "rateExpiresAt", "rateSnapshotHash"],
    "Prepared production quote",
  );
  const quoteHash = hash(prepared.quoteHash, "Prepared quote hash");
  const rateSnapshotHash = hash(
    prepared.rateSnapshotHash,
    "Prepared rate snapshot hash",
  );
  const quoteId = deterministicUuid(
    `production-quote:${input.configurationCandidateId}:${quoteHash}`,
  );
  try {
    await rpc("command_record_production_quote", {
      p_configuration_candidate_id: input.configurationCandidateId,
      p_expires_at: expiresAt,
      p_hard_ceiling_microusd: highTotalMicrousd,
      p_lines: lines,
      p_plan_bundle_id: quoteInput.planBundleId,
      p_plan_qc_consensus_id: quoteInput.planQcConsensusId,
      p_quote_hash: quoteHash,
      p_quote_id: quoteId,
      p_rate_snapshot_hash: rateSnapshotHash,
      p_workspace_id: input.workspaceId,
    });
  } catch (error) {
    const { data, error: lookupError } = await createAdminSupabaseClient()
      .from("production_quotes")
      .select("id,quote_hash,hard_ceiling_microusd")
      .eq("id", quoteId)
      .eq("workspace_id", input.workspaceId)
      .maybeSingle();
    if (
      lookupError ||
      !data ||
      data.quote_hash !== quoteHash ||
      Number(data.hard_ceiling_microusd) !== highTotalMicrousd
    ) {
      throw error;
    }
  }
  return Object.freeze({
    hardCeilingMicrousd: highTotalMicrousd,
    quoteHash,
    quoteId,
    replayed: false,
  });
}

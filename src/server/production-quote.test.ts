import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureCapabilities: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/server/production-video-capabilities", () => ({
  ensureProductionVideoCapabilities: mocks.ensureCapabilities,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ from: mocks.from, rpc: mocks.rpc }),
}));

import { compileProductionQuoteLines, ensureProductionQuote } from "./production-quote";

const id = (suffix: string) => `10000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const hash = (character: string) => character.repeat(64);

const allowanceDefinitions = [
  ["narration_master_reuse", "episode", 0, 1, 0],
  ["qc_judges", "judge_call", 250_000, 4, 3_000_000],
  ["render_export", "render_minute", 500_000, 1, 1_500_000],
  ["repair_allowance", "episode", 500_000, 1, 1_000_000],
  ["score_music", "episode", 1_250_000, 1, 2_500_000],
  ["sfx_ambience", "credit", 100, 0, 1_000_000],
  ["storyboard_generation", "billing_quantum", 80_000, 0, 50_000_000],
  ["upscale", "minute", 1_200_000, 0, 5_000_000],
] as const;

function quoteInput(providerUnitPriceMicrousd = 300_000) {
  const expiresAt = "2026-10-17T13:06:06.255Z";
  const allowanceRates = allowanceDefinitions.map(
    (
      [rateKey, unitName, unitPriceMicrousd, minimumQuantity, maximumLineMicrousd],
      index,
    ) => ({
      expiresAt,
      lineKind: rateKey,
      maximumLineMicrousd,
      minimumQuantity,
      rateCardId: id(String(100 + index)),
      rateHash: hash(String((index + 1) % 10)),
      rateKey,
      unitName,
      unitPriceMicrousd,
    }),
  );
  const slots = (["primary", "candidate", "retry", "alternate"] as const).map(
    (slotKind, index) => ({
      billingQuantumCount: 5,
      capabilityVersionId: id("40"),
      expiresAt,
      outputHeight: 1280,
      rateCardId: id("50"),
      rateHash: hash("a"),
      retainedDurationMs: 15_000,
      slotId: id(String(60 + index)),
      slotKey: `shot-001.${slotKind}`,
      slotKind,
      unitPriceMicrousd: providerUnitPriceMicrousd,
    }),
  );
  return {
    allowanceRates,
    configurationCandidateId: id("4"),
    existingQuote: null,
    masterDurationMs: 60_000,
    planBundleId: id("5"),
    planHash: hash("b"),
    planQcConsensusId: id("6"),
    rateExpiresAt: expiresAt,
    slots,
    storyboardBillingQuantumCount: 3.05,
    workspaceId: id("1"),
  };
}

describe("exact production quote compiler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-19T14:00:00.000Z"));
    vi.resetAllMocks();
    mocks.ensureCapabilities.mockResolvedValue({});
  });

  afterEach(() => vi.useRealTimers());

  it("prices every immutable provider slot and all seven mandatory allowances", () => {
    const lines = compileProductionQuoteLines(quoteInput());
    expect(lines).toHaveLength(12);
    expect(
      lines.slice(0, 4).map(({ expectedQuantity, highQuantity, lowQuantity }) => ({
        expectedQuantity,
        highQuantity,
        lowQuantity,
      })),
    ).toEqual([
      { expectedQuantity: "5", highQuantity: "5", lowQuantity: "5" },
      { expectedQuantity: "5", highQuantity: "5", lowQuantity: "0" },
      { expectedQuantity: "1.75", highQuantity: "5", lowQuantity: "0" },
      { expectedQuantity: "0.75", highQuantity: "5", lowQuantity: "0" },
    ]);
    expect(lines.filter(({ slotId }) => slotId === "")).toHaveLength(8);
    expect(
      lines.find(({ lineKey }) => lineKey === "storyboard_generation"),
    ).toMatchObject({
      expectedAmountMicrousd: 244_000,
      expectedQuantity: "3.05",
      highAmountMicrousd: 244_000,
    });
    expect(lines.find(({ lineKey }) => lineKey === "sfx_ambience")).toMatchObject({
      expectedAmountMicrousd: 500_000,
      highAmountMicrousd: 1_000_000,
    });
    expect(lines.find(({ lineKey }) => lineKey === "upscale")).toMatchObject({
      expectedQuantity: "0.25",
      highAmountMicrousd: 300_000,
      lowQuantity: "0.25",
    });
    expect(new Set(lines.map(({ evidenceHash }) => evidenceHash)).size).toBe(
      lines.length,
    );
  });

  it("prepares and persists the exact high envelope with no spend authorization", async () => {
    const input = quoteInput();
    const preparedQuoteHash = hash("c");
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "command_ensure_production_allowance_rates") {
        return { data: input.allowanceRates, error: null };
      }
      if (name === "get_production_quote_input") {
        return { data: input, error: null };
      }
      if (name === "prepare_production_quote") {
        return {
          data: {
            quoteHash: preparedQuoteHash,
            rateExpiresAt: input.rateExpiresAt,
            rateSnapshotHash: hash("d"),
          },
          error: null,
        };
      }
      if (name === "command_record_production_quote") {
        return { data: id("90"), error: null };
      }
      throw new Error(`unexpected RPC ${name}`);
    });

    const result = await ensureProductionQuote({
      configurationCandidateId: id("4"),
      workspaceId: id("1"),
    });

    expect(result).toMatchObject({
      quoteHash: preparedQuoteHash,
      replayed: false,
    });
    expect(result.hardCeilingMicrousd).toBeGreaterThan(0);
    const recordCall = mocks.rpc.mock.calls.find(
      ([name]) => name === "command_record_production_quote",
    )!;
    expect(recordCall[1]).toMatchObject({
      p_configuration_candidate_id: id("4"),
      p_hard_ceiling_microusd: result.hardCeilingMicrousd,
      p_plan_bundle_id: id("5"),
      p_plan_qc_consensus_id: id("6"),
      p_quote_hash: preparedQuoteHash,
      p_workspace_id: id("1"),
    });
    expect(recordCall[1].p_lines).toHaveLength(12);
    expect(mocks.rpc.mock.calls.some(([name]) => name.includes("authorization"))).toBe(
      false,
    );
  });

  it("records the exact high envelope when quality-first spend exceeds $50", async () => {
    const input = quoteInput(10_000_000);
    const preparedQuoteHash = hash("e");
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "command_ensure_production_allowance_rates") {
        return { data: input.allowanceRates, error: null };
      }
      if (name === "get_production_quote_input") {
        return { data: input, error: null };
      }
      if (name === "prepare_production_quote") {
        return {
          data: {
            quoteHash: preparedQuoteHash,
            rateExpiresAt: input.rateExpiresAt,
            rateSnapshotHash: hash("f"),
          },
          error: null,
        };
      }
      if (name === "command_record_production_quote") {
        return { data: id("91"), error: null };
      }
      throw new Error(`unexpected RPC ${name}`);
    });

    const result = await ensureProductionQuote({
      configurationCandidateId: id("4"),
      workspaceId: id("1"),
    });

    expect(result).toMatchObject({ quoteHash: preparedQuoteHash, replayed: false });
    expect(result.hardCeilingMicrousd).toBeGreaterThan(50_000_000);
    expect(
      mocks.rpc.mock.calls.some(([name]) => name === "command_record_production_quote"),
    ).toBe(true);
  });
});

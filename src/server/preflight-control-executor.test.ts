import { describe, expect, it } from "vitest";

import { PreflightPlanAgentError } from "@/server/preflight-plan-agent";
import { ProductionQuoteError } from "@/server/production-quote";
import { UploadedNarrationClockError } from "@/server/uploaded-narration-clock";
import { WorldExtractionUpgradeRequiredError } from "@/server/preflight-control-ledger";

import { classifyPreflightControlFailure } from "./preflight-control-executor";

describe("preflight control failure classification", () => {
  it("terminalizes an obsolete World extraction so recovery starts a fresh run", () => {
    expect(
      classifyPreflightControlFailure(
        new WorldExtractionUpgradeRequiredError("upgrade required"),
      ),
    ).toEqual({
      retryable: false,
      safeErrorClass: "world-extraction-upgrade-required",
    });
  });

  it("seals genuine plan-repair exhaustion without scheduling another attempt", () => {
    expect(
      classifyPreflightControlFailure(
        new PreflightPlanAgentError(
          "Monica exhausted two automatic plan repairs.",
          false,
          "PLAN_QUALITY_BLOCKED",
        ),
      ),
    ).toEqual({ retryable: false, safeErrorClass: "plan-quality-blocked" });
  });

  it("seals an episode whose full quality envelope exceeds the launch ceiling", () => {
    expect(
      classifyPreflightControlFailure(
        new ProductionQuoteError(
          "The full quality envelope is above the launch ceiling.",
          false,
          "PRODUCTION_QUOTE_CEILING_EXCEEDED",
        ),
      ),
    ).toEqual({
      retryable: false,
      safeErrorClass: "production-quote-ceiling-exceeded",
    });
  });

  it("keeps transient ledger failures retryable and ignores unrelated errors", () => {
    expect(
      classifyPreflightControlFailure(
        new PreflightPlanAgentError(
          "Ledger unavailable.",
          true,
          "PLAN_LEDGER_REJECTED",
        ),
      ),
    ).toEqual({ retryable: true, safeErrorClass: "plan-ledger-rejected" });
    expect(classifyPreflightControlFailure(new Error("network"))).toBeNull();
  });

  it("classifies uploaded narration clock failures without leaking provider text", () => {
    expect(
      classifyPreflightControlFailure(
        new UploadedNarrationClockError(
          "private detail",
          "uploaded_narration.clock_ledger_rejected",
          true,
        ),
      ),
    ).toEqual({
      retryable: true,
      safeErrorClass: "uploaded-narration.clock-ledger-rejected",
    });
  });
});

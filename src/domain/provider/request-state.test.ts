import { describe, expect, it } from "vitest";

import {
  classifyLateProviderCompletion,
  ProviderRequestTransitionError,
  transitionProviderRequest,
} from "./request-state";

describe("provider request state contract", () => {
  it("follows the authoritative request path", () => {
    let state = transitionProviderRequest("reserved", "enqueue");
    state = transitionProviderRequest(state, "submit");
    state = transitionProviderRequest(state, "accept");
    state = transitionProviderRequest(state, "poll");
    expect(transitionProviderRequest(state, "complete")).toBe("succeeded");
  });

  it("requires a new row for retry and never reopens terminal state", () => {
    expect(transitionProviderRequest("accepted", "fail_retryable")).toBe(
      "failed_retryable",
    );
    expect(() => transitionProviderRequest("failed_retryable", "enqueue")).toThrow(
      ProviderRequestTransitionError,
    );
    expect(() => transitionProviderRequest("canceled", "complete")).toThrow(
      ProviderRequestTransitionError,
    );
  });

  it("records late completion orthogonally", () => {
    expect(
      classifyLateProviderCompletion({
        hasQuarantinedAsset: true,
        isBillable: true,
        isDuplicate: false,
      }),
    ).toBe("quarantined_asset");
    expect(
      classifyLateProviderCompletion({
        hasQuarantinedAsset: false,
        isBillable: true,
        isDuplicate: false,
      }),
    ).toBe("billable_no_asset");
  });
});

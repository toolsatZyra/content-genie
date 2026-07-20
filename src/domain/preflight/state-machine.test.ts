import { describe, expect, it } from "vitest";

import {
  isTerminalPreflightState,
  PreflightTransitionError,
  transitionPreflight,
} from "./state-machine";

describe("preflight state contract", () => {
  it("supports the normative durable path and bounded waits", () => {
    expect(transitionPreflight("created", "enqueue")).toBe("queued");
    expect(transitionPreflight("queued", "started")).toBe("running");
    expect(transitionPreflight("running", "wait_external")).toBe("waiting_external");
    expect(transitionPreflight("waiting_external", "succeed")).toBe("succeeded");
  });

  it("does not reopen terminal authority", () => {
    for (const state of ["succeeded", "failed", "canceled", "superseded"] as const) {
      expect(isTerminalPreflightState(state)).toBe(true);
      expect(() => transitionPreflight(state, "enqueue")).toThrow(
        PreflightTransitionError,
      );
      expect(() => transitionPreflight(state, "resume")).toThrow(
        PreflightTransitionError,
      );
    }
  });

  it("resumes only through a new queued claim", () => {
    expect(transitionPreflight("running", "pause")).toBe("paused");
    expect(transitionPreflight("paused", "resume")).toBe("queued");
    expect(() => transitionPreflight("paused", "started")).toThrow(
      "preflight.started is invalid from paused",
    );
  });
});

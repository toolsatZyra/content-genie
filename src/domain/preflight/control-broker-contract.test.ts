import { describe, expect, it } from "vitest";

import {
  parsePreflightControlRequest,
  PREFLIGHT_CONTROL_SCHEMA_VERSION,
  PreflightControlContractError,
} from "./control-broker-contract";

const id = (suffix: string) => `10000000-0000-4000-8000-${suffix.padStart(12, "0")}`;

describe("preflight control broker request", () => {
  it("accepts exact run and stage authority shapes", () => {
    expect(
      parsePreflightControlRequest(
        JSON.stringify({
          operation: "dispatch",
          preflightRunId: id("1"),
          schemaVersion: PREFLIGHT_CONTROL_SCHEMA_VERSION,
          stageAttemptId: null,
          stageRunId: null,
        }),
      ).operation,
    ).toBe("dispatch");
    expect(
      parsePreflightControlRequest(
        JSON.stringify({
          operation: "execute",
          preflightRunId: id("1"),
          schemaVersion: PREFLIGHT_CONTROL_SCHEMA_VERSION,
          stageAttemptId: id("2"),
          stageRunId: id("3"),
        }),
      ).stageAttemptId,
    ).toBe(id("2"));
    expect(
      parsePreflightControlRequest(
        JSON.stringify({
          operation: "externalize",
          preflightRunId: id("1"),
          schemaVersion: PREFLIGHT_CONTROL_SCHEMA_VERSION,
          stageAttemptId: id("2"),
          stageRunId: id("3"),
        }),
      ).operation,
    ).toBe("externalize");
  });

  it.each([
    {
      operation: "dispatch",
      preflightRunId: id("1"),
      schemaVersion: PREFLIGHT_CONTROL_SCHEMA_VERSION,
      stageAttemptId: id("2"),
      stageRunId: id("3"),
    },
    {
      operation: "execute",
      preflightRunId: id("1"),
      schemaVersion: PREFLIGHT_CONTROL_SCHEMA_VERSION,
      stageAttemptId: null,
      stageRunId: null,
    },
    {
      operation: "shell",
      preflightRunId: id("1"),
      schemaVersion: PREFLIGHT_CONTROL_SCHEMA_VERSION,
      stageAttemptId: null,
      stageRunId: null,
    },
  ])("rejects invalid authority shape %#", (value) => {
    expect(() => parsePreflightControlRequest(JSON.stringify(value))).toThrow(
      PreflightControlContractError,
    );
  });

  it("rejects non-exact and malformed requests", () => {
    expect(() => parsePreflightControlRequest("not-json")).toThrow(
      PreflightControlContractError,
    );
    expect(() =>
      parsePreflightControlRequest(
        JSON.stringify({
          operation: "finalize",
          preflightRunId: id("1"),
          schemaVersion: PREFLIGHT_CONTROL_SCHEMA_VERSION,
          stageAttemptId: null,
          stageRunId: null,
          url: "https://attacker.test",
        }),
      ),
    ).toThrow("not exact");
  });
});

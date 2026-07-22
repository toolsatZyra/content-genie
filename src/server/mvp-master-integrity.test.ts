import { describe, expect, it } from "vitest";

import {
  persistedMasterObjectMatches,
  persistedMasterRecordMatches,
  type RenderedMasterIdentity,
} from "./mvp-master-integrity";

const expected: RenderedMasterIdentity = {
  byteLength: 4_096,
  contentSha256: "a".repeat(64),
  durationMs: 60_000,
  height: 1_920,
  objectName: "workspace/mvp-masters/run/1/master.mp4",
  width: 1_080,
};

describe("immutable MVP master verification", () => {
  it("accepts only an existing object with the exact rendered byte identity", () => {
    expect(
      persistedMasterObjectMatches(
        { byteLength: 4_096, contentSha256: "a".repeat(64) },
        expected,
      ),
    ).toBe(true);
    expect(
      persistedMasterObjectMatches(
        { byteLength: 4_096, contentSha256: "b".repeat(64) },
        expected,
      ),
    ).toBe(false);
    expect(
      persistedMasterObjectMatches(
        { byteLength: 4_095, contentSha256: "a".repeat(64) },
        expected,
      ),
    ).toBe(false);
  });

  it("accepts an idempotent retry only when every persisted master field agrees", () => {
    const persisted = {
      byte_length: "4096",
      content_sha256: "a".repeat(64),
      duration_ms: "60000",
      height: "1920",
      object_name: "workspace/mvp-masters/run/1/master.mp4",
      width: "1080",
    };

    expect(persistedMasterRecordMatches(persisted, expected)).toBe(true);
    expect(
      persistedMasterRecordMatches({ ...persisted, duration_ms: "59999" }, expected),
    ).toBe(false);
    expect(
      persistedMasterRecordMatches(
        { ...persisted, object_name: "workspace/mvp-masters/run/2/master.mp4" },
        expected,
      ),
    ).toBe(false);
  });
});

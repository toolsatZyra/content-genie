import { describe, expect, it } from "vitest";

import {
  parseSignedStorageRequest,
  StoragePathValidationError,
} from "@/security/storage-path";

const workspaceId = "10000000-0000-0000-0000-000000000101";

describe("signed Storage request", () => {
  it("allows only a short-lived private workspace object", () => {
    expect(
      parseSignedStorageRequest({
        bucket: "workspace-private",
        expiresIn: 60,
        path: `${workspaceId}/source/asset/v1/frame.webp`,
      }),
    ).toMatchObject({ workspaceId, expiresIn: 60 });
  });

  it.each([
    { bucket: "workspace-exports", expiresIn: 60, path: `${workspaceId}/a` },
    { bucket: "workspace-private", expiresIn: 29, path: `${workspaceId}/a` },
    { bucket: "workspace-private", expiresIn: 121, path: `${workspaceId}/a` },
    { bucket: "workspace-private", expiresIn: 60, path: "not-a-workspace/a" },
    { bucket: "workspace-private", expiresIn: 60, path: `${workspaceId}/../a` },
    { bucket: "workspace-private", expiresIn: 60, path: `${workspaceId}/%2e/a` },
    { bucket: "workspace-private", expiresIn: 60, path: `${workspaceId}\\a` },
  ])("rejects unsafe or overlong signing input %#", (input) => {
    expect(() => parseSignedStorageRequest(input)).toThrow(StoragePathValidationError);
  });
});

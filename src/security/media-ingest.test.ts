import { describe, expect, it } from "vitest";

import {
  assertPromotableAsset,
  INGEST_ATTESTATION_SCHEMA_VERSION,
  MediaIngestPolicyError,
  parseQuarantineManifest,
  QUARANTINE_MANIFEST_SCHEMA_VERSION,
  sniffMediaMagic,
} from "./media-ingest";

const workspaceId = "10000000-0000-4000-8000-000000000001";
const assetId = "10000000-0000-4000-8000-000000000002";
const versionId = "10000000-0000-4000-8000-000000000003";
const policyVersionId = "10000000-0000-4000-8000-000000000004";

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    assetId,
    assetVersionId: versionId,
    bucketId: "quarantine",
    byteLength: 1024,
    declaredMime: "image/png",
    displayFilename: "reference.png",
    objectName: `${workspaceId}/quarantine/${assetId}/${versionId}/source`,
    schemaVersion: QUARANTINE_MANIFEST_SCHEMA_VERSION,
    sha256: "a".repeat(64),
    sourceKind: "provider_output",
    workspaceId,
    ...overrides,
  };
}

function attestation(overrides: Record<string, unknown> = {}) {
  return {
    createdAt: "2026-07-19T00:00:00.000Z",
    decompressedBytes: 4_000_000,
    durationMs: null,
    frameCount: null,
    height: 1920,
    magicMime: "image/png",
    malwareStatus: "clean",
    metadataStripped: true,
    outputSha256: "b".repeat(64),
    parserSandboxed: true,
    policyVersionId,
    probeSha256: "c".repeat(64),
    quarantineAssetVersionId: versionId,
    reencodedMime: "image/png",
    scanEngine: "clamav",
    scanVersion: "1.4.3",
    schemaVersion: INGEST_ATTESTATION_SCHEMA_VERSION,
    width: 1080,
    ...overrides,
  };
}

describe("quarantine-first media ingest", () => {
  it("sniffs launch media independently of declared MIME", () => {
    expect(sniffMediaMagic(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(
      "image/png",
    );
    expect(sniffMediaMagic(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(
      "image/jpeg",
    );
    expect(sniffMediaMagic(Uint8Array.from([0x4d, 0x5a, 0x90, 0x00]))).toBeNull();
  });

  it("promotes only a scan-, sandbox-, probe-, metadata-, and reencode-bound asset", () => {
    expect(assertPromotableAsset(manifest(), attestation())).toEqual({
      assetId,
      outputSha256: "b".repeat(64),
      policyVersionId,
      promotedMime: "image/png",
      quarantineAssetVersionId: versionId,
      workspaceId,
    });
  });

  it.each([
    ["malware", { malwareStatus: "infected" }],
    ["metadata", { metadataStripped: false }],
    ["sandbox", { parserSandboxed: false }],
    ["MIME mismatch", { magicMime: "image/jpeg" }],
    ["pixel bomb", { width: 32_768, height: 32_768 }],
    ["decompression bomb", { decompressedBytes: 300 * 1024 * 1024 }],
    ["unexpected duration", { durationMs: 1_000 }],
  ])("blocks %s evidence", (_name, patch) => {
    expect(() => assertPromotableAsset(manifest(), attestation(patch))).toThrow(
      MediaIngestPolicyError,
    );
  });

  it("rejects traversal, wrong bucket, oversized images, and extra fields", () => {
    expect(() =>
      parseQuarantineManifest(manifest({ objectName: `${workspaceId}/../secret` })),
    ).toThrow(MediaIngestPolicyError);
    expect(() =>
      parseQuarantineManifest(manifest({ bucketId: "workspace-media" })),
    ).toThrow(MediaIngestPolicyError);
    expect(() =>
      parseQuarantineManifest(manifest({ byteLength: 26 * 1024 * 1024 })),
    ).toThrow(MediaIngestPolicyError);
    expect(() =>
      parseQuarantineManifest(manifest({ providerUrl: "https://x" })),
    ).toThrow("not exact");
  });

  it("rejects an attestation for another quarantine version", () => {
    expect(() =>
      assertPromotableAsset(
        manifest(),
        attestation({
          quarantineAssetVersionId: "20000000-0000-4000-8000-000000000001",
        }),
      ),
    ).toThrow("does not bind");
  });
});

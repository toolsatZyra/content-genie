import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claim: vi.fn(),
  complete: vi.fn(),
  environment: vi.fn(),
  fail: vi.fn(),
  fetch: vi.fn(),
  falRecovery: vi.fn(),
  policy: vi.fn(),
  promote: vi.fn(),
  quarantine: vi.fn(),
  recordFetch: vi.fn(),
  scan: vi.fn(),
  narration: vi.fn(),
  nextPlan: vi.fn(),
  plan: vi.fn(),
}));

vi.mock("@/config/secure-ingest-cron-env", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/config/secure-ingest-cron-env")>();
  return { ...original, getSecureIngestCronEnvironment: mocks.environment };
});
vi.mock("@/security/remote-fetch", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/security/remote-fetch")>();
  return { ...original, fetchRemoteToQuarantineBuffer: mocks.fetch };
});
vi.mock("@/server/provider-broker-ledger", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/server/provider-broker-ledger")>();
  return {
    ...original,
    claimNextProviderOutputCandidate: mocks.claim,
    completeProviderOutputCandidate: mocks.complete,
    failProviderOutputCandidate: mocks.fail,
    getActiveRemoteFetchPolicy: mocks.policy,
    promoteProviderWorldAnchor: mocks.promote,
    quarantineProviderOutputBytes: mocks.quarantine,
    recordProviderRemoteFetch: mocks.recordFetch,
  };
});
vi.mock("@/server/sandbox-media-scanner", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/server/sandbox-media-scanner")>();
  return { ...original, scanAndReencodeWorldImage: mocks.scan };
});
vi.mock("@/server/narration-ingest", () => ({
  processNextNarrationIngest: mocks.narration,
}));
vi.mock("@/server/preflight-auto-reconciler", () => ({
  ensureNextPlanEvaluationRun: mocks.nextPlan,
  ensurePlanEvaluationRun: mocks.plan,
}));
vi.mock("@/server/fal-result-recovery", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/server/fal-result-recovery")>();
  return { ...original, recoverNextCompletedFalResult: mocks.falRecovery };
});

import { RemoteFetchPolicyError } from "@/security/remote-fetch";
import { SandboxMediaScannerError } from "@/server/sandbox-media-scanner";
import { GET } from "./route";

const secret = "c".repeat(48);
const claim = {
  authorityEpoch: 1,
  candidateId: "30000000-0000-4000-8000-000000000001",
  declaredMime: "image/png",
  empty: false,
  expectedHeight: 1792,
  expectedWidth: 1024,
  fencingToken: 1,
  leaseExpiresAt: "2026-07-19T01:00:00.000Z",
  leaseToken: "30000000-0000-4000-8000-000000000002",
  ok: true,
  preflightRunId: "30000000-0000-4000-8000-000000000003",
  providerRequestId: "30000000-0000-4000-8000-000000000004",
  remoteUrl: "https://v3.fal.media/files/result.png",
  remoteUrlSha256: "a".repeat(64),
  stageAttemptId: "30000000-0000-4000-8000-000000000005",
  targetAssetId: "30000000-0000-4000-8000-000000000006",
  workspaceId: "30000000-0000-4000-8000-000000000007",
};
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);

function request(value = `Bearer ${secret}`) {
  return new Request(
    "https://content-genie-three.vercel.app/api/cron/provider-output-ingest",
    {
      headers: { authorization: value },
    },
  );
}

describe("provider output secure-ingest cron", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.environment.mockReturnValue({ cronSecret: secret, environment: "test" });
    mocks.narration.mockResolvedValue(null);
    mocks.nextPlan.mockResolvedValue(null);
    mocks.falRecovery.mockResolvedValue({
      checked: false,
      providerRequestId: null,
      recovered: false,
    });
    mocks.plan.mockResolvedValue({
      configurationCandidateId: "30000000-0000-4000-8000-000000000014",
      preflightRunId: "30000000-0000-4000-8000-000000000015",
      shouldTrigger: true,
      state: "queued",
    });
    mocks.claim.mockResolvedValueOnce(claim).mockResolvedValueOnce(null);
    mocks.policy.mockResolvedValue({
      allowedHosts: ["v3.fal.media"],
      allowlistVersionId: "30000000-0000-4000-8000-000000000008",
      environment: "test",
      fetchClass: "provider_output",
      manifestHash: "b".repeat(64),
    });
    mocks.fetch.mockResolvedValue({
      bytes: png,
      canonicalUrl: claim.remoteUrl,
      contentType: "image/png",
      redirectCount: 0,
      resolvedAddressHashes: ["c".repeat(64)],
      sha256: "d".repeat(64),
    });
    mocks.recordFetch.mockResolvedValue("30000000-0000-4000-8000-000000000009");
    mocks.quarantine.mockResolvedValue({
      quarantineAssetVersionId: "30000000-0000-4000-8000-000000000010",
      state: "quarantined",
    });
    mocks.complete.mockResolvedValue(undefined);
    mocks.fail.mockResolvedValue(undefined);
    mocks.scan.mockResolvedValue({
      decompressedBytes: 1024,
      height: 1792,
      magicMime: "image/png",
      outputBytes: png,
      outputSha256: "e".repeat(64),
      probeSha256: "f".repeat(64),
      scanEngine: "ClamAV.ImageMagick",
      scanVersion: "scanner-v1",
      scannerTaskVersion: "genie-world-image-sandbox-v1",
      width: 1024,
    });
    mocks.promote.mockResolvedValue({
      assetVersionId: "30000000-0000-4000-8000-000000000011",
      worldVersionId: "30000000-0000-4000-8000-000000000012",
    });
  });

  it("rejects invalid authorization before claiming work", async () => {
    const result = await GET(request("Bearer wrong"));
    expect(result.status).toBe(401);
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it("fetches, quarantines, scans, and atomically promotes in order", async () => {
    const result = await GET(request());
    expect(result.status).toBe(200);
    await expect(result.json()).resolves.toEqual({
      claimed: 1,
      completed: 1,
      failed: 0,
      falRecoveryChecked: false,
      falRecoveryProviderRequestId: null,
      falRecovered: false,
      narrationCompleted: null,
      narrationJobId: null,
      ok: true,
      planQueued: false,
      planRunId: null,
    });
    expect(mocks.fetch.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.recordFetch.mock.invocationCallOrder[0]!,
    );
    expect(mocks.recordFetch.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.quarantine.mock.invocationCallOrder[0]!,
    );
    expect(mocks.quarantine.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.complete.mock.invocationCallOrder[0]!,
    );
    expect(mocks.complete.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.scan.mock.invocationCallOrder[0]!,
    );
    expect(mocks.scan.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.promote.mock.invocationCallOrder[0]!,
    );
  });

  it("rejects MIME confusion without writing or completing an asset", async () => {
    mocks.fetch.mockResolvedValue({
      bytes: png,
      canonicalUrl: claim.remoteUrl,
      contentType: "image/jpeg",
      redirectCount: 0,
      resolvedAddressHashes: ["c".repeat(64)],
      sha256: "d".repeat(64),
    });
    const result = await GET(request());
    expect(result.status).toBe(200);
    await expect(result.json()).resolves.toEqual({
      claimed: 1,
      completed: 0,
      failed: 1,
      falRecoveryChecked: false,
      falRecoveryProviderRequestId: null,
      falRecovered: false,
      narrationCompleted: null,
      narrationJobId: null,
      ok: true,
      planQueued: false,
      planRunId: null,
    });
    expect(mocks.recordFetch).not.toHaveBeenCalled();
    expect(mocks.quarantine).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.fail).toHaveBeenCalledWith(
      expect.objectContaining({
        retryable: false,
        safeErrorClass: "provider_output_media_mismatch",
      }),
    );
  });

  it.each([
    ["malformed", Buffer.from("MZ-not-an-image"), "image/png"],
    ["wrong magic", png, "image/webp"],
  ])(
    "rejects %s provider media before quarantine or promotion",
    async (_name, bytes, contentType) => {
      mocks.fetch.mockResolvedValue({
        bytes,
        canonicalUrl: claim.remoteUrl,
        contentType,
        redirectCount: 0,
        resolvedAddressHashes: ["c".repeat(64)],
        sha256: "d".repeat(64),
      });
      const result = await GET(request());
      expect(result.status).toBe(200);
      expect(mocks.quarantine).not.toHaveBeenCalled();
      expect(mocks.complete).not.toHaveBeenCalled();
      expect(mocks.promote).not.toHaveBeenCalled();
      expect(mocks.fail).toHaveBeenCalledWith(
        expect.objectContaining({
          retryable: false,
          safeErrorClass: "provider_output_media_mismatch",
        }),
      );
    },
  );

  it("keeps oversized provider output out of quarantine and authority", async () => {
    mocks.fetch.mockRejectedValue(
      new RemoteFetchPolicyError(
        "Provider output exceeded the byte limit.",
        "remote_fetch_size_limit",
        false,
      ),
    );
    const result = await GET(request());
    expect(result.status).toBe(200);
    expect(mocks.quarantine).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.promote).not.toHaveBeenCalled();
    expect(mocks.fail).toHaveBeenCalledWith(
      expect.objectContaining({
        retryable: false,
        safeErrorClass: "remote_fetch_size_limit",
      }),
    );
  });

  it("rejects a quarantined malformed container without promotion", async () => {
    mocks.scan.mockRejectedValue(
      new SandboxMediaScannerError(
        "The image container was malformed.",
        "media.container_malformed",
      ),
    );
    const result = await GET(request());
    expect(result.status).toBe(200);
    expect(mocks.quarantine).toHaveBeenCalledOnce();
    expect(mocks.complete).toHaveBeenCalledOnce();
    expect(mocks.promote).not.toHaveBeenCalled();
    expect(mocks.fail).toHaveBeenCalledWith(
      expect.objectContaining({
        retryable: false,
        safeErrorClass: "media.container_malformed",
      }),
    );
  });

  it("uses an idle image-ingest invocation for one narration", async () => {
    mocks.claim.mockReset().mockResolvedValue(null);
    mocks.narration.mockResolvedValue({
      completed: true,
      jobId: "30000000-0000-4000-8000-000000000013",
      narrationPreflightRunId: "30000000-0000-4000-8000-000000000003",
      workspaceId: "30000000-0000-4000-8000-000000000007",
    });
    const result = await GET(request());
    await expect(result.json()).resolves.toEqual({
      claimed: 0,
      completed: 0,
      failed: 0,
      falRecoveryChecked: false,
      falRecoveryProviderRequestId: null,
      falRecovered: false,
      narrationCompleted: true,
      narrationJobId: "30000000-0000-4000-8000-000000000013",
      ok: true,
      planQueued: true,
      planRunId: "30000000-0000-4000-8000-000000000015",
    });
  });

  it("resumes a completed narration whose plan enqueue was interrupted", async () => {
    mocks.claim.mockReset().mockResolvedValue(null);
    mocks.nextPlan.mockResolvedValue({
      configurationCandidateId: "30000000-0000-4000-8000-000000000014",
      preflightRunId: "30000000-0000-4000-8000-000000000015",
      shouldTrigger: true,
      state: "queued",
    });
    const result = await GET(request());
    await expect(result.json()).resolves.toMatchObject({
      narrationCompleted: null,
      planQueued: true,
      planRunId: "30000000-0000-4000-8000-000000000015",
    });
  });

  it("uses an idle invocation to recover a completed FAL result before narration", async () => {
    mocks.claim.mockReset().mockResolvedValue(null);
    mocks.falRecovery.mockResolvedValue({
      checked: true,
      providerRequestId: claim.providerRequestId,
      recovered: true,
    });
    const result = await GET(request());
    await expect(result.json()).resolves.toEqual({
      claimed: 0,
      completed: 0,
      failed: 0,
      falRecoveryChecked: true,
      falRecoveryProviderRequestId: claim.providerRequestId,
      falRecovered: true,
      narrationCompleted: null,
      narrationJobId: null,
      ok: true,
      planQueued: false,
      planRunId: null,
    });
    expect(mocks.narration).not.toHaveBeenCalled();
  });
});

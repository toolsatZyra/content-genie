import { describe, expect, it, vi } from "vitest";

import { settleWorldPromotion } from "./world-promotion-recovery";

describe("World promotion receipt recovery", () => {
  it("returns the first successful promotion without reconciliation", async () => {
    const attemptPromotion = vi.fn().mockResolvedValue({ assetVersionId: "asset-1" });
    const isCommitted = vi.fn();

    await expect(
      settleWorldPromotion({
        attemptPromotion,
        isCommitted,
        shouldRetry: () => true,
      }),
    ).resolves.toEqual({ assetVersionId: "asset-1" });
    expect(isCommitted).not.toHaveBeenCalled();
  });

  it("accepts an exact committed receipt after a lost response", async () => {
    const timeout = new Error("upstream request timeout");
    const attemptPromotion = vi.fn().mockRejectedValue(timeout);

    await expect(
      settleWorldPromotion({
        attemptPromotion,
        isCommitted: vi.fn().mockResolvedValue(true),
        shouldRetry: () => true,
      }),
    ).resolves.toBeNull();
    expect(attemptPromotion).toHaveBeenCalledTimes(1);
  });

  it("replays a retryable promotion with the same caller inputs", async () => {
    const timeout = new Error("upstream request timeout");
    const attemptPromotion = vi
      .fn()
      .mockRejectedValueOnce(timeout)
      .mockResolvedValueOnce({ assetVersionId: "asset-1" });
    const wait = vi.fn().mockResolvedValue(undefined);

    await expect(
      settleWorldPromotion({
        attemptPromotion,
        isCommitted: vi.fn().mockResolvedValue(false),
        retryDelaysMs: [300],
        shouldRetry: () => true,
        wait,
      }),
    ).resolves.toEqual({ assetVersionId: "asset-1" });
    expect(attemptPromotion).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(300);
  });

  it("does not replay a definitive authority conflict", async () => {
    const conflict = new Error("authority conflict");
    const attemptPromotion = vi.fn().mockRejectedValue(conflict);

    await expect(
      settleWorldPromotion({
        attemptPromotion,
        isCommitted: vi.fn().mockResolvedValue(false),
        shouldRetry: () => false,
      }),
    ).rejects.toBe(conflict);
    expect(attemptPromotion).toHaveBeenCalledTimes(1);
  });

  it("reconciles a commit that lands after one bounded replay", async () => {
    const timeout = new Error("upstream request timeout");
    const attemptPromotion = vi.fn().mockRejectedValue(timeout);
    const isCommitted = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await expect(
      settleWorldPromotion({
        attemptPromotion,
        isCommitted,
        retryDelaysMs: [300],
        shouldRetry: () => true,
        wait: vi.fn().mockResolvedValue(undefined),
      }),
    ).resolves.toBeNull();
    expect(attemptPromotion).toHaveBeenCalledTimes(2);
  });
});

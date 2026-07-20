import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();

vi.mock("@/config/server-env", () => ({
  getServerEnvironment: () => ({ environment: "preview" }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ rpc }),
}));

import {
  ensureProductionVideoCapabilities,
  QUALIFIED_VIDEO_PROFILES,
} from "./production-video-capabilities";

const id = (suffix: string) => `10000000-0000-4000-8000-${suffix.padStart(12, "0")}`;

describe("authenticated production video capabilities", () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockImplementation(async (_name: string, input: Record<string, unknown>) => {
      const index = QUALIFIED_VIDEO_PROFILES.findIndex(
        ({ profileKey }) => profileKey === input.p_profile_key,
      );
      return {
        data: {
          capabilityVersionId: id(String(index + 1)),
          expiresAt: "2099-10-17T13:06:06.255Z",
          ok: true,
          profileKey: input.p_profile_key,
          rateCardVersionId: id(String(index + 11)),
        },
        error: null,
      };
    });
  });

  it("pins every preferred motion class to its qualified profile", async () => {
    const result = await ensureProductionVideoCapabilities(id("99"));
    expect(Object.keys(result).sort()).toEqual([
      "camera_led",
      "complex_general",
      "simple_camera_subject",
    ]);
    expect(result.simple_camera_subject.profileKey).toBe(
      "kling-2.5-simple-camera-subject",
    );
    expect(result.camera_led.profileKey).toBe("kling-3-camera-led");
    expect(result.complex_general.profileKey).toBe("seedance-2-complex-general");
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({
      p_environment: "preview",
      p_expires_at: "2026-10-17T13:06:06.255Z",
    });
  });

  it("fails closed when any database qualification fails", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "rejected" } });
    await expect(ensureProductionVideoCapabilities(id("99"))).rejects.toThrow(
      "could not be qualified",
    );
  });

  it("rejects stale or substituted capability receipts", async () => {
    rpc.mockResolvedValueOnce({
      data: {
        capabilityVersionId: id("1"),
        expiresAt: "2020-01-01T00:00:00.000Z",
        ok: true,
        profileKey: "substituted-profile",
        rateCardVersionId: id("11"),
      },
      error: null,
    });
    await expect(ensureProductionVideoCapabilities(id("99"))).rejects.toThrow(
      "stale or malformed",
    );
  });
});

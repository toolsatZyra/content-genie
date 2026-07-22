import { describe, expect, it } from "vitest";

import {
  compileMvpVideoRequest,
  MvpStoryboardProductionError,
} from "./mvp-storyboard-production";

const storyboard = "https://media.example.test/storyboard.png?token=signed";
const frameId = "10000000-0000-4000-8000-000000000001";
const motion =
  "Rama raises the bow while the camera makes one restrained forward move.";

describe("MVP storyboard video request compiler", () => {
  it("uses Kling 2.5 with the next sufficient duration for simple motion", () => {
    const result = compileMvpVideoRequest({
      compositionMode: "single_frame",
      expectedProviderDurationMs: 5_000,
      motionClass: "simple_camera_subject",
      prompt: motion,
      retainedDurationMs: 4_300,
      storyboardFrameId: frameId,
      storyboardUrl: storyboard,
    });

    expect(result.endpoint).toBe("fal-ai/kling-video/v2.5-turbo/pro/image-to-video");
    expect(result.payload).toMatchObject({
      duration: "5",
      image_url: storyboard,
      prompt: motion,
    });
  });

  it("uses Kling 3 for camera-led motion and retains the storyboard as start frame", () => {
    const result = compileMvpVideoRequest({
      compositionMode: "single_frame",
      expectedProviderDurationMs: 8_000,
      motionClass: "camera_led",
      prompt: motion,
      retainedDurationMs: 7_200,
      storyboardFrameId: frameId,
      storyboardUrl: storyboard,
    });

    expect(result.endpoint).toBe("fal-ai/kling-video/v3/pro/image-to-video");
    expect(result.payload).toMatchObject({
      duration: "8",
      start_image_url: storyboard,
    });
  });

  it("uses Seedance image-to-video for complex full-frame motion", () => {
    const result = compileMvpVideoRequest({
      compositionMode: "single_frame",
      expectedProviderDurationMs: 4_000,
      motionClass: "complex_general",
      prompt: motion,
      retainedDurationMs: 3_200,
      storyboardFrameId: frameId,
      storyboardUrl: storyboard,
    });

    expect(result.endpoint).toBe("bytedance/seedance-2.0/image-to-video");
    expect(result.payload).toMatchObject({
      duration: "4",
      image_url: storyboard,
    });
  });

  it("keeps a legacy split board readable but blocks it before provider compilation", () => {
    expect(() =>
      compileMvpVideoRequest({
        compositionMode: "split_screen_two_state",
        expectedProviderDurationMs: 6_000,
        motionClass: "complex_general",
        prompt: motion,
        retainedDurationMs: 5_100,
        storyboardFrameId: frameId,
        storyboardUrl: storyboard,
      }),
    ).toThrowError(
      expect.objectContaining({
        safeCode: "PRODUCTION_STORYBOARD_MIGRATION_REQUIRED",
      }),
    );
  });

  it("sends separate clean start and end frames through Seedance image-to-video", () => {
    const endStoryboard = "https://media.example.test/storyboard-end.png?token=signed";
    const result = compileMvpVideoRequest({
      compositionMode: "two_state_start_end",
      expectedProviderDurationMs: 6_000,
      motionClass: "complex_general",
      prompt: motion,
      retainedDurationMs: 5_100,
      storyboardEndFrameId: "10000000-0000-4000-8000-000000000002",
      storyboardEndUrl: endStoryboard,
      storyboardFrameId: frameId,
      storyboardUrl: storyboard,
    });

    expect(result.endpoint).toBe("bytedance/seedance-2.0/image-to-video");
    expect(result.payload).toMatchObject({
      duration: "6",
      end_image_url: endStoryboard,
      image_url: storyboard,
      prompt: motion,
    });
    expect(result.payload).not.toHaveProperty("image_urls");
  });

  it("rejects a two-state video request without two distinct frames", () => {
    expect(() =>
      compileMvpVideoRequest({
        compositionMode: "two_state_start_end",
        expectedProviderDurationMs: 6_000,
        motionClass: "complex_general",
        prompt: motion,
        retainedDurationMs: 5_100,
        storyboardFrameId: frameId,
        storyboardUrl: storyboard,
      }),
    ).toThrow(MvpStoryboardProductionError);
  });

  it("fails closed when the compiled provider quantum differs from the locked slot", () => {
    expect(() =>
      compileMvpVideoRequest({
        compositionMode: "single_frame",
        expectedProviderDurationMs: 4_000,
        motionClass: "simple_camera_subject",
        prompt: motion,
        retainedDurationMs: 3_200,
        storyboardFrameId: frameId,
        storyboardUrl: storyboard,
      }),
    ).toThrow(MvpStoryboardProductionError);
  });
});

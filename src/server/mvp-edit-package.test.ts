import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  admin: vi.fn(),
  createSandbox: vi.fn(),
  download: vi.fn(),
  loadEffectiveClips: vi.fn(),
  loadEffectiveStoryboards: vi.fn(),
  readFileToBuffer: vi.fn(),
  rpc: vi.fn(),
  runCommand: vi.fn(),
  stop: vi.fn(),
  upload: vi.fn(),
  writeFiles: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@vercel/sandbox", () => ({
  Sandbox: { create: mocks.createSandbox },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: mocks.admin,
}));
vi.mock("@/server/mvp-effective-production-assets", () => ({
  loadEffectiveClips: mocks.loadEffectiveClips,
  loadEffectiveStoryboards: mocks.loadEffectiveStoryboards,
}));

import { advanceNextMvpEditPackage } from "./mvp-edit-package";

const ids = {
  clip: "10000000-0000-4000-8000-000000000001",
  edd: "10000000-0000-4000-8000-000000000002",
  endFrame: "10000000-0000-4000-8000-000000000003",
  episode: "10000000-0000-4000-8000-000000000004",
  master: "10000000-0000-4000-8000-000000000005",
  package: "10000000-0000-4000-8000-000000000006",
  plan: "10000000-0000-4000-8000-000000000007",
  run: "10000000-0000-4000-8000-000000000008",
  startFrame: "10000000-0000-4000-8000-000000000009",
  workspace: "10000000-0000-4000-8000-000000000010",
} as const;

const objects = {
  clip: `${ids.workspace}/clips/shot-1.mp4`,
  endFrame: `${ids.workspace}/storyboards/shot-1-end.png`,
  master: `${ids.workspace}/masters/approved.mp4`,
  startFrame: `${ids.workspace}/storyboards/shot-1-start.png`,
} as const;

const bytes = {
  clip: Buffer.from("verified-clip-bytes"),
  endFrame: Buffer.from("verified-end-frame-bytes"),
  master: Buffer.from("verified-master-bytes"),
  startFrame: Buffer.from("verified-start-frame-bytes"),
} as const;

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function query(table: string) {
  const result =
    table === "mvp_episode_masters"
      ? {
          data: {
            attempt_number: 1,
            byte_length: bytes.master.length,
            content_sha256: sha256(bytes.master),
            duration_ms: 3_500,
            id: ids.master,
            object_name: objects.master,
            state: "approved",
          },
          error: null,
        }
      : table === "mvp_production_jobs"
        ? {
            data: { active_repair_request_id: null, plan_bundle_id: ids.plan },
            error: null,
          }
        : table === "preflight_plan_bundles"
          ? { data: { edd_version_id: ids.edd }, error: null }
          : table === "preflight_plan_component_versions"
            ? {
                data: {
                  content_hash: sha256("canonical-edd"),
                  payload: {
                    shots: [
                      {
                        endMs: 3_500,
                        endScalar: 18,
                        exactNarration: "राम ने धनुष उठाया।",
                        shotNumber: 1,
                        startMs: 0,
                        startScalar: 0,
                      },
                    ],
                  },
                },
                error: null,
              }
            : (() => {
                throw new Error(`Unexpected test table ${table}`);
              })();
  const chain = {
    eq: vi.fn(() => chain),
    select: vi.fn(() => chain),
    single: vi.fn(async () => result),
  };
  return chain;
}

describe("MVP approved edit package provenance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runCommand.mockResolvedValue({
      exitCode: 0,
      stdout: vi.fn().mockResolvedValue(""),
    });
    mocks.stop.mockResolvedValue(undefined);
    mocks.writeFiles.mockResolvedValue(undefined);
    mocks.readFileToBuffer.mockResolvedValue(Buffer.alloc(2_048, 1));
    mocks.createSandbox.mockResolvedValue({
      readFileToBuffer: mocks.readFileToBuffer,
      runCommand: mocks.runCommand,
      stop: mocks.stop,
      writeFiles: mocks.writeFiles,
    });
    mocks.loadEffectiveClips.mockResolvedValue([
      {
        attempt_number: 1,
        byte_length: bytes.clip.length,
        content_sha256: sha256(bytes.clip),
        duration_ms: 3_500,
        end_ms: 3_500,
        id: ids.clip,
        model_key: "bytedance/seedance-2.0/image-to-video",
        object_name: objects.clip,
        reference_asset_version_id: ids.startFrame,
        shot_number: 1,
        start_ms: 0,
        state: "complete",
        storyboard_end_frame_id: ids.endFrame,
        storyboard_frame_id: ids.startFrame,
      },
    ]);
    mocks.loadEffectiveStoryboards.mockResolvedValue([
      {
        end: {
          attempt_number: 1,
          content_sha256: sha256(bytes.endFrame),
          endpoint: "fal-ai/nano-banana-2/edit",
          frame_role: "end",
          id: ids.endFrame,
          media_mime: "image/png",
          model_key: "nano-banana-2",
          object_name: objects.endFrame,
          shot_number: 1,
          state: "complete",
        },
        primary: {
          attempt_number: 1,
          content_sha256: sha256(bytes.startFrame),
          endpoint: "fal-ai/nano-banana-2/edit",
          frame_role: "start",
          id: ids.startFrame,
          media_mime: "image/png",
          model_key: "nano-banana-2",
          object_name: objects.startFrame,
          shot_number: 1,
          state: "complete",
        },
      },
    ]);
    mocks.download.mockImplementation(async (objectName: string) => {
      const entry = Object.entries(objects).find(([, value]) => value === objectName);
      if (!entry) throw new Error(`Unexpected storage object ${objectName}`);
      const value = bytes[entry[0] as keyof typeof bytes];
      return { data: new Blob([Uint8Array.from(value)]), error: null };
    });
    mocks.upload.mockResolvedValue({ error: null });
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "claim_next_mvp_edit_package") {
        return {
          data: {
            attempt_number: 1,
            claim_token: "lease-token",
            episode_id: ids.episode,
            id: ids.package,
            master_id: ids.master,
            master_version: 4,
            production_run_id: ids.run,
            version: 7,
            workspace_id: ids.workspace,
          },
          error: null,
        };
      }
      if (name === "complete_mvp_edit_package") {
        return { data: { state: "ready" }, error: null };
      }
      if (name === "fail_mvp_edit_package") {
        return { data: { state: "failed" }, error: null };
      }
      throw new Error(`Unexpected test RPC ${name}`);
    });
    mocks.admin.mockReturnValue({
      from: vi.fn(query),
      rpc: mocks.rpc,
      storage: {
        from: vi.fn(() => ({ download: mocks.download, upload: mocks.upload })),
      },
    });
  });

  it("binds the approved EDD, exact narration windows, and every used asset", async () => {
    await expect(advanceNextMvpEditPackage()).resolves.toMatchObject({
      advanced: true,
      packageId: ids.package,
      state: "ready",
    });

    const writtenFiles = mocks.writeFiles.mock.calls.flatMap(([files]) => files);
    const manifestFile = writtenFiles.find(
      (file: { path: string }) => file.path === "/vercel/sandbox/manifest.json",
    ) as { content: Buffer; path: string } | undefined;
    expect(manifestFile).toBeDefined();
    const manifest = JSON.parse(manifestFile!.content.toString()) as Record<
      string,
      unknown
    >;

    expect(manifest).toMatchObject({
      approvedEdd: {
        contentSha256: sha256("canonical-edd"),
        identityKind: "preflight_edd_version",
        versionId: ids.edd,
      },
      files: [
        {
          path: "approved-master.mp4",
          sha256: sha256(bytes.master),
        },
        {
          path: "video-clips/shot-001.mp4",
          sha256: sha256(bytes.clip),
        },
        {
          path: "storyboard-images/shot-001-start.png",
          sha256: sha256(bytes.startFrame),
        },
        {
          path: "storyboard-images/shot-001-end.png",
          sha256: sha256(bytes.endFrame),
        },
      ],
      format: "genie-approved-edit-package.v2",
      masterContentSha256: sha256(bytes.master),
      masterId: ids.master,
      shots: [
        {
          clip: {
            assetId: ids.clip,
            contentSha256: sha256(bytes.clip),
            modelEndpoint: "bytedance/seedance-2.0/image-to-video",
            provider: "fal",
          },
          endMs: 3_500,
          exactNarration: "राम ने धनुष उठाया।",
          scriptScalarWindow: { endExclusive: 18, startInclusive: 0 },
          shotNumber: 1,
          sourceImages: [
            {
              assetId: ids.startFrame,
              contentSha256: sha256(bytes.startFrame),
              modelEndpoint: "nano-banana-2",
              provider: "fal",
              providerEndpoint: "fal-ai/nano-banana-2/edit",
              role: "start",
            },
            {
              assetId: ids.endFrame,
              contentSha256: sha256(bytes.endFrame),
              modelEndpoint: "nano-banana-2",
              provider: "fal",
              providerEndpoint: "fal-ai/nano-banana-2/edit",
              role: "end",
            },
          ],
          startMs: 0,
          storyboardEndFrameId: ids.endFrame,
          storyboardFrameId: ids.startFrame,
        },
      ],
    });
    expect(mocks.stop).toHaveBeenCalledOnce();
  });

  it("fails closed when a selected clip disagrees with the approved EDD clock", async () => {
    const [clip] = await mocks.loadEffectiveClips();
    mocks.loadEffectiveClips.mockResolvedValueOnce([{ ...clip, end_ms: 3_400 }]);

    await expect(advanceNextMvpEditPackage()).rejects.toMatchObject({
      safeCode: "EDIT_PACKAGE_TIMELINE_MISMATCH",
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "fail_mvp_edit_package",
      expect.objectContaining({
        p_claim_token: "lease-token",
        p_error_code: "EDIT_PACKAGE_TIMELINE_MISMATCH",
        p_package_id: ids.package,
      }),
    );
  });
});

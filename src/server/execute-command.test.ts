import type { SupabaseClient, User } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { findLook } from "@/domain/look/look-registry";
import { voiceForGender } from "@/domain/voice/voice-registry";
import {
  CommandValidationError,
  type ParsedCommand,
} from "@/security/command-envelope";

import { executeCommand } from "./execute-command";

const user = { id: "10000000-0000-4000-8000-000000000101" } as User;
const workspaceId = "10000000-0000-4000-8000-000000000102";
const configurationCandidateId = "10000000-0000-4000-8000-000000000103";
const episodeId = "10000000-0000-4000-8000-000000000104";

describe("executeCommand local validation", () => {
  it.each<Readonly<{ command: ParsedCommand; label: string }>>([
    {
      command: {
        commandType: "series.create",
        payload: {
          description: "",
          ownerUserId: user.id,
          slug: "Not a slug",
          title: "Series",
          workspaceId,
        },
      },
      label: "invalid Series slug",
    },
    {
      command: {
        commandType: "invitation.create",
        payload: {
          email: "not-an-email",
          maximumRole: "member",
          workspaceId,
        },
      },
      label: "invalid invitation email",
    },
    {
      command: {
        commandType: "invitation.create",
        payload: {
          email: "member@example.com",
          maximumRole: "admin",
          workspaceId,
        },
      },
      label: "invalid invitation role",
    },
    {
      command: {
        commandType: "episode.voice.select",
        payload: {
          configurationCandidateId: "10000000-0000-4000-8000-000000000103",
          episodeId: "10000000-0000-4000-8000-000000000104",
          expectedCandidateVersion: 1,
          narratorGender: "unknown",
          voiceVersionId: "ec4e61a6-dc45-53d9-ba4b-fd5c7f267b2f",
          workspaceId,
        },
      } as unknown as ParsedCommand,
      label: "invalid narrator gender",
    },
  ])("classifies $label as a definitive validation error", async ({ command }) => {
    const rpc = vi.fn();
    const client = { rpc } as unknown as SupabaseClient;

    await expect(
      executeCommand(client, user, command, "local-validation-0001"),
    ).rejects.toBeInstanceOf(CommandValidationError);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("explicit default confirmation commands", () => {
  it.each([
    {
      commandType: "episode.voice.select" as const,
      expectedRpc: "command_select_episode_voice",
      payload: {
        configurationCandidateId,
        episodeId,
        expectedCandidateVersion: 1,
        narratorGender: "male",
        voiceVersionId: voiceForGender("male").versionId,
        workspaceId,
      },
    },
    {
      commandType: "episode.look.select" as const,
      expectedRpc: "command_select_episode_look",
      payload: {
        configurationCandidateId,
        episodeId,
        expectedCandidateVersion: 1,
        lookVersionId: findLook("glowing-divine-realism")?.versionId,
        workspaceId,
      },
    },
  ])(
    "sends an explicit $commandType even when it confirms the system default",
    async ({ commandType, expectedRpc, payload }) => {
      const rpc = vi.fn(async () => ({ data: { ok: true }, error: null }));
      const client = { rpc } as unknown as SupabaseClient;

      await executeCommand(
        client,
        user,
        { commandType, payload } as ParsedCommand,
        `confirm-default-${commandType}`,
      );

      expect(rpc).toHaveBeenCalledWith(
        expectedRpc,
        expect.objectContaining({
          p_configuration_candidate_id: configurationCandidateId,
          p_episode_id: episodeId,
          p_expected_candidate_version: 1,
          p_workspace_id: workspaceId,
        }),
      );
    },
  );
});

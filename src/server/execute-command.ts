import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient, User } from "@supabase/supabase-js";

import { getServerEnvironment } from "@/config/server-env";
import {
  boundedText,
  CommandValidationError,
  deriveInvitationToken,
  hashCommand,
  integerValue,
  newCommandIdentity,
  type ParsedCommand,
  uuidValue,
} from "@/security/command-envelope";

interface CommandResult {
  readonly inviteToken?: string;
  readonly result: unknown;
}

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function commandBase(command: ParsedCommand, idempotencyKey: string) {
  const identity = newCommandIdentity();
  return {
    p_command_id: identity.commandId,
    p_correlation_id: identity.correlationId,
    p_idempotency_key: idempotencyKey,
    p_request_hash: hashCommand(command),
  };
}

async function rpc(
  client: SupabaseClient,
  name: string,
  parameters: Record<string, unknown>,
): Promise<unknown> {
  const { data, error } = await client.rpc(name, parameters);
  if (error) throw error;
  return data;
}

export async function executeCommand(
  client: SupabaseClient,
  user: User,
  command: ParsedCommand,
  idempotencyKey: string,
): Promise<CommandResult> {
  const payload = command.payload;
  const base = commandBase(command, idempotencyKey);

  switch (command.commandType) {
    case "series.create": {
      const title = boundedText(payload, "title", 200);
      const requestedSlug = boundedText(payload, "slug", 120).toLowerCase();
      if (!slugPattern.test(requestedSlug)) throw new Error("slug is invalid.");
      return {
        result: await rpc(client, "command_create_series", {
          ...base,
          p_description: boundedText(payload, "description", 4000, false),
          p_owner_user_id: uuidValue(payload, "ownerUserId", user.id),
          p_slug: requestedSlug,
          p_title: title,
          p_workspace_id: uuidValue(payload, "workspaceId"),
        }),
      };
    }
    case "episode.create":
      return {
        result: await rpc(client, "command_create_episode", {
          ...base,
          p_owner_user_id: uuidValue(payload, "ownerUserId", user.id),
          p_series_id: uuidValue(payload, "seriesId"),
          p_summary: boundedText(payload, "summary", 4000, false),
          p_title: boundedText(payload, "title", 240),
          p_workspace_id: uuidValue(payload, "workspaceId"),
        }),
      };
    case "series.archive":
      return {
        result: await rpc(client, "command_archive_series", {
          ...base,
          p_expected_version: integerValue(
            payload,
            "expectedVersion",
            1,
            Number.MAX_SAFE_INTEGER,
          ),
          p_series_id: uuidValue(payload, "seriesId"),
          p_workspace_id: uuidValue(payload, "workspaceId"),
        }),
      };
    case "work.claim":
      return {
        result: await rpc(client, "command_claim_work_item", {
          ...base,
          p_lease_seconds: integerValue(payload, "leaseSeconds", 60, 1800),
          p_work_item_id: uuidValue(payload, "workItemId"),
          p_workspace_id: uuidValue(payload, "workspaceId"),
        }),
      };
    case "invitation.create": {
      const email = boundedText(payload, "email", 320).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new Error("email is invalid.");
      }
      const maximumRole = payload.maximumRole;
      if (maximumRole !== "member" && maximumRole !== "reviewer") {
        throw new Error("maximumRole is invalid.");
      }
      const workspaceId = uuidValue(payload, "workspaceId");
      const invitationSecret = getServerEnvironment().supabaseServiceRoleKey;
      if (!invitationSecret) {
        throw new CommandValidationError("Invitation service is unavailable.");
      }
      const token = deriveInvitationToken(invitationSecret, {
        actorUserId: user.id,
        idempotencyKey,
        invitedEmail: email,
        maximumRole,
        workspaceId,
      });
      const result = await rpc(client, "command_create_invitation", {
        ...base,
        p_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        p_invited_email: email,
        p_maximum_role: maximumRole,
        p_token_hash: token.hash,
        p_workspace_id: workspaceId,
      });
      return { inviteToken: token.token, result };
    }
    case "invitation.accept": {
      const token = boundedText(payload, "token", 128);
      return {
        result: await rpc(client, "command_accept_invitation", {
          ...base,
          p_token_hash: createHash("sha256").update(token).digest("hex"),
        }),
      };
    }
    case "membership.offboard": {
      const targetUserId = uuidValue(payload, "targetUserId");
      const replacementUserId = uuidValue(payload, "replacementUserId");
      if (targetUserId === replacementUserId) {
        throw new CommandValidationError(
          "replacementUserId must identify a different active member.",
        );
      }
      return {
        result: await rpc(client, "command_offboard_member", {
          ...base,
          p_expected_authority_epoch: integerValue(
            payload,
            "expectedAuthorityEpoch",
            1,
            Number.MAX_SAFE_INTEGER,
          ),
          p_reason: boundedText(payload, "reason", 1000),
          p_replacement_user_id: replacementUserId,
          p_target_user_id: targetUserId,
          p_workspace_id: uuidValue(payload, "workspaceId"),
        }),
      };
    }
  }
}

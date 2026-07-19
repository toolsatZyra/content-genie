import { describe, expect, it } from "vitest";

import {
  assertExactPayloadKeys,
  boundedText,
  canonicalJson,
  CommandValidationError,
  deriveInvitationToken,
  hashCommand,
  integerValue,
  newCommandIdentity,
  parseCommand,
  parseIdempotencyKey,
  uuidValue,
} from "@/security/command-envelope";

describe("command envelope", () => {
  it("canonicalizes nested object keys without reordering arrays", () => {
    expect(canonicalJson({ z: [{ b: 2, a: 1 }], a: "first" })).toBe(
      '{"a":"first","z":[{"a":1,"b":2}]}',
    );
    expect(
      hashCommand({
        commandType: "series.create",
        payload: { title: "Shiva", workspaceId: "one" },
      }),
    ).toMatch(/^[a-f0-9]{64}$/);
  });

  it("creates opaque command identities and deterministic invitation retries", () => {
    const identity = newCommandIdentity();
    expect(identity.commandId).not.toBe(identity.correlationId);
    expect(uuidValue({ id: identity.commandId }, "id")).toBe(identity.commandId);
    const input = {
      actorUserId: "20000000-0000-0000-0000-000000000003",
      idempotencyKey: "invite-create-0001",
      invitedEmail: "Member@Zyra.test",
      maximumRole: "member" as const,
      workspaceId: "10000000-0000-0000-0000-000000000101",
    };
    const invitation = deriveInvitationToken("s".repeat(32), input);
    expect(invitation).toEqual(deriveInvitationToken("s".repeat(32), input));
    expect(invitation.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(invitation.token).not.toContain("=");
    expect(deriveInvitationToken("t".repeat(32), input).token).not.toBe(
      invitation.token,
    );
    expect(
      deriveInvitationToken("s".repeat(32), {
        ...input,
        workspaceId: "10000000-0000-0000-0000-000000000102",
      }).token,
    ).not.toBe(invitation.token);
    expect(() => deriveInvitationToken("short", input)).toThrow(CommandValidationError);
  });

  it("accepts only allowlisted commands and object payloads", () => {
    expect(
      parseCommand({ commandType: "episode.create", payload: { title: "Ganga" } }),
    ).toMatchObject({ commandType: "episode.create" });
    expect(() => parseCommand(null)).toThrow(CommandValidationError);
    expect(() => parseCommand({ commandType: "episode.delete", payload: {} })).toThrow(
      "Unsupported command type",
    );
    expect(() => parseCommand({ commandType: "episode.create", payload: [] })).toThrow(
      "payload",
    );
  });

  it("validates actor-scoped idempotency keys", () => {
    expect(parseIdempotencyKey("episode:create:123")).toBe("episode:create:123");
    for (const value of [null, "short", "contains space", ".bad-prefix"]) {
      expect(() => parseIdempotencyKey(value)).toThrow(CommandValidationError);
    }
  });

  it("bounds text, UUID and integer values", () => {
    expect(boundedText({ title: "  story  " }, "title", 10)).toBe("story");
    expect(boundedText({}, "note", 10, false)).toBe("");
    expect(() => boundedText({}, "title", 10)).toThrow("title");
    expect(() => boundedText({ title: "too long" }, "title", 3)).toThrow("title");
    expect(integerValue({ version: 2 }, "version", 1, 3)).toBe(2);
    expect(() => integerValue({ version: 2.5 }, "version", 1, 3)).toThrow("version");
    expect(() => uuidValue({ id: "not-a-uuid" }, "id")).toThrow("UUID");
  });

  it("rejects missing or model-invented command fields", () => {
    expect(() =>
      assertExactPayloadKeys({ episodeId: "one", workspaceId: "two" }, [
        "episodeId",
        "workspaceId",
      ]),
    ).not.toThrow();
    expect(() =>
      assertExactPayloadKeys({ approval: true, episodeId: "one", workspaceId: "two" }, [
        "episodeId",
        "workspaceId",
      ]),
    ).toThrow("exactly");
  });
});

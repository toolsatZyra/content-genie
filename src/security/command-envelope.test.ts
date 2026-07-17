import { describe, expect, it } from "vitest";

import {
  boundedText,
  canonicalJson,
  CommandValidationError,
  hashCommand,
  integerValue,
  newCommandIdentity,
  newInvitationToken,
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

  it("creates opaque command and invitation identities", () => {
    const identity = newCommandIdentity();
    expect(identity.commandId).not.toBe(identity.correlationId);
    expect(uuidValue({ id: identity.commandId }, "id")).toBe(identity.commandId);
    const invitation = newInvitationToken();
    expect(invitation.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(invitation.token).not.toContain("=");
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
});

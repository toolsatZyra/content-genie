import { describe, expect, it } from "vitest";

import {
  mutationRpcFailureStatus,
  parseScriptLockRequest,
  prepareScriptLockCommand,
} from "./script-lock";

const workspaceId = "10000000-0000-4000-8000-000000000001";
const episodeId = "10000000-0000-4000-8000-000000000002";

describe("the exact script-lock command", () => {
  it("only treats explicit database domain failures as definitive", () => {
    expect(mutationRpcFailureStatus({ code: "40001" })).toBe(409);
    expect(mutationRpcFailureStatus({ code: "23514" })).toBe(400);
    expect(mutationRpcFailureStatus({ code: "P0001" })).toBe(400);
    expect(mutationRpcFailureStatus({ code: "P0002" })).toBe(400);
    expect(mutationRpcFailureStatus({ code: "55P03" })).toBe(503);
    expect(mutationRpcFailureStatus({ code: "08006" })).toBe(503);
    expect(mutationRpcFailureStatus({ code: "XX000" })).toBe(503);
    expect(mutationRpcFailureStatus({ code: "" })).toBe(503);
    expect(mutationRpcFailureStatus(new TypeError("fetch failed"))).toBe(503);
  });

  it("never trims or rewrites the authoritative raw input", () => {
    const request = parseScriptLockRequest({
      durationAcknowledged: true,
      episodeId,
      expectedEpisodeVersion: 4,
      rawText: "  शिव कथा\r\nसमाप्त  ",
      workspaceId,
    });
    if (request.sourceKind !== "browser_text") {
      throw new Error("Expected a browser-text request.");
    }
    const command = prepareScriptLockCommand(request, "script-lock-0001");

    expect(command.parameters).toMatchObject({
      p_processing_text: "  शिव कथा\nसमाप्त  ",
      p_raw_text: "  शिव कथा\r\nसमाप्त  ",
      p_raw_utf16_code_units: request.rawText.length,
    });
    expect(command.parameters.p_raw_utf8).toMatch(/^\\x[0-9a-f]+$/);
    expect(command.requestHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects missing, unknown, or type-coerced fields", () => {
    expect(() =>
      parseScriptLockRequest({
        approval: true,
        durationAcknowledged: true,
        episodeId,
        expectedEpisodeVersion: 4,
        rawText: "कथा",
        workspaceId,
      }),
    ).toThrow("exactly");
    expect(() =>
      parseScriptLockRequest({
        durationAcknowledged: "yes",
        episodeId,
        expectedEpisodeVersion: 4,
        rawText: "कथा",
        workspaceId,
      }),
    ).toThrow("boolean");
  });

  it("binds idempotent request hashes to every authoritative input", () => {
    const base = {
      durationAcknowledged: true,
      episodeId,
      expectedEpisodeVersion: 4,
      rawText: "कथा",
      workspaceId,
    };
    const left = prepareScriptLockCommand(
      parseScriptLockRequest(base),
      "script-lock-0002",
    );
    const right = prepareScriptLockCommand(
      parseScriptLockRequest({ ...base, rawText: "कथा " }),
      "script-lock-0002",
    );
    const differentKey = prepareScriptLockCommand(
      parseScriptLockRequest(base),
      "script-lock-0002-other",
    );
    expect(left.requestHash).not.toBe(right.requestHash);
    expect(left.requestHash).not.toBe(differentKey.requestHash);
  });

  it("derives uploaded text on the server and binds the preserved source bytes", () => {
    const original = Uint8Array.from([0xff, 0xfe, 0x15, 0x09, 0x25, 0x09]);
    const request = parseScriptLockRequest({
      durationAcknowledged: true,
      episodeId,
      expectedEpisodeVersion: 4,
      originalBytesBase64: Buffer.from(original).toString("base64"),
      sourceKind: "uploaded_text",
      workspaceId,
    });
    const command = prepareScriptLockCommand(request, "script-lock-upload-0001");

    expect(command.parameters).toMatchObject({
      p_original_source_bytes: `\\x${Buffer.from(original).toString("hex")}`,
      p_original_source_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      p_raw_text: "\u0915\u0925",
      p_source_encoding_evidence: {
        bom: "utf-16le",
        byteLength: original.byteLength,
        decoderProfile: "genie-uploaded-script-decoder.v1",
        encoding: "utf-16le",
        originalSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
      p_source_kind: "uploaded_text",
    });
  });

  it("rejects mixed uploaded/browser payloads and malformed upload bytes", () => {
    expect(() =>
      parseScriptLockRequest({
        durationAcknowledged: true,
        episodeId,
        expectedEpisodeVersion: 4,
        originalBytesBase64: Buffer.from("\u0915\u0925\u093e").toString("base64"),
        rawText: "different",
        sourceKind: "uploaded_text",
        workspaceId,
      }),
    ).toThrow("exactly");
    expect(() =>
      prepareScriptLockCommand(
        parseScriptLockRequest({
          durationAcknowledged: true,
          episodeId,
          expectedEpisodeVersion: 4,
          originalBytesBase64: "not base64",
          sourceKind: "uploaded_text",
          workspaceId,
        }),
        "script-lock-upload-0002",
      ),
    ).toThrow("canonical base64");
  });

  it.each([null, [], "text"])("rejects a non-object request body %j", (body) => {
    expect(() => parseScriptLockRequest(body)).toThrow(
      "Script lock body must be an object.",
    );
  });

  it("rejects non-string raw text and invalid acknowledgement/version values", () => {
    expect(() =>
      parseScriptLockRequest({
        durationAcknowledged: true,
        episodeId,
        expectedEpisodeVersion: 4,
        rawText: 17,
        workspaceId,
      }),
    ).toThrow("rawText must be an exact string.");
    expect(() =>
      parseScriptLockRequest({
        durationAcknowledged: false,
        episodeId,
        expectedEpisodeVersion: 0,
        rawText: "कथा",
        workspaceId,
      }),
    ).toThrow();
  });

  it("binds duration acknowledgement into the request hash", () => {
    const base = {
      durationAcknowledged: true,
      episodeId,
      expectedEpisodeVersion: 4,
      rawText: "कथा",
      workspaceId,
    };
    const acknowledged = prepareScriptLockCommand(
      parseScriptLockRequest(base),
      "script-lock-0003",
    );
    const unacknowledged = prepareScriptLockCommand(
      parseScriptLockRequest({ ...base, durationAcknowledged: false }),
      "script-lock-0003",
    );
    expect(acknowledged.requestHash).not.toBe(unacknowledged.requestHash);
  });
});

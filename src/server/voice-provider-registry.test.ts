import { describe, expect, it } from "vitest";

import { resolveVoiceProviderConfiguration } from "./voice-provider-registry";

describe("server-only voice provider registry", () => {
  it("resolves the exact supplied male identity by immutable version UUID", () => {
    expect(
      resolveVoiceProviderConfiguration("ec4e61a6-dc45-53d9-ba4b-fd5c7f267b2f"),
    ).toMatchObject({
      externalVoiceId: "b0oby86k6n7Uh5LZcOBR",
      gender: "male",
      providerAccountKey: "elevenlabs.primary",
    });
  });

  it("resolves the exact supplied female identity and never falls back", () => {
    expect(
      resolveVoiceProviderConfiguration("bb2db360-9e44-5e17-95d3-a1e38ef21fa7"),
    ).toMatchObject({
      externalVoiceId: "GSdeLRB8detpjZjN63Wn",
      gender: "female",
    });
    expect(() => resolveVoiceProviderConfiguration(crypto.randomUUID())).toThrow(
      "unavailable",
    );
  });
});

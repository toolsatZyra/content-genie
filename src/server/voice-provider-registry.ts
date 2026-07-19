import "server-only";

import type { NarratorGender } from "@/domain/voice/voice-registry";

export interface VoiceProviderConfiguration {
  readonly externalVoiceId: string;
  readonly gender: NarratorGender;
  readonly provider: "elevenlabs";
  readonly providerAccountKey: "elevenlabs.primary";
  readonly rightsBasis: "owner-supplied-internal-use";
  readonly versionId: string;
}

const VOICE_PROVIDER_CONFIGURATIONS = [
  {
    externalVoiceId: "b0oby86k6n7Uh5LZcOBR",
    gender: "male",
    provider: "elevenlabs",
    providerAccountKey: "elevenlabs.primary",
    rightsBasis: "owner-supplied-internal-use",
    versionId: "ec4e61a6-dc45-53d9-ba4b-fd5c7f267b2f",
  },
  {
    externalVoiceId: "GSdeLRB8detpjZjN63Wn",
    gender: "female",
    provider: "elevenlabs",
    providerAccountKey: "elevenlabs.primary",
    rightsBasis: "owner-supplied-internal-use",
    versionId: "bb2db360-9e44-5e17-95d3-a1e38ef21fa7",
  },
] as const satisfies readonly VoiceProviderConfiguration[];

const byVersionId = new Map<string, VoiceProviderConfiguration>(
  VOICE_PROVIDER_CONFIGURATIONS.map((voice) => [voice.versionId, voice]),
);

export function resolveVoiceProviderConfiguration(
  versionId: string,
): VoiceProviderConfiguration {
  const voice = byVersionId.get(versionId);
  if (!voice) throw new Error("The exact server voice configuration is unavailable.");
  return voice;
}

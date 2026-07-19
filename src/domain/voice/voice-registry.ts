import { GENIE_LAUNCH_PERFORMANCE_PROFILE } from "@/domain/profile/launch-profile";

export const VOICE_REGISTRY_VERSION = 1;
export const DEFAULT_NARRATOR_GENDER = "male";

export type NarratorGender = "female" | "male";

export interface VoiceVersionDescriptor {
  readonly availabilityStatus: "pending_authenticated_canary";
  readonly gender: NarratorGender;
  readonly id: string;
  readonly performanceProfileId: typeof GENIE_LAUNCH_PERFORMANCE_PROFILE.id;
  readonly version: 1;
  readonly versionId: string;
}

// Browser-safe descriptors only. Provider identity, account routing, and rights
// evidence remain in the private database configuration and server-only module.
export const VOICE_VERSIONS = [
  {
    availabilityStatus: "pending_authenticated_canary",
    gender: "male",
    id: "male-hindi-devotional-v1",
    performanceProfileId: GENIE_LAUNCH_PERFORMANCE_PROFILE.id,
    version: 1,
    versionId: "ec4e61a6-dc45-53d9-ba4b-fd5c7f267b2f",
  },
  {
    availabilityStatus: "pending_authenticated_canary",
    gender: "female",
    id: "female-hindi-devotional-v1",
    performanceProfileId: GENIE_LAUNCH_PERFORMANCE_PROFILE.id,
    version: 1,
    versionId: "bb2db360-9e44-5e17-95d3-a1e38ef21fa7",
  },
] as const satisfies readonly VoiceVersionDescriptor[];

const voiceByGender = new Map(
  VOICE_VERSIONS.map((voice) => [voice.gender, voice] as const),
);
const voiceByVersionId = new Map<string, VoiceVersionDescriptor>(
  VOICE_VERSIONS.map((voice) => [voice.versionId, voice] as const),
);

export function parseNarratorGender(value: unknown): NarratorGender {
  if (value !== "male" && value !== "female") {
    throw new Error("Narrator gender must be male or female.");
  }
  return value;
}

export function voiceForGender(gender: NarratorGender): VoiceVersionDescriptor {
  const voice = voiceByGender.get(gender);
  if (!voice) throw new Error("The selected narrator voice is unavailable.");
  return voice;
}

export function findVoiceByVersionId(
  voiceVersionId: string,
): VoiceVersionDescriptor | undefined {
  return voiceByVersionId.get(voiceVersionId);
}

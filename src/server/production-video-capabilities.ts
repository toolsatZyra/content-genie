import "server-only";

import { getServerEnvironment } from "@/config/server-env";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

const RETRIEVED_AT = "2026-07-19T13:06:06.255Z";
const EXPIRES_AT = "2026-10-17T13:06:06.255Z";
const PRICING_RAW_SHA256 =
  "0bbe010c183d0d1b3eb38a4dbd62a71f7fd71a648234011cb1e349462c7df084";
const PRICING_CANONICAL_HASH =
  "20c63f9d979b379afb093e2f09b40fba4d17c2e6347b4c2f320d3bacd74ce50d";

export type VideoMotionClass =
  "camera_led" | "complex_general" | "simple_camera_subject";

type QualifiedVideoProfile = Readonly<{
  canaryCanonicalHash: string;
  canaryRawSha256: string;
  motionClass: VideoMotionClass;
  profileKey: string;
  schemaCanonicalHash: string;
  schemaRawSha256: string;
}>;

export const QUALIFIED_VIDEO_PROFILES = Object.freeze([
  Object.freeze({
    canaryCanonicalHash:
      "d23838b52b03f64e40f3b67850a4df5dc53664003dc6e25c8d8c8f23db9a38db",
    canaryRawSha256: "28e7f619a30bd4c4f16e4ba48e9208896beb80caa7db23d4a62a09dd99b436f4",
    motionClass: "simple_camera_subject",
    profileKey: "kling-2.5-simple-camera-subject",
    schemaCanonicalHash:
      "979783417dfb1e319ffbf84bdafb878ec32f305aa70b7d926fcb728d0dd00f52",
    schemaRawSha256: "89719e9bbf2864ef733e61182f87c3884ad4fcce269cd3fb304aa37ea9207ae2",
  }),
  Object.freeze({
    canaryCanonicalHash:
      "09c0c10d2573dc3fca20644cd2d4700edbe97da111f339fb574bb10e79db636e",
    canaryRawSha256: "9e667248a8dd4a0dc98939fbf6c5b700cbd24e9b3a1dce9c2e085e3bf42743fb",
    motionClass: "camera_led",
    profileKey: "kling-3-camera-led",
    schemaCanonicalHash:
      "19bada0f4b6bed681b54f490d73cc69618e646ee1c6a96ca95d2a0b26a59489a",
    schemaRawSha256: "e48bb88661f8eebe3d40904f4be71659e823006fcbf9a0789a8cd9d39a9de7e8",
  }),
  Object.freeze({
    canaryCanonicalHash:
      "ae939ee262141ef8d3862203297518bbf75c305216bb1c50baf99dc962d4521e",
    canaryRawSha256: "a2418f1901a1562ffe15e9b99f9390c7e5df802cf3031d7294ad8190e963fcfc",
    motionClass: "complex_general",
    profileKey: "seedance-2-complex-general",
    schemaCanonicalHash:
      "f49614fd15f016e958008ef2b6878f56295366983d1362b3747ce379d1abaabb",
    schemaRawSha256: "3700d3b348f00102d600d252d3980cdb835a2e8b39a0240976e4e841246fcac1",
  }),
] satisfies readonly QualifiedVideoProfile[]);

export type QualifiedVideoCapability = Readonly<{
  capabilityVersionId: string;
  expiresAt: string;
  motionClass: VideoMotionClass;
  profileKey: string;
  rateCardVersionId: string;
}>;

export class ProductionVideoCapabilityError extends Error {
  override readonly name = "ProductionVideoCapabilityError";
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function parseCapability(
  value: unknown,
  profile: QualifiedVideoProfile,
): QualifiedVideoCapability {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProductionVideoCapabilityError(
      `Video capability ${profile.profileKey} is malformed.`,
    );
  }
  const row = value as Record<string, unknown>;
  if (
    row.ok !== true ||
    row.profileKey !== profile.profileKey ||
    typeof row.capabilityVersionId !== "string" ||
    !uuidPattern.test(row.capabilityVersionId) ||
    typeof row.rateCardVersionId !== "string" ||
    !uuidPattern.test(row.rateCardVersionId) ||
    typeof row.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(row.expiresAt)) ||
    Date.parse(row.expiresAt) <= Date.now()
  ) {
    throw new ProductionVideoCapabilityError(
      `Video capability ${profile.profileKey} is stale or malformed.`,
    );
  }
  return Object.freeze({
    capabilityVersionId: row.capabilityVersionId,
    expiresAt: row.expiresAt,
    motionClass: profile.motionClass,
    profileKey: profile.profileKey,
    rateCardVersionId: row.rateCardVersionId,
  });
}

export async function ensureProductionVideoCapabilities(
  workspaceId: string,
): Promise<Readonly<Record<VideoMotionClass, QualifiedVideoCapability>>> {
  if (!uuidPattern.test(workspaceId)) {
    throw new ProductionVideoCapabilityError("Workspace identity is malformed.");
  }
  const environment = getServerEnvironment().environment;
  const client = createAdminSupabaseClient();
  const results: Partial<Record<VideoMotionClass, QualifiedVideoCapability>> = {};
  for (const profile of QUALIFIED_VIDEO_PROFILES) {
    const { data, error } = await client.rpc(
      "command_ensure_video_production_profile",
      {
        p_canary_canonical_hash: profile.canaryCanonicalHash,
        p_canary_raw_sha256: profile.canaryRawSha256,
        p_environment: environment,
        p_expires_at: EXPIRES_AT,
        p_pricing_canonical_hash: PRICING_CANONICAL_HASH,
        p_pricing_raw_sha256: PRICING_RAW_SHA256,
        p_profile_key: profile.profileKey,
        p_retrieved_at: RETRIEVED_AT,
        p_schema_canonical_hash: profile.schemaCanonicalHash,
        p_schema_raw_sha256: profile.schemaRawSha256,
        p_workspace_id: workspaceId,
      },
    );
    if (error) {
      throw new ProductionVideoCapabilityError(
        `Video capability ${profile.profileKey} could not be qualified.`,
      );
    }
    results[profile.motionClass] = parseCapability(data, profile);
  }
  if (
    !results.simple_camera_subject ||
    !results.camera_led ||
    !results.complex_general
  ) {
    throw new ProductionVideoCapabilityError(
      "The qualified video routing set is incomplete.",
    );
  }
  return Object.freeze({
    camera_led: results.camera_led,
    complex_general: results.complex_general,
    simple_camera_subject: results.simple_camera_subject,
  });
}

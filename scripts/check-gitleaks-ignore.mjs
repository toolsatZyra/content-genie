import { readFileSync } from "node:fs";

const expected = [
  "77c4ae9ab734eed310854d35f6d626531f69090d:docs/implementation-plan.md:generic-api-key:497",
  "d16a9bbaf6c91a72853ebbf97d6ca66b2783b894:src/test/fakes/creation.ts:generic-api-key:134",
  "2164fc776ceb7cd87f7db5f4b485f942538c7e1c:src/server/source-cultural-preflight.ts:generic-api-key:242",
  "2164fc776ceb7cd87f7db5f4b485f942538c7e1c:src/server/audio-identity-preflight.ts:generic-api-key:610",
  "2164fc776ceb7cd87f7db5f4b485f942538c7e1c:src/server/preflight-plan-agent.ts:generic-api-key:1955",
  "2164fc776ceb7cd87f7db5f4b485f942538c7e1c:supabase/migrations/20260719074600_phase2_narration_independent_audio_qc.sql:generic-api-key:328",
  "2164fc776ceb7cd87f7db5f4b485f942538c7e1c:supabase/migrations/20260719074600_phase2_narration_independent_audio_qc.sql:generic-api-key:422",
  "d61bc1c5873e7030cfb84acdb601b598024ba390:src/domain/studio.test.ts:generic-api-key:124",
  "d61bc1c5873e7030cfb84acdb601b598024ba390:src/domain/studio.test.ts:generic-api-key:173",
  "d61bc1c5873e7030cfb84acdb601b598024ba390:src/server/studio-query.test.ts:generic-api-key:96",
  "d61bc1c5873e7030cfb84acdb601b598024ba390:src/server/studio-query.test.ts:generic-api-key:141",
  "d61bc1c5873e7030cfb84acdb601b598024ba390:src/test/fakes/studio.ts:generic-api-key:85",
  "d61bc1c5873e7030cfb84acdb601b598024ba390:src/test/fakes/studio.test.ts:generic-api-key:29",
  "d61bc1c5873e7030cfb84acdb601b598024ba390:tests/live/phase2-script-live.spec.ts:generic-api-key:250",
  "d61bc1c5873e7030cfb84acdb601b598024ba390:tests/live/phase2-script-live.spec.ts:generic-api-key:270",
  "d61bc1c5873e7030cfb84acdb601b598024ba390:supabase/migrations/20260717121602_phase2_0011_look_seed_02.sql:generic-api-key:41",
  "d61bc1c5873e7030cfb84acdb601b598024ba390:supabase/migrations/20260717121608_phase2_look_policy_baselines.sql:generic-api-key:1333",
];
const entries = readFileSync(".gitleaksignore", "utf8")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);

if (
  entries.length !== expected.length ||
  entries.some((entry, index) => entry !== expected[index])
) {
  throw new Error(
    "Gitleaks ignore must contain only the explicitly reviewed fingerprints.",
  );
}

const prose = readFileSync("docs/implementation-plan.md", "utf8")
  .split(/\r?\n/)
  .slice(498, 508)
  .join(" ");
if (!prose.includes("wrong-project keys") || !prose.includes("wrong audience")) {
  throw new Error(
    "Reviewed Gitleaks prose context changed; re-review the fingerprint.",
  );
}

console.log(
  `PASS Gitleaks ignore is limited to ${expected.length} reviewed historical findings`,
);

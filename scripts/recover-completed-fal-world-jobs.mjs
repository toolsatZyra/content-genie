import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

const environment = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/u)
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const separator = line.indexOf("=");
      return [
        line.slice(0, separator),
        line
          .slice(separator + 1)
          .trim()
          .replace(/^['"]|['"]$/gu, ""),
      ];
    }),
);

const falKey = environment.FAL_KEY;
const supabaseUrl = environment.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = environment.SUPABASE_SERVICE_ROLE_KEY;
if (!falKey || !supabaseUrl || !serviceRoleKey) {
  throw new Error("FAL and Supabase service credentials are required.");
}

const jobSource = process.argv[2] ?? "[]";
const jobs = JSON.parse(
  jobSource.endsWith(".json") ? readFileSync(jobSource, "utf8") : jobSource,
);
if (!Array.isArray(jobs) || jobs.length < 1 || jobs.length > 100) {
  throw new Error("A bounded JSON job array is required.");
}
const client = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

for (const job of jobs) {
  if (
    !job ||
    typeof job !== "object" ||
    !/^[0-9a-f-]{36}$/u.test(job.providerRequestId ?? "") ||
    !/^[0-9a-f-]{36}$/u.test(job.targetAssetId ?? "") ||
    !/^[A-Za-z0-9_-]{6,200}$/u.test(job.externalJobId ?? "")
  ) {
    throw new Error("A recovery job is malformed.");
  }
  const response = await fetch(
    `https://queue.fal.run/fal-ai/nano-banana-2/requests/${job.externalJobId}`,
    { headers: { Authorization: `Key ${falKey}` } },
  );
  const rawBody = await response.text();
  if (!response.ok) throw new Error(`FAL result ${job.externalJobId} was unavailable.`);
  const result = JSON.parse(rawBody);
  if (!Array.isArray(result.images) || result.images.length !== 1) {
    throw new Error(`FAL result ${job.externalJobId} is not an exact image result.`);
  }
  const image = result.images[0];
  if (
    !image ||
    typeof image.url !== "string" ||
    !image.url.startsWith("https://") ||
    !["image/png", "image/jpeg", "image/webp"].includes(image.content_type)
  ) {
    throw new Error(`FAL result ${job.externalJobId} has invalid media metadata.`);
  }
  const output = {
    contentType: image.content_type,
    height: Number.isSafeInteger(image.height) ? image.height : null,
    ordinal: 1,
    targetAssetId: job.targetAssetId,
    url: image.url,
    urlSha256: sha256(image.url),
    width: Number.isSafeInteger(image.width) ? image.width : null,
  };
  const canonicalPayloadHash = sha256(
    JSON.stringify({
      externalJobId: job.externalJobId,
      outputs: [output],
      status: "OK",
    }),
  );
  const { data, error } = await client.rpc("command_record_fal_signed_webhook", {
    p_canonical_payload_hash: canonicalPayloadHash,
    p_external_job_id: job.externalJobId,
    p_gateway_request_id: job.externalJobId,
    p_outputs: [output],
    p_provider_event_id: `poll:${job.externalJobId}`,
    p_provider_request_id: job.providerRequestId,
    p_raw_body_sha256: sha256(rawBody),
    p_safe_summary: {
      hasPayload: true,
      outputCount: 1,
      status: "OK",
      verificationClass: "authenticated_poll",
    },
    p_status: "OK",
  });
  if (error)
    throw new Error(`Recovery ledger rejected ${job.externalJobId}: ${error.message}`);
  console.log(
    JSON.stringify({
      disposition: data?.disposition,
      externalJobId: job.externalJobId,
      providerRequestId: job.providerRequestId,
      state: data?.state,
    }),
  );
}

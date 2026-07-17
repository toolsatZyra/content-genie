import { randomBytes, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";

import { createClient } from "@supabase/supabase-js";

const required = [
  "GENIE_LIVE_SUPABASE_URL",
  "GENIE_LIVE_SUPABASE_ANON_KEY",
  "GENIE_LIVE_SUPABASE_SERVICE_ROLE_KEY",
];
for (const name of required) {
  if (!process.env[name]) throw new Error(`${name} is required`);
}

const suffix = Date.now().toString(36);
const password = `G!${randomBytes(24).toString("base64url")}7a`;
const ownerEmail = `genie-owner-${suffix}@example.test`;
const outsiderEmail = `genie-outsider-${suffix}@example.test`;
const url = process.env.GENIE_LIVE_SUPABASE_URL;
const anonKey = process.env.GENIE_LIVE_SUPABASE_ANON_KEY;
const admin = createClient(url, process.env.GENIE_LIVE_SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function createUser(email) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
  });
  if (error || !data.user) throw error ?? new Error("Auth user was not created");
  return data.user.id;
}

async function insert(table, row) {
  const { data, error } = await admin.from(table).insert(row).select().single();
  if (error) throw error;
  return data;
}

const ownerId = await createUser(ownerEmail);
const outsiderId = await createUser(outsiderEmail);
const organization = await insert("organizations", {
  name: `Genie Live Validation ${suffix}`,
  slug: `genie-live-${suffix}`,
});
const workspace = await insert("workspaces", {
  name: "Zyra Live Validation",
  organization_id: organization.id,
  slug: `zyra-live-${suffix}`,
});
const outsiderWorkspace = await insert("workspaces", {
  name: "Outsider Validation",
  organization_id: organization.id,
  slug: `outsider-live-${suffix}`,
});
await admin.from("profiles").insert([
  { display_name: "Live Owner", user_id: ownerId },
  { display_name: "Live Outsider", user_id: outsiderId },
]);
await admin.from("memberships").insert([
  {
    activated_at: new Date().toISOString(),
    role: "admin",
    status: "active",
    user_id: ownerId,
    workspace_id: workspace.id,
  },
  {
    activated_at: new Date().toISOString(),
    role: "member",
    status: "active",
    user_id: outsiderId,
    workspace_id: outsiderWorkspace.id,
  },
]);

function userClient() {
  return createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

const owner = userClient();
const ownerSignIn = await owner.auth.signInWithPassword({
  email: ownerEmail,
  password,
});
if (ownerSignIn.error) throw ownerSignIn.error;
const outsider = userClient();
const outsiderSignIn = await outsider.auth.signInWithPassword({
  email: outsiderEmail,
  password,
});
if (outsiderSignIn.error) throw outsiderSignIn.error;

const commandId = randomUUID();
const correlationId = randomUUID();
const idempotencyKey = `live-series-${suffix}`;
const requestHash = "a".repeat(64);
const createParameters = {
  p_command_id: commandId,
  p_correlation_id: correlationId,
  p_description: "Live proof of the Phase 1 command boundary.",
  p_idempotency_key: idempotencyKey,
  p_owner_user_id: ownerId,
  p_request_hash: requestHash,
  p_slug: `live-series-${suffix}`,
  p_title: `Live Series ${suffix}`,
  p_workspace_id: workspace.id,
};
const firstSeries = await owner.rpc("command_create_series", createParameters);
if (firstSeries.error) throw firstSeries.error;
const replayedSeries = await owner.rpc("command_create_series", {
  ...createParameters,
  p_command_id: randomUUID(),
  p_correlation_id: randomUUID(),
});
if (replayedSeries.error) throw replayedSeries.error;
if (firstSeries.data.seriesId !== replayedSeries.data.seriesId) {
  throw new Error("Idempotent replay returned a different Series");
}

const episodeResponses = await Promise.all(
  Array.from({ length: 4 }, (_, index) =>
    owner.rpc("command_create_episode", {
      p_command_id: randomUUID(),
      p_correlation_id: randomUUID(),
      p_idempotency_key: `live-episode-${suffix}-${index}`,
      p_owner_user_id: ownerId,
      p_request_hash: String(index + 1).repeat(64),
      p_series_id: firstSeries.data.seriesId,
      p_summary: `Concurrent numbering proof ${index + 1}`,
      p_title: `Live Episode ${index + 1}`,
      p_workspace_id: workspace.id,
    }),
  ),
);
for (const result of episodeResponses) if (result.error) throw result.error;
const numbers = episodeResponses
  .map(({ data }) => data.episodeNumber)
  .sort((left, right) => left - right);
if (new Set(numbers).size !== 4 || numbers.join(",") !== "1,2,3,4") {
  throw new Error(`Episode numbering was not deterministic: ${numbers.join(",")}`);
}

const outsiderRead = await outsider
  .from("series")
  .select("id")
  .eq("workspace_id", workspace.id);
if (outsiderRead.error || outsiderRead.data.length !== 0) {
  throw outsiderRead.error ?? new Error("Outsider could read the owner workspace");
}
const forgedCreate = await outsider.rpc("command_create_series", {
  ...createParameters,
  p_command_id: randomUUID(),
  p_correlation_id: randomUUID(),
  p_idempotency_key: `forged-${suffix}`,
  p_owner_user_id: outsiderId,
});
if (!forgedCreate.error) throw new Error("Forged cross-workspace command succeeded");
const directMutation = await owner.from("series").insert({
  created_by: ownerId,
  owner_user_id: ownerId,
  slug: `direct-${suffix}`,
  title: "Direct mutation must fail",
  workspace_id: workspace.id,
});
if (!directMutation.error) throw new Error("Direct Series mutation succeeded");

const objectPath = `${workspace.id}/source/${randomUUID()}/v1/probe.txt`;
const upload = await owner.storage
  .from("workspace-private")
  .upload(objectPath, new Blob(["phase1-live-proof"], { type: "text/plain" }));
if (upload.error) throw upload.error;
const outsiderDownload = await outsider.storage
  .from("workspace-private")
  .download(objectPath);
if (!outsiderDownload.error) throw new Error("Outsider downloaded workspace media");

await writeFile(
  ".tmp/phase1-live-credentials.json",
  JSON.stringify(
    {
      email: ownerEmail,
      password,
      seriesId: firstSeries.data.seriesId,
      workspaceId: workspace.id,
    },
    null,
    2,
  ),
  { encoding: "utf8", mode: 0o600 },
);

console.log(
  JSON.stringify({
    commandReplay: "pass",
    concurrentEpisodeNumbers: numbers,
    crossWorkspaceRead: "denied",
    directMutation: "denied",
    liveUser: "created",
    storageIsolation: "pass",
    workspaceId: workspace.id,
  }),
);

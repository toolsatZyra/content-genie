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
const outsiderOrganization = await insert("organizations", {
  name: `Outsider Live Validation ${suffix}`,
  slug: `outsider-live-${suffix}`,
});
const workspace = await insert("workspaces", {
  name: "Zyra Live Validation",
  organization_id: organization.id,
  slug: `zyra-live-${suffix}`,
});
const outsiderWorkspace = await insert("workspaces", {
  name: "Outsider Validation",
  organization_id: outsiderOrganization.id,
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
const validateRealtime = process.env.GENIE_LIVE_SKIP_REALTIME !== "1";

function subscribe(channel, label) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`${label} Realtime subscription timed out`)),
      15_000,
    );
    channel.subscribe((status, error) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(timeout);
        resolve();
      }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        clearTimeout(timeout);
        reject(error ?? new Error(`${label} Realtime subscription failed: ${status}`));
      }
    });
  });
}

async function waitFor(predicate, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${label} timed out`);
}

const ownerEvents = [];
const outsiderEvents = [];
let ownerReplicationStatus = "pending";
let outsiderReplicationStatus = "pending";
const realtimeFilter = {
  event: "*",
  filter: `workspace_id=eq.${workspace.id}`,
  schema: "public",
  table: "domain_events",
};
const ownerChannel = owner
  .channel(`phase1-owner-${suffix}`, {
    config: { broadcast: { replication_ready: true } },
  })
  .on("system", {}, ({ status }) => {
    ownerReplicationStatus = status;
  })
  .on("postgres_changes", realtimeFilter, (event) => ownerEvents.push(event));
const outsiderChannel = outsider
  .channel(`phase1-outsider-${suffix}`, {
    config: { broadcast: { replication_ready: true } },
  })
  .on("system", {}, ({ status }) => {
    outsiderReplicationStatus = status;
  })
  .on("postgres_changes", realtimeFilter, (event) => outsiderEvents.push(event));
if (validateRealtime) {
  await Promise.all([
    subscribe(ownerChannel, "owner"),
    subscribe(outsiderChannel, "outsider"),
  ]);
  await waitFor(
    () => ownerReplicationStatus === "ok" && outsiderReplicationStatus === "ok",
    `Realtime replication readiness (owner=${ownerReplicationStatus}, outsider=${outsiderReplicationStatus})`,
    60_000,
  );
}

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
if (validateRealtime) {
  await waitFor(
    () =>
      ownerEvents.some(
        ({ new: row }) => row?.aggregate_id === firstSeries.data.seriesId,
      ),
    "owner Realtime delivery",
  );
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  if (outsiderEvents.length !== 0) {
    throw new Error("Outsider received a cross-workspace Realtime event");
  }
  await Promise.all([
    owner.removeChannel(ownerChannel),
    outsider.removeChannel(outsiderChannel),
  ]);
}

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

const workspaceTables = [
  "memberships",
  "membership_role_history",
  "invitations",
  "workspace_acl_entries",
  "series",
  "series_releases",
  "series_release_statuses",
  "continuity_state_versions",
  "episodes",
  "episode_watchers",
  "domain_events",
  "work_items",
  "work_leases",
  "notifications",
  "watches",
  "presence_sessions",
];
for (const table of workspaceTables) {
  const result = await outsider
    .from(table)
    .select("*", { count: "exact", head: false })
    .eq("workspace_id", workspace.id);
  if (result.error || result.data.length !== 0) {
    throw result.error ?? new Error(`Outsider enumerated owner rows in ${table}`);
  }
}
for (const [table, column, value] of [
  ["organizations", "id", organization.id],
  ["workspaces", "id", workspace.id],
  ["profiles", "user_id", ownerId],
]) {
  const result = await outsider.from(table).select("*").eq(column, value);
  if (result.error || result.data.length !== 0) {
    throw result.error ?? new Error(`Outsider enumerated owner rows in ${table}`);
  }
}
const forgedCreate = await outsider.rpc("command_create_series", {
  ...createParameters,
  p_command_id: randomUUID(),
  p_correlation_id: randomUUID(),
  p_idempotency_key: `forged-${suffix}`,
  p_owner_user_id: outsiderId,
});
if (!forgedCreate.error) throw new Error("Forged cross-workspace command succeeded");

const ownerWork = await owner
  .from("work_items")
  .select("id")
  .eq("workspace_id", workspace.id)
  .limit(1)
  .single();
if (ownerWork.error) throw ownerWork.error;
const forgedCommands = [
  outsider.rpc("command_create_episode", {
    p_command_id: randomUUID(),
    p_correlation_id: randomUUID(),
    p_idempotency_key: `forged-episode-${suffix}`,
    p_owner_user_id: outsiderId,
    p_request_hash: "b".repeat(64),
    p_series_id: firstSeries.data.seriesId,
    p_summary: "",
    p_title: "Forged Episode",
    p_workspace_id: workspace.id,
  }),
  outsider.rpc("command_archive_series", {
    p_command_id: randomUUID(),
    p_correlation_id: randomUUID(),
    p_expected_version: 1,
    p_idempotency_key: `forged-archive-${suffix}`,
    p_request_hash: "c".repeat(64),
    p_series_id: firstSeries.data.seriesId,
    p_workspace_id: workspace.id,
  }),
  outsider.rpc("command_claim_work_item", {
    p_command_id: randomUUID(),
    p_correlation_id: randomUUID(),
    p_idempotency_key: `forged-work-${suffix}`,
    p_lease_seconds: 300,
    p_request_hash: "d".repeat(64),
    p_work_item_id: ownerWork.data.id,
    p_workspace_id: workspace.id,
  }),
  outsider.rpc("command_create_invitation", {
    p_command_id: randomUUID(),
    p_correlation_id: randomUUID(),
    p_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    p_idempotency_key: `forged-invite-${suffix}`,
    p_invited_email: outsiderEmail,
    p_maximum_role: "reviewer",
    p_request_hash: "e".repeat(64),
    p_token_hash: "f".repeat(64),
    p_workspace_id: workspace.id,
  }),
  outsider.rpc("command_offboard_member", {
    p_command_id: randomUUID(),
    p_correlation_id: randomUUID(),
    p_expected_authority_epoch: 1,
    p_idempotency_key: `forged-offboard-${suffix}`,
    p_reason: "forged",
    p_replacement_user_id: outsiderId,
    p_request_hash: "0".repeat(64),
    p_target_user_id: ownerId,
    p_workspace_id: workspace.id,
  }),
  outsider.rpc("command_accept_invitation", {
    p_command_id: randomUUID(),
    p_correlation_id: randomUUID(),
    p_idempotency_key: `forged-accept-${suffix}`,
    p_request_hash: "1".repeat(64),
    p_token_hash: "2".repeat(64),
  }),
];
for (const result of await Promise.all(forgedCommands)) {
  if (!result.error) throw new Error("Outsider executed a forged command path");
}

const directMutation = await owner.from("series").insert({
  created_by: ownerId,
  owner_user_id: ownerId,
  slug: `direct-${suffix}`,
  title: "Direct mutation must fail",
  workspace_id: workspace.id,
});
if (!directMutation.error) throw new Error("Direct Series mutation succeeded");
const outsiderUpdate = await outsider
  .from("series")
  .update({ title: "Forged update" })
  .eq("id", firstSeries.data.seriesId)
  .select("id");
if (!outsiderUpdate.error && outsiderUpdate.data.length !== 0) {
  throw new Error("Outsider updated an owner Series");
}
const outsiderDelete = await outsider
  .from("series")
  .delete()
  .eq("id", firstSeries.data.seriesId)
  .select("id");
if (!outsiderDelete.error && outsiderDelete.data.length !== 0) {
  throw new Error("Outsider deleted an owner Series");
}

const objectPath = `${workspace.id}/source/${randomUUID()}/v1/probe.txt`;
const upload = await owner.storage
  .from("workspace-private")
  .upload(objectPath, new Blob(["phase1-live-proof"], { type: "text/plain" }));
if (upload.error) throw upload.error;
const outsiderDownload = await outsider.storage
  .from("workspace-private")
  .download(objectPath);
if (!outsiderDownload.error) throw new Error("Outsider downloaded workspace media");
const forgedUploadPath = `${workspace.id}/source/${randomUUID()}/v1/forged.txt`;
const outsiderUpload = await outsider.storage
  .from("workspace-private")
  .upload(forgedUploadPath, new Blob(["forged"], { type: "text/plain" }));
if (!outsiderUpload.error) throw new Error("Outsider wrote owner workspace media");
const ownerSignedUrl = await owner.storage
  .from("workspace-private")
  .createSignedUrl(objectPath, 60);
if (ownerSignedUrl.error || !ownerSignedUrl.data?.signedUrl) {
  throw ownerSignedUrl.error ?? new Error("Owner could not issue a short signed URL");
}
const outsiderSignedUrl = await outsider.storage
  .from("workspace-private")
  .createSignedUrl(objectPath, 60);
if (!outsiderSignedUrl.error) {
  throw new Error("Outsider issued a signed URL for owner workspace media");
}

await writeFile(
  ".tmp/phase1-live-credentials.json",
  JSON.stringify(
    {
      email: ownerEmail,
      objectPath,
      outsiderEmail,
      password,
      seriesId: firstSeries.data.seriesId,
      workspaceId: workspace.id,
    },
    null,
    2,
  ),
  { encoding: "utf8", mode: 0o600 },
);

owner.realtime.disconnect();
outsider.realtime.disconnect();

console.log(
  JSON.stringify({
    commandReplay: "pass",
    concurrentEpisodeNumbers: numbers,
    crossWorkspaceCrud: "denied",
    crossWorkspaceRead: "denied",
    directMutation: "denied",
    liveUser: "created",
    realtimeIsolation: validateRealtime ? "pass" : "separate-persistent-gate",
    shortSignedUrl: "pass",
    storageIsolation: "pass",
    workspaceId: workspace.id,
  }),
);

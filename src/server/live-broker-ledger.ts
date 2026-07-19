import "server-only";

import { createClient } from "@supabase/supabase-js";

import type { LiveBrokerRequest } from "@/server/live-broker-contract";

export type LiveBrokerLifecycle = Readonly<{
  aggregateVersion: number;
  cancelRequested: boolean;
  createInFlight: boolean;
  createLeaseExpiresAt: string | null;
  sandboxName: string;
  sandboxSessionId: string | null;
  state:
    "cancel_requested" | "creating" | "deleted" | "failed" | "finished" | "running";
}>;

export class LiveBrokerLedgerError extends Error {
  constructor(
    message: string,
    readonly conflict = false,
  ) {
    super(message);
    this.name = "LiveBrokerLedgerError";
  }
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceRoleKey) {
    throw new LiveBrokerLedgerError("Live broker ledger authority is unavailable.");
  }
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { "X-Client-Info": "genie-live-broker-ledger/1" } },
  });
}

function parseLifecycle(value: unknown): LiveBrokerLifecycle {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !==
      "aggregateVersion,cancelRequested,createInFlight,createLeaseExpiresAt,sandboxName,sandboxSessionId,state"
  ) {
    throw new LiveBrokerLedgerError("Live broker ledger returned invalid state.");
  }
  const lifecycle = value as Record<string, unknown>;
  if (
    !Number.isSafeInteger(lifecycle.aggregateVersion) ||
    (lifecycle.aggregateVersion as number) < 1 ||
    typeof lifecycle.cancelRequested !== "boolean" ||
    typeof lifecycle.createInFlight !== "boolean" ||
    ![
      "cancel_requested",
      "creating",
      "deleted",
      "failed",
      "finished",
      "running",
    ].includes(String(lifecycle.state)) ||
    !/^genie-live-[a-f0-9]{24}$/u.test(String(lifecycle.sandboxName)) ||
    !(
      lifecycle.sandboxSessionId === null ||
      /^[A-Za-z0-9_-]{8,255}$/u.test(String(lifecycle.sandboxSessionId))
    ) ||
    !(
      lifecycle.createLeaseExpiresAt === null ||
      (typeof lifecycle.createLeaseExpiresAt === "string" &&
        !Number.isNaN(Date.parse(lifecycle.createLeaseExpiresAt)))
    )
  ) {
    throw new LiveBrokerLedgerError("Live broker ledger state is malformed.");
  }
  return lifecycle as LiveBrokerLifecycle;
}

async function rpc(name: string, parameters: Record<string, unknown>) {
  const { data, error } = await adminClient().rpc(name, parameters);
  if (error) {
    throw new LiveBrokerLedgerError(
      "Live broker ledger operation failed safely.",
      error.code === "23505" || error.code === "54000",
    );
  }
  return parseLifecycle(data);
}

export async function claimLiveBrokerRequest(input: {
  bodySha256: string;
  brokerDeploymentCommit: string;
  command: LiveBrokerRequest;
  issuedAt: string;
  nonce: string;
  signerId: string;
}): Promise<LiveBrokerLifecycle> {
  return rpc("command_claim_live_broker_request", {
    p_action: input.command.action,
    p_body_sha256: input.bodySha256,
    p_broker_deployment_commit: input.brokerDeploymentCommit,
    p_candidate_commit: input.command.candidate.commit,
    p_candidate_tree: input.command.candidate.tree,
    p_issued_at_ms: Number(input.issuedAt),
    p_nonce: input.nonce,
    p_sandbox_name: input.command.sandboxName,
    p_signer_id: input.signerId,
  });
}

export async function recordLiveBrokerCreated(
  command: LiveBrokerRequest,
  sandboxSessionId: string,
  brokerDeploymentCommit: string,
): Promise<LiveBrokerLifecycle> {
  return rpc("command_record_live_broker_created", {
    p_broker_deployment_commit: brokerDeploymentCommit,
    p_candidate_commit: command.candidate.commit,
    p_candidate_tree: command.candidate.tree,
    p_sandbox_name: command.sandboxName,
    p_sandbox_session_id: sandboxSessionId,
  });
}

export async function recordLiveBrokerState(
  command: LiveBrokerRequest,
  state: "deleted" | "failed" | "finished",
  brokerDeploymentCommit: string,
): Promise<LiveBrokerLifecycle> {
  return rpc("command_record_live_broker_state", {
    p_broker_deployment_commit: brokerDeploymentCommit,
    p_candidate_commit: command.candidate.commit,
    p_candidate_tree: command.candidate.tree,
    p_sandbox_name: command.sandboxName,
    p_state: state,
  });
}

export async function readLiveBrokerLifecycle(
  command: LiveBrokerRequest,
  brokerDeploymentCommit: string,
): Promise<LiveBrokerLifecycle> {
  return rpc("get_live_broker_lifecycle", {
    p_broker_deployment_commit: brokerDeploymentCommit,
    p_candidate_commit: command.candidate.commit,
    p_candidate_tree: command.candidate.tree,
    p_sandbox_name: command.sandboxName,
  });
}

export async function reconcileLiveBrokerCancellation(
  command: LiveBrokerRequest,
  brokerDeploymentCommit: string,
): Promise<LiveBrokerLifecycle> {
  return rpc("command_reconcile_live_broker_cancellation", {
    p_broker_deployment_commit: brokerDeploymentCommit,
    p_candidate_commit: command.candidate.commit,
    p_candidate_tree: command.candidate.tree,
    p_sandbox_name: command.sandboxName,
  });
}

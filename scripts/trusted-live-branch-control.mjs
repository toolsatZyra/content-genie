import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import {
  isTransientCliFailureOutput,
  isTransientManagementStatus,
  isTransientTransportError,
} from "./transient-failure-policy.mjs";

export const TRUSTED_LIVE_BRANCH_NAME_PATTERN = /^genie-live-[0-9a-f]{8}-[0-9a-f]{3}$/u;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/u;
const GIT_OBJECT_PATTERN = /^[a-f0-9]{40}$/u;

function ownString(value, name) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !Object.hasOwn(value, name) ||
    typeof value[name] !== "string" ||
    !value[name].trim()
  ) {
    return null;
  }
  return value[name].trim();
}

function ownBoolean(value, name) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !Object.hasOwn(value, name) ||
    typeof value[name] !== "boolean"
  ) {
    return null;
  }
  return value[name];
}

function assertUuid(value, label) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new Error(`${label} is not an exact UUID.`);
  }
  return value;
}

function assertProjectRef(value, label) {
  if (typeof value !== "string" || !PROJECT_REF_PATTERN.test(value)) {
    throw new Error(`${label} is not an exact project reference.`);
  }
  return value;
}

function assertGitObject(value, label) {
  if (typeof value !== "string" || !GIT_OBJECT_PATTERN.test(value)) {
    throw new Error(`${label} is not an exact Git object identity.`);
  }
  return value;
}

function disposableBranchIdentity(branch, branchId, branchName, productionRef) {
  if (!branch || typeof branch !== "object" || Array.isArray(branch)) {
    throw new Error("Disposable branch identity is not an object.");
  }
  assertUuid(branchId, "Disposable branch ID");
  if (!TRUSTED_LIVE_BRANCH_NAME_PATTERN.test(branchName)) {
    throw new Error("Disposable branch name is invalid.");
  }
  const branchRef = assertProjectRef(
    ownString(branch, "project_ref"),
    "Disposable branch ref",
  );
  const parentProjectRef = assertProjectRef(
    ownString(branch, "parent_project_ref"),
    "Disposable branch parent ref",
  );
  if (parentProjectRef !== productionRef || branchRef === productionRef) {
    throw new Error("Disposable branch is not isolated under the exact parent.");
  }
  if (
    ownBoolean(branch, "is_default") !== false ||
    ownBoolean(branch, "persistent") !== false
  ) {
    throw new Error("Default or persistent branches are never disposable.");
  }
  return Object.freeze({
    branch,
    branchId,
    branchName,
    branchRef,
    parentProjectRef,
  });
}

function nestedString(value, acceptedNames) {
  if (!value || typeof value !== "object") return null;
  for (const [name, nested] of Object.entries(value)) {
    const normalized = name.toLowerCase().replaceAll("_", "");
    if (acceptedNames.has(normalized) && typeof nested === "string" && nested.trim()) {
      return nested.trim();
    }
    const found = nestedString(nested, acceptedNames);
    if (found) return found;
  }
  return null;
}

function credentialValue(details, name) {
  return nestedString(details, new Set([name.toLowerCase().replaceAll("_", "")]));
}

function parseJsonOutput(value, label) {
  const objectStart = value.indexOf("{");
  const arrayStart = value.indexOf("[");
  const starts = [objectStart, arrayStart].filter((index) => index >= 0);
  if (starts.length === 0) throw new Error(`${label} returned no JSON payload.`);
  const start = Math.min(...starts);
  const end = value.lastIndexOf(value[start] === "{" ? "}" : "]");
  if (end < start) throw new Error(`${label} returned incomplete JSON.`);
  return JSON.parse(value.slice(start, end + 1));
}

function runCli({ args, environment, node, supabaseCli, transient = false }) {
  const result = spawnSync(node, [supabaseCli, ...args], {
    encoding: "utf8",
    env: environment,
    shell: false,
    stdio: "pipe",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    if (transient && isTransientCliFailureOutput(output)) return "";
    throw new Error("Trusted disposable-branch control failed safely.");
  }
  return result.stdout ?? "";
}

function runCliOutcome({ args, environment, node, supabaseCli }) {
  const result = spawnSync(node, [supabaseCli, ...args], {
    encoding: "utf8",
    env: environment,
    shell: false,
    stdio: "pipe",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  return Object.freeze({
    completionUnknown: result.status !== 0 && isTransientCliFailureOutput(output),
    output,
    status: result.status,
    stdout: result.stdout ?? "",
  });
}

function exactIdentitySnapshot(
  branches,
  branchId,
  branchName,
  branchRef = null,
  productionRef = null,
) {
  if (!Array.isArray(branches)) {
    throw new Error("Branch control received a non-array branch list.");
  }
  const idMatches = branches.filter((branch) => ownString(branch, "id") === branchId);
  const nameMatches = branches.filter(
    (branch) => ownString(branch, "name") === branchName,
  );
  const refMatches = branchRef
    ? branches.filter((branch) => ownString(branch, "project_ref") === branchRef)
    : [];
  if (
    idMatches.some((branch) => ownString(branch, "name") !== branchName) ||
    nameMatches.some((branch) => ownString(branch, "id") !== branchId) ||
    refMatches.some(
      (branch) =>
        ownString(branch, "id") !== branchId ||
        ownString(branch, "name") !== branchName,
    )
  ) {
    throw new Error("Disposable branch identity is ambiguous or has changed.");
  }
  const exact = idMatches.filter(
    (branch) =>
      ownString(branch, "id") === branchId && ownString(branch, "name") === branchName,
  );
  if (
    idMatches.length > 1 ||
    nameMatches.length > 1 ||
    refMatches.length > 1 ||
    exact.length > 1
  ) {
    throw new Error("Disposable branch identity is duplicated.");
  }
  let disposable = null;
  if (exact.length === 1 && productionRef) {
    disposable = disposableBranchIdentity(
      exact[0],
      branchId,
      branchName,
      productionRef,
    );
    if (branchRef && disposable.branchRef !== branchRef) {
      throw new Error("Disposable branch ref is ambiguous or has changed.");
    }
  }
  return Object.freeze({ disposable, exact, idMatches, nameMatches, refMatches });
}

function exactNameSnapshot(branches, branchName) {
  if (!Array.isArray(branches)) {
    throw new Error("Branch control received a non-array branch list.");
  }
  const nameMatches = branches.filter(
    (branch) => ownString(branch, "name") === branchName,
  );
  if (nameMatches.length > 1) {
    throw new Error("Disposable branch name is duplicated.");
  }
  const branch = nameMatches[0] ?? null;
  const branchId = branch ? ownString(branch, "id") : null;
  if (branch && !branchId) {
    throw new Error("Disposable branch name resolved without a strict ID.");
  }
  return Object.freeze({ branch, branchId, nameMatches });
}

const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function branchListArgs(productionRef) {
  return ["branches", "list", "--project-ref", productionRef, "--output", "json"];
}

function listedBranches({
  environment,
  label,
  node,
  runCliImpl = runCli,
  supabaseCli,
  transient = false,
}) {
  const output = runCliImpl({
    args: branchListArgs(label.productionRef),
    environment,
    node,
    supabaseCli,
    transient,
  });
  return output.trim() ? parseJsonOutput(output, label.operation) : null;
}

export function listTrustedBranchSnapshot({
  environment,
  node,
  productionRef,
  runCliImpl = runCli,
  supabaseCli,
}) {
  assertProjectRef(productionRef, "Production project ref");
  const branches = listedBranches({
    environment,
    label: { operation: "Trusted branch snapshot", productionRef },
    node,
    runCliImpl,
    supabaseCli,
  });
  if (!branches) throw new Error("Trusted branch snapshot returned no strict list.");
  if (!Array.isArray(branches)) {
    throw new Error("Trusted branch snapshot returned a non-array branch list.");
  }
  return Object.freeze(branches.map((branch) => Object.freeze({ ...branch })));
}

async function recoverExactBranchByName({
  attempts,
  branchName,
  environment,
  node,
  productionRef,
  runCliImpl = runCli,
  sleep = wait,
  supabaseCli,
  waitMs,
}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const branches = listedBranches({
      environment,
      label: { operation: "Branch identity recovery", productionRef },
      node,
      runCliImpl,
      supabaseCli,
      transient: true,
    });
    if (branches) {
      const identity = exactNameSnapshot(branches, branchName);
      if (identity.branch) {
        return Object.freeze({
          ...identity,
          disposable: disposableBranchIdentity(
            identity.branch,
            identity.branchId,
            branchName,
            productionRef,
          ),
        });
      }
    }
    if (attempt < attempts) await sleep(waitMs);
  }
  return null;
}

export async function executeManagementSql(accessToken, projectRef, query) {
  const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;
  for (let attempt = 1; attempt <= 15; attempt += 1) {
    let response;
    try {
      response = await fetch(endpoint, {
        body: JSON.stringify({ query }),
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        method: "POST",
        signal: AbortSignal.timeout(120_000),
      });
    } catch (error) {
      if (!isTransientTransportError(error) || attempt === 15) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      continue;
    }
    const body = await response.text();
    if (response.ok) return JSON.parse(body);
    if (!isTransientManagementStatus(response.status) || attempt === 15) {
      throw new Error("Trusted database identity control failed safely.");
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error("Trusted database identity control exhausted its retry budget.");
}

function sqlLiteral(value) {
  if (typeof value !== "string") throw new Error("SQL identity must be a string.");
  return `'${value.replaceAll("'", "''")}'`;
}

function managementJsonRows(rows, label) {
  if (!Array.isArray(rows)) throw new Error(`${label} returned no row array.`);
  return rows.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error(`${label} returned an invalid row.`);
    }
    const value = Object.values(row)[0];
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`${label} returned an invalid lease payload.`);
    }
    return Object.freeze({ ...value });
  });
}

function assertCandidate(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("Candidate cleanup identity is required.");
  }
  return Object.freeze({
    commit: assertGitObject(candidate.commit, "Candidate commit"),
    tree: assertGitObject(candidate.tree, "Candidate tree"),
  });
}

function assertCleanupLeaseIdentity(lease) {
  if (!lease || typeof lease !== "object" || Array.isArray(lease)) {
    throw new Error("Cleanup lease identity is required.");
  }
  return Object.freeze({
    branchId: assertUuid(lease.branchId, "Cleanup branch ID"),
    branchName: TRUSTED_LIVE_BRANCH_NAME_PATTERN.test(lease.branchName)
      ? lease.branchName
      : (() => {
          throw new Error("Cleanup branch name is invalid.");
        })(),
    branchRef: assertProjectRef(lease.branchRef, "Cleanup branch ref"),
    cleanupLeaseId: assertUuid(lease.cleanupLeaseId, "Cleanup lease ID"),
  });
}

export async function registerTrustedBranchCleanupLease({
  accessToken,
  branch,
  candidate,
  cleanupLeaseId,
  coordinatorOwner,
  productionRef,
}) {
  const exactProductionRef = assertProjectRef(productionRef, "Production project ref");
  const exactBranch = assertCleanupLeaseIdentity({
    ...branch,
    cleanupLeaseId,
  });
  if (exactBranch.branchRef === exactProductionRef) {
    throw new Error("A cleanup lease cannot target production.");
  }
  const exactCandidate = assertCandidate(candidate);
  assertUuid(coordinatorOwner, "Cleanup coordinator owner");
  const rows = await executeManagementSql(
    accessToken,
    exactProductionRef,
    `select private.register_live_branch_cleanup_lease(${sqlLiteral(exactBranch.branchId)}::uuid, ${sqlLiteral(exactBranch.branchName)}, ${sqlLiteral(exactBranch.branchRef)}, ${sqlLiteral(exactProductionRef)}, ${sqlLiteral(exactCandidate.commit)}, ${sqlLiteral(exactCandidate.tree)}, ${sqlLiteral(exactBranch.cleanupLeaseId)}::uuid, ${sqlLiteral(coordinatorOwner)}::uuid) as lease`,
  );
  const leases = managementJsonRows(rows, "Cleanup lease registration");
  if (leases.length !== 1) {
    throw new Error("Cleanup lease registration returned no exact lease.");
  }
  const registered = assertCleanupLeaseIdentity(leases[0]);
  if (
    registered.branchId !== exactBranch.branchId ||
    registered.branchName !== exactBranch.branchName ||
    registered.branchRef !== exactBranch.branchRef ||
    registered.cleanupLeaseId !== exactBranch.cleanupLeaseId ||
    leases[0].candidateCommit !== exactCandidate.commit ||
    leases[0].candidateTree !== exactCandidate.tree ||
    leases[0].productionProjectRef !== exactProductionRef ||
    leases[0].leaseSource !== "candidate" ||
    leases[0].coordinatorOwner !== coordinatorOwner
  ) {
    throw new Error("Cleanup lease registration identity did not round-trip.");
  }
  return Object.freeze({ ...leases[0] });
}

export async function claimTrustedBranchCleanupLeases({
  accessToken,
  limit = 20,
  productionRef,
  reaperOwner,
}) {
  const exactProductionRef = assertProjectRef(productionRef, "Production project ref");
  assertUuid(reaperOwner, "Reaper owner");
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new Error("Cleanup lease claim limit is invalid.");
  }
  const rows = await executeManagementSql(
    accessToken,
    exactProductionRef,
    `select private.claim_live_branch_cleanup_leases(${sqlLiteral(exactProductionRef)}, ${sqlLiteral(reaperOwner)}::uuid, ${limit}) as lease`,
  );
  return Object.freeze(
    managementJsonRows(rows, "Cleanup lease claim").map((lease) => {
      assertCleanupLeaseIdentity(lease);
      if (
        lease.productionProjectRef !== exactProductionRef ||
        lease.state !== "reaping" ||
        lease.reaperOwner !== reaperOwner
      ) {
        throw new Error("Cleanup lease claim returned hostile identity state.");
      }
      return Object.freeze({ ...lease });
    }),
  );
}

export async function adoptTrustedOrphanBranchCleanupLease({
  accessToken,
  branch,
  cleanupLeaseId,
  productionRef,
  reaperOwner,
}) {
  const exactProductionRef = assertProjectRef(productionRef, "Production project ref");
  const exactBranch = assertCleanupLeaseIdentity({
    ...branch,
    cleanupLeaseId,
  });
  assertUuid(reaperOwner, "Reaper owner");
  const rows = await executeManagementSql(
    accessToken,
    exactProductionRef,
    `select private.adopt_orphan_live_branch_cleanup_lease(${sqlLiteral(exactBranch.branchId)}::uuid, ${sqlLiteral(exactBranch.branchName)}, ${sqlLiteral(exactBranch.branchRef)}, ${sqlLiteral(exactProductionRef)}, ${sqlLiteral(exactBranch.cleanupLeaseId)}::uuid, ${sqlLiteral(reaperOwner)}::uuid) as lease`,
  );
  const adopted = managementJsonRows(rows, "Orphan cleanup lease adoption");
  if (adopted.length !== 1) {
    throw new Error("Orphan cleanup lease adoption returned no exact identity.");
  }
  assertCleanupLeaseIdentity(adopted[0]);
  if (
    adopted[0].branchId !== exactBranch.branchId ||
    adopted[0].branchName !== exactBranch.branchName ||
    adopted[0].branchRef !== exactBranch.branchRef ||
    adopted[0].productionProjectRef !== exactProductionRef
  ) {
    throw new Error("Orphan cleanup lease adoption changed branch identity.");
  }
  return Object.freeze({ ...adopted[0] });
}

export async function completeTrustedBranchCleanupLease({
  accessToken,
  cleanup,
  lease,
  productionRef,
  reaperOwner,
}) {
  const exactProductionRef = assertProjectRef(productionRef, "Production project ref");
  const exactLease = assertCleanupLeaseIdentity(lease);
  assertUuid(reaperOwner, "Reaper owner");
  if (
    cleanup?.confirmedAbsentSnapshots !== 3 ||
    typeof cleanup?.deleteRequested !== "boolean"
  ) {
    throw new Error("Cleanup lease completion requires three absence snapshots.");
  }
  const rows = await executeManagementSql(
    accessToken,
    exactProductionRef,
    `select private.complete_live_branch_cleanup_lease(${sqlLiteral(exactLease.cleanupLeaseId)}::uuid, ${sqlLiteral(exactLease.branchId)}::uuid, ${sqlLiteral(exactLease.branchName)}, ${sqlLiteral(exactLease.branchRef)}, ${sqlLiteral(exactProductionRef)}, ${sqlLiteral(reaperOwner)}::uuid, 3, ${cleanup.deleteRequested ? "true" : "false"}) as lease`,
  );
  const completed = managementJsonRows(rows, "Cleanup lease completion");
  if (
    completed.length !== 1 ||
    completed[0].state !== "deleted" ||
    completed[0].confirmedAbsentSnapshots !== 3
  ) {
    throw new Error("Cleanup lease completion did not create a deletion tombstone.");
  }
  return Object.freeze({ ...completed[0] });
}

export async function releaseTrustedBranchCleanupLease({
  accessToken,
  lease,
  productionRef,
  reaperOwner,
}) {
  const exactProductionRef = assertProjectRef(productionRef, "Production project ref");
  const exactLease = assertCleanupLeaseIdentity(lease);
  assertUuid(reaperOwner, "Reaper owner");
  const rows = await executeManagementSql(
    accessToken,
    exactProductionRef,
    `select private.release_live_branch_cleanup_lease(${sqlLiteral(exactLease.cleanupLeaseId)}::uuid, ${sqlLiteral(reaperOwner)}::uuid) as lease`,
  );
  const released = managementJsonRows(rows, "Cleanup lease release");
  if (released.length !== 1 || !["registered", "deleted"].includes(released[0].state)) {
    throw new Error("Cleanup lease release returned an invalid state.");
  }
  return Object.freeze({ ...released[0] });
}

export async function listTrustedBranchCleanupLeases({ accessToken, productionRef }) {
  const exactProductionRef = assertProjectRef(productionRef, "Production project ref");
  const rows = await executeManagementSql(
    accessToken,
    exactProductionRef,
    `select private.list_live_branch_cleanup_leases(${sqlLiteral(exactProductionRef)}) as lease`,
  );
  return Object.freeze(
    managementJsonRows(rows, "Cleanup lease list").map((lease) => {
      assertCleanupLeaseIdentity(lease);
      if (lease.productionProjectRef !== exactProductionRef) {
        throw new Error("Cleanup lease list crossed the production identity boundary.");
      }
      return Object.freeze({ ...lease });
    }),
  );
}

export function trustedBranchEnvironment(source, operatingEnvironment) {
  const accessToken = source.SUPABASE_ACCESS_TOKEN?.trim();
  if (!accessToken) throw new Error("Disposable branch control requires access.");
  return Object.freeze({
    accessToken,
    childEnvironment: Object.freeze({
      ...operatingEnvironment,
      SUPABASE_ACCESS_TOKEN: accessToken,
    }),
  });
}

export function productionProjectRef(source) {
  const configured = source.SUPABASE_PROJECT_REF?.trim();
  if (configured) return configured;
  const url = source.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const derived = url
    ? new URL(url).hostname.match(/^([a-z0-9]{20})\.supabase\.co$/)?.[1]
    : null;
  if (!derived)
    throw new Error("A canonical production project reference is required.");
  return derived;
}

export async function createTrustedDisposableBranch({
  branchName,
  environment,
  node,
  onExactIdentity = async () => {},
  productionRef,
  runCliImpl = runCli,
  runCliOutcomeImpl = runCliOutcome,
  sleep = wait,
  supabaseCli,
}) {
  if (!TRUSTED_LIVE_BRANCH_NAME_PATTERN.test(branchName)) {
    throw new Error("Disposable branch name is invalid.");
  }
  assertProjectRef(productionRef, "Production project ref");
  const preflightBranches = listedBranches({
    environment,
    label: { operation: "Branch creation preflight", productionRef },
    node,
    runCliImpl,
    supabaseCli,
  });
  if (!preflightBranches) {
    throw new Error("Branch creation preflight returned no strict branch list.");
  }
  if (exactNameSnapshot(preflightBranches, branchName).branch) {
    throw new Error("Disposable branch name already exists before creation.");
  }

  let branchId = null;
  let branchRef = null;
  let exactIdentityRegistered = false;
  let createSucceeded = false;
  let createCompletionUnknown = false;
  const creation = runCliOutcomeImpl({
    args: [
      "branches",
      "create",
      branchName,
      "--project-ref",
      productionRef,
      "--output",
      "json",
      "--yes",
    ],
    environment,
    node,
    supabaseCli,
  });
  createSucceeded = creation.status === 0;
  createCompletionUnknown = creation.completionUnknown;
  if (createSucceeded) {
    const created = parseJsonOutput(creation.stdout, "Branch creation");
    branchId = ownString(created, "id");
    const createdName = ownString(created, "name");
    if (createdName !== branchName) {
      throw Object.assign(
        new Error("Branch creation returned a mismatched identity."),
        {
          branchId,
          branchName,
          createAttempted: true,
          createCompletionUnknown,
          createSucceeded,
        },
      );
    }
    const disposable = disposableBranchIdentity(
      created,
      branchId,
      branchName,
      productionRef,
    );
    branchRef = disposable.branchRef;
  } else if (!createCompletionUnknown) {
    throw Object.assign(new Error("Branch creation failed deterministically."), {
      branchId,
      branchName,
      createAttempted: true,
      createCompletionUnknown,
      createSucceeded,
    });
  }

  if (!branchId) {
    const recovered = await recoverExactBranchByName({
      attempts: 60,
      branchName,
      environment,
      node,
      productionRef,
      runCliImpl,
      sleep,
      supabaseCli,
      waitMs: 2_000,
    });
    branchId = recovered?.branchId ?? null;
    branchRef = recovered?.disposable?.branchRef ?? null;
  }
  if (!branchId) {
    throw Object.assign(
      new Error(
        createCompletionUnknown
          ? "Branch creation outcome is unknown and no exact identity was recovered."
          : "Branch creation returned no strict exact identity.",
      ),
      {
        branchId,
        branchName,
        createAttempted: true,
        createCompletionUnknown,
        createSucceeded,
      },
    );
  }

  if (!branchRef) {
    throw Object.assign(
      new Error("Disposable branch identity has no exact preview ref."),
      {
        branchId,
        branchName,
        createAttempted: true,
        createCompletionUnknown,
        createSucceeded,
      },
    );
  }

  try {
    await onExactIdentity(
      Object.freeze({ branchId, branchName, branchRef, productionRef }),
    );
    exactIdentityRegistered = true;
  } catch (error) {
    if (error && typeof error === "object") {
      Object.assign(error, {
        branchId,
        branchName,
        branchRef,
        createAttempted: true,
        createCompletionUnknown,
        createSucceeded,
        exactIdentityRegistered,
      });
    }
    throw error;
  }

  try {
    for (let attempt = 1; attempt <= 60; attempt += 1) {
      const listOutput = runCliImpl({
        args: branchListArgs(productionRef),
        environment,
        node,
        supabaseCli,
        transient: true,
      });
      if (listOutput.trim()) {
        const branches = parseJsonOutput(listOutput, "Branch readiness");
        const identity = exactIdentitySnapshot(
          branches,
          branchId,
          branchName,
          branchRef,
          productionRef,
        );
        const branch = identity.exact[0];
        if (
          branch &&
          credentialValue(branch, "status") === "FUNCTIONS_DEPLOYED" &&
          credentialValue(branch, "preview_project_status") === "ACTIVE_HEALTHY"
        ) {
          const detailsOutput = runCliImpl({
            args: [
              "branches",
              "get",
              branchId,
              "--project-ref",
              productionRef,
              "--output",
              "json",
            ],
            environment,
            node,
            supabaseCli,
            transient: true,
          });
          if (detailsOutput.trim()) {
            const details = parseJsonOutput(detailsOutput, "Branch details");
            const credentials = Object.freeze({
              anonKey: credentialValue(details, "SUPABASE_ANON_KEY"),
              databaseUrl: credentialValue(details, "POSTGRES_URL"),
              serviceRoleKey: credentialValue(details, "SUPABASE_SERVICE_ROLE_KEY"),
              supabaseUrl: credentialValue(details, "SUPABASE_URL"),
            });
            if (Object.values(credentials).every(Boolean)) {
              const credentialBranchRef = new URL(
                credentials.supabaseUrl,
              ).hostname.split(".")[0];
              if (
                !PROJECT_REF_PATTERN.test(credentialBranchRef) ||
                credentialBranchRef !== branchRef ||
                credentialBranchRef === productionRef
              ) {
                throw new Error("Disposable branch resolved to production.");
              }
              return Object.freeze({
                branchId,
                branchName,
                branchRef,
                createCompletionUnknown,
                createSucceeded,
                credentials,
              });
            }
          }
        }
      }
      await sleep(5_000);
    }
  } catch (error) {
    if (error && typeof error === "object") {
      Object.assign(error, {
        branchId,
        branchName,
        branchRef,
        createAttempted: true,
        createCompletionUnknown,
        createSucceeded,
        exactIdentityRegistered,
      });
    }
    throw error;
  }
  throw Object.assign(new Error("Disposable branch did not become ready."), {
    branchId,
    branchName,
    branchRef,
    createAttempted: true,
    createCompletionUnknown,
    createSucceeded,
    exactIdentityRegistered,
  });
}

export async function createTrustedIdentityChallenge({
  accessToken,
  branchRef,
  productionRef,
}) {
  const nonce = randomUUID();
  const table = `phase2_connection_challenge_${randomUUID().replaceAll("-", "")}`;
  await executeManagementSql(
    accessToken,
    branchRef,
    `create unlogged table private.${table} (challenge_nonce uuid primary key); insert into private.${table} values ('${nonce}'::uuid);`,
  );
  const productionRows = await executeManagementSql(
    accessToken,
    productionRef,
    `select to_regclass('private.${table}') is not null as challenge_present`,
  );
  if (
    !Array.isArray(productionRows) ||
    productionRows.length !== 1 ||
    productionRows[0]?.challenge_present !== false
  ) {
    throw new Error("Production exclusion challenge failed safely.");
  }
  return Object.freeze({ nonce, productionAbsenceVerified: true, table });
}

export async function cleanupTrustedDisposableBranch({
  branchId,
  branchName,
  branchRef = null,
  createAttempted,
  environment,
  node,
  productionRef,
  runCliImpl = runCli,
  sleep = wait,
  supabaseCli,
}) {
  if (!createAttempted) {
    return Object.freeze({
      branchId: null,
      branchName: null,
      confirmedAbsentSnapshots: 0,
      deleteRequested: false,
      exactIdentityFields: ["id", "name"],
      outcome: "branch-not-created",
    });
  }
  let consecutiveAbsentSnapshots = 0;
  let deleteRequested = false;
  let recoveredBranchId = branchId;
  let recoveredBranchRef = branchRef;
  const minimumAbsenceAttempt = 3;
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    const listOutput = runCliImpl({
      args: branchListArgs(productionRef),
      environment,
      node,
      supabaseCli,
      transient: true,
    });
    if (listOutput.trim()) {
      const branches = parseJsonOutput(listOutput, "Branch cleanup");
      if (!branchId) {
        const recovered = exactNameSnapshot(branches, branchName);
        if (recovered.branch) {
          recoveredBranchId = recovered.branchId;
          const disposable = disposableBranchIdentity(
            recovered.branch,
            recoveredBranchId,
            branchName,
            productionRef,
          );
          recoveredBranchRef = disposable.branchRef;
          consecutiveAbsentSnapshots = 0;
          const identity = exactIdentitySnapshot(
            branches,
            recoveredBranchId,
            branchName,
            recoveredBranchRef,
            productionRef,
          );
          if (identity.exact.length !== 1) {
            throw new Error("Recovered disposable branch identity is not exact.");
          }
          runCliImpl({
            args: [
              "branches",
              "delete",
              recoveredBranchId,
              "--project-ref",
              productionRef,
              "--yes",
            ],
            environment,
            node,
            supabaseCli,
            transient: true,
          });
          deleteRequested = true;
        } else {
          if (!recoveredBranchRef) {
            throw new Error("Exact disposable branch ref was never observed.");
          }
          consecutiveAbsentSnapshots += 1;
        }
      } else {
        const identity = exactIdentitySnapshot(
          branches,
          branchId,
          branchName,
          recoveredBranchRef,
          productionRef,
        );
        if (identity.exact.length === 1) {
          recoveredBranchRef = identity.disposable.branchRef;
          consecutiveAbsentSnapshots = 0;
          runCliImpl({
            args: [
              "branches",
              "delete",
              branchId,
              "--project-ref",
              productionRef,
              "--yes",
            ],
            environment,
            node,
            supabaseCli,
            transient: true,
          });
          deleteRequested = true;
        } else {
          if (!recoveredBranchRef) {
            throw new Error("Exact disposable branch ref was never observed.");
          }
          consecutiveAbsentSnapshots += 1;
        }
      }
      if (attempt >= minimumAbsenceAttempt && consecutiveAbsentSnapshots >= 3) {
        return Object.freeze({
          branchId: recoveredBranchId,
          branchName,
          branchRef: recoveredBranchRef,
          confirmedAbsentSnapshots: consecutiveAbsentSnapshots,
          deleteRequested,
          exactIdentityFields: [
            "id",
            "name",
            "project_ref",
            "parent_project_ref",
            "is_default",
            "persistent",
          ],
          minimumAbsenceAttempt,
          outcome: deleteRequested
            ? "branch-delete-confirmed"
            : "branch-absence-confirmed",
          requiredConsecutiveAbsentSnapshots: 3,
        });
      }
    }
    await sleep(2_000);
  }
  throw new Error("Could not confirm exact disposable-branch absence.");
}

export const trustedBranchIdentityTest = Object.freeze({
  disposableBranchIdentity,
  exactIdentitySnapshot,
  exactNameSnapshot,
  recoverExactBranchByName,
});

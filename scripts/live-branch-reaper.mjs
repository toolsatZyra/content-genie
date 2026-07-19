import { randomUUID } from "node:crypto";

import {
  adoptTrustedOrphanBranchCleanupLease,
  claimTrustedBranchCleanupLeases,
  cleanupTrustedDisposableBranch,
  completeTrustedBranchCleanupLease,
  listTrustedBranchCleanupLeases,
  listTrustedBranchSnapshot,
  releaseTrustedBranchCleanupLease,
  TRUSTED_LIVE_BRANCH_NAME_PATTERN,
} from "./trusted-live-branch-control.mjs";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/u;
const UTC_TIMESTAMP_PATTERN =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?Z$/u;
const DEFAULT_MINIMUM_AGE_MS = 6 * 60 * 60 * 1000;
const MINIMUM_ALLOWED_AGE_MS = 60 * 60 * 1000;

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

function exactUuid(value, label) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new Error(`${label} is not an exact UUID.`);
  }
  return value;
}

function exactProjectRef(value, label) {
  if (typeof value !== "string" || !PROJECT_REF_PATTERN.test(value)) {
    throw new Error(`${label} is not an exact project reference.`);
  }
  return value;
}

function strictAgeMilliseconds(source) {
  const configured = source.GENIE_LIVE_BRANCH_REAPER_MIN_AGE_MINUTES?.trim();
  if (!configured) return DEFAULT_MINIMUM_AGE_MS;
  if (!/^[0-9]+$/u.test(configured)) {
    throw new Error("Live branch reaper age must be an integer minute count.");
  }
  const milliseconds = Number(configured) * 60 * 1000;
  if (!Number.isSafeInteger(milliseconds) || milliseconds < MINIMUM_ALLOWED_AGE_MS) {
    throw new Error("Live branch reaper age must be at least 60 minutes.");
  }
  return milliseconds;
}

export function trustedLiveBranchReaperEnvironment(source, { scheduled = false } = {}) {
  const accessToken = source.SUPABASE_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    throw new Error(
      scheduled
        ? "Scheduled live branch reaping requires SUPABASE_ACCESS_TOKEN."
        : "Live branch reaping requires SUPABASE_ACCESS_TOKEN.",
    );
  }
  const productionRef = exactProjectRef(
    source.SUPABASE_PROJECT_REF?.trim(),
    "Scheduled production project ref",
  );
  return Object.freeze({
    accessToken,
    minimumAgeMs: strictAgeMilliseconds(source),
    productionRef,
  });
}

export function classifyStrictStaleBranch({
  branch,
  minimumAgeMs,
  nowMs,
  productionRef,
}) {
  const branchName = ownString(branch, "name");
  if (!branchName || !TRUSTED_LIVE_BRANCH_NAME_PATTERN.test(branchName)) {
    return Object.freeze({ eligible: false, ignored: true, reason: "name-pattern" });
  }
  if (
    !Number.isSafeInteger(minimumAgeMs) ||
    minimumAgeMs < MINIMUM_ALLOWED_AGE_MS ||
    !Number.isSafeInteger(nowMs)
  ) {
    throw new Error("Strict stale-branch age inputs are invalid.");
  }
  const createdAt = ownString(branch, "created_at");
  if (!createdAt || !UTC_TIMESTAMP_PATTERN.test(createdAt)) {
    throw new Error("Generated live branch has no trustworthy creation time.");
  }
  const createdAtMs = createdAt ? Date.parse(createdAt) : Number.NaN;
  if (!Number.isFinite(createdAtMs) || createdAtMs > nowMs) {
    throw new Error("Generated live branch has no trustworthy creation time.");
  }
  if (nowMs - createdAtMs < minimumAgeMs) {
    return Object.freeze({ eligible: false, ignored: true, reason: "age-threshold" });
  }
  const branchId = exactUuid(ownString(branch, "id"), "Stale branch ID");
  const branchRef = exactProjectRef(
    ownString(branch, "project_ref"),
    "Stale branch ref",
  );
  const parentProjectRef = exactProjectRef(
    ownString(branch, "parent_project_ref"),
    "Stale branch parent ref",
  );
  if (branchRef === productionRef || parentProjectRef !== productionRef) {
    throw new Error("Generated live branch crossed the production identity boundary.");
  }
  if (
    ownBoolean(branch, "is_default") !== false ||
    ownBoolean(branch, "persistent") !== false
  ) {
    throw new Error("Default or persistent generated branches are never reaped.");
  }
  return Object.freeze({
    branchId,
    branchName,
    branchRef,
    createdAt,
    eligible: true,
    ignored: false,
    parentProjectRef,
  });
}

function exactLeaseCollision(leases, branch) {
  const collisions = leases.filter(
    (lease) =>
      lease.branchId === branch.branchId ||
      lease.branchName === branch.branchName ||
      lease.branchRef === branch.branchRef,
  );
  if (collisions.length > 1) {
    throw new Error("Cleanup ledger contains duplicate branch identities.");
  }
  const collision = collisions[0] ?? null;
  if (
    collision &&
    (collision.branchId !== branch.branchId ||
      collision.branchName !== branch.branchName ||
      collision.branchRef !== branch.branchRef)
  ) {
    throw new Error("Cleanup ledger contains a hostile partial identity collision.");
  }
  return collision;
}

function failureMessage(error) {
  return error instanceof Error ? error.message : "Unknown cleanup failure.";
}

function cleanupFailure({
  error,
  releaseError = null,
  releasedForRetry = null,
  stage,
  target = null,
}) {
  return Object.freeze({
    branchId: ownString(target, "branchId"),
    branchName: ownString(target, "branchName"),
    branchRef: ownString(target, "branchRef"),
    cleanupLeaseId: ownString(target, "cleanupLeaseId"),
    errorName: error instanceof Error ? error.name : "Error",
    message: failureMessage(error),
    releaseErrorName:
      releaseError instanceof Error ? releaseError.name : releaseError ? "Error" : null,
    releaseMessage: releaseError ? failureMessage(releaseError) : null,
    releasedForRetry,
    stage,
  });
}

export async function reconcileTrustedBranchCleanupLeases({
  accessToken,
  claimImpl = claimTrustedBranchCleanupLeases,
  cleanupImpl = cleanupTrustedDisposableBranch,
  completeImpl = completeTrustedBranchCleanupLease,
  environment,
  node,
  productionRef,
  reaperOwner = randomUUID(),
  releaseImpl = releaseTrustedBranchCleanupLease,
  sleep,
  supabaseCli,
}) {
  exactUuid(reaperOwner, "Reaper owner");
  const cleaned = [];
  const failedClaims = [];
  const failures = [];
  const attemptedLeaseIds = new Set();
  let exhausted = false;
  let claimOwner = reaperOwner;
  for (let batch = 0; batch < 20; batch += 1) {
    let leases;
    try {
      leases = await claimImpl({
        accessToken,
        limit: 50,
        productionRef,
        reaperOwner: claimOwner,
      });
    } catch (error) {
      failures.push(cleanupFailure({ error, stage: "lease-claim" }));
      break;
    }
    if (!Array.isArray(leases)) {
      failures.push(
        cleanupFailure({
          error: new Error("Cleanup lease claim did not return an array."),
          stage: "lease-claim",
        }),
      );
      break;
    }
    if (leases.length === 0) {
      exhausted = true;
      break;
    }
    let newLeaseCount = 0;
    let failedLeaseCount = 0;
    for (const lease of leases) {
      const leaseId = ownString(lease, "cleanupLeaseId");
      if (leaseId && attemptedLeaseIds.has(leaseId)) continue;
      if (leaseId) attemptedLeaseIds.add(leaseId);
      newLeaseCount += 1;
      let cleanup;
      try {
        cleanup = await cleanupImpl({
          branchId: lease.branchId,
          branchName: lease.branchName,
          branchRef: lease.branchRef,
          createAttempted: true,
          environment,
          node,
          productionRef,
          sleep,
          supabaseCli,
        });
        if (cleanup.confirmedAbsentSnapshots !== 3) {
          throw new Error("Cleanup returned fewer than three absence snapshots.");
        }
        await completeImpl({
          accessToken,
          cleanup,
          lease,
          productionRef,
          reaperOwner: claimOwner,
        });
        cleaned.push(
          Object.freeze({
            branchId: lease.branchId,
            branchName: lease.branchName,
            branchRef: lease.branchRef,
            cleanup,
            cleanupLeaseId: lease.cleanupLeaseId,
            deleteRequested: cleanup.deleteRequested,
          }),
        );
      } catch (error) {
        // Keep failed claims owned until the remaining pending leases have had
        // a chance to run. Releasing here could immediately re-claim the same
        // bad lease and starve later cleanup work.
        failedClaims.push({ error, lease, reaperOwner: claimOwner });
        failedLeaseCount += 1;
      }
    }
    if (newLeaseCount === 0) {
      failures.push(
        cleanupFailure({
          error: new Error("Cleanup lease claim repeated an active lease."),
          stage: "lease-claim",
        }),
      );
      break;
    }
    if (failedLeaseCount > 0) {
      // Claims owned by the previous UUID stay temporarily ineligible while a
      // fresh owner advances to later pending work.
      claimOwner = randomUUID();
    }
  }
  if (!exhausted && failures.length === 0) {
    failures.push(
      cleanupFailure({
        error: new Error(
          "Cleanup reconciliation exceeded its bounded lease batch limit.",
        ),
        stage: "lease-claim",
      }),
    );
  }
  for (const failed of failedClaims) {
    let releaseError = null;
    let releasedForRetry = false;
    try {
      await releaseImpl({
        accessToken,
        lease: failed.lease,
        productionRef,
        reaperOwner: failed.reaperOwner,
      });
      releasedForRetry = true;
    } catch (error) {
      // An expiring database claim remains the crash-recovery backstop.
      releaseError = error;
    }
    failures.push(
      cleanupFailure({
        error: failed.error,
        releaseError,
        releasedForRetry,
        stage: "leased-cleanup",
        target: failed.lease,
      }),
    );
  }
  return Object.freeze({
    cleaned: Object.freeze(cleaned),
    failures: Object.freeze(failures),
    reaperOwner,
  });
}

export async function reapTrustedLiveBranches({
  accessToken,
  adoptImpl = adoptTrustedOrphanBranchCleanupLease,
  claimImpl,
  cleanupImpl = cleanupTrustedDisposableBranch,
  completeImpl,
  environment,
  listBranchesImpl = listTrustedBranchSnapshot,
  listLeasesImpl = listTrustedBranchCleanupLeases,
  minimumAgeMs = DEFAULT_MINIMUM_AGE_MS,
  node,
  nowMs = Date.now(),
  productionRef,
  reaperOwner = randomUUID(),
  releaseImpl,
  sleep,
  supabaseCli,
  uuidImpl = randomUUID,
}) {
  const reconciliation = await reconcileTrustedBranchCleanupLeases({
    accessToken,
    claimImpl,
    cleanupImpl,
    completeImpl,
    environment,
    node,
    productionRef,
    reaperOwner,
    releaseImpl,
    sleep,
    supabaseCli,
  });
  const failures = [...reconciliation.failures];
  let branches;
  let leases;
  try {
    [branches, leases] = await Promise.all([
      listBranchesImpl({ environment, node, productionRef, supabaseCli }),
      listLeasesImpl({ accessToken, productionRef }),
    ]);
  } catch (error) {
    failures.push(cleanupFailure({ error, stage: "orphan-discovery" }));
    return Object.freeze({
      failures: Object.freeze(failures),
      leased: reconciliation.cleaned,
      orphaned: Object.freeze([]),
      reaperOwner,
    });
  }
  if (!Array.isArray(branches) || !Array.isArray(leases)) {
    failures.push(
      cleanupFailure({
        error: new Error("Scheduled stale-branch discovery returned invalid state."),
        stage: "orphan-discovery",
      }),
    );
    return Object.freeze({
      failures: Object.freeze(failures),
      leased: reconciliation.cleaned,
      orphaned: Object.freeze([]),
      reaperOwner,
    });
  }
  const orphaned = [];
  for (const rawBranch of branches) {
    let branch;
    try {
      branch = classifyStrictStaleBranch({
        branch: rawBranch,
        minimumAgeMs,
        nowMs,
        productionRef,
      });
      if (!branch.eligible || exactLeaseCollision(leases, branch)) continue;
    } catch (error) {
      failures.push(
        cleanupFailure({ error, stage: "orphan-classification", target: rawBranch }),
      );
      continue;
    }
    let lease;
    try {
      lease = await adoptImpl({
        accessToken,
        branch,
        cleanupLeaseId: uuidImpl(),
        productionRef,
        reaperOwner,
      });
    } catch (error) {
      failures.push(
        cleanupFailure({ error, stage: "orphan-adoption", target: branch }),
      );
      continue;
    }
    if (
      lease.state !== "reaping" ||
      lease.reaperOwner !== reaperOwner ||
      lease.leaseSource !== "orphan_discovery"
    ) {
      failures.push(
        cleanupFailure({
          error: new Error("Orphan cleanup lease was not claimed by this reaper."),
          stage: "orphan-adoption",
          target: lease,
        }),
      );
      continue;
    }
    let cleanup;
    try {
      cleanup = await cleanupImpl({
        branchId: branch.branchId,
        branchName: branch.branchName,
        branchRef: branch.branchRef,
        createAttempted: true,
        environment,
        node,
        productionRef,
        sleep,
        supabaseCli,
      });
      if (cleanup.confirmedAbsentSnapshots !== 3) {
        throw new Error("Orphan cleanup returned fewer than three absence snapshots.");
      }
      await (completeImpl ?? completeTrustedBranchCleanupLease)({
        accessToken,
        cleanup,
        lease,
        productionRef,
        reaperOwner,
      });
      orphaned.push(
        Object.freeze({
          branchId: branch.branchId,
          branchName: branch.branchName,
          branchRef: branch.branchRef,
          cleanupLeaseId: lease.cleanupLeaseId,
        }),
      );
    } catch (error) {
      let releaseError = null;
      let releasedForRetry = false;
      try {
        await (releaseImpl ?? releaseTrustedBranchCleanupLease)({
          accessToken,
          lease,
          productionRef,
          reaperOwner,
        });
        releasedForRetry = true;
      } catch (caughtReleaseError) {
        // Expiring database ownership remains the crash-recovery backstop.
        releaseError = caughtReleaseError;
      }
      failures.push(
        cleanupFailure({
          error,
          releaseError,
          releasedForRetry,
          stage: "orphan-cleanup",
          target: lease,
        }),
      );
    }
  }
  return Object.freeze({
    failures: Object.freeze(failures),
    leased: reconciliation.cleaned,
    orphaned: Object.freeze(orphaned),
    reaperOwner,
  });
}

export const liveBranchReaperTest = Object.freeze({ exactLeaseCollision });

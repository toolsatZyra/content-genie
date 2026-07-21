import assert from "node:assert/strict";

import { assertClosedCandidateArtifact } from "./live-candidate-evidence.mjs";
import { PHASE2_COORDINATE_PREDECESSOR_FIXTURE } from "./phase2-coordinate-upgrade-drill.mjs";
import {
  candidateMigrationVersion,
  loadPhase2CandidateMigrationInventory,
} from "./phase2-candidate-migration-inventory.mjs";

const digest = (seed) => ({ fileCount: 1, sha256: seed.repeat(64) });
const binding = {
  databaseTests: digest("a"),
  gitTree: "b".repeat(40),
  liveTests: digest("c"),
  migrations: digest("d"),
  snapshotSeal: "windows-current-user-readonly-staged-snapshot",
  source: digest("e"),
};
const revisionId = "10000000-0000-4000-8000-000000000001";
const episodeId = "10000000-0000-4000-8000-000000000002";
const timestamp = "2026-07-18T00:00:00.000Z";
const candidateMigrations = await loadPhase2CandidateMigrationInventory();
const versions = candidateMigrations.map(candidateMigrationVersion);
const terminalForwardMigration = "20260717121607";
const legacyRows = [
  {
    bytes: 8193,
    id: "96500000-0000-4000-8000-000000000001",
    rawUtf8Sha256: "9c10c48d1f1d6618db88fde2c25409181c9201ed34ec6815d62bcf57c10d177b",
  },
  {
    bytes: 65536,
    id: "96500000-0000-4000-8000-000000000002",
    rawUtf8Sha256: "fce4d906c666cb2bc9d0f2d42a5e871f418c5e8dac03b4a4a60eed343b3480ec",
  },
];
const expectedPgTapSuites = [
  {
    hardenedQuerySha256: "2".repeat(64),
    plannedAssertions: 1,
    sourceSha256: "3".repeat(64),
    testFile: "phase1_foundation.test.sql",
  },
];
const evidence = {
  apiReadinessAttempts: 1,
  boundaryEvidence: {
    accepted: {
      bytes: 8192,
      episodeId,
      rawUtf8Sha256: "f".repeat(64),
      scriptRevisionId: revisionId,
      status: 200,
    },
    browserRoundTrip: true,
    database: {
      coordinateMapBytes: 1024,
      coordinateMapVerifier: "postgres-structural-v2",
      coordinateMapVersion: 2,
      rawUtf8Bytes: 8192,
      rawUtf8Sha256: "f".repeat(64),
      remainingAttestations: 0,
      scriptRevisionId: revisionId,
    },
    rejected: { bytes: 8193, code: "SCRIPT_TOO_LARGE", status: 400 },
    schemaVersion: "genie-script-boundary-evidence.v1",
  },
  browserCredentialEvidence: {
    credentialDirectoryAbsent: true,
    credentialDirectoryCreated: true,
    credentialFileCreated: true,
    credentialFileMode: "windows-current-user-protected",
  },
  candidate: {
    gitTree: binding.gitTree,
    source: binding.source,
    snapshotSeal: binding.snapshotSeal,
    migrations: binding.migrations,
    liveTests: binding.liveTests,
    databaseTests: binding.databaseTests,
  },
  candidateBindingError: null,
  candidateBindingVerified: true,
  candidateRevalidatedAt: timestamp,
  cleanupError: null,
  databaseCredentialEvidence: {
    credentialDirectoryAbsent: true,
    credentialDirectoryCreated: true,
    credentialFileAbsent: true,
    credentialFileCreated: true,
    credentialFileMode: "windows-current-user-protected",
    guardedChildInvocations: 1,
    passwordlessTargetPassedInChildArgv: true,
    productionCredentialExcluded: true,
    secretPassedInChildArgv: false,
    transport: "pgpass",
  },
  databaseIdentityChallenge: "passed",
  executionCompleted: true,
  executionError: null,
  finishedAt: timestamp,
  forwardRollback: "passed",
  forwardUpgradeEvidence: {
    appliedPhase2Versions: versions,
    expectedPhase2Versions: versions,
    predecessorContract: {
      coordinateMapVerifierDefault: "postgres-structural-v1",
      legacyMaximumBytes: 65536,
      scriptSizePolicyColumnAbsent: true,
      uniqueAttestationIndex: true,
    },
    predecessorFixture: PHASE2_COORDINATE_PREDECESSOR_FIXTURE,
    predecessorSeed: {
      legacyRowCount: 2,
      legacyRows,
      maximumLegacyBytes: 65536,
      minimumLegacyBytes: 8193,
      verifiedV1: true,
    },
    predecessorUpgradeExercised: true,
    preexistingPhase2Versions: versions.filter(
      (version) => version !== terminalForwardMigration,
    ),
    terminalForwardMigration,
    upgrade: {
      exactV2WriteAccepted: true,
      legacyRows,
      legacyRowsPreserved: true,
      oversizedV2WritesRejected: true,
    },
  },
  outcome: "passed",
  pgTapSuites: [
    {
      assertionsPassed: 1,
      databaseResultSha256: "1".repeat(64),
      hardenedQuerySha256: "2".repeat(64),
      plannedAssertions: 1,
      resultRowCount: 2,
      sourceSha256: "3".repeat(64),
      testFile: "phase1_foundation.test.sql",
    },
  ],
  phase2PersistenceEvidence: {
    configurationCount: 1,
    coordinateMapVersion: 2,
    episodeId,
    lockEventCount: 1,
    processingUtf8Sha256: "4".repeat(64),
    rawUtf8Sha256: "5".repeat(64),
    remainingAttestations: 0,
  },
  predecessorFixture: PHASE2_COORDINATE_PREDECESSOR_FIXTURE,
  schemaVersion: "genie-live-candidate-evidence.v3",
  startedAt: timestamp,
  state: "finished",
};

const expectations = {
  candidateBinding: binding,
  candidateMigrations,
  pgTapSuites: expectedPgTapSuites,
  predecessorFixture: PHASE2_COORDINATE_PREDECESSOR_FIXTURE,
};

assert.equal(assertClosedCandidateArtifact(evidence, expectations), evidence);

for (const mutate of [
  (value) => {
    value.extra = true;
  },
  (value) => {
    value.candidate.extra = true;
  },
  (value) => {
    value.candidate.source.sha256 = "0".repeat(64);
  },
  (value) => {
    value.databaseCredentialEvidence.extra = true;
  },
  (value) => {
    value.pgTapSuites[0].extra = true;
  },
  (value) => {
    value.pgTapSuites[0].testFile = "hostile.test.sql";
  },
  (value) => {
    value.pgTapSuites[0].plannedAssertions = 2;
  },
  (value) => {
    value.forwardUpgradeEvidence.predecessorSeed.verifiedV1 = false;
  },
  (value) => {
    value.forwardUpgradeEvidence.preexistingPhase2Versions = versions;
  },
  (value) => {
    value.predecessorFixture.sha256 = "0".repeat(64);
  },
  (value) => {
    value.boundaryEvidence.database.remainingAttestations = 1;
  },
  (value) => {
    value.outcome = "failed";
  },
]) {
  const hostile = structuredClone(evidence);
  mutate(hostile);
  assert.throws(
    () => assertClosedCandidateArtifact(hostile, expectations),
    /trusted invariant/,
  );
}

console.log(
  "PASS order-independent closed candidate evidence and hostile nested controls",
);

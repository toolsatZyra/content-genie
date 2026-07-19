const TOP_LEVEL_KEYS = [
  "apiReadinessAttempts",
  "boundaryEvidence",
  "browserCredentialEvidence",
  "candidate",
  "candidateBindingError",
  "candidateBindingVerified",
  "candidateRevalidatedAt",
  "cleanupError",
  "databaseCredentialEvidence",
  "databaseIdentityChallenge",
  "executionCompleted",
  "executionError",
  "finishedAt",
  "forwardRollback",
  "forwardUpgradeEvidence",
  "outcome",
  "pgTapSuites",
  "phase2PersistenceEvidence",
  "predecessorFixture",
  "schemaVersion",
  "startedAt",
  "state",
];

function invariant(condition, label) {
  if (!condition) {
    throw new Error(`Candidate evidence failed trusted invariant: ${label}.`);
  }
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expectedKeys, label) {
  invariant(plainObject(value), `${label} object`);
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  invariant(
    actual.length === expected.length &&
      actual.every((key, index) => key === expected[index]),
    `${label} closed schema`,
  );
}

function exactValue(value, expected, label) {
  if (Array.isArray(expected)) {
    invariant(Array.isArray(value), `${label} array`);
    invariant(value.length === expected.length, `${label} array length`);
    for (let index = 0; index < expected.length; index += 1) {
      exactValue(value[index], expected[index], `${label}[${index}]`);
    }
    return;
  }
  if (plainObject(expected)) {
    exactKeys(value, Object.keys(expected), label);
    for (const key of Object.keys(expected).sort()) {
      exactValue(value[key], expected[key], `${label}.${key}`);
    }
    return;
  }
  invariant(Object.is(value, expected), `${label} exact value`);
}

function isoTimestamp(value) {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function uuid(value) {
  return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);
}

function sha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function safeInteger(value, minimum = 0) {
  return Number.isSafeInteger(value) && value >= minimum;
}

function assertDigest(value, expected, label) {
  exactKeys(value, ["fileCount", "sha256"], `${label} digest`);
  exactKeys(expected, ["fileCount", "sha256"], `${label} expected digest`);
  invariant(safeInteger(value.fileCount), `${label} file count`);
  invariant(sha256(value.sha256), `${label} SHA-256`);
  invariant(value.fileCount === expected.fileCount, `${label} file-count binding`);
  invariant(value.sha256 === expected.sha256, `${label} digest binding`);
}

function assertCandidateBinding(value, expected) {
  const keys = [
    "databaseTests",
    "gitTree",
    "liveTests",
    "migrations",
    "snapshotSeal",
    "source",
  ];
  exactKeys(value, keys, "candidate binding");
  exactKeys(expected, keys, "trusted candidate binding");
  for (const label of ["databaseTests", "liveTests", "migrations", "source"]) {
    assertDigest(value[label], expected[label], label);
  }
  invariant(
    typeof value.gitTree === "string" && /^[a-f0-9]{40,64}$/.test(value.gitTree),
    "candidate Git tree",
  );
  invariant(value.gitTree === expected.gitTree, "candidate Git-tree binding");
  invariant(
    typeof value.snapshotSeal === "string" && value.snapshotSeal.length > 0,
    "candidate snapshot seal",
  );
  invariant(
    value.snapshotSeal === expected.snapshotSeal,
    "candidate snapshot-seal binding",
  );
}

function assertBrowserCredentialEvidence(value) {
  exactKeys(
    value,
    [
      "credentialDirectoryAbsent",
      "credentialDirectoryCreated",
      "credentialFileCreated",
      "credentialFileMode",
    ],
    "browser credential evidence",
  );
  invariant(value.credentialDirectoryAbsent === true, "browser credential cleanup");
  invariant(value.credentialDirectoryCreated === true, "browser credential creation");
  invariant(value.credentialFileCreated === true, "browser credential-file creation");
  invariant(
    new Set(["0700-directory-0600-file", "windows-current-user-protected"]).has(
      value.credentialFileMode,
    ),
    "browser credential protection",
  );
}

function assertDatabaseCredentialEvidence(value) {
  exactKeys(
    value,
    [
      "credentialDirectoryAbsent",
      "credentialDirectoryCreated",
      "credentialFileAbsent",
      "credentialFileCreated",
      "credentialFileMode",
      "guardedChildInvocations",
      "passwordlessTargetPassedInChildArgv",
      "productionCredentialExcluded",
      "secretPassedInChildArgv",
      "transport",
    ],
    "database credential evidence",
  );
  invariant(value.credentialDirectoryAbsent === true, "database directory cleanup");
  invariant(value.credentialDirectoryCreated === true, "database directory creation");
  invariant(value.credentialFileAbsent === true, "database credential-file cleanup");
  invariant(value.credentialFileCreated === true, "database credential-file creation");
  invariant(
    new Set(["0700-directory-0600-file", "windows-current-user-protected"]).has(
      value.credentialFileMode,
    ),
    "database credential protection",
  );
  invariant(
    safeInteger(value.guardedChildInvocations, 1),
    "database guarded child invocations",
  );
  invariant(
    value.passwordlessTargetPassedInChildArgv === true,
    "passwordless database target",
  );
  invariant(value.productionCredentialExcluded === true, "production exclusion");
  invariant(value.secretPassedInChildArgv === false, "database argv secrecy");
  invariant(value.transport === "pgpass", "database credential transport");
}

function assertPgTapSuites(value, expectedSuites) {
  invariant(Array.isArray(expectedSuites), "trusted pgTAP suite collection");
  invariant(
    Array.isArray(value) && value.length === expectedSuites.length,
    "pgTAP exact suite collection",
  );
  for (const [index, suite] of value.entries()) {
    const expected = expectedSuites[index];
    exactKeys(
      expected,
      ["hardenedQuerySha256", "plannedAssertions", "sourceSha256", "testFile"],
      "trusted pgTAP suite",
    );
    exactKeys(
      suite,
      [
        "assertionsPassed",
        "databaseResultSha256",
        "hardenedQuerySha256",
        "plannedAssertions",
        "resultRowCount",
        "sourceSha256",
        "testFile",
      ],
      "pgTAP suite",
    );
    invariant(
      safeInteger(suite.assertionsPassed, 1) &&
        suite.assertionsPassed === expected.plannedAssertions &&
        suite.plannedAssertions === expected.plannedAssertions,
      "pgTAP assertion count",
    );
    invariant(
      safeInteger(suite.resultRowCount, expected.plannedAssertions + 1),
      "pgTAP result row count",
    );
    invariant(sha256(suite.databaseResultSha256), "pgTAP result digest");
    invariant(
      suite.hardenedQuerySha256 === expected.hardenedQuerySha256,
      "pgTAP hardened-query binding",
    );
    invariant(suite.sourceSha256 === expected.sourceSha256, "pgTAP source binding");
    invariant(suite.testFile === expected.testFile, "pgTAP exact test-file identity");
  }
}

function assertForwardUpgradeEvidence(value, expectedFixture) {
  exactKeys(
    value,
    [
      "appliedPhase2Versions",
      "expectedPhase2Versions",
      "predecessorContract",
      "predecessorFixture",
      "predecessorSeed",
      "predecessorUpgradeExercised",
      "preexistingPhase2Versions",
      "terminalForwardMigration",
      "upgrade",
    ],
    "forward-upgrade evidence",
  );
  const expectedVersions = [
    "20260717121500",
    "20260717121501",
    "20260717121600",
    "20260717121601",
    "20260717121602",
    "20260717121603",
    "20260717121604",
    "20260717121605",
    "20260717121606",
    "20260717121607",
  ];
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
  exactValue(
    value,
    {
      appliedPhase2Versions: expectedVersions,
      expectedPhase2Versions: expectedVersions,
      predecessorContract: {
        coordinateMapVerifierDefault: "postgres-structural-v1",
        legacyMaximumBytes: 65536,
        scriptSizePolicyColumnAbsent: true,
        uniqueAttestationIndex: true,
      },
      predecessorFixture: expectedFixture,
      predecessorSeed: {
        legacyRowCount: 2,
        legacyRows,
        maximumLegacyBytes: 65536,
        minimumLegacyBytes: 8193,
        verifiedV1: true,
      },
      predecessorUpgradeExercised: true,
      preexistingPhase2Versions: expectedVersions.slice(0, -1),
      terminalForwardMigration: expectedVersions.at(-1),
      upgrade: {
        exactV2WriteAccepted: true,
        legacyRows,
        legacyRowsPreserved: true,
        oversizedV2WritesRejected: true,
      },
    },
    "forward-upgrade evidence",
  );
}

function assertBoundaryEvidence(value) {
  exactKeys(
    value,
    ["accepted", "browserRoundTrip", "database", "rejected", "schemaVersion"],
    "boundary evidence",
  );
  exactKeys(
    value.accepted,
    ["bytes", "episodeId", "rawUtf8Sha256", "scriptRevisionId", "status"],
    "accepted boundary",
  );
  exactKeys(value.rejected, ["bytes", "code", "status"], "rejected boundary");
  exactKeys(
    value.database,
    [
      "coordinateMapBytes",
      "coordinateMapVerifier",
      "coordinateMapVersion",
      "rawUtf8Bytes",
      "rawUtf8Sha256",
      "remainingAttestations",
      "scriptRevisionId",
    ],
    "database boundary",
  );
  invariant(
    value.schemaVersion === "genie-script-boundary-evidence.v1",
    "boundary schema",
  );
  invariant(value.browserRoundTrip === true, "browser boundary round trip");
  invariant(
    value.accepted.bytes === 8192 && value.accepted.status === 200,
    "accepted boundary result",
  );
  invariant(uuid(value.accepted.episodeId), "accepted boundary Episode ID");
  invariant(
    uuid(value.accepted.scriptRevisionId),
    "accepted boundary Script Revision ID",
  );
  invariant(sha256(value.accepted.rawUtf8Sha256), "accepted boundary digest");
  invariant(
    value.rejected.bytes === 8193 &&
      value.rejected.status === 400 &&
      value.rejected.code === "SCRIPT_TOO_LARGE",
    "rejected boundary result",
  );
  invariant(
    safeInteger(value.database.coordinateMapBytes, 1) &&
      value.database.coordinateMapBytes <= 8_388_608,
    "database coordinate-map size",
  );
  invariant(
    value.database.coordinateMapVerifier === "postgres-structural-v2" &&
      value.database.coordinateMapVersion === 2,
    "database coordinate verifier",
  );
  invariant(value.database.rawUtf8Bytes === 8192, "database raw-byte boundary");
  invariant(
    value.database.rawUtf8Sha256 === value.accepted.rawUtf8Sha256,
    "database raw-byte digest binding",
  );
  invariant(value.database.remainingAttestations === 0, "boundary attestation cleanup");
  invariant(
    value.database.scriptRevisionId === value.accepted.scriptRevisionId,
    "boundary revision binding",
  );
}

function assertPersistenceEvidence(value) {
  exactKeys(
    value,
    [
      "configurationCount",
      "coordinateMapVersion",
      "episodeId",
      "lockEventCount",
      "processingUtf8Sha256",
      "rawUtf8Sha256",
      "remainingAttestations",
    ],
    "Phase 2 persistence evidence",
  );
  invariant(value.configurationCount === 1, "configuration persistence");
  invariant(value.coordinateMapVersion === 2, "persistence coordinate version");
  invariant(uuid(value.episodeId), "persistence Episode ID");
  invariant(value.lockEventCount === 1, "script-lock event persistence");
  invariant(sha256(value.processingUtf8Sha256), "processing-text digest");
  invariant(sha256(value.rawUtf8Sha256), "raw-text digest");
  invariant(value.remainingAttestations === 0, "persistence attestation cleanup");
}

export function assertClosedCandidateArtifact(
  value,
  { candidateBinding, pgTapSuites, predecessorFixture },
) {
  exactKeys(value, TOP_LEVEL_KEYS, "candidate evidence");
  invariant(
    value.schemaVersion === "genie-live-candidate-evidence.v3",
    "candidate schema version",
  );
  invariant(value.state === "finished", "candidate terminal state");
  invariant(value.outcome === "passed", "candidate outcome");
  invariant(value.executionCompleted === true, "candidate execution completion");
  invariant(value.executionError === null, "candidate execution error");
  invariant(value.candidateBindingVerified === true, "candidate binding revalidation");
  invariant(value.candidateBindingError === null, "candidate binding error");
  invariant(value.cleanupError === null, "candidate cleanup error");
  invariant(
    value.databaseIdentityChallenge === "passed",
    "database identity challenge",
  );
  invariant(value.forwardRollback === "passed", "forward rollback drill");
  invariant(safeInteger(value.apiReadinessAttempts, 1), "API readiness attempts");
  invariant(isoTimestamp(value.startedAt), "candidate start timestamp");
  invariant(isoTimestamp(value.finishedAt), "candidate finish timestamp");
  invariant(
    isoTimestamp(value.candidateRevalidatedAt),
    "candidate revalidation timestamp",
  );
  exactValue(value.predecessorFixture, predecessorFixture, "predecessor fixture");
  assertForwardUpgradeEvidence(value.forwardUpgradeEvidence, predecessorFixture);
  assertCandidateBinding(value.candidate, candidateBinding);
  assertBrowserCredentialEvidence(value.browserCredentialEvidence);
  assertDatabaseCredentialEvidence(value.databaseCredentialEvidence);
  assertPgTapSuites(value.pgTapSuites, pgTapSuites);
  assertBoundaryEvidence(value.boundaryEvidence);
  assertPersistenceEvidence(value.phase2PersistenceEvidence);
  return value;
}

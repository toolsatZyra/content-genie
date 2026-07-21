export type CandidateEvidenceExpectations = Readonly<{
  candidateBinding: Readonly<{
    databaseTests: Readonly<{ fileCount: number; sha256: string }>;
    gitTree: string;
    liveTests: Readonly<{ fileCount: number; sha256: string }>;
    migrations: Readonly<{ fileCount: number; sha256: string }>;
    snapshotSeal: string;
    source: Readonly<{ fileCount: number; sha256: string }>;
  }>;
  candidateMigrations: ReadonlyArray<string>;
  pgTapSuites: ReadonlyArray<
    Readonly<{
      hardenedQuerySha256: string;
      plannedAssertions: number;
      sourceSha256: string;
      testFile: string;
    }>
  >;
  predecessorFixture: unknown;
}>;

export function assertClosedCandidateArtifact(
  value: unknown,
  expectations: CandidateEvidenceExpectations,
): unknown;

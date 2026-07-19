import {
  assertCompletePgTapResult,
  getPlannedPgTapAssertions,
  hardenPgTapQuery,
  splitSqlStatements,
} from "./pgtap-harness-policy.mjs";

const safeSource = [
  "/* outer comment; /* nested; comment */ retained */ begin;",
  "set application_name to foo$tag$;",
  "select plan(3);",
  "select lives_ok($probe$select ';'::text$probe$, 'dollar-quoted semicolon');",
  "select is(E'it\\'s;safe', E'it\\'s;safe', 'E-string escaped quote and semicolon');",
  "select ok(true, 'third assertion');",
  `select set_config('request.jwt.claims', '{"role":"authenticated"}', true);`,
  "select * from finish();",
  "rollback; -- trailing comment without a second transaction",
].join("\n");

if (getPlannedPgTapAssertions(safeSource, "safe.test.sql") !== 3) {
  throw new Error("The exact top-level pgTAP plan was not recovered.");
}
const hardened = hardenPgTapQuery(safeSource, "safe.test.sql");
const hardenedStatements = splitSqlStatements(hardened);
if (!/^\s*\/\*[\s\S]*?\*\/\s*begin\s*;$/iu.test(hardenedStatements[0] ?? "")) {
  throw new Error("The transformed pgTAP transaction does not begin structurally.");
}
if (!/^\s*rollback\s*;/iu.test(hardenedStatements.at(-1) ?? "")) {
  throw new Error("The transformed pgTAP transaction does not roll back structurally.");
}
const captureStatements = hardenedStatements.filter((statement) =>
  /^\s*insert into pg_temp\.genie_tap_output\b/iu.test(statement),
);
if (captureStatements.length !== 6) {
  throw new Error(
    `Expected six structurally captured SELECT statements, got ${captureStatements.length}.`,
  );
}
if (
  captureStatements.filter((statement) => /finish\s*\(\s*true\s*\)/iu.test(statement))
    .length !== 1 ||
  captureStatements.some((statement) => /finish\s*\(\s*\)/iu.test(statement))
) {
  throw new Error("The transformed pgTAP finish contract is not exactly throwing.");
}
if (!captureStatements.some((statement) => statement.includes("E'it\\'s;safe'"))) {
  throw new Error(
    "The E-string escaped quote/semicolon was not retained structurally.",
  );
}

const identifierBoundarySource = [
  "begin;",
  "set application_name to foo$tag$;",
  "set application_name to foo9$tag$;",
  "set application_name to foo_$tag$;",
  "set application_name to é$tag$;",
  "set application_name to foo$$;",
  "select plan(1);",
  "select ok(true, 'identifier boundary');",
  "select * from finish();",
  "rollback;",
].join("\n");
if (splitSqlStatements(identifierBoundarySource).length !== 10) {
  throw new Error("Dollar signs inside PostgreSQL identifiers were treated as quotes.");
}

const hiddenTransactionAtIdentifierBoundary = [
  "begin;",
  "set application_name to foo$tag$; commit; begin; set application_name to bar$tag$;",
  "select plan(1);",
  "select ok(true, 'must remain in one transaction');",
  "select * from finish();",
  "rollback;",
].join("\n");
let hiddenTransactionRejected = false;
try {
  hardenPgTapQuery(
    hiddenTransactionAtIdentifierBoundary,
    "identifier-boundary.test.sql",
  );
} catch {
  hiddenTransactionRejected = true;
}
if (!hiddenTransactionRejected) {
  throw new Error("A transaction hidden at an identifier boundary was accepted.");
}
if (
  !/^\s*select line from pg_temp\.genie_tap_output order by sequence\s*;$/iu.test(
    hardenedStatements.at(-2) ?? "",
  )
) {
  throw new Error(
    "The exact Management API row projection is not immediately before rollback.",
  );
}

assertCompletePgTapResult(
  [
    { line: "1..3" },
    { line: "ok 1 - first" },
    { line: "ok 2 - second" },
    { line: "ok 3 - third" },
    { line: '{"role":"authenticated"}' },
  ],
  3,
  "safe.test.sql",
);

for (const [label, planned, result] of [
  [
    "earlier failure followed by final success",
    3,
    [
      { line: "1..3" },
      { line: "not ok 1 - compromised" },
      { line: "ok 2 - second" },
      { line: "ok 3 - misleading final success" },
    ],
  ],
  [
    "bail out",
    3,
    [{ line: "1..3" }, { line: "Bail out! setup failed" }, { line: "ok 3 - final" }],
  ],
  [
    "duplicate assertion",
    3,
    [
      { line: "1..3" },
      { line: "ok 1 - first" },
      { line: "ok 1 - duplicate" },
      { line: "ok 3 - third" },
    ],
  ],
  [
    "out-of-order assertion",
    3,
    [
      { line: "1..3" },
      { line: "ok 1 - first" },
      { line: "ok 3 - third" },
      { line: "ok 2 - second" },
    ],
  ],
  [
    "missing plan",
    3,
    [{ line: "ok 1 - first" }, { line: "ok 2 - second" }, { line: "ok 3 - third" }],
  ],
  [
    "wrong plan",
    3,
    [
      { line: "1..2" },
      { line: "ok 1 - first" },
      { line: "ok 2 - second" },
      { line: "ok 3 - third" },
    ],
  ],
  [
    "arbitrary object fields forge a pass",
    1,
    { error: "permission denied", fake: "ok 1 - forged", plan: "1..1" },
  ],
  [
    "extra error field",
    1,
    [{ line: "1..1", error: "query failed" }, { line: "ok 1 - forged" }],
  ],
  ["wrong row key", 1, [{ tap: "1..1" }, { tap: "ok 1 - forged" }]],
  ["scalar row", 1, ["1..1", "ok 1 - forged"]],
  ["empty response", 1, []],
]) {
  let rejected = false;
  try {
    assertCompletePgTapResult(result, planned, `${label}.test.sql`);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error(`Unsafe pgTAP result was accepted: ${label}`);
}

for (const query of [
  "begin; select plan(1); select ok(true); select * from finish(true); rollback;",
  "begin; select plan(1); select ok(true); rollback;",
  "begin; select plan(1); select * from finish(); select * from finish(); rollback;",
  "begin; select plan(1); select ok(true); select * from finish();",
  "select plan(1); select ok(true); select * from finish(); rollback;",
  "select 1; begin; select plan(1); select ok(true); select * from finish(); rollback;",
  "begin; select plan(1); select ok(true); select * from finish(); rollback; select 1;",
  "begin; begin; select plan(1); select ok(true); select * from finish(); rollback;",
  "begin; select plan(1); select ok(true); select * from finish(); rollback; rollback;",
  "begin; -- select plan(1);\n select ok(true); select * from finish(); rollback;",
]) {
  let rejected = false;
  try {
    hardenPgTapQuery(query, "unsafe.test.sql");
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error(`Unsafe pgTAP transaction was accepted: ${query}`);
}

console.log(
  "PASS fail-closed pgTAP transformer, exact row schema, and hostile controls",
);

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { assertCheckpointVerified } from "./assert-traceability-checkpoint.mjs";

const source = JSON.parse(
  readFileSync(
    new URL("../reference/acceptance/traceability-plan.v1.json", import.meta.url),
    "utf8",
  ),
);
const phase0 = structuredClone(source);
const obligations = phase0.requirements.flatMap((requirement) =>
  requirement.obligations.filter((obligation) => obligation.checkpoint === "phase0"),
);
assert.ok(obligations.length > 0);

for (const obligation of obligations) {
  obligation.status = "verified";
  obligation.commit = "1234567";
  obligation.verifiedAt = "2026-07-17T00:00:00.000Z";
  obligation.evidence = [
    {
      path: "docs/evidence/phase0/gate-report.md",
      sha256: "a".repeat(64),
    },
  ];
}
assert.equal(assertCheckpointVerified(phase0, "phase0"), obligations.length);

obligations[0].status = "unimplemented";
assert.throws(() => assertCheckpointVerified(phase0, "phase0"), /gate is not verified/);
obligations[0].status = "verified";
obligations[0].evidence = [];
assert.throws(() => assertCheckpointVerified(phase0, "phase0"), /gate is not verified/);

console.log("PASS checkpoint gate positive and negative-control mutations");

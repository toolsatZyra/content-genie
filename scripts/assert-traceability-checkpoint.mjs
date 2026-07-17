import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function assertCheckpointVerified(plan, checkpoint) {
  const obligations = plan.requirements.flatMap((requirement) =>
    requirement.obligations.filter(
      (obligation) => obligation.checkpoint === checkpoint,
    ),
  );
  if (obligations.length === 0) {
    throw new Error(`Traceability checkpoint has no obligations: ${checkpoint}`);
  }

  const incomplete = obligations.filter(
    (obligation) =>
      obligation.status !== "verified" ||
      !obligation.commit ||
      !obligation.verifiedAt ||
      !Array.isArray(obligation.evidence) ||
      obligation.evidence.length === 0,
  );
  if (incomplete.length > 0) {
    throw new Error(
      `${checkpoint} gate is not verified: ${incomplete
        .map((obligation) => `${obligation.obligationId}=${obligation.status}`)
        .join(", ")}`,
    );
  }
  return obligations.length;
}

function run() {
  const checkpoint = process.argv[2];
  if (!checkpoint) {
    throw new Error("Usage: assert-traceability-checkpoint.mjs <checkpoint>");
  }
  const plan = JSON.parse(
    readFileSync(
      new URL("../reference/acceptance/traceability-plan.v1.json", import.meta.url),
      "utf8",
    ),
  );
  const count = assertCheckpointVerified(plan, checkpoint);
  console.log(`PASS ${checkpoint} traceability gate (${count} verified obligations)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run();
}

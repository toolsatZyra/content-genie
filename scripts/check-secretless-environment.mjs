import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { serverOnlyVariables } from "./server-only-variables.mjs";

function assertSecretless(source) {
  const present = serverOnlyVariables.filter((name) => Boolean(source[name]));
  if (present.length > 0) {
    throw new Error(
      `Secretless execution received forbidden variables: ${present.join(", ")}`,
    );
  }

  const productionRef = source.SUPABASE_PROJECT_REF;
  const testRef = source.SUPABASE_TEST_PROJECT_REF;
  if (productionRef && testRef && productionRef === testRef) {
    throw new Error("Test and production Supabase project refs must differ.");
  }

  if (
    source.GENIE_ENABLE_PROVIDER_SPEND === "true" ||
    source.GENIE_ENABLE_RENDER === "true" ||
    source.GENIE_ENABLE_EXPORT === "true" ||
    source.GENIE_ENABLE_FINAL_APPROVAL === "true"
  ) {
    throw new Error("Secretless execution cannot enable consequential feature gates.");
  }
}

if (process.argv.includes("--assert-current")) {
  assertSecretless(process.env);
  console.log("PASS current process is secretless");
} else {
  const cleanEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !serverOnlyVariables.includes(name)),
  );
  cleanEnvironment.GENIE_ENABLE_EXPORT = "false";
  cleanEnvironment.GENIE_ENABLE_FINAL_APPROVAL = "false";
  cleanEnvironment.GENIE_ENABLE_PROVIDER_SPEND = "false";
  cleanEnvironment.GENIE_ENABLE_RENDER = "false";

  const script = fileURLToPath(import.meta.url);
  const clean = spawnSync(process.execPath, [script, "--assert-current"], {
    encoding: "utf8",
    env: cleanEnvironment,
  });
  if (clean.error) throw clean.error;
  if (clean.status !== 0) {
    throw new Error("Isolated secretless child was rejected.");
  }

  const poisonedSecrets = serverOnlyVariables.map((name) =>
    spawnSync(process.execPath, [script, "--assert-current"], {
      encoding: "utf8",
      env: {
        ...cleanEnvironment,
        [name]: "seeded-negative-test-value",
      },
    }),
  );
  const poisonedGate = spawnSync(process.execPath, [script, "--assert-current"], {
    encoding: "utf8",
    env: {
      ...cleanEnvironment,
      GENIE_ENABLE_PROVIDER_SPEND: "true",
    },
  });
  if (
    poisonedSecrets.some((result) => result.status === 0) ||
    poisonedGate.status === 0 ||
    poisonedSecrets.some((result) => result.error)
  ) {
    throw new Error("Secretless negative-control mutation was not rejected.");
  }

  console.log("PASS isolated secretless child and negative-control mutations");
}

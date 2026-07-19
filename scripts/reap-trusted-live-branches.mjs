import { existsSync } from "node:fs";
import { resolve } from "node:path";

import {
  reapTrustedLiveBranches,
  trustedLiveBranchReaperEnvironment,
} from "./live-branch-reaper.mjs";

const scheduled =
  process.env.GENIE_LIVE_BRANCH_REAPER_SCHEDULED === "true" ||
  process.env.GITHUB_EVENT_NAME === "schedule";
const configuration = trustedLiveBranchReaperEnvironment(process.env, { scheduled });
const supabaseCli = resolve("node_modules", "supabase", "dist", "supabase.js");
if (!existsSync(supabaseCli)) {
  throw new Error("The pinned Supabase CLI is required for trusted branch reaping.");
}

const operatingNames = new Set([
  "APPDATA",
  "CI",
  "COMSPEC",
  "HOME",
  "HOMEDRIVE",
  "HOMEPATH",
  "LANG",
  "LC_ALL",
  "LOCALAPPDATA",
  "NODE_EXTRA_CA_CERTS",
  "OS",
  "PATH",
  "PATHEXT",
  "SYSTEMDRIVE",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "TMPDIR",
  "USERPROFILE",
  "WINDIR",
]);
const environment = Object.fromEntries(
  Object.entries(process.env).filter(
    ([name, value]) => value !== undefined && operatingNames.has(name.toUpperCase()),
  ),
);
environment.SUPABASE_ACCESS_TOKEN = configuration.accessToken;

const result = await reapTrustedLiveBranches({
  accessToken: configuration.accessToken,
  environment,
  minimumAgeMs: configuration.minimumAgeMs,
  node: process.execPath,
  productionRef: configuration.productionRef,
  supabaseCli,
});

console.log(
  JSON.stringify({
    failureCount: result.failures.length,
    failures: result.failures,
    leasedBranchesReaped: result.leased.length,
    orphanBranchesReaped: result.orphaned.length,
    outcome:
      result.failures.length === 0
        ? "trusted-live-branch-reaping-complete"
        : "trusted-live-branch-reaping-incomplete",
  }),
);

if (result.failures.length > 0) {
  process.exitCode = 1;
}

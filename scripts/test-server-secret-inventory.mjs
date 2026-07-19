import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { serverOnlyVariables } from "./server-only-variables.mjs";

const root = process.cwd();
const example = fs.readFileSync(path.join(root, ".env.example"), "utf8");
const contract = fs.readFileSync(
  path.join(root, "docs", "environment-contract.md"),
  "utf8",
);
const inventory = new Set(serverOnlyVariables);
const publicExceptions = new Set([
  "GENIE_BROKER_CLIENT_PUBLIC_KEYS_JSON",
  "GENIE_CAPABILITY_VERIFY_PUBLIC_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
]);
const sensitiveName =
  /(?:API_KEY|ACCESS_TOKEN|CALLBACK_SECRET|CLIENT_SECRET|CRON_SECRET|DB_URL|HMAC_SECRET|PRIVATE_KEY|SECRET_KEY|SERVICE_ROLE_KEY|SIGNING_KEY)/;

const exampleNames = [...example.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map(
  (match) => match[1],
);
const documentedNames = [...contract.matchAll(/\| `([A-Z][A-Z0-9_]*)` \|/g)].map(
  (match) => match[1],
);
const required = [...new Set([...exampleNames, ...documentedNames])]
  .filter((name) => sensitiveName.test(name))
  .filter((name) => !name.startsWith("NEXT_PUBLIC_"))
  .filter((name) => !publicExceptions.has(name))
  .sort();
const missing = required.filter((name) => !inventory.has(name));

assert.deepEqual(
  missing,
  [],
  `Documented server secrets missing from config/server-only-variables.json: ${missing.join(", ")}`,
);
for (const name of [
  "GENIE_LIVE_BROKER_SIGNING_PRIVATE_KEY_PKCS8_BASE64",
  "GENIE_LIVE_EVIDENCE_PRIVATE_KEY_PKCS8_BASE64",
]) {
  assert.ok(inventory.has(name), `${name} must be in the server-secret inventory`);
}

console.log(
  `PASS complete server-secret inventory (${required.length} documented secret-bearing variables)`,
);

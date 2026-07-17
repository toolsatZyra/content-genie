import assert from "node:assert/strict";

import { detectHighConfidenceSecrets } from "./secret-patterns.mjs";

const syntheticAws = ["AKIA", "ABCDEFGHIJKLMNOP"].join("");
const syntheticGithub = ["ghp_", "a".repeat(36)].join("");
assert.deepEqual(detectHighConfidenceSecrets("OPENAI_API_KEY="), []);
assert.deepEqual(detectHighConfidenceSecrets("sk-test-fixture"), []);
assert.ok(detectHighConfidenceSecrets(syntheticAws).includes("AWS access key"));
assert.ok(detectHighConfidenceSecrets(syntheticGithub).includes("GitHub token"));

console.log("PASS repository secret pattern positive and negative controls");

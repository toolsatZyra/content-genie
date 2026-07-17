import assert from "node:assert/strict";

import { evaluateProductionLicenses } from "./license-policy.mjs";

assert.deepEqual(evaluateProductionLicenses({ MIT: [{ name: "safe-package" }] }), {
  packages: 1,
  rejected: [],
});
assert.equal(
  evaluateProductionLicenses({
    "AGPL-3.0": [{ name: "forbidden-package" }],
  }).rejected.length,
  1,
);
assert.equal(
  evaluateProductionLicenses({
    "Custom-Proprietary": [{ name: "unknown-package" }],
  }).rejected.length,
  1,
);

console.log("PASS license policy allowlist and negative-control mutations");

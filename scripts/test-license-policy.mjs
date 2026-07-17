import assert from "node:assert/strict";

import { evaluateProductionLicenses } from "./license-policy.mjs";

assert.deepEqual(evaluateProductionLicenses({ MIT: [{ name: "safe-package" }] }), {
  packages: 1,
  rejected: [],
});
assert.deepEqual(
  evaluateProductionLicenses({
    "LGPL-3.0-or-later": [{ name: "@img/sharp-libvips-linux-x64" }],
  }),
  {
    packages: 1,
    rejected: [],
  },
);
assert.deepEqual(
  evaluateProductionLicenses({
    "LGPL-3.0-or-later": [{ name: "@img/sharp-libvips-linuxmusl-x64" }],
  }),
  {
    packages: 1,
    rejected: [],
  },
);
assert.equal(
  evaluateProductionLicenses({
    "LGPL-3.0-or-later": [{ name: "unrelated-lgpl-package" }],
  }).rejected.length,
  1,
);
assert.equal(
  evaluateProductionLicenses({
    "AGPL-3.0": [{ name: "@img/sharp-libvips-linux-x64" }],
  }).rejected.length,
  1,
);
assert.equal(
  evaluateProductionLicenses({
    "AGPL-3.0": [{ name: "@img/sharp-libvips-linuxmusl-x64" }],
  }).rejected.length,
  1,
);
assert.equal(
  evaluateProductionLicenses({
    "LGPL-3.0-or-later": [{}],
  }).rejected.length,
  1,
);
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

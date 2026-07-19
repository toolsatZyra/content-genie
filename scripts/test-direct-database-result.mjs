import assert from "node:assert/strict";

import {
  strictDatabaseInteger,
  terminalDatabaseRows,
} from "./direct-database-result.mjs";

const row = { exact: true };
assert.deepEqual(terminalDatabaseRows([row]), [row]);
assert.deepEqual(terminalDatabaseRows([[], [row]]), [row]);
assert.deepEqual(terminalDatabaseRows([]), []);
assert.throws(() => terminalDatabaseRows(null), /non-array/);
assert.throws(() => terminalDatabaseRows([[row], "invalid"]), /invalid terminal/);

assert.equal(strictDatabaseInteger(4, "version"), 4);
assert.equal(strictDatabaseInteger("4", "version"), 4);
assert.equal(strictDatabaseInteger("0", "count"), 0);
assert.equal(strictDatabaseInteger("-1", "offset"), -1);
for (const hostile of [
  "04",
  "+4",
  " 4",
  "4 ",
  "4.0",
  "1e2",
  "9007199254740992",
  Number.NaN,
  Number.POSITIVE_INFINITY,
  4.5,
  4n,
  null,
]) {
  assert.throws(
    () => strictDatabaseInteger(hostile, "hostile"),
    /canonical safe database integer/,
  );
}

console.log("PASS direct PostgreSQL terminal rowset and strict integer normalization");

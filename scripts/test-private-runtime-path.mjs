import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
  assertPrivateRuntimeDirectory,
  assertPrivateRuntimeFile,
  createPrivateRuntimeDirectory,
  removePrivateRuntimeDirectory,
  sealPrivateRuntimeSnapshot,
  writePrivateRuntimeFile,
} from "./private-runtime-path.mjs";

const testPrefix = "private-runtime-test-";
const snapshotPrefix = "private-snapshot-test-";
const unsafePrefix = "private-runtime-unsafe-";

function broadenWindowsAcl(targetPath) {
  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;
  const pathExt = process.env.PATHEXT;
  assert.ok(systemRoot && pathExt, "Windows ACL test support is unavailable.");
  const result = spawnSync(
    join(systemRoot, "System32", "icacls.exe"),
    [targetPath, "/grant", "*S-1-5-11:(RX)"],
    {
      encoding: "utf8",
      env: { PATHEXT: pathExt, SystemRoot: systemRoot, WINDIR: systemRoot },
      shell: false,
      stdio: "pipe",
      windowsHide: true,
    },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, "Windows ACL test mutation failed.");
}

async function broadenPermissions(targetPath, kind) {
  if (process.platform === "win32") {
    broadenWindowsAcl(targetPath);
  } else {
    await chmod(targetPath, kind === "directory" ? 0o755 : 0o644);
  }
}

let privateDirectory = null;
try {
  privateDirectory = await createPrivateRuntimeDirectory(testPrefix);
  const privateFile = join(privateDirectory, "credential.txt");
  await writePrivateRuntimeFile(privateFile, "synthetic-test-value", testPrefix);
  await assertPrivateRuntimeDirectory(privateDirectory, testPrefix);
  await assertPrivateRuntimeFile(privateFile, testPrefix);

  await assert.rejects(
    writePrivateRuntimeFile(privateFile, "replacement", testPrefix),
    /EEXIST|already exists/i,
  );

  await broadenPermissions(privateFile, "file");
  await assert.rejects(
    assertPrivateRuntimeFile(privateFile, testPrefix),
    /permissions|ACL validation/i,
  );

  await broadenPermissions(privateDirectory, "directory");
  await assert.rejects(
    assertPrivateRuntimeDirectory(privateDirectory, testPrefix),
    /permissions|ACL validation/i,
  );
} finally {
  if (privateDirectory) {
    await removePrivateRuntimeDirectory(privateDirectory, testPrefix);
  }
}
assert.equal(
  privateDirectory ? existsSync(privateDirectory) : false,
  false,
  "Private runtime cleanup left a directory behind.",
);

await mkdir(resolve(".tmp"), { recursive: true });
const unsafeDirectory = await mkdtemp(join(resolve(".tmp"), unsafePrefix));
try {
  await broadenPermissions(unsafeDirectory, "directory");
  await assert.rejects(
    writePrivateRuntimeFile(
      join(unsafeDirectory, "must-not-exist.txt"),
      "synthetic-test-value",
      unsafePrefix,
    ),
    /outside the trusted root|permissions|ACL validation/i,
  );
  assert.equal(existsSync(join(unsafeDirectory, "must-not-exist.txt")), false);
} finally {
  const temporaryRoot = resolve(".tmp");
  assert.equal(dirname(resolve(unsafeDirectory)), temporaryRoot);
  await rm(unsafeDirectory, { force: true, recursive: true });
}

await assert.rejects(
  removePrivateRuntimeDirectory(resolve(".tmp", "artifacts"), testPrefix),
  /cleanup path is invalid/,
);
await assert.rejects(createPrivateRuntimeDirectory("../escape-"), /prefix is invalid/);

const exactIdentityDirectory = await createPrivateRuntimeDirectory(testPrefix);
try {
  await assert.rejects(
    removePrivateRuntimeDirectory(exactIdentityDirectory, "different-prefix-"),
    /identity is invalid/,
  );
} finally {
  await removePrivateRuntimeDirectory(exactIdentityDirectory, testPrefix);
}

const replacedIdentityDirectory = await createPrivateRuntimeDirectory(testPrefix);
await rm(replacedIdentityDirectory, { force: true, recursive: true });
await mkdir(replacedIdentityDirectory);
try {
  await assert.rejects(
    removePrivateRuntimeDirectory(replacedIdentityDirectory, testPrefix),
    /object identity changed/,
  );
} finally {
  await rm(replacedIdentityDirectory, { force: true, recursive: true });
}

let snapshotDirectory = null;
try {
  snapshotDirectory = await createPrivateRuntimeDirectory(snapshotPrefix);
  const sourceFile = join(snapshotDirectory, "bound-source.txt");
  const writableDirectory = join(snapshotDirectory, ".tmp");
  await writeFile(sourceFile, "bound-source", { flag: "wx" });
  await mkdir(writableDirectory);
  await sealPrivateRuntimeSnapshot(snapshotDirectory, snapshotPrefix, [".tmp"]);
  await assert.rejects(
    writeFile(sourceFile, "mutated-source"),
    /EACCES|EPERM|access.*denied/i,
  );
  await writeFile(join(writableDirectory, "runtime-output.txt"), "runtime-output", {
    flag: "wx",
  });
} finally {
  if (snapshotDirectory) {
    await removePrivateRuntimeDirectory(snapshotDirectory, snapshotPrefix);
  }
}
assert.equal(snapshotDirectory ? existsSync(snapshotDirectory) : false, false);

console.log(
  "PASS private credential roots, exact cleanup, sealed snapshots, and hostile controls",
);

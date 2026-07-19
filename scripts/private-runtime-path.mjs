import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";

const WINDOWS_ACL_SUCCESS = "PRIVATE_RUNTIME_ACL_OK";
const managedDirectoryIdentities = new Map();
const managedFileIdentities = new Map();
export const DATABASE_PGPASS_PREFIX = "database-pgpass-";
export const LIVE_CREDENTIALS_PREFIX = "phase1-live-credentials-";
export const LIVE_SNAPSHOT_PREFIX = "live-staged-snapshot-";
const WINDOWS_ACL_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$TargetPath = [Environment]::GetEnvironmentVariable('GENIE_PRIVATE_ACL_PATH')
$TargetKind = [Environment]::GetEnvironmentVariable('GENIE_PRIVATE_ACL_KIND')
$Operation = [Environment]::GetEnvironmentVariable('GENIE_PRIVATE_ACL_OPERATION')
if (
  [string]::IsNullOrWhiteSpace($TargetPath) -or
  $TargetKind -notin @('directory', 'file', 'sealed-directory', 'trusted-parent') -or
  $Operation -notin @('protect', 'seal', 'verify')
) { throw 'invalid private ACL invocation' }
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
if ($null -eq $sid) { throw 'current identity has no SID' }

if ($TargetKind -eq 'trusted-parent') {
  if ($Operation -ne 'verify') { throw 'invalid trusted-parent ACL operation' }
  $parentAcl = [System.IO.Directory]::GetAccessControl(
    $TargetPath,
    [System.Security.AccessControl.AccessControlSections]::Access -bor
      [System.Security.AccessControl.AccessControlSections]::Owner
  )
  $allowedSids = @(
    $sid.Value,
    'S-1-5-18',
    'S-1-5-32-544'
  )
  $ownerSid = $parentAcl.GetOwner(
    [System.Security.Principal.SecurityIdentifier]
  ).Value
  if ($allowedSids -notcontains $ownerSid) {
    throw 'runtime parent owner is untrusted'
  }
  $dangerousRights =
    [System.Security.AccessControl.FileSystemRights]::WriteData -bor
    [System.Security.AccessControl.FileSystemRights]::AppendData -bor
    [System.Security.AccessControl.FileSystemRights]::WriteExtendedAttributes -bor
    [System.Security.AccessControl.FileSystemRights]::WriteAttributes -bor
    [System.Security.AccessControl.FileSystemRights]::Delete -bor
    [System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
    [System.Security.AccessControl.FileSystemRights]::ChangePermissions -bor
    [System.Security.AccessControl.FileSystemRights]::TakeOwnership
  $parentRules = @($parentAcl.GetAccessRules(
    $true,
    $true,
    [System.Security.Principal.SecurityIdentifier]
  ))
  foreach ($parentRule in $parentRules) {
    if (
      $parentRule.AccessControlType -eq
        [System.Security.AccessControl.AccessControlType]::Allow -and
      ($parentRule.FileSystemRights -band $dangerousRights) -ne 0 -and
      $allowedSids -notcontains $parentRule.IdentityReference.Value
    ) {
      throw 'runtime parent grants mutation authority to an untrusted principal'
    }
  }
  [Console]::Out.Write('${WINDOWS_ACL_SUCCESS}')
  exit 0
}

if ($Operation -in @('protect', 'seal')) {
  $icacls = Join-Path $env:SystemRoot 'System32\icacls.exe'
  if (-not (Test-Path -LiteralPath $icacls -PathType Leaf)) {
    throw 'private ACL utility is unavailable'
  }
  $grant = if ($Operation -eq 'seal') {
    '*' + $sid.Value + ':(OI)(CI)(RX)'
  } elseif ($TargetKind -eq 'directory') {
    '*' + $sid.Value + ':(OI)(CI)(F)'
  } else {
    '*' + $sid.Value + ':(F)'
  }
  & $icacls $TargetPath '/reset' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'private ACL reset failed' }
  & $icacls $TargetPath '/inheritance:r' '/grant:r' $grant | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'private ACL update failed' }
}

if ($TargetKind -in @('directory', 'sealed-directory')) {
  $verified = [System.IO.Directory]::GetAccessControl(
    $TargetPath,
    [System.Security.AccessControl.AccessControlSections]::Access
  )
} else {
  $verified = [System.IO.File]::GetAccessControl(
    $TargetPath,
    [System.Security.AccessControl.AccessControlSections]::Access
  )
}
$rules = @($verified.GetAccessRules(
  $true,
  $true,
  [System.Security.Principal.SecurityIdentifier]
))
if (-not $verified.AreAccessRulesProtected -or $rules.Count -ne 1) {
  throw 'private ACL is not protected and singular'
}
$verifiedRule = $rules[0]
$expectedRights = if ($TargetKind -eq 'sealed-directory') {
  [System.Security.AccessControl.FileSystemRights]::ReadAndExecute -bor
    [System.Security.AccessControl.FileSystemRights]::Synchronize
} else {
  [System.Security.AccessControl.FileSystemRights]::FullControl
}
if (
  -not $verifiedRule.IdentityReference.Equals($sid) -or
  $verifiedRule.IsInherited -or
  $verifiedRule.AccessControlType -ne
    [System.Security.AccessControl.AccessControlType]::Allow -or
  $verifiedRule.FileSystemRights -ne $expectedRights
) {
  throw 'private ACL does not belong exclusively to the current identity'
}
if (
  ($TargetKind -in @('directory', 'sealed-directory') -and
    $verifiedRule.InheritanceFlags -ne (
      [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
      [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
    )) -or
  ($TargetKind -eq 'file' -and
    $verifiedRule.InheritanceFlags -ne
      [System.Security.AccessControl.InheritanceFlags]::None)
) {
  throw 'private ACL inheritance is invalid'
}
[Console]::Out.Write('${WINDOWS_ACL_SUCCESS}')
`;

function windowsPowerShellPath() {
  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;
  if (!systemRoot || !isAbsolute(systemRoot)) {
    throw new Error("Private runtime ACL support is unavailable.");
  }
  const executable = join(
    systemRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  if (!existsSync(executable)) {
    throw new Error("Private runtime ACL support is unavailable.");
  }
  return executable;
}

function windowsAclEnvironment(targetPath, targetKind, operation) {
  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;
  const pathExt = process.env.PATHEXT;
  if (!systemRoot || !pathExt) {
    throw new Error("Private runtime ACL support is unavailable.");
  }
  return {
    GENIE_PRIVATE_ACL_KIND: targetKind,
    GENIE_PRIVATE_ACL_OPERATION: operation,
    GENIE_PRIVATE_ACL_PATH: targetPath,
    PATHEXT: pathExt,
    SystemRoot: systemRoot,
    WINDIR: systemRoot,
  };
}

function runWindowsAcl(targetPath, targetKind, operation) {
  const result = spawnSync(
    windowsPowerShellPath(),
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", WINDOWS_ACL_SCRIPT],
    {
      encoding: "utf8",
      env: windowsAclEnvironment(targetPath, targetKind, operation),
      shell: false,
      stdio: "pipe",
      windowsHide: true,
    },
  );
  if (
    result.error ||
    result.status !== 0 ||
    result.stdout.trim() !== WINDOWS_ACL_SUCCESS
  ) {
    throw new Error("Private runtime ACL validation failed.");
  }
}

function assertSafePrefix(prefix) {
  if (
    typeof prefix !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}-$/.test(prefix)
  ) {
    throw new Error("Private runtime directory prefix is invalid.");
  }
}

function assertManagedName(name, prefix) {
  assertSafePrefix(prefix);
  if (!name.startsWith(prefix) || !/^[A-Za-z0-9]{6}$/.test(name.slice(prefix.length))) {
    throw new Error("Private runtime directory identity is invalid.");
  }
}

async function assertExpectedType(path, kind) {
  const status = await lstat(path);
  if (status.isSymbolicLink()) {
    throw new Error("Private runtime path must not be a symbolic link.");
  }
  if (
    (kind === "directory" && !status.isDirectory()) ||
    (kind === "file" && !status.isFile())
  ) {
    throw new Error("Private runtime path has an invalid filesystem type.");
  }
  return status;
}

async function filesystemIdentity(path) {
  const status = await lstat(path, { bigint: true });
  return `${status.dev}:${status.ino}:${status.birthtimeNs}`;
}

async function rememberIdentity(registry, path) {
  const absolute = resolve(path);
  const identity = await filesystemIdentity(absolute);
  registry.set(absolute, identity);
  return identity;
}

async function assertRememberedIdentity(registry, path, label) {
  const absolute = resolve(path);
  const expected = registry.get(absolute);
  if (!expected || (await filesystemIdentity(absolute)) !== expected) {
    throw new Error(`Private runtime ${label} object identity changed.`);
  }
  return expected;
}

async function assertPosixMode(path, kind, expectedMode) {
  const status = await assertExpectedType(path, kind);
  if ((status.mode & 0o777) !== expectedMode) {
    throw new Error("Private runtime path permissions are invalid.");
  }
  if (typeof process.getuid === "function" && status.uid !== process.getuid()) {
    throw new Error("Private runtime path ownership is invalid.");
  }
}

async function privateRuntimeRoot() {
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA;
    if (!localAppData || !isAbsolute(localAppData)) {
      throw new Error("Private runtime root is unavailable.");
    }
    const base = resolve(localAppData);
    await assertExpectedType(base, "directory");
    runWindowsAcl(base, "trusted-parent", "verify");
    const components = [join(base, "Zyra"), join(base, "Zyra", "Genie")];
    const root = join(base, "Zyra", "Genie", "Runtime");
    const created = await mkdir(root, { recursive: true });
    for (const component of components) {
      await assertExpectedType(component, "directory");
      runWindowsAcl(component, "trusted-parent", "verify");
    }
    await assertExpectedType(root, "directory");
    if (created) runWindowsAcl(root, "directory", "protect");
    else runWindowsAcl(root, "directory", "verify");
    return root;
  }

  const root = resolve(tmpdir());
  const status = await assertExpectedType(root, "directory");
  const currentUid = typeof process.getuid === "function" ? process.getuid() : null;
  const ownerTrusted =
    currentUid === null || status.uid === 0 || status.uid === currentUid;
  const writableByOthers = (status.mode & 0o022) !== 0;
  const sticky = (status.mode & 0o1000) !== 0;
  if (!ownerTrusted || (writableByOthers && !sticky)) {
    throw new Error("Private runtime root permissions are unsafe.");
  }
  return root;
}

async function assertPrivateAclDirectory(directoryPath) {
  const absolute = resolve(directoryPath);
  await assertExpectedType(absolute, "directory");
  if (process.platform === "win32") {
    runWindowsAcl(absolute, "directory", "verify");
  } else {
    await assertPosixMode(absolute, "directory", 0o700);
  }
}

async function assertManagedRuntimeDirectory(directoryPath, prefix) {
  const absolute = resolve(directoryPath);
  const root = await privateRuntimeRoot();
  if (dirname(absolute) !== root) {
    throw new Error("Private runtime directory is outside the trusted root.");
  }
  assertManagedName(basename(absolute), prefix);
  await assertRememberedIdentity(managedDirectoryIdentities, absolute, "directory");
  await assertPrivateAclDirectory(absolute);
  return absolute;
}

export async function assertPrivateRuntimeDirectory(directoryPath, prefix) {
  await assertManagedRuntimeDirectory(directoryPath, prefix);
}

export async function assertPrivateRuntimeFile(filePath, prefix) {
  const { absolute, parent } = directChildPath(filePath);
  await assertManagedRuntimeDirectory(parent, prefix);
  await assertExpectedType(absolute, "file");
  await assertRememberedIdentity(managedFileIdentities, absolute, "file");
  if (process.platform === "win32") {
    runWindowsAcl(absolute, "file", "verify");
  } else {
    await assertPosixMode(absolute, "file", 0o600);
  }
}

export async function createPrivateRuntimeDirectory(prefix) {
  assertSafePrefix(prefix);
  const root = await privateRuntimeRoot();
  const directory = await mkdtemp(join(root, prefix));
  try {
    await assertExpectedType(directory, "directory");
    if (process.platform === "win32") {
      runWindowsAcl(directory, "directory", "protect");
    } else {
      await chmod(directory, 0o700);
    }
    await rememberIdentity(managedDirectoryIdentities, directory);
    await assertManagedRuntimeDirectory(directory, prefix);
    return directory;
  } catch (error) {
    managedDirectoryIdentities.delete(resolve(directory));
    await rm(directory, { force: true, recursive: true }).catch(() => {});
    throw error;
  }
}

function directChildPath(filePath) {
  const absolute = resolve(filePath);
  const parent = dirname(absolute);
  const name = basename(absolute);
  if (
    !name ||
    name === "." ||
    name === ".." ||
    absolute !== join(parent, name) ||
    absolute === parse(absolute).root
  ) {
    throw new Error("Private runtime file path is invalid.");
  }
  return { absolute, parent };
}

export async function writePrivateRuntimeFile(filePath, contents, prefix) {
  const { absolute, parent } = directChildPath(filePath);
  const parentIdentity = await assertManagedRuntimeDirectory(parent, prefix);
  await writeFile(absolute, contents, {
    encoding: typeof contents === "string" ? "utf8" : undefined,
    flag: "wx",
    mode: 0o600,
  });
  try {
    if (process.platform === "win32") {
      runWindowsAcl(absolute, "file", "protect");
    } else {
      await chmod(absolute, 0o600);
    }
    await rememberIdentity(managedFileIdentities, absolute);
    await assertRememberedIdentity(
      managedDirectoryIdentities,
      parentIdentity,
      "directory",
    );
    await assertPrivateRuntimeFile(absolute, prefix);
  } catch (error) {
    managedFileIdentities.delete(absolute);
    await rm(absolute, { force: true }).catch(() => {});
    throw error;
  }
}

function assertWritableSnapshotPath(snapshotRoot, candidatePath) {
  if (isAbsolute(candidatePath)) {
    throw new Error("Snapshot writable path must be relative.");
  }
  const absolute = resolve(snapshotRoot, candidatePath);
  const fromRoot = relative(snapshotRoot, absolute);
  if (!fromRoot || fromRoot.startsWith(`..${sep}`) || fromRoot === "..") {
    throw new Error("Snapshot writable path escapes the private snapshot.");
  }
  return absolute;
}

async function sealPosixTree(path, writableRoots) {
  const absolute = resolve(path);
  if (writableRoots.has(absolute)) {
    await chmod(absolute, 0o700);
    return;
  }
  const status = await lstat(absolute);
  if (status.isSymbolicLink()) return;
  if (status.isDirectory()) {
    for (const entry of await readdir(absolute)) {
      await sealPosixTree(join(absolute, entry), writableRoots);
    }
    await chmod(absolute, 0o555);
  } else if (status.isFile()) {
    await chmod(absolute, 0o444);
  }
}

async function makePosixTreeWritable(path) {
  const status = await lstat(path);
  if (status.isSymbolicLink()) return;
  if (status.isDirectory()) {
    await chmod(path, 0o700);
    for (const entry of await readdir(path)) {
      await makePosixTreeWritable(join(path, entry));
    }
  } else if (status.isFile()) {
    await chmod(path, 0o600);
  }
}

export async function sealPrivateRuntimeSnapshot(
  directoryPath,
  prefix,
  writableRelativePaths,
) {
  const absolute = await assertManagedRuntimeDirectory(directoryPath, prefix);
  const writablePaths = new Set(
    writableRelativePaths.map((path) => assertWritableSnapshotPath(absolute, path)),
  );
  for (const writablePath of writablePaths) {
    await mkdir(writablePath, { recursive: true });
  }
  if (process.platform === "win32") {
    for (const writablePath of writablePaths) {
      runWindowsAcl(writablePath, "directory", "protect");
    }
    runWindowsAcl(absolute, "sealed-directory", "seal");
    runWindowsAcl(absolute, "sealed-directory", "verify");
  } else {
    await sealPosixTree(absolute, writablePaths);
    const status = await assertExpectedType(absolute, "directory");
    if ((status.mode & 0o777) !== 0o555) {
      throw new Error("Private runtime snapshot sealing failed.");
    }
  }
}

export async function removePrivateRuntimeDirectory(directoryPath, prefix) {
  const absolute = resolve(directoryPath);
  const root = await privateRuntimeRoot();
  if (dirname(absolute) !== root) {
    throw new Error("Private runtime cleanup path is invalid.");
  }
  assertManagedName(basename(absolute), prefix);
  const expectedIdentity = managedDirectoryIdentities.get(absolute);
  if (!expectedIdentity) {
    throw new Error("Private runtime cleanup has no created object identity.");
  }
  if (existsSync(absolute)) {
    await assertExpectedType(absolute, "directory");
    await assertRememberedIdentity(managedDirectoryIdentities, absolute, "directory");
    if (process.platform === "win32") {
      runWindowsAcl(absolute, "directory", "protect");
    } else {
      await makePosixTreeWritable(absolute);
    }
    await assertRememberedIdentity(managedDirectoryIdentities, absolute, "directory");
    await rm(absolute, { force: true, recursive: true });
  }
  if (existsSync(absolute)) {
    throw new Error("Private runtime directory cleanup failed.");
  }
  managedDirectoryIdentities.delete(absolute);
  for (const path of managedFileIdentities.keys()) {
    if (dirname(path) === absolute) managedFileIdentities.delete(path);
  }
}

export function privateRuntimePermissionLabel() {
  return process.platform === "win32"
    ? "windows-current-user-protected"
    : "0700-directory-0600-file";
}

export function privateRuntimeSnapshotLabel() {
  return process.platform === "win32"
    ? "windows-current-user-readonly-staged-snapshot"
    : "posix-readonly-staged-snapshot";
}

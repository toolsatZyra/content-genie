import { createHash } from "node:crypto";

import { Sandbox, type NetworkPolicy } from "@vercel/sandbox";
import postgres from "postgres";

import { assertClosedCandidateArtifact } from "../../scripts/live-candidate-evidence.mjs";
import trustedHarnessManifestJson from "../../scripts/live-trusted-harness-manifest.v1.json";

import {
  LIVE_BROKER_REPOSITORY_URL,
  LIVE_BROKER_SEAL,
  liveBrokerRuntimeAllowlist,
  type LiveBrokerStartRequest,
  type LiveBrokerStatusRequest,
  type LiveBrokerStopRequest,
} from "@/server/live-broker-contract";

const NODE = "/vercel/runtimes/node24/bin/node";
const COREPACK = "/vercel/runtimes/node24/bin/corepack";
const RUNUSER = "/usr/sbin/runuser";
const CONTROL_PATH = "/home/vercel-sandbox/.genie-live-control.v1.json";
const CANDIDATE_ARTIFACT_PATH = ".tmp/candidate-live-evidence.json";
const TRUSTED_STDOUT_PATH = "/home/vercel-sandbox/.genie-live-stdout.log";
const TRUSTED_STDERR_PATH = "/home/vercel-sandbox/.genie-live-stderr.log";
const PLAYWRIGHT_BROWSERS_PATH = "/home/candidate/.cache/ms-playwright";
const SANDBOX_TIMEOUT_MS = 15 * 60_000;
const COMMAND_TIMEOUT_MS = 12 * 60_000;
const ARTIFACT_MAX_BYTES = 2 * 1024 * 1024;
const COMMAND_OUTPUT_MAX_BYTES = 8 * 1024 * 1024;
const candidateWritablePaths = [".next", ".tmp", "supabase/.temp"] as const;
const expectedPhase2MigrationVersions = [
  "20260717121500",
  "20260717121501",
  "20260717121600",
  "20260717121601",
  "20260717121602",
  "20260717121603",
  "20260717121604",
  "20260717121605",
  "20260717121606",
  "20260717121607",
  "20260717121608",
  "20260717121609",
  "20260717121610",
  "20260717121611",
  "20260717121612",
  "20260717121613",
  "20260717121614",
  "20260717121615",
  "20260717121616",
  "20260719030500",
  "20260719032252",
  "20260719032603",
  "20260719033129",
  "20260719040025",
  "20260719040929",
  "20260719041024",
  "20260719041555",
  "20260719041830",
  "20260719042436",
  "20260719043240",
  "20260719044020",
  "20260719044544",
  "20260719045118",
  "20260719045745",
  "20260719045855",
  "20260719051000",
  "20260719052500",
  "20260719053000",
  "20260719053500",
  "20260719054000",
  "20260719054500",
  "20260719055000",
  "20260719061422",
  "20260719062218",
  "20260719063218",
  "20260719064500",
  "20260719070000",
  "20260719071000",
  "20260719072000",
  "20260719073000",
  "20260719073100",
  "20260719073200",
  "20260719073300",
  "20260719073400",
  "20260719073500",
  "20260719073600",
  "20260719073700",
  "20260719073800",
  "20260719073900",
  "20260719074000",
  "20260719074100",
  "20260719074200",
  "20260719074300",
  "20260719074400",
  "20260719074500",
  "20260719074600",
  "20260719074700",
  "20260719074800",
  "20260719074900",
  "20260719075000",
  "20260719075100",
  "20260719075200",
  "20260719075300",
  "20260719075400",
  "20260719075500",
  "20260719075600",
  "20260719075700",
  "20260719075800",
  "20260719075900",
  "20260719080000",
  "20260719080100",
  "20260719080200",
  "20260719080300",
  "20260719080400",
  "20260719165003",
  "20260719195650",
  "20260719215715",
  "20260719223000",
] as const;
const trustedHarnessSha256 = createHash("sha256")
  .update(JSON.stringify(trustedHarnessManifestJson))
  .digest("hex");
const sourceFingerprintProgram = String.raw`
const crypto=require('node:crypto');const fs=require('node:fs');const path=require('node:path');
const root=process.cwd();const rows=[];
function visit(dir){for(const name of fs.readdirSync(dir).sort()){if(dir===root&&(name==='.git'||name==='node_modules'))continue;const full=path.join(dir,name);const stat=fs.lstatSync(full);const rel=path.relative(root,full).replaceAll('\\','/');if(stat.isSymbolicLink())throw new Error('source symlink rejected: '+rel);if(stat.isDirectory())visit(full);else if(stat.isFile())rows.push(rel+'\0'+crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex'));else throw new Error('unsupported source entry: '+rel)}}
visit(root);process.stdout.write(crypto.createHash('sha256').update(rows.join('\n')).digest('hex'));
`;
const packageConfigPreflightProgram = String.raw`
const fs=require('node:fs');const path=require('node:path');const root=process.cwd();
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
if(pkg?.pnpm?.configDependencies||pkg?.pnpmfile||pkg?.globalPnpmfile)throw new Error('executable pnpm configuration rejected');
function visit(dir){for(const name of fs.readdirSync(dir)){if(dir===root&&(name==='.git'||name==='node_modules'))continue;const full=path.join(dir,name);const stat=fs.lstatSync(full);if(stat.isDirectory())visit(full);else if(/^\.pnpmfile(?:\.|$)/u.test(name))throw new Error('pnpmfile rejected');else if(name==='.npmrc'&&/^(?:pnpmfile|global-pnpmfile)\s*=/imu.test(fs.readFileSync(full,'utf8')))throw new Error('pnpmfile npmrc directive rejected')}}
visit(root);
`;

type TrustedDigest = Readonly<{ fileCount: number; sha256: string }>;
type TrustedCandidateBinding = Readonly<{
  databaseTests: TrustedDigest;
  gitTree: string;
  liveTests: TrustedDigest;
  migrations: TrustedDigest;
  snapshotSeal: typeof LIVE_BROKER_SEAL;
  source: TrustedDigest;
}>;
type TrustedPgTapSuite = Readonly<{
  hardenedQuerySha256: string;
  plannedAssertions: number;
  sourceSha256: string;
  testFile: string;
}>;
type TrustedHarnessEvidence = Readonly<{
  candidateBinding: TrustedCandidateBinding;
  manifestSha256: string;
  pgTapSuites: TrustedPgTapSuite[];
  predecessorFixture: unknown;
  schemaVersion: "genie-live-trusted-harness-verification.v1";
}>;

function trustedHarnessVerificationProgram(candidateTree: string): string {
  const manifest = JSON.stringify(trustedHarnessManifestJson);
  return String.raw`
const crypto=require('node:crypto');const fs=require('node:fs');const fsp=require('node:fs/promises');const path=require('node:path');const url=require('node:url');
const root=process.cwd();const manifest=${manifest};const candidateTree=${JSON.stringify(candidateTree)};const snapshotSeal=${JSON.stringify(LIVE_BROKER_SEAL)};
function fail(label){throw new Error('trusted harness verification failed: '+label)}
function exactKeys(value,keys,label){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==[...keys].sort().join(','))fail(label)}
function digest(value){return crypto.createHash('sha256').update(value).digest('hex')}
async function fileDigest(relative){if(typeof relative!=='string'||!relative||relative.includes('\\')||relative.includes('\0')||path.isAbsolute(relative))fail('path');const full=path.resolve(root,relative);if(!full.startsWith(root+path.sep))fail('escape');const stat=await fsp.lstat(full);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)fail('file identity '+relative);const hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(full))hash.update(chunk);return hash.digest('hex')}
function same(left,right){return JSON.stringify(left)===JSON.stringify(right)}
async function files(directory,predicate){const rows=[];async function visit(relative){const entries=await fsp.readdir(path.resolve(root,relative),{withFileTypes:true});for(const entry of entries){const child=(relative+'/'+entry.name).replaceAll('\\','/');if(entry.isDirectory())await visit(child);else if(entry.isFile()&&predicate(entry.name))rows.push(child);else if(!entry.isFile()&&!entry.isDirectory())fail('unsupported entry '+child)}}await visit(directory);return rows.sort()}
function candidateDigest(entries){entries.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);if(new Set(entries.map((entry)=>entry.path)).size!==entries.length)fail('duplicate binding path');const hash=crypto.createHash('sha256');for(const entry of entries){hash.update(entry.path);hash.update('\0');hash.update(String(entry.contents.byteLength));hash.update('\0');hash.update(entry.contents);hash.update('\0')}return{fileCount:entries.length,sha256:hash.digest('hex')}}
async function bindingGroup({directories=[],files:individual=[]}){const relative=[...individual];for(const directory of directories)relative.push(...await files(directory,()=>true));return candidateDigest(await Promise.all(relative.map(async(entry)=>({contents:await fsp.readFile(path.resolve(root,entry)),path:entry.replaceAll('\\','/')}))))}
(async()=>{
exactKeys(manifest,['entries','liveSpecs','manifestPath','packageManager','pgTapSuites','phase2Migrations','predecessorFixture','predecessorFixtureSource','schemaVersion'],'manifest schema');
if(manifest.schemaVersion!=='genie-live-trusted-harness-manifest.v1')fail('manifest version');
const manifestFile=JSON.parse(await fsp.readFile(path.resolve(root,manifest.manifestPath),'utf8'));if(!same(manifestFile,manifest))fail('committed manifest');
const seen=new Set();for(const entry of manifest.entries){exactKeys(entry,['path','role','sha256'],'entry schema');if(seen.has(entry.path)||!/^[a-f0-9]{64}$/.test(entry.sha256))fail('entry identity');seen.add(entry.path);if(await fileDigest(entry.path)!==entry.sha256)fail('entry digest '+entry.path)}
const migrations=(await files('supabase/migrations',(name)=>/^\d{14}_phase2_[a-z0-9_]+\.sql$/u.test(name)));if(!same(migrations,manifest.phase2Migrations))fail('phase2 migrations');
const liveSpecs=['playwright.live.config.ts',...await files('tests/live',(name)=>name.endsWith('.spec.ts'))];if(!same(liveSpecs,manifest.liveSpecs))fail('live specs');
const pgTapPaths=await files('supabase/tests',(name)=>name.endsWith('.test.sql'));if(!same(pgTapPaths.map((entry)=>entry.split('/').at(-1)),manifest.pgTapSuites.map((entry)=>entry.testFile)))fail('pgtap collection');
const pkg=JSON.parse(await fsp.readFile(path.resolve(root,'package.json'),'utf8'));if(!same(manifest.packageManager,{declaration:pkg.packageManager,name:'pnpm',version:'11.9.0'}))fail('package manager');
const pgtap=await import(url.pathToFileURL(path.resolve(root,'scripts/pgtap-harness-policy.mjs')).href);for(const expected of manifest.pgTapSuites){exactKeys(expected,['hardenedQuerySha256','plannedAssertions','sourceSha256','testFile'],'pgtap schema');const source=await fsp.readFile(path.resolve(root,'supabase/tests',expected.testFile),'utf8');if(digest(source)!==expected.sourceSha256||digest(pgtap.hardenPgTapQuery(source,expected.testFile))!==expected.hardenedQuerySha256||pgtap.getPlannedPgTapAssertions(source,expected.testFile)!==expected.plannedAssertions)fail('pgtap binding '+expected.testFile)}
const predecessor=await import(url.pathToFileURL(path.resolve(root,'scripts/phase2-coordinate-upgrade-drill.mjs')).href);const fixture=predecessor.assertPhase2CoordinatePredecessorFixture();if(!same(fixture,manifest.predecessorFixture))fail('predecessor fixture');if(await fileDigest(manifest.predecessorFixtureSource)!==manifest.entries.find((entry)=>entry.path===manifest.predecessorFixtureSource)?.sha256)fail('predecessor source');
const candidateBinding={databaseTests:await bindingGroup({directories:['supabase/tests']}),gitTree:candidateTree,liveTests:await bindingGroup({directories:['tests/live'],files:['playwright.live.config.ts']}),migrations:await bindingGroup({directories:['supabase/migrations']}),snapshotSeal,source:await bindingGroup({directories:['src','scripts','public','supabase/templates'],files:['package.json','pnpm-lock.yaml','next.config.ts','tsconfig.json']})};
process.stdout.write(JSON.stringify({candidateBinding,manifestSha256:digest(JSON.stringify(manifest)),pgTapSuites:manifest.pgTapSuites,predecessorFixture:manifest.predecessorFixture,schemaVersion:'genie-live-trusted-harness-verification.v1'}));
})().catch(()=>process.exit(91));
`;
}

const boundedCandidateCommandProgram = String.raw`
const fs=require('node:fs');const {spawn}=require('node:child_process');
const limit=8*1024*1024;const stdoutPath='/home/vercel-sandbox/.genie-live-stdout.log';const stderrPath='/home/vercel-sandbox/.genie-live-stderr.log';
const stdoutFd=fs.openSync(stdoutPath,'wx',0o600);const stderrFd=fs.openSync(stderrPath,'wx',0o600);let overflow=false;let finalized=false;let child;
function terminate(){if(!child||!child.pid)return;try{process.kill(-child.pid,'SIGKILL')}catch{try{child.kill('SIGKILL')}catch{}}}
function consume(stream,fd){let written=0;stream.on('data',(chunk)=>{const remaining=Math.max(0,limit-written);if(remaining>0){const bounded=chunk.subarray(0,remaining);fs.writeSync(fd,bounded);written+=bounded.length}if(chunk.length>remaining){overflow=true;terminate()}})}
function finish(code){if(finalized)return;finalized=true;fs.closeSync(stdoutFd);fs.closeSync(stderrFd);process.exitCode=overflow?86:(Number.isInteger(code)&&code>=0?code:87)}
child=spawn('/usr/sbin/runuser',['--preserve-environment','-u','candidate','--','/vercel/runtimes/node24/bin/node','scripts/run-phase1-live-suite.mjs'],{cwd:process.cwd(),detached:true,env:process.env,stdio:['ignore','pipe','pipe']});
consume(child.stdout,stdoutFd);consume(child.stderr,stderrFd);child.once('error',()=>{terminate();finish(87)});child.once('close',(code)=>finish(code));process.once('SIGTERM',()=>{terminate();finish(88)});process.once('SIGINT',()=>{terminate();finish(88)});
`;

function boundedFileEvidenceProgram(
  relativePath: string,
  maximumBytes: number,
  minimumBytes: number,
): string {
  return String.raw`
const crypto=require('node:crypto');const fs=require('node:fs');const fsp=require('node:fs/promises');const path=require('node:path');
(async()=>{const root=process.cwd();const input=${JSON.stringify(relativePath)};const full=path.isAbsolute(input)?input:path.resolve(root,input);if(!path.isAbsolute(input)&&!full.startsWith(root+path.sep))throw new Error('path escape');const stat=await fsp.lstat(full);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size<${minimumBytes}||stat.size>${maximumBytes})throw new Error('unsafe bounded file');const hash=crypto.createHash('sha256');let bytes=0;for await(const chunk of fs.createReadStream(full)){bytes+=chunk.length;if(bytes>${maximumBytes})throw new Error('file grew');hash.update(chunk)}if(bytes!==stat.size)throw new Error('file changed');process.stdout.write(JSON.stringify({bytes,sha256:hash.digest('hex')}))})().catch(()=>process.exit(92));
`;
}

type BrokerControl = {
  branch: {
    branchRef: string;
    challengeNonce: string;
    challengeTable: string;
    databaseUrl: string;
  };
  candidate: LiveBrokerStatusRequest["candidate"];
  commandId: string;
  networkPolicy: { allow: string[] };
  preflightDatabaseEvidence: {
    branchRef: string;
    challengeVerified: true;
  };
  sandboxName: string;
  schemaVersion: "genie-live-sandbox-control.v2";
  trustedHarnessSha256: string;
};

export type LiveSandboxStartResult = {
  commandId: string;
  networkPolicyVerified: true;
  runtime: string;
  sandboxName: string;
  sandboxSessionId: string;
  seal: typeof LIVE_BROKER_SEAL;
  sourceCommit: string;
  sourceTree: string;
};

export type LiveSandboxStatusResult = {
  brokerArtifact: {
    candidateArtifactSha256: string;
    command: {
      durationMs: number;
      exitCode: 0;
      stderrBytes: number;
      stderrSha256: string;
      stdoutBytes: number;
      stdoutSha256: string;
    };
    database: {
      boundaryScripts: number;
      branchRef: string;
      lookCount: 117;
      migrationVersions: string[];
      policyBoundLookCount: 117;
      voiceCount: 2;
    };
    harnessSha256: string;
    preflightDatabaseEvidence: BrokerControl["preflightDatabaseEvidence"];
    schemaVersion: "genie-trusted-live-harness-evidence.v1";
  } | null;
  candidateArtifact: unknown | null;
  commandDurationMs: number | null;
  commandExitCode: number | null;
  commandId: string;
  networkPolicyVerified: boolean;
  sandboxName: string;
  seal: typeof LIVE_BROKER_SEAL;
  sourceSealVerified: boolean;
  state: "running" | "finished";
};

async function commandOutput(
  sandbox: Sandbox,
  cmd: string,
  args: string[],
  options: { cwd?: string; env?: Record<string, string>; sudo?: boolean } = {},
): Promise<string> {
  const parameters = {
    args,
    cmd,
    timeoutMs: 120_000,
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.env ? { env: options.env } : {}),
    ...(options.sudo === undefined ? {} : { sudo: options.sudo }),
  };
  const result = await sandbox.runCommand(parameters);
  if (result.exitCode !== 0) {
    throw new Error("Sandbox preparation command failed safely.");
  }
  return (await result.stdout()).trim();
}

function exactDigest(value: unknown): value is TrustedDigest {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== "fileCount,sha256"
  ) {
    return false;
  }
  const digest = value as Record<string, unknown>;
  return (
    Number.isSafeInteger(digest.fileCount) &&
    (digest.fileCount as number) > 0 &&
    typeof digest.sha256 === "string" &&
    /^[a-f0-9]{64}$/u.test(digest.sha256)
  );
}

function parseTrustedHarnessEvidence(
  value: string,
  candidateTree: string,
): TrustedHarnessEvidence {
  let evidence: unknown;
  try {
    evidence = JSON.parse(value);
  } catch {
    throw new Error("Trusted harness verification returned malformed evidence.");
  }
  if (
    !evidence ||
    typeof evidence !== "object" ||
    Array.isArray(evidence) ||
    Object.keys(evidence).sort().join(",") !==
      "candidateBinding,manifestSha256,pgTapSuites,predecessorFixture,schemaVersion"
  ) {
    throw new Error("Trusted harness verification returned an open schema.");
  }
  const parsed = evidence as Record<string, unknown>;
  const candidateBinding = parsed.candidateBinding;
  if (
    !candidateBinding ||
    typeof candidateBinding !== "object" ||
    Array.isArray(candidateBinding) ||
    Object.keys(candidateBinding).sort().join(",") !==
      "databaseTests,gitTree,liveTests,migrations,snapshotSeal,source"
  ) {
    throw new Error("Trusted harness candidate binding is malformed.");
  }
  const binding = candidateBinding as Record<string, unknown>;
  if (
    !exactDigest(binding.databaseTests) ||
    !exactDigest(binding.liveTests) ||
    !exactDigest(binding.migrations) ||
    !exactDigest(binding.source) ||
    binding.gitTree !== candidateTree ||
    binding.snapshotSeal !== LIVE_BROKER_SEAL ||
    parsed.manifestSha256 !== trustedHarnessSha256 ||
    parsed.schemaVersion !== "genie-live-trusted-harness-verification.v1" ||
    JSON.stringify(parsed.pgTapSuites) !==
      JSON.stringify(trustedHarnessManifestJson.pgTapSuites) ||
    JSON.stringify(parsed.predecessorFixture) !==
      JSON.stringify(trustedHarnessManifestJson.predecessorFixture)
  ) {
    throw new Error("Trusted harness manifest binding failed.");
  }
  return evidence as TrustedHarnessEvidence;
}

async function verifyTrustedHarness(
  sandbox: Sandbox,
  candidateTree: string,
): Promise<TrustedHarnessEvidence> {
  return parseTrustedHarnessEvidence(
    await commandOutput(
      sandbox,
      NODE,
      ["-e", trustedHarnessVerificationProgram(candidateTree)],
      { cwd: sandbox.cwd },
    ),
    candidateTree,
  );
}

async function boundedFileEvidence(
  sandbox: Sandbox,
  path: string,
  maximumBytes: number,
  minimumBytes = 0,
): Promise<{ bytes: number; sha256: string }> {
  const output = await commandOutput(
    sandbox,
    NODE,
    ["-e", boundedFileEvidenceProgram(path, maximumBytes, minimumBytes)],
    { cwd: sandbox.cwd },
  );
  let evidence: unknown;
  try {
    evidence = JSON.parse(output);
  } catch {
    throw new Error("Bounded sandbox file evidence is malformed.");
  }
  if (
    !evidence ||
    typeof evidence !== "object" ||
    Array.isArray(evidence) ||
    Object.keys(evidence).sort().join(",") !== "bytes,sha256" ||
    !Number.isSafeInteger((evidence as { bytes?: unknown }).bytes) ||
    ((evidence as { bytes: number }).bytes as number) < minimumBytes ||
    (evidence as { bytes: number }).bytes > maximumBytes ||
    !/^[a-f0-9]{64}$/u.test(String((evidence as { sha256?: unknown }).sha256))
  ) {
    throw new Error("Bounded sandbox file evidence failed closed validation.");
  }
  return evidence as { bytes: number; sha256: string };
}

function assertDeployedCandidate(candidateCommit: string): void {
  const deployedCommit = process.env.VERCEL_GIT_COMMIT_SHA?.trim();
  if (
    !/^[a-f0-9]{40}$/u.test(deployedCommit ?? "") ||
    deployedCommit !== candidateCommit
  ) {
    throw new Error(
      "Live proof requires the exact deployed and reviewed broker commit.",
    );
  }
}

async function assertSandboxNameAbsent(name: string): Promise<void> {
  const result = await Sandbox.list({ namePrefix: name });
  const sandboxes = await result.toArray();
  if (sandboxes.some((sandbox) => sandbox.name === name)) {
    throw new Error("The signed sandbox name has already been used.");
  }
}

function assertSandboxMetadataIdentity(
  sandbox: Pick<Sandbox, "name" | "tags">,
  request: LiveBrokerStatusRequest | LiveBrokerStopRequest,
): void {
  if (
    sandbox.name !== request.sandboxName ||
    sandbox.tags?.candidate !== request.candidate.commit ||
    sandbox.tags?.tree !== request.candidate.tree ||
    sandbox.tags?.product !== "genie" ||
    sandbox.tags?.purpose !== "live-proof"
  ) {
    throw new Error("Sandbox metadata does not match the signed candidate identity.");
  }
}

function assertRuntimeNetworkPolicy(sandbox: Sandbox, branchRef: string): void {
  if (
    JSON.stringify(sandbox.networkPolicy) !==
    JSON.stringify(runtimeNetworkPolicy(branchRef))
  ) {
    throw new Error("Sandbox runtime network policy has drifted.");
  }
}

function parseControl(
  value: Buffer | null,
  request: LiveBrokerStatusRequest | LiveBrokerStopRequest,
): BrokerControl {
  if (!value || value.length > 4_096) {
    throw new Error("Sandbox control evidence is unavailable.");
  }
  let control: unknown;
  try {
    control = JSON.parse(value.toString("utf8"));
  } catch {
    throw new Error("Sandbox control evidence is malformed.");
  }
  if (
    !control ||
    typeof control !== "object" ||
    Array.isArray(control) ||
    Object.keys(control).sort().join(",") !==
      "branch,candidate,commandId,networkPolicy,preflightDatabaseEvidence,sandboxName,schemaVersion,trustedHarnessSha256" ||
    JSON.stringify((control as BrokerControl).candidate) !==
      JSON.stringify(request.candidate) ||
    (control as BrokerControl).sandboxName !== request.sandboxName ||
    (control as BrokerControl).schemaVersion !== "genie-live-sandbox-control.v2" ||
    (control as BrokerControl).trustedHarnessSha256 !== trustedHarnessSha256 ||
    !/^[A-Za-z0-9._:-]{8,256}$/u.test((control as BrokerControl).commandId) ||
    !exactControlNetworkPolicy((control as BrokerControl).networkPolicy) ||
    !exactControlBranch((control as BrokerControl).branch) ||
    JSON.stringify((control as BrokerControl).preflightDatabaseEvidence) !==
      JSON.stringify({
        branchRef: (control as BrokerControl).branch.branchRef,
        challengeVerified: true,
      })
  ) {
    throw new Error("Sandbox control evidence does not match the signed request.");
  }
  return control as BrokerControl;
}

function exactControlBranch(value: unknown): value is BrokerControl["branch"] {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !==
      "branchRef,challengeNonce,challengeTable,databaseUrl"
  ) {
    return false;
  }
  const branch = value as Record<string, unknown>;
  if (
    !/^[a-z0-9]{20}$/u.test(String(branch.branchRef)) ||
    !/^[0-9a-f-]{36}$/iu.test(String(branch.challengeNonce)) ||
    !/^phase2_connection_challenge_[a-f0-9]{32}$/u.test(String(branch.challengeTable))
  ) {
    return false;
  }
  try {
    const url = new URL(String(branch.databaseUrl));
    return (
      url.protocol === "postgresql:" &&
      url.hostname === `db.${branch.branchRef}.supabase.co` &&
      url.port === "5432" &&
      url.pathname === "/postgres" &&
      Boolean(url.password)
    );
  } catch {
    return false;
  }
}

function exactControlNetworkPolicy(value: unknown): value is { allow: string[] } {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).join(",") !== "allow" ||
    !Array.isArray((value as { allow?: unknown }).allow) ||
    (value as { allow: unknown[] }).allow.length !== 2
  ) {
    return false;
  }
  const [apiHost, databaseHost] = (value as { allow: unknown[] }).allow;
  if (typeof apiHost !== "string" || typeof databaseHost !== "string") {
    return false;
  }
  const branchRef = apiHost.match(/^([a-z0-9]{20})\.supabase\.co$/u)?.[1];
  return Boolean(branchRef) && databaseHost === `db.${branchRef}.supabase.co`;
}

async function verifyCommitAndTree(
  sandbox: Sandbox,
  candidate: LiveBrokerStartRequest["candidate"],
): Promise<void> {
  const git = ["-c", `safe.directory=${sandbox.cwd}`];
  const commit = await commandOutput(sandbox, "git", [...git, "rev-parse", "HEAD"]);
  const tree = await commandOutput(sandbox, "git", [
    ...git,
    "rev-parse",
    "HEAD^{tree}",
  ]);
  if (commit !== candidate.commit || tree !== candidate.tree) {
    throw new Error("Sandbox source does not match the signed candidate identity.");
  }
  await commandOutput(sandbox, "git", [...git, "diff", "--quiet", "--no-ext-diff"]);
  await commandOutput(sandbox, "git", [
    ...git,
    "diff",
    "--cached",
    "--quiet",
    "--no-ext-diff",
  ]);
}

async function sourceFingerprint(sandbox: Sandbox): Promise<string> {
  const fingerprint = await commandOutput(
    sandbox,
    NODE,
    ["-e", sourceFingerprintProgram],
    { cwd: sandbox.cwd },
  );
  if (!/^[a-f0-9]{64}$/u.test(fingerprint)) {
    throw new Error("Candidate source fingerprint is invalid.");
  }
  return fingerprint;
}

async function prepareUnprivilegedBuilder(sandbox: Sandbox): Promise<void> {
  await commandOutput(sandbox, NODE, ["-e", packageConfigPreflightProgram], {
    cwd: sandbox.cwd,
  });
  await sandbox.createUser("candidate");
  await commandOutput(sandbox, "chown", ["-R", "candidate:candidate", sandbox.cwd], {
    sudo: true,
  });
  await commandOutput(sandbox, "chown", ["-R", "root:root", ".git"], {
    cwd: sandbox.cwd,
    sudo: true,
  });
  await commandOutput(sandbox, "chmod", ["-R", "a-w", ".git"], {
    cwd: sandbox.cwd,
    sudo: true,
  });
}

async function installCandidateDependencies(sandbox: Sandbox): Promise<void> {
  const candidate = sandbox.asUser("candidate");
  const versionResult = await candidate.runCommand(COREPACK, ["pnpm", "--version"]);
  if (versionResult.exitCode !== 0) {
    throw new Error("Sandbox package-manager pin could not be read.");
  }
  const version = (await versionResult.stdout()).trim();
  if (version !== "11.9.0") {
    throw new Error("Sandbox package-manager pin has drifted.");
  }
  const install = await candidate.runCommand({
    args: [
      "pnpm",
      "install",
      "--frozen-lockfile",
      "--ignore-pnpmfile",
      "--ignore-scripts",
      "--package-import-method=copy",
    ],
    cmd: COREPACK,
    cwd: sandbox.cwd,
    timeoutMs: 120_000,
  });
  if (install.exitCode !== 0) {
    throw new Error("Unprivileged candidate dependency installation failed.");
  }
}

async function installCandidateBrowser(sandbox: Sandbox): Promise<void> {
  const candidate = sandbox.asUser("candidate");
  for (const path of [PLAYWRIGHT_BROWSERS_PATH, "/home/candidate/tmp"]) {
    const directory = await candidate.runCommand("mkdir", ["-p", path]);
    if (directory.exitCode !== 0) {
      throw new Error("Candidate browser directory preparation failed.");
    }
  }
  const install = await candidate.runCommand({
    args: ["pnpm", "exec", "playwright", "install", "chromium"],
    cmd: COREPACK,
    env: { PLAYWRIGHT_BROWSERS_PATH },
    timeoutMs: 180_000,
  });
  if (install.exitCode !== 0) {
    throw new Error("Pinned Chromium installation failed in the sandbox.");
  }
  const executable = await candidate.runCommand({
    args: [
      "-e",
      "process.stdout.write(require('@playwright/test').chromium.executablePath())",
    ],
    cmd: NODE,
    env: { PLAYWRIGHT_BROWSERS_PATH },
  });
  if (executable.exitCode !== 0) {
    throw new Error("Pinned Chromium executable could not be resolved.");
  }
  const browserPath = (await executable.stdout()).trim();
  if (!browserPath.startsWith(`${PLAYWRIGHT_BROWSERS_PATH}/`)) {
    throw new Error("Pinned Chromium executable escaped its browser root.");
  }
  const linkage = await candidate.runCommand("ldd", [browserPath]);
  if (linkage.exitCode !== 0 || (await linkage.stdout()).includes("not found")) {
    throw new Error("Pinned Chromium has unresolved sandbox dependencies.");
  }
}

async function assertNoCandidateProcesses(sandbox: Sandbox): Promise<void> {
  const result = await sandbox.runCommand("pgrep", ["-u", "candidate"]);
  if (result.exitCode === 0 || (await result.stdout()).trim()) {
    throw new Error("Candidate preparation left a residual process.");
  }
  if (result.exitCode !== 1) {
    throw new Error("Candidate process isolation could not be verified.");
  }
}

async function sealCandidateSource(sandbox: Sandbox): Promise<void> {
  for (const path of candidateWritablePaths) {
    await commandOutput(sandbox, "mkdir", ["-p", path], { sudo: true });
  }
  await commandOutput(sandbox, "chown", ["-R", "root:root", sandbox.cwd], {
    sudo: true,
  });
  await commandOutput(sandbox, "chmod", ["-R", "a-w", sandbox.cwd], {
    sudo: true,
  });
  for (const path of candidateWritablePaths) {
    await commandOutput(sandbox, "chown", ["-R", "candidate:candidate", path], {
      sudo: true,
    });
    await commandOutput(sandbox, "chmod", ["-R", "u+rwX,go-rwx", path], {
      sudo: true,
    });
  }
}

async function assertCandidateWriteScope(sandbox: Sandbox): Promise<void> {
  const candidate = sandbox.asUser("candidate");
  const result = await candidate.runCommand({
    args: [
      ".",
      "-path",
      "./.next",
      "-prune",
      "-o",
      "-path",
      "./.tmp",
      "-prune",
      "-o",
      "-path",
      "./supabase/.temp",
      "-prune",
      "-o",
      "-writable",
      "-print",
    ],
    cmd: "find",
    cwd: sandbox.cwd,
  });
  if (result.exitCode !== 0 || (await result.stdout()).trim()) {
    throw new Error("Candidate can write outside its three declared runtime roots.");
  }
}

function runtimeNetworkPolicy(branchRef: string): NetworkPolicy {
  return liveBrokerRuntimeAllowlist(branchRef);
}

async function trustedDatabaseEvidence(
  branch: BrokerControl["branch"],
  mode: "preflight" | "terminal",
): Promise<unknown> {
  if (!exactControlBranch(branch)) {
    throw new Error("Trusted database boundary is invalid.");
  }
  const sql = postgres(branch.databaseUrl, {
    connect_timeout: 15,
    idle_timeout: 1,
    max: 1,
    ssl: "require",
  });
  try {
    if (mode === "preflight") {
      const rows = await sql.unsafe<{ nonce: string }[]>(
        `select challenge_nonce::text as nonce from private."${branch.challengeTable}"`,
      );
      if (rows.length !== 1 || rows[0]?.nonce !== branch.challengeNonce) {
        throw new Error("Trusted disposable-database challenge failed.");
      }
      return { branchRef: branch.branchRef, challengeVerified: true };
    }
    const versions = await sql<[{ version: string }]>`
      select version::text as version
      from supabase_migrations.schema_migrations
      where version::text >= '20260717121500'
      order by version
    `;
    const rows = await sql<
      [
        {
          boundary_scripts: number;
          looks: number;
          policy_bound_looks: number;
          voices: number;
        },
      ]
    >`
      select
        (select count(*)::integer from public.look_versions) as looks,
        (
          select count(*)::integer
          from public.look_versions
          where negative_policy ->> 'schemaVersion' = 'genie-look-negative-policy.v1'
            and visual_qc_baseline ->> 'schemaVersion' = 'genie-look-visual-qc-baseline.v1'
            and visual_qc_baseline ->> 'sourceLookBlockSha256' = locked_look_block_sha256
            and visual_qc_baseline ->> 'negativePolicySha256' = negative_policy_sha256
        ) as policy_bound_looks,
        (select count(*)::integer from public.voice_versions) as voices,
        (
          select count(*)::integer
          from public.script_revisions
          where octet_length(raw_utf8) = 8192
            and coordinate_map ->> 'v' = '2'
            and coordinate_map_verifier = 'postgres-structural-v2'
            and duration_estimation_profile = 'genie-hindi-conversational-expressive-duration.v1'
        ) as boundary_scripts
    `;
    const row = rows[0];
    if (!row) throw new Error("Trusted terminal database query returned no row.");
    return {
      boundaryScripts: row.boundary_scripts,
      branchRef: branch.branchRef,
      lookCount: row.looks,
      migrationVersions: versions.map(({ version }) => version),
      policyBoundLookCount: row.policy_bound_looks,
      voiceCount: row.voices,
    };
  } finally {
    await sql.end({ timeout: 2 });
  }
}

function parsePreflightDatabaseEvidence(
  value: unknown,
  branchRef: string,
): BrokerControl["preflightDatabaseEvidence"] {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== "branchRef,challengeVerified" ||
    (value as { branchRef?: unknown }).branchRef !== branchRef ||
    (value as { challengeVerified?: unknown }).challengeVerified !== true
  ) {
    throw new Error("Trusted disposable-database challenge failed.");
  }
  return value as BrokerControl["preflightDatabaseEvidence"];
}

function parseTerminalDatabaseEvidence(
  value: unknown,
  branchRef: string,
): NonNullable<LiveSandboxStatusResult["brokerArtifact"]>["database"] {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !==
      "boundaryScripts,branchRef,lookCount,migrationVersions,policyBoundLookCount,voiceCount"
  ) {
    throw new Error("Trusted terminal database evidence is malformed.");
  }
  const evidence = value as Record<string, unknown>;
  if (
    evidence.branchRef !== branchRef ||
    evidence.lookCount !== 117 ||
    evidence.policyBoundLookCount !== 117 ||
    evidence.voiceCount !== 2 ||
    !Number.isInteger(evidence.boundaryScripts) ||
    (evidence.boundaryScripts as number) < 1 ||
    JSON.stringify(evidence.migrationVersions) !==
      JSON.stringify(expectedPhase2MigrationVersions)
  ) {
    throw new Error("Trusted terminal database invariants failed.");
  }
  return evidence as NonNullable<LiveSandboxStatusResult["brokerArtifact"]>["database"];
}

export async function startLiveSandbox(
  request: LiveBrokerStartRequest,
): Promise<LiveSandboxStartResult> {
  assertDeployedCandidate(request.candidate.commit);
  await assertSandboxNameAbsent(request.sandboxName);
  const controlBranch: BrokerControl["branch"] = {
    branchRef: request.branch.branchRef,
    challengeNonce: request.branch.challengeNonce,
    challengeTable: request.branch.challengeTable,
    databaseUrl: request.branch.credentials.databaseUrl,
  };
  const preflightDatabaseEvidence = parsePreflightDatabaseEvidence(
    await trustedDatabaseEvidence(controlBranch, "preflight"),
    request.branch.branchRef,
  );
  let sandbox: (Sandbox & AsyncDisposable) | null = null;
  try {
    sandbox = await Sandbox.create({
      name: request.sandboxName,
      networkPolicy: {
        allow: [
          "github.com",
          "registry.npmjs.org",
          "cdn.playwright.dev",
          "playwright.download.prss.microsoft.com",
        ],
      },
      persistent: false,
      resources: { vcpus: 4 },
      runtime: "node24",
      source: {
        depth: 1,
        revision: request.candidate.commit,
        type: "git",
        url: LIVE_BROKER_REPOSITORY_URL,
      },
      tags: {
        candidate: request.candidate.commit,
        product: "genie",
        purpose: "live-proof",
        tree: request.candidate.tree,
      },
      timeout: SANDBOX_TIMEOUT_MS,
    });
    await verifyCommitAndTree(sandbox, request.candidate);
    const pristineSourceFingerprint = await sourceFingerprint(sandbox);
    await prepareUnprivilegedBuilder(sandbox);
    await installCandidateDependencies(sandbox);
    await installCandidateBrowser(sandbox);
    await commandOutput(sandbox, "test", ["-x", RUNUSER]);
    await assertNoCandidateProcesses(sandbox);
    if ((await sourceFingerprint(sandbox)) !== pristineSourceFingerprint) {
      throw new Error("Candidate preparation changed source outside dependencies.");
    }
    await verifyCommitAndTree(sandbox, request.candidate);
    await sealCandidateSource(sandbox);
    await assertCandidateWriteScope(sandbox);
    const trustedHarness = await verifyTrustedHarness(sandbox, request.candidate.tree);
    await sandbox.update({
      networkPolicy: runtimeNetworkPolicy(request.branch.branchRef),
    });
    assertRuntimeNetworkPolicy(sandbox, request.branch.branchRef);
    const command = await sandbox.runCommand({
      args: ["-e", boundedCandidateCommandProgram],
      cmd: NODE,
      cwd: sandbox.cwd,
      detached: true,
      env: {
        CI: "1",
        GENIE_LIVE_ARTIFACT_PATH: `${sandbox.cwd}/${CANDIDATE_ARTIFACT_PATH}`,
        GENIE_LIVE_BOUND_TREE: request.candidate.tree,
        GENIE_LIVE_BRANCH_ID: request.branch.branchId,
        GENIE_LIVE_BRANCH_NAME: request.branch.branchName,
        GENIE_LIVE_DB_CHALLENGE_NONCE: request.branch.challengeNonce,
        GENIE_LIVE_DB_CHALLENGE_TABLE: request.branch.challengeTable,
        GENIE_LIVE_POSTGRES_URL: request.branch.credentials.databaseUrl,
        GENIE_LIVE_PRODUCTION_ABSENCE_VERIFIED: "1",
        GENIE_LIVE_PRODUCTION_PROJECT_REF: request.productionRef,
        GENIE_LIVE_SNAPSHOT_SEAL: LIVE_BROKER_SEAL,
        GENIE_LIVE_SUPABASE_ANON_KEY: request.branch.credentials.anonKey,
        GENIE_LIVE_SUPABASE_SERVICE_ROLE_KEY: request.branch.credentials.serviceRoleKey,
        GENIE_LIVE_SUPABASE_URL: request.branch.credentials.supabaseUrl,
        GENIE_LIVE_TEST_PROJECT_REF: request.branch.branchRef,
        HOME: "/home/candidate",
        PLAYWRIGHT_BROWSERS_PATH,
        TMPDIR: "/home/candidate/tmp",
      },
      timeoutMs: COMMAND_TIMEOUT_MS,
    });
    const control: BrokerControl = {
      branch: controlBranch,
      candidate: request.candidate,
      commandId: command.cmdId,
      networkPolicy: runtimeNetworkPolicy(request.branch.branchRef) as {
        allow: string[];
      },
      preflightDatabaseEvidence,
      sandboxName: request.sandboxName,
      schemaVersion: "genie-live-sandbox-control.v2",
      trustedHarnessSha256: trustedHarness.manifestSha256,
    };
    await sandbox.writeFiles([
      {
        content: `${JSON.stringify(control)}\n`,
        mode: 0o600,
        path: CONTROL_PATH,
      },
    ]);
    const sessions = await (await sandbox.listSessions({ limit: 1 })).toArray();
    const sandboxSessionId = sessions[0]?.id;
    if (!sandboxSessionId || !/^[A-Za-z0-9_-]{8,255}$/u.test(sandboxSessionId)) {
      throw new Error("Sandbox session identity is unavailable.");
    }
    return {
      commandId: command.cmdId,
      networkPolicyVerified: true,
      runtime: sandbox.runtime ?? "node24",
      sandboxName: sandbox.name,
      sandboxSessionId,
      seal: LIVE_BROKER_SEAL,
      sourceCommit: request.candidate.commit,
      sourceTree: request.candidate.tree,
    };
  } catch (error) {
    if (sandbox) {
      await sandbox.stop().catch(() => undefined);
      await sandbox.delete().catch(() => undefined);
    }
    throw error;
  }
}

export async function statusLiveSandbox(
  request: LiveBrokerStatusRequest,
): Promise<LiveSandboxStatusResult> {
  const sandbox = await Sandbox.get({ name: request.sandboxName, resume: false });
  assertSandboxMetadataIdentity(sandbox, request);
  const control = parseControl(
    await sandbox.readFileToBuffer({ path: CONTROL_PATH }),
    request,
  );
  const command = await sandbox.getCommand(control.commandId);
  if (command.exitCode === null) {
    return {
      brokerArtifact: null,
      candidateArtifact: null,
      commandDurationMs: null,
      commandExitCode: null,
      commandId: command.cmdId,
      networkPolicyVerified: false,
      sandboxName: sandbox.name,
      seal: LIVE_BROKER_SEAL,
      sourceSealVerified: false,
      state: "running",
    };
  }
  const durationMs = command.durationMs;
  if (
    command.exitCode !== 0 ||
    typeof durationMs !== "number" ||
    !Number.isFinite(durationMs)
  ) {
    throw new Error("Candidate command did not complete successfully.");
  }
  await verifyCommitAndTree(sandbox, request.candidate);
  await assertCandidateWriteScope(sandbox);
  await assertNoCandidateProcesses(sandbox);
  const networkPolicyVerified =
    JSON.stringify(sandbox.networkPolicy) === JSON.stringify(control.networkPolicy);
  if (!networkPolicyVerified) {
    throw new Error("Sandbox terminal network policy is not a custom allowlist.");
  }
  const trustedHarness = await verifyTrustedHarness(sandbox, request.candidate.tree);
  if (trustedHarness.manifestSha256 !== control.trustedHarnessSha256) {
    throw new Error("Trusted harness changed during candidate execution.");
  }
  const artifactEvidence = await boundedFileEvidence(
    sandbox,
    CANDIDATE_ARTIFACT_PATH,
    ARTIFACT_MAX_BYTES,
    1,
  );
  const artifactBytes = await sandbox.readFileToBuffer({
    cwd: sandbox.cwd,
    path: CANDIDATE_ARTIFACT_PATH,
  });
  if (
    !artifactBytes ||
    artifactBytes.length !== artifactEvidence.bytes ||
    createHash("sha256").update(artifactBytes).digest("hex") !== artifactEvidence.sha256
  ) {
    throw new Error("Candidate returned no bounded live evidence artifact.");
  }
  let candidateArtifact: unknown;
  try {
    candidateArtifact = JSON.parse(artifactBytes.toString("utf8"));
  } catch {
    throw new Error("Candidate live evidence is malformed.");
  }
  const validatedCandidateArtifact = assertClosedCandidateArtifact(candidateArtifact, {
    candidateBinding: trustedHarness.candidateBinding,
    pgTapSuites: trustedHarness.pgTapSuites,
    predecessorFixture: trustedHarness.predecessorFixture,
  });
  const stdoutEvidence = await boundedFileEvidence(
    sandbox,
    TRUSTED_STDOUT_PATH,
    COMMAND_OUTPUT_MAX_BYTES,
  );
  const stderrEvidence = await boundedFileEvidence(
    sandbox,
    TRUSTED_STDERR_PATH,
    COMMAND_OUTPUT_MAX_BYTES,
  );
  const database = parseTerminalDatabaseEvidence(
    await trustedDatabaseEvidence(control.branch, "terminal"),
    control.branch.branchRef,
  );
  const brokerArtifact = {
    candidateArtifactSha256: createHash("sha256")
      .update(JSON.stringify(validatedCandidateArtifact))
      .digest("hex"),
    command: {
      durationMs,
      exitCode: 0 as const,
      stderrBytes: stderrEvidence.bytes,
      stderrSha256: stderrEvidence.sha256,
      stdoutBytes: stdoutEvidence.bytes,
      stdoutSha256: stdoutEvidence.sha256,
    },
    database,
    harnessSha256: trustedHarness.manifestSha256,
    preflightDatabaseEvidence: control.preflightDatabaseEvidence,
    schemaVersion: "genie-trusted-live-harness-evidence.v1" as const,
  };
  return {
    brokerArtifact,
    candidateArtifact: validatedCandidateArtifact,
    commandDurationMs: durationMs,
    commandExitCode: command.exitCode,
    commandId: command.cmdId,
    networkPolicyVerified,
    sandboxName: sandbox.name,
    seal: LIVE_BROKER_SEAL,
    sourceSealVerified: true,
    state: "finished",
  };
}

export async function stopLiveSandbox(
  request: LiveBrokerStopRequest,
): Promise<{ absenceSnapshots: 3; deleted: boolean; sandboxName: string }> {
  let consecutiveAbsence = 0;
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    const listed = await Sandbox.list({ namePrefix: request.sandboxName });
    const exact = (await listed.toArray()).filter(
      (sandbox) => sandbox.name === request.sandboxName,
    );
    if (exact.length > 1) {
      throw new Error("Sandbox cleanup identity is duplicated.");
    }
    if (exact.length === 1) {
      consecutiveAbsence = 0;
      const sandbox = await Sandbox.get({
        name: request.sandboxName,
        resume: false,
      });
      assertSandboxMetadataIdentity(sandbox, request);
      await sandbox.stop().catch(() => undefined);
      await sandbox.delete();
    } else {
      consecutiveAbsence += 1;
      if (consecutiveAbsence >= 3) {
        return {
          absenceSnapshots: 3,
          deleted: true,
          sandboxName: request.sandboxName,
        };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("Sandbox cleanup could not prove repeated exact-name absence.");
}

import { createPublicKey, createHash, randomUUID, verify } from "node:crypto";

export const LIVE_BROKER_SCHEMA_VERSION = "genie-live-broker-request.v1";
export const LIVE_BROKER_SIGNER_ID = "genie-ci-ed25519-v1";
export const LIVE_BROKER_PUBLIC_KEY_SPKI_BASE64 =
  "MCowBQYDK2VwAyEAQWlCcHOTC+evpLw+iL09TrOsz807JdXg6mYeeqUa0NM=";
export const LIVE_BROKER_REPOSITORY = "toolsatZyra/content-genie";
export const LIVE_BROKER_REPOSITORY_URL =
  "https://github.com/toolsatZyra/content-genie.git";
export const LIVE_BROKER_SEAL =
  "vercel-firecracker-root-owned-low-privilege-candidate-v1";

export const LIVE_BROKER_MAX_BODY_BYTES = 32 * 1024;
const MAX_CLOCK_SKEW_MS = 120_000;
const commitPattern = /^[a-f0-9]{40}$/u;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const sandboxNamePattern = /^genie-live-[a-f0-9]{24}$/u;
const branchNamePattern = /^genie-live-[0-9a-f-]{12}$/u;
const branchRefPattern = /^[a-z0-9]{20}$/u;
const challengeTablePattern = /^phase2_connection_challenge_[a-f0-9]{32}$/u;

type LiveBrokerCandidate = {
  commit: string;
  tree: string;
};

type LiveBrokerCredentials = {
  anonKey: string;
  databaseUrl: string;
  serviceRoleKey: string;
  supabaseUrl: string;
};

export type LiveBrokerStartRequest = {
  action: "start";
  branch: {
    branchId: string;
    branchName: string;
    branchRef: string;
    challengeNonce: string;
    challengeTable: string;
    credentials: LiveBrokerCredentials;
  };
  candidate: LiveBrokerCandidate;
  productionRef: string;
  sandboxName: string;
  schemaVersion: typeof LIVE_BROKER_SCHEMA_VERSION;
};

export type LiveBrokerStatusRequest = {
  action: "status";
  candidate: LiveBrokerCandidate;
  sandboxName: string;
  schemaVersion: typeof LIVE_BROKER_SCHEMA_VERSION;
};

export type LiveBrokerStopRequest = {
  action: "stop";
  candidate: LiveBrokerCandidate;
  sandboxName: string;
  schemaVersion: typeof LIVE_BROKER_SCHEMA_VERSION;
};

export type LiveBrokerRequest =
  LiveBrokerStartRequest | LiveBrokerStatusRequest | LiveBrokerStopRequest;

export class LiveBrokerRequestError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 401 | 409,
  ) {
    super(message);
    this.name = "LiveBrokerRequestError";
  }
}

function exactKeys(value: unknown, keys: readonly string[]): value is object {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",")
  );
}

function ownString(value: object, key: string, maximum = 8_192): string {
  const candidate = (value as Record<string, unknown>)[key];
  if (typeof candidate !== "string" || !candidate || candidate.length > maximum) {
    throw new LiveBrokerRequestError(`Invalid live-broker ${key}.`, 400);
  }
  return candidate;
}

function parseCandidate(value: unknown): LiveBrokerCandidate {
  if (!exactKeys(value, ["commit", "tree"])) {
    throw new LiveBrokerRequestError("Invalid live-broker candidate.", 400);
  }
  const commit = ownString(value, "commit");
  const tree = ownString(value, "tree");
  if (!commitPattern.test(commit) || !commitPattern.test(tree)) {
    throw new LiveBrokerRequestError("Invalid live-broker candidate identity.", 400);
  }
  return { commit, tree };
}

function parseDatabaseUrl(value: string, branchRef: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new LiveBrokerRequestError("Invalid disposable database URL.", 400);
  }
  const expectedHost = `db.${branchRef}.supabase.co`;
  if (
    parsed.protocol !== "postgresql:" ||
    parsed.hostname !== expectedHost ||
    parsed.port !== "5432" ||
    parsed.pathname !== "/postgres" ||
    parsed.username !== "postgres" ||
    !parsed.password ||
    parsed.hash ||
    parsed.search
  ) {
    throw new LiveBrokerRequestError(
      "Disposable database URL is outside the exact branch boundary.",
      400,
    );
  }
  return value;
}

function parseStart(value: object): LiveBrokerStartRequest {
  if (
    !exactKeys(value, [
      "action",
      "branch",
      "candidate",
      "productionRef",
      "sandboxName",
      "schemaVersion",
    ])
  ) {
    throw new LiveBrokerRequestError("Invalid live-broker start schema.", 400);
  }
  const candidate = parseCandidate((value as Record<string, unknown>).candidate);
  const sandboxName = ownString(value, "sandboxName");
  const productionRef = ownString(value, "productionRef");
  const branchValue = (value as Record<string, unknown>).branch;
  if (
    !sandboxNamePattern.test(sandboxName) ||
    !branchRefPattern.test(productionRef) ||
    !exactKeys(branchValue, [
      "branchId",
      "branchName",
      "branchRef",
      "challengeNonce",
      "challengeTable",
      "credentials",
    ])
  ) {
    throw new LiveBrokerRequestError("Invalid live-broker branch schema.", 400);
  }
  const branchId = ownString(branchValue, "branchId");
  const branchName = ownString(branchValue, "branchName");
  const branchRef = ownString(branchValue, "branchRef");
  const challengeNonce = ownString(branchValue, "challengeNonce");
  const challengeTable = ownString(branchValue, "challengeTable");
  if (
    !uuidPattern.test(branchId) ||
    !branchNamePattern.test(branchName) ||
    !branchRefPattern.test(branchRef) ||
    branchRef === productionRef ||
    !uuidPattern.test(challengeNonce) ||
    !challengeTablePattern.test(challengeTable)
  ) {
    throw new LiveBrokerRequestError("Invalid disposable branch identity.", 400);
  }
  const credentialsValue = (branchValue as Record<string, unknown>).credentials;
  if (
    !exactKeys(credentialsValue, [
      "anonKey",
      "databaseUrl",
      "serviceRoleKey",
      "supabaseUrl",
    ])
  ) {
    throw new LiveBrokerRequestError("Invalid branch credential schema.", 400);
  }
  const supabaseUrl = ownString(credentialsValue, "supabaseUrl");
  if (supabaseUrl !== `https://${branchRef}.supabase.co`) {
    throw new LiveBrokerRequestError(
      "Disposable Supabase URL is outside the exact branch boundary.",
      400,
    );
  }
  const anonKey = ownString(credentialsValue, "anonKey");
  const serviceRoleKey = ownString(credentialsValue, "serviceRoleKey");
  if (anonKey.length < 32 || serviceRoleKey.length < 32 || anonKey === serviceRoleKey) {
    throw new LiveBrokerRequestError("Invalid disposable branch credentials.", 400);
  }
  return {
    action: "start",
    branch: {
      branchId,
      branchName,
      branchRef,
      challengeNonce,
      challengeTable,
      credentials: {
        anonKey,
        databaseUrl: parseDatabaseUrl(
          ownString(credentialsValue, "databaseUrl"),
          branchRef,
        ),
        serviceRoleKey,
        supabaseUrl,
      },
    },
    candidate,
    productionRef,
    sandboxName,
    schemaVersion: LIVE_BROKER_SCHEMA_VERSION,
  };
}

function parseControl(
  value: object,
  action: "status" | "stop",
): LiveBrokerStatusRequest | LiveBrokerStopRequest {
  if (!exactKeys(value, ["action", "candidate", "sandboxName", "schemaVersion"])) {
    throw new LiveBrokerRequestError("Invalid live-broker control schema.", 400);
  }
  const sandboxName = ownString(value, "sandboxName");
  if (!sandboxNamePattern.test(sandboxName)) {
    throw new LiveBrokerRequestError("Invalid live-broker sandbox name.", 400);
  }
  return {
    action,
    candidate: parseCandidate((value as Record<string, unknown>).candidate),
    sandboxName,
    schemaVersion: LIVE_BROKER_SCHEMA_VERSION,
  };
}

export function parseLiveBrokerRequest(rawBody: string): LiveBrokerRequest {
  if (Buffer.byteLength(rawBody, "utf8") > LIVE_BROKER_MAX_BODY_BYTES) {
    throw new LiveBrokerRequestError("Live-broker request is too large.", 400);
  }
  let value: unknown;
  try {
    value = JSON.parse(rawBody);
  } catch {
    throw new LiveBrokerRequestError("Malformed live-broker JSON.", 400);
  }
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (value as Record<string, unknown>).schemaVersion !== LIVE_BROKER_SCHEMA_VERSION
  ) {
    throw new LiveBrokerRequestError("Invalid live-broker request version.", 400);
  }
  const action = (value as Record<string, unknown>).action;
  if (action === "start") return parseStart(value);
  if (action === "status" || action === "stop") {
    return parseControl(value, action);
  }
  throw new LiveBrokerRequestError("Invalid live-broker action.", 400);
}

export function liveBrokerSignaturePayload(
  rawBody: string,
  issuedAt: string,
  nonce: string,
): Buffer {
  const bodySha256 = createHash("sha256").update(rawBody).digest("hex");
  return Buffer.from(
    `genie-live-broker-signature.v1\n${issuedAt}\n${nonce}\n${bodySha256}`,
    "utf8",
  );
}

export function authenticateLiveBrokerRequest(
  headers: Headers,
  rawBody: string,
  options: { now?: number; publicKeySpkiBase64?: string } = {},
): { issuedAt: string; nonce: string; signerId: typeof LIVE_BROKER_SIGNER_ID } {
  const issuedAt = headers.get("x-genie-live-issued-at") ?? "";
  const nonce = headers.get("x-genie-live-nonce") ?? "";
  const signature = headers.get("x-genie-live-signature") ?? "";
  const issuedAtNumber = Number(issuedAt);
  const now = options.now ?? Date.now();
  if (
    !/^[0-9]{13}$/u.test(issuedAt) ||
    !Number.isSafeInteger(issuedAtNumber) ||
    Math.abs(now - issuedAtNumber) > MAX_CLOCK_SKEW_MS ||
    !uuidPattern.test(nonce) ||
    !/^[A-Za-z0-9+/]{80,100}={0,2}$/u.test(signature)
  ) {
    throw new LiveBrokerRequestError("Live-broker authentication failed.", 401);
  }
  let valid = false;
  try {
    valid = verify(
      null,
      liveBrokerSignaturePayload(rawBody, issuedAt, nonce),
      createPublicKey({
        format: "der",
        key: Buffer.from(
          options.publicKeySpkiBase64 ?? LIVE_BROKER_PUBLIC_KEY_SPKI_BASE64,
          "base64",
        ),
        type: "spki",
      }),
      Buffer.from(signature, "base64"),
    );
  } catch {
    valid = false;
  }
  if (!valid) {
    throw new LiveBrokerRequestError("Live-broker authentication failed.", 401);
  }
  return { issuedAt, nonce, signerId: LIVE_BROKER_SIGNER_ID };
}

export function createLiveBrokerSandboxName(): string {
  return `genie-live-${randomUUID().replaceAll("-", "").slice(0, 24)}`;
}

export function liveBrokerRuntimeAllowlist(branchRef: string) {
  return {
    allow: [`${branchRef}.supabase.co`, `db.${branchRef}.supabase.co`],
  };
}

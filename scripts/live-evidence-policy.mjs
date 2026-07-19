import { createHash } from "node:crypto";

export function normalizeCandidatePath(path) {
  if (typeof path !== "string" || path.length === 0 || path.includes("\0")) {
    throw new Error("Candidate evidence paths must be non-empty strings.");
  }
  return path.replaceAll("\\", "/").replace(/^\.\//u, "");
}

function comparePaths(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function digestCandidateEntries(entries) {
  const normalized = entries
    .map(({ contents, path }) => ({
      contents: Buffer.isBuffer(contents) ? contents : Buffer.from(contents),
      path: normalizeCandidatePath(path),
    }))
    .sort((left, right) => comparePaths(left.path, right.path));
  const uniquePaths = new Set(normalized.map(({ path }) => path));
  if (uniquePaths.size !== normalized.length) {
    throw new Error("Candidate evidence contains duplicate normalized paths.");
  }

  const digest = createHash("sha256");
  for (const { contents, path } of normalized) {
    digest.update(path, "utf8");
    digest.update("\0", "utf8");
    digest.update(String(contents.byteLength), "utf8");
    digest.update("\0", "utf8");
    digest.update(contents);
    digest.update("\0", "utf8");
  }
  return Object.freeze({
    fileCount: normalized.length,
    sha256: digest.digest("hex"),
  });
}

function parsePostgresCredentialUrl(databaseUrl) {
  if (
    typeof databaseUrl !== "string" ||
    databaseUrl.length === 0 ||
    /[\0\r\n]/u.test(databaseUrl)
  ) {
    throw new Error("PostgreSQL credential URL is invalid.");
  }
  const url = new URL(databaseUrl);
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("PostgreSQL credential source is not a PostgreSQL URL.");
  }
  let username;
  let password;
  let database;
  try {
    username = decodeURIComponent(url.username);
    password = decodeURIComponent(url.password);
    database = decodeURIComponent(url.pathname.replace(/^\//u, ""));
  } catch {
    throw new Error("PostgreSQL credential URL contains invalid encoding.");
  }
  if (!username || !password || !database || !url.hostname) {
    throw new Error("PostgreSQL credential source is missing connection credentials.");
  }
  for (const [label, value] of Object.entries({
    database,
    host: url.hostname,
    password,
    username,
  })) {
    if (/[\0\r\n]/u.test(value)) {
      throw new Error(`PostgreSQL credential ${label} is invalid.`);
    }
  }
  const sslMode = url.searchParams.get("sslmode") ?? "require";
  if (!new Set(["require", "verify-ca", "verify-full"]).has(sslMode)) {
    throw new Error("PostgreSQL credential transport requires a safe TLS mode.");
  }
  const port = url.port || "5432";
  if (!/^\d{1,5}$/u.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error("PostgreSQL credential port is invalid.");
  }
  return Object.freeze({
    database,
    encodedPassword: url.password,
    host: url.hostname,
    password,
    port,
    sslMode,
    username,
  });
}

function pgpassValue(value) {
  return value.replaceAll("\\", "\\\\").replaceAll(":", "\\:");
}

export function buildPostgresPgpassTransport(databaseUrl) {
  const parsed = parsePostgresCredentialUrl(databaseUrl);
  const host = parsed.host.includes(":")
    ? `[${parsed.host.replace(/^\[|\]$/gu, "")}]`
    : parsed.host;
  const passwordlessUrl =
    `postgresql://${encodeURIComponent(parsed.username)}@${host}:${parsed.port}/` +
    `${encodeURIComponent(parsed.database)}?sslmode=${encodeURIComponent(parsed.sslMode)}`;
  return Object.freeze({
    passwordlessUrl,
    pgpassLine: `${[
      parsed.host,
      parsed.port,
      parsed.database,
      parsed.username,
      parsed.password,
    ]
      .map(pgpassValue)
      .join(":")}\n`,
  });
}

export function assertPostgresCredentialAbsentFromArgv(args, databaseUrl) {
  if (!Array.isArray(args)) {
    throw new Error("Child-process arguments must be an array.");
  }
  const parsed = parsePostgresCredentialUrl(databaseUrl);
  const forbidden = new Set([
    databaseUrl,
    parsed.encodedPassword,
    parsed.password,
    encodeURIComponent(parsed.password),
  ]);
  if (
    args.some((argument) =>
      [...forbidden].some(
        (secret) => secret.length > 0 && String(argument).includes(secret),
      ),
    )
  ) {
    throw new Error("A child-process argument contains branch database credentials.");
  }
}

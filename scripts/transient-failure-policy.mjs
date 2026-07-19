const transientDatabaseOutputPatterns = Object.freeze([
  /\bconnect\s+ECONNREFUSED\b/i,
  /\bread\s+ECONNRESET\b/i,
  /\bconnect\s+ETIMEDOUT\b/i,
  /\bconnection timed out\b/i,
  /\bgetaddrinfo\s+EAI_AGAIN\b/i,
  /psql:[^\r\n]*connection to server[^\r\n]*failed:[^\r\n]*connection refused/i,
  /connection reset by peer/i,
  /server closed the connection unexpectedly/i,
  /the database system is starting up/i,
  /remaining connection slots are reserved/i,
  /too many clients already/i,
  /TLS handshake timeout/i,
  /network is unreachable/i,
  /unexpected EOF (?:on|from) (?:client|server) connection/i,
  /\bwrite\s+EPIPE\b/i,
]);

const transientTransportCodes = new Set([
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EPIPE",
  "ETIMEDOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
]);

const transientDatabaseSqlStates = new Set([
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
  "08007",
  "08P01",
  "53300",
  "57P03",
]);

export function isTransientDatabaseFailureOutput(output) {
  const sqlStates = databaseSqlStates(output);
  if (sqlStates.length > 0) {
    return sqlStates.every((sqlState) => transientDatabaseSqlStates.has(sqlState));
  }
  return transientDatabaseOutputPatterns.some((pattern) => pattern.test(output));
}

export function isTransientCliFailureOutput(output) {
  const sqlStates = databaseSqlStates(output);
  if (sqlStates.some((sqlState) => !transientDatabaseSqlStates.has(sqlState))) {
    return false;
  }
  return (
    isTransientDatabaseFailureOutput(output) ||
    /Timeout while shutting down PostHog\. Some events may not have been sent\./i.test(
      output,
    ) ||
    /\bfailed to (?:create|delete|get|list) branch:\s*TransportError\b/i.test(output) ||
    /\b(?:HTTP(?: response)?(?: status)?|status(?: code)?)\s*[:=]?\s*(?:408|425|429|500|502|503|504)\b/i.test(
      output,
    )
  );
}

function databaseSqlStates(output) {
  return [...output.matchAll(/\bSQLSTATE\s+([0-9A-Z]{5})\b/gi)].map((match) =>
    match[1].toUpperCase(),
  );
}

function errorCode(error) {
  if (!error || typeof error !== "object") return null;
  if ("code" in error && typeof error.code === "string") return error.code;
  if ("cause" in error) return errorCode(error.cause);
  return null;
}

export function isTransientTransportError(error) {
  if (
    error &&
    typeof error === "object" &&
    "name" in error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  ) {
    return true;
  }
  const code = errorCode(error);
  return code !== null && transientTransportCodes.has(code);
}

export function isTransientManagementStatus(status) {
  return [408, 425, 429, 500, 502, 503, 504].includes(status);
}

export function isTransientReadinessStatus(status) {
  return status === 404 || isTransientManagementStatus(status);
}

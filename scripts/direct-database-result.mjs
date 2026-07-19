export function terminalDatabaseRows(value) {
  if (!Array.isArray(value)) {
    throw new Error("Direct database query returned a non-array result.");
  }
  const terminal =
    value.length > 0 && value.every((result) => Array.isArray(result))
      ? value.at(-1)
      : value;
  if (
    !Array.isArray(terminal) ||
    terminal.some((row) => !row || typeof row !== "object" || Array.isArray(row))
  ) {
    throw new Error("Direct database query returned an invalid terminal rowset.");
  }
  return [...terminal];
}

export function strictDatabaseInteger(value, label) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^-?(?:0|[1-9]\d*)$/.test(value)
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${label} is not a canonical safe database integer.`);
  }
  return parsed;
}

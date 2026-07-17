function present(source, name) {
  return Boolean(source[name]?.trim());
}

function validUrl(source, name) {
  if (!present(source, name)) return false;
  try {
    return ["http:", "https:"].includes(new URL(source[name]).protocol);
  } catch {
    return false;
  }
}

export function assertProductionRuntime(source) {
  const issues = [];
  if (source.GENIE_ENVIRONMENT !== "production") {
    issues.push("environment");
  }
  for (const name of ["NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_SUPABASE_URL"]) {
    if (!validUrl(source, name)) issues.push(name);
  }
  if (!present(source, "NEXT_PUBLIC_SUPABASE_ANON_KEY")) {
    issues.push("browser database credential");
  }

  const gates = [
    "GENIE_ENABLE_EXPORT",
    "GENIE_ENABLE_FINAL_APPROVAL",
    "GENIE_ENABLE_PROVIDER_SPEND",
    "GENIE_ENABLE_RENDER",
  ];
  for (const name of gates) {
    if (!["true", "false"].includes(source[name] ?? "")) issues.push(name);
  }
  if (!present(source, "SUPABASE_SERVICE_ROLE_KEY")) {
    issues.push("trusted Storage signer credential");
  }
  if (
    (source.GENIE_ENABLE_PROVIDER_SPEND === "true" ||
      source.GENIE_ENABLE_RENDER === "true") &&
    !present(source, "TRIGGER_SECRET_KEY")
  ) {
    issues.push("job runtime credential");
  }
  if (
    present(source, "SUPABASE_PROJECT_REF") &&
    source.SUPABASE_PROJECT_REF === source.SUPABASE_TEST_PROJECT_REF
  ) {
    issues.push("database environment isolation");
  }

  if (issues.length > 0) {
    throw new Error(`Production runtime contract failed (${issues.join(", ")})`);
  }
}

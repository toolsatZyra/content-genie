import "server-only";

export function consumeBuildSecretCanary(): "armed" | "empty" {
  return process.env.GENIE_BUILD_SECRET_CANARY ? "armed" : "empty";
}

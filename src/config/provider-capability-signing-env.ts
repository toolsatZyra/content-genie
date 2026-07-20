import "server-only";

import { getServerEnvironment } from "@/config/server-env";

export type ProviderCapabilitySigningEnvironment = Readonly<{
  audience: string;
  issuer: string;
  kid: string;
  privateKeyPkcs8Base64: string;
}>;

export class ProviderCapabilitySigningEnvironmentError extends Error {
  override readonly name = "ProviderCapabilitySigningEnvironmentError";
}

let cached: ProviderCapabilitySigningEnvironment | undefined;

export function getProviderCapabilitySigningEnvironment(): ProviderCapabilitySigningEnvironment {
  if (cached) return cached;
  const server = getServerEnvironment();
  const kid = process.env.GENIE_CAPABILITY_SIGNING_KID?.trim() ?? "";
  const privateKeyPkcs8Base64 =
    process.env.GENIE_CAPABILITY_SIGNING_PRIVATE_KEY?.trim() ?? "";
  const audience = `${server.public.appUrl}/api/internal/provider-broker`;
  if (
    !server.enableProviderSpend ||
    !server.public.appUrl ||
    !/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,79}$/u.test(kid) ||
    !/^[A-Za-z0-9+/]{56,200}={0,2}$/u.test(privateKeyPkcs8Base64)
  ) {
    throw new ProviderCapabilitySigningEnvironmentError(
      "Provider capability signing is unavailable.",
    );
  }
  cached = Object.freeze({
    audience,
    issuer: `genie-capability-${server.environment}`,
    kid,
    privateKeyPkcs8Base64,
  });
  return cached;
}

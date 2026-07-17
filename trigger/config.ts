import { EnvironmentContractError } from "@/config/env-core";

export interface TriggerEnvironment {
  readonly brokerAudience: string;
  readonly brokerClientId: string;
  readonly brokerClientSigningPrivateKey: string;
  readonly capabilityVerifyPublicKey: string;
  readonly triggerSecretKey: string;
}

let cached: TriggerEnvironment | undefined;

export function getTriggerEnvironment(): TriggerEnvironment {
  if (cached) return cached;

  const names = [
    "GENIE_BROKER_AUDIENCE",
    "GENIE_BROKER_CLIENT_ID",
    "GENIE_BROKER_CLIENT_SIGNING_PRIVATE_KEY",
    "GENIE_CAPABILITY_VERIFY_PUBLIC_KEY",
    "TRIGGER_SECRET_KEY",
  ] as const;
  const values = Object.fromEntries(
    names.map((name) => [name, process.env[name]?.trim()]),
  ) as Record<(typeof names)[number], string | undefined>;
  const missing = names.filter((name) => !values[name]);

  if (missing.length > 0) {
    throw new EnvironmentContractError(
      missing.map((name) => `${name} is required in Trigger runtime`),
    );
  }

  cached = Object.freeze({
    brokerAudience: values.GENIE_BROKER_AUDIENCE!,
    brokerClientId: values.GENIE_BROKER_CLIENT_ID!,
    brokerClientSigningPrivateKey: values.GENIE_BROKER_CLIENT_SIGNING_PRIVATE_KEY!,
    capabilityVerifyPublicKey: values.GENIE_CAPABILITY_VERIFY_PUBLIC_KEY!,
    triggerSecretKey: values.TRIGGER_SECRET_KEY!,
  });
  return cached;
}

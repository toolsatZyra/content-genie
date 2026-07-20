import { EnvironmentContractError } from "@/config/env-core";

export interface TriggerEnvironment {
  readonly brokerAudience: string;
  readonly brokerClientId: string;
  readonly brokerClientKid: string;
  readonly brokerClientSigningPrivateKey: string;
  readonly capabilityVerifyPublicKey: string;
  readonly environment: "development" | "preview" | "production" | "test";
  readonly triggerProject: string;
  readonly triggerSecretKey: string;
}

let cached: TriggerEnvironment | undefined;

export function getTriggerEnvironment(): TriggerEnvironment {
  if (cached) return cached;

  const names = [
    "GENIE_BROKER_AUDIENCE",
    "GENIE_BROKER_CLIENT_ID",
    "GENIE_BROKER_CLIENT_KID",
    "GENIE_BROKER_CLIENT_SIGNING_PRIVATE_KEY",
    "GENIE_CAPABILITY_VERIFY_PUBLIC_KEY",
    "GENIE_ENVIRONMENT",
    "TRIGGER_SECRET_KEY",
    "TRIGGER_PROJECT_REF",
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
  if (
    !["development", "preview", "production", "test"].includes(
      values.GENIE_ENVIRONMENT!,
    )
  ) {
    throw new EnvironmentContractError([
      "GENIE_ENVIRONMENT is invalid in Trigger runtime",
    ]);
  }

  cached = Object.freeze({
    brokerAudience: values.GENIE_BROKER_AUDIENCE!,
    brokerClientId: values.GENIE_BROKER_CLIENT_ID!,
    brokerClientKid: values.GENIE_BROKER_CLIENT_KID!,
    brokerClientSigningPrivateKey: values.GENIE_BROKER_CLIENT_SIGNING_PRIVATE_KEY!,
    capabilityVerifyPublicKey: values.GENIE_CAPABILITY_VERIFY_PUBLIC_KEY!,
    environment: values.GENIE_ENVIRONMENT! as TriggerEnvironment["environment"],
    triggerProject: values.TRIGGER_PROJECT_REF!,
    triggerSecretKey: values.TRIGGER_SECRET_KEY!,
  });
  return cached;
}

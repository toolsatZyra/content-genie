import "server-only";

import { getServerEnvironment } from "@/config/server-env";

export type ProviderBrokerEnvironment = Readonly<{
  audience: string;
  capabilityIssuer: string;
  capabilityVerifyPublicKeySpkiBase64: string;
  environment: "development" | "preview" | "production" | "test";
  elevenLabsApiKey: string;
  falKey: string;
  falWebhookBaseUrl: string;
  referenceImageHosts: readonly string[];
}>;

export class ProviderBrokerEnvironmentError extends Error {
  override readonly name = "ProviderBrokerEnvironmentError";
}

export function parseProviderBrokerEnvironment(
  source: Readonly<Record<string, string | undefined>>,
): ProviderBrokerEnvironment {
  const server = getServerEnvironment();
  if (!server.enableProviderSpend) {
    throw new ProviderBrokerEnvironmentError("Provider spend is disabled.");
  }
  const audience = source.GENIE_BROKER_AUDIENCE?.trim() ?? "";
  const capabilityVerifyPublicKeySpkiBase64 =
    source.GENIE_CAPABILITY_VERIFY_PUBLIC_KEY?.trim() ?? "";
  const falKey = source.FAL_KEY?.trim() ?? "";
  const elevenLabsApiKey = source.ELEVENLABS_API_KEY?.trim() ?? "";
  const supabaseUrl = server.public.supabaseUrl;
  const expectedAudience = server.public.appUrl
    ? `${server.public.appUrl}/api/internal/provider-broker`
    : "";
  if (
    !expectedAudience ||
    !supabaseUrl ||
    audience !== expectedAudience ||
    !/^[A-Za-z0-9+/]{56,200}={0,2}$/u.test(capabilityVerifyPublicKeySpkiBase64) ||
    falKey.length < 16 ||
    elevenLabsApiKey.length < 16
  ) {
    throw new ProviderBrokerEnvironmentError(
      "Provider broker configuration is unavailable.",
    );
  }
  return Object.freeze({
    audience,
    capabilityIssuer: `genie-capability-${server.environment}`,
    capabilityVerifyPublicKeySpkiBase64,
    elevenLabsApiKey,
    environment: server.environment,
    falKey,
    falWebhookBaseUrl: `${server.public.appUrl}/api/internal/provider-webhooks/fal`,
    referenceImageHosts: Object.freeze([new URL(supabaseUrl).hostname.toLowerCase()]),
  });
}

let cached: ProviderBrokerEnvironment | undefined;

export function getProviderBrokerEnvironment(): ProviderBrokerEnvironment {
  cached ??= parseProviderBrokerEnvironment(process.env);
  return cached;
}

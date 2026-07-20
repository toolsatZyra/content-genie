export type GenieEnvironment = "development" | "preview" | "production" | "test";

export interface PublicEnvironment {
  readonly appUrl: string | null;
  readonly supabaseAnonKey: string | null;
  readonly supabaseUrl: string | null;
}

export interface ServerEnvironment {
  readonly commandHmacSecret: string | null;
  readonly environment: GenieEnvironment;
  readonly enableExport: boolean;
  readonly enableFinalApproval: boolean;
  readonly enableMvpInlinePreflight: boolean;
  readonly enableProviderSpend: boolean;
  readonly enableRender: boolean;
  readonly public: PublicEnvironment;
  readonly supabaseProjectRef: string | null;
  readonly supabaseServiceRoleKey: string | null;
  readonly supabaseTestProjectRef: string | null;
  readonly triggerSecretKey: string | null;
}

export class EnvironmentContractError extends Error {
  override readonly name = "EnvironmentContractError";

  constructor(readonly issues: readonly string[]) {
    super(`Environment contract failed (${issues.join("; ")})`);
  }
}

type EnvironmentSource = Readonly<Record<string, string | undefined>>;

function optional(source: EnvironmentSource, name: string): string | null {
  const value = source[name]?.trim();
  return value ? value : null;
}

function parseBoolean(
  source: EnvironmentSource,
  name: string,
  issues: string[],
): boolean {
  const value = optional(source, name);
  if (value === null || value === "false") return false;
  if (value === "true") return true;
  issues.push(`${name} must be true or false`);
  return false;
}

function parseUrl(value: string | null, name: string, issues: string[]): string | null {
  if (value === null) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) {
      issues.push(`${name} must use http or https`);
      return null;
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    issues.push(`${name} must be a valid absolute URL`);
    return null;
  }
}

function parseEnvironment(
  source: EnvironmentSource,
  issues: string[],
): GenieEnvironment {
  const defaultEnvironment =
    source.NODE_ENV === "production"
      ? "production"
      : source.NODE_ENV === "test"
        ? "test"
        : "development";
  const value = optional(source, "GENIE_ENVIRONMENT") ?? defaultEnvironment;
  if (
    value === "development" ||
    value === "preview" ||
    value === "production" ||
    value === "test"
  ) {
    return value;
  }
  issues.push("GENIE_ENVIRONMENT must be development, preview, production, or test");
  return "development";
}

function supabaseRefFromUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const hostname = new URL(value).hostname;
    const suffix = ".supabase.co";
    return hostname.endsWith(suffix) ? hostname.slice(0, -suffix.length) : null;
  } catch {
    return null;
  }
}

export function parsePublicEnvironment(source: EnvironmentSource): PublicEnvironment {
  const issues: string[] = [];
  const parsed = {
    appUrl: parseUrl(
      optional(source, "NEXT_PUBLIC_APP_URL"),
      "NEXT_PUBLIC_APP_URL",
      issues,
    ),
    supabaseAnonKey: optional(source, "NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    supabaseUrl: parseUrl(
      optional(source, "NEXT_PUBLIC_SUPABASE_URL"),
      "NEXT_PUBLIC_SUPABASE_URL",
      issues,
    ),
  } satisfies PublicEnvironment;

  if (issues.length > 0) throw new EnvironmentContractError(issues);
  return Object.freeze(parsed);
}

export function parseServerEnvironment(source: EnvironmentSource): ServerEnvironment {
  const issues: string[] = [];
  const environment = parseEnvironment(source, issues);
  const publicEnvironment = (() => {
    try {
      return parsePublicEnvironment(source);
    } catch (error) {
      if (error instanceof EnvironmentContractError) issues.push(...error.issues);
      return {
        appUrl: null,
        supabaseAnonKey: null,
        supabaseUrl: null,
      };
    }
  })();

  const enableExport = parseBoolean(source, "GENIE_ENABLE_EXPORT", issues);
  const enableFinalApproval = parseBoolean(
    source,
    "GENIE_ENABLE_FINAL_APPROVAL",
    issues,
  );
  const enableProviderSpend = parseBoolean(
    source,
    "GENIE_ENABLE_PROVIDER_SPEND",
    issues,
  );
  const enableRender = parseBoolean(source, "GENIE_ENABLE_RENDER", issues);
  const enableMvpInlinePreflight = parseBoolean(
    source,
    "GENIE_MVP_INLINE_PREFLIGHT",
    issues,
  );
  const commandHmacSecret = optional(source, "GENIE_COMMAND_HMAC_SECRET");
  const supabaseProjectRef = optional(source, "SUPABASE_PROJECT_REF");
  const supabaseTestProjectRef = optional(source, "SUPABASE_TEST_PROJECT_REF");
  const supabaseServiceRoleKey = optional(source, "SUPABASE_SERVICE_ROLE_KEY");
  const triggerSecretKey = optional(source, "TRIGGER_SECRET_KEY");

  if (
    supabaseProjectRef &&
    supabaseTestProjectRef &&
    supabaseProjectRef === supabaseTestProjectRef
  ) {
    issues.push("SUPABASE_TEST_PROJECT_REF must not equal SUPABASE_PROJECT_REF");
  }

  if (environment === "preview" || environment === "test") {
    const urlRef = supabaseRefFromUrl(publicEnvironment.supabaseUrl);
    if (urlRef && supabaseProjectRef && urlRef === supabaseProjectRef) {
      issues.push("preview/test runtime cannot target the production Supabase URL");
    }
    if (urlRef && supabaseTestProjectRef && urlRef !== supabaseTestProjectRef) {
      issues.push("preview/test Supabase URL must match SUPABASE_TEST_PROJECT_REF");
    }
  }

  if (
    (environment === "production" || enableFinalApproval) &&
    (!publicEnvironment.appUrl ||
      !publicEnvironment.supabaseUrl ||
      !publicEnvironment.supabaseAnonKey)
  ) {
    issues.push(
      "production/final approval requires public application and Supabase values",
    );
  }

  if (
    (environment === "production" ||
      enableExport ||
      enableFinalApproval ||
      enableProviderSpend ||
      enableRender) &&
    !supabaseServiceRoleKey
  ) {
    issues.push(
      "production and consequential feature gates require SUPABASE_SERVICE_ROLE_KEY",
    );
  }

  if (
    (enableProviderSpend || enableRender) &&
    !triggerSecretKey &&
    !enableMvpInlinePreflight
  ) {
    issues.push(
      "provider spend/render requires TRIGGER_SECRET_KEY or GENIE_MVP_INLINE_PREFLIGHT",
    );
  }

  if (issues.length > 0) throw new EnvironmentContractError(issues);

  return Object.freeze({
    commandHmacSecret,
    environment,
    enableExport,
    enableFinalApproval,
    enableMvpInlinePreflight,
    enableProviderSpend,
    enableRender,
    public: publicEnvironment,
    supabaseProjectRef,
    supabaseServiceRoleKey,
    supabaseTestProjectRef,
    triggerSecretKey,
  });
}

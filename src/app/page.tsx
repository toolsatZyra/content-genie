import { AccessPending } from "@/components/auth/access-pending";
import { AuthGateway } from "@/components/auth/auth-gateway";
import { AuthenticatedStudio } from "@/components/studio/authenticated-studio";
import { StudioAtrium } from "@/components/studio/studio-atrium";
import { consumeBuildSecretCanary } from "@/config/build-boundary";
import { getServerEnvironment } from "@/config/server-env";
import {
  createServerSupabaseClient,
  hasConfiguredSupabase,
} from "@/lib/supabase/server";
import { loadStudioProjection } from "@/server/studio-query";
import { deterministicStudioProjection } from "@/test/fakes/studio";

interface HomePageProps {
  readonly searchParams: Promise<{
    readonly auth?: string;
    readonly fixture?: string;
    readonly invite?: string;
    readonly workspace?: string;
  }>;
}

function authNotice(code: string | undefined): string | undefined {
  if (code === "missing-code") return "That sign-in link was incomplete.";
  if (code === "exchange-failed") return "That sign-in link is invalid or expired.";
  return undefined;
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const canary = consumeBuildSecretCanary();
  const parameters = await searchParams;
  if (
    getServerEnvironment().environment === "test" &&
    parameters.fixture === "phase1"
  ) {
    return (
      <div data-server-secret-boundary={canary}>
        <AuthenticatedStudio
          projection={deterministicStudioProjection()}
          realtimeEnabled={false}
        />
      </div>
    );
  }
  if (!hasConfiguredSupabase()) {
    return (
      <div data-server-secret-boundary={canary}>
        <StudioAtrium />
      </div>
    );
  }

  const client = await createServerSupabaseClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) {
    return (
      <div data-server-secret-boundary={canary}>
        <AuthGateway initialNotice={authNotice(parameters.auth)} />
      </div>
    );
  }

  const projection = await loadStudioProjection(user, parameters.workspace);
  if (!projection) {
    const token =
      parameters.invite && /^[A-Za-z0-9_-]{32,128}$/.test(parameters.invite)
        ? parameters.invite
        : undefined;
    return (
      <div data-server-secret-boundary={canary}>
        <AccessPending
          displayEmail={user.email ?? "verified user"}
          invitationToken={token}
        />
      </div>
    );
  }

  return (
    <div data-server-secret-boundary={canary}>
      <AuthenticatedStudio projection={projection} />
    </div>
  );
}

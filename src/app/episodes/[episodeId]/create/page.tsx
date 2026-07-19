import { notFound, redirect } from "next/navigation";

import { CreationStudio } from "@/components/creation/creation-studio";
import { getServerEnvironment } from "@/config/server-env";
import type { CreationProjection } from "@/domain/creation";
import { findLook } from "@/domain/look/look-registry";
import { findVoiceByVersionId } from "@/domain/voice/voice-registry";
import {
  createServerSupabaseClient,
  hasConfiguredSupabase,
} from "@/lib/supabase/server";
import { loadCreationProjection } from "@/server/creation-query";
import {
  deterministicCreationProjection,
  deterministicReadOnlyNoScriptCreationProjection,
} from "@/test/fakes/creation";

interface CreationPageProps {
  readonly params: Promise<{ readonly episodeId: string }>;
  readonly searchParams: Promise<{
    readonly fixture?: string;
    readonly episodeId?: string;
    readonly resumeCreation?: string;
    readonly seriesId?: string;
  }>;
}

function creationProjectionKey(projection: CreationProjection): string {
  const configuration = projection.configuration;
  return JSON.stringify({
    configuration: configuration
      ? {
          aggregateVersion: configuration.aggregateVersion,
          id: configuration.id,
          lookAvailabilityByVersionId: Object.entries(
            configuration.lookAvailabilityByVersionId,
          ).sort(([left], [right]) => left.localeCompare(right)),
          lookAvailabilityStatus: configuration.lookAvailabilityStatus,
          lookVersionId: configuration.lookVersionId,
          narratorGender: configuration.narratorGender,
          voiceAvailabilityByVersionId: Object.entries(
            configuration.voiceAvailabilityByVersionId,
          ).sort(([left], [right]) => left.localeCompare(right)),
          voiceVersionId: configuration.voiceVersionId,
        }
      : null,
    episodeVersion: projection.episode.aggregateVersion,
    workflowState: projection.episode.workflowState,
    scriptId: projection.script?.id ?? "draft",
  });
}

function canResumeCreationInLook(projection: CreationProjection): boolean {
  const configuration = projection.configuration;
  if (!projection.script || !configuration) return false;

  const pinnedVoice = findVoiceByVersionId(configuration.voiceVersionId);
  const availability =
    configuration.voiceAvailabilityByVersionId[configuration.voiceVersionId];
  return Boolean(
    pinnedVoice &&
    pinnedVoice.gender === configuration.narratorGender &&
    (availability === "pending_authenticated_canary" || availability === "verified"),
  );
}

export default async function CreationPage({
  params,
  searchParams,
}: CreationPageProps) {
  const [{ episodeId }, query] = await Promise.all([params, searchParams]);
  if (
    getServerEnvironment().environment === "test" &&
    [
      "phase2-empty",
      "phase2-ambiguous-script",
      "phase2-stale-script",
      "phase2-script",
      "phase2-divine-look",
      "phase2-advertising-look",
      "phase2-withdrawn-look",
      "phase2-unavailable-look",
      "phase2-invalid-look",
      "phase2-invalid-voice",
      "phase2-missing-voice-status",
      "phase2-refresh-withdrawn-pins",
      "phase2-stale-look",
      "phase2-withdrawn-voice",
      "phase2-canceled",
      "phase2-delivered",
      "phase2-read-only-no-script",
    ].includes(query.fixture ?? "")
  ) {
    const scriptAppearsAfterReconciliation =
      (query.fixture === "phase2-stale-script" ||
        query.fixture === "phase2-ambiguous-script") &&
      query.resumeCreation === "script";
    const fixtureStartsEmpty =
      query.fixture === "phase2-empty" ||
      query.fixture === "phase2-read-only-no-script" ||
      query.fixture === "phase2-stale-script" ||
      query.fixture === "phase2-ambiguous-script";
    const projection = deterministicCreationProjection(
      !fixtureStartsEmpty || scriptAppearsAfterReconciliation,
    );
    let fixtureProjection =
      query.fixture === "phase2-read-only-no-script"
        ? deterministicReadOnlyNoScriptCreationProjection()
        : projection;
    if (query.fixture === "phase2-canceled") {
      fixtureProjection = {
        ...fixtureProjection,
        episode: { ...fixtureProjection.episode, workflowState: "canceled" },
      };
    } else if (query.fixture === "phase2-delivered") {
      fixtureProjection = {
        ...fixtureProjection,
        episode: { ...fixtureProjection.episode, workflowState: "delivered" },
      };
    }
    if (projection.configuration) {
      if (query.fixture === "phase2-divine-look") {
        fixtureProjection = {
          ...projection,
          configuration: {
            ...projection.configuration,
            lookVersionId:
              findLook("divine-fury")?.versionId ??
              "00000000-0000-0000-0000-000000000000",
          },
        };
      } else if (query.fixture === "phase2-advertising-look") {
        fixtureProjection = {
          ...projection,
          configuration: {
            ...projection.configuration,
            lookVersionId:
              findLook("apple-clean-high-key")?.versionId ??
              "00000000-0000-0000-0000-000000000000",
          },
        };
      } else if (query.fixture === "phase2-withdrawn-look") {
        fixtureProjection = {
          ...projection,
          configuration: {
            ...projection.configuration,
            lookAvailabilityStatus: "withdrawn" as const,
          },
        };
      } else if (query.fixture === "phase2-unavailable-look") {
        fixtureProjection = {
          ...projection,
          configuration: {
            ...projection.configuration,
            lookAvailabilityByVersionId: {
              ...projection.configuration.lookAvailabilityByVersionId,
              [projection.configuration.lookVersionId]: "unavailable" as const,
            },
            lookAvailabilityStatus: "unavailable" as const,
          },
        };
      } else if (query.fixture === "phase2-invalid-look") {
        fixtureProjection = {
          ...projection,
          configuration: {
            ...projection.configuration,
            lookVersionId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
          },
        };
      } else if (query.fixture === "phase2-invalid-voice") {
        fixtureProjection = {
          ...projection,
          configuration: {
            ...projection.configuration,
            voiceVersionId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
          },
        };
      } else if (query.fixture === "phase2-missing-voice-status") {
        const {
          [projection.configuration.voiceVersionId]: _missing,
          ...remainingAvailability
        } = projection.configuration.voiceAvailabilityByVersionId;
        void _missing;
        fixtureProjection = {
          ...projection,
          configuration: {
            ...projection.configuration,
            voiceAvailabilityByVersionId: remainingAvailability,
          },
        };
      } else if (query.fixture === "phase2-withdrawn-voice") {
        fixtureProjection = {
          ...projection,
          configuration: {
            ...projection.configuration,
            voiceAvailabilityByVersionId: {
              ...projection.configuration.voiceAvailabilityByVersionId,
              [projection.configuration.voiceVersionId]: "withdrawn" as const,
            },
          },
        };
      } else if (
        query.fixture === "phase2-stale-look" &&
        query.resumeCreation === "look"
      ) {
        fixtureProjection = {
          ...projection,
          configuration: {
            ...projection.configuration,
            aggregateVersion: projection.configuration.aggregateVersion + 1,
            lookVersionId:
              findLook("hard-shadow-grey-editorial")?.versionId ??
              "00000000-0000-0000-0000-000000000000",
          },
          episode: {
            ...projection.episode,
            aggregateVersion: projection.episode.aggregateVersion + 1,
          },
        };
      } else if (
        query.fixture === "phase2-refresh-withdrawn-pins" &&
        query.resumeCreation === "look"
      ) {
        fixtureProjection = {
          ...projection,
          configuration: {
            ...projection.configuration,
            lookAvailabilityStatus: "withdrawn" as const,
            voiceAvailabilityByVersionId: {
              ...projection.configuration.voiceAvailabilityByVersionId,
              [projection.configuration.voiceVersionId]: "withdrawn" as const,
            },
          },
        };
      }
    }
    const resumeLook =
      query.resumeCreation === "look" && canResumeCreationInLook(fixtureProjection);
    return (
      <CreationStudio
        initialChamber={resumeLook ? "look" : undefined}
        key={creationProjectionKey(fixtureProjection)}
        projection={fixtureProjection}
        restoreAuthoritativeLook={resumeLook}
      />
    );
  }
  if (!hasConfiguredSupabase()) redirect("/");
  const client = await createServerSupabaseClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) redirect("/");
  const projection = await loadCreationProjection(client, user, episodeId);
  if (!projection) notFound();
  const resumeLook =
    query.resumeCreation === "look" && canResumeCreationInLook(projection);
  return (
    <CreationStudio
      initialChamber={resumeLook ? "look" : undefined}
      key={creationProjectionKey(projection)}
      projection={projection}
      restoreAuthoritativeLook={resumeLook}
    />
  );
}

import type { CreationProjection } from "@/domain/creation";
import { DEFAULT_LOOK_ID, LOOKS, findLook } from "@/domain/look/look-registry";
import { voiceForGender } from "@/domain/voice/voice-registry";

export function deterministicCreationProjection(
  withScript = false,
): CreationProjection {
  const look = findLook(DEFAULT_LOOK_ID);
  const voice = voiceForGender("male");
  if (!look) throw new Error("Default fixture look is missing.");
  return {
    configuration: withScript
      ? {
          aggregateVersion: 1,
          id: "10000000-0000-4000-8000-000000000120",
          lookAvailabilityByVersionId: Object.fromEntries(
            LOOKS.map(({ versionId }) => [versionId, "active"] as const),
          ),
          lookAvailabilityStatus: "active",
          lookConfirmation: {
            confirmedAt: null,
            confirmedBy: null,
            origin: "system_default",
          },
          lookVersionId: look.versionId,
          narratorGender: "male",
          performanceProfileId: "genie-launch-hindi-delhi-sanskrit-performance.v1",
          voiceAvailabilityByVersionId: {
            [voiceForGender("female").versionId]: "pending_authenticated_canary",
            [voice.versionId]: "pending_authenticated_canary",
          },
          voiceConfirmation: {
            confirmedAt: null,
            confirmedBy: null,
            origin: "system_default",
          },
          voiceVersionId: voice.versionId,
        }
      : null,
    episode: {
      aggregateVersion: withScript ? 2 : 1,
      episodeNumber: 1,
      id: "10000000-0000-4000-8000-000000000110",
      seriesId: "10000000-0000-4000-8000-000000000105",
      seriesTitle: "Mahadev: The First Light",
      title: "When Shiva Opened His Eyes",
      workflowState: withScript ? "world_setup" : "draft",
      workspaceId: "10000000-0000-4000-8000-000000000101",
    },
    script: withScript
      ? {
          estimatedDurationSeconds: 78,
          id: "10000000-0000-4000-8000-000000000130",
          rawText:
            "कैलाश की निस्तब्धता में, जब महादेव ने अपने नेत्र खोले, तब सृष्टि ने पहली बार प्रकाश को पहचाना।",
          rawUtf8Sha256:
            "ef8f0b238ee67685d74a1fd76e2ce34dbf2edfc25ae48995853cc9d12859b20c",
          revisionNumber: 1,
        }
      : null,
  };
}

export function deterministicReadOnlyNoScriptCreationProjection(): CreationProjection {
  const projection = deterministicCreationProjection(false);
  return {
    ...projection,
    episode: {
      ...projection.episode,
      workflowState: "ready_to_produce",
    },
  };
}

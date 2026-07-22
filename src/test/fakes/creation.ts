import type { CreationProjection } from "@/domain/creation";
import { emptyCreationReadinessProjection } from "@/domain/creation-readiness";
import { emptyCreationProductionProjection } from "@/domain/mvp-production";
import { DEFAULT_LOOK_ID, LOOKS, findLook } from "@/domain/look/look-registry";
import { voiceForGender } from "@/domain/voice/voice-registry";

export function deterministicCreationProjection(
  withScript = false,
): CreationProjection {
  const look = findLook(DEFAULT_LOOK_ID);
  const voice = voiceForGender("male");
  if (!look) throw new Error("Default fixture look is missing.");
  return {
    ...emptyCreationReadinessProjection,
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
    production: emptyCreationProductionProjection,
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

export type DeterministicCreationReadinessStage =
  "blocked" | "confirmed" | "preflight" | "ready" | "review" | "running";

export function deterministicReadyCreationProjection(
  stage: DeterministicCreationReadinessStage,
): CreationProjection {
  const base = deterministicCreationProjection(true);
  if (!base.configuration) throw new Error("Ready fixture configuration is missing.");
  const accepted = stage !== "review";
  const hasPreflight = ["blocked", "confirmed", "preflight", "running"].includes(stage);
  const quoteConfirmed = stage === "confirmed" || stage === "running";
  const actorId = "10000000-0000-4000-8000-000000000199";
  const projection: CreationProjection = {
    ...base,
    configuration: {
      ...base.configuration,
      aggregateVersion: accepted ? 6 : 4,
      lookConfirmation: {
        confirmedAt: "2026-07-19T06:00:00.000Z",
        confirmedBy: actorId,
        origin: "human_confirmed",
      },
      voiceConfirmation: {
        confirmedAt: "2026-07-19T05:59:00.000Z",
        confirmedBy: actorId,
        origin: "human_confirmed",
      },
    },
    episode: {
      ...base.episode,
      aggregateVersion: accepted ? 8 : 5,
      workflowState: stage === "running" ? "ready_to_produce" : "world_setup",
    },
    production:
      stage === "running"
        ? {
            job: null,
            master: null,
            package: null,
            repair: null,
            productionRunId: "30000000-0000-4000-8000-000000000109",
            signedMasterUrl: null,
            transcript: [],
          }
        : emptyCreationProductionProjection,
    world: {
      progress:
        stage === "review"
          ? [
              {
                createdAt: "2026-07-20T12:00:00.000Z",
                displayName: "Script analysis complete",
                id: "20000000-0000-4000-8000-000000000401",
                itemKey: "system.extraction",
                itemKind: "system",
                promptText: null,
                providerModel: null,
                providerRequestId: null,
                safeDetail: "Three visual anchors identified from the locked script",
                sortOrder: 0,
                sourceCount: 0,
                state: "identified",
                updatedAt: "2026-07-20T12:00:03.000Z",
                worldEntityId: null,
              },
              {
                createdAt: "2026-07-20T12:00:03.000Z",
                displayName: "Shiva's Pinaka bow",
                id: "20000000-0000-4000-8000-000000000402",
                itemKey: "prop.shivas-pinaka-bow.abc123def456",
                itemKind: "prop",
                promptText:
                  "Isolated sacred Pinaka bow, exact recurved silhouette and Shaiva carvings.",
                providerModel: "fal-ai/nano-banana-2",
                providerRequestId: "20000000-0000-4000-8000-000000000403",
                safeDetail: "Nano Banana is generating this anchor",
                sortOrder: 500,
                sourceCount: 0,
                state: "generating",
                updatedAt: "2026-07-20T12:00:06.000Z",
                worldEntityId: "20000000-0000-4000-8000-000000000404",
              },
            ]
          : [],
      characters: [
        {
          aggregateVersion: accepted ? 3 : 2,
          assetVersionId: "20000000-0000-4000-8000-000000000101",
          bucketId: "workspace-media",
          candidateVersionId: "20000000-0000-4000-8000-000000000102",
          entityId: "20000000-0000-4000-8000-000000000103",
          formId: "20000000-0000-4000-8000-000000000104",
          formKey: "mahayogi",
          name: "Mahadev",
          objectName:
            "10000000-0000-4000-8000-000000000101/character-anchor/20000000-0000-4000-8000-000000000105/20000000-0000-4000-8000-000000000101/source",
          promptSha256:
            "1111111111111111111111111111111111111111111111111111111111111111",
          promptText:
            "Mahadev in still meditation on moonlit Mount Kailash, compassionate eyes opening as the first dawn reaches the snow.\n\nGlowing divine realism, devotional Indian epic scale, sculpted light, sacred atmosphere, cinematic vertical composition.",
          selectedVersionId: accepted ? "20000000-0000-4000-8000-000000000102" : null,
          selectionId: "20000000-0000-4000-8000-000000000106",
          sheetState: accepted ? "verified" : null,
          state: accepted ? "accepted" : "review_required",
        },
      ],
      locations: [
        {
          aggregateVersion: 2,
          assetVersionId: "20000000-0000-4000-8000-000000000201",
          bucketId: "workspace-media",
          candidateVersionId: "20000000-0000-4000-8000-000000000202",
          entityId: "20000000-0000-4000-8000-000000000203",
          name: "Mount Kailash at first light",
          namedTemple: false,
          objectName:
            "10000000-0000-4000-8000-000000000101/location-anchor/20000000-0000-4000-8000-000000000204/20000000-0000-4000-8000-000000000201/source",
          promptSha256:
            "2222222222222222222222222222222222222222222222222222222222222222",
          promptText:
            "An immense silent Mount Kailash before sunrise, clouds moving below the peak and a thin golden horizon revealing sacred scale.\n\nGlowing divine realism, devotional Indian epic scale, sculpted light, sacred atmosphere, cinematic vertical composition.",
          selectedVersionId: "20000000-0000-4000-8000-000000000202",
          selectionId: "20000000-0000-4000-8000-000000000205",
          state: "accepted",
          templeEvidenceSetHash: null,
          worldObjectKind: "location",
        },
      ],
      referencePack: {
        id: "20000000-0000-4000-8000-000000000301",
        manifestHash:
          "3333333333333333333333333333333333333333333333333333333333333333",
        state: accepted ? "verified" : "stale",
        versionNumber: accepted ? 2 : 1,
      },
    },
    preflight: hasPreflight
      ? {
          sourceReview: {
            competencies: [
              {
                competencyVersionId: "30000000-0000-4000-8000-000000000110",
                expiresAt: "2035-07-19T08:00:00.000Z",
                scopeHash:
                  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                status: "active",
              },
            ],
            contentClasses: ["general", "deity_form", "rights"],
            findings: [
              {
                confidence: 1,
                nonOverridable: true,
                ruleCode: "GCP-ATTR-001",
                safeSummary:
                  "The appointed reviewer confirmed the selected divine form against the exact evidence set.",
                verdict: "qualified_review_required",
              },
            ],
            interpretationLabels: ["shaiva", "pan-indian"],
            language: "Hindi",
            machineVerdict: "qualified_review_required",
            packetId: "30000000-0000-4000-8000-000000000111",
            packetVersion: 1,
            region: "pan-indian",
            sources: [
              {
                boundedProposition:
                  "The exact author-supplied narration is the sole wording authority.",
                claimClass: "narrative",
                contradictionState: "none",
                rightsStatus: "internal_authorized",
                sourceClass: "regional_retelling",
                sourceVersionId: "30000000-0000-4000-8000-000000000112",
                stableUrl: null,
                title: "Author-supplied locked narration",
                verificationState: "verified",
              },
            ],
            status: "approved",
            statusVersion: 2,
            subjectHash:
              "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            tradition: "Shaiva",
            worldReferencePackVersionId: "20000000-0000-4000-8000-000000000301",
          },
          audioIdentity: {
            id: "30000000-0000-4000-8000-000000000101",
            selectionHash:
              "4444444444444444444444444444444444444444444444444444444444444444",
            state: "verified",
            voiceVersionId: base.configuration.voiceVersionId,
          },
          failure:
            stage === "blocked"
              ? {
                  attemptNo: 3,
                  code: "plan-quality-blocked",
                  failedAt: "2026-07-19T08:15:00.000Z",
                  stageKey: "plan_evaluation",
                }
              : null,
          masterClock: {
            alignmentHash:
              "5555555555555555555555555555555555555555555555555555555555555555",
            durationMs: 78_400,
            id: "30000000-0000-4000-8000-000000000102",
            state: "verified",
          },
          plan: {
            id: "30000000-0000-4000-8000-000000000103",
            planHash:
              "6666666666666666666666666666666666666666666666666666666666666666",
            projectedConfidence: 94.2,
            projectedCvp: 96.8,
            projectedOvs: 91.6,
            projectedPfs: 93.4,
            state: "qc_passed",
          },
          productionRun:
            stage === "running"
              ? {
                  authorizedHighMicrousd: 38_900_000,
                  hardCeilingMicrousd: 45_000_000,
                  id: "30000000-0000-4000-8000-000000000109",
                  manifestHash:
                    "9999999999999999999999999999999999999999999999999999999999999999",
                  runNumber: 1,
                  state: "queued",
                }
              : null,
          qc: {
            confidence: 95.1,
            consensusHash:
              "7777777777777777777777777777777777777777777777777777777777777777",
            cvp: 96.4,
            evidenceDensity: 92.7,
            gateCodes: [],
            id: "30000000-0000-4000-8000-000000000104",
            lcr: 94.9,
            ovs: 92.3,
            pfs: 94.1,
            verdict: "pass",
          },
          quote:
            stage === "blocked"
              ? null
              : {
                  confirmed: quoteConfirmed,
                  expectedTotalMicrousd: 32_600_000,
                  expired: false,
                  expiresAt: "2035-07-19T08:00:00.000Z",
                  hardCeilingMicrousd: 45_000_000,
                  highTotalMicrousd: 38_900_000,
                  id: "30000000-0000-4000-8000-000000000105",
                  lines: [
                    {
                      expectedAmountMicrousd: 18_400_000,
                      expectedQuantity: 23,
                      highAmountMicrousd: 22_400_000,
                      highQuantity: 28,
                      lineKey: "provider_clips",
                      lineKind: "provider_clip",
                      lowAmountMicrousd: 16_000_000,
                      lowQuantity: 20,
                    },
                    {
                      expectedAmountMicrousd: 2_100_000,
                      expectedQuantity: 1,
                      highAmountMicrousd: 2_100_000,
                      highQuantity: 1,
                      lineKey: "narration_master_reuse",
                      lineKind: "narration_master_reuse",
                      lowAmountMicrousd: 2_100_000,
                      lowQuantity: 1,
                    },
                    {
                      expectedAmountMicrousd: 3_200_000,
                      expectedQuantity: 1,
                      highAmountMicrousd: 3_200_000,
                      highQuantity: 1,
                      lineKey: "score_music",
                      lineKind: "score_music",
                      lowAmountMicrousd: 3_200_000,
                      lowQuantity: 1,
                    },
                    {
                      expectedAmountMicrousd: 4_100_000,
                      expectedQuantity: 1,
                      highAmountMicrousd: 4_100_000,
                      highQuantity: 1,
                      lineKey: "qc_judges",
                      lineKind: "qc_judges",
                      lowAmountMicrousd: 3_500_000,
                      lowQuantity: 1,
                    },
                    {
                      expectedAmountMicrousd: 4_800_000,
                      expectedQuantity: 1,
                      highAmountMicrousd: 7_100_000,
                      highQuantity: 1,
                      lineKey: "repair_allowance",
                      lineKind: "repair_allowance",
                      lowAmountMicrousd: 3_000_000,
                      lowQuantity: 1,
                    },
                  ],
                  lowTotalMicrousd: 27_800_000,
                  quoteHash:
                    "8888888888888888888888888888888888888888888888888888888888888888",
                  target40UsdBreached: false,
                },
        }
      : emptyCreationReadinessProjection.preflight,
  };
  return projection;
}

import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildCinematicTimeline } from "./preflight-plan-timeline";

const mocks = vi.hoisted(() => ({
  agent: vi.fn(),
  ensureCapabilities: vi.fn(),
  rpc: vi.fn(),
  summary: vi.fn(),
}));

vi.mock("@/server/ledgered-openai-agent", () => ({
  runLedgeredOpenAiStructuredAgent: mocks.agent,
}));
vi.mock("@/server/production-video-capabilities", () => ({
  ensureProductionVideoCapabilities: mocks.ensureCapabilities,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({
    from: () => {
      const query = {
        eq: () => query,
        select: () => query,
        single: mocks.summary,
      };
      return query;
    },
    rpc: mocks.rpc,
  }),
}));

import { executePlanPreflight } from "./preflight-plan-agent";

const id = (suffix: string) => `10000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const hash = (character: string) => character.repeat(64);

function fixture() {
  const words = Array.from({ length: 120 }, (_, index) => `शब्द${index + 1}`);
  const processingText = words.join(" ");
  const tokens = [...processingText.matchAll(/\s+|\S+/gu)];
  let scalar = 0;
  const alignmentSegments = tokens.map((match, index) => {
    const exactText = match[0];
    const startScalar = scalar;
    scalar += Array.from(exactText).length;
    return {
      endMs:
        index === tokens.length - 1
          ? 60_000
          : Math.round(((index + 1) * 60_000) / tokens.length),
      endScalar: scalar,
      exactText,
      kind: /^\s+$/u.test(exactText) ? "authored_pause" : "spoken",
      segmentNumber: index + 1,
      startMs: Math.round((index * 60_000) / tokens.length),
      startScalar,
    } as const;
  });
  const timeline = buildCinematicTimeline({
    durationMs: 60_000,
    processingText,
    segments: alignmentSegments,
  });
  const capabilities = [
    {
      capabilityVersionId: id("41"),
      durationMaxMs: 10_000,
      durationMinMs: 5_000,
      durationQuantumMs: 5_000,
      endpointKey: "kling-video-v2.5-turbo-pro-image-to-video",
      expiresAt: "2099-01-01T00:00:00.000Z",
      maximumHeight: 1920,
      maximumReferenceCount: 1,
      maximumWidth: 1080,
      modelKey: "fal-ai/kling-video/v2.5-turbo/pro/image-to-video",
      modelVersion: "qualified",
      motionClass: "simple_camera_subject",
      profileKey: "kling-2.5-simple-camera-subject",
      providerFamily: "fal",
      schemaHash: hash("1"),
    },
    {
      capabilityVersionId: id("42"),
      durationMaxMs: 15_000,
      durationMinMs: 3_000,
      durationQuantumMs: 1_000,
      endpointKey: "kling-video-v3-pro-image-to-video",
      expiresAt: "2099-01-01T00:00:00.000Z",
      maximumHeight: 1920,
      maximumReferenceCount: 1,
      maximumWidth: 1080,
      modelKey: "fal-ai/kling-video/v3/pro/image-to-video",
      modelVersion: "qualified",
      motionClass: "camera_led",
      profileKey: "kling-3-camera-led",
      providerFamily: "fal",
      schemaHash: hash("2"),
    },
    {
      capabilityVersionId: id("43"),
      durationMaxMs: 15_000,
      durationMinMs: 4_000,
      durationQuantumMs: 1_000,
      endpointKey: "seedance-2.0-reference-to-video",
      expiresAt: "2099-01-01T00:00:00.000Z",
      maximumHeight: 1280,
      maximumReferenceCount: 9,
      maximumWidth: 720,
      modelKey: "bytedance/seedance-2.0/reference-to-video",
      modelVersion: "qualified",
      motionClass: "complex_general",
      profileKey: "seedance-2-complex-general",
      providerFamily: "seedance",
      schemaHash: hash("3"),
    },
  ] as const;
  const input = {
    alignmentSegments,
    audio: {
      audioIdentitySelectionId: id("30"),
      scoreIdentityVersionId: id("31"),
      soundIdentityVersionId: id("32"),
    },
    capabilities,
    configurationCandidateId: id("4"),
    episodeId: id("3"),
    existingPlan: null,
    inputManifestHash: hash("a"),
    masterClock: {
      alignmentHash: hash("4"),
      audioEvidenceHash: hash("5"),
      durationMs: 60_000,
      masterClockVersionId: id("5"),
      performanceProfileHash: hash("6"),
    },
    preflightRunId: id("6"),
    processingScalarCount: Array.from(processingText).length,
    processingText,
    processingTextSha256: hash("7"),
    rubric: {
      parameters: [
        "first_frame_hook",
        "visual_story_clarity",
        "vertical_composition",
        "emotional_readability",
        "reveal_execution",
        "blocking_power_geometry",
        "visual_escalation",
        "cliffhanger_image",
        "edit_rhythm",
        "shot_economy",
        "performance_capture",
        "sound_music",
        "subtitle_ui_safety",
        "production_feasibility",
        "localization_compliance",
      ].map((parameterId) => ({ baseWeight: 1, parameterId })),
      rubricHash: hash("8"),
      rubricKey: "mythological-devotional-plan",
      rubricVersion: "1.0.0",
    },
    scriptRevisionId: id("2"),
    sourceReview: {
      evidenceSetHash: hash("9"),
      policyHash: hash("b"),
      policyManifest: { rules: ["devotional dignity"] },
      policyVersionId: id("7"),
      sourceReviewPacketId: id("8"),
      sourceSetHash: hash("c"),
      sources: [{ boundedProposition: "Source-bound story context." }],
      subjectHash: hash("d"),
    },
    stageAttemptId: id("9"),
    workspaceId: id("1"),
    world: {
      characters: [
        {
          anchorAssetVersionId: id("11"),
          anchorContentSha256: hash("e"),
          characterFormId: id("12"),
          characterVersionId: id("13"),
          identityManifest: {
            identity: {
              canonicalName: "Devi",
              characterKey: "devi",
              formName: "Devi",
            },
          },
          identityManifestHash: hash("f"),
          sheetAssetVersionId: id("14"),
          sheetContentSha256: hash("0"),
        },
      ],
      locations: [
        {
          anchorAssetVersionId: id("21"),
          anchorContentSha256: hash("1"),
          locationId: id("22"),
          locationManifest: { canonicalName: "पर्वत" },
          locationManifestHash: hash("2"),
          locationVersionId: id("23"),
          researchReferences: [
            {
              assetVersionId: id("31"),
              authorCredit: "Photographer One",
              canonicalTitle: "Festival reference one",
              contentHash: hash("4"),
              licenseShortName: "CC BY-SA 4.0",
              sourcePageUrl:
                "https://commons.wikimedia.org/wiki/File:Festival_reference_one.jpg",
            },
            {
              assetVersionId: id("32"),
              authorCredit: "Photographer Two",
              canonicalTitle: "Festival reference two",
              contentHash: hash("5"),
              licenseShortName: "CC BY 4.0",
              sourcePageUrl:
                "https://commons.wikimedia.org/wiki/File:Festival_reference_two.jpg",
            },
          ],
          templeEvidenceSetHash: hash("f"),
        },
      ],
      manifest: { schemaVersion: "world" },
      manifestHash: hash("3"),
      qcEvidenceHash: hash("4"),
      worldReferencePackVersionId: id("24"),
    },
  };
  const director = {
    beats: timeline.beats.map(({ beatNumber }) => ({
      beatNumber,
      beatType: beatNumber === 1 ? "hook" : "escalation",
      emotionalTurn: "The emotional pressure changes visibly.",
      revealLevel: beatNumber === 2 ? "minor" : "none",
    })),
    schemaVersion: "genie.cinematic-plan-director.v1",
    shots: timeline.shots.map(({ beatNumber, shotNumber }) => ({
      cameraMotion: "A controlled motivated move.",
      characterIdentityKeys: ["devi"],
      characterVersionIds: [id("13")],
      emotionalRead: "Readable restraint and resolve.",
      framing:
        "Devi holds a layered vertical composition with subtitle-safe negative space.",
      lighting: "Motivated warm key and cool separation.",
      locationVersionId: id("23"),
      motionClass: ["simple_camera_subject", "camera_led", "complex_general"][
        shotNumber % 3
      ],
      narrativeFunction: "Advance cause, reaction, and consequence.",
      realWorldReferenceAssetVersionId: shotNumber % 2 === 1 ? id("31") : id("32"),
      revealContributions: beatNumber === 2 ? ["proof", "reaction"] : [],
      scoreCue: "A restrained motif gains one layer.",
      sfxCue: "A restrained cloth movement with a short natural decay.",
      sfxDurationMs: Math.min(
        1_000,
        timeline.shots[shotNumber - 1]!.endMs - timeline.shots[shotNumber - 1]!.startMs,
      ),
      sfxGainDb: -20,
      sfxStartOffsetMs: 0,
      shotNumber,
      subjectAction: "Devi reacts with controlled physical detail.",
      transition: "hard_cut",
      visualIntent: "Devi makes the story legible without sound.",
    })),
    story: {
      devotionalIntent: "Awe with emotional intimacy.",
      finalImage: "A precise charged devotional tableau.",
      logline: "A source-bound devotional turning point.",
      tensionArc: "Question, escalation, proof, reaction, consequence.",
      viewerPromise: "A cinematic revelation grounded in devotion.",
    },
  };
  const evaluator = {
    findings: [],
    schemaVersion: "genie.plan-evaluator-output.v1",
    scores: input.rubric.parameters.map(({ parameterId }) => ({
      applicabilityReason: `Concrete plan evidence supports ${parameterId}.`,
      parameterId,
      score: 8,
    })),
  };
  return { director, evaluator, input, timeline };
}

function semanticBoundaries(data: ReturnType<typeof fixture>) {
  const startByScalar = new Map(
    data.input.alignmentSegments.map((segment) => [
      segment.startScalar,
      segment.segmentNumber,
    ]),
  );
  const endByScalar = new Map(
    data.input.alignmentSegments.map((segment) => [
      segment.endScalar,
      segment.segmentNumber,
    ]),
  );
  return {
    schemaVersion: "genie.semantic-shot-boundaries.v1",
    shots: data.timeline.shots.map((shot) => ({
      endSegmentNumber: endByScalar.get(shot.endScalar)!,
      sceneNumber: shot.beatNumber,
      shotNumber: shot.shotNumber,
      startSegmentNumber: startByScalar.get(shot.startScalar)!,
    })),
  };
}

type PersistedPlanParameters = Readonly<{
  p_component_ids: Readonly<Record<string, string>>;
  p_graph_hash: string;
  p_plan: Readonly<Record<string, unknown>>;
  p_plan_bundle_id: string;
  p_plan_hash: string;
}>;

function blockingEvaluator(data: ReturnType<typeof fixture>, suffix = "") {
  return {
    ...data.evaluator,
    findings: [
      {
        code: "PLAN_VISUAL_STORY_CLARITY",
        evidenceComponent: "shot",
        reason: `Cause, reaction, and consequence are not yet visually explicit${suffix}.`,
        severity: "blocker",
      },
    ],
    scores: data.evaluator.scores.map((score) => ({ ...score, score: 5 })),
  };
}

function repairedDirector(data: ReturnType<typeof fixture>, iteration: 2 | 3) {
  return {
    ...data.director,
    story: {
      ...data.director.story,
      finalImage: `A repaired proof-reaction-consequence tableau, iteration ${iteration}.`,
    },
  };
}

function repairFeedback(
  data: ReturnType<typeof fixture>,
  plan: PersistedPlanParameters,
  priorIteration: 1 | 2,
  consensusId: string,
) {
  const blocked = blockingEvaluator(data);
  return {
    confidence: 70,
    consensusId,
    cvp: 62,
    evaluators: ["monica.plan.sol.v1", "monica.plan.terra.v1"].map(
      (evaluatorKey, index) => ({
        evaluatorKey,
        findings: blocked.findings.map((finding) => ({
          code: finding.code,
          evidenceVersionId: plan.p_component_ids.shot,
          reason: finding.reason,
          severity: finding.severity,
        })),
        modelVersion: index === 0 ? "openai.gpt-5.6-sol" : "openai.gpt-5.6-terra",
        parameters: blocked.scores.map(
          ({ applicabilityReason, parameterId, score }) => ({
            applicabilityReason,
            parameterId,
            score,
          }),
        ),
        score: 50,
        verdict: "block",
      }),
    ),
    evidenceDensity: 100,
    gateCodes: ["PLAN_VISUAL_STORY_CLARITY"],
    nextIteration: priorIteration + 1,
    ovs: 60,
    pfs: 64,
    priorIteration,
    priorPlanBundleId: plan.p_plan_bundle_id,
    priorPlanHash: plan.p_plan_hash,
    repairAvailable: true,
    verdict: "block",
  };
}

const blockedSummary = {
  data: {
    confidence: 70,
    cvp: 62,
    evidence_density: 100,
    gate_codes: ["PLAN_VISUAL_STORY_CLARITY"],
    ovs: 60,
    pfs: 64,
    verdict: "block",
  },
  error: null,
};

const passingSummary = {
  data: {
    confidence: 90,
    cvp: 80,
    evidence_density: 100,
    gate_codes: [],
    ovs: 82,
    pfs: 81,
    verdict: "pass",
  },
  error: null,
};

describe("executable cinematic plan agent", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    const data = fixture();
    mocks.ensureCapabilities.mockResolvedValue({
      camera_led: {
        capabilityVersionId: id("42"),
        profileKey: "kling-3-camera-led",
      },
      complex_general: {
        capabilityVersionId: id("43"),
        profileKey: "seedance-2-complex-general",
      },
      simple_camera_subject: {
        capabilityVersionId: id("41"),
        profileKey: "kling-2.5-simple-camera-subject",
      },
    });
    let evaluatorRecord = 0;
    let scoreSet = 0;
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "get_plan_preflight_input") return { data: data.input, error: null };
      if (name === "command_record_evaluator_record") {
        evaluatorRecord += 1;
        return { data: id(String(60 + evaluatorRecord)), error: null };
      }
      if (name === "command_record_plan_evaluator_score_set") {
        scoreSet += 1;
        return { data: id(String(70 + scoreSet)), error: null };
      }
      if (name === "command_create_preflight_plan_consensus") {
        return { data: id("80"), error: null };
      }
      return { data: id("50"), error: null };
    });
    mocks.agent
      .mockResolvedValueOnce({
        output: semanticBoundaries(data),
        requestHash: hash("4"),
        responseId: "resp_boundaries",
        responseRequestId: "request_boundaries",
      })
      .mockResolvedValueOnce({
        output: data.director,
        requestHash: hash("5"),
        responseId: "resp_director",
        responseRequestId: "request_director",
      })
      .mockResolvedValueOnce({
        output: data.evaluator,
        requestHash: hash("6"),
        responseId: "resp_sol",
        responseRequestId: "request_sol",
      })
      .mockResolvedValueOnce({
        output: data.evaluator,
        requestHash: hash("7"),
        responseId: "resp_terra",
        responseRequestId: "request_terra",
      });
    mocks.summary.mockResolvedValue({
      data: {
        confidence: 90,
        cvp: 80,
        evidence_density: 100,
        gate_codes: [],
        ovs: 82,
        pfs: 81,
        verdict: "pass",
      },
      error: null,
    });
  });

  it("pins exact narration coverage, provider quanta, references, and blind evaluators", async () => {
    const data = fixture();
    const result = await executePlanPreflight({
      authorityEpoch: 1,
      capabilityGrantId: null,
      fencingToken: 1,
      inputManifestId: id("90"),
      inputManifestSha256: hash("a"),
      preflightRunId: id("6"),
      schemaVersion: "genie.preflight-task.v1",
      stageAttemptId: id("9"),
      stageRunId: id("91"),
      workspaceId: id("1"),
    });
    expect(result).toMatchObject({
      consensusId: id("80"),
      replayed: false,
      schemaVersion: "genie.plan-preflight-output.v1",
    });
    const planCall = mocks.rpc.mock.calls.find(
      ([name]) => name === "command_record_preflight_plan",
    );
    const plan = planCall?.[1].p_plan;
    expect(
      plan.beats.map(({ exactText }: { exactText: string }) => exactText).join(""),
    ).toBe(data.input.processingText);
    expect(plan.shots[0].startMs).toBe(0);
    expect(plan.shots.at(-1).endMs).toBe(60_000);
    expect(
      plan.edd.shots.every(({ promptBlueprint }: { promptBlueprint: string }) =>
        promptBlueprint.includes(
          "do not assume or mention any prior or following image",
        ),
      ),
    ).toBe(true);
    expect(
      plan.edd.shots
        .slice(0, 4)
        .map(
          ({
            realWorldReferenceAssetVersionId,
          }: {
            realWorldReferenceAssetVersionId: string;
          }) => realWorldReferenceAssetVersionId,
        ),
    ).toEqual([id("31"), id("32"), id("31"), id("32")]);
    expect(
      plan.requestSlots.every(
        (slot: { durationMs: number; retainedDurationMs: number }) =>
          slot.durationMs >= slot.retainedDurationMs,
      ),
    ).toBe(true);
    expect(
      new Set(plan.requestSlots.map(({ slotKind }: { slotKind: string }) => slotKind)),
    ).toEqual(new Set(["alternate", "candidate", "primary", "retry"]));
    expect(
      plan.shots.every(
        ({ shotNumber }: { shotNumber: number }) =>
          plan.requestSlots.filter(
            (slot: { shotNumber: number; slotKind: string }) =>
              slot.shotNumber === shotNumber && slot.slotKind === "primary",
          ).length === 1,
      ),
    ).toBe(true);
    expect(
      plan.references.some(
        ({ referenceKind }: { referenceKind: string }) =>
          referenceKind === "continuity",
      ),
    ).toBe(true);
    expect(
      plan.references.filter(
        ({ referenceKind }: { referenceKind: string }) =>
          referenceKind === "real_world",
      ),
    ).toHaveLength(plan.shots.length);
    const challengeCall = mocks.rpc.mock.calls.find(
      ([name]) => name === "command_issue_plan_evaluator_challenges",
    );
    expect(
      new Set(
        challengeCall?.[1].p_challenges.map(
          ({ deploymentFamily }: { deploymentFamily: string }) => deploymentFamily,
        ),
      ).size,
    ).toBe(2);
    expect(mocks.agent).toHaveBeenCalledTimes(4);
    expect(JSON.stringify(mocks.agent.mock.calls[0]![1].schema)).not.toContain(
      "uniqueItems",
    );
    expect(mocks.agent.mock.calls[1]![1].reasoningEffort).toBe("medium");
    expect(mocks.agent.mock.calls[1]![1]).toMatchObject({
      maxOutputTokens: 16_000,
      model: "gpt-5.6-terra",
    });
    expect(mocks.agent.mock.calls[1]![1].instructions).toContain(
      "Never invent an anonymous devotee",
    );
    expect(mocks.agent.mock.calls[1]![1].instructions).toContain(
      "Never translate death into kneeling",
    );
    const directorInput = JSON.parse(mocks.agent.mock.calls[1]![1].input as string);
    expect(directorInput.world.characters[0].identityBinding).toEqual({
      canonicalName: "Devi",
      characterKey: "devi",
      formName: "Devi",
    });
    expect(mocks.agent.mock.calls[1]![1].schema).toMatchObject({
      properties: {
        shots: {
          items: {
            properties: {
              characterIdentityKeys: {
                items: { enum: ["devi"] },
              },
              revealContributions: {
                items: {
                  enum: ["proof", "reaction", "consequence"],
                },
              },
              visualIntent: {
                maxLength: 720,
              },
            },
          },
        },
      },
    });
    const boundaryInput = JSON.parse(mocks.agent.mock.calls[0]![1].input as string);
    expect(boundaryInput.planningGuidance).toMatchObject({
      minimumShotCountGuidance: 20,
      rule: expect.stringContaining("never a required count"),
    });
    const evaluatorInput = JSON.parse(mocks.agent.mock.calls[2]![1].input as string);
    expect(evaluatorInput.sourceEvidence.sources[0]).toMatchObject({
      boundedProposition: "Source-bound story context.",
      propositionTruncated: false,
    });
    expect((mocks.agent.mock.calls[2]![1].input as string).length).toBeLessThan(
      100_000,
    );
    expect(evaluatorInput.plan.requestSlots[0]).not.toHaveProperty(
      "capabilityVersionId",
    );
    expect(evaluatorInput.plan.references[0]).not.toHaveProperty("contentHash");
    expect(evaluatorInput.plan.edd.shots[0]).toMatchObject({
      action: expect.any(String),
      cameraAngleAndDistance: expect.any(String),
      cameraMotion: expect.any(String),
      cutType: expect.any(String),
      lighting: expect.any(String),
      mood: expect.any(String),
      narrativeFunction: expect.any(String),
      sceneComposition: expect.any(String),
      storyboardCompositionMode: expect.any(String),
    });
    expect(evaluatorInput.plan.edd.shots[0]).not.toHaveProperty("promptBlueprint");
    expect(evaluatorInput.plan.edd.shots[0]).not.toHaveProperty(
      "storyboardPromptBlueprint",
    );
    const revealShotNumbers = data.timeline.shots
      .filter(({ beatNumber }) => beatNumber === 2)
      .map(({ shotNumber }) => shotNumber);
    expect(
      plan.shots
        .filter(({ shotNumber }: { shotNumber: number }) =>
          revealShotNumbers.includes(shotNumber),
        )
        .every(
          ({
            suppliesProof,
            suppliesReaction,
          }: {
            suppliesProof: boolean;
            suppliesReaction: boolean;
          }) => suppliesProof && suppliesReaction,
        ),
    ).toBe(true);
  });

  it("rejects a World ID reused for an invented devotee", async () => {
    const data = fixture();
    mocks.agent
      .mockReset()
      .mockResolvedValueOnce({
        output: semanticBoundaries(data),
        requestHash: hash("4"),
        responseId: "resp_boundaries",
        responseRequestId: "request_boundaries",
      })
      .mockResolvedValueOnce({
        output: {
          ...data.director,
          shots: data.director.shots.map((shot, index) =>
            index === 0
              ? {
                  ...shot,
                  framing: "Devi watches an anonymous adult devotee in close-up.",
                  subjectAction: "The devotee folds both hands in prayer.",
                  visualIntent:
                    "An unnamed worshipper stands alone in the devotional frame.",
                }
              : shot,
          ),
        },
        requestHash: hash("5"),
        responseId: "resp_director",
        responseRequestId: "request_director",
      });

    await expect(
      executePlanPreflight({
        authorityEpoch: 1,
        capabilityGrantId: null,
        fencingToken: 1,
        inputManifestId: id("90"),
        inputManifestSha256: hash("a"),
        preflightRunId: id("6"),
        schemaVersion: "genie.preflight-task.v1",
        stageAttemptId: id("9"),
        stageRunId: id("91"),
        workspaceId: id("1"),
      }),
    ).rejects.toMatchObject({
      code: "PLAN_CHARACTER_BINDING_INVALID",
      message: "Director shot depicts a person who is not present in the locked World.",
      retryable: true,
    });
    expect(
      mocks.rpc.mock.calls.some(([name]) => name === "command_record_preflight_plan"),
    ).toBe(false);
  });

  it("rejects a character key that does not match its immutable World ID", async () => {
    const data = fixture();
    mocks.agent
      .mockReset()
      .mockResolvedValueOnce({
        output: semanticBoundaries(data),
        requestHash: hash("4"),
        responseId: "resp_boundaries",
        responseRequestId: "request_boundaries",
      })
      .mockResolvedValueOnce({
        output: {
          ...data.director,
          shots: data.director.shots.map((shot, index) =>
            index === 0
              ? {
                  ...shot,
                  characterIdentityKeys: ["someone-else"],
                }
              : shot,
          ),
        },
        requestHash: hash("5"),
        responseId: "resp_director",
        responseRequestId: "request_director",
      });

    await expect(
      executePlanPreflight({
        authorityEpoch: 1,
        capabilityGrantId: null,
        fencingToken: 1,
        inputManifestId: id("90"),
        inputManifestSha256: hash("a"),
        preflightRunId: id("6"),
        schemaVersion: "genie.preflight-task.v1",
        stageAttemptId: id("9"),
        stageRunId: id("91"),
        workspaceId: id("1"),
      }),
    ).rejects.toMatchObject({
      code: "PLAN_CHARACTER_BINDING_INVALID",
      message: "Director shot identity keys do not match its immutable World IDs.",
      retryable: true,
    });
  });

  it("does not treat an editorial audience reference as a visible unanchored person", async () => {
    const data = fixture();
    mocks.agent
      .mockReset()
      .mockResolvedValueOnce({
        output: semanticBoundaries(data),
        requestHash: hash("4"),
        responseId: "resp_boundaries",
        responseRequestId: "request_boundaries",
      })
      .mockResolvedValueOnce({
        output: {
          ...data.director,
          shots: data.director.shots.map((shot, index) =>
            index === 0
              ? {
                  ...shot,
                  emotionalRead: "The audience should feel immediate wonder.",
                  narrativeFunction:
                    "Orient the audience to the source-bound visual question.",
                }
              : shot,
          ),
        },
        requestHash: hash("5"),
        responseId: "resp_director",
        responseRequestId: "request_director",
      })
      .mockResolvedValueOnce({
        output: data.evaluator,
        requestHash: hash("6"),
        responseId: "resp_sol",
        responseRequestId: "request_sol",
      })
      .mockResolvedValueOnce({
        output: data.evaluator,
        requestHash: hash("7"),
        responseId: "resp_terra",
        responseRequestId: "request_terra",
      });

    await expect(
      executePlanPreflight({
        authorityEpoch: 1,
        capabilityGrantId: null,
        fencingToken: 1,
        inputManifestId: id("90"),
        inputManifestSha256: hash("a"),
        preflightRunId: id("6"),
        schemaVersion: "genie.preflight-task.v1",
        stageAttemptId: id("9"),
        stageRunId: id("91"),
        workspaceId: id("1"),
      }),
    ).resolves.toMatchObject({
      schemaVersion: "genie.plan-preflight-output.v1",
    });
  });

  it("retries an incomplete storyboard sentence instead of persisting it", async () => {
    const data = fixture();
    mocks.agent
      .mockReset()
      .mockResolvedValueOnce({
        output: semanticBoundaries(data),
        requestHash: hash("4"),
        responseId: "resp_boundaries",
        responseRequestId: "request_boundaries",
      })
      .mockResolvedValueOnce({
        output: {
          ...data.director,
          shots: data.director.shots.map((shot, index) =>
            index === 0
              ? {
                  ...shot,
                  visualIntent: "Devi remains centered while the reveal",
                }
              : shot,
          ),
        },
        requestHash: hash("5"),
        responseId: "resp_director",
        responseRequestId: "request_director",
      });

    await expect(
      executePlanPreflight({
        authorityEpoch: 1,
        capabilityGrantId: null,
        fencingToken: 1,
        inputManifestId: id("90"),
        inputManifestSha256: hash("a"),
        preflightRunId: id("6"),
        schemaVersion: "genie.preflight-task.v1",
        stageAttemptId: id("9"),
        stageRunId: id("91"),
        workspaceId: id("1"),
      }),
    ).rejects.toMatchObject({
      code: "PLAN_VISUAL_INTENT_INCOMPLETE",
      retryable: true,
    });
  });

  it("retries an exact repeated-object count that generative media cannot guarantee", async () => {
    const data = fixture();
    mocks.agent
      .mockReset()
      .mockResolvedValueOnce({
        output: semanticBoundaries(data),
        requestHash: hash("4"),
        responseId: "resp_boundaries",
        responseRequestId: "request_boundaries",
      })
      .mockResolvedValueOnce({
        output: {
          ...data.director,
          shots: data.director.shots.map((shot, index) =>
            index === 0
              ? {
                  ...shot,
                  visualIntent:
                    "Exactly eleven countable pearl markers fill the upper frame.",
                }
              : shot,
          ),
        },
        requestHash: hash("5"),
        responseId: "resp_director",
        responseRequestId: "request_director",
      });

    await expect(
      executePlanPreflight({
        authorityEpoch: 1,
        capabilityGrantId: null,
        fencingToken: 1,
        inputManifestId: id("90"),
        inputManifestSha256: hash("a"),
        preflightRunId: id("6"),
        schemaVersion: "genie.preflight-task.v1",
        stageAttemptId: id("9"),
        stageRunId: id("91"),
        workspaceId: id("1"),
      }),
    ).rejects.toMatchObject({
      code: "PLAN_GENERATIVE_COUNT_INVALID",
      retryable: true,
    });
  });

  it("retries incomplete beat-level reveal coverage", async () => {
    const data = fixture();
    mocks.agent
      .mockReset()
      .mockResolvedValueOnce({
        output: semanticBoundaries(data),
        requestHash: hash("4"),
        responseId: "resp_boundaries",
        responseRequestId: "request_boundaries",
      })
      .mockResolvedValueOnce({
        output: {
          ...data.director,
          shots: data.director.shots.map((shot) =>
            shot.revealContributions.includes("reaction")
              ? {
                  ...shot,
                  revealContributions: ["proof"],
                }
              : shot,
          ),
        },
        requestHash: hash("5"),
        responseId: "resp_director",
        responseRequestId: "request_director",
      });

    await expect(
      executePlanPreflight({
        authorityEpoch: 1,
        capabilityGrantId: null,
        fencingToken: 1,
        inputManifestId: id("90"),
        inputManifestSha256: hash("a"),
        preflightRunId: id("6"),
        schemaVersion: "genie.preflight-task.v1",
        stageAttemptId: id("9"),
        stageRunId: id("91"),
        workspaceId: id("1"),
      }),
    ).rejects.toMatchObject({
      code: "PLAN_REVEAL_COVERAGE_INVALID",
      message: "Director reveal coverage is incomplete for beat 2.",
      retryable: true,
    });
  });

  it("retries the exact materialized plan after an absent timeout receipt", async () => {
    const defaultRpc = mocks.rpc.getMockImplementation()!;
    let persistenceAttempts = 0;
    mocks.rpc.mockImplementation(async (name: string, parameters) => {
      if (name === "command_record_preflight_plan") {
        persistenceAttempts += 1;
        if (persistenceAttempts === 1) {
          return {
            data: null,
            error: { message: "upstream request timeout" },
          };
        }
      }
      if (name === "get_plan_preflight_resume") {
        return { data: null, error: null };
      }
      return defaultRpc(name, parameters);
    });

    await executePlanPreflight({
      authorityEpoch: 1,
      capabilityGrantId: null,
      fencingToken: 1,
      inputManifestId: id("90"),
      inputManifestSha256: hash("a"),
      preflightRunId: id("6"),
      schemaVersion: "genie.preflight-task.v1",
      stageAttemptId: id("9"),
      stageRunId: id("91"),
      workspaceId: id("1"),
    });

    expect(persistenceAttempts).toBe(2);
  });

  it("does not replay a plan when receipt authority cannot be reconciled", async () => {
    const defaultRpc = mocks.rpc.getMockImplementation()!;
    let persistenceAttempts = 0;
    mocks.rpc.mockImplementation(async (name: string, parameters) => {
      if (name === "command_record_preflight_plan") {
        persistenceAttempts += 1;
        return {
          data: null,
          error: { message: "upstream request timeout" },
        };
      }
      if (name === "get_plan_preflight_resume") {
        return {
          data: null,
          error: { message: "plan resume authority is stale" },
        };
      }
      return defaultRpc(name, parameters);
    });

    await expect(
      executePlanPreflight({
        authorityEpoch: 1,
        capabilityGrantId: null,
        fencingToken: 1,
        inputManifestId: id("90"),
        inputManifestSha256: hash("a"),
        preflightRunId: id("6"),
        schemaVersion: "genie.preflight-task.v1",
        stageAttemptId: id("9"),
        stageRunId: id("91"),
        workspaceId: id("1"),
      }),
    ).rejects.toMatchObject({
      code: "PLAN_LEDGER_RECONCILIATION_FAILED",
    });
    expect(persistenceAttempts).toBe(1);
  });

  it("reconciles an exact committed plan after an ambiguous timeout", async () => {
    const defaultRpc = mocks.rpc.getMockImplementation()!;
    let persisted: PersistedPlanParameters | null = null;
    let persistenceAttempts = 0;
    mocks.rpc.mockImplementation(async (name: string, parameters) => {
      if (name === "command_record_preflight_plan") {
        persistenceAttempts += 1;
        persisted = parameters as PersistedPlanParameters;
        return {
          data: null,
          error: { message: "upstream request timeout" },
        };
      }
      if (name === "get_plan_preflight_resume" && persisted) {
        return {
          data: {
            challenges: [],
            componentIds: persisted.p_component_ids,
            consensus: null,
            graphHash: persisted.p_graph_hash,
            plan: persisted.p_plan,
            planBundleId: persisted.p_plan_bundle_id,
            planHash: persisted.p_plan_hash,
            state: "candidate",
          },
          error: null,
        };
      }
      return defaultRpc(name, parameters);
    });

    await executePlanPreflight({
      authorityEpoch: 1,
      capabilityGrantId: null,
      fencingToken: 1,
      inputManifestId: id("90"),
      inputManifestSha256: hash("a"),
      preflightRunId: id("6"),
      schemaVersion: "genie.preflight-task.v1",
      stageAttemptId: id("9"),
      stageRunId: id("91"),
      workspaceId: id("1"),
    });

    expect(persistenceAttempts).toBe(1);
  });

  it("rejects a timeout receipt with different component identities", async () => {
    const defaultRpc = mocks.rpc.getMockImplementation()!;
    let persisted: PersistedPlanParameters | null = null;
    mocks.rpc.mockImplementation(async (name: string, parameters) => {
      if (name === "command_record_preflight_plan") {
        persisted = parameters as PersistedPlanParameters;
        return {
          data: null,
          error: { message: "upstream request timeout" },
        };
      }
      if (name === "get_plan_preflight_resume" && persisted) {
        return {
          data: {
            challenges: [],
            componentIds: {
              ...persisted.p_component_ids,
              edd: id("999"),
            },
            consensus: null,
            graphHash: persisted.p_graph_hash,
            plan: persisted.p_plan,
            planBundleId: persisted.p_plan_bundle_id,
            planHash: persisted.p_plan_hash,
            state: "candidate",
          },
          error: null,
        };
      }
      return defaultRpc(name, parameters);
    });

    await expect(
      executePlanPreflight({
        authorityEpoch: 1,
        capabilityGrantId: null,
        fencingToken: 1,
        inputManifestId: id("90"),
        inputManifestSha256: hash("a"),
        preflightRunId: id("6"),
        schemaVersion: "genie.preflight-task.v1",
        stageAttemptId: id("9"),
        stageRunId: id("91"),
        workspaceId: id("1"),
      }),
    ).rejects.toMatchObject({ code: "PLAN_LEDGER_CONFLICT" });
  });

  it("rotates researched photographs before repeating an available alternative", async () => {
    const data = fixture();
    mocks.agent
      .mockReset()
      .mockResolvedValueOnce({
        output: semanticBoundaries(data),
        requestHash: hash("4"),
        responseId: "resp_boundaries",
        responseRequestId: "request_boundaries",
      })
      .mockResolvedValueOnce({
        output: {
          ...data.director,
          shots: data.director.shots.map((shot, index) => ({
            ...shot,
            realWorldReferenceAssetVersionId: index < 2 ? id("31") : id("32"),
          })),
        },
        requestHash: hash("5"),
        responseId: "resp_director",
        responseRequestId: "request_director",
      })
      .mockResolvedValueOnce({
        output: data.evaluator,
        requestHash: hash("6"),
        responseId: "resp_sol",
        responseRequestId: "request_sol",
      })
      .mockResolvedValueOnce({
        output: data.evaluator,
        requestHash: hash("7"),
        responseId: "resp_terra",
        responseRequestId: "request_terra",
      });

    await executePlanPreflight({
      authorityEpoch: 1,
      capabilityGrantId: null,
      fencingToken: 1,
      inputManifestId: id("90"),
      inputManifestSha256: hash("a"),
      preflightRunId: id("6"),
      schemaVersion: "genie.preflight-task.v1",
      stageAttemptId: id("9"),
      stageRunId: id("91"),
      workspaceId: id("1"),
    });
    const planCall = mocks.rpc.mock.calls.find(
      ([name]) => name === "command_record_preflight_plan",
    );
    expect(
      planCall?.[1].p_plan.edd.shots
        .slice(0, 4)
        .map(
          ({
            realWorldReferenceAssetVersionId,
          }: {
            realWorldReferenceAssetVersionId: string;
          }) => realWorldReferenceAssetVersionId,
        ),
    ).toEqual([id("31"), id("32"), id("31"), id("32")]);
  });

  it("normalizes bounded director metadata without changing shot authority", async () => {
    const data = fixture();
    const normalizedDirector = {
      ...data.director,
      shots: data.director.shots.map((shot, index) =>
        index === 0
          ? {
              ...shot,
              sfxCue: "deliberate silence",
              sfxDurationMs: 5_000,
              sfxStartOffsetMs: 14_999,
            }
          : index === 1
            ? {
                ...shot,
                characterVersionIds: [id("13"), id("13")],
                sfxDurationMs: 5_000,
                sfxStartOffsetMs: 14_999,
                shotNumber: 1,
                transition: "fade_from_black",
              }
            : shot,
      ),
    };
    mocks.agent
      .mockReset()
      .mockResolvedValueOnce({
        output: semanticBoundaries(data),
        requestHash: hash("4"),
        responseId: "resp_boundaries",
        responseRequestId: "request_boundaries",
      })
      .mockResolvedValueOnce({
        output: normalizedDirector,
        requestHash: hash("5"),
        responseId: "resp_director",
        responseRequestId: "request_director",
      })
      .mockResolvedValueOnce({
        output: data.evaluator,
        requestHash: hash("6"),
        responseId: "resp_sol",
        responseRequestId: "request_sol",
      })
      .mockResolvedValueOnce({
        output: data.evaluator,
        requestHash: hash("7"),
        responseId: "resp_terra",
        responseRequestId: "request_terra",
      });

    await executePlanPreflight({
      authorityEpoch: 1,
      capabilityGrantId: null,
      fencingToken: 1,
      inputManifestId: id("90"),
      inputManifestSha256: hash("a"),
      preflightRunId: id("6"),
      schemaVersion: "genie.preflight-task.v1",
      stageAttemptId: id("9"),
      stageRunId: id("91"),
      workspaceId: id("1"),
    });
    const planCall = mocks.rpc.mock.calls.find(
      ([name]) => name === "command_record_preflight_plan",
    );
    const plan = planCall?.[1].p_plan;
    const [firstShot, secondShot] = plan.edd.shots;
    expect(firstShot).toMatchObject({
      sfxCue: "deliberate silence",
      sfxDurationMs: 0,
      sfxStartOffsetMs: 0,
    });
    expect(plan.shots[1]).toMatchObject({
      characterVersionIds: [id("13")],
      shotNumber: 2,
    });
    expect(plan.composition.shots[1]).toMatchObject({
      transition: "hard_cut",
    });
    expect(secondShot.sfxDurationMs).toBeGreaterThanOrEqual(500);
    expect(secondShot.sfxStartOffsetMs + secondShot.sfxDurationMs).toBeLessThanOrEqual(
      data.timeline.shots[1]!.endMs - data.timeline.shots[1]!.startMs,
    );
  });

  it("repairs a blocked plan with exact feedback and fresh blind evaluation", async () => {
    const data = fixture();
    const plans: PersistedPlanParameters[] = [];
    const blindGroups: string[] = [];
    let resumeBlocked = false;
    let evaluatorRecord = 0;
    let scoreSet = 0;
    let consensus = 0;
    mocks.rpc.mockReset().mockImplementation(async (name: string, parameters) => {
      if (name === "get_plan_preflight_input") {
        const prior = plans[0];
        return {
          data:
            resumeBlocked && prior
              ? {
                  ...data.input,
                  existingPlan: {
                    beatVersionId: prior.p_component_ids.beat,
                    compositionVersionId: prior.p_component_ids.composition,
                    eddVersionId: prior.p_component_ids.edd,
                    graphHash: prior.p_graph_hash,
                    planBundleId: prior.p_plan_bundle_id,
                    planHash: prior.p_plan_hash,
                    routingVersionId: prior.p_component_ids.routing,
                    safetyVersionId: prior.p_component_ids.safety,
                    shotVersionId: prior.p_component_ids.shot,
                    soundVersionId: prior.p_component_ids.sound,
                    state: "blocked",
                    storyVersionId: prior.p_component_ids.story,
                  },
                }
              : data.input,
          error: null,
        };
      }
      if (name === "get_plan_preflight_resume") {
        const prior = plans[0]!;
        return {
          data: {
            challenges: [],
            componentIds: prior.p_component_ids,
            consensus: { consensusId: id("81") },
            graphHash: prior.p_graph_hash,
            plan: prior.p_plan,
            planBundleId: prior.p_plan_bundle_id,
            planHash: prior.p_plan_hash,
            state: "blocked",
          },
          error: null,
        };
      }
      if (name === "command_record_preflight_plan") {
        plans.push(parameters as PersistedPlanParameters);
        return { data: parameters.p_plan_bundle_id, error: null };
      }
      if (name === "command_issue_plan_evaluator_challenges") {
        blindGroups.push(parameters.p_blind_group_id as string);
        return { data: parameters.p_blind_group_id, error: null };
      }
      if (name === "command_record_evaluator_record") {
        evaluatorRecord += 1;
        return { data: id(String(60 + evaluatorRecord)), error: null };
      }
      if (name === "command_record_plan_evaluator_score_set") {
        scoreSet += 1;
        return { data: id(String(70 + scoreSet)), error: null };
      }
      if (name === "command_create_preflight_plan_consensus") {
        consensus += 1;
        return { data: id(String(80 + consensus)), error: null };
      }
      if (name === "get_plan_repair_feedback") {
        return {
          data: repairFeedback(data, plans.at(-1)!, 1, id("81")),
          error: null,
        };
      }
      return { data: id("50"), error: null };
    });
    const blocked = blockingEvaluator(data);
    mocks.agent
      .mockReset()
      .mockResolvedValueOnce({
        output: semanticBoundaries(data),
        requestHash: hash("4"),
        responseId: "resp_boundaries",
        responseRequestId: "request_boundaries",
      })
      .mockResolvedValueOnce({
        output: data.director,
        requestHash: hash("5"),
        responseId: "resp_director",
        responseRequestId: "request_director",
      })
      .mockResolvedValueOnce({
        output: blocked,
        requestHash: hash("6"),
        responseId: "resp_sol_blocked",
        responseRequestId: "request_sol_blocked",
      })
      .mockResolvedValueOnce({
        output: blocked,
        requestHash: hash("7"),
        responseId: "resp_terra_blocked",
        responseRequestId: "request_terra_blocked",
      })
      .mockResolvedValueOnce({
        output: repairedDirector(data, 2),
        requestHash: hash("8"),
        responseId: "resp_repair",
        responseRequestId: "request_repair",
      })
      .mockResolvedValueOnce({
        output: data.evaluator,
        requestHash: hash("9"),
        responseId: "resp_sol_pass",
        responseRequestId: "request_sol_pass",
      })
      .mockResolvedValueOnce({
        output: data.evaluator,
        requestHash: hash("a"),
        responseId: "resp_terra_pass",
        responseRequestId: "request_terra_pass",
      });
    mocks.summary
      .mockReset()
      .mockResolvedValueOnce(blockedSummary)
      .mockResolvedValueOnce(passingSummary);

    const envelope = {
      authorityEpoch: 1,
      capabilityGrantId: null,
      fencingToken: 1,
      inputManifestId: id("90"),
      inputManifestSha256: hash("a"),
      preflightRunId: id("6"),
      schemaVersion: "genie.preflight-task.v1",
      stageAttemptId: id("9"),
      stageRunId: id("91"),
      workspaceId: id("1"),
    } as const;

    await expect(executePlanPreflight(envelope)).rejects.toMatchObject({
      code: "PLAN_REPAIR_PENDING",
      retryable: true,
    });
    expect(plans).toHaveLength(1);
    expect(mocks.agent).toHaveBeenCalledTimes(4);

    resumeBlocked = true;
    const result = await executePlanPreflight(envelope);

    expect(result).toMatchObject({ consensusId: id("82"), replayed: true });
    expect(plans).toHaveLength(2);
    expect(plans[1]!.p_plan_hash).not.toBe(plans[0]!.p_plan_hash);
    expect(blindGroups).toHaveLength(2);
    expect(blindGroups[1]).not.toBe(blindGroups[0]);
    expect(mocks.agent).toHaveBeenCalledTimes(7);
    const repairInput = JSON.parse(mocks.agent.mock.calls[4]![1].input as string);
    expect(repairInput.immutableScript.exactText).toBe(data.input.processingText);
    expect(repairInput.repair).toMatchObject({
      priorIteration: 1,
      priorPlanBundleId: plans[0]!.p_plan_bundle_id,
      repairAvailable: true,
    });
    expect(repairInput.repair.priorCreativePlan.edd.shots[0]).not.toHaveProperty(
      "promptBlueprint",
    );
    expect(mocks.agent.mock.calls[4]![1].input.length).toBeLessThan(100_000);
  });

  it("honors persisted repair exhaustion before another model call", async () => {
    const data = fixture();
    const plans: PersistedPlanParameters[] = [];
    let resumeExhausted = false;
    let evaluatorRecord = 0;
    let scoreSet = 0;
    let consensus = 0;
    mocks.rpc.mockReset().mockImplementation(async (name: string, parameters) => {
      if (name === "get_plan_preflight_input") {
        const prior = plans[0];
        return {
          data:
            resumeExhausted && prior
              ? {
                  ...data.input,
                  existingPlan: {
                    beatVersionId: prior.p_component_ids.beat,
                    compositionVersionId: prior.p_component_ids.composition,
                    eddVersionId: prior.p_component_ids.edd,
                    graphHash: prior.p_graph_hash,
                    planBundleId: prior.p_plan_bundle_id,
                    planHash: prior.p_plan_hash,
                    routingVersionId: prior.p_component_ids.routing,
                    safetyVersionId: prior.p_component_ids.safety,
                    shotVersionId: prior.p_component_ids.shot,
                    soundVersionId: prior.p_component_ids.sound,
                    state: "blocked",
                    storyVersionId: prior.p_component_ids.story,
                  },
                }
              : data.input,
          error: null,
        };
      }
      if (name === "get_plan_preflight_resume") {
        const prior = plans[0]!;
        return {
          data: {
            challenges: [],
            componentIds: prior.p_component_ids,
            consensus: { consensusId: id("303") },
            graphHash: prior.p_graph_hash,
            plan: prior.p_plan,
            planBundleId: prior.p_plan_bundle_id,
            planHash: prior.p_plan_hash,
            state: "blocked",
          },
          error: null,
        };
      }
      if (name === "command_record_preflight_plan") {
        plans.push(parameters as PersistedPlanParameters);
        return { data: parameters.p_plan_bundle_id, error: null };
      }
      if (name === "command_record_evaluator_record") {
        evaluatorRecord += 1;
        return { data: id(String(100 + evaluatorRecord)), error: null };
      }
      if (name === "command_record_plan_evaluator_score_set") {
        scoreSet += 1;
        return { data: id(String(200 + scoreSet)), error: null };
      }
      if (name === "command_create_preflight_plan_consensus") {
        consensus += 1;
        return { data: id(String(300 + consensus)), error: null };
      }
      if (name === "get_plan_repair_feedback") {
        const plan = plans.at(-1)!;
        if (resumeExhausted) {
          return {
            data: {
              consensusId: id("303"),
              priorIteration: 3,
              priorPlanBundleId: plan.p_plan_bundle_id,
              priorPlanHash: plan.p_plan_hash,
              reason: "exhausted",
              repairAvailable: false,
            },
            error: null,
          };
        }
        return {
          data: repairFeedback(
            data,
            plan,
            plans.length as 1 | 2,
            id(String(300 + plans.length)),
          ),
          error: null,
        };
      }
      return { data: id("50"), error: null };
    });
    const blocked = blockingEvaluator(data, " throughout the repair budget");
    mocks.agent
      .mockReset()
      .mockResolvedValueOnce({
        output: semanticBoundaries(data),
        requestHash: hash("0"),
        responseId: "boundaries_1",
        responseRequestId: null,
      })
      .mockResolvedValueOnce({
        output: data.director,
        requestHash: hash("1"),
        responseId: "director_1",
        responseRequestId: null,
      });
    mocks.agent
      .mockResolvedValueOnce({
        output: blocked,
        requestHash: hash("2"),
        responseId: "sol_1",
        responseRequestId: null,
      })
      .mockResolvedValueOnce({
        output: blocked,
        requestHash: hash("3"),
        responseId: "terra_1",
        responseRequestId: null,
      });
    mocks.summary.mockReset().mockResolvedValue(blockedSummary);

    const envelope = {
      authorityEpoch: 1,
      capabilityGrantId: null,
      fencingToken: 1,
      inputManifestId: id("90"),
      inputManifestSha256: hash("a"),
      preflightRunId: id("6"),
      schemaVersion: "genie.preflight-task.v1",
      stageAttemptId: id("9"),
      stageRunId: id("91"),
      workspaceId: id("1"),
    } as const;
    await expect(executePlanPreflight(envelope)).rejects.toMatchObject({
      code: "PLAN_REPAIR_PENDING",
      retryable: true,
    });
    resumeExhausted = true;
    await expect(executePlanPreflight(envelope)).rejects.toMatchObject({
      code: "PLAN_QUALITY_BLOCKED",
      retryable: false,
    });
    expect(plans).toHaveLength(1);
    expect(
      mocks.rpc.mock.calls.filter(
        ([name]) => name === "command_issue_plan_evaluator_challenges",
      ),
    ).toHaveLength(1);
    expect(mocks.agent).toHaveBeenCalledTimes(4);
  });

  it("resumes a published candidate and runs only the missing blind evaluator", async () => {
    const data = fixture();
    const envelope = {
      authorityEpoch: 1,
      capabilityGrantId: null,
      fencingToken: 1,
      inputManifestId: id("90"),
      inputManifestSha256: hash("a"),
      preflightRunId: id("6"),
      schemaVersion: "genie.preflight-task.v1" as const,
      stageAttemptId: id("9"),
      stageRunId: id("91"),
      workspaceId: id("1"),
    };
    await executePlanPreflight(envelope);
    const planCall = mocks.rpc.mock.calls.find(
      ([name]) => name === "command_record_preflight_plan",
    )!;
    const challengeCall = mocks.rpc.mock.calls.find(
      ([name]) => name === "command_issue_plan_evaluator_challenges",
    )!;
    const parameters = planCall[1];
    const issued = challengeCall[1].p_challenges;

    mocks.agent.mockReset().mockResolvedValueOnce({
      output: data.evaluator,
      requestHash: hash("9"),
      responseId: "resp_terra_resume",
      responseRequestId: "request_terra_resume",
    });
    mocks.rpc.mockReset().mockImplementation(async (name: string) => {
      if (name === "get_plan_preflight_input") {
        return {
          data: {
            ...data.input,
            existingPlan: {
              beatVersionId: parameters.p_component_ids.beat,
              compositionVersionId: parameters.p_component_ids.composition,
              eddVersionId: parameters.p_component_ids.edd,
              graphHash: parameters.p_graph_hash,
              planBundleId: parameters.p_plan_bundle_id,
              planHash: parameters.p_plan_hash,
              routingVersionId: parameters.p_component_ids.routing,
              safetyVersionId: parameters.p_component_ids.safety,
              shotVersionId: parameters.p_component_ids.shot,
              soundVersionId: parameters.p_component_ids.sound,
              state: "candidate",
              storyVersionId: parameters.p_component_ids.story,
            },
          },
          error: null,
        };
      }
      if (name === "get_plan_preflight_resume") {
        return {
          data: {
            challenges: [
              {
                ...issued[0],
                blindGroupId: challengeCall[1].p_blind_group_id,
                evaluatorRecordId: id("61"),
                scoreSetId: id("71"),
              },
              {
                ...issued[1],
                blindGroupId: challengeCall[1].p_blind_group_id,
                evaluatorRecordId: null,
                scoreSetId: null,
              },
            ],
            componentIds: parameters.p_component_ids,
            consensus: null,
            graphHash: parameters.p_graph_hash,
            plan: parameters.p_plan,
            planBundleId: parameters.p_plan_bundle_id,
            planHash: parameters.p_plan_hash,
            state: "candidate",
          },
          error: null,
        };
      }
      if (name === "command_record_evaluator_record") {
        return { data: id("62"), error: null };
      }
      if (name === "command_record_plan_evaluator_score_set") {
        return { data: id("72"), error: null };
      }
      if (name === "command_create_preflight_plan_consensus") {
        return { data: id("80"), error: null };
      }
      return { data: id("50"), error: null };
    });

    const resumed = await executePlanPreflight(envelope);
    expect(resumed).toMatchObject({ replayed: true, consensusId: id("80") });
    expect(mocks.agent).toHaveBeenCalledTimes(1);
    expect(mocks.agent.mock.calls[0]?.[1]).toMatchObject({
      model: "gpt-5.6-terra",
    });
    expect(
      mocks.rpc.mock.calls.some(([name]) => name === "command_record_preflight_plan"),
    ).toBe(false);
    expect(
      mocks.rpc.mock.calls.some(
        ([name]) => name === "command_issue_plan_evaluator_challenges",
      ),
    ).toBe(false);
  });
});

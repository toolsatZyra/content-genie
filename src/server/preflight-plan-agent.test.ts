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
          identityManifest: { canonicalName: "देवी" },
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
          templeEvidenceSetHash: null,
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
    shots: timeline.shots.map(({ shotNumber }) => ({
      cameraMotion: "A controlled motivated move.",
      characterVersionIds: [id("13")],
      emotionalRead: "Readable restraint and resolve.",
      framing: "Layered vertical composition with subtitle-safe negative space.",
      lighting: "Motivated warm key and cool separation.",
      locationVersionId: id("23"),
      motionClass: ["simple_camera_subject", "camera_led", "complex_general"][
        shotNumber % 3
      ],
      narrativeFunction: "Advance cause, reaction, and consequence.",
      scoreCue: "A restrained motif gains one layer.",
      sfxCue: "Specific cloth, wind, and environment detail.",
      shotNumber,
      subjectAction: "The figure reacts with controlled physical detail.",
      transition: "Motivated visual cut.",
      visualIntent: "Make the story legible without sound.",
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

type PersistedPlanParameters = Readonly<{
  p_component_ids: Readonly<Record<string, string>>;
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
    expect(mocks.agent).toHaveBeenCalledTimes(3);
  });

  it("repairs a blocked plan with exact feedback and fresh blind evaluation", async () => {
    const data = fixture();
    const plans: PersistedPlanParameters[] = [];
    const blindGroups: string[] = [];
    let evaluatorRecord = 0;
    let scoreSet = 0;
    let consensus = 0;
    mocks.rpc.mockReset().mockImplementation(async (name: string, parameters) => {
      if (name === "get_plan_preflight_input") {
        return { data: data.input, error: null };
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

    expect(result).toMatchObject({ consensusId: id("82"), replayed: false });
    expect(plans).toHaveLength(2);
    expect(plans[1]!.p_plan_hash).not.toBe(plans[0]!.p_plan_hash);
    expect(blindGroups).toHaveLength(2);
    expect(blindGroups[1]).not.toBe(blindGroups[0]);
    expect(mocks.agent).toHaveBeenCalledTimes(6);
    const repairInput = JSON.parse(mocks.agent.mock.calls[3]![1].input as string);
    expect(repairInput.immutableScript.exactText).toBe(data.input.processingText);
    expect(repairInput.repair).toMatchObject({
      priorIteration: 1,
      priorPlanBundleId: plans[0]!.p_plan_bundle_id,
      repairAvailable: true,
    });
  });

  it("stops after exactly two blocked automatic repairs", async () => {
    const data = fixture();
    const plans: PersistedPlanParameters[] = [];
    let evaluatorRecord = 0;
    let scoreSet = 0;
    let consensus = 0;
    mocks.rpc.mockReset().mockImplementation(async (name: string, parameters) => {
      if (name === "get_plan_preflight_input") {
        return { data: data.input, error: null };
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
        if (plans.length === 3) {
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
    mocks.agent.mockReset().mockResolvedValueOnce({
      output: data.director,
      requestHash: hash("1"),
      responseId: "director_1",
      responseRequestId: null,
    });
    for (let iteration = 1; iteration <= 3; iteration += 1) {
      mocks.agent
        .mockResolvedValueOnce({
          output: blocked,
          requestHash: hash("2"),
          responseId: `sol_${iteration}`,
          responseRequestId: null,
        })
        .mockResolvedValueOnce({
          output: blocked,
          requestHash: hash("3"),
          responseId: `terra_${iteration}`,
          responseRequestId: null,
        });
      if (iteration < 3) {
        mocks.agent.mockResolvedValueOnce({
          output: repairedDirector(data, (iteration + 1) as 2 | 3),
          requestHash: hash("4"),
          responseId: `director_${iteration + 1}`,
          responseRequestId: null,
        });
      }
    }
    mocks.summary.mockReset().mockResolvedValue(blockedSummary);

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
    ).rejects.toMatchObject({ code: "PLAN_QUALITY_BLOCKED", retryable: false });
    expect(plans).toHaveLength(3);
    expect(
      mocks.rpc.mock.calls.filter(
        ([name]) => name === "command_issue_plan_evaluator_challenges",
      ),
    ).toHaveLength(3);
    expect(mocks.agent).toHaveBeenCalledTimes(9);
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

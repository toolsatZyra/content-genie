import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  admin: vi.fn(),
  runAgent: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: mocks.admin,
}));
vi.mock("@/server/openai-structured-agent", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/server/openai-structured-agent")>();
  return {
    ...original,
    runPreparedOpenAiStructuredAgent: mocks.runAgent,
  };
});

import { advanceNextMvpRepairPlanning } from "./mvp-repair-production";

const ids = {
  bundle: "10000000-0000-4000-8000-000000000001",
  clip: "10000000-0000-4000-8000-000000000002",
  edd: "10000000-0000-4000-8000-000000000003",
  episode: "10000000-0000-4000-8000-000000000004",
  frame: "10000000-0000-4000-8000-000000000005",
  lease: "10000000-0000-4000-8000-000000000006",
  repair: "10000000-0000-4000-8000-000000000007",
  run: "10000000-0000-4000-8000-000000000008",
  workspace: "10000000-0000-4000-8000-000000000009",
} as const;

const sourceEdd = {
  shots: [
    {
      action: "Rama slowly lifts the sacred bow.",
      cameraAngleAndDistance: "Low-angle medium close-up.",
      cameraMotion: "A restrained forward dolly.",
      cutType: "hard_cut",
      endMs: 3_000,
      exactNarration: "राम ने धनुष उठाया।",
      lighting: "Warm ceremonial torchlight.",
      mood: "Reverent anticipation.",
      motionPromptBlueprint: "Animate only the deliberate bow lift.",
      narrativeFunction: "Reveal the decisive action.",
      promptBlueprint: "Rama lifting Shiva's bow in the royal court.",
      sceneComposition: "Rama centered with the bow spanning the lower frame.",
      sfxCue: "A short wooden bow resonance.",
      sfxDurationMs: 800,
      sfxGainDb: -18,
      sfxStartOffsetMs: 1_200,
      shotNumber: 1,
      startMs: 0,
      storyboardCompositionMode: "single_frame",
      storyboardEndPromptBlueprint: null,
      storyboardPromptBlueprint: "Rama lifting Shiva's bow in a 9:16 frame.",
      storyboardStartPromptBlueprint: "Rama lifting Shiva's bow in a 9:16 frame.",
      visualIntent: "Make the sacred action instantly legible.",
    },
  ],
} as const;

function queryResult(table: string) {
  if (table === "mvp_repair_request_worker") {
    return {
      data: {
        clarification_transcript: [
          {
            content: "Which exact timestamp should Monica repair?",
            kind: "question",
            round: 1,
          },
          {
            content: "At 00:01.500, but I am unsure whether it is the image.",
            kind: "answer",
            round: 1,
          },
        ],
        feedback: "Make the bow moment more powerful.",
      },
      error: null,
    };
  }
  if (table === "preflight_plan_bundles") {
    return { data: { edd_version_id: ids.edd }, error: null };
  }
  if (table === "preflight_plan_component_versions") {
    return { data: { payload: sourceEdd }, error: null };
  }
  if (table === "mvp_production_clip_worker") {
    return {
      data: [
        {
          id: ids.clip,
          shot_number: 1,
          storyboard_end_frame_id: null,
          storyboard_frame_id: ids.frame,
        },
      ],
      error: null,
    };
  }
  if (table === "preflight_reference_edges") {
    return { data: [], error: null };
  }
  throw new Error(`Unexpected test table ${table}`);
}

function query(table: string) {
  const response = queryResult(table);
  const chain = {
    eq: vi.fn(() => chain),
    not: vi.fn(() => chain),
    order: vi.fn(async () => response),
    select: vi.fn(() => chain),
    single: vi.fn(async () => response),
  };
  return chain;
}

describe("MVP repair planning clarification fence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("publishes one clarification and does not publish a media repair plan", async () => {
    const rpc = vi.fn(async (name: string, _parameters?: Record<string, unknown>) => {
      void _parameters;
      if (name === "command_claim_next_mvp_repair") {
        return {
          data: {
            id: ids.repair,
            plan_bundle_id: ids.bundle,
            planner_lease_token: ids.lease,
            production_run_id: ids.run,
            source_attempt_number: 1,
            target_attempt_number: 2,
            version: 3,
            workspace_id: ids.workspace,
          },
          error: null,
        };
      }
      if (name === "command_publish_mvp_repair_clarification_grounded") {
        return { data: { state: "awaiting_clarification" }, error: null };
      }
      throw new Error(`Unexpected RPC ${name}`);
    });
    mocks.admin.mockReturnValue({ from: vi.fn(query), rpc });
    mocks.runAgent.mockResolvedValue({
      output: {
        actions: [],
        clarification: {
          ambiguousFeedbackPoints: [
            "The owner has not said whether the defect is in the static image or its motion.",
          ],
          question:
            "At 00:01.500, should Monica change the still image composition or only the clip motion?",
        },
        decision: "clarification_required",
        overallInterpretation:
          "The timestamp maps to shot 1, but the requested asset change is ambiguous.",
      },
    });

    await expect(advanceNextMvpRepairPlanning()).resolves.toBe(true);

    const prepared = mocks.runAgent.mock.calls[0]![0] as { bodyText: string };
    const body = JSON.parse(prepared.bodyText) as { input: string };
    expect(JSON.parse(body.input)).toMatchObject({
      clarificationTranscript: {
        rounds: [
          {
            answer: "At 00:01.500, but I am unsure whether it is the image.",
            question: "Which exact timestamp should Monica repair?",
          },
        ],
      },
      sourceEdd: { shots: [{ endMs: 3_000, startMs: 0 }] },
    });
    const clarificationCall = rpc.mock.calls.find(
      ([name]) => name === "command_publish_mvp_repair_clarification_grounded",
    );
    expect(clarificationCall?.[1]).toMatchObject({
      p_feedback_points: [
        {
          evidenceWindows: [],
          feedbackPointIndex: 1,
          resolution: "clarification",
          resolvedShotNumbers: [],
        },
      ],
      p_expected_request_version: 3,
      p_planner_lease_token: ids.lease,
      p_question:
        "At 00:01.500, should Monica change the still image composition or only the clip motion?",
      p_repair_request_id: ids.repair,
    });
    expect(
      rpc.mock.calls.some(
        ([name]) => name === "command_publish_mvp_repair_plan_grounded",
      ),
    ).toBe(false);
    expect(
      rpc.mock.calls.some(([name]) => name === "command_fail_mvp_repair_request"),
    ).toBe(false);
  });
});

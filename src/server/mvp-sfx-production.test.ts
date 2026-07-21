import { describe, expect, it } from "vitest";

import { isReusableMvpSfxSource, type ReusableMvpSfxRow } from "./mvp-sfx-production";

const hash = "a".repeat(64);

function source(overrides: Partial<ReusableMvpSfxRow> = {}): ReusableMvpSfxRow {
  return {
    byte_length: 8_192,
    content_sha256: hash,
    cue_kind: "generated_effect",
    cue_sha256: hash,
    cue_text: "A taut bowstring snaps with a short wooden resonance.",
    fade_in_ms: 20,
    fade_out_ms: 90,
    gain_db: -18,
    id: "10000000-0000-4000-8000-000000000001",
    model_contract_sha256: hash,
    object_name: "workspace/run/1/1.mp3",
    payload_sha256: hash,
    prompt_sha256: hash,
    requested_duration_ms: 1_200,
    shot_number: 1,
    start_offset_ms: 100,
    state: "complete",
    trim_duration_ms: 1_000,
    ...overrides,
  };
}

function parameters(overrides: Record<string, unknown> = {}) {
  return {
    p_cue_text: "A taut bowstring snaps with a short wooden resonance.",
    p_cue_sha256: hash,
    p_fade_in_ms: 20,
    p_fade_out_ms: 90,
    p_gain_db: -18,
    p_model_contract_sha256: hash,
    p_payload_sha256: hash,
    p_prompt_sha256: hash,
    p_requested_duration_ms: 1_200,
    p_start_offset_ms: 100,
    p_trim_duration_ms: 1_000,
    ...overrides,
  };
}

describe("MVP SFX exact-reuse authority", () => {
  it("reuses only a complete generated effect with exact cue, provider and mix identity", () => {
    expect(isReusableMvpSfxSource(source(), parameters())).toBe(true);
    expect(isReusableMvpSfxSource(source({ gain_db: "-18" }), parameters())).toBe(true);
  });

  it("rejects a changed cue, provider payload or mix decision", () => {
    expect(
      isReusableMvpSfxSource(source(), parameters({ p_cue_sha256: "b".repeat(64) })),
    ).toBe(false);
    expect(
      isReusableMvpSfxSource(
        source(),
        parameters({ p_payload_sha256: "b".repeat(64) }),
      ),
    ).toBe(false);
    expect(isReusableMvpSfxSource(source(), parameters({ p_gain_db: -17 }))).toBe(
      false,
    );
    expect(
      isReusableMvpSfxSource(source(), parameters({ p_start_offset_ms: 101 })),
    ).toBe(false);
  });

  it("never treats silence, an unfinished row, or missing media as reusable audio", () => {
    expect(
      isReusableMvpSfxSource(source({ cue_kind: "deliberate_silence" }), parameters()),
    ).toBe(false);
    expect(isReusableMvpSfxSource(source({ state: "claimed" }), parameters())).toBe(
      false,
    );
    expect(isReusableMvpSfxSource(source({ object_name: null }), parameters())).toBe(
      false,
    );
    expect(isReusableMvpSfxSource(source({ content_sha256: null }), parameters())).toBe(
      false,
    );
  });
});

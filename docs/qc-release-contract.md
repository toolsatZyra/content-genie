# Genie QC and Release Contract

**Status:** Authoritative normative contract for quality control, repair, and
release  
**Contract ID:** `genie.qc-release`  
**Version:** `1.0.0`  
**Applicability profile:** `genie.narration-hi.launch.v1`  
**Effective date:** 2026-07-17

## 1. Authority and scope

This document is the implementation contract for every Genie quality decision
from script ingestion through final export. Within this scope it resolves and
supersedes conflicting QC or release language in:

- `docs/design.md`;
- `reference/rubric-config/visual.v1.json`;
- `reference/rubric-config/script.v1.json`;
- `reference/rubric-config/checks.v1.json`;
- `docs/archive/research-design-2026-07-10.md`.

`docs/design.md` remains authoritative for the wider product. The three
vendored JSON files remain authoritative for their parameter definitions,
anchors, base weights, source formulas, source gates, and provenance. This
contract is authoritative for:

- Genie stage applicability;
- narration-only adaptations;
- advisory, repair-triggering, and blocking effects;
- evidence and evaluator requirements;
- provisional and calibrated behavior;
- repair and regression behavior;
- cultural/theological eligibility;
- the final release decision.

The runtime must fail closed if this contract, the selected applicability
profile, or any required source config cannot be loaded and validated.

### 1.1 Pinned source snapshot

The initial implementation must recognize this exact source snapshot:

| Source | Version | SHA-256 |
|---|---:|---|
| `visual.v1.json` | `1.0.0` | `D7F33631EBEAD6FD4AF26C811295904E5622C72098B54382C5CC95106688C4A5` |
| `script.v1.json` | `1.0.0` | `714FEF20F2151EE63BCE3307267F531485F3F3C29215BB8A5FA552EE9DD165B4` |
| `checks.v1.json` | `1.0.0` | `CA3143B61F6207034A7893ABCD5B09E5558E22A3218E7478E13B7D029016DECB` |

A hash mismatch is `GQC-CONFIG-001` and blocks creation of a new authoritative
QC verdict. Historical verdicts remain valid only for the exact master and
configuration versions they pin.

## 2. Resolved conflicts

| Conflict | Authoritative resolution |
|---|---|
| `checks.v1.json` says checks never gate, while Genie must stop visible glitches. | Results emitted directly from `checks.v1.json` remain non-scored advisory pass/warn observations. Separate Genie operational defect rules may consume the same evidence and independently trigger repair or block release. The source check is never silently promoted into a gate. |
| Generic rubrics contain dialogue and lip-sync, while launch episodes are narration-only. | Lip-sync is always `not_applicable`. Dialogue masking becomes narration masking under an explicit semantic adapter. Dialogue economy becomes narration economy and speakability. Disabled rules never count as passes. |
| The script rubric contains rewrite/reject gates, while the user script is immutable. | Every script-rubric score, gate, verdict, and fix-first item is advisory. It may require compensating visual, performance, or edit planning, but it may never mutate, reject, shorten, reorder, or silently rewrite the script. |
| The visual config marks `visual_plan` unreachable, while Genie requires pre-generation plan QC. | The Genie applicability profile makes `visual_plan` reachable at checkpoint `PLAN_PREFLIGHT`. The original visual anchors, formulas, mode adjustment, and confidence mapping remain pinned. |
| Cultural safety is mixed into localization/compliance scores. | Rubric localization scores remain quality/risk signals. Cultural and theological eligibility is a separate conjunctive release decision and is never averaged away by a high visual score. |
| `production_feasibility` is a live-action-oriented visual parameter. | At plan time it is adapted to **generation feasibility** using pinned provider capability data. At final time it is scored from the master plus production telemetry as **observed execution feasibility**. Its source ID remains `production_feasibility`; the semantic adapter version is stored. |
| Cliffhanger rules assume serialized commercial microdrama. | `cliffhanger_pull` and `cliffhanger_image` apply only when `continuationExpected=true`. They are `not_applicable` for a standalone story or resolved finale. No episode is forced to manufacture a cliffhanger that the locked script does not contain. |
| The research checks call for dialogue clarity and dialogue masking. | All launch evaluation prompts, labels, and evidence use **narration**. The runtime must reject a result that claims to have assessed on-screen dialogue or lip-sync. |
| The design requires production-quality automation before benchmark calibration. | Software can generate, repair, and QC end to end before calibration, but automated quality judgments are labelled `provisional`; every final release requires a human approval. Deterministic integrity and absolute policy rules remain fully blocking. |
| A source repair label such as `reshoot_scene` can be wrong for the actual failure (for example, narration masking). | Source labels are diagnostic suggestions only. The stage-aware repair router in this contract selects the executable repair action. |

## 3. Stable identifiers and result semantics

### 3.1 Identifier namespaces

Identifiers are stable and must not be reused with a different meaning.

| Namespace | Meaning |
|---|---|
| `GQC-CONFIG-*` | Contract, config, profile, and version integrity |
| `GQC-SCRIPT-*` | Locked script and script-sidecar integrity |
| `GQC-VOICE-*` | Narration, alignment, pronunciation, and master-clock checks |
| `GQC-WORLD-*` | Character, deity, costume, location, and reference checks |
| `GQC-PLAN-*` | Pre-generation story, shot, sound, and feasibility checks |
| `GQC-FRAME-*` | Keyframe checks |
| `GQC-CLIP-*` | Video-clip and temporal checks |
| `GQC-AUDIO-*` | Score, SFX, ambience, captions, and mix checks |
| `GQC-CONT-*` | Boundary, scene, identity, and series continuity checks |
| `GQC-CULT-*` | Cultural and theological eligibility |
| `GQC-MASTER-*` | Full-master quality and release checks |
| `GQC-REPAIR-*` | Repair planning and regression checks |
| `GQC-EXPORT-*` | Export integrity |
| `RUB-SCRIPT-<source_id>` | A result from `script.v1.json` |
| `RUB-VISUAL-<source_id>` | A result from `visual.v1.json` |
| `CHK-<source_id>` | A non-scored result from `checks.v1.json` |

### 3.2 Effects

Every rule result has exactly one effect:

| Effect | Meaning |
|---|---|
| `advisory` | Recorded and shown; never stops a stage or release by itself. |
| `repair_trigger` | The current candidate cannot complete the stage until the issue is repaired, explicitly waived where this contract permits a waiver, or superseded. |
| `hard_block_stage` | The next production stage cannot start. |
| `hard_block_release` | The master cannot become approved or be packaged as an approved export. |
| `hard_block_export` | The requested export/package cannot be created or exposed for download. |
| `not_applicable` | The rule was deliberately disabled by a pinned applicability condition. It is neither a pass nor a failure. |
| `indeterminate` | Required evidence or evaluator confidence is insufficient. For a required rule, this fails closed exactly like the corresponding block. |

Effects are conjunctive. A high rubric score never cancels a defect, cultural
block, stale dependency, missing evidence, or integrity failure.
No rule is waivable unless its own row or a later section explicitly defines
the permitted waiver, actor, evidence, and versioning behavior.

### 3.3 Severity

| Severity | Definition |
|---|---|
| `critical` | Script mutation, corrupt/unplayable media, wrong deity topology or essential attribute, confirmed identity swap, prohibited cultural content, materially wrong narration text, unintelligible narration, missing required evidence, or a defect that can cause serious religious/cultural harm. |
| `major` | A clearly visible or audible defect that materially breaks belief, comprehension, continuity, emotion, or cinematic quality. |
| `minor` | Polish issue noticeable on inspection but not materially harmful to comprehension, identity, dignity, or continuity. |
| `note` | Non-defect observation or improvement opportunity. |

Before calibration, the confirmed AI-artifact glitch budget is zero for the
entire released master. Hero shots always have a zero-glitch budget, even after
calibration. A low-level compression artifact introduced by the delivery codec
is not an AI-artifact glitch, but it must still satisfy export integrity.

## 4. Required QC record

Every QC execution persists an immutable `QcRun` equivalent containing at
least:

```text
run_id
checkpoint_id
subject_type
subject_id
subject_version
master_version_id (when applicable)
contract_id
contract_version
applicability_profile_id
applicability_profile_version
source_config_ids, versions, and hashes
semantic_adapter_version
calibration_state and calibration_version
series_release_id
episode_configuration_version
look_pack_version
voice_version
EDD_version
provider capability snapshot version
detector model/threshold versions
evaluator model/provider/prompt versions
evaluator independence metadata
parameter results
operational rule results
cultural decision
confidence results
repair links
release decision
created_at
content hash of the complete record
```

No record may point at an unversioned "current" character, location, look,
voice, prompt, detector, threshold, timeline, or master.

## 5. Stage contract

### 5.1 Checkpoints

| Checkpoint | Pipeline stage | Required systems | Maximum effect |
|---|---|---|---|
| `SCRIPT_PREFLIGHT` | S1 ingest and lock | Script integrity, script rubric, source/cultural triage | Script rubric advisory; integrity and absolute policy may block stage |
| `VOICE_ACCEPTANCE` | S2 voice/master clock | Exact text, alignment, pronunciation, audio integrity, duration | Hard block stage |
| `WORLD_ACCEPTANCE` | S4 world | Identity, references, deity attributes, location/cultural evidence | Repair or hard block stage |
| `PLAN_PREFLIGHT` | S5 planning | Visual plan rubric, structural invariants, cultural plan review, cost/capability fit | Repair or hard block stage |
| `KEYFRAME_ACCEPTANCE` | S6 keyframes | Frame defects, identity, anatomy, attributes, composition, safe zones | Repair or hard block stage |
| `CLIP_ACCEPTANCE` | S7 motion | Temporal defects, identity, anatomy/topology, motion, duration | Repair or hard block stage |
| `AUDIO_MIX_ACCEPTANCE` | S8-S9 | Narration, score, SFX, ambience, captions, loudness | Repair or hard block stage |
| `SCENE_CONTINUITY` | S9 | Boundaries, eyelines, grade, world continuity, dramatic continuity | Repair or hard block stage |
| `MASTER_RELEASE` | S10 | Full visual rubric, full defect funnel, cultural decision, evidence completeness | Repair or hard block release |
| `REPAIR_REGRESSION` | Repair branch | Local, boundary, dependency, and full-master checks | Hard block release |
| `EXPORT_ACCEPTANCE` | S11 | Exact approved version, checksums, probes, package completeness | Hard block export |

### 5.1.1 Source-rubric applicability matrix

The evaluator cannot decide applicability. The Story Analyst emits the required
context flags, deterministic policy validates them against the locked
script/plan, and the QC run pins them.

| Source parameters | `SCRIPT_PREFLIGHT` | `PLAN_PREFLIGHT` | `MASTER_RELEASE` | Launch effect/notes |
|---|---|---|---|---|
| Script: `opening_hook`, `protagonist_clarity`, `conflict_stakes`, `structure_pacing`, `relationship_legibility`, `genre_freshness`, `localization_fit` | Required | Not rescored as script rubric | Optional finished diagnostic | Always advisory |
| Script: `twist_reveal` | Required when `hasRevealOrDecisiveTurn=true`; otherwise `not_applicable` | Converted to visual coverage requirements | Optional finished diagnostic | Advisory; devotional revelation adapter applies |
| Script: `cliffhanger_pull` | Required only when `continuationExpected=true` | Converted to ending-image requirements | Optional finished diagnostic | Advisory; otherwise `not_applicable` |
| Script: `dialogue_economy` | Required through narration-economy adapter | Converted to voice/caption/visual-density requirements | Optional finished diagnostic | Advisory |
| Script: `series_continuity` | Required only for a Series episode with pinned prior/arc context | Converted to continuity requirements | Optional finished diagnostic | Advisory; standalone is `not_applicable` |
| Script: `monetization_compliance` | Required through production/platform adapter | Converted to capability, budget, rights, and platform rules | Optional finished diagnostic | Advisory; no invented paywall scoring |
| Visual: hook, clarity, vertical composition, emotion, blocking, escalation, edit rhythm, shot economy, performance, sound/music, subtitle safety, production feasibility, localization/compliance | Not applicable | Required in `visual_plan` mode | Required in `finished_episode` mode | Plan failures repair/block stage; final failures repair/block release according to this contract |
| Visual: `reveal_execution` | Not applicable | Required when `hasRevealOrDecisiveTurn=true`; otherwise `not_applicable` | Same pinned applicability as plan | Source gate only when `revealIsEpisodeFunction=true` |
| Visual: `cliffhanger_image` | Not applicable | Required only when `continuationExpected=true` | Same pinned applicability as plan | Otherwise `not_applicable`; no continuation gate |

`hasRevealOrDecisiveTurn=false` and `continuationExpected=false` require
evidence from the locked script/beat map; they are not score-avoidance switches.
Changing either flag versions the Episode configuration and invalidates
dependent QC.

### 5.2 `SCRIPT_PREFLIGHT`

Stable rules:

| Rule ID | Requirement | Effect |
|---|---|---|
| `GQC-SCRIPT-001` | Persist the exact submitted Unicode code-point sequence, its UTF-8 serialization/hash, the versioned NFC/LF processing representation, explicit raw/processing UTF-8-byte + scalar + browser UTF-16 + UAX #29 grapheme maps and library versions, language, revision, and lock actor. For uploaded text files, also preserve original bytes, encoding evidence, and file checksum. | `hard_block_stage` |
| `GQC-SCRIPT-002` | Every downstream text representation is traceable to the locked script; additions are typed sidecars and never substitute source words. | `hard_block_stage` |
| `GQC-SCRIPT-003` | Script-rubric evaluation covers all applicable parameters with valid evidence or an explicit `not_applicable`. | `advisory`; missing run is `hard_block_stage` because planning lacks required diagnostics |
| `GQC-SCRIPT-004` | Source/canon claims, named temples, rituals, shlokas, and contested retellings are extracted for cultural triage. | `hard_block_stage` if extraction is missing; findings route to `GQC-CULT-*` |
| `GQC-SCRIPT-005` | No automatic rewrite, paraphrase, deletion, reordering, or shortening is committed. | `hard_block_stage` |
| `GQC-SCRIPT-006` | Before lock, a deterministic word/punctuation/performance estimate shows whether narration is expected within 60–120 seconds. Out-of-band input requires acknowledgement but is not mutated. | `hard_block_stage` if estimate/acknowledgement is missing |

The only compatibility exception to `GQC-SCRIPT-003` is an exact
configuration captured in `private.script_rubric_legacy_waivers` by migration
`20260723033100` because it was already World-locked before this gate became
required. The allowlist is immutable, private, has no runtime writer, and
cannot admit any Episode created or World-locked after that migration.

All `RUB-SCRIPT-*` results are `advisory`, including every source gate and
source verdict. A weak script creates compensating plan requirements:

- a weak `opening_hook` requires a strong visual counter-image without changing
  words;
- weak `structure_pacing` requires tighter shot and edit planning;
- weak `dialogue_economy`, adapted to narration economy, requires performance,
  pause, caption, and visual-density management;
- weak `localization_fit` creates a Cultural Guardian review item;
- weak production/platform fit may block only through a separate deterministic
  production or policy rule, never through the script score itself.

### 5.3 `VOICE_ACCEPTANCE`

| Rule ID | Requirement | Effect |
|---|---|---|
| `GQC-VOICE-001` | Requested TTS text is exactly the locked script plus non-spoken provider markup that has a reversible sidecar mapping. | `hard_block_stage` |
| `GQC-VOICE-002` | No confirmed spoken word insertion, deletion, substitution, or reordering. ASR disagreement is `indeterminate`, never a pass. | `hard_block_stage` |
| `GQC-VOICE-003` | Captions are generated from locked words and forced alignment, not from an unconstrained ASR rewrite. | `hard_block_stage` |
| `GQC-VOICE-004` | Every token has monotonic timing; segment boundaries do not overlap or reverse; alignment gaps are explained by authored pauses. | `hard_block_stage` |
| `GQC-VOICE-005` | Sanskrit names and shlokas match the pinned pronunciation lexicon. An unverified shloka cannot advance. | `hard_block_stage` |
| `GQC-VOICE-006` | Narration has no clipping, truncation, corrupt frames, unintended silence, or audible segment seam. | `repair_trigger` |
| `GQC-VOICE-007` | Accepted narration duration is 60.000-120.000 seconds for the launch profile. | `hard_block_stage` unless an explicit product-scope override creates a new episode configuration |
| `GQC-VOICE-008` | Voice identity equals the pinned Series/Episode voice version; fallback routing may not silently change identity. | `hard_block_stage` |
| `GQC-VOICE-009` | Performance is conversational and expressive Hindi, with the requested narrator gender and the pinned voice ID. | `repair_trigger` |

`GQC-VOICE-002` uses normalization only for comparison diagnostics: Unicode
normalization, punctuation, provider markup, and documented numeral expansion
may be ignored. A semantic word change is never normalized away. A suspected
text mismatch requires a second ASR/alignment method or human resolution.

### 5.4 `WORLD_ACCEPTANCE`

| Rule ID | Requirement | Effect |
|---|---|---|
| `GQC-WORLD-001` | Every used character and location resolves to an accepted immutable version in the pinned Series Release or Episode override. | `hard_block_stage` |
| `GQC-WORLD-002` | Character identity, form, wardrobe, skin rule, ornaments, and essential attributes have measurable manifests. | `hard_block_stage` |
| `GQC-WORLD-003` | A deity form has explicit arm count, hand-object assignment, vahana, weapons, ornaments, skin-tone/form rules, and allowed transitions where relevant. | `hard_block_stage` |
| `GQC-WORLD-004` | Character sheets and required crops are complete and usable by the selected provider capability profile. | `repair_trigger` |
| `GQC-WORLD-005` | Named temples have researched architectural references and provenance; actual references are used for geometry, not unauthorized style imitation. | `hard_block_stage` |
| `GQC-WORLD-006` | Uploaded references pass rights, decode, MIME, malware, metadata, and storage controls. | `hard_block_stage` |
| `GQC-WORLD-007` | Cross-series or cross-tradition asset reuse is explicit and compatible; no name-only identity match. | `hard_block_stage` |
| `GQC-WORLD-008` | The exact reference pack, source registry extract, rights classifications, deity/temple manifests, and machine cultural-readiness report are complete, current, and bound to the Series draft. | `hard_block_stage` |

Universal numeric face/identity thresholds are forbidden. Identity thresholds
must be calibrated and pinned by `look_id x entity_kind x detector_version`.
Until such a cell is calibrated, its embedding score is evidence only and a
reference-conditioned independent VLM comparison is required.

For complex or multi-arm deity forms, free limb motion is disabled unless the
relevant detector/provider lane passes the calibration gate in Section 12. The
safe launch fallback is camera motion on a locked, passing keyframe.

### 5.5 `PLAN_PREFLIGHT`

The visual rubric runs in `visual_plan` mode with:

- `genre=mythological_devotional`;
- `market=hi-IN`;
- explicit `episodePosition`;
- `paywallPosition=not_applicable` unless the product later has a real paywall;
- `continuationExpected` and `revealIsEpisodeFunction` supplied explicitly;
- the source `mode_visual_plan` adjustment;
- the source mythological/devotional context adjustment;
- the `production_feasibility -> generation_feasibility` adapter.

Quantitative candidate floors:

| Rule ID | Requirement | Effect |
|---|---|---|
| `GQC-PLAN-001` | Projected OVS >= 74.0 using unrounded deterministic math. | `repair_trigger` |
| `GQC-PLAN-002` | Projected CVP >= 70.0. The autonomous target is 78.0. | `repair_trigger` |
| `GQC-PLAN-003` | PFS >= 70.0. | `repair_trigger` |
| `GQC-PLAN-004` | Visual confidence >= 75.0 and evidence density = 100% for required plan parameters. | `repair_trigger`; `indeterminate` after bounded retry is `hard_block_stage` |
| `GQC-PLAN-005` | No applicable source visual gate is triggered. | `repair_trigger` |
| `GQC-PLAN-006` | Every locked narration span has visual coverage; every shot has a valid time range; no unintended coverage gap or overlap exists. | `hard_block_stage` |
| `GQC-PLAN-007` | Planned generated duration, provider routes, reference counts, aspect ratio, model availability, and quoted retry budget fit pinned capability rows. | `hard_block_stage` |
| `GQC-PLAN-008` | Critical story action, eyes, mouths, and proof objects remain within the pinned safe-area profile. | `repair_trigger` |
| `GQC-PLAN-009` | Every planned reveal has proof and reaction; a major reveal also has consequence. | `repair_trigger` when a reveal exists |
| `GQC-PLAN-010` | Cultural plan eligibility is not blocked. | `hard_block_stage` |
| `GQC-PLAN-011` | Score, ambience, SFX, silence, and impact plans cover the episode without per-clip music dependence. | `repair_trigger` |
| `GQC-PLAN-012` | The quote and repair allowance are within the approved hard ceiling. | `hard_block_stage` |

The following planning targets are evidence-backed heuristics, not universal
hard rules. Missing them triggers explanation or repair, not automatic
rejection:

| Duration | Hook completes by | Typical cuts | Typical ASL |
|---:|---:|---:|---:|
| 60s | 4s | 8-12 | 2.5-4.0s |
| 90s | 5s | 12-18 | 3.0-5.0s |
| 120s | 6s | 14-22 | 3.5-6.0s |

For intermediate durations, hook completion is linearly interpolated. The
strongest opening image should land by 2.5 seconds. Rasa and story purpose may
justify slower average shot length, but not unclear coverage or a visually
empty opening. A generated clip should not normally be held beyond six seconds;
a stable keyframe-based devotional hold is an allowed, recorded exception.

The launch safe-area profile is configuration, not hard-coded judge prose. Its
initial conservative values are:

- top protection: 10% of frame height;
- bottom protection: 22% of frame height;
- left/right protection: 6% of frame width.

Rendered caption bounding boxes, not character-count guesses, determine safety.
Captions may use at most two displayed lines in the launch profile.

Monica may automatically repair a failing plan twice. A third failing plan is
`quality_blocked`. It may proceed only when an independent adjudication proves
the score or applicability result invalid and creates a corrected QC run; a
reviewer cannot simply waive the quality floor to authorize video spend.

### 5.6 `KEYFRAME_ACCEPTANCE`

| Rule ID | Requirement | Effect |
|---|---|---|
| `GQC-FRAME-001` | File decodes and matches required dimensions/aspect ratio. | `hard_block_stage` |
| `GQC-FRAME-002` | Prompt and reference bindings match the intended shot, characters, forms, wardrobe, and location. | `repair_trigger` |
| `GQC-FRAME-003` | No malformed anatomy, merged body/object geometry, unintended duplicate, or garbled story-critical text. | `repair_trigger`; critical topology is `hard_block_stage` |
| `GQC-FRAME-004` | Deity topology and hand-object assignment exactly match the pinned attribute manifest. | `hard_block_stage` |
| `GQC-FRAME-005` | Identity and skin/form color remain within calibrated thresholds or pass the uncalibrated multi-evidence procedure. | `repair_trigger` |
| `GQC-FRAME-006` | Composition, safe zones, emotional readability, dignity, and look adherence support the shot purpose. | `repair_trigger` |
| `GQC-FRAME-007` | Named-temple geometry and ritual staging match pinned evidence where applicable. | `hard_block_stage` |

No motion job may consume a failing keyframe.

### 5.7 `CLIP_ACCEPTANCE`

| Rule ID | Requirement | Effect |
|---|---|---|
| `GQC-CLIP-001` | Media probe, expected duration/handles, frame rate, resolution, and decode integrity pass. | `hard_block_stage` |
| `GQC-CLIP-002` | No temporal face/identity morph, character swap, flicker, sudden costume/attribute change, topology change, or object pop. | `repair_trigger`; critical identity/topology is `hard_block_stage` |
| `GQC-CLIP-003` | Every retained deity frame matches required arm count and hand-object assignment. | `hard_block_stage` |
| `GQC-CLIP-004` | Motion is physically plausible, completes the planned action, and settles at the required edit state. | `repair_trigger` |
| `GQC-CLIP-005` | No malformed hands/limbs/contact, body-object fusion, impossible camera discontinuity, or refusal artifact survives in retained frames. | `repair_trigger` |
| `GQC-CLIP-006` | Identity, skin/form color, and essential attributes remain stable across every retained frame under calibrated or provisional evidence rules. | `repair_trigger` |
| `GQC-CLIP-007` | Native generated music is not accepted as the episode soundtrack. | `hard_block_stage` |

Frame sampling alone cannot prove temporal stability. Deterministic/ML temporal
checks must inspect every retained frame or every retained frame pair where the
detector supports it. VLM review may sample intelligently but cannot replace
per-frame critical topology checks.

### 5.8 `AUDIO_MIX_ACCEPTANCE`

| Rule ID | Requirement | Effect |
|---|---|---|
| `GQC-AUDIO-001` | Narration remains intelligible throughout; score, ambience, SFX, or stings never mask a story-relevant word. | `hard_block_stage` |
| `GQC-AUDIO-002` | Score is continuous and dramatically arranged; ambience is continuous within a location unless silence is authored. | `repair_trigger` |
| `GQC-AUDIO-003` | SFX/foley timing supports rather than contradicts visible action. | `repair_trigger` |
| `GQC-AUDIO-004` | Caption text exactly reconciles to locked narration words and timing. | `hard_block_stage` |
| `GQC-AUDIO-005` | Caption rendering has no clipping, overflow, unreadable duration, or collision with critical imagery/UI. | `hard_block_stage` for critical collision; otherwise `repair_trigger` |
| `GQC-AUDIO-006` | Launch stereo master targets -14 LUFS integrated +/-1 LU and true peak <= -1.0 dBTP; no sample clipping. | `repair_trigger` |
| `GQC-AUDIO-007` | No unauthorized or unprovenanced music, SFX, shloka, or recording enters the mix. | `hard_block_stage` |

Loudness targets are pinned per export profile. Changing a target creates a new
mix/master version and invalidates the previous export verdict.

### 5.9 `SCENE_CONTINUITY`

| Rule ID | Requirement | Effect |
|---|---|---|
| `GQC-CONT-001` | Adjacent-shot identity, costume, ornament, prop, and deity attributes are continuous unless the script/plan declares a transition. | `repair_trigger` |
| `GQC-CONT-002` | Location geometry or atmospheric recipe remains class-appropriately coherent. | `repair_trigger` |
| `GQC-CONT-003` | Eyelines, 180-degree relationship, screen direction, dominance, and movement continuity remain inferable. | `repair_trigger` |
| `GQC-CONT-004` | Grade, lighting direction, contrast, black level, and palette do not create an unintended slideshow effect. | `repair_trigger` |
| `GQC-CONT-005` | Audio bridges and ambience prevent unintended scene seams. | `repair_trigger` |
| `GQC-CONT-006` | Series identity/look drift is measured against the pinned Series Release, never a mutable latest version. | `repair_trigger` |

Any continuity issue that causes identity confusion, wrong deity attributes, or
story incomprehension escalates to `hard_block_stage`.

### 5.10 `MASTER_RELEASE`

The full visual rubric runs in `finished_episode` mode. Every applicable source
parameter must have valid timestamp evidence. Narration-only adapters apply.
`production_feasibility` is evaluated using the film and pinned production
telemetry, not guessed from pixels alone.

Automated target:

- OVS >= 82.0;
- CVP >= 78.0;
- PFS >= 70.0;
- LCR <= 30.0;
- no source visual gate;
- visual confidence >= 80.0.

Minimum threshold to enter final human review:

- OVS >= 74.0;
- LCR <= 50.0;
- no source visual gate;
- visual confidence >= 80.0;
- all operational and cultural release conditions below pass.

An episode below the minimum remains in automatic repair or
`quality_blocked`; it is not presented as a passing candidate.

| Rule ID | Release requirement |
|---|---|
| `GQC-MASTER-001` | The master is the exact output of the pinned EDD and dependency versions. |
| `GQC-MASTER-002` | Zero unresolved critical or major defects. |
| `GQC-MASTER-003` | Zero confirmed AI-artifact glitches during the provisional period; hero-shot glitch budget is always zero. |
| `GQC-MASTER-004` | Full visual rubric satisfies the minimum threshold above. |
| `GQC-MASTER-005` | Raw Unicode, uploaded-source bytes when applicable, processing map, spoken narration, alignment, and captions reconcile under `GQC-SCRIPT-*` and `GQC-VOICE-*`. |
| `GQC-MASTER-006` | Machine/source cultural readiness is `eligible` and a separate qualified human cultural decision is `qualified_approved` for this exact master, policy, source set, evidence set, and competency version. |
| `GQC-MASTER-007` | No stale, superseded, unverified, or missing dependency exists. |
| `GQC-MASTER-008` | Evidence bundle is complete and content-hashed. |
| `GQC-MASTER-009` | Required independent evaluator agreement is complete. |
| `GQC-MASTER-010` | A permitted human approves the exact master version shown. |

The script rubric may also run in `finished_episode` mode for diagnostics and
future calibration, but its score remains advisory. Text-originated weaknesses
cannot block release. Execution failures revealed by that evaluation must be
expressed through a separate operational visual, audio, integrity, or
continuity rule before they can trigger repair.

### 5.11 `EXPORT_ACCEPTANCE`

| Rule ID | Requirement | Effect |
|---|---|---|
| `GQC-EXPORT-001` | Export references an approved, non-stale master version and its exact release verdict. | `hard_block_export` |
| `GQC-EXPORT-002` | MP4 probes, decodes, is 9:16, has expected duration, audio streams, and no truncated tail. | `hard_block_export` |
| `GQC-EXPORT-003` | Captions, stems, timeline, reports, provenance, and checksums in the requested package are complete. | `hard_block_export` |
| `GQC-EXPORT-004` | Review, approved, and superseded masters are unmistakably labelled and cannot share a mutable URL identity. | `hard_block_export` |
| `GQC-EXPORT-005` | Package checksum manifest verifies after upload and again when a signed download is issued. | `hard_block_export` |

## 6. Narration-only rubric adaptation

Semantic adapters must be explicit records. They do not edit the vendored JSON.

| Source item | Launch behavior |
|---|---|
| `CHK-lip_sync` | `not_applicable`, reason `narration_only_no_on_camera_dialogue` |
| `CHK-dialogue_masking` | Display and evaluate as narration masking; source check stays advisory; `GQC-AUDIO-001` independently blocks masking |
| `RUB-SCRIPT-dialogue_economy` | Evaluate narration economy, speakability, breath, specificity, captionability, and story work per word |
| `RUB-VISUAL-sound_music` | Replace every evaluator reference to dialogue/speech with locked narration; preserve 1-10 anchors' severity intent |
| `RUB-VISUAL-performance_capture` | Evaluate whether generated physical performance, framing, holds, and editorial selection carry the intended emotion |
| `RUB-VISUAL-production_feasibility` | Plan: generation feasibility. Final: observed execution feasibility using production telemetry |
| Script monetization/paywall language | Evaluate production/platform compliance and social-feed viability; do not invent a paywall requirement |
| Script/visual cliffhanger parameters | Apply only when `continuationExpected=true`; otherwise `not_applicable` |
| Script `series_continuity` | Apply for a Series episode with available pinned context; `not_applicable` for an explicitly standalone production |
| Reveal parameters | A devotional revelation may be a divine recognition, moral reversal, boon/curse consequence, or status/knowledge shift; it need not be a sensational twist |

An adapter must preserve the source parameter's underlying construct. If it
cannot, the parameter is `not_applicable`; it must not be assigned a convenient
score.

## 7. Source checks versus operational defects

Every `CHK-*` result remains advisory, exactly as `checks.v1.json` requires.
The mapping below creates independent Genie rules:

| Source check | Genie operational rule | Operational effect |
|---|---|---|
| `morphing_faces` | `GQC-CLIP-002`, `GQC-MASTER-002/003` | Repair; block unresolved release |
| `continuity_drift` | `GQC-CONT-001/002/006` | Repair; block if identity/story critical |
| `lip_sync` | None | `not_applicable` |
| `anatomy_text_artifacts` | `GQC-FRAME-003`, `GQC-CLIP-005` | Repair; critical anatomy/story text blocks |
| `caption_collision` | `GQC-AUDIO-005` | Critical collision blocks; otherwise repair |
| `reveal_proof_reaction` | `GQC-PLAN-009`, source reveal gate | Repair when reveal is applicable |
| `dialogue_masking` | `GQC-AUDIO-001` as narration masking | Hard block |
| `eyeline_continuity` | `GQC-CONT-003` | Repair; block if spatial comprehension fails |
| `insert_readability` | `GQC-PLAN-009`, `GQC-MASTER-002` | Repair; critical unreadable proof blocks |
| `hook_visual` | Plan/final hook parameter and gate | Repair |
| `cliffhanger_visual` | Cliffhanger parameter when continuation is expected | Repair |
| `safe_area_text` | `GQC-PLAN-008`, `GQC-AUDIO-005` | Repair or critical block |

Promotable moments remain non-scored editorial metadata. Their absence never
blocks release.

## 8. Deterministic scoring and verdict math

### 8.1 General rules

1. Each evaluator call emits integer parameter scores from 1 through 10.
2. Scores outside the range, unknown IDs, missing required evidence, or invalid
   applicability are rejected, not clamped.
3. Context shifts multiply base weight by `1.2` for every applicable `up` and
   `0.8` for every applicable `down`, stacking multiplicatively.
4. Applicable weights are renormalized to exactly 100 before weighted
   composites.
5. Calculations use decimal arithmetic at full stored precision.
6. Clamping occurs only where the source config specifies it.
7. Threshold comparisons use unrounded values.
8. Display values round half-up to one decimal place.
9. Gates are evaluated from consensus parameter scores after composites.
10. Verdict ladders are evaluated top-down; the first matching band wins; then
    gate caps/force-bottom rules apply.
11. Fix-first priority uses the source formula and unrounded effective weight.
12. Deterministic code, never an LLM, performs these operations.

### 8.2 `not_applicable` projection

A parameter may be removed only by this pinned profile, not by an evaluator.

For a weighted composite:

```text
projected = 10 * SUM(applicable effective_weight_i * score_i)
                  / SUM(applicable effective_weight_i)
```

For a positive linear composite whose coefficients normally sum to one:

```text
projected = 10 * SUM(applicable coefficient_i * score_i)
                  / SUM(applicable coefficient_i)
```

Risk composites retain their source intercept and are projected only when this
contract supplies a stage-specific formula. Required risk inputs
`localization_fit`, `monetization_compliance`, `localization_compliance`,
`subtitle_ui_safety`, `visual_story_clarity`, and `sound_music` are therefore
never optional in the launch profile.

Every projected composite stores the removed IDs and denominator. A projected
score is not presented as directly comparable to an unprojected score unless
the same applicability profile was used.

### 8.3 Visual formulas

The runtime implements `visual.v1.json` literally:

```text
OVS = SUM(score_i * effectiveWeight_i) / 10

CVP = 10 * (
  0.22 * first_frame_hook +
  0.14 * emotional_readability +
  0.14 * visual_escalation +
  0.18 * reveal_execution +
  0.20 * cliffhanger_image +
  0.12 * edit_rhythm
)

VCS = 10 * (
  0.18 * vertical_composition +
  0.20 * visual_story_clarity +
  0.16 * blocking_power_geometry +
  0.12 * shot_economy +
  0.14 * performance_capture +
  0.10 * sound_music +
  0.10 * subtitle_ui_safety
)

PFS = 10 * (
  0.35 * production_feasibility +
  0.20 * shot_economy +
  0.20 * blocking_power_geometry +
  0.15 * edit_rhythm +
  0.10 * subtitle_ui_safety
)

LCR = clamp(
  100 - 10 * (
    0.45 * localization_compliance +
    0.25 * subtitle_ui_safety +
    0.15 * visual_story_clarity +
    0.15 * sound_music
  ),
  0, 100
)
```

A `policy_counsel_flag` floors LCR at 70, but a cultural/policy block does not
depend on LCR and cannot be averaged away.

Visual ladder:

- `approve`: OVS >= 82, CVP >= 78, PFS >= 70, LCR <= 30, no gate;
- `approve_minor_fixes`: OVS >= 74, LCR <= 50, no gate;
- `recut`: OVS >= 55;
- otherwise `reject_visual_plan`.

Source gate operators are exact: visual gate thresholds use `<= 3`, except
localization uses `<= 2`.

### 8.4 Script formulas

The runtime implements `script.v1.json` literally after applicability
projection:

```text
CQ = 10 * SUM(applicable effectiveWeight_i * score_i)
          / SUM(applicable effectiveWeight_i)

CP = 10 * (
  0.25 * opening_hook +
  0.20 * conflict_stakes +
  0.20 * cliffhanger_pull +
  0.15 * genre_freshness +
  0.10 * localization_fit +
  0.10 * monetization_compliance
)

R = clamp(
  100 - 10 * (
    0.40 * localization_fit +
    0.60 * monetization_compliance
  ) + severe_flag_adjustment,
  0, 100
)

Overall = clamp(0.60 * CQ + 0.30 * CP - 0.10 * R, 0, 100)
```

The severe flag adjustment is +15. Source script gate operators use `< 4`.
Their effects are advisory in Genie.

### 8.5 Golden math cases

Implementations must pass at least:

- all visual parameters = 7, no shifts: OVS = 70.0 and LCR = 30.0;
- all visual parameters = 8, no shifts: OVS = 80.0, CVP = 80.0,
  PFS = 80.0, LCR = 20.0, verdict `approve_minor_fixes`;
- all visual parameters = 9, no shifts: OVS/CVP/PFS = 90.0, LCR = 10.0,
  verdict `approve`;
- all script parameters = 8, no shifts/flags: CQ = 80.0, CP = 80.0,
  R = 20.0, Overall = 70.0;
- all script parameters = 10, no shifts/flags: CQ = 100.0, CP = 100.0,
  R = 0.0, Overall = 90.0;
- a visual hook score of 3 triggers the applicable hook gate; 4 does not;
- a script hook score of 3 triggers its advisory gate; 4 does not;
- a standalone episode removes both cliffhanger parameters through the pinned
  profile and records the projected denominator.

## 9. Evidence and confidence

### 9.1 Evidence schema

Every scored or failed call contains:

```text
rule_or_parameter_id
result
severity
evidence_type
asset_version_id
timestamp_start_ms
timestamp_end_ms
frame_number(s)
shot_id / scene_id / track_id
script Unicode offsets when text-derived
reference/version compared against
short observable rationale
evaluator_run_id or detector_run_id
confidence
```

Evidence must describe observable facts, not hidden reasoning. Raw
chain-of-thought is neither requested nor stored.

### 9.2 Minimum evidence

- Every applicable final visual parameter requires at least one valid timestamp
  or time-range item.
- A score of 1-4, a source gate, or a major/critical defect requires at least
  two corroborating evidence items, unless a deterministic check alone proves
  the condition.
- First-frame hook evidence must include the first 2.5 seconds.
- Cliffhanger evidence, when applicable, must include the final 8% of runtime.
- Reveal evidence must identify proof and reaction ranges.
- Identity/continuity evidence must name the pinned reference version.
- Narration mismatch evidence must include locked-script offsets and aligned
  audio time.
- Cultural findings must cite the pinned policy, source, tradition sheet,
  temple reference, or attribute manifest used.

Evidence that points to a stale or different asset version is invalid.

### 9.3 Confidence

Source confidence formulas are computed exactly. Additional operational rules:

- script confidence affects the strength of advice, never script acceptance;
- plan confidence must be >= 75;
- final visual confidence must be >= 80;
- evidence density for required plan/final parameters must be 100%;
- a required rule with insufficient evidence is `indeterminate` and fails
  closed;
- confidence must not be increased manually without a new evaluator/evidence
  run.

The visual source formula is:

```text
0.45 * InputCompleteness +
0.25 * EvidenceDensity +
0.20 * ModeAppropriateness +
0.10 * EvaluatorCertainty
```

`paywallPosition=not_applicable` counts as explicitly complete but activates no
paywall adjustment. Evaluator certainty uses the source spread threshold of
three points.

The script source confidence begins at 100 and subtracts:

- 20 when Series context is absent;
- 15 when episode position is absent;
- 15 when market/language is absent;
- 10 when platform model is absent;
- 10 in `outline_only` mode;
- 10 when prior-episode availability is unspecified;
- 5 per rejected parameter call, capped at 20;
- 2 per parameter whose independent-run spread is at least three, capped at 10.

The result is clamped to 0-100. Explicit `standalone`, `not_applicable`, or
`false` metadata counts as supplied context; an absent value does not.

## 10. Independent evaluators

### 10.1 Independence requirements

An evaluator is independent only when:

- it is not the same invocation that generated or planned the candidate;
- it receives the candidate, pinned intent, references, and rubric, but not
  another judge's score or conclusion;
- its prompt and response are versioned;
- it cannot mutate production state;
- its provider/model identity is recorded;
- where two evaluators are required, they use different model families or
  independently deployed evaluator configurations. Two temperatures of one
  call do not count as independent.

The QC Jury recommends; deterministic policy code transitions state.

### 10.2 Required evaluation pattern

| Checkpoint | Requirement |
|---|---|
| Script preflight | One evaluator; a second independent call for any source gate, confidence < 70, or score spread discovered by retry |
| Plan preflight | One full evaluator plus independent challenge of every score <= 4, every triggered gate, and the six high-leverage parameters: hook, clarity, reveal, escalation, cliffhanger when applicable, feasibility |
| Keyframe/clip | Deterministic/ML checks plus one VLM; a second VLM for ambiguous, major, critical, deity-attribute, dignity, or cultural findings |
| Final master | Two independent full visual-rubric evaluations |
| Cultural approval | Automated Cultural Guardian plus a separate qualified human decision for every launch master |

Consensus scoring is deterministic:

1. equal scores: use that score;
2. scores differing by one: use the lower score;
3. scores differing by two or more: run a third independent evaluator and use
   the median of three;
4. if a third run is unavailable, the parameter is `indeterminate`.

For defects, one credible critical finding quarantines the candidate. It is not
cleared by averaging. A deterministic disproval, an independent adjudication,
or qualified human review is required.

## 11. Cultural and theological eligibility

### 11.1 Separation from rubric quality

`localization_fit`, `localization_compliance`, Risk, and LCR do not constitute
cultural approval. The cultural state is a separate record:

```text
eligible
needs_evidence
needs_repair
needs_qualified_review
qualified_approved
blocked
```

`eligible` is the machine/source-readiness precondition that allows a candidate
to enter final human review. It never releases a master. Only a separate
`qualified_approved` human decision bound to the exact master can satisfy the
human cultural conjunct of `GQC-MASTER-006`.

### 11.2 Stable cultural rules

| Rule ID | Requirement | Effect |
|---|---|---|
| `GQC-CULT-001` | No nudity or sexualized framing of deities/revered figures. | Non-overridable `hard_block_release` |
| `GQC-CULT-002` | No religious-conflict, interfaith mockery/comparison, or deity-ranking staging. | Non-overridable `hard_block_release` |
| `GQC-CULT-003` | Deity form, topology, attributes, hand assignments, ornaments, vahana, costume, skin/form rules, and dignity match the pinned tradition manifest. | Repair; critical mismatch blocks |
| `GQC-CULT-004` | Canonical, regional-tradition, and popular-retelling claims are labelled distinctly and supported. | `hard_block_release` while evidence is missing; otherwise `repair_trigger` for mislabelling |
| `GQC-CULT-005` | Named temple depictions use researched real architectural evidence and do not invent a specific consecrated murti/ritual. | `hard_block_release` until corrected/evidenced |
| `GQC-CULT-006` | Depicted ritual matches a cited approved ritual template; no fabricated worship act. | `hard_block_release` until corrected/evidenced |
| `GQC-CULT-007` | Violence and romance use the restraint and dignity of mainstream Indian devotional cinema. | Repair; severe violation blocks |
| `GQC-CULT-008` | Caste/social roles may be historically realistic but not humiliating, stereotyped, or framed as present-day hate. | Repair; hate framing blocks |
| `GQC-CULT-009` | Shloka/source/rights/pronunciation evidence is complete. Vedic samhita and bija-mantra lanes require approved human recordings unless policy changes. | `hard_block_release` |
| `GQC-CULT-010` | Thumbnail, cliffhanger freeze, and every reusable standalone frame remain dignified without narration context. | Repair |
| `GQC-CULT-011` | Regional/counter-veneration sensitivity and release targeting are explicitly reviewed when triggered. | `needs_qualified_review` |
| `GQC-CULT-012` | No real living guru is portrayed without a separately approved rights/policy workflow. | `hard_block_release` |

### 11.3 Universal launch approval and enhanced-review triggers

Every Genie launch master requires a separate qualified cultural approval.
This is deliberately stricter than a sensitivity-only policy because the
product's entire launch scope is Hindu devotional mythology. The following
conditions additionally determine the required competency scope, evidence
depth, and whether specialist or dual-review escalation is needed:

- an on-screen deity or revered figure;
- a shloka, mantra, ritual, consecrated temple, or named temple;
- a contested or region-specific retelling;
- counter-venerated antagonists;
- caste, romantic, or material violence involving revered figures;
- an automated cultural finding of `major`, `critical`, or `indeterminate`.

The same person may perform final creative approval and cultural approval only
if they hold the required reviewer competency, but the system stores two
separate version-bound decisions. A cultural override must cite the exact rule,
evidence, rationale, actor, competency, and master version. Non-overridable
rules cannot be waived.

## 12. Provisional operation and calibration gates

### 12.1 Provisional behavior

Until `calibration_state=production_calibrated`:

- every automated score and quality verdict displays `Provisional`;
- every released master requires human final approval;
- every master requires the separate qualified cultural approval;
- automated plan repair and defect repair may run normally;
- deterministic integrity, rights, security, and non-overridable cultural
  rules remain hard blocks;
- no quality threshold may be relaxed because cost or time is exhausted;
- a failed or uncertain evaluator cannot be treated as a pass;
- confirmed AI-artifact glitch budget is zero.

The first 10–20 benchmark Episodes/scripts do not block implementation. They
form a pilot/tuning set only and cannot by themselves support a
production-calibrated claim.

### 12.2 Rubric calibration gate

`CAL-RUBRIC-001` passes only when:

1. a predeclared stratified corpus contains at least 50 representative
   Episodes: at least 30 calibration Episodes and an independent untouched
   holdout of at least 20;
2. supported cells/slices are declared by look family, provider lane, deity/
   entity complexity, temple/ritual sensitivity, pacing, and motion class;
3. benchmarks include strong, weak, culturally sensitive, slow devotional, and
   high-motion mythology examples;
4. at least two qualified humans provide blinded rankings and defect labels;
5. evaluator re-run spread, human rank agreement, false-ready rate,
   false-block rate, confidence intervals, and per-slice results are reported;
6. no benchmark with a human-labelled critical defect receives an automated
   releasable decision;
7. threshold changes are versioned, reviewed, replayed against calibration, and
   evaluated once against the untouched holdout;
8. an uncalibrated slice retains conservative routing or human review rather
   than inheriting a global pass claim.

The initial production-calibration promotion gate is:

- Spearman rank correlation >= 0.70 against median human ranking;
- weighted kappa >= 0.60 on release bands;
- critical-defect recall = 100% on the benchmark set;
- false-ready rate <= 5%;
- median per-parameter cross-run spread <= 1 point;
- no more than 10% of parameters with spread >= 3.

Failing any item keeps the system provisional. A later contract version may
change these values only through a benchmark replay and reviewed calibration
report. These are calibration gates, not claims about current performance.

### 12.3 Detector calibration gate

Each detector threshold is versioned per relevant class, such as:

```text
detector_version x look_id x entity_kind x deity_form x provider_lane
```

For a critical deity topology/attribute detector to authorize free motion:

- test data must include real passing renders and seeded extra/missing limb,
  wrong-hand object, merged object, transient mid-clip, and occlusion defects;
- the test set and labels are independent of training;
- each promoted threshold cell has at least 100 critical-positive clips/frames
  and 100 representative passing negatives;
- critical-defect recall must be 100% on the fixed release set;
- the lower 95% Wilson bound for critical recall must be >= 0.95;
- false-positive rate must be <= 10%, and its upper 95% Wilson bound must be
  <= 15%;
- failures are reported per deity form, not hidden in a global average.

If the gate does not pass, the lane remains camera-on-keyframe or human-reviewed
and cannot silently use an uncalibrated numeric threshold.

### 12.4 Identity and visual metric calibration

Identity embeddings, skin/form color tolerances, flicker, optical flow,
luminance, and aesthetic floors require per-look/per-kind validation. Before a
threshold cell passes:

- the metric may rank candidates;
- it may trigger a second evaluator;
- it may not be the sole proof of pass or failure;
- critical release decisions require corroborating evidence.

## 13. Repair routing

### 13.1 Deterministic route table

| Failure class | Primary route | Escalation |
|---|---|---|
| Script checksum/text mutation | Restore locked version and invalidate all dependent artifacts | Explicit script-revision workflow; never auto-edit |
| Narration word/pronunciation/performance | Regenerate affected narration segment with same words/voice; realign; remix | Full narration rerender if seams/timing cannot be repaired |
| Score/SFX/ambience masking | Remix automation, replace/retime stem | Replace score arrangement; never regenerate video first |
| Caption collision/timing | Re-render captions or reframe/retrim affected shot | Regenerate shot only if critical action cannot be safely reframed |
| Edit rhythm/shot economy | EDD recut/retrim/reorder within locked semantic order | Regenerate missing coverage |
| Missing proof/reaction | Generate the smallest required insert/reaction package | Replan the affected beat/scene |
| Keyframe anatomy/attribute/identity | Critique-conditioned keyframe regeneration | Provider/model lane switch or safe locked-keyframe fallback |
| Temporal morph/anatomy/topology | Regenerate containing clip; model switch for repeated class failure | Replan motion or use camera-on-keyframe |
| Character/location continuity | Regenerate affected shot using canonical anchors; color/grade conform where sufficient | Repair dependency closure across adjacent shots/scene |
| Cultural/iconographic/ritual defect | Correct manifest/reference/plan and regenerate all affected assets | Qualified review; non-overridable prohibition remains blocked |
| Hook/clarity/escalation/cliffhanger weakness | Replan/re-edit the smallest beat range | Scene replan; never rewrite locked script automatically |
| Provider/capability infeasibility | Route to a prequalified compatible lane and requote | Replan shot or wait for explicit budget/config decision |

The source labels map as follows:

- `recut` -> EDD repair;
- `reshoot_inserts` -> regenerate proof/reaction/insert coverage;
- `reshoot_scene` -> use the evidence-derived audio, clip, or scene route;
- `rewrite_before_shoot` -> replan visuals/performance/sound, not script;
- `reject_visual_plan` -> quarantine and require plan/cultural correction.

### 13.2 Bounded retries

Every repair has:

- input and target version;
- failure class and evidence;
- expected affected dependency closure;
- candidate/time/dollar ceiling;
- provider and fallback lane;
- stop conditions;
- rollback target.

Keep-best means only candidates above all non-negotiable floors are eligible.
Budget exhaustion never converts a failing candidate into a pass. Exhaustion
routes to a safe fallback, a replan, or `quality_blocked`.

## 14. Regression QC

Every repair produces a new immutable branch and runs:

1. the exact failed local rules;
2. all rules applicable to the newly generated asset;
3. before/after boundary checks;
4. scene continuity checks;
5. affected audio/caption/grade/dependency checks;
6. full `MASTER_RELEASE` QC;
7. a differential comparison with the base master.

Stable regression rules:

| Rule ID | Requirement |
|---|---|
| `GQC-REPAIR-001` | Repair plan is linked to feedback rows and a base master version. |
| `GQC-REPAIR-002` | The dependency closure is complete; no downstream artifact remains silently stale. |
| `GQC-REPAIR-003` | Every originally blocking defect is resolved or explicitly remains blocked. |
| `GQC-REPAIR-004` | No new critical/major defect appears locally, at boundaries, or in the full master. |
| `GQC-REPAIR-005` | Locked script, voice identity, look, world versions, and requested invariants remain unchanged unless the approved plan explicitly versions a permitted change. |
| `GQC-REPAIR-006` | Unaffected deterministic assets retain hashes; perceptually changed regions outside the dependency closure are investigated. |
| `GQC-REPAIR-007` | Final visual threshold and confidence are recomputed; old scores are never copied forward. |
| `GQC-REPAIR-008` | A drop of >= 2 points in any non-targeted high-leverage visual parameter triggers independent adjudication. |
| `GQC-REPAIR-009` | The base master remains available for A/B review and rollback. |

A local pass is insufficient. Only the new full-master verdict can make a
repair branch ready for approval.

## 15. Configuration and version pinning

A release verdict pins:

- QC contract ID/version/hash;
- applicability profile ID/version/hash;
- all three source rubric IDs/versions/hashes;
- semantic adapter version;
- evaluator prompts/models/providers;
- detector code/model/threshold versions;
- calibration dataset/report version and state;
- episode configuration and Series Release;
- script, voice, look, character, form, wardrobe, location, score, and
  pronunciation versions;
- provider capability/rate snapshot;
- EDD, captions, mix, master, and evidence bundle versions.

Changing any pinned input:

1. creates a new candidate/configuration version;
2. marks affected verdicts stale;
3. computes the dependency closure;
4. requires new QC for that closure and a new full-master verdict;
5. never mutates historical records.

Config promotion requires schema validation, golden math tests, benchmark replay
where applicable, migration notes, rollback instructions, and an explicit
activation time. Active in-flight runs continue on their pinned version unless
a critical policy revocation forces quarantine.

## 16. Final release decision

The server computes:

```text
ready_for_human_review =
  master_integrity_pass
  AND script_voice_caption_integrity_pass
  AND operational_defects_pass
  AND visual_minimum_pass
  AND evidence_confidence_pass
  AND cultural_eligibility_pass
  AND no_stale_dependencies
  AND repair_regression_pass_if_applicable

approved =
  ready_for_human_review
  AND final_human_approval_matches_exact_master_version
  AND qualified_cultural_approval_matches_exact_master_version
```

At launch, there is no automated `approved` path. The UI may say:

- `Monica is repairing`;
- `Quality blocked`;
- `Ready for your review - provisional automated QC passed`;
- `Approved`;
- `Superseded`.

It must not say `Ready to publish` based only on a rubric band while another
release conjunct is missing.

## 17. Implementation acceptance criteria

The QC/release implementation is accepted only when the following are
automated tests or reproducible evidence:

| ID | Acceptance criterion |
|---|---|
| `AC-QC-001` | Source JSON schema, ID, version, and SHA validation fail closed. |
| `AC-QC-002` | Every verdict stores all pin fields in Section 15. |
| `AC-QC-003` | Golden math cases in Section 8.5 pass exactly before display rounding. |
| `AC-QC-004` | Context weight shifts stack multiplicatively and renormalize to 100. |
| `AC-QC-005` | Gate boundary tests prove visual `<=3`, localization `<=2`, and script `<4` behavior. |
| `AC-QC-006` | `not_applicable` parameters are excluded by the projection formula and never counted as passes. |
| `AC-QC-007` | Lip-sync is always `not_applicable` for the launch profile. |
| `AC-QC-008` | Narration adapters never emit or require on-camera dialogue evidence. |
| `AC-QC-009` | A script-rubric gate cannot mutate the script or block it solely due to score. |
| `AC-QC-010` | Any raw Unicode mutation, processing-map mismatch, or uploaded-source byte mutation invalidates downstream approval. |
| `AC-QC-011` | A seeded spoken insertion/deletion/substitution is detected or becomes `indeterminate`, never pass. |
| `AC-QC-012` | Caption text derives from locked words and remains exact after alignment. |
| `AC-QC-013` | Narration duration outside 60-120 seconds blocks the launch configuration. |
| `AC-QC-014` | A failing keyframe cannot enqueue video generation. |
| `AC-QC-015` | Seeded face morph, object pop, extra/missing limb, wrong-hand object, and identity swap are routed to the correct operational rule. |
| `AC-QC-016` | A `CHK-*` warning alone never gates, while its mapped `GQC-*` defect can gate independently. |
| `AC-QC-017` | Narration masking routes to remix/audio repair, not blind scene regeneration. |
| `AC-QC-018` | Story-critical caption collision blocks; a non-critical collision creates a bounded repair. |
| `AC-QC-019` | Standalone/finale fixtures disable cliffhanger parameters and gates deterministically. |
| `AC-QC-020` | A reveal fixture requires proof/reaction evidence; non-reveal fixtures do not. |
| `AC-QC-021` | Plan OVS/CVP/PFS/confidence floors route to bounded replan and block video spend after exhaustion. |
| `AC-QC-022` | Every required final parameter has valid version-matched timestamp evidence. |
| `AC-QC-023` | Two independent final judges run; disagreement follows the deterministic consensus algorithm. |
| `AC-QC-024` | One credible critical finding quarantines a candidate and cannot be averaged away. |
| `AC-QC-025` | A high OVS cannot override a cultural, integrity, rights, stale-version, or defect block. |
| `AC-QC-026` | Named-temple, ritual, deity-attribute, shloka, and contested-retelling fixtures create separate cultural decisions. |
| `AC-QC-027` | Non-overridable cultural rules reject attempted overrides. |
| `AC-QC-028` | A qualified cultural approval is a separate record from creative final approval. |
| `AC-QC-029` | Before calibration, every automated verdict is labelled provisional and every release requires human approval. |
| `AC-QC-030` | Uncalibrated identity/detector metrics cannot act as sole proof. |
| `AC-QC-031` | Complex deity motion cannot use a lane whose detector/provider calibration cell is not passed. |
| `AC-QC-032` | A repair creates a new master; it never overwrites the base master. |
| `AC-QC-033` | A repaired shot reruns local, boundary, dependency, scene, and full-master QC. |
| `AC-QC-034` | Seeded regressions outside the requested repair range are detected and investigated. |
| `AC-QC-035` | Stale provider callbacks and stale QC results cannot approve or overwrite a newer version. |
| `AC-QC-036` | Budget exhaustion leaves a failing asset blocked; it never lowers a threshold. |
| `AC-QC-037` | Final review approval uses compare-and-swap against the exact reviewed master. |
| `AC-QC-038` | An export cannot package a stale, unapproved, or mismatched master. |
| `AC-QC-039` | Export checksum verification catches post-package corruption. |
| `AC-QC-040` | Replaying a historical verdict with its pinned versions reproduces its deterministic math and gate outcome. |

## 18. Non-negotiable invariants

1. The user's locked script is never silently changed.
2. A score never cancels a defect.
3. A quality score never constitutes cultural approval.
4. Missing evidence is never a pass.
5. `not_applicable` is never a pass.
6. A failing keyframe never advances to motion.
7. A local repair never skips full-master regression.
8. Budget and deadline pressure never lower a quality threshold.
9. An uncalibrated metric never becomes sole proof by convenience.
10. Every approval is bound to exact immutable versions.

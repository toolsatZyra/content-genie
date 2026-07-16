# Archived research design — superseded

> This document preserves the detailed research specification completed on
> 2026-07-10. It is not the active build contract. Several launch decisions
> changed after this version, including narration-only scripts, the 117-look
> vault, the autonomous post-world-lock flow, Monica's structured Repair Room,
> multi-user launch scope, and Supabase-only diagnostics.
>
> The authoritative design is [`../design.md`](../design.md).

# Zyra Studio — Design Specification

**What this is:** the complete design for Zyra Studio — an internal, multi-user, agent-native web application that turns a micro-drama script from Indian scriptures into a finished, vertical (9:16), 60–120 second episode, autonomously produced by a crew of AI agents on a durable production pipeline. This document is the build contract: an implementation agent should be able to construct the system from this specification plus the reference materials listed in §21.

---

## 1. Product

**The job.** A small internal team (Zyra Internal) produces respectful, high-quality devotional/mythological micro-drama episodes at daily cadence. A member supplies a script (optionally a human-recorded voice-over and character reference photos); the system plans, casts, generates, edits, quality-controls, and packages the episode, pausing at configurable green-light gates for human approval.

**Per-episode deliverables — always three:**
1. `final.mp4` — 1080×1920, 9:16, 30fps, mixed to −14 LUFS, captions burned in, AI-labeled and C2PA-signed.
2. `bundle.zip` — every untrimmed generated clip (with edit handles), all audio stems (narration, score, ambience, SFX), captions (SRT/ASS/JSON), timeline files, QC + cost reports; every asset C2PA-signed; relative paths.
3. `edit.otio` + `edit_fcp7.xml` — a Premiere-importable timeline of the exact edit: video track + four audio tracks, real cross-dissolves, raw clips with handles, beat/SFX/transition markers.

Plus: 1–3 **promotable moments** — automatically extracted 3–15s ad-clips of the episode's most scroll-stopping beats, each with a suggested caption.

**The quality bar** (what "good" means, in priority order): natural and cinematic to watch; free of AI-induced glitches (identity drift, morphing, extra limbs, flicker, audio desync); comparable to professionally made vertical dramas; well-told and engaging (a viewer finishes and taps the next episode); culturally respectful and safe.

**Languages:** Hindi first; Sanskrit shlokas from a cleared library; regional languages (Tamil, Telugu, Bengali, Marathi, …) are architecturally supported from day one but each launches only through a per-language readiness gate (§11). English available.

**Positioning:** an internal studio tool (single team, bring-your-own API keys, no billing engine), built tenant-ready so multi-team or SaaS later is a configuration change, not a rewrite.

---

## 2. Design decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Audio-first, narration-driven pipeline.** The narration track is the master clock; every shot's duration derives from word-level timestamps *before* any video is generated. Dialogue is an optional "spoken moment" tier (1–2 shots per episode, flagged), not the core mode. | No leading video model supports Hindi lip-sync (Kling 3.0 covers zh/en/ja/ko/es only, including for uploaded audio; Veo's Hindi support is unverified). The one high-profile dialogue-driven AI mythology series (JioHotstar's *Mahabharat: Ek Dharmayudh*, 2025) was publicly criticized for lip-sync and AV-desync failures. The devotional channels that monetize reliably are narration + shloka format. Audio-first also makes sync a construction property — the edit exists before the pixels — and makes the Premiere timeline trivial to emit. |
| D2 | **A durable, deterministic pipeline spine with an agent "Director" layer on top.** Fixed, idempotent stages run on a job runner; one agent session per episode plans, adjudicates QC verdicts, decides retries, and takes mid-flight instructions. | Research on multi-agent filmmaking (FilmAgent, MovieAgent, ViMax) shows critic/verifier loops and typed plan artifacts add measurable quality while free-form agent role-play adds none. Fixed stages are knowable in advance → workflow; judgment (QC, retries, steering) varies per run → agent. |
| D3 | **Agent-native = a first-party MCP tool surface.** Domain verbs (`episode.create`, `gate.approve`, `shot.revise`, `episode.export`…) plus a `pending_inputs` enumeration and resolution verbs, so an external agent can run an entire episode headlessly and never wedges on a gate, a flagged shot, or a budget approval. | Flagged shots and budget approvals are the *expected* case, not the exception; a bare `input_required` state is too coarse for headless drivers. |
| D4 | **Series-first data model; episodes pin immutable asset versions (a lockfile).** The pin is written at Gate A and is the only canon source for that episode, including steering-triggered regenerations; canon promotion affects only episodes pinned after it; cache keys include the pin version. | Mythology content is serialized (30+ episode arcs, recurring deities, cliffhanger chains). Identity assets (bibles, voices, looks, score themes) amortize across a series and must never mutate under an in-flight episode. Pinning gives reproducible re-renders forever. |
| D5 | **Provider-agnostic adapter layer.** Agents call capabilities (`gen_image`, `gen_video`, `gen_speech`, `judge`…); adapters route to providers. The routing table is data with `verified_at` timestamps; the quote engine refuses stale rows. | Models and prices change quarterly. No vendor may be load-bearing alone. |
| D6 | **Green-light gates A/B/C, configurable per series.** Gate approval pins a content-hash set (narration, shot list, quote version, manifest). Mutating a pinned artifact flips the gate stale → the episode re-enters `input_required` with a diff; auto-re-approve below a configurable delta (e.g. cost change <5%). | Unpinned gates would let post-approval steering spend outside the quote and would corrupt the audit record the legal defense depends on (§11). |
| D7 | **Per-language launch gates for regional languages.** Each language ships only with (a) a retained native-speaker/tradition reviewer, (b) per-language register rules, (c) a per-language TTS bake-off. | The human sign-off is the last line of cultural defense; shipping a language the reviewer cannot evaluate makes that defense blind to exactly the error classes (mispronounced shlokas, register slips) that trigger backlash. |
| D8 | **Cost: standard tier $15–40 per episode (median target ~$30) computed on pessimistic pricing; the Gate B quote total is an absolute-dollar hard cap**, escrowed as jobs enqueue; breach pauses the episode for approval. Budget tier ≈ $13; premium $75+. | Video generation is 70–85% of episode cost and per-second prices vary >2× between official APIs and resellers; envelopes quoted on promo pricing collapse when promos end. Escrow-at-enqueue is the only cap in-flight webhook-billed jobs cannot overshoot. |
| D9 | **Internal tool now, tenant-ready schema always.** `team_id`/`org_id` on every row; an append-only cost ledger from day one. | The ledger becomes the billing engine if the tool is ever productized; retrofitting tenancy is a rewrite. |
| D10 | **The cultural-safety engine is a core subsystem, not a filter** — regional iconography variants, revered-figure protections, shloka clearance lanes, counter-veneration handling, standalone-image dignity checks, post-publication monitoring, C2PA + AI-labeling compliance. | Documented enforcement reality in India: police complaints over AI deity imagery (Puri Jagannath temple, Jan 2026), criminal bookings under BNS 299/298/196/353 (Varanasi, 2026), and the Adipurush (2023) backlash — where *register* failure alone, not factual error, caused national outrage. MeitY's IT Rules (Feb 2026) mandate synthetic-media labeling, with a stricter always-visible-label draft pending. The audit trail of human review is the good-faith defense BNS 299's "deliberate and malicious" standard turns on. |
| D11 | **The soundtrack never comes from the clips.** One continuous, dramatically-arranged score bed per episode from a curated, pre-cleared, beat-gridded **Score Library**; scene-level ambience beds; a scale/impact layer for mythic beats; native model audio demoted to ambience/foley stems; deterministic ducking with a dynamic-range budget. Generative music is an offline library-extension lane, never the per-episode default. | Every shipped script-to-video product with traction uses a tagged library bed fitted deterministically and ducked under VO; per-clip native audio is the documented failure mode (cross-clip audio breakage). Music-generation licensing is volatile (post-settlement Suno/Udio); pre-generated, frozen, licensed tracks are immune. Library tracks carry pre-computed beat grids — available *before* shot planning, enabling beat-snapped cuts no script-first competitor ships. |
| D12 | **Multi-user team model.** Roles: admin · reviewer/approver (with per-language/tradition competency flags) · member · onboarding (limited). First user is admin of "Zyra Internal"; new sign-ups auto-join it in the onboarding role. Series have an owner and per-member ACL; shared canon is protected by advisory locks; gates and reviews are claimable team work-items with notifications. **Autonomy is risk-tiered:** low-risk content may earn auto-approval; on-screen deity / shloka / ritual content always requires one qualified reviewer sign-off and never auto-graduates. | A shared mutable series canon without ownership/locking corrupts reproducibility; episodes must not stall because their creator is offline (claimable gates); and the qualified sign-off on sensitive content *is* the legal shield — automating it away would discard the defense while keeping the risk. |
| D13 | **Voice is human-cast, and voice-over is optionally human-recorded.** Each character's and the narrator's voice is selected in a Voice Studio (browse a provider library, design a voice from a description, or clone from an upload with consent → audition → approve) and pinned to the series bible; agents choose per-shot performance and engine routing, never the voice identity. Per episode, narration can be the pinned series voice via TTS (default, for daily cadence), a re-picked voice (a special episode), or an uploaded VO file (human or AI) — uploaded VO is forced-aligned with an ASR-diff reconciliation step and holds the episode in `vo_pending` until audio arrives. A voice-clone bridge lets a recorded artist's voice later drive TTS episodes. | Human narration is the single largest quality lever for devotional content (dramatic Hindi prosody, correct Sanskrit recitation) and eliminates the synthetic-Vedic-recitation risk entirely. VO artists deviate from scripts (ad-libs, dropped particles, elongated shloka vowels), so the *actual* audio — not the written script — must become the clock: transcribe, diff, rewrite spans, flag large deviations; use segment-level alignment for chanting (word-level aligners are unreliable on melisma). |
| D14 | **Consistency = human-defined identity + machine-maintained.** A person casts each character once (upload reference photos or generate a portrait → generate a model sheet → iterate → approve) into the series bible; the approved clean portrait is the identity anchor for all keyframes. A **motion-conform layer** then maintains that identity through video: per-frame attribute/limb detection, deterministic skin-tone conform, temporal identity stability, keep-best-of-N retries, one pinned video model per character per episode, and camera-motion-on-locked-keyframe for complex multi-arm forms. | Reference-conditioned image generation holds identity for stills, but video models re-sample identity every frame — the approved sheet governs frame 0, not frames 1–120. The observed failure classes for this genre are precisely: arm-count/attribute errors on deities (off-the-shelf 2-arm pose models cannot count a 10-armed Durga), dark-skin (shyama-varna) drift toward lighter tones (invisible to embedding metrics, theologically loaded), and slow mid-clip morphing (invisible to first-frame checks and frame-sampled judges). Each gets a purpose-built check. |
| D15 | **Quality is an episode-level distribution target, not a per-shot average.** An episode-level gate (glitch budget: zero on hero shots) plus a scored quality rubric (§12) decide readiness; hero shots never terminate on a bare still-image fallback; the target is stated as a distribution (e.g. "P90 of a series' episodes ship with zero flagged glitch"). | Per-shot QC does not compose: at 96% per-shot glitch-free and ~15 cuts, only ~54% of episodes are clean; without an episode-level gate the majority of a season ships with a visible artifact. Fallbacks correlate with hero shots (deity reveals trip filters and fail retries most), so an undifferentiated fallback degrades exactly the most-watched frames. |
| D16 | **Look before cast; two production flows; batch is first-class.** The series look is chosen and locked *before* characters are generated (characters render inside the look). Flow A: new-series setup (look → cast → voices → score theme → series Gate A, once). Flow B: new-episode-in-series (paste script/VO → bible reused → only new characters cast → straight toward Gate B). Batch mode enqueues N episodes from a list of scripts with batch gate review. | Characters generated before the look is locked must be regenerated after it; daily cadence is impossible if every episode walks full pre-production; a series' episodes 2–N should cost one script paste and two gate approvals. |
| D17 | **The visual-direction and evaluation frameworks in §10 and §12 are adopted from the mobile-first microdrama research corpus** (§21), with deliberate divergences where AI generation differs from live-action shooting (lens strategy, feasibility → generability, no paywall economics). | The corpus provides microdrama-specific, duration-indexed numbers (shot counts, ASL, beat windows, safe zones, reaction timing) and a complete weighted evaluation instrument — replacing craft inferences with researched values, and giving the pipeline a scored definition of "engaging" it can optimize before and after spending money. |

---

## 3. Principles

1. **The audio track is the spine of the film; the edit exists before the pixels.**
2. **Never pay for the same pixels twice.** Content-hash idempotency on every generation step; revision-stamped jobs discard stale completions (cost still recorded).
3. **Judge cheaply, regenerate reluctantly, escalate honestly.** Dollar-denominated retry budgets; keep-best-of-N; model-switch on capability failures; humans see only flagged work.
4. **Identity is defined by a human once and maintained by the machine forever after.**
5. **Respect is a system property** — enforced at generation, checked at review, monitored after publication, logged for audit.
6. **The user is a director, not an operator.** One instruction does what twelve form edits would — and returns a delta-quote before it spends.
7. **Series canon over episode whim.** Canon changes are explicit, versioned, priced, permissioned, and locked against concurrent writers.
8. **Transparent money, at two levels.** Per-episode quote → escrow → ledger; org-level spend governance (caps, dashboards, alerts).
9. **The system learns, and so does the team.** Published-episode analytics feed the directing grammar *and* a team performance view.
10. **Direction is a shape, not a pulse.** Rhythm, score, and coverage are modulated across each episode and varied across a series — never a fixed metronome. Comprehension per second beats cuts per second.

---

## 4. The production pipeline

Eleven durable, idempotent, revision-stamped stages with typed inputs/outputs persisted before and after. S1–S4 run at interactive speed; S5–S10 are the async render fan-out. Gates are durable, claimable waitpoints that pin content-hash sets.

```
S1  INGEST      script/treatment + refs → normalized screenplay; entity roster (reuse-aware); beat map
                (12-axis dramatic analysis + cultural tags + beat types); reveal map; source citations
                (canonical | regional | retelling); ADVISORY SCRIPT PRE-FLIGHT (scored, warn-only)
S2  LOOK        pick-a-look (curated gallery) or upload reference → vision agent reads it into an editable
                style-tail "recipe" → review/edit → look-test → LOCK (locks the look for series AND cast)
S3  CASTING     Character Studio: per character — upload reference OR generate portrait → generate model
                sheet → iterate → APPROVE; DNA core + wardrobe variants + regional iconography sheet;
                clean portrait = identity anchor; locations (plates or atmosphere recipes); voices
        ── GATE A: cast & look approval + series-setup quote; episode manifest pinned ──   (auto-satisfied for reuse episodes)
S4  SCRIPT+SOUND narration (pause + performance markup, cleared shlokas) → TTS or human-VO → word
                timestamps (forced alignment + ASR reconciliation for human VO) = MASTER CLOCK; score
                picked from the beat-gridded Score Library; RHYTHM & DYNAMICS MAP; DOMINANCE MAPS per
                scene; shot list compiled beat-by-beat (beat→shot compiler, duration grid, eyeline/180);
                ambience + SFX cue plan; itemized EPISODE QUOTE (absolute-dollar cap);
                PLAN-MODE RUBRIC SCORE (predictive OVS/CVP + fix-first list)
        ── GATE B: narration + score + shot list + rhythm map + plan score + quote (hashes pinned) ──
S5  KEYFRAMES   per-shot image prompts → keyframes via the reference graph → L0–L2 QC
                (incl. attribute/limb + skin-tone vs approved sheet) → retries
S6  MOTION      image-to-video per shot (router; approved keyframe = identity authority; complex forms →
                camera-on-locked-keyframe) → per-frame + temporal QC → keep-best retries / model switch
                → per-shot terminal fallback (hero shots never fall back to a bare still)
S7  SFX/FOLEY   scene ambience beds + spot SFX at exact cue times + scale/impact layer + harvested
                native-audio texture stems
S8  ASSEMBLY    EDD finalized (apex-aware trims; cut-on-motion for flow shots; J/L audio bridges;
                freeze/alternate cliffhanger; word-silence cuts with best-effort beat-snap) →
                GRADE-CONFORM pass (match every clip to a per-scene master) → dramatic mix
                (ducking + dynamic-range budget, −14 LUFS) → final MP4 + hook-variant openings
S9  REVIEW      L3 continuity (incl. eyeline/180 + dominance) + FINISHED-MODE RUBRIC SCORE +
                episode-level reliability gate + human queue (flagged shots) + role-gated itemized
                sign-off (deity/shloka/ritual content requires a qualified reviewer)
        ── GATE C: final cut approval (small delta-quoted revision budget) ──
S10 EXPORT      MP4 + zip + OTIO/FCP7 XML + captions + labels + C2PA + cost/QC reports +
                PROMOTABLE MOMENTS (1–3 ad clips + captions)
S11 PUBLISH     per-series channel binding; religious-calendar-checked scheduling; direct/scheduled
                publish or export handoff → post-publication monitoring + analytics ingest
```

**Two flows over one spine.** *New-series setup* runs S1–S3 + voices to a one-time series Gate A that establishes the bible. *New-episode-in-series* pastes a script (and optional VO); S1 matches roster entries against the bible and flags only new characters (quick S3 for those alone); Gate A auto-satisfies when nothing new was set up; the member lands at Gate B. *Batch mode* creates N episodes from a script list against a series template, with a unified batch review for structurally similar Gate Bs.

**Episode state machine.** Per-shot terminal states: `ready | fallback_used | replanned` — an episode can always assemble. Episode states: `draft · setup · vo_pending · queued · rendering · needs_input(gate) · review · needs_rework · ready · published · abandoned`. Permanent generation failure on a shot degrades to a controlled fallback — a designed camera-move on the approved keyframe for hero shots (never a bare Ken-Burns still; §12), Ken-Burns-over-keyframe for non-hero shots — or triggers a Director re-plan that merges narration spans. `abandon` releases escrow. `clone-episode`/`clone-series` support daily repeatability.

### Stage details

**S1 — Ingest.** Accepts screenplay, prose, Hindi/Hinglish, or treatment. Outputs: (a) a normalized screenplay (Hindi dialogue preserved, English action lines, numbered scenes); (b) an entity roster with characters/locations/props flagged `existing-series-asset | user-upload | generate`; (c) a beat map: 12-axis dramatic analysis (dramatic question, conflict/tactics, power dynamics, emotional arc, subtext, pacing, spatial relationships, information asymmetry, turning points, genre/tone, narrative position, cultural tags), with each beat typed against the beat taxonomy (§10.3) — hook, accusation, threat, betrayal, identity reveal, evidence reveal, impossible choice, darshan, boon/curse, vow, test-of-faith, divine intervention, cliffhanger; (d) a **reveal map** tracking four knowledge layers (audience / protagonist / antagonist / hidden-from-all) with, per reveal: the hidden item, trigger, new knower, power shift, and next debt; (e) per-scene source citations with a fidelity tag — `canonical | regional-tradition | popular-retelling` — unsourced beats blocked, dramatization within a sourced beat allowed. Cultural tags (DARSHAN_REVEAL, RITUAL_IMMERSION, MYTHIC_ACTION, HERO_ENTRY, INTIMATE_DRAMA, …) key the shot-cluster templates downstream.

**Advisory script pre-flight (warn-only).** The input script is scored against the 12-parameter script rubric (`reference/rubric-config/script.v1.json`): opening hook, protagonist clarity, conflict/stakes density, structure/pacing, twist/reveal, cliffhanger pull, dialogue economy, relationship legibility, series continuity, genre freshness, localization fit, compliance — weighted composite + hard-signal checks (hook < 4, non-finale cliffhanger < 4). Output: a one-line verdict, the top-3 fix-first items, and suggested rewrites — surfaced beside Gate A/B so weak scripts are fixed *before* money is spent. It never blocks: the script is the member's creative input. Devotional calibration: the "midpoint worsens power" heuristic reads "midpoint deepens the test of faith"; the ad-supported/social-feed context profile applies (hook, pacing, and dialogue compression weighted up; paywall mechanics ignored).

**S2 — Look.** A curated gallery of 115 looks in 9 families — Cinematic Eras (11), Genre Worlds (13), Indian Cinema (12), **Indian Mythology (8: Devotional Calendar Art, Indian Mythology Comic, Bright Indian TV Cartoon, Sacred Folk Scroll, Temple-Wall Fresco Awakens, Glowing Divine Realism, Lamplit Temple Stillness, Divine Fury)**, World Cinema (8), Advertising (17), Documentary (14), Animation (14), Mood (18) — with family tabs + counts, search-by-feeling, and upload-your-own-reference as a peer (look assets ported from the reference implementation, §21). Picking a look runs a vision agent that reads the image into an **editable style-tail recipe** — one 50–150-word portable-look paragraph (tonal structure → palette geometry → sensor-look class → lens/depth behavior → optical artifacts/texture → skin realism → tailored negatives), describing *behavior, never equipment claims*, with scene content forbidden. The member reviews/edits, runs a two-frame look-test, and **locks**. The locked tail is appended verbatim to every image and video prompt in the series. A deterministic anti-amber negative suffix is appended in code (idempotent, per-shot deletable) and disabled for devotional-warm looks (`negative_tint=false`). A mid-series look change is a priced "restyle canon" event (§9).

**S3 — Casting (Character Studio).** The roster is pre-named from the script ("we read your script and cast it"). Per character: **upload a reference photo OR generate a portrait** from the description → **generate a model sheet** (multi-view turnaround) → iterate freely (lightbox zoom, inline-editable description, per-character shot count) → **approve**. Reused bible characters appear locked (`◆ Bible vN`). Structural rules: the **clean single portrait — rendered at 9:16 — is the identity anchor** fed to generation; the multi-view sheet is a human preview only (a collage fed as a reference drifts likeness); descriptions are sanitized of weather/mood words before becoming reference briefs; briefs are hard-capped (≈15 words identity brief; ≈40 words casting line). Each character carries: a **DNA core** (face, exact skin tone as a first-class Lab value, tilak, defining ornaments/weapons — verbatim, lint-enforced, never paraphrased), named **wardrobe variants** (court/battle/travel) each with macro crops, a **regional iconography sheet** binding for deities (§11), and for deities an **attribute manifest** (arm count, per-hand object assignment, vahana). Deletion is two-tier (remove sheet vs delete reference) with an archive-guard when a published episode's manifest references the character. Locations are classed `architectural` (plates per time-of-day; geometry preserved) / `landscape` / `atmospheric` (Vaikuntha, cosmic voids — a palette/motif/light recipe + one mood plate used as style-not-geometry reference).

**Voices (Voice Studio).** Each character — and the narrator — is voice-cast the way it is face-cast: **browse the provider voice library, design a voice from a description** ("deep, resonant, weathered — a mountain ascetic"), **or clone from an uploaded sample** (only for a licensed human, with verified consent) → **audition on an actual line of the script** → **approve**. The approved voice is pinned to the series bible with a permanent voice ID and reproducible seed and reused across every episode, so the series has a consistent sound (a deity who sounds different each episode is as broken as one whose face drifts). An agent never chooses the *voice identity*; it only applies per-shot performance (§4-S4) and routes the engine by language (§13). Sanskrit shloka voice is a separate cleared lane (§11), never general TTS.

**S4 — Script + Sound (the clock and the creative spine).** The **Narration Writer** produces the VO script with the register rules (§11), `<pause>` markup (held silences are authored), **performance/prosody markup** (emphasis, hush, swell, breath-before-reveal, tempo) mapped to the beat map, and shloka stings drawn only from the cleared library. Dialogue lines obey action-tagging (every line attacks/defends/reveals/threatens/decides — untagged lines are cut) and the one-breath / one-subtitle-unit constraint (≤2 caption lines, <32 characters per line English baseline). **Narration source & voice** (series default; per-episode override): the episode uses the series-pinned voice (§3-S3) by default. Overrides for a one-off episode: *upload a VO file* (human or AI-generated) — the episode enters `vo_pending`, then forced-alignment + ASR-diff reconciliation makes the actual recording the clock (D13); or *re-pick a voice* from the library for a guest/special episode. For synthesized narration, the Narration Writer supplies the *performance* — the pinned voice plus emotion tags, pauses, and pace from the beat map — and the router selects the *engine* by language (§13); both are overridable, but the voice identity defaults to the pinned series voice precisely so nobody drifts the series' sound by re-rolling it each episode. TTS renders with character-level timestamps. The **Music Supervisor** retrieves the score from the Score Library (rasa arc + tempo + energy + instrumentation; top-2 candidates offered) — its pre-computed beat grid is now available, *before* shot planning. The **Rhythm Director** authors the **Rhythm & Dynamics Map** — the master creative artifact: a designed curve across the episode (cut-density envelope with mandated variance; ≥1 earned suspension where cutting halts and one image holds 4–6s; a **visual-escalation ladder** — scale, movement, density, and stakes stepping up together toward the climax; drama-placed micro-events; score dynamics: drop-to-silence at the darshan, swell on the climax, cliffhanger stinger). The **Dominance Maps** are drawn per scene from the beat map's power analysis: who owns foreground, center, height, and the doorway; where the witness stands; the exact beat where ownership reverses. The **Shot Director** then compiles the shot list beat-by-beat (§10.3): each shot bound to a narration span or `span=null` (purely visual beats over music); multiple shots per span (reactions, intercuts); per-shot fields: type (from the shot taxonomy, with notation), description, camera (move + height semantics + motion-completion timing — "camera settles by second 3"), lens, duration, lighting, audio, emotion, **a concrete physical performance beat** (a gesture / gaze-shift / breath — never a bare emotion label), **eyeline vector + 180-line side**, beat type, look_id, wardrobe_id. Cuts ≠ clips: ~12–18 cuts per 90s assembled from ~10–14 generated clips via reuse windows. Shot 1 and the final shot are generated as a coordinated pair (loop rhyme by construction). The SFX Designer emits the cue list, per-scene ambience plan, and scale/impact events. The quote engine prices the plan (§15). Finally the **plan-mode rubric score** (§12) runs on the shot list + rhythm map + keyframe intents, and Gate B presents: playable narration, score pick, shot-list table, rhythm map, predictive quality score with fix-first list, and the itemized quote.

**S5 — Keyframes.** The Prompt Engine composes per-shot image prompts in the three-layer pattern: an identity parenthetical (the character's immutable brief, overlaid at first mention), a per-shot scene brief (subject → action → environment restated concretely every time → explicit shot-type/composition sentence → scene lighting → atmosphere, with depth-of-field in prose), then the locked style tail verbatim after a double newline. Prompts obey the **Self-Contained Frame Law**: each prompt describes one complete frozen frame — no cross-shot references, no narrative progression, no sound or editing language (sound/transition metadata is stripped from the shot JSON before prompting; it leaks otherwise). Subjects are referred to by NAME only; a reference-roster system prompt binds names to reference images ("Image 1 = NAME (traits)… preserve facial identity, wardrobe, skin tone exactly"), with environment-role clauses ("preserve the set, architecture, layout; do not copy any person") and, for chained shots, the two-frame continuity clause ("Image N is the environment master, Image M the previous shot — same location; keep set and layout identical and render the new angle; do not merge"). The **reference graph** wires master→coverage per scene deterministically in code (widest shot per scene = master; coverage inherits [master, previous] environment refs; consecutive same-location-same-character shots chain; overflow priority characters > previous > master; chained shots get composition-only prompts). Topological render order; failed anchors skip-and-flag dependents. Slot-allocation profiles per shot class (solo / two-character / ensemble) with explicit drop order and compensation (inline set-description when environment refs drop; composite jewelry crop-sheets to reclaim slots); the actual allocation is logged so QC knows what was conditioned. Every keyframe passes L0–L2 QC — including the per-frame deity attribute check and the deterministic skin-tone check against the approved sheet — before any motion money is spent.

**S6 — Motion.** Image-to-video per shot through the router (§13). Motion prompts describe **only the delta**: what moves + what stays anchored + the camera move + an explicit end state ("…then settles"); camera motion and subject motion as separate layers; one hero action per clip (cramming causes morphing). The QC-approved keyframe is the identity authority; element/ingredient reference systems derive from it or canon-promoted frames, never from raw turnarounds. **Complex/multi-arm hero forms are animated as camera-motion-on-locked-keyframe** (push-in, rise, parallax; topology preserved by construction) rather than free limb motion. Native model audio is muted (kept only as an ambience stem when the router picked an audio-native model). Start/end-frame conditioning for continuity pairs; re-anchor to canonical references every 3–5 chained shots. Per-clip QC: L0–L2 plus per-frame attribute/skin checks on deity shots plus **temporal identity stability across every retained frame**; **keep-best-of-N retries** (every attempt scored; the best is retained; if budget exhausts, ship best-above-floor — never a worse fallback); anatomy/physics failures switch models rather than re-rolling (retries resample the same failure distribution); the character-video model is **pinned per character per episode** (a provider outage pauses rather than silently re-rendering a character on a different-looking model). Content-refusal fallback is regex-gated (moderation language only) so transient errors don't double-spend.

**S7 — SFX/foley.** Three layers, none of which is music: (1) **continuous scene ambience beds** — one per location/scene, run under all that scene's cuts so room tone never jumps; (2) **spot SFX** at exact cue times (conch, damaru, thunder, bells); (3) the **scale/impact layer** — sub-bass drones, risers, impacts for cosmic/battle/fury beats, and **hero sound events** where score + SFX + silence combine (the conch that cuts the music; the sub-drop on the cosmic reveal). Video-to-foley models cover silent clips; harvested native audio is demoted to texture. Shloka audio comes only from the cleared lanes (§11).

**S8 — Assembly.** The Editor finalizes the EDD (§14): a frame-sampled **vision pass** picks each cut's in/out around the action apex, always discarding each generation's first and last ~0.5s (the highest-artifact regions); **flow-sequence shots are cut on motion** (entered and exited mid-movement) while hero/darshan shots settle; word-silence cut placement is mandatory, beat-snap best-effort within the silence window (scene-change downbeats may insert ≤300ms of silence rather than move a cut off a word gap); J/L cuts bridge visual cuts with 0.5–1.5s of carried audio; the register's transition whitelist applies (cut / 0.5–1.0s dissolve / 0.5s fade-to-black / bookend fades — no wipes or glitch transitions); adjacent-diversity rules (no consecutive same-subject-same-scale cuts; palette patterns broken every 4 cuts); reaction cuts land 0.2–1.0s after the revelation with ~12-frame holds; the cliffhanger lands as a freeze (sharpest-frame selector scores blur/blink over the final second) or a rotated alternate ending type. The **grade-conform pass** derives a per-scene color target from the approved master keyframe and matches every clip's exposure/white-balance/contrast to it before render — then the mix: score ducked under narration by precomputed regions (sidechain ratio 8, release 300–500ms), ambience at −20…−24, a **dynamic-range budget** mandating quiet troughs so peaks land, master −14 LUFS / −1.0 dBTP. Render: EDD → deterministic ffmpeg filtergraph compiler → 1080×1920/30fps H.264 + AAC 256k, plus hook-variant opening recuts. Karaoke captions grouped to grapheme-cluster boundaries (naive per-character karaoke breaks Devanagari conjuncts); sidecar SRT always.

**S9 — Review.** L3 continuity per scene (adjacent-shot boundary + interior frames against the continuity bible — costume, props, lighting direction, **eyeline/180 consistency, dominance-map conformance**; class-aware for atmospheric locations). The **finished-mode rubric score** (§12) runs on the assembled episode. The **episode-level reliability gate** enforces the series glitch budget (zero for hero shots) and the rubric verdict; rejection returns the episode to `needs_rework` with the fix-first list. The human queue shows only flagged shots with judge notes and one-tap approve/regenerate. The **role-gated itemized sign-off** (pronunciation spot-check, register, per-item iconography, ritual plausibility keyed to citations, standalone dignity of freeze-frame and thumbnail, reverence-as-craft) must be completed by a reviewer with the right competency flags for any deity/shloka/ritual content.

**S10 — Export.** The three deliverables (§1) plus compliance: C2PA manifests on every asset, provider watermarks preserved through transcodes, burned-in AI label (built to the strictest pending Indian labeling rules), platform altered-content flags prefilled, the standard disclaimer ("AI-assisted dramatization for educational and devotional storytelling; not intended for worship; source: [text, canto]"), and the full audit log (prompt/seed/source per asset). The **promotable-moments extractor** selects 1–3 beats (3–15s) that work with zero context — peak conflict/reveal/emotional spike, legible at phone size, ending on an open question — and emits clips + suggested captions from the EDD.

**S11 — Publish.** Per-series channel binding; scheduling checked against the religious calendar (block/warn dates by content tag — e.g. never a deity-in-peril cliffhanger pinned across that deity's festival week; never Vamana-victory content pushed to Kerala feeds at Onam); direct scheduled publish or a clean export-to-uploader handoff; the published-state view closes the loop with analytics ingest (`episode_performance`) and post-publication monitoring (comment-velocity/sentiment alerts; the incident runbook — decision owner, response templates citing sources, unlist-first policy, audit-log export within a news cycle).

---

## 5. Sound architecture

Four stacked, dramatically-arranged layers — none per-clip; a picture cut cannot interrupt the soundtrack:

```
L1  NARRATION (the clock)     one continuous TTS or human-VO track                −16 LUFS working
L2  SPOT SFX / STINGS / SCALE-IMPACT   exact-t cues; sub-bass & impacts for mythic beats
L3  AMBIENCE BEDS             one continuous bed per scene                        −20…−24
L4  SCORE BED                 one Score Library track, dramatically arranged      −24…−28, ducked 3–6 dB
                              (drop-to-silence, swell, stinger)                   under narration
```

**Sound priority stack** (mixing law): (1) dialogue/narration intelligibility, (2) reaction-supporting silence or room tone, (3) sting or motif, (4) music bed, (5) effects sweetening. Captions supplement clarity; they never rescue a bad mix.

**The Score Library.** 30–60 tracks generated offline (music models prompted from section plans), human-curated in one seeding session for raga/instrument correctness, then frozen as pre-cleared team assets. Each track carries: rasa tags (bhakti, shanta, veera, karuna, raudra, adbhuta), BPM + energy curve, instrumentation tags (bansuri, sitar, tabla, tanpura, chant), **pre-computed beat grid + downbeats + section markers**, loop points, license record, and **stems where available** (so the bed can thin to tanpura-only under intimacy and bloom on awe). Curation targets four **motif families** — a divine-reveal sting family, a threat-pulse family, a bhakti bed family, and a cliffhanger sting family — reused across a series (cheaper and more memorable than bespoke cueing). A series pins 3–5 tracks + a signature motif: a consistent sound across 30 episodes. Selection is retrieval; deterministic DSP does the fitting (section-boundary arrangement, loop, cadence ending, tail fade, ≤±3% stretch) — but the arrangement honors the Rhythm & Dynamics Map's dramatic moves, not just the duration. The generative lane exists to extend the library offline (new tracks are tagged + beat-gridded on ingestion) and for bespoke flagship scoring — never as the per-episode default.

**Why native model audio is not the soundtrack:** it is generated per 5–10s clip — disjointed by construction (different keys, reverbs, levels at every cut), unmixable (no stems; music baked under effects), and unaware the narration exists. It is kept for what it is good at: free, frame-synced ambience and foley texture, demoted to L3.

---

## 6. Agent architecture

### 6.1 The Director (session layer)

One long-lived agent session per episode run: it plans, parameterizes stages, adjudicates QC verdicts (retry / re-prompt / model-switch / escalate), translates mid-flight instructions into minimal graph invalidations, and keeps a human-readable production log ("Shot 7 failed identity twice — switching models with a tighter DNA block"). It is *not* in the generation hot path: workers execute; the Director decides at stage boundaries and QC events. Contracts:

- **Decisions are durable work items.** QC verdicts land in a decisions queue; the Director consumes it; a worker-side timeout auto-escalates to the human queue if the Director is absent. Decisions commit through a transactional outbox (decision + intended action atomically; workers execute idempotently from the outbox). The conversation log is narrative, not the recovery mechanism — if the session dies, the spine keeps rendering and a new session resumes from the plan + log.
- **Steering is revision-based.** Every steerable artifact carries a monotonic `revision`. Invalidation = revision bump + best-effort provider cancel; jobs and completions are revision-stamped; workers commit via compare-and-set, discarding stale completions (their cost still recorded).
- **Steering is delta-quoted.** `shot.revise` returns "invalidates 3 shots, ~$4.80 — proceed?" against a visible revision budget; Gate C rejection cycles have their own small budget; rapid steering is rate-limited against remaining escrow and surfaces "N% of budget spent on cancelled work."
- **The Director is metered:** a per-episode token/spend budget in the quote, session checkpoint-and-compact at stage boundaries, actuals in the ledger.
- **Repair routing:** rubric verdicts (§12) map to concrete Director actions — `recut` → Editor EDD re-pass; `regenerate inserts` → produce the missing proof/reaction shots; `regenerate scene` → re-render that scene's clips; `re-plan` → back to S4 — each bounded and delta-quoted, optimizing for the smallest intervention with the largest expected score gain.

### 6.2 The crew (structured sub-agents; typed, schema-validated output contracts)

| Agent | Stage | Role and knowledge |
|---|---|---|
| Script Doctor | S1 | Any input format → normalized screenplay; Hindi/Hinglish preserved |
| Dramaturg | S1 | 12-axis beat map; beat typing; reveal map; cultural tags; drama only — never cameras |
| Source Keeper | S1 | Market-relative canon anchoring; per-scene citations + fidelity tags; unsourced-beat blocking |
| Script Judge | S1 | Advisory pre-flight scoring against the script rubric; top-3 fixes with suggested rewrites |
| Look Analyst | S2 | Look image → editable style-tail recipe (behavior, never equipment; scene content forbidden) |
| Casting Director | S3 | Character Studio + Voice Studio flows; DNA cores + wardrobe variants; attribute manifests; iconography binding; voice casting (library / design / clone → audition → approve) |
| Narration Writer | S4 | Register rules; pause + performance/prosody markup; action-tagged dialogue; one-breath/one-subtitle lines; shloka stings from the cleared library; write-the-last-3-seconds-first |
| Music Supervisor | S4/S5 | Score Library retrieval (rasa/tempo/energy/instrumentation); dramatic arrangement (drop/swell/stinger); motif-family discipline; section-plan prompts for the offline generative lane |
| Rhythm Director | S4 | The Rhythm & Dynamics Map: cut-density envelope, suspensions, visual-escalation ladder, drama-placed micro-events, score dynamics |
| Shot Director | S4 | The beat→shot compiler (§10.3); dominance maps; duration grids; shot taxonomy + notation; eyeline/180 assignment; performance beats; template variation; the full directing law (§10) |
| SFX Designer | S4/S7 | Cue lists; ambience-bed plans; scale/impact + hero sound events; sacred-object sound table |
| Prompt Engine | S5/S6 | Three-layer image prompts under the Self-Contained Frame Law; delta-only motion prompts with explicit end states |
| Iconography Guardian | S3/S5/S9 | Regional deity sheets; dignity + revered-figure rules; ritual-template whitelist; freeze-frame and thumbnail selection with standalone-dignity checks |
| Editor | S8 | Apex-aware vision-pass trims; cut-on-motion vs settle; beat-snap; J/L bridges; diversity rules; grade-conform targets; reaction timing |
| QC & Rubric Judges | S5/S6/S9 | Discrete-level defect rubrics; the 15-parameter visual rubric in plan and finished modes; second-judge ensemble on ambiguity |
| Publisher | S10/S11 | Compliance flags; channel binding; calendar check; promotable-moment selection; thumbnail dignity |
| Episode Writer *(later phase)* | pre-S1 | Season arc → beat sheets → drafts against series narrative state; human-approved |

### 6.3 The MCP surface

```
series.create / series.get_canon / series.update_bible / canon.promote(episode_id)
episode.create(series_id, script) → task_id   /   episode.clone(id)   /   episode.abandon(id)
episode.status(task_id)
episode.pending_inputs(task_id) → [{kind: gate|shot_review|budget_approval|stale_gate, id, context, options, claimable_by}]
gate.claim(gate_id) / gate.approve(gate_id, notes?) / gate.reject(gate_id, reason)
shot.revise(shot_id, instruction) → delta_quote   /   shot.approve(id)   /   shot.regenerate(id, note?)
budget.approve(id)   /   quote.delta(change_id)
episode.quote(episode_id)   /   episode.export(episode_id, targets=[mp4, zip, otio, fcp7xml])
```

`pending_inputs` is the drain contract: an external agent (e.g. a Claude Code session) can run an entire episode headlessly, claim and answer gates, resolve flagged shots and budget approvals, and pull exports without the web UI. The same work-item model drives human notifications (§7).

---

## 7. Team, roles & collaboration

**Teams & onboarding.** One team at launch — **Zyra Internal**. The first user is its admin. New sign-ups auto-join in a limited **onboarding** role (create drafts; no publish, no bible edits, capped spend) until promoted; a short cultural-safety orientation precedes first publish. Multi-team (assignment at sign-up, moving members, per-team libraries) is a later phase; the schema is team-ready now.

**Roles.** `admin` (team, members, spend policy) · `reviewer/approver` (completes role-gated sign-offs; carries per-language/tradition **competency flags** so only a qualified reviewer approves deity/shloka content) · `member` (full production) · `onboarding`. The reviewer role exists because the qualified sign-off is enforced by permission, not honor.

**Series ownership & shared canon.** Each series has an owner and per-member ACL: `view · edit-episodes · edit-bible · promote-canon`. All members see the team's series and episodes; editing another member's episode requires `edit-episodes`; only `edit-bible`/`promote-canon` holders touch shared canon. Canon writes take a **series-level advisory lock** and surface a diff ("N in-flight episodes will be affected — proceed?"); in-flight episodes are unaffected (they read their pinned manifests). A human-readable **series audit history** records who changed canon and when.

**Claimable gates + notifications.** Gates, flagged-shot reviews, and budget approvals are team work-items any authorized member can claim — an episode never stalls because its creator is offline. Configurable notifications (in-app + email/Slack) per event class: gate ready, shot flagged, budget cap hit, VO received, episode done, post-publication sentiment alert. The **In Production** view is the claimable queue: stage, progress, ETA, cost-vs-cap, blocked-on-whom, stall duration; filters Mine / All team / Needs me. An **internal review link** lets an approver watch an episode before publish.

**Risk-tiered autonomy.** Autonomy graduates by *content class*, not episode count: low-risk content (no on-screen deity, no shloka, no depicted ritual) may earn auto-approval after N consecutive clean episodes; **sensitive content always costs one qualified reviewer sign-off and never auto-graduates.** Throughput is planned accordingly: N low-risk episodes/person/day fully automated; each sensitive episode budgets ~10–20 minutes of qualified review.

**Org spend governance.** Beyond per-episode quote/escrow/ledger: admin-set per-member and per-series budget ceilings; an admin spend dashboard (burn by member/series/day; cost-per-published-episode trend); burn-rate alerts — all views over the append-only cost ledger.

**Content calendar.** A planning surface over the religious calendar: plan episodes against festival dates, see scheduled/in-production/published per day, flag empty days for a daily series — generative and defensive.

**Library.** Every member's finished videos front and center (thumbnail grid, series-grouped); teammates' work in collapsed expandable sections; search + filters (status, series, member, deity/festival tag, publish state, platform). **Team performance view:** retention curves, hook-3s survival, completion by series/episode/hook-variant — for programming the next slate, separate from the grammar-tuning loop.

---

## 8. Data model

```
orgs / teams(id, name) / users / memberships(user_id, team_id, role, competency_flags[], joined_at)
spend_policies(team_id, per_member_cap, per_series_cap, alert_thresholds)
notifications(user_id, kind, subject_ref, read, ts)

series(id, team_id, owner_id, title, language, market_tradition, style_profile_id@v, narration_source_default)
  series_acl(series_id, user_id, roles[]) / series_lock(series_id, held_by, reason, since) / series_audit(...)
  series_bible(series_id, version, canon_json)                       # append-only
  characters(id, series_id, name, kind, revered_figure, iconography_sheet_id?)
    character_looks(id, character_id, label)                          # child/adult/cosmic forms
    character_versions(character_id, look_id, version, dna_core, skin_lab[], wardrobe_variants[],
                       approved_portrait_ref, turnaround_refs[], macro_refs[], canonical_embedding,
                       embedding_model, attribute_manifest{arm_count, hand_assignments, vahana},
                       approved_by, lora_id?)
  voices(id, series_id, character_id, provider, mode: library|designed|cloned|human_recorded, voice_id?, seed, ref_audio, approved_by, version)
  locations(id, series_id, name, class: architectural|landscape|atmospheric)
    location_plates(location_id, time_of_day, image, recipe, version) | atmosphere_recipes
  style_profiles(id, series_id, look_id, style_tail, negative_policy, lut?, version)
  iconography_sheets(deity, regional_tradition, sheet_json)
  counter_veneration(figure, communities, contested_regions, festivals)
  shloka_library(verse, source_locator, lane: synthetic_cleared|human_recorded_only, signoff_by)
  score_library(team_id, track_id, uri, stems[], rasa_tags[], motif_family, bpm, energy_curve,
                instrumentation[], beat_grid, downbeats, sections, loop_points, license, curated_by)
  ambience_beds / impact_library
  religious_calendar(date_range, tradition, content_tags_blocked|warned) / channels(series_id, platform, handle)
  narrative_state(series_id, episode_number, state_json)             # who knows what; boons/curses/vows

episodes(id, series_id, number, status, risk_class: low|sensitive, created_by, pinned_manifest_json)
  stage_runs(episode_id, stage, status, payload_json)
  agent_calls(episode_id, stage, agent_key, request_hash, response, tokens, cost)   # LLM idempotency backbone
  vo_asset(episode_id, source: tts|human, voice_override_id?, uri?, alignment_json, asr_reconciliation_json, state)  # override optional; default = series-pinned voice
  rhythm_map(episode_id, curve_json, suspensions[], escalation_ladder[], micro_events[], score_dynamics[])
  dominance_maps(episode_id, scene, owners_json{foreground,center,height,doorway,evidence,witness}, reversal_beat)
  reveal_map(episode_id, reveals_json[])                              # 4 knowledge layers, power shift, next debt
  shots(episode_id, scene, idx, revision, look_id, wardrobe_id, beat_type, narration_span nullable,
        spec_json{shot_type_notation, camera{move,height,completion}, lens, lighting, performance_beat,
                  eyeline_vector, line_side, slot_allocation}, reference_edges,
        keyframe_asset_id, clip_asset_id, pinned_video_model, qc_json, terminal_state, status)
  provider_jobs(provider, request_id, revision, state: enqueued→completed→ingested)  # exactly-once ingestion
  assets(id, episode_id?, series_id?, kind, uri, content_hash, provider, model, params, cost, provenance, c2pa_manifest)
  edd(episode_id, version, edd_json)                                  # cuts keyed by clip content_hash
  gates(episode_id, gate: A|B|C, status, pinned_hash_set, quote_version, claimed_by, decided_by, notes, decided_at)
  rubric_scores(episode_id, checkpoint: script|plan|final, rubric_version, param_scores_json,
                composites_json{ovs,cvp,vcs,lcr}, verdict, fix_first_json, confidence)
  cost_events(episode_id?, series_id, team_id, member_id, provider, model, units, unit_cost, actual_cost,
              outcome: ok|retry|billed_no_asset, escrowed_at, ts)     # append-only
  infra_events(...) / quotes(episode_id, version, itemized_json, total, approved_by?)
  qc_reports(episode_id, layer, subject_id, verdict_json) / citations(episode_id, scene, source_text, locator, fidelity)
  episode_performance(episode_id, platform, retention_curve, hook_3s_survival, avg_view_duration, completion, per_shot_dropoff)
  promotable_moments(episode_id, t_start, t_end, reason, suggested_caption)
```

**Contracts.** The lockfile (`pinned_manifest_json`) is written at Gate A and is the only canon source for the episode — every prompt, reference, and QC baseline resolves through it, including steering regenerations; cache keys include the pin version; `canon.promote` affects only episodes pinned after it. **Canon promotion is atomic over the whole identity stack:** promoting approved episode outputs regenerates turnaround references from the best approved frames, retrains any LoRA, and recomputes embeddings — versioned together; episode 1's Gate C makes the promote-vs-re-render decision explicit, never silent. QC identity baselines resolve via `shots.look_id`; form-transition shots (child→cosmic) are exempt from single-identity embedding checks and judged by attribute/VLM only. The narrative chain: episode N stores its cliffhanger-out (final clip refs + open threads); episode N+1's recap may reuse that clip at zero cost, and the payoff lands within the first 15–30% of the episode before a bigger question is planted.

---

## 9. Consistency system (human-defined identity, machine-maintained)

**Front end — a human defines identity.** Each character is cast once in the Character Studio (§4-S3): reference photos or a generated portrait, an iterated model sheet, and an explicit approval. The approved clean portrait is the anchor; the approved sheet's DNA core, wardrobe variants, `skin_lab` value, and attribute manifest are the measurable targets. Recurring characters are reused from the bible across all episodes; only new characters are cast per episode.

**Back end — the machine maintains it through motion**, cheapest layer first:

1. **DNA discipline:** the invariant core (face, skin tone, tilak, defining ornaments/weapons) is verbatim and lint-enforced in every prompt — never paraphrased; wardrobe variants are selected per shot by `wardrobe_id`, each with its own macro crops. Skin tone is a first-class Lab value, not a phrase.
2. **Reference conditioning** on the approved portrait with slot-allocation profiles per shot class; jewelry/costume macro crops in early slots; explicit per-image role assignment; allocation logged.
3. **The reference graph** (§4-S5): deterministic master→coverage environment wiring; keyframe-as-identity-authority at the video stage; camera-on-locked-keyframe for complex forms.
4. **LoRA (optional):** a low-cost image-model LoRA per series lead is used to *synthesize additional canonical reference images* (more angles/expressions/lighting) that feed the reference slots — the keyframe model itself takes no user LoRA.
5. **Motion-stage conform — the maintenance guarantee:**
   - **Per-frame attribute/limb detection** against the approved `attribute_manifest` — arm count *and* which object is in which hand, on every retained frame of deity clips (purpose-trained on the project's own iconography sheets and character renders; generic human-pose models cannot count deity arms). Its measured recall on a seeded-violation set is a **hard launch gate** per deity class; until a class clears it, that class's hero shots are camera-on-keyframe only.
   - **Deterministic skin-tone conform:** the character's median Lab/chroma per frame compared to `skin_lab` within tolerance (hard fail outside); a post-generation color-conform pass hue-locks the segmented character at assembly.
   - **Temporal identity stability:** the kind-appropriate embedding (face-recognition embeddings for photoreal human faces; self-supervised visual embeddings + VLM attribute checks for deity/non-human/stylized/deified-under-divine-light, routed per look × kind) evaluated across every retained frame, failing on drift-variance — this is what catches slow morphing that first-frame checks and sampled judges miss.
   - **Keep-best-of-N retries** and **per-episode model pinning** per character (§4-S6).
6. **Drift QC vs series canon:** baselines are promoted from approved episode outputs (typically episodes 1–2), re-baselined only by explicit human canon-promotion; drift audits run from episode 3.
7. **Series-level style-drift detector:** cut rhythm, lens usage, hue range, and blocking density compared against the series blueprint each episode; material departures are flagged unless episode-justified.
8. **Locations:** architectural locations hold geometry via plates; atmospheric locations (cosmic oceans, divine realms) hold palette/motif/light via recipes — coverage clauses say "preserve palette, light quality, motif vocabulary; geometry may vary," and continuity checks are class-aware.
9. **Mid-series look changes** are a priced "restyle canon" event: bible assets re-rendered under the new tail (old assets as structure references), LoRAs retrained, embeddings recomputed, approved at a Gate-A-equivalent.

---

## 10. Directing grammar & visual-direction system

The pipeline's craft law. Sources: the microdrama visual-direction research corpus (§21), calibrated for AI generation and the devotional genre. Direction is a **shape, not a pulse**; the operating philosophy is **maximize comprehension per second** — every frame legible emotionally, spatially, and commercially in under a second on a handheld screen.

### 10.1 The Rhythm & Dynamics Map (master creative artifact)

Authored at S4, above the shot list: one designed curve per episode — a cut-density envelope with mandated variance (never a fixed interval); ≥1 **earned suspension** (cutting halts; one image holds 4–6s against the score); a **visual-escalation ladder** (scale, movement, density, and stakes stepping up together — MCU→CU, static→push-in, controlled stare→interruption, object→reaction — so the episode visibly intensifies); micro-events placed where the beat map wants them (floor/ceiling cadence, not a metronome); and the score's dramatic moves (drop-to-silence at the darshan, swell landing on the climax, cliffhanger stinger). **Rasa profiles** drive the whole map: a bhakti/shanta episode runs lower cut density, stretched cadence, and a withheld-and-held reveal; veera/raudra runs the fast end. Contrast is what makes the fast parts feel fast.

### 10.2 Duration grid (structural targets)

| Length | Hook completes | Beat windows | Cuts | ASL | Rhythm rule |
|---|---|---|---|---|---|
| 30s | ≤3s | turn 10–22s · cliff 22–30s | 5–8 | 2.5–5.0s | one dominant visual event; no scene-setter |
| 60s | ≤4s | escalation 4–24s · reveal 24–45s · cliff 45–60s | 8–12 | 2.5–4.0s | alternate action/proof/reaction |
| 90s | ≤5s | beat1 5–30s · beat2 30–65s · reveal/cliff 65–90s | **12–18** | **3.0–5.0s** | one hold for emotional weight |
| 120s | ≤6s | setup 6–30s · escalation 30–85s · reveal 85–110s · cliff 110–120s | 14–22 | 3.5–6.0s | one clean status reversal |

The strongest single image still lands inside the first 2.5s; the *hook completes* by the window above. Hook/climax stretches may cut at 2–2.5s; the terminal reveal→cliffhanger sequence occupies roughly the final quarter, with the cliffhanger image itself in the final 5–8%. Cuts ≠ generated clips: ~12–18 cuts per 90s come from ~10–14 clips via reuse windows. Generated shots are never held past ~6s (an AI-artifact constraint — solved for hero darshan with best-of-N on the cleanest clip or a slow push on a near-still keyframe, not by banning the long gaze).

### 10.3 The beat→shot compiler

Every beat from the Dramaturg's map compiles to the **smallest visually sufficient package** with five slots — context, action, **proof**, **reaction**, transition — using a beat-conversion table that specifies, per beat type: shot types, blocking, camera move, reaction coverage, insert needs, sound cue, and best cut-point. Core rows (adapted for scripture drama): accusation (accuser MCU → accused reaction CU → vertical two-shot; cut after the accusation lands, before the rebuttal), threat (low-angle threatener, distance closing, micro push-in; bass rise), betrayal (background-to-foreground reveal; cut on comprehension, not explanation), evidence reveal (insert → mandatory reaction; one beat after the insert), impossible choice (character framed between two demands; hold longer than usual; low drone or silence; cut before the decision is spoken), public exposure (crowd compression, witness reveal; murmur swell), identity reveal (doorway/axial reveal; reaction first, explanation second), **darshan** (threshold → devotee reaction → centered low-angle axis reveal, held → reciprocity), **boon/curse/vow** (ritual center axis; sacred object insert; consequence shot), **test of faith** (impossible-choice grammar at devotional pace), **divine intervention** (scale composition + light-source change + scale/impact sound event), cliffhanger (frozen unresolved vector; stopped motion; spike, drop, or silence).

**The reveal triad is law:** every reveal = a readable **proof** shot (insert at ~85% of frame for ~2.0s; text objects must be parseable in one glance — unreadable proof kills reveals) → a **reaction** cut within 0.2–1.0s (hold ≈12 frames; the reaction *is* the event in vertical) → a **consequence** shot. A witness, when present, is shown *before* the reveal so the payoff activates instantly.

### 10.4 Dominance maps (power made visible)

Per scene, from the beat map's power analysis: who owns **foreground, center, height, the doorway, and the evidence**; where the witness stands; and the exact beat where ownership reverses. Blocking prompts encode it ("elder owns the chair; challenger stands until the reversal"); every power shift in the story must move the *frame* power (center, foreground, height, distance, or movement authority) — and continuity QC checks that dominance changes coincide with beat changes. For darshan this is the native grammar: the deity owns height and center — and the inversions (the god kneels to the devotee) are staged, not accidental.

### 10.5 Shot taxonomy & vertical composition

Shot vocabulary with notation, used in shot lists and prompts: face-led close-up (`CU A center, eyes upper-third`), reaction close-up (`RCU B hold 12f`), vertical two-shot (`V2S A fg / B bg` — faces stacked in depth, never side-by-side), foreground/background power shot, doorway reveal, mirror reveal, phone/document/hand-prop inserts (`INS obj 2.0s, 85% frame`), witness reveal, public-humiliation composition, power walk-in (`PWI A enters on axis`), status-reversal composition (`SR before center / after edge`), **scale composition** (the tiny devotee before the vast deity, both in one frame — the signature awe shot), cliffhanger freeze (`CFI` — the final frame must work as a poster).

Composition rules: **CU/MCU is the default scale; ECU is a reserved escalation step** (shock, tears, evidence, darshan-eyes) — relentless ECU flattens the ladder. Decisive action lives in the **central 40–55% of frame width**; eyes in the upper third (~30–35% from top, 8–12% headroom). Depth-over-width staging: stack foreground/midground/background power positions; wides only as 1–2s punctuation with vertically strong subjects (gopuram, Kailash, a pillar of light). Max 2 faces per frame except staged crowd compositions. **Safe zones (asymmetric):** protect the top ~10% (app chrome), the bottom ~18–22% (captions + UI), and the sides ~5–6%; every crucial eye, mouth, and proof object stays inside the inner safe frame; captions assume ≤2 lines × <32 characters (English baseline; Devanagari calibration is a validation spike). Every plot-critical beat must read with the sound off — the muted episode should still be understood (proof shots, expressions, text overlays ≥2s inside the safe zone).

### 10.6 Camera, lighting, color

Camera height carries meaning: eye-level = empathy; slightly low = power; slightly high = shame/vulnerability. **Vertical camera moves (rise/fall) outrank lateral moves in 9:16.** Movement signals change — static, push-in, or single-axis drift are the defaults; a move is reserved for realization, intrusion, alignment change, pursuit, or reveal ("stable until the proof, then minimally unstable"). Rack focus only for shifting allegiance or revealing a hidden observer. Motion-completion timing is declared per shot ("camera settles by second 3"). Lens: 50–85mm-equivalent portraiture is the default for CU/MCU (a deliberate divergence from live-action microdrama practice, which shoots 28–50mm in cramped real sets — AI generation has no walls, and longer equivalents read more premium while avoiding wide-lens facial distortion that generation models compound); ~35mm-equivalent is reserved as an *intent* choice for pressure, entrapment, or POV. Lighting: high face separation, catchlights, controlled background contrast, readable skin on small screens; no uncontrolled darkness (phone screens punish muddy blacks and underexposed eyes — a checkable luminance criterion). Color: one dominant palette per location family (the grade-conform pass enforces it across cuts); **accent colors are reserved for divine presence and turning points**, so color itself narrates.

### 10.7 Performance direction (what the "acting" is, without actors)

Every character shot specifies a **concrete physical performance beat** — a gesture, gaze shift, or breath — never a bare emotion label (models render the generic version of an emotion word; they render a *specific micro-moment* far better). Vocabulary: breath before the reveal; **visible listening**, not only visible speaking; emotion that begins from a readable micro-shift and then blooms; villain pressure through stillness and eye contact; **hand economy** (hands expand and distract in tight portrait frames — and fewer hand gestures also means fewer AI hand failures); romance/devotion through timing, inhale, proximity, pause. **Emotional transitions are carried by the cut, never by a held morphing face:** reaction A → the object of the emotion → reaction B; any held face keeps a single stable affect and stays short.

### 10.8 Story mechanics (hooks, reveals, cliffhangers, series flow)

The opening frame draws from a checkable ontology — a face, threat, proof object, omen, divine sign, or ritual interruption **already in progress**; the hook is an *image*, not a line (a verbal hook gets a counter-image or proof insert). Escalation is causal ("because of this, what gets harder?"); at most one neutral exchange per episode; scenes enter on an active problem and exit on new debt — no greetings, no walking in and out, no after-the-fact summaries. **Cliffhangers rotate across twelve patterns** (question, interruption, discovery, accusation, evidence, arrival, identity, romantic, betrayal, danger, public shame, impossible choice), each with its payoff rule (a discovery object must trigger action; an interruption resolves fast and changes stakes; an arrival must alter hierarchy); the terminal image carries **unresolved directionality** — a raised hand, an opened door, trembling proof, frozen realization — a *visual* question, never merely a spoken one, ending on stopped motion, strong enough to pause as a poster. The loop rhyme (final freeze visually echoing shot 1) is an occasional series signature, not a per-episode mandate. Across a series: cultural shot-cluster templates ship 3–4 blocking variants with anti-repetition memory (never the last-used variant for the same cluster); the next episode pays the previous promise within its first 15–30%, then plants a bigger one.

The Shot Director self-checks every beat against five audience questions: what must the viewer **understand, feel, notice, anticipate, and remember**. A precedence table resolves rule conflicts (when a cultural tag owns the opening, the hook rule relaxes to "strongest single image inside 2.5s, reveal completes inside the duration-grid window"; the shloka sting becomes an audio layer over the mid-crisis visual, not a competing opener).

---

## 11. Cultural safety & authenticity engine

**Generation-time (hard rules).**
- **Iconography sheets keyed by (deity, regional tradition)** — a Bengali Durga is not a generic Durga — selected from the series market at casting, pinned in the lockfile, and encoded as the character's attribute manifest. Baseline pan-Indian sheet: Vishnu 4 arms (Panchajanya, Sudarshana, Kaumodaki, padma; Garuda; srivatsa, pitambara); Shiva 2 arms standard (trishula, damaru, third eye, crescent, Ganga, rudraksha, Nandi, Kailasa); Ganesha (ekadanta, ankusha, pasha, modak, mushaka); Hanuman (gada, devotional bearing, never crude speech); **Rama and Krishna always 2 arms** (the cosmic multi-armed form only in explicitly cited contexts, e.g. Gita 11); Durga (8/10/18 arms, lion, deva-gifted weapons, Mahishasura context); Lakshmi, Saraswati, Kali (garland, tongue, over Shiva — never a child form). Cross-region deity forms are blocked like cross-religion motifs; costume/architecture is region-matched in the style tail.
- **Revered-figure protections** independent of divinity: Sita, Draupadi, Ahalya carry the full dignity ruleset — full traditional dress locked in the DNA core, no body-focused crops, distress rendered via reaction and symbol (the vastraharan is the endless sari, never the body).
- **Dignity constraints:** no deities sick, mundane-sleeping, in vehicles or modern dress, in romantic-sexualized framing, comically harmed, or compositionally subordinate to humans; antagonists fearsome but never modernized-gangster, caste-coded, or racialized-dark. A **counter-veneration register** records communities that venerate specific antagonists (Mahishasura; Ravana; the Vamana–Mahabali inversion in Kerala) and gates release timing and regional targeting of contested episodes.
- **Register:** elevated, honorific language (Bhagwan, Shree, Prabhu, Mata); no slang from divine or revered characters; per-language register rules gate regional launches.
- **Shloka lanes:** a cleared library — Gita, stotras, and popular Purana verses are eligible for synthetic recitation only after verse-level pronunciation sign-off by a Sanskrit-competent reviewer (cleared once, reused forever); **Vedic samhita and bija mantras are never synthesized** — licensed human recordings only.
- No real living gurus; no specific consecrated temple murtis in invented rituals (generic canonical forms only); no interfaith comparison or mockery; a sampradaya-framing check (no deity-ranking staging even in fully sourced scenes).
- **Source fidelity, market-relative:** the canonical anchor follows the audience (Gita Press/Ramcharitmanas for Hindi devotional; Krittivasa for Bengali; Kamban for Tamil), with critical editions as internal cross-check; attribution lives in the description by default, on-screen only for genuinely obscure variants; unsourced beats are blocked; dramatization inside a sourced beat is allowed; television inventions are never presented as scripture.

**Review-time.** VLM iconography checks on keyframes and per-frame samples of final deity clips, plus the purpose-trained attribute detectors (§9); **ritual plausibility is whitelist-gated** — any depicted worship act must match a Source-Keeper-cited ritual template, because a fabricated rite can have every individual attribute correct; a **standalone-image dignity check** on every cliffhanger freeze and thumbnail ("acceptable as a context-free poster?"); the **role-gated itemized sign-off** (§4-S9). The attribute detectors' seeded-violation recall threshold is a hard pre-launch gate per deity class.

**Post-publication.** Calendar-checked scheduling; comment-velocity/sentiment alerts; a written incident runbook (decision owner, response templates citing sources and the disclaimer, unlist-first policy, audit-log export within a news cycle).

**Compliance.** C2PA manifests on every exported asset; provider watermarks preserved through transcodes; a burned-in AI label built to the strictest pending Indian labeling requirement (always-visible); platform altered-content flags auto-set; the standard disclaimer; the full per-asset audit log (prompt, seed, source citation) — the demonstrable good-faith record that the "deliberate and malicious" legal standard turns on. Output is positioned as cinematic storytelling, never as worship imagery.

---

## 12. Quality control

QC is two systems working together: a **defect funnel** (is anything broken?) and a **quality rubric** (is it actually good?). Both feed the Director's repair routing. LLM judges score; deterministic code does all math.

### 12.1 The defect funnel (per shot)

```
L0 Deterministic (free): ffprobe duration/res/fps; black/frozen frames; audio clipping; integrity → hard fail = auto-regen
L1 Cheap ML (<$0.001/shot): identity embedding by look×kind; CLIP drift; optical-flow flicker/morph; aesthetic floor;
   luminance floor (no muddy blacks); DETERMINISTIC SKIN-TONE (Lab) vs skin_lab; TEMPORAL identity stability
   across every retained frame; SyncNet on spoken-moment shots
L2 VLM judge (~$0.002–0.02/shot): discrete-level rubric — prompt adherence | anatomy/artifacts | costume+prop vs
   bible (wardrobe-aware) | framing vs shot list (incl. safe zones, center column) | motion quality | tone/reverence;
   ambiguous verdicts go to a second judge, agreement taken. Deity shots add PER-FRAME ATTRIBUTE/LIMB DETECTION
   (count + hand assignment vs the attribute manifest).
L3 Continuity (per scene): adjacent-shot boundary + interior frames vs the continuity bible — costume, props,
   lighting direction, EYELINE/180 consistency, DOMINANCE-MAP conformance; class-aware for atmospheric locations.
   Plus the non-scored direction checks: caption-band collision, dialogue masking, insert readability,
   hook-is-an-image, cliffhanger-is-a-visual-question.
L4 Retry policy (dollar-denominated, keep-best): L0/L1 fail → regen (max 1). L2 actionable defect →
   critique-conditioned re-prompt (max 2). Anatomy/physics class → reseed or model-switch (destination-priced).
   Hero shots → best-of-2 up front, booked as base spend. Budget escrowed at enqueue; planning factor 1.5–1.7×.
   Exhausted → ship best-above-floor or terminal fallback (hero → camera-on-keyframe, never a bare still).
L5 Human (role-gated): flagged-shot queue + full watch + itemized sign-off (qualified reviewer for sensitive content).
```

### 12.2 The quality rubric (per episode, twice)

The **15-parameter weighted visual rubric** (vendored at `reference/rubric-config/visual.v1.json`; ten-level anchors; weights summing to 100): first-frame hook 10 · visual story clarity 9 · vertical composition 8 · emotional readability 8 · reveal execution 8 · blocking & power geometry 7 · visual escalation 7 · cliffhanger image strength 7 · edit rhythm 7 · shot economy 6 · performance capture 6 · sound & music 5 · subtitle/UI safety 4 · **generability** 4 (production feasibility reinterpreted: does the plan fit what the generation models reliably render — crowds, hands, multi-arm motion, in-scene text — scored against the capability rows) · localization/compliance 4. Composites: **OVS** (overall, weighted), **CVP** (commercial pull: hook/emotion/escalation/reveal/cliffhanger/rhythm — the "will viewers stay" score), **VCS** (craft), **LCR** (compliance risk, inverted, floored at 70 on any policy flag). Genre adjustment `mythological_devotional` (+sound, +localization) applies; hard gates (hook ≤3 on an opener, reveal ≤3 on a reveal episode, unintelligible dialogue, caption-collision, cliffhanger ≤3 on a continuation episode) cap the verdict; the ladder reads **ready (≥82, CVP ≥78, LCR ≤30, no gates) → ready-with-minor-fixes (≥74) → recut → not-releasable**, with a fix-first priority list (weight × (10 − score) × context multiplier).

It runs at **two checkpoints**:
- **Plan mode, at Gate B** — scoring the shot list + rhythm map + keyframe intents *before generation spend* (plan-mode weight shifts: composition/blocking/economy/reveal/generability up; sound down). The gate shows the predictive OVS/CVP and the top-3 fixes; a weak plan is repaired while it costs tokens, not dollars.
- **Finished mode, at S9** — scoring the assembled episode; the verdict joins the episode-level reliability gate (§12.3).

**Repair routing:** the verdict's repair label maps to a Director action — *recut* → Editor EDD re-pass (reorder, re-trim, re-time; near-zero cost); *regenerate inserts* → produce the missing proof/reaction shots; *regenerate scene* → re-render one scene's clips; *re-plan* → back to S4. Each action is bounded, delta-quoted, and chosen as the smallest intervention with the largest expected score gain; one re-loop per episode by default, then human.

### 12.3 The episode-level gate

An episode ships only when: the glitch budget holds (zero flagged glitches on hero shots; ≤N background), the finished-mode verdict is ≥ ready-with-minor-fixes, LCR ≤ 50, and the role-gated sign-off is complete (for sensitive content). The quality target is tracked as a distribution — e.g. **P90 of a series' episodes ship with zero human-flagged glitch** — instrumented from episode 1. Rubric scores accumulate against `episode_performance`, so weights and thresholds can later be calibrated against real retention.

Total QC spend ≈ $0.50–1.50/episode API + serverless GPU for L1 — the instrument that caps the retry bill, not a cost center. All-in human time (gates + queue + sign-off + steering) is budgeted honestly at 30–60 minutes/episode early, tracked like cost, with risk-tiered graduation.

---

## 13. Model layer: adapters, routing, provider operations

**Adapter interface (capabilities, not vendors):** `gen_image`, `edit_image(refs[])`, `gen_video(i2v|ref2v|first_last)`, `gen_speech(→timestamps?)`, `align_speech`, `asr`, `gen_music(plan)`, `gen_sfx`, `video_to_foley`, `judge(image|video)`, `train_lora`, `upscale`, `color_conform`. Each adapter declares a capability row: durations, resolutions, 9:16 support, reference counts/types, native audio, timestamp support, price/s, latency class, content-policy quirks, `verified_at`, `conditional_on_spike?`. The router and the quote engine read only capability rows and refuse stale ones.

| Slot | Primary | Fallbacks | Notes |
|---|---|---|---|
| Keyframes | Nano Banana Pro 2K (Gemini image) | Seedream, FLUX.2 (+LoRA ref-synthesis lane) | Vertex routing where indemnity matters |
| Video — character shots | Kling 3.0 / Omni Elements | Veo 3.1 Fast | element-library headless API is a validation spike; keyframe is identity authority; model pinned per character/episode |
| Video — volume/B-roll | Seedance 2.0 Fast | Wan 2.x, Hailuo | conditional on face-filter + price spikes; fallback lane pre-priced |
| Video — hero/ambience | Veo 3.1 | Kling 3 Pro | 3–5 shots/episode at standard tier |
| TTS — Hindi / English | ElevenLabs v3 (voice library + Voice Design + cloning; audio tags for performance; character timestamps) | Sarvam Bulbul v3 (cheaper; native Hinglish) | dramatic-quality primary; A/B via spike #1; Devanagari input always |
| TTS — regional languages (post per-language gate) | Sarvam Bulbul v3 (artist-recorded regional voices, more idiomatic) | ElevenLabs v3 | integrated with each regional launch (D7) |
| Human VO | upload → forced alignment (ElevenLabs FA / MFA-Indic) + ASR-diff | — | segment-level alignment for chanting |
| Shlokas | cleared-library synthetic (Indic Parler self-host / designed pandit voice) | Camb.ai; human recordings for the Vedic lane | |
| Score | Score Library (curated, beat-gridded, stem'd) | generative lane offline (ElevenLabs Music → Stable Audio → Beatoven) | native model music never used |
| SFX / foley / impact | ElevenLabs SFX + MMAudio + impact library | — | |
| VLM judges | Gemini Flash (batch where non-blocking) | Gemini Pro; self-hosted Qwen-VL second judge | plus purpose-trained deity detectors |
| LLM | Claude (Director frontier-tier; crew mid-tier) | — | prompt caching; Director budget-stopped |

**Pricing bases:** two published tables — optimistic (promo/720p) and pessimistic (post-promo/1080p path) — with all envelope claims on the pessimistic one; the 720p→1080p delivery path (native tier vs upscale pass) is an explicit priced decision. **A second character-video provider is pre-qualified per series** at Gate A (look-matched), so a provider policy change is a known-good swap, not an emergency.

**Provider semantics the orchestrator encodes:** queue-based providers never reject (queued jobs are free; webhooks are at-least-once with retry windows; CDN-hosted outputs expire in days → a durable fetch-media step with an expiry alarm ingests every asset, and a `provider_jobs` state machine keyed by (provider, request_id) makes ingestion exactly-once across webhook + poll); rate-limited providers get client-side semaphores per plan/model family; token-bucket providers get spend-cap awareness (10-minute rolling caps can throttle a burst even when RPM is fine). Circuit breakers on hard-429 providers; queue-age alarms (not breakers) on queue providers. **Turnaround:** first cut in ~1 hour (P50 25–45 min; P95 60–120); interactive pre-production, async render; the state machine keeps the promise degradable, never breakable.

**Legal routing:** the Google/Vertex lane is the only vendor-indemnified path (unmodified-output condition needs counsel review for edited films); aggregator ToS pass nothing through (self-insured — reflected in the risk register); one major video vendor takes a perpetual license-back over outputs (accepted, monitored); reference-image content filters on one video vendor block photoreal human faces — moot here because references are AI-generated character sheets; music licensing is clean only on the curated-library lane.

---

## 14. The Edit Decision Document and deliverables

The EDD is the versioned single source of truth for the edit:

```jsonc
{
  "fps": 30, "canvas": [1080, 1920], "duration_ms": 92000,
  "narration": { "audio": "vo.wav", "words": [{ "w": "धर्म", "s": 1240, "e": 1610 }], "pauses": [...] },
  "score":     { "source": "library", "track_id": "lib_bhakti_07", "audio": "score.wav",
                 "arrangement": [...], "bpm": 88, "beats": [...], "downbeats": [...],
                 "dynamics": [{ "t": 41200, "move": "drop_to_silence" }], "duck_regions": [...] },
  "ambience":  [{ "scene": 1, "audio": "amb/temple_dawn.wav", "in_ms": 0, "out_ms": 31400, "gain_db": -22 }],
  "impacts":   [{ "t": 63800, "file": "impact/sub_drop.wav" }],
  "cuts": [{
      "shot_id": "s3_sh2", "clip": "clips/007.mp4", "clip_hash": "9f3…",
      "type": "cut | dissolve | fade | freeze | intercut",
      "in_ms": 480, "out_ms": 4620, "head_handle_ms": 200, "tail_handle_ms": 340,
      "freeze": { "frame_idx": 131, "hold_ms": 2400 },
      "kenburns": null,                     // stills/plates/non-hero fallbacks only, ≤1.08×
      "reason": "reaction carries the reveal; lands on downbeat 14", "provenance": "asset_9f3…"
  }],
  "sfx": [...], "overlays": [...],
  "captions": { "style": "karaoke", "source": "captions/words.json", "grouping": "grapheme_cluster" }
}
```

**Contracts.** Cuts are derived artifacts keyed by `clip_hash`: replacing a clip marks its cuts stale, triggers a scoped Editor re-pass (that cut ± neighbors), and bumps the EDD version; render and export refuse stale cuts. The beat grid is pre-computed from the Score Library (extraction runs only for the generative fallback). Cut-placement precedence: word-silence mandatory → beat-snap best-effort inside the silence window → scene-change downbeats may insert ≤300ms of silence rather than move a cut off a word gap. **The clip-conform contract:** shots are deliberately over-generated (~5s for a ~3s span) with motion-completion declared in the prompt; the Editor's vision pass selects in/out at the action apex, discarding each generation's first/last ~0.5s; handles are preserved for dissolves, beat nudges, and ±1s of editor slip in the NLE; **never time-stretch to fit** (≤±3% as a last resort — too-short is solved by regenerating longer or model-native extend); unused footage supplies reuse cuts; full untrimmed clips ship in the zip so a human can re-trim without regenerating. Ken Burns is restricted to genuinely static sources (freezes, stills, plates), ≤1.08× scale, with the framing check re-run on transformed geometry — never applied to AI video clips.

**Compiled deterministically three ways:** (1) the final 9:16 MP4 via an ffmpeg filtergraph compiler, plus hook-variant opening recuts; (2) OTIO + FCP7 XML — V1 video / A1 narration / A2 score / A3 ambience / A4 SFX, real cross-dissolve objects, raw clips with proper handles (baking is for the MP4 only), colored markers for beats/SFX/transitions; (3) the bundle zip (relative paths; every asset C2PA-signed). Because the pipeline is audio-first and the score is a known library track, a draft EDD with its beat grid exists at Gate B — before any clip is rendered.

---

## 15. Cost model & quote engine

Standard-tier 90s episode (≈15 cuts from ≈12 generated clips, ~60–75 pre-retry generated seconds, best-of-2 on 4 hero shots, 1.6× planning retry factor, pessimistic prices):

| Category | Pessimistic | Optimistic (verified cheap lanes) |
|---|---|---|
| Keyframes (≈40 generations) | $5.50 | $3.50 |
| Video (~100–120 retry-inclusive seconds, mixed routing) | $14–22 | $7–12 |
| Hero video (4–5 premium shots) | $5–9 | $3–6 |
| TTS + alignment (human-VO tier adds $5–20 retained / $50–145 one-off as labor) | $0.25 | $0.15 |
| Score (library ≈ $0 post-seeding) + ambience + SFX + foley | $0.75–1.50 | $0.60 |
| QC: VLM judges + detectors + rubric (plan + finished) | $0.75–1.25 | $0.40 |
| LLM (Director budgeted + crew, cached) | $2–4 | $1–2 |
| **Generation total** | **$28–42** | **$16–25** |
| Loaded infra allocation (serverless GPU, storage, egress, orchestrator) | +$1–3 | +$1–3 |

The envelope is **$15–40 standard** (pessimistic median ≈ $32), conditional on the pricing spikes; budget tier ≈ $13; premium $75+. Mechanics: a **series-setup quote at Gate A** ($10–90 by cast size, amortized per episode in every report); the **episode quote at Gate B** itemized per shot, with a narration-tier line, a filter-tax line on deity-heavy episodes (measured refusal × billed-anyway rates), and the Director's LLM budget; the quote total is the **absolute cap**, escrowed at enqueue; `billed_no_asset` outcomes ledgered; steering and Gate-C revisions delta-quoted from visible budgets; batch-API discounts booked only on non-blocking work (bible pre-generation, LoRA sets, library seeding, nightly re-QC). Org-level governance per §7.

---

## 16. Technology stack

- **App:** Next.js (App Router) + React + Tailwind + TypeScript strict. Chat-first steering surface bound to the Director session; the production board, In-Production queue, Library, calendar, and admin dashboards as live views over the same state.
- **Data/auth:** Supabase (Postgres + Auth + Storage + Realtime); RLS enforcing team roles and series ACL; schema per §8.
- **Orchestration:** a durable job runner (Trigger.dev-class: crash-surviving tasks, unbilled multi-day waitpoints for claimable gates, realtime progress, long CPU/GPU steps in-runner) — final choice by the orchestrator spike; step payloads carry IDs/URIs only.
- **Director:** Claude Agent SDK (TypeScript); decisions queue + transactional outbox in Postgres; per-episode budget stop; conversation log persisted per turn.
- **Renderer:** containerized ffmpeg compiler + color-conform service; Remotion held as a caption-layer fallback (license check).
- **Timeline service:** Python + OpenTimelineIO (+ adapter plugins) emitting `.otio` and FCP7 `.xml`.
- **Audio workers:** TTS adapters; forced-alignment service (ElevenLabs FA / MFA with Indic models / WhisperX); ASR for reconciliation and round-trip narration checks; beat/section extraction (librosa/madmom) for library ingestion; the deterministic mix chain (loudnorm, sidechain ducking, dynamic-range budget).
- **QC workers (serverless/spot GPU):** face/visual embeddings (permissively licensed), optical flow, SyncNet, the skin-tone check, the purpose-trained deity attribute/limb detectors, optional self-hosted VLM second judge.
- **Rubric engine:** the vendored rubric configs (`reference/rubric-config/`) drive judge prompts; all composite math, gates, verdict ladders, and fix-first priorities are computed deterministically in code from the JSON.
- **MCP server:** same service layer as the web API; local token auth for the internal phase.
- **Analytics:** platform analytics ingest → `episode_performance`; per-shot retention-drop attribution (the EDD knows every cut boundary); monthly grammar-review report into the Shot Director's knowledge base.

---

## 17. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Multi-arm/deity attribute glitches shipping (highest quality+legal risk) | Purpose-trained per-frame attribute/limb detectors with a hard recall launch-gate; camera-on-locked-keyframe for complex hero forms until the detector clears; per-frame checks on every retained frame |
| Shyama-varna skin drift (invisible to embeddings; theologically loaded) | First-class `skin_lab` + deterministic Lab check per frame + post-generation color-conform |
| Mid-clip morphing surviving first-frame checks | Temporal identity stability across all retained frames; shorter character clips; keep-best retries |
| Episodes ship with *some* glitch even when shots mostly pass | Episode-level gate with a hero-zero glitch budget; distribution target (P90 clean) instrumented from episode 1 |
| Output feels same-y / mechanical by episode 5 | Rhythm & Dynamics Map with mandated variance; rasa profiles; template + cliffhanger variation with anti-repetition memory; style-drift detector |
| Cuts feel like a slideshow of separate generations | Grade-conform pass; eyeline/180 + dominance continuity checks; cut-on-motion for flow shots; J/L audio bridges; ambience beds |
| Flat, unengaging storytelling | Beat→shot compiler with the reveal triad; dominance maps; plan-mode rubric scoring at Gate B (fix the plan before the spend); CVP tracked against real retention |
| Human-VO desync when the artist deviates from script | ASR-diff reconciliation rewrites spans to the actual audio; segment-level shloka alignment; `vo_pending` state |
| Team stalls / shared-canon races | Claimable gates + notifications; series advisory locks + ACL + audit history |
| Autonomy vs the legal shield | Risk-tiered autonomy: sensitive content always requires a qualified reviewer and never auto-graduates |
| Cost blowout | Quote-as-absolute-cap + escrow at enqueue + dollar retry budgets + delta-quoted steering + org ceilings + burn alerts |
| Provider policy change mid-season | Model pinned per character per episode; a second look-matched provider pre-qualified per series; adapter layer with `verified_at` rows |
| Cultural backlash / police complaint | The §11 engine end-to-end: regional sheets, revered-figure rules, ritual whitelist, counter-veneration targeting rules, role-gated sign-off, post-publication runbook, full audit trail |
| Platform demonetization of "inauthentic" mass AI content | Original scripts, per-episode differentiation, logged human editorial evidence, distinct series voices/looks |

---

## 18. Validation spikes (pre-build; each ≤1–2 days)

1. **Hindi TTS bake-off** — 20 devotional lines, blind (ElevenLabs v3 / Sarvam Bulbul v3 / Gemini TTS); verify v3 audio-tags × timestamp interaction; Bulbul timestamp support; shloka alignment accuracy.
2. **Deity prompt probes** per provider (incl. Kali/Narasimha gore-adjacent and revered-women scene classes) — refusal rate × billed-anyway behavior (the filter tax).
3. **Seedance stylized-face filter** — do AI-generated character sheets pass reference conditioning? — plus its per-second price check.
4. **NLE interchange fidelity** — synthetic 20-clip/4-audio-track timeline with dissolves and markers imported into Premiere; OTIO vs FCP7 XML.
5. **Provider concurrency under load** (funded account) — effective parallel job ceilings.
6. **Identity embeddings on stylized + non-human + deified faces** — per-look×kind thresholds; embedding licensing.
7. **Kling official API** — pricing durability, rate limits, 9:16 per endpoint, 1080p tier vs upscale.
8. **End-to-end sync proof** — a 30s scene: narration → timestamps → 6 shots → assembly; frame-accurate sync; EDD→XML round-trip; a 10-line **Devanagari karaoke caption** render test.
9. **Kling Omni element library headless** — create + reference via API; combinability with first/last-frame conditioning.
10. **Deity attribute/limb detector** — build on the project's own iconography sheets; measure recall on seeded violations (extra/missing arm, swapped hand objects, merged objects, mid-clip transients); set the pass threshold that gates launch.
11. **Orchestrator discriminators** — multi-day waitpoints, long GPU steps in-runner, payload limits, per-key concurrency.
12. **Score Library seeding sprint** — ~90 candidate tracks across the six rasas → curate 30–60 with a musically literate ear; beat-grid + section extraction; stems availability; motif-family coverage.
13. **Human-VO reconciliation** — a dramatic Hindi read + a Sanskrit chant: forced-align + ASR-diff; measure alignment error on chanting and reconciliation quality on deliberate deviations.
14. **Grade-conform + eyeline** — a 6-shot scene from separate generations, color-matched to a master and cut eyeline-consistent: does it read as one scene?
15. **Temporal stability + skin-tone** — a 5s deity clip: verify per-frame checks catch a seeded arm-drop and a seeded skin-lighten that sampled judges miss.
16. **Rubric judge calibration** — score 10 known-good and known-weak vertical episodes with the visual rubric judges; measure cross-run spread and agreement with human ranking before trusting plan-mode scores.

---

## 19. Roadmap

**Phase 0 — the quality-risk skeleton.** Single user, hardcoded plans, no Director session. Scope: the audio-first spine S1→S8 happy path (look-before-cast); Character Studio + Look Picker; minimum consistency stack (approved-portrait anchor + reference conditioning) **plus the four decisive conform checks** (skin-tone, attribute detector, grade-conform, eyeline modeling); one VLM judge pass; a seed Score Library (~10 tracks) with the deterministic dramatic mix; MP4 + clip zip out. **Exit criteria: one episode the team would genuinely publish, and a 6-shot scene that reads as one continuously-shot scene rather than a slideshow.**

**Phase 1 — the studio.** Everything in this document: the full crew + Director (revision steering, delta-quotes, outbox); both production flows + batch + templates; the full consistency + conform stack (detector recall gates, temporal stability, keep-best, canon promotion, drift QC, restyle events); the defect funnel + the rubric at both checkpoints + repair routing + the episode-level gate; the quote engine + escrow + org spend governance; the full cultural-safety engine; the team layer (auth, roles, ACL, claimable gates, notifications, calendar, performance view, library IA, lifecycle actions); human-VO; the craft system (rhythm maps, rasa profiles, beat→shot compiler, dominance maps, score dynamics, scale/impact sound); MCP surface; timeline exports; promotable moments; publishing + analytics ingest. Hindi + cleared shlokas; regional languages behind their gates.

**Phase 2 — scale & autonomy.** Risk-tiered auto-approval graduation (sensitive content never graduates); season/batch mode at full depth; the Episode Writer agent (season arcs → beat sheets → drafts against narrative state, human-approved); grammar auto-tuning from retention data; rubric-weight calibration against `episode_performance`; regional language launches as their gates clear; multi-team; optional external productization (the ledger becomes billing).

---

## 20. Open questions (tracked, non-blocking)

- Veo Hindi native dialogue support (gates any native spoken-moment path) — needs a hands-on test.
- ElevenLabs v3 billing multipliers and voice-slot limits vs cast size.
- Whether editing/grading voids the "unmodified output" condition of vendor indemnity (counsel).
- Final text of the Indian always-visible AI-labeling rule (draft stage at time of writing).
- Remotion company-license cost vs pure-ffmpeg for the caption layer.
- The Kling prohibited-content list (its policy pages are region-blocked; read from an Indian IP).
- Sarvam voice-clone API availability and pricing.
- Whether serialized micro-*drama* outperforms single-shot devotional reels for this audience — instrument episodes 1–20 and let the analytics answer.
- Whether the image-LoRA reference-synthesis lane earns its keep (style-parity spike).
- The attribute detector's architecture (detection vs segmentation head) and labeled-data volume needed to clear its recall gate.

---

## 21. Reference materials

**Research corpus** (the source of §10's direction system and §12's rubric; ~250 pages):
- `C:\Work\Code\microdrama-evaluator\input-research\Mobile-First Vertical Microdrama Visual Direction and Evaluation Framework.pdf` — duration models, the 12 visual-grammar rules, safe-zone standard, beat→shot conversion table, shot taxonomy, blocking archetypes, cinematography/performance/sound frameworks, genre playbooks (incl. mythological/devotional), India localization notes, and the 15-parameter evaluation rubric with composites, gates, and recommendation logic.
- `C:\Work\Code\microdrama-evaluator\input-research\Standalone Visual Direction Framework for Scripted Series.pdf` — the beat slot-fill contract, reveal triad, dominance mapping, exit-image doctrine, constraint-envelope/coverage-tier pattern, style-drift detection, and evaluation methodology.
- `C:\Work\Code\microdrama-evaluator\input-research\Implementation-Ready Microdrama Scriptwriting and Evaluation Framework.pdf` — episode beat-timing grids, hook/reversal/cliffhanger taxonomies, the reveal-map artifact, dialogue economy rules, series-structure models, and the 12-parameter script rubric.

**Vendored rubric configuration** (`reference/rubric-config/` in this repository): `visual.v1.json`, `script.v1.json`, `checks.v1.json` — a corrected, machine-readable synthesis of the research frameworks (anchors at all ten levels, weights normalized, gates and verdict ladders made deterministic), maintained in the micro-drama evaluator project (`C:\Work\Code\microdrama-evaluator`) and vendored here as the QC rubric source. The evaluator app itself is a standalone human-facing tool built on the same configs; this pipeline's `episode_performance` data is the future calibration set for both.

**Source assets to port** (from `C:\Work\Code\ai-director`, a prior production app whose components this design adopts):
- The 115 curated looks: `src/lib/styles/curatedLooks.ts` + `tools/look-gen/all-looks.json` (keep the pair in sync).
- The prompt corpus: `src/lib/prompts/**` (prompt-engine base + the Self-Contained Frame Law text, style-analyzer/CINE-TAIL, subject-analyzer, negative-tint mechanism), and `AI_Director_System_Prompts.md`.
- The reference-graph algebra: `src/lib/graph/masterCoverage.ts`, `referenceGraph.ts`, `src/lib/pipeline/composeShotReferences.ts`, `planRenderOrder`.
- The reference-roster render contract: `src/lib/fal/renderShot.ts` (name-bound roster system prompt, environment/continuity clauses, overflow priority).
- UI components: `src/components/CharacterStudio.tsx`, `LookGalleryModal.tsx`, `SetTheLookStage.tsx`, `ReviewStyleTailView.tsx`.
- Patterns: the `agent_calls` idempotency table, the single-source pricing ledger (`src/lib/cost/prices.ts`), defensive LLM-output parsing (`parseResponse.ts`), the declarative video-capability table (`videoCapabilities.ts`), and the motion-prompt discipline in `src/lib/agents/videoPlanner.ts`.
- The cinematography knowledge base: `Cinematic Shot Types_ A Director's Guide.md` and the six `deep-research-report (13–18).md` files (camera grammar, editing logic, director styles, lighting, scene analysis, modern Indian cinema visual language) — source material for the Shot Director's knowledge base and for re-authoring the two prompt-seed reference files noted below.
- Prompt-seed skills: the `zyra-prompt-engine` and `zyra-shot-director` skill bundles (under `C:\Users\shiba\AppData\Roaming\Claude\local-agent-mode-sessions\...\skills\`) — per-model prompt architectures (image two-block; video five-layer/SACT), genre DNA, the mythic-language pack (deity visual anchors, sacred environments, devotional lighting vocabulary), and the shot-director questioning flow. Note: `director-styles.md` and `visual-vocabulary.md` referenced by the shot-director skill are missing on disk and must be re-authored from the cinematography knowledge base above.

**Market context** (why the differentiators are differentiators): shipped script-to-video products (InVideo, HeyGen, Pictory, Revid, CapCut-class) universally use tag-selected library music deterministically fitted and ducked under VO, cut on narration boundaries only, export flat MP4s, and score nothing before generation. No script-first product beat-snaps cuts, exports an editable NLE timeline with handles and stems, quotes-then-caps spend, or scores a *plan* before money is spent — those four, plus the mythology-native craft and safety systems, are this product's edge. The category's loudest customer complaints — credits burned on failed generations, mid-video style drift, chat edits that mutate an opaque render — are answered structurally here by escrowed quotes with `billed_no_asset` ledgering, locked style tails + series canon, and edits that compile to explicit reversible EDD operations.

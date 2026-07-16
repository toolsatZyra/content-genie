# Genie by Zyra — Product and Solution Design

**Status:** Authoritative build contract
**Version:** 1.0
**Last updated:** 2026-07-17
**Supersedes:** `docs/archive/research-design-2026-07-10.md`
**UI source:** `DESIGN.md` and `docs/genie-ui/`

Companion contracts are authoritative within their domains:

- `docs/qc-release-contract.md`;
- `docs/state-and-data-contract.md`;
- `docs/threat-model.md`;
- `docs/provider-contract.md`;
- `docs/series-and-cultural-policy.md`;
- `docs/sdlc.md`.

If two artifacts appear to conflict, the narrower domain contract controls and
the inconsistency must be corrected before implementation proceeds.

## 1. Product definition

Genie is Zyra's internal, multi-user AI film studio for producing cinematic
Hindi devotional and mythological vertical videos from an exact user-supplied
narration script.

The launch product creates 60–120 second, 9:16 episodes for Instagram Reels,
YouTube Shorts, and Zyra's own content platform. The target operating volume is
at least five finished episodes per day.

The product promise is not merely automated video generation. It is reliable,
autonomous filmmaking:

- cinematic and engaging visual storytelling;
- stable characters, iconography, locations, costumes, lighting, and look;
- conversational, expressive Hindi narration with correct Sanskrit;
- a coherent and dramatically suitable background score;
- well-placed ambience, foley, SFX, silence, and impact;
- deterministic editing, captions, mixing, packaging, and export;
- automated defect detection, quality scoring, repair, and regression testing;
- a final human review surface with Monica-directed, timecoded repairs.

Genie is a shared studio. **Series define reusable creative worlds. Episodes are
independent, versioned productions. Monica coordinates quality and attention
across all of them.**

## 2. Launch scope and non-negotiable constraints

### 2.1 Included

- Hindi narration with user-selected male or female narrator.
- Default narrator gender: male.
- Default ElevenLabs voices:
  - male: `b0oby86k6n7Uh5LZcOBR`;
  - female: `GSdeLRB8detpjZjN63Wn`.
- Narration-only scripts. There is no character dialogue, lip-sync, or
  dialogue-driven shot mode at launch.
- Exact user-supplied script as the immutable semantic source of truth.
- 117-look visual vault, with the Indian mythology look selected by default.
- Generated or uploaded character and location anchors.
- Editable generation prompts and regeneration before accepting world assets.
- Automatic character-sheet generation after character acceptance.
- Series-level inheritance of look, characters, locations, narrator identity,
  score identity, pronunciation rules, and cultural constraints.
- Concurrent background production, repair, QC, export, and notification.
- Final-video review and Monica Repair Room.
- Direct downloads of the final master and production package.
- Internal multi-user roles and collaboration.
- Search, filters, archive, restore, audit history, and immutable exports.

### 2.2 Explicitly excluded from launch

- Topic-to-script generation. It is a later upstream feature.
- Silent rewriting, paraphrasing, shortening, or reordering of the input script.
- Dialogue and lip-sync.
- Routine human review of shot lists, generation prompts, individual clips, or
  intermediate edits after the world is locked.
- A full nonlinear editor. A future Clip Lab may expose advanced clip-level
  intervention without changing the underlying architecture.
- Public self-service SaaS, external billing, or anonymous access.
- Sentry. Product, provider, orchestration, cost, QC, and client diagnostics are
  stored in Supabase.

### 2.3 Script integrity

For text entered or pasted in the product, the immutable source is the exact
Unicode code-point sequence received from the browser. Genie persists that
sequence as `raw_text`, serializes it as UTF-8, and records `raw_utf8_sha256`.
For an uploaded text file, Genie additionally preserves the original bytes,
encoding declaration/detection result, and original-file checksum.

Genie derives a separate `processing_text` using only documented Unicode NFC
normalization and LF line endings. It records `processing_utf8_sha256` and an
index map between raw and processing code points. It never trims, spell-checks,
transliterates, changes punctuation, collapses whitespace, or substitutes
Devanagari characters. Both representations remain inspectable.

Text offsets are never represented by an unqualified integer. The canonical
cross-system span contract stores, for each boundary:

- raw UTF-8 byte offset;
- raw Unicode scalar-value offset;
- processing UTF-8 byte offset;
- processing Unicode scalar-value offset;
- browser UTF-16 code-unit offset, used only at the browser boundary;
- extended grapheme-cluster ID and boundary according to a pinned Unicode/UAX
  #29 version.

The normalization and segmentation library/version are part of the locked
script manifest. JavaScript `.length`, PostgreSQL character count, provider
word indices, and transcript-tool offsets are never assumed equivalent.
Round-trip fixtures include Devanagari combining marks, nukta, ZWJ/ZWNJ,
emoji, CRLF, mixed normalization forms, and leading/trailing whitespace.

Language, revision, lock actor, normalization version, and checksums are
persisted. All production intelligence is additive sidecar data:

- pronunciation and Sanskrit annotations;
- performance, emotion, breath, pause, emphasis, and pace;
- narration timing and word alignment;
- scene, beat, entity, sound, shot, and edit planning;
- citations, cultural tags, and safety constraints.

Sidecars may never mutate either locked representation. If a requested repair
implies a wording change, Monica must route it to a separate explicit
script-revision workflow. TTS segments, transcript alignment, and captions
reference processing-text spans; every rendered caption is reconciled through
the index map to the locked raw words. The UI always displays the raw source.

## 3. Product structure

```text
Workspace
├── Studio Home / My Work
├── Series
│   ├── Series Release / World Bible
│   │   ├── Look Pack
│   │   ├── Characters and forms
│   │   ├── Locations
│   │   ├── Narrator and pronunciation rules
│   │   ├── Score and sound identity
│   │   └── Cultural and continuity rules
│   └── Episodes
│       ├── Episode configuration versions
│       ├── Production runs
│       ├── Masters and repair branches
│       └── Export packages
├── Productions
├── Monica Inbox
└── Library / Archive
```

### 3.1 Workspace

The launch workspace is `Zyra Internal`. It contains users, roles, shared
libraries, spending policies, notifications, series, and episodes.

### 3.2 Series

A Series is not a mutable folder. It is a versioned creative world. Every
approved World Bible change creates a coherent **Series Release**. A release
pins exact versions of every inherited asset so an episode never reads an
incoherent mix of "latest" records.

A Series Release is an internal, immutable world seal, not a public-content
approval. Publishing the seal is nevertheless a version-bound authority
boundary: an authorized Series editor reviews the manifest, passes a current
`aal2` check, and records approve or deny against the exact candidate hash.
The initial owner can hold this permission, so the explicit **Lock the world**
action remains one fluid gate rather than an additional hand-off.

Series releases contain:

- visual look and exact prompt-tail recipe;
- approved character identities, forms, wardrobe, ornaments, attributes, and
  voice identities where applicable;
- approved locations and environment recipes;
- narrator voice and pronunciation lexicon;
- score theme, motif family, and sound rules;
- market tradition, source/canon rules, ritual constraints, and safety rules;
- continuity and narrative-state data.

Episode 1 begins against a **Series Draft**, not a partially published release.
The user's accepted look/world assets, the selected narrator, the generated
pronunciation policy, and Monica's selected score/sound identity are assembled
into one candidate release. Automatic character-sheet/reference-pack QC,
source/rights readiness, deity or temple manifests, and the machine cultural
preflight must pass before the candidate can be approved. Immediately before
expensive generation, the authorized Lock-the-world command and one
serializable transaction:

1. revalidates the exact approved candidate hash, authority, and `aal2`;
2. revalidates the exact executable quote, full high envelope, hard ceiling,
   and remaining budget authority;
3. records the immutable Series-release and budget-authorization decisions;
4. publishes immutable Series Release 1;
5. creates and activates the Episode configuration version;
6. reserves the full itemized high envelope;
7. creates the production run and pins that exact release, configuration,
   quote, authorization, and reservation.

If the transaction fails, no partial release or production run is visible.
Later approved changes create a new release; they never mutate Release 1.

Approved Episode outcomes do not mutate Series continuity implicitly. Monica
creates an immutable **Episode Outcome Proposal** containing narrative facts,
relationship/state changes, newly established visual rules, provenance, and a
base continuity-version hash. An authorized Series editor may accept, amend,
reject, or defer it. Acceptance uses compare-and-swap to create a new continuity
state version and, when adopted, a new Series Release. Parallel Episodes stay
pinned to their earlier state; conflicts require rebase, branch, or explicit
dependency ordering.

### 3.3 Episode

An Episode is the durable identity of one video. It may have multiple immutable
configuration versions, production runs, repair revisions, masters, and export
packages.

When created, an episode pins a Series Release. Later series changes never
silently affect it. The episode may:

- stay pinned;
- preview and adopt a newer release;
- create an explicit episode override;
- propose an approved override back to the Series;
- be marked stale or blocked by a serious cultural/canon correction.

## 4. Primary user journeys

### 4.1 New series and first episode

1. Create a Series.
2. Create Episode 1 and submit the exact narration script.
3. Select narrator gender and performance direction.
4. Select one of 117 looks; Indian mythology is preselected.
5. Genie extracts required characters and locations.
6. Genie generates visual anchors in the locked look.
7. The user accepts, edits the prompt and regenerates, or uploads an anchor.
8. Genie creates and quality-checks character sheets automatically.
9. Genie builds the source, rights, deity/temple, reference, and cultural
   readiness packet and shows any fail-closed blocker.
10. Genie presents the low/expected/high production quote and hard ceiling.
11. The authorized user locks the exact world and cost ceiling; the accepted
    world becomes Series Release 1.
12. Autonomous production starts and the user may leave the episode.
13. Monica and specialist agents plan, generate, assemble, QC, and repair.
14. The user receives a notification when the final candidate is ready.
15. A qualified reviewer records cultural approval separately from the
    creative/final decision, then approves or submits timecoded repair feedback.
16. Genie packages immutable exports for download.

### 4.2 Later episode in an existing series

1. Create the next Episode inside a Series.
2. Submit and lock the new script.
3. Genie extracts entities and matches them against stable Series identities and
   aliases.
4. Existing look, narrator, characters, locations, and sound identity are
   inherited automatically.
5. Only new, ambiguous, incompatible, or explicitly overridden assets are
   presented for human resolution.
6. The episode pins the resulting coherent Series Release/configuration and
   enters autonomous production.

### 4.3 Concurrent work

All production is server-owned and resumable. A user can start one episode,
leave it generating, create another, review a teammate's film, and return later.
Browser closure, logout, navigation, frontend deployment, or another user
opening the episode cannot interrupt a production run.

## 5. Experience architecture

The product has two complementary experiences.

### 5.1 Studio Atrium

The operational shell manages:

- Home / My Work;
- Series and World Bibles;
- Productions;
- Monica Inbox;
- Library, search, filters, archive, and download;
- team roles, assignments, claims, and spend.

It must be calm, image-led, and highly scannable rather than a generic
enterprise dashboard.

### 5.2 Living Cinema

The immersive episode experience handles:

- Source;
- Voice;
- Look;
- World;
- Create;
- Premiere and Repair.

The shell recedes inside an episode, leaving a slim Studio Dock for leaving,
switching productions, seeing running jobs, and opening Monica.

### 5.3 Attention design

Home answers:

1. What needs me?
2. What is Monica working on?
3. What was completed recently?

The in-product inbox is the source of truth. Email or Slack may be added as
delivery channels later, but must never become separate task systems.

## 6. Human decisions and autonomous boundary

Routine launch decisions are:

1. Provide and lock the exact script.
2. Choose narrator gender/performance direction.
3. Choose the Series look.
4. Accept, redirect, or upload new character and location anchors.
5. Review the finished film and approve it or request repairs.

After the world is locked, intermediate plans and clips are not routine human
gates. Monica may repair autonomously within the approved cost and quality
contract. She fails closed when she cannot preserve script integrity, cultural
safety, identity, or the quality floor.

High-consequence actions—unlocking a script, changing a Series Release, raising
a budget ceiling, resolving an eligible cultural exception, or approving a
final master—are explicit, version-bound, permission-checked actions.

Monica is a machine quality certifier and release orchestrator, not a legal,
theological, or human editorial authority. At launch, only a permitted human
reviewer can release a master. Cultural-policy blockers classified as
non-overridable cannot be waived in the product. Eligible exceptions require a
reason, evidence, and approval from both an admin and a reviewer whose
competency covers the relevant tradition.

## 7. Monica and the agent system

Monica is the machine Quality Director, release orchestrator, and user-facing
explanation layer. She certifies machine readiness and assembles release
evidence; she does not directly render media or replace the final human
approver.

### 7.1 Deterministic spine

A durable workflow owns stage execution, retries, waitpoints, idempotency,
provider callbacks, timeouts, compensation, and recovery.

### 7.2 Agent judgment

Structured agents produce schema-validated artifacts:

- Script Analyst: entities, scenes, beats, cultural tags, and sidecars.
- Source Keeper: citations and fidelity classification.
- Pronunciation Director: Hindi/Sanskrit lexicon and performance markings.
- Casting Director: character/location briefs and reference plans.
- Look Analyst: exact two-block prompt construction and locked look tail.
- Story Director: beat coverage, emotional arc, hook, escalation, and ending.
- Shot Director: shot plan, composition, camera, motion, and duration.
- Prompt Engine: image and video prompts with exact reference bindings.
- Voice Director: segment performance and candidate selection.
- Music Director: score retrieval/generation and arrangement.
- Sound Director: ambience, foley, SFX, silence, and impact plan.
- Editor: deterministic Edit Decision Document.
- QC Jury: independent defect and quality judgments.
- Cultural Guardian: iconography, temple, ritual, dignity, and tradition checks.
- Repair Planner: smallest safe dependency closure and repair DAG.

Agents propose typed decisions. Workers perform side effects. No free-form agent
conversation is a recovery mechanism or database of record.

### 7.3 Durable decision protocol

- Every input and output is versioned and content-hashed.
- Every external request has an idempotency key.
- Provider completions use effectively-once commits: signed callbacks/polls may
  arrive multiple times, but database uniqueness, inbox/outbox records, and
  compare-and-swap allow only one authoritative state transition and asset
  commit.
- Decisions and intended actions commit through a transactional outbox.
- Stale completions are recorded for cost but cannot overwrite newer revisions.
- Automatic retries have bounded candidate, time, and dollar budgets.
- Monica narrates material repairs in plain language.

## 8. Media production pipeline

### S1 — Ingest and lock

Persist the exact script, checksum it, create an immutable revision, extract
entities/scenes/beats, and attach sidecars. Advisory script scoring may identify
risks, but may not rewrite or block the user's script. Before lock, show an
estimated narration duration. A script outside the intended 60–120 second band
requires explicit acknowledgement; it is never shortened or padded
automatically.

### S2 — Voice and master clock

Use the chosen ElevenLabs narrator identity. Generate performance candidates by
segment, verify exact-text round trip, Sanskrit pronunciation, clipping, pace,
emotion, and naturalness, then concatenate the accepted narration. Persist
word/character timestamps. Narration becomes the master clock. Exact synthesized
duration is a hard production gate: outside 60–120 seconds, the user may revise
performance direction or explicitly start a new script revision, but Genie may
not change wording. Performance direction and synthesis settings are versioned;
changing either invalidates narration, timing, shot, sound, edit, QC, and master
descendants.

### S3 — Look

Present the 117-look vault. The selected look creates a versioned Look Pack:

- preview asset;
- exact style-tail paragraph;
- negative policy;
- color/contrast/texture/lens behavior;
- visual QC baselines.

Every image prompt is:

1. shot-specific subject, action, composition, lighting, and environment;
2. the locked look paragraph, unchanged.

### S4 — World

Match or create characters and locations. Generate anchors using the locked
look. The user may accept, edit prompt and regenerate, or upload. After
acceptance, generate character sheets and derived reference crops
automatically. QC identity, anatomy, skin tone, deity attributes, costume,
architecture, dignity, and reference usability. Build a versioned reference
pack, source registry extract, rights classifications, deity/form manifests,
named-temple evidence where applicable, and machine cultural-readiness report.
The world cannot become publishable while any mandatory artifact is missing,
stale, unverified, or release-blocking.

### S5 — Story, rhythm, sound, and shot planning

Compile the immutable script and narration timing into:

- beat and reveal maps;
- hook, escalation, suspension, climax, and exit-image plan;
- shot list and narration-span coverage;
- camera, motion, composition, eyeline, and performance beats;
- score, ambience, SFX, silence, and impact plan;
- predictive visual/script rubric scores;
- an itemized low/expected/high cost estimate and hard execution ceiling.

Weak plans are repaired before expensive generation. Before the first paid
video enqueue, the user sees the route assumptions and authorizes the exact hard
ceiling. The full per-request high envelope, including provider billing
duration buckets and every bounded retry/alternate slot, is reserved and must
fit within that ceiling. Candidate multipliers are feasibility heuristics only;
dispatch uses the versioned executable BOM. World-asset requests made earlier
use bounded, visible micro-reservations against the same Episode ceiling.

### S6 — Keyframes

Compose self-contained frame prompts with only the required character/location
references. Generate alternatives, run deterministic and VLM QC, and retain the
best passing candidate. No video spend occurs for a failing keyframe.

### S7 — Motion

Route each shot by capability:

- simple camera and simple subject motion: Kling 2.5 through fal.ai;
- camera-motion-led shots: Kling 3.0;
- other supported video generation: Seedance;
- complex topology-sensitive deity forms: camera motion on a locked keyframe
  unless a validated provider lane safely supports the motion.

Provider endpoint IDs remain configuration data with `verified_at` dates. The
router refuses stale or unverified capability rows.

Inspect retained frames for identity drift, anatomy, topology, extra/missing
limbs, attribute assignment, skin-tone drift, flicker, morphing, physics,
contact, motion completion, and refusal artifacts.

### S8 — Score and sound

Use four continuous layers:

1. narration;
2. score;
3. scene ambience;
4. spot SFX, foley, silence, and scale/impact.

Launch provider policy:

- score primary: a Zyra-owned, tagged, beat-gridded Score Library in Supabase
  Storage;
- automated score fallback/extension: ElevenLabs Music, ingested and frozen
  with provenance before reuse;
- Epidemic Sound: optional licensed source library, not assumed to have a
  headless download API;
- SFX primary: ElevenLabs SFX plus owned/licensed library assets.

Per-clip native music is never the soundtrack. Native audio may be harvested as
low-level ambience or foley only.

### S9 — Deterministic edit and mix

The Edit Decision Document is the source of truth for:

- cuts, handles, transitions, overlays, and captions;
- narration words and pauses;
- score arrangement and beat grid;
- ambience and SFX cues;
- color-conform operations;
- provenance and reasons for each edit.

Compile it to MP4 through ffmpeg and to OTIO/FCP7 XML. Never time-stretch video
to hide a generation-duration failure except within a tightly bounded final
conform tolerance.

### S10 — QC, challenge, and automatic repair

QC is two connected systems:

- a defect funnel asking whether anything is broken;
- quality rubrics asking whether the film is engaging, cinematic, coherent,
  emotionally effective, culturally respectful, and releasable.

Checks run at shot, boundary, scene, track, and full-episode levels. Monica
routes the smallest safe repair, rechecks every affected dependency, then runs
full-master regression QC. Quality thresholds never fall because budget or time
is running out.

### S11 — Premiere, repair, export

Present the final passing candidate and complete evidence packet. A qualified
cultural reviewer records a separate version-bound cultural decision. The same
person may then record creative/final approval when they have both permissions,
but the database stores two decisions. The user may approve or open Monica's
Repair Room. An approved master produces versioned download packages and can
later be published through a channel adapter.

## 9. Monica Repair Room

The Repair Room is a curated conversation, not unrestricted chat-to-render.

The canonical input is a versioned repair brief containing unlimited practical
feedback rows. Each row stores:

- stable row ID;
- source master version;
- point timestamp or time range;
- captured frame;
- original user text;
- transcript/shot/track targets;
- Monica's interpreted intent;
- constraints and invariants;
- status and clarification;
- linked repair tasks and evidence.

Flow:

1. Add note at playhead, mark a range, select transcript words, or type a
   timestamp.
2. Monica maps viewer time to the narration master clock, shots, transitions,
   captions, score, ambience, and SFX.
3. She detects duplicates, overlap, contradictions, forbidden script changes,
   global changes, and unsupported requests.
4. She paraphrases what will change and what remains locked.
5. Invalid or out-of-master ranges cannot enter a plan. Ambiguous overlaps,
   contradictory rows, unsupported capabilities, and script-changing requests
   become explicit clarification/blocker states rather than guessed work.
6. She merges compatible rows into the smallest safe dependency-aware Repair
   Plan and exposes the affected shot/track/dependency closure.
7. The plan freezes its source versions, ordered row interpretations, task DAG,
   low/expected/high delta quote, hard ceiling, and canonical plan hash.
8. The user confirms that exact hash and hard ceiling before spend.
9. Workers execute a versioned repair branch.
10. Monica runs local, boundary, dependency, and full-master regression QC.
11. The user receives A/B affected-range review, a row-by-row resolution report,
    the complete new master, and rollback.

A selected timestamp is not promised as the literal generation unit. Most
visual repairs regenerate the containing shot and adjacent handles. Score and
ambience repairs may extend beyond the highlighted range to avoid audible
seams. Master duration and narration wording remain locked unless the user
starts an explicit script revision.

Every repair branch pins its source master, EDD, Series Release, and dependency
versions. Only one branch may promote from a given source version at a time.
Promotion uses compare-and-swap; a branch whose source has been superseded must
be rebased, explicitly abandoned, or retained as a non-promotable experiment.
Two accepted repairs can be merged only by compiling a new EDD and rerunning
full-master regression QC—never by silently overwriting each other's assets.

## 10. Quality system

Machine-readable rubric files under `reference/rubric-config/` are versioned
inputs to the QC engine. Deterministic code computes weights, composites,
thresholds, gates, and fix-first priorities; LLM/VLM judges provide discrete
evidence-backed scores.

The generic rubric corpus contains dialogue and lip-sync checks. A versioned
Genie launch applicability profile must disable those checks for narration-only
episodes and reinterpret `dialogue_masking` as `narration_masking`. Disabled
checks are recorded as `not_applicable`, never silently omitted or counted as
passes.

The existing rubric JSON is research input, not by itself a releasable runtime
contract. Implementation must add a versioned stage contract defining:

- which parameters/checks apply at script, plan, shot, scene, repair, and final
  checkpoints;
- which outputs are advisory, repair-triggering, release-blocking, or
  not-applicable;
- exact threshold and verdict calculations;
- evidence and confidence requirements;
- deterministic repair labels;
- the rubric/configuration version attached to every verdict.

Script-rubric gates are advisory at launch because the user script is immutable.
They may influence planning and warn the reviewer, but may not rewrite or reject
the script. Cultural/policy eligibility is separate and may block production
without changing the script.

Required dimensions include:

- first-frame hook and scroll stopping;
- visual story clarity;
- vertical composition and safe zones;
- emotion and performance readability;
- reveal and climax execution;
- visual escalation;
- blocking, scale, and power geometry;
- edit rhythm and shot economy;
- character/location/look continuity;
- motion quality and temporal anatomy;
- narration naturalness and pronunciation;
- score, SFX, silence, ambience, and mix;
- captions and UI safety;
- cultural, iconographic, ritual, and temple fidelity;
- generability and regression risk.

Generative judges do not certify their own output in the same unblinded
context. The runtime combines deterministic media checks, specialized
detectors, and at least one evaluator configuration isolated from the
generation prompt and candidate-selection rationale. High-consequence or
low-confidence verdicts receive a challenger evaluation. Candidate ordering is
blinded where practical, evidence timestamps are mandatory, disagreements are
stored, and no detector becomes release-blocking until a seeded evaluation set
has established its minimum recall and false-positive bounds.

Release requires:

- zero critical visual, audio, script, cultural, or integrity defects;
- zero hero-shot glitches;
- exact narration/caption reconciliation;
- passing episode-level visual and script/rhythm contracts;
- no unresolved stale dependencies;
- a complete evidence bundle;
- final approval against the exact master version shown.

The first 10–20 user-supplied sample scripts and benchmark episodes are a
post-build pilot/tuning set. They are not prerequisites for software
implementation and cannot by themselves justify a production-calibrated claim.
Promotion requires a predeclared stratified benchmark of at least 50 Episodes:
at least 30 calibration Episodes plus an independent holdout of at least 20,
two qualified human raters, per-slice confidence reporting, and the detector
evidence defined in the QC contract. Unsupported look/provider/deity cells keep
their conservative fallback or human-review requirement. Until every relevant
gate passes, software may generate and repair complete Episodes, but every
release remains human-approved and automated quality confidence is labelled
provisional.

## 11. Cultural and theological policy

- Treat canonical, regional-tradition, and popular-retelling sources
  distinctly and record fidelity.
- Regional retellings are allowed when identified.
- Research real temple references before depicting a named temple.
- Use actual architectural references as geometry evidence, not as unrestricted
  style transfer material.
- Violence and romance follow the restraint and dignity of mainstream Indian
  devotional cinema.
- No nudity or religious-conflict content.
- Caste and social roles may be depicted realistically for the era without
  humiliation, stereotyping, or present-day hate framing.
- Deities require explicit attribute manifests, form rules, skin-tone rules,
  ornaments, weapons, vahana, hand assignments, and dignity checks.
- Standalone frames, thumbnails, and freeze frames must remain respectful when
  detached from narration context.
- Sanskrit and shlokas require source, pronunciation, and cleared-use evidence.

Every factual, iconographic, ritual, architectural, or textual assertion that
affects generation links to a versioned source-registry entry. An entry records
title, tradition/region, edition or URL, passage/page when applicable,
retrieval date, rights/use basis, evidence asset checksum, reviewer notes, and
confidence. Named-temple imagery records the exact reference photographs and
their permitted use; references guide geometry and factual detail but are not
assumed to permit copying a photographer's expressive composition.

Every Episode has a Source Review work item and an immutable review decision.
Accepted evidence classes, stable citations, archive handles, rights status,
contradictions, and unresolved claims are explicit. Model research is only a
lead. A missing or withdrawn source, uncertain rights basis, or unresolved
generation-affecting contradiction fails closed.

Reviewer competency is a versioned entity with tradition, region, language,
content-class scope, evidence of appointment, issuer, start/expiry, recusal and
conflict-of-interest records, suspension, and revocation. A decision is valid
only when the competency covers the subject at decision time. The owner may be
the initial broad reviewer, but the UI and audit must never infer competence
merely from admin status.

Non-overridable blockers include nudity, religious-conflict content,
degrading/hateful caste depiction, sexualized deities or minors, deliberate
misattribution of scripture, missing identity-defining deity attributes, and
disallowed provider-policy content. Other ambiguity may be resolved only
through the evidence-backed exception workflow defined in §6.

Monica may detect and explain policy risk, but a qualified human reviewer owns
the cultural release decision. Reviewer competency is scoped by tradition,
region, language, and content class. Policy evidence, reviewer competency,
exceptions, and decisions are versioned and auditable.

## 12. Collaboration, permissions, and concurrency

Roles:

- admin;
- reviewer/approver;
- member;
- onboarding/pending.

Separate Creator, Owner, Assignee, and Claimant. Reviews and approvals are
granular work items with time-bounded claims, not whole-episode locks.

Use optimistic concurrency and compare-and-swap for version-bound actions.
Never silently last-write-wins. Preserve conflicting inputs and allow compare,
merge, discard, or fork.

Granular locking:

- script editing before lock;
- individual world assets;
- Series Release changes;
- approved Repair Plan execution;
- final approval and export against a specific master.

An upstream change during production creates a new pending configuration. It
does not mutate the active run.

### 12.1 Claims, leases, and command ordering

- Claims are time-bounded leases with heartbeat, expiry, takeover, and fencing
  tokens.
- Submission revalidates lease, role, object version, and permission.
- Commands for one Episode configuration are serialized through a monotonic
  sequence; stale/out-of-order commands cannot commit.
- One authoritative production run may write a given Episode configuration.
  Replacement runs explicitly supersede earlier runs.

### 12.2 Capacity and backpressure

- Provider concurrency is limited per account, model, and capability.
- Workspace queues use fair scheduling so one large episode cannot starve all
  other users.
- High-cost generation requires a budget reservation before enqueue.
- Queue depth, oldest-job age, provider throttling, and per-workspace spend
  produce alerts.
- The launch load test covers at least five daily episodes, overlapping repair
  jobs, simultaneous users, duplicate callbacks, and one degraded provider.

## 13. State model

Do not overload one status field.

Episode workflow:

`draft | world_setup | ready_to_produce | pending_qualified_review |
awaiting_final_review | approved | delivered | archived | abandoned`

Production-run lifecycle:

`created | queued | running | paused | waiting_external | waiting_decision |
succeeded | failed | canceled | superseded`

Repair lifecycle:

`draft | interpreting | needs_clarification | awaiting_confirmation | queued |
repairing | regression_qc | ready_for_review | accepted | rejected | failed |
canceled | superseded`

`accepted` means the repaired candidate was selected as the Episode's current
qualified-review target. It never means release approval. Selection atomically
supersedes the prior active creative/final-review selection, clears the prior
cultural-decision selection, returns the Episode to
`pending_qualified_review`, and creates a fresh qualified-cultural-review
item. Only a new qualified cultural approval bound to the exact repaired
master, policy, source, evidence, and competency versions can advance it to
`awaiting_final_review`; the separate creative/final decision follows.

Export lifecycle:

`requested | packaging | ready | failed | expired | superseded | canceled`

Health:

`healthy | delayed | retrying | provider_failed | quality_blocked |
budget_blocked | stale_dependency | canceled`

Attention:

`none | needs_me | needs_team | waiting_on_system | watching`

Freshness:

`current | series_update_available | stale | superseded`

Every client label is derived from authoritative server state.

State transitions are implemented as an allowlisted transition table with
actor, precondition, idempotency, side effect, emitted event, and recovery
rules. Terminal states cannot be reopened by a late callback.

## 14. Search, notifications, library, and exports

Search indexes Series/Episode titles and numbers, locked script text,
characters, locations, deities, looks, narrator, owner/creator/assignee,
statuses, blockers, repair notes, master versions, and dates.

Launch search uses Postgres full-text search plus trigram matching. A separate
search engine is unnecessary.

Notify only on actionable or material events:

- assigned/claimable action;
- clarification required;
- QC or cultural blocker;
- repair-plan confirmation;
- final review ready;
- budget threshold/hard stop;
- provider failure requiring action;
- material Series update;
- export ready;
- claim expiry/takeover.

Notifications are deduplicated, stateful, and deep-link to the exact asset,
timestamp, repair row, or review.

Export packages are immutable records, not a mutable download button:

- review candidate;
- approved master;
- superseded master;
- captions;
- stems;
- OTIO/FCP7 timeline;
- source bundle;
- thumbnails and promotable clips;
- QC, cost, and provenance reports;
- checksums and retention state.

Each package contains a machine-readable deliverable manifest with artifact
path, media role, MIME type, byte length, SHA-256, source version, and
provenance link. The launch approved-master profile is:

- `final.mp4`: 1080×1920, 9:16, 30 fps constant frame rate, H.264 video, AAC
  audio, target −14 LUFS integrated and no higher than −1 dBTP;
- captions: burned-in master plus SRT, ASS, and timed JSON sidecars;
- audio: narration, score, ambience, foley, and SFX stems plus final mix;
- edit interchange: canonical EDD JSON, OpenTimelineIO, and FCP7 XML;
- media: untrimmed source clips or durable source handles with edit handles;
- reports: QC, cost, cultural/source, provider, license, and audit evidence.

Economical 720p lanes conform through `fal-ai/topaz/upscale/video` only after a
clip passes retention QC. The primary launch route is 720p-to-1080p Topaz at the
dated rate in `docs/cost-envelope.md`; native-1080p generation is an explicitly
quoted alternative. Upscale output must pass identity, deity-attribute,
temporal-flicker, halo/ringing, face/hand, text, color, frame-count, duration,
and resolution probes. One bounded retry may change the upscale model/settings;
failure blocks the master rather than shipping 720p or inventing pixels through
an unqualified route.

The package includes an explicit provenance/AI-generation declaration.
C2PA signing is feature-gated, not promised at launch: it may be marked
`not_signed` until Zyra has configured signing credentials, certificate
rotation, asset-by-asset signing policy, and verification tests. The product
must never label an artifact as C2PA-signed without cryptographic verification.

Archive is reversible lifecycle state, not deletion.

## 15. Technical architecture

### 15.1 Application

- Next.js 16 App Router;
- React 19.2.4 or later patched release;
- TypeScript strict;
- Tailwind CSS 4;
- accessible headless/shadcn primitives adapted to the Living Cinema visual
  system;
- Server Components by default and narrowly scoped Client Components;
- server-side authorization on every sensitive action.

### 15.2 Data and identity

- Supabase Auth;
- Supabase Postgres;
- Supabase Storage;
- Supabase Realtime for progress, inbox, presence, and state transitions;
- RLS on every exposed table;
- membership/ACL data in database tables and trusted app metadata, never
  user-editable metadata.

### 15.3 Orchestration

- Trigger.dev durable workflows;
- Postgres transactional outbox and decision queue;
- step payloads carry IDs and URIs rather than large media;
- provider-specific concurrency controls, poll/webhook reconciliation, circuit
  breakers, and queue-age alarms.

### 15.4 Provider adapters

Application code calls capabilities rather than vendor endpoints:

`reason`, `judge`, `gen_image`, `edit_image`, `gen_video`, `gen_speech`,
`align_speech`, `asr`, `gen_music`, `gen_sfx`, `upscale`, `color_conform`.

Capability rows include supported inputs, references, durations, resolution,
9:16 support, timestamps, price, latency, policy quirks, and `verified_at`.

Default voice IDs and model routes are configuration records with account
ownership/license evidence, environment availability, `verified_at`, and tested
fallbacks. A missing or inaccessible default may pause before spend or route to
an explicitly prequalified fallback; it may never silently change Series voice
identity.

### 15.5 Storage

Supabase Storage is the durable asset store. Provider CDN URLs are ephemeral
ingress only. A fetch-and-ingest task records:

- content hash;
- media probe;
- source request;
- model/provider/version;
- prompt and references;
- cost and retry;
- retention and provenance.

### 15.6 Rendering

At launch, rendering runs as a dedicated Trigger.dev Cloud task queue, not a
Vercel function or an unspecified host. The deployment pins a Node 22 container
image digest, ffmpeg/ffprobe 7.x build checksum, libass, required Devanagari
fonts and checksums, and the EDD compiler version. A render task requests at
least 4 vCPU and 8 GB RAM on Trigger.dev Cloud's `large-1x` machine, uses no
GPU, and treats the documented 10 GB disk as a hard platform limit. It is
capped at three concurrent renders for the five-Episodes-per-day launch target.

The renderer MUST keep its own scratch high-water mark below 7 GB. It never
materializes the complete source bundle locally. Inputs arrive through
manifest-scoped signed URLs; the worker downloads only the current segment or
track chunk, streams into ffmpeg pipes where practical, uploads each verified
intermediate immediately, and deletes its local copy. A long or media-heavy
EDD is partitioned into independently rendered segments followed by a bounded
concat/mux pass. At 70% disk use the worker stops admitting new local inputs;
at 80% it checkpoints, cleans verified intermediates, and either resumes or
fails closed with `RENDER_PARTITION_REQUIRED`. A larger Trigger.dev CPU/RAM
preset is not treated as a disk fallback because the documented Cloud presets
have the same 10 GB disk allocation. The pinned platform evidence source is
<https://trigger.dev/docs/machines>; an authenticated deployment canary must
confirm the selected environment before render enablement.

The queue has age alarms, bounded task time, heartbeats, dead-letter recovery,
media probes, disk-pressure checks at the thresholds above, and a startup
canary that renders both a fixed fixture and a multi-segment concat fixture.
Autoscaling never bypasses the database lease/fencing contract.

Workers receive no Supabase service-role or broad provider credential. The
control plane issues a short-lived, single-attempt capability token containing
workspace, run, stage attempt, fencing token, allowed RPCs/storage objects,
expiry, and unique `jti`, plus short-lived signed input/output URLs. Every
command revalidates the token, current authority epoch, and fencing token.
Application-level egress allowlists reject private networks and hosts outside
the exact input manifests. Vercel functions authorize and orchestrate; they do
not perform long video rendering.

### 15.7 Diagnostics without Sentry

Supabase stores:

- diagnostic events;
- client error reports with redaction;
- workflow/stage events;
- provider request and callback events;
- cost ledger;
- QC evidence;
- audit events;
- latency and failure aggregates.

Secrets, script bodies, access tokens, signed URLs, and raw provider payloads
must be redacted according to event schema.

## 16. Core data domains

The schema is organized around:

- organizations, workspaces, memberships, roles, and invitations;
- series, series releases, bibles, continuity-state versions, Episode Outcome
  Proposals, release decisions, and ACL;
- looks, characters, forms, versions, locations, voices, score identities;
- episodes, configuration versions, production runs, and stage runs;
- scripts, sidecars, narration assets, alignments, and pronunciation entries;
- source records/reviews, rights evidence, reviewer competencies/recusals,
  cultural decisions, shots, references, provider jobs, candidates, assets, and
  QC reports;
- EDD versions, masters, repair sessions, repair rows, plans, and tasks;
- work items, claims, notifications, watches, and activity;
- quotes, budgets, cost events, diagnostics, and audit events;
- export packages, export artifacts, archive, retention, backup copies, and
  restore evidence.

Every mutable domain uses stable identity plus immutable versions. Foreign keys
that influence generation pin a version, never an unversioned "current" row.

## 17. Security and reliability contracts

- No service-role key is shipped to the browser.
- Every exposed table has RLS and explicit grants.
- `getClaims()` or a fresh server user check protects server operations;
  client session objects are not authorization evidence.
- Authorization is rechecked at action time, including after a claim lease or
  permission change.
- Storage paths are workspace-scoped and protected by object policies.
- Signed URLs are short lived and regenerable.
- Webhooks verify signatures and are idempotent.
- Final approval uses compare-and-swap against the reviewed master version.
- Export never packages stale cuts, QC, or dependencies.
- Budget reservations occur before provider enqueue.
- A reservation or authorization is an execution ceiling, not proof of final
  provider billing. Actual, refunded, unknown, and `billed_no_asset` events are
  appended independently and reconciled against provider records.
- Canceled/stale provider work is cost-recorded but cannot commit outputs.
- Backups, migration rollback, dead-letter handling, and reconciliation jobs
  are documented and tested.
- Agent tools use allowlists, typed arguments, least privilege, and explicit
  side-effect boundaries. Retrieved scripts, web research, provider output, and
  model text are untrusted data and cannot inject new tool authority.
- Uploads are size-limited, MIME-sniffed, decoded/re-encoded where appropriate,
  scanned, stripped of unsafe metadata, rights-attributed, and stored outside
  executable paths. Remote fetchers block private networks and unsafe schemes.
- Invitations, first-admin bootstrap, MFA policy, session revocation, role
  changes, and deactivated-user ownership transfer are explicit flows.
- Provider retention/training terms and permitted data regions are recorded in
  capability configuration and reviewed before sending scripts or references.
- Secret rotation, credential ownership, least-privilege provider keys, and
  incident revocation are documented. Secrets never enter diagnostics.
- Diagnostic retention, redaction, access, alert thresholds, and deletion are
  defined; storing events without alerting does not constitute monitoring.
- Production Postgres requires PITR with RPO ≤5 minutes and RTO ≤2 hours.
  Accepted source assets, approved anchors, Series manifests, masters, export
  packages, and audit records are replicated to a separately restorable
  `Genie Vault` Supabase project: critical Storage/audit RPO ≤15 minutes and RTO
  ≤4 hours. Code, migrations, and environment contracts are retained in GitHub
  with RTO ≤2 hours. Regenerable rejected candidates have no recovery promise.
  A tier that cannot meet these targets blocks production enablement; the
  product may still run in an explicitly labelled non-production/demo mode.
- Vault copies are content-addressed and checksum-verified. A vault-only
  principal can append but the application cannot update/delete archived audit
  events. Restore and reconciliation drills run quarterly and after material
  schema/orchestration changes, with alerts and named owner evidence.
- Workflow reconciliation, stale-lease recovery, callback replay, storage
  integrity sampling, queue-age alarms, spend alarms, and error-budget alerts
  run independently of the primary production workflow.

## 18. Cost and performance

Priority order:

1. output quality;
2. reliability;
3. cost;
4. speed.

Target episode generation cost is below USD 40 where possible and never above
USD 50 without explicit approval. Development and validation are not constrained
by that episode target.

The worked 60/90/120-second bill of materials, dated provider evidence,
candidate multipliers, upscale route, and proof obligations are normative in
`docs/cost-envelope.md`. The 90-second expected case is USD 34.54 and the high
case is USD 47.99 under the representative route mix. The 120-second high case
exceeds USD 50 and therefore cannot start without replanning or top-up.

The estimate and reservation protect new enqueue decisions; providers may still
bill a refused, timed-out, late, or canceled request. Genie therefore cannot
promise that a hard UI ceiling is an absolute invoice ceiling. It stops further
authorized work at the ceiling, records all observed liabilities, and requires
an explicit top-up before retrying.

The UI must distinguish:

- deterministic stage progress;
- completed/total work units;
- provider queueing;
- estimated ranges;
- action-required waitpoints.

It must not fabricate precise percentages or completion times.

## 19. Deployment model

- GitHub is the source of truth.
- Vercel builds the Next.js application from the repository.
- Supabase hosts Auth, Postgres, Storage, and Realtime.
- Trigger.dev hosts durable workflows.
- Trigger.dev Cloud hosts the pinned ffmpeg/media task queue described in
  §15.6; no separate unknown worker platform remains.
- A separate `Genie Vault` Supabase project receives independently restorable
  critical media, manifests, and audit records.
- All environments use explicit configuration validation.
- Preview environments use isolated or safely namespaced data and buckets.
- Migrations are committed, ordered, reversible where practical, and applied
  before enabling dependent application code.

The user will create/link the Vercel project after the application is ready.
The repository must therefore ship with a complete environment contract and
deployment runbook without assuming an existing `.vercel` link.

## 20. Acceptance criteria

Milestones use distinct vocabulary:

- **software-complete:** required code, migrations, tests, documentation, and
  local/CI acceptance pass;
- **deployable:** production build and deployment/configuration smoke pass;
- **provider-enabled:** authenticated credentials, live canaries, rate cards,
  retention evidence, capacity, and billing reconciliation pass;
- **product-calibrated:** the independent benchmark and detector gates pass.

The solution is not software-complete until evidence proves:

- multiple authenticated users can work concurrently;
- a Series Release is created and later episodes inherit exact versions;
- an immutable Hindi script survives production Unicode-for-Unicode (and
  byte-for-byte for an uploaded source file) with captions reconciled;
- narrator gender selects the configured ElevenLabs voice;
- all 117 looks are searchable and the default is correct;
- characters/locations can be generated, prompt-edited, regenerated, uploaded,
  accepted, versioned, and inherited;
- character sheets are automatically created and used correctly;
- one episode runs durably while the user works on another;
- provider retries and duplicate callbacks do not duplicate assets or spend
  commits;
- a complete 9:16 candidate is generated, assembled, mixed, captioned, and QC'd;
- Monica detects seeded defects and routes bounded repairs;
- timecoded multi-row repairs produce a new reversible master and full
  regression QC;
- notifications deep-link to exact work;
- search retrieves historical Series/Episodes by content and metadata;
- approved and superseded exports are distinguishable and downloadable;
- RLS, storage access, stale-version approval, budgets, and permissions survive
  adversarial tests;
- production build and deployment smoke tests pass;
- provider and human benchmark gates are reported honestly and separately from
  software completion.

## 21. Known external follow-ups

These do not block design or implementation:

- 10–20 representative scripts and benchmark Episodes for pilot/tuning, then
  additional accumulated cases to reach the independent 30+20 calibration and
  holdout gate;
- Vercel project creation/linking and production environment entry;
- Supabase MCP/CLI project authentication or database password for applying
  committed migrations to the hosted project;
- licensed score/SFX asset ingestion if Zyra wants the Epidemic library included;
- final publishing-channel credentials when direct publishing is enabled.

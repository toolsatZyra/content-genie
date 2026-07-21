# Genie MVP cinematic pipeline and Edit-stage implementation plan

**Status:** owner-approved design; implementation authorized
**Effective:** 2026-07-21
**Applies to:** the owner-operated Genie developer MVP

## 1. Outcome

Replace the proof-oriented montage path with an automated film-production path:

1. the Director creates scenes and semantic shots from the immutable script and
   accepted World;
2. each shot owns an exact contiguous source-word span;
3. the final ElevenLabs V3 narration aligns those spans to exact time;
4. Nano Banana 2 produces one accepted storyboard image, or two separate clean
   A/B state images, for every shot;
5. a model-specific compiler sends only the images explicitly bound in that
   provider's prompt and payload;
6. Kling or Seedance animates the accepted board for the audio-derived window;
7. FFmpeg executes the EDD, transitions, narration, score, ambience and SFX;
8. Stage 6, **Edit**, shows actual production progress, the edited film, Monica
   repair progress, owner approval and downloads without leaving the creation
   flow.

The script's words and order remain immutable. Delivery punctuation, tags and
permitted English emphasis remain an additive ElevenLabs-only sidecar.

## 2. Stable MVP requirements

| ID | Requirement | Acceptance evidence |
|---|---|---|
| `MVP-CIN-001` | The Director creates scene/shot semantics before timing; every shot has one exact contiguous source-word span. | Unit fixtures prove complete, ordered, non-overlapping source coverage without script mutation. |
| `MVP-CIN-002` | `ceil(narration_ms / 3000)` is advisory only. | No database or application validation requires that count; fixtures with fewer and more good shots pass. |
| `MVP-CIN-003` | Final word alignment supplies each shot's editorial start, end and duration. | Timeline tests bind shot words to exact narration segments and reject gaps, overlap and non-monotonic alignment. |
| `MVP-CIN-004` | Every storyboard image is generated from shot composition plus the exact locked look tail. | Golden prompt tests prove two paragraphs and forbid previous/next-shot assumptions. |
| `MVP-CIN-005` | Nano Banana reference order and prompt roles are explicit and bijective. | Payload tests reject attached-but-uncited images, missing images, duplicate ordinals and name-only binding. |
| `MVP-CIN-006` | Each video model uses its own fal.ai reference contract. | Adapter fixtures and authenticated canaries cover every enabled endpoint and duration quantum. |
| `MVP-CIN-007` | A/B storyboard states remain separate full-frame assets; UI contact sheets never become provider inputs. | Payload and visual fixture prove clean start/end frames and no split-screen source. |
| `MVP-CIN-008` | Exact aligned duration is editorial truth; provider duration rounds up only to a supported quantum and is trimmed without loop/stretch. | Timeline/render test covers fractional, short, long and provider-limit boundaries. |
| `MVP-CIN-009` | Production and user-requested repairs do not pause above USD 50 during the developer MVP. | Quote/World Lock/repair tests prove cost is recorded while the workflow continues. |
| `MVP-EDIT-001` | Stage 6 is labelled Edit and no longer redirects to `/production`. | Browser journey stays on `/create` and shows the live stage rail throughout production and review. |
| `MVP-EDIT-002` | Edit shows only authoritative job/shot/render/repair progress. | UI reads durable states; no fabricated percentage or ETA exists. |
| `MVP-EDIT-003` | A review-ready master is playable and downloadable before approval. | Authenticated browser and signed-download test pass. |
| `MVP-EDIT-004` | Owner feedback creates a preserved repair branch; prior master, boards and clips are never deleted or overwritten. | Database/CAS test proves immutable attempts and supersession. |
| `MVP-EDIT-005` | Monica exposes actual repair steps and returns the repaired master to the same Edit stage. | Browser fixture advances through interpretation, scope, regeneration, re-edit, QC and review-ready states. |
| `MVP-EDIT-006` | Approval triggers an editable-media package containing all and only the storyboard images and clips used by the approved master. | Manifest, count, hash and ZIP-content tests reconcile to the approved EDD. |
| `MVP-EDIT-007` | The legacy `/production` URL canonically redirects to Stage 6 Edit. | Route test preserves old bookmarks without a second UI. |

## 3. Data and compatibility changes

Use forward-only migrations. Preserve Ep 1 and all historical receipts.

1. Remove the MVP USD 50 rejection from production/repair authority commands.
   Retain quote lines, high forecast, actual cost, duplicate-submit prevention
   and bounded automatic retry.
2. Replace the 1-40 proof constraints with positive shot ordinals and a
   practical payload/fan-out safety bound independent of the three-second
   guidance.
3. Add immutable shot-plan fields for scene, exact source coordinates, camera,
   lighting, mood, composition, action, cut and SFX cue.
4. Add storyboard assets per shot and role (`single`, `start`, `end`), including
   prompt hash, locked look-tail hash, Nano payload hash and QC state.
5. Add a provider reference-binding ledger containing asset version, ordinal,
   role, provider field/token and content hash. The dispatched attachment set
   must equal the prompt binding set.
6. Extend clip attempts with storyboard start/end assets, provider request
   quantum, exact retained duration and trim handles. Never delete prior
   attempts during repair.
7. Add durable Edit/repair progress rows and approved media-package state.
8. Backfill existing Ep 1 clip rows as legacy World-source attempts. Its current
   master remains playable and approvable; only a new repair attempt uses the
   new storyboard compiler.

## 4. Provider payload compilers

The reference resolver selects the smallest sufficient reference set from the
shot's graph before compilation. Prompt and payload are returned as one object;
callers cannot append an extra URL afterward.

### Nano Banana 2

- zero references: `fal-ai/nano-banana-2`;
- one or more references: `fal-ai/nano-banana-2/edit` with ordered
  `image_urls`;
- `system_prompt` declares `Image N / @ImageN`, the asset's exact role and what
  must not be copied;
- the user prompt explicitly cites every `Image N` it uses;
- names alone never bind an image.

### Seedance 2

- ordinary board animation: image-to-video with `image_url`;
- clean A to B motion: `image_url` plus `end_image_url`;
- genuinely multimodal reference work: reference-to-video with ordered
  `image_urls` and exact `@ImageN` citations;
- provider-generated audio remains off because Genie owns narration and sound.

### Kling 2.5

- `image_url` is the typed start frame;
- optional `tail_image_url` is the typed end frame;
- there are no invented `@ImageN` tokens or arbitrary reference attachments;
- request duration is 5 or 10 seconds, then trimmed to the EDD window.

### Kling 3

- `start_image_url` and optional `end_image_url` carry boards;
- additional identity/object image sets use `elements` and exact `@ElementN`
  citations;
- a normal Genie shot uses one `prompt`, not autonomous `multi_prompt`;
- duration is the smallest supported integer from 3-15 seconds covering the
  EDD window and edit handles.

Before enabling an expanded payload, freeze the current fal OpenAPI schema and
run one authenticated, low-cost canary. The July 19 schema receipts have drifted
and are not sufficient evidence for the current contracts.

## 5. Stage 6 Edit experience

The Stage 6 component has one continuous state model:

| State | Primary surface |
|---|---|
| queued/planning | Current specialist, current durable task and shot count |
| storyboarding | Storyboard cards arrive as actual assets are promoted |
| animating | Per-shot provider state and completed/total count |
| editing | Render, audio mix and QC steps |
| review ready | 9:16 player, `Request repairs`, `Approve`, and `Download video` |
| repairing | Monica activity plus feedback interpretation, affected shots, boards/clips being replaced, edit rebuild and QC |
| approved | Approved player, `Download video`, and media-package preparation/download |
| failed/blocked | Exact safe error, retained work and one truthful recovery action |

The agent panel uses database-backed task names and item states. Motion can
make active work legible, but must not imply progress that has not occurred.
The player and feedback state remain mounted while reconciliation updates the
rest of the surface.

`/episodes/:id/production` becomes a compatibility redirect to
`/episodes/:id/create?resumeCreation=edit`. The creation route remains the
canonical six-stage Episode URL.

## 6. Repair and download behavior

Submitting feedback does not mutate the base master. It creates a new repair
attempt bound to the exact master version and feedback hash. Monica treats each
feedback point independently: she grounds any supplied timestamp to the exact
half-open shot window, identifies the requested change, and classifies it as an
image-and-clip repair, a clip-only repair, or an edit-only repair. An image
repair always regenerates that shot's dependent clip; a clip-only repair keeps
the accepted storyboard image; an edit-only repair keeps both assets. Monica
then validates every replacement, swaps only the dependency-closed affected
shot set into the edit, reruns applicable boundary and master QC, and returns a
new pending-review master. If either the target shot or intended change is not
clear, the whole owner submission pauses before provider dispatch or spend and
Monica asks one precise clarification question; already-grounded points remain
recorded and are not discarded. Each owner submission starts one bounded
repair pass; there is no autonomous infinite retry loop.

The review master MP4 is always downloadable once it exists. Approval starts
an asynchronous package job containing:

```text
approved-master.mp4
storyboard-images/shot-N-{single|start|end}.png
video-clips/shot-N.mp4
manifest.json
SHA256SUMS.txt
```

`manifest.json` records the approved master, EDD, shot ordering, exact word/time
windows, provider/model, asset IDs and hashes. Only assets selected by the
approved EDD are packaged; discarded candidates remain auditable but are not
included.

## 7. Implementation slices

1. **Contract slice:** update active MVP contracts, add forward migrations and
   typed shot/storyboard/reference/edit projections.
2. **Director/timing slice:** semantic shot schema and prompt, exact source-span
   validation, V3 alignment-to-shot timing, advisory density signal.
3. **Storyboard slice:** Nano prompt compiler, reference bijection, single/A/B
   assets, secure ingest and storyboard QC.
4. **Motion slice:** provider-specific compilers, current schema snapshots,
   canaries, exact duration routing and clip lineage.
5. **Edit/render slice:** EDD cut/SFX execution without loops, retained attempts,
   final master lineage and Monica QC/repair progress.
6. **Stage 6 slice:** rename Create to Edit, embed progress/player/review/repair,
   canonicalize legacy route and remove the automatic navigation.
7. **Package slice:** immutable approved-media manifest, Sandbox ZIP creation,
   private storage promotion and short-lived authenticated download.
8. **Release slice:** focused tests, concise regression, preview migration,
   provider canaries, full owner-observable Episode, production migration,
   explicit GitHub push and automatic Vercel verification.

## 8. Developer-MVP gate

Run checks proportional to this high-value path:

- formatting, lint and type checking;
- focused unit/API/database tests for every requirement above plus the concise
  unit suite;
- preview migration and relevant pgTAP/provider-policy checks;
- Nano, Seedance, Kling 2.5 and Kling 3 payload canaries only for enabled paths;
- a fixed-media renderer/package proof;
- one Chromium journey from World completion through automatic Preflight,
  Stage 6 production, playback, feedback/repair, approval and both downloads;
- build, secretless boot, browser-bundle scan and high-severity dependency scan;
- explicit `main` push, automatic Vercel deployment, public health probe and an
  authenticated owner-observable Episode proof.

The broader calibration corpus, exhaustive phase matrices and team-scale
operations remain separate from software completion under the active MVP
delivery profile.

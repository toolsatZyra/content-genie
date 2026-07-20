# Genie by Zyra — implementation continuation handoff

**Snapshot date:** 2026-07-19
**Workspace:** `C:\Work\Code\zyrastudio`
**Git branch:** `main`
**Deployed implementation checkpoint:** `098a89cfe0f62e0f963143735002fa8436800b13`
**Goal status:** active — the grounded real-world visual pipeline is deployed;
obtain owner-observable real Episode proof and iterate from that MVP test
**Current phase:** deployed developer-MVP completion
**Status vocabulary:** work described below is either committed, implemented in
the working tree, or externally verified. Those states are deliberately not
treated as interchangeable.

This file is the authoritative continuation snapshot for a fresh Codex
conversation. The live worktree and external services remain the ultimate
truth. Begin with the startup audit in section 13 before changing code.

## 0. Developer-MVP scope change (2026-07-20)

The owner explicitly prioritized a working application over the original
launch-scale assurance program. `docs/MVP_DELIVERY_PROFILE_2026-07-20.md` is now
the active release gate. Preserve the immutable-script, exact identity,
cultural, provider-secret, media-ingest, USD 50, workspace-isolation, and final
human-review invariants. Defer exhaustive concurrency, fault-injection,
all-state/all-device matrices, per-phase independent reviews, and enterprise
operations until owner testing or wider-team rollout. Deferred obligations are
not verified and must remain labelled honestly.

### Live deployed checkpoint

- GitHub `main` contains implementation checkpoint
  `098a89cfe0f62e0f963143735002fa8436800b13`.
- Git-connected Vercel deployment `dpl_zyyzJTWM3KF2Kq4Dh2d9Vhe6eg8X` reached
  `READY` and aliased `https://content-genie-three.vercel.app/`.
- The public runtime probe returned HTTP 200 with
  `{"environment":"production","ok":true}`; the two MVP cron routes returned
  HTTP 401 without their cron authorization.
- Supabase preview `iuzijmzcimtwyowhwinu` and production
  `fnxztrqsqucojcvabjhk` contain the Phase 2 foundation and compact Phase 3 MVP
  production/review/export migrations. Both enforce 1-40 clip shot numbers and
  a 0-40 production-job clip count.
- Final focused candidate evidence: lint and types passed; 84 unit files / 497
  tests passed; production build, secret scans, browser-bundle scan, and the
  owner approval browser journey passed; the bounded browser server stopped.
- The 20-input isolated renderer canary produced H.264, 1080x1920, yuv420p,
  exactly 61.000 seconds.
- Migrations `phase3_real_world_visual_research`,
  `phase3_mvp_command_execute_grants`, and
  `phase3_real_world_reference_graph` are applied to preview and production.
  The working tree generalizes licensed photo research to named
  temples, festivals, and rituals; exposes the references to the Director;
  enforces use-before-repeat allocation; records the chosen asset in the EDD
  and executable graph; and makes production use it for the exact narration
  window only when both identities match. Focused lint, types, and 26 tests
  pass. Anonymous execution is explicitly removed from the
  three owner-facing MVP SECURITY DEFINER commands. The complete lean candidate
  gate passed, the implementation was committed and pushed explicitly, and the
  automatic production deployment was verified.
- The independent context-minimized review found three issues: incidental
  explicit names could be skipped, duplicate image content could survive page
  de-duplication, and the EDD photo was not in the executable graph. All three
  are fixed; the reviewer rechecked each correction and reported them fixed.

## 1. Mission and intended moat

Genie by Zyra is an internal, multi-user AI production studio for cinematic
Hindu devotional short-form films. It takes an exact user-provided Hindi script
and, through Monica and a team of specialist agents, autonomously produces a
cinematic, consistent, expressive 9:16 episode with voiceover, score, SFX,
editing, QC, repair, and export.

The owner also clarified the real-world visual and editing design. The durable
decision is in
`docs/MVP_REAL_WORLD_VISUAL_RESEARCH_AND_EDITING_2026-07-20.md`. Real-world
research records and scans licensed public file references for explicitly
named temples, festivals, and rituals and keeps up to four candidates. The
Director rotates those references across applicable exact-word shots before
reuse, and production uses the chosen EDD reference as the motion source. The MVP renderer is
FFmpeg in ephemeral Vercel Sandbox, not Remotion; the six/twelve-clip proofs
have been replaced with `ceil(audio duration / 3 seconds)` word-bound visual
slots (20-40 shots) and EDD-timed cuts. A Seedance multi-shot source clip may
cover adjacent slots only when its internal changes map to the exact same word
ranges. The revised Sandbox canary passed H.264, 1080x1920, yuv420p, exactly
61.000 seconds.

The moat is not generic script-to-video orchestration. It is the reliable,
automatic combination of:

- cinematic and engaging visual storytelling;
- persistent character, costume, location, iconography, look, voice, score,
  and sound identities;
- expressive conversational Hindi narration with fluent Sanskrit
  pronunciation;
- culturally and theologically responsible devotional depiction;
- provider-aware shot direction and reference continuity;
- automatic detection and bounded repair of visual, audio, narrative,
  continuity, cultural, and render defects;
- final-video quality that a human viewer would describe as a good devotional
  film, not merely a technically valid generation;
- durable lineage, costs, decisions, retries, QC evidence, and human authority.

InVideo Agent One is the broad script-to-video benchmark. Genie is narrower and
deeper: devotional drama and mythology, series continuity, immutable scripts,
cinematic vertical composition, Indian cultural rules, and automatic
multi-agent quality control.

## 2. Non-negotiable product contract

### 2.1 Launch scope

- Hindi, narration-only episodes.
- Typical duration 60–120 seconds.
- Vertical 9:16 output for Instagram Reels and YouTube Shorts.
- No dialogue, lip-sync, or dialogue-character voice synthesis at launch.
- Internal application. Multiple team members may work concurrently and may
  start multiple Episodes while other Episodes generate or repair.
- Initial expected production volume: approximately five Episodes per day.
- Users may export completed videos directly.

### 2.2 Immutable input and additive intelligence

- The source script supplied by the user must never be rewritten, paraphrased,
  shortened, reordered, or silently corrected.
- Preserve exact input bytes/text and an exact processing coordinate map.
- Script rubrics may advise or block eligibility, but may not mutate source
  text.
- Timing, beat decomposition, pronunciation, cultural notes, entity extraction,
  narration markup, story design, shot plans, reference graphs, prompts, and QC
  are sidecars bound to the exact source hash.

### 2.3 Human intervention at launch

The intended routine human flow is:

1. Create/select Series and Episode; enter and lock the exact script.
2. Choose narrator gender; male is default.
3. Choose one of exactly 117 looks; Indian mythology
   `glowing-divine-realism` is default. There is no Recommended section.
4. Review generated character and location anchors. For each anchor the user
   can accept, inspect/edit its prompt and regenerate, or upload a replacement.
5. Genie generates character sheets and the complete world reference pack.
6. A qualified source/cultural reviewer records a decision when required.
7. The user confirms the exact production quote/ceiling and authorizes one
   atomic World Lock.
8. Monica and specialist agents operate autonomously through production and QC.
9. The user reviews the final video and can submit any number of timecoded or
   time-range repair rows in plain language through a curated Monica interface.

The future clip-review/editor surface may expose individual clips and their
prompts/references before the final edit, but it is not a launch prerequisite.

### 2.4 Voices and creative defaults

- Male ElevenLabs voice ID: `b0oby86k6n7Uh5LZcOBR`.
- Female ElevenLabs voice ID: `GSdeLRB8detpjZjN63Wn`.
- Male is the default narrator gender.
- Narration target: expressive conversational Hindi, Delhi-identifiable accent,
  fluent Sanskrit pronunciation.
- Do not silently fall back to another voice. A withdrawn, missing, or
  unverified identity fails closed.
- Every recurring identity is versioned and inherited through a released
  Series world.

### 2.5 Provider routing and cost

- Kling 2.5 on fal.ai: simple camera plus simple subject motion.
- Kling 3.0 on fal.ai: camera-led motion.
- Seedance: other/complex AI video shots.
- Selected look is a separate prompt paragraph/tail derived from the exact
  117-look registry; it does not replace the scene-composition paragraph.
- Optimize for quality first, reliability second, cost third, speed fourth.
- Target Episode cost below USD 40. Normal hard ceiling is USD 50 unless an
  explicit top-up authority exists.
- Reservations cap future authorized spend; they do not claim that provider
  invoices cannot include failed/refused attempts.

### 2.6 Cultural and content policy

- Regional retellings are allowed when lineage/tradition is recorded.
- Named temples require research against actual references and evidence-bound
  depiction.
- Violence and romance follow the treatment of Indian devotional cinema.
- Era/caste depiction should be historically credible without dehumanizing or
  promotional stereotyping.
- No nudity or religious conflict content.
- Monica may evaluate and block, but she is not the human cultural, legal, or
  final release authority.
- Human final release remains mandatory until the calibration/holdout contract
  in `docs/qc-release-contract.md` is satisfied.

## 3. Product organization and UX

- Organization → Workspace → Series → Episode.
- A Series is a versioned creative world/master folder.
- Later Episodes inherit the released look, selected character/location
  versions, narrator identity, pronunciation, score, and sound rules.
- Episode changes may propose a later Series release; they must not silently
  mutate the world used by existing Episodes.
- Concurrent generation/repair is durable and backgrounded. Users can leave an
  Episode, start another, return to progress, receive review-required
  notifications, search older Series/Episodes, and download final exports.
- The UI design language is Living Cinema: fluid, cinematic, playful, tactile,
  and futuristic rather than a conventional enterprise dashboard.
- Operational UI must never fabricate provider outputs, percentages, ETAs,
  QC scores, or completion states.

## 4. Authoritative design and assurance sources

Read these in this order when a requirement is unclear:

1. `docs/GENIE_IMPLEMENTATION_HANDOFF_2026-07-19.md` — current execution state.
2. `docs/design.md` — authoritative end-to-end product/solution contract.
3. `DESIGN.md` — Living Cinema UI contract.
4. `docs/implementation-plan.md` — phases, work packages, gates, rollback, and
   definition of done.
5. `docs/qc-release-contract.md` — normative runtime QC/release requirements.
6. `docs/state-and-data-contract.md` — state, transaction, concurrency, CAS,
   fencing, and idempotency contract.
7. `docs/provider-contract.md` and `docs/cost-envelope.md` — routing, freshness,
   spend, provider evidence, and quote rules.
8. `docs/series-and-cultural-policy.md` — source, cultural, continuity, and
   release-authority rules.
9. `docs/threat-model.md` — security boundaries.
10. `docs/sdlc.md` — delivery loop and the revised phase-level adversarial
    review cadence.
11. `docs/verification-matrix.md` — explicit verification scenarios.
12. `docs/traceability.md`, `docs/traceability-matrix.md`, and
    `reference/acceptance/` — machine and human requirement/evidence routing.
13. `docs/reference-porting-map.md` — verified AI Director look/character-sheet
    porting map.
14. `reference/rubric-config/` — research inputs. These do not override the
    stage-specific runtime QC contract.

`docs/project-state.md` contains valuable historical Phase 1 evidence but was
outdated for the current Phase 2 working tree. It now points here for live
status.

## 5. Repository, Git, deployment, and secrets

- GitHub: `https://github.com/toolsatZyra/content-genie.git`.
- Branch: `main`.
- Deployed implementation checkpoint:
  `2164fc776ceb7cd87f7db5f4b485f942538c7e1c`
  (`feat: ship Genie developer MVP production flow`).
- The repository intentionally has no persistent `origin` because the owner
  works across many repositories in parallel.
- Push only with an explicit URL, for example:

  ```powershell
  git push https://github.com/toolsatZyra/content-genie.git main
  ```

- Git-linked Vercel production URL:
  `https://content-genie-three.vercel.app/`.
- Vercel project: `content-genie`, project ID
  `prj_aSnq2s4OL3hw3e8NX29dLPXDFe3g`, team
  `team_pwTpdWGJnbaaUJHUGUtCMxVG`.
- Routine deployment is a verified `main` push; do not browse Vercel for normal
  deployment.
- Supabase production: `fnxztrqsqucojcvabjhk`.
- Supabase Phase 2 preview: `iuzijmzcimtwyowhwinu`, branch
  `genie-phase1-dev`.
- Sentry is intentionally excluded. Application diagnostics, QC, costs, and
  audit evidence live in Supabase.
- `.env.local` contains private configuration and must never be committed or
  copied into handoffs/logs.
- Never stage or commit
  `docs/Provider and Infrastructure Inventory.xlsx`.
- Owner authorization covers in-scope GitHub, database, provider, and
  deployment actions. Platform safety and permission boundaries still apply.

## 6. External state verified for this handoff

The following state was re-read from current services on 2026-07-19:

### 6.1 Supabase

- Preview is healthy and contains 102 migration records: 13 named Phase 1
  migrations, the remote schema record, and 88 named Phase 2 migrations.
- Preview latest migration name: `phase2_broker_key_overlap_security`.
- Production is healthy and contains 14 records: 13 named Phase 1 migrations
  plus the remote schema record.
- Production contains zero Phase 2 migrations. This is intentional until the
  Phase 2 gate and independent review pass.
- The Supabase migration service assigns its own applied version timestamps;
  compare migration names and SQL content rather than assuming its applied
  version equals the local filename timestamp.

### 6.2 Trigger.dev

- `TRIGGER_SECRET_KEY` exists locally but is a development secret.
- `TRIGGER_PROJECT_REF` is missing.
- `trigger.config.ts` therefore uses the fail-closed placeholder
  `proj_genie_control_unconfigured`.
- The Trigger CLI is not authenticated with a deployment PAT. A project secret
  is not a CLI PAT.
- The development secret has been validated read-only against the Trigger API:
  listing runs succeeds and identifies the `dev` environment owned by
  `toolsatZyra`; the latest known run is
  `genie-preflight-discovery-probe-v0`. No secret value is recorded here.
- The development secret cannot call PAT-only `/api/v2/whoami` or
  `/api/v1/projects`, and neither the repository nor the provider inventory
  contains a real `proj_...` reference. The currently installed Trigger CLI is
  not logged in and there is no local `TRIGGER_ACCESS_TOKEN`.
- This is not the immediate code blocker, but Phase 2 cannot close until the
  required Trigger project/identity/queues are deployed and authenticated.
  Exhaust all local, preview-database, provider-broker, and browser work before
  escalating this dependency.

### 6.3 Authenticated provider evidence

Current evidence artifacts include:

- `docs/evidence/provider-snapshots/elevenlabs-2026-07-19.json`;
- `docs/evidence/provider-snapshots/elevenlabs-with-timestamps-2026-07-19.json`;
- `docs/evidence/provider-snapshots/fal-nano-banana-edit-canary-2026-07-19.json`;
- `docs/evidence/provider-snapshots/fal-video-production-canaries-2026-07-19.json`;
- `docs/evidence/provider-snapshots/openai-narration-audio-qc-2026-07-19.json`.

These prove bounded authenticated canary observations. They are not a full
production Episode or product-calibration proof.

## 7. Phase status

### Phase 0 — complete and committed

Repository/toolchain, CI, security baseline, exact evidence machinery, and
adversarial foundation were completed and pushed.

### Phase 1 — complete and committed

Identity, workspaces, Series/Episodes, roles, durable commands/events,
notifications, audit/diagnostics, RLS/storage, and the initial Studio were
closed through the required Phase 1 gate and review.

### Phase 2 — implemented substantially in the working tree; not complete

The committed Phase 2 zero-spend checkpoint ends at current HEAD. The live
working tree adds the remainder of the provider/preflight/world/quote/World
Lock slice. It has not passed the complete Phase 2 gate or the single required
end-of-phase independent adversarial review. Do not promote it to production or
call it complete.

The current dirty tree contains 188 modified/untracked paths, including
88 Phase 2 migrations, three Phase 2 pgTAP suites, ten API route groups,
about 45 server modules, six Trigger files, UI chambers, policies, tests, and
authenticated provider evidence. The large dirty state is intentional
in-progress Phase 2 work, not disposable noise.

### Phases 3 and 4 — not started as implementation phases

Their design and plan exist, but production media orchestration, Monica’s full
QC/repair loop, rendering, Premiere, repair chat, exports, search,
notifications, and launch/calibration remain future implementation.

## 8. Phase 2 implementation now present

The following capabilities are present in the current worktree and/or preview
schema. Each still requires the complete Phase 2 exit gate.

### 8.1 Exact script, voice, and look foundation (`P2-01`–`P2-03`)

- Exact script/raw-processing coordinate contracts and hardened map v2.
- Uploaded UTF-8/UTF-16 text preserves original bytes, checksum, encoding
  evidence, and decoded text through the same immutable atomic script-lock
  boundary.
- The pinned script rubric now validates exact source/config hashes,
  deterministic applicability and rational math, independent evaluator
  identity/evidence, and advisory-only gates. Its immutable service-authored run
  is required and pinned before a new plan-evaluation preflight can start.
- Pinned male/female identities and fail-closed voice verification.
- Deterministic 117-look pack, manifest/provenance hashes, and default look.
- Script/voice/look Living Cinema flow and exact Series creative inheritance.

### 8.2 Durable preflight and restricted agents (`P2-04`, `P2-05`)

- Preflight runs, stages, attempts, leases/fences, durable outcomes, failure
  retry classification, and Trigger control dispatch contracts.
- Restricted typed OpenAI agent/evaluator boundary.
- All restricted model calls are ledgered with exact input/output hashes,
  rejection/replay evidence, and no arbitrary side-effect authority.
- World Extraction and Pronunciation Director use the ledgered structured-agent
  path.
- Executable-plan evaluation uses two fresh blind evaluators and bounded
  automatic repair: initial plan plus no more than two materially changed
  successors. Exact locked inputs are preserved.
- Terminal plan-quality or quote-ceiling failures are sealed product outcomes,
  not indefinite transport retries. They create a durable work item and a safe
  creation-readiness projection.

### 8.3 Provider authority and secure ingest (`P2-06`, `P2-07`)

- Micro-spend versus production-spend separation.
- Capability grants, bounded provider slots, provider profiles, authenticated
  request/retry/alternate lanes, deterministic idempotency, and cost ledgers.
- Provider keys stay behind the Vercel broker; Trigger receives bounded
  assertions/grants rather than provider secrets.
- fal signed-webhook inbox, late/lost/replay correction, output-target binding,
  media-kind/dimension/duration binding, retry pools, and reconciliation.
- Secure remote fetch defenses and quarantine-first image/audio ingest.
- MIME, size, redirect/private-network, exact still-image container/CRC,
  scan, re-encode, metadata, provenance, and promotion constraints.
- Appended-payload polyglots are rejected before parser creation. A real
  ephemeral Vercel Sandbox corpus proves a metadata-bearing PNG is scanned and
  re-encoded after network denial with no GPS, comment, XMP, or private
  attachment chunks/payload in the derivative. Malformed, oversized, and
  wrong-MIME provider outputs never become authoritative.

### 8.4 World Studio and cultural readiness (`P2-08`, `P2-09`)

- World extraction, character/location entities, generated candidate versions,
  prompt revision/regeneration, secure upload replacement, acceptance, version
  history, character sheets, and verified world reference packs.
- Named-temple research/evidence binding and null-safety corrections.
- Qualified cultural source packets, competencies, appointments, recusal,
  approve/block decisions, non-overridable policy, and source/world version
  pins.
- World anchor generation/edit dispatch and atomic promotion/retry behavior.

### 8.5 Audio identity, planning, quote, and World Lock (`P2-10`–`P2-13`)

- Pronunciation, score identity, sound rules, narrator identity, and pre-lock
  narration dispatch/reconciliation.
- Narration exact-text and master-clock binding, scan/replay evidence, and
  independent audio QC.
- Story/beat/shot/EDD/reference graph plan, provider-slot plan, feasibility and
  evaluator consensus.
- Exact quote compiler with provider lines plus seven mandatory allowance
  classes and exact low/expected/high totals.
- Quote confirmation binds the exact quote hash and ceiling. It cannot authorize
  more than USD 50 without a separate top-up contract.
- Atomic World Lock is designed to publish the Series release, production run,
  high reservation, and production authority together or not at all.

### 8.6 Living Cinema creation flow (`P2-14`)

- Real World Studio, Preflight Studio, and Creation Launchpad replace the former
  placeholder chambers.
- World build, accept, regenerate, upload, cultural appointment/decision,
  quote-confirm, and World Lock route integrations use retained idempotency.
- Soft polling refreshes visible World/Preflight/Create chambers while durable
  asynchronous work is pending; online/visibility events reconcile state.
- Terminal plan/quote failure renders explicit safe feedback, disables quote
  and lock actions, and states that no production spend was authorized.
- Browser fixture/test coverage includes a blocked Phase 2 preflight state.

## 9. Last verified tests and what remains unproven

### 9.1 Recent passing evidence

- The handoff QA reran the focused quote confirmation, World Lock route,
  preflight failure classification, bounded plan repair, exact quote, and
  creation-readiness contracts: 23 tests across six files passed.
- The uploaded-source and script-rubric batch passes 43/43 focused unit/API
  tests. The UTF-16 browser upload regression also passes in Chromium.
- The secure-image negative corpus passes 13 focused tests across container,
  scanner, and provider-ingest boundaries. Its credential-gated live case then
  passed separately through the real ephemeral Vercel Sandbox in 65.36 seconds
  (63.42 seconds in the scanner): the derivative retained its exact dimensions
  and valid PNG/hash envelope while GPS, comments, XMP, and attachment
  chunks/payload were absent. The ignored temporary OIDC file was deleted.
- `pnpm typecheck` passed against the current TypeScript/UI/API worktree after
  the latest browser-fixture and terminal-feedback edits.
- All four current Phase 2 preview pgTAP suites pass: zero-spend/script/upload/
  rubric 178 planned assertions, provider/secure ingest 85/85, world/cultural/
  transactional World Lock 57/57, and executable plan/quote/terminal feedback
  45/45 — 365 planned assertions in total.
- The 57-assertion world suite now reruns AAL2 owner offboarding after the
  bounded World Lock envelope exists: Series/Episode authority transfers, the
  removed owner loses membership/session/work/lease authority, and the exact
  autonomous run, reservation, and historical signer evidence remain unchanged.
- The preview run exposed and the forward-only migration
  `20260719080400_phase2_terminal_feedback_summary_disambiguation.sql` fixes a
  genuine PL/pgSQL variable/column ambiguity that had prevented terminal
  preflight failure from sealing its durable safe work item.
- The complete-worktree formatting and lint passes are green after correcting
  four small TypeScript hygiene findings and formatting the accumulated Phase 2
  batch.
- The integration suite is green at 5/5. Type checking, the 117-look generated
  asset/pixel-decode gate, production-environment fail-closed test, secretless
  boot test, secret/inventory/security scan, and browser-bundle policy gate are
  green.
- The production dependency licence gate is green for 182 package records. The
  dependency audit is below its high-severity threshold after workspace-level
  `tar` and `ws` overrides; three accepted lower-severity advisories remain (one
  low and two moderate).
- The concise full-unit run is conclusive: 77 test files and 449 tests passed
  with exit code 0.
- The full coverage run is conclusive against the same 77 files and 449 tests:
  96.87% statements (651/672), 94.05% branches (506/538), 100% functions
  (113/113), and 98.03% lines (600/612), with exit code 0.
- The provider-broker identity boundary now enforces an explicit key-overlap
  maximum of 15 minutes. Preview pgTAP proves both `kid` values during overlap,
  immediate key revocation and client disable, unexpired-JTI invalidation,
  stale-writer rejection, private-table denial, and append-only lifecycle plus
  rejection security evidence. The TypeScript corpus independently covers exact
  issuer/audience/project/environment/task/run/stage/subject/time/capability
  bindings. True two-session revoke/disable-versus-consume races remain in the
  concurrency audit before `V-P2-034` can close.
- The frozen trusted-harness manifest now includes the exact 88 Phase 2
  migration versions and all five required pgTAP suites. Its hostile controls,
  sandbox policy, and isolated-runner policy pass. The complete `pnpm test:rls`
  composite passes with exit code 0. Its final local live-database skip is
  intentional because the isolated Supabase harness is not active; the managed
  preview pgTAP checkpoint provides the live schema proof.
- The complete 55-test creation browser suite initially exposed four stale
  accessible-name locators and one real toast/sticky-tray overlap. The locators
  now target `Build world + preflight`, and the toast clearance was raised from
  126px to 146px. All five earlier focused regressions and the uploaded-source
  regression pass. A final complete 55-test browser run remains required after
  the Phase 2 candidate is frozen.
- `pnpm build:canary` passes on Next.js 16.2.10. The acceptance-structure gate
  passes, including traceability and checkpoint hostile controls. SBOM
  generation passes with 828 components at `.tmp/artifacts/sbom.cdx.json`.

These are targeted build-loop checks, not the Phase 2 gate.

### 9.2 Resolved database stopping point

File: `supabase/tests/phase2_world_cultural.test.sql`

- The plan was expanded from 37 to 57 assertions.
- A transaction-level fixture now creates one complete executable plan and
  exact USD 7.95 quote, confirms the quote as an authenticated AAL2 user,
  prepares World Lock, forces a unique-conflict at the final work-item write,
  asserts that release/run/authority all roll back, performs a successful World
  Lock, and verifies idempotent replay.
- `.tmp/run-pgtap-preview.mjs` now captures only the pgTAP result functions used
  by the three suites. Data-producing continuation lines shaped as:

  ```sql
  insert into ...
  select ...
  ```

- remain untouched. The expanded suite then exposed a missing exact source/
  world binding in the integration fixture; the fixture now constructs the
  valid script/extraction/world/policy binding before World Lock.
- The suite proves a forced unique conflict at the final work-item write rolls
  back the release, run, and budget authority; the subsequent valid seal creates
  exactly one USD 7.95 reservation/run/release and identical replay creates no
  duplicate.

### 9.3 Exact current stopping point

The transactional database checkpoint and the first deterministic gate batch
are closed. Unit, coverage, RLS/policy, focused browser repairs, canary build,
acceptance structure, and SBOM are conclusive. The live requirement audit is in
`docs/evidence/phase2/requirement-evidence-audit-2026-07-19.md`; `P2-01`,
`P2-07`, `V-P2-003`, `V-P2-004`, `V-P2-008`, `V-P2-011`, `V-P2-012`, `V-P2-029`, `V-P2-030`, and `V-P2-031` are
covered pending the frozen gate. The media proof is in
`docs/evidence/phase2/media-scanner-corpus-2026-07-19.md`. Continue the remaining
`P2-01`-`P2-14` and `V-P2-001`-`V-P2-034` gaps, then run the final complete
browser and local/security/build regression batch.
Trigger deployment qualification and the frozen remote-live evidence remain
unresolved external phase-exit dependencies. Do not start the independent
adversarial review until the deterministic phase-ready gate passes.

## 10. Immediate continuation sequence

Execute this order in the fresh conversation:

1. Read this handoff, the root `AGENTS.md`, Phase 2 of
   `docs/implementation-plan.md`, Phase 2 of `docs/verification-matrix.md`, and
   the current `git status`/diff.
2. Confirm HEAD, branch, no `origin`, preview/production project IDs, and that
   the owner workbook and `.env.local` remain unstaged.
3. Confirm the current Phase 2 preview pgTAP checkpoint remains 178 planned,
   85/85, 57/57, and 45/45 if any schema or SQL-test change occurs:

   ```powershell
   node --env-file=.env.local .tmp/run-pgtap-preview.mjs iuzijmzcimtwyowhwinu supabase/tests/phase2_zero_spend_foundation.test.sql
   node --env-file=.env.local .tmp/run-pgtap-preview.mjs iuzijmzcimtwyowhwinu supabase/tests/phase2_preflight_provider_ingest.test.sql
   node --env-file=.env.local .tmp/run-pgtap-preview.mjs iuzijmzcimtwyowhwinu supabase/tests/phase2_world_cultural.test.sql
   node --env-file=.env.local .tmp/run-pgtap-preview.mjs iuzijmzcimtwyowhwinu supabase/tests/phase2_executable_plan.test.sql
   ```

4. Preserve the conclusive unit, coverage, RLS/policy, focused-browser,
   canary-build, acceptance-structure, and SBOM results above; rerun only the
   affected focused layer while closing requirement gaps.
5. Complete the `P2-01`-`P2-14` and `V-P2-001`-`V-P2-034` evidence audit. Then
   run the full 55-test creation browser suite plus security, bundle, evidence,
   preview-parity, formatting, lint, type, unit, coverage, RLS, and build gates
   as one frozen-candidate regression batch.
6. Re-run the four preview pgTAP suites only if schema or SQL-test inputs change;
   their current checkpoint is 178 planned plus 85/85, 57/57, and 45/45.
7. Audit every `P2-01`–`P2-14` item and `V-P2-001`–`V-P2-034` scenario against
   actual code/evidence. Close implementation or test gaps before the phase
   gate.
8. Resolve/deploy the Trigger project identity/queues when it becomes the
   critical-path blocker. Do not substitute the development secret for a CLI
   PAT or invent a project reference.
9. Freeze the Phase 2 candidate and run the complete local, database, browser,
   security, media, build, preview, and authorized live-canary gate.
10. Only after deterministic gates pass, run one independent context-minimized
    end-of-Phase-2 adversarial review covering code, schema, authorization,
    tests, media, UX/visuals, deployment, and objective traceability.
11. Fix all P0/P1 findings and any correctness-relevant lower-priority
    findings, then rerun the complete affected gate.
12. Commit and push Phase 2 to explicit GitHub `main`; verify the automatic
    Vercel deployment at the canonical URL. Do not navigate Vercel merely to
    initiate deployment.
13. Update this handoff and continue Phase 3.

## 11. Phase 2 exit gate

Do not call Phase 2 complete until evidence proves all of the following:

- `P2-01` through `P2-14` satisfy the implementation-plan contracts.
- Exact script bytes/text cannot be mutated through UI, RPC, model, or provider
  paths.
- Voice IDs and all 117 looks are exact, deterministic, and fail closed.
- Restricted agents cannot obtain arbitrary network/database/provider
  authority; every model invocation is ledgered.
- Micro and production spend/slots cannot cross-authorize.
- Provider requests, callbacks, retries, lost responses, quarantine, scan, and
  promotion are durable and effectively-once.
- Named-temple, source, cultural, pronunciation, score, sound, narration,
  master-clock, plan, reference, QC, quote, and world versions are exact and
  current.
- Quote confirmation and World Lock require the intended AAL2 authority and
  reject stale versions/hashes.
- Fault injection proves World Lock is all-or-nothing at every meaningful write
  boundary; concurrency and replay do not mint duplicate authority/spend.
- Creation UX passes desktop/tablet/mobile, keyboard, zoom, reduced-motion,
  accessibility, visual, loading, retry, terminal-failure, and leave/return
  journeys without fabricated state.
- Trigger project and queues are authenticated and cannot read provider keys.
- All preview migrations match the frozen source candidate; production remains
  unchanged until promotion is explicitly justified by the phase gate.
- Formatting, lint, types, unit, coverage, integration, RLS/policy, pgTAP,
  browser, build, bundle, security, dependency/license, secretless, provider
  contract, and exact evidence checks pass.
- One independent end-of-phase adversarial review reports no unresolved P0/P1.

The repository scripts provide most deterministic layers. Inspect `package.json`
before choosing the final command set; do not assume a narrow script proves the
whole phase.

## 12. Remaining roadmap after Phase 2

### Phase 3 — autonomous production and Monica QC

Implement the durable Trigger control/agent/media runtime, provider adapters,
shot generation, quarantined ingest, exact-reference graph execution,
narration/score/SFX production, edit timeline, renderer, quality specialists,
Monica consensus, bounded automatic repair, cost/reliability control, and
failure recovery. Validate cinematic consistency and glitches at the media
artifact level, not only through metadata.

Provider keys remain at the broker. Trigger projects receive separate identities
and bounded grants. Production dispatch must inherit the exact World Lock
manifest/quote and cannot improvise new source text or world identities.

At the end of Phase 3: batch deterministic tests, full phase gate, one
independent adversarial review, fixes, re-gate, commit/push, deployment smoke.

### Phase 4 — Premiere, repair, collaboration, export

Implement final-video review, timecoded/time-range repair rows, Monica’s curated
conversation, repair proposals and CAS promotion, qualified cultural and final
creative approvals, immutable export, download, searchable library, Series and
Episode organization, concurrent status, notifications, revocation, and audit.

At the end of Phase 4: full phase gate, one independent adversarial review,
fixes, re-gate, commit/push, deployed end-to-end software proof.

### Launch and calibration

- Software-complete and product-calibrated are separate states.
- The owner will supply the first 10–20 scripts/Episodes for pilot and tuning
  after the software build. Those samples do not prove general detector or
  cinematic quality.
- Follow the calibration and untouched holdout requirements in
  `docs/qc-release-contract.md` before reducing human release authority.
- Final proof must cover a real deployed Episode from exact script through
  World Lock, providers, Monica, qualified review, final approval, export,
  lineage, cost, recovery, and downloadable video.

## 13. Fresh-conversation startup audit

The new conversation should use the same local Genie project and checkout, not
a forked chat or clean worktree. The old conversation should stop editing once
the new one starts.

Run these read-only checks first:

```powershell
git branch --show-current
git rev-parse HEAD
git status --short
git remote -v
git diff --stat
```

Then verify:

- branch is `main`;
- HEAD is at or beyond deployed implementation checkpoint
  `098a89cfe0f62e0f963143735002fa8436800b13`;
- no persistent `origin` has been added;
- `.env.local` and `docs/Provider and Infrastructure Inventory.xlsx` are not
  staged;
- Supabase preview and production contain the Phase 2 foundation plus the
  compact MVP production, inline-preflight, editorial-timeline, and
  three-second-visual-coverage migrations;
- no persistent development server is running;
- `.tmp/run-pgtap-preview.mjs` retains the narrow pgTAP-only instrumentation and
  the four Phase 2 suites remain at 178 planned, 85/85, 57/57, and 45/45 after
  schema/test changes.

If any item differs, treat the live state as authoritative, determine whether
another actor intentionally advanced the project, and update this handoff
before proceeding.

## 14. Known risks and prohibited shortcuts

- Do not commit the current tree merely to make it easier to hand off; `main`
  triggers deployment. Commit only coherent, gated application or handoff
  updates.
- Do not promote Phase 2 preview migrations to production early.
- Do not use passing structural tests as proof of transaction/runtime behavior.
- Do not relax quote, World Lock, RLS, cultural, secure-ingest, or exact-script
  constraints to make tests pass.
- Do not create fabricated progress, ETA, QC, or provider output in the UI.
- Do not allow model-generated text to become source-script truth.
- Do not expose provider keys to browser or Trigger runtimes.
- Do not treat generated temple imagery as factual without evidence-bound
  references.
- Do not run a new adversarial reviewer after every fix/batch. Review once at
  the end of the phase, fix findings, and re-gate.
- Do not run unrelated write-heavy agents concurrently in the shared checkout.
- Do not browse Vercel for routine deployment.
- Do not leave test servers running after browser work.

## 15. Definition of project completion

The active goal is not complete when Phase 2 passes. It is complete only when
the end-to-end design and implementation plan are realized through Phases 0–4,
required independent phase reviews and fixes pass, production infrastructure is
configured, the GitHub/Vercel/Supabase/Trigger/provider path is deployed and
verified, a real Episode works end to end with complete lineage, and the
remaining owner-supplied pilot/calibration work is clearly separated and ready.

Until that evidence exists, keep the goal active and continue autonomously.

## 16. 2026-07-20 developer-MVP World and studio release candidate

Live state supersedes several older stopping-point statements above. Production
already contains the compact Phase 2 MVP schema through the three-second visual
coverage work; do not rely on the earlier claim that production has no Phase 2
migrations. The owner explicitly prioritized a usable internal MVP and asked
that routine deterministic checks be batched rather than expanded without a
specific risk.

The current candidate adds the following coherent product slice:

- Atrium now exposes both the Series -> Episode hierarchy and an across-Series
  queue of Episodes still in progress. Creating a Series opens that Series;
  creating an Episode goes directly to its Script chamber. The unexplained
  Episode story note is removed.
- Login and creation surfaces accurately present fifteen specialist AI agents
  coordinated by Monica. Every creation chamber has a compact current-agent
  indicator. World shows real, database-backed handoffs among extraction,
  research, prompting, provider queue/generation, secure ingest, review, and
  failure; there are no fabricated percentages or ETAs.
- World extraction schema v2 detects character forms, locations, and up to
  twelve story-significant props such as Shiva's Pinaka. Real temples retain
  the evidence-bound public-reference research path. Generated prop/location
  anchors share the existing secure provider and quarantine boundary.
- The exact USD 5.00 developer-MVP pre-lock pass may be authorized from an
  active AAL1 or AAL2 session. Its existing USD 3.84 World plus USD 1.16
  narration partition is unchanged. World Lock, production authority, cultural
  authority, and higher-consequence commands remain AAL2-only. Micro authority
  provenance is rebound transactionally from the exact spend intent named by
  each World or narration preparation; no global inference trigger remains.
- Transient success notices dismiss after one second. Rejected and unconfirmed
  outcomes persist until dismissal or authoritative reconciliation.

Preview `iuzijmzcimtwyowhwinu` has migrations
`phase3_world_progress_props_and_mvp_authority` and
`phase3_world_authority_and_progress_review_fixes`. The progress table forces
RLS, is select-only for active members, and is in the Realtime publication.
Live verification reports both exact-intent binding triggers present, the old
global trigger absent, and zero mismatched World/narration authorizations.

One context-minimized independent review reported two P1 and three P2 findings:
broad AAL inference, terminal ingest progress, provider-queue wording, toast
error persistence, and a false home empty state. All five are fixed. The
affected frozen evidence is green: type checking; lint; 84 unit files / 498
tests; integration 5/5 with one live scanner test intentionally skipped; the
three focused browser journeys; security; bundle scan (70 browser files, 2,142
build files); RLS/policy static checks; canary production build; and preview
pgTAP at 178/178, 85/85, 57/57, and 45/45. The pgTAP authenticated-command
allowlist now includes the already deployed compact MVP production commands.

At the time this section was written, production migration, explicit GitHub
push, automatic Vercel deployment, and post-deploy live Episode proof remained
the immediate release steps. The larger Phase 3 and Phase 4 roadmap is still
active and must not be called complete from this MVP slice.

## 17. 2026-07-20 live Ep 1 recovery and retry hardening

The section 16 release candidate was committed as `d16a9bb` and pushed to
explicit GitHub `main`. Vercel deployment `dpl_4ZuuwvjFabQjDNXYMAn2jyJBeT1T`
became READY for that exact commit, owned the canonical production alias, and
served the new agentic-crew and studio hierarchy UI. Production now has both
World progress/prop migrations from section 16 with the same RLS, Realtime,
and exact-intent verification as preview.

The owner's existing Episode `6f6bdc23-8e54-4f41-b693-3f2e0a0d6852` (Ep 1)
was opened through the deployed UI. Its World action returned 202 and created
durable preflight run `4ab7961d-dabb-47d8-9a49-5d857219cc1d`, proving that the
former AAL1 authorization dead end is closed. The live worker then exposed two
separate retry defects that narrow local mocks had not exercised:

- OpenAI strict structured output rejects the unsupported JSON Schema keyword
  `uniqueItems`. It was removed only from the provider schema; the local parser
  still enforces unique IDs and reference lists. Commit `ae76e22` is deployed
  READY as Vercel deployment `dpl_9rzoF6ZFwVmA5JPZB6yL4Xy7PcuC`, and a bounded
  live probe returned OpenAI 200 with the repaired strict schema.
- A preflight retry attempted to insert the same immutable input manifest a
  second time and collided with its unique run/hash constraint. Migrations
  `phase3_preflight_retry_manifest_reuse` and
  `phase3_preflight_retry_manifest_reuse_disambiguation` now reuse only the
  exact recomputed manifest hash. Both preview and production have the two
  migrations. A rollback-only production dispatch diagnostic succeeded and
  the next worker received a higher fencing token with the same input
  manifest, proving retry authority is durable without minting a second input.

The second live attempt reached OpenAI but exceeded the 180-second request
window. Commit `2ba6f3c` deployed READY as Vercel deployment
`dpl_C2qGSH3B7KLaeb2UtXM78pehU6w2` with retry-manifest reuse, medium reasoning,
and a temporary World-only 240-second client request window. A live recovery
immediately proved that widening invalid: the database model-call ledger
correctly permits exactly 180 seconds. The client is therefore restored to the
ledger-bound 180-second maximum; no execution authority was widened.

At medium reasoning the next exact live attempt completed inside 180 seconds
and identified Rama, Sita, King Janaka, Sage Vishvamitra, Parashurama, the
assembled kings and warriors, the royal assembly hall of Mithila, the approach
to Mithila, Shiva's great bow, and Parashurama's axe. It first failed closed on
an ambiguity that referenced a non-canonical key. The strict provider schema
and instructions now require ambiguity references to use only an extracted
entity's exact `canonicalKey`, permit the already supported `prop` ambiguity
kind, and use an empty list for scope-wide ambiguity. A further retry completed
the same extraction and persisted entity-by-entity progress, including both
props, without spending provider authority.

That retry exposed one final semantic defect: two quoted declarations inside
the narrator-read immutable Hindi prose were classified as separately performed
dialogue. Launch remains one selected narrator reading every immutable word;
quote marks alone do not create character actors, dialogue performance, or lip
sync. The extraction contract now marks quoted narrator prose as narration-only
and reserves dialogue/lip-sync flags for explicit separate character voices or
on-screen mouth-synced performance. A focused regression test binds that rule.

The World screen now presents a clean `Retry World` recovery action only when
there are failed progress rows, no active work, and no generated anchors. It
starts a new fenced run while retaining the prior attempt as audit evidence and
never mutates the script. A successful retry resets the system progress row to
`extracting`, so users see the current agent and item-level progress instead of
a stale failure. The next operational step is to deploy this correction, start
a new run for the same Ep 1, and preserve its provider-dispatch and UI evidence
here.

Deployment `dpl_J6wX4FPiiSqxE1CGcnCdS29GuVYR` is READY for commit `541dff7`
and owns the canonical production alias. Ep 1 run 2 proved the corrected scope
contract live: it returned narration-only, no dialogue, and no lip sync, while
extracting six character forms, two locations, Shiva's bow, and Parashurama's
axe. Two additional defects were then closed without provider spend:

- `phase3_world_extraction_cross_attempt_replay` lets a fenced retry reuse an
  immutable extraction only inside the same run, authority epoch, and exact
  input-manifest hash. Preview and production both have the migration.
- `phase3_provider_capability_registration_disambiguation` qualifies the
  Nano Banana generation/edit capability column that PL/pgSQL otherwise
  confused with its local record variable. Preview and production both have
  the migration, and a production registration now returns the expected
  verified capability at exactly USD 0.12 per image.

Run 3 (`c733fbde-e3a8-4978-bf14-1642b7d69349`) passed launch scope and
completed extraction but stopped before spend because it treated the absence
of the proper name Pinaka as a blocking ambiguity for the script's generic
"Shiva's great bow." The contract now preserves the exact generic sacred-prop
identity, forbids invented proper names or iconography, and does not block only
because the immutable script is less specific. The next live run must prove
provider jobs are dispatched from that rule before this recovery is called
complete.

## 18. 2026-07-20 Ep 1 production dispatch proof

The live recovery is now past the World blocker. The immutable Episode, Series,
configuration candidate, and script revision remain:

- Episode `6f6bdc23-8e54-4f41-b693-3f2e0a0d6852` (`Ep 1`)
- Series `e8f6f4cf-4484-465b-8e85-fcdd8d962536`
- configuration `830c078b-4aa3-4c02-a066-83f508ba8a49`
- script revision `edeb0410-9720-479c-958d-a2294fdac72f`

The live attempts exposed and closed four additional transaction/retry gaps:

- `phase3_mvp_claimed_provider_authority` permits the compact inline worker to
  consume exact provider authority while its live fenced attempt is `claimed`;
  all quote, grant, manifest, expiry, epoch, and fence checks remain intact.
- `phase3_preflight_world_intent_renewal` aligns the user-facing `Retry World`
  route with the configuration ledger so an exact USD 5.00 bounded intent can
  be renewed from `preflight` as well as `world_design`.
- `phase3_claimed_preflight_dispatch_resume` lets the durable production worker
  resume the same still-live claimed attempt after a local/inline worker exits.
  It requeues only the mutable run-control row and refuses expired or mismatched
  leases; it does not mutate the attempt, preparation, jobs, or script.
- `phase3_world_preparation_total_disambiguation` qualifies the quote's
  `total_minor` column in the immutable preparation replay branch. The prior
  unqualified name collided with the PL/pgSQL variable and explained the
  generic World ledger error before provider claims.

Preview and production both have all four migrations. A rollback-only
production probe proved the exact first job can be claimed and its bounded MVP
provider authority consumed without committing a request. The final clean run
`b92734c4-285a-45ba-99de-eeebb9635200` then completed the same narration-only
extraction and prepared nine visual anchors: six character forms, two
locations, and the script-faithful generic Shiva bow prop. It has no blocking
ambiguity and does not invent the proper name Pinaka.

The production-secret worker replayed the nine reserved claims and submitted
them once. Current authoritative evidence is:

- preflight run, root stage, and attempt: `waiting_external`
- exact attempt lease: `consumed`
- World jobs: 9 `waiting_output`
- provider requests: 9 `accepted`
- user-visible progress: 9 `generating` items plus the identified system row
- primary requested amount: 9 x USD 0.12 = USD 1.08, within the unchanged
  USD 3.84 World partition and USD 5.00 total developer-MVP ceiling

The owner can refresh the deployed Episode and return to World; the Realtime
progress rows now describe actual provider work. Do not call the whole project,
Phase 2, Phase 3, or Phase 4 complete from this recovery. Secure ingest,
candidate review/World Lock, and the remaining phase gates still apply.

## 19. 2026-07-20 Ep 1 secure-ingest recovery and MVP studio UX batch

All nine Ep 1 Nano Banana requests from preparation
`c53cbd4d-2704-49a8-b0f1-6409cdcef862` completed at FAL in 31–63 seconds.
Generation was not slow or still running. The original production callbacks
returned 401 because FAL's live Ed25519 JWKS `x` value was valid padded
base64url (44 characters), while the verifier accepted only the unpadded
43-character form. Commit `65b90e6` accepts both canonical encodings and is
already live.

FAL did not replay those callbacks after the verifier deployment. Migration
`fal_authenticated_result_recovery` therefore adds a service-only,
request-bound authenticated-poll recovery class, and
`recover-completed-fal-world-jobs.mjs` retrieved the exact nine completed queue
results without regenerating or spending again. The production requests were
also rebound from the accidentally selected test provider account to the
otherwise identical active production account.

The recovery exposed two independent secure-ingest defects:

- there was no active exact-host `provider_output` remote-fetch policy;
  migration `fal_provider_output_allowlist` installs active policies for all
  four environments with only `v3b.fal.media` and `cdn.fal.media`;
- Node 20+ requested the custom HTTPS lookup callback in all-address mode, but
  the pinned transport returned the legacy single-address shape. This caused
  `ERR_INVALID_IP_ADDRESS` before any remote bytes were received and was
  recorded safely as `remote_fetch_network_failed`. The transport now honors
  both callback forms while returning only the one policy-validated address.
  A diagnostic against the real recovered Ep 1 URL downloaded the 6,007,600
  byte PNG successfully, and a focused regression binds the all-address form.

The same batch implements the owner's MVP studio corrections: the global
workspace switcher and redundant Monica destination are removed; review work
is available in Activity; Series and Episode cards use compact, consistent
dimensions; the Series CAS/archive footer is removed; Atrium places matching
Create Series and Create Episode actions together; the account panel removes
TOTP enrollment and exposes a single consistently styled Member role; and
every Episode link resolves its authoritative current creation chamber, with
completed production resolving to Create. User-facing copy now consistently
describes the agentic AI crew.

The developer-MVP password-authority migration removes the legacy TOTP gate
from the three exact interactive commands used by this single-owner workflow
while preserving authenticated identity, workspace role, immutable ledger,
spend, fencing, and final-human-release checks. The larger production security
and calibration contracts remain unchanged.

Pre-deploy evidence for this coherent batch is green: the complete unit run
passed 84 files / 501 tests before the final transport regression; the focused
remote-fetch and provider-ingest suite passes 37/37; integration passes 5/5
with one intentional live-scanner skip; seven focused browser journeys pass;
type checking, lint, formatting, security, browser/server bundle scan,
production secretless/fail-closed boot, the Phase 2 database/provider policy
checks, and canary build pass. Preview and production both have the three new
migrations. Explicit GitHub push, automatic Vercel verification, and final Ep
1 asset-promotion evidence remain the immediate next steps for this batch.

## 20. 2026-07-20 Ep 1 private-preview and current-run projection proof

The section 19 batch and its subsequent secure-ingest corrections were pushed
to explicit GitHub `main`. All nine recovered FAL outputs are now atomically
promoted: six `character_selections` and three location/prop selections are in
`review_required`, with nine matching immutable `asset_versions` and nine
matching current `storage.objects` receipts. The generated Shiva bow remains a
story-prop projection; it is not renamed or treated as a place.

The final blank-preview root cause was not Nano Banana latency. The promoted
objects were present, but `workspace_media_member_select` allowed authenticated
download/info operations and omitted Supabase Storage's current
`storage.object.sign` operation. Storage therefore hid each signing request as
`Object not found`, and the application correctly returned nine 503 preview
responses. Migration `workspace_media_signed_preview` is applied to preview
and production. It adds only `storage.object.sign` and
`storage.object.sign_many`, while retaining the private bucket, authenticated
role, exact workspace-path derivation, and active-membership predicate. A
production test using the owner's normal authenticated session now creates the
short-lived URL successfully; the same test also succeeds with service
authority.

The provider promotion caller is also hardened at the ambiguity boundary. Once
the atomic promotion RPC has been attempted it no longer deletes the uploaded
immutable object on a transport timeout. It first reconciles the exact asset
ID, object path, quarantine source, and storage receipt. If that evidence is
not available it retains a harmless unbound object for later evidence-aware
cleanup rather than risking deletion after a committed transaction.

World progress now queries only the newest fenced `world_anchor` preflight run.
Historical failed attempts remain queryable as audit evidence but no longer
inflate the current UI. Commit `020c289` is deployed READY as Vercel deployment
`dpl_FozLPcZrndx3bhj7rET5SiQbqQqQ` and owns
`content-genie-three.vercel.app`. Authenticated post-deploy browser evidence for
Ep 1 shows exactly `0 of 9 world anchors accepted`, nine World cards, nine
image elements, nine `Accept anchor` actions, zero unavailable previews, and
zero stale progress cards. Opening Ep 1 resolves directly to World, its current
authoritative chamber.

The proportionate regression batch is green: type checking; lint; formatting;
84 unit files / 502 tests; integration 5/5 with one intentional live-scanner
skip; four focused Series/current-chamber/World browser tests; security; the
Phase 2 database policy checks; and the production authenticated signing probe.
No persistent test server remains. The owner workbook is still untracked and
was not staged. Ep 1 is unblocked for human anchor review; the broader Phase 2,
Phase 3, and Phase 4 gates remain active and must not be inferred complete from
this recovery.

## 21. 2026-07-21 owner-feedback World recast and studio-density batch

The owner-feedback review in `C:\Users\shiba\Downloads\Genie Feedback.docx`
identified one backend defect and a coherent UI/prompting batch. The stalled
Ep 1 `Mithila ki Rajsabha` recast was not a slow FAL request: regeneration
request `4edbd5d4-be6c-4a71-b923-bc428153cf44` was durably `queued`, but no
provider request or worker consumer had ever been created for that event.

Migration `world_regeneration_dispatch_recovery` closes that gap. It binds an
exact user-authorized regeneration request to a fresh fenced `world_anchor`
preflight run, one bounded Nano Banana job, normal provider capability and
quote authority, secure ingest, and the existing atomic candidate-promotion
path. The minute MVP worker also claims legacy queued requests, so the live Ep
1 request does not require another user click. All new RPCs are executable by
`service_role` only; preview and production both have the migration, with the
live request still queued until the matching application worker deploys.

The same batch implements the requested interaction and visual corrections:

- World cards are aligned in consistent rows; the deliberate vertical stagger
  is removed.
- accept, recast, and upload use per-card pending state, so independent anchors
  remain actionable in parallel; short-lived signed previews are cached across
  reconciliation refreshes.
- every World anchor prompt and every Director shot blueprint explicitly
  describes one self-contained image/shot and forbids prior/next-image
  assumptions; researched real-world references and locked World identities
  remain separate generation inputs.
- the creation header now reads Episode then Series and has no idle `Ready`
  label; the main studio profile/actions are right-aligned.
- Atrium has one matched Create Series/Create Episode action pair, no duplicate
  row-level Create Series action or hierarchy label, and compact rectangular
  Series/Episode cards. The Series catalogue no longer prints `Series · active`
  and uses a denser multi-column layout.

Proportionate pre-deploy evidence is green: formatting, lint, type checking,
84 unit files / 502 tests, integration 5/5 with one intentional live-scanner
skip, the two focused Atrium/Series and World accept/recast browser journeys,
and the secret-canary production build. Supabase preview confirms all new
functions and run-binding columns, and preview/production privilege probes
confirm no `anon` or `authenticated` execution.

Commit `8fa57c27e447a0e73184930ce2c5fc751a98deda` was pushed explicitly to
GitHub `main`. Automatic production deployment
`dpl_3VVLjStLRc5DBcb14SGDSNVZ4DRo` reached READY and the canonical alias served
that exact deployment; the health route returned production `ok`.

The live legacy request then exposed two narrow replay ambiguities that are
now corrected in preview and production. `world_regeneration_preflight_resume`
accepts the episode configuration's legitimate `preflight` state after the
queued recast creates its run, and
`world_regeneration_decision_disambiguation` qualifies the regeneration
decision field rather than colliding with the PL/pgSQL output variable.

Ep 1's replacement is no longer queued or generating. Authoritative production
proof now shows request `4edbd5d4-be6c-4a71-b923-bc428153cf44` `completed`,
run `bee1e4d5-2c35-47ea-b802-9a2108c64a3b` `succeeded`, job
`e3cc4cdb-58bc-571f-bae7-4f3ab446cc39` `promoted`, provider request
`630ad078-76a4-4f3e-8dd8-0818b7dc84f3` `succeeded`, immutable World version
`d977013e-4756-4fec-b7d7-f059ea62c8d8`, and promoted asset version
`e0c7d4a5-20d6-4e01-977b-f3f9835e7193`. The Mithila location selection is
`review_required` at aggregate version 3, intentionally with no selected
version until the owner chooses `Accept anchor`.

FAL completed the generation normally, but its signed webhook was rejected
three times with 401. The exact completed result was recovered once through
the existing request-bound authenticated polling authority, without a second
generation or second spend. Migration `fal_authenticated_poll_reconciler` and
the secure-ingest worker now make that fallback automatic and bounded: only a
service-role worker can select one aged accepted FAL image request, the result
is fetched with the provider credential, and the output must still pass the
provider inbox, private quarantine, media scan, and atomic promotion path.
Preview and production privilege probes show service execution only. Focused
fallback/webhook/ingest tests pass 12/12, and type checking, lint, and formatting
remain green. This does not complete the broader phase gates.

Follow-up commit `14342e5163b01007746d343da533f2c5b3bfb291` was pushed
explicitly to GitHub `main`. Automatic Vercel deployment
`dpl_7ciWAnJJuoQVLN5zQPFQttr5gYQs` reached READY, owns
`content-genie-three.vercel.app`, and serves the exact commit. Canonical health
is HTTP 200 with production `ok`, and the post-deploy runtime-error query is
empty. An authenticated Ep 1 browser probe resolves directly to World with
nine cards, nine image elements, one replacement `Accept anchor` action, zero
recasting cards, no stale `Ready` label, no application overlay, and no browser
page errors.

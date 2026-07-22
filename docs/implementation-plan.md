# Genie by Zyra — executable implementation plan

**Status:** Implementation-plan gate passed
**Version:** 1.0
**Date:** 17 July 2026
**Design authority:** `docs/Genie by Zyra - End-to-End Solution Design.docx` and
its source contracts
**Target:** Software-complete launch system, deployed canary, and owner-ready
human pilot

> **Developer-MVP override (2026-07-20):** Owner direction now prioritizes the
> shortest credible owner-operated end-to-end application over the original
> launch-hardening program. `docs/MVP_DELIVERY_PROFILE_2026-07-20.md` is the
> active release gate for the first deployment. Requirements deferred by that
> profile remain visible and must not be represented as verified, but they do
> not block the developer MVP.

## 1. Outcome and delivery rule

This plan builds Genie as an internal, multi-user AI film studio that turns an
exact user-provided Hindi narration script into a 60–120 second, 9:16 cinematic
devotional episode. The launch system must:

- preserve the submitted script exactly;
- let the user choose narrator gender, one of 117 looks, and approve or replace
  AI-generated characters and locations;
- atomically lock the creative world, configuration, provider quote, budget
  ceiling, and Series Release before autonomous spend;
- run a durable, evidence-producing production pipeline;
- use Monica for provisional machine quality orchestration;
- require separate qualified cultural and creative/final human approvals for
  every launch master;
- support timecoded repair feedback, versioned repair candidates, export,
  search, notifications, and concurrent Series/Episode work;
- fail closed on integrity, authority, cultural, quality, budget, provider, or
  evidence uncertainty.

Under the developer-MVP profile, a coherent phase slice exits when its
owner-visible happy path, essential invariants, focused regression, build, and
deployment evidence pass. The broader launch gates below remain the roadmap
for wider-team or production-readiness promotion.

## 2. Delivery topology

```text
Browser
  -> Next.js 16 App Router on Vercel
     -> authenticated Server Actions / Route Handlers
        -> Supabase Auth + Postgres command functions
        -> Supabase Storage + Realtime
        -> transactional outbox
           -> Trigger.dev control-plane tasks
              -> provider adapters
              -> media ingest and evidence
              -> dedicated large-1x render queue
        -> Monica deterministic and model-assisted QC
  -> review, repair, approval, export
```

### 2.1 Repository structure

```text
src/
  app/                       Next.js routes, layouts, error/loading boundaries
  components/                accessible Living Cinema primitives
  features/                  product-facing vertical slices
  domain/                    pure state, policy, scoring, and command logic
  server/                    authenticated commands, queries, and authorization
  infrastructure/            Supabase, Trigger.dev, providers, media, telemetry
  config/                    validated public/server configuration
trigger/                     durable workflows and provider/render tasks
supabase/
  migrations/                ordered, forward-safe SQL migrations
  seed.sql                   deterministic local/test reference data
tests/
  unit/                      pure domain and utility tests
  integration/               database, command, outbox, storage, provider mocks
  rls/                       outsider/member/role/storage isolation tests
  contract/                  provider, event, schema, rubric, config contracts
  browser/                   Playwright user journeys and accessibility
  workflow/                  retry, crash, stale callback, reconciliation tests
  media/                     ffprobe, loudness, caption, checksum fixtures
  security/                  TM-01..TM-42 and secret/bundle tests
  visual/                    reference screenshots and responsive checks
reference/
  rubric-config/             immutable source rubric snapshots
  acceptance/                machine-readable requirement/test inventory
docs/evidence/               commit-bound verification reports
```

### 2.2 Package and runtime baseline

- Node.js `22.23.1`, pinned in `.nvmrc`, `.node-version`, CI, Trigger image, and
  `package.json#engines`.
- pnpm `11.9.0` with a committed lockfile.
- Next.js `16.2.10`, React/React DOM `19.2.7`.
- TypeScript `5.9.3` strict, exact ESLint/Prettier versions, Tailwind CSS
  `4.3.3`.
- Supabase JS `2.110.7`, Supabase SSR `0.12.3`, Supabase CLI `2.109.1`, and
  generated database types.
- Trigger.dev SDK/build `4.5.4` with a digest-pinned task image and machine
  configuration.
- Vitest `4.1.10`, exact Testing Library/axe/fast-check versions, and Playwright
  `1.61.1`.
- Zod for boundary and environment validation.
- Exact ffmpeg/ffprobe 7.x build, libass, Devanagari fonts, OS packages, and
  container image digest are selected in `P0-01` and then treated as immutable
  release inputs.
- No Sentry. Structured diagnostics, aggregates, audit, and client-error
  reports persist in Supabase.

## 3. Cross-phase engineering contracts

### 3.1 Command path

Every state-changing action uses one authenticated command boundary:

1. validate schema and payload size;
2. derive actor from a fresh server-side auth check;
3. revalidate workspace membership, role, AAL, and aggregate version;
4. call an allowlisted SQL command function or a narrowly scoped server
   transaction;
5. persist command receipt, audit event, domain event, and outbox work in the
   same transaction;
6. return a safe typed result;
7. make retries idempotent.

Client code never writes authority, status, approval, budget, provider, audit,
or workflow tables directly.

### 3.2 Immutable/versioned data

Stable identities point to immutable versions. Generation and approval rows pin
exact version IDs and hashes. Replacement creates a new version; it never
overwrites evidence used by a historical run or master.

### 3.3 Expensive work

Every provider request belongs to exactly one authorized spend envelope:

- an authenticated rate-card snapshot and capability row are pinned;
- either a bounded pre-lock micro-quote or the full production/repair high
  envelope has an active authorization;
- exactly one unused quote-line slot is claimed by compare-and-swap;
- workspace and Episode budgets remain valid;
- the applicable preflight or run/stage authority epoch and fencing token are
  current.

Pre-lock micro-spend covers only provider verification, world anchors/sheets,
pronunciation/score previews, narration master-clock synthesis, and
story/shot/EDD preflight. It has its own authorization, hard ceiling, request
slots, settlement, and cancellation. It can never authorize production clips.

The full production high envelope is calculated only after the master clock,
shot graph, EDD request expansion, route choices, billing quanta, and bounded
candidate/retry/alternate slots exist.

### 3.4 Evidence

Every external or model-assisted outcome stores:

- input/version hashes;
- model, provider, endpoint, parameters, and request correlation;
- timestamps and latency;
- cost state;
- output checksum and media probe where applicable;
- evaluator/rubric/config versions;
- verdict, confidence, evidence pointers, and indeterminate reason.

### 3.5 Feature flags

Incomplete or uncalibrated expensive paths remain server-side disabled. Flags
cannot relax integrity, authorization, budget, cultural, or final-approval
requirements.

### 3.6 Gate-specific evidence policy

- A phase requirement that is implemented and in scope for that phase must be
  `verified`.
- `failed`, `unimplemented`, and `implemented_unverified` always block the
  phase that owns the requirement.
- A future-phase requirement remains `unimplemented` and is explicitly outside
  the earlier gate; absence is tested only to prove the feature is disabled.
- `deferred_external` can pass only `software-complete` when the named external
  integration is feature-disabled and the limitation is explicit.
- `deferred_external` blocks `provider-enabled`, `production-ready`, final
  approval, provider spend, export, and the owner pilot whenever the deferred
  item is required by those milestones.
- Production readiness requires every launch-blocking software, provider,
  recovery, security, QC, cultural-authority, and deployment requirement to be
  `verified`.

## 4. Phase 0 — bootstrap and reproducible toolchain

### Entry

- Design gate is PASS.
- GitHub checkpoint `2b1db34` is available.
- `.env.local` is ignored and contains the currently supplied development keys.

### Work packages

#### `P0-01` Bootstrap the application

- Create the Next.js application in the repository root without disturbing
  design/reference artifacts.
- Configure strict TypeScript, ESLint, Prettier, Tailwind, aliases, and
  server-only import protection.
- Freeze exact package versions, runtime/tool checksums, container inputs, and
  supported Node/pnpm versions.
- Generate an SBOM and add dependency, license, container, and secret scans.
- Add a secretless-fork CI job that proves pull-request code receives no
  production secrets.
- Add scripts for typecheck, lint, unit, integration, RLS, browser, accessibility,
  visual, security, build, and all-gates.
- Add deterministic CI on GitHub Actions.

#### `P0-02` Validate environment and secret boundaries

- Implement typed environment parsing from `docs/environment-contract.md`.
- Separate browser-safe, Vercel server-only, Trigger-only, and local-CLI
  variables.
- Add bundle/secret canary tests.
- Add redaction helpers and safe structured logging.

#### `P0-03` Establish local and CI test infrastructure

- Configure Vitest projects and Playwright.
- Add Supabase CLI configuration and an isolated database workflow: local
  Supabase when Docker is available, otherwise a managed Supabase preview
  branch/test project with non-production keys and automatic cleanup.
- Never run destructive integration fixtures against the production project.
- Add provider fakes, webhook fixtures, media fixtures, and deterministic clock,
  UUID, and object-storage helpers.
- Add a machine-readable acceptance inventory validator that checks all 207
  requirements, exact Markdown-to-child ownership parity, valid work packages,
  checkpoint-specific proof, status enums, parent-status computation, and
  verified evidence/commit/date.
- Treat `traceability-evidence.v1.json` as the durable, hand-updated status
  source and `traceability-plan.v1.json` as generated output; regeneration must
  preserve every evidence record or fail on a stale work-package or
  obligation-definition hash.
- A `verified` entry requires nonempty allowlisted `docs/evidence/` artifacts
  with matching SHA-256 values, a real Git commit containing the same bytes,
  and a valid non-future date. Missing artifacts, nonexistent commits, changed
  source/rationale/owner/proof, compact verification ranges, and future-phase
  verification IDs fail the generator and its mutation test.

#### `P0-04` Create application observability primitives

- Define diagnostic event schemas and severity taxonomy.
- Add server/client error boundaries that submit redacted reports.
- Add request, command, run, stage, and provider correlation IDs.

### Exit gate

- Clean install, lint, typecheck, unit smoke, build, and one browser smoke pass.
- Browser bundle contains no seeded secret.
- CI runs from a clean checkout.
- SBOM/dependency/container/secret scans and secretless-fork evidence pass.
- Every `@phase0` obligation in
  `reference/acceptance/traceability-plan.v1.json` is `verified`.
- Cold code/test review has no unresolved P0/P1.
- Commit and explicit-URL push.

### Rollback

The phase is additive. Revert the checkpoint; no remote schema or provider work
is enabled.

## 5. Phase 1 — identity, data foundation, workspace, Series and Episode

### Entry

- Phase 0 gate passes.
- A Supabase project is selected and authenticated through the installed
  Supabase integration or CLI.

### Migration sequence

Migrations are expand-only within this phase and apply in this order:

1. `0001_extensions_schemas.sql`
   - extensions, `public`, `private`, and `audit` conventions;
   - enum/reference tables only where evolution is safe.
2. `0002_identity_workspace.sql`
   - organizations, workspaces, memberships, roles, invitations, actor
     principals, sessions, and trusted claims.
3. `0003_series_episode.sql`
   - Series, ACL, releases, continuity versions, Episode Outcome Proposals,
     Episodes, owners, watchers, archive state.
4. `0004_commands_events.sql`
   - command receipts, aggregate versions, domain events, transactional outbox,
     inbox, delivery attempts, dead letters.
5. `0005_work_notifications.sql`
   - work items, claims/leases/fences, notifications, activity, presence.
6. `0006_diagnostics_audit.sql`
   - diagnostics, client error reports, aggregates, restricted append-only audit.
7. `0007_rls_grants_indexes.sql`
   - explicit grants, RLS, membership helpers, composite workspace foreign
     keys, and policy-leading indexes.
8. `0008_storage_policies.sql`
   - workspace-scoped buckets and object policies.

### Work packages

#### `P1-01` Supabase clients and authorization

- Implement cookie-safe SSR browser/server clients.
- Implement invite-only onboarding with hashed single-use tokens, expiry, exact
  invited-email match, inviter role caps, replay prevention, and rate limits.
- Disable anonymous sign-in.
- Implement TOTP enrollment/recovery and enforce current `aal2` in the server
  command and database boundaries for admins, reviewers/approvers, budget
  authority, Series publication, and other high-consequence actions.
- Implement session inventory, revocation, role downgrade/deactivation, and
  offboarding so open tabs cannot retain authority.
- Use fresh server user/claims checks for commands.
- Implement workspace selection and permission evaluation.

#### `P1-02` Command and query infrastructure

- Implement typed command envelopes, idempotency receipts, aggregate CAS, audit,
  domain events, and outbox insertion.
- Implement safe paginated query services.
- Implement leases and fencing helpers.

#### `P1-03` Workspace shell

- Build authenticated Living Cinema shell, command palette, global search
  entry, activity tray, Monica status, notifications, and responsive navigation.
- Preserve accessible names, focus order, reduced-motion behavior, and 44px
  targets.

#### `P1-04` Series and Episode organization

- Create/list/search/archive Series.
- Create Episodes with Series numbering and ownership.
- Show concurrent episode states, assigned review work, generation activity,
  cost state, and completed downloads.
- Implement versioned Series Release and continuity-state read models without
  yet enabling production.

#### `P1-05` Realtime and reconciliation

- Subscribe only to authorized workspace projections.
- Treat Realtime as a hint; refetch authoritative state after reconnect.
- Add outbox/inbox and stale-lease reconcilers in dry-run/test mode.

### Required adversarial proof

- Every exposed table has RLS and explicit grants.
- Outsider, removed member, wrong role, forged workspace ID, and direct REST
  mutation tests fail.
- Duplicate create commands return the same aggregate.
- Concurrent Episode numbering and Series update CAS are deterministic.
- Realtime reconnect cannot resurrect stale state.
- Audit rows cannot be changed by application roles.
- Storage path traversal and cross-workspace object access fail.
- Deactivating an owner revokes sessions/leases and transfers active
  Episodes/work items/runs through an audited workflow.
- Fixture-driven empty, partial, retrying, paused, delayed, blocked, canceled,
  resumed, and happy states pass on desktop, tablet, and 390px mobile.

### Exit gate

- Every `@phase1` child obligation in the machine traceability ledger is
  `verified`; later child obligations under the same parent remain
  `unimplemented`.
- Future feature surfaces remain disabled and are not counted as verified.
- Foundation migrations pass fresh apply, replay, lint, policy inventory, and
  forward rollback drill.
- Core authenticated Series/Episode flow passes browser and accessibility QA.
- Independent cold code/test review and adversarial runtime test pass.
- Supabase migration checkpoint, docs/project state, commit, and push complete.

### Rollback

- Disable application features through server flags.
- Roll forward with corrective migrations; never rewrite applied migration
  history.
- No provider spend exists in this phase.

## 6. Phase 2 — immutable input, provider preflight, world design, and atomic World Lock

### Entry

- Phase 1 gate passes.
- 117 look records and prompt-tail source data are available from the pinned
  AI Director reference.
- A non-production Supabase project/preview branch is isolated for provider and
  media security tests.

### Migration sequence

1. `0010_scripts_and_sidecars.sql`
2. `0011_looks_voices_and_config.sql`
3. `0012_characters_locations_versions.sql`
4. `0013_sources_rights_competencies_reviews.sql`
5. `0014_pronunciation_score_sound_identity.sql`
6. `0015_preflight_runs_stages_attempts_leases.sql`
7. `0016_agent_tool_grants_and_evaluator_records.sql`
8. `0017_provider_accounts_broker_identities_capabilities_requests.sql`
9. `0018_remote_fetch_quarantine_assets.sql`
10. `0019_budgets_production_and_micro_quotes_reservations_claims.sql`
11. `0020_preflight_master_clock_story_reference_graph_qc.sql`
12. `0021_series_releases_run_envelopes_world_lock.sql`
13. `0022_phase2_rls_grants_indexes.sql`

Phase 2 contains preflight runs, stages, attempts, leases, fencing, authority
epochs, authoritative-run uniqueness, configuration/Series/quote pins, and all
FKs required by live world/preflight work and World Lock. Phase 3 extends the
same state model for production lanes; it does not introduce authority state
after Phase 2 already needs it.

Migrations `0015`, `0017`, and `0019` implement sections 4.3.2 and 4.3.3 of
`docs/state-and-data-contract.md`: preflight commands and authority, separate
micro quote/authorization/reservation/slot state, and the broker
client/key/assertion-JTI registry. They must land before any live Phase 2
provider canary.

### Work packages

#### `P2-01` Exact script ingestion

- Preserve raw browser text and uploaded source bytes where applicable.
- Store UTF-8 serialization/hash, Unicode scalar and UTF-16/grapheme maps,
  NFC/LF processing representation, library versions, and immutable lock event.
- Add typed annotations for claim extraction, pronunciation, visual beats, and
  performance without changing source text.
- Estimate duration and require acknowledgement for out-of-band input.

#### `P2-02` Voice selection

- Male is default; female is available.
- Pin the supplied ElevenLabs voice IDs as versioned, server-configured voice
  identities with ownership/test evidence.
- Never silently substitute a different identity.
- Present an equal third choice to upload an owner-recorded MP3 or WAV. Inspect,
  sanitize, transcribe, align, preview, and require explicit confirmation. The
  script comparison is advisory only: after confirmation, the recording and
  its exact transcript are the Episode narration authority, the earlier script
  revision remains immutable, and ElevenLabs is skipped.

#### `P2-03` Look picker

- Port all 117 looks and exact prompt-tail semantics.
- Default to `glowing-divine-realism`.
- Remove the AI Director recommended section.
- Add search, filter, keyboard navigation, preview, and responsive performance.

#### `P2-04` Durable preflight control plane

- Deploy a minimal Trigger.dev preflight/control project before any live Phase 2
  provider or media gate.
- Implement preflight run/stage/attempt states, leases, fences, authority
  epochs, heartbeats, cancellation, bounded retry, dead letters, and
  reconciliation.
- Implement the normative `preflight.*` command/state contract, exclusive
  configuration-candidate/kind authority, and typed separation from production
  runs/stages.
- Use dedicated preflight queues for world images, speech/master clock, secure
  fetch/ingest, and plan evaluation.
- Payloads carry IDs and signed URIs, never large media.
- The preflight dispatcher has no provider API keys; provider calls go through
  the scoped Vercel provider broker in `P2-06`.

#### `P2-05` Read-only typed agent and evaluator boundary

- Implement schema-validated, typed, allowlisted read-only tools for source
  extraction, cultural triage, world prompts, story/shot/EDD planning, and plan
  evaluation.
- Insert server-derived workspace/script/source/version/policy scope; never
  trust model-proposed authority.
- Treat scripts, uploads/OCR, research web text, provider output/errors, and
  model text as untrusted data.
- Enforce output schemas, ID/version checks, fan-out/depth/token/time/cost
  limits, and deterministic validation.
- Permit no arbitrary HTTP, SQL, shell, filesystem, mutation, budget,
  approval, export, or cross-workspace tool.
- Run a Phase 2 injection corpus before machine extraction or planning is
  accepted.

#### `P2-06` Minimal provider core and pre-lock micro-spend

- Implement provider accounts, capability/rate/evidence snapshots, callback
  credentials, request correlation, cost events, and exact quote-line claims.
- Implement the server-only broker client/key/assertion-JTI registry and
  register/rotate/revoke/disable/consume commands before the broker accepts a
  Trigger caller.
- Implement the authoritative request states:
  `reserved → queued → submitted → accepted → polling → succeeded`, with
  `failed_retryable`, `failed_terminal`, `cancel_requested`, terminal
  cancellation, and an orthogonal late-completion/cost record that never reopens
  a terminal request.
- Every retry is a new request row linked to its predecessor.
- Implement signed webhook verification or authenticated polling, inbox
  idempotency, stale-authority checks, and reconciliation before retry.
- Implement image and speech adapters needed by world/preflight work.
- Keep all provider API keys in a narrowly deployed Vercel provider broker.
  Trigger tasks receive a one-attempt registered grant and can request only the
  exact provider operation/slot encoded by that grant.
- Give each Trigger project/environment a unique Ed25519 broker-client identity.
  Every broker call presents a short-lived, replay-protected service assertion
  bound to the exact task/run/stage plus the separately signed, registered
  capability grant. The broker verifies issuer, audience, `kid`, environment,
  subject, `jti`, expiry, grant/attempt/quote/fence binding, and client status
  before loading a provider key.
- Implement overlap-window key rotation and immediate project/`kid`
  revocation. Test wrong-project keys, unknown/disabled `kid`, wrong audience,
  expired/not-yet-valid assertions, subject mismatch, and replay.
- Create a distinct pre-lock micro-quote/reservation/authorization type. It
  has its own command/state lifecycle and cannot claim a production-video,
  render, export, approval, or publication slot.
- Do not dispatch an output-producing canary until `P2-07` quarantine ingest
  and its malicious-media tests are verified.
- Then run bounded account/capability canaries under the micro-budget; every
  completion enters quarantine first.

#### `P2-07` Secure remote fetch and quarantine-first media ingest

- Use separate exact-host allowlists for research references and provider
  output; allow HTTPS only.
- Resolve and reject loopback, link-local, private, metadata-service, encoded,
  IPv4/IPv6, redirect, and DNS-rebinding targets at every hop.
- Never forward user cookies, auth headers, signed URLs, or provider credentials.
- Commit uploads, research images, and provider outputs to a quarantine namespace
  first.
- Enforce byte/pixel/duration/frame/archive/redirect limits, independent magic
  sniffing, decompression-bomb protection, malware scanning, metadata stripping,
  parser sandboxing, re-encoding, probes, checksums, and immutable promotion.
- Renderer/model inputs can reference only promoted, policy-cleared assets.

#### `P2-08` Character and location studio

- Extract required characters/forms and locations from the locked script.
- Generate candidate images using the selected look through `P2-06`.
- Let the user accept, inspect/edit prompt, regenerate, or upload.
- Route every upload, research reference, and provider output through `P2-07`.
- Research named temples from actual references and record provenance.
- Generate provider-compatible character sheets and reference crops after
  acceptance.

#### `P2-09` Qualified source review and cultural readiness

- Implement reviewer competencies, scope, appointment evidence, expiry,
  recusal/conflict checks, and deactivation.
- Extract deity attributes, traditions, named temples, rituals, shlokas,
  contested retellings, violence/romance, caste/social context, and rights
  triggers.
- Create machine readiness findings, source records, rights evidence, and
  impact analysis.
- Require an actual qualified source-review decision bound to the exact source,
  evidence, policy, and competency versions before Series publication.
- Enforce non-overridable launch cultural rules.

#### `P2-10` Pronunciation, score identity, and sound rules

- Create a versioned pronunciation lexicon with Sanskrit/Hindi entries,
  provider markup, human evidence requirements, and shloka restrictions.
- Create a Series score identity with motif, palette, tempo/instrument rules,
  provenance/licensing, and approved library/generation sources.
- Create ambience/SFX identity and dignity rules.
- Generate only bounded micro-spend previews where needed.
- A confirmed owner recording satisfies `human_recording_only` pronunciation
  entries by binding them to that exact promoted narration asset; generated
  narration continues to fail closed for those entries.
- Pin approved voice, pronunciation, score, and sound-identity versions in the
  Series Release candidate.

#### `P2-11` Pre-lock narration, story, shot, EDD, reference-graph, and QC preflight

- Synthesize a bounded narration candidate/master clock with the selected voice
  under the micro-quote, or compile the master clock directly from the confirmed
  owner-uploaded narration without creating any ElevenLabs request or spend.
- Align exact locked words and verify actual 60–120 second duration,
  pronunciation, identity, monotonic timing, corruption, and seams before the
  production quote. For confirmed uploaded narration, "exact locked words"
  means its authoritative transcript revision; mismatch with the earlier user
  script remains visible evidence and never blocks after owner confirmation.
- Produce immutable story, beat, shot, sound, composition, safety, routing, and
  preliminary EDD versions without changing source words.
- Expand the EDD into exact provider request rows, durations, reference counts,
  output/resolution choices, candidate/retry/alternate slots, and billing
  quanta.
- Build the reference graph with cycle detection, later-shot-reference
  rejection, per-shot/master coverage, provider caps, canonical location
  ordering, topological execution order, content-hash staleness, and upstream
  failure spend prevention.
- Run projected OVS/CVP/PFS, coverage, feasibility, cultural, reference-graph,
  and capability gates. Exhausted bounded preflight failure stops before
  production authorization.
- Implement the minimum common QC core here: rubric schema/ID/version/hash
  validation, applicability, deterministic scoring/gate math, evidence schema,
  and plan-verdict records.
- Run the normative plan evaluation pattern through the restricted `P2-05`
  evaluator broker, including independent plan challenges that cannot see one
  another's result before deterministic consensus.

#### `P2-12` Exact production quote and authorization

- Calculate expected and full high envelopes from the accepted master clock,
  EDD request expansion, authenticated rate cards, billing quanta/minima,
  candidate multipliers, bounded retries/alternates, upscaling, audio, judges,
  rendering, and allowances.
- Show the itemized quote and hard ceiling.
- Collect the actor's explicit `aal2` confirmation inputs against the exact
  quote hash and ceiling, but do not create a budget authorization or
  reservation yet.
- Freeze the confirmed quote candidate for the atomic World Lock transaction.
- Production requests can claim only the exact unused slots in this quote.

#### `P2-13` Atomic first-Episode World Lock

Run one serializable command that:

- revalidates script, narration/master clock, story/shot/EDD/reference graph,
  voice, pronunciation, score/sound identities, look, accepted
  character/location versions, qualified source review, cultural/rights
  readiness, capability/rate pins, quote, high envelope, ceiling, actor, AAL,
  and aggregate versions;
- records Series decisions;
- publishes the Series Release and all required components;
- activates the Episode configuration;
- creates the human budget authorization and the sole full high-envelope
  reservation for that quote authorization;
- creates the authoritative production run envelope pinned to every dependency;
- writes audit/domain/outbox rows;
- commits all or nothing.

Later Episodes inherit exact released versions by default and may propose
explicit versioned overrides.

#### `P2-14` Living Cinema creation flow

- Implement Script → Voice → Look → World → Preflight → Create chambers without
  inventing a routine human gate inside production.
- Use optimistic presentation only for non-authoritative local state.
- Surface qualified source status, master-clock duration, reference-graph
  readiness, exact quote, ceiling, lock summary, and warnings.
- Cover empty, partial, generating, retrying, delayed, blocked, canceled,
  resumed, success, and stale states on desktop, tablet, and mobile.

### Required adversarial proof

- Unicode/property tests seed combining marks, emoji, Devanagari, CRLF, upload
  encodings, copy/paste, normalization, and round-trips.
- Any source mutation invalidates downstream versions.
- 117 unique look IDs and default are contract-tested.
- Malicious upload/provider-media corpus, metadata stripping, parser limits,
  quarantine promotion, and content checks pass.
- IPv4/IPv6/private/encoded/redirect/DNS-rebinding SSRF suites pass for research
  and provider allowlists.
- Provider request states, retry-as-new-row, lost response, duplicate/forged/
  late callback, cancel, cost settlement, and no-terminal-reopen tests pass.
- Character/location replacement never mutates an accepted historical version.
- Named-temple, deity, ritual, shloka, rights, competency, recusal, and source
  review fixtures fail closed when incomplete.
- Pronunciation/score/sound release components are complete and pinned.
- Reference-graph cycle, cap, ordering, staleness, later-shot, and upstream
  spend-prevention tests pass.
- Quote requests cannot exceed or bypass authorized micro or production slots.
- Concurrency tests prove only one first Series Release/high reservation/run is
  created.
- Transaction fault injection at every World Lock write proves all-or-nothing.
- Cross-workspace and stale-version attacks fail.
- Fixture-driven desktop/tablet/mobile visual, keyboard, reduced-motion, 100%,
  and 200% zoom QA passes.

### Exit gate

- Every `@phase2` child obligation in the machine traceability ledger is
  `verified`; later child obligations under the same parent remain
  `unimplemented`.
- Future Phase 3/4 capabilities remain disabled and are not counted as passed.
- A bounded preflight reaches one authoritative
  `production_runs.created` envelope with exact pins and no production-video
  request dispatched.
- Independent cold code/test/security/media/visual review and adversarial
  runtime test pass with no unresolved P0/P1.
- Commit and explicit-URL push.

### Rollback

- Disable production enqueue; retain locked versions and reservations.
- Cancel/reconcile preflight work and release unspent reservations through
  audited compensating commands.
- Preserve qualified decisions and immutable released evidence.
- Correct schema forward; do not rewrite migration history.

## 7. Phase 3 — durable production, providers, media pipeline, rendering, Monica QC

### Entry

- Phase 2 gate passes.
- Trigger.dev project and queues are authenticated.
- Phase 2 provider, secure-ingest, master-clock, reference-graph, executable
  quote, and run-envelope contracts are verified.
- Provider canaries and rate/capability snapshots are current within their
  declared validity windows.

### Migration sequence

1. `0030_production_stage_lanes_and_attempt_extensions.sql`
2. `0031_provider_video_audio_request_extensions.sql`
3. `0032_agent_tool_grants_and_decisions.sql`
4. `0033_assets_candidates_evidence.sql`
5. `0034_narration_captions_clips_audio.sql`
6. `0035_qc_reports_defects_judges.sql`
7. `0036_edd_masters_render_segments.sql`
8. `0037_operational_metrics_alerts.sql`
9. `0038_machine_ready_qualified_review_transition.sql`
10. `0039_phase3_rls_grants_indexes.sql`

### Work packages

#### `P3-01` Trigger.dev control plane

- Extend the verified Phase 2 dispatcher/stage/attempt/lease/fence model with
  production lanes, pause/resume, repair-aware authority, and render capacity.
- Send IDs and signed URIs, never large media payloads.
- Separate provider queues and a render queue capped at three `large-1x`
  concurrent tasks.

#### `P3-02` Full provider adapter contract

- Extend the Phase 2 provider core with capability-based adapters:
  `reason`, `judge`, `gen_image`, `edit_image`, `gen_video`, `gen_speech`,
  `align_speech`, `asr`, `gen_music`, `gen_sfx`, `upscale`, `color_conform`.
- Preserve the exact authoritative request state machine; do not collapse
  retryable/terminal/cancel/late-completion states.
- Verify signed webhooks or use trusted polling.
- Claim one authorized quote-line slot before dispatch.
- Route every provider output through the Phase 2 quarantine-first ingest
  boundary before it can become an authoritative asset.
- Reconcile actual, refunded, unknown, and `billed_no_asset` costs.
- Provider API keys remain in the Vercel provider broker; no Trigger project or
  task environment contains them.
- Revalidate both the project-specific broker service identity and the
  one-attempt capability grant on every submit, poll, reconcile, and callback-
  driven continuation; neither proof is sufficient alone.

#### `P3-03` Typed agent/tool broker and prompt-injection resistance

- Extend the Phase 2 read-only broker for Monica and production specialists with
  the minimum typed side-effect tools needed by the locked run.
- Separate untrusted script, repair text, OCR, research web text, provider
  output, captions, and provider errors from trusted system/policy context.
- Enforce tool-specific permissions, idempotency, fan-out/depth/time/token/cost
  limits, and capability grants.
- Prohibit arbitrary HTTP, SQL, shell, filesystem, policy edits, budget changes,
  cross-workspace access, approval, export, or publication.
- Require deterministic server/database checks for every model-proposed ID,
  version, route, dependency, and action.

#### `P3-04` Execute the pinned story, shot, EDD, and reference graph

- Consume only the World-Locked preflight versions.
- Revalidate coverage, capability/rate freshness, graph acyclicity, canonical
  location ordering, provider reference caps, content hashes, and topological
  readiness before each downstream dispatch.
- Block downstream spend when an upstream reference fails or becomes stale.
- Replanning creates a new version and requires quote/authority reconciliation;
  it cannot mutate the locked plan silently.

#### `P3-05` Narration master and captions

- Reuse the exact accepted pre-lock narration/master clock when still current.
- Any authorized post-lock regeneration pauses and supersedes the old run
  authority, creates new narration/config/EDD/quote versions, reserves the new
  authorized envelope, creates and activates a replacement authoritative run,
  invalidates dependents, and only then permits new dispatch.
- Align locked words; use ASR only as disagreement evidence.
- Enforce duration, identity, pronunciation, monotonic timing, corruption, and
  seam checks.
- Generate captions from locked words and alignment.

#### `P3-06` Keyframes and clips

- Generate and QC keyframes before video spend.
- Route simple camera/simple subject motion to Kling 2.5 on fal.ai.
- Route camera-led motion to Kling 3.0.
- Route all other launch AI clips to Seedance.
- Generate bounded candidates/retries from the authorized plan.
- Detect face/identity drift, anatomy, deity attributes, object pop, flicker,
  captions/text, continuity, and temporal defects.

#### `P3-07` Audio design

- Arrange the pinned provenance-cleared Series score identity and motif.
- Generate/select ambience and SFX with visible-action timing.
- Mix for narration intelligibility, -14 LUFS ±1 LU, and <= -1 dBTP.
- Preserve stems and evidence.

#### `P3-08` EDD compiler and renderer

- Compile a deterministic, versioned edit decision document.
- Render on the exact digest-pinned Node/ffmpeg/font image selected in Phase 0.
- Enforce sub-7GB scratch, segment streaming, verified intermediate upload and
  deletion, 70% admission stop, 80% checkpoint/replan, and
  `RENDER_PARTITION_REQUIRED`.
- Probe and checksum every segment and final master.

#### `P3-09` Monica QC and bounded autonomous repair

- Implement deterministic QC rules first.
- Run two independent final visual judges using different model families or
  independently deployed evaluator configurations; neither receives the
  other's result before consensus.
- Treat automated verdicts as provisional.
- Create typed defects and bounded repair plans; never lower thresholds due to
  budget.
- Rerun local, boundary, dependency, scene, and full-master checks after repair.
- In migration `0038`, add the canonical Episode
  `pending_qualified_review` constraint/enum value and
  `episode.mark_machine_ready_for_qualified_review` command before this worker
  can complete a master.
- Stop at Episode state `pending_qualified_review`, run state
  `waiting_decision`, or a fail-closed blocker. Phase 3 cannot enter
  creative/final review because the exact-master qualified cultural decision
  does not exist yet.

#### `P3-10` Diagnostics and operational controls

- Build run timeline, provider/cost ledger, QC evidence viewer, dead-letter
  queue, queue/circuit status, and redacted diagnostic dashboards.
- Add alarms for queue age, disk pressure, cost anomaly, callback mismatch,
  stale lease, missing evidence, and repeated model failure.
- Implement a security-alert router with persisted delivery attempts,
  acknowledgement, retry/backoff, primary/fallback destinations, dead-receiver
  detection, and named on-call ownership.
- Cover secret exposure, spend anomaly, cultural override, RLS/auth failure
  bursts, dead-letter age, publishing attempts, callback forgery, and recovery
  checksum failure.

### Required adversarial proof

- Crash before/after every transaction/outbox/provider boundary and resume.
- Duplicate, reordered, forged, stale, and delayed callbacks cannot advance a
  newer attempt.
- Budget exhaustion blocks spend and never weakens QC.
- Provider request/quote slot uniqueness holds under concurrency.
- Circuit breakers and fallback rules never silently change voice/world/model
  identity outside policy.
- Prompt-injection corpora in script, repair rows, OCR, web sources, provider
  output, captions, and error strings cannot obtain arbitrary tools, data,
  spend, policy changes, approval, or cross-workspace scope.
- Fuzzed IDs, stale versions, cycles, huge arrays, recursive plans, fan-out, and
  depth limits fail safely.
- Reference-graph staleness and upstream failures prevent downstream spend.
- Seeded media defects map to the correct GQC rule and repair scope.
- Full fixed-fixture and segmented render canaries pass media probes.
- Disk-pressure tests exercise 70%, 80%, and partition failure.
- Deterministic verdict replay reproduces math and gates.
- Logs, diagnostics, and browser bundles pass secret/redaction scans.
- Trigger environment/bundle/runtime tests prove provider keys are absent from
  control, agent, ingest, parser, and renderer tasks.
- Every mandatory security-alert class reaches the primary route, retries, and
  falls back when the primary receiver is dead; acknowledgement is recorded.

### Exit gate

- Every `@phase3` child obligation in the machine traceability ledger is
  `verified`; later child obligations under the same parent remain
  `unimplemented`.
- Repair-room, approval, export, search, and production-readiness claims remain
  disabled until their Phase 4/deployment gates.
- A complete provider-sandbox or minimum-cost live canary reaches a review
  master with evidence and cost ledger.
- No unresolved P0/P1 from cold code/test/security review.
- Browser run monitoring and failure recovery are visually/adversarially tested.
- Commit and explicit-URL push.

### Rollback

- Pause dispatch and open provider circuits.
- Preserve inflight external correlation and ingest safe late results as stale.
- Reconcile reservations and actual/unknown billing.
- Keep generated artifacts quarantined; never promote partial work.

## 8. Phase 4 — Premiere, human approvals, repair, export, search, and collaboration

### Entry

- Phase 3 gate passes.
- A machine-eligible master in canonical Episode state
  `pending_qualified_review` and a complete evidence package can be produced.

### Migration sequence

1. `0040_master_review_approvals.sql`
2. `0041_master_cultural_decisions.sql`
3. `0042_repairs_rows_plans_candidates.sql`
4. `0043_exports_packages_downloads.sql`
5. `0044_continuity_outcomes_incidents.sql`
6. `0045_search_activity_collaboration.sql`
7. `0046_retention_deletion_backup_restore.sql`
8. `0047_phase4_rls_grants_indexes.sql`

### Work packages

#### `P4-01` Premiere and evidence review

- Present the exact machine-ready candidate to the qualified cultural reviewer
  with frame-accurate timecode and the complete source/evidence package.
- Show Monica findings, comparison evidence, cost, provenance, and version pins.
- Make provisional machine status unmistakable.
- Prevent stale browser tabs from deciding on a replaced master.

#### `P4-02` Separate cultural and creative/final decisions

- Record qualified cultural approval against the exact master, policy, source,
  evidence, and competency versions.
- After that decision is current and approved, invoke
  `episode.mark_final_review_ready` to move the Episode from
  `pending_qualified_review` to `awaiting_final_review`, set the exact review
  target, and create the creative/final work item and notification.
- Record creative/final approval separately with AAL2 and CAS.
- Enforce one current selected cultural decision and one current selected final
  approval per Episode.
- Every launch master requires both; machine QC cannot substitute.

#### `P4-03` Curated timecoded repair interface

- Provide repeatable feedback rows with start/end time, plain-language
  instruction, optional defect/category, priority, and attachments.
- Validate non-overlap only where the requested operation requires it; allow
  multiple rows at the same range.
- Detect ambiguous, unsupported, conflicting, culturally unsafe, and
  script-changing instructions and ask a constrained clarification rather than
  guessing.
- Monica compiles rows into an explicit dependency-closed repair plan and
  itemized high quote.
- `repair.confirm` uses `aal2` and CAS against the exact source
  master/EDD/config/Series Release and plan hash, creates the repair budget
  authorization and sole high-envelope reservation atomically, then enqueues
  the repair. A stale source or ceiling mismatch leaves the branch blocked.

#### `P4-04` Repair execution and candidate promotion

- Create a new candidate/master; never overwrite the base.
- Preserve synchronized A/B playback, requested versus actual repair-scope
  visualization, and rollback to the untouched base.
- Rerun full required QC and cultural eligibility.
- `repair.accept` uses `aal2`, exact source/current-master and branch CAS, and
  invokes `episode.promote_repair_candidate` atomically.
- Promotion sets the repaired master as the pending qualified-review target,
  including when repair began from `pending_qualified_review`. It supersedes
  the old pending cultural target/work item and any selected cultural decision,
  supersedes any selected creative approval, cancels unissued exports, retains
  issued packages as historical superseded artifacts, and creates exactly one
  replacement cultural-review work item and notification.
- After a new qualified cultural approval, `episode.mark_final_review_ready`
  creates the replacement creative/final work item. Accepting or promoting a
  repair candidate never approves it.

#### `P4-05` Export and download

- Package only a current approved master.
- Provide MP4, captions, stems, EDD/timeline, reports, provenance, and checksums
  according to selected package type.
- Verify checksums after upload and when issuing a short-lived download.
- Label review/approved/superseded artifacts distinctly.

#### `P4-06` Search, notifications, and concurrent teamwork

- Search Series, Episodes, script titles/metadata, characters, locations,
  statuses, creators, dates, and tags.
- Add review-ready, blocker, repair-ready, approved, failed, and export-ready
  notifications.
- Support multiple users, work claims/takeover, presence, watchers, and
  concurrent Episodes.
- Show “needs me”, “Monica working”, and “recently completed” queues.

#### `P4-07` Archive, retention, backup, and restore

- Implement reversible archive separately from deletion.
- Implement pending-deletion request, impact calculation, legal/incident holds,
  approval, signed-access revocation, provider/work cancellation, object and
  checksum verification, tombstones, search-index removal, and residual-backup
  retention/reconciliation.
- Add content-addressed critical-copy workflow toward a separate Genie Vault
  Supabase project.
- Implement restore/reconciliation drills and evidence.
- If PITR, the separate Vault project, replication, or timed restore is not
  verified, the environment remains explicit demo/non-production mode with
  provider spend, final approval, export, and owner-pilot claims disabled.

#### `P4-08` Episode outcomes and Series continuity

- After an approved/delivered Episode, generate an immutable Episode Outcome
  Proposal against the exact base continuity-state version.
- Let an authorized Series editor review, accept, reject, or defer the proposal
  with `aal2`.
- Acceptance uses CAS to create a new continuity-state version and Series
  Release draft; parallel Episodes either rebase explicitly or retain a
  documented branch/conflict.
- Later Episodes inherit only an accepted/published release, never an
  unreviewed model proposal.

#### `P4-09` Quarantine, withdrawal, and downstream revocation

- Implement master quarantine/withdrawal, approval-selection revocation,
  Episode release-blocked projection, pending export cancellation, signed URL
  expiry, and downstream reconciliation.
- Implement Series Release withdrawal with admin plus qualified cultural
  authority, `aal2`, reason/evidence, and impact analysis.
- Preserve immutable evidence and historical package identity while preventing
  new selection/export.

### Required adversarial proof

- Every Phase 4 `AC-QC-*` and `TM-*` row in `docs/traceability.md` passes its
  individually named proof; ranges are not accepted as evidence.
- Cultural and creative approval records cannot be forged, conflated, or reused
  across masters.
- Promotion resets both approval selections.
- Stale tabs, races, and replayed approval commands fail safely.
- Export rejects stale, unapproved, quarantined, corrupt, or mismatched masters.
- Repair rows survive reload, concurrency, duplicate submission, and Unicode.
- Search and Realtime never leak another workspace.
- Signed download expiry/revocation and checksum verification pass.
- Concurrent Episode Outcome Proposals cannot silently overwrite continuity.
- Quarantine/withdrawal prevents new downloads/exports and creates an auditable
  downstream reconciliation trail.
- Repair clarification, unsupported/conflicting/script-changing instructions,
  requested-versus-actual scope, synchronized A/B playback, and rollback pass.
- Empty, partial, retrying, paused, delayed, blocked, canceled, resumed, and
  complete states pass on desktop, tablet, and mobile.
- Full keyboard, reduced-motion, zoom, and screen-reader-oriented journeys pass.

### Exit gate

- Every `@phase4` child obligation in the machine traceability ledger is
  `verified`.
- Across Phases 0–4, every software obligation is `verified`;
  `failed`, `implemented_unverified`, or `unimplemented` blocks its owning gate.
- Recovery-related `deferred_external` permits only demo/non-production mode and
  blocks spend, final approval, export, production readiness, and owner pilot.
- In an isolated test harness, the full domain/browser journey passes with fake
  providers and recovery dependencies:
  sign in → create Series → create Episode → exact script → voice → look →
  world → atomic lock → production → qualified cultural decision → final
  approval or repair → promotion/re-review → export/download.
- Deployed final approval/export remain disabled until `D-05` recovery
  qualification passes.
- Independent code/test/security/visual reviews find no unresolved P0/P1.
- Commit and explicit-URL push.

### Rollback

- Disable repair/export flags independently.
- Revoke signed URLs and pending exports.
- Preserve masters, approvals, and evidence; use compensating commands rather
  than destructive updates.

## 9. Deployment, canaries, and production-readiness

### `D-01` Vercel project and environments

- Create or connect a Vercel project to the GitHub repository after the local
  production build is clean.
- Configure preview and production variables by environment.
- Protect expensive/provider routes behind server flags until live canaries
  pass.
- Verify headers, caching, max-duration assumptions, cron authentication, and
  no long media work in Vercel functions.

### `D-02` Supabase deployment

- Apply migrations through the Supabase integration or CLI.
- Run RLS/grants/advisor/policy inventory and generated-type checks.
- Configure Storage buckets, Auth redirect URLs, and Realtime publication.
- Seed only immutable reference/config data.
- Verify production project isolation from preview/test projects and credentials.

### `D-03` Trigger.dev deployment

- Deploy separate `genie-control`, `genie-agent`, and `genie-media` Trigger
  projects/environments with the secret sets in `docs/environment-contract.md`.
- Deploy tasks and queues; no Trigger project receives provider API keys.
- Verify selected project/environment, `large-1x` availability, max three render
  concurrency, task image digest, disk canary, and callback authentication.
- Attempt to read all provider-key names from every Trigger runtime and prove
  they are absent.

### `D-04` Live provider canaries

- Verify exact voice IDs and sample narration.
- Verify each enabled image/video/model route and account availability.
- Capture authenticated pricing/billing observations and update rate cards.
- Run one bounded full Episode canary after any changed route/task image.
- Run an overlapping five-Episode qualification with simple, camera-led, and
  other-motion routes, one degraded provider, queue-age/oldest-ready evidence,
  actual account concurrency/rate limits, cancellation, and recovery.
- Reconcile settled billing, candidate multipliers, retry/refund/unknown states,
  and actual generated seconds.
- Treat the first 20 complete, stratified, 90-second-equivalent
  Episode/canary records as preliminary cost evidence only.
- Before calling the production p95 cost target verified, use a predeclared
  stratified tolerance/sequential method. With a zero-breach one-sided 95%
  claim that at least 95% comply, collect at least 59 independent representative
  records; target 100+ for stable route/slice estimates. Publish the confidence
  interval and breaches rather than only an empirical percentile.

### `D-05` Recovery and independent Vault qualification

- Verify production PITR/backup configuration.
- Provision the separate Genie Vault Supabase project with independently scoped
  custom insert-only writer and offline restore authority; no running Vault
  component receives a `service_role` key.
- Verify content-addressed Storage/audit replication, checksum alarms,
  retention, least-privilege access, and inability of ordinary production roles
  to alter Vault copies.
- Compromise-test the writer role/JWT and prove it cannot update, delete,
  truncate, overwrite, or execute DDL against prior copies.
- Run a timed restore plus database/Storage/provider/Trigger/export
  reconciliation under dispatch freeze.
- Prove the launch objectives separately: production Postgres RPO ≤5 minutes
  and RTO ≤2 hours; critical Storage/audit Vault RPO ≤15 minutes and RTO ≤4
  hours; code/migrations/environment RPO at the protected commit and RTO ≤2
  hours.
- Failure or deferral keeps the app in demo/non-production mode.

### `D-06` Release evidence and handoff

- After `D-05`, run the real deployed browser journey from exact script and
  World Lock through providers, Monica, `pending_qualified_review`, exact
  qualified cultural approval, `awaiting_final_review`, separate creative/final
  approval, repair promotion/re-review where applicable, immutable export,
  signed download, revocation, and notification delivery.
- Record deployment URLs/IDs without secrets.
- Record commit SHA, migration versions, task versions, config/rubric hashes,
  canary artifacts, costs, and open external/calibration dependencies.
- Update `docs/project-state.md`, traceability, runbook, and owner test guide.
- Require every `@deployment` child obligation in the machine traceability
  ledger to be `verified` before the production-ready label.

### Canary spend policy

Live canaries never run in ordinary CI. They run only when the relevant
provider/model/rate card, adapter, render image, or release candidate changes.

| Gate | Authorization ceiling | Automatic stop |
|---|---:|---|
| Phase 2 provider/world/preflight canaries | USD 75 per environment checkpoint | USD 90 aggregate or any request >125% of its quote |
| Phase 3 full-Episode canaries | USD 50 per Episode; at most 2 per checkpoint | USD 100 checkpoint or USD 150 day |
| Five-Episode overlapping qualification | USD 250 exact aggregate high envelope | Any Episode >USD 50 or aggregate reservation/settlement breach |
| Preliminary 20-record cost corpus | USD 1,000 separately authorized program ceiling | Any unauthorized slot or unexplained cost |
| Production cost qualification | USD 2,950 for minimum 59 zero-breach records; prefer separately authorized 100-record ceiling | Any unauthorized slot, unexplained cost, statistical-policy breach, or Episode >USD 50 |

Each live run stores approver, environment, purpose, quote hash, hard ceiling,
frequency reason, kill threshold, settlement, and evidence. A blanket
development mandate does not remove per-request and per-program budget
controls.

### Software-complete vs product-calibrated

Software complete means the system and safety contracts work. It does not mean
Monica has demonstrated human-level cinematic judgment. Product-calibrated
requires the owner's 10–20 pilot Episodes followed by the predeclared
calibration and untouched holdout corpus. Until then:

- automated QC is visibly provisional;
- every release requires qualified cultural and creative/final human approval;
- uncalibrated detector/provider cells remain conservative or disabled;
- no quality claim is inferred from mocks or a single canary.

Milestones:

- `software-complete`: local/preview software proof; external provider,
  deployment, or recovery rows may be `deferred_external` only while their
  features remain disabled.
- `provider-enabled-provisional`: `D-01..D-04` route and five-Episode capacity
  proof passes; each Episode remains protected by its exact USD 50 ceiling, but
  the aggregate p95 cost target is still labelled preliminary.
- `production-ready`: `D-01..D-05`, the statistically predeclared production
  cost qualification, and every launch-blocking row are `verified`.
- `product-calibrated`: the independent human/calibration/holdout contract also
  passes.

## 10. Product calibration

### `C-01` Independent rubric calibration and holdout

- Begins only after software-complete and the owner's 10–20 pilot Episodes;
  this user-supplied corpus is an explicit external dependency.
- Freeze the predeclared sampling, annotation, adjudication, threshold-tuning,
  model/prompt/config, and leakage controls in
  `docs/qc-release-contract.md`.
- Collect at least 30 representative calibration Episodes and then 20 untouched
  holdout Episodes with qualified cultural labels and independent
  creative/cinematic labels.
- Tune only on the calibration set. Run the untouched holdout once per frozen
  rubric/model candidate; a failed holdout requires a new version and a new
  untouched holdout.
- Record exact episode/master/evidence hashes, annotator competencies,
  disagreement/adjudication, metrics by required slice, confidence intervals,
  failure analysis, and the immutable accepted rubric/config hashes.
- Set `CAL-RUBRIC-001@product_calibrated` to `verified` only when every
  normative criterion passes with complete evidence. This checkpoint never
  gates Phase 3, Phase 4, provider enablement, or software-complete; until it
  passes, Monica remains explicitly provisional and both human approvals remain
  mandatory.

## 11. Review protocol after every phase

The implementation agent prepares evidence but does not self-certify. A cold
reviewer receives only:

- current repository and authoritative design;
- phase scope and diff;
- test/evidence outputs;
- explicit claim list.

The reviewer must challenge:

- requirement coverage and hidden scope loss;
- state/transaction/idempotency correctness;
- authorization, RLS, secret, upload, webhook, cost, and abuse boundaries;
- negative-path and concurrency coverage;
- provider/media assumptions;
- UX accessibility, responsive behavior, and design fidelity;
- evidence honesty.

Severity:

- `P0`: exploitable loss, uncontrolled spend, false approval/release, data
  corruption, or inability to recover;
- `P1`: launch objective or major safety/reliability path not met;
- `P2`: material quality/maintainability/UX issue that can ship only with a
  recorded owner decision.

No phase closes with unresolved P0/P1.

## 11. Critical path and parallelism

Critical path:

```text
toolchain
  -> Supabase identity/command/RLS foundation
  -> Series/Episode
  -> exact script/look + provider/security/source foundation
  -> world + narration/shot/EDD/reference preflight
  -> exact quote + atomic World Lock/run envelope
  -> stages/outbox/Trigger + provider/media/QC/render
  -> Premiere/approval/repair/export
  -> deployment + provider/cost/capacity + recovery qualification
```

Safe parallel lanes after their shared contracts exist:

- Living Cinema components and browser fixtures;
- provider adapters behind common fakes;
- deterministic QC engines and media fixtures;
- diagnostics dashboards;
- search/read projections;
- documentation and runbooks.

Database authority, migrations, state transitions, budget claims, and final
approval semantics remain single-contract work and are not independently
invented in parallel.

## 12. Definition of done

The goal is complete only when:

- the software is built and the production build passes;
- all migrations and server tasks are versioned;
- all launch requirements have implementation and evidence links;
- all 25 product, 40 QC, and 42 threat rows have the gate-required evidence
  status; every launch-blocking row is `verified`;
- cold reviews and adversarial runtime tests have no unresolved P0/P1;
- deployed smoke, provider/capacity/cost, and recovery gates pass;
- periodic and final commits are pushed through the explicit GitHub URL;
- the user can open the deployed app, create a Series/Episode, and begin the
  human pilot without editing code.

If a deployment credential, sample corpus, provider account state, or recovery
resource is external and unavailable, the corresponding milestone remains
active and blocked; it is not reported as completed.

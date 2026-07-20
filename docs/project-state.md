# Genie Project State and Continuation Handoff

> **Live-status notice (2026-07-19):** This document preserves detailed Phase 1
> and early Phase 2 history. For the current large Phase 2 working tree, external
> state, exact stopping point, and fresh-conversation startup sequence, read
> `docs/GENIE_IMPLEMENTATION_HANDOFF_2026-07-19.md` first. If the two documents
> differ on current status, the newer handoff and verified live state control.

**Updated:** 2026-07-18
**Goal status:** active — design, plan, build, test, and prepare for Vercel
deployment end to end

This file is the continuity source for a fresh task or reviewer. Inspect the
current worktree before relying on any status below.

## 1. Non-negotiable product decisions

- Product name: **Genie by Zyra**. Main quality orchestrator: **Monica**.
- Internal multi-user studio, initially reviewed by the owner.
- Hindi narration-only 60–120 second 9:16 videos; no dialogue or lip-sync at
  launch.
- The user-supplied script is immutable. Intelligence is additive sidecar data.
- User picks narrator gender; default male.
- ElevenLabs male voice: `b0oby86k6n7Uh5LZcOBR`.
- ElevenLabs female voice: `GSdeLRB8detpjZjN63Wn`.
- 117 looks; Indian mythology selected by default; remove the AI Director
  Recommended section.
- Human preproduction decisions: lock script, choose voice, choose look, accept
  or replace character/location anchors.
- Character and location anchors support generate, inspect/edit prompt,
  regenerate, upload, accept, and version history.
- Character sheets are generated automatically after character acceptance.
- After world lock, production is autonomous until final review.
- Final repair uses timecoded/ranged structured feedback rows plus curated
  Monica conversation.
- Multiple users can run multiple Episodes concurrently.
- Series is a versioned creative world; later Episodes inherit exact released
  look/character/location/narrator/sound versions.
- Video route: Kling 2.5 for simple camera/simple subject motion; Kling 3 for
  camera-led motion; Seedance for other motion.
- Quality first, reliability second, cost third, speed fourth.
- Target production cost below USD 40, maximum USD 50 without explicit top-up;
  provider billing may still include failed/refused calls and is recorded.
- Supabase stores application data, media, diagnostics, QC, cost, and audit.
  Sentry is excluded.
- Vercel project `content-genie` is linked to GitHub `main`; the canonical URL
  is `https://content-genie-three.vercel.app/`.
- The first 10–20 sample scripts/Episodes are a post-build pilot/tuning set, not
  a software-implementation prerequisite or sufficient calibration proof.
- Product-calibrated status requires at least 30 calibration plus 20 untouched
  holdout Episodes and the detector/per-slice gates in the QC contract.

## 2. Repository and Git

- Workspace: `C:\Work\Code\zyrastudio`
- GitHub: `https://github.com/toolsatZyra/content-genie.git`
- Branch: `main`
- Final Phase 1 code candidate:
  `7706117bf2ee1b17d115faf14f46a498d1d3c9b0`
- Phase 1 closure evidence anchor:
  `70119839059ea51427e97cb48d675569197484b1`
- Last pushed checkpoint before Phase 2:
  `16fab9e2617f7d3b8c458e74557036581d8e9a7f`.
- The repository intentionally has no persistent `origin`.
- Push with the explicit URL, for example:

```powershell
git push https://github.com/toolsatZyra/content-genie.git main
```

- Preserve and do not accidentally commit the owner workbook:
  `docs/Provider and Infrastructure Inventory.xlsx`.
- Never commit `.env.local`.

## 3. Available local configuration

The following variable names are present and non-empty in `.env.local`; values
must never be copied into documentation or logs:

- `ANTHROPIC_API_KEY`
- `FAL_KEY`
- `GOOGLE_GENAI_API_KEY`
- `OPENAI_API_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ELEVENLABS_API_KEY`
- `SARVAM_API_KEY`
- `TRIGGER_SECRET_KEY`

Known environment gaps/state:

- Supabase CLI access is authenticated to project `content-genie`
  (`fnxztrqsqucojcvabjhk`); the connected Supabase workflow must be used for
  database work.
- Local Docker is unavailable, so database verification must use isolated
  remote/test paths rather than assuming a local Supabase stack.
- Vercel project ID: `prj_aSnq2s4OL3hw3e8NX29dLPXDFe3g`; team:
  `team_pwTpdWGJnbaaUJHUGUtCMxVG`. The Git-linked deployment exists, but
  production runtime variables and the canonical deployment smoke are still
  pending.

## 4. Current design artifacts

- `docs/design.md` — authoritative product and solution contract.
- `DESIGN.md` — Living Cinema UI source of truth.
- `docs/genie-ui/` — current interactive design simulation.
- `docs/provider-contract.md` — provider routing, freshness, cost, and
  infrastructure contract.
- `docs/cost-envelope.md` — dated 60/90/120-second feasibility BOM,
  reservations, and production proof obligations.
- `docs/evidence/provider-snapshots/` — design-time official-documentation
  observations; not authenticated account canaries.
- `docs/qc-release-contract.md` — stage-specific QC and release contract.
- `docs/state-and-data-contract.md` — state, transaction, and concurrency
  contract.
- `docs/threat-model.md` — security boundaries and mitigations.
- `docs/series-and-cultural-policy.md` — source, tradition, continuity, and
  release-authority policy.
- `docs/reference-porting-map.md` — verified AI Director porting map.
- `docs/sdlc.md` — phased adversarial SDLC.
- `docs/implementation-plan.md` — authoritative work packages and phase gates.
- `docs/traceability.md` — human-readable requirement/checkpoint ledger.
- `reference/acceptance/traceability-plan.v1.json` — reproducibly generated
  machine acceptance plan.
- `reference/acceptance/traceability-evidence.v1.json` — durable evidence
  source; Phase 0 and Phase 1 checkpoints are verified.
- `docs/implementation-plan-adversarial-review.md` — independent plan-gate
  report.
- `reference/rubric-config/` — research rubric inputs, not sufficient alone as
  runtime release logic.
- `docs/archive/research-design-2026-07-10.md` — superseded research design.
- `docs/agent-flow/` — superseded discovery prototype.

## 5. Design review findings being enforced

- Existing rubric JSON contradicts launch needs in places; the stage-specific
  QC contract controls applicability and severity.
- Script quality scoring is advisory because Genie cannot rewrite the input.
  Policy eligibility may still block production without changing the script.
- Monica is not the human/cultural/legal release authority.
- Final release remains human-approved until benchmark calibration passes.
- Series Release publication and Episode pinning are atomic.
- World Lock is a version-bound `aal2` Series-editor authorization, and Episode
  Outcome Proposals commit continuity only by CAS into a later release.
- Qualified cultural approval and creative/final approval are separate records.
- Source Review, reviewer competency/recusal, master quarantine/withdrawal, and
  export revocation are explicit state.
- Launch rendering uses a pinned Trigger.dev Cloud ffmpeg task queue with
  single-attempt capability grants; media tasks receive no service-role key.
- Production Postgres target is RPO ≤5 minutes/RTO ≤2 hours. Critical media and
  audit copies use a separately restorable `Genie Vault` Supabase project.
- Claims use leases/fencing; final approvals and repair promotions use
  compare-and-swap.
- Provider retries/callbacks are effectively-once commits, not an impossible
  exactly-once network claim.
- Reservations limit further authorized spend; they do not guarantee invoice
  cost.
- The UI cannot fabricate percentages, ETAs, QC scores, provider output, or
  progress.
- C2PA is feature-gated until signing credentials and cryptographic tests exist.

## 6. Immediate next sequence

Completed gates:

- design: independent cold retest PASS with no P0/P1, deterministic checks and
  interactive browser smoke passed, Word review artifact QA'd and pushed;
- implementation plan: two independent frozen retests PASS with no P0/P1;
- generated acceptance ledger: 207 requirements, 280 checkpoint obligations,
  49 valid work packages, exact verification/checkpoint matching, and
  adversarial rejection of missing, stale, byte-different, or
  definition-mismatched proof. Byte authenticity alone is not semantic proof.
  Typed checkpoint JSON authenticates structure and committed hashes only; it
  does not authenticate GitHub, Supabase, command execution, or reviewer
  identity. Phase 2 and later promotion to `verified` therefore remains
  fail-closed until an external cryptographic provenance gate is implemented;
- Phase 0 foundation: exact-SHA CI and three independent adversarial reviews
  passed; six Phase 0 obligations are evidence-verified;
- Phase 1 identity/data/Studio: 13 migrations, 104 pgTAP assertions, disposable
  and persistent-preview live gates, 10 browser journeys, and exact-SHA
  security/test/visual reviews passed; 20 Phase 1 obligations are
  evidence-verified.

Immediate next sequence:

1. Close the Phase 2 zero-spend checkpoint: exact browser-script integrity,
   pinned narrator identities, the deterministic 117-look pack, Script/Voice/
   Look creation UI, migration parity, and live preview-database tests.
2. Resolve the remaining Phase 2 contract gates before live provider work:
   explicit micro-versus-production spend authority, complete schema/state/
   command contracts, the Preflight readiness-surface wording, and a narrow
   bootstrap-canary authority.
3. Implement `P2-04` through `P2-13`: durable preflight, read-only agent
   boundary, provider broker, quarantine ingest, World studio, cultural/sound/
   planning preflight, exact quote, and atomic World Lock. Production video
   dispatch remains impossible in Phase 2.
4. Run the complete Phase 2 exact-SHA database/security/media/UI gate and fresh
   independent cold reviews before promoting Phase 2 migrations to production.
5. Continue Phases 3–4 with the same evidence and adversarial gates, then
   complete launch and film-quality calibration.

Current Phase 2 checkpoint facts:

- The long-lived Supabase preview project `iuzijmzcimtwyowhwinu` contains the
  exact 14-migration Phase 2 chain through
  `20260717121612_phase2_release_creative_identity_truth.sql`. Both managed
  database contracts pass there: Phase 1 is 104/104 and Phase 2 is 158/158.
  Compact coordinate-map v2, exact Series-release narrator/look/voice inheritance,
  withdrawn-voice fail-closed Episode creation, and lifecycle creative locks are
  therefore exercised on the persistent preview. This is preview validation, not
  promotion evidence: a passing live artifact bound to the exact frozen tree and
  fresh cold reviews are still required. Production still contains Phase 1 only.
- A predecessor compact-v2 tree passed a disposable run on branch
  `0c0cb538-1f41-4437-b567-914cbedbacc0` / `cjcnpvsoubzrmwmdhxtc`, but the next
  cold review rejected that fingerprint for ambiguous RPC outcomes, unsafe
  long-lived v1 size migration, unbound evidence, incomplete cleanup/locking, and
  UI focus/accessibility findings. That run is diagnostic history only. The
  live harness writes a running artifact before work, binds the staged Git tree
  and source/migration/test digests, reconstructs the exact deployed v1 contract,
  upgrades hash-bound 8,193- and 65,536-byte legacy rows, and records complete
  TAP/boundary/persistence/cleanup evidence. `.tmp/artifacts/phase1-live-suite.json`
  is current gate truth only when its candidate tree and digests match the frozen
  review tree and every outcome and cleanup field passes.
- The passing artifact for tree `ebeb9702f0407d410776dd9922d3f7142064c721`
  proved the then-current disposable gate. The third cold-review round rejected
  that tree for attestation-cleanup, final evidence-binding, credential-transport,
  URL-resume gating, focus, target-size, announcement, and documentation findings.
  The resulting remediation changed the tree, so that artifact is historical and
  must be regenerated after the replacement candidate is frozen; it is not current
  proof for this candidate.
- The replacement artifact for tree
  `7c40ce0f835d63cf5a96c9ed2cc11723ed354fd6` passed the complete disposable
  replay, and its fresh acceptance and UI reviews accepted the candidate. The
  fourth security review nevertheless rejected it because Windows inherited
  ACLs defeated the claimed owner-only temporary credential mode, and malformed
  narrator gender became an unknown `503` instead of a definitive `400`. The
  private-runtime and validation remediation again changes the tree, so that
  artifact is historical and another exact-tree replay and fresh review set are
  required.
- The subsequent artifact for tree
  `dc39fa6eb32cfa5b712660f834ca70586dd35833` passed the complete local and
  disposable replay, and its fresh acceptance reviewer accepted it. The fifth
  security and UI reviews rejected that exact fingerprint: credential children
  were still below a broadly mutable workspace parent, the long live execution
  still read a mutable worktree, cleanup accepted a broad prefix and branch name
  or ID, the automatically focused chamber heading had an effectively invisible
  outline, and keyboard toast dismissal lost focus. That artifact is historical.
  The replacement candidate uses a trusted per-user runtime root, exact purpose
  prefixes and suffixes, exact branch name-and-ID cleanup, a sealed staged-index
  execution snapshot, and explicit chamber/toast focus repair. It requires a new
  exact-tree replay and fresh review set.
- The next artifact for tree
  `af1096e56f84e9ea17c6f2b24de95d184214c3c1` passed all local gates and the
  complete disposable replay; its independent UI reviewer accepted it. The
  sixth acceptance and security reviews still rejected that fingerprint for
  exact-CRLF undo loss, asymmetric branch identity handling, mutable linked
  dependencies, candidate exposure to production control credentials,
  insufficient parent evidence validation, and path-only runtime cleanup. That
  artifact is historical. The replacement v3 launcher owns branch lifecycle and
  final evidence, gives the candidate only disposable credentials, installs an
  offline frozen independent dependency tree, and binds runtime cleanup to the
  created filesystem object. It requires a new replay and review set.
- The first v3 launcher replay for tree
  `0f36c4cb3a0fb7aeb7e9324891c4f9e673c47754` failed safely before pgTAP: the
  direct Postgres adapter returned one rowset per SQL statement, while the
  predecessor assertion expected the former Management API's terminal rowset.
  Exact branch deletion, dependency revalidation, and snapshot cleanup still
  passed. A tested fail-closed normalizer now selects the terminal rowset and
  rejects malformed shapes. The fix changes the tree and requires another full
  gate and disposable replay.
- The next v3 replay for tree
  `2bceaea8cee658ab5bb3bd795955b6083ee03ddf` passed both managed pgTAP
  suites (104/104 and 84/84), schema lint, the authentic coordinate upgrade,
  the forward/rollback drill, and both live browser scenarios. It then failed
  safely in the candidate persistence verifier because the direct driver
  represented a bigint aggregate version as canonical decimal string `"4"`
  rather than number `4`. The trusted parent still deleted the exact branch,
  observed three consecutive absence snapshots, revalidated all 24,413
  dependency entries, removed the snapshot, and proved production exclusion;
  the Supabase connector independently showed only `main` and the existing
  `genie-phase1-dev` branch afterward. A strict safe-integer normalizer now
  accepts only JavaScript safe integers or canonical decimal strings and rejects
  ambiguous or unsafe shapes. That fix changes the tree and requires another
  full gate and disposable replay.
- The following replay for tree
  `b4d543b3d33ae6aa3edaf51d66174ea0c2cb660e` reached Phase 2 migration
  application, then Supabase CLI exited nonzero solely because its PostHog
  telemetry client timed out during shutdown after the migrations were listed
  as applied. The trusted parent again deleted the exact branch, confirmed
  three absence snapshots, revalidated the dependency tree, removed the
  snapshot, and proved production exclusion; the connector independently
  confirmed no disposable branch remained. CLI completion-unknown
  classification now recognizes only that exact telemetry-shutdown signature,
  while any deterministic non-transient SQLSTATE takes precedence even when
  transient telemetry or HTTP noise is also present. This policy change creates
  another tree and requires a fresh full gate and disposable replay.
- The next replay for tree
  `87fff498fc53cd6ad67d21919fbd0cc0596778c1` passed the complete
  candidate suite, both pgTAP suites, both live browser scenarios, persistence
  verification, and candidate-side binding revalidation. The trusted parent
  nevertheless rejected the final artifact because it compared the
  independently equal candidate-binding objects with order-sensitive
  `JSON.stringify`; the candidate's duplicate `snapshotSeal` declaration had
  retained a different insertion position. Exact branch deletion, three
  absence snapshots, dependency revalidation, snapshot cleanup, and production
  exclusion still passed. The duplicate declaration is removed and a tested
  order-independent closed-schema validator now checks exact top-level and
  nested binding, credential, pgTAP, boundary, and persistence shapes plus
  their terminal values. Hostile extra-field, digest, cleanup, and outcome
  mutations fail closed. The fix changes the tree and requires a fresh full
  gate and disposable replay.
- Remote pgTAP runs over the disposable branch's direct PostgreSQL connection;
  only the trusted parent launcher may use the Supabase Management API token.
  The Supabase CLI's remote `test db` path still requires unavailable local
  Docker. The hardened harness injects exactly one `finish(true)`, rejects any
  `not ok` or `Bail out!`, and requires one exact plan plus the complete ordered
  assertion sequence `1..N`. Hostile local fixtures prove that an earlier
  failure followed by a successful final assertion is rejected. Dollar-quote
  recognition also rejects transaction control hidden after legal unquoted
  identifier dollar characters.
- Before any direct-connection mutation, the database harness validates the
  branch-shaped URL, creates a randomized nonce through the branch Management
  API, reads it through the exact PostgreSQL URL, and proves the nonce table is
  absent from production. It retries only enumerated transient failures,
  deletes only when the randomized branch's exact ID and name both match,
  confirms that exact tuple is absent, requires the full polling window when
  creation returned no ID,
  records that confirmation, and removes generated credential/boundary files in
  `finally`. PostgreSQL and browser credentials are written only inside a newly
  randomized private directory below a trusted per-user runtime root: Windows
  verifies that every parent denies mutation authority to untrusted principals,
  removes child inheritance, and verifies one non-inherited current-user rule on
  both directory and file; POSIX verifies a safe root, owner identity, and exact
  `0700`/`0600` modes. Exact purpose prefixes plus six-character random suffixes
  bind creation and cleanup, while device/inode/birth identity binds cleanup to
  the actual created object. Broad-permission, broad-prefix, same-path object
  replacement, and residual-directory mutations fail closed. The disposable
  suite executes from a randomized read-only export of the staged Git index, with
  only named build-output directories writable. Before sealing, the parent
  installs dependencies offline from the frozen lockfile as independent copies,
  rejects shared hard links and escaping links, binds the complete dependency
  tree and pinned Supabase CLI digests, and verifies the tree again after the run.
  Candidate evidence is snapshot-local; only the parent publishes the closed-
  schema v3 artifact after independently recomputing every candidate digest.
  Supabase children invoke the repository-pinned CLI entrypoint directly through
  Node; `pnpm exec` is structurally rejected inside the sealed tree because its
  dependency self-check may attempt an install and a root-level temporary write.
  Exact resolver `ENOTFOUND` codes on harness-owned fixed-endpoint calls and the
  CLI's branch-operation `TransportError` receive bounded retries; arbitrary
  DNS/error text and deterministic authorization or schema failures do not.
- Supabase security advice has no error-level findings. Its 11 warnings identify
  intentionally authenticated `SECURITY DEFINER` command RPCs; each command
  pins an empty `search_path`, rejects a missing `auth.uid()`, validates the
  current session and active workspace membership, and is covered by RLS/RPC
  negative tests. The 73 Phase 2 performance notices are informational
  foreign-key/index/connection telemetry, with no performance warning or error.
- Script locking preserves exact UTF-8 bytes and raw text and binds a fresh
  single-use, server-identified coordinate attestation to the idempotency key,
  raw/processing hashes, exact canonical JSONB map hash, and runtime evidence.
  Issuance and command outcomes share a fail-closed revocation `finally`, including
  a lost issuance response. The trusted server runtime remains the UAX #29
  authority. Compact map v2 stores exact-key
  `{v,c,r,p,s}` envelopes with positional scalar/byte/grapheme indexes and
  coalesced mapping tuples; PostgreSQL rejects hostile tuple types/arity/order,
  recomputes scalar UTF-16/UTF-8 offsets and normalization reasons, requires
  strict grapheme and segment coverage, and verifies the exact map hash. After
  256 detailed reason transitions, v2 uses one full-range reason-4 segment to
  bound work. Full raw/processing indexes remain available, but local reason
  resolution inside that segment is intentionally unavailable. The browser and
  database new-write limit remains 8,192 UTF-8 bytes and the PostgreSQL map
  ceiling remains 8 MiB. Explicit policy version 1 preserves only authenticated
  predecessor rows from 8,193 through 65,536 bytes; all inserts are forced to
  policy version 2 and the 8,192-byte cap. Local and pgTAP regressions include
  CR-heavy, alternating, and grandfathered semantic envelopes. The authoritative
  PostgreSQL result is whatever the exact-tree bound artifact records; results from
  another tree are historical only.
- Voice verification is fail-closed in the zero-spend slice: the supplied male
  and female ElevenLabs identities are pinned, but neither can be marked
  verified from caller-authored metadata. Only an authenticated provider
  receipt may open that later canary path.
- Invalid narrator-gender payloads are definitive command-validation failures;
  they cannot fall through to the retryable unknown-outcome path.
- The repository owns all 117 look previews and a versioned manifest. Generation
  policy verifies every preview hash, seed SQL, manifest hash, source-catalog
  hash, and pinned AI Director repository/commit/catalog provenance.
- Local test counts and coverage are candidate-bound evidence, not durable
  constants. Read them from the exact-tree gate record; selected-module coverage
  is not a whole-repository or whole-component coverage claim.
- Uploaded-script files remain intentionally disabled until the quarantine
  boundary in `P2-07`; browser text is the only current script-lock source.
- No Phase 2 provider generation, voice canary, or production-video request has
  been made. Closure requires the exact-tree staged gate, passing bound artifact,
  and fresh independent cold reviews. Only the implemented
  pieces of the `P2-01`–`P2-03` partial checkpoint may be described as
  `implemented_unverified`; the authoritative Phase 2 ledger remains
  `unimplemented` while later mapped Phase 2 work is unfinished. External
  authenticated provenance is additionally required before any Phase 2
  obligation may become `verified`.

## 7. Verification standard

Do not call the project complete from intent or documentation. Completion
requires requirement-by-requirement current evidence for code, schema,
permissions, provider contracts, durable workflows, media artifacts, UI states,
adversarial tests, build, and deployment smoke behavior. Live film-quality
calibration remains explicitly separate from software completion until the
pilot, accumulated benchmark, and independent holdout gates pass.

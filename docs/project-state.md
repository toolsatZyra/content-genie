# Genie Project State and Continuation Handoff

**Updated:** 2026-07-17  
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
  adversarial rejection of stale or fabricated proof;
- Phase 0 foundation: exact-SHA CI and three independent adversarial reviews
  passed; six Phase 0 obligations are evidence-verified;
- Phase 1 identity/data/Studio: 13 migrations, 104 pgTAP assertions, disposable
  and persistent-preview live gates, 10 browser journeys, and exact-SHA
  security/test/visual reviews passed; 20 Phase 1 obligations are
  evidence-verified.

Immediate next sequence:

1. Regenerate and close the Phase 1 evidence checkpoint.
2. Promote the reviewed Phase 1 migration branch to the production Supabase
   project and verify schema, RLS, lint, and security advisors.
3. Configure the linked Vercel project with production-safe Phase 1 variables
   and all future-feature gates disabled; smoke the canonical deployment.
4. Implement Phase 2 immutable script ingestion, 117-look registry, world
   anchors, provider preflight, and atomic World Lock.
5. Continue Phases 3–4 with the same exact-SHA evidence and independent
   adversarial gates, then complete launch and film-quality calibration.

## 7. Verification standard

Do not call the project complete from intent or documentation. Completion
requires requirement-by-requirement current evidence for code, schema,
permissions, provider contracts, durable workflows, media artifacts, UI states,
adversarial tests, build, and deployment smoke behavior. Live film-quality
calibration remains explicitly separate from software completion until the
pilot, accumulated benchmark, and independent holdout gates pass.

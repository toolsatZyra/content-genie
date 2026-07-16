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
- Vercel will build from GitHub after the owner creates/links the project.
- The first 10–20 sample scripts/Episodes are a post-build pilot/tuning set, not
  a software-implementation prerequisite or sufficient calibration proof.
- Product-calibrated status requires at least 30 calibration plus 20 untouched
  holdout Episodes and the detector/per-slice gates in the QC contract.

## 2. Repository and Git

- Workspace: `C:\Work\Code\zyrastudio`
- GitHub: `https://github.com/toolsatZyra/content-genie.git`
- Branch: `main`
- Last pushed checkpoint at time of this update:
  `453b6a9 design(ui): add Living Cinema approval prototype`
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

- Supabase MCP currently requests authentication.
- A global Supabase CLI was not found.
- Vercel CLI/project link is not configured; this is expected.
- The owner will create/link the Vercel project after the repository is ready.

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

Completed design gate:

- independent cold retest: PASS with zero P0/P1/P2;
- deterministic design/rubric/provider checks: PASS;
- desktop/mobile browser, overflow, console, World Lock and repair-state smoke:
  PASS;
- Word review artifact generated and visually/structurally QA'd.

Immediate next sequence:

1. Commit and push the design checkpoint.
2. Create `docs/implementation-plan.md`, `docs/traceability.md`, environment
   contract, migration plan, and verification matrix.
3. Run a cold plan review, revise, commit, and push.
4. Bootstrap and implement Phases 1–4, with an independent test/code review and
   adversarial runtime pass after each phase.
5. Ship the deployment runbook and Vercel-ready repository.

## 7. Verification standard

Do not call the project complete from intent or documentation. Completion
requires requirement-by-requirement current evidence for code, schema,
permissions, provider contracts, durable workflows, media artifacts, UI states,
adversarial tests, build, and deployment smoke behavior. Live film-quality
calibration remains explicitly separate from software completion until the
pilot, accumulated benchmark, and independent holdout gates pass.

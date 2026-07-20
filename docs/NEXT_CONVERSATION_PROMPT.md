# Paste this into a new conversation in the same Genie project

Continue the existing active goal: design, implement, test, deploy, and prepare
Genie by Zyra end to end through Phases 2, 3, and 4, including each phase gate,
one independent adversarial review at the end of each phase, fixes, re-gating,
explicit GitHub pushes, automatic Vercel deployment verification, and final
software-complete proof. Do not redefine success around the current Phase 2
slice and do not stop for routine approval.

You are in the same local project and must continue the existing dirty
worktree. Do not create a clean worktree, do not fork the old chat history, and
do not discard or overwrite uncommitted work.

Before changing anything, read these files completely in this order:

1. `AGENTS.md`
2. `docs/GENIE_IMPLEMENTATION_HANDOFF_2026-07-19.md`
3. Phase 2 and the review protocol in `docs/implementation-plan.md`
4. Phase 2 in `docs/verification-matrix.md`
5. `docs/sdlc.md`
6. The relevant contracts referenced by the handoff when a decision is
   ambiguous

Treat the current worktree and external service state as authoritative. Run the
fresh-conversation startup audit in handoff section 13. Update the handoff if
live evidence has legitimately advanced beyond it.

The transactional database checkpoint is closed. The narrowed preview runner
and all three current Phase 2 pgTAP suites pass against
`iuzijmzcimtwyowhwinu`: provider/secure ingest 63/63,
world/cultural/transactional World Lock 52/52, and executable plan/quote/
terminal feedback 45/45. The latest preview migration is
`phase2_terminal_feedback_summary_disambiguation`; production intentionally has
no Phase 2 migration. Formatting, lint, integration 5/5, type checking, the
117-look generated-asset gate, production-env/secretless boot, security,
bundle, licence, and high-severity dependency gates are green. The conclusive
unit run passes 77 files/449 tests. Coverage is 96.87% statements, 94.05%
branches, 100% functions, and 98.03% lines. The complete RLS/policy composite
passes with the frozen trusted harness covering all 84 Phase 2 migrations and
five pgTAP suites. The canary build, acceptance-structure gate, and 828-component
SBOM pass. The five focused browser regressions for four stale accessible-name
locators and one toast/sticky-tray collision pass; the final complete 54-test
browser run remains part of the frozen-candidate gate. Continue with the
`P2-01`-`P2-14` and `V-P2-001`-`V-P2-034` requirement/evidence audit, close any
gaps, then run the complete regression batch. Fix failures in coherent batches.

Complete every remaining `P2-01`–`P2-14` and `V-P2-001`–`V-P2-034` obligation.
Batch routine deterministic testing after coherent changes. Only after the
complete Phase 2 local/database/browser/security/media/build/preview/live gate
passes, run one independent context-minimized adversarial Phase 2 review. Fix
all correctness findings, rerun the complete affected gate, then commit and
push `main` explicitly to
`https://github.com/toolsatZyra/content-genie.git`. Verify the automatic
deployment at `https://content-genie-three.vercel.app/`; do not use the Vercel
browser for routine deployment.

After Phase 2, update the handoff and proceed autonomously through Phases 3 and
4 with the same phase-level review discipline. Preserve all product invariants,
especially the immutable user script, exact voice/look/world identities,
cultural authority, secure provider boundary, USD 50 authority ceiling,
cinematic quality objective, durable concurrency, Monica QC/repair, and final
human approval. Keep software-complete separate from the later owner-supplied
10–20 Episode pilot and the larger calibration/holdout gate.

Never stage or commit `.env.local` or
`docs/Provider and Infrastructure Inventory.xlsx`. Do not add a persistent Git
origin. Do not promote Phase 2 migrations to production before the gate. Do not
leave a persistent dev server running. Keep the active goal intact until the
full requested end state is proven.

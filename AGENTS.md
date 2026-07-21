# Genie repository instructions

Read `docs/GENIE_IMPLEMENTATION_HANDOFF_2026-07-19.md` before substantive
work. It is the current implementation handoff. Inspect the live worktree and
external state before relying on any status claim in a document.

## Product invariants

- The user-supplied script is immutable. All analysis, timing, shot planning,
  pronunciation, cultural notes, and production data are additive sidecars.
- Launch output is Hindi, narration-only, 60–120 seconds, vertical 9:16, with
  no dialogue or lip-sync.
- Genie has exactly 117 looks. `glowing-divine-realism` is the default Indian
  mythology look.
- Narrator gender is user-selected and defaults to male. Do not silently
  substitute a voice.
- Quality order is cinematic quality, reliability, cost, then speed. During the
  owner-operated developer MVP, production records forecast and actual cost but
  does not pause when an Episode exceeds USD 50. Re-establish a cap only after
  the owner reviews several days of real Episode cost evidence and explicitly
  selects one for wider use.
- After World Lock, production is autonomous until final review. Human review
  remains the release authority until the calibration contract is satisfied.

## Engineering and release rules

- Follow `docs/implementation-plan.md`, `docs/sdlc.md`,
  `docs/verification-matrix.md`, and `docs/qc-release-contract.md`.
- Batch deterministic checks after coherent implementation batches. Run one
  independent adversarial review at the end of each phase, then fix findings
  and re-run the relevant complete gate. Do not run adversarial reviews after
  every granular task or batch.
- Never describe a phase as complete from implementation intent or a partial
  test. Require the phase exit evidence specified in the implementation plan.
- Preserve the user-owned file
  `docs/Provider and Infrastructure Inventory.xlsx`; never stage or commit it.
- Never commit `.env.local`, temporary credentials, provider secrets, private
  signing keys, or `.tmp` evidence containing secrets.
- The repository intentionally has no persistent Git `origin`. Push `main`
  explicitly to `https://github.com/toolsatZyra/content-genie.git` only after a
  phase gate passes.
- Vercel deploys from GitHub `main`. Do not use a Vercel browser session for
  routine deployment. Verify the public URL after a successful push.
- Do not leave a persistent development server running. Start bounded test
  servers only through repository test runners and ensure they are stopped.
- Use Supabase preview `iuzijmzcimtwyowhwinu` for Phase 2 validation. Do not
  promote Phase 2 migrations to production `fnxztrqsqucojcvabjhk` before the
  complete Phase 2 gate and independent adversarial review pass.

## Working style

- Prefer the current worktree, database state, test output, and provider
  receipts over chat recollection.
- Use `apply_patch` for hand-written file changes.
- Use `rg` or `rg --files` for repository search.
- Keep dynamic progress in the current handoff rather than expanding this file
  with transient debugging history.

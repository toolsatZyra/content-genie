# Genie traceability summary

**Status:** Implementation-plan gate passed
**Authoritative ledger:** `docs/traceability.md`

This file is a compact routing summary. It is not an evidence ledger and may
not be used to pass a gate. The generated
`reference/acceptance/traceability-plan.v1.json` contains all 207 requirements
and phase-specific children; durable status/evidence is sourced from
`reference/acceptance/traceability-evidence.v1.json`.

## Product routing

| Requirement area | Design heading | First implementation owner |
|---|---|---|
| Exact script and narration-only profile | `docs/design.md` — Launch scope; Script integrity | `P2-01`, `P2-11`, `P3-05` |
| Voice, look, world, temple/source evidence | `docs/design.md` — S2 Voice; S3 Look; S4 World | `P2-02`, `P2-03`, `P2-07..11` |
| Durable preflight, provider security, and pre-lock spend | provider/threat/cost contracts | `P2-04..07` |
| Story, shot, EDD, reference graph, machine plan evaluation | `docs/design.md` — S5 Story, rhythm, sound, and shot planning | `P2-05`, `P2-11` |
| Exact quote and atomic Series Release/config/run World Lock | state/data contract — Series/Episode commands | `P2-12`, `P2-13` |
| Creation-flow UI through World Lock | `docs/design.md` — S1..S5 | `P2-14` |
| Durable production and Monica | `docs/design.md` — Monica and the agent system; Media production pipeline | `P3-01..10` |
| Premiere, qualified cultural review, separate creative approval, repair, export | `docs/design.md` — S11 Premiere, repair, export; Monica Repair Room | `P4-01..05` |
| Search, collaboration, continuity outcomes | `docs/design.md` — Concurrent work; Search, notifications, library, and exports | `P1-03..05`, `P4-06`, `P4-08` |
| Retention, withdrawal, recovery | state/data and threat recovery contracts | `P4-07`, `P4-09`, `D-05` |
| Provider/cost/capacity qualification | provider and cost contracts | `D-03`, `D-04` |
| Independent cinematic/QC calibration and untouched holdout | QC calibration contract | `C-01` |

## Gate routing

| Gate | Evidence rule |
|---|---|
| Phase 0 | Only Phase 0 child obligations must be `verified`; future features remain disabled |
| Phase 1 | Every Phase 1 child obligation must be `verified`; no future feature is counted as tested |
| Phase 2 | Every Phase 2 child obligation must be `verified`; no production-video dispatch occurs |
| Phase 3 | Every Phase 3 child obligation must be `verified`; approvals/export remain disabled |
| Phase 4 | Every Phase 4 software child obligation must be `verified` |
| Provider-enabled | Deployment/provider/cost/capacity child obligations must be `verified` |
| Production-ready | Recovery/Vault and every launch-blocking child obligation must be `verified` |
| Product-calibrated | Human benchmark, calibration, and holdout contracts pass |

`failed` and `unimplemented`/`implemented_unverified` always block the gate
that owns the child obligation. `deferred_external` permits only a named
non-production milestone with the affected feature disabled.

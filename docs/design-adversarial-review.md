# Genie End-to-End Design Adversarial Review

**Review date:** 2026-07-17  
**Scope:** product, UX, film pipeline, providers, cost, cultural authority,
quality/release, state/data, security, recovery, deployment, and SDLC  
**Method:** two cold reviews by an independent agent without the design author's
working context, plus deterministic document/rubric checks and a short-lived
desktop/mobile browser pass  
**Gate:** **PASS** — zero unresolved P0, P1, or P2 findings

## 1. Executive assessment

The first cold gate correctly returned **FAIL** with no P0 findings, seventeen
P1 design blockers, and seven P2 corrections. The strongest parts of the
original package were its creative ambition, immutable-script intent, staged QC
model, versioned Series concept, and refusal to make Monica a human authority.
The failure was implementability: several normative documents and the prototype
could not all be true at once.

The revised package does not waive those findings. It resolves them through
explicit authority records, state machines, provider evidence status, a worked
cost envelope, a concrete rendering boundary, independently restorable backups,
stricter calibration vocabulary, cross-runtime Hindi span semantics, and a
prototype that exposes the mandatory gates.

## 2. First-gate P1 findings and resolutions

| # | Cold finding | Resolution in the revised design | Verification |
|---:|---|---|---|
| 1 | First-Series publication bypassed authorization | World Lock is an internal Series seal with a dedicated `series.release.publish` permission, current `aal2`, exact candidate hash, explicit approve/deny decision, and serializable release/config/run transaction | `docs/design.md` §3.2; `docs/state-and-data-contract.md` §§4.3, 5.2; prototype World authorization |
| 2 | Premiere could not record qualified cultural approval | Cultural approval is a separate immutable decision from creative/final approval. One qualified person may perform both, but two records bind the exact master/evidence versions | `docs/design.md` S11; QC §§11.3–12; state §§4.1, 4.9; prototype approval ledger |
| 3 | World acceptance skipped sheets/reference/source/rights/cultural readiness | World readiness now requires character sheets, reference packs, deity/temple manifests, Source Review, rights classifications, and machine cultural preflight before publication/autonomy | design S4; state §§4.1–4.3; QC `GQC-WORLD-008`; prototype prerequisite ledger |
| 4 | USD 40/50 target had no worked BOM or pre-enqueue quote | Added dated 60/90/120-second low/expected/high BOM, route and candidate assumptions, upscale and non-video allowances, per-request billing quantum/minimum/modifier rows, per-shot retry slots, full-high-envelope reservation, hard-ceiling check, and top-up behavior | `docs/cost-envelope.md`; provider §6; design §§S5, 18; prototype quote/authorization |
| 5 | Repair Plan did not meet its execution contract | Rows validate nonempty bounded ranges; unsupported, contradictory, ambiguous, and script-changing requests block/clarify; the plan freezes dependency closure, source versions, ordered interpretations, task DAG, low/expected/high quote, hard ceiling, and canonical hash | design §9; state §4.8; prototype Repair Room |
| 6 | Series continuity had no post-Episode commit | Added immutable Episode Outcome Proposals, explicit dependencies, qualified Series-editor review, base continuity hash, CAS accept, and rebase/branch/conflict semantics | design §3.2; state §4.3.1; cultural policy §2 |
| 7 | Incident withdrawal could not be represented | Master availability now supports quarantine/withdrawal; approval selection is revoked, Episode becomes release-blocked, export access is revoked, signed URLs expire, and reconciliation runs without deleting history | state §§4.9–4.10; threat §21 |
| 8 | ffmpeg worker was an unspecified trust/deployment boundary | Launch uses a dedicated Trigger.dev Cloud `large-1x` render queue with pinned Node/ffmpeg/fonts/compiler, the real 4-vCPU/8-GB/10-GB limit, sub-7-GB scratch discipline, segmented streaming/cleanup, three-render cap, health/queue alarms, and single-attempt scoped capability tokens rather than service-role credentials | design §15.6; provider §9; state §§3, 8; threat §§11, 17 |
| 9 | Recovery objectives contradicted | One launch contract now governs each domain: Postgres RPO ≤5 min/RTO ≤2 h; critical Storage/audit RPO ≤15 min/RTO ≤4 h; GitHub configuration RTO ≤2 h | design §17; state §9; threat §21.3 |
| 10 | Independent backup/audit destination was unnamed | Added a separately restorable `Genie Vault` Supabase project with content-addressed copies, checksums, append-only vault identity, retention, alerts, quarterly restore drills, and reconciliation evidence | design §§17, 19; provider §9; state §§5.2, 9; threat §§13, 21 |
| 11 | Ten to twenty Episodes could not support calibration claims | The first 10–20 are pilot/tuning only. Product calibration requires at least 30 calibration plus 20 untouched holdout Episodes, two qualified raters, confidence and per-slice reporting, and the detector gates | design §10; QC §12; SDLC §5 |
| 12 | Prototype cross-contaminated a single global Episode state | Simulation now keeps per-Episode aggregate, Series release, config/artifact revision, durable job, completion, voice/look/world, repair, and freshness state | prototype `app.js` Episode aggregates and revision strip |
| 13 | Provider capabilities were asserted without reproducible evidence | Provider contract now distinguishes official-documentation observation from authenticated verification. Added dated evidence payload and production gates for raw/schema hashes, account receipts, canary media/cost/retention, and capacity | provider §§1, 3, 7, 10; `docs/evidence/provider-snapshots/` |
| 14 | 1080×1920 delivery had no upscale route | Selected Topaz video upscale on fal.ai for retained 720p-to-1080p clips, with dated cost, one bounded alternate retry, and identity/deity/flicker/halo/text/color/duration probes; native 1080p is a quoted alternative | design §14; provider §§2, 3.5; cost envelope |
| 15 | Hindi immutability lacked cross-system offset semantics | Script manifests now map raw/processing UTF-8 bytes, Unicode scalar values, browser UTF-16 units, and pinned UAX #29 grapheme IDs; fixtures cover Devanagari combining marks, nukta, ZWJ/ZWNJ, normalization, CRLF, emoji, and whitespace | design §2.3; state §§5.2, 6.9, 11.1; QC `GQC-SCRIPT-001` |
| 16 | Source/cultural authority could not operate on arbitrary scripts | Added Source Review, accepted-evidence taxonomy, stable citations/archive handles, rights and contradiction state, competency scope/evidence/expiry/suspension/revocation, recusals, conflicts, exceptions, and fail-closed behavior | design §11; cultural policy §§1–5; state §4.11; threat §15 |
| 17 | Prototype typography and targets violated its own accessibility contract | Removed all 7–11px declarations, set metadata floor to 12px, operational copy/controls to 14px, buttons to at least 44×44px, corrected mobile wrapping, and reran desktop/mobile overflow and interaction smoke | `docs/genie-ui/styles.css`; UI adversarial review |

## 3. First-gate P2 findings and resolutions

| Finding | Resolution |
|---|---|
| Prompt grammar had an optional third suffix | Runtime grammar is exactly `frame_block + "\n\n" + locked_look_block`; anti-tint policy is compiled into the locked second block and every look becomes deterministic reviewed manifest data |
| Script lock lacked the duration gate | Pre-lock estimate and acknowledgement are explicit; exact post-TTS 60–120 seconds is a hard production gate without changing words |
| Performance change did not reliably invalidate narration | Performance direction and synthesis settings are versioned and invalidate narration, alignment, shots, sound, edit, QC, and masters |
| Provider capacity was unproven | It is now an explicit production-enablement gate: authenticated account concurrency, queue-age and five-Episodes-per-day load tests must pass |
| Terminal request could become `stale_completed` | Terminal provider state remains unchanged; late/duplicate/billable completions append an orthogonal immutable event and cost record |
| Master reapproval semantics were unclear | Revoked/quarantined approval cannot be reused. Reapproval requires a new master version, rerun evidence, and a new decision |
| “Complete” vocabulary conflated software and cinematic proof | The design distinguishes software-complete, deployable, provider-enabled, and product-calibrated |

## 4. Cost adversarial check

At the documented rate snapshot:

- a representative 90-second retained mix costs USD 13.36 for one base video
  pass;
- the expected 1.8× candidate case plus upscale, images, and non-video allowance
  is USD 34.54;
- the high 2.5× case is USD 47.99;
- a 120-second high case is USD 62.83 and therefore cannot begin under the
  default ceiling without replanning or explicit top-up;
- all-Seedance or native-1080p-heavy plans can exceed the target and are not
  disguised as affordable.

These values prove design feasibility, not production billing. The application
must use authenticated current rate cards and canaries. Unknown or contradictory
rates fail closed.

## 5. Browser and static QA

The current design simulation was loaded directly from the local HTML file in
one short-lived headless session:

- 1440×1100 desktop: no horizontal overflow, console errors, or page errors;
- 390×844 emulated mobile: no horizontal overflow, console errors, or page
  errors;
- Home → Series → Episode Premiere → Monica Repair Room interaction smoke
  passed;
- screenshot inspection identified and corrected one global italic selector
  that shrank the hero line and one narrow-layout heading/action collision;
- 133 HTML IDs are unique;
- all direct DOM-ID references resolve;
- CSS braces balance;
- all buttons have a 44×44px minimum target;
- no 7–11px font declarations remain;
- JavaScript syntax and repository whitespace checks pass.

This validates the representative prototype, not production UI accessibility.
The implementation still requires automated accessibility, keyboard, zoom,
screen-reader, focus, responsive, and real-state tests.

## 6. Residual proof gates that are intentionally not design claims

The following are prerequisites for provider-enabled or product-calibrated
operation, not reasons to weaken the design:

- authenticated account/schema/rate/retention canaries for every provider;
- actual ElevenLabs voice pronunciation and accent fixtures for the two
  configured IDs;
- real provider concurrency and five-Episodes-per-day load evidence;
- settled-cost reconciliation and measured candidate multipliers;
- purchased Supabase PITR and a separate Genie Vault project;
- timed database/media/audit restore drills;
- the owner's first 10–20 pilot Episodes;
- accumulated 30-Episode calibration and 20-Episode untouched holdout;
- independent detector, cinematic-ranking, cultural, and human-release evidence.

Until those gates pass, the product must show the appropriate status:
`deployable`, `provider validation pending`, or `quality confidence provisional`.
It must not claim production-calibrated cinematic autonomy.

## 7. Final gate

**Disposition: PASS.** The final independent cold retest found zero remaining
P0, P1, or P2 findings after re-reading the current worktree.

The retest itself found and forced correction of five initially missed P1
contradictions: Trigger.dev's real 10 GB disk limit, cost authorization after
World Lock, conditional versus universal cultural approval, repair acceptance
bypassing final review, and stale QA evidence. Subsequent narrow retests found
and closed the repaired-Episode transition, exact quote-slot consumption,
double-reservation risk, reservation uniqueness, and PostgreSQL null-key
escape. The gate was not passed until the independent reviewer returned
`PASS`.

This PASS means the design is coherent enough to enter implementation planning.
It does not claim that provider canaries, deployed recovery, film-quality
calibration, or production runtime behavior already exist. Those remain
fail-closed delivery and external-evidence gates.

# Phase 2 requirement and evidence audit

**Audit date:** 2026-07-22 (continuing the 2026-07-19 audit)
**Candidate base:** `49dc7ea8c2e7d85857660e775b2bed575616aa5e` plus the intentional dirty MVP cinematic/Edit worktree
**Scope:** `P2-01`-`P2-14`, `V-P2-001`-`V-P2-034`, and all 96 `@phase2` traceability obligations
**Status:** implementation audit reconciled through the pre-freeze gate; this document is not phase-exit evidence. Section 6 supersedes the older point-in-time dispositions in sections 2–5.

> **MVP disposition (2026-07-20):** This remains the launch-hardening backlog,
> but `docs/MVP_DELIVERY_PROFILE_2026-07-20.md` now defines the first
> owner-operated release gate. Rows that require exhaustive races, fault
> injection, all-state/all-device coverage, or external infrastructure remain
> `partial`/`mvp_deferred`; they do not block the developer MVP and are not
> represented as verified.

## 1. Audit rules

- `covered_pending_gate` means implementation and focused proof exist, but the frozen-candidate complete gate has not yet passed.
- `partial` means some implementation or evidence exists but the named scenario is not proven at its required boundary.
- `gap` means a required implementation or evidence path is absent.
- `mvp_deferred` means useful wider-team or production-hardening work that is
  intentionally outside the owner-operated MVP gate.
- No row becomes `verified` until the exact committed candidate, complete phase gate, required live evidence, and one independent end-of-phase review all pass.

## 2. Work-package audit

| Work package | Current implementation | Audit disposition | Required closure |
|---|---|---|---|
| `P2-01` | Exact browser/uploaded UTF-8/UTF-16 sources, hashes/maps, typed additive annotations, duration acknowledgement, and pinned advisory script-rubric evaluation | `covered_pending_gate` | Re-run both source paths and rubric persistence/planning binding in the complete frozen gate. |
| `P2-02` | Exact male/female identities, male default, no fallback, authenticated voice evidence | `covered_pending_gate` | Bind into final candidate/live evidence. |
| `P2-03` | Exact 117-look registry, default, deterministic prompt tails, responsive picker | `covered_pending_gate` | Complete browser/visual gate. |
| `P2-04` | Durable preflight runs/stages/attempts/leases/fences/reconciliation and Trigger dispatch contracts | `partial` | Deploy/authenticate the real Trigger project and queues; add explicit dependency-crash and concurrency proof. |
| `P2-05` | Restricted typed tools, injection rejection, ledgered OpenAI calls, blind plan evaluators, and pinned advisory script-rubric evaluators | `partial` | Add the explicit graph/cap/fan-out/depth negative corpus. |
| `P2-06` | Provider broker, grants/assertions, micro authority, request/callback/reconciliation ledger | `partial` | Run true two-session micro authorization/slot and revoke/disable-versus-consume races; deterministic identity, overlap, revocation, disable, replay, and security-evidence proofs are complete. |
| `P2-07` | Exact-host fetch and SSRF checks; quarantine-only provider/upload/research paths; exact image-container validation; real ephemeral Vercel Sandbox ClamAV/ImageMagick scan, probe, metadata stripping, re-encode, and derivative inspection | `covered_pending_gate` | Re-run the deterministic and live scanner corpora in the frozen gate; keep every rejected artifact non-authoritative. |
| `P2-08` | Character/location extraction, anchor generations, decisions, uploads, reference packs | `partial` | Make deity form topology/hand-object/vahana/weapon/skin/transition manifests structurally exact. |
| `P2-09` | Source packets, competencies, appointments, recusal, decisions, temple evidence, non-overridable findings | `partial` | Map and test all twelve stable cultural rules and source-rubric claim classes explicitly. |
| `P2-10` | Pronunciation, score, sound identities and release pins | `covered_pending_gate` | Add exact missing-component negative fixtures to closure evidence. |
| `P2-11` | Narration/QC, deterministic timeline, executable plan, references, provider slots, blind consensus and bounded repair | `partial` | Add explicit cycle/later-shot/stale-hash/cap/upstream-spend and golden plan-QC math coverage. |
| `P2-12` | Exact provider slots, seven allowances, high envelope, AAL2 quote confirmation, USD 50 ceiling | `partial` | Add true concurrent quote/reservation/slot claims and bind all exact quote inputs into final evidence. |
| `P2-13` | Atomic World Lock function, late-bound rollback fixture, exact replay/stale rejection, and safe post-lock owner offboarding | `partial` | Prove every meaningful write boundary and two concurrent first locks. |
| `P2-14` | Six-chamber Living Cinema flow, honest polling/states, terminal failure feedback | `partial` | Run/fix the expanded 55-test suite and add explicit 200% zoom plus stored-XSS coverage. |

## 3. Verification-scenario audit

| ID | Current proof | Disposition | Closure action |
|---|---|---|---|
| `V-P2-001` | `src/domain/script/integrity.test.ts`, `exact-textarea.test.ts`, Phase 2 foundation pgTAP | `covered_pending_gate` | Re-run in frozen gate. |
| `V-P2-002` | immutable script trigger, exact hash/version pins, mutation tests | `covered_pending_gate` | Bind affected downstream eligibility assertions into final evidence. |
| `V-P2-003` | `uploaded-text.ts`, script-lock v2, exact upload migration, 178 planned zero-spend pgTAP assertions, 38/38 focused unit/API tests, and the UTF-16 browser regression preserve bytes/checksum/encoding evidence | `covered_pending_gate` | Re-run the complete frozen local/preview/browser/live gate and bind the same candidate evidence. |
| `V-P2-004` | Pinned `script.v1.json` engine, rational golden math, independent challenge, service-only immutable run, advisory gate enforcement, unchanged-source proof, and exact plan-run pin pass in 5/5 unit and preview pgTAP tests | `covered_pending_gate` | Re-run config-hash/math/persistence/planning cases in the complete frozen gate and bind the same candidate evidence. |
| `V-P2-005` | exact voice registry/provider tests and canary evidence | `covered_pending_gate` | Frozen gate/live binding. |
| `V-P2-006` | exact 117 registry/default/manifest/pixel checks | `covered_pending_gate` | Frozen gate. |
| `V-P2-007` | world decision/version routes and world cultural pgTAP | `covered_pending_gate` | Frozen gate. |
| `V-P2-008` | bounded exact container/CRC tests reject malformed and polyglot PNG/JPEG/WebP before parsing; size/MIME tests reject oversized/wrong media; a metadata-bearing PNG passes through the real ephemeral sandbox and is sanitized | `covered_pending_gate` | Re-run the corpus in the frozen gate. |
| `V-P2-009` | named-temple extraction, research evidence, World Lock blockers | `covered_pending_gate` | Frozen gate. |
| `V-P2-010` | IPv4/IPv6/encoded/redirect/rebinding unit suite | `covered_pending_gate` | Frozen gate. |
| `V-P2-011` | provider-ingest regressions reject malformed/wrong-MIME/oversized outputs before authority; a quarantined malformed container is failed and never promoted | `covered_pending_gate` | Re-run provider-ingest and scanner cases in the frozen gate. |
| `V-P2-012` | real Vercel Sandbox re-encode produced a distinct valid derivative with no GPS/comment/XMP/private attachment chunks or payload and an exact `IEND` boundary; see `media-scanner-corpus-2026-07-19.md` | `covered_pending_gate` | Re-run live derivative inspection against the frozen candidate. |
| `V-P2-013` | signed webhook, inbox replay, late evidence, lost-response reconciliation | `covered_pending_gate` | Frozen gate. |
| `V-P2-014` | retry-as-new-row state and database contracts | `covered_pending_gate` | Frozen gate. |
| `V-P2-015` | unique exact slot claim contract | `partial` | Run two-session race proof. |
| `V-P2-016` | sole reservation constraints and World Lock replay proof | `partial` | Run two-session duplicate-authorization/reservation race. |
| `V-P2-017` | typed broker and database guards reject production scopes from micro authority | `covered_pending_gate` | Frozen gate. |
| `V-P2-018` | competency/AAL/expiry/recusal/source-hash tests | `covered_pending_gate` | Add explicit expired/deactivated fixtures if absent, then frozen gate. |
| `V-P2-019` | complete pronunciation/score/sound selections are required by World Lock | `covered_pending_gate` | Add one missing-component fixture per component. |
| `V-P2-020` | 59.999/60/120/120.001 duration boundaries and independent transcript mutation checks | `covered_pending_gate` | Frozen gate. |
| `V-P2-021` | database command rejects later/stale/cap/order errors; deterministic generator builds acyclic order | `partial` | Add explicit cycle/later-shot/cap/stale-hash fixtures and assertions. |
| `V-P2-022` | preflight dependency guard requires successful upstream output hash | `partial` | Add failed-upstream claim test proving no downstream request/spend. |
| `V-P2-023` | final-write unique-conflict rollback is proven | `partial` | Inject failure at every meaningful World Lock write boundary. |
| `V-P2-024` | uniqueness/advisory locks and idempotent replay exist | `partial` | Run two-session first-Episode World Lock race. |
| `V-P2-025` | route and database stale aggregate/hash rejection | `covered_pending_gate` | Expand stale component matrix if needed and frozen gate. |
| `V-P2-026` | 55 browser cases exist; the five prior regressions and uploaded-source regression pass in focused Chromium runs | `partial` | Run complete suite; add explicit 200% zoom and remaining operational-state proof. |
| `V-P2-027` | lease/fence/heartbeat/failure/reconciliation tests | `partial` | Add crash-before/after-submit and expired-lease highest-fence scenarios for world/TTS/plan. |
| `V-P2-028` | restricted tool injection corpus and ledger-before-network tests | `covered_pending_gate` | Frozen gate. |
| `V-P2-029` | exact pinned rubric SHA, two golden rational-math cases, deterministic applicability/projection, mutation/spoof/independence rejection, DB payload/hash/advisory validation, and exact plan-run evidence pin | `covered_pending_gate` | Re-run unit and preview rubric corruption/binding cases in the frozen gate. |
| `V-P2-030` | preview pgTAP reruns the AAL2 Phase 1 offboarding transaction after World Lock: Series/Episode authority transfers, membership/session/work/leases are revoked, and the immutable bounded autonomous run plus historical signer evidence remain exact | `covered_pending_gate` | Re-run the 57-assertion world/cultural/transactional suite in the frozen gate. |
| `V-P2-031` | exact dual-signature verification rejects wrong/unknown issuer, audience, key, project, environment, task/run/stage/subject, future `nbf`, expiry, capability binding, and replay before provider work; safe rejection diagnostics persist separately | `covered_pending_gate` | Re-run the 26-case verifier, 8-case route, and 85-assertion preview provider suites in the frozen gate. |
| `V-P2-032` | typed and database cross-kind/scope guards | `covered_pending_gate` | Frozen gate. |
| `V-P2-033` | sole micro authorization/reservation/slot constraints | `partial` | Run concurrent two-session authority and slot claims. |
| `V-P2-034` | preview proves register/add/activate/revoke/disable, a maximum 15-minute two-key overlap, immediate JTI invalidation, disabled/revoked verification failure, stale-writer loss, replay rejection, and append-only audit/security evidence | `partial` | Run true two-session assertion replay and revoke/disable-versus-consume races to prove the losing transaction has no provider side effect. |

## 4. Traceability and phase-exit evidence gap

`reference/acceptance/traceability-plan.v1.json` currently contains 96 Phase 2 obligations, all `unimplemented`, and `traceability-evidence.v1.json` contains no Phase 2 entries. `scripts/create-phase2-implementation-evidence.mjs` binds only eight obligations from `P2-01`-`P2-03`; it cannot close Phase 2. Its promotion policy also requires three distinct review manifests, which conflicts with the current SDLC and implementation-plan rule requiring exactly one context-minimized end-of-phase adversarial review that covers acceptance, security, media, and UI/UX.

Closure requires:

1. update planned owners/proofs where the implementation legitimately differs from the original placeholders;
2. create candidate-bound evidence for all 96 Phase 2 obligations;
3. require one comprehensive independent review manifest with all mandated review scopes;
4. keep every obligation `implemented_unverified` until the complete gate and review pass, then promote all supported obligations to `verified` together;
5. preserve future Phase 3/4 child obligations as `unimplemented`.

## 5. External phase-exit dependencies

- Trigger.dev project reference, deployment identity, authenticated queues, and CLI/deployment authority remain unavailable in the current environment.
- The final remote-live same-candidate suite must run from a published commit in the disposable trusted sandbox.
- Production Supabase intentionally remains Phase 1-only until the complete local/preview/live gate and independent review pass.

## 6. 2026-07-22 pre-freeze reconciliation

This reconciliation uses the current worktree, preview database, generated
traceability plan, and test output rather than the older July 19 counts. It does
not promote any obligation. The candidate still requires a commit-bound local
gate, remote disposable-branch proof, the one comprehensive independent review,
fixes, re-gating, and explicit deployment.

### 6.1 Work packages

| Work package | Reconciled disposition | Current evidence and remaining boundary |
|---|---|---|
| `P2-01`–`P2-03` | `covered_pending_gate` | Exact script/upload paths, male/female voice identities, and all 117 looks pass the unit, preview, and browser layers. Candidate-bound live/review evidence remains. |
| `P2-04` | `mvp_deferred` for Trigger cloud qualification; `covered_pending_gate` for the owner MVP | Durable database leases, fences, recovery and Vercel cron reconciliation are implemented and tested. The Trigger CLI is not authenticated in this environment, so its cloud deployment identity and queues are explicitly deferred and are not claimed verified. |
| `P2-05` | `covered_pending_gate` | Restricted tool, prompt-text, graph cycle/later-reference/fan-out/depth/cap, ledger-before-provider, blind evaluation and corrupt-rubric cases now exist and pass. |
| `P2-06` | `covered_pending_gate` | Broker, assertion, reservation, request, callback and reconciliation contracts pass. The disposable-branch concurrency diagnostic proved one authorization/reservation/request, replay rejection, and revoke/disable-before-consume with no provider side effect; the frozen live runner must repeat the proof for the committed candidate. |
| `P2-07` | `covered_pending_gate` | Exact-host fetch, quarantine, strict container validation, real sandbox re-encode/inspection and provider-ingest rejection paths pass; same-candidate live scanner evidence remains. |
| `P2-08` | `covered_pending_gate` | New v2 character identity manifests bind canonical SHA-256, topology, arms, hands/objects, vahana, weapons, ornaments, wardrobe, skin/form, dignity and transitions. Focused preview World suite passes `100/100` after combined integration. |
| `P2-09` | `covered_pending_gate` | New immutable P2-09 bundle covers the exact nine claim categories and all twelve cultural rules, blocks incomplete/non-overridable cases and preserves qualified-human-only approval. Focused preview suite passes `59/59`; the shared World fixture now records the bundle before approval. |
| `P2-10`–`P2-13` | `covered_pending_gate` | Pronunciation/score/sound blockers, exact narration/timeline/plan/quote inputs, upstream-failure behavior, World Lock rollback/replay/staleness, and concurrent first-lock authority are covered. The developer-MVP records spend without pausing above USD 50 as explicitly approved; that scope change is not a wider-team cap decision. |
| `P2-14` | `covered_pending_gate` | Complete Chromium suite passes `62/62`, including all authoritative lifecycle openings, compact Atrium/Series navigation, autonomous preflight/Edit, repair/approval, mobile/accessibility, stored-markup inertness, and the 200%-zoom overlap regression. |

### 6.2 Verification scenarios

| Scenario set | Reconciled disposition | Evidence boundary |
|---|---|---|
| `V-P2-001`–`V-P2-014` | `covered_pending_gate` | Exact script/rubric/voice/look/World/media/provider retry paths pass deterministic, preview and browser checks. The live scanner/provider portion remains candidate-bound. |
| `V-P2-015`–`V-P2-017` | `covered_pending_gate` | Disposable-branch races produced one slot/request and one reservation; micro authority cannot claim production slots. |
| `V-P2-018`–`V-P2-020` | `covered_pending_gate` | Competency/recusal/source binding, all required audio identity components and duration/spoken-text boundaries pass. |
| `V-P2-021`–`V-P2-025` | `covered_pending_gate`, except exhaustive every-write-boundary injection is `mvp_deferred` | The 73-assertion executable-plan suite covers cycle/later-shot/cap/stale input and failed-upstream behavior. Representative World Lock rollback, staleness, replay and concurrent-first-lock proofs pass; the original exhaustive fault matrix remains outside the owner-MVP gate. |
| `V-P2-026` | `covered_pending_gate` | Complete 62-case browser proof passes at the current candidate worktree, including zoom, responsive, reduced-clutter and operational-state paths. |
| `V-P2-027` | `mvp_deferred` for Trigger cloud crash qualification; `covered_pending_gate` for database/cron recovery | Lease expiry, fencing, replay and provider convergence pass; real Trigger before/after-submit crash proof awaits authenticated Trigger deployment. |
| `V-P2-028`–`V-P2-032` | `covered_pending_gate` | Restricted-agent injection corpus, rubric corruption, offboarding, dual-signature/provider assertion and cross-kind guards pass. |
| `V-P2-033`–`V-P2-034` | `covered_pending_gate` | Disposable-branch evidence records one-winner concurrent authority/slot claims, assertion replay rejection, bounded key behavior, and revoke/disable winning before provider side effect. Same-candidate remote repetition remains. |

### 6.3 Current aggregate proof

- Preview pgTAP: nine suites, `745/745` assertions.
- RLS/database-policy/trusted-harness composite: passed; its isolated live portion
  is intentionally skipped outside the disposable runner.
- Unit coverage: 102 files / 637 tests; 95.58% statements, 92.16% branches,
  96.66% functions, 97.4% lines.
- Integration: `5/5`; the provider-backed live scanner is intentionally skipped
  in the deterministic environment.
- Browser: `62/62` in Chromium; the bounded Next server exited normally.
- Formatting, lint, type checking and trusted-manifest validation: passed.

### 6.4 Traceability and honest closure state

The implementation-evidence generator now derives and requires all 96 Phase 2
obligations and exactly `P2-01`–`P2-14`. Its promotion policy requires one fresh
`genie-cold-review.v2` manifest covering acceptance, media, security and UI/UX,
bound to the same candidate commit/tree, with no open P0/P1/P2 finding. Hostile
tests reject missing obligation coverage and incomplete review coverage.

The ledger deliberately remains `unimplemented` before the frozen candidate is
committed and gated. After the same-candidate local/remote/review proof, the
repository can truthfully promote the 96 entries only to
`implemented_unverified`: `docs/traceability.md` still forbids `verified` from
Phase 2 onward until an external cryptographic provenance contract is enabled.
That assurance limitation is separate from owner-MVP software completion and
must not be hidden by relabelling local evidence.

### 6.5 External state correction

The older statement that production is Phase-1-only is historical. Production
already contains the deployed owner-MVP World/preflight/production/Edit lineage
through commit `49dc7ea8c2e7d85857660e775b2bed575616aa5e`. The new P2-08 and P2-09
migrations in this audit have been applied only to preview
`iuzijmzcimtwyowhwinu`; they are not promoted to production before the frozen
candidate gate and review.

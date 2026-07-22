# Genie verification matrix

**Status:** Implementation-plan gate passed
**Purpose:** Define the proof required before phase and launch claims.

Rows are routed individually through `docs/traceability.md`. A grouped range in
this matrix is never evidence. `failed`, `unimplemented`, or
`implemented_unverified` blocks the owning gate; `deferred_external` permits
only a named non-production milestone with the
affected feature disabled.

## 1. Test layers

| Layer | Scope | Required evidence |
|---|---|---|
| Static | types, lint, formatting, forbidden imports, schema inventory | command output and CI artifact |
| Unit | pure domain policy, scoring, routing, state transitions | deterministic test report |
| Property | Unicode, money, time ranges, weights, idempotency, CAS models | seeds and minimized failures |
| Database integration | migrations, constraints, functions, outbox/inbox | fresh database report |
| RLS/Storage | outsider/member/role/object isolation | actor matrix report |
| Contract | environment, events, providers, rubrics, config hashes | schema fixtures and snapshots |
| Component | interaction, accessibility, error/loading states | Testing Library and axe |
| Browser | complete user journeys and responsive behavior | Playwright trace/screenshots |
| Workflow/chaos | retries, crashes, callback order, reconciliation | deterministic fault matrix |
| Media | ffprobe, loudness, captions, corruption, checksums | fixture and canary manifests |
| AI/QC | seeded defects, judge consensus, replay, calibration labels | evidence bundles |
| Security | `TM-01..42`, secret/bundle, SSRF/upload/webhook/cost abuse | security report |
| Visual | Living Cinema fidelity, mobile, reduced motion, contrast | reviewed screenshots |
| Live canary | authenticated provider/render/deployment behavior | bounded-cost run record |
| Human pilot | cinematic/cultural usefulness | owner review corpus; external to software gate |

## 2. Phase 0 proof

| ID | Scenario | Expected |
|---|---|---|
| `V-P0-001` | Clean `pnpm install --frozen-lockfile` | succeeds |
| `V-P0-002` | TypeScript strict build | zero errors |
| `V-P0-003` | Lint/format policy | zero blocking findings |
| `V-P0-004` | Production build | succeeds without provider calls |
| `V-P0-005` | Seeded canary secret in server env | absent from all client/build artifacts |
| `V-P0-006` | Missing required production env | boot/build path fails with redacted actionable error |
| `V-P0-007` | Browser smoke desktop/mobile | shell renders, no console/page errors |
| `V-P0-008` | CI clean checkout | all bootstrap gates reproduce |
| `V-P0-009` | SBOM/dependency/container/license scans | no unaccepted critical finding |
| `V-P0-010` | Secretless fork/preview CI | no production secrets or provider access |

## 3. Phase 1 proof

| ID | Scenario | Expected |
|---|---|---|
| `V-P1-001` | Fresh migration apply and replay | deterministic success |
| `V-P1-002` | Exposed-table inventory | every table has RLS and explicit grants |
| `V-P1-003` | Outsider enumerates all CRUD/API paths | zero rows or authorization failure |
| `V-P1-004` | Member forges workspace/role/owner/status fields | rejected |
| `V-P1-005` | Removed member reuses open tab/token | action-time authorization rejects |
| `V-P1-006` | Duplicate Series/Episode command | same receipt/aggregate, no duplicate |
| `V-P1-007` | Concurrent Episode number allocation | unique deterministic outcome |
| `V-P1-008` | Audit mutation through application roles | rejected |
| `V-P1-009` | Cross-workspace Storage read/write/path traversal | rejected |
| `V-P1-010` | Realtime disconnect/reconnect | authoritative refetch, no stale resurrection |
| `V-P1-011` | Work lease expiry/takeover race | highest fence wins |
| `V-P1-012` | Authenticated Series/Episode browser journey | accessible and responsive |
| `V-P1-013` | Invite replay, email mismatch, role escalation, expired token | rejected and audited |
| `V-P1-014` | Direct high-consequence command with `aal1` | rejected in server/database boundary |
| `V-P1-015` | Session revocation or role downgrade with open tab | next action rejected |
| `V-P1-016` | Deactivate owner with active Episodes and work leases | sessions/leases revoked; ownership/work transferred auditably; nullable future-run path retained |
| `V-P1-017` | Empty/partial/retrying/paused/delayed/blocked/canceled/resumed states | accessible on desktop, tablet, and mobile |

## 4. Phase 2 proof

| ID | Scenario | Expected |
|---|---|---|
| `V-P2-001` | Devanagari/emoji/combining/CRLF source round-trip | raw and processing maps reconcile exactly |
| `V-P2-002` | Seed one scalar/byte mutation | downstream eligibility invalidates |
| `V-P2-003` | Uploaded text with encoding evidence | original bytes/checksum retained |
| `V-P2-004` | Script rubric suggests rewrite | advisory only; source unchanged |
| `V-P2-005` | Narrator gender/voice identity or owner-uploaded narration | exact pinned voice with no silent fallback; or sanitized MP3/WAV plus explicit confirmation makes its transcript authoritative and creates no ElevenLabs request |
| `V-P2-006` | Look registry | exactly 117 unique IDs and correct default |
| `V-P2-007` | Prompt edit/regenerate/accept/upload | creates immutable versions and correct selection |
| `V-P2-008` | Malformed, polyglot, oversized, metadata-bearing upload | rejected or sanitized per policy |
| `V-P2-009` | Named temple without provenance | World Lock blocked |
| `V-P2-010` | IPv4/IPv6/private/encoded/redirect/DNS-rebinding remote URLs | rejected at every resolution/redirect hop |
| `V-P2-011` | Provider returns malformed/oversized/wrong-MIME media | quarantined; never authoritative input |
| `V-P2-012` | Metadata stripping and re-encode | GPS/comments/attachments absent after promotion |
| `V-P2-013` | Forged/replayed/late callback or lost submit response | exact state machine, no overwrite/duplicate logical spend |
| `V-P2-014` | Retry after retryable failure | new request row; terminal predecessor unchanged |
| `V-P2-015` | Quote slot double claim race | one request wins |
| `V-P2-016` | High reservation duplicate authorization | one reservation exists |
| `V-P2-017` | Micro-quote tries to claim production-video slot | rejected |
| `V-P2-018` | Missing/expired/recused source reviewer competency | Series publication blocked |
| `V-P2-019` | Missing pronunciation/score/sound release component | Series publication blocked |
| `V-P2-020` | Generated narration spoken mutation, unconfirmed upload, or narration duration out of range | production quote/World Lock blocked; a confirmed upload may differ from the earlier immutable script only through its new authoritative transcript revision |
| `V-P2-021` | Reference cycle, later-shot reference, cap breach, stale hash | preflight blocked |
| `V-P2-022` | Upstream reference failure | no downstream spend |
| `V-P2-023` | Fault at every World Lock write boundary | all-or-nothing |
| `V-P2-024` | Two concurrent first-Episode World Locks | one release/config/reservation/run authority |
| `V-P2-025` | Stale character/location/config/EDD/quote version | lock rejected |
| `V-P2-026` | Full creation flow and all operational states | desktop/tablet/mobile/keyboard/zoom/reduced-motion pass |
| `V-P2-027` | Crash/lease expiry around live world/TTS/preflight stages | durable retry/reconciliation; highest fence wins |
| `V-P2-028` | Injection in script/OCR/research/provider/model text | read-only broker exposes no arbitrary side effects or authority |
| `V-P2-029` | Corrupt rubric hash/math/applicability/plan evidence | fail closed before production quote |
| `V-P2-030` | Offboard owner after run envelope exists | Phase-1 transfer contract rerun; active run safely reassigned/paused |
| `V-P2-031` | Broker client assertion has wrong/unknown `iss`, `aud`, `kid`, environment, task/run/stage subject, expiry, or replayed `jti` | provider broker rejects before key use or spend; rejection is audited without secret leakage |
| `V-P2-032` | Preflight and production stages/slots are cross-linked or a micro slot requests video/render/export/approval | database constraints and command guards reject; no request or spend |
| `V-P2-033` | Concurrent micro authorization/reservation/slot claims | one authorization, one sole reservation, and at most one request per exact slot |
| `V-P2-034` | Broker key overlap, rotation, revocation, client disable, and assertion replay races | only valid bounded-overlap key succeeds; revocation/disable wins before provider key use |

## 5. Phase 3 proof

| ID | Scenario | Expected |
|---|---|---|
| `V-P3-001` | Crash before/after outbox commit | exactly-once logical effect |
| `V-P3-002` | Duplicate/reordered/stale provider callback | idempotent; stale result quarantined |
| `V-P3-003` | Forged callback/correlation | rejected and audited |
| `V-P3-004` | Provider timeout after successful submit | reconcile by idempotency/correlation |
| `V-P3-005` | Budget exhausted during retries | stop; threshold unchanged |
| `V-P3-006` | Provider circuit opens | no new dispatch; safe pause/fallback policy |
| `V-P3-007` | Narration insertion/deletion/substitution | fail or indeterminate, never pass |
| `V-P3-008` | Caption generation | exact locked words and monotonic alignment |
| `V-P3-009` | Simple/camera-led/other shot fixtures | Kling 2.5/Kling 3.0/Seedance routes |
| `V-P3-010` | Failing keyframe | video generation not enqueued |
| `V-P3-011` | Seeded morph/limb/object/flicker/identity defects | correct typed defect and bounded repair |
| `V-P3-012` | Narration masking | audio remix route, not blind visual regeneration |
| `V-P3-013` | Judge disagreement/critical finding | consensus/challenger; critical cannot average away |
| `V-P3-014` | Historical verdict replay | exact deterministic outcome |
| `V-P3-015` | Fixed render fixture | valid 9:16 master with expected streams |
| `V-P3-016` | Multi-segment render fixture | valid concat/mux with no seam/truncation |
| `V-P3-017` | Scratch reaches 70% | no new local input |
| `V-P3-018` | Scratch reaches 80% | checkpoint/cleanup/replan or closed partition failure |
| `V-P3-019` | Worker with expired/stale capability/fence | command/storage access rejected |
| `V-P3-020` | Diagnostic/log scan | no secrets, scripts, signed URLs, raw provider payloads |
| `V-P3-021` | Injection in script, repair text, OCR, web text, provider output/error | no arbitrary HTTP/SQL/shell/data/spend/policy/approval authority |
| `V-P3-022` | Fuzzed IDs, huge arrays, recursive task graph, excessive fan-out/depth | schema/scope/limit rejection |
| `V-P3-023` | Two final judges | independent family/deployment; neither sees peer result |
| `V-P3-024` | Reference graph changes after lock | stale run blocks until version/quote reconciliation |
| `V-P3-025` | Trigger control/agent/media tasks read provider-key names | keys are absent; provider broker rejects unauthorized grant |
| `V-P3-026` | Each mandatory security-alert class | primary delivery, acknowledgement, retry, dead receiver, fallback and on-call evidence |
| `V-P3-027` | One Trigger project presents another project's client assertion or capability grant | broker rejects project/key/grant binding; no provider request or reservation claim |
| `V-P3-028` | P3-09 completes a passing authoritative run | migration `0038` command moves only `ready_to_produce` → `pending_qualified_review` and creates one qualified-cultural-review item |

## 6. Phase 4 proof

| ID | Scenario | Expected |
|---|---|---|
| `V-P4-001` | Machine QC passes without humans | Episode remains `pending_qualified_review`; no creative/final-review item, approval, or export exists |
| `V-P4-002` | Cultural approver and creative approver use same record | impossible; separate records required |
| `V-P4-003` | Cultural decision for old master reused | rejected |
| `V-P4-004` | Stale tab approves replaced master | CAS conflict |
| `V-P4-005` | Attempt to override non-overridable cultural rule | rejected |
| `V-P4-006` | Multiple repair rows, same/overlapping ranges, Unicode | persist and compile deterministically |
| `V-P4-007` | Repair plan omits downstream dependency | confirmation blocked |
| `V-P4-008` | Repair executes | new master; base retained |
| `V-P4-009` | Promote repaired candidate | prior decisions reset; unissued old exports canceled; issued packages retained as historical; Episode enters `pending_qualified_review` |
| `V-P4-010` | Seed regression outside repair range | detected and investigated |
| `V-P4-011` | Export stale/unapproved/quarantined master | rejected |
| `V-P4-012` | Corrupt package after upload | checksum validation fails |
| `V-P4-013` | Expired/revoked signed download | denied |
| `V-P4-014` | Cross-workspace search terms/IDs | no leakage |
| `V-P4-015` | Two users claim/review same work | lease/fence/CAS resolves safely |
| `V-P4-016` | Full repair and approval browser journey | passes desktop/mobile/accessibility |
| `V-P4-017` | Full export/download journey | correct immutable labels and artifacts |
| `V-P4-018` | Concurrent Episode Outcome Proposals share one base head | one CAS wins; other rebases/branches explicitly |
| `V-P4-019` | Master or Series Release is quarantined/withdrawn | approvals revoked as required; new exports/downloads denied; reconciliation audited |
| `V-P4-020` | Ambiguous/unsupported/conflicting/script-changing repair rows | constrained clarification; no dispatch |
| `V-P4-021` | Repair requested scope differs from actual dependency closure | UI and plan show both; confirmation binds actual scope |
| `V-P4-022` | Repair A/B playback and rollback | base remains available and selectable for review |
| `V-P4-023` | Pending deletion with impact, hold, backup residual | no premature erasure; tombstone and reconciliation verified |
| `V-P4-024` | Empty/partial/retrying/paused/delayed/blocked/canceled/resumed states | desktop/tablet/mobile accessibility and visual pass |
| `V-P4-025` | Attempt `pending_qualified_review` → `awaiting_final_review` without an active exact cultural decision | rejected at the database command boundary |
| `V-P4-026` | Qualified cultural decision binds exact master/policy/source/evidence/competency versions | only that target advances to `awaiting_final_review`; one creative/final-review item is created |
| `V-P4-027` | Two concurrent `repair.confirm` commands | one AAL2/CAS-bound authorization and one sole high-envelope reservation; loser has no side effect |
| `V-P4-028` | Two concurrent repair promotions or stale source master | one CAS wins or both reject; no mixed selections, orphan exports, or duplicate review items |
| `V-P4-029` | Pending qualified-cultural reviewer requests repair, result is promoted, then re-reviews | old cultural target/work item/decision is superseded; repaired target receives one fresh cultural review before creative review becomes available |

## 7. Deployment and live proof

| ID | Scenario | Expected |
|---|---|---|
| `V-D-001` | Vercel preview/production env separation | no shared secrets or unsafe flags |
| `V-D-002` | Supabase remote policy/grant inventory | matches tested migration state |
| `V-D-003` | Separate Trigger project/startup canaries | `large-1x`, pinned image/tools, disk behavior and provider-key absence verified |
| `V-D-004` | Exact male/female voice canaries | configured identities accessible and recorded |
| `V-D-005` | Each enabled provider route | authenticated bounded output and billing evidence |
| `V-D-006` | One full live Episode canary | reaches human review with complete evidence/cost |
| `V-D-007` | Five overlapping Episodes with a degraded provider | account limits, fairness, queue age, cancellation, recovery verified |
| `V-D-008` | Settled 20-record stratified 90-second-equivalent corpus | preliminary cost evidence only; no production p95 claim |
| `V-D-009` | Minimum 59 zero-breach representative records or stronger predeclared method | one-sided 95% claim/interval and slice results support production cost target |
| `V-D-010` | Pause/kill switches | prevent new spend/render/final approval/export |
| `V-D-011` | Production PITR and independent Vault replication | checksums, access isolation, retention and alarms verified |
| `V-D-012` | Compromised Vault writer role/JWT | cannot update/delete/truncate/overwrite/DDL prior copies |
| `V-D-013` | Timed restore/reconciliation drill | database/Storage/provider/Trigger/export converge within targets |
| `V-D-014` | Timed production Postgres PITR drill | measured RPO ≤5 minutes and RTO ≤2 hours, including reconciliation |
| `V-D-015` | Timed critical Storage/audit Vault drill | measured RPO ≤15 minutes and RTO ≤4 hours with checksum-complete reconstruction |
| `V-D-016` | Clean code/migration/environment recovery from a protected commit | measured RPO at that commit and RTO ≤2 hours |
| `V-D-017` | Real deployed Episode after recovery gate | exact script → World Lock → providers → Monica → qualified cultural review → creative/final approval → immutable export succeeds with complete lineage |

## 8. Quality gates for evidence

- A screenshot does not prove authorization.
- A unit test does not prove a remote provider or deployment.
- A provider success does not prove quality.
- A model judge score does not prove calibration.
- A local migration does not prove remote grants/RLS.
- A review master does not prove release approval.
- A mock repair does not prove dependency-safe rendering.
- Any missing/ambiguous evidence is `unimplemented`,
  `implemented_unverified`, or `deferred_external`, never
  inferred as pass.

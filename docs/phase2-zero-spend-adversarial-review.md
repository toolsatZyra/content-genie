# Phase 2 zero-spend checkpoint adversarial review

**Date:** 18 July 2026

**Status:** determined from the latest passing evidence artifact bound to the exact frozen Git tree, plus fresh independent reviews; no artifact may be carried across a tree change

**Scope:** `P2-01`, `P2-02`, `P2-03`, and the supporting database, security, traceability, live-harness, and creation-UI boundaries.

## Checkpoint claim

This checkpoint may claim only that Genie can preserve and seal the user's exact narration script, pin the two launch voice identities without pretending they are provider-verified, expose and persist one of 117 provenance-bound looks, and carry those decisions through the creation UI on an isolated Supabase preview. It does not authorize provider spend, asset generation, World Lock, production dispatch, or a released video.

The declared browser script limit is 8,192 UTF-8 bytes. Closure requires the disposable live suite to reject 8,193 bytes and insert an adversarial exact-boundary script through the production server path while PostgreSQL's real `pg_column_size(coordinate_map) <= 8388608` JSONB constraint is present. Local serialized-JSON measurements are regression screens only; they are not substitutes for that PostgreSQL proof. The database now enforces the same 8,192-byte raw-input limit and retains the unchanged 8 MiB map ceiling.

## Independent cold-review findings and remediation

Eight independent cold-review rounds inspected acceptance evidence, security/data boundaries, and UI/UX behavior. None found a P0 issue. Each round found at least one checkpoint-blocking P1 or P2 issue and rejected the reviewed fingerprint, even when another review discipline accepted the same tree. Every result from those rejected trees is diagnostic history rather than closure evidence.

### Acceptance and semantic proof

The initial review found that the old remote pgTAP parser could accept a final `ok N` after an earlier failure, repository-authored JSON authenticated structure rather than provenance, and the advertised 64 KiB script boundary could exceed the coordinate-map database limit.

The remediation now:

- injects exactly one `finish(true)` into each remote pgTAP suite, rejects every `not ok` or `Bail out!`, and requires one exact plan plus ordered assertions `1..N`;
- executes hostile local fixtures for a misleading final success, bail-out, duplicate, missing, and out-of-order assertions;
- describes only the implemented pieces of this `P2-01`–`P2-03` partial checkpoint as `implemented_unverified`; the authoritative Phase 2 ledger remains `unimplemented` because its obligations include later, unfinished Phase 2 work packages;
- treats typed checkpoint, CI, command, database, and reviewer JSON as structural/integrity records only—not as proof of who produced those claims;
- limits browser script input to 8,192 UTF-8 bytes, locally screens multiple exact-boundary ASCII/control/NFC/astral maps without calling one fixture "worst case," and requires the disposable production path to prove the adversarial boundary map is accepted by the actual PostgreSQL JSONB constraint;
- persists coordinate-map v2 as exact-key `{v,c,r,p,s}` objects whose indexes and mapping segments are positional tuples, coalesces adjacent equal reasons, and switches to one full-range reason-4 segment after 256 detailed transitions so hostile alternating input cannot create unbounded per-segment work;
- emits the shared replay-safe coordinate hardening body into the fresh-install hardener and `20260717121607_phase2_script_coordinate_v2_forward.sql`, while the terminal migration alone replaces the authentic predecessor attestor with the server-identified signature; it deterministically projects any persisted verified v1 map into v2, replaces the legacy table constraints/default, and replaces the old unique attestation index rather than silently retaining it through `IF NOT EXISTS`;
- retains complete raw and processing scalar-to-UTF-16, scalar-to-UTF-8, and grapheme-end indexes under that fallback, but explicitly gives up local normalization-reason resolution inside the full-range segment;
- preserves raw UTF-8 bytes separately from normalized processing text;
- uses the trusted server runtime for Unicode grapheme segmentation; PostgreSQL validates exact v2 key/tuple shape, semantic non-negative integers, complete scalar byte/UTF-16 offsets, strictly increasing grapheme ends, segment bounds/order/coverage, and normalization reasons, but does not independently implement UAX #29; and
- binds fresh server-identified, single-use coordinate attestations to the idempotency key, raw/processing hashes, exact canonical JSONB map hash, and runtime-evidence hash, consumes one on success, and revokes the known identity after any issuance or command outcome.

The second acceptance review found that ambiguous Supabase transport outcomes were mapped to definitive HTTP errors, so the browser could discard the only safe replay key after a commit whose response was lost. It also found that the terminal v2 migration reduced the row limit to 8,192 bytes without preserving legitimate v1 rows up to the predecessor's 65,536-byte contract. The remediation now classifies no-code, connection, resource, system, and completion-unknown outcomes as retryable `503` responses; keeps known transaction-abort/domain outcomes definitive; creates each attestation with a server-known v4 UUID and revokes it in `finally` even when issuance loses its response; and preserves the exact idempotency key for every unknown result.

The migration now adds an immutable `script_size_policy_version`. Authenticated predecessor rows from 8,193 through 65,536 bytes are grandfathered as policy v1, while every new row defaults to policy v2 and is capped at 8,192 bytes by a row constraint, `BEFORE INSERT` trigger, attestor, and command. The v2 semantic verifier validates coordinate correctness independently of size policy. A candidate-bound live drill must reconstruct the exact long-lived v1 functions/defaults/constraints, seed verifier-approved 8,193- and 65,536-byte rows, bind their exact IDs/bytes/SHA-256 hashes, apply only terminal migration `121607`, prove both rows remain byte/hash-identical and semantically valid, accept an exact 8,192-byte v2 row, and reject default-v2 and forged-policy-v1 8,193-byte inserts.

The third acceptance review found that attestation issuance still sat outside the cleanup scope: a committed issuance with a lost response could leave unknown authority alive until expiry. It also found that prose describing live proof as pending contradicted the then-current exact-tree passing artifact. The remediation now chooses a v4 attestation UUID on the trusted server, supplies that identity to the terminal attestor, and revokes the same known identity in `finally` after every issuance and command outcome. Cleanup failure takes precedence as a retryable fail-closed response. Durable prose no longer hardcodes a mutable gate result; the exact-tree artifact and fresh reviews are the source of current checkpoint truth.

The sixth acceptance review found two P1 defects in the then-passing tree. Browser-native undo restored the textarea's LF-normalized display value rather than the original CRLF bytes, so paste -> delete -> undo could silently change `A\r\nB` from four bytes to `A\nB` at seal time. Branch cleanup also treated a same-name/different-ID row as absence whenever the originally returned ID was known. The editor now owns a bounded exact-text undo/redo history, records every accepted edit, intercepts native history input, and handles paste, copy, cut, and drop through exact selection-offset translation. A Chromium test seals and asserts the posted raw bytes after the precise paste -> delete -> Ctrl+Z sequence. Branch lifecycle is now an executable trusted-parent state machine: strict creation output must contain the exact own-property ID and name; every deletion is immediately preceded by a list snapshot containing exactly that pair; same-ID/different-name, same-name/different-ID, duplicates, and ambiguous identities fail closed and are never deleted. Hostile executable state tests cover each collision.

The eighth acceptance review rejected the then-frozen tree for two P2 semantic failures. The Series UI called an aggregate compare-and-swap counter a "World version" and claimed inherited characters, locations, and visual language even when no active Series Release existed. Unknown future Episode and Series lifecycle values also failed open to familiar `draft` and `active` states. The remediation labels the counter only as a record/CAS version; projects the exact active release number, status, look identity and availability, and continuity identity/version; distinguishes an explicitly unreleased Series from malformed or unsupported release data; and never claims inheritance without a persisted release pin. Unknown lifecycle values now project to an explicit unavailable state that blocks Episode creation, Series archival, and World Setup navigation while preserving all fifteen authoritative Episode workflow states.

A later checkpoint may promote Phase 2 to `verified` only after GitHub-issued provenance (or an equivalently external, cryptographically verifiable attestation) binds the exact candidate and evidence artifact. A committed JSON document cannot self-authenticate GitHub, Supabase, command execution, or reviewer identity.

### Security and failure containment

The initial review found that URL-shaped database identity was insufficient, browser tests received account-management and service credentials, forward-correction retries were too broad, branch deletion was not confirmed, and the generated live credential file survived cleanup.

The remediation now:

- first validates that the PostgreSQL URL is branch-shaped and excludes production;
- creates a randomized nonce table through the branch-scoped Supabase Management API, reads the nonce through the exact direct PostgreSQL connection, proves the table is absent from production, and completes this challenge before migration-history repair or any other direct-connection mutation;
- retries only an enumerated set of transient connection/network failures and executes deterministic-failure and transient-recovery negative controls;
- gives the Next.js server the service-role key it needs, but gives Playwright only the exact non-privileged/test-variable allowlist; the account-wide Management API token and service-role key never enter the Playwright child;
- performs the privileged persistence query in the parent harness after the browser journey;
- recovers and deletes the exact randomized branch in `finally`, polls the branch list until absence is confirmed, records the confirmation time, and removes the local live credential file on success and failure paths; and
- retains exact expected RLS predicates, guarded `SECURITY DEFINER` functions, minimal grants, and adversarial workspace/session/membership checks.

The second security review found a legal PostgreSQL identifier form that confused the SQL splitter, an unbound/stale live artifact, no real predecessor-upgrade exercise, unlocked voice/look availability reads, and a cleanup path that could accept early eventually-consistent absence. The remediation now recognizes dollar quoting only at valid token boundaries; writes `outcome: running` before work; binds the artifact to the staged Git tree plus deterministic source, migration, database-test, and live-test digests; records complete TAP, boundary, persistence, predecessor, and cleanup evidence; locks the exact voice/look availability row during selection; and requires repeated branch-list snapshots before absence can be accepted. No deletion is permitted until a fresh list proves the exact ID-and-name tuple. Interpreter-control environment variables are excluded from child allowlists.

The third security review found a time-of-check/time-of-use gap between the initial candidate binding and final evidence emission, a predecessor fixture whose authenticity was described but not digest-pinned, and a branch password exposed in child-process arguments. The remediation now recomputes and compares the complete normalized candidate binding after cleanup and immediately before terminal evidence; pins and rechecks the exact predecessor fixture SHA-256 before branch work, before execution, and at final binding; normalizes Git-style paths before sorting portable digests; and supplies the password through a unique temporary `.pgpass` file while child arguments carry only a standard passwordless PostgreSQL URL. The credential file is removed in `finally`, its absence is recorded, and any binding or cleanup failure forces `outcome: failed` and a non-zero run.

The fourth security review found that Node's requested `0600` mode did not remove inherited Windows workspace ACLs, leaving the temporary PostgreSQL and browser credential files readable by broader local principals. It also found that a malformed narrator-gender payload escaped the definitive validation boundary and became a retryable unknown `503`. The remediation now creates a randomized credential directory before writing any secret; on Windows it removes inheritance, grants only the current user full control, and verifies a protected, singular, non-inherited ACL for both directory and file; on POSIX it verifies owner identity plus exact `0700`/`0600` modes. Every write is create-exclusive, every unsafe permission or cleanup state fails closed, and both private directories must be absent before a passing artifact can be emitted. Local negative controls broaden the directory and file permissions and prove that verification rejects them. Narrator-gender parsing is now translated into the same definitive command-validation error as the other malformed fields, so the route returns `400` without pretending the request is safe to retry.

The fifth security review found four remaining containment defects: the protected credential child was created below a broadly mutable workspace parent, the seven-minute live run still executed from the mutable main worktree, cleanup accepted unrelated direct children that merely matched a broad prefix, and branch recovery could delete by matching name or ID instead of the exact identity tuple. The remediation moves all credentials and staged snapshots to a trusted per-user runtime root. On Windows every parent from `%LOCALAPPDATA%` through the stable Genie runtime root is checked for mutation authority by untrusted principals before a randomized protected child is created; on POSIX the temporary root must be owner-trusted and any group/world-writable root must have the sticky bit. Managed child names require an approved purpose prefix plus exactly six random alphanumeric characters, every file write revalidates the protected direct parent and uses create-exclusive mode, and cleanup is root-bound to the same exact purpose prefix and suffix shape. The live command now exports the staged Git index to a randomized snapshot, seals candidate source read-only, exposes only named build-output directories as writable, runs the suite with that snapshot as `GIT_WORK_TREE`, and records the snapshot tree and seal in the terminal artifact. Every Supabase child invokes the repository-pinned CLI entrypoint directly through Node; `pnpm exec` is forbidden inside the sealed tree because its dependency-status self-check can attempt an install and a root-level temporary write. Branch deletion now requires exact name **and** exact ID; a same-name/different-ID or same-ID/different-name observation fails closed and is never deleted.

The sixth security review found four P1s and one P2 despite a completely passing local/live artifact: the sealed source snapshot junctioned mutable workspace dependencies; production database/service credentials and the account management token reached candidate orchestration code; branch creation/cleanup did not enforce a strict identity immediately before the first destructive request; the parent accepted an insufficiently validated child artifact; and runtime cleanup authenticated a path-shaped name rather than the created filesystem object while Windows parent ownership was unchecked. The remediation establishes a real parent/candidate boundary. Before sealing, the trusted parent performs an offline, frozen-lockfile, scripts-disabled pnpm install with independent copies; rejects hard links and links escaping the snapshot; binds the lockfile, full dependency-tree, package-manager, and pinned Supabase CLI version/digests; then re-hashes the dependency tree after execution. The trusted parent alone receives the management token, creates the disposable branch, proves a nonce absent from production, and performs exact-pair cleanup. Candidate code receives only disposable branch credentials and executes pgTAP/persistence queries over the disposable direct PostgreSQL connection.

The candidate writes only a snapshot-local `genie-live-candidate-evidence.v3` record. The parent recomputes source, migration, database-test, and live-test digests independently, validates an exact closed schema and every terminal binding/cleanup invariant, and publishes `genie-live-suite-evidence.v3` through a parent-owned artifact path never disclosed to the candidate. Private runtime directories and files are registered by device/inode/birth identity at creation and revalidated before use and cleanup; replacing a directory at the same path fails closed. Windows trusted parents must also have a trusted owner. The stable runtime root is protected only when newly created and otherwise verified without repeated shared-root ACL rewrites.

The seventh security review rejected the remote-broker boundary because the
broker executed a candidate-authored runner with disposable owner credentials,
accepted its JSON before complete semantic validation, and materialized output
before checking size. It also found an unbounded nonce ledger, a cleanup lease
that could outlive one stop request, Supabase-token-derived request signing, an
unsafe managed-database fallback, and broad constraint removal. The remediation
intentionally narrows the proof claim. The broker accepts only a candidate commit
equal to its reviewed `VERCEL_GIT_COMMIT_SHA`; both client and server enforce the
same approved deployment pin. A committed manifest binds every harness input,
the broker verifies it inside the sealed sandbox, a broker-owned streaming wrapper
caps stdout and stderr before the platform stores them, and regular-file metadata
is checked before a bounded artifact read. The broker then validates the entire
closed artifact before signing. Dedicated Ed25519 request authority is independent
of the Supabase management token. Nonces have indexed ten-minute retention,
cancellation is durably reconciled after a lease longer than the route ceiling,
and the client repeats signed cleanup requests until exact absence is proved.
Local database testing now requires Docker; managed proof uses only the
exact-identity controller. Coordinate migrations whitelist and validate the known
predecessor constraints and abort on unexpected inventory rather than deleting
checks found by broad SQL-text matching.

The eighth security review rejected that tree for two P2 containment gaps. The
broker route and remote client checked request or response size only after
buffering the complete body, and disposable-branch cleanup existed only in the
live coordinator's in-process `finally`. The remediation enforces independent
32 KiB request and 3 MiB response streaming caps, rejects declared oversize
before stream access, cancels on streamed overflow, and rejects malformed UTF-8
before authentication or JSON parsing. Branch identity is now registered in a
production-private durable cleanup ledger before candidate execution. Exact
coordinator ownership lets the creating process clean its own lease immediately;
another startup or scheduled reaper cannot claim an unexpired active lease and
may recover it only after the two-hour coordinator lease expires. A strict
hourly reaper also covers the smaller crash window before registration by
adopting only unleased, non-default, non-persistent, exact-pattern branches under
the exact production parent after a six-hour age threshold. Completion requires
three exact absence snapshots. During remediation review, an earlier draft that
made all registered leases immediately claimable was rejected before freeze;
hostile concurrency tests now prove that one run cannot reap another healthy
run and can recover it after expiry.

### UI and interaction fidelity

The initial review found pending-script mutation, payload/idempotency mismatch, missing voice availability failing open, hidden chamber focus, mutable look browsing during commit, rejected-look scroll mismatch, low-contrast metadata, and raw JSON parser errors.

The remediation now:

- snapshots and immediately freezes the submitted script while its lock request is pending;
- binds each idempotency key to the exact payload, reuses it only for an identical ambiguous retry, and clears it after success or a definitive rejection;
- treats only `pending_authenticated_canary` and `verified` voices as selectable;
- scrolls focused chamber headings below the sticky navigation stack;
- disables look-vault controls during commit and restores the authoritative look into view after rejection;
- raises the faint metadata contrast token; and
- parses mutation responses defensively with a domain-safe fallback for empty, HTML, or malformed responses.

The second UI review found that look commit success/rejection dropped focus to the document body, vertical arrow keys moved linearly rather than spatially, several mobile controls missed the 44 px target contract, and an invalid narrator could enter Look. The remediation now moves success focus to the enabled World action, restores rejection focus to the authoritative look or search control, derives vertical movement from the rendered 4/3/2/1-column grid, gives rail/family/toast controls at least 44 px targets, and blocks both Look entry controls until the effective narrator pin is valid. Browser coverage includes all of these paths plus axe checks and the reviewed mobile visual baseline.

The third UI review found that `?resumeCreation=look` could bypass invalid-narrator gating, the script textarea lost its visible keyboard focus ring, two remaining actions missed the 44 px target contract, and the header plus toast announced the same mutation twice. The remediation validates narrator identity, gender, and availability before honoring a Look resume on the server and guards the client chamber independently; restores a two-pixel `:focus-visible` outline; applies and comprehensively tests the minimum target geometry; and keeps the visual header save state out of the accessibility tree so the single toast status or alert owns the announcement.

The fifth-round UI review found that a programmatically focused chamber heading had only an effectively invisible one-pixel outline and that keyboard dismissal of the save toast removed the focused element without returning focus to a stable target. The remediation gives every focused chamber heading a visible two-pixel gold ring with contrast and offset checks, and toast dismissal returns focus to the current chamber heading on the next animation frame. Browser tests exercise both the automatic chamber transition and Enter-key toast dismissal, asserting the focused element and computed outline rather than relying on a screenshot alone.

The sixth UI review accepted the exact reviewed tree with no P0/P1/P2 findings after independently rerunning all creation-flow tests at 390/600/900/1280 px and checking focus, roving-grid, 44 px target, reduced-motion, narrator/look fail-closed, and exact-script behaviors. That acceptance did not override the acceptance/security rejections for the same tree.

The seventh acceptance and UI reviews rejected the replacement tree. System
defaults were presented as human-pinned without a durable confirmation, only the
current look's availability was projected, and the evidence promoter could run
without same-tree live proof plus reviewer records. Filtering could leave a hidden
look selected and still committable; the mobile action followed all 117 cards;
Episode milestones could contradict Delivered state; and Series selection had no
semantic or productive consequence. The remediation separates system defaults
from explicit human confirmation, keeps the launch performance profile fixed and
versioned, projects all 117 availability states, and blocks progression until the
look and voice are confirmed. Authoritative evidence promotion now requires the
same-tree local and live artifacts plus acceptance, security, and UI reviewer
manifests. The look vault reconciles filtered selection, uses bounded progressive
disclosure with an accessible persistent action, and disables unavailable looks.
Episode milestones derive from workflow state, Series selection exposes selected
details and a preselected Create Episode action, search/status announcements are
accessible, and mobile/desktop geometry tests protect the focused content and CTA.

The eighth UI/UX review found no P0/P1/P2 issue in its reviewed tree after
rerunning the responsive browser and visual checks. That acceptance is
diagnostic only because the acceptance and security disciplines rejected the
same fingerprint and their remediations changed the tree; closure still requires
a fresh UI/UX review of the final exact candidate.

## Current evidence status

The gate source of truth is `.tmp/artifacts/phase1-live-suite.json`, but only when all of the following are true for the same review candidate:

1. `schemaVersion` is `genie-live-suite-evidence.v3`, `state` is `finished`, and the parent-owned closed-schema validator reports no error;
2. `candidate.gitTree` equals the exact frozen staged tree; every recorded source, migration, database-test, and live-test digest independently recomputes in the trusted parent; and `executionSnapshot` proves the suite ran from the sealed Git-index checkout with an offline frozen independent dependency tree whose lockfile, complete tree, package-manager version, and Supabase CLI version/digests are bound and unchanged;
3. `outcome` is `passed`, ordered TAP plans and assertions are complete, boundary and persistence evidence pass, the authentic predecessor upgrade preserves the bound row IDs/bytes/SHA-256 values, and no residual coordinate attestations remain;
4. trusted-parent cleanup is confirmed for the exact disposable branch ID **and** name, candidate credential cleanup is null, generated credential directories/files and the sealed snapshot are absent, runtime object identities remained unchanged, and the candidate received no management token or production database/service credential; and
5. fresh acceptance, security, and UI/UX reviews for that tree return no P0/P1/P2; and
6. `candidate.commit`, the independently approved deployment pin, and the
   production broker's `VERCEL_GIT_COMMIT_SHA` are identical, while the signed
   broker artifact binds the committed manifest and complete semantic validator.

The artifact previously generated for tree `ebeb9702f0407d410776dd9922d3f7142064c721` recorded a passing disposable replay, including the complete then-current TAP streams, an authentic predecessor upgrade, exact 8,192-byte acceptance, 8,193-byte rejection, persistence checks, zero residual attestations, and exact branch cleanup. The acceptance remediation in this document's candidate changes the tree, so that artifact is now historical evidence only and must be regenerated after the replacement candidate is frozen. Its result must not be described as current proof for a different tree.

The later artifact for tree `7c40ce0f835d63cf5a96c9ed2cc11723ed354fd6` also passed its complete disposable replay, but the fourth security review showed that its `owner-temporary` Windows credential claim was not enforced by the inherited ACL and that invalid narrator gender was misclassified. That artifact is historical evidence only. The private-runtime and validation remediation changes the tree, so closure requires another exact-tree replay and another fresh three-discipline review.

The next artifact for tree `dc39fa6eb32cfa5b712660f834ca70586dd35833` passed the complete local and disposable replay and its acceptance reviewer returned ACCEPT. The fifth security and UI reviews nevertheless rejected that exact fingerprint for the mutable-parent, mutable-execution-tree, broad cleanup identity, branch identity, invisible heading-focus, and toast-focus findings described above. That artifact is historical evidence only. The sealed-snapshot, exact-runtime-identity, branch-cleanup, and focus remediation changes the tree and therefore requires a completely new replay and review set.

The following artifact for tree `af1096e56f84e9ea17c6f2b24de95d184214c3c1` passed all local gates, the complete disposable replay, 104/104 Phase 1 and 84/84 Phase 2 pgTAP assertions, the authentic predecessor upgrade, 8,192-byte acceptance/8,193-byte rejection, and exact reported cleanup. Its UI reviewer accepted it. The sixth acceptance and security reviews nevertheless rejected that exact fingerprint for CRLF undo loss, same-name/different-ID false absence, mutable dependencies, candidate exposure to production control credentials, insufficient parent evidence validation, and path-only runtime cleanup. That artifact is historical evidence only. The v3 trust-boundary remediation changes the tree and requires a new exact-tree replay and fresh review set.

Earlier runs remain diagnostic history: the original preview had an unsound TAP parser and URL-only database guard; the first boundary probe failed the exact 8,192-byte PostgreSQL insertion; and the compact-v2 predecessor run on branch `0c0cb538-1f41-4437-b567-914cbedbacc0` was bound to a later-rejected tree. Their successful subchecks do not close the current candidate.

The first v3 launcher replay for tree `0f36c4cb3a0fb7aeb7e9324891c4f9e673c47754` failed safely before pgTAP because direct Postgres represents a multi-statement query as one rowset per statement while the former Management API adapter exposed only the terminal rowset. The trusted parent still proved production exclusion, deleted the exact disposable branch, revalidated the dependency tree, and removed the snapshot. A pure fail-closed adapter now accepts either one rowset or a multi-statement result and returns only the terminal rowset; malformed shapes are rejected by executable tests. That change creates a new tree and the failed run is diagnostic only.

The next v3 launcher replay for tree `2bceaea8cee658ab5bb3bd795955b6083ee03ddf` passed 104/104 Phase 1 and 84/84 Phase 2 managed pgTAP assertions, schema lint, the authentic predecessor upgrade, the forward/rollback drill, and both live browser scenarios, including exact-byte persistence and the real 8,192/8,193-byte PostgreSQL boundary. It then failed safely in the candidate persistence verifier because a bigint aggregate version arrived from the direct driver as canonical decimal string `"4"` while the verifier required number `4`. The trusted parent still deleted branch `ab643def-8834-43fe-a622-d91402818259` by exact ID and name, confirmed three consecutive absence snapshots, revalidated all 24,413 dependency entries unchanged, removed the snapshot, and proved production exclusion; an independent Supabase connector check showed only production and the existing persistent development branch afterward. A strict result-boundary normalizer now accepts only JavaScript safe integers or canonical decimal strings and rejects whitespace, leading zeros, explicit plus signs, fractions, exponents, unsafe values, bigint objects, and nulls. That change creates a new tree; the failed run is diagnostic only and must not be reported as closure evidence.

The following replay for tree `b4d543b3d33ae6aa3edaf51d66174ea0c2cb660e` reached Phase 2 migration application, then Supabase CLI exited nonzero because its PostHog telemetry client timed out during shutdown after reporting the migrations as applied. The trusted parent still deleted branch `1ab1a8d5-9fcd-42a4-ab78-74ea34bb46a5` by exact ID and name, confirmed three consecutive absence snapshots, revalidated all 24,413 dependency entries unchanged, removed the snapshot, and proved production exclusion; the independent connector again showed only production and the existing development branch. The retry classifier now recognizes only the exact telemetry-shutdown completion-unknown signature. A deterministic non-transient SQLSTATE overrides that signature and HTTP/transient noise, preventing domain failures from being retried. The policy change creates a new tree; this failed replay is diagnostic only.

The next replay for tree `87fff498fc53cd6ad67d21919fbd0cc0596778c1` passed the entire isolated candidate suite, 104/104 and 84/84 managed pgTAP assertions, both live browser scenarios, exact persistence verification, and candidate-side final binding revalidation. The trusted parent still rejected the artifact because it compared independently equal binding objects using order-sensitive `JSON.stringify`; a duplicate candidate `snapshotSeal` property retained a different insertion position. The parent deleted branch `949b96e9-a3a0-44be-b281-2b1bf225fa83` by exact identity, observed three consecutive absence snapshots, revalidated all 24,413 dependency entries unchanged, removed the snapshot, and proved production exclusion; the independent connector confirmed no disposable branch remained. The duplicate property is removed. An executable order-independent validator now requires exact top-level and nested schemas for candidate binding, credential lifecycle, pgTAP suites, boundary proof, and persistence evidence, and validates their terminal values. Hostile tests reject extra fields, changed digests, residual attestations, and non-passing outcomes. The remediation changes the tree; the rejected parent artifact remains diagnostic only.

Local gates are likewise tree-bound. Current pass counts and coverage belong in the bound artifact or review record rather than in this durable document, so a later test addition cannot silently leave a false hardcoded count here.

Externally authenticated checkpoint provenance remains separately required before any Phase 2 obligation is called `verified`, even when the exact-tree local, disposable, cleanup, and review gates pass.

## Advisor disposition

The earlier preview run had no error-level Supabase advisor finding. Security warnings were limited to intentionally exposed authenticated command RPCs implemented as `SECURITY DEFINER`; they are not waived generically. Each affected function must retain an empty `search_path`, direct authentication/current-session/active-membership authorization, minimal execute grants, and negative authorization tests. Performance INFO notices for unused indexes remain diagnostic until production traffic can establish meaningful usage.

Advisor results must be refreshed whenever the schema changes; the bound artifact or review record identifies the result applicable to the frozen tree.

## Final closure rule

This report becomes a PASS only after the exact frozen candidate is committed,
published, deployed as the approved broker, passes the complete local and
disposable-preview gates, and three fresh independent reviewers return no
P0/P1/P2 finding. The live result is an exact-tree integrated proof whose
reviewed deployment is part of the trusted computing base; it must never be
described as independent validation of arbitrary candidate code. Only the
implemented pieces of this `P2-01`–`P2-03` partial checkpoint may then be
described as `implemented_unverified`; the authoritative Phase 2 ledger remains
`unimplemented` until every mapped Phase 2 obligation is implemented. No Phase 2
obligation may become `verified` until the externally authenticated provenance
gate also passes.

Any subsequent code, migration, test, generated-artifact, or reviewed-visual change invalidates the affected closure evidence and requires the relevant gate and review to be repeated. No Phase 2 provider generation, voice canary, or production-video request is authorized by this checkpoint.

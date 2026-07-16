# Genie SDLC and Adversarial Assurance Contract

**Status:** authoritative delivery process  
**Inspiration reviewed:** Garry Tan's gstack workflow at commit
`a3259400a366593e0c909dd9ac3e59752efd2488`

Genie is a high-judgment media system with expensive, nondeterministic external
work. A green unit-test suite is necessary but cannot prove the product works.
Delivery therefore uses traceable requirements, cold reviews, runtime evidence,
and phased GitHub checkpoints.

## 1. Delivery loop

Every material phase follows:

1. **Think:** restate user outcome, constraints, risk, and evidence required.
2. **Specify:** assign stable requirement IDs and write acceptance examples.
3. **Plan:** map requirements to schema, routes, jobs, UI states, tests, and
   rollout gates.
4. **Build:** implement the smallest coherent vertical slices, not disconnected
   layers.
5. **Review:** run an independent, context-minimized adversarial design/code
   review against the requirement set.
6. **Test:** execute the full relevant pyramid and record artifacts.
7. **Repair:** resolve findings or document an explicit owner-accepted risk.
8. **Checkpoint:** commit and push a self-describing GitHub checkpoint.
9. **Reflect:** update project state, decisions, residual risks, and the next
   evidence target.

## 2. Traceability

`docs/traceability.md` is the requirement ledger. Each row contains:

- stable requirement ID;
- source and rationale;
- design section;
- implementation task;
- code/schema owner;
- automated test/evaluation;
- manual or visual evidence;
- status: `unimplemented`, `implemented_unverified`, `verified`, `failed`,
  `deferred_external`, or `superseded`;
- last verified commit and date.

No requirement becomes `verified` merely because code exists. The evidence must
cover the actual scope of the claim.

## 3. Independent adversarial review

The builder does not perform the only review of its own work. At each mandatory
gate, a cold reviewer receives:

- the original requirement and current artifact/code;
- relevant contracts and tests;
- no persuasive summary of why the implementation is supposedly correct.

The reviewer attacks:

- missing requirements and scope substitutions;
- unsafe assumptions;
- state and concurrency races;
- permissions and tenant isolation;
- provider failure, duplicate callback, and billed-failure behavior;
- fabricated UI progress or quality certainty;
- script mutation;
- cultural and source-provenance failures;
- nondeterminism, unbounded retries, and cost leakage;
- accessibility, responsive behavior, and visual regression;
- test gaps and weak assertions.

Findings are severity-labelled P0–P3. P0/P1 findings block a phase checkpoint
unless resolved or explicitly accepted by the owner with evidence and scope.

## 4. Test pyramid

### 4.1 Static and unit

- TypeScript strict and lint;
- pure state-transition and policy functions;
- schema validation;
- property tests for checksums, normalization maps, reference graphs, EDD time
  math, budget ledger, idempotency keys, and rubric calculations;
- snapshot/golden tests for look tails, prompt construction, captions,
  timelines, and manifests.

### 4.2 Database and authorization

- migration apply/rollback checks where reversible;
- RLS allow/deny matrix for every exposed table and storage path;
- transaction, uniqueness, compare-and-swap, fencing, and outbox tests;
- multi-user concurrent claims and stale permission tests;
- backup and restore rehearsal evidence.

### 4.3 Contract and adapter

- provider request/response fixtures;
- schema drift and capability expiry;
- timeout, retry, cancellation, webhook replay, duplicate callback, late
  callback, and `billed_no_asset`;
- durable ingest, media probe, hash, and provenance;
- bounded live canaries only after mocked contracts pass.

### 4.4 Workflow integration

- every waitpoint and recovery path;
- browser/server closure and deployment resumption;
- overlapping episodes, exports, and repair branches;
- replacement/supersession;
- queue fairness, backpressure, and spend reservations;
- reconciliation after missed callbacks or worker death.

### 4.5 Browser end-to-end

For desktop, tablet, and mobile:

- first-use, active, success, partial, retrying, delayed, failed, blocked,
  stale, canceled, and resumed states;
- keyboard-only flow, focus containment, screen-reader announcements,
  reduced-motion mode, contrast, and 44 px touch targets;
- exact script locking;
- all 117 looks and default selection;
- character/location generate-edit-regenerate-upload-accept;
- background production while navigating elsewhere;
- Repair Room rows, clarification, A/B review, rollback, and stale-master
  rejection;
- search, notifications, downloads, and multi-user conflicts.

Every critical E2E produces screenshots, console/network error evidence, and a
machine-readable result.

### 4.6 Media and AI evaluation

- deterministic ffprobe/loudness/frame-rate/resolution/package checks;
- seeded identity, anatomy, attribute, flicker, caption, audio, and continuity
  defects;
- detector recall/false-positive datasets;
- judge repeatability and challenger disagreement;
- blind human benchmark ranking when the owner supplies samples;
- one full live canary Episode before production traffic.

## 5. Phase gates

### Design complete

- authoritative design and companion contracts agree;
- rubrics have a release-contract mapping;
- state/data and threat contracts exist;
- provider claims are verified or explicitly unverified;
- cold adversarial design findings are resolved;
- UI prototype is honestly labelled and visually/browser tested.

### Plan complete

- every requirement maps to a task and proof;
- dependency order and migration strategy are executable;
- test fixtures and external canaries are budgeted;
- each phase has entry/exit gates, rollback, and evidence;
- cold plan review finds no unresolved P0/P1.

### Implementation phase complete

- phase requirements are implemented;
- relevant full regression suite passes;
- cold code/test review completed;
- adversarial runtime tests completed;
- security delta and visual QA completed;
- docs/project state and traceability updated;
- checkpoint committed and pushed.

### Provider-enabled production

- software-complete gates pass;
- deployed smoke and restoration tests pass;
- live provider canary passes;
- authenticated cost/capacity/billing evidence passes;
- Monica may operate provisionally, but qualified cultural and creative/final
  human approvals remain mandatory.

### Product-calibrated

- the owner's first 10–20 Episodes have completed pilot/tuning;
- the predeclared corpus reaches at least 30 calibration plus 20 untouched
  holdout Episodes;
- rubric, detector, per-slice confidence, and independent-human gates pass;
- unsupported cells keep conservative routing or human review.

## 6. Security delta review

Every phase records changes to:

- trust boundaries;
- identities and permissions;
- data classes and retention;
- upload/fetch surfaces;
- agent tools;
- webhook/provider exposure;
- secrets;
- billing/spend authority;
- logs and alerts.

The final threat model is cumulative; phase reviews cannot declare “no new
risk” without checking the actual diff.

## 7. Git and release discipline

- Work on branches prefixed `codex/` when a branch is required.
- Preserve user-owned untracked files.
- Never commit secrets or `.env.local`.
- Commits describe an independently useful checkpoint.
- Push using the explicit GitHub URL; do not persist a local `origin`.
- Tag evidence with the commit SHA it validates.
- Database migrations are ordered and forward-safe; destructive migrations
  require a staged expand/migrate/contract rollout.
- Feature flags guard incomplete provider or expensive paths.

## 8. Context-degradation protection

`docs/project-state.md` is updated after every checkpoint with:

- objective and non-negotiable decisions;
- current branch and pushed SHA;
- completed work and evidence;
- active risks and external dependencies;
- exact next actions and commands;
- files that must not be modified or committed.

Long reasoning is converted into repository artifacts. A fresh reviewer or
future task should be able to continue from the repository without trusting
chat memory.

## 9. Evidence integrity

Evidence is labelled:

- `VERIFIED`: directly tested against the current commit/environment;
- `FAILED`: test contradicts the requirement;
- `UNVERIFIED`: plausible but not tested;
- `DEFERRED_EXTERNAL`: requires credentials, deployment, samples, or owner
  action not currently available;
- `SUPERSEDED`: no longer applies and points to its replacement.

Simulations, mocks, screenshots, unit tests, and live canaries are distinct
evidence classes. One may not be presented as another.

## 10. gstack references

- Repository:
  <https://github.com/garrytan/gstack/tree/a3259400a366593e0c909dd9ac3e59752efd2488>
- Specification:
  <https://github.com/garrytan/gstack/blob/main/spec/SKILL.md>
- Review:
  <https://github.com/garrytan/gstack/blob/main/review/SKILL.md>
- QA:
  <https://github.com/garrytan/gstack/blob/main/qa-only/SKILL.md>
- Security:
  <https://github.com/garrytan/gstack/blob/main/cso/SKILL.md>
- Ship:
  <https://github.com/garrytan/gstack/blob/main/ship/SKILL.md>
- Context save:
  <https://github.com/garrytan/gstack/blob/main/context-save/SKILL.md>

Genie adopts the useful controls and evidence model, not arbitrary scores,
ceremony, or a claim of 100% coverage.

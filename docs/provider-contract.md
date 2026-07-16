# Genie Provider and Infrastructure Contract

**Status:** authoritative design companion  
**Official documentation observed:** 2026-07-17  
**Authenticated account canaries:** not yet verified  
**Owner:** provider adapters and capability registry

This document converts provider research and the local infrastructure workbook
into a runtime contract. Provider names in product code are configuration data,
not scattered conditionals.

## 1. Operating rules

1. Product and workflow code request a capability; only an adapter knows a
   vendor endpoint.
2. Every enabled capability has a versioned snapshot with `verified_at`,
   request schema hash, supported inputs, limits, price basis, retention/policy
   notes, health state, and tested fallback.
3. A snapshot may be `verified`, `degraded`, `disabled`, `unverified`, or
   `superseded`. Expired or unverified rows cannot receive production traffic.
4. Adapter inputs and outputs are validated at both boundaries. Provider output
   is untrusted until fetched, probed, hashed, and stored by Genie.
5. Provider request IDs, Genie idempotency keys, attempts, callbacks, usage,
   reservation, actual cost, and outcomes are append-only evidence.
6. A provider switch may never silently change a Series voice, visual identity,
   duration, resolution, content policy, or quality tier.

## 2. Launch capability matrix

| Capability | Primary | When selected | Fallback / failure behavior |
|---|---|---|---|
| Reasoning, planning, Monica | OpenAI through a typed adapter | Default structured planning and tool decisions | A prequalified Anthropic adapter may challenge or replace a failed call; never mix incompatible schemas silently |
| Independent quality challenger | Separately configured reasoning/VLM adapter | High-consequence, low-confidence, or disputed verdicts | Human review if no independent challenger is healthy |
| Image generation/edit | Nano Banana 2 on fal.ai | Look previews, character/location anchors, sheets, keyframes, repair edits | Retry bounded variants; no silent model change after an identity is approved |
| Simple camera + simple subject motion | Kling 2.5 Turbo Pro on fal.ai | Shot classifier marks both camera and subject motion simple | Seedance only after a compatibility and continuity re-plan |
| Camera-led motion | Kling 3 on fal.ai | Deliberate camera move is the shot's main expressive device | Seedance after re-plan; never send unsupported reference shapes |
| Other or reference-dense motion | Seedance 2 on fal.ai | Complex subject action, multi-reference, audio/reference-dense, or non-camera-led shots | Re-plan references/duration or escalate; no capability fiction |
| Hindi narration | ElevenLabs TTS | Locked narration segments with performance sidecars | Prequalified voice-compatible route only; otherwise pause before spend |
| Male narrator | ElevenLabs voice `b0oby86k6n7Uh5LZcOBR` | Default user choice | No silent voice substitution |
| Female narrator | ElevenLabs voice `GSdeLRB8detpjZjN63Wn` | User selects female | No silent voice substitution |
| Music generation | ElevenLabs Music v2 | Bounded instrumental bridge, extension, motif, or missing library coverage | Curated owned/licensed score library; generation is not required when a better track exists |
| Sound effects | ElevenLabs Sound Effects | Bespoke SFX/ambience not covered by owned library | Owned/licensed SFX library |
| Speech alignment / ASR | Capability-registry selection | Word timing, reconciliation, pronunciation evidence | Fail closed for caption/master release if required timing cannot be established |
| Durable data and diagnostics | Supabase Postgres | Source of truth | Deployment is blocked without migrations, RLS, backup verification, and health checks |
| Durable media | Supabase Storage | All accepted inputs and outputs | Provider URLs are ingress only |
| Durable orchestration | Trigger.dev | Long-running stateful workflows and waitpoints | Postgres outbox remains authoritative; reconciliation resumes missed work |
| Media assembly | Pinned Trigger.dev Cloud ffmpeg task queue | EDD compile, captions, mix, package, probes | Vercel functions may not emulate this with short-lived in-process rendering |
| Video upscale/conform | Topaz video upscale on fal.ai | Retained economical 720p clips require 1080×1920 delivery | Native-1080p generation only when quoted and quality-qualified; fail closed if neither route passes |

## 3. Documentation-observed media endpoints

The endpoint identifiers and price evidence below were observed in official
provider documentation on the date above. They remain `unverified` for
production until Genie persists the raw/schema snapshot hash, authenticated
account receipt, bounded canary output, media probe, settled cost, retention
evidence, and tested concurrency. The design-time evidence payload is
`docs/evidence/provider-snapshots/fal-2026-07-17.json`.

### 3.1 Nano Banana 2

- fal endpoint: `fal-ai/nano-banana-2/edit`
- use: reference-conditioned image editing and generation
- production constraints: taken only from the persisted authenticated schema
  snapshot; the product must not advertise an input-reference count or
  resolution until that snapshot and a canary prove it
- official reference:
  <https://fal.ai/models/fal-ai/nano-banana-2/edit>

Genie separates a clean identity portrait from the multi-view character sheet.
The portrait is the primary likeness anchor; a collage sheet is an approval and
derived-reference artifact, not the default face reference.

### 3.2 Kling 2.5

- fal endpoint:
  `fal-ai/kling-video/v2.5-turbo/pro/image-to-video`
- documentation-observed duration values: 5 or 10 seconds
- inputs used by Genie: start image, prompt, optional tail image when the
  capability snapshot verifies support
- official reference:
  <https://fal.ai/docs/model-api-reference/video-generation-api/kling-video-v2.5-turbo-pro>

### 3.3 Kling 3

- standard:
  `fal-ai/kling-video/v3/standard/image-to-video`
- pro:
  `fal-ai/kling-video/v3/pro/image-to-video`
- documentation-observed range used by Genie: 3–15 seconds
- pro features represented as distinct typed fields: start/end frames,
  elements, and `multi_prompt`
- native audio defaults off because Genie builds the final soundscape
  deterministically
- official references:
  <https://fal.ai/models/fal-ai/kling-video/v3/standard/image-to-video/api>
  and
  <https://fal.ai/models/fal-ai/kling-video/v3/pro/image-to-video>

### 3.4 Seedance 2

- text route: `bytedance/seedance-2.0/text-to-video`
- reference route: `bytedance/seedance-2.0/reference-to-video`
- documentation-observed reference limits: up to nine images, three videos, three audio
  references, and twelve references total
- documentation-observed range used by Genie: 4–15 seconds, 9:16,
  tier-dependent 720p/1080p
- official references:
  <https://fal.ai/models/bytedance/seedance-2.0/text-to-video> and
  <https://fal.ai/models/bytedance/seedance-2.0/reference-to-video>

The adapter must distinguish ordered images, videos, audio references, start
frame, end frame, and prior-clip continuity. A generic array of URLs is not an
acceptable internal type.

### 3.5 Topaz video upscale

- fal endpoint: `fal-ai/topaz/upscale/video`
- launch use: accepted 720p clip to 1080p conform, native 30 fps
- documentation-observed rate: USD 0.02 per input second for 720p-to-1080p
- official reference:
  <https://fal.ai/models/fal-ai/topaz/upscale/video>

The route is not a quality escape hatch. Output must preserve duration,
frame count, identity, face/hands, deity attributes, text, temporal stability,
and color. One bounded alternate-setting retry is allowed; otherwise the shot
returns to generation or blocks the master.

## 4. ElevenLabs audio contract

Official references:

- TTS: <https://elevenlabs.io/docs/overview/capabilities/text-to-speech>
- SFX: <https://elevenlabs.io/docs/overview/capabilities/sound-effects>
- Music compose: <https://elevenlabs.io/docs/api-reference/music/compose>

Voice IDs are seeded as versioned `voice_assets`, including account owner,
permitted use, provider availability, sample checksum, language test result,
pronunciation test result, and `verified_at`. Selecting narrator gender pins a
voice-asset version into the Episode configuration.

Until a persisted account canary passes, the UI may show each configured ID as
`Configured · validation pending`; it must not claim “Sanskrit fluent,” a
particular accent, or production readiness from the ID alone. The canary suite
stores model/version, settings, exact Hindi/Sanskrit fixture hashes, audio,
alignment, independent human result, and cost/usage receipt.

Narration is segmented only at reversible processing boundaries. Segment text
must equal a span of the locked processing script, and concatenation must
reconstruct it exactly. Provider character limits are capability data, not UI
assumptions. Every segment stores request text hash, returned audio hash,
duration, alignment, retries, and synthesis settings.

Music v2 may compose from a prompt or composition plan and supports
instrumental generation. Genie uses it for bounded gaps or custom connective
material, not as a reason to discard a stronger curated score library.
Generated music and SFX must be stored with license/provider evidence and never
mixed directly from temporary URLs.

## 5. Score and SFX decision

Launch scoring uses a hybrid system:

1. a curated owned or licensed library is the preferred source for full-scene
   musical reliability;
2. ElevenLabs Music v2 supplies bespoke motifs, transitions, extensions, and
   uncovered rasa/tempo needs;
3. ElevenLabs SFX supplies bespoke effects and ambiences;
4. deterministic music supervision selects sections, snaps transitions, applies
   loudness envelopes, ducks around narration, preserves intentional silence,
   and mixes stems;
5. Monica evaluates narrative fit, repetition, masking, emotional contour, and
   continuity before release.

Epidemic Sound may be ingested only when Zyra has a license and an approved
headless acquisition workflow. The design does not assume its catalog can be
scraped or called through an undocumented API.

## 6. Cost ledger and reservations

`provider_rate_cards` are dated evidence snapshots. No price is hard-coded into
planning prompts or UI components.

The design-feasibility BOM and its known-versus-allowance distinction are
normative in `docs/cost-envelope.md`. Production quote computation never imports
the markdown values; it reads enabled authenticated rate-card rows.

A quote contains a low/expected/high range and assumptions. Its executable BOM
is per request and includes authenticated billing duration/quantum, minimum,
rounding rule, output count, resolution/tier/audio modifiers, candidate slots,
per-shot retry slots, alternate-route slots, and rate-card/canary evidence.
Candidate multipliers in planning documents are never dispatched directly.
Before enqueue, Genie reserves the complete itemized high envelope against the
configured ceiling. A retry consumes a pre-authorized slot; any new slot or
pricing-affecting route change requires a new quote and authorization. The
reservation limits additional authorized work; it cannot guarantee the
provider invoice, because refused, canceled, late, or failed calls may still
be billed.

The envelope is reserved exactly once. Each base request, retry and alternate
is an immutable, individually claimable quote-line slot. Creating a provider
request performs a compare-and-swap claim of one unused slot whose endpoint,
billing duration, outputs, resolution/tier/audio flags and modifiers exactly
match the request. Unique constraints permit one request per slot and one slot
per request. Claiming does not increment the workspace reserved balance again.
An unclaimed slot is released only when its run/repair branch becomes terminal
or a replacement quote atomically supersedes the authorization.

Each observed call appends one or more cost events:

- `reserved`
- `authorization_released`
- `usage_observed`
- `actual_cost`
- `billed_no_asset`
- `refund_observed`
- `cost_unknown`
- `reconciled`

No update overwrites historical cost. Retries point to their parent attempt.
Unknown billing blocks a claim of final cost accuracy but does not erase the
liability.

### 6.1 Preflight micro-envelope and broker trust boundary

A Phase 2 preflight provider request uses a separate micro envelope defined by
sections 4.3.2 and 4.3.3 of `docs/state-and-data-contract.md`. It never borrows
the production high envelope and can never claim `gen_video`, render, export,
approval, or publication scope.

Before a preflight request can enter `queued`, the broker verifies all of:

1. an authoritative, nonterminal preflight run/stage/attempt with the exact
   configuration candidate, authority epoch, input hash, lease, and fence;
2. a current confirmed micro quote, active authorization, sole reservation,
   and one exact unused allowed-capability slot;
3. current authenticated provider capability/rate evidence;
4. a Vercel-issued, registered one-attempt capability grant whose subject and
   scope match the request;
5. a separate Trigger-project service assertion whose Ed25519 signature,
   `client_id`, environment, Trigger project, `kid`, `iss`, `aud`,
   task/run/stage subject, `iat`, `nbf`, ≤60-second `exp`, and unique `jti`
   match the server-only broker registry; and
6. an atomic `broker_assertion.consume` plus slot claim before the provider key
   is loaded.

The service assertion authenticates the calling deployment only. The
capability grant authorizes only the registered attempt. Neither can substitute
for quote, budget, fence, policy, or provider-capability checks. Trigger
projects hold only their own broker-client private signing key and never a
provider key. Postgres stores public verification keys and hashed assertion
JTIs, never broker-client private keys.

Key rotation permits a bounded documented overlap of public-key versions.
Unknown, expired, not-yet-valid, disabled, wrong-environment, or revoked keys
fail closed. Revocation or client disable invalidates unexpired assertion JTIs
and wins any race before provider dispatch. Replay, wrong-project use, and
grant/assertion subject mismatch are mandatory security alerts. Every rejection
records safe correlation and reason codes without the assertion, grant, prompt,
or provider secret.

Provider outputs always enter the quarantine contract before becoming
authoritative. Output-producing account canaries cannot run until the
quarantine and malicious-media suite passes.

## 7. Capability freshness

The scheduled capability-sync job:

1. fetches or validates official schemas where machine-readable access exists;
2. performs a minimal non-billing validation or a bounded live canary;
3. compares schema, duration, aspect ratio, reference, safety, price, and
   retention properties;
4. writes a new immutable snapshot;
5. disables incompatible production routes;
6. creates a Monica/admin work item for material changes.

Freshness policy:

- production traffic: verified within 14 days;
- prices and policy notes: verified within 7 days;
- after a provider release or schema error: re-verify before the next job;
- stale rows: plan-only, never execution-enabled.

## 8. Data handling checklist

Before enabling a provider, record:

- account and credential owner;
- permitted commercial/internal use;
- input/output retention period;
- training use and opt-out state;
- data region if specified;
- deletion mechanism;
- content-policy link and effective date;
- callback/signature behavior;
- rate and concurrency limits;
- incident and revocation procedure;
- tested fallback and identity/quality impact.

Scripts, reference images, unreleased media, signed URLs, and credentials may
not enter unrestricted logs. Diagnostic payloads use allowlisted fields and
stable internal IDs.

## 9. Infrastructure decision

- Supabase is the system of record for Auth, Postgres, Storage, Realtime,
  diagnostics, QC evidence, cost events, and audit.
- Trigger.dev owns durable execution but not business truth.
- Vercel hosts the Next.js control plane.
- A dedicated Trigger.dev Cloud task queue runs the pinned ffmpeg build and
  machine profile in `docs/design.md` §15.6. It authenticates with a
  single-attempt capability token and signed object URLs, never a Supabase
  service-role secret.
- A separately restorable `Genie Vault` Supabase project receives critical
  content-addressed media, manifests, and audit copies.
- Sentry is intentionally excluded. Supabase diagnostics must therefore include
  alert routing, retention, redaction, deduplication, and operational views;
  merely storing errors is insufficient.

## 10. Production enablement gates

A capability may receive production traffic only when:

- configuration and credentials validate;
- a raw/schema snapshot, canonical normalized snapshot, and SHA-256 are
  persisted;
- its authenticated account receipt is verified and fresh;
- live smoke output passes media probes;
- cost units and reconciliation are tested;
- timeout, retry, cancellation, and duplicate callback tests pass;
- provider output is durably ingested;
- policy/data handling is accepted;
- configured account concurrency, queue age, and five-Episodes-per-day capacity
  pass a load test;
- a compatible fallback or explicit fail-closed path exists;
- generated evidence can be traced to the exact request and configuration.

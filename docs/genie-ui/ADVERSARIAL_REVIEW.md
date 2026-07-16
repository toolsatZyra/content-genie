# Genie UI adversarial review

**Review mode:** context-blind principal product design, accessibility, product-trust, and frontend source review
**Artifact reviewed:** Studio Atrium, Series World, Living Cinema, and Monica Repair Room interactive prototype
**Disposition:** distinctive visual direction retained; the prototype now demonstrates the operating system around an episode as well as the episode itself

## Verdict

The manuscript chamber, arched vertical-film frames, editorial typography, saffron/gold devotional palette, six-stage journey, and Monica quality language remain substantially more distinctive than a conventional AI studio.

The expanded prototype now has a coherent product hierarchy:

1. Studio Atrium for attention, active work, search, and switching.
2. Series World for episodes, the pinned World Bible, inheritance, and collaboration history.
3. Living Cinema for the existing episode-production flow.
4. Monica Repair Room for structured, reversible, timecoded feedback.

The strongest product decision is that chat is not the system of record for repairs. Editable feedback rows remain canonical; Monica’s conversational layer interprets, groups, and explains them.

## Original Living Cinema corrections retained

| Finding | Resolution |
|---|---|
| Future stages could be opened without prerequisites | Journey and command destinations remain guarded until unlocked |
| Screen position incorrectly implied completed work | Completion comes from explicit stage state, not navigation index |
| Narrator/look did not reach final output | Final metadata and preview use the current narrator and look |
| Upstream changes preserved stale downstream work | Script, voice, look, and world changes invalidate dependent stages and production |
| Script lock did not lock or hash | Non-empty validation, read-only state, SHA-256 fragment, and duration estimate remain |
| Asset prompt editing was not asset-specific | Shiva, Parvati, and Kailash retain separate prompt state plus current Look DNA |
| Focus could escape modals | Focus containment, topmost-Escape behavior, inert background content, and focus restoration remain |
| Look vault eagerly created all 117 images | Vault content remains lazy, searchable, and paged |
| Create-another preserved stale state | New-film reset clears prior production state |

## 2026-07-17 operating-layer adversarial pass

| Finding | Resolution |
|---|---|
| The prototype implied Genie was only a single-video tunnel | Added Studio Atrium/Home around the existing Living Cinema flow |
| Concurrent productions had no trustworthy progress language | Added stage and completed-work-unit descriptions; removed visible provider percentages |
| Simulated dollars and numerical Monica scores looked authoritative | Removed exact live cost totals and quality scores; estimates are described as provider ranges |
| Users could not see what needed action versus what was merely running | Separated Studio Pulse from Monica Inbox and gave every inbox item a precise destination |
| A Series risked becoming a decorative folder | Added a versioned World Bible with look, character, location, narrator, and inheritance semantics |
| New episodes could silently follow mutable “latest” assets | The design explicitly pins a World Bible release per episode |
| Episode-specific changes could accidentally mutate canon | The UI states that overrides remain local until explicitly proposed to the Series Bible |
| Repair was a placeholder with no accountable input model | Added repeatable timecode/range rows, free-text feedback, removal, and add-at-playhead behavior |
| Raw chat could trigger one expensive generation per message | Monica groups notes by dependency into repair work units before execution |
| A user-entered timestamp could be mistaken for the true repair boundary | The Repair Room explains requested range versus actual shot, transition, or audio scope |
| A repair could silently change the script | Repair plan visibly locks narration words, order, voice identity, look, and approved anchors |
| Local repair success could hide global regression | Plan and result states explicitly include boundary checks and full-episode regression review |
| Repair acceptance destroyed the previous candidate | A/B comparison and revision language preserve the base candidate and rollback path |
| Accepting cards looked like an instant World Lock | Added a qualified Series-editor decision with pending, authorize, deny, and recorded states bound to one Episode aggregate and pinned release |
| Character sheets and cultural readiness could appear bypassed | Added automatic identity packs, character sheets, deity/temple/source/rights readiness, and machine cultural preflight before autonomy |
| Paid generation could begin without an auditable operating ceiling | Added clearly simulated low/expected/high quote values plus reserve/authorize hard-ceiling confirmation before enqueue |
| Machine readiness could be mistaken for human approval | Premiere now sequences Monica readiness, exact qualified cultural approval, and then separate human creative/final approval as three records |
| Repair timestamps and directions were accepted as arbitrary strings | Added deterministic `MM:SS.d` bounds, required feedback, end-after-start validation, conflict detection, unsupported-scope flags, and script-change clarification |
| Repair spend and dependency closure were opaque | Added task dependency scopes, deterministic plan hash, expected/high simulated quote, and a hard-ceiling gate |
| The UI still looked like one global mutable job | Added independent Episode aggregate records, pinned Series/config revisions, durable-job labels, artifact revisions, and stale/current markers |
| Duration consequences appeared only as a word estimate | Added 60–120 second pre-lock target feedback plus simulated post-TTS duration and voice-performance revision invalidation |
| Operational copy remained visually undersized | Raised operational body/control copy toward 14px, metadata to at least 12px, and interactive targets to 44px |
| Tab controls were mouse-oriented | Added arrow-key behavior to Series and Studio Activity tablists |
| Smooth scrolling ignored reduced-motion preferences | JavaScript scroll behavior now follows `prefers-reduced-motion`; CSS animation suppression remains |
| User-entered repair text could be injected into generated markup | Repair text and time ranges are escaped before plan/result rendering |

## Product-trust boundaries

The prototype deliberately does not pretend to know:

- provider-native generation percentage;
- an exact cost before a provider quote exists; displayed low/expected/high figures are explicitly marked simulated examples;
- an exact quality score without stored evidence and calibrated thresholds;
- exact completion time for asynchronous generation;
- whether a simulated repair genuinely improved a generated video.

All operational examples are covered by the prototype disclosure. Work meters represent named workflow stages or completed work units, not provider progress.

## Deliberately deferred to implementation

These remain production capabilities rather than claims made by the static simulation:

- real authentication, roles, assignments, presence, leases, and optimistic concurrency;
- server-owned Trigger.dev workflows and durable resumption;
- Supabase persistence, RLS, search indexes, audit records, and realtime notifications;
- live ElevenLabs audio and pronunciation evidence;
- real image/video provider calls, version manifests, and artifact storage;
- actual timeline-to-shot/audio dependency mapping;
- provider quotes, retry ceilings, and budget authorization;
- inspectable Monica thresholds, evidence, and calibrated rubric results;
- real A/B video playback, export packaging, signed downloads, and rollback;
- qualified cultural/theological policy review and provenance.

## Current QA evidence

- JavaScript syntax (`node --check`): passed
- Repository whitespace/error check (`git diff --check`): passed
- HTML IDs: 133 unique; no duplicates
- Direct JavaScript DOM-ID references: all 106 present in HTML
- CSS brace balance: 946 opening / 946 closing
- Operational typography scan: no 7–11px declarations remain; metadata floor
  is 12px, operational controls/body copy use 14px, and buttons have a
  44×44px minimum target
- Unlabelled exact cost, numerical quality-score, and provider-progress claim scan: passed; all example quote figures are explicitly marked simulated
- Keyboard and reduced-motion handling: reviewed in source
- One short-lived headless Playwright session loaded the local file directly
  without a dev server at 1440×1100 and an explicitly emulated 390×844
  viewport. Both had `scrollWidth == viewportWidth`, zero non-ambient overflow
  offenders, zero console errors, and zero page errors
- Desktop interaction smoke: Home → Series → Episode Premiere → Monica Repair
  Room all became visible as expected
- State-integrity smoke: Repair Plan → repaired candidate → promote to
  qualified review left creative approval unavailable, superseded prior
  decisions, and labelled the artifact `Candidate 02`, never `Approved`
- Authorization-order smoke: after all three World anchors and the Series
  decision were selected, the World Lock remained disabled until the quote
  ceiling checkbox was authorized; the one atomic record then opened
  autonomous production
- Screenshot inspection found a global `em` typography override shrinking the
  hero line and a narrow-layout heading/button collision. Both were corrected
  and the desktop/mobile captures were rerun successfully
- No Playwright/headless Chrome process or normal dev port remained after the
  check; existing user browser processes were not touched

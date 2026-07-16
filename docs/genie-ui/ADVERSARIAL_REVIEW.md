# Genie UI adversarial review

**Review mode:** context-blind principal product design, accessibility, and frontend QA review
**Artifact reviewed:** Living Cinema interactive prototype
**Disposition:** visual direction retained; trust, state, mobile, and accessibility findings corrected before owner approval

## Verdict

The reviewer found the manuscript chamber, arched vertical-film frames, editorial typography, saffron/gold devotional palette, six-stage journey, and Monica quality categories genuinely more distinctive than a generic AI studio.

The first prototype nevertheless looked more trustworthy than its state model warranted. It allowed gates to be bypassed and presented simulated production evidence as if it were live. That criticism was accepted.

## Resolution matrix

| Finding | Resolution |
|---|---|
| Future stages could be opened without prerequisites | Added one guarded job state; journey and command destinations disable until unlocked |
| Screen position incorrectly implied completed work | Completion now comes from explicit stage state, not navigation index |
| Narrator/look did not reach final output | Final metadata and preview now use current narrator and look |
| Upstream changes preserved stale downstream work | Script, voice, look, and world changes invalidate dependent stages and production |
| Monica scores and repairs appeared live | Added prototype-wide simulation disclosure and sample-state language |
| Script lock did not lock or hash | Added non-empty validation, read-only locked state, calculated SHA-256 fragment, and duration estimate |
| Every asset opened Shiva's prompt | Added separate Shiva, Parvati, and Kailash prompt state plus current look DNA |
| Kailash image contradicted its label | Replaced temple interior with a Himalayan master-environment reference |
| Mobile prioritized preview over script | Reordered the script chamber so the manuscript is first on narrow screens |
| Floating Monica obscured mobile controls | Moved Monica into the compact mobile top bar |
| Mobile final seal overlapped the title | Moved the seal into normal document flow |
| Dialog/button names and selection semantics were weak | Added dialog labels, button labels, `aria-pressed`, Hindi language metadata, and stage announcements |
| Focus could escape modals | Added focus containment, topmost-Escape behavior, and inert background content |
| Operational typography was too small | Increased creation, QC, asset, command, and final-review text sizes and contrast |
| Look vault created all 117 images on initial load | Vault contents are created only when opened, paged in 24-look batches, and released when closed |
| Shot counts contradicted one another | Standardized the sample production plan to seven shots; twelve remains the story-beat count |
| Create-another preserved stale state | Added a clean new-film reset |
| Shortcut always displayed Command-K | Added platform-aware Command-K / Ctrl-K labelling |

## Deliberately deferred to implementation

These are production capabilities, not claims made by the revised prototype:

- real ElevenLabs audio playback and pronunciation evidence;
- script/asset file upload;
- generated image and video calls;
- durable Trigger.dev job resumption;
- Supabase evidence persistence;
- inspectable Monica thresholds and before/after repair evidence;
- actual video playback, targeted timestamp repair, and export packaging;
- responsive thumbnail derivatives and CDN delivery beyond the prototype's 24-look paging;
- culturally qualified review policies and provenance records.

Each remains represented as a clearly labelled simulated interaction so the owner can approve the UX without mistaking the prototype for a functioning production backend.

## QA evidence

- Source JavaScript syntax check: passed
- Repository whitespace/error check: passed
- Desktop, tablet, and mobile headless renders: passed with zero horizontal document overflow
- Runtime console/page errors: zero
- Exact source script preserved through the full simulated workflow
- 117 looks present; Indian Mythology family search returns eight matches
- Per-asset prompt regeneration state: passed
- Production pause/resume: passed
- Final playback pause: passed
- Modal keyboard flow: passed
- Downstream invalidation: passed
- New-film state reset: passed

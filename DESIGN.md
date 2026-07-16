# Genie by Zyra — UI Design Source of Truth

**Status:** Proposed direction for owner approval
**Direction name:** Living Cinema
**Prototype:** `docs/genie-ui/index.html`

The prototype is explicitly labelled as an interactive design simulation. It demonstrates product behavior and state transitions; it does not claim that voice playback, media generation, QC evidence, or export are already connected.

## Product feeling

Genie is not a conventional video editor and should not resemble one. The user is not operating timelines, model settings, render queues, or a dense enterprise dashboard. They are giving creative direction to a living film studio.

The intended emotional arc is:

1. **Trust:** the user sees that their exact script is protected.
2. **Taste:** voice, look, characters, and locations feel pleasurable to choose.
3. **Wonder:** after world lock, the studio visibly awakens and works autonomously.
4. **Confidence:** Monica explains quality evidence and repairs without exposing implementation noise.
5. **Pride:** final review feels like a premiere, not another form submission.

## Core interaction metaphor

The application is a sequence of six cinematic chambers:

1. Script
2. Voice
3. Look
4. World
5. Create
6. Premiere

They are connected by a luminous journey line rather than a conventional left navigation sidebar. Each chamber has one dominant object and one obvious next action.

The chambers correspond directly to the launch product contract. There are no invented approval gates inside autonomous production.

## Visual language

### Palette

- Night: `#08080C`
- Elevated night: `#101017`
- Ivory text: `#F8F0DF`
- Saffron: `#FF8B42`
- Bright saffron: `#FFB05F`
- Sacred gold: `#F3D084`
- Rose: `#C75A6D`
- Indigo: `#6557DC`
- Pass green: `#62D69B`
- Critical red: `#FF7669`

Saffron and gold communicate creative energy, devotional warmth, and selection. Indigo carries intelligence and machine activity. Green is reserved for evidence-backed passing states.

### Typography

- Display: Georgia or an equivalent high-contrast editorial serif.
- UI and body: Inter/system sans-serif.
- Hindi narration: a readable Devanagari serif when available, with Georgia/system serif fallback.
- Technical metadata uses compact uppercase sans-serif with generous tracking.

Display typography should feel cinematic and editorial. UI typography remains restrained and highly legible.

### Geometry

The signature geometry is asymmetrical: round arches paired with squared or lightly rounded corners. This suggests portals, temple thresholds, film frames, and manuscript corners without copying religious ornament.

Uniform rounded rectangles are prohibited. Shape communicates role:

- Film portals: tall arches.
- Source/script: manuscript corners.
- Selection surfaces: asymmetric lozenges.
- System controls: circles and pills.
- Diagnostic evidence: restrained lines and compact lists.

### Imagery

Vertical cinematic imagery should dominate the creative surfaces. Interface chrome must not compete with the film.

Look thumbnails are visual choices first and text labels second. Character and location anchors should be large enough for facial, costume, ornament, and architectural judgment.

## Monica

Monica is Genie’s machine Quality Director and release orchestrator. She
certifies that the configured quality contract has passed and prepares the
release evidence; the permitted human reviewer remains the release authority.

She is represented as a warm orbiting light rather than a humanoid avatar. This avoids false anthropomorphism while still creating a memorable, friendly presence.

Monica:

- remains available from every chamber;
- speaks in plain language;
- explains viewer-visible impact, not only technical defects;
- distinguishes waiting, checking, passing, repairing, and blocking states;
- does not interrupt for issues she can repair autonomously;
- never lowers quality thresholds because of cost or time;
- links every release verdict to stored evidence.

Example:

> Shot 04 showed unstable rudraksha beads. I rejected the candidate and regenerated only that shot with stronger identity references.

## Motion

Motion must communicate state:

- Journey-line growth communicates progress.
- Portal transitions communicate entering another chamber.
- Scan lines communicate active generation.
- Orbit motion communicates Monica’s continuous observation.
- Shot movement communicates production fan-out and selection.
- Film playback communicates the final assembly.

Decorative motion that delays action or obscures content is prohibited. Every animation must respect `prefers-reduced-motion`.

## Interaction principles

1. Every chamber has one dominant creative decision.
2. The next action is visible without scrolling on standard laptop viewports whenever practical.
3. A user must always know what is locked and what a change would invalidate.
4. Creative selection is visual and tactile; technical detail is available on demand.
5. Long-running work is resumable. The user may leave without losing progress.
6. Automatic repair is narrated, not hidden.
7. Errors offer recovery and preserve accepted work.
8. The final video is the next human review after world lock.
9. Command navigation exists for repeated use, but never replaces visible navigation.
10. Keyboard, touch, and reduced-motion behavior are first-class.

## Prototype integrity contract

The approval prototype follows the same trust model intended for production:

- Future chambers remain locked until their real prerequisites are complete.
- Journey and command navigation obey the same gates.
- Locking the script creates a read-only source snapshot with a calculated hash and duration estimate.
- Changing the script, narrator, look, or accepted world anchors invalidates every dependent output.
- Narrator and look selections propagate into the final-film metadata and preview.
- Character/location prompt editing is specific to the selected asset and current look DNA.
- Starting a new film creates a clean job state rather than navigating back with stale data.
- Simulated scores, repairs, generation, playback, evidence, and export are labelled as simulated.

Production will replace the prototype state object with a versioned job aggregate containing the immutable script hash, narrator and voice version, look-pack version, accepted asset versions, shot-plan version, output versions, QC verdict versions, and final approval version.

## Human gates represented

There are four intentional human decisions before autonomy:

1. Provide and lock the exact narration.
2. Confirm narrator gender and performance direction.
3. Choose the visual look.
4. Accept, redirect, or upload every generated character and location anchor.

After the world is locked, the system produces autonomously until final-film review. The prototype contains no hidden clip-review gate.

## Product shell: the Studio Atrium

Living Cinema is the experience inside one Episode. Production also requires a
persistent shared Studio Atrium around it.

The Atrium contains:

- **Home / My Work:** actionable reviews, blockers, active productions, and
  recently completed films;
- **Series:** visual worlds containing versioned World Bibles and Episodes;
- **Productions:** all running, waiting, repairing, exporting, and blocked jobs;
- **Monica Inbox:** deduplicated work items and deep-linked notifications;
- **Library:** searchable approved, superseded, archived, and downloadable
  masters.

The Atrium is not a generic administrative dashboard. Series appear as authored
worlds with cover art, signature color, principal cast, and sound identity.
Episodes appear as film objects with poster frames and meaningful stage
progress. Dense list/table views remain available for high-volume operation,
but are not the default emotional presentation.

Inside Living Cinema, the Atrium recedes into a slim Studio Dock containing:

- back to Series;
- active-job count;
- action-required count;
- quick production switcher;
- Monica;
- current collaborators.

Leaving an Episode never pauses its server-owned production.

## Series and Episode visual behavior

A Series home should communicate both identity and activity:

- cover frame and Series title;
- pinned look and World Bible release;
- approved characters and locations;
- narrator and score identity;
- active Episodes;
- Episodes waiting for review;
- material Series changes;
- a dominant **Create next episode** action.

An Episode clearly distinguishes:

- inherited Series assets;
- Episode overrides;
- updates available from a newer Series Release;
- the exact configuration pinned by its active production run;
- current master, repair branch, approval, and export state.

Series changes never silently alter active or completed Episodes. Adoption is a
visible, versioned action with an impact preview.

## Monica Repair Room

The final-screen **Request a targeted repair** action opens an immersive Repair
Room rather than a small generic chat widget.

The final film remains dominant. A structured brief sits beside it. The user
may:

- pause and add a note at the current playhead;
- mark an in/out range;
- select transcript words;
- enter timecodes manually;
- add, edit, reorder, or remove practical feedback rows.

Each feedback row contains:

- timestamp or range;
- captured frame;
- original plain-language direction;
- resolved shot/transcript/track target;
- Monica's interpretation;
- status, clarification, cost, and eventual evidence.

Monica's conversation explains ambiguity, conflicts, dependency impact, cost,
and results. The structured rows—not raw chat messages—are the auditable source
of truth.

Before execution, Monica shows:

- rows merged into repair units;
- what will change;
- what remains locked;
- affected shots, tracks, transitions, and dependencies;
- estimated cost/time range;
- unsupported, conflicting, or script-changing requests.

After execution, the room provides:

- original/revised A/B playback;
- loops for affected ranges;
- before/after frames;
- row-by-row resolution status;
- complete regression-QC result;
- rollback and approval.

The UI must never imply that a selected ten-frame range guarantees a ten-frame
generation repair. It shows both the user's requested range and Monica's actual
safe repair scope.

## Adversarial review changes

A separate context-blind review challenged both the visual design and the honesty of the interaction model. The following corrections were incorporated before owner review:

- enforced prerequisite gates and explicit downstream invalidation;
- real read-only script locking and calculated source hash;
- selected narrator/look propagated to the final state;
- per-asset prompts and current look DNA;
- 117-look vault created on demand and paged in 24-look batches rather than placed in the initial DOM;
- simulation labelling for generation, QC, evidence, playback, and export;
- subject-correct Himalayan location reference;
- manuscript-first mobile hierarchy;
- named dialogs, selection semantics, Hindi language metadata, stage announcements, modal focus containment, inert background, visible focus states, and larger touch targets;
- larger operational typography and stronger low-emphasis contrast;
- consistent seven-shot sample plan and explicit distinction from twelve story beats.

## State coverage required in implementation

Every production stage must specify and test:

- empty/first-use;
- ready;
- active;
- success;
- partial success;
- retrying;
- paused;
- provider delayed;
- provider failed;
- quality-blocked;
- user action required;
- budget nearing limit;
- budget hard stop;
- stale dependency;
- canceled;
- resumed after deployment or browser closure.

World assets additionally require:

- generated option;
- accepted option;
- user-uploaded option;
- prompt editing;
- regeneration in progress;
- generation rejected by QC;
- version history;
- downstream invalidation warning.

## Responsive behavior

Responsive design is not desktop panels stacked mechanically.

- Desktop: spatial chamber with a strong dominant object and contextual secondary surfaces.
- Tablet: dominant object remains primary; choices reflow around it.
- Mobile: journey becomes an icon path; the manuscript leads on the source step, while vertical film imagery leads in later creative/review steps; controls follow in natural thumb order.
- All touch targets are at least 44 px for production UI.
- Hover-only discovery is prohibited.

## Accessibility

- Semantic buttons and form controls.
- Visible focus indication.
- Native reading and tab order.
- Text alternatives for meaningful imagery.
- Colour never carries status alone.
- Contrast must meet WCAG AA for essential content.
- Motion can be reduced without losing state information.
- Production progress and Monica verdicts must be announced through appropriate live regions.

## AI-slop rejection rules

Reject frontend work containing:

- a generic SaaS sidebar plus card grid as the main product experience;
- three equal feature cards used to fill space;
- decorative gradient blobs with no product meaning;
- identical border radii on every surface;
- generic “sparkle AI” copy without concrete state;
- fake metrics or invented scores;
- tiny unreadable metadata;
- excessive glassmorphism that weakens contrast;
- animations that exist only to impress;
- placeholder empty states such as “No items found”;
- hidden primary actions or hover-dependent controls;
- mockups that work at only one viewport;
- visual polish that masks unclear state or destructive consequences.

## Inspiration translated into Genie

- **Runway:** conversational direction and image-first preview before expensive generation.
- **Midjourney:** visual discovery, dense look exploration, and quick reuse of visual language.
- **Linear:** command navigation and keyboard fluency for repeated internal operation.
- **Rive:** meaningful interactive motion and celebratory moments that remain part of the shipped product.
- **gstack design discipline:** mockups before implementation, explicit interaction-state coverage, adversarial AI-slop review, responsive intent, accessibility, visual QA, and regression testing.

These are principles to translate, not interfaces to copy.

## Approval questions

The owner should judge:

1. Does Living Cinema feel like the right creative identity for Genie?
2. Is the dark devotional palette appropriate for daily use?
3. Does Monica feel helpful and memorable without becoming childish?
4. Does the six-chamber journey feel clearer and more enjoyable than a traditional studio dashboard?
5. Should the final implementation preserve this level of ambient motion, reduce it, or increase it?

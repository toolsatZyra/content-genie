# Genie developer-MVP delivery profile

**Effective:** 2026-07-20
**Authority:** owner direction
**Applies to:** the first developer-operated end-to-end Genie deployment

## Outcome

Ship one working internal path as quickly as practical:

script -> voice -> look -> world -> preflight -> edit/review -> approve -> export.

The first release is operated by the owner, at low volume, with manual
observation and final approval. It is not represented as a hardened public or
large-team production service.

## Invariants that remain mandatory

- Never mutate the submitted script.
- Preserve the selected voice, look, characters, locations, and cultural
  decisions through the generated master.
- Keep provider credentials server-side and out of logs, browser bundles, and
  committed files.
- Keep workspace authorization and basic row isolation intact.
- Record the itemized forecast and actual provider spend. For the owner-operated
  MVP, do not pause production or repair because the forecast exceeds USD 50.
  Duplicate-request prevention, bounded automatic retries, and exact cost
  attribution remain mandatory. The owner will select a future cap after
  reviewing several days of real Episode costs.
- Quarantine and validate provider media before it becomes selected input.
- Require the owner to review the final master before approval. The review
  master itself remains downloadable so the owner can make a manual edit;
  approved Episodes additionally expose the complete set of storyboard images
  and video clips used in the final edit.
- Research explicitly named real temples, festivals, and rituals from
  rights-verified public photographs and bind selected references to the shots
  where the real-world subject appears.
- Keep production migrations, provider calls, and Git deployment explicit and
  observable.

## MVP release gate

Run the smallest credible set of checks for the changed candidate:

1. formatting, lint, and type checking;
2. focused unit/API tests for changed behavior plus the existing concise unit
   regression;
3. migration apply and the existing Phase 2 pgTAP suites on preview;
4. one Chromium happy-path journey covering the complete available creation
   flow, plus focused regressions for UI that changed;
5. build, secretless boot, browser-bundle secret scan, and high-severity
   dependency scan;
6. one low-cost provider canary for each provider capability used by the final
   happy path;
7. one owner-observable end-to-end run and final human review;
8. explicit GitHub push and public Vercel smoke verification.

The focused real-world reference and edit-timeline acceptance checks are
defined in `docs/MVP_REAL_WORLD_VISUAL_RESEARCH_AND_EDITING_2026-07-20.md`.

A check is rerun when its owning code changes. Expensive unchanged checks are
not repeated merely to create a larger evidence packet.

## Deferred until user testing or wider team rollout

The following remain useful backlog items, but they do not block the
developer-MVP:

- exhaustive two-session race matrices beyond database uniqueness and
  transaction constraints;
- fault injection at every write, callback, lease, and render boundary;
- every browser state across desktop, tablet, mobile, 100%, and 200% zoom;
- exhaustive malformed-input, callback-ordering, and provider-drift
  permutations after representative boundary cases pass;
- a coverage percentage target beyond focused tests for changed behavior;
- per-phase independent cold or adversarial reviews;
- full multi-user presence, takeover, notification, retention, vault, PITR,
  and disaster-recovery qualification;
- calibration/holdout proof and the owner-supplied 10-20 Episode pilot;
- verification of every machine traceability child row before the first owner
  run.

Deferred items must be labelled `mvp_deferred` or `deferred_external`; they are
not described as verified. Any failure observed in the happy path, data
integrity, access control, secrets, spend control, or final-master identity
returns to blocking status immediately.

## Security-language boundary

Routine work should be described as application QA: authentication checks,
signed provider-call validation, duplicate-request handling, media validation,
secret scanning, and database consistency. Broad offensive-security language
or unrelated attack simulation is outside the MVP scope. Essential validation
of Genie-owned APIs remains in scope because it protects provider credentials,
spend, and user data.

## Promotion boundary

This profile authorizes an internal developer MVP. Before inviting a wider
team or increasing unattended spend, revisit the deferred concurrency,
recovery, monitoring, and multi-user items using evidence from actual owner
testing.
